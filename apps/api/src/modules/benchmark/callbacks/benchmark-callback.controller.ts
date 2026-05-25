import { type BenchmarkLogCallback, benchmarkLogCallbackSchema } from "@modeldoctor/contracts";
import { byTool, type ProgressEvent, type ToolName } from "@modeldoctor/tool-adapters";
import { Body, Controller, HttpCode, HttpStatus, Param, Post, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Public } from "../../../common/decorators/public.decorator.js";
import { HmacCallbackGuard } from "../../../common/hmac/hmac-callback.guard.js";
import { ZodValidationPipe } from "../../../common/pipes/zod-validation.pipe.js";
import { BenchmarkRepository } from "../benchmark.repository.js";
import { SseHub } from "../sse/sse-hub.service.js";

@ApiTags("benchmark-callback")
@UseGuards(HmacCallbackGuard)
@Controller("internal/benchmarks/:id")
export class BenchmarkCallbackController {
  constructor(
    private readonly benchmarks: BenchmarkRepository,
    private readonly sse: SseHub,
  ) {}

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
}
