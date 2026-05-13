import {
  type CreateRunRequest,
  type ListRunSamplesQuery,
  type ListRunsQuery,
  createRunRequestSchema,
  listRunSamplesQuerySchema,
  listRunsQuerySchema,
} from "@modeldoctor/contracts";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { CurrentUser } from "../../../common/decorators/current-user.decorator.js";
import { ZodValidationPipe } from "../../../common/pipes/zod-validation.pipe.js";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard.js";
import type { JwtPayload } from "../../auth/jwt.strategy.js";
import { RunsService } from "../services/runs.service.js";

@Controller("quality-gate/runs")
@UseGuards(JwtAuthGuard)
export class RunsController {
  constructor(private readonly svc: RunsService) {}

  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query(new ZodValidationPipe(listRunsQuerySchema)) q: ListRunsQuery,
  ) {
    return this.svc.list(user.sub, q);
  }

  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(createRunRequestSchema)) body: CreateRunRequest,
  ) {
    return this.svc.create(user.sub, body);
  }

  @Get(":id")
  get(@CurrentUser() user: JwtPayload, @Param("id") id: string) {
    return this.svc.get(user.sub, id);
  }

  @Post(":id/cancel")
  async cancel(@CurrentUser() user: JwtPayload, @Param("id") id: string) {
    await this.svc.cancel(user.sub, id);
    return { ok: true };
  }

  @Delete(":id")
  @HttpCode(204)
  remove(@CurrentUser() user: JwtPayload, @Param("id") id: string) {
    return this.svc.delete(user.sub, id);
  }

  @Get(":id/samples")
  samples(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
    @Query(new ZodValidationPipe(listRunSamplesQuerySchema)) q: ListRunSamplesQuery,
  ) {
    return this.svc.listSamples(user.sub, id, q);
  }
}
