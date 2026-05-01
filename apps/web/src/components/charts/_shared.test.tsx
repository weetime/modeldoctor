import { describe, expect, it } from "vitest";
import { assignRunColors } from "./_shared";

describe("assignRunColors", () => {
  it("returns empty map for empty input", () => {
    expect(assignRunColors([])).toEqual({});
  });

  it("assigns one color per runId in input order", () => {
    const m = assignRunColors(["a", "b", "c"]);
    expect(Object.keys(m)).toEqual(["a", "b", "c"]);
    expect(m.a).not.toBe(m.b);
    expect(m.b).not.toBe(m.c);
  });

  it("is stable for identical input", () => {
    expect(assignRunColors(["x", "y"])).toEqual(assignRunColors(["x", "y"]));
  });

  it("wraps around the 8-color palette when given more than 8 runs", () => {
    const ids = Array.from({ length: 10 }, (_, i) => `r${i}`);
    const m = assignRunColors(ids);
    expect(m.r0).toBe(m.r8);
    expect(m.r1).toBe(m.r9);
  });

  it("allocates by position, not by id content", () => {
    const m1 = assignRunColors(["alice", "bob"]);
    const m2 = assignRunColors(["charlie", "alice"]);
    // "alice" is at index 0 in m1 and index 1 in m2 → different colors
    expect(m1.alice).not.toBe(m2.alice);
    // "charlie" (index 0 in m2) gets the same color as "alice" (index 0 in m1)
    expect(m2.charlie).toBe(m1.alice);
  });
});
