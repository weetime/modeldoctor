// apps/api/src/modules/llm-judge/llm-judge.controller.ts
import {
  type CreateLlmJudgeProvider,
  createLlmJudgeProviderSchema,
  type ListLlmJudgeProvidersResponse,
  type LlmJudgeProviderPublic,
  type TestLlmJudgeRequest,
  type TestLlmJudgeResponse,
  testLlmJudgeRequestSchema,
  testLlmJudgeResponseSchema,
  type UpdateLlmJudgeProvider,
  updateLlmJudgeProviderSchema,
} from "@modeldoctor/contracts";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
import { chatCompletion } from "../insights/llm-client.js";
import { type LlmJudgeActor, LlmJudgeService } from "./llm-judge.service.js";

function actorFrom(user: JwtPayload): LlmJudgeActor {
  return { sub: user.sub, isAdmin: user.roles.includes("admin") };
}

@ApiTags("llm-judge")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("llm-judge")
export class LlmJudgeController {
  constructor(private readonly svc: LlmJudgeService) {}

  @ApiOperation({ summary: "List configured LLM-judge providers (api keys omitted)" })
  @Get("providers")
  list(@CurrentUser() user: JwtPayload): Promise<ListLlmJudgeProvidersResponse> {
    return this.svc.list(actorFrom(user));
  }

  @ApiOperation({ summary: "Get an LLM-judge provider by ID" })
  @Get("providers/:id")
  getOne(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
  ): Promise<LlmJudgeProviderPublic> {
    return this.svc.getOne(actorFrom(user), id);
  }

  @ApiOperation({ summary: "Create an LLM-judge provider (admin-only)" })
  @Post("providers")
  create(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(createLlmJudgeProviderSchema)) body: CreateLlmJudgeProvider,
  ): Promise<LlmJudgeProviderPublic> {
    return this.svc.create(actorFrom(user), body);
  }

  @ApiOperation({ summary: "Patch an LLM-judge provider (admin-only)" })
  @Patch("providers/:id")
  update(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateLlmJudgeProviderSchema)) body: UpdateLlmJudgeProvider,
  ): Promise<LlmJudgeProviderPublic> {
    return this.svc.update(actorFrom(user), id, body);
  }

  @ApiOperation({ summary: "Delete an LLM-judge provider (admin-only)" })
  @Delete("providers/:id")
  @HttpCode(204)
  async remove(@CurrentUser() user: JwtPayload, @Param("id") id: string): Promise<void> {
    await this.svc.remove(actorFrom(user), id);
  }

  @ApiOperation({ summary: "Promote an LLM-judge provider to the default (admin-only)" })
  @Post("providers/:id/set-default")
  setDefault(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
  ): Promise<LlmJudgeProviderPublic> {
    return this.svc.setDefault(actorFrom(user), id);
  }

  @ApiOperation({ summary: "Send a one-shot ping to verify a provider config works" })
  @Post("test")
  async test(
    @Body(new ZodValidationPipe(testLlmJudgeRequestSchema)) body: TestLlmJudgeRequest,
  ): Promise<TestLlmJudgeResponse> {
    let apiKey = body.apiKey;
    if (!apiKey) {
      // No key supplied: reuse the saved key of the referenced provider.
      const saved = body.id ? await this.svc.getDecrypted({ id: body.id }) : null;
      if (!saved) {
        return testLlmJudgeResponseSchema.parse({
          ok: false,
          latencyMs: null,
          error: "No saved provider; supply apiKey to test",
        });
      }
      apiKey = saved.apiKey;
    }
    try {
      const r = await chatCompletion(
        { baseUrl: body.baseUrl, apiKey, model: body.model },
        [{ role: "user", content: "ping" }],
        { timeoutMs: 10_000 },
      );
      return testLlmJudgeResponseSchema.parse({ ok: true, latencyMs: r.latencyMs, error: null });
    } catch (e: any) {
      return testLlmJudgeResponseSchema.parse({
        ok: false,
        latencyMs: null,
        error: String(e?.message ?? e).slice(0, 500),
      });
    }
  }
}
