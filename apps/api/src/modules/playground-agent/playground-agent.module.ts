import { Module } from "@nestjs/common";
import { ConnectionModule } from "../connection/connection.module.js";
import { LlmJudgeModule } from "../llm-judge/llm-judge.module.js";
import { McpClientModule } from "../mcp-client/mcp-client.module.js";
import { McpServerModule } from "../mcp-server/mcp-server.module.js";
import { AgentController } from "./agent.controller.js";
import { AgentJudgeService } from "./agent-judge.service.js";
import { AgentLoopService } from "./agent-loop.service.js";

@Module({
  imports: [ConnectionModule, McpClientModule, McpServerModule, LlmJudgeModule],
  controllers: [AgentController],
  providers: [AgentLoopService, AgentJudgeService],
})
export class PlaygroundAgentModule {}
