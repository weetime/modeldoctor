import type { ToolName } from "./interface.js";
import type { MetricKind } from "./metric-extractor.js";

/**
 * Per-tool metric extractor map. Filled in by `read-metric-safe.runtime.ts`
 * (api side) or `read-metric-safe.fe.ts` (web side) so this file itself
 * stays free of any adapter-runtime imports — both entries (`index.ts`
 * and `schemas-entry.ts`) can share the same helper shape.
 */
export type ReadMetricFn = (kind: MetricKind, data: Record<string, unknown>) => number | null;

export type ReadMetricTable = Readonly<Record<ToolName, ReadMetricFn>>;

/**
 * Read one metric from a `{ tool, data }` discriminated summary in a
 * single try-catch step. Returns `null` when:
 *   - summary is null/undefined / not an object
 *   - tool name doesn't match any registered adapter (stale DB rows
 *     from a deleted-tool migration that somehow survived)
 *   - the adapter has no value for that kind / shape doesn't match
 *
 * Centralizing this avoids the duplicate try/catch + asTagged blocks
 * PR #183 reviewers flagged across 5 consumer files.
 *
 * Callers build a thin wrapper that closes over the per-environment
 * `table` (api runtime: `byTool(name).readMetric`; web FE: the
 * per-adapter `<tool>ReadMetric` exports from `schemas-entry`).
 */
export function readMetricSafeFromTable(
  table: ReadMetricTable,
  kind: MetricKind,
  summary: { tool?: unknown; data?: unknown } | null | undefined,
): number | null {
  if (!summary || typeof summary !== "object") return null;
  const { tool, data } = summary;
  if (typeof tool !== "string") return null;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const fn = (table as Record<string, ReadMetricFn | undefined>)[tool];
  if (!fn) return null;
  try {
    return fn(kind, data as Record<string, unknown>);
  } catch {
    return null;
  }
}
