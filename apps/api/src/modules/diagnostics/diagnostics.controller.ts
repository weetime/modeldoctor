import {
  type DiagnosticsRunRequest,
  diagnosticsRunRequestSchema,
  type DiagnosticsRunResponse,
  diagnosticsRunResponseSchema,
} from "@modeldoctor/contracts";
import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { ConnectionService } from "../connection/connection.service.js";
import { DiagnosticsService } from "./diagnostics.service.js";

class DiagnosticsRunRequestDto extends createZodDto(diagnosticsRunRequestSchema) {}
class DiagnosticsRunResponseDto extends createZodDto(diagnosticsRunResponseSchema) {}

@ApiTags("diagnostics")
@Controller("diagnostics")
export class DiagnosticsController {
  constructor(
    private readonly svc: DiagnosticsService,
    private readonly connections: ConnectionService,
  ) {}

  @ApiOperation({ summary: "Run selected probes against a model endpoint" })
  @ApiBody({ type: DiagnosticsRunRequestDto })
  @ApiOkResponse({ type: DiagnosticsRunResponseDto })
  @Post("runs")
  @HttpCode(HttpStatus.OK)
  async run(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(diagnosticsRunRequestSchema)) body: DiagnosticsRunRequest,
  ): Promise<DiagnosticsRunResponse> {
    const conn = await this.connections.getOwnedDecrypted(user.sub, body.connectionId);
    return this.svc.run(user.sub, conn, body);
  }
}
