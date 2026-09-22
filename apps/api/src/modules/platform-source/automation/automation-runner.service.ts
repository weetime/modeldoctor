import {
  AUTOMATION_STEPS,
  type AutomationStep,
  type AutomationSummary,
  type AutomationTrigger,
  type AutomationVerdict,
  type CreateBenchmarkRequest,
  DEFAULT_GATE_CONFIG,
  DEFAULT_REGRESSION_THRESHOLDS,
  type GateConfig,
  type RegressionThresholds,
} from "@modeldoctor/contracts";
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { type AutomationRun, type DiscoveredModel, Prisma } from "@prisma/client";
import { PrismaService } from "../../../database/prisma.service.js";
import { BaselineService } from "../../baseline/baseline.service.js";
import { BenchmarkService } from "../../benchmark/benchmark.service.js";
import { IN_PROGRESS_STATES } from "../../benchmark/constants.js";
import { BenchmarkTemplateRepository } from "../../benchmark-template/benchmark-template.repository.js";
import { ConnectionService } from "../../connection/connection.service.js";
import { DiagnosticsService } from "../../diagnostics/diagnostics.service.js";
import { NotifyService } from "../../notifications/notify.service.js";
import { RunsService } from "../../quality-gate/services/runs.service.js";
import { toProbes } from "../sync/mapping.js";
import { SourceSyncService } from "../sync/source-sync.service.js";
import { detectRegression, nextScheduleAt } from "./regression.js";

const LEASE_MS = 60_000;
type Step = AutomationStep | "compare";
type RunCtx = AutomationRun & { model: DiscoveredModel & { source: { userId: string } } };

@Injectable()
export class AutomationRunnerService implements OnModuleInit {
  private readonly log = new Logger(AutomationRunnerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly connections: ConnectionService,
    private readonly diagnostics: DiagnosticsService,
    private readonly runs: RunsService,
    private readonly benchmarks: BenchmarkService,
    private readonly templates: BenchmarkTemplateRepository,
    private readonly baselines: BaselineService,
    private readonly notify: NotifyService,
    private readonly sync: SourceSyncService,
  ) {}

  onModuleInit(): void {
    this.sync.setReadyListener(async ({ discoveredModelId, revisionId }) => {
      const dm = await this.prisma.discoveredModel.findUnique({ where: { id: discoveredModelId } });
      if (!dm?.automationEnabled) return;
      await this.enqueue({
        discoveredModelId,
        revisionId,
        trigger: "revision",
        triggerKey: `revision:${revisionId}`,
      });
    });
  }

  // ---------- enqueue / cancel ----------

  async enqueue(input: {
    discoveredModelId: string;
    revisionId: string;
    trigger: AutomationTrigger;
    triggerKey: string;
  }): Promise<string | null> {
    const dm = await this.prisma.discoveredModel.findUniqueOrThrow({
      where: { id: input.discoveredModelId },
    });
    if (input.trigger === "revision") {
      const active = await this.prisma.automationRun.findMany({
        where: { discoveredModelId: dm.id, status: { in: ["pending", "running"] } },
      });
      for (const r of active) await this.cancel(r.id, "superseded");
    }
    try {
      const run = await this.prisma.automationRun.create({
        data: {
          discoveredModelId: dm.id,
          sourceId: dm.sourceId,
          revisionId: input.revisionId,
          trigger: input.trigger,
          triggerKey: input.triggerKey,
          status: "pending",
        },
      });
      return run.id;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return null;
      throw e;
    }
  }

  async cancel(runId: string, verdict: "superseded" | null): Promise<void> {
    const run = await this.prisma.automationRun.findUnique({
      where: { id: runId },
      include: { model: { include: { source: { select: { userId: true } } } } },
    });
    if (!run || run.status === "completed" || run.status === "cancelled") return;
    const userId = run.model.source.userId;
    await this.prisma.automationRun.update({
      where: { id: runId },
      data: { status: "cancelled", verdict, finishedAt: new Date(), lockedUntil: null },
    });
    if (run.benchmarkId)
      await this.benchmarks.cancel(run.benchmarkId, userId).catch(() => undefined);
    if (run.evaluationRunId)
      await this.runs.cancel(userId, run.evaluationRunId).catch(() => undefined);
  }

  // ---------- tick ----------

  async tick(): Promise<void> {
    await this.promotePending();
    const running = await this.prisma.automationRun.findMany({
      where: { status: "running" },
      select: { id: true },
    });
    for (const { id } of running) {
      if (!(await this.acquireLease(id))) continue;
      try {
        await this.advance(id);
      } catch (e) {
        this.log.error(`advance ${id} failed`, e as Error);
        await this.finish(id, "error", { stepMessage: (e as Error).message });
      } finally {
        await this.prisma.automationRun.updateMany({
          where: { id, status: "running" },
          data: { lockedUntil: null },
        });
      }
    }
  }

  /** 每个源至多 1 个 running：行锁 platform_sources 后再检查并提升。 */
  private async promotePending(): Promise<void> {
    const sources = await this.prisma.automationRun.findMany({
      where: { status: "pending" },
      distinct: ["sourceId"],
      select: { sourceId: true },
    });
    for (const { sourceId } of sources) {
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM platform_sources WHERE id = ${sourceId} FOR UPDATE`;
        const running = await tx.automationRun.count({ where: { sourceId, status: "running" } });
        if (running > 0) return;
        const next = await tx.automationRun.findFirst({
          where: { sourceId, status: "pending" },
          orderBy: { createdAt: "asc" },
          include: { model: true },
        });
        if (!next) return;
        const steps = this.effectiveSteps(next.trigger as AutomationTrigger, next.model);
        await tx.automationRun.update({
          where: { id: next.id },
          data: {
            status: "running",
            currentStep: steps[0],
            startedAt: new Date(),
            summary: { steps: [] },
          },
        });
      });
    }
  }

  private async acquireLease(id: string): Promise<boolean> {
    const now = new Date();
    const { count } = await this.prisma.automationRun.updateMany({
      where: { id, status: "running", OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
      data: { lockedUntil: new Date(now.getTime() + LEASE_MS) },
    });
    return count === 1;
  }

  private effectiveSteps(trigger: AutomationTrigger, model: DiscoveredModel): Step[] {
    if (trigger === "schedule") return ["benchmark", "compare"];
    const chosen = AUTOMATION_STEPS.filter((s) => model.steps.includes(s));
    return chosen.includes("benchmark") ? [...chosen, "compare"] : chosen;
  }

  private async load(id: string): Promise<RunCtx> {
    return this.prisma.automationRun.findUniqueOrThrow({
      where: { id },
      include: { model: { include: { source: { select: { userId: true } } } } },
    });
  }

  private async advance(id: string): Promise<void> {
    const run = await this.load(id);
    const step = run.currentStep as Step | null;
    if (!step) return this.finish(id, "passed", {});
    const userId = run.model.source.userId;
    const connectionId = run.model.connectionId;
    if (!connectionId)
      return this.finish(id, "error", { step, stepMessage: "model has no connection" });

    switch (step) {
      case "diagnostics": {
        const conn = await this.connections.getOwnedDecrypted(userId, connectionId);
        const res = await this.diagnostics.run(userId, conn, {
          connectionId,
          probes: toProbes(run.model.categories),
        });
        await this.prisma.automationRun.update({
          where: { id },
          data: { diagnosticsRunId: res.diagnosticsRunId },
        });
        if (!res.success)
          return this.finish(id, "failed", {
            step,
            outcome: "failed",
            stepMessage: "diagnostics failed",
          });
        return this.nextStep(run, step, { step, outcome: "ok" });
      }
      case "quality_gate": {
        if (!run.evaluationRunId) {
          if (!run.model.evaluationId)
            return this.finish(id, "error", { step, stepMessage: "no evaluation configured" });
          const created = await this.runs.create(userId, {
            evaluationId: run.model.evaluationId,
            endpointAId: connectionId,
            gateConfig: (run.model.gateConfig as GateConfig | null) ?? { ...DEFAULT_GATE_CONFIG },
          });
          await this.prisma.automationRun.update({
            where: { id },
            data: { evaluationRunId: created.id },
          });
          return;
        }
        const er = await this.prisma.evaluationRun.findUniqueOrThrow({
          where: { id: run.evaluationRunId },
        });
        if (er.status === "PENDING" || er.status === "RUNNING") return;
        if (er.status !== "COMPLETED")
          return this.finish(id, "error", { step, stepMessage: `evaluation run ${er.status}` });
        if (er.gateResult === "FAILED")
          return this.finish(id, "failed", {
            step,
            outcome: "failed",
            stepMessage: "quality gate failed",
          });
        return this.nextStep(run, step, {
          step,
          outcome: "ok",
          gateWarning: er.gateResult === "WARNING",
        });
      }
      case "benchmark": {
        if (!run.benchmarkId) {
          const tplId = run.model.benchmarkTemplateId;
          const tpl = tplId ? await this.templates.findByIdOrNull(tplId) : null;
          if (!tpl)
            return this.finish(id, "error", { step, stepMessage: "benchmark template not found" });
          const b = await this.benchmarks.create(userId, {
            scenario: tpl.scenario as CreateBenchmarkRequest["scenario"],
            tool: tpl.tool as CreateBenchmarkRequest["tool"],
            connectionId,
            name: `auto-${run.model.name}-${run.id.slice(-8)}`.slice(0, 128),
            params: tpl.config as Record<string, unknown>,
            templateId: tpl.id,
          });
          await this.prisma.automationRun.update({ where: { id }, data: { benchmarkId: b.id } });
          return;
        }
        const b = await this.prisma.benchmark.findUniqueOrThrow({ where: { id: run.benchmarkId } });
        if ((IN_PROGRESS_STATES as readonly string[]).includes(b.status)) return;
        if (b.status !== "completed")
          return this.finish(id, "error", { step, stepMessage: `benchmark ${b.status}` });
        return this.nextStep(run, step, { step, outcome: "ok" });
      }
      case "compare":
        return this.compare(run, userId);
    }
  }

  private async nextStep(
    run: RunCtx,
    done: Step,
    entry: { step: Step; outcome: "ok"; gateWarning?: boolean },
  ): Promise<void> {
    const steps = this.effectiveSteps(run.trigger as AutomationTrigger, run.model);
    const next = steps[steps.indexOf(done) + 1] ?? null;
    const summary = this.appendStep(run.summary, entry);
    if (entry.gateWarning) summary.gateWarning = true;
    await this.prisma.automationRun.update({
      where: { id: run.id },
      data: { currentStep: next, summary: summary as Prisma.InputJsonValue },
    });
    if (!next) await this.finish(run.id, "passed", {});
  }

  private appendStep(
    raw: unknown,
    entry: { step: Step; outcome: "ok" | "failed" | "error" | "skipped"; stepMessage?: string },
  ): AutomationSummary {
    const s = (raw as AutomationSummary | null) ?? { steps: [] };
    return {
      ...s,
      steps: [
        ...(s.steps ?? []),
        {
          step: entry.step,
          outcome: entry.outcome,
          ...(entry.stepMessage ? { message: entry.stepMessage } : {}),
        },
      ],
    };
  }

  private async compare(run: RunCtx, userId: string): Promise<void> {
    const b = await this.prisma.benchmark.findUniqueOrThrow({ where: { id: run.benchmarkId! } });
    const baselineId = run.model.baselineId;
    let summary = this.appendStep(run.summary, { step: "compare", outcome: "ok" });

    if (!baselineId) {
      const bl = await this.baselines.create(userId, {
        benchmarkId: b.id,
        name: `${run.model.name} @ ${run.revisionId.slice(-8)}`,
        tags: ["gpustack"],
      });
      await this.prisma.discoveredModel.update({
        where: { id: run.model.id },
        data: { baselineId: bl.id },
      });
      summary = {
        ...summary,
        baselineEstablished: true,
        regression: { compared: false, reason: "baseline established", metrics: [] },
      };
      return this.finishWithSummary(run.id, "passed", summary);
    }

    const baseline = await this.prisma.baseline.findUnique({
      where: { id: baselineId },
      include: { benchmark: true },
    });
    if (!baseline) {
      summary = {
        ...summary,
        regression: { compared: false, reason: "baseline missing", metrics: [] },
      };
      return this.finishWithSummary(run.id, "passed", summary);
    }
    if (baseline.benchmark.templateId !== b.templateId) {
      summary = {
        ...summary,
        regression: { compared: false, reason: "template changed", baselineId, metrics: [] },
      };
      return this.finishWithSummary(run.id, "passed", summary);
    }
    const thresholds =
      (run.model.regressionThresholds as RegressionThresholds | null) ??
      DEFAULT_REGRESSION_THRESHOLDS;
    const r = detectRegression({
      baseline: baseline.benchmark.summaryMetrics,
      candidate: b.summaryMetrics,
      thresholds,
    });
    summary = { ...summary, regression: { compared: true, baselineId, metrics: r.metrics } };
    return this.finishWithSummary(run.id, r.regressed ? "regressed" : "passed", summary);
  }

  private async finish(
    id: string,
    verdict: AutomationVerdict,
    info: { step?: Step; outcome?: "failed" | "error"; stepMessage?: string },
  ): Promise<void> {
    const run = await this.load(id);
    const summary = info.step
      ? this.appendStep(run.summary, {
          step: info.step,
          outcome: info.outcome ?? "error",
          stepMessage: info.stepMessage,
        })
      : ((run.summary as AutomationSummary | null) ?? { steps: [] });
    return this.finishWithSummary(id, verdict, summary);
  }

  private async finishWithSummary(
    id: string,
    verdict: AutomationVerdict,
    summary: AutomationSummary,
  ): Promise<void> {
    const { count } = await this.prisma.automationRun.updateMany({
      where: { id, status: "running" },
      data: {
        status: "completed",
        verdict,
        currentStep: null,
        finishedAt: new Date(),
        lockedUntil: null,
        summary: summary as Prisma.InputJsonValue,
      },
    });
    if (count === 0) return; // 已被取消 / 已由其它副本完成
    const run = await this.load(id);
    const eventType =
      verdict === "passed"
        ? "automation.passed"
        : verdict === "regressed"
          ? "automation.regressed"
          : "automation.failed";
    await this.notify.emit({
      eventType,
      userId: run.model.source.userId,
      connectionId: run.model.connectionId ?? undefined,
      payload: {
        automationRunId: id,
        discoveredModelId: run.model.id,
        modelName: run.model.name,
        revisionId: run.revisionId,
        trigger: run.trigger,
        verdict,
        benchmarkId: run.benchmarkId,
        evaluationRunId: run.evaluationRunId,
        summary,
      },
    });
  }

  // ---------- schedules ----------

  async scanSchedules(now: Date = new Date()): Promise<number> {
    const due = await this.prisma.discoveredModel.findMany({
      where: {
        automationEnabled: true,
        schedule: { not: "off" },
        nextScheduledAt: { lte: now },
        status: { in: ["new", "active"] },
        currentRevisionId: { not: null },
      },
    });
    let enqueued = 0;
    for (const dm of due) {
      const slot = dm.nextScheduledAt!.toISOString();
      const busy = await this.prisma.automationRun.count({
        where: { discoveredModelId: dm.id, status: { in: ["pending", "running"] } },
      });
      if (!busy) {
        const id = await this.enqueue({
          discoveredModelId: dm.id,
          revisionId: dm.currentRevisionId!,
          trigger: "schedule",
          triggerKey: `schedule:${dm.id}:${slot}`,
        });
        if (id) enqueued++;
      }
      await this.prisma.discoveredModel.updateMany({
        where: { id: dm.id, nextScheduledAt: dm.nextScheduledAt },
        data: { nextScheduledAt: nextScheduleAt(dm.schedule as "daily" | "weekly", now) },
      });
    }
    return enqueued;
  }
}
