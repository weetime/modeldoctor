import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../database/prisma.service.js";
import { ConnectionService } from "../../connection/connection.service.js";
import { GpustackClientFactory } from "../gpustack/gpustack-client.js";
import type { GpustackInstance, GpustackModel, GpustackRoute } from "../gpustack/types.js";
import { PlatformSourcesService } from "../sources/platform-sources.service.js";
import { buildSnapshot, deploymentFingerprint } from "./fingerprint.js";
import {
  resolveDedicatedRoute,
  tokenizerFromSource,
  toModalityCategory,
  toServerKind,
} from "./mapping.js";

export interface ReadyRevisionEvent {
  discoveredModelId: string;
  revisionId: string;
}

export interface ReconcileResult {
  models: number;
  revisionsCreated: number;
  readyRevisions: ReadyRevisionEvent[];
  removed: number;
}

type Decrypted = Awaited<ReturnType<PlatformSourcesService["getDecrypted"]>>;

/**
 * The single writer of DiscoveredModel / DeploymentRevision rows. Lists
 * GPUStack's current models + routes + instances, upserts discovered
 * models, resolves each model's dedicated route, creates/updates the
 * ModelDoctor Connection that points at it, computes the deployment
 * fingerprint, records a new DeploymentRevision when it changes, marks a
 * revision ready exactly once when GPUStack reports a running replica, and
 * marks models removed when they vanish from GPUStack.
 */
@Injectable()
export class SourceSyncService {
  private readonly log = new Logger(SourceSyncService.name);
  private readonly inflight = new Map<string, Promise<ReconcileResult>>();
  private readyListener: ((e: ReadyRevisionEvent) => Promise<void>) | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sources: PlatformSourcesService,
    private readonly clients: GpustackClientFactory,
    private readonly connections: ConnectionService,
  ) {}

  /** Task 8's runner registers here; avoids a sync <-> runner circular dependency. */
  setReadyListener(fn: (e: ReadyRevisionEvent) => Promise<void>): void {
    this.readyListener = fn;
  }

  /** Concurrent reconcile() calls for the same sourceId coalesce into one in-flight promise. */
  reconcile(sourceId: string): Promise<ReconcileResult> {
    const existing = this.inflight.get(sourceId);
    if (existing) return existing;
    const p = this.doReconcile(sourceId).finally(() => this.inflight.delete(sourceId));
    this.inflight.set(sourceId, p);
    return p;
  }

  private async doReconcile(sourceId: string): Promise<ReconcileResult> {
    const src = await this.sources.getDecrypted(sourceId);
    let models: GpustackModel[];
    let routes: GpustackRoute[];
    let instances: GpustackInstance[];
    try {
      const client = await this.clients.create(src.baseUrl, src.apiKey);
      [models, routes, instances] = await Promise.all([
        client.listModels(),
        client.listRoutes(),
        client.listInstances(),
      ]);
    } catch (e) {
      await this.prisma.platformSource.update({
        where: { id: sourceId },
        data: { lastSyncError: (e as Error).message },
      });
      throw e;
    }

    if (src.clusterId) models = models.filter((m) => String(m.cluster_id ?? "") === src.clusterId);

    const result: ReconcileResult = {
      models: models.length,
      revisionsCreated: 0,
      readyRevisions: [],
      removed: 0,
    };
    const seen: string[] = [];
    for (const m of models) {
      seen.push(String(m.id));
      await this.syncModel(src, m, routes, instances, result);
    }
    result.removed = await this.markRemoved(src, seen);

    await this.prisma.platformSource.update({
      where: { id: sourceId },
      data: { lastSyncAt: new Date(), lastSyncError: null },
    });

    for (const e of result.readyRevisions) {
      try {
        await this.readyListener?.(e);
      } catch (err) {
        this.log.error(`ready listener failed for revision ${e.revisionId}`, err as Error);
      }
    }
    return result;
  }

  private async syncModel(
    src: Decrypted,
    m: GpustackModel,
    routes: GpustackRoute[],
    instances: GpustackInstance[],
    result: ReconcileResult,
  ): Promise<void> {
    const externalId = String(m.id);
    const categories = m.categories ?? [];
    let dm = await this.prisma.discoveredModel.upsert({
      where: { sourceId_externalId: { sourceId: src.id, externalId } },
      create: {
        sourceId: src.id,
        externalId,
        name: m.name,
        categories,
        clusterId: m.cluster_id != null ? String(m.cluster_id) : null,
        status: "new",
      },
      update: {
        name: m.name,
        categories,
        clusterId: m.cluster_id != null ? String(m.cluster_id) : null,
      },
    });

    // 1) Route
    const routeName = dm.routeOverride ? dm.routeName : resolveDedicatedRoute(m.id, routes);
    let status = dm.status;
    if (!routeName) status = "unroutable";
    else if (status === "unroutable" || status === "removed")
      status = dm.automationEnabled ? "active" : "new";

    // 2) Connection
    let connectionId = dm.connectionId;
    if (routeName && !connectionId) {
      const conn = await this.connections.create(src.userId, {
        name: `gpustack/${m.name}`,
        baseUrl: `${src.baseUrl}/v1`,
        apiKey: src.apiKey,
        model: routeName,
        customHeaders: "",
        queryParams: "",
        category: toModalityCategory(categories),
        tags: ["gpustack"],
        serverKind: toServerKind(m.backend),
        tokenizerHfId: tokenizerFromSource(m),
      });
      connectionId = conn.id;
    } else if (
      routeName &&
      connectionId &&
      (routeName !== dm.routeName || dm.status === "removed")
    ) {
      await this.connections.update(src.userId, connectionId, {
        ...(routeName !== dm.routeName ? { model: routeName } : {}),
        ...(dm.status === "removed" ? { enabled: true } : {}),
      });
    }

    // 3) Revision
    const fingerprint = deploymentFingerprint(m);
    let revision = await this.prisma.deploymentRevision.findUnique({
      where: { discoveredModelId_fingerprint: { discoveredModelId: dm.id, fingerprint } },
    });
    if (!revision) {
      try {
        revision = await this.prisma.deploymentRevision.create({
          data: {
            discoveredModelId: dm.id,
            fingerprint,
            snapshot: buildSnapshot(m, instances) as Prisma.InputJsonValue,
          },
        });
        result.revisionsCreated++;
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
        revision = await this.prisma.deploymentRevision.findUniqueOrThrow({
          where: { discoveredModelId_fingerprint: { discoveredModelId: dm.id, fingerprint } },
        });
      }
    }

    // 4) Ready (conditional update guarantees a single flip across replicas)
    if ((m.ready_replicas ?? 0) >= 1 && !revision.readyAt) {
      const { count } = await this.prisma.deploymentRevision.updateMany({
        where: { id: revision.id, readyAt: null },
        data: {
          readyAt: new Date(),
          snapshot: buildSnapshot(m, instances) as Prisma.InputJsonValue,
        },
      });
      if (count === 1)
        result.readyRevisions.push({ discoveredModelId: dm.id, revisionId: revision.id });
    }

    dm = await this.prisma.discoveredModel.update({
      where: { id: dm.id },
      data: { routeName, status, connectionId, currentRevisionId: revision.id },
    });
  }

  private async markRemoved(src: Decrypted, seenExternalIds: string[]): Promise<number> {
    const gone = await this.prisma.discoveredModel.findMany({
      where: {
        sourceId: src.id,
        externalId: { notIn: seenExternalIds },
        status: { not: "removed" },
      },
    });
    for (const dm of gone) {
      await this.prisma.discoveredModel.update({
        where: { id: dm.id },
        data: { status: "removed" },
      });
      if (dm.connectionId)
        await this.connections.update(src.userId, dm.connectionId, { enabled: false });
      await this.prisma.automationRun.updateMany({
        where: { discoveredModelId: dm.id, status: { in: ["pending", "running"] } },
        data: {
          status: "cancelled",
          verdict: "error",
          finishedAt: new Date(),
          summary: { steps: [], reason: "model removed from GPUStack" },
        },
      });
    }
    return gone.length;
  }
}
