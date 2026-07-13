import type { Finding, RadarAxisId, ScenarioId, Severity } from "@modeldoctor/contracts";

export type Direction = "lower_is_better" | "higher_is_better";

const SEVERITY_SCORE: Record<Exclude<Severity, "no_data">, number> = {
  good: 1.0,
  warn: 0.5,
  crit: 0.0,
};

export function evaluateSeverity(
  value: number | null,
  threshold: { warn: number; crit: number },
  direction: Direction,
): Severity {
  if (value === null) return "no_data";
  if (direction === "lower_is_better") {
    if (value >= threshold.crit) return "crit";
    if (value >= threshold.warn) return "warn";
    return "good";
  }
  if (value <= threshold.crit) return "crit";
  if (value <= threshold.warn) return "warn";
  return "good";
}

export function scenarioScore(findings: Finding[]): number | null {
  const scored = findings.filter((f) => f.severity !== "no_data");
  if (scored.length === 0) return null;
  let weightedSum = 0;
  let totalWeight = 0;
  for (const f of scored) {
    weightedSum += SEVERITY_SCORE[f.severity as Exclude<Severity, "no_data">] * f.weight;
    totalWeight += f.weight;
  }
  if (totalWeight === 0) return null;
  return Math.round((weightedSum / totalWeight) * 100);
}

export function compositeScore(perScenario: Record<ScenarioId, number | null>): number | null {
  const present = Object.values(perScenario).filter((s): s is number => s !== null);
  if (present.length === 0) return null;
  return Math.round(present.reduce((a, b) => a + b, 0) / present.length);
}

export function axisValue(axis: RadarAxisId, findings: Finding[]): number | null {
  const onAxis = findings.filter((f) => f.axis === axis && f.severity !== "no_data");
  if (onAxis.length === 0) return null;
  let weightedSum = 0;
  let totalWeight = 0;
  for (const f of onAxis) {
    weightedSum += SEVERITY_SCORE[f.severity as Exclude<Severity, "no_data">] * f.weight;
    totalWeight += f.weight;
  }
  if (totalWeight === 0) return null;
  return weightedSum / totalWeight;
}
