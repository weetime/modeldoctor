import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./prompts.js";

it("returns base unchanged for empty fragment", () => {
  const empty = buildSystemPrompt("zh-CN", "");
  expect(empty).not.toContain("场景专项要求");
});
it("appends the scenario fragment under a header", () => {
  const out = buildSystemPrompt("zh-CN", "命中率优先");
  expect(out).toContain("场景专项要求");
  expect(out).toContain("命中率优先");
});
it("uses the English header for en-US", () => {
  const out = buildSystemPrompt("en-US", "lead with hit rate");
  expect(out).toContain("Scenario guidance");
  expect(out).toContain("lead with hit rate");
});
