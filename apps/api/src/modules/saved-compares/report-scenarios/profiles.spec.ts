import { describe, expect, it } from "vitest";
import { getReportProfile, reportScenarioRegistry } from "./index.js";

it("every intent has a non-default profile except 'default'", () => {
  for (const [intent, profile] of Object.entries(reportScenarioRegistry)) {
    expect(profile.intent === intent || intent === "default").toBe(true);
  }
});
it("fragments are non-empty for real intents (both locales)", () => {
  for (const intent of ["lb-strategy", "engine-kv-cache", "capacity", "gateway", "inference-multi", "inference-single"] as const) {
    const p = getReportProfile(intent);
    expect(p.promptFragment("zh-CN").length).toBeGreaterThan(20);
    expect(p.promptFragment("en-US").length).toBeGreaterThan(20);
  }
});
