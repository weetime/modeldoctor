// apps/api/src/modules/insights/evaluation-profile.controller.ts
import { listEvaluationProfilesResponseSchema } from "@modeldoctor/contracts";
import { Controller, Get, Param } from "@nestjs/common";
import { EvaluationProfileService } from "./evaluation-profile.service.js";

@Controller("insights/profiles")
export class EvaluationProfileController {
  constructor(private readonly svc: EvaluationProfileService) {}

  @Get()
  async list() {
    const items = await this.svc.list();
    return listEvaluationProfilesResponseSchema.parse({ items });
  }

  @Get(":slug")
  async get(@Param("slug") slug: string) {
    return this.svc.getBySlug(slug);
  }
}
