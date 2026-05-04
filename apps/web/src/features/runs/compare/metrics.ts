import type { Run, RunTool } from "@modeldoctor/contracts";

// summaryMetrics is the discriminated union written by tool-adapter
// parseFinalReport: { tool, data } (see
// packages/tool-adapters/src/{guidellm,vegeta,genai-perf}/runtime.ts).
// vegeta latencies are normalized to ms by the adapter (NOT ns).

type SummaryMetrics = Run["summaryMetrics"];
type Tagged = { tool?: string; data?: Record<string, unknown> };

function asTagged(metrics: SummaryMetrics): Tagged | null {
  if (!metrics) return null;
  const m = metrics as Tagged;
  return m.data ? m : null;
}

function fromDist(data: Record<string, unknown>, key: string, field: string): number | null {
  const dist = data[key] as Record<string, unknown> | undefined;
  const v = dist?.[field];
  return typeof v === "number" ? v : null;
}

// ─── Verdict-eligible readers ────────────────────────────────────────────────

export function readP95Latency(metrics: SummaryMetrics): number | null {
  const m = asTagged(metrics);
  if (!m?.data) return null;
  switch (m.tool) {
    case "guidellm":
      return fromDist(m.data, "e2eLatency", "p95");
    case "vegeta":
      return fromDist(m.data, "latencies", "p95");
    case "genai-perf":
      return fromDist(m.data, "requestLatency", "p95");
    default:
      return null;
  }
}

export function readErrorRate(metrics: SummaryMetrics): number | null {
  const m = asTagged(metrics);
  if (!m?.data) return null;
  switch (m.tool) {
    case "guidellm": {
      const r = m.data.requests as { total?: number; error?: number } | undefined;
      if (typeof r?.total !== "number" || typeof r.error !== "number") return null;
      if (r.total === 0) return null;
      return r.error / r.total;
    }
    case "vegeta": {
      const s = m.data.success;
      return typeof s === "number" ? 1 - s / 100 : null;
    }
    default:
      // genai-perf carries no error/success counts.
      return null;
  }
}

export function readThroughput(metrics: SummaryMetrics): number | null {
  const m = asTagged(metrics);
  if (!m?.data) return null;
  switch (m.tool) {
    case "guidellm": {
      const r = m.data.requestsPerSecond as { mean?: number } | undefined;
      return typeof r?.mean === "number" ? r.mean : null;
    }
    case "vegeta": {
      const r = m.data.requests as { throughput?: number } | undefined;
      return typeof r?.throughput === "number" ? r.throughput : null;
    }
    case "genai-perf": {
      const r = m.data.requestThroughput as { avg?: number } | undefined;
      return typeof r?.avg === "number" ? r.avg : null;
    }
    default:
      return null;
  }
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

function distRow(
  labelKey: string,
  toolKey: string,
  field: string,
  opts: { digits?: number; unitSuffix?: string; verdictKind?: VerdictKind } = {},
): MetricRowDescriptor {
  return {
    labelKey,
    read: (m) => {
      const t = asTagged(m);
      return t?.data ? fromDist(t.data, toolKey, field) : null;
    },
    digits: opts.digits,
    unitSuffix: opts.unitSuffix,
    verdictKind: opts.verdictKind,
  };
}

const guidellmRows: MetricRowDescriptor[] = [
  distRow("ttftMean", "ttft", "mean", { unitSuffix: "ms" }),
  distRow("ttftP50", "ttft", "p50", { unitSuffix: "ms" }),
  distRow("ttftP95", "ttft", "p95", { unitSuffix: "ms" }),
  distRow("ttftP99", "ttft", "p99", { unitSuffix: "ms" }),
  distRow("itlMean", "itl", "mean", { unitSuffix: "ms" }),
  distRow("itlP95", "itl", "p95", { unitSuffix: "ms" }),
  distRow("e2eLatencyP50", "e2eLatency", "p50", { unitSuffix: "ms" }),
  // Verdict-eligible: shared latency P95 row uses the same reader as the
  // standalone readP95Latency exported above.
  { labelKey: "latencyP95", read: readP95Latency, verdictKind: "latency", unitSuffix: "ms" },
  distRow("e2eLatencyP99", "e2eLatency", "p99", { unitSuffix: "ms" }),
  { labelKey: "errorRate", read: readErrorRate, verdictKind: "errorRate", digits: 4 },
  { labelKey: "throughput", read: readThroughput, verdictKind: "throughput", unitSuffix: "req/s" },
];

const vegetaRows: MetricRowDescriptor[] = [
  distRow("latencyMin", "latencies", "min", { unitSuffix: "ms" }),
  distRow("latencyMean", "latencies", "mean", { unitSuffix: "ms" }),
  distRow("latencyP50", "latencies", "p50", { unitSuffix: "ms" }),
  distRow("latencyP90", "latencies", "p90", { unitSuffix: "ms" }),
  { labelKey: "latencyP95", read: readP95Latency, verdictKind: "latency", unitSuffix: "ms" },
  distRow("latencyP99", "latencies", "p99", { unitSuffix: "ms" }),
  distRow("latencyMax", "latencies", "max", { unitSuffix: "ms" }),
  { labelKey: "errorRate", read: readErrorRate, verdictKind: "errorRate", digits: 4 },
  { labelKey: "throughput", read: readThroughput, verdictKind: "throughput", unitSuffix: "req/s" },
];

const genaiPerfRows: MetricRowDescriptor[] = [
  distRow("latencyMean", "requestLatency", "avg", { unitSuffix: "ms" }),
  distRow("latencyP50", "requestLatency", "p50", { unitSuffix: "ms" }),
  distRow("latencyP90", "requestLatency", "p90", { unitSuffix: "ms" }),
  { labelKey: "latencyP95", read: readP95Latency, verdictKind: "latency", unitSuffix: "ms" },
  distRow("latencyP99", "requestLatency", "p99", { unitSuffix: "ms" }),
  distRow("ttftMean", "timeToFirstToken", "avg", { unitSuffix: "ms" }),
  distRow("ttftP95", "timeToFirstToken", "p95", { unitSuffix: "ms" }),
  // genai-perf has no errorRate row (schema doesn't carry success/error counts)
  { labelKey: "throughput", read: readThroughput, verdictKind: "throughput", unitSuffix: "req/s" },
];

export function rowDescriptorsForTool(tool: RunTool): MetricRowDescriptor[] {
  switch (tool) {
    case "guidellm":
      return guidellmRows;
    case "vegeta":
      return vegetaRows;
    case "genai-perf":
      return genaiPerfRows;
    default:
      // e2e / custom Runs are not supported in compare today.
      return [];
  }
}
