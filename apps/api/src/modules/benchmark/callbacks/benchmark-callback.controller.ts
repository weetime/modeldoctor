import {
  type BenchmarkMetricsCallback,
  BenchmarkMetricsCallbackSchema,
  type BenchmarkStateCallback,
  BenchmarkStateCallbackSchema,
} from "@modeldoctor/contracts";
import { Body, Controller, HttpCode, HttpStatus, Param, Post, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Public } from "../../../common/decorators/public.decorator.js";
import { ZodValidationPipe } from "../../../common/pipes/zod-validation.pipe.js";
import { BenchmarkService } from "../benchmark.service.js";
import { HmacCallbackGuard } from "./hmac-callback.guard.js";

@ApiTags("benchmark-callback")
@Controller("internal/benchmarks")
export class BenchmarkCallbackController {
  constructor(private readonly svc: BenchmarkService) {}

  @ApiOperation({ summary: "Runner-pod state callback" })
  @Public()
  @UseGuards(HmacCallbackGuard)
  @HttpCode(HttpStatus.OK)
  @Post(":id/state")
  async state(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(BenchmarkStateCallbackSchema))
    body: BenchmarkStateCallback,
  ): Promise<void> {
    await this.svc.handleStateCallback(id, body);
  }

  @ApiOperation({ summary: "Runner-pod metrics callback (final)" })
  @Public()
  @UseGuards(HmacCallbackGuard)
  @HttpCode(HttpStatus.OK)
  @Post(":id/metrics")
  async metrics(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(BenchmarkMetricsCallbackSchema))
    body: BenchmarkMetricsCallback,
  ): Promise<void> {
    await this.svc.handleMetricsCallback(id, body);
  }
}
