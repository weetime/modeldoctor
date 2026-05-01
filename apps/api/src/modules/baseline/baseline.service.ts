import type { Baseline, CreateBaseline, ListBaselinesResponse } from "@modeldoctor/contracts";
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type Baseline as PrismaBaseline } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service.js";

@Injectable()
export class BaselineService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, input: CreateBaseline): Promise<Baseline> {
    const run = await this.prisma.run.findUnique({ where: { id: input.runId } });
    if (!run) throw new NotFoundException(`Run ${input.runId} not found`);
    if (run.userId !== userId) throw new ForbiddenException();

    try {
      const row = await this.prisma.baseline.create({
        data: {
          userId,
          runId: input.runId,
          name: input.name,
          description: input.description ?? null,
          tags: input.tags ?? [],
          // Copied from Run; both are NULL pre-#56.
          templateId: run.templateId,
          templateVersion: run.templateVersion,
        },
      });
      return toContract(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException(`Run ${input.runId} already has a baseline`);
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

  async delete(userId: string, id: string): Promise<void> {
    const row = await this.prisma.baseline.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Baseline ${id} not found`);
    if (row.userId !== userId) throw new ForbiddenException();
    await this.prisma.baseline.delete({ where: { id } });
  }
}

function toContract(row: PrismaBaseline): Baseline {
  return {
    id: row.id,
    userId: row.userId,
    runId: row.runId,
    name: row.name,
    description: row.description,
    tags: row.tags,
    templateId: row.templateId,
    templateVersion: row.templateVersion,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export { toContract as baselineRowToContract };
