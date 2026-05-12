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
import { z } from "zod";
import {
  type CreateEvaluationRequest,
  type UpdateEvaluationRequest,
  createEvaluationRequestSchema,
  importEvaluationRequestSchema,
  updateEvaluationRequestSchema,
} from "@modeldoctor/contracts";
import { CurrentUser } from "../../../common/decorators/current-user.decorator.js";
import { ZodValidationPipe } from "../../../common/pipes/zod-validation.pipe.js";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard.js";
import type { JwtPayload } from "../../auth/jwt.strategy.js";
import { EvaluationsService } from "../services/evaluations.service.js";

const importBodySchema = z.object({
  name: z.string().min(1).max(200),
  import: importEvaluationRequestSchema,
});

@Controller("quality-gate/evaluations")
@UseGuards(JwtAuthGuard)
export class EvaluationsController {
  constructor(private readonly svc: EvaluationsService) {}

  @Get()
  async list(@CurrentUser() user: JwtPayload) {
    return { items: await this.svc.list(user.sub) };
  }

  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(createEvaluationRequestSchema)) body: CreateEvaluationRequest,
  ) {
    return this.svc.create(user.sub, body);
  }

  @Get(":id")
  async findOne(@CurrentUser() user: JwtPayload, @Param("id") id: string) {
    const r = await this.svc.get(user.sub, id);
    if (!r) throw new NotFoundException(`evaluation ${id} not found`);
    return r;
  }

  @Patch(":id")
  update(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateEvaluationRequestSchema)) body: UpdateEvaluationRequest,
  ) {
    return this.svc.update(user.sub, id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(@CurrentUser() user: JwtPayload, @Param("id") id: string) {
    return this.svc.delete(user.sub, id);
  }

  @Post("import")
  importSet(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(importBodySchema)) body: z.infer<typeof importBodySchema>,
  ) {
    return this.svc.import(user.sub, body.name, body.import);
  }
}
