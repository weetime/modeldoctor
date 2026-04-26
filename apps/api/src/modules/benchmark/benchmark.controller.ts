import {
  type BenchmarkRun,
  BenchmarkRunSchema,
  type CreateBenchmarkRequest,
  CreateBenchmarkRequestSchema,
  type ListBenchmarksQuery,
  ListBenchmarksQuerySchema,
  type ListBenchmarksResponse,
  ListBenchmarksResponseSchema,
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
} from "@nestjs/common";
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { BenchmarkService } from "./benchmark.service.js";

class CreateBenchmarkRequestDto extends createZodDto(CreateBenchmarkRequestSchema) {}
class BenchmarkRunDto extends createZodDto(BenchmarkRunSchema) {}
class ListBenchmarksResponseDto extends createZodDto(ListBenchmarksResponseSchema) {}

@ApiTags("benchmark")
@Controller("benchmarks")
export class BenchmarkController {
  constructor(private readonly svc: BenchmarkService) {}

  @ApiOperation({ summary: "Create a benchmark run" })
  @ApiBody({ type: CreateBenchmarkRequestDto })
  @ApiOkResponse({ type: BenchmarkRunDto })
  @Post()
  create(
    @Body(new ZodValidationPipe(CreateBenchmarkRequestSchema))
    body: CreateBenchmarkRequest,
    @CurrentUser() user: JwtPayload,
  ): Promise<BenchmarkRun> {
    return this.svc.create(body, user);
  }

  @ApiOperation({ summary: "List benchmark runs (cursor-paginated, newest first)" })
  @ApiOkResponse({ type: ListBenchmarksResponseDto })
  @Get()
  list(
    @Query(new ZodValidationPipe(ListBenchmarksQuerySchema))
    query: ListBenchmarksQuery,
    @CurrentUser() user: JwtPayload,
  ): Promise<ListBenchmarksResponse> {
    return this.svc.list(query, user);
  }

  @ApiOperation({ summary: "Fetch a benchmark run" })
  @ApiOkResponse({ type: BenchmarkRunDto })
  @Get(":id")
  detail(@Param("id") id: string, @CurrentUser() user: JwtPayload): Promise<BenchmarkRun> {
    return this.svc.detail(id, user);
  }

  @ApiOperation({ summary: "Cancel an in-flight benchmark run" })
  @ApiOkResponse({ type: BenchmarkRunDto })
  @Post(":id/cancel")
  cancel(@Param("id") id: string, @CurrentUser() user: JwtPayload): Promise<BenchmarkRun> {
    return this.svc.cancel(id, user);
  }

  @ApiOperation({ summary: "Delete a terminal benchmark run" })
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Param("id") id: string, @CurrentUser() user: JwtPayload): Promise<void> {
    return this.svc.delete(id, user);
  }
}
