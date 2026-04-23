import type { CheckVegetaResponse, HealthResponse } from "@modeldoctor/contracts";
import { Controller, Get } from "@nestjs/common";
import { HealthService } from "./health.service.js";

@Controller()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get("health")
  getHealth(): HealthResponse {
    return this.health.getHealth();
  }

  @Get("check-vegeta")
  checkVegeta(): Promise<CheckVegetaResponse> {
    return this.health.checkVegeta();
  }
}
