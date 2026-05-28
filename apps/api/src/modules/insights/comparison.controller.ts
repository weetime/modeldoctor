// apps/api/src/modules/insights/comparison.controller.ts
import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { ComparisonService } from "./comparison.service.js";

@ApiTags("insights")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("insights/:connectionId")
export class ComparisonController {
  constructor(private readonly svc: ComparisonService) {}

  @ApiOperation({ summary: "Compare recent benchmarks for this connection against its baseline" })
  @Get("baseline-comparison")
  async baseline(
    @CurrentUser() user: JwtPayload,
    @Param("connectionId") connectionId: string,
    @Query("from") fromISO: string,
  ) {
    return { items: await this.svc.baseline(user.sub, connectionId, fromISO) };
  }

  @ApiOperation({ summary: "Compare this connection's benchmarks against other connections" })
  @Get("fleet-comparison")
  async fleet(
    @CurrentUser() user: JwtPayload,
    @Param("connectionId") connectionId: string,
    @Query("from") fromISO: string,
  ) {
    return { items: await this.svc.fleet(user.sub, connectionId, fromISO) };
  }
}
