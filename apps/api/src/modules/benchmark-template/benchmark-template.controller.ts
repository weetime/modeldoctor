import {
  type BenchmarkTemplate,
  type CreateBenchmarkTemplateRequest,
  createBenchmarkTemplateRequestSchema,
  type ListBenchmarkTemplatesQuery,
  type ListBenchmarkTemplatesResponse,
  listBenchmarkTemplatesQuerySchema,
  patchBenchmarkTemplateRequestSchema as patchSchema,
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
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { BenchmarkTemplateService, type TemplateActor } from "./benchmark-template.service.js";

// patchSchema is imported from @modeldoctor/contracts (patchBenchmarkTemplateRequestSchema).
// Re-exported so controller.spec.ts can use it directly without knowing the contracts name.
export { patchSchema };

function actorFrom(user: JwtPayload): TemplateActor {
  return { sub: user.sub, isAdmin: user.roles.includes("admin") };
}

@ApiTags("benchmark-templates")
@ApiBearerAuth()
@Controller("benchmark-templates")
@UseGuards(JwtAuthGuard)
export class BenchmarkTemplateController {
  constructor(private readonly service: BenchmarkTemplateService) {}

  @ApiOperation({ summary: "List official + user benchmark templates with optional filters" })
  @Get()
  list(
    @Query(new ZodValidationPipe(listBenchmarkTemplatesQuerySchema))
    query: ListBenchmarkTemplatesQuery,
  ): Promise<ListBenchmarkTemplatesResponse> {
    return this.service.list(query);
  }

  @ApiOperation({ summary: "Get a benchmark template by ID" })
  @Get(":id")
  detail(@Param("id") id: string): Promise<BenchmarkTemplate> {
    return this.service.findByIdOrFail(id);
  }

  @ApiOperation({ summary: "Create a new benchmark template (admins may flag as official)" })
  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(createBenchmarkTemplateRequestSchema))
    body: CreateBenchmarkTemplateRequest,
  ): Promise<BenchmarkTemplate> {
    return this.service.create(actorFrom(user), body);
  }

  @ApiOperation({ summary: "Patch a benchmark template (owner or admin only)" })
  @Patch(":id")
  update(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(patchSchema)) body: Record<string, unknown>,
  ): Promise<BenchmarkTemplate> {
    return this.service.update(actorFrom(user), id, body);
  }

  @ApiOperation({ summary: "Delete a benchmark template (owner or admin only)" })
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@CurrentUser() user: JwtPayload, @Param("id") id: string): Promise<void> {
    await this.service.delete(actorFrom(user), id);
  }
}
