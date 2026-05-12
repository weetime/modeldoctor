import { describe, expect, it } from "vitest";
import { createEvaluationRequestSchema, evaluationSampleSchema, evaluationSchema } from "../evaluations.js";

describe("evaluationSampleSchema", () => {
  it("requires prompt, expected, and judgeConfig", () => {
    expect(() => evaluationSampleSchema.parse({ id: "s1", idx: 0 })).toThrow();
  });
  it("accepts a full sample", () => {
    const s = evaluationSampleSchema.parse({
      id: "s1",
      idx: 0,
      prompt: "Q?",
      expected: "A",
      judgeConfig: { kind: "exact-match" },
    });
    expect(s.prompt).toBe("Q?");
  });
});

describe("createEvaluationRequestSchema", () => {
  it("requires at least 1 sample and rejects > 500", () => {
    const make = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `s${i}`,
        idx: i,
        prompt: "Q",
        expected: "A",
        judgeConfig: { kind: "exact-match" },
      }));
    expect(() => createEvaluationRequestSchema.parse({ name: "x", samples: [] })).toThrow();
    expect(() => createEvaluationRequestSchema.parse({ name: "x", samples: make(501) })).toThrow();
    expect(createEvaluationRequestSchema.parse({ name: "x", samples: make(1) }).samples.length).toBe(1);
  });
});

describe("evaluationSchema", () => {
  it("infers totalSamples and version", () => {
    const e = evaluationSchema.parse({
      id: "e1",
      userId: "u1",
      name: "Set",
      description: null,
      version: 1,
      samples: [],
      totalSamples: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(e.version).toBe(1);
  });
});
