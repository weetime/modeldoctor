import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../insights/llm-client.js", () => ({
  chatCompletion: vi.fn(async () => ({
    content: JSON.stringify({
      tldr: [{ headline: "QPS 提升", oneLine: "Y-CPU QPS 比 baseline 高 27%" }],
      analysis: [{ metricLabel: "QPS", body: "缓存命中提高使 prefill 减少。" }],
      conclusion: { recommendation: "在低错误率优先场景推荐 LMCache。", caveats: [] },
    }),
    latencyMs: 100,
  })),
}));

import { PrismaService } from "../../database/prisma.service.js";
import { LlmJudgeService } from "../llm-judge/llm-judge.service.js";
import { CompareSynthesizeService } from "./compare-synthesize.service.js";
import { SavedComparesService } from "./saved-compares.service.js";

describe("CompareSynthesizeService", () => {
  let svc: CompareSynthesizeService;
  let prisma: PrismaService;
  let userId: string;
  let savedCompareId: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        CompareSynthesizeService,
        SavedComparesService,
        PrismaService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => (key === "DATABASE_URL" ? process.env.DATABASE_URL : undefined),
          },
        },
        {
          provide: LlmJudgeService,
          useValue: {
            getDecrypted: vi.fn(async () => ({
              id: "p",
              baseUrl: "http://x",
              model: "gpt-4",
              enabled: true,
              apiKey: "sk-test",
            })),
          },
        },
      ],
    }).compile();
    svc = mod.get(CompareSynthesizeService);
    prisma = mod.get(PrismaService);
    await prisma.$connect();
  });

  beforeEach(async () => {
    await prisma.savedCompare.deleteMany();
    await prisma.benchmark.deleteMany();
    await prisma.user.deleteMany();
    const u = await prisma.user.create({
      data: { email: `s-${Date.now()}@x`, passwordHash: "x" },
    });
    userId = u.id;
    const b1 = await prisma.benchmark.create({
      data: {
        userId,
        scenario: "inference",
        tool: "guidellm",
        name: "r1",
        params: {},
        summaryMetrics: {
          tool: "guidellm",
          data: {
            ttft: { p50: 100, p90: 200, p99: 500 },
            e2eLatency: { p50: 800, p90: 1500, p99: 3000 },
            requestsPerSecond: { mean: 3 },
            requests: { total: 1000, error: 0 },
          },
        },
      },
    });
    const b2 = await prisma.benchmark.create({
      data: {
        userId,
        scenario: "inference",
        tool: "guidellm",
        name: "r2",
        params: {},
        summaryMetrics: {
          tool: "guidellm",
          data: {
            ttft: { p50: 80, p90: 160, p99: 400 },
            e2eLatency: { p50: 700, p90: 1300, p99: 2700 },
            requestsPerSecond: { mean: 3.8 },
            requests: { total: 1000, error: 10 },
          },
        },
      },
    });
    const sc = await prisma.savedCompare.create({
      data: {
        userId,
        name: "n",
        benchmarkIds: [b1.id, b2.id],
        stageLabels: { [b1.id]: "A", [b2.id]: "B" },
        baselineId: b1.id,
      },
    });
    savedCompareId = sc.id;
  });

  it("calls LLM and persists narrative", async () => {
    const r = await svc.synthesize(userId, savedCompareId, { locale: "zh-CN" });
    expect(r.narrative.tldr).toHaveLength(1);
    expect(r.fromCache).toBe(false);
    const refreshed = await prisma.savedCompare.findUnique({ where: { id: savedCompareId } });
    expect(refreshed?.narrative).not.toBeNull();
  });

  it("returns cached on second call", async () => {
    await svc.synthesize(userId, savedCompareId, { locale: "zh-CN" });
    const r = await svc.synthesize(userId, savedCompareId, { locale: "zh-CN" });
    expect(r.fromCache).toBe(true);
  });
});
