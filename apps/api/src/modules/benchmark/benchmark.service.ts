import {
  type BenchmarkMetricsCallback,
  type BenchmarkRun as BenchmarkRunDto,
  type BenchmarkRunSummary,
  type BenchmarkState,
  type BenchmarkStateCallback,
  type CreateBenchmarkRequest,
  ErrorCodes,
  type ListBenchmarksQuery,
  type ListBenchmarksResponse,
} from "@modeldoctor/contracts";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, type Run as PrismaRun } from "@prisma/client";
import { decodeKey, decrypt, encrypt } from "../../common/crypto/aes-gcm.js";
import type { Env } from "../../config/env.schema.js";
import { PrismaService } from "../../database/prisma.service.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { RunRepository } from "../run/run.repository.js";
import { signCallbackToken } from "./callbacks/hmac-token.js";
import { BENCHMARK_DRIVER } from "./drivers/benchmark-driver.token.js";
import type {
  BenchmarkExecutionContext,
  BenchmarkExecutionDriver,
} from "./drivers/execution-driver.interface.js";

export const ACTIVE_STATES = ["pending", "submitted", "running"] as const;
export const TERMINAL_STATES = ["completed", "failed", "canceled"] as const;
const CALLBACK_TTL_SLACK_SECONDS = 15 * 60;

/** Map guidellm profile names to the unified Run.mode enum. */
function mapProfileToMode(
  profile: string,
): "fixed" | "ramp-up" | "throughput" | "sla-target" {
  switch (profile) {
    case "throughput":
    case "generation_heavy":
      return "throughput";
    case "latency":
    case "long_context":
    case "sharegpt":
    default:
      return "fixed";
  }
}

/** Translate a Run row back to the legacy BenchmarkRun DTO shape. */
export function runRowToBenchmark(row: PrismaRun): BenchmarkRunDto {
  const scenario = (row.scenario ?? {}) as Record<string, unknown>;
  const dataset = (scenario.dataset ?? {}) as Record<string, unknown>;
  const params = (row.params ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    userId: row.userId,
    name: row.name ?? "",
    description: row.description,
    profile: (params.profile as BenchmarkRunDto["profile"] | undefined) ?? "custom",
    apiType: scenario.apiType as BenchmarkRunDto["apiType"],
    apiBaseUrl: scenario.apiBaseUrl as string,
    model: scenario.model as string,
    datasetName: (dataset.name as BenchmarkRunDto["datasetName"] | undefined) ?? "random",
    datasetInputTokens: (dataset.inputTokens as number | null | undefined) ?? null,
    datasetOutputTokens: (dataset.outputTokens as number | null | undefined) ?? null,
    datasetSeed: (dataset.seed as number | null | undefined) ?? null,
    requestRate: (scenario.requestRate as number | undefined) ?? 0,
    totalRequests: (scenario.totalRequests as number | undefined) ?? 1000,
    state: row.status as BenchmarkRunDto["state"],
    stateMessage: row.statusMessage,
    progress: row.progress,
    jobName: row.driverHandle,
    metricsSummary: row.summaryMetrics as BenchmarkRunDto["metricsSummary"],
    rawMetrics: row.rawOutput ?? null,
    logs: row.logs,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

/** Translate a Run row to the lightweight BenchmarkRunSummary shape. */
export function runRowToBenchmarkSummary(row: PrismaRun): BenchmarkRunSummary {
  const scenario = (row.scenario ?? {}) as Record<string, unknown>;
  const dataset = (scenario.dataset ?? {}) as Record<string, unknown>;
  const params = (row.params ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    userId: row.userId,
    name: row.name ?? "",
    profile: (params.profile as BenchmarkRunSummary["profile"] | undefined) ?? "custom",
    apiType: scenario.apiType as BenchmarkRunSummary["apiType"],
    apiBaseUrl: scenario.apiBaseUrl as string,
    model: scenario.model as string,
    datasetName: (dataset.name as BenchmarkRunSummary["datasetName"] | undefined) ?? "random",
    state: row.status as BenchmarkState,
    progress: row.progress,
    metricsSummary: row.summaryMetrics as BenchmarkRunSummary["metricsSummary"],
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class BenchmarkService {
  protected readonly log = new Logger(BenchmarkService.name);
  private readonly key: Buffer;
  private readonly callbackSecret: Buffer;
  private readonly callbackUrl: string;
  private readonly defaultMaxDuration: number;
  private readonly validateBackend: boolean;
  private readonly processor: string | undefined;
  private readonly maxConcurrency: number;
  private readonly driverKind: "local" | "k8s";

  constructor(
    private readonly prisma: PrismaService,
    @Inject(BENCHMARK_DRIVER) private readonly driver: BenchmarkExecutionDriver,
    config: ConfigService<Env, true>,
    private readonly runs: RunRepository,
  ) {
    this.key = decodeKey(config.get("BENCHMARK_API_KEY_ENCRYPTION_KEY", { infer: true }) as string);
    this.callbackSecret = Buffer.from(
      config.get("BENCHMARK_CALLBACK_SECRET", { infer: true }) as string,
      "utf8",
    );
    this.callbackUrl = config.get("BENCHMARK_CALLBACK_URL", { infer: true }) as string;
    this.defaultMaxDuration = config.get("BENCHMARK_DEFAULT_MAX_DURATION_SECONDS", {
      infer: true,
    }) as number;
    // Default true (vanilla guidellm). Set BENCHMARK_VALIDATE_BACKEND=false in
    // the API env to skip the GET /v1/models probe — required when the target
    // is an OpenAI-compatible gateway that only exposes /v1/chat/completions.
    this.validateBackend = config.get("BENCHMARK_VALIDATE_BACKEND", { infer: true }) as boolean;
    // Optional HF tokenizer id passed to guidellm for synthetic prompt token
    // counting. Required when the target gateway exposes a local model name
    // (e.g. "gen-studio_…") that doesn't resolve on HuggingFace.
    this.processor =
      (config.get("BENCHMARK_PROCESSOR", { infer: true }) as string | undefined) || undefined;
    // Max concurrent in-flight requests for throughput mode. guidellm 0.5.x
    // ThroughputProfile requires this. Tune up for high-RPS targets, down
    // for resource-constrained ones. Constant/poisson rate modes ignore it.
    this.maxConcurrency = config.get("BENCHMARK_DEFAULT_MAX_CONCURRENCY", {
      infer: true,
    }) as number;
    const benchmarkDriver = (
      config.get("BENCHMARK_DRIVER", { infer: true }) ?? "subprocess"
    ) as string;
    this.driverKind = benchmarkDriver === "k8s" ? "k8s" : "local";
  }

  async create(req: CreateBenchmarkRequest, user: JwtPayload): Promise<BenchmarkRunDto> {
    if (req.datasetName === "sharegpt") {
      throw new BadRequestException({
        code: ErrorCodes.BENCHMARK_DATASET_UNSUPPORTED,
        message: "ShareGPT dataset is not supported until a follow-up phase",
      });
    }

    // Check for duplicate active benchmark names for this user.
    const dupes = await this.prisma.run.count({
      where: {
        userId: user.sub,
        name: req.name,
        kind: "benchmark",
        status: { in: [...ACTIVE_STATES] },
      },
    });
    if (dupes > 0) {
      throw new ConflictException({
        code: ErrorCodes.BENCHMARK_NAME_IN_USE,
        message: `An active benchmark named '${req.name}' already exists`,
      });
    }

    const cipher = encrypt(req.apiKey, this.key);
    const created = await this.runs.create({
      userId: user.sub,
      kind: "benchmark",
      tool: "guidellm",
      driverKind: this.driverKind,
      mode: mapProfileToMode(req.profile),
      name: req.name,
      description: req.description ?? null,
      apiKeyCipher: cipher,
      scenario: {
        apiType: req.apiType,
        apiBaseUrl: req.apiBaseUrl,
        model: req.model,
        dataset: {
          name: req.datasetName,
          inputTokens: req.datasetInputTokens ?? null,
          outputTokens: req.datasetOutputTokens ?? null,
          seed: req.datasetSeed ?? null,
        },
        requestRate: req.requestRate,
        totalRequests: req.totalRequests,
      },
      params: {
        profile: req.profile,
      },
    });

    return await this.start(created.id);
  }

  async start(runId: string): Promise<BenchmarkRunDto> {
    const row = await this.runs.findById(runId);
    if (!row) throw new Error(`BenchmarkService.start: row ${runId} not found`);

    const apiKey = decrypt(row.apiKeyCipher!, this.key);
    const callbackToken = signCallbackToken(
      row.id,
      this.callbackSecret,
      this.defaultMaxDuration + CALLBACK_TTL_SLACK_SECONDS,
    );

    const scenario = (row.scenario ?? {}) as Record<string, unknown>;
    const dataset = (scenario.dataset ?? {}) as Record<string, unknown>;
    const params = (row.params ?? {}) as Record<string, unknown>;

    const ctx: BenchmarkExecutionContext = {
      benchmarkId: row.id,
      profile: (params.profile as BenchmarkExecutionContext["profile"]),
      apiType: (scenario.apiType as BenchmarkExecutionContext["apiType"]),
      apiBaseUrl: scenario.apiBaseUrl as string,
      apiKey,
      model: scenario.model as string,
      datasetName: (dataset.name as BenchmarkExecutionContext["datasetName"]),
      datasetInputTokens: (dataset.inputTokens as number | undefined) ?? undefined,
      datasetOutputTokens: (dataset.outputTokens as number | undefined) ?? undefined,
      datasetSeed: (dataset.seed as number | undefined) ?? undefined,
      requestRate: scenario.requestRate as number,
      totalRequests: scenario.totalRequests as number,
      maxDurationSeconds: this.defaultMaxDuration,
      callbackUrl: this.callbackUrl,
      callbackToken,
      validateBackend: this.validateBackend,
      processor: this.processor,
      maxConcurrency: this.maxConcurrency,
    };

    let handle: string;
    try {
      const result = await this.driver.start(ctx);
      handle = result.handle;
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      await this.runs.update(row.id, {
        status: "failed",
        statusMessage: msg.slice(0, 2048),
        completedAt: new Date(),
      });
      throw e;
    }

    const updated = await this.runs.update(row.id, {
      status: "submitted",
      driverHandle: handle,
      startedAt: new Date(),
    });
    return runRowToBenchmark(updated);
  }

  async list(query: ListBenchmarksQuery, user: JwtPayload): Promise<ListBenchmarksResponse> {
    const limit = query.limit;
    const userScope = user.roles.includes("admin") ? {} : { userId: user.sub };

    // Build raw prisma where for profile filter (stored in params JSON).
    // RunRepository.list doesn't support profile filter — we do it via prisma.run.findMany.
    const where: Prisma.RunWhereInput = {
      kind: "benchmark",
      ...userScope,
    };
    if (query.state) where.status = query.state;
    if (query.profile) {
      where.params = { path: ["profile"], equals: query.profile };
    }
    if (query.search) where.name = { contains: query.search, mode: "insensitive" };

    const rows = await this.prisma.run.findMany({
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    const pageRows = rows.slice(0, limit);
    const items = pageRows.map(runRowToBenchmarkSummary);
    const nextCursor = rows.length > limit ? pageRows[pageRows.length - 1].id : null;
    return { items, nextCursor };
  }

  async detail(id: string, user: JwtPayload): Promise<BenchmarkRunDto> {
    const userScope = user.roles.includes("admin") ? {} : { userId: user.sub };
    const row = await this.prisma.run.findFirst({
      where: { id, kind: "benchmark", ...userScope },
    });
    if (!row) throw new NotFoundException({ code: "NOT_FOUND", message: "benchmark not found" });
    return runRowToBenchmark(row);
  }

  async cancel(id: string, user: JwtPayload): Promise<BenchmarkRunDto> {
    const userScope = user.roles.includes("admin") ? {} : { userId: user.sub };
    const row = await this.prisma.run.findFirst({
      where: { id, kind: "benchmark", ...userScope },
    });
    if (!row) throw new NotFoundException({ code: "NOT_FOUND", message: "benchmark not found" });

    if ((TERMINAL_STATES as readonly string[]).includes(row.status)) {
      throw new BadRequestException({
        code: ErrorCodes.BENCHMARK_ALREADY_TERMINAL,
        message: `Cannot cancel a benchmark in state '${row.status}'`,
      });
    }

    if (row.status !== "pending" && row.driverHandle) {
      try {
        await this.driver.cancel(row.driverHandle);
      } catch (e) {
        this.log.warn(
          `driver.cancel threw for ${row.id} (handle ${row.driverHandle}); marking canceled anyway: ${(e as Error).message}`,
        );
      }
    }

    const updated = await this.runs.update(row.id, {
      status: "canceled",
      completedAt: new Date(),
    });
    return runRowToBenchmark(updated);
  }

  async delete(id: string, user: JwtPayload): Promise<void> {
    const userScope = user.roles.includes("admin") ? {} : { userId: user.sub };
    const row = await this.prisma.run.findFirst({
      where: { id, kind: "benchmark", ...userScope },
    });
    if (!row) throw new NotFoundException({ code: "NOT_FOUND", message: "benchmark not found" });
    if (!(TERMINAL_STATES as readonly string[]).includes(row.status)) {
      throw new ConflictException({
        code: ErrorCodes.BENCHMARK_NOT_TERMINAL,
        message: `Cannot delete a benchmark in state '${row.status}'. Cancel it first.`,
      });
    }
    await this.runs.delete(row.id);
  }

  async handleStateCallback(id: string, body: BenchmarkStateCallback): Promise<void> {
    const row = await this.runs.findById(id);
    if (!row) {
      this.log.warn(`state callback for missing run ${id}; ignoring`);
      return;
    }
    const cur = row.status as BenchmarkState;
    const next = body.state;

    // Forward-only: a callback cannot drag a terminal row backwards.
    const isTerminal = (TERMINAL_STATES as readonly string[]).includes(cur);
    if (isTerminal) {
      this.log.warn(
        `state callback ${next} for already-terminal run ${id} (current=${cur}); ignoring`,
      );
      return;
    }

    if (next === "running") {
      if (cur === "running") return; // duplicate ok
      await this.runs.update(id, {
        status: "running",
        progress: body.progress ?? null,
        statusMessage: null,
      });
      return;
    }

    if (next === "completed" || next === "failed") {
      await this.runs.update(id, {
        status: next,
        statusMessage: body.stateMessage?.slice(0, 2048) ?? null,
        progress: body.progress ?? null,
        completedAt: new Date(),
      });
      return;
    }
    // Other inbound values (e.g. "canceled") aren't expected from the runner;
    // ignore them.
  }

  async handleMetricsCallback(id: string, body: BenchmarkMetricsCallback): Promise<void> {
    const row = await this.runs.findById(id);
    if (!row) {
      this.log.warn(`metrics callback for missing run ${id}; ignoring`);
      return;
    }
    await this.runs.update(id, {
      summaryMetrics: body.metricsSummary as Prisma.InputJsonValue,
      rawOutput:
        body.rawMetrics === undefined || body.rawMetrics === null
          ? null
          : (body.rawMetrics as Prisma.InputJsonValue),
      logs: body.logs ?? null,
    });
  }
}

// Legacy adapter functions kept for backward compatibility with tests.
// These were previously the sole DTO serializers; now runRowToBenchmark/
// runRowToBenchmarkSummary are the canonical ones.
export { runRowToBenchmark as toBenchmarkRunDto };
export { runRowToBenchmarkSummary as toBenchmarkRunSummary };
