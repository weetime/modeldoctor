// FE-side `readMetricSafe`. Imported by `schemas-entry.ts` so the web
// bundle gets the helper without dragging in adapter runtimes.
//
// Each adapter's `<tool>ReadMetric` lives in `<tool>/read-metric.ts`
// (no runtime.ts dependency), so this table is FE-safe.
import { aiperfReadMetric } from "../aiperf/read-metric.js";
import { evalscopeReadMetric } from "../evalscope/read-metric.js";
import { guidellmReadMetric } from "../guidellm/read-metric.js";
import { vegetaReadMetric } from "../vegeta/read-metric.js";
import type { MetricKind } from "./metric-extractor.js";
import { type ReadMetricTable, readMetricSafeFromTable } from "./read-metric-safe.js";

const FE_TABLE: ReadMetricTable = {
  guidellm: guidellmReadMetric,
  vegeta: vegetaReadMetric,
  evalscope: evalscopeReadMetric,
  aiperf: aiperfReadMetric,
};

export function readMetricSafe(
  kind: MetricKind,
  summary: { tool?: unknown; data?: unknown } | null | undefined,
): number | null {
  return readMetricSafeFromTable(FE_TABLE, kind, summary);
}
