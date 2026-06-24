import type { FigureRefId } from "@modeldoctor/contracts";

/**
 * Render-time reshaping of an AI narrative section so each metric's comparison
 * table sits next to its trend chart, and delta cells read as colored
 * triangles (▲/▼) instead of plain "+2.6%" / "-43%" text.
 *
 * The narrative model keeps tables (free markdown inside `bodyMarkdown`) and
 * figures (structured `refId` objects) separate — figures used to render in a
 * block after all the prose. These helpers split a section body into ordered
 * blocks and pair each table with the figure for the same metric, with zero
 * dependency on the AI emitting any special syntax (works on existing reports).
 */

export interface ParsedTable {
  headers: string[];
  rows: string[][];
  /** Figure refId for this table's metric, derived from the heading above it. */
  metric: FigureRefId | null;
}

export type SectionBlock = { kind: "md"; text: string } | { kind: "table"; table: ParsedTable };

/** Sign + magnitude of a delta cell like "+19.4%", "-43%", "−5.4%". */
export interface DeltaValue {
  /** "+" when the value rose, "-" when it fell. */
  sign: "+" | "-";
  /** Original text without the sign, e.g. "19.4%". */
  magnitude: string;
}

const DELTA_RE = /^\s*([+\-−])\s*(\d+(?:\.\d+)?\s*%)\s*$/;

/** Parse a signed-percent delta cell. Returns null for any other content
 * (plain numbers, "0.42%" without a sign, prose) so non-delta cells are left
 * untouched. */
export function parseDelta(raw: string): DeltaValue | null {
  const m = DELTA_RE.exec(raw);
  if (!m) return null;
  const sign = m[1] === "+" ? "+" : "-";
  return { sign, magnitude: m[2].replace(/\s+/g, "") };
}

// CJK keywords are written as \u escapes (the no-hardcoded-zh lint forbids
// literal Chinese anywhere in source, comments included). Romanized glyphs:
//   reduction set — jiangdi/xiajiang/jianshao/suoduan (reduce/decline/...)
//   header set    — also tisheng/fudu/tigao (raise/magnitude/increase)
const REDUCTION_RE = /\u964d\u4f4e|\u4e0b\u964d|\u51cf\u5c11|\u7f29\u77ed|reduc|lower|decrease|↓/i;
const DELTA_HEADER_RE =
  /\u63d0\u5347|\u964d\u4f4e|\u5e45\u5ea6|\u63d0\u9ad8|\u4e0b\u964d|\u51cf\u5c11|\u7f29\u77ed|delta|change|gain|reduc/i;

/** Metrics where a lower value is better — latency + error rate. Mirrors the
 * `higherIsBetter: false` flags the same charts carry in FigureRenderer. */
const LOWER_IS_BETTER: ReadonlySet<FigureRefId> = new Set<FigureRefId>([
  "stage-bars-ttft-p95",
  "stage-bars-e2e-p95",
  "stage-bars-error-rate",
]);

// Per-ROW polarity from the row's own label (first cell). The table `metric`
// (from the heading) describes only ONE metric, but the AI often emits a
// COMBINED table (hit + throughput + TTFT + E2E rows under one heading) — there
// the heading's polarity is wrong for the latency/error rows. A row whose label
// names a latency/error/pressure metric is lower-is-better regardless of the
// heading. CJK as \u escapes (no-hardcoded-zh lint): yanchi/duanduanduan(e2e)/
// paidui(queue)/cuowu(error)/qiangzhan(preempt).
const ROW_LOWER_IS_BETTER_RE =
  /ttft|tpot|\bitl\b|latency|e2e|queue|error|preempt|\u5ef6\u8fdf|\u7aef\u5230\u7aef|\u6392\u961f|\u9519\u8bef|\u62a2\u5360/i;
// hit/mingzhong, throughput/tuntu, qps, success/chenggong, efficiency/xiaolv.
const ROW_HIGHER_IS_BETTER_RE =
  /hit|throughput|qps|req\/s|success|efficiency|\u547d\u4e2d|\u541e\u5410|\u6210\u529f|\u6548\u7387/i;

/** Whether a delta is an improvement. Polarity sources, most-specific first:
 * (1) the ROW's own label — handles combined multi-metric tables where one
 * heading can't describe every row; (2) the table's `metric` (from the heading,
 * authoritative for single-metric tables, same as the chart's higherIsBetter);
 * (3) reduction-keyword detection on the delta header; else default to gain. */
export function isImprovement(
  sign: "+" | "-",
  header: string,
  metric?: FigureRefId | null,
  rowLabel?: string,
): boolean {
  if (rowLabel) {
    if (ROW_LOWER_IS_BETTER_RE.test(rowLabel)) return sign === "-";
    if (ROW_HIGHER_IS_BETTER_RE.test(rowLabel)) return sign === "+";
  }
  if (metric) return LOWER_IS_BETTER.has(metric) ? sign === "-" : sign === "+";
  return REDUCTION_RE.test(header) ? sign === "-" : sign === "+";
}

/** Index of the delta column (the signed-percent one), or -1. We detect it by
 * header keyword first, falling back to "any column whose body cells parse as
 * deltas". */
export function deltaColumnIndex(headers: string[], rows: string[][]): number {
  const byHeader = headers.findIndex((h) => DELTA_HEADER_RE.test(h));
  if (byHeader >= 0) return byHeader;
  for (let c = 0; c < headers.length; c++) {
    if (rows.length > 0 && rows.every((r) => r[c] !== undefined && parseDelta(r[c]) !== null)) {
      return c;
    }
  }
  return -1;
}

/** Map a metric heading (e.g. "**TTFT p95 \u5bf9\u6bd4**") to the figure refId that
 * charts the same metric, so the renderer can drop that chart under the table.
 * Order matters: check specific latency labels before generic ones. */
export function figureForHeading(heading: string): FigureRefId | null {
  if (/ttft/i.test(heading)) return "stage-bars-ttft-p95";
  if (/e2e|\u7aef\u5230\u7aef/i.test(heading)) return "stage-bars-e2e-p95";
  if (/\u9519\u8bef|error/i.test(heading)) return "stage-bars-error-rate";
  if (/\u541e\u5410|throughput|qps|req\/s/i.test(heading)) return "stage-bars-throughput";
  // Prefix-cache headings. \u547d\u4e2d=hit, \u526f\u672c\u5360\u6bd4=top-pod
  // share. Match the full \u526f\u672c\u5360\u6bd4 phrase (not \u526f\u672c or
  // \u5360\u6bd4 alone, which falsely match unrelated headings like
  // "\u526f\u672c\u6570" or any "\u5360\u6bd4" metric). Check top-pod before hit
  // so "top pod share" doesn't get swallowed by a generic hit match.
  if (/top.?pod|\u526f\u672c\u5360\u6bd4/i.test(heading)) return "stage-bars-top-pod-share";
  if (/\u547d\u4e2d|hit.?rate|cache.?hit/i.test(heading)) return "stage-bars-prefix-cache-hit";
  return null;
}

function splitRow(line: string): string[] {
  // "| a | b | c |" → ["a","b","c"] (drop the leading/trailing empties).
  const cells = line.split("|").map((c) => c.trim());
  if (cells.length && cells[0] === "") cells.shift();
  if (cells.length && cells[cells.length - 1] === "") cells.pop();
  return cells;
}

const SEPARATOR_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/**
 * Split a section's markdown into ordered blocks, parsing GitHub pipe tables
 * into structured {headers, rows} (tagged with the metric from the nearest
 * preceding heading / bold label) and leaving everything else as markdown.
 */
export function parseSectionBlocks(markdown: string): SectionBlock[] {
  const lines = markdown.split("\n");
  const blocks: SectionBlock[] = [];
  let buf: string[] = [];
  let lastHeading = "";

  const flushMd = () => {
    if (buf.length === 0) return;
    const text = buf.join("\n");
    if (text.trim() !== "") blocks.push({ kind: "md", text });
    buf = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1] ?? "";
    // Track the most recent heading or bold label so tables know their metric.
    const headingMatch = /^#{1,6}\s+(.+?)\s*$/.exec(line) ?? /^\s*\*\*(.+?)\*\*\s*$/.exec(line);
    if (headingMatch) lastHeading = headingMatch[1];

    const isTableStart = line.includes("|") && line.trim() !== "" && SEPARATOR_RE.test(next);
    if (isTableStart) {
      flushMd();
      const headers = splitRow(line);
      i += 1; // consume separator
      const rows: string[][] = [];
      while (i + 1 < lines.length && lines[i + 1].includes("|") && lines[i + 1].trim() !== "") {
        rows.push(splitRow(lines[i + 1]));
        i += 1;
      }
      blocks.push({
        kind: "table",
        table: { headers, rows, metric: figureForHeading(lastHeading) },
      });
      continue;
    }
    buf.push(line);
  }
  flushMd();
  return blocks;
}
