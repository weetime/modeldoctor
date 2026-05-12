import type { CreateRunRequest, EvaluationRun, ListRunsQuery } from "@modeldoctor/contracts";
import { Injectable, NotFoundException } from "@nestjs/common";
import type { RunsRepository } from "../repositories/runs.repository.js";
import type { EvaluationsService } from "./evaluations.service.js";
import type { QualityGateRunExecutor } from "./run-executor.service.js";

interface ConnectionsLike {
  findById(id: string, userId: string): Promise<{ id: string } | null>;
}

@Injectable()
export class RunsService {
  constructor(
    private readonly repo: RunsRepository,
    private readonly evaluations: EvaluationsService,
    private readonly connections: ConnectionsLike,
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

  async create(userId: string, body: CreateRunRequest): Promise<EvaluationRun> {
    const evaluation = await this.evaluations.get(userId, body.evaluationId);
    if (!evaluation) throw new NotFoundException(`evaluation ${body.evaluationId} not found`);
    const connA = await this.connections.findById(body.endpointAId, userId);
    if (!connA) throw new NotFoundException(`endpointA connection ${body.endpointAId} not found`);
    if (body.endpointBId) {
      const connB = await this.connections.findById(body.endpointBId, userId);
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
