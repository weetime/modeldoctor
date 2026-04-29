import {
  type PlaygroundEmbeddingsRequest,
  PlaygroundEmbeddingsRequestSchema,
  type PlaygroundEmbeddingsResponse,
  PlaygroundEmbeddingsResponseSchema,
} from "@modeldoctor/contracts";
import { Body, Controller, HttpCode, HttpStatus, Post, UsePipes } from "@nestjs/common";
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { EmbeddingsService } from "./embeddings.service.js";

class PlaygroundEmbeddingsRequestDto extends createZodDto(PlaygroundEmbeddingsRequestSchema) {}
class PlaygroundEmbeddingsResponseDto extends createZodDto(PlaygroundEmbeddingsResponseSchema) {}

@ApiTags("playground")
@Controller("playground")
export class EmbeddingsController {
  constructor(private readonly svc: EmbeddingsService) {}

  @ApiOperation({ summary: "Generate embeddings via the Playground" })
  @ApiBody({ type: PlaygroundEmbeddingsRequestDto })
  @ApiOkResponse({ type: PlaygroundEmbeddingsResponseDto })
  @Post("embeddings")
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(PlaygroundEmbeddingsRequestSchema))
  embeddings(@Body() body: PlaygroundEmbeddingsRequest): Promise<PlaygroundEmbeddingsResponse> {
    return this.svc.run(body);
  }
}
