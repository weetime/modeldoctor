import { Module } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service.js";
import { BenchmarkTemplateRepository } from "./benchmark-template.repository.js";

@Module({
  providers: [PrismaService, BenchmarkTemplateRepository],
  exports: [BenchmarkTemplateRepository],
})
export class BenchmarkTemplateModule {}
