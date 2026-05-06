import {
  type Benchmark,
  type BenchmarkChartsResponse,
  type CreateBenchmarkRequest,
  type EndpointReportRange,
  type EndpointReportsResponse,
  type ListBenchmarksQuery,
  type ListBenchmarksResponse,
  createBenchmarkRequestSchema,
  endpointReportRangeSchema,
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
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { BenchmarkChartsService } from "./benchmark-charts.service.js";
import { BenchmarkService } from "./benchmark.service.js";

@Controller("benchmarks")
@UseGuards(JwtAuthGuard)
export class BenchmarkController {
  constructor(
    private readonly service: BenchmarkService,
    private readonly charts: BenchmarkChartsService,
  ) {}

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

  @Get("reports/by-connection")
  reportsByConnection(
    @CurrentUser() user: JwtPayload,
    @Query("range", new ZodValidationPipe(endpointReportRangeSchema.optional()))
    range: EndpointReportRange | undefined,
  ): Promise<EndpointReportsResponse> {
    return this.service.getByConnectionReports(user.sub, range ?? "30d");
  }

  @Get(":id")
  detail(@CurrentUser() user: JwtPayload, @Param("id") id: string): Promise<Benchmark> {
    return this.service.findByIdOrFail(id, user.roles.includes("admin") ? undefined : user.sub);
  }

  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(createBenchmarkRequestSchema)) body: CreateBenchmarkRequest,
  ): Promise<Benchmark> {
    return this.service.create(user.sub, body);
  }

  @Post(":id/cancel")
  cancel(@CurrentUser() user: JwtPayload, @Param("id") id: string): Promise<Benchmark> {
    return this.service.cancel(id, user.roles.includes("admin") ? undefined : user.sub);
  }

  @Delete(":id")
  @HttpCode(204)
  async delete(@CurrentUser() user: JwtPayload, @Param("id") id: string): Promise<void> {
    await this.service.delete(id, user.roles.includes("admin") ? undefined : user.sub);
  }

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
