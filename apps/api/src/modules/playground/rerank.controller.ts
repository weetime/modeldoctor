import {
  type PlaygroundRerankRequest,
  PlaygroundRerankRequestSchema,
  type PlaygroundRerankResponse,
  PlaygroundRerankResponseSchema,
} from "@modeldoctor/contracts";
import { Body, Controller, HttpCode, HttpStatus, Post, UsePipes } from "@nestjs/common";
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { RerankService } from "./rerank.service.js";

class PlaygroundRerankRequestDto extends createZodDto(PlaygroundRerankRequestSchema) {}
class PlaygroundRerankResponseDto extends createZodDto(PlaygroundRerankResponseSchema) {}

@ApiTags("playground")
@Controller("playground")
export class RerankController {
  constructor(private readonly svc: RerankService) {}

  @ApiOperation({ summary: "Rerank documents via the Playground (cohere or tei wire)" })
  @ApiBody({ type: PlaygroundRerankRequestDto })
  @ApiOkResponse({ type: PlaygroundRerankResponseDto })
  @Post("rerank")
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(PlaygroundRerankRequestSchema))
  rerank(@Body() body: PlaygroundRerankRequest): Promise<PlaygroundRerankResponse> {
    return this.svc.run(body);
  }
}
