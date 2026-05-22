// apps/api/src/modules/insights/comparison.controller.ts
import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { ComparisonService } from "./comparison.service.js";

@UseGuards(JwtAuthGuard)
@Controller("insights/:connectionId")
export class ComparisonController {
  constructor(private readonly svc: ComparisonService) {}

  @Get("baseline-comparison")
  async baseline(
    @CurrentUser() user: JwtPayload,
    @Param("connectionId") connectionId: string,
    @Query("from") fromISO: string,
  ) {
    return { items: await this.svc.baseline(user.sub, connectionId, fromISO) };
  }

  @Get("fleet-comparison")
  async fleet(
    @CurrentUser() user: JwtPayload,
    @Param("connectionId") connectionId: string,
    @Query("from") fromISO: string,
  ) {
    return { items: await this.svc.fleet(user.sub, connectionId, fromISO) };
  }
}
