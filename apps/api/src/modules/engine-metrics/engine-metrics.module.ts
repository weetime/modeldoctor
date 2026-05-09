import { Module } from "@nestjs/common";
import { ConnectionModule } from "../connection/connection.module.js";
import { EngineMetricsController } from "./engine-metrics.controller.js";
import { EngineMetricsService } from "./engine-metrics.service.js";
import { PromClient } from "./prom-client.js";

@Module({
  imports: [ConnectionModule],
  controllers: [EngineMetricsController],
  providers: [EngineMetricsService, PromClient],
  exports: [EngineMetricsService],
})
export class EngineMetricsModule {}
