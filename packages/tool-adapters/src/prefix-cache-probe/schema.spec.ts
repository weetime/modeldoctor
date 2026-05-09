import { describe, expect, it } from "vitest";
import {
  prefixCacheProbeParamDefaults,
  prefixCacheProbeParamsSchema,
  prefixCacheProbeReportSchema,
} from "./schema.js";

describe("prefixCacheProbeParamsSchema", () => {
  it("applies defaults", () => {
    const r = prefixCacheProbeParamsSchema.parse({});
    expect(r.promptSets).toBe(2);
    expect(r.requestsPerSet).toBe(10);
    expect(r.maxTokens).toBe(5);
    expect(r.promBackoffSec).toBe(18);
  });

  it("rejects promptSets < 2", () => {
    expect(() => prefixCacheProbeParamsSchema.parse({ promptSets: 1 })).toThrow();
  });

  it("rejects promptSets > 5", () => {
    expect(() => prefixCacheProbeParamsSchema.parse({ promptSets: 6 })).toThrow();
  });

  it("rejects promBackoffSec < 15", () => {
    expect(() => prefixCacheProbeParamsSchema.parse({ promBackoffSec: 14 })).toThrow();
  });

  it("matches paramDefaults", () => {
    const parsed = prefixCacheProbeParamsSchema.parse({});
    expect(parsed).toMatchObject(prefixCacheProbeParamDefaults);
  });
});

describe("prefixCacheProbeReportSchema", () => {
  it("accepts a well-formed report", () => {
    const r = prefixCacheProbeReportSchema.parse({
      stickinessPct: 100,
      deterministic: true,
      perPod: [{ pod: "vllm-0", queries: 50, hits: 40 }],
      promptSets: [{ label: "set-0", dominantPod: "vllm-0", dominantPct: 100, totalRequests: 10 }],
    });
    expect(r.stickinessPct).toBe(100);
  });

  it("rejects stickinessPct out of [0, 100]", () => {
    expect(() =>
      prefixCacheProbeReportSchema.parse({
        stickinessPct: 101,
        deterministic: true,
        perPod: [],
        promptSets: [],
      }),
    ).toThrow();
  });
});
