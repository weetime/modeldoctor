// Runtime-side `readMetricSafe`. Imported by `index.ts` so api consumers
// get one helper instead of duplicating try/catch(byTool) blocks.
import type { ToolName } from "./interface.js";
import type { MetricKind } from "./metric-extractor.js";
import { type ReadMetricTable, readMetricSafeFromTable } from "./read-metric-safe.js";
import { byTool } from "./registry.js";

// Defer lookup to `byTool` so a future adapter registration is picked up
// automatically — no parallel table to keep in sync.
const RUNTIME_TABLE: ReadMetricTable = new Proxy({} as ReadMetricTable, {
  get(_t, prop: string) {
    return (kind: MetricKind, data: Record<string, unknown>) =>
      byTool(prop as ToolName).readMetric(kind, data);
  },
});

export function readMetricSafe(
  kind: MetricKind,
  summary: { tool?: unknown; data?: unknown } | null | undefined,
): number | null {
  return readMetricSafeFromTable(RUNTIME_TABLE, kind, summary);
}
