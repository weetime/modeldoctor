// apps/api/src/modules/insights/insights.module.ts
import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module.js";
import { LlmJudgeModule } from "../llm-judge/llm-judge.module.js";
import { ComparisonController } from "./comparison.controller.js";
import { ComparisonService } from "./comparison.service.js";
import { EvaluationProfileController } from "./evaluation-profile.controller.js";
import { EvaluationProfileService } from "./evaluation-profile.service.js";
import { MatrixController } from "./matrix.controller.js";
import { MatrixService } from "./matrix.service.js";
import { SynthesizeController } from "./synthesize.controller.js";
import { SynthesizeService } from "./synthesize.service.js";

@Module({
  imports: [DatabaseModule, LlmJudgeModule],
  controllers: [
    EvaluationProfileController,
    ComparisonController,
    SynthesizeController,
    MatrixController,
  ],
  providers: [EvaluationProfileService, ComparisonService, SynthesizeService, MatrixService],
  exports: [EvaluationProfileService, ComparisonService, SynthesizeService, MatrixService],
})
export class InsightsModule {}
