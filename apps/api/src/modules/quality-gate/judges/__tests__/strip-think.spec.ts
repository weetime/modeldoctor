import { describe, expect, it } from "vitest";
import { stripThink } from "../strip-think.js";

describe("stripThink", () => {
  it("removes a leading think block and trims", () => {
    expect(stripThink("<think>\n嗯，让我想想…\n</think>\n\nB")).toBe("B");
  });
  it("is a no-op when there is no think block (parser-separated content)", () => {
    expect(stripThink("C. 北京")).toBe("C. 北京");
  });
  it("removes multiple think blocks", () => {
    expect(stripThink("<think>a</think>X<think>b</think>Y")).toBe("XY");
  });
  it("is case-insensitive on the tag", () => {
    expect(stripThink("<THINK>r</THINK>D")).toBe("D");
  });
  it("leaves an unclosed (truncated) think intact", () => {
    const truncated = "<think>嗯，这道题我需要先分析积分的结构，然后";
    expect(stripThink(truncated)).toBe(truncated);
  });
});
