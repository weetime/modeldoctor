import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const validNarrative = {
  schemaVersion: 2,
  locale: "zh-CN",
  hero: {
    eyebrow: "MODELDOCTOR · 双 stage 对比",
    title: "stage B 吞吐 3.8 req/s 领先 stage A 27%",
    subtitle:
      "对比 A / B 两个 stage 的 guidellm 跑测,B 吞吐 3.8 req/s 比 A 3.0 高 27%,但 B 错误率 1% 非零。",
    metaItems: [{ label: "tool", value: "guidellm" }],
  },
  summaryCards: [
    {
      label: "stage B 吞吐",
      value: "3.8",
      unit: "req/s",
      tone: "success",
      trend: "领先 A 27%",
    },
    {
      label: "stage B 错误率",
      value: "1.0",
      unit: "%",
      tone: "danger",
      foot: "10/1000 失败",
    },
  ],
  sections: [
    {
      id: "summary",
      num: "01",
      title: "stage B 吞吐 3.8 req/s 领先 A 27%,但错误率 1%",
      bodyMarkdown:
        "stage B 吞吐 3.8 req/s 比 A 3.0 高 27%。\n\nB 错误率 1.0%,A 0.0%,B 在压力档出现少量失败。\n\nTTFT 与 E2E 三档百分位 B 全面更低。",
    },
    {
      id: "scope",
      num: "02",
      title: "本次对比聚焦 A / B 两 stage 的吞吐与错误率",
      bodyMarkdown: "对比 guidellm inference scenario 下两个 stage 的吞吐与延迟。",
    },
    {
      id: "method",
      num: "03",
      title: "硬件与工具固定:guidellm + inference + 同 1000 req 样本",
      bodyMarkdown: "工具 guidellm,scenario inference,每 stage 1000 请求。",
    },
    {
      id: "results",
      num: "04",
      title: "stage B 在 TTFT / E2E / 吞吐三项均领先",
      bodyMarkdown:
        "stage B 吞吐 3.8 req/s,A 3.0,B 高 27%。\n\nTTFT p50 B 80 ms 比 A 100 ms 低 20 ms。\n\nE2E p99 B 2700 ms 比 A 3000 ms 低 10%。",
    },
    {
      id: "caveats",
      num: "05",
      title: "B 错误率 1% 非零,稳态性需复测确认",
      bodyMarkdown: "B 有 10/1000 失败,A 0。建议加跑一次窗口确认非偶发。",
    },
    {
      id: "advice",
      num: "06",
      title: "吞吐优先选 B,SLO 严格场景仍建议 A",
      bodyMarkdown: "吞吐优先 → B。错误率 0 要求 → A。",
    },
  ],
  figures: [{ id: "f1", refId: "compare-grid", caption: "B 在四项指标全面领先 A。" }],
  lintWarnings: [],
};

vi.mock("../insights/llm-client.js", () => ({
  chatCompletion: vi.fn(async () => ({
    content: JSON.stringify(validNarrative),
    latencyMs: 100,
  })),
}));

import { PrismaService } from "../../database/prisma.service.js";
import { LlmJudgeService } from "../llm-judge/llm-judge.service.js";
import { CompareSynthesizeService } from "./compare-synthesize.service.js";
import { buildSystemPrompt } from "./prompts.js";
import { getReportProfile, resolveReportIntent } from "./report-scenarios/index.js";
import { SavedComparesService } from "./saved-compares.service.js";

it("lb compare yields a hit-rate-led system prompt", () => {
  const intent = resolveReportIntent("lb-strategy", 2);
  const sys = buildSystemPrompt("zh-CN", getReportProfile(intent).promptFragment("zh-CN"));
  expect(sys).toContain("命中率");
  expect(sys).toContain("场景专项要求");
});

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

  it("calls LLM and persists narrative in new schema", async () => {
    const r = await svc.synthesize(userId, savedCompareId, { locale: "zh-CN" });
    expect(r.narrative.schemaVersion).toBe(2);
    expect(r.narrative.hero.title).toContain("3.8");
    expect(r.narrative.sections).toHaveLength(6);
    expect(r.narrative.sections.map((s) => s.id)).toEqual([
      "summary",
      "scope",
      "method",
      "results",
      "caveats",
      "advice",
    ]);
    expect(r.fromCache).toBe(false);
    const refreshed = await prisma.savedCompare.findUnique({ where: { id: savedCompareId } });
    expect(refreshed?.narrative).not.toBeNull();
  });

  it("returns cached on second call", async () => {
    await svc.synthesize(userId, savedCompareId, { locale: "zh-CN" });
    const r = await svc.synthesize(userId, savedCompareId, { locale: "zh-CN" });
    expect(r.fromCache).toBe(true);
  });

  // ensurePrefixCacheFigures is a private server-control step; test it directly
  // (no DB / LLM) so the figure-cap behavior is pinned regardless of the model.
  describe("ensurePrefixCacheFigures", () => {
    const pcRun = {
      missing: false,
      summaryMetrics: null,
      serverMetrics: {
        prefixCache: {
          hitRatePct: 80,
          topPodSharePct: 50,
          perPod: [{ pod: "p1", queries: 100, hits: 80 }],
          metricTag: "v1",
        },
      },
    };
    const scWithPrefixCache = { benchmarks: [pcRun, pcRun] };
    const fig = (i: number) => ({ id: `f${i}`, refId: "compare-grid" as const, caption: `c${i}` });

    it("injects the hit-rate figure when the LLM omitted it", () => {
      const out = (
        svc as never as {
          ensurePrefixCacheFigures: (f: unknown, sc: unknown, l: string) => { refId: string }[];
        }
      ).ensurePrefixCacheFigures([fig(0)], scWithPrefixCache, "zh-CN");
      expect(out).toHaveLength(2);
      expect(out.at(-1)?.refId).toBe("stage-bars-prefix-cache-hit");
    });

    it("caps at the 8-figure schema limit, dropping the LLM's last figure (not ours)", () => {
      const eight = Array.from({ length: 8 }, (_, i) => fig(i));
      const out = (
        svc as never as {
          ensurePrefixCacheFigures: (f: unknown, sc: unknown, l: string) => { refId: string }[];
        }
      ).ensurePrefixCacheFigures(eight, scWithPrefixCache, "zh-CN");
      expect(out).toHaveLength(8);
      expect(out.at(-1)?.refId).toBe("stage-bars-prefix-cache-hit");
    });

    it("is a no-op when the runs carry no prefix-cache annotation", () => {
      const plain = { benchmarks: [{ missing: false, summaryMetrics: null }] };
      const input = [fig(0)];
      const out = (
        svc as never as {
          ensurePrefixCacheFigures: (f: unknown, sc: unknown, l: string) => unknown[];
        }
      ).ensurePrefixCacheFigures(input, plain, "zh-CN");
      expect(out).toBe(input);
    });
  });
});
