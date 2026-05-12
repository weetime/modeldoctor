import type {
  CreateSavedCompareRequest,
  SavedCompare,
  UpdateSavedCompareRequest,
} from "@modeldoctor/contracts";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service.js";

export interface HydratedBenchmarkRef {
  id: string;
  stageLabel: string;
  missing: boolean;
  // Present when missing === false:
  name?: string | null;
  tool?: string;
  scenario?: string;
  summaryMetrics?: unknown;
  params?: unknown;
  createdAt?: string;
}

export interface HydratedEvaluationRunRef {
  id: string;
  stageLabel: string;
  missing: boolean;
  // Present when missing === false:
  status?: string;
  gateResult?: string | null;
  aggregateMetrics?: unknown;
  createdAt?: string;
}

export interface HydratedSavedCompare extends SavedCompare {
  benchmarks: HydratedBenchmarkRef[];
  evaluationRuns: HydratedEvaluationRunRef[];
}

@Injectable()
export class SavedComparesService {
  constructor(private readonly prisma: PrismaService) {}

  private serialize(row: {
    id: string;
    userId: string;
    name: string;
    benchmarkIds: string[];
    evaluationRunIds: string[];
    stageLabels: unknown;
    baselineId: string | null;
    context: string | null;
    narrative: unknown;
    narrativeAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): SavedCompare {
    return {
      id: row.id,
      userId: row.userId,
      name: row.name,
      benchmarkIds: row.benchmarkIds,
      evaluationRunIds: row.evaluationRunIds,
      stageLabels: row.stageLabels as Record<string, string>,
      baselineId: row.baselineId,
      context: row.context,
      narrative: row.narrative,
      narrativeAt: row.narrativeAt ? row.narrativeAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async create(userId: string, body: CreateSavedCompareRequest): Promise<SavedCompare> {
    if (new Set(body.benchmarkIds).size !== body.benchmarkIds.length) {
      throw new BadRequestException("benchmarkIds must be unique");
    }
    const evaluationRunIds = body.evaluationRunIds ?? [];
    if (new Set(evaluationRunIds).size !== evaluationRunIds.length) {
      throw new BadRequestException("evaluationRunIds must be unique");
    }
    const row = await this.prisma.savedCompare.create({
      data: {
        userId,
        name: body.name,
        benchmarkIds: body.benchmarkIds,
        evaluationRunIds,
        stageLabels: body.stageLabels,
        baselineId: body.baselineId ?? null,
        context: body.context ?? null,
      },
    });
    return this.serialize(row);
  }

  async list(userId: string): Promise<SavedCompare[]> {
    const rows = await this.prisma.savedCompare.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return rows.map((r) => this.serialize(r));
  }

  async get(userId: string, id: string): Promise<SavedCompare | null> {
    const row = await this.prisma.savedCompare.findUnique({ where: { id } });
    if (!row || row.userId !== userId) return null;
    return this.serialize(row);
  }

  async getHydrated(userId: string, id: string): Promise<HydratedSavedCompare | null> {
    const sc = await this.get(userId, id);
    if (!sc) return null;
    const labels = sc.stageLabels;

    // Hydrate benchmark runs
    const benchmarks = await this.prisma.benchmark.findMany({
      where: { id: { in: sc.benchmarkIds } },
    });
    const benchmarkById = new Map(benchmarks.map((b) => [b.id, b]));
    const hydratedBenchmarks: HydratedBenchmarkRef[] = sc.benchmarkIds.map((bid) => {
      const b = benchmarkById.get(bid);
      if (!b) return { id: bid, stageLabel: labels[bid] ?? "?", missing: true };
      return {
        id: b.id,
        stageLabel: labels[bid] ?? "?",
        missing: false,
        name: b.name,
        tool: b.tool,
        scenario: b.scenario,
        summaryMetrics: b.summaryMetrics,
        params: b.params,
        createdAt: b.createdAt.toISOString(),
      };
    });

    // Hydrate evaluation runs (owner-scoped)
    const evaluationRunIds = sc.evaluationRunIds ?? [];
    const hydratedEvaluationRuns: HydratedEvaluationRunRef[] = [];
    if (evaluationRunIds.length > 0) {
      const evaluationRuns = await this.prisma.evaluationRun.findMany({
        where: { id: { in: evaluationRunIds }, userId },
      });
      const evaluationRunById = new Map(evaluationRuns.map((r) => [r.id, r]));
      for (const rid of evaluationRunIds) {
        const r = evaluationRunById.get(rid);
        if (!r) {
          hydratedEvaluationRuns.push({ id: rid, stageLabel: labels[rid] ?? "?", missing: true });
        } else {
          hydratedEvaluationRuns.push({
            id: r.id,
            stageLabel: labels[rid] ?? "?",
            missing: false,
            status: r.status,
            gateResult: r.gateResult,
            aggregateMetrics: r.aggregateMetrics,
            createdAt: r.createdAt.toISOString(),
          });
        }
      }
    }

    return { ...sc, benchmarks: hydratedBenchmarks, evaluationRuns: hydratedEvaluationRuns };
  }

  async update(userId: string, id: string, body: UpdateSavedCompareRequest): Promise<SavedCompare> {
    const existing = await this.get(userId, id);
    if (!existing) throw new NotFoundException("SavedCompare not found");
    const row = await this.prisma.savedCompare.update({
      where: { id },
      data: {
        name: body.name ?? undefined,
        stageLabels: body.stageLabels ?? undefined,
        baselineId: body.baselineId === undefined ? undefined : body.baselineId,
        context: body.context === undefined ? undefined : body.context,
      },
    });
    return this.serialize(row);
  }

  async delete(userId: string, id: string): Promise<void> {
    const existing = await this.get(userId, id);
    if (!existing) throw new NotFoundException("SavedCompare not found");
    await this.prisma.savedCompare.delete({ where: { id } });
  }

  async setNarrative(id: string, narrative: unknown, generatedAt: Date): Promise<void> {
    await this.prisma.savedCompare.update({
      where: { id },
      data: { narrative: narrative as Prisma.InputJsonValue, narrativeAt: generatedAt },
    });
  }
}
