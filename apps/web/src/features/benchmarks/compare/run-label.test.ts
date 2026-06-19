import { describe, expect, it } from "vitest";
import { shortRunLabels } from "./run-label";

describe("shortRunLabels", () => {
  it("strips the common leading ' · ' tokens shared by all runs", () => {
    expect(
      shortRunLabels([
        "深会话t2 · Qwen3-8B · MX-OFF-r1-a1",
        "深会话t2 · Qwen3-8B · MX-OFF-r2-a1",
        "深会话t2 · Qwen3-8B · MX-ON-r1-a2",
      ]),
    ).toEqual(["MX-OFF-r1-a1", "MX-OFF-r2-a1", "MX-ON-r1-a2"]);
  });

  it("falls back to the full name when stripping would empty a label", () => {
    // All identical → no distinguishing suffix → keep full names.
    expect(shortRunLabels(["A · B", "A · B"])).toEqual(["A · B", "A · B"]);
  });

  it("returns names unchanged when there is no common prefix", () => {
    expect(shortRunLabels(["alpha", "beta"])).toEqual(["alpha", "beta"]);
  });

  it("handles a single run by returning it unchanged", () => {
    expect(shortRunLabels(["深会话t2 · Qwen3-8B · MX-OFF-r1-a1"])).toEqual([
      "深会话t2 · Qwen3-8B · MX-OFF-r1-a1",
    ]);
  });

  it("only strips whole tokens, not partial-token character prefixes", () => {
    // Common char prefix "MX-O" but differing tokens → nothing stripped.
    expect(shortRunLabels(["MX-OFF", "MX-ON"])).toEqual(["MX-OFF", "MX-ON"]);
  });

  it("keeps trailing tokens intact after stripping the shared head", () => {
    expect(shortRunLabels(["env · a · x · 1", "env · a · y · 2"])).toEqual(["x · 1", "y · 2"]);
  });
});
