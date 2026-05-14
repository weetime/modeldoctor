import { type MetricKind, type ToolName, byTool } from "@modeldoctor/tool-adapters";
import type { Prisma } from "@prisma/client";

/**
 * Backend twin of the FE `readP95Latency` reader
 * (apps/web/src/features/benchmarks/compare/metrics.ts). The per-tool field
 * paths live in each adapter's `readMetric(kind, data)` — this module just
 * picks a `MetricKind` and delegates. Adding a new tool only requires
 * registering its adapter; this file is tool-agnostic.
 *
 * Returns null whenever the metric is missing or non-finite. The reports
 * service treats null as "no data point in this run".
 */
type Tagged = { tool?: unknown; data?: Record<string, unknown> };

function asTagged(metrics: Prisma.JsonValue | null): Tagged | null {
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) return null;
  const m = metrics as Tagged;
  return m.data && typeof m.data === "object" && !Array.isArray(m.data) ? m : null;
}

function readByKind(kind: MetricKind, metrics: Prisma.JsonValue | null): number | null {
  const m = asTagged(metrics);
  if (!m?.data || typeof m.tool !== "string") return null;
  try {
    return byTool(m.tool as ToolName).readMetric(kind, m.data);
  } catch {
    // byTool throws on unknown tool names; tolerate stale rows whose tool
    // is no longer registered (e.g. a Run from a deleted-tool migration).
    return null;
  }
}

export function readP95LatencyMs(metrics: Prisma.JsonValue | null): number | null {
  return readByKind("e2e.p95", metrics);
}
