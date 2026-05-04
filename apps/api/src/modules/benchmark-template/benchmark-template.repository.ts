import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service.js";

/**
 * Skeleton repository for BenchmarkTemplate. PR2 will add full CRUD; for now
 * BenchmarkService only needs to validate that a templateId references an
 * existing row when the caller supplies one.
 */
@Injectable()
export class BenchmarkTemplateRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByIdOrNull(id: string) {
    return this.prisma.benchmarkTemplate.findUnique({ where: { id } });
  }
}
