import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import {
  listRunsQuerySchema,
  type ListRunsQuery,
  type ListRunsResponse,
  type Run,
} from "@modeldoctor/contracts";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { RunService } from "./run.service.js";

@Controller("runs")
@UseGuards(JwtAuthGuard)
export class RunController {
  constructor(private readonly service: RunService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(listRunsQuerySchema)) query: ListRunsQuery,
  ): Promise<ListRunsResponse> {
    return this.service.list(query);
  }

  @Get(":id")
  detail(@Param("id") id: string): Promise<Run> {
    return this.service.findByIdOrFail(id);
  }
}
