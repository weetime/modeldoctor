import {
  type CreateEvaluationRequest,
  createEvaluationRequestSchema,
  importEvaluationRequestSchema,
  type UpdateEvaluationRequest,
  updateEvaluationRequestSchema,
} from "@modeldoctor/contracts";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { CurrentUser } from "../../../common/decorators/current-user.decorator.js";
import { ZodValidationPipe } from "../../../common/pipes/zod-validation.pipe.js";
import type { JwtPayload } from "../../auth/jwt.strategy.js";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard.js";
import { EvaluationsService } from "../services/evaluations.service.js";

const importBodySchema = z.object({
  name: z.string().min(1).max(200),
  import: importEvaluationRequestSchema,
});

@ApiTags("quality-gate")
@ApiBearerAuth()
@Controller("quality-gate/evaluations")
@UseGuards(JwtAuthGuard)
export class EvaluationsController {
  constructor(private readonly svc: EvaluationsService) {}

  @ApiOperation({ summary: "List Quality-Gate evaluation sets owned by the user" })
  @Get()
  async list(@CurrentUser() user: JwtPayload) {
    return { items: await this.svc.list(user.sub) };
  }

  @ApiOperation({ summary: "Create a Quality-Gate evaluation set" })
  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(createEvaluationRequestSchema)) body: CreateEvaluationRequest,
  ) {
    return this.svc.create(user.sub, body);
  }

  @ApiOperation({ summary: "Get a Quality-Gate evaluation set by ID" })
  @Get(":id")
  async findOne(@CurrentUser() user: JwtPayload, @Param("id") id: string) {
    const r = await this.svc.get(user.sub, id);
    if (!r) throw new NotFoundException(`evaluation ${id} not found`);
    return r;
  }

  @ApiOperation({ summary: "Patch a Quality-Gate evaluation set" })
  @Patch(":id")
  update(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateEvaluationRequestSchema)) body: UpdateEvaluationRequest,
  ) {
    return this.svc.update(user.sub, id, body);
  }

  @ApiOperation({ summary: "Delete a Quality-Gate evaluation set" })
  @Delete(":id")
  @HttpCode(204)
  remove(@CurrentUser() user: JwtPayload, @Param("id") id: string) {
    return this.svc.delete(user.sub, id);
  }

  @ApiOperation({ summary: "Import an evaluation set from an external source" })
  @Post("import")
  importSet(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(importBodySchema)) body: z.infer<typeof importBodySchema>,
  ) {
    return this.svc.import(user.sub, body.name, body.import);
  }

  @ApiOperation({ summary: "Duplicate an evaluation set" })
  @Post(":id/duplicate")
  duplicate(@CurrentUser() user: JwtPayload, @Param("id") id: string) {
    return this.svc.duplicate(user.sub, id);
  }
}
