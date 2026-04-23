import {
  type E2ETestRequest,
  E2ETestRequestSchema,
  type E2ETestResponse,
  E2ETestResponseSchema,
} from "@modeldoctor/contracts";
import { Body, Controller, HttpCode, HttpStatus, Post, UsePipes } from "@nestjs/common";
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { E2ETestService } from "./e2e-test.service.js";

class E2ETestRequestDto extends createZodDto(E2ETestRequestSchema) {}
class E2ETestResponseDto extends createZodDto(E2ETestResponseSchema) {}

@ApiTags("e2e-test")
@Controller()
export class E2ETestController {
  constructor(private readonly svc: E2ETestService) {}

  @ApiOperation({ summary: "Run selected probes against a model endpoint" })
  @ApiBody({ type: E2ETestRequestDto })
  @ApiOkResponse({ type: E2ETestResponseDto })
  @Post("e2e-test")
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(E2ETestRequestSchema))
  run(@Body() body: E2ETestRequest): Promise<E2ETestResponse> {
    return this.svc.run(body);
  }
}
