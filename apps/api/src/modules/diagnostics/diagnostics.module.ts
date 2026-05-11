import { Module } from "@nestjs/common";
import { ConnectionModule } from "../connection/connection.module.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { DiagnosticsController } from "./diagnostics.controller.js";
import { DiagnosticsRepository } from "./diagnostics.repository.js";
import { DiagnosticsService } from "./diagnostics.service.js";

@Module({
  imports: [ConnectionModule, NotificationsModule],
  controllers: [DiagnosticsController],
  providers: [DiagnosticsService, DiagnosticsRepository],
  exports: [DiagnosticsService],
})
export class DiagnosticsModule {}
