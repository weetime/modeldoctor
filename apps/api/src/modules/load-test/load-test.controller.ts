import {
  type ListLoadTestRunsQuery,
  ListLoadTestRunsQuerySchema,
  type ListLoadTestRunsResponse,
  ListLoadTestRunsResponseSchema,
  type LoadTestRequest,
  LoadTestRequestSchema,
  type LoadTestResponse,
  LoadTestResponseSchema,
} from "@modeldoctor/contracts";
import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from "@nestjs/common";
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { LoadTestService } from "./load-test.service.js";

class LoadTestRequestDto extends createZodDto(LoadTestRequestSchema) {}
class LoadTestResponseDto extends createZodDto(LoadTestResponseSchema) {}
class ListLoadTestRunsResponseDto extends createZodDto(ListLoadTestRunsResponseSchema) {}

@ApiTags("load-test")
@Controller()
export class LoadTestController {
  constructor(private readonly svc: LoadTestService) {}

  @ApiOperation({ summary: "Run a vegeta load test" })
  @ApiBody({ type: LoadTestRequestDto })
  @ApiOkResponse({ type: LoadTestResponseDto })
  @Post("load-test")
  @HttpCode(HttpStatus.OK)
  run(
    @Body(new ZodValidationPipe(LoadTestRequestSchema)) body: LoadTestRequest,
    @CurrentUser() user: JwtPayload,
  ): Promise<LoadTestResponse> {
    return this.svc.run(body, user);
  }

  @ApiOperation({ summary: "List load-test runs (cursor-paginated, newest first)" })
  @ApiOkResponse({ type: ListLoadTestRunsResponseDto })
  @Get("load-test/runs")
  listRuns(
    @Query(new ZodValidationPipe(ListLoadTestRunsQuerySchema)) query: ListLoadTestRunsQuery,
    @CurrentUser() user: JwtPayload,
  ): Promise<ListLoadTestRunsResponse> {
    return this.svc.listRuns(query, user);
  }
}
