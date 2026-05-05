import {
  type BenchmarkTemplate,
  type CreateBenchmarkTemplateRequest,
  type ListBenchmarkTemplatesQuery,
  type ListBenchmarkTemplatesResponse,
  createBenchmarkTemplateRequestSchema,
  listBenchmarkTemplatesQuerySchema,
  updateBenchmarkTemplateRequestSchema,
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
  Query,
  UseGuards,
} from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { BenchmarkTemplateService, type TemplateActor } from "./benchmark-template.service.js";

// PATCH body schema: drop isOfficial (immutable post-create) + scenario/tool
// (changing these would invalidate the stored config). Anything the client
// sends in these fields is stripped here, never reaches the service.
export const patchSchema = updateBenchmarkTemplateRequestSchema.omit({
  isOfficial: true,
  scenario: true,
  tool: true,
});

function actorFrom(user: JwtPayload): TemplateActor {
  return { sub: user.sub, isAdmin: user.roles.includes("admin") };
}

@Controller("benchmark-templates")
@UseGuards(JwtAuthGuard)
export class BenchmarkTemplateController {
  constructor(private readonly service: BenchmarkTemplateService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(listBenchmarkTemplatesQuerySchema))
    query: ListBenchmarkTemplatesQuery,
  ): Promise<ListBenchmarkTemplatesResponse> {
    return this.service.list(query);
  }

  @Get(":id")
  detail(@Param("id") id: string): Promise<BenchmarkTemplate> {
    return this.service.findByIdOrFail(id);
  }

  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(createBenchmarkTemplateRequestSchema))
    body: CreateBenchmarkTemplateRequest,
  ): Promise<BenchmarkTemplate> {
    return this.service.create(actorFrom(user), body);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(patchSchema)) body: Record<string, unknown>,
  ): Promise<BenchmarkTemplate> {
    return this.service.update(actorFrom(user), id, body);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@CurrentUser() user: JwtPayload, @Param("id") id: string): Promise<void> {
    await this.service.delete(actorFrom(user), id);
  }
}
