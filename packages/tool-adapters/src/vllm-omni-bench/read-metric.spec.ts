import { describe, expect, it } from "vitest";
import { vllmOmniBenchReadMetric } from "./read-metric.js";

const data = {
  curve: [
    { arm: "audio", concurrency: 1, status: "ok", reqPerSec: 0.5, outTokPerSec: 100,
      ttftMs: { mean: 66, p50: 60, p99: 120 }, e2elMs: { mean: 8000, p50: 7900, p99: 9000 },
      audioTtfpMs: { mean: 511, p50: 490, p99: 900 }, audioRtf: { mean: 0.19, p50: 0.18, p99: 0.3 } },
    { arm: "audio", concurrency: 32, status: "ok", reqPerSec: 0.61, outTokPerSec: 140,
      ttftMs: { mean: 106, p50: 98, p99: 357 }, e2elMs: { mean: 9800, p50: 9500, p99: 12000 },
      audioTtfpMs: { mean: 2870, p50: 2500, p99: 3804 }, audioRtf: { mean: 0.54, p50: 0.5, p99: 0.9 } },
    { arm: "audio", concurrency: 64, status: "failed", reqPerSec: null, outTokPerSec: null,
      ttftMs: null, e2elMs: null, audioTtfpMs: null, audioRtf: null },
    { arm: "text", concurrency: 32, status: "ok", reqPerSec: 0.9, outTokPerSec: 200,
      ttftMs: { mean: 80, p50: 70, p99: 200 }, e2elMs: { mean: 5000, p50: 4800, p99: 7000 },
      audioTtfpMs: null, audioRtf: null },
  ],
  derived: { realtimeCeiling: 32, peakConcurrency: 32,
    voiceTaxMsByLevel: { "32": 4800 }, voiceTaxMs: 4800 },
  warnings: [],
} as unknown as Record<string, unknown>;

describe("vllmOmniBenchReadMetric", () => {
  it("omni kinds", () => {
    expect(vllmOmniBenchReadMetric("realtimeCeiling", data)).toBe(32);
    expect(vllmOmniBenchReadMetric("audioTtfpC1.mean", data)).toBe(511);
    expect(vllmOmniBenchReadMetric("audioTtfpPeak.p99", data)).toBe(3804);
    expect(vllmOmniBenchReadMetric("audioRtfPeak.mean", data)).toBe(0.54);
    expect(vllmOmniBenchReadMetric("voiceTax.ms", data)).toBe(4800);
  });
  it("standard kinds resolve at the peak audio point", () => {
    expect(vllmOmniBenchReadMetric("ttft.p50", data)).toBe(98);
    expect(vllmOmniBenchReadMetric("ttft.p99", data)).toBe(357);
    expect(vllmOmniBenchReadMetric("e2e.p99", data)).toBe(12000);
    expect(vllmOmniBenchReadMetric("requestsPerSec", data)).toBe(0.61);
    expect(vllmOmniBenchReadMetric("outputTokensPerSec", data)).toBe(140);
  });
  it("errorRate = failed points / total points", () => {
    expect(vllmOmniBenchReadMetric("errorRate", data)).toBe(0.25);
  });
  it("bench 只出 p50/p99 → p90/p95 为 null;无对应点也为 null", () => {
    expect(vllmOmniBenchReadMetric("ttft.p95", data)).toBeNull();
    expect(vllmOmniBenchReadMetric("itl.p50", data)).toBeNull();
  });
});
