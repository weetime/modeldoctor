import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { DatabaseModule } from "../../database/database.module.js";
import { LlmJudgeModule } from "../llm-judge/llm-judge.module.js";
import { AlertsController } from "./alerts.controller.js";
import { AlertsService } from "./alerts.service.js";
import { AlertExplainerService } from "./explainer.service.js";
import { SubscribersController } from "./subscribers.controller.js";
import { SubscribersService } from "./subscribers.service.js";

@Module({
  imports: [DatabaseModule, ConfigModule, LlmJudgeModule],
  controllers: [AlertsController, SubscribersController],
  providers: [AlertsService, AlertExplainerService, SubscribersService],
  exports: [AlertsService],
})
export class AlertsModule {}
