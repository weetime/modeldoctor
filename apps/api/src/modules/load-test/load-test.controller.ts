import {
  type LoadTestRequest,
  LoadTestRequestSchema,
  type LoadTestResponse,
  LoadTestResponseSchema,
  type ListLoadTestRunsQuery,
  ListLoadTestRunsQuerySchema,
  type ListLoadTestRunsResponse,
  ListLoadTestRunsResponseSchema,
} from "@modeldoctor/contracts";
import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UsePipes } from "@nestjs/common";
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
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
  @UsePipes(new ZodValidationPipe(LoadTestRequestSchema))
  run(@Body() body: LoadTestRequest): Promise<LoadTestResponse> {
    return this.svc.run(body);
  }

  @ApiOperation({ summary: "List load-test runs (cursor-paginated, newest first)" })
  @ApiOkResponse({ type: ListLoadTestRunsResponseDto })
  @Get("load-test/runs")
  @UsePipes(new ZodValidationPipe(ListLoadTestRunsQuerySchema))
  listRuns(@Query() query: ListLoadTestRunsQuery): Promise<ListLoadTestRunsResponse> {
    return this.svc.listRuns(query);
  }
}
