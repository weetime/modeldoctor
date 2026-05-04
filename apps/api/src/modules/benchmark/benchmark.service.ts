import {
  type Benchmark,
  type CreateBenchmarkRequest,
  type ListBenchmarksQuery,
  type ListBenchmarksResponse,
} from "@modeldoctor/contracts";
import { type ToolName, applyScenarioConstraints, byTool } from "@modeldoctor/tool-adapters";
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
import { BenchmarkTemplateRepository } from "../benchmark-template/benchmark-template.repository.js";
import { ConnectionService } from "../connection/connection.service.js";
import { BenchmarkRepository, type BenchmarkWithRelations } from "./benchmark.repository.js";
import { imageForTool } from "./drivers/benchmark-driver.factory.js";
import { BENCHMARK_DRIVER } from "./drivers/benchmark-driver.token.js";
import type { BenchmarkExecutionDriver } from "./drivers/execution-driver.interface.js";

const TERMINAL_STATES = ["completed", "failed", "canceled"] as const;
// 15-minute slack on top of adapter.getMaxDurationSeconds(): a final /finish
// callback shouldn't be rejected if the runner overruns by clock skew or
// shutdown grace.
const CALLBACK_TTL_SLACK_SECONDS = 15 * 60;

@Injectable()
export class BenchmarkService {
  private readonly callbackSecret: Buffer;
  private readonly callbackUrl: string;
  private readonly driverKind: "local" | "k8s";

  constructor(
    private readonly repo: BenchmarkRepository,
    @Inject(BENCHMARK_DRIVER) private readonly driver: BenchmarkExecutionDriver,
    private readonly config: ConfigService<Env, true>,
    private readonly connections: ConnectionService,
    private readonly templates: BenchmarkTemplateRepository,
  ) {
    const secret = this.config.get("BENCHMARK_CALLBACK_SECRET", { infer: true }) as
      | string
      | undefined;
    if (!secret) {
      throw new Error(
        "BenchmarkService: BENCHMARK_CALLBACK_SECRET is required. Env schema must enforce presence outside test mode.",
      );
    }
    this.callbackSecret = Buffer.from(secret, "utf8");

    const url = this.config.get("BENCHMARK_CALLBACK_URL", { infer: true }) as string | undefined;
    if (!url) {
      throw new Error(
        "BenchmarkService: BENCHMARK_CALLBACK_URL is required. Env schema must enforce presence outside test mode.",
      );
    }
    this.callbackUrl = url;

    const driverChoice = (this.config.get("BENCHMARK_DRIVER", { infer: true }) ??
      "subprocess") as string;
    this.driverKind = driverChoice === "k8s" ? "k8s" : "local";
  }

  async findById(id: string): Promise<Benchmark | null> {
    const row = await this.repo.findById(id);
    return row ? toContract(row) : null;
  }

  async findByIdOrFail(id: string, userId?: string): Promise<Benchmark> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException(`Benchmark ${id} not found`);
    // Ownership check: when a userId is supplied (auth'd path), the benchmark
    // must belong to that user. Benchmarks with null userId (system-initiated)
    // are not currently exposed to anyone via the auth'd endpoints.
    if (userId !== undefined && row.userId !== userId) {
      throw new NotFoundException(`Benchmark ${id} not found`);
    }
    return toContract(row);
  }

  async list(query: ListBenchmarksQuery, userId?: string): Promise<ListBenchmarksResponse> {
    const result = await this.repo.list({
      ...query,
      // Force scope to current user when an auth'd caller invokes us.
      ...(userId !== undefined && { userId }),
    });
    return { items: result.items.map(toContract), nextCursor: result.nextCursor };
  }

  async create(userId: string, req: CreateBenchmarkRequest): Promise<Benchmark> {
    const conn = await this.connections.getOwnedDecrypted(userId, req.connectionId);
    const adapter = byTool(req.tool as ToolName);

    // 1. Validate scenario × tool compatibility before zod parse — gives a
    //    crisper error than "rateType not allowed".
    if (!adapter.scenarios.includes(req.scenario)) {
      throw new BadRequestException({
        code: "BENCHMARK_SCENARIO_TOOL_MISMATCH",
        message: `scenario '${req.scenario}' does not support tool '${req.tool}'`,
      });
    }

    // 2. Apply scenario-specific overlays (e.g. force rateType=sweep for
    //    capacity). NOTE: applyScenarioConstraints unwraps ZodEffects, so any
    //    superRefine on adapter.paramsSchema is DROPPED by the merge. We MUST
    //    also run the original schema afterward to retain cross-field rules
    //    (e.g. guidellm's "random dataset requires datasetInputTokens /
    //    datasetOutputTokens"). See JSDoc on applyScenarioConstraints.
    let params: unknown;
    try {
      const merged = applyScenarioConstraints(req.scenario, req.tool as ToolName);
      // First: scenario-narrowed shape (rateType narrowing).
      merged.parse(req.params);
      // Second: full base schema including superRefine cross-field checks.
      params = adapter.paramsSchema.parse(req.params);
    } catch (e) {
      throw new BadRequestException({
        code: "BENCHMARK_PARAMS_INVALID",
        message: `params validation failed: ${(e as Error).message}`,
      });
    }

    // 3. Reject duplicate active name (per-user uniqueness).
    const dupes = await this.repo.countActiveByName(userId, req.name);
    if (dupes > 0) {
      throw new ConflictException({
        code: "BENCHMARK_NAME_IN_USE",
        message: `An active benchmark named '${req.name}' already exists`,
      });
    }

    // 4. Validate templateId reference + scenario/tool match (if provided).
    if (req.templateId) {
      const tpl = await this.templates.findByIdOrNull(req.templateId);
      if (!tpl) {
        throw new BadRequestException({
          code: "BENCHMARK_TEMPLATE_NOT_FOUND",
          message: `templateId '${req.templateId}' does not exist`,
        });
      }
      if (tpl.scenario !== req.scenario || tpl.tool !== req.tool) {
        throw new BadRequestException({
          code: "BENCHMARK_TEMPLATE_MISMATCH",
          message: `template (scenario='${tpl.scenario}', tool='${tpl.tool}') does not match request (scenario='${req.scenario}', tool='${req.tool}')`,
        });
      }
    }

    const created = await this.repo.create({
      userId,
      connectionId: conn.id,
      scenario: req.scenario,
      tool: req.tool,
      driverKind: this.driverKind,
      name: req.name,
      description: req.description ?? null,
      params: params as Prisma.InputJsonValue,
      templateId: req.templateId ?? null,
      parentBenchmarkId: req.parentBenchmarkId ?? null,
      baselineId: req.baselineId ?? null,
    });

    return await this.start(created.id);
  }

  async start(benchmarkId: string): Promise<Benchmark> {
    const row = await this.repo.findById(benchmarkId);
    if (!row) throw new NotFoundException(`Benchmark ${benchmarkId} not found`);
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
    if (!reloaded) throw new NotFoundException(`Benchmark ${row.id} not found`);
    return toContract(reloaded);
  }

  async cancel(id: string, userId?: string): Promise<Benchmark> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException(`Benchmark ${id} not found`);
    if (userId !== undefined && row.userId !== userId) {
      throw new NotFoundException(`Benchmark ${id} not found`);
    }
    if ((TERMINAL_STATES as readonly string[]).includes(row.status)) {
      throw new BadRequestException({
        code: "BENCHMARK_ALREADY_TERMINAL",
        message: `Cannot cancel a benchmark in state '${row.status}'`,
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
    if (!reloaded) throw new NotFoundException(`Benchmark ${row.id} not found`);
    return toContract(reloaded);
  }

  async delete(id: string, userId?: string): Promise<void> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException(`Benchmark ${id} not found`);
    if (userId !== undefined && row.userId !== userId) {
      throw new NotFoundException(`Benchmark ${id} not found`);
    }
    if (!(TERMINAL_STATES as readonly string[]).includes(row.status)) {
      throw new ConflictException({
        code: "BENCHMARK_NOT_TERMINAL",
        message: `Cannot delete a benchmark in state '${row.status}'. Cancel it first.`,
      });
    }
    await this.repo.delete(row.id);
  }
}

/**
 * Translate a Prisma Benchmark row to the contract Benchmark DTO.
 *
 * Drops `apiKeyCipher` — that column holds AES-256-GCM ciphertext for the
 * benchmark runner's outbound API key and must never leave the server.
 * Returning ciphertext over an authenticated HTTP API would enable offline
 * dictionary attacks on the encryption key.
 */
function toContract(row: BenchmarkWithRelations): Benchmark {
  return {
    id: row.id,
    userId: row.userId,
    connectionId: row.connectionId,
    connection: row.connection ? { id: row.connection.id, name: row.connection.name } : null,
    scenario: row.scenario as Benchmark["scenario"],
    tool: row.tool as Benchmark["tool"],
    toolVersion: row.toolVersion,
    driverKind: row.driverKind as Benchmark["driverKind"],
    name: row.name,
    description: row.description,
    status: row.status as Benchmark["status"],
    statusMessage: row.statusMessage,
    progress: row.progress,
    driverHandle: row.driverHandle,
    params: row.params as Benchmark["params"],
    rawOutput: row.rawOutput as Benchmark["rawOutput"],
    summaryMetrics: row.summaryMetrics as Benchmark["summaryMetrics"],
    serverMetrics: row.serverMetrics as Benchmark["serverMetrics"],
    templateId: row.templateId,
    parentBenchmarkId: row.parentBenchmarkId,
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

export { toContract as benchmarkRowToContract };
