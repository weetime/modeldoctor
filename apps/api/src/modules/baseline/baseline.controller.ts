import {
  type Baseline,
  type CreateBaseline,
  type ListBaselinesResponse,
  createBaselineSchema,
} from "@modeldoctor/contracts";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { BaselineService } from "./baseline.service.js";

@Controller("baselines")
@UseGuards(JwtAuthGuard)
export class BaselineController {
  constructor(private readonly service: BaselineService) {}

  @Get()
  list(@CurrentUser() user: JwtPayload): Promise<ListBaselinesResponse> {
    return this.service.list(user.sub);
  }

  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(createBaselineSchema)) body: CreateBaseline,
  ): Promise<Baseline> {
    return this.service.create(user.sub, body);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: JwtPayload, @Param("id") id: string): Promise<void> {
    await this.service.delete(user.sub, id);
  }
}
