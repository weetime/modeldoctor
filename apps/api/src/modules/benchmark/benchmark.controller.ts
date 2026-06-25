import {
  type Benchmark,
  benchmarkUpdateSchema,
  type BenchmarkChartsResponse,
  type BenchmarkUpdateRequest,
  type BulkDeleteBenchmarksRequest,
  type BulkDeleteBenchmarksResponse,
  bulkDeleteBenchmarksRequestSchema,
  type CreateBenchmarkRequest,
  createBenchmarkRequestSchema,
  type EndpointReportRange,
  type EndpointReportsResponse,
  endpointReportRangeSchema,
  type ListBenchmarksQuery,
  type ListBenchmarksResponse,
  listBenchmarksQuerySchema,
} from "@modeldoctor/contracts";
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  type MessageEvent,
  Param,
  Patch,
  Post,
  Query,
  Sse,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { EMPTY, from, type Observable } from "rxjs";
import { map, switchMap } from "rxjs/operators";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { Public } from "../../common/decorators/public.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { SseJwtAuthGuard } from "../auth/sse-jwt-auth.guard.js";
import { BenchmarkService } from "./benchmark.service.js";
import { BenchmarkChartsService } from "./benchmark-charts.service.js";
import { isInProgressStatus } from "./constants.js";
import { SseHub } from "./sse/sse-hub.service.js";

@ApiTags("benchmarks")
@ApiBearerAuth()
@Controller("benchmarks")
@UseGuards(JwtAuthGuard)
export class BenchmarkController {
  constructor(
    private readonly service: BenchmarkService,
    private readonly charts: BenchmarkChartsService,
    private readonly sse: SseHub,
  ) {}

  @ApiOperation({ summary: "List benchmarks (scope=mine by default; scope=all is admin-only)" })
  @Get()
  async list(
    @CurrentUser() user: JwtPayload,
    @Query(new ZodValidationPipe(listBenchmarksQuerySchema)) query: ListBenchmarksQuery,
  ): Promise<ListBenchmarksResponse> {
    if (query.scope === "all" && !user.roles.includes("admin")) {
      throw new ForbiddenException({
        code: "BENCHMARK_SCOPE_FORBIDDEN",
        message: "admin role required for scope=all",
      });
    }
    return this.service.list(query, query.scope === "all" ? undefined : user.sub);
  }

  @ApiOperation({ summary: "Aggregated benchmark reports grouped by connection over a date range" })
  @Get("reports/by-connection")
  reportsByConnection(
    @CurrentUser() user: JwtPayload,
    @Query("range", new ZodValidationPipe(endpointReportRangeSchema.optional()))
    range: EndpointReportRange | undefined,
  ): Promise<EndpointReportsResponse> {
    return this.service.getByConnectionReports(user.sub, range ?? "30d");
  }

  @ApiOperation({ summary: "Get a benchmark by ID (owner or admin)" })
  @Get(":id")
  detail(@CurrentUser() user: JwtPayload, @Param("id") id: string): Promise<Benchmark> {
    return this.service.findByIdOrFail(id, user.roles.includes("admin") ? undefined : user.sub);
  }

  @ApiOperation({ summary: "Update a benchmark's name / label" })
  @Patch(":id")
  update(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(benchmarkUpdateSchema)) body: BenchmarkUpdateRequest,
  ): Promise<Benchmark> {
    return this.service.update(id, user.roles.includes("admin") ? undefined : user.sub, body);
  }

  @ApiOperation({ summary: "Submit a new benchmark run" })
  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(createBenchmarkRequestSchema)) body: CreateBenchmarkRequest,
  ): Promise<Benchmark> {
    return this.service.create(user.sub, body);
  }

  @ApiOperation({ summary: "Cancel an in-flight benchmark" })
  @Post(":id/cancel")
  cancel(@CurrentUser() user: JwtPayload, @Param("id") id: string): Promise<Benchmark> {
    return this.service.cancel(id, user.roles.includes("admin") ? undefined : user.sub);
  }

  @ApiOperation({ summary: "Delete a benchmark and its artifacts" })
  @Delete(":id")
  @HttpCode(204)
  async delete(@CurrentUser() user: JwtPayload, @Param("id") id: string): Promise<void> {
    await this.service.delete(id, user.roles.includes("admin") ? undefined : user.sub);
  }

  @ApiOperation({ summary: "Delete many benchmarks in one request (owner or admin)" })
  @Post("bulk-delete")
  async bulkDelete(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(bulkDeleteBenchmarksRequestSchema))
    body: BulkDeleteBenchmarksRequest,
  ): Promise<BulkDeleteBenchmarksResponse> {
    const deleted = await this.service.bulkDelete(
      body.ids,
      user.roles.includes("admin") ? undefined : user.sub,
    );
    return { deleted };
  }

  /** Live log stream for an in-flight benchmark.
   *  @Public() bypasses the class-level JwtAuthGuard; SseJwtAuthGuard then
   *  validates the JWT via Authorization header OR `?token=` query param,
   *  which EventSource requires since it cannot set custom headers. */
  @ApiOperation({
    summary: "Server-Sent Events stream for a running benchmark (token via Bearer or ?token=)",
  })
  @Public()
  @UseGuards(SseJwtAuthGuard)
  @Sse(":id/events")
  events(@CurrentUser() user: JwtPayload, @Param("id") id: string): Observable<MessageEvent> {
    const isAdmin = user.roles.includes("admin");
    return from(this.service.findByIdOrFail(id, isAdmin ? undefined : user.sub)).pipe(
      switchMap((bench) => (isInProgressStatus(bench.status) ? this.sse.subscribe(id) : EMPTY)),
      map((evt) => ({ data: evt }) as MessageEvent),
    );
  }

  @ApiOperation({ summary: "Extracted chart-ready data series from a benchmark's raw output" })
  @Get(":id/charts")
  @Header("Cache-Control", "private, max-age=86400")
  async getCharts(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
  ): Promise<BenchmarkChartsResponse> {
    // findByIdOrFail enforces ownership + throws 404 on missing.
    const benchmark = await this.service.findByIdOrFail(
      id,
      user.roles.includes("admin") ? undefined : user.sub,
    );
    return this.charts.extract({
      id: benchmark.id,
      tool: benchmark.tool,
      status: benchmark.status,
      rawOutput: benchmark.rawOutput,
    });
  }
}
