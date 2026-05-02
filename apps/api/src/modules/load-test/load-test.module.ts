import { Module } from "@nestjs/common";
import { RunModule } from "../run/run.module.js";
import { LoadTestController } from "./load-test.controller.js";

/**
 * Phase 3 facade (#53). Bindings live in RunModule; this module only
 * mounts the legacy /api/load-test/* route surface for FE backward
 * compat. #54 deletes this module.
 */
@Module({
  imports: [RunModule],
  controllers: [LoadTestController],
})
export class LoadTestModule {}
