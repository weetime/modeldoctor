// apps/api/src/modules/insights/synthesize.controller.ts
import { type SynthesizeRequest, synthesizeRequestSchema } from "@modeldoctor/contracts";
import { Body, Controller, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { SynthesizeService } from "./synthesize.service.js";

@ApiTags("insights")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("insights/:connectionId")
export class SynthesizeController {
  constructor(private readonly svc: SynthesizeService) {}

  @ApiOperation({
    summary: "Synthesize an AI narrative report from recent benchmarks (synchronous, 5-30s)",
  })
  @Post("synthesize")
  async synthesize(
    @CurrentUser() user: JwtPayload,
    @Param("connectionId") connectionId: string,
    @Body(new ZodValidationPipe(synthesizeRequestSchema)) body: SynthesizeRequest,
  ) {
    return this.svc.synthesize(user.sub, connectionId, body);
  }
}
