export interface ParetoPoint {
  id: string;
  x: number;
  y: number;
}

export interface ParetoFrontierOptions {
  xBetter?: "higher" | "lower";
  yBetter?: "higher" | "lower";
}

/**
 * Returns the ids of the non-dominated points (the Pareto frontier).
 *
 * A point p is dominated by another point q iff q is no worse than p on
 * both axes and strictly better on at least one axis (respecting each
 * axis's better-direction). Points that are dominated by no other point
 * form the frontier.
 *
 * Defaults match the quadrant scatter's score/latency semantics:
 * x (score) higher is better, y (latency) lower is better.
 */
export function paretoFrontier(
  points: ParetoPoint[],
  opts?: ParetoFrontierOptions,
): Set<string> {
  const xBetter = opts?.xBetter ?? "higher";
  const yBetter = opts?.yBetter ?? "lower";

  const xSign = xBetter === "higher" ? 1 : -1;
  const ySign = yBetter === "higher" ? 1 : -1;

  const frontier = new Set<string>();

  for (const p of points) {
    let dominated = false;
    for (const q of points) {
      if (q === p) continue;

      const qBetterOrEqualX = (q.x - p.x) * xSign >= 0;
      const qBetterOrEqualY = (q.y - p.y) * ySign >= 0;
      const qStrictlyBetterX = (q.x - p.x) * xSign > 0;
      const qStrictlyBetterY = (q.y - p.y) * ySign > 0;

      if (
        qBetterOrEqualX &&
        qBetterOrEqualY &&
        (qStrictlyBetterX || qStrictlyBetterY)
      ) {
        dominated = true;
        break;
      }
    }
    if (!dominated) {
      frontier.add(p.id);
    }
  }

  return frontier;
}
