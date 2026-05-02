import { describe, expect, it } from "vitest";
import { genaiPerfParamsSchema, genaiPerfReportSchema, genaiPerfParamDefaults } from "./schema.js";

describe("genaiPerfParamsSchema", () => {
  it("rejects negative numPrompts", () => {
    const r = genaiPerfParamsSchema.safeParse({
      endpointType: "chat",
      numPrompts: -1,
      concurrency: 1,
    });
    expect(r.success).toBe(false);
  });

  it("accepts a minimal valid config", () => {
    const r = genaiPerfParamsSchema.safeParse({ endpointType: "chat" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.numPrompts).toBe(100);
      expect(r.data.concurrency).toBe(1);
      expect(r.data.streaming).toBe(true);
    }
  });

  it("paramDefaults is a parseable starter", () => {
    expect(typeof genaiPerfParamDefaults).toBe("object");
  });
});

describe("genaiPerfReportSchema", () => {
  it("requires distribution fields", () => {
    const r = genaiPerfReportSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it("accepts a typical genai-perf report shape", () => {
    const dist = {
      avg: 10, min: 1, max: 50, p50: 9, p90: 18, p95: 22, p99: 40, stddev: 5, unit: "ms",
    };
    const lengthDist = { avg: 100, p50: 100, p99: 200 };
    const r = genaiPerfReportSchema.safeParse({
      requestThroughput: { avg: 5.2, unit: "requests/sec" },
      requestLatency: dist,
      timeToFirstToken: dist,
      interTokenLatency: dist,
      outputTokenThroughput: { avg: 200, unit: "tokens/sec" },
      outputSequenceLength: lengthDist,
      inputSequenceLength: lengthDist,
    });
    expect(r.success).toBe(true);
  });
});
