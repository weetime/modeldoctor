import { Module } from "@nestjs/common";
import { ConnectionModule } from "../connection/connection.module.js";
import { AgentController } from "./agent.controller.js";
import { AgentLoopService } from "./agent-loop.service.js";

@Module({
  imports: [ConnectionModule],
  controllers: [AgentController],
  providers: [AgentLoopService],
})
export class PlaygroundAgentModule {}
