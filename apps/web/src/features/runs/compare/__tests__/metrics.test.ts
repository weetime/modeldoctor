import type { Run, RunTool } from "@modeldoctor/contracts";
import { describe, expect, it } from "vitest";
import { readErrorRate, readP95Latency, readThroughput, rowDescriptorsForTool } from "../metrics";

const guidellmMetrics: Run["summaryMetrics"] = {
  tool: "guidellm",
  data: {
    e2eLatency: { mean: 100, p50: 95, p90: 130, p95: 491.2, p99: 600 },
    ttft: { mean: 80, p50: 75, p90: 100, p95: 150, p99: 200 },
    requestsPerSecond: { mean: 12.4 },
    requests: { total: 100, success: 95, error: 5, incomplete: 0 },
  },
} as unknown as Run["summaryMetrics"];

const vegetaMetrics: Run["summaryMetrics"] = {
  tool: "vegeta",
  data: {
    latencies: { min: 1, mean: 100, p50: 95, p90: 220, p95: 250.5, p99: 280, max: 300 },
    requests: { total: 1000, rate: 10, throughput: 9.8 },
    success: 98.5,
  },
} as unknown as Run["summaryMetrics"];

const genaiPerfMetrics: Run["summaryMetrics"] = {
  tool: "genai-perf",
  data: {
    requestLatency: { avg: 100, p50: 95, p90: 200, p95: 333.3, p99: 400 },
    requestThroughput: { avg: 50.2 },
    timeToFirstToken: { avg: 80, p50: 75, p90: 100, p95: 150, p99: 200 },
  },
} as unknown as Run["summaryMetrics"];

describe("readP95Latency", () => {
  it("reads guidellm.e2eLatency.p95", () => {
    expect(readP95Latency(guidellmMetrics)).toBe(491.2);
  });
  it("reads vegeta.latencies.p95", () => {
    expect(readP95Latency(vegetaMetrics)).toBe(250.5);
  });
  it("reads genai-perf.requestLatency.p95", () => {
    expect(readP95Latency(genaiPerfMetrics)).toBe(333.3);
  });
  it("returns null when metrics is null", () => {
    expect(readP95Latency(null)).toBeNull();
  });
  it("returns null on unknown tool", () => {
    expect(
      readP95Latency({ tool: "unknown", data: {} } as unknown as Run["summaryMetrics"]),
    ).toBeNull();
  });
});

describe("readErrorRate", () => {
  it("reads guidellm requests.error/total as 0..1 ratio", () => {
    expect(readErrorRate(guidellmMetrics)).toBeCloseTo(0.05, 6);
  });
  it("converts vegeta success percent to error ratio", () => {
    // success = 98.5% → error = 0.015
    expect(readErrorRate(vegetaMetrics)).toBeCloseTo(0.015, 6);
  });
  it("returns null for genai-perf (schema has no error field)", () => {
    expect(readErrorRate(genaiPerfMetrics)).toBeNull();
  });
  it("returns null when guidellm requests.total is 0", () => {
    const zero = {
      tool: "guidellm",
      data: { requests: { total: 0, error: 0 } },
    } as unknown as Run["summaryMetrics"];
    expect(readErrorRate(zero)).toBeNull();
  });
});

describe("readThroughput", () => {
  it("reads guidellm.requestsPerSecond.mean", () => {
    expect(readThroughput(guidellmMetrics)).toBe(12.4);
  });
  it("reads vegeta.requests.throughput", () => {
    expect(readThroughput(vegetaMetrics)).toBe(9.8);
  });
  it("reads genai-perf.requestThroughput.avg", () => {
    expect(readThroughput(genaiPerfMetrics)).toBe(50.2);
  });
  it("returns null when missing", () => {
    expect(readThroughput(null)).toBeNull();
  });
});

describe("rowDescriptorsForTool", () => {
  it("returns guidellm full row set including verdict-eligible flags", () => {
    const rows = rowDescriptorsForTool("guidellm" as RunTool);
    const verdictRows = rows.filter((r) => r.verdictKind !== undefined);
    // p95Latency, errorRate, throughput (3 verdict-eligible rows)
    expect(verdictRows).toHaveLength(3);
    expect(verdictRows.map((r) => r.verdictKind).sort()).toEqual([
      "errorRate",
      "latency",
      "throughput",
    ]);
    // Total row count: each tool has its own complete metric list
    expect(rows.length).toBeGreaterThanOrEqual(verdictRows.length);
  });

  it("returns vegeta row set without TTFT/ITL rows", () => {
    const rows = rowDescriptorsForTool("vegeta" as RunTool);
    expect(rows.find((r) => r.labelKey === "ttftP95")).toBeUndefined();
  });

  it("returns genai-perf row set without errorRate row (schema has no error)", () => {
    const rows = rowDescriptorsForTool("genai-perf" as RunTool);
    expect(rows.find((r) => r.labelKey === "errorRate")).toBeUndefined();
  });

  it("returns empty array for unknown tool", () => {
    expect(rowDescriptorsForTool("e2e" as RunTool)).toEqual([]);
  });
});
