import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module.js";
import { AlertsModule } from "../alerts/alerts.module.js";
import { BenchmarkModule } from "../benchmark/benchmark.module.js";
import { ConnectionModule } from "../connection/connection.module.js";
import { DiagnosticsModule } from "../diagnostics/diagnostics.module.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { PrometheusDatasourceModule } from "../prometheus-datasource/prometheus-datasource.module.js";
import { QualityGateModule } from "../quality-gate/quality-gate.module.js";
import { ConfirmTokenService } from "./confirm-token.service.js";
import { McpController } from "./mcp.controller.js";
import { McpAuthGuard } from "./mcp.guard.js";
import { McpService } from "./mcp.service.js";

@Module({
  imports: [
    DatabaseModule,
    ConnectionModule,
    BenchmarkModule,
    DiagnosticsModule,
    NotificationsModule,
    AlertsModule,
    PrometheusDatasourceModule,
    QualityGateModule,
  ],
  controllers: [McpController],
  providers: [McpService, McpAuthGuard, ConfirmTokenService],
})
export class McpModule {}
