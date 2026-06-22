import { describe, expect, it } from "vitest";
import { figureRefIdSchema } from "./compare-narrative.js";

it("accepts the new phase-1 refIds", () => {
  for (const r of ["pod-traffic-distribution", "pod-hit-rate", "cold-warm-delta"]) {
    expect(figureRefIdSchema.parse(r)).toBe(r);
  }
});

it("accepts the latency-distribution refId", () => {
  expect(figureRefIdSchema.parse("latency-distribution")).toBe("latency-distribution");
});
