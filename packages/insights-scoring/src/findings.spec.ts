import type { ProfileRules } from "@modeldoctor/contracts";
import { describe, expect, it } from "vitest";
import {
  aggregateCheckDetailed,
  bandFromScore,
  buildFindingsCore,
  type RunLike,
} from "./findings.js";

const rules: ProfileRules = {
  checks: { "inference.ttft.p95.ms": { warn: 100, crit: 300, weight: 1 } },
};
const run = (metrics: unknown): RunLike => ({
  id: "r1",
  scenario: "inference",
  status: "completed",
  tool: "guidellm",
  summaryMetrics: metrics,
});
// reader that returns a fixed ttft.p95
const reader = (_k: unknown, _m: unknown) => 50; // good (<100)

describe("buildFindingsCore", () => {
  it("scores good when metric under warn", () => {
    const findings = buildFindingsCore([run({})], rules, reader as never);
    const ttft = findings.find((f) => f.checkId === "inference.ttft.p95.ms");
    expect(ttft?.severity).toBe("good");
    expect(ttft?.recommendation).toBe("");
  });
});
describe("aggregateCheckDetailed", () => {
  const check = { metricKind: "ttft.p95" as const, scenario: "inference", toolFilter: undefined };

  it("returns null value and no contributing runs when nothing matches", () => {
    const result = aggregateCheckDetailed(check, [], reader as never);
    expect(result).toEqual({ value: null, contributingRunIds: [] });
  });

  it("returns median value and contributing run ids across matching runs", () => {
    const runs: RunLike[] = [
      {
        id: "r1",
        scenario: "inference",
        status: "completed",
        tool: "guidellm",
        summaryMetrics: {},
      },
      {
        id: "r2",
        scenario: "inference",
        status: "completed",
        tool: "guidellm",
        summaryMetrics: {},
      },
    ];
    // reader always returns 50 here, so median is 50 and both runs contribute.
    const result = aggregateCheckDetailed(check, runs, reader as never);
    expect(result).toEqual({ value: 50, contributingRunIds: ["r1", "r2"] });
  });

  it("respects toolFilter", () => {
    const vegetaOnly = { ...check, toolFilter: ["vegeta"] };
    const runs: RunLike[] = [
      {
        id: "r1",
        scenario: "inference",
        status: "completed",
        tool: "guidellm",
        summaryMetrics: {},
      },
    ];
    expect(aggregateCheckDetailed(vegetaOnly, runs, reader as never)).toEqual({
      value: null,
      contributingRunIds: [],
    });
  });
});

describe("bandFromScore", () => {
  it("bands by threshold", () => {
    expect(bandFromScore(90)).toBe("recommended");
    expect(bandFromScore(70)).toBe("usable");
    expect(bandFromScore(40)).toBe("not-recommended");
    expect(bandFromScore(null)).toBeNull();
  });
});
