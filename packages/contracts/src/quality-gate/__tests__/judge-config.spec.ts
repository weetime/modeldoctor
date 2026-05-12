import { describe, expect, it } from "vitest";
import { judgeConfigSchema } from "../judge-config.js";

describe("judgeConfigSchema", () => {
  it("accepts exact-match", () => {
    expect(
      judgeConfigSchema.parse({ kind: "exact-match", caseSensitive: false, trim: true }),
    ).toMatchObject({ kind: "exact-match" });
  });
  it("rejects contains with empty substrings", () => {
    expect(() =>
      judgeConfigSchema.parse({ kind: "contains", substrings: [], mode: "all" }),
    ).toThrow();
  });
  it("rejects regex with invalid pattern", () => {
    expect(() => judgeConfigSchema.parse({ kind: "regex", pattern: "[unclosed" })).toThrow(
      /invalid regex/,
    );
  });
  it("rejects llm-judge passThreshold outside scale", () => {
    expect(() =>
      judgeConfigSchema.parse({
        kind: "llm-judge",
        rubric: "ten chars +",
        scale: "0-1",
        passThreshold: 1.5,
      }),
    ).toThrow();
  });
  it("accepts llm-judge with default threshold inferred per scale", () => {
    const c = judgeConfigSchema.parse({ kind: "llm-judge", rubric: "ten chars +", scale: "0-5" });
    expect(c.kind).toBe("llm-judge");
  });
});
