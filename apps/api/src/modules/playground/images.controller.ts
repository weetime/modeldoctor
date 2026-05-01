import {
  PlaygroundImagesEditMultipartFieldsSchema,
  type PlaygroundImagesRequest,
  PlaygroundImagesRequestSchema,
  type PlaygroundImagesResponse,
  PlaygroundImagesResponseSchema,
} from "@modeldoctor/contracts";
import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
  UsePipes,
} from "@nestjs/common";
import { FileFieldsInterceptor } from "@nestjs/platform-express";
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { ConnectionService } from "../connection/connection.service.js";
import { ImagesService } from "./images.service.js";

class PlaygroundImagesRequestDto extends createZodDto(PlaygroundImagesRequestSchema) {}
class PlaygroundImagesResponseDto extends createZodDto(PlaygroundImagesResponseSchema) {}

const IMAGE_FILE_SIZE_LIMIT = 5 * 1024 * 1024;
const ALLOWED_IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);

@ApiTags("playground")
@Controller("playground")
@UseGuards(JwtAuthGuard)
export class ImagesController {
  constructor(
    private readonly svc: ImagesService,
    private readonly connections: ConnectionService,
  ) {}

  @ApiOperation({ summary: "Generate images via the Playground" })
  @ApiBody({ type: PlaygroundImagesRequestDto })
  @ApiOkResponse({ type: PlaygroundImagesResponseDto })
  @Post("images")
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(PlaygroundImagesRequestSchema))
  async images(
    @CurrentUser() user: JwtPayload,
    @Body() body: PlaygroundImagesRequest,
  ): Promise<PlaygroundImagesResponse> {
    const conn = await this.connections.getOwnedDecrypted(user.sub, body.connectionId);
    return this.svc.run(conn, body);
  }

  @ApiOperation({ summary: "Edit (inpaint) an image via the Playground (multipart upload)" })
  @ApiOkResponse({ type: PlaygroundImagesResponseDto })
  @Post("images/edit")
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: "image", maxCount: 1 },
        { name: "mask", maxCount: 1 },
      ],
      { limits: { fileSize: IMAGE_FILE_SIZE_LIMIT } },
    ),
  )
  async edit(
    @CurrentUser() user: JwtPayload,
    @UploadedFiles()
    files: { image?: Express.Multer.File[]; mask?: Express.Multer.File[] } | undefined,
    @Body() rawBody: unknown,
  ): Promise<PlaygroundImagesResponse> {
    const image = files?.image?.[0];
    const mask = files?.mask?.[0];
    if (!image) throw new BadRequestException("missing 'image' part in multipart body");
    if (!mask) throw new BadRequestException("missing 'mask' part in multipart body");
    if (!ALLOWED_IMAGE_MIMES.has(image.mimetype)) {
      throw new BadRequestException(
        `image mime ${image.mimetype} not allowed (png/jpeg/webp only)`,
      );
    }
    if (mask.mimetype !== "image/png") {
      throw new BadRequestException("mask must be image/png (alpha channel required)");
    }

    const parsed = PlaygroundImagesEditMultipartFieldsSchema.safeParse(rawBody);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    const fields = parsed.data;

    const conn = await this.connections.getOwnedDecrypted(user.sub, fields.connectionId);

    return this.svc.runEdit(conn, {
      image: {
        buffer: image.buffer,
        originalname: image.originalname,
        mimetype: image.mimetype,
        size: image.size,
      },
      mask: {
        buffer: mask.buffer,
        originalname: mask.originalname,
        mimetype: mask.mimetype,
        size: mask.size,
      },
      prompt: fields.prompt,
      n: fields.n !== undefined ? Number(fields.n) : undefined,
      size: fields.size,
    });
  }
}
