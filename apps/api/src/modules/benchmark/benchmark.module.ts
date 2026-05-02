import { Module } from "@nestjs/common";
import { RunModule } from "../run/run.module.js";
import { BenchmarkController } from "./benchmark.controller.js";

/**
 * Phase 3 facade (#53). Bindings live in RunModule; this module only
 * mounts the legacy /api/benchmarks/* route surface for FE backward
 * compat. #54 deletes this module.
 */
@Module({
  imports: [RunModule],
  controllers: [BenchmarkController],
})
export class BenchmarkModule {}
