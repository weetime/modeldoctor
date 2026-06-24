/**
 * Per-row distribution stats for the compare Key-metrics grid.
 *
 * When no baseline is selected, cells are oriented against the row mean: an
 * arrow shows direction vs mean and strong outliers get a heatmap tint. These
 * helpers are pure so the thresholds stay unit-tested and out of the render.
 */

export interface RowStats {
  mean: number;
  /** Population standard deviation. */
  std: number;
  n: number;
}

/**
 * Mean + population std over the finite values in a row. Returns null when
 * fewer than {@link MIN_SAMPLES} values are present — a "mean" over one or two
 * points isn't a meaningful reference, so the grid skips arrows/highlight then.
 */
export const MIN_SAMPLES = 3;

export function rowStats(values: readonly (number | null)[]): RowStats | null {
  const nums = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (nums.length < MIN_SAMPLES) return null;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
  return { mean, std: Math.sqrt(variance), n: nums.length };
}

// Outlier gate: BOTH a spread test (z-score) AND a magnitude test (relative
// deviation). The z-score alone over-flags tightly-clustered rows (e.g. ITL
// 24.8–29.9 ms, where +15% reads as ~2.5σ); the relative floor keeps "modest
// but technically far" values from lighting up. A value must clear both.
export const OUTLIER_Z = 2;
export const OUTLIER_REL = 0.25;

export function isOutlier(value: number, stats: RowStats): boolean {
  if (stats.std === 0) return false;
  const z = Math.abs(value - stats.mean) / stats.std;
  const rel = stats.mean !== 0 ? Math.abs(value - stats.mean) / Math.abs(stats.mean) : 0;
  return z >= OUTLIER_Z && rel >= OUTLIER_REL;
}
