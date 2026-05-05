import { Module } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service.js";
import { BenchmarkTemplateController } from "./benchmark-template.controller.js";
import { BenchmarkTemplateRepository } from "./benchmark-template.repository.js";
import { BenchmarkTemplateService } from "./benchmark-template.service.js";

@Module({
  controllers: [BenchmarkTemplateController],
  providers: [PrismaService, BenchmarkTemplateRepository, BenchmarkTemplateService],
  exports: [BenchmarkTemplateRepository, BenchmarkTemplateService],
})
export class BenchmarkTemplateModule {}
