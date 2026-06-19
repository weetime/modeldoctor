import type { Benchmark, BenchmarkTool } from "@modeldoctor/contracts";
import {
  type MetricFormat,
  type MetricRowSpec,
  readMetricSafe,
  rowDescriptorsByTool,
  type VerdictKind,
} from "@modeldoctor/tool-adapters/schemas";

// summaryMetrics is the discriminated union written by tool-adapter
// parseFinalReport: { tool, data } (see
// packages/tool-adapters/src/{guidellm,vegeta,aiperf,evalscope}/runtime.ts).
// vegeta latencies are normalized to ms by the adapter (NOT ns).
//
// Per-tool row sets, MetricKind dispatch, and raw field knowledge all
// live in the adapters (`packages/tool-adapters/src/<tool>/row-descriptors.ts`
// + read-metric.ts). This module just materializes adapter specs into
// renderable rows and delegates value reads to `readMetricSafe`.

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

export type { MetricFormat, VerdictKind };

export interface MetricRowDescriptor {
  labelKey: string; // "compare.metricRowLabel.<key>"
  read: (m: SummaryMetrics) => number | null;
  verdictKind?: VerdictKind;
  digits?: number; // default 1
  unitSuffix?: string; // for the cell display (e.g. "ms", "%")
  format?: MetricFormat; // named formatter; takes precedence over digits/unitSuffix
}

function readRawField(metrics: SummaryMetrics, section: string, field: string): number | null {
  const t = metrics as { tool?: unknown; data?: Record<string, unknown> } | null;
  if (!t?.data) return null;
  const dist = t.data[section] as Record<string, unknown> | undefined;
  const v = dist?.[field];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function materialize(spec: MetricRowSpec): MetricRowDescriptor {
  if (spec.source === "metric") {
    const { labelKey, metric, verdictKind, digits, unitSuffix, format } = spec;
    return {
      labelKey,
      read: (m) => readMetricSafe(metric, m as { tool?: unknown; data?: unknown } | null),
      verdictKind,
      digits,
      unitSuffix,
      format,
    };
  }
  const { labelKey, section, field, unitSuffix, format } = spec;
  return {
    labelKey,
    read: (m) => readRawField(m, section, field),
    unitSuffix,
    format,
  };
}

// Materialized rows are cached by spec-array identity, not tool name.
// Two adapters that re-export the same spec array (evalscope + aiperf
// both re-export SHARED_INFERENCE_ROWS) therefore yield the same
// materialized array reference — preserves the identity invariant that
// compare/__tests__/metrics.test.ts asserts (`aiperf === evalscope`).
const cache = new WeakMap<readonly MetricRowSpec[], MetricRowDescriptor[]>();

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
  const specs = rowDescriptorsByTool[tool as keyof typeof rowDescriptorsByTool] as
    | readonly MetricRowSpec[]
    | undefined;
  if (!specs) return [];
  let cached = cache.get(specs);
  if (!cached) {
    cached = specs.map(materialize);
    cache.set(specs, cached);
  }
  return cached;
}
