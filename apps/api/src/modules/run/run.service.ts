import {
  type CreateRunRequest,
  type ListRunsQuery,
  type ListRunsResponse,
  type Run,
} from "@modeldoctor/contracts";
import { type ToolName, byTool } from "@modeldoctor/tool-adapters";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Prisma } from "@prisma/client";
import { signCallbackToken } from "../../common/hmac/hmac-token.js";
import type { Env } from "../../config/env.schema.js";
import { ConnectionService } from "../connection/connection.service.js";
import type { RunExecutionDriver } from "./drivers/execution-driver.interface.js";
import { imageForTool } from "./drivers/run-driver.factory.js";
import { RUN_DRIVER } from "./drivers/run-driver.token.js";
import { RunRepository, type RunWithRelations } from "./run.repository.js";

const TERMINAL_STATES = ["completed", "failed", "canceled"] as const;
// 15-minute slack on top of adapter.getMaxDurationSeconds(): a final /finish
// callback shouldn't be rejected if the runner overruns by clock skew or
// shutdown grace.
const CALLBACK_TTL_SLACK_SECONDS = 15 * 60;

@Injectable()
export class RunService {
  private readonly callbackSecret: Buffer;
  private readonly callbackUrl: string;
  private readonly driverKind: "local" | "k8s";

  constructor(
    private readonly repo: RunRepository,
    @Inject(RUN_DRIVER) private readonly driver: RunExecutionDriver,
    private readonly config: ConfigService<Env, true>,
    private readonly connections: ConnectionService,
  ) {
    const secret = this.config.get("BENCHMARK_CALLBACK_SECRET", { infer: true }) as
      | string
      | undefined;
    if (!secret) {
      throw new Error(
        "RunService: BENCHMARK_CALLBACK_SECRET is required. Env schema must enforce presence outside test mode.",
      );
    }
    this.callbackSecret = Buffer.from(secret, "utf8");

    const url = this.config.get("BENCHMARK_CALLBACK_URL", { infer: true }) as string | undefined;
    if (!url) {
      throw new Error(
        "RunService: BENCHMARK_CALLBACK_URL is required. Env schema must enforce presence outside test mode.",
      );
    }
    this.callbackUrl = url;

    const driverChoice = (this.config.get("BENCHMARK_DRIVER", { infer: true }) ??
      "subprocess") as string;
    this.driverKind = driverChoice === "k8s" ? "k8s" : "local";
  }

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
    return { items: result.items.map(toContract), nextCursor: result.nextCursor };
  }

  async create(userId: string, req: CreateRunRequest): Promise<Run> {
    const conn = await this.connections.getOwnedDecrypted(userId, req.connectionId);
    const adapter = byTool(req.tool as ToolName);
    let params: unknown;
    try {
      params = adapter.paramsSchema.parse(req.params);
    } catch (e) {
      throw new BadRequestException({
        code: "RUN_PARAMS_INVALID",
        message: `params validation failed: ${(e as Error).message}`,
      });
    }

    const dupes = await this.repo.countActiveByName(userId, req.name);
    if (dupes > 0) {
      throw new ConflictException({
        code: "RUN_NAME_IN_USE",
        message: `An active run named '${req.name}' already exists`,
      });
    }

    const created = await this.repo.create({
      userId,
      connectionId: conn.id,
      kind: req.kind,
      tool: req.tool,
      mode: "fixed",
      driverKind: this.driverKind,
      name: req.name,
      description: req.description ?? null,
      scenario: {
        apiBaseUrl: conn.baseUrl,
        model: conn.model,
        customHeaders: conn.customHeaders,
        queryParams: conn.queryParams,
      },
      params: params as Prisma.InputJsonValue,
      templateId: req.templateId ?? null,
      templateVersion: req.templateVersion ?? null,
      parentRunId: req.parentRunId ?? null,
      baselineId: req.baselineId ?? null,
    });

    return await this.start(created.id);
  }

  async start(runId: string): Promise<Run> {
    const row = await this.repo.findById(runId);
    if (!row) throw new NotFoundException(`Run ${runId} not found`);
    if (!row.userId || !row.connectionId) {
      throw new BadRequestException("Connection no longer exists");
    }

    let handle: string;
    try {
      const conn = await this.connections.getOwnedDecrypted(row.userId, row.connectionId);
      const adapter = byTool(row.tool as ToolName);
      const adapterMaxDuration = adapter.getMaxDurationSeconds(row.params);
      const callbackToken = signCallbackToken(
        row.id,
        this.callbackSecret,
        adapterMaxDuration + CALLBACK_TTL_SLACK_SECONDS,
      );
      const buildResult = adapter.buildCommand({
        runId: row.id,
        params: row.params,
        connection: {
          baseUrl: conn.baseUrl,
          apiKey: conn.apiKey,
          model: conn.model,
          customHeaders: conn.customHeaders,
          queryParams: conn.queryParams,
          tokenizerHfId: conn.tokenizerHfId,
        },
        callback: { url: this.callbackUrl, token: callbackToken },
      });
      const result = await this.driver.start({
        runId: row.id,
        tool: row.tool as ToolName,
        buildResult,
        callback: { url: this.callbackUrl, token: callbackToken },
        image: this.driverKind === "k8s" ? imageForTool(row.tool as ToolName, this.config) : "",
      });
      handle = result.handle;
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      await this.repo.update(row.id, {
        status: "failed",
        statusMessage: msg.slice(0, 2048),
        completedAt: new Date(),
      });
      throw e;
    }

    await this.repo.update(row.id, {
      status: "submitted",
      driverHandle: handle,
      startedAt: new Date(),
    });
    const reloaded = await this.repo.findById(row.id);
    if (!reloaded) throw new NotFoundException(`Run ${row.id} not found`);
    return toContract(reloaded);
  }

  async cancel(id: string, userId?: string): Promise<Run> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException(`Run ${id} not found`);
    if (userId !== undefined && row.userId !== userId) {
      throw new NotFoundException(`Run ${id} not found`);
    }
    if ((TERMINAL_STATES as readonly string[]).includes(row.status)) {
      throw new BadRequestException({
        code: "RUN_ALREADY_TERMINAL",
        message: `Cannot cancel a run in state '${row.status}'`,
      });
    }
    if (row.status !== "pending" && row.driverHandle) {
      // re-raises non-404 errors per K8sJobDriver contract; let them propagate
      // so callers see a 5xx instead of a misleading 200 canceled.
      await this.driver.cancel(row.driverHandle);
    }
    await this.repo.update(row.id, {
      status: "canceled",
      completedAt: new Date(),
    });
    const reloaded = await this.repo.findById(row.id);
    if (!reloaded) throw new NotFoundException(`Run ${row.id} not found`);
    return toContract(reloaded);
  }

  async delete(id: string, userId?: string): Promise<void> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException(`Run ${id} not found`);
    if (userId !== undefined && row.userId !== userId) {
      throw new NotFoundException(`Run ${id} not found`);
    }
    if (!(TERMINAL_STATES as readonly string[]).includes(row.status)) {
      throw new ConflictException({
        code: "RUN_NOT_TERMINAL",
        message: `Cannot delete a run in state '${row.status}'. Cancel it first.`,
      });
    }
    await this.repo.delete(row.id);
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
function toContract(row: RunWithRelations): Run {
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
    rawOutput: row.rawOutput as Run["rawOutput"],
    summaryMetrics: row.summaryMetrics as Run["summaryMetrics"],
    serverMetrics: row.serverMetrics as Run["serverMetrics"],
    templateId: row.templateId,
    templateVersion: row.templateVersion,
    parentRunId: row.parentRunId,
    baselineId: row.baselineId,
    baselineFor: row.baselineFor
      ? {
          id: row.baselineFor.id,
          name: row.baselineFor.name,
          createdAt: row.baselineFor.createdAt.toISOString(),
        }
      : null,
    logs: row.logs,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

export { toContract as runRowToContract };
