import type { Benchmark, BenchmarkTool } from "@modeldoctor/contracts";
import { type MetricKind, readMetricSafe } from "@modeldoctor/tool-adapters/schemas";

// summaryMetrics is the discriminated union written by tool-adapter
// parseFinalReport: { tool, data } (see
// packages/tool-adapters/src/{guidellm,vegeta,aiperf,evalscope}/runtime.ts).
// vegeta latencies are normalized to ms by the adapter (NOT ns).
//
// All per-tool field-path logic now lives in each adapter's `readMetric`
// (see packages/tool-adapters/src/<tool>/read-metric.ts). This module
// just picks `MetricKind`s and delegates via the shared `readMetricSafe`
// helper — adding a new tool / metric updates exactly one adapter file.

type SummaryMetrics = Benchmark["summaryMetrics"];

// ─── Verdict-eligible readers ────────────────────────────────────────────────

export function readP95Latency(metrics: SummaryMetrics): number | null {
  return readMetricSafe("e2e.p95", metrics as { tool?: unknown; data?: unknown } | null);
}

export function readErrorRate(metrics: SummaryMetrics): number | null {
  return readMetricSafe("errorRate", metrics as { tool?: unknown; data?: unknown } | null);
}

export function readThroughput(metrics: SummaryMetrics): number | null {
  return readMetricSafe("requestsPerSec", metrics as { tool?: unknown; data?: unknown } | null);
}

// ─── Grid row descriptors ────────────────────────────────────────────────────
//
// Each descriptor names: (a) which i18n key labels the row, (b) how to
// extract the number per Run, (c) which verdict function (if any) applies.
//
// `verdictKind` is undefined on display-only rows (latency p50/p99, TTFT
// percentiles, byte counts, etc.). The compare grid only renders a colored
// VerdictBadge on rows where verdictKind is set; other rows show the number
// + a gray Δ% text.

export type VerdictKind = "latency" | "errorRate" | "throughput";

export interface MetricRowDescriptor {
  labelKey: string; // "compare.metricRowLabel.<key>"
  read: (m: SummaryMetrics) => number | null;
  verdictKind?: VerdictKind;
  digits?: number; // default 1
  unitSuffix?: string; // for the cell display (e.g. "ms", "%")
}

function metricRow(
  labelKey: string,
  kind: MetricKind,
  opts: { digits?: number; unitSuffix?: string; verdictKind?: VerdictKind } = {},
): MetricRowDescriptor {
  return {
    labelKey,
    read: (m) => readMetricSafe(kind, m as { tool?: unknown; data?: unknown } | null),
    digits: opts.digits,
    unitSuffix: opts.unitSuffix,
    verdictKind: opts.verdictKind,
  };
}

// `ttftMean` / `itlMean` / latency min/mean/max have no MetricKind counterparts
// (only the dist buckets are first-class). Fall back to direct field reads
// where MetricKind doesn't cover the case.
function rawDistRow(
  labelKey: string,
  toolKey: string,
  field: string,
  opts: { unitSuffix?: string } = {},
): MetricRowDescriptor {
  return {
    labelKey,
    read: (m) => {
      const t = m as { tool?: unknown; data?: Record<string, unknown> } | null;
      if (!t?.data) return null;
      const dist = t.data[toolKey] as Record<string, unknown> | undefined;
      const v = dist?.[field];
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    },
    unitSuffix: opts.unitSuffix,
  };
}

const guidellmRows: MetricRowDescriptor[] = [
  rawDistRow("ttftMean", "ttft", "mean", { unitSuffix: "ms" }),
  metricRow("ttftP50", "ttft.p50", { unitSuffix: "ms" }),
  metricRow("ttftP95", "ttft.p95", { unitSuffix: "ms" }),
  metricRow("ttftP99", "ttft.p99", { unitSuffix: "ms" }),
  rawDistRow("itlMean", "itl", "mean", { unitSuffix: "ms" }),
  metricRow("itlP95", "itl.p95", { unitSuffix: "ms" }),
  metricRow("e2eLatencyP50", "e2e.p50", { unitSuffix: "ms" }),
  // Verdict-eligible: shared latency P95 row uses the same reader as the
  // standalone readP95Latency exported above.
  metricRow("latencyP95", "e2e.p95", { unitSuffix: "ms", verdictKind: "latency" }),
  metricRow("e2eLatencyP99", "e2e.p99", { unitSuffix: "ms" }),
  metricRow("errorRate", "errorRate", { digits: 4, verdictKind: "errorRate" }),
  metricRow("throughput", "requestsPerSec", { unitSuffix: "req/s", verdictKind: "throughput" }),
];

const vegetaRows: MetricRowDescriptor[] = [
  rawDistRow("latencyMin", "latencies", "min", { unitSuffix: "ms" }),
  rawDistRow("latencyMean", "latencies", "mean", { unitSuffix: "ms" }),
  metricRow("latencyP50", "e2e.p50", { unitSuffix: "ms" }),
  metricRow("latencyP90", "e2e.p90", { unitSuffix: "ms" }),
  metricRow("latencyP95", "e2e.p95", { unitSuffix: "ms", verdictKind: "latency" }),
  metricRow("latencyP99", "e2e.p99", { unitSuffix: "ms" }),
  rawDistRow("latencyMax", "latencies", "max", { unitSuffix: "ms" }),
  metricRow("errorRate", "errorRate", { digits: 4, verdictKind: "errorRate" }),
  metricRow("throughput", "requestsPerSec", { unitSuffix: "req/s", verdictKind: "throughput" }),
];

// evalscope and aiperf surface the same inference fields (ttft / e2eLatency /
// itl distributions + throughput.requestsPerSec + requests.errorRate as a
// 0-1 fraction), so they share a single row descriptor array. Evalscope-only
// fields (prefixCacheStats.hitRate) are rendered in the report component, not
// the compare grid.
const inferenceRowsForNewTools: MetricRowDescriptor[] = [
  rawDistRow("ttftMean", "ttft", "mean", { unitSuffix: "ms" }),
  metricRow("ttftP50", "ttft.p50", { unitSuffix: "ms" }),
  metricRow("ttftP95", "ttft.p95", { unitSuffix: "ms" }),
  metricRow("ttftP99", "ttft.p99", { unitSuffix: "ms" }),
  rawDistRow("itlMean", "itl", "mean", { unitSuffix: "ms" }),
  metricRow("itlP95", "itl.p95", { unitSuffix: "ms" }),
  metricRow("e2eLatencyP50", "e2e.p50", { unitSuffix: "ms" }),
  metricRow("latencyP95", "e2e.p95", { unitSuffix: "ms", verdictKind: "latency" }),
  metricRow("e2eLatencyP99", "e2e.p99", { unitSuffix: "ms" }),
  metricRow("errorRate", "errorRate", { digits: 4, verdictKind: "errorRate" }),
  metricRow("throughput", "requestsPerSec", { unitSuffix: "req/s", verdictKind: "throughput" }),
];

// Formats a baseline-to-current delta as a signed string for display in
// VerdictBadge. errorRate uses percentage points (×100, "pp" suffix);
// latency/throughput use percent change with 1 decimal. Returns "—" when
// baseline is 0 to avoid divide-by-zero, matching verdict.ts's same-baseline
// guard.
export function deltaText(kind: VerdictKind, baseline: number, current: number): string {
  if (kind === "errorRate") {
    const pp = (current - baseline) * 100;
    return `${pp >= 0 ? "+" : ""}${pp.toFixed(2)}pp`;
  }
  if (baseline === 0) return "—";
  const pct = ((current - baseline) / baseline) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

export function rowDescriptorsForTool(tool: BenchmarkTool): MetricRowDescriptor[] {
  switch (tool) {
    case "guidellm":
      return guidellmRows;
    case "vegeta":
      return vegetaRows;
    case "evalscope":
    case "aiperf":
      return inferenceRowsForNewTools;
    default:
      return [];
  }
}
