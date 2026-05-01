import type { ListRunsQuery, ListRunsResponse, Run } from "@modeldoctor/contracts";
import { Injectable, NotFoundException } from "@nestjs/common";
import { RunRepository, type RunWithConnection } from "./run.repository.js";

@Injectable()
export class RunService {
  constructor(private readonly repo: RunRepository) {}

  async findById(id: string): Promise<Run | null> {
    const row = await this.repo.findById(id);
    return row ? toContract(row) : null;
  }

  async findByIdOrFail(id: string, userId?: string): Promise<Run> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException(`Run ${id} not found`);
    // Ownership check: when a userId is supplied (auth'd path), the run must
    // belong to that user. Runs with null userId (system-initiated) are not
    // currently exposed to anyone via the auth'd endpoints.
    if (userId !== undefined && row.userId !== userId) {
      throw new NotFoundException(`Run ${id} not found`);
    }
    return toContract(row);
  }

  async list(query: ListRunsQuery, userId?: string): Promise<ListRunsResponse> {
    const result = await this.repo.list({
      ...query,
      // Force scope to current user when an auth'd caller invokes us.
      ...(userId !== undefined && { userId }),
    });
    return {
      items: result.items.map(toContract),
      nextCursor: result.nextCursor,
    };
  }
}

/**
 * Translate a Prisma Run row to the contract Run DTO.
 *
 * Drops `apiKeyCipher` — that column holds AES-256-GCM ciphertext for the
 * benchmark runner's outbound API key and must never leave the server.
 * Returning ciphertext over an authenticated HTTP API would enable offline
 * dictionary attacks on the encryption key.
 */
function toContract(row: RunWithConnection): Run {
  return {
    id: row.id,
    userId: row.userId,
    connectionId: row.connectionId,
    connection: row.connection ? { id: row.connection.id, name: row.connection.name } : null,
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
