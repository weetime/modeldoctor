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
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { chatCompletion } from "../insights/llm-client.js";
import { LlmJudgeService } from "./llm-judge.service.js";

@UseGuards(JwtAuthGuard)
@Controller("llm-judge")
export class LlmJudgeController {
  constructor(private readonly svc: LlmJudgeService) {}

  @Get("provider")
  async get() {
    const p = await this.svc.getPublic();
    return p ? llmJudgeProviderPublicSchema.parse(p) : null;
  }

  @Put("provider")
  async put(
    @Body(new ZodValidationPipe(upsertLlmJudgeProviderSchema)) body: UpsertLlmJudgeProvider,
  ) {
    return this.svc.upsert(body);
  }

  @Delete("provider")
  @HttpCode(204)
  async del() {
    await this.svc.delete();
  }

  @Post("test")
  async test(
    @Body(new ZodValidationPipe(testLlmJudgeRequestSchema)) body: TestLlmJudgeRequest,
  ): Promise<TestLlmJudgeResponse> {
    let apiKey = body.apiKey;
    if (!apiKey) {
      const saved = await this.svc.getDecrypted();
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
