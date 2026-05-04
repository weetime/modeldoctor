import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema.js";
import { PrismaService } from "../../database/prisma.service.js";
import { BenchmarkTemplateModule } from "../benchmark-template/benchmark-template.module.js";
import { ConnectionModule } from "../connection/connection.module.js";
import { BenchmarkCallbackController } from "./callbacks/benchmark-callback.controller.js";
import { createBenchmarkDriver } from "./drivers/benchmark-driver.factory.js";
import { BENCHMARK_DRIVER } from "./drivers/benchmark-driver.token.js";
import { BenchmarkChartsService } from "./benchmark-charts.service.js";
import { BenchmarkController } from "./benchmark.controller.js";
import { BenchmarkRepository } from "./benchmark.repository.js";
import { BenchmarkService } from "./benchmark.service.js";
import { SseHub } from "./sse/sse-hub.service.js";

@Module({
  imports: [ConfigModule, ConnectionModule, BenchmarkTemplateModule],
  controllers: [BenchmarkController, BenchmarkCallbackController],
  providers: [
    PrismaService,
    BenchmarkRepository,
    BenchmarkService,
    BenchmarkChartsService,
    SseHub,
    {
      provide: BENCHMARK_DRIVER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => createBenchmarkDriver(config),
    },
  ],
  exports: [BenchmarkRepository, BenchmarkService, BenchmarkChartsService, SseHub],
})
export class BenchmarkModule {}
