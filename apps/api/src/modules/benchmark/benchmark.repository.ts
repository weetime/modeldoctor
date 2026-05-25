import { Injectable } from "@nestjs/common";
import { Prisma, type Benchmark as PrismaBenchmark } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service.js";
import { IN_PROGRESS_STATES } from "./constants.js";

const benchmarkWithRelations = Prisma.validator<Prisma.BenchmarkDefaultArgs>()({
  include: {
    connection: { select: { id: true, name: true, model: true, baseUrl: true } },
    baselineFor: { select: { id: true, name: true, createdAt: true } },
  },
});
export type BenchmarkWithRelations = Prisma.BenchmarkGetPayload<typeof benchmarkWithRelations>;

export type CreateBenchmarkInput = {
  userId?: string | null;
  connectionId?: string | null;
  scenario: string;
  tool: "guidellm" | "vegeta" | "prefix-cache-probe" | "evalscope" | "aiperf";
  params: Prisma.InputJsonValue;
  name: string;
  description?: string | null;
  templateId?: string | null;
  parentBenchmarkId?: string | null;
  baselineId?: string | null;
};

export type UpdateBenchmarkInput = Partial<{
  status: string;
  statusMessage: string | null;
  progress: number | null;
  driverHandle: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  rawOutput: Prisma.InputJsonValue | null;
  summaryMetrics: Prisma.InputJsonValue | null;
  serverMetrics: Prisma.InputJsonValue | null;
  logs: string | null;
  toolVersion: string | null;
}>;

export type ListBenchmarksInput = {
  scenario?: string;
  tool?: string;
  status?: string;
  connectionId?: string;
  parentBenchmarkId?: string;
  templateId?: string;
  userId?: string;
  search?: string;
  createdAfter?: string;
  createdBefore?: string;
  isBaseline?: boolean;
  referencesBaseline?: boolean;
  cursor?: string;
  limit?: number;
};

@Injectable()
export class BenchmarkRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateBenchmarkInput): Promise<PrismaBenchmark> {
    const data: Prisma.BenchmarkCreateInput = {
      scenario: input.scenario,
      tool: input.tool,
      params: input.params,
      name: input.name,
      description: input.description ?? null,
    };
    if (input.userId) data.user = { connect: { id: input.userId } };
    if (input.connectionId) data.connection = { connect: { id: input.connectionId } };
    if (input.templateId) data.template = { connect: { id: input.templateId } };
    if (input.parentBenchmarkId) data.parent = { connect: { id: input.parentBenchmarkId } };
    if (input.baselineId) data.baseline = { connect: { id: input.baselineId } };
    return this.prisma.benchmark.create({ data });
  }

  findById(id: string): Promise<BenchmarkWithRelations | null> {
    return this.prisma.benchmark.findUnique({
      where: { id },
      include: benchmarkWithRelations.include,
    });
  }

  async list(
    input: ListBenchmarksInput,
  ): Promise<{ items: BenchmarkWithRelations[]; nextCursor: string | null }> {
    const limit = Math.min(input.limit ?? 20, 100);
    const where: Prisma.BenchmarkWhereInput = {};
    if (input.scenario) where.scenario = input.scenario;
    if (input.tool) where.tool = input.tool;
    if (input.status) where.status = input.status;
    if (input.connectionId) where.connectionId = input.connectionId;
    if (input.parentBenchmarkId) where.parentBenchmarkId = input.parentBenchmarkId;
    if (input.templateId) where.templateId = input.templateId;
    if (input.userId) where.userId = input.userId;
    if (input.search)
      where.OR = [
        { name: { contains: input.search, mode: "insensitive" } },
        { description: { contains: input.search, mode: "insensitive" } },
      ];
    if (input.isBaseline !== undefined) {
      where.baselineFor = input.isBaseline ? { isNot: null } : { is: null };
    }
    if (input.referencesBaseline !== undefined) {
      where.baselineId = input.referencesBaseline ? { not: null } : null;
    }
    if (input.createdAfter || input.createdBefore) {
      where.createdAt = {
        ...(input.createdAfter && { gte: new Date(input.createdAfter) }),
        ...(input.createdBefore && { lte: new Date(input.createdBefore) }),
      };
    }

    const items = await this.prisma.benchmark.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      include: benchmarkWithRelations.include,
      ...(input.cursor && { cursor: { id: input.cursor }, skip: 1 }),
    });

    const hasMore = items.length > limit;
    const sliced = hasMore ? items.slice(0, limit) : items;
    return {
      items: sliced,
      nextCursor: hasMore ? sliced[sliced.length - 1].id : null,
    };
  }

  update(id: string, input: UpdateBenchmarkInput): Promise<PrismaBenchmark> {
    return this.prisma.benchmark.update({
      where: { id },
      data: input as Prisma.BenchmarkUpdateInput,
    });
  }

  /**
   * Conditional update: only writes when current `status` is in `allowedStatuses`.
   * Returns the updated row, or `null` if the guard rejected the write (row not
   * found OR status outside allowed set).
   *
   * Implementation uses Prisma's `updateMany` with a `where: { status: { in } }`
   * filter; if `count === 0` the guard rejected. Followed by a `findUnique` to
   * return the new row. Two queries instead of one, but cleaner than raw SQL
   * and the watcher path is low-volume.
   */
  async updateGuarded(
    id: string,
    allowedStatuses: readonly string[],
    input: UpdateBenchmarkInput,
  ): Promise<PrismaBenchmark | null> {
    const result = await this.prisma.benchmark.updateMany({
      where: { id, status: { in: [...allowedStatuses] } },
      data: input as Prisma.BenchmarkUpdateInput,
    });
    if (result.count === 0) return null;
    return this.prisma.benchmark.findUnique({ where: { id } });
  }

  delete(id: string): Promise<PrismaBenchmark> {
    return this.prisma.benchmark.delete({ where: { id } });
  }

  async countActiveByName(userId: string, name: string): Promise<number> {
    return this.prisma.benchmark.count({
      where: {
        userId,
        name,
        status: { in: [...IN_PROGRESS_STATES] },
      },
    });
  }

  /**
   * Lightweight existence probe used by BenchmarkService to validate
   * `parentBenchmarkId` before issuing a `repo.create` that would otherwise
   * raise a Prisma P2003 FK-constraint error and surface as HTTP 500. Selecting
   * only `id` keeps the round-trip cheap regardless of row width or relation
   * count on Benchmark.
   */
  async existsById(id: string): Promise<boolean> {
    const row = await this.prisma.benchmark.findUnique({
      where: { id },
      select: { id: true },
    });
    return row !== null;
  }
}
