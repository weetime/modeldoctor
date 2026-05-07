import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../../database/prisma.service.js";
import { LlmJudgeService } from "../llm-judge/llm-judge.service.js";
import { ComparisonService } from "./comparison.service.js";
import { EvaluationProfileService } from "./evaluation-profile.service.js";
import { SynthesizeService } from "./synthesize.service.js";

const TEST_KEY_B64 = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";

describe("SynthesizeService", () => {
  let svc: SynthesizeService;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        SynthesizeService,
        ComparisonService,
        EvaluationProfileService,
        LlmJudgeService,
        PrismaService,
        { provide: ConfigService, useValue: { get: () => TEST_KEY_B64 } },
      ],
    }).compile();
    svc = mod.get(SynthesizeService);
    await mod.get(PrismaService).$connect();
  });

  afterEach(() => undefined);

  it("throws NotFoundException when LLM provider is not configured", async () => {
    await expect(
      svc.synthesize("nonexistent-user", "nonexistent-connection", {
        profileSlug: "default",
        range: "30d",
        runIds: [],
        locale: "zh-CN",
      }),
    ).rejects.toThrow(/provider/);
  });
});
