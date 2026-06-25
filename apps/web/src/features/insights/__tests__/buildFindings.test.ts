import type { Benchmark, ProfileRules } from "@modeldoctor/contracts";
import { describe, expect, it } from "vitest";
import { aggregateCheck, buildFindings } from "../buildFindings";
import { getCheck } from "../checks/descriptors";

function run(p: Partial<Benchmark> & { id: string; summaryMetrics: any }): Benchmark {
  return {
    id: p.id,
    userId: "u1",
    connectionId: "c1",
    connection: null,
    scenario: p.scenario ?? "inference",
    tool: p.tool ?? "guidellm",
    toolVersion: null,
    name: p.id,
    label: null,
    description: null,
    status: "completed",
    statusMessage: null,
    progress: null,
    driverHandle: null,
    params: {},
    rawOutput: null,
    summaryMetrics: p.summaryMetrics,
    serverMetrics: null,
    templateId: null,
    parentBenchmarkId: null,
    baselineId: null,
    logs: null,
    createdAt: "2026-05-01T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
    baselineFor: null,
  } as Benchmark;
}

const guidellmMetrics = (ttft_p95: number) => ({
  tool: "guidellm",
  data: {
    ttft: { p95: ttft_p95, p99: ttft_p95 * 1.3 },
    e2eLatency: { p95: 2000, p99: 4000 },
    requests: { total: 1000, error: 5 },
    requestsPerSecond: { mean: 12 },
  },
});

describe("aggregateCheck", () => {
  it("returns null when no completed runs match", () => {
    const c = getCheck("inference.ttft.p95.ms");
    if (!c) throw new Error("expected check");
    const v = aggregateCheck(c, [run({ id: "r1", summaryMetrics: null, status: "failed" } as any)]);
    expect(v).toBeNull();
  });

  it("returns median across runs", () => {
    const c = getCheck("inference.ttft.p95.ms");
    if (!c) throw new Error("expected check");
    const runs = [
      run({ id: "r1", summaryMetrics: guidellmMetrics(100) }),
      run({ id: "r2", summaryMetrics: guidellmMetrics(300) }),
      run({ id: "r3", summaryMetrics: guidellmMetrics(500) }),
    ];
    expect(aggregateCheck(c, runs)).toBe(300);
  });

  it("respects toolFilter", () => {
    const c = getCheck("inference.itl.p95.ms"); // guidellm-only
    if (!c) throw new Error("expected check");
    const runs = [run({ id: "r1", tool: "vegeta", summaryMetrics: { tool: "vegeta", data: {} } })];
    expect(aggregateCheck(c, runs)).toBeNull();
  });
});

describe("buildFindings", () => {
  const profileRules: ProfileRules = {
    checks: {
      "inference.ttft.p95.ms": { warn: 200, crit: 500, weight: 1.0 },
      "inference.error_rate": { warn: 0.01, crit: 0.05, weight: 1.0 },
    },
  };

  it("emits crit finding when value crosses crit threshold", () => {
    const runs = [run({ id: "r1", summaryMetrics: guidellmMetrics(800) })];
    const findings = buildFindings(runs, profileRules);
    const ttft = findings.find((f) => f.checkId === "inference.ttft.p95.ms");
    expect(ttft?.severity).toBe("crit");
    expect(ttft?.value).toBe(800);
  });

  it("emits no_data finding when check has no rule in profile", () => {
    const runs = [run({ id: "r1", summaryMetrics: guidellmMetrics(100) })];
    const findings = buildFindings(runs, { checks: {} });
    expect(findings.every((f) => f.severity === "no_data")).toBe(true);
  });

  it("populates contributingRunIds with the runs whose values were aggregated", () => {
    const runs = [
      run({ id: "r1", summaryMetrics: guidellmMetrics(100) }),
      run({ id: "r2", summaryMetrics: guidellmMetrics(300) }),
    ];
    const findings = buildFindings(runs, profileRules);
    const ttft = findings.find((f) => f.checkId === "inference.ttft.p95.ms");
    expect(ttft?.contributingRunIds).toEqual(["r1", "r2"]);
  });
});
