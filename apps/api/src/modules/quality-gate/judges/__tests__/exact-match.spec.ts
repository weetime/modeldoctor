import { describe, expect, it } from "vitest";
import { exactMatchJudge } from "../exact-match.js";

const ctx = (answer: string, expected = "Hello") => ({ question: "Q", expected, answer });

describe("exactMatchJudge", () => {
  it("passes on identical strings", async () => {
    expect(await exactMatchJudge.evaluate({ kind: "exact-match" }, ctx("Hello"))).toMatchObject({
      passed: true,
    });
  });
  it("trims by default", async () => {
    expect(await exactMatchJudge.evaluate({ kind: "exact-match" }, ctx("  Hello  "))).toMatchObject(
      { passed: true },
    );
  });
  it("case-insensitive by default", async () => {
    expect(await exactMatchJudge.evaluate({ kind: "exact-match" }, ctx("hello"))).toMatchObject({
      passed: true,
    });
  });
  it("case-sensitive when configured", async () => {
    expect(
      await exactMatchJudge.evaluate({ kind: "exact-match", caseSensitive: true }, ctx("hello")),
    ).toMatchObject({ passed: false });
  });
  it("fails on mismatch", async () => {
    expect(await exactMatchJudge.evaluate({ kind: "exact-match" }, ctx("world"))).toMatchObject({
      passed: false,
    });
  });
  it("no trim when configured", async () => {
    expect(
      await exactMatchJudge.evaluate({ kind: "exact-match", trim: false }, ctx("  Hello  ")),
    ).toMatchObject({ passed: false });
  });
});
