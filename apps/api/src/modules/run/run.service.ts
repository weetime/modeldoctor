import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  Run,
  ListRunsQuery,
  ListRunsResponse,
} from "@modeldoctor/contracts";
import type { Run as PrismaRun } from "@prisma/client";
import { RunRepository } from "./run.repository.js";

@Injectable()
export class RunService {
  constructor(private readonly repo: RunRepository) {}

  async findById(id: string): Promise<Run | null> {
    const row = await this.repo.findById(id);
    return row ? toContract(row) : null;
  }

  async findByIdOrFail(id: string): Promise<Run> {
    const row = await this.findById(id);
    if (!row) throw new NotFoundException(`Run ${id} not found`);
    return row;
  }

  async list(query: ListRunsQuery): Promise<ListRunsResponse> {
    const result = await this.repo.list(query);
    return {
      items: result.items.map(toContract),
      nextCursor: result.nextCursor,
    };
  }
}

function toContract(row: PrismaRun): Run {
  return {
    id: row.id,
    userId: row.userId,
    connectionId: row.connectionId,
    kind: row.kind as Run["kind"],
    tool: row.tool as Run["tool"],
    scenario: row.scenario as Run["scenario"],
    mode: row.mode as Run["mode"],
    driverKind: row.driverKind as Run["driverKind"],
    name: row.name,
    description: row.description,
    status: row.status as Run["status"],
    statusMessage: row.statusMessage,
    progress: row.progress,
    driverHandle: row.driverHandle,
    apiKeyCipher: row.apiKeyCipher,
    params: row.params as Run["params"],
    canonicalReport: row.canonicalReport as Run["canonicalReport"],
    rawOutput: row.rawOutput as Run["rawOutput"],
    summaryMetrics: row.summaryMetrics as Run["summaryMetrics"],
    serverMetrics: row.serverMetrics as Run["serverMetrics"],
    templateId: row.templateId,
    templateVersion: row.templateVersion,
    parentRunId: row.parentRunId,
    baselineId: row.baselineId,
    logs: row.logs,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

export { toContract as runRowToContract };
