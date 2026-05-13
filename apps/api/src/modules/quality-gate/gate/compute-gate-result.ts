import type { AggregateMetrics, GateConfig, GateResult } from "@modeldoctor/contracts";

export interface GateOutcome {
  result: GateResult;
  failures: string[];
  warnings: string[];
}

export function computeGateResult(metrics: AggregateMetrics, gateConfig: GateConfig): GateOutcome {
  const failures: string[] = [];
  const warnings: string[] = [];

  const passRate = metrics.passRateB ?? metrics.passRateA;
  if (gateConfig.passRateMin != null) {
    if (passRate < gateConfig.passRateMin - 0.05) failures.push("passRate");
    else if (passRate < gateConfig.passRateMin) warnings.push("passRate");
  }

  if (gateConfig.regressionMax != null && metrics.regressionCount != null) {
    if (metrics.regressionCount > gateConfig.regressionMax * 1.5) failures.push("regression");
    else if (metrics.regressionCount > gateConfig.regressionMax) warnings.push("regression");
  }

  if (gateConfig.judgeScoreMin != null && metrics.judgeAvgB != null) {
    if (metrics.judgeAvgB < gateConfig.judgeScoreMin - 0.5) failures.push("judgeScore");
    else if (metrics.judgeAvgB < gateConfig.judgeScoreMin) warnings.push("judgeScore");
  }

  if (failures.length) return { result: "FAILED", failures, warnings };
  if (warnings.length) return { result: "WARNING", failures: [], warnings };
  return { result: "PASSED", failures: [], warnings: [] };
}
