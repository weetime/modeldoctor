import {
  type RunFinishCallback,
  type RunLogCallback,
  type RunStateCallback,
  runFinishCallbackSchema,
  runLogCallbackSchema,
  runStateCallbackSchema,
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
import { RunRepository } from "../run.repository.js";
import { SseHub } from "../sse/sse-hub.service.js";

@ApiTags("run-callback")
@UseGuards(HmacCallbackGuard)
@Controller("internal/runs/:id")
export class RunCallbackController {
  private readonly log = new Logger(RunCallbackController.name);

  constructor(
    private readonly runs: RunRepository,
    private readonly sse: SseHub,
  ) {}

  @Post("state")
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "v2 callback: state transition" })
  async handleState(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(runStateCallbackSchema)) body: RunStateCallback,
  ): Promise<void> {
    const row = await this.runs.findById(id);
    if (!row) {
      this.log.warn(`/state callback for unknown run ${id}; ignoring`);
      return;
    }
    if (body.state === "running" && row.status !== "running") {
      await this.runs.update(id, {
        status: "running",
        startedAt: row.startedAt ?? new Date(),
      });
    }
  }

  @Post("log")
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "v2 callback: streaming log lines" })
  async handleLog(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(runLogCallbackSchema)) body: RunLogCallback,
  ): Promise<void> {
    const row = await this.runs.findById(id);
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
      await this.runs.update(id, { progress: lastProgress });
    }
  }

  @Post("finish")
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "v2 callback: terminal state + final report" })
  async handleFinish(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(runFinishCallbackSchema)) body: RunFinishCallback,
  ): Promise<void> {
    const row = await this.runs.findById(id);
    if (!row) {
      this.log.warn(`/finish callback for unknown run ${id}; ignoring`);
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

    await this.runs.update(id, {
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
