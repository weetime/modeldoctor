import {
  type PlaygroundRerankRequest,
  PlaygroundRerankRequestSchema,
  type PlaygroundRerankResponse,
  PlaygroundRerankResponseSchema,
} from "@modeldoctor/contracts";
import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from "@nestjs/common";
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { ConnectionService } from "../connection/connection.service.js";
import { RerankService } from "./rerank.service.js";

class PlaygroundRerankRequestDto extends createZodDto(PlaygroundRerankRequestSchema) {}
class PlaygroundRerankResponseDto extends createZodDto(PlaygroundRerankResponseSchema) {}

@ApiTags("playground")
@Controller("playground")
@UseGuards(JwtAuthGuard)
export class RerankController {
  constructor(
    private readonly svc: RerankService,
    private readonly connections: ConnectionService,
  ) {}

  @ApiOperation({ summary: "Rerank documents via the Playground (cohere or tei wire)" })
  @ApiBody({ type: PlaygroundRerankRequestDto })
  @ApiOkResponse({ type: PlaygroundRerankResponseDto })
  @Post("rerank")
  @HttpCode(HttpStatus.OK)
  async rerank(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(PlaygroundRerankRequestSchema)) body: PlaygroundRerankRequest,
  ): Promise<PlaygroundRerankResponse> {
    const conn = await this.connections.getOwnedDecrypted(user.sub, body.connectionId);
    return this.svc.run(conn, body);
  }
}
