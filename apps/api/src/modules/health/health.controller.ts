import {
  type CheckVegetaResponse,
  CheckVegetaResponseSchema,
  HealthResponseSchema,
} from "@modeldoctor/contracts";
import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  HealthCheck,
  type HealthCheckResult,
  HealthCheckService,
  PrismaHealthIndicator,
} from "@nestjs/terminus";
import { createZodDto } from "nestjs-zod";
import { Public } from "../../common/decorators/public.decorator.js";
import { PrismaService } from "../../database/prisma.service.js";
import { HealthService } from "./health.service.js";

class HealthResponseDto extends createZodDto(HealthResponseSchema) {}
class CheckVegetaResponseDto extends createZodDto(CheckVegetaResponseSchema) {}

@ApiTags("health")
@Controller()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaProbe: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
    private readonly legacy: HealthService,
  ) {}

  @Public()
  @ApiOperation({ summary: "Liveness probe with DB check" })
  @ApiOkResponse({ type: HealthResponseDto })
  @Get("health")
  @HealthCheck()
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.prismaProbe.pingCheck("database", this.prisma, { timeout: 500 }),
    ]);
  }

  @Public()
  @ApiOperation({ summary: "Check if Vegeta CLI is installed on the host" })
  @ApiOkResponse({ type: CheckVegetaResponseDto })
  @Get("check-vegeta")
  checkVegeta(): Promise<CheckVegetaResponse> {
    return this.legacy.checkVegeta();
  }
}
