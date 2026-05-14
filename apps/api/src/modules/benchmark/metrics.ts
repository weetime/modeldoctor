import { readMetricSafe } from "@modeldoctor/tool-adapters";
import type { Prisma } from "@prisma/client";

/**
 * Backend twin of the FE `readP95Latency` reader
 * (apps/web/src/features/benchmarks/compare/metrics.ts). The per-tool field
 * paths live in each adapter's `readMetric(kind, data)` — this module just
 * picks a `MetricKind` and delegates via the shared `readMetricSafe`. Adding
 * a new tool only requires registering its adapter; this file is
 * tool-agnostic.
 *
 * Returns null whenever the metric is missing or non-finite. The reports
 * service treats null as "no data point in this run".
 */
export function readP95LatencyMs(metrics: Prisma.JsonValue | null): number | null {
  return readMetricSafe("e2e.p95", metrics as { tool?: unknown; data?: unknown } | null);
}
