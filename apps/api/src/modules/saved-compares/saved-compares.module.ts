import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module.js";
import { LlmJudgeModule } from "../llm-judge/llm-judge.module.js";
import { CompareSynthesizeService } from "./compare-synthesize.service.js";
import { SavedComparesController } from "./saved-compares.controller.js";
import { SavedComparesService } from "./saved-compares.service.js";

@Module({
  imports: [DatabaseModule, LlmJudgeModule],
  controllers: [SavedComparesController],
  providers: [SavedComparesService, CompareSynthesizeService],
  exports: [SavedComparesService, CompareSynthesizeService],
})
export class SavedComparesModule {}
