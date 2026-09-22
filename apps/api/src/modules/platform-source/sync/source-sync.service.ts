import { randomUUID } from "node:crypto";
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
  /** Models whose own processing threw; the rest of the source still synced. */
  failed: number;
}

/** How many per-model failure messages are folded into `lastSyncError`. */
const MAX_REPORTED_FAILURES = 5;
/** Connection.name is (userId, name)-unique; keep generated names bounded. */
const MAX_CONNECTION_NAME = 120;
/** Recorded on runs cancelled because their model vanished from GPUStack. */
export const REMOVED_REASON = "model removed from GPUStack";

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
  private cancelRunsListener:
    | ((discoveredModelId: string, reason: string) => Promise<void>)
    | null = null;

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

  /**
   * Same inversion as `setReadyListener`: `markRemoved` must cancel the
   * removed model's in-flight automation run *through the runner* (spec §9 —
   * the child Benchmark / EvaluationRun has to be cancelled too), but sync
   * must never import the runner. The runner registers here in onModuleInit.
   */
  setCancelRunsListener(fn: (discoveredModelId: string, reason: string) => Promise<void>): void {
    this.cancelRunsListener = fn;
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
      failed: 0,
    };

    // Guard against mass-removal: a 200 with `items: []` (tenant-visibility
    // change, wrong cluster filter, mis-scoped API key) is indistinguishable
    // from a genuine full drain. If GPUStack reports zero models while this
    // source still has known (non-removed) DiscoveredModel rows, refuse to
    // run markRemoved — leave every model untouched and surface the
    // ambiguity via lastSyncError instead of silently disabling everything.
    if (models.length === 0) {
      const knownCount = await this.prisma.discoveredModel.count({
        where: { sourceId: src.id, status: { not: "removed" } },
      });
      if (knownCount > 0) {
        await this.prisma.platformSource.update({
          where: { id: sourceId },
          data: {
            lastSyncAt: new Date(),
            lastSyncError: `GPUStack returned 0 models while ${knownCount} are known — refusing to mass-remove; check the API key scope and cluster filter`,
          },
        });
        return result;
      }
    }

    // Per-model isolation: one bad model (a Connection name collision, a
    // constraint violation, a transient DB error) must not abort the whole
    // source's reconcile. Its externalId still goes into `seen` so the
    // failure can't be mistaken for "vanished from GPUStack" by markRemoved.
    const seen: string[] = [];
    const failures: string[] = [];
    try {
      for (const m of models) {
        seen.push(String(m.id));
        try {
          await this.syncModel(src, m, routes, instances, result);
        } catch (e) {
          result.failed++;
          failures.push(`${m.name}: ${(e as Error).message}`);
          this.log.error(`sync model ${m.name} (${m.id}) of source ${sourceId} failed`, e as Error);
        }
      }
      result.removed = await this.markRemoved(src, seen);
    } catch (e) {
      // Non-client (DB / Connection) failure: without this the UI would stay
      // green while nothing actually reconciled.
      await this.prisma.platformSource
        .update({ where: { id: sourceId }, data: { lastSyncError: (e as Error).message } })
        .catch(() => {});
      throw e;
    }

    await this.prisma.platformSource.update({
      where: { id: sourceId },
      data: { lastSyncAt: new Date(), lastSyncError: this.failureSummary(failures) },
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

  private failureSummary(failures: string[]): string | null {
    if (failures.length === 0) return null;
    const shown = failures.slice(0, MAX_REPORTED_FAILURES).join("; ");
    const rest = failures.length - Math.min(failures.length, MAX_REPORTED_FAILURES);
    return `${failures.length} model(s) failed to sync: ${shown}${rest > 0 ? ` (+${rest} more)` : ""}`;
  }

  /**
   * `Connection` is `@@unique([userId, name])` and `ConnectionService.create`
   * does not translate P2002, so a plain `gpustack/<model>` name throws the
   * moment two sources own a same-named model — or the user deletes and
   * re-adds a source (deleting a source cascades its DiscoveredModel rows but
   * the Connections they pointed at survive, because that FK is SetNull).
   *
   * Retry with progressively more specific, *stable* suffixes so a re-created
   * source converges on the same name rather than growing a new one per sync;
   * a random suffix is only the last resort.
   */
  private async createConnection(
    src: Decrypted,
    input: Parameters<ConnectionService["create"]>[1],
  ): Promise<{ id: string }> {
    const base = input.name;
    const shortSource = src.id.slice(-6);
    const candidates = [
      base,
      `${base} (${shortSource})`,
      `${base} (${shortSource}-${randomUUID().slice(0, 8)})`,
    ].map((n) => n.slice(0, MAX_CONNECTION_NAME));

    let last: unknown;
    for (const name of candidates) {
      try {
        return await this.connections.create(src.userId, { ...input, name });
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
        last = e;
        this.log.warn(`connection name "${name}" already taken for user ${src.userId}; retrying`);
      }
    }
    throw last;
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
    const previousStatus = dm.status;
    const routeName = dm.routeOverride ? dm.routeName : resolveDedicatedRoute(m.id, routes);
    let status = previousStatus;
    if (!routeName) status = "unroutable";
    else if (previousStatus === "unroutable" || previousStatus === "removed")
      status = dm.automationEnabled ? "active" : "new";

    // 2) Connection
    let connectionId = dm.connectionId;
    if (routeName && !connectionId) {
      const conn = await this.createConnection(src, {
        name: `gpustack/${m.name}`,
        // Connection.baseUrl is the host root — every existing caller
        // (quality-gate/endpoint-caller.ts, connection/discovery/probes/*)
        // appends its own API path (e.g. `/v1/chat/completions`). GPUStack
        // serves its OpenAI-compatible API at `/v1` from that root, so a
        // bare host here (no `/v1` suffix) is what those callers expect.
        baseUrl: src.baseUrl,
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
      (routeName !== dm.routeName ||
        previousStatus === "removed" ||
        previousStatus === "unroutable")
    ) {
      await this.connections.update(src.userId, connectionId, {
        ...(routeName !== dm.routeName ? { model: routeName } : {}),
        ...(previousStatus === "removed" || previousStatus === "unroutable"
          ? { enabled: true }
          : {}),
      });
    } else if (!routeName && connectionId && previousStatus !== "unroutable") {
      // Route deleted or became multi-target: disable the Connection so it
      // doesn't keep pointing at a route name GPUStack may reuse for a
      // different model. Re-enabled above once a dedicated route reappears.
      await this.connections.update(src.userId, connectionId, { enabled: false });
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
      // spec §9: cancel the in-flight run. This has to go through the runner
      // so the child Benchmark / EvaluationRun (a live K8s job) is cancelled
      // too — a raw updateMany here would flip the AutomationRun row and
      // leave the GPU job running forever.
      await this.cancelRuns(dm.id);
    }
    return gone.length;
  }

  private async cancelRuns(discoveredModelId: string): Promise<void> {
    const reason = REMOVED_REASON;
    if (this.cancelRunsListener) {
      await this.cancelRunsListener(discoveredModelId, reason);
      return;
    }
    // No runner registered (unit context / module wiring regression): still
    // close the rows out so they can't sit "running" forever, and say loudly
    // that the child jobs were NOT cancelled.
    this.log.warn(
      `no cancel-runs listener registered; closing runs of ${discoveredModelId} without cancelling their child jobs`,
    );
    await this.prisma.automationRun.updateMany({
      where: { discoveredModelId, status: { in: ["pending", "running"] } },
      data: {
        status: "cancelled",
        verdict: "error",
        finishedAt: new Date(),
        lockedUntil: null,
        summary: { steps: [], reason },
      },
    });
  }
}
