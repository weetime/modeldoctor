// apps/api/src/modules/insights/evaluation-profile.controller.ts
import { listEvaluationProfilesResponseSchema } from "@modeldoctor/contracts";
import { Controller, Get, Param } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { EvaluationProfileService } from "./evaluation-profile.service.js";

@ApiTags("insights")
@ApiBearerAuth()
@Controller("insights/profiles")
export class EvaluationProfileController {
  constructor(private readonly svc: EvaluationProfileService) {}

  @ApiOperation({ summary: "List built-in evaluation profiles (read-only seed data)" })
  @Get()
  async list() {
    const items = await this.svc.list();
    return listEvaluationProfilesResponseSchema.parse({ items });
  }

  @ApiOperation({ summary: "Get an evaluation profile by slug" })
  @Get(":slug")
  async get(@Param("slug") slug: string) {
    return this.svc.getBySlug(slug);
  }
}
