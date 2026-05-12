import { describe, expect, it } from "vitest";
import { regexJudge } from "../regex.js";

const ctx = (answer: string) => ({ question: "Q", expected: "", answer });

describe("regexJudge", () => {
  it("passes when pattern matches", async () => {
    expect(await regexJudge.evaluate({ kind: "regex", pattern: "^foo\\d+$" }, ctx("foo123"))).toMatchObject({ passed: true });
  });
  it("fails on no match", async () => {
    expect(await regexJudge.evaluate({ kind: "regex", pattern: "^foo$" }, ctx("bar"))).toMatchObject({ passed: false });
  });
  it("honors flags (case-insensitive)", async () => {
    expect(await regexJudge.evaluate({ kind: "regex", pattern: "FOO", flags: "i" }, ctx("foo"))).toMatchObject({ passed: true });
  });
  it("error on invalid pattern", async () => {
    const r = await regexJudge.evaluate({ kind: "regex", pattern: "[unclosed" }, ctx("x"));
    expect(r.passed).toBe(false);
    expect(r.error).toBeDefined();
  });
});
