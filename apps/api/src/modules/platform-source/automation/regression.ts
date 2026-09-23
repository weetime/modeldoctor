import type {
  AutomationSchedule,
  RegressionMetric,
  RegressionThresholds,
} from "@modeldoctor/contracts";
import { readMetricSafe } from "@modeldoctor/tool-adapters";

type Summary = { tool?: unknown; data?: unknown } | null;

const RULES: Array<{
  metric: RegressionMetric["metric"];
  /** 变化方向：'drop' 表示下降为坏，'rise' 表示上升为坏 */
  bad: "drop" | "rise";
  threshold: (t: RegressionThresholds) => number;
}> = [
  { metric: "outputTokensPerSec", bad: "drop", threshold: (t) => t.outputTokensPerSecDropPct },
  { metric: "ttft.p95", bad: "rise", threshold: (t) => t.ttftP95RisePct },
  { metric: "itl.p95", bad: "rise", threshold: (t) => t.itlP95RisePct },
];

export function detectRegression(input: {
  baseline: unknown;
  candidate: unknown;
  thresholds: RegressionThresholds;
}): { regressed: boolean; metrics: RegressionMetric[] } {
  const metrics = RULES.map((r): RegressionMetric => {
    const baseline = readMetricSafe(r.metric, input.baseline as Summary);
    const current = readMetricSafe(r.metric, input.candidate as Summary);
    const thresholdPct = r.threshold(input.thresholds);
    if (baseline == null || current == null || baseline === 0) {
      return {
        metric: r.metric,
        baseline,
        current,
        changePct: null,
        thresholdPct,
        exceeded: false,
      };
    }
    const changePct = ((current - baseline) / baseline) * 100;
    const exceeded = r.bad === "drop" ? -changePct > thresholdPct : changePct > thresholdPct;
    return { metric: r.metric, baseline, current, changePct, thresholdPct, exceeded };
  });
  return { regressed: metrics.some((m) => m.exceeded), metrics };
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function nextScheduleAt(schedule: AutomationSchedule, from: Date): Date | null {
  if (schedule === "daily") return new Date(from.getTime() + DAY_MS);
  if (schedule === "weekly") return new Date(from.getTime() + 7 * DAY_MS);
  return null;
}
