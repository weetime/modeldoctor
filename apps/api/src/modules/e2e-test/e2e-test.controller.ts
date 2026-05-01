import {
  type E2ETestRequest,
  E2ETestRequestSchema,
  type E2ETestResponse,
  E2ETestResponseSchema,
} from "@modeldoctor/contracts";
import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { ConnectionService } from "../connection/connection.service.js";
import { E2ETestService } from "./e2e-test.service.js";

class E2ETestRequestDto extends createZodDto(E2ETestRequestSchema) {}
class E2ETestResponseDto extends createZodDto(E2ETestResponseSchema) {}

@ApiTags("e2e-test")
@Controller()
export class E2ETestController {
  constructor(
    private readonly svc: E2ETestService,
    private readonly connections: ConnectionService,
  ) {}

  @ApiOperation({ summary: "Run selected probes against a model endpoint" })
  @ApiBody({ type: E2ETestRequestDto })
  @ApiOkResponse({ type: E2ETestResponseDto })
  @Post("e2e-test")
  @HttpCode(HttpStatus.OK)
  async run(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(E2ETestRequestSchema)) body: E2ETestRequest,
  ): Promise<E2ETestResponse> {
    const conn = await this.connections.getOwnedDecrypted(user.sub, body.connectionId);
    return this.svc.run(user.sub, conn, body);
  }
}
