import {
  type BenchmarkFinishCallback,
  type BenchmarkLogCallback,
  type BenchmarkStateCallback,
  benchmarkFinishCallbackSchema,
  benchmarkLogCallbackSchema,
  benchmarkStateCallbackSchema,
} from "@modeldoctor/contracts";
import { type ProgressEvent, type ToolName, byTool } from "@modeldoctor/tool-adapters";
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Prisma } from "@prisma/client";
import { Public } from "../../../common/decorators/public.decorator.js";
import { HmacCallbackGuard } from "../../../common/hmac/hmac-callback.guard.js";
import { ZodValidationPipe } from "../../../common/pipes/zod-validation.pipe.js";
import { BenchmarkRepository } from "../benchmark.repository.js";
import { SseHub } from "../sse/sse-hub.service.js";

@ApiTags("benchmark-callback")
@UseGuards(HmacCallbackGuard)
@Controller("internal/benchmarks/:id")
export class BenchmarkCallbackController {
  private readonly log = new Logger(BenchmarkCallbackController.name);

  constructor(
    private readonly benchmarks: BenchmarkRepository,
    private readonly sse: SseHub,
  ) {}

  @Post("state")
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "v2 callback: state transition" })
  async handleState(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(benchmarkStateCallbackSchema)) body: BenchmarkStateCallback,
  ): Promise<void> {
    const row = await this.benchmarks.findById(id);
    if (!row) {
      this.log.warn(`/state callback for unknown benchmark ${id}; ignoring`);
      return;
    }
    // Assumption: the runner emits a single, idempotent toolVersion value
    // per benchmark, captured once during runner-startup version detection.
    // The read-modify-write below (findById → compare in memory → update)
    // is therefore not atomic — two concurrent /state callbacks landing in
    // the same millisecond could both decide an update is needed — but
    // since the runner serializes the version-detection step, no real
    // contention is expected. If a future runner change makes /state
    // emission concurrent, swap this for a conditional UPDATE in SQL.
    if (body.state === "running" && row.status !== "running") {
      await this.benchmarks.update(id, {
        status: "running",
        startedAt: row.startedAt ?? new Date(),
        ...(body.toolVersion ? { toolVersion: body.toolVersion } : {}),
      });
    } else if (body.toolVersion && row.toolVersion !== body.toolVersion) {
      // record toolVersion even if we already transitioned to running
      await this.benchmarks.update(id, { toolVersion: body.toolVersion });
    }
  }

  @Post("log")
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "v2 callback: streaming log lines" })
  async handleLog(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(benchmarkLogCallbackSchema)) body: BenchmarkLogCallback,
  ): Promise<void> {
    const row = await this.benchmarks.findById(id);
    if (!row) return;
    const adapter = byTool(row.tool as ToolName);
    let lastProgress: number | null = null;
    for (const line of body.lines) {
      let evt: ProgressEvent | null;
      try {
        evt = adapter.parseProgress(line);
      } catch {
        evt = { kind: "log", level: "warn", line };
      }
      if (!evt) continue;
      this.sse.publish(id, evt);
      if (evt.kind === "progress") lastProgress = evt.pct;
    }
    if (lastProgress !== null) {
      await this.benchmarks.update(id, { progress: lastProgress });
    }
  }

  @Post("finish")
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "v2 callback: terminal state + final report" })
  async handleFinish(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(benchmarkFinishCallbackSchema)) body: BenchmarkFinishCallback,
  ): Promise<void> {
    const row = await this.benchmarks.findById(id);
    if (!row) {
      this.log.warn(`/finish callback for unknown benchmark ${id}; ignoring`);
      return;
    }
    const adapter = byTool(row.tool as ToolName);
    let finalState: "completed" | "failed" = body.state;
    let message = body.message;
    let summary: unknown = null;

    try {
      const fileBuffers: Record<string, Buffer> = Object.fromEntries(
        Object.entries(body.files).map(([k, v]) => [k, Buffer.from(v, "base64")]),
      );
      summary = adapter.parseFinalReport(body.stdout, fileBuffers);
    } catch (e) {
      finalState = "failed";
      message = `report parse: ${(e as Error).message}`.slice(0, 2048);
      summary = null;
    }

    await this.benchmarks.update(id, {
      status: finalState,
      completedAt: new Date(),
      statusMessage: message ?? null,
      summaryMetrics: (summary ?? null) as Prisma.InputJsonValue,
      rawOutput: {
        stdout: body.stdout,
        stderr: body.stderr,
        files: body.files,
      } as Prisma.InputJsonValue,
    });
    this.sse.close(id);
  }
}
