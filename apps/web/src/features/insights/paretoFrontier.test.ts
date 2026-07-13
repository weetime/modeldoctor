import { describe, expect, it } from "vitest";
import { paretoFrontier } from "./paretoFrontier";

describe("paretoFrontier", () => {
  it("keeps non-dominated points (x higher better, y lower better)", () => {
    // A(90,100) dominates B(80,120); C(70,50) non-dominated (lower y)
    const front = paretoFrontier([
      { id: "A", x: 90, y: 100 },
      { id: "B", x: 80, y: 120 },
      { id: "C", x: 70, y: 50 },
    ]);
    expect(front.has("A")).toBe(true);
    expect(front.has("C")).toBe(true);
    expect(front.has("B")).toBe(false);
  });

  it("keeps both points when they are exact ties (neither strictly dominates)", () => {
    const front = paretoFrontier([
      { id: "A", x: 50, y: 100 },
      { id: "B", x: 50, y: 100 },
    ]);
    expect(front.has("A")).toBe(true);
    expect(front.has("B")).toBe(true);
  });

  it("honors custom opts (both axes higher-better)", () => {
    // With yBetter="higher", B(80,120) is no longer dominated by A(90,100):
    // A is better on x but worse on y, so neither dominates the other.
    const front = paretoFrontier(
      [
        { id: "A", x: 90, y: 100 },
        { id: "B", x: 80, y: 120 },
        { id: "C", x: 70, y: 50 },
      ],
      { xBetter: "higher", yBetter: "higher" },
    );
    expect(front.has("A")).toBe(true);
    expect(front.has("B")).toBe(true);
    // C is dominated by both A (better x, better y) and B (better x, better y)
    expect(front.has("C")).toBe(false);
  });
});
