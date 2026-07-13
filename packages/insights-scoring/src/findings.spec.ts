import type { ProfileRules } from "@modeldoctor/contracts";
import { describe, expect, it } from "vitest";
import { bandFromScore, buildFindingsCore, type RunLike } from "./findings.js";

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
describe("bandFromScore", () => {
  it("bands by threshold", () => {
    expect(bandFromScore(90)).toBe("recommended");
    expect(bandFromScore(70)).toBe("usable");
    expect(bandFromScore(40)).toBe("not-recommended");
    expect(bandFromScore(null)).toBeNull();
  });
});
