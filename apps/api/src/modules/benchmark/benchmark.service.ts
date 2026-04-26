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
import { Prisma } from "@prisma/client";
import { decodeKey, decrypt, encrypt } from "../../common/crypto/aes-gcm.js";
import type { Env } from "../../config/env.schema.js";
import { PrismaService } from "../../database/prisma.service.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { signCallbackToken } from "./callbacks/hmac-token.js";
import { BENCHMARK_DRIVER } from "./drivers/benchmark-driver.token.js";
import type {
  BenchmarkExecutionContext,
  BenchmarkExecutionDriver,
} from "./drivers/execution-driver.interface.js";

export const ACTIVE_STATES = ["pending", "submitted", "running"] as const;
export const TERMINAL_STATES = ["completed", "failed", "canceled"] as const;
const CALLBACK_TTL_SLACK_SECONDS = 15 * 60;

type BenchmarkRow = Awaited<ReturnType<PrismaService["benchmarkRun"]["findUnique"]>>;

@Injectable()
export class BenchmarkService {
  protected readonly log = new Logger(BenchmarkService.name);
  private readonly key: Buffer;
  private readonly callbackSecret: Buffer;
  private readonly callbackUrl: string;
  private readonly defaultMaxDuration: number;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(BENCHMARK_DRIVER) private readonly driver: BenchmarkExecutionDriver,
    config: ConfigService<Env, true>,
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
  }

  async create(req: CreateBenchmarkRequest, user: JwtPayload): Promise<BenchmarkRunDto> {
    if (req.datasetName === "sharegpt") {
      throw new BadRequestException({
        code: ErrorCodes.BENCHMARK_DATASET_UNSUPPORTED,
        message: "ShareGPT dataset is not supported until a follow-up phase",
      });
    }

    const dupes = await this.prisma.benchmarkRun.count({
      where: {
        userId: user.sub,
        name: req.name,
        state: { in: [...ACTIVE_STATES] },
      },
    });
    if (dupes > 0) {
      throw new ConflictException({
        code: ErrorCodes.BENCHMARK_NAME_IN_USE,
        message: `An active benchmark named '${req.name}' already exists`,
      });
    }

    const cipher = encrypt(req.apiKey, this.key);
    const created = await this.prisma.benchmarkRun.create({
      data: {
        userId: user.sub,
        name: req.name,
        description: req.description ?? null,
        profile: req.profile,
        apiType: req.apiType,
        apiUrl: req.apiUrl,
        apiKeyCipher: cipher,
        model: req.model,
        datasetName: req.datasetName,
        datasetInputTokens: req.datasetInputTokens ?? null,
        datasetOutputTokens: req.datasetOutputTokens ?? null,
        datasetSeed: req.datasetSeed ?? null,
        requestRate: req.requestRate,
        totalRequests: req.totalRequests,
        state: "pending",
      },
    });

    return await this.start(created.id);
  }

  async start(runId: string): Promise<BenchmarkRunDto> {
    const row = await this.prisma.benchmarkRun.findUnique({ where: { id: runId } });
    if (!row) throw new Error(`BenchmarkService.start: row ${runId} not found`);

    const apiKey = decrypt(row.apiKeyCipher, this.key);
    const callbackToken = signCallbackToken(
      row.id,
      this.callbackSecret,
      this.defaultMaxDuration + CALLBACK_TTL_SLACK_SECONDS,
    );

    const ctx: BenchmarkExecutionContext = {
      benchmarkId: row.id,
      profile: row.profile as BenchmarkExecutionContext["profile"],
      apiType: row.apiType as BenchmarkExecutionContext["apiType"],
      apiUrl: row.apiUrl,
      apiKey,
      model: row.model,
      datasetName: row.datasetName as BenchmarkExecutionContext["datasetName"],
      datasetInputTokens: row.datasetInputTokens ?? undefined,
      datasetOutputTokens: row.datasetOutputTokens ?? undefined,
      datasetSeed: row.datasetSeed ?? undefined,
      requestRate: row.requestRate,
      totalRequests: row.totalRequests,
      maxDurationSeconds: this.defaultMaxDuration,
      callbackUrl: this.callbackUrl,
      callbackToken,
    };

    let handle: string;
    try {
      const result = await this.driver.start(ctx);
      handle = result.handle;
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      await this.prisma.benchmarkRun.update({
        where: { id: row.id },
        data: {
          state: "failed",
          stateMessage: msg.slice(0, 2048),
          completedAt: new Date(),
        },
      });
      throw e;
    }

    const updated = await this.prisma.benchmarkRun.update({
      where: { id: row.id },
      data: {
        state: "submitted",
        jobName: handle,
        startedAt: new Date(),
      },
    });
    return toBenchmarkRunDto(updated);
  }

  async list(query: ListBenchmarksQuery, user: JwtPayload): Promise<ListBenchmarksResponse> {
    const limit = query.limit;
    const userScope = user.roles.includes("admin") ? {} : { userId: user.sub };
    const where: Record<string, unknown> = { ...userScope };
    if (query.state) where.state = query.state;
    if (query.profile) where.profile = query.profile;
    if (query.search) where.name = { contains: query.search, mode: "insensitive" };

    const rows = await this.prisma.benchmarkRun.findMany({
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    const pageRows = rows.slice(0, limit);
    const items = pageRows.map(toBenchmarkRunSummary);
    const nextCursor = rows.length > limit ? pageRows[pageRows.length - 1].id : null;
    return { items, nextCursor };
  }

  async detail(id: string, user: JwtPayload): Promise<BenchmarkRunDto> {
    const userScope = user.roles.includes("admin") ? {} : { userId: user.sub };
    const row = await this.prisma.benchmarkRun.findFirst({ where: { id, ...userScope } });
    if (!row) throw new NotFoundException({ code: "NOT_FOUND", message: "benchmark not found" });
    return toBenchmarkRunDto(row);
  }

  async cancel(id: string, user: JwtPayload): Promise<BenchmarkRunDto> {
    const userScope = user.roles.includes("admin") ? {} : { userId: user.sub };
    const row = await this.prisma.benchmarkRun.findFirst({ where: { id, ...userScope } });
    if (!row) throw new NotFoundException({ code: "NOT_FOUND", message: "benchmark not found" });

    if ((TERMINAL_STATES as readonly string[]).includes(row.state)) {
      throw new BadRequestException({
        code: ErrorCodes.BENCHMARK_ALREADY_TERMINAL,
        message: `Cannot cancel a benchmark in state '${row.state}'`,
      });
    }

    if (row.state !== "pending" && row.jobName) {
      try {
        await this.driver.cancel(row.jobName);
      } catch (e) {
        this.log.warn(
          `driver.cancel threw for ${row.id} (handle ${row.jobName}); marking canceled anyway: ${(e as Error).message}`,
        );
      }
    }

    const updated = await this.prisma.benchmarkRun.update({
      where: { id: row.id },
      data: { state: "canceled", completedAt: new Date() },
    });
    return toBenchmarkRunDto(updated);
  }

  async delete(id: string, user: JwtPayload): Promise<void> {
    const userScope = user.roles.includes("admin") ? {} : { userId: user.sub };
    const row = await this.prisma.benchmarkRun.findFirst({ where: { id, ...userScope } });
    if (!row) throw new NotFoundException({ code: "NOT_FOUND", message: "benchmark not found" });
    if (!(TERMINAL_STATES as readonly string[]).includes(row.state)) {
      throw new ConflictException({
        code: ErrorCodes.BENCHMARK_NOT_TERMINAL,
        message: `Cannot delete a benchmark in state '${row.state}'. Cancel it first.`,
      });
    }
    await this.prisma.benchmarkRun.delete({ where: { id: row.id } });
  }

  async handleStateCallback(id: string, body: BenchmarkStateCallback): Promise<void> {
    const row = await this.prisma.benchmarkRun.findUnique({ where: { id } });
    if (!row) {
      this.log.warn(`state callback for missing run ${id}; ignoring`);
      return;
    }
    const cur = row.state as BenchmarkState;
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
      await this.prisma.benchmarkRun.update({
        where: { id },
        data: {
          state: "running",
          progress: body.progress ?? null,
          stateMessage: null,
        },
      });
      return;
    }

    if (next === "completed" || next === "failed") {
      await this.prisma.benchmarkRun.update({
        where: { id },
        data: {
          state: next,
          stateMessage: body.stateMessage?.slice(0, 2048) ?? null,
          progress: body.progress ?? null,
          completedAt: new Date(),
        },
      });
      return;
    }
    // Other inbound values (e.g. "canceled") aren't expected from the runner;
    // ignore them.
  }

  async handleMetricsCallback(id: string, body: BenchmarkMetricsCallback): Promise<void> {
    const row = await this.prisma.benchmarkRun.findUnique({ where: { id } });
    if (!row) {
      this.log.warn(`metrics callback for missing run ${id}; ignoring`);
      return;
    }
    await this.prisma.benchmarkRun.update({
      where: { id },
      data: {
        metricsSummary: body.metricsSummary as Prisma.InputJsonValue,
        rawMetrics:
          body.rawMetrics === undefined || body.rawMetrics === null
            ? Prisma.DbNull
            : (body.rawMetrics as Prisma.InputJsonValue),
        logs: body.logs ?? null,
      },
    });
  }
}

export function toBenchmarkRunDto(row: NonNullable<BenchmarkRow>): BenchmarkRunDto {
  // Strip apiKeyCipher; cast JSON columns; serialize dates.
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    description: row.description,
    profile: row.profile as BenchmarkRunDto["profile"],
    apiType: row.apiType as BenchmarkRunDto["apiType"],
    apiUrl: row.apiUrl,
    model: row.model,
    datasetName: row.datasetName as BenchmarkRunDto["datasetName"],
    datasetInputTokens: row.datasetInputTokens,
    datasetOutputTokens: row.datasetOutputTokens,
    datasetSeed: row.datasetSeed,
    requestRate: row.requestRate,
    totalRequests: row.totalRequests,
    state: row.state as BenchmarkState,
    stateMessage: row.stateMessage,
    progress: row.progress,
    jobName: row.jobName,
    metricsSummary: row.metricsSummary as BenchmarkRunDto["metricsSummary"],
    rawMetrics: row.rawMetrics ?? null,
    logs: row.logs,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

export function toBenchmarkRunSummary(row: NonNullable<BenchmarkRow>): BenchmarkRunSummary {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    profile: row.profile as BenchmarkRunSummary["profile"],
    apiType: row.apiType as BenchmarkRunSummary["apiType"],
    apiUrl: row.apiUrl,
    model: row.model,
    datasetName: row.datasetName as BenchmarkRunSummary["datasetName"],
    state: row.state as BenchmarkState,
    progress: row.progress,
    metricsSummary: row.metricsSummary as BenchmarkRunSummary["metricsSummary"],
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}
