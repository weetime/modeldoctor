import { Injectable } from "@nestjs/common";
import type {
  AggregateMetrics, EvaluationRun, GateResult, ListRunSamplesQuery,
  ListRunSamplesResponse, ListRunsQuery, RunSample,
} from "@modeldoctor/contracts";
import { Prisma } from "@prisma/client";
import type { PrismaClient, EvaluationRunStatus } from "@prisma/client";
import type { GateOutcome } from "../gate/compute-gate-result.js";

export interface CreatePendingInput {
  userId: string;
  evaluationId: string;
  evaluationVersion: number;
  evaluationSnapshot: { samples: unknown[] };
  endpointAId: string;
  endpointBId?: string | null;
  gateConfig: object;
}

export interface SaveSampleInput {
  runId: string;
  sampleId: string;
  sampleIdx: number;
  resultA: object;
  resultB: object | null;
  delta: "REGRESSION" | "IMPROVEMENT" | "BOTH_PASS" | "BOTH_FAIL" | "NA";
}

@Injectable()
export class RunsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createPending(input: CreatePendingInput): Promise<EvaluationRun> {
    const total = (input.evaluationSnapshot.samples as unknown[]).length;
    const row = await this.prisma.evaluationRun.create({
      data: {
        userId: input.userId,
        evaluationId: input.evaluationId,
        evaluationVersion: input.evaluationVersion,
        evaluationSnapshot: input.evaluationSnapshot as unknown as object,
        endpointAId: input.endpointAId,
        endpointBId: input.endpointBId ?? null,
        gateConfig: input.gateConfig,
        totalSamples: total,
      },
    });
    return this.toDto(row);
  }

  async findById(userId: string, id: string): Promise<EvaluationRun | null> {
    const row = await this.prisma.evaluationRun.findFirst({ where: { id, userId } });
    return row ? this.toDto(row) : null;
  }

  async list(userId: string, q: ListRunsQuery): Promise<{ items: EvaluationRun[]; total: number; page: number; pageSize: number }> {
    const where = { userId, ...(q.status ? { status: q.status as EvaluationRunStatus } : {}), ...(q.evaluationId ? { evaluationId: q.evaluationId } : {}) };
    const [total, rows] = await Promise.all([
      this.prisma.evaluationRun.count({ where }),
      this.prisma.evaluationRun.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return { items: rows.map(this.toDto), total, page: q.page, pageSize: q.pageSize };
  }

  async markRunning(id: string) {
    return this.prisma.evaluationRun.update({ where: { id }, data: { status: "RUNNING", startedAt: new Date() } });
  }

  async updateProgress(id: string, processed: number) {
    return this.prisma.evaluationRun.update({ where: { id }, data: { processedSamples: processed } });
  }

  async markCancelled(id: string) {
    return this.prisma.evaluationRun.update({ where: { id }, data: { status: "CANCELLED", finishedAt: new Date() } });
  }

  async markFailed(id: string, message: string) {
    return this.prisma.evaluationRun.update({ where: { id }, data: { status: "FAILED", finishedAt: new Date(), errorMessage: message } });
  }

  async markCompleted(id: string, metrics: AggregateMetrics, gate: GateOutcome): Promise<EvaluationRun> {
    const row = await this.prisma.evaluationRun.update({
      where: { id },
      data: {
        status: "COMPLETED",
        finishedAt: new Date(),
        aggregateMetrics: metrics as unknown as object,
        gateResult: gate.result as GateResult,
      },
    });
    return this.toDto(row);
  }

  async saveSample(input: SaveSampleInput) {
    await this.prisma.evaluationRunSample.create({
      data: {
        runId: input.runId,
        sampleId: input.sampleId,
        sampleIdx: input.sampleIdx,
        resultA: input.resultA,
        resultB: input.resultB ?? Prisma.JsonNull,
        delta: input.delta,
      },
    });
  }

  async listSamples(runId: string, q: ListRunSamplesQuery): Promise<ListRunSamplesResponse> {
    const deltaMap: Record<string, string | undefined> = {
      regression: "REGRESSION",
      improvement: "IMPROVEMENT",
      "both-pass": "BOTH_PASS",
      "both-fail": "BOTH_FAIL",
      all: undefined,
    };
    const deltaFilter = deltaMap[q.filter];
    const where = { runId, ...(deltaFilter ? { delta: deltaFilter as "REGRESSION" } : {}) };
    const orderBy = { sampleIdx: "asc" as const };
    const [total, rows] = await Promise.all([
      this.prisma.evaluationRunSample.count({ where }),
      this.prisma.evaluationRunSample.findMany({ where, orderBy, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    return {
      items: rows.map(
        (r): RunSample => ({
          id: r.id,
          runId: r.runId,
          sampleId: r.sampleId,
          sampleIdx: r.sampleIdx,
          resultA: r.resultA as RunSample["resultA"],
          resultB: r.resultB as RunSample["resultB"],
          delta: r.delta as RunSample["delta"],
          createdAt: r.createdAt.toISOString(),
        }),
      ),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async sampleRowsForAggregate(runId: string) {
    const rows = await this.prisma.evaluationRunSample.findMany({ where: { runId } });
    return rows.map((r) => ({
      resultA: r.resultA as { call: { error?: string }; judge: { passed: boolean; score?: number } },
      resultB: r.resultB as { call: { error?: string }; judge: { passed: boolean; score?: number } } | null,
    }));
  }

  async sweepRunningOnBoot(): Promise<number> {
    const r = await this.prisma.evaluationRun.updateMany({
      where: { status: { in: ["PENDING", "RUNNING"] } },
      data: { status: "FAILED", errorMessage: "server restarted, retrigger to resume", finishedAt: new Date() },
    });
    return r.count;
  }

  async deleteRun(userId: string, id: string) {
    const owned = await this.prisma.evaluationRun.findFirst({ where: { id, userId }, select: { id: true } });
    if (!owned) throw new Error(`run ${id} not found`);
    await this.prisma.evaluationRun.delete({ where: { id } });
  }

  async findFullRun(id: string) {
    const row = await this.prisma.evaluationRun.findUnique({ where: { id } });
    if (!row) return null;
    return {
      id: row.id,
      userId: row.userId,
      endpointAId: row.endpointAId,
      endpointBId: row.endpointBId,
      evaluationSnapshot: row.evaluationSnapshot as { samples: Array<{ id: string; idx: number; prompt: string; expected: string; judgeConfig: import("@modeldoctor/contracts").JudgeConfig }> },
      gateConfig: row.gateConfig as import("@modeldoctor/contracts").GateConfig,
    };
  }

  private toDto = (row: {
    id: string; userId: string; evaluationId: string; evaluationVersion: number;
    evaluationSnapshot: unknown; endpointAId: string; endpointBId: string | null;
    gateConfig: unknown; status: EvaluationRunStatus; gateResult: GateResult | null;
    aggregateMetrics: unknown; processedSamples: number; totalSamples: number;
    startedAt: Date | null; finishedAt: Date | null; errorMessage: string | null;
    createdAt: Date;
  }): EvaluationRun => ({
    id: row.id,
    userId: row.userId,
    evaluationId: row.evaluationId,
    evaluationVersion: row.evaluationVersion,
    evaluationSnapshot: row.evaluationSnapshot as EvaluationRun["evaluationSnapshot"],
    endpointAId: row.endpointAId,
    endpointBId: row.endpointBId,
    gateConfig: row.gateConfig as EvaluationRun["gateConfig"],
    status: row.status as EvaluationRun["status"],
    gateResult: row.gateResult,
    aggregateMetrics: row.aggregateMetrics as EvaluationRun["aggregateMetrics"],
    processedSamples: row.processedSamples,
    totalSamples: row.totalSamples,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
  });
}
