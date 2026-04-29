import {
  type PlaygroundChatRequest,
  PlaygroundChatRequestSchema,
  type PlaygroundChatResponse,
  PlaygroundChatResponseSchema,
} from "@modeldoctor/contracts";
import { Body, Controller, HttpCode, HttpStatus, Post, UsePipes } from "@nestjs/common";
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { ChatService } from "./chat.service.js";

class PlaygroundChatRequestDto extends createZodDto(PlaygroundChatRequestSchema) {}
class PlaygroundChatResponseDto extends createZodDto(PlaygroundChatResponseSchema) {}

@ApiTags("playground")
@Controller("playground")
export class ChatController {
  constructor(private readonly svc: ChatService) {}

  @ApiOperation({ summary: "Send a chat completion via the Playground (non-streaming)" })
  @ApiBody({ type: PlaygroundChatRequestDto })
  @ApiOkResponse({ type: PlaygroundChatResponseDto })
  @Post("chat")
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(PlaygroundChatRequestSchema))
  chat(@Body() body: PlaygroundChatRequest): Promise<PlaygroundChatResponse> {
    return this.svc.run(body);
  }
}
