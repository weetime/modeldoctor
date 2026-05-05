import type { Baseline, CreateBaseline, ListBaselinesResponse } from "@modeldoctor/contracts";
import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type Baseline as PrismaBaseline } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service.js";

@Injectable()
export class BaselineService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, input: CreateBaseline): Promise<Baseline> {
    const benchmark = await this.prisma.benchmark.findUnique({
      where: { id: input.benchmarkId },
    });
    // Use NotFoundException for cross-user access too — exposing the
    // existence of another user's Benchmark leaks enumerable IDs.
    if (!benchmark || benchmark.userId !== userId) {
      throw new NotFoundException(`Benchmark ${input.benchmarkId} not found`);
    }

    try {
      const row = await this.prisma.baseline.create({
        data: {
          userId,
          benchmarkId: input.benchmarkId,
          name: input.name,
          description: input.description ?? null,
          tags: input.tags ?? [],
          // Copied from Benchmark; NULL when the Benchmark wasn't started from a template.
          templateId: benchmark.templateId,
        },
      });
      return toContract(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException(`Benchmark ${input.benchmarkId} already has a baseline`);
      }
      throw err;
    }
  }

  async list(userId: string): Promise<ListBaselinesResponse> {
    const rows = await this.prisma.baseline.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    return { items: rows.map(toContract) };
  }

  /**
   * Existence probe used by BenchmarkService to validate `baselineId` on
   * benchmark creation before reaching Prisma. Without this check the FK
   * constraint would raise a P2003 and surface as HTTP 500 rather than a
   * clean 400. Existence-only — no ownership check, since baselines may be
   * referenced cross-user (mirror of `parentBenchmarkId` semantics).
   */
  async existsById(id: string): Promise<boolean> {
    const row = await this.prisma.baseline.findUnique({
      where: { id },
      select: { id: true },
    });
    return row !== null;
  }

  async delete(userId: string, id: string): Promise<void> {
    const row = await this.prisma.baseline.findUnique({ where: { id } });
    // NotFoundException for cross-user access too (don't leak existence).
    if (!row || row.userId !== userId) {
      throw new NotFoundException(`Baseline ${id} not found`);
    }
    await this.prisma.baseline.delete({ where: { id } });
  }
}

function toContract(row: PrismaBaseline): Baseline {
  return {
    id: row.id,
    userId: row.userId,
    benchmarkId: row.benchmarkId,
    name: row.name,
    description: row.description,
    tags: row.tags,
    templateId: row.templateId,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export { toContract as baselineRowToContract };
