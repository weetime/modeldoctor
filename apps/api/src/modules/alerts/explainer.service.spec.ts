import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import type { AlertEvent } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the LLM client before importing anything that closes over its module
// graph — chatCompletion is hit inside explainAsync, and we want to assert
// the explainer writes a row even when the Prom fetch returns null without
// reaching out to a real provider.
vi.mock("../insights/llm-client.js", () => ({
  chatCompletion: vi.fn(async () => ({
    content: JSON.stringify({
      ai_severity: "warning",
      narrative: "测试叙事。这段文字仅用于测试,长度满足 schema 最小约束二十个字符。\n\n第二段。",
      recommendations: ["第一步", "第二步"],
    }),
    latencyMs: 42,
  })),
}));

import { PrismaService } from "../../database/prisma.service.js";
import { LlmJudgeService } from "../llm-judge/llm-judge.service.js";
import { AlertExplainerService } from "./explainer.service.js";
import { type PromContext, PrometheusFetcherService } from "./prometheus-fetcher.service.js";
import { SubscribersService } from "./subscribers.service.js";

const TEST_KEY_B64 = Buffer.alloc(32, 7).toString("base64");

function makeEvent(over: Partial<AlertEvent> = {}): AlertEvent {
  return {
    id: "evt_1",
    fingerprint: "fp",
    status: "firing",
    severity: "warning",
    scenario: null,
    alertName: "HighLatency",
    connectionId: null,
    modelName: "m1",
    engine: null,
    instance: null,
    labels: {},
    annotations: {},
    rawPayload: {},
    startsAt: new Date("2026-05-18T14:30:00Z"),
    endsAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as AlertEvent;
}

function makeSnapshot(): PromContext {
  return {
    datasource: { id: "ds_1", name: "fake-prom" },
    expr: "ttft_p95",
    window: {
      start: "2026-05-18T14:15:00.000Z",
      end: "2026-05-18T14:35:00.000Z",
      stepSeconds: 15,
    },
    series: [
      {
        labels: { __name__: "ttft_p95", model_name: "m1" },
        summary: { min: 0.32, max: 0.61, mean: 0.47, last: 0.58 },
        samples: [
          { at: "2026-05-18T14:15:00.000Z", value: 0.32 },
          { at: "2026-05-18T14:30:00.000Z", value: 0.61 },
        ],
      },
    ],
  };
}

describe("AlertExplainerService — buildPrompt", () => {
  let svc: AlertExplainerService;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        AlertExplainerService,
        PrismaService,
        // Stub the surrounding deps — buildPrompt only consumes the
        // pre-built `BuiltContext`, so no DB or fetcher calls fire.
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === "DATABASE_URL"
                ? process.env.DATABASE_URL
                : key === "CONNECTION_API_KEY_ENCRYPTION_KEY"
                  ? TEST_KEY_B64
                  : undefined,
          },
        },
        {
          provide: LlmJudgeService,
          useValue: { getDecrypted: vi.fn(async () => null) },
        },
        {
          provide: SubscribersService,
          useValue: { findMatching: vi.fn(async () => []) },
        },
        {
          provide: PrometheusFetcherService,
          useValue: { fetchAlertContext: vi.fn(async () => null) },
        },
      ],
    }).compile();
    svc = mod.get(AlertExplainerService);
  });

  it("omits the 告警时段指标 section when promSnapshot is null", () => {
    const prompt = svc._test_buildPrompt(makeEvent(), {
      baseline: null,
      recentBenchmarks: [],
      promSnapshot: null,
    });
    expect(prompt).not.toContain("告警时段指标");
  });

  it("includes the section + datasource name + a numeric value when promSnapshot present", () => {
    const prompt = svc._test_buildPrompt(makeEvent(), {
      baseline: null,
      recentBenchmarks: [],
      promSnapshot: makeSnapshot(),
    });
    expect(prompt).toContain("告警时段指标");
    expect(prompt).toContain("fake-prom");
    // Numeric grounding token — the summary line emits min/max/mean/last
    // to 3 decimals, so 0.610 will appear verbatim from the fixture max.
    expect(prompt).toContain("0.610");
  });
});

describe("AlertExplainerService — explainAsync writes narrative even when Prom fetch fails", () => {
  let prisma: PrismaService;
  let svc: AlertExplainerService;
  let fetcher: { fetchAlertContext: ReturnType<typeof vi.fn> };

  beforeAll(async () => {
    fetcher = { fetchAlertContext: vi.fn(async () => null) };
    const mod = await Test.createTestingModule({
      providers: [
        AlertExplainerService,
        PrismaService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === "DATABASE_URL"
                ? process.env.DATABASE_URL
                : key === "CONNECTION_API_KEY_ENCRYPTION_KEY"
                  ? TEST_KEY_B64
                  : undefined,
          },
        },
        {
          provide: LlmJudgeService,
          useValue: {
            getDecrypted: vi.fn(async () => ({
              id: "judge_1",
              baseUrl: "http://x",
              apiKey: "sk",
              model: "gpt-4",
              enabled: true,
            })),
          },
        },
        {
          provide: SubscribersService,
          useValue: { findMatching: vi.fn(async () => []) },
        },
        { provide: PrometheusFetcherService, useValue: fetcher },
      ],
    }).compile();
    svc = mod.get(AlertExplainerService);
    prisma = mod.get(PrismaService);
    await prisma.$connect();
  });

  beforeEach(async () => {
    await prisma.alertExplanation.deleteMany();
    await prisma.alertEvent.deleteMany();
  });

  afterAll(async () => {
    await prisma.alertExplanation.deleteMany();
    await prisma.alertEvent.deleteMany();
    await prisma.$disconnect();
  });

  it("creates an alertExplanation row when promFetcher returns null", async () => {
    const event = await prisma.alertEvent.create({
      data: {
        fingerprint: "explainer-null-prom-fp",
        status: "firing",
        severity: "warning",
        alertName: "TestAlert",
        labels: {},
        annotations: {},
        rawPayload: {},
        startsAt: new Date("2026-05-18T14:30:00Z"),
      },
    });

    await svc.explainAsync(event.id);

    expect(fetcher.fetchAlertContext).toHaveBeenCalled();
    const row = await prisma.alertExplanation.findUnique({
      where: { alertEventId: event.id },
    });
    expect(row).not.toBeNull();
    expect(row?.narrative).toContain("测试叙事");
    expect(row?.aiSeverity).toBe("warning");
  });
});
