import type { Run } from "@modeldoctor/contracts";
import type { GuidellmReport } from "@modeldoctor/tool-adapters";
import { describe, expect, it } from "vitest";
import {
  guidellmReportToLegacyMetricsSummary,
  legacyCreateToCreateRun,
  runToBenchmarkRun,
  runToBenchmarkRunSummary,
} from "./benchmark-facade.mappers.js";

function makeRun(over: Partial<Run> = {}): Run {
  return {
    id: "r1",
    userId: "u1",
    connectionId: "conn-1",
    connection: { id: "conn-1", name: "conn" },
    kind: "benchmark",
    tool: "guidellm",
    scenario: { apiBaseUrl: "https://upstream/", model: "m" },
    mode: "fixed",
    driverKind: "local",
    name: "n",
    description: null,
    status: "submitted",
    statusMessage: null,
    progress: null,
    driverHandle: "subprocess:1",
    params: {
      profile: "throughput",
      apiType: "chat",
      datasetName: "random",
      datasetInputTokens: 1024,
      datasetOutputTokens: 128,
      requestRate: 0,
      totalRequests: 1000,
    },
    rawOutput: null,
    summaryMetrics: null,
    serverMetrics: null,
    templateId: null,
    templateVersion: null,
    parentRunId: null,
    baselineId: null,
    baselineFor: null,
    logs: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
    ...over,
  };
}

describe("legacyCreateToCreateRun", () => {
  it("translates a CreateBenchmarkRequest into a CreateRunRequest with tool=guidellm, kind=benchmark", () => {
    const out = legacyCreateToCreateRun({
      connectionId: "conn-1",
      name: "n",
      description: "d",
      profile: "throughput",
      apiType: "chat",
      datasetName: "random",
      datasetInputTokens: 1024,
      datasetOutputTokens: 128,
      datasetSeed: 42,
      requestRate: 0,
      totalRequests: 1000,
    });

    expect(out.tool).toBe("guidellm");
    expect(out.kind).toBe("benchmark");
    expect(out.connectionId).toBe("conn-1");
    expect(out.name).toBe("n");
    expect(out.description).toBe("d");
    expect(out.params).toMatchObject({
      profile: "throughput",
      apiType: "chat",
      datasetName: "random",
      datasetInputTokens: 1024,
      datasetOutputTokens: 128,
      datasetSeed: 42,
      requestRate: 0,
      totalRequests: 1000,
    });
  });

  it("omits dataset token/seed fields when not provided (sharegpt)", () => {
    const out = legacyCreateToCreateRun({
      connectionId: "conn-1",
      name: "n",
      profile: "sharegpt",
      apiType: "chat",
      datasetName: "sharegpt",
      requestRate: 0,
      totalRequests: 100,
    });

    expect(out.params).not.toHaveProperty("datasetInputTokens");
    expect(out.params).not.toHaveProperty("datasetOutputTokens");
    expect(out.params).not.toHaveProperty("datasetSeed");
  });
});

describe("runToBenchmarkRun", () => {
  it("maps params + scenario fields onto the legacy DTO", () => {
    const out = runToBenchmarkRun(makeRun());

    expect(out.id).toBe("r1");
    expect(out.profile).toBe("throughput");
    expect(out.apiType).toBe("chat");
    expect(out.apiBaseUrl).toBe("https://upstream/");
    expect(out.model).toBe("m");
    expect(out.datasetName).toBe("random");
    expect(out.datasetInputTokens).toBe(1024);
    expect(out.datasetOutputTokens).toBe(128);
    expect(out.requestRate).toBe(0);
    expect(out.totalRequests).toBe(1000);
    expect(out.state).toBe("submitted");
    expect(out.jobName).toBe("subprocess:1");
    expect(out.metricsSummary).toBeNull();
  });

  it("falls back to safe defaults when params/scenario are sparse", () => {
    const out = runToBenchmarkRun(
      makeRun({
        scenario: {},
        params: {},
        name: null,
        connectionId: null,
      }),
    );

    expect(out.profile).toBe("custom");
    expect(out.apiType).toBe("chat");
    expect(out.apiBaseUrl).toBe("");
    expect(out.model).toBe("");
    expect(out.datasetName).toBe("random");
    expect(out.datasetInputTokens).toBeNull();
    expect(out.datasetOutputTokens).toBeNull();
    expect(out.datasetSeed).toBeNull();
    expect(out.requestRate).toBe(0);
    expect(out.totalRequests).toBe(0);
    expect(out.name).toBe("");
    expect(out.connectionId).toBeNull();
  });

  it("unwraps {tool,data} envelope when summaryMetrics is wrapped", () => {
    const report: GuidellmReport = {
      ttft: { mean: 10, p50: 9, p90: 14, p95: 15, p99: 20 },
      itl: { mean: 5, p50: 4, p90: 7, p95: 8, p99: 11 },
      e2eLatency: { mean: 100, p50: 95, p90: 130, p95: 150, p99: 200 },
      requestsPerSecond: { mean: 2 },
      outputTokensPerSecond: { mean: 200 },
      inputTokensPerSecond: { mean: 100 },
      totalTokensPerSecond: { mean: 300 },
      concurrency: { mean: 4, max: 8 },
      requests: { total: 100, success: 99, error: 1, incomplete: 0 },
    };
    const out = runToBenchmarkRun(
      makeRun({
        summaryMetrics: { tool: "guidellm", data: report },
      }),
    );

    expect(out.metricsSummary).not.toBeNull();
    expect(out.metricsSummary?.ttft.p95).toBe(15);
    // p90 must be stripped — legacy contract has no p90.
    expect(out.metricsSummary?.ttft).not.toHaveProperty("p90");
  });
});

describe("runToBenchmarkRunSummary", () => {
  it("returns the lighter projection (no jobName/raw/logs)", () => {
    const out = runToBenchmarkRunSummary(makeRun());
    expect(out).toMatchObject({
      id: "r1",
      profile: "throughput",
      apiType: "chat",
      datasetName: "random",
      state: "submitted",
    });
    expect(out).not.toHaveProperty("jobName");
    expect(out).not.toHaveProperty("logs");
    expect(out).not.toHaveProperty("rawMetrics");
  });
});

describe("guidellmReportToLegacyMetricsSummary", () => {
  it("strips p90 from each distribution and preserves throughput fields", () => {
    const report: GuidellmReport = {
      ttft: { mean: 10, p50: 9, p90: 14, p95: 15, p99: 20 },
      itl: { mean: 5, p50: 4, p90: 7, p95: 8, p99: 11 },
      e2eLatency: { mean: 100, p50: 95, p90: 130, p95: 150, p99: 200 },
      requestsPerSecond: { mean: 2 },
      outputTokensPerSecond: { mean: 200 },
      inputTokensPerSecond: { mean: 100 },
      totalTokensPerSecond: { mean: 300 },
      concurrency: { mean: 4, max: 8 },
      requests: { total: 100, success: 99, error: 1, incomplete: 0 },
    };
    const out = guidellmReportToLegacyMetricsSummary(report);
    expect(out.ttft).toEqual({ mean: 10, p50: 9, p95: 15, p99: 20 });
    expect(out.itl).toEqual({ mean: 5, p50: 4, p95: 8, p99: 11 });
    expect(out.e2eLatency).toEqual({ mean: 100, p50: 95, p95: 150, p99: 200 });
    expect(out.requestsPerSecond.mean).toBe(2);
    expect(out.concurrency.max).toBe(8);
    expect(out.requests.total).toBe(100);
  });
});
