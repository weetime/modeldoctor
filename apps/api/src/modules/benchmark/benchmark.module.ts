import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema.js";
import { DatabaseModule } from "../../database/database.module.js";
import { RunModule } from "../run/run.module.js";
import { BenchmarkController } from "./benchmark.controller.js";
import { BENCHMARK_K8S_READER, BenchmarkReconciler } from "./benchmark.reconciler.js";
import { BenchmarkService } from "./benchmark.service.js";
import { BenchmarkCallbackController } from "./callbacks/benchmark-callback.controller.js";
import { HmacCallbackGuard } from "./callbacks/hmac-callback.guard.js";
import { BENCHMARK_DRIVER } from "./drivers/benchmark-driver.token.js";
import { createBenchmarkDriver } from "./drivers/driver.factory.js";
import { createBenchmarkK8sReader } from "./drivers/k8s-reader.factory.js";

@Module({
  imports: [DatabaseModule, RunModule],
  controllers: [BenchmarkController, BenchmarkCallbackController],
  providers: [
    BenchmarkService,
    BenchmarkReconciler,
    HmacCallbackGuard,
    {
      provide: BENCHMARK_DRIVER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => createBenchmarkDriver(config),
    },
    {
      provide: BENCHMARK_K8S_READER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => createBenchmarkK8sReader(config),
    },
  ],
})
export class BenchmarkModule {}
