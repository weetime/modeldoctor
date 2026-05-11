import { Module } from "@nestjs/common";
import { BenchmarkModule } from "../benchmark/benchmark.module.js";
import { ConnectionModule } from "../connection/connection.module.js";
import { DiagnosticsModule } from "../diagnostics/diagnostics.module.js";
import { McpController } from "./mcp.controller.js";
import { McpAuthGuard } from "./mcp.guard.js";
import { McpService } from "./mcp.service.js";

@Module({
  imports: [ConnectionModule, BenchmarkModule, DiagnosticsModule],
  controllers: [McpController],
  providers: [McpService, McpAuthGuard],
})
export class McpModule {}
