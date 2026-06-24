import { describe, expect, it } from "vitest";
import {
  deltaColumnIndex,
  figureForHeading,
  isImprovement,
  parseDelta,
  parseSectionBlocks,
} from "./report-blocks";

describe("parseDelta", () => {
  it("parses signed percents in either minus glyph", () => {
    expect(parseDelta("+19.4%")).toEqual({ sign: "+", magnitude: "19.4%" });
    expect(parseDelta("-43%")).toEqual({ sign: "-", magnitude: "43%" });
    expect(parseDelta("−5.4%")).toEqual({ sign: "-", magnitude: "5.4%" });
    expect(parseDelta("  +2.6%  ")).toEqual({ sign: "+", magnitude: "2.6%" });
  });

  it("ignores non-delta cells (plain numbers, unsigned percents, prose)", () => {
    expect(parseDelta("2.87")).toBeNull();
    expect(parseDelta("0.42%")).toBeNull(); // no sign → not a delta
    expect(parseDelta("405")).toBeNull();
    expect(parseDelta("L1 (20)")).toBeNull();
  });
});

describe("isImprovement", () => {
  it("gain columns improve when positive", () => {
    expect(isImprovement("+", "提升幅度")).toBe(true);
    expect(isImprovement("-", "提升幅度")).toBe(false);
    expect(isImprovement("+", "Improvement")).toBe(true);
  });
  it("reduction columns improve when negative", () => {
    expect(isImprovement("-", "降低幅度")).toBe(true);
    expect(isImprovement("+", "降低幅度")).toBe(false);
    expect(isImprovement("-", "Reduction")).toBe(true);
  });
  it("defaults unknown headers to gain semantics", () => {
    expect(isImprovement("+", "Δ")).toBe(true);
    expect(isImprovement("-", "Δ")).toBe(false);
  });

  it("uses the metric's polarity over a generic/ambiguous header", () => {
    // Header carries no direction; metric decides. Latency/error = lower better.
    expect(isImprovement("-", "幅度", "stage-bars-ttft-p95")).toBe(true);
    expect(isImprovement("+", "Δ", "stage-bars-ttft-p95")).toBe(false);
    expect(isImprovement("-", "Change", "stage-bars-error-rate")).toBe(true);
    // Throughput = higher better.
    expect(isImprovement("+", "幅度", "stage-bars-throughput")).toBe(true);
    expect(isImprovement("-", "Δ", "stage-bars-throughput")).toBe(false);
  });

  it("metric overrides even a misleading header keyword", () => {
    // header says 提升 (gain) but metric is latency → a drop is still good.
    expect(isImprovement("-", "提升幅度", "stage-bars-ttft-p95")).toBe(true);
  });

  it("row label wins over the table heading in a combined multi-metric table", () => {
    // A combined table sits under one "命中率" heading (metric = hit, higher
    // better), but its TTFT/E2E/queue rows are lower-is-better — the row label
    // decides, so a latency drop reads as an improvement (green), not a regression.
    const hit = "stage-bars-prefix-cache-hit";
    expect(isImprovement("-", "变化", hit, "TTFT p95 (ms)")).toBe(true);
    expect(isImprovement("-", "变化", hit, "E2E latency p95 (ms)")).toBe(true);
    expect(isImprovement("-", "变化", hit, "排队时间 (peak)")).toBe(true);
    // hit / throughput rows in the same table stay higher-is-better.
    expect(isImprovement("+", "变化", hit, "命中率")).toBe(true);
    expect(isImprovement("+", "变化", hit, "吞吐 (req/s)")).toBe(true);
    expect(isImprovement("-", "变化", hit, "吞吐 (req/s)")).toBe(false);
  });
});

describe("deltaColumnIndex", () => {
  it("finds the delta column by header keyword", () => {
    expect(deltaColumnIndex(["并发等级", "OFF", "ON", "提升幅度"], [])).toBe(3);
    expect(deltaColumnIndex(["Stage", "OFF (ms)", "ON (ms)", "降低幅度"], [])).toBe(3);
  });
  it("falls back to the column whose cells all parse as deltas", () => {
    const rows = [
      ["L1", "2.87", "+2.6%"],
      ["L2", "4.48", "+19.4%"],
    ];
    expect(deltaColumnIndex(["stage", "off", "x"], rows)).toBe(2);
  });
  it("returns -1 when there is no delta column", () => {
    expect(deltaColumnIndex(["a", "b"], [["1", "2"]])).toBe(-1);
  });
});

describe("figureForHeading", () => {
  it("maps metric headings to chart refIds, latency before throughput", () => {
    expect(figureForHeading("TTFT p95 对比")).toBe("stage-bars-ttft-p95");
    expect(figureForHeading("E2E p95 对比")).toBe("stage-bars-e2e-p95");
    expect(figureForHeading("端到端延迟")).toBe("stage-bars-e2e-p95");
    expect(figureForHeading("吞吐对比")).toBe("stage-bars-throughput");
    expect(figureForHeading("Throughput comparison")).toBe("stage-bars-throughput");
    expect(figureForHeading("错误率")).toBe("stage-bars-error-rate");
    expect(figureForHeading("选型建议")).toBeNull();
  });

  it("maps prefix-cache headings, top-pod before hit", () => {
    expect(figureForHeading("命中率对比")).toBe("stage-bars-prefix-cache-hit");
    expect(figureForHeading("Prefix cache hit rate")).toBe("stage-bars-prefix-cache-hit");
    expect(figureForHeading("最高副本占比")).toBe("stage-bars-top-pod-share");
    expect(figureForHeading("Top Pod Share")).toBe("stage-bars-top-pod-share");
  });
});

describe("parseSectionBlocks", () => {
  const body = [
    "**吞吐对比**",
    "",
    "| 并发等级 | OFF (req/s) | ON (req/s) | 提升幅度 |",
    "|----------|-------------|------------|----------|",
    "| L1 (20)  | 2.87        | 2.95       | +2.6%    |",
    "| L2 (40)  | 4.48        | 5.35       | +19.4%   |",
    "",
    "开启 prefix cache 后吞吐全面领先。",
    "",
    "**TTFT p95 对比**",
    "",
    "| 并发等级 | OFF (ms) | ON (ms) | 降低幅度 |",
    "|----------|----------|---------|----------|",
    "| L1 (20)  | 710      | 405     | -43%     |",
    "",
    "TTFT p95 降低显著。",
  ].join("\n");

  it("splits into ordered md/table blocks and tags tables with their metric", () => {
    const blocks = parseSectionBlocks(body);
    const tables = blocks.filter((b) => b.kind === "table");
    expect(tables).toHaveLength(2);
    expect(tables[0].kind === "table" && tables[0].table.metric).toBe("stage-bars-throughput");
    expect(tables[1].kind === "table" && tables[1].table.metric).toBe("stage-bars-ttft-p95");
    // first table parsed structurally
    if (tables[0].kind === "table") {
      expect(tables[0].table.headers).toEqual([
        "并发等级",
        "OFF (req/s)",
        "ON (req/s)",
        "提升幅度",
      ]);
      expect(tables[0].table.rows).toHaveLength(2);
      expect(tables[0].table.rows[0]).toEqual(["L1 (20)", "2.87", "2.95", "+2.6%"]);
    }
    // ordering: heading md → table → (prose+next heading) md → table → prose md.
    // Consecutive prose/heading lines with no table between them coalesce into
    // one md block — the table boundaries are what matter for interleaving.
    expect(blocks.map((b) => b.kind)).toEqual(["md", "table", "md", "table", "md"]);
  });

  it("leaves prose-only sections as a single md block", () => {
    const blocks = parseSectionBlocks("纯文字结论，没有表格。\n\n第二段。");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("md");
  });
});
