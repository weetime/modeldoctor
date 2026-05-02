import { Injectable } from "@nestjs/common";
import { Prisma, Run as PrismaRun } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service.js";

const runWithRelations = Prisma.validator<Prisma.RunDefaultArgs>()({
  include: {
    connection: { select: { id: true, name: true } },
    baselineFor: { select: { id: true, name: true, createdAt: true } },
  },
});
export type RunWithRelations = Prisma.RunGetPayload<typeof runWithRelations>;

export type CreateRunInput = {
  userId?: string | null;
  connectionId?: string | null;
  kind: "benchmark" | "e2e";
  tool: "guidellm" | "genai-perf" | "vegeta" | "e2e" | "custom";
  scenario: Prisma.InputJsonValue;
  mode: "fixed" | "ramp-up" | "throughput" | "sla-target" | "correctness";
  driverKind: "local" | "k8s";
  params: Prisma.InputJsonValue;
  name?: string | null;
  description?: string | null;
  templateId?: string | null;
  templateVersion?: string | null;
  parentRunId?: string | null;
  baselineId?: string | null;
};

export type UpdateRunInput = Partial<{
  status: string;
  statusMessage: string | null;
  progress: number | null;
  driverHandle: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  rawOutput: Prisma.InputJsonValue | null;
  summaryMetrics: Prisma.InputJsonValue | null;
  logs: string | null;
}>;

export type ListRunsInput = {
  kind?: "benchmark" | "e2e";
  tool?: string;
  status?: string;
  connectionId?: string;
  parentRunId?: string;
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
export class RunRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateRunInput): Promise<PrismaRun> {
    const data: Prisma.RunCreateInput = {
      kind: input.kind,
      tool: input.tool,
      scenario: input.scenario,
      mode: input.mode,
      driverKind: input.driverKind,
      params: input.params,
      name: input.name ?? null,
      description: input.description ?? null,
      templateId: input.templateId ?? null,
      templateVersion: input.templateVersion ?? null,
    };
    if (input.userId) data.user = { connect: { id: input.userId } };
    if (input.connectionId) data.connection = { connect: { id: input.connectionId } };
    if (input.parentRunId) data.parent = { connect: { id: input.parentRunId } };
    if (input.baselineId) data.baseline = { connect: { id: input.baselineId } };
    return this.prisma.run.create({ data });
  }

  findById(id: string): Promise<RunWithRelations | null> {
    return this.prisma.run.findUnique({
      where: { id },
      include: runWithRelations.include,
    });
  }

  async list(
    input: ListRunsInput,
  ): Promise<{ items: RunWithRelations[]; nextCursor: string | null }> {
    const limit = Math.min(input.limit ?? 20, 100);
    const where: Prisma.RunWhereInput = {};
    if (input.kind) where.kind = input.kind;
    if (input.tool)
      where.tool = input.tool as "guidellm" | "genai-perf" | "vegeta" | "e2e" | "custom";
    if (input.status) where.status = input.status;
    if (input.connectionId) where.connectionId = input.connectionId;
    if (input.parentRunId) where.parentRunId = input.parentRunId;
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

    const items = await this.prisma.run.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      include: runWithRelations.include,
      ...(input.cursor && { cursor: { id: input.cursor }, skip: 1 }),
    });

    const hasMore = items.length > limit;
    const sliced = hasMore ? items.slice(0, limit) : items;
    return {
      items: sliced,
      nextCursor: hasMore ? sliced[sliced.length - 1].id : null,
    };
  }

  update(id: string, input: UpdateRunInput): Promise<PrismaRun> {
    return this.prisma.run.update({
      where: { id },
      data: input as Prisma.RunUpdateInput,
    });
  }

  delete(id: string): Promise<PrismaRun> {
    return this.prisma.run.delete({ where: { id } });
  }

  async countActiveByName(userId: string, name: string): Promise<number> {
    return this.prisma.run.count({
      where: {
        userId,
        name,
        status: { in: ["pending", "submitted", "running"] },
      },
    });
  }
}
