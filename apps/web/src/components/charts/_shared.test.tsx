import { describe, expect, it } from "vitest";
import { assignRunColors } from "./_shared";

const PALETTE = ["c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7"];

describe("assignRunColors", () => {
  it("returns empty map for empty input", () => {
    expect(assignRunColors([], PALETTE)).toEqual({});
  });

  it("assigns one color per runId in input order", () => {
    const m = assignRunColors(["a", "b", "c"], PALETTE);
    expect(Object.keys(m)).toEqual(["a", "b", "c"]);
    expect(m.a).toBe("c0");
    expect(m.b).toBe("c1");
    expect(m.c).toBe("c2");
  });

  it("is stable for identical input", () => {
    expect(assignRunColors(["x", "y"], PALETTE)).toEqual(assignRunColors(["x", "y"], PALETTE));
  });

  it("wraps around the 8-color palette when given more than 8 runs", () => {
    const ids = Array.from({ length: 10 }, (_, i) => `r${i}`);
    const m = assignRunColors(ids, PALETTE);
    expect(m.r0).toBe(m.r8);
    expect(m.r1).toBe(m.r9);
  });

  it("allocates by position, not by id content", () => {
    const m1 = assignRunColors(["alice", "bob"], PALETTE);
    const m2 = assignRunColors(["charlie", "alice"], PALETTE);
    expect(m1.alice).not.toBe(m2.alice);
    expect(m2.charlie).toBe(m1.alice);
  });
});
