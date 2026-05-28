import type {
  CreateEvaluationRequest,
  Evaluation,
  EvaluationSample,
  UpdateEvaluationRequest,
} from "@modeldoctor/contracts";
import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../database/prisma.service.js";

@Injectable()
export class EvaluationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<Evaluation[]> {
    // Users see their own evaluations + all official built-ins (seeded under
    // SEED_SYSTEM_USER_ID). Official sets show with an "Official" badge in
    // the UI and are locked from edit/delete at the service layer.
    const rows = await this.prisma.evaluation.findMany({
      where: { OR: [{ userId }, { isOfficial: true }] },
      orderBy: [{ isOfficial: "desc" }, { createdAt: "desc" }],
    });
    return rows.map(this.toDto);
  }

  async findById(userId: string, id: string): Promise<Evaluation | null> {
    // Read path includes official sets — users can run against built-ins.
    const row = await this.prisma.evaluation.findFirst({
      where: { id, OR: [{ userId }, { isOfficial: true }] },
    });
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
    const existing = await this.prisma.evaluation.findFirst({
      where: { id, userId },
      select: { version: true, name: true, description: true, samples: true },
    });
    if (!existing) throw new NotFoundException(`evaluation ${id} not found`);

    const data: Prisma.EvaluationUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.description !== undefined) data.description = body.description;
    if (body.samples !== undefined) {
      data.samples = body.samples as unknown as Prisma.InputJsonValue;
      data.version = existing.version + 1;
      data.totalSamples = body.samples.length;
    }

    const row = await this.prisma.evaluation.update({ where: { id }, data });
    return this.toDto(row);
  }

  async delete(userId: string, id: string): Promise<void> {
    const owned = await this.prisma.evaluation.findFirst({
      where: { id, userId },
      select: { id: true },
    });
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
    isOfficial: boolean;
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
    isOfficial: row.isOfficial,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
