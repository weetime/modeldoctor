import { randomUUID } from "node:crypto";
import {
  type AutomationRunPublic,
  type AutomationStep,
  type AutomationSummary,
  DEFAULT_GATE_CONFIG,
  type DeploymentRevisionPublic,
  type DiscoveredModelPublic,
  type GpustackRouteOption,
  type ListDiscoveredModelsQuery,
  type UpdateDiscoveredModel,
} from "@modeldoctor/contracts";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import {
  type AutomationRun,
  type DeploymentRevision,
  type DiscoveredModel,
  Prisma,
} from "@prisma/client";
import { PrismaService } from "../../../database/prisma.service.js";
import { ConnectionService } from "../../connection/connection.service.js";
import { AutomationRunnerService } from "../automation/automation-runner.service.js";
import { nextScheduleAt } from "../automation/regression.js";
import { GpustackClientFactory } from "../gpustack/gpustack-client.js";
import { PlatformSourcesService } from "../sources/platform-sources.service.js";
import { diffSnapshots } from "../sync/fingerprint.js";

type ModelRow = DiscoveredModel & {
  source: { name: string; userId: string };
  runs: AutomationRun[];
};

export function toRunPublic(r: AutomationRun): AutomationRunPublic {
  return {
    id: r.id,
    discoveredModelId: r.discoveredModelId,
    revisionId: r.revisionId,
    trigger: r.trigger as AutomationRunPublic["trigger"],
    status: r.status as AutomationRunPublic["status"],
    currentStep: r.currentStep,
    verdict: (r.verdict as AutomationRunPublic["verdict"]) ?? null,
    diagnosticsRunId: r.diagnosticsRunId,
    evaluationRunId: r.evaluationRunId,
    benchmarkId: r.benchmarkId,
    summary: (r.summary as AutomationSummary | null) ?? null,
    startedAt: r.startedAt?.toISOString() ?? null,
    finishedAt: r.finishedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

@Injectable()
export class DiscoveredModelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: AutomationRunnerService,
    private readonly connections: ConnectionService,
    private readonly sources: PlatformSourcesService,
    private readonly clients: GpustackClientFactory,
  ) {}

  private readonly include = {
    source: { select: { name: true, userId: true } },
    runs: { orderBy: { createdAt: "desc" as const }, take: 1 },
  };

  private async toPublic(m: ModelRow): Promise<DiscoveredModelPublic> {
    const rev = m.currentRevisionId
      ? await this.prisma.deploymentRevision.findUnique({ where: { id: m.currentRevisionId } })
      : null;
    const snap = (rev?.snapshot ?? {}) as Record<string, unknown>;
    return {
      id: m.id,
      sourceId: m.sourceId,
      sourceName: m.source.name,
      externalId: m.externalId,
      name: m.name,
      categories: m.categories,
      clusterId: m.clusterId,
      status: m.status as DiscoveredModelPublic["status"],
      routeName: m.routeName,
      routeOverride: m.routeOverride,
      connectionId: m.connectionId,
      currentRevision: rev
        ? {
            id: rev.id,
            fingerprint: rev.fingerprint,
            backend: (snap.backend as string | undefined) ?? null,
            backendVersion: (snap.backend_version as string | undefined) ?? null,
            readyAt: rev.readyAt?.toISOString() ?? null,
          }
        : null,
      automationEnabled: m.automationEnabled,
      steps: m.steps as AutomationStep[],
      evaluationId: m.evaluationId,
      gateConfig: (m.gateConfig as DiscoveredModelPublic["gateConfig"]) ?? null,
      benchmarkTemplateId: m.benchmarkTemplateId,
      schedule: m.schedule as DiscoveredModelPublic["schedule"],
      nextScheduledAt: m.nextScheduledAt?.toISOString() ?? null,
      baselineId: m.baselineId,
      regressionThresholds:
        (m.regressionThresholds as DiscoveredModelPublic["regressionThresholds"]) ?? null,
      lastRun: m.runs[0] ? toRunPublic(m.runs[0]) : null,
    };
  }

  private async findOwned(userId: string, id: string): Promise<ModelRow> {
    const m = await this.prisma.discoveredModel.findFirst({
      where: { id, source: { userId } },
      include: this.include,
    });
    if (!m) throw new NotFoundException(`Discovered model ${id} not found`);
    return m;
  }

  async list(userId: string, q: ListDiscoveredModelsQuery): Promise<DiscoveredModelPublic[]> {
    const rows = await this.prisma.discoveredModel.findMany({
      where: {
        source: { userId },
        ...(q.sourceId ? { sourceId: q.sourceId } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(q.automationEnabled !== undefined ? { automationEnabled: q.automationEnabled } : {}),
      },
      include: this.include,
      orderBy: [{ status: "asc" }, { name: "asc" }],
    });
    return Promise.all(rows.map((r) => this.toPublic(r)));
  }

  async get(userId: string, id: string): Promise<DiscoveredModelPublic> {
    return this.toPublic(await this.findOwned(userId, id));
  }

  async update(
    userId: string,
    id: string,
    patch: UpdateDiscoveredModel,
  ): Promise<DiscoveredModelPublic> {
    const cur = await this.findOwned(userId, id);
    const data: Prisma.DiscoveredModelUpdateInput = {};

    if (patch.routeName !== undefined) {
      if (patch.routeName === null) {
        data.routeOverride = false; // 下次 reconcile 自动解析
      } else {
        data.routeOverride = true;
        data.routeName = patch.routeName;
        if (cur.status === "unroutable") data.status = cur.automationEnabled ? "active" : "new";
        if (cur.connectionId)
          await this.connections.update(userId, cur.connectionId, { model: patch.routeName });
      }
    }
    if (patch.steps) data.steps = patch.steps;
    if (patch.evaluationId !== undefined) data.evaluationId = patch.evaluationId;
    if (patch.gateConfig !== undefined) data.gateConfig = patch.gateConfig ?? Prisma.DbNull;
    if (patch.benchmarkTemplateId !== undefined)
      data.benchmarkTemplateId = patch.benchmarkTemplateId;
    if (patch.baselineId !== undefined) data.baselineId = patch.baselineId;
    if (patch.regressionThresholds !== undefined)
      data.regressionThresholds = patch.regressionThresholds ?? Prisma.DbNull;
    if (patch.schedule !== undefined) {
      data.schedule = patch.schedule;
      data.nextScheduledAt = nextScheduleAt(patch.schedule, new Date());
    }

    const merged = {
      steps: patch.steps ?? (cur.steps as AutomationStep[]),
      evaluationId: patch.evaluationId !== undefined ? patch.evaluationId : cur.evaluationId,
      benchmarkTemplateId:
        patch.benchmarkTemplateId !== undefined
          ? patch.benchmarkTemplateId
          : cur.benchmarkTemplateId,
      gateConfig: patch.gateConfig !== undefined ? patch.gateConfig : cur.gateConfig,
      status: (data.status as string | undefined) ?? cur.status,
      routeName: (data.routeName as string | undefined) ?? cur.routeName,
      automationEnabled: patch.automationEnabled ?? cur.automationEnabled,
    };

    const enabling = patch.automationEnabled === true && !cur.automationEnabled;
    const disabling = patch.automationEnabled === false && cur.automationEnabled;

    if (merged.automationEnabled) {
      if (
        merged.status === "unroutable" ||
        merged.status === "removed" ||
        !cur.connectionId ||
        !merged.routeName
      ) {
        throw new BadRequestException("Model is not routable; pick a GPUStack route first");
      }
      if (merged.steps.includes("quality_gate") && !merged.evaluationId) {
        throw new BadRequestException("evaluationId is required when quality_gate step is enabled");
      }
      if (merged.steps.includes("benchmark") && !merged.benchmarkTemplateId) {
        throw new BadRequestException(
          "benchmarkTemplateId is required when benchmark step is enabled",
        );
      }
      if (merged.steps.includes("quality_gate") && !merged.gateConfig)
        data.gateConfig = { ...DEFAULT_GATE_CONFIG };
    }
    if (enabling) {
      data.automationEnabled = true;
      data.status = "active";
    }
    if (disabling) {
      data.automationEnabled = false;
      data.status = "new";
    }

    await this.prisma.discoveredModel.update({ where: { id }, data });

    if (disabling) {
      const active = await this.prisma.automationRun.findMany({
        where: { discoveredModelId: id, status: { in: ["pending", "running"] } },
      });
      for (const r of active) await this.runner.cancel(r.id, null);
    }
    if (enabling && cur.currentRevisionId) {
      const rev = await this.prisma.deploymentRevision.findUnique({
        where: { id: cur.currentRevisionId },
      });
      if (rev?.readyAt) {
        await this.runner.enqueue({
          discoveredModelId: id,
          revisionId: rev.id,
          trigger: "enable",
          triggerKey: `enable:${rev.id}:${Date.now()}`,
        });
      }
    }
    return this.get(userId, id);
  }

  async runNow(userId: string, id: string): Promise<AutomationRunPublic> {
    const m = await this.findOwned(userId, id);
    if (!m.automationEnabled || !m.currentRevisionId) {
      throw new BadRequestException("Enable automation on a model with a deployed revision first");
    }
    const runId = await this.runner.enqueue({
      discoveredModelId: id,
      revisionId: m.currentRevisionId,
      trigger: "manual",
      triggerKey: `manual:${randomUUID()}`,
    });
    const run = await this.prisma.automationRun.findUniqueOrThrow({ where: { id: runId! } });
    return toRunPublic(run);
  }

  async listRevisions(userId: string, id: string): Promise<DeploymentRevisionPublic[]> {
    await this.findOwned(userId, id);
    const revs: Array<DeploymentRevision & { runs: AutomationRun[] }> =
      await this.prisma.deploymentRevision.findMany({
        where: { discoveredModelId: id },
        orderBy: { firstSeenAt: "asc" },
        include: { runs: { orderBy: { createdAt: "desc" } } },
      });
    const out = revs.map((r, i) => ({
      id: r.id,
      fingerprint: r.fingerprint,
      snapshot: r.snapshot as Record<string, unknown>,
      firstSeenAt: r.firstSeenAt.toISOString(),
      readyAt: r.readyAt?.toISOString() ?? null,
      diff: diffSnapshots(
        i > 0 ? (revs[i - 1].snapshot as Record<string, unknown>) : null,
        r.snapshot as Record<string, unknown>,
      ),
      runs: r.runs.map(toRunPublic),
    }));
    return out.reverse();
  }

  async cancelRun(userId: string, runId: string): Promise<void> {
    const run = await this.prisma.automationRun.findFirst({
      where: { id: runId, model: { source: { userId } } },
    });
    if (!run) throw new NotFoundException(`Automation run ${runId} not found`);
    await this.runner.cancel(runId, null);
  }

  async listRoutes(userId: string, sourceId: string): Promise<GpustackRouteOption[]> {
    const owned = await this.prisma.platformSource.findFirst({ where: { id: sourceId, userId } });
    if (!owned) throw new NotFoundException(`Platform source ${sourceId} not found`);
    const s = await this.sources.getDecrypted(sourceId);
    const client = await this.clients.create(s.baseUrl, s.apiKey);
    const routes = await client.listRoutes();
    return routes.map((r) => ({
      name: r.effective_name || r.name,
      targets: r.targets,
      createdModelId: r.created_model_id != null ? String(r.created_model_id) : null,
    }));
  }
}
