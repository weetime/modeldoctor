// apps/api/src/modules/llm-judge/llm-judge.module.ts
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { DatabaseModule } from "../../database/database.module.js";
import { LlmJudgeController } from "./llm-judge.controller.js";
import { LlmJudgeService } from "./llm-judge.service.js";

@Module({
  imports: [ConfigModule, DatabaseModule],
  controllers: [LlmJudgeController],
  providers: [LlmJudgeService],
  exports: [LlmJudgeService],
})
export class LlmJudgeModule {}
