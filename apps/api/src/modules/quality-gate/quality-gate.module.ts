import { Module } from "@nestjs/common";
import { ConnectionModule } from "../connection/connection.module.js";
import { LlmJudgeModule } from "../llm-judge/llm-judge.module.js";
import { EvaluationsController } from "./controllers/evaluations.controller.js";
import { RunsController } from "./controllers/runs.controller.js";
import { EndpointCaller } from "./endpoint-caller.js";
import { JudgesService } from "./judges/judges.service.js";
import { EvaluationsRepository } from "./repositories/evaluations.repository.js";
import { RunsRepository } from "./repositories/runs.repository.js";
import { EvaluationsService } from "./services/evaluations.service.js";
import { QualityGateRunExecutor } from "./services/run-executor.service.js";
import { RunsService } from "./services/runs.service.js";

@Module({
  imports: [ConnectionModule, LlmJudgeModule],
  controllers: [EvaluationsController, RunsController],
  providers: [
    EvaluationsRepository,
    RunsRepository,
    EvaluationsService,
    EndpointCaller,
    JudgesService,
    QualityGateRunExecutor,
    RunsService,
  ],
  exports: [EvaluationsService, RunsService],
})
export class QualityGateModule {}
