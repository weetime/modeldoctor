import { Injectable } from "@nestjs/common";
import type {
  CreateEvaluationRequest,
  Evaluation,
  EvaluationSample,
  UpdateEvaluationRequest,
} from "@modeldoctor/contracts";
import type { PrismaClient } from "@prisma/client";

@Injectable()
export class EvaluationsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(userId: string): Promise<Evaluation[]> {
    const rows = await this.prisma.evaluation.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
    return rows.map(this.toDto);
  }

  async findById(userId: string, id: string): Promise<Evaluation | null> {
    const row = await this.prisma.evaluation.findFirst({ where: { id, userId } });
    return row ? this.toDto(row) : null;
  }

  async create(userId: string, body: CreateEvaluationRequest): Promise<Evaluation> {
    const row = await this.prisma.evaluation.create({
      data: {
        userId,
        name: body.name,
        description: body.description ?? null,
        samples: body.samples as unknown as object,
        totalSamples: body.samples.length,
      },
    });
    return this.toDto(row);
  }

  async update(userId: string, id: string, body: UpdateEvaluationRequest): Promise<Evaluation> {
    const existing = await this.prisma.evaluation.findFirst({ where: { id, userId } });
    if (!existing) throw new Error(`evaluation ${id} not found`);
    const newSamples = body.samples ?? (existing.samples as unknown as EvaluationSample[]);
    const samplesChanged = body.samples != null;
    const row = await this.prisma.evaluation.update({
      where: { id },
      data: {
        name: body.name ?? existing.name,
        description: body.description !== undefined ? body.description : existing.description,
        samples: newSamples as unknown as object,
        totalSamples: newSamples.length,
        version: samplesChanged ? existing.version + 1 : existing.version,
      },
    });
    return this.toDto(row);
  }

  async delete(userId: string, id: string): Promise<void> {
    const owned = await this.prisma.evaluation.findFirst({ where: { id, userId }, select: { id: true } });
    if (!owned) throw new Error(`evaluation ${id} not found`);
    await this.prisma.evaluation.delete({ where: { id } });
  }

  private toDto = (row: {
    id: string;
    userId: string;
    name: string;
    description: string | null;
    version: number;
    samples: unknown;
    totalSamples: number;
    createdAt: Date;
    updatedAt: Date;
  }): Evaluation => ({
    id: row.id,
    userId: row.userId,
    name: row.name,
    description: row.description,
    version: row.version,
    samples: row.samples as EvaluationSample[],
    totalSamples: row.totalSamples,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
