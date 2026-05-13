import type {
  CreateRunRequest,
  EvaluationRun,
  ListRunSamplesQuery,
  ListRunsQuery,
} from "@modeldoctor/contracts";
import { Injectable, NotFoundException } from "@nestjs/common";
import { ConnectionService } from "../../connection/connection.service.js";
import { RunsRepository } from "../repositories/runs.repository.js";
import { EvaluationsService } from "./evaluations.service.js";
import { QualityGateRunExecutor } from "./run-executor.service.js";

@Injectable()
export class RunsService {
  constructor(
    private readonly repo: RunsRepository,
    private readonly evaluations: EvaluationsService,
    private readonly connections: ConnectionService,
    private readonly executor: QualityGateRunExecutor,
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

    const pending = await this.repo.createPending({
      userId,
      evaluationId: evaluation.id,
      evaluationVersion: evaluation.version,
      evaluationSnapshot: { samples: evaluation.samples },
      endpointAId: body.endpointAId,
      endpointBId: body.endpointBId ?? null,
      gateConfig: body.gateConfig,
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
