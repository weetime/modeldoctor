import {
  PlaygroundTranscriptionsBodySchema,
  type PlaygroundTranscriptionsResponse,
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
    if (body.reference_audio_base64) {
      const b64 = body.reference_audio_base64.split(",")[1] ?? "";
      // base64 decode ratio: 4 chars → 3 bytes (≈0.75); conservative
      // decoded-size upper bound used for the 15 MB security guard.
      const bytes = Math.floor(b64.length * 0.75);
      if (bytes > 15 * 1024 * 1024) {
        throw new BadRequestException("reference_audio_base64 exceeds 15 MB decoded");
      }
    }
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
