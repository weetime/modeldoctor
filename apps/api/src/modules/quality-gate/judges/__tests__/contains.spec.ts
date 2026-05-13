import { describe, expect, it } from "vitest";
import { containsJudge } from "../contains.js";

const ctx = (answer: string) => ({ question: "Q", expected: "", answer });

describe("containsJudge", () => {
  it("passes on all substrings present", async () => {
    expect(
      await containsJudge.evaluate(
        { kind: "contains", substrings: ["foo", "bar"], mode: "all" },
        ctx("foo and bar"),
      ),
    ).toMatchObject({ passed: true });
  });
  it("fails on missing substring in all-mode", async () => {
    const r = await containsJudge.evaluate(
      { kind: "contains", substrings: ["foo", "bar"], mode: "all" },
      ctx("foo only"),
    );
    expect(r.passed).toBe(false);
    expect(r.reason).toContain("bar");
  });
  it("any-mode passes if at least one matches", async () => {
    expect(
      await containsJudge.evaluate(
        { kind: "contains", substrings: ["x", "foo"], mode: "any" },
        ctx("foo"),
      ),
    ).toMatchObject({ passed: true });
  });
  it("case-insensitive by default", async () => {
    expect(
      await containsJudge.evaluate(
        { kind: "contains", substrings: ["FOO"], mode: "all" },
        ctx("foo"),
      ),
    ).toMatchObject({ passed: true });
  });
  it("case-sensitive when configured", async () => {
    expect(
      await containsJudge.evaluate(
        { kind: "contains", substrings: ["FOO"], mode: "all", caseSensitive: true },
        ctx("foo"),
      ),
    ).toMatchObject({ passed: false });
  });
});
