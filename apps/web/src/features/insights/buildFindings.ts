import type { Benchmark, Finding, ProfileRules } from "@modeldoctor/contracts";
import {
  type AggregatableCheck,
  buildFindingsCore,
  aggregateCheckDetailed as coreAggregateCheckDetailed,
  type RunLike,
} from "@modeldoctor/insights-scoring";
import { readMetricSafe } from "@modeldoctor/tool-adapters/schemas";
import i18n from "@/lib/i18n";

// `run.summaryMetrics` is the contracts-side discriminated union; the helper
// just needs `{ tool?, data? }`. Cast at the boundary like compare/metrics.ts.
const feReader = (kind: Parameters<typeof readMetricSafe>[0], m: unknown) =>
  readMetricSafe(kind, m as { tool?: unknown; data?: unknown } | null);

interface AggregateResult {
  value: number | null;
  contributingRunIds: string[];
}

export function aggregateCheckDetailed(
  check: AggregatableCheck,
  runs: Benchmark[],
): AggregateResult {
  return coreAggregateCheckDetailed(check, runs as unknown as RunLike[], feReader as never);
}

export function aggregateCheck(check: AggregatableCheck, runs: Benchmark[]): number | null {
  return aggregateCheckDetailed(check, runs).value;
}

export function buildFindings(runs: Benchmark[], profile: ProfileRules): Finding[] {
  const core = buildFindingsCore(runs as unknown as RunLike[], profile, feReader as never);
  return core.map((f) => ({
    ...f,
    recommendation: i18n.t(`checks.${f.checkId}.recommendation`, {
      ns: "insights",
      defaultValue: "",
    }),
  }));
}
