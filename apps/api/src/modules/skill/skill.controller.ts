import {
  type CreateSkill,
  createSkillSchema,
  type ListSkillsResponse,
  type SkillPublic,
  type UpdateSkill,
  updateSkillSchema,
} from "@modeldoctor/contracts";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { SkillService } from "./skill.service.js";

@ApiTags("skills")
@ApiBearerAuth()
@Controller("skills")
@UseGuards(JwtAuthGuard)
export class SkillController {
  constructor(private readonly service: SkillService) {}

  @ApiOperation({ summary: "List skills (local agent presets) owned by the user" })
  @Get()
  list(@CurrentUser() user: JwtPayload): Promise<ListSkillsResponse> {
    return this.service.list(user.sub);
  }

  @ApiOperation({ summary: "Create a skill" })
  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(createSkillSchema)) body: CreateSkill,
  ): Promise<SkillPublic> {
    return this.service.create(user.sub, body);
  }

  @ApiOperation({ summary: "Get a skill by ID" })
  @Get(":id")
  detail(@CurrentUser() user: JwtPayload, @Param("id") id: string): Promise<SkillPublic> {
    return this.service.findOwnedPublic(user.sub, id);
  }

  @ApiOperation({ summary: "Patch a skill" })
  @Patch(":id")
  update(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateSkillSchema)) body: UpdateSkill,
  ): Promise<SkillPublic> {
    return this.service.update(user.sub, id, body);
  }

  @ApiOperation({ summary: "Delete a skill" })
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: JwtPayload, @Param("id") id: string): Promise<void> {
    await this.service.delete(user.sub, id);
  }
}
