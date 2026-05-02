import {
  type BenchmarkRun,
  type BenchmarkRunSummary,
  type CreateBenchmarkRequest,
  CreateBenchmarkRequestSchema,
  type ListBenchmarksQuery,
  ListBenchmarksQuerySchema,
  type ListBenchmarksResponse,
} from "@modeldoctor/contracts";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { RunService } from "../run/run.service.js";
import {
  legacyCreateToCreateRun,
  runToBenchmarkRun,
  runToBenchmarkRunSummary,
} from "./benchmark-facade.mappers.js";

/**
 * Phase 3 facade (#53). The /api/benchmarks/* route surface is unchanged
 * so the FE keeps working until #54 switches it to /api/runs and deletes
 * this file. Internally everything routes through RunService.
 */
@Controller("benchmarks")
@UseGuards(JwtAuthGuard)
export class BenchmarkController {
  constructor(private readonly runs: RunService) {}

  @Post()
  async create(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(CreateBenchmarkRequestSchema)) body: CreateBenchmarkRequest,
  ): Promise<BenchmarkRun> {
    const run = await this.runs.create(user.sub, legacyCreateToCreateRun(body));
    return runToBenchmarkRun(run);
  }

  @Get()
  async list(
    @CurrentUser() user: JwtPayload,
    @Query(new ZodValidationPipe(ListBenchmarksQuerySchema)) q: ListBenchmarksQuery,
  ): Promise<ListBenchmarksResponse> {
    const r = await this.runs.list(
      {
        limit: q.limit,
        cursor: q.cursor,
        kind: "benchmark",
        tool: "guidellm",
        ...(q.state ? { status: q.state } : {}),
        ...(q.search ? { search: q.search } : {}),
      },
      user.sub,
    );
    let items: BenchmarkRunSummary[] = r.items.map(runToBenchmarkRunSummary);
    // Profile is stored in params JSON; RunService.list doesn't filter on it.
    // Apply post-filter in-memory to preserve legacy semantics. Note: this
    // can produce a short page when filtering reduces a full page below
    // `limit`, but #54 retires this code path.
    if (q.profile) items = items.filter((s) => s.profile === q.profile);
    return { items, nextCursor: r.nextCursor };
  }

  @Get(":id")
  async detail(@CurrentUser() user: JwtPayload, @Param("id") id: string): Promise<BenchmarkRun> {
    const run = await this.runs.findByIdOrFail(id, user.sub);
    return runToBenchmarkRun(run);
  }

  @Post(":id/cancel")
  async cancel(@CurrentUser() user: JwtPayload, @Param("id") id: string): Promise<BenchmarkRun> {
    const run = await this.runs.cancel(id, user.sub);
    return runToBenchmarkRun(run);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@CurrentUser() user: JwtPayload, @Param("id") id: string): Promise<void> {
    await this.runs.delete(id, user.sub);
  }
}
