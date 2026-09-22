import { Module } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service.js";
import { BaselineModule } from "../baseline/baseline.module.js";
import { BenchmarkModule } from "../benchmark/benchmark.module.js";
import { BenchmarkTemplateModule } from "../benchmark-template/benchmark-template.module.js";
import { ConnectionModule } from "../connection/connection.module.js";
import { DiagnosticsModule } from "../diagnostics/diagnostics.module.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { QualityGateModule } from "../quality-gate/quality-gate.module.js";
import { AutomationRunnerService } from "./automation/automation-runner.service.js";
import { PlatformSourceCron } from "./automation/platform-source.cron.js";
import { GpustackClientFactory } from "./gpustack/gpustack-client.js";
import { PlatformSourcesController } from "./sources/platform-sources.controller.js";
import { PlatformSourcesService } from "./sources/platform-sources.service.js";
import { SourceSyncService } from "./sync/source-sync.service.js";
import { SourceWatcherService } from "./sync/source-watcher.service.js";

@Module({
  imports: [
    ConnectionModule,
    DiagnosticsModule,
    QualityGateModule,
    BenchmarkModule,
    BenchmarkTemplateModule,
    BaselineModule,
    NotificationsModule,
  ],
  controllers: [PlatformSourcesController],
  providers: [
    PrismaService,
    GpustackClientFactory,
    PlatformSourcesService,
    SourceSyncService,
    SourceWatcherService,
    AutomationRunnerService,
    PlatformSourceCron,
  ],
  exports: [PlatformSourcesService, SourceSyncService, AutomationRunnerService],
})
export class PlatformSourceModule {}
