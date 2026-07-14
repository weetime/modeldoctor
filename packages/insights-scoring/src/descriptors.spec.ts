import { describe, expect, it } from "vitest";
import { ALL_CHECKS, getCheck } from "./descriptors.js";

describe("descriptors", () => {
  it("all checks have metricKind and known scenario", () => {
    expect(ALL_CHECKS.length).toBeGreaterThan(0);
    for (const c of ALL_CHECKS) {
      expect(c.metricKind).toBeTruthy();
      expect(["inference", "capacity", "gateway"]).toContain(c.scenario);
    }
  });

  it("getCheck resolves by id", () => {
    expect(getCheck("inference.ttft.p95.ms")?.axis).toBe("responsiveness");
  });
});
