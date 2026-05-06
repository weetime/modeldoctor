import type { Prisma } from "@prisma/client";

/**
 * Backend twin of the FE `readP95Latency` reader
 * (apps/web/src/features/benchmarks/compare/metrics.ts). Kept in sync
 * with the tool-adapter parseFinalReport shapes:
 *   guidellm → data.e2eLatency.p95     (ms)
 *   vegeta   → data.latencies.p95      (ms; runtime normalizes from
 *                                        Go-duration units before persist)
 *   genai-perf → data.requestLatency.p95 (ms)
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

function asFiniteNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function fromDist(data: Record<string, unknown>, key: string, field: string): number | null {
  const dist = data[key] as Record<string, unknown> | undefined;
  return asFiniteNumber(dist?.[field]);
}

export function readP95LatencyMs(metrics: Prisma.JsonValue | null): number | null {
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
