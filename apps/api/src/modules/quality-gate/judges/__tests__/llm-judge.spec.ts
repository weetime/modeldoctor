import { describe, expect, it, vi } from "vitest";
import { createLlmJudge } from "../llm-judge.js";

function stubService(response: { content: string }) {
  return { runJudge: vi.fn().mockResolvedValue(response) };
}

const ctx = { question: "Q", expected: "E", answer: "A" };

describe("llmJudge", () => {
  it("parses score+reason from JSON content", async () => {
    const svc = stubService({ content: '{"score": 4, "reason": "ok"}' });
    const judge = createLlmJudge(svc as never);
    const r = await judge.evaluate(
      { kind: "llm-judge", rubric: "ten char rubric.", scale: "0-5", passThreshold: 3 },
      ctx,
    );
    expect(r).toMatchObject({ passed: true, score: 4, reason: "ok" });
  });
  it("uses default threshold per scale", async () => {
    const svc = stubService({ content: '{"score": 2.5, "reason": "meh"}' });
    const judge = createLlmJudge(svc as never);
    const r = await judge.evaluate(
      { kind: "llm-judge", rubric: "ten char rubric.", scale: "0-5" },
      ctx,
    );
    expect(r.passed).toBe(false);
  });
  it("falls back to error on non-JSON content", async () => {
    const svc = stubService({ content: "not json" });
    const judge = createLlmJudge(svc as never);
    const r = await judge.evaluate(
      { kind: "llm-judge", rubric: "ten char rubric.", scale: "0-5" },
      ctx,
    );
    expect(r.passed).toBe(false);
    expect(r.error).toBeDefined();
  });
  it("propagates service error", async () => {
    const svc = { runJudge: vi.fn().mockRejectedValue(new Error("rate limit")) };
    const judge = createLlmJudge(svc as never);
    const r = await judge.evaluate(
      { kind: "llm-judge", rubric: "ten char rubric.", scale: "0-5" },
      ctx,
    );
    expect(r.passed).toBe(false);
    expect(r.error).toContain("rate limit");
  });
});
