import i18n from "@/lib/i18n";
import type { Benchmark, Finding, ProfileRules } from "@modeldoctor/contracts";
import { ALL_CHECKS, type CheckDescriptor } from "./checks/descriptors";
import { evaluateSeverity } from "./evaluate";

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

interface AggregateResult {
  value: number | null;
  contributingRunIds: string[];
}

export function aggregateCheck(check: CheckDescriptor, runs: Benchmark[]): number | null {
  return aggregateCheckDetailed(check, runs).value;
}

export function aggregateCheckDetailed(check: CheckDescriptor, runs: Benchmark[]): AggregateResult {
  const matched = runs.filter(
    (r) =>
      r.scenario === check.scenario &&
      r.status === "completed" &&
      (!check.toolFilter || check.toolFilter.includes(r.tool)),
  );
  const samples: { id: string; v: number }[] = [];
  for (const r of matched) {
    const v = check.read(r.summaryMetrics);
    if (v !== null) samples.push({ id: r.id, v });
  }
  if (samples.length === 0) return { value: null, contributingRunIds: [] };
  return {
    value: median(samples.map((s) => s.v)),
    contributingRunIds: samples.map((s) => s.id),
  };
}

export function buildFindings(runs: Benchmark[], profile: ProfileRules): Finding[] {
  const findings: Finding[] = [];
  for (const check of ALL_CHECKS) {
    const rule = profile.checks[check.id];
    const { value, contributingRunIds } = aggregateCheckDetailed(check, runs);
    const severity = rule ? evaluateSeverity(value, rule, check.direction) : "no_data";
    findings.push({
      checkId: check.id,
      scenario: check.scenario,
      axis: check.axis,
      severity,
      value,
      threshold: rule ?? { warn: 0, crit: 0 },
      weight: rule?.weight ?? check.defaultWeight,
      recommendation: i18n.t(check.recommendationKey, { ns: "insights", defaultValue: "" }),
      contributingRunIds,
    });
  }
  return findings;
}
