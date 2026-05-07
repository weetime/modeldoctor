// apps/api/src/modules/insights/insights.module.ts
import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module.js";
import { LlmJudgeModule } from "../llm-judge/llm-judge.module.js";
import { ComparisonController } from "./comparison.controller.js";
import { ComparisonService } from "./comparison.service.js";
import { EvaluationProfileController } from "./evaluation-profile.controller.js";
import { EvaluationProfileService } from "./evaluation-profile.service.js";
import { SynthesizeController } from "./synthesize.controller.js";
import { SynthesizeService } from "./synthesize.service.js";

@Module({
  imports: [DatabaseModule, LlmJudgeModule],
  controllers: [EvaluationProfileController, ComparisonController, SynthesizeController],
  providers: [EvaluationProfileService, ComparisonService, SynthesizeService],
  exports: [EvaluationProfileService, ComparisonService, SynthesizeService],
})
export class InsightsModule {}
