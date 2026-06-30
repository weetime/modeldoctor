import type { SweepSeries } from "@modeldoctor/contracts";
import { describe, expect, it } from "vitest";
import { resolveReportIntent } from "./report-scenarios/index.js";
import { formatSweepMatrix } from "./sweep-prompt.js";

describe("resolveReportIntent", () => {
  it("reportKind='sweep' wins over scenario", () => {
    expect(resolveReportIntent("inference", 9, "sweep")).toBe("sweep");
    expect(resolveReportIntent("lb-strategy", 2, "sweep")).toBe("sweep");
  });
  it("falls back to scenario mapping when reportKind is null", () => {
    expect(resolveReportIntent("inference", 9, null)).toBe("inference-multi");
    expect(resolveReportIntent("inference", 1, null)).toBe("inference-single");
    expect(resolveReportIntent("capacity", 3)).toBe("capacity");
    expect(resolveReportIntent("nope", 3)).toBe("default");
  });
});

describe("formatSweepMatrix", () => {
  const series: SweepSeries[] = [
    {
      seriesKey: "c-v",
      seriesLabel: "vllm",
      points: [
        { x: 8, values: { outTps: 145, rps: 0.29, ttftP50: 283, ttftP95: 545, kvAvg: 4.5 }, n: 3 },
        { x: 128, values: { outTps: 1228, ttftP50: 1200, queueDepth: 3.1 }, n: 3 },
      ],
    },
  ];
  it("renders a markdown table row per (series, x)", () => {
    const md = formatSweepMatrix(series);
    expect(md).toContain("Sweep matrix");
    expect(md).toContain("| vllm | 8 |");
    expect(md).toContain("| vllm | 128 |");
    expect(md).toContain("145"); // outTps
    expect(md).toContain("1228");
  });
  it("renders em-dash for absent metrics", () => {
    const md = formatSweepMatrix(series);
    // c128 row has no rps → em-dash placeholder
    const c128 = md.split("\n").find((l) => l.includes("| 128 |")) ?? "";
    expect(c128).toContain("—");
  });
  it("returns empty string for no series", () => {
    expect(formatSweepMatrix([])).toBe("");
  });
});
