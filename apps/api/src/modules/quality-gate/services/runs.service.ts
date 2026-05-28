import type {
  CreateRunRequest,
  EvaluationRun,
  ListRunSamplesQuery,
  ListRunsQuery,
} from "@modeldoctor/contracts";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ConnectionService } from "../../connection/connection.service.js";
import { LlmJudgeService } from "../../llm-judge/llm-judge.service.js";
import { RunsRepository } from "../repositories/runs.repository.js";
import { EvaluationsService } from "./evaluations.service.js";
import { QualityGateRunExecutor } from "./run-executor.service.js";

// Exported so unit tests can assert the exact message without duplicating it.
// If the Settings page label ever moves, both this constant and the i18n key
// `settings.ai.title` need updating together.
export const NO_LLM_JUDGE_PROVIDER_MSG =
  "This evaluation requires an LLM judge. " +
  "No enabled LLM judge provider is configured. " +
  "Configure one at Settings → AI Diagnostics.";

@Injectable()
export class RunsService {
  constructor(
    private readonly repo: RunsRepository,
    private readonly evaluations: EvaluationsService,
    private readonly connections: ConnectionService,
    private readonly executor: QualityGateRunExecutor,
    private readonly llmJudge: LlmJudgeService,
  ) {}

  list(userId: string, q: ListRunsQuery) {
    return this.repo.list(userId, q);
  }

  async get(userId: string, id: string) {
    const run = await this.repo.findById(userId, id);
    if (!run) throw new NotFoundException(`run ${id} not found`);
    return run;
  }

  delete(userId: string, id: string) {
    return this.repo.deleteRun(userId, id);
  }

  /** List per-sample results for a run owned by the user. */
  async listSamples(userId: string, runId: string, q: ListRunSamplesQuery) {
    // Ownership check (throws if missing / not owned)
    await this.get(userId, runId);
    return this.repo.listSamples(runId, q);
  }

  async create(userId: string, body: CreateRunRequest): Promise<EvaluationRun> {
    const evaluation = await this.evaluations.get(userId, body.evaluationId);
    if (!evaluation) throw new NotFoundException(`evaluation ${body.evaluationId} not found`);

    const needsLlmJudge = evaluation.samples.some((s) => s.judgeConfig.kind === "llm-judge");
    if (needsLlmJudge) {
      const provider = await this.llmJudge.getDecrypted();
      if (!provider?.enabled) {
        throw new BadRequestException(NO_LLM_JUDGE_PROVIDER_MSG);
      }
    }

    const connA = await this.connections
      .findOwnedPublic(userId, body.endpointAId)
      .catch(() => null);
    if (!connA) throw new NotFoundException(`endpointA connection ${body.endpointAId} not found`);
    if (body.endpointBId) {
      const connB = await this.connections
        .findOwnedPublic(userId, body.endpointBId)
        .catch(() => null);
      if (!connB) throw new NotFoundException(`endpointB connection ${body.endpointBId} not found`);
    }

    // Baseline resolution. Dual mode wins: when endpointBId is set, baseline
    // is forced null (executor would otherwise ignore endpointBId). Contract
    // refine catches the explicit "both" case; this guard catches a stray
    // string slipping through alongside endpointBId.
    let baselineRunIdAtExecution: string | null = null;
    if (body.endpointBId == null && body.baselineRunIdOverride != null) {
      const override = await this.repo.findById(userId, body.baselineRunIdOverride);
      if (!override) {
        throw new NotFoundException(`baseline run ${body.baselineRunIdOverride} not found`);
      }
      if (override.evaluationId !== evaluation.id) {
        throw new BadRequestException(
          `baseline run ${body.baselineRunIdOverride} belongs to a different evaluation`,
        );
      }
      if (override.status !== "COMPLETED") {
        throw new BadRequestException(
          `baseline run ${body.baselineRunIdOverride} must be COMPLETED`,
        );
      }
      baselineRunIdAtExecution = override.id;
    }

    const pending = await this.repo.createPending({
      userId,
      evaluationId: evaluation.id,
      evaluationVersion: evaluation.version,
      evaluationSnapshot: { samples: evaluation.samples },
      endpointAId: body.endpointAId,
      endpointBId: body.endpointBId ?? null,
      gateConfig: body.gateConfig,
      baselineRunIdAtExecution,
    });

    // Fire and forget; executor runs async, controller returns immediately.
    void this.executor.start(pending.id);

    return pending;
  }

  async cancel(userId: string, id: string) {
    const run = await this.repo.findById(userId, id);
    if (!run) throw new NotFoundException(`run ${id} not found`);
    this.executor.cancel(id);
  }
}
