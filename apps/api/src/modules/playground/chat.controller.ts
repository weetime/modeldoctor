import {
  type PlaygroundChatRequest,
  PlaygroundChatRequestSchema,
  type PlaygroundChatResponse,
  PlaygroundChatResponseSchema,
} from "@modeldoctor/contracts";
import { Body, Controller, HttpCode, HttpStatus, Post, Res, UsePipes } from "@nestjs/common";
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { createZodDto } from "nestjs-zod";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { pipeUpstreamSseToResponse } from "../../integrations/openai-client/index.js";
import { ChatService } from "./chat.service.js";

class PlaygroundChatRequestDto extends createZodDto(PlaygroundChatRequestSchema) {}
class PlaygroundChatResponseDto extends createZodDto(PlaygroundChatResponseSchema) {}

@ApiTags("playground")
@Controller("playground")
export class ChatController {
  constructor(private readonly svc: ChatService) {}

  @ApiOperation({
    summary:
      "Send a chat completion via the Playground (non-streaming JSON OR SSE pass-through if params.stream === true)",
  })
  @ApiBody({ type: PlaygroundChatRequestDto })
  @ApiOkResponse({ type: PlaygroundChatResponseDto })
  @Post("chat")
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(PlaygroundChatRequestSchema))
  async chat(
    @Body() body: PlaygroundChatRequest,
    @Res({ passthrough: false }) res: Response,
  ): Promise<undefined | PlaygroundChatResponse> {
    if (body.params?.stream) {
      const result = await this.svc.runStream(body);
      if (result.kind === "error") {
        res.status(result.status).json({ success: false, error: result.error, latencyMs: 0 });
        return;
      }
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();
      const ac = new AbortController();
      const upstreamBody = result.upstream.body;
      if (!upstreamBody) {
        res.end();
        return;
      }
      await pipeUpstreamSseToResponse(upstreamBody, res, ac);
      return;
    }
    const out = await this.svc.run(body);
    res.json(out);
  }
}
