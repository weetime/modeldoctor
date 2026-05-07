// apps/api/src/modules/insights/insights.module.ts
import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module.js";
import { EvaluationProfileController } from "./evaluation-profile.controller.js";
import { EvaluationProfileService } from "./evaluation-profile.service.js";

@Module({
  imports: [DatabaseModule],
  controllers: [EvaluationProfileController],
  providers: [EvaluationProfileService],
  exports: [EvaluationProfileService],
})
export class InsightsModule {}
