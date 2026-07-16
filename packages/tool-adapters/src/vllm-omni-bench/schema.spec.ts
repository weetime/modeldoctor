import { describe, expect, it } from "vitest";
import {
  vllmOmniBenchParamDefaults,
  vllmOmniBenchParamsSchema,
  vllmOmniBenchReportSchema,
} from "./schema.js";

describe("vllmOmniBenchParamsSchema", () => {
  it("defaults match the article methodology (levels 1/8/16/32, 500in/300out, voiceTax on)", () => {
    const p = vllmOmniBenchParamsSchema.parse({});
    expect(p.concurrencyLevels).toEqual([1, 8, 16, 32]);
    expect(p.inputTokens).toBe(500);
    expect(p.outputTokens).toBe(300);
    expect(p.voiceTax).toBe(true);
    expect(p.numWarmups).toBe(1);
    expect(p.perPointTimeoutSeconds).toBe(900);
  });
  it("rejects empty / oversized / duplicate concurrency levels", () => {
    expect(() => vllmOmniBenchParamsSchema.parse({ concurrencyLevels: [] })).toThrow();
    expect(() =>
      vllmOmniBenchParamsSchema.parse({ concurrencyLevels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }),
    ).toThrow();
    expect(() => vllmOmniBenchParamsSchema.parse({ concurrencyLevels: [8, 8] })).toThrow();
  });
  it("paramDefaults parse clean through the schema", () => {
    expect(() => vllmOmniBenchParamsSchema.parse(vllmOmniBenchParamDefaults)).not.toThrow();
  });
});

describe("vllmOmniBenchReportSchema", () => {
  it("accepts a two-arm curve with a failed point and null audio stats on the text arm", () => {
    const report = {
      curve: [
        {
          arm: "audio", concurrency: 1, status: "ok",
          reqPerSec: 0.5, outTokPerSec: 120,
          ttftMs: { mean: 66, p50: 60, p99: 120 },
          e2elMs: { mean: 8000, p50: 7900, p99: 9000 },
          audioTtfpMs: { mean: 511, p50: 490, p99: 900 },
          audioRtf: { mean: 0.19, p50: 0.18, p99: 0.3 },
        },
        {
          arm: "text", concurrency: 1, status: "ok",
          reqPerSec: 0.7, outTokPerSec: 140,
          ttftMs: { mean: 60, p50: 55, p99: 100 },
          e2elMs: { mean: 5000, p50: 4900, p99: 6000 },
          audioTtfpMs: null, audioRtf: null,
        },
        {
          arm: "audio", concurrency: 64, status: "failed",
          reqPerSec: null, outTokPerSec: null,
          ttftMs: null, e2elMs: null, audioTtfpMs: null, audioRtf: null,
        },
      ],
      derived: {
        realtimeCeiling: 1, peakConcurrency: 1,
        voiceTaxMsByLevel: { "1": 3000 }, voiceTaxMs: 3000,
      },
      warnings: ["arm=audio c=64: bench exited 1, point skipped"],
    };
    expect(() => vllmOmniBenchReportSchema.parse(report)).not.toThrow();
  });
});
