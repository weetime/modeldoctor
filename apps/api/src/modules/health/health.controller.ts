import { Controller, Get } from "@nestjs/common";
import { HealthService } from "./health.service.js";
import type { HealthResponse, CheckVegetaResponse } from "@modeldoctor/contracts";

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
