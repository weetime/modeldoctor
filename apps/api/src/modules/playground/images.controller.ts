import {
  type PlaygroundImagesRequest,
  PlaygroundImagesRequestSchema,
  type PlaygroundImagesResponse,
  PlaygroundImagesResponseSchema,
} from "@modeldoctor/contracts";
import { Body, Controller, HttpCode, HttpStatus, Post, UsePipes } from "@nestjs/common";
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { ImagesService } from "./images.service.js";

class PlaygroundImagesRequestDto extends createZodDto(PlaygroundImagesRequestSchema) {}
class PlaygroundImagesResponseDto extends createZodDto(PlaygroundImagesResponseSchema) {}

@ApiTags("playground")
@Controller("playground")
export class ImagesController {
  constructor(private readonly svc: ImagesService) {}

  @ApiOperation({ summary: "Generate images via the Playground" })
  @ApiBody({ type: PlaygroundImagesRequestDto })
  @ApiOkResponse({ type: PlaygroundImagesResponseDto })
  @Post("images")
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(PlaygroundImagesRequestSchema))
  images(@Body() body: PlaygroundImagesRequest): Promise<PlaygroundImagesResponse> {
    return this.svc.run(body);
  }
}
