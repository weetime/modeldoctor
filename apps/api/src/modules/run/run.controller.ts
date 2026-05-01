import {
  type ListRunsQuery,
  type ListRunsResponse,
  type Run,
  listRunsQuerySchema,
} from "@modeldoctor/contracts";
import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { RunService } from "./run.service.js";

@Controller("runs")
@UseGuards(JwtAuthGuard)
export class RunController {
  constructor(private readonly service: RunService) {}

  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query(new ZodValidationPipe(listRunsQuerySchema)) query: ListRunsQuery,
  ): Promise<ListRunsResponse> {
    return this.service.list(query, user.sub);
  }

  @Get(":id")
  detail(@CurrentUser() user: JwtPayload, @Param("id") id: string): Promise<Run> {
    return this.service.findByIdOrFail(id, user.sub);
  }
}
