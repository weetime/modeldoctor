// Shared metric formatters for the Compare page (tables + charts + tooltips).
// Mainstream readability rules: latency in ms shows no false precision, error
// rate reads as a percentage (not a raw 0-1 fraction), throughput keeps one
// decimal. All accept null and degrade to an em dash.

const DASH = "—";

/**
 * Latency in milliseconds. ≥100 ms drops decimals (831 ms); <100 ms keeps one
 * (13.2 ms) so sub-10ms metrics like ITL don't collapse to integers.
 */
export function formatLatencyMs(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  const digits = Math.abs(n) >= 100 ? 0 : 1;
  return `${n.toFixed(digits)} ms`;
}

/** Error rate stored as a 0-1 fraction → percentage with one decimal. */
export function formatPercentFromFraction(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  return `${(n * 100).toFixed(1)}%`;
}

/** A value already on a 0-100 scale (hit rate / top pod share) → one decimal. */
export function formatPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  return `${n.toFixed(1)}%`;
}

/** Throughput in requests per second, one decimal. */
export function formatThroughput(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  return `${n.toFixed(1)} req/s`;
}
