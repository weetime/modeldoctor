import { figureRefIdSchema } from "@modeldoctor/contracts";
import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./prompts.js";

// Drift guard: the `figures[].refId` union baked into the schema block the LLM
// fills MUST list every refId the zod schema accepts. When they diverge the
// model is told a refId is invalid and silently omits that figure — exactly how
// the engine bars (kv-cache / preemption / queue) went missing from generated
// reports despite being wired into FigureRenderer + preferredFigures (#330).
describe("prompt figure-refId union stays in sync with figureRefIdSchema", () => {
  it("mentions every schema refId in the system prompt", () => {
    const prompt = buildSystemPrompt("zh-CN", "");
    for (const refId of figureRefIdSchema.options) {
      expect(prompt, `prompt is missing refId "${refId}"`).toContain(refId);
    }
  });
});

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
