import { describe, expect, it } from "vitest";
import { ALL_CHECKS, getCheck } from "../checks/descriptors";

describe("ALL_CHECKS", () => {
  it("contains expected check IDs across scenarios", () => {
    const ids = ALL_CHECKS.map((c) => c.id);
    expect(ids).toContain("inference.ttft.p95.ms");
    expect(ids).toContain("inference.error_rate");
    expect(ids).toContain("capacity.max_qps");
    expect(ids).toContain("gateway.error_rate");
  });

  it("every check has a stable id and a recommendationKey", () => {
    for (const c of ALL_CHECKS) {
      expect(c.id).toMatch(/^[a-z]+\.[a-z_.]+/);
      expect(c.recommendationKey).toContain(c.id);
    }
  });

  it("getCheck looks up by id", () => {
    const c = getCheck("inference.ttft.p95.ms");
    expect(c?.scenario).toBe("inference");
    expect(c?.axis).toBe("responsiveness");
    expect(c?.direction).toBe("lower_is_better");
  });

  it("returns undefined for unknown id", () => {
    expect(getCheck("nope")).toBeUndefined();
  });
});
