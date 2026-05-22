import {
  type CompareSynthesizeRequest,
  type CreateSavedCompareRequest,
  compareSynthesizeRequestSchema,
  createSavedCompareRequestSchema,
  type UpdateSavedCompareRequest,
  updateSavedCompareRequestSchema,
} from "@modeldoctor/contracts";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { CompareSynthesizeService } from "./compare-synthesize.service.js";
import { SavedComparesService } from "./saved-compares.service.js";

@UseGuards(JwtAuthGuard)
@Controller("saved-compares")
export class SavedComparesController {
  constructor(
    private readonly svc: SavedComparesService,
    private readonly synth: CompareSynthesizeService,
  ) {}

  @Get()
  async list(@CurrentUser() user: JwtPayload) {
    return { items: await this.svc.list(user.sub) };
  }

  @Get(":id")
  async get(@CurrentUser() user: JwtPayload, @Param("id") id: string) {
    const sc = await this.svc.getHydrated(user.sub, id);
    if (!sc) throw new NotFoundException();
    return sc;
  }

  @Post()
  async create(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(createSavedCompareRequestSchema)) body: CreateSavedCompareRequest,
  ) {
    return this.svc.create(user.sub, body);
  }

  @Patch(":id")
  async update(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateSavedCompareRequestSchema)) body: UpdateSavedCompareRequest,
  ) {
    return this.svc.update(user.sub, id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  async delete(@CurrentUser() user: JwtPayload, @Param("id") id: string) {
    await this.svc.delete(user.sub, id);
  }

  @Post(":id/synthesize")
  async synthesize(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(compareSynthesizeRequestSchema)) body: CompareSynthesizeRequest,
  ) {
    return this.synth.synthesize(user.sub, id, body);
  }
}
