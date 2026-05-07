// apps/api/src/modules/llm-judge/llm-judge.controller.ts
import {
  type TestLlmJudgeRequest,
  type TestLlmJudgeResponse,
  type UpsertLlmJudgeProvider,
  llmJudgeProviderPublicSchema,
  testLlmJudgeRequestSchema,
  testLlmJudgeResponseSchema,
  upsertLlmJudgeProviderSchema,
} from "@modeldoctor/contracts";
import { Body, Controller, Delete, Get, HttpCode, Post, Put, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { chatCompletion } from "../insights/llm-client.js";
import { LlmJudgeService } from "./llm-judge.service.js";

@UseGuards(JwtAuthGuard)
@Controller("llm-judge")
export class LlmJudgeController {
  constructor(private readonly svc: LlmJudgeService) {}

  @Get("provider")
  async get(@CurrentUser() user: JwtPayload) {
    const p = await this.svc.getPublic(user.sub);
    return p ? llmJudgeProviderPublicSchema.parse(p) : null;
  }

  @Put("provider")
  async put(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(upsertLlmJudgeProviderSchema)) body: UpsertLlmJudgeProvider,
  ) {
    return this.svc.upsert(user.sub, body);
  }

  @Delete("provider")
  @HttpCode(204)
  async del(@CurrentUser() user: JwtPayload) {
    await this.svc.delete(user.sub);
  }

  @Post("test")
  async test(
    @Body(new ZodValidationPipe(testLlmJudgeRequestSchema)) body: TestLlmJudgeRequest,
  ): Promise<TestLlmJudgeResponse> {
    try {
      const r = await chatCompletion(
        { baseUrl: body.baseUrl, apiKey: body.apiKey, model: body.model },
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
