import {
  type Benchmark,
  type BenchmarkStatus,
  type CreateBenchmarkRequest,
  type EndpointReport,
  type EndpointReportRange,
  type EndpointReportsResponse,
  type ListBenchmarksQuery,
  type ListBenchmarksResponse,
} from "@modeldoctor/contracts";
import { applyScenarioConstraints, byTool, type ToolName } from "@modeldoctor/tool-adapters";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { signCallbackToken } from "../../common/hmac/hmac-token.js";
import { formatZodError } from "../../common/zod/format-zod-error.js";
import type { Env } from "../../config/env.schema.js";
import { PrismaService } from "../../database/prisma.service.js";
import { BaselineService } from "../baseline/baseline.service.js";
import { BenchmarkTemplateRepository } from "../benchmark-template/benchmark-template.repository.js";
import { ConnectionService } from "../connection/connection.service.js";
import { NotifyService } from "../notifications/notify.service.js";
import { BenchmarkRepository, type BenchmarkWithRelations } from "./benchmark.repository.js";
import { K8sBenchmarkRunner } from "./k8s/k8s-benchmark-runner.js";
import { imageForTool } from "./k8s/runner-images.js";
import { readP95LatencyMs } from "./metrics.js";

const TERMINAL_STATES = ["completed", "failed", "canceled"] as const;

const IN_PROGRESS_STATES = ["pending", "submitted", "running"] as const;
function isInProgressStatus(status: string): boolean {
  return (IN_PROGRESS_STATES as readonly string[]).includes(status);
}

/** Safety cap for the per-user/per-window query the reports endpoint
 * issues. In practice user × 30-day windows are << 1000 rows; this
 * exists only to bound worst-case memory if a power user runs many
 * thousands of tests. */
const MAX_REPORT_ROWS = 5000;
// 15-minute slack on top of adapter.getMaxDurationSeconds(): a final /finish
// callback shouldn't be rejected if the runner overruns by clock skew or
// shutdown grace.
const CALLBACK_TTL_SLACK_SECONDS = 15 * 60;

@Injectable()
export class BenchmarkService {
  private readonly log = new Logger(BenchmarkService.name);
  private readonly callbackSecret: Buffer;
  private readonly callbackUrl: string;

  constructor(
    private readonly repo: BenchmarkRepository,
    private readonly runner: K8sBenchmarkRunner,
    private readonly config: ConfigService<Env, true>,
    private readonly connections: ConnectionService,
    private readonly templates: BenchmarkTemplateRepository,
    private readonly baselines: BaselineService,
    private readonly prisma: PrismaService,
    private readonly notify: NotifyService,
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
      const detail = e instanceof ZodError ? formatZodError(e) : (e as Error).message;
      throw new BadRequestException({
        code: "BENCHMARK_PARAMS_INVALID",
        message: `params validation failed: ${detail}`,
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

    // 4. Validate FK references against existing rows BEFORE handing off to
    //    Prisma. Without these probes, a bogus id would raise P2003 inside
    //    repo.create and bubble up as a 500 — bad UX, and indistinguishable
    //    from real DB outages in monitoring. Each probe is a single
    //    findUnique({ select: { id: true } }) so the cost is negligible.
    //
    //    Existence checks here are PURE existence — no ownership check on
    //    parentBenchmarkId or baselineId because users may reference
    //    benchmarks/baselines they don't own (e.g. cloning a template-built
    //    benchmark, or comparing against a shared baseline).
    if (req.templateId) {
      const tpl = await this.assertReferenceExists("template", req.templateId, (id) =>
        this.templates.findByIdOrNull(id),
      );
      if (tpl.scenario !== req.scenario || tpl.tool !== req.tool) {
        throw new BadRequestException({
          code: "BENCHMARK_TEMPLATE_MISMATCH",
          message: `template (scenario='${tpl.scenario}', tool='${tpl.tool}') does not match request (scenario='${req.scenario}', tool='${req.tool}')`,
        });
      }
    }
    if (req.parentBenchmarkId) {
      await this.assertReferenceExists("parent", req.parentBenchmarkId, async (id) =>
        (await this.repo.existsById(id)) ? { id } : null,
      );
    }
    if (req.baselineId) {
      await this.assertReferenceExists("baseline", req.baselineId, async (id) =>
        (await this.baselines.existsById(id)) ? { id } : null,
      );
    }

    const created = await this.repo.create({
      userId,
      connectionId: conn.id,
      scenario: req.scenario,
      tool: req.tool,
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
          prometheusDatasource: conn.prometheusDatasource,
        },
        callback: { url: this.callbackUrl, token: callbackToken },
      });
      const result = await this.runner.start({
        runId: row.id,
        tool: row.tool as ToolName,
        buildResult,
        callback: { url: this.callbackUrl, token: callbackToken },
        image: imageForTool(row.tool as ToolName, this.config),
      });
      handle = result.handle;
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      await this.repo.update(row.id, {
        status: "failed",
        statusMessage: msg.slice(0, 2048),
        completedAt: new Date(),
      });
      if (row.userId) {
        await this.notify.emit({
          eventType: "benchmark.failed",
          userId: row.userId,
          connectionId: row.connectionId ?? undefined,
          payload: {
            benchmarkId: row.id,
            name: row.name,
            status: "failed",
            reason: msg.slice(0, 2048),
          },
        });
      }
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
      // re-raises non-404 errors per K8sBenchmarkRunner contract; let them propagate
      // so callers see a 5xx instead of a misleading 200 canceled.
      await this.runner.cancel(row.driverHandle);
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
    // Non-terminal rows may have a backing driver job (K8s Job, subprocess,
    // …). Best-effort cancel before DB delete so we don't orphan resources.
    // The K8sBenchmarkRunner already treats 404 on the Job as idempotent; any
    // other error is logged and swallowed so a flaky apiserver doesn't
    // block the user from clearing a stuck row.
    const isTerminal = (TERMINAL_STATES as readonly string[]).includes(row.status);
    if (!isTerminal && row.driverHandle) {
      try {
        await this.runner.cancel(row.driverHandle);
      } catch (e) {
        const err = e as Error;
        this.log.warn(
          `delete: best-effort driver.cancel failed for ${row.id}: ${err.message}\n${err.stack ?? ""}`,
        );
      }
    }
    await this.repo.delete(row.id);
  }

  /**
   * Connection-anchored 7/30/90-day report. Pulls all of `userId`'s
   * benchmarks within the window, buckets by connectionId in JS, and
   * emits one summary per connection. Bounded data per user/window —
   * no streaming needed.
   *
   * Orphaned benchmarks (connection deleted, FK SET NULL) are dropped —
   * they don't belong on a connection-anchored view.
   */
  async getByConnectionReports(
    userId: string,
    range: EndpointReportRange,
  ): Promise<EndpointReportsResponse> {
    const days = ({ "7d": 7, "30d": 30, "90d": 90 } as const)[range];
    const since = new Date(Date.now() - days * 86_400_000);

    const result = await this.repo.list({
      userId,
      createdAfter: since.toISOString(),
      limit: MAX_REPORT_ROWS,
    });

    type Row = (typeof result)["items"][number];
    const groups = new Map<string, Row[]>();
    for (const r of result.items) {
      if (!r.connection) continue;
      const arr = groups.get(r.connection.id) ?? [];
      arr.push(r);
      groups.set(r.connection.id, arr);
    }

    // Batch-load category for every grouped connection in one query.
    const connectionIds = [...groups.keys()];
    const categoryRows =
      connectionIds.length > 0
        ? await this.prisma.connection.findMany({
            where: { id: { in: connectionIds } },
            select: { id: true, category: true },
          })
        : [];
    const categoryById = new Map(categoryRows.map((r) => [r.id, r.category]));

    const items: EndpointReport[] = [];
    for (const [connId, runs] of groups.entries()) {
      // groups Map only contains rows whose connection passed the !r.connection
      // guard above, so the embedded ref is non-null here.
      const connection = runs[0].connection;
      if (!connection) continue;
      // Success-rate denominator is completed + failed only. Cancellation
      // is user action (someone clicked "cancel"), not an endpoint signal —
      // including canceled runs would artificially lower the connection's
      // health score for unrelated reasons.
      const completed = runs.filter((r) => r.status === "completed");
      const failed = runs.filter((r) => r.status === "failed");
      const canceled = runs.filter((r) => r.status === "canceled").length;
      const inProgress = runs.filter((r) => isInProgressStatus(r.status)).length;
      const successRateDenominator = completed.length + failed.length;

      const successRate =
        successRateDenominator > 0 ? (completed.length / successRateDenominator) * 100 : null;

      const completedAsc = [...completed].sort(
        (a, b) => +new Date(a.createdAt) - +new Date(b.createdAt),
      );
      const firstWithMetric = completedAsc.find((r) => readP95LatencyMs(r.summaryMetrics) != null);
      const lastWithMetric = [...completedAsc]
        .reverse()
        .find((r) => readP95LatencyMs(r.summaryMetrics) != null);
      const p95Latency =
        firstWithMetric || lastWithMetric
          ? {
              first: firstWithMetric ? readP95LatencyMs(firstWithMetric.summaryMetrics) : null,
              last: lastWithMetric ? readP95LatencyMs(lastWithMetric.summaryMetrics) : null,
            }
          : null;

      const latestRow = runs.reduce((a, b) => (a.createdAt >= b.createdAt ? a : b));
      const latestRun = {
        id: latestRow.id,
        name: latestRow.name,
        status: latestRow.status as BenchmarkStatus,
        createdAt: latestRow.createdAt.toISOString(),
      };

      items.push({
        connection: {
          id: connection.id,
          name: connection.name,
          model: connection.model,
          baseUrl: connection.baseUrl,
          category: (categoryById.get(connId) ??
            "chat") as EndpointReport["connection"]["category"],
        },
        totalRuns: runs.length,
        statusCounts: {
          completed: completed.length,
          failed: failed.length,
          canceled,
          inProgress,
        },
        successRate,
        p95Latency,
        latestRun,
      });
    }

    items.sort((a, b) => b.totalRuns - a.totalRuns);
    return {
      range,
      generatedAt: new Date().toISOString(),
      items,
    };
  }

  /**
   * Verify that a foreign-key reference (templateId / parentBenchmarkId /
   * baselineId) points at an existing row. Throws BadRequestException with a
   * stable, kind-specific error code on miss so clients can render a
   * field-level message instead of "internal server error".
   *
   * The lookup callback returns `null` on miss and the row on hit; existence-
   * only checks can pass `(id) => exists ? { id } : null`. Returning the row
   * lets callers do additional invariants (e.g. template scenario/tool match)
   * without a second round-trip.
   */
  private async assertReferenceExists<T extends object>(
    kind: "template" | "parent" | "baseline",
    id: string,
    lookup: (id: string) => Promise<T | null>,
  ): Promise<T> {
    const row = await lookup(id);
    if (row) return row;
    const errorMap = {
      template: { code: "BENCHMARK_TEMPLATE_NOT_FOUND", field: "templateId" },
      parent: { code: "BENCHMARK_PARENT_NOT_FOUND", field: "parentBenchmarkId" },
      baseline: { code: "BENCHMARK_BASELINE_NOT_FOUND", field: "baselineId" },
    } as const;
    const { code, field } = errorMap[kind];
    throw new BadRequestException({
      code,
      message: `${field} '${id}' does not exist`,
    });
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
    connection: row.connection
      ? {
          id: row.connection.id,
          name: row.connection.name,
          model: row.connection.model,
          baseUrl: row.connection.baseUrl,
        }
      : null,
    scenario: row.scenario as Benchmark["scenario"],
    tool: row.tool as Benchmark["tool"],
    toolVersion: row.toolVersion,
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
