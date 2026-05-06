import { describe, expect, it } from "vitest";
import { readP95LatencyMs } from "./metrics.js";

describe("readP95LatencyMs", () => {
  it("reads guidellm e2eLatency.p95", () => {
    expect(
      readP95LatencyMs({
        tool: "guidellm",
        data: { e2eLatency: { p95: 491.2 } },
      }),
    ).toBe(491.2);
  });

  it("reads vegeta latencies.p95", () => {
    expect(
      readP95LatencyMs({
        tool: "vegeta",
        data: { latencies: { p95: 147 } },
      }),
    ).toBe(147);
  });

  it("reads genai-perf requestLatency.p95", () => {
    expect(
      readP95LatencyMs({
        tool: "genai-perf",
        data: { requestLatency: { p95: 220.5 } },
      }),
    ).toBe(220.5);
  });

  it("returns null when summaryMetrics is null", () => {
    expect(readP95LatencyMs(null)).toBeNull();
  });

  it("returns null when tool is unknown", () => {
    expect(
      readP95LatencyMs({
        tool: "unknown",
        data: { p95: 100 },
      }),
    ).toBeNull();
  });

  it("returns null when distribution missing", () => {
    expect(readP95LatencyMs({ tool: "guidellm", data: {} })).toBeNull();
  });

  it("returns null for non-finite values (NaN / Infinity)", () => {
    expect(
      readP95LatencyMs({
        tool: "vegeta",
        data: { latencies: { p95: Number.NaN } },
      }),
    ).toBeNull();
  });
});
