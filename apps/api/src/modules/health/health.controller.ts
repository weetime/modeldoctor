import {
  type CheckVegetaResponse,
  CheckVegetaResponseSchema,
  type HealthResponse,
  HealthResponseSchema,
} from "@modeldoctor/contracts";
import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import { Public } from "../../common/decorators/public.decorator.js";
import { HealthService } from "./health.service.js";

class HealthResponseDto extends createZodDto(HealthResponseSchema) {}
class CheckVegetaResponseDto extends createZodDto(CheckVegetaResponseSchema) {}

@ApiTags("health")
@Controller()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Public()
  @ApiOperation({ summary: "Liveness probe" })
  @ApiOkResponse({ type: HealthResponseDto })
  @Get("health")
  getHealth(): HealthResponse {
    return this.health.getHealth();
  }

  @Public()
  @ApiOperation({ summary: "Check if Vegeta CLI is installed on the host" })
  @ApiOkResponse({ type: CheckVegetaResponseDto })
  @Get("check-vegeta")
  checkVegeta(): Promise<CheckVegetaResponse> {
    return this.health.checkVegeta();
  }
}
