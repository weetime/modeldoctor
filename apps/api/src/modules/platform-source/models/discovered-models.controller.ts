import {
  type AutomationRunPublic,
  type DeploymentRevisionPublic,
  type DiscoveredModelPublic,
  type ListDiscoveredModelsQuery,
  listDiscoveredModelsQuerySchema,
  type UpdateDiscoveredModel,
  updateDiscoveredModelSchema,
} from "@modeldoctor/contracts";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../../common/decorators/current-user.decorator.js";
import { ZodValidationPipe } from "../../../common/pipes/zod-validation.pipe.js";
import type { JwtPayload } from "../../auth/jwt.strategy.js";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard.js";
import { DiscoveredModelsService } from "./discovered-models.service.js";

@ApiTags("deployment-gate")
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard)
export class DiscoveredModelsController {
  constructor(private readonly service: DiscoveredModelsService) {}

  @Get("discovered-models")
  list(
    @CurrentUser() user: JwtPayload,
    @Query(new ZodValidationPipe(listDiscoveredModelsQuerySchema)) q: ListDiscoveredModelsQuery,
  ): Promise<DiscoveredModelPublic[]> {
    return this.service.list(user.sub, q);
  }

  @Get("discovered-models/:id")
  get(@CurrentUser() user: JwtPayload, @Param("id") id: string): Promise<DiscoveredModelPublic> {
    return this.service.get(user.sub, id);
  }

  @Patch("discovered-models/:id")
  update(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateDiscoveredModelSchema)) body: UpdateDiscoveredModel,
  ): Promise<DiscoveredModelPublic> {
    return this.service.update(user.sub, id, body);
  }

  @Post("discovered-models/:id/run")
  run(@CurrentUser() user: JwtPayload, @Param("id") id: string): Promise<AutomationRunPublic> {
    return this.service.runNow(user.sub, id);
  }

  @Get("discovered-models/:id/revisions")
  revisions(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
  ): Promise<DeploymentRevisionPublic[]> {
    return this.service.listRevisions(user.sub, id);
  }

  @Post("automation-runs/:id/cancel")
  @HttpCode(204)
  cancel(@CurrentUser() user: JwtPayload, @Param("id") id: string): Promise<void> {
    return this.service.cancelRun(user.sub, id);
  }
}
