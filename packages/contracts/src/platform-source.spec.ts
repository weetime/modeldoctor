import { describe, expect, it } from "vitest";
import {
  createPlatformSourceSchema,
  DEFAULT_REGRESSION_THRESHOLDS,
  updateDiscoveredModelSchema,
} from "./platform-source.js";

describe("platform-source contracts", () => {
  it("createPlatformSourceSchema defaults kind to gpustack and strips trailing slash", () => {
    const r = createPlatformSourceSchema.parse({
      name: "prod",
      baseUrl: "http://gpustack.local/",
      apiKey: "gpustack_xxx",
    });
    expect(r.kind).toBe("gpustack");
    expect(r.baseUrl).toBe("http://gpustack.local");
  });

  it("rejects empty steps", () => {
    expect(updateDiscoveredModelSchema.safeParse({ steps: [] }).success).toBe(false);
  });

  it("rejects unknown step", () => {
    expect(updateDiscoveredModelSchema.safeParse({ steps: ["foo"] }).success).toBe(false);
  });

  it("exports default thresholds from spec", () => {
    expect(DEFAULT_REGRESSION_THRESHOLDS).toEqual({
      outputTokensPerSecDropPct: 10,
      ttftP95RisePct: 15,
      itlP95RisePct: 15,
    });
  });
});
