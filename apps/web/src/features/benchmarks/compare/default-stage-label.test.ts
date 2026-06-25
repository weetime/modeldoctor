import { describe, expect, it } from "vitest";
import { shortRunLabels } from "./run-label";

// Mirrors BenchmarkComparePage's default-label rule so the precedence is pinned.
function defaultStageLabel(label: string | null, autoShort: string): string {
  return label ?? autoShort;
}

describe("compare default stage label", () => {
  it("prefers benchmark.label over the auto-derived short label", () => {
    const names = ["长前缀 · Qwen3 · T6N-OFF-r1", "长前缀 · Qwen3 · T6N-ON-r1"];
    const short = shortRunLabels(names);
    expect(defaultStageLabel("OFF", short[0])).toBe("OFF");
    expect(defaultStageLabel(null, short[1])).toBe(short[1]);
  });
});
