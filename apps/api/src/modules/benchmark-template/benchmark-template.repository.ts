import { Injectable } from "@nestjs/common";
import { Prisma, type BenchmarkTemplate as PrismaBenchmarkTemplate } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service.js";

export type CreateBenchmarkTemplateInput = {
  name: string;
  description?: string | null;
  scenario: string;
  tool: string;
  config: Prisma.InputJsonValue;
  isOfficial?: boolean;
  createdBy: string;
  tags?: string[];
  categories?: string[];
};

export type UpdateBenchmarkTemplateInput = Partial<{
  name: string;
  description: string | null;
  config: Prisma.InputJsonValue;
  tags: string[];
  categories: string[];
}>;

export type ListBenchmarkTemplatesInput = {
  scenario?: string;
  tool?: string;
  // Filters to templates whose `categories` array contains this value.
  category?: string;
  isOfficial?: boolean;
  search?: string;
  cursor?: string;
  limit?: number;
};

@Injectable()
export class BenchmarkTemplateRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByIdOrNull(id: string): Promise<PrismaBenchmarkTemplate | null> {
    return this.prisma.benchmarkTemplate.findUnique({ where: { id } });
  }

  async create(input: CreateBenchmarkTemplateInput): Promise<PrismaBenchmarkTemplate> {
    return this.prisma.benchmarkTemplate.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        scenario: input.scenario,
        tool: input.tool,
        config: input.config,
        isOfficial: input.isOfficial ?? false,
        tags: input.tags ?? [],
        ...(input.categories ? { categories: input.categories } : {}),
        creator: { connect: { id: input.createdBy } },
      },
    });
  }

  async update(id: string, input: UpdateBenchmarkTemplateInput): Promise<PrismaBenchmarkTemplate> {
    return this.prisma.benchmarkTemplate.update({
      where: { id },
      data: input as Prisma.BenchmarkTemplateUpdateInput,
    });
  }

  async delete(id: string): Promise<PrismaBenchmarkTemplate> {
    return this.prisma.benchmarkTemplate.delete({ where: { id } });
  }

  async list(input: ListBenchmarkTemplatesInput): Promise<{
    items: PrismaBenchmarkTemplate[];
    nextCursor: string | null;
  }> {
    const limit = Math.min(input.limit ?? 50, 100);
    const where: Prisma.BenchmarkTemplateWhereInput = {};
    if (input.scenario) where.scenario = input.scenario;
    if (input.tool) where.tool = input.tool;
    if (input.category) where.categories = { has: input.category };
    if (input.isOfficial !== undefined) where.isOfficial = input.isOfficial;
    if (input.search) {
      where.OR = [
        { name: { contains: input.search, mode: "insensitive" } },
        { description: { contains: input.search, mode: "insensitive" } },
      ];
    }

    const items = await this.prisma.benchmarkTemplate.findMany({
      where,
      orderBy: [{ isOfficial: "desc" }, { updatedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(input.cursor && { cursor: { id: input.cursor }, skip: 1 }),
    });

    const hasMore = items.length > limit;
    const sliced = hasMore ? items.slice(0, limit) : items;
    return {
      items: sliced,
      nextCursor: hasMore ? sliced[sliced.length - 1].id : null,
    };
  }
}
