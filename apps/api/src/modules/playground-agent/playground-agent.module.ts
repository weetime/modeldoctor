import { Module } from "@nestjs/common";
import { ConnectionModule } from "../connection/connection.module.js";
import { McpClientModule } from "../mcp-client/mcp-client.module.js";
import { McpServerModule } from "../mcp-server/mcp-server.module.js";
import { AgentController } from "./agent.controller.js";
import { AgentLoopService } from "./agent-loop.service.js";

@Module({
  imports: [ConnectionModule, McpClientModule, McpServerModule],
  controllers: [AgentController],
  providers: [AgentLoopService],
})
export class PlaygroundAgentModule {}
