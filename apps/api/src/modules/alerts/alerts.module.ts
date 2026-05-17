import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { DatabaseModule } from "../../database/database.module.js";
import { LlmJudgeModule } from "../llm-judge/llm-judge.module.js";
import { AlertsController } from "./alerts.controller.js";
import { AlertsService } from "./alerts.service.js";
import { AlertExplainerService } from "./explainer.service.js";

@Module({
  imports: [DatabaseModule, ConfigModule, LlmJudgeModule],
  controllers: [AlertsController],
  providers: [AlertsService, AlertExplainerService],
  exports: [AlertsService],
})
export class AlertsModule {}
