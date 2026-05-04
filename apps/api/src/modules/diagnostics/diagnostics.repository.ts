import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service.js";

@Injectable()
export class DiagnosticsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: {
    userId: string | null;
    connectionId: string | null;
    probes: string[];
    pathOverride: Prisma.InputJsonValue;
  }) {
    return this.prisma.diagnosticsRun.create({
      data: {
        userId: input.userId,
        connectionId: input.connectionId,
        status: "completed",
        statusMessage: null,
        probes: input.probes,
        pathOverride: input.pathOverride,
        results: [] as Prisma.InputJsonValue,
        summary: { total: 0, passed: 0, failed: 0 } as Prisma.InputJsonValue,
        startedAt: new Date(),
      },
    });
  }

  async update(
    id: string,
    patch: {
      status?: "completed" | "failed";
      statusMessage?: string | null;
      results?: Prisma.InputJsonValue;
      summary?: Prisma.InputJsonValue;
      completedAt?: Date;
    },
  ) {
    return this.prisma.diagnosticsRun.update({ where: { id }, data: patch });
  }

  async findById(id: string) {
    return this.prisma.diagnosticsRun.findUnique({ where: { id } });
  }
}
