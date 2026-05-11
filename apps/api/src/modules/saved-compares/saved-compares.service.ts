import type {
  CreateSavedCompareRequest,
  SavedCompare,
  UpdateSavedCompareRequest,
} from "@modeldoctor/contracts";
import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
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

export interface HydratedSavedCompare extends SavedCompare {
  benchmarks: HydratedBenchmarkRef[];
}

@Injectable()
export class SavedComparesService {
  constructor(private readonly prisma: PrismaService) {}

  private serialize(row: {
    id: string;
    userId: string;
    name: string;
    benchmarkIds: string[];
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
      throw new ForbiddenException("benchmarkIds must be unique");
    }
    const row = await this.prisma.savedCompare.create({
      data: {
        userId,
        name: body.name,
        benchmarkIds: body.benchmarkIds,
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
    const benchmarks = await this.prisma.benchmark.findMany({
      where: { id: { in: sc.benchmarkIds } },
    });
    const byId = new Map(benchmarks.map((b) => [b.id, b]));
    const labels = sc.stageLabels;
    const hydrated: HydratedBenchmarkRef[] = sc.benchmarkIds.map((bid) => {
      const b = byId.get(bid);
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
    return { ...sc, benchmarks: hydrated };
  }

  async update(
    userId: string,
    id: string,
    body: UpdateSavedCompareRequest,
  ): Promise<SavedCompare> {
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
      data: { narrative, narrativeAt: generatedAt },
    });
  }
}
