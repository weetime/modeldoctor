import {
  type CreatePlatformSource,
  createPlatformSourceSchema,
  type PlatformSource,
  type TestPlatformSourceResponse,
  type UpdatePlatformSource,
  updatePlatformSourceSchema,
} from "@modeldoctor/contracts";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { CurrentUser } from "../../../common/decorators/current-user.decorator.js";
import { ZodValidationPipe } from "../../../common/pipes/zod-validation.pipe.js";
import type { JwtPayload } from "../../auth/jwt.strategy.js";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard.js";
import { PlatformSourcesService } from "./platform-sources.service.js";

const testBodySchema = z.object({ baseUrl: z.string().url(), apiKey: z.string().min(1) });

@ApiTags("platform-sources")
@ApiBearerAuth()
@Controller("platform-sources")
@UseGuards(JwtAuthGuard)
export class PlatformSourcesController {
  constructor(private readonly service: PlatformSourcesService) {}

  @Get()
  list(@CurrentUser() user: JwtPayload): Promise<PlatformSource[]> {
    return this.service.list(user.sub);
  }

  @Post("test")
  @HttpCode(200)
  test(
    @Body(new ZodValidationPipe(testBodySchema)) body: z.infer<typeof testBodySchema>,
  ): Promise<TestPlatformSourceResponse> {
    return this.service.test(body);
  }

  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(createPlatformSourceSchema)) body: CreatePlatformSource,
  ): Promise<PlatformSource> {
    return this.service.create(user.sub, body);
  }

  @Get(":id")
  get(@CurrentUser() user: JwtPayload, @Param("id") id: string): Promise<PlatformSource> {
    return this.service.get(user.sub, id);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updatePlatformSourceSchema)) body: UpdatePlatformSource,
  ): Promise<PlatformSource> {
    return this.service.update(user.sub, id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  delete(@CurrentUser() user: JwtPayload, @Param("id") id: string): Promise<void> {
    return this.service.delete(user.sub, id);
  }

  @Post(":id/test")
  @HttpCode(200)
  testSaved(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
  ): Promise<TestPlatformSourceResponse> {
    return this.service.testSaved(user.sub, id);
  }
}
