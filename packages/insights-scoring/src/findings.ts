import type { Finding, ProfileRules } from "@modeldoctor/contracts";
import type { MetricKind } from "@modeldoctor/tool-adapters";
import { ALL_CHECKS } from "./descriptors.js";
import { evaluateSeverity } from "./evaluate.js";

export type MetricReader = (kind: MetricKind, metrics: unknown) => number | null;
export type RunLike = {
  id: string;
  scenario: string;
  status: string;
  tool: string;
  summaryMetrics: unknown;
};

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function aggregate(
  kind: MetricKind,
  scenario: string,
  toolFilter: string[] | undefined,
  runs: RunLike[],
  read: MetricReader,
) {
  const matched = runs.filter(
    (r) =>
      r.scenario === scenario &&
      r.status === "completed" &&
      (!toolFilter || toolFilter.includes(r.tool)),
  );
  const samples: { id: string; v: number }[] = [];
  for (const r of matched) {
    const v = read(kind, r.summaryMetrics);
    if (v !== null) samples.push({ id: r.id, v });
  }
  if (samples.length === 0) return { value: null as number | null, ids: [] as string[] };
  return { value: median(samples.map((s) => s.v)), ids: samples.map((s) => s.id) };
}

export function buildFindingsCore(
  runs: RunLike[],
  rules: ProfileRules,
  read: MetricReader,
): Finding[] {
  const out: Finding[] = [];
  for (const check of ALL_CHECKS) {
    const rule = rules.checks[check.id];
    const { value, ids } = aggregate(
      check.metricKind,
      check.scenario,
      check.toolFilter,
      runs,
      read,
    );
    out.push({
      checkId: check.id,
      scenario: check.scenario,
      axis: check.axis,
      severity: rule ? evaluateSeverity(value, rule, check.direction) : "no_data",
      value,
      threshold: rule ?? { warn: 0, crit: 0 },
      weight: rule?.weight ?? check.defaultWeight,
      recommendation: "",
      contributingRunIds: ids,
    });
  }
  return out;
}

export function bandFromScore(score: number | null) {
  if (score == null) return null;
  if (score >= 85) return "recommended" as const;
  if (score >= 60) return "usable" as const;
  return "not-recommended" as const;
}

export function nativeMetric(
  scenario: string,
  runs: RunLike[],
  read: MetricReader,
): { kind: MetricKind; value: number } | null {
  const kind: MetricKind = "e2e.p95";
  const { value } = aggregate(kind, scenario, undefined, runs, read);
  return value == null ? null : { kind, value };
}
