import {
  type ListLoadTestRunsQuery,
  ListLoadTestRunsQuerySchema,
  type ListLoadTestRunsResponse,
  ListLoadTestRunsResponseSchema,
  type LoadTestParsed,
  type LoadTestRequest,
  LoadTestRequestSchema,
  type LoadTestResponse,
  LoadTestResponseSchema,
  type Run,
} from "@modeldoctor/contracts";
import type { VegetaReport } from "@modeldoctor/tool-adapters";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { RunService } from "../run/run.service.js";
import { legacyToCreateRun, runToLoadTestResponse } from "./load-test-facade.mappers.js";

class LoadTestRequestDto extends createZodDto(LoadTestRequestSchema) {}
class LoadTestResponseDto extends createZodDto(LoadTestResponseSchema) {}
class ListLoadTestRunsResponseDto extends createZodDto(ListLoadTestRunsResponseSchema) {}

/**
 * Phase 3 facade (#53). The /api/load-test/* route surface is unchanged
 * so the FE keeps working until #54 switches it to /api/runs and deletes
 * this file. Internally everything routes through RunService.
 *
 * The legacy POST /load-test was synchronous (the FE blocks on it and
 * renders the parsed report from the response body). RunService.create
 * returns 'submitted' immediately, so we poll runs.findById until the
 * run reaches a terminal state to preserve synchronous semantics.
 */
@ApiTags("load-test")
@Controller("load-test")
@UseGuards(JwtAuthGuard)
export class LoadTestController {
  constructor(private readonly runs: RunService) {}

  @ApiOperation({ summary: "Run a vegeta load test (synchronous; polls run to terminal)" })
  @ApiBody({ type: LoadTestRequestDto })
  @ApiOkResponse({ type: LoadTestResponseDto })
  @Post()
  @HttpCode(HttpStatus.OK)
  async run(
    @Body(new ZodValidationPipe(LoadTestRequestSchema)) body: LoadTestRequest,
    @CurrentUser() user: JwtPayload,
  ): Promise<LoadTestResponse> {
    const name = `loadtest-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    const created = await this.runs.create(user.sub, legacyToCreateRun(body, name));
    const final = await waitForTerminal(this.runs, created.id, body.duration + 60);
    return runToLoadTestResponse(final);
  }

  @ApiOperation({ summary: "List load-test runs (cursor-paginated, newest first)" })
  @ApiOkResponse({ type: ListLoadTestRunsResponseDto })
  @Get("runs")
  async list(
    @Query(new ZodValidationPipe(ListLoadTestRunsQuerySchema)) q: ListLoadTestRunsQuery,
    @CurrentUser() user: JwtPayload,
  ): Promise<ListLoadTestRunsResponse> {
    const r = await this.runs.list(
      { limit: q.limit, cursor: q.cursor, kind: "benchmark", tool: "vegeta", scope: "own" },
      // Admins see across all users; regular users see only their own.
      // Restored after Phase 3 facade refactor (PR #74) collapsed both
      // branches to user.sub. Goes away with the facade in #54.
      user.roles.includes("admin") ? undefined : user.sub,
    );
    return {
      items: r.items.map((run) => {
        const scenario = (run.scenario ?? {}) as Record<string, unknown>;
        const params = (run.params ?? {}) as Record<string, unknown>;
        return {
          id: run.id,
          userId: run.userId,
          apiType:
            (params.apiType as ListLoadTestRunsResponse["items"][number]["apiType"]) ?? "chat",
          apiBaseUrl: (scenario.apiBaseUrl as string) ?? "",
          model: (scenario.model as string) ?? "",
          rate: (params.rate as number) ?? 0,
          duration: (params.duration as number) ?? 0,
          // Legacy contract limited status to "completed" | "failed". Project
          // any non-"completed" status (failed/canceled/running/pending/
          // submitted) to "failed" so the wire shape is preserved. #54
          // exposes the full RunStatus enum on /api/runs.
          status: (run.status === "completed" ? "completed" : "failed") as "completed" | "failed",
          summaryJson: unwrapSummary(run.summaryMetrics),
          createdAt: run.createdAt,
          completedAt: run.completedAt,
        };
      }),
      nextCursor: r.nextCursor,
    };
  }
}

/**
 * Poll the run until it reaches a terminal state. RunService.create returns
 * "submitted" immediately; the legacy contract is synchronous, so we block
 * here to preserve it. timeout = body.duration + 60s (matches the legacy
 * vegeta subprocess timeout in load-test.service.ts pre-Task 3.6).
 */
async function waitForTerminal(runs: RunService, id: string, timeoutSec: number): Promise<Run> {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    const r = await runs.findById(id);
    if (r && (r.status === "completed" || r.status === "failed" || r.status === "canceled")) {
      return r;
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  throw new Error(`Run ${id} did not reach terminal state within ${timeoutSec}s`);
}

/**
 * summaryMetrics is the adapter's `{ tool, data }` envelope when a run
 * completes (RunCallbackController.handleFinish writes it that way). The
 * legacy LoadTestRunSummary.summaryJson schema is the inner LoadTestParsed
 * shape, so we project the envelope's data → LoadTestParsed. Returns null
 * when the envelope is missing or malformed.
 *
 * Strict envelope check: only `{ tool: "vegeta", data: VegetaReport }` is
 * recognized. Pre-Task-3.6 rows wrote summaryMetrics directly as a raw
 * LoadTestParsed shape (no envelope) — those rows will show summaryJson:null
 * here until the dev DB is reset (Task 3.7 reset clears them) or #54 retires
 * this endpoint. We accept this trade-off over adding a raw-shape recognizer.
 */
function unwrapSummary(sm: Run["summaryMetrics"]): LoadTestParsed | null {
  if (sm == null || typeof sm !== "object") return null;
  if (!("tool" in sm) || !("data" in sm)) return null;
  const data = (sm as { tool: string; data: unknown }).data as VegetaReport | null | undefined;
  if (!data) return null;
  return {
    requests: data.requests.total,
    success: data.success,
    throughput: data.requests.throughput,
    latencies: {
      mean: `${data.latencies.mean}ms`,
      p50: `${data.latencies.p50}ms`,
      p95: `${data.latencies.p95}ms`,
      p99: `${data.latencies.p99}ms`,
      max: `${data.latencies.max}ms`,
    },
  };
}
