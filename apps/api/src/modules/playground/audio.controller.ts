import {
  type PlaygroundTranscriptionsResponse,
  PlaygroundTranscriptionsBodySchema,
  PlaygroundTranscriptionsResponseSchema,
  type PlaygroundTtsRequest,
  PlaygroundTtsRequestSchema,
  type PlaygroundTtsResponse,
  PlaygroundTtsResponseSchema,
} from "@modeldoctor/contracts";
import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseInterceptors,
  UsePipes,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { AudioService } from "./audio.service.js";

class PlaygroundTtsRequestDto extends createZodDto(PlaygroundTtsRequestSchema) {}
class PlaygroundTtsResponseDto extends createZodDto(PlaygroundTtsResponseSchema) {}
class PlaygroundTranscriptionsResponseDto extends createZodDto(
  PlaygroundTranscriptionsResponseSchema,
) {}

const TRANSCRIPTIONS_FILE_SIZE_LIMIT = 25 * 1024 * 1024;

@ApiTags("playground")
@Controller("playground/audio")
export class AudioController {
  constructor(private readonly svc: AudioService) {}

  @ApiOperation({ summary: "Synthesize speech via the Playground" })
  @ApiBody({ type: PlaygroundTtsRequestDto })
  @ApiOkResponse({ type: PlaygroundTtsResponseDto })
  @Post("tts")
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(PlaygroundTtsRequestSchema))
  tts(@Body() body: PlaygroundTtsRequest): Promise<PlaygroundTtsResponse> {
    return this.svc.runTts(body);
  }

  @ApiOperation({ summary: "Transcribe audio via the Playground (multipart upload)" })
  @ApiOkResponse({ type: PlaygroundTranscriptionsResponseDto })
  @Post("transcriptions")
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: TRANSCRIPTIONS_FILE_SIZE_LIMIT } }),
  )
  async transcriptions(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() rawBody: unknown,
  ): Promise<PlaygroundTranscriptionsResponse> {
    if (!file) throw new BadRequestException("missing 'file' part in multipart body");
    const parsed = PlaygroundTranscriptionsBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    return this.svc.runTranscriptions({ file, body: parsed.data });
  }
}
