// apps/api/src/modules/insights/matrix.controller.ts
import {
  type EndpointReportRange,
  endpointReportRangeSchema,
  type InsightsMatrixResponse,
  type MatrixAggregate,
  matrixAggregateSchema,
} from "@modeldoctor/contracts";
import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { MatrixService } from "./matrix.service.js";

@ApiTags("insights")
@ApiBearerAuth()
@Controller("insights")
@UseGuards(JwtAuthGuard)
export class MatrixController {
  constructor(private readonly matrix: MatrixService) {}

  @ApiOperation({
    summary: "Cross-endpoint x dimension score matrix (scenario/tool/engine over a date range)",
  })
  @Get("matrix")
  async getMatrix(
    @CurrentUser() user: JwtPayload,
    @Query("aggregate", new ZodValidationPipe(matrixAggregateSchema.default("scenario")))
    aggregate: MatrixAggregate,
    @Query("range", new ZodValidationPipe(endpointReportRangeSchema.default("30d")))
    range: EndpointReportRange,
    @Query("profile") profile?: string,
  ): Promise<InsightsMatrixResponse> {
    return this.matrix.getMatrix(user.sub, {
      aggregate,
      range,
      profileSlug: profile ?? "default",
    });
  }
}
