import {
  type PlaygroundEmbeddingsRequest,
  PlaygroundEmbeddingsRequestSchema,
  type PlaygroundEmbeddingsResponse,
  PlaygroundEmbeddingsResponseSchema,
} from "@modeldoctor/contracts";
import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from "@nestjs/common";
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { ConnectionService } from "../connection/connection.service.js";
import { EmbeddingsService } from "./embeddings.service.js";

class PlaygroundEmbeddingsRequestDto extends createZodDto(PlaygroundEmbeddingsRequestSchema) {}
class PlaygroundEmbeddingsResponseDto extends createZodDto(PlaygroundEmbeddingsResponseSchema) {}

@ApiTags("playground")
@Controller("playground")
@UseGuards(JwtAuthGuard)
export class EmbeddingsController {
  constructor(
    private readonly svc: EmbeddingsService,
    private readonly connections: ConnectionService,
  ) {}

  @ApiOperation({ summary: "Generate embeddings via the Playground" })
  @ApiBody({ type: PlaygroundEmbeddingsRequestDto })
  @ApiOkResponse({ type: PlaygroundEmbeddingsResponseDto })
  @Post("embeddings")
  @HttpCode(HttpStatus.OK)
  async embeddings(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(PlaygroundEmbeddingsRequestSchema))
    body: PlaygroundEmbeddingsRequest,
  ): Promise<PlaygroundEmbeddingsResponse> {
    const conn = await this.connections.getOwnedDecrypted(user.sub, body.connectionId);
    return this.svc.run(conn, body);
  }
}
