import { describe, expect, it } from "vitest";
import { kvCacheStressParamsSchema, kvCacheStressReportSchema } from "./schema.js";

describe("kvCacheStressParamsSchema", () => {
  it("applies defaults when no fields provided", () => {
    const parsed = kvCacheStressParamsSchema.parse({});
    expect(parsed.numSessions).toBe(200);
    expect(parsed.turns).toBe(4);
    expect(parsed.concurrency).toBe(25);
    expect(parsed.maxTokens).toBe(50);
    expect(parsed.durationSec).toBe(600);
    expect(parsed.systemPromptSeed).toBe("scn");
  });

  it("rejects durationSec below 30 (Prom counter delta too noisy)", () => {
    expect(() => kvCacheStressParamsSchema.parse({ durationSec: 10 })).toThrow();
  });

  it("rejects durationSec above 7200 (matches BENCHMARK_DEFAULT_MAX_DURATION ceiling)", () => {
    expect(() => kvCacheStressParamsSchema.parse({ durationSec: 9000 })).toThrow();
  });

  it("rejects numSessions above 2000 (memory pressure cliff)", () => {
    expect(() => kvCacheStressParamsSchema.parse({ numSessions: 5000 })).toThrow();
  });

  it("rejects concurrency above 256", () => {
    expect(() => kvCacheStressParamsSchema.parse({ concurrency: 512 })).toThrow();
  });

  it("rejects turns above 16 (context window blow-out)", () => {
    expect(() => kvCacheStressParamsSchema.parse({ turns: 32 })).toThrow();
  });

  it("accepts custom systemPromptSeed for reproducibility across runs", () => {
    const parsed = kvCacheStressParamsSchema.parse({ systemPromptSeed: "qwen3-32b-tier1" });
    expect(parsed.systemPromptSeed).toBe("qwen3-32b-tier1");
  });
});

describe("kvCacheStressReportSchema", () => {
  it("parses a full report (LMCache CPU baseline shape)", () => {
    const parsed = kvCacheStressReportSchema.parse({
      qps: 3.75,
      outputTps: 187.0,
      requestsOk: 2312,
      requestsErr: 0,
      errRatePct: 0.0,
      ttftMs: { p50: 757, p90: 2315, p99: 7729 },
      e2eMs: { p50: 5254, p90: 10424, p99: 22265 },
      prom: {
        hbmHitRatePct: 76.9,
        prefixCacheSavingsPct: 85.1,
      },
      backend: {
        nameGuess: "lmcache",
        counters: { "lmcache:num_retrieve_requests_total": 1368 },
      },
    });
    expect(parsed.qps).toBe(3.75);
    expect(parsed.prom.prefixCacheSavingsPct).toBe(85.1);
    expect(parsed.backend.nameGuess).toBe("lmcache");
  });

  it("accepts empty prom block (when prometheusUrl wasn't set)", () => {
    const parsed = kvCacheStressReportSchema.parse({
      qps: 3.5,
      outputTps: 175,
      requestsOk: 2000,
      requestsErr: 0,
      errRatePct: 0,
      ttftMs: { p50: 650, p90: 2300, p99: 7000 },
      e2eMs: { p50: 5000, p90: 10000, p99: 22000 },
      prom: {},
      backend: { nameGuess: "unknown", counters: {} },
    });
    expect(parsed.prom).toEqual({});
  });

  it("accepts backend nameGuess=yrcache with yrcache_* counters", () => {
    const parsed = kvCacheStressReportSchema.parse({
      qps: 3.39,
      outputTps: 168,
      requestsOk: 2087,
      requestsErr: 217,
      errRatePct: 9.4,
      ttftMs: { p50: 644, p90: 2060, p99: 8384 },
      e2eMs: { p50: 5953, p90: 9084, p99: 24324 },
      prom: { prefixCacheSavingsPct: 89.1 },
      backend: {
        nameGuess: "yrcache",
        counters: {
          yrcache_num_retrieve_requests_total: 642,
          yrcache_num_hit_tokens_total: 3798592,
        },
      },
    });
    expect(parsed.backend.nameGuess).toBe("yrcache");
  });

  it("rejects errRatePct outside [0, 100]", () => {
    expect(() =>
      kvCacheStressReportSchema.parse({
        qps: 1,
        outputTps: 1,
        requestsOk: 1,
        requestsErr: 0,
        errRatePct: 150,
        ttftMs: { p50: 1, p90: 1, p99: 1 },
        e2eMs: { p50: 1, p90: 1, p99: 1 },
        prom: {},
        backend: { nameGuess: "unknown", counters: {} },
      }),
    ).toThrow();
  });
});
