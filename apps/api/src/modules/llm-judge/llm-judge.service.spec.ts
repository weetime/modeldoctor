import { ConfigService } from "@nestjs/config";
// apps/api/src/modules/llm-judge/llm-judge.service.spec.ts
import { Test } from "@nestjs/testing";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaService } from "../../database/prisma.service.js";
import { LlmJudgeService } from "./llm-judge.service.js";

const TEST_KEY_B64 = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="; // 32 zero-ish bytes

describe("LlmJudgeService", () => {
  let svc: LlmJudgeService;
  let prisma: PrismaService;
  let userId: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        LlmJudgeService,
        PrismaService,
        { provide: ConfigService, useValue: { get: () => TEST_KEY_B64 } },
      ],
    }).compile();
    svc = mod.get(LlmJudgeService);
    prisma = mod.get(PrismaService);
    await prisma.$connect();
  });

  beforeEach(async () => {
    const u = await prisma.user.create({
      data: { email: `t-${Date.now()}-${Math.random()}@e.com`, passwordHash: "x" },
    });
    userId = u.id;
  });

  afterEach(async () => {
    await prisma.llmJudgeProvider.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("returns null when no provider configured", async () => {
    expect(await svc.getPublic(userId)).toBeNull();
    expect(await svc.getDecrypted(userId)).toBeNull();
  });

  it("upsert encrypts and round-trips", async () => {
    const pub = await svc.upsert(userId, {
      baseUrl: "https://x",
      apiKey: "sk-secret",
      model: "gpt-x",
      enabled: true,
    });
    expect(pub.baseUrl).toBe("https://x");
    const dec = await svc.getDecrypted(userId);
    expect(dec?.apiKey).toBe("sk-secret");
  });

  it("upsert idempotent — second call updates", async () => {
    await svc.upsert(userId, { baseUrl: "https://a", apiKey: "k1", model: "m1", enabled: true });
    await svc.upsert(userId, { baseUrl: "https://b", apiKey: "k2", model: "m2", enabled: false });
    const dec = await svc.getDecrypted(userId);
    expect(dec?.baseUrl).toBe("https://b");
    expect(dec?.enabled).toBe(false);
  });

  it("delete removes the row", async () => {
    await svc.upsert(userId, { baseUrl: "https://x", apiKey: "k", model: "m", enabled: true });
    await svc.delete(userId);
    expect(await svc.getPublic(userId)).toBeNull();
  });

  it("delete throws when no row", async () => {
    await expect(svc.delete(userId)).rejects.toThrow();
  });
});
