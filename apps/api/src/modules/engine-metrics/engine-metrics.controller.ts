import {
  type EngineMetricsSnapshotQuery,
  type EngineMetricsSnapshotResponse,
  engineMetricsSnapshotQuerySchema,
  engineMetricsSnapshotResponseSchema,
} from "@modeldoctor/contracts";
import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { EngineMetricsService } from "./engine-metrics.service.js";

class EngineMetricsSnapshotResponseDto extends createZodDto(engineMetricsSnapshotResponseSchema) {}

@ApiTags("engine-metrics")
@Controller("engine-metrics")
export class EngineMetricsController {
  constructor(private readonly svc: EngineMetricsService) {}

  @ApiOperation({ summary: "Snapshot of engine-side Prometheus metrics for a connection" })
  @ApiOkResponse({ type: EngineMetricsSnapshotResponseDto })
  @Get(":connectionId/snapshot")
  async snapshot(
    @CurrentUser() user: JwtPayload,
    @Param("connectionId") connectionId: string,
    @Query(new ZodValidationPipe(engineMetricsSnapshotQuerySchema))
    query: EngineMetricsSnapshotQuery,
  ): Promise<EngineMetricsSnapshotResponse> {
    return this.svc.fetchSnapshot(user.sub, connectionId, query);
  }
}
