import { describe, expect, it } from "vitest";
import { createJudgeRegistry } from "../registry.js";

const stubLlm = { runJudge: async () => ({ content: '{"score": 1, "reason": "ok"}' }) };

describe("judgeRegistry", () => {
  const r = createJudgeRegistry(stubLlm);
  it("dispatches to exact-match", async () => {
    expect(
      await r.apply({ kind: "exact-match" }, { question: "Q", expected: "A", answer: "A" }),
    ).toMatchObject({ passed: true });
  });
  it("dispatches to contains", async () => {
    expect(
      await r.apply(
        { kind: "contains", substrings: ["x"], mode: "all" },
        { question: "Q", expected: "", answer: "x" },
      ),
    ).toMatchObject({ passed: true });
  });
  it("dispatches to regex", async () => {
    expect(
      await r.apply(
        { kind: "regex", pattern: "^ok$" },
        { question: "Q", expected: "", answer: "ok" },
      ),
    ).toMatchObject({ passed: true });
  });
  it("dispatches to llm-judge", async () => {
    expect(
      await r.apply(
        { kind: "llm-judge", rubric: "rubric>10c.", scale: "0-1", passThreshold: 0.5 },
        { question: "Q", expected: "", answer: "x" },
      ),
    ).toMatchObject({ passed: true });
  });
});
