// apps/api/src/modules/insights/insights.module.ts
import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module.js";
import { ComparisonController } from "./comparison.controller.js";
import { ComparisonService } from "./comparison.service.js";
import { EvaluationProfileController } from "./evaluation-profile.controller.js";
import { EvaluationProfileService } from "./evaluation-profile.service.js";

@Module({
  imports: [DatabaseModule],
  controllers: [EvaluationProfileController, ComparisonController],
  providers: [EvaluationProfileService, ComparisonService],
  exports: [EvaluationProfileService, ComparisonService],
})
export class InsightsModule {}
