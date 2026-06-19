import type { HydratedBenchmarkRef } from "@modeldoctor/contracts";
import type { ReportRun } from "./ReportSections";

/** Params blob → the compact summary the matrix renders (concurrency only;
 * workload/duration are not meaningful across these tools — see the scenario
 * redesign that dropped those matrix columns). Shared with `BenchmarkComparePage`,
 * which builds its own `ReportRun[]` from live `Benchmark` rows but derives
 * `paramsSummary` identically. */
export function extractParamsSummary(params: unknown): ReportRun["paramsSummary"] {
  if (!params || typeof params !== "object") return {};
  const p = params as Record<string, unknown>;
  return {
    concurrency: typeof p.concurrency === "number" ? p.concurrency : undefined,
  };
}

/**
 * Map the SavedCompare API's hydrated benchmark refs into the `ReportRun` shape
 * the report renderer consumes.
 *
 * SINGLE SOURCE — both the in-app detail page (`/reports/:id`) and the
 * print/export preview (`/reports/:id/preview`) call this, so the two surfaces
 * can't drift. (Past bug: this mapping was copy-pasted into both pages and
 * `serverMetrics` was copied in one but not the other, dropping the
 * prefix-cache-hit / top-pod-share figures from one surface.)
 *
 * `serverMetrics` carries `serverMetrics.prefixCache`, required by the
 * prefix-cache figures; `?? null` normalises "absent" to null. The snapshot is
 * typed as `ReportBenchmarkSnapshot` (not `Benchmark`) — exactly the fields the
 * report reads — so it needs no `as Benchmark` cast, and the next missing field
 * is a compile error rather than a silent `undefined` (the #302 footgun).
 */
export function toReportRuns(benchmarks: HydratedBenchmarkRef[]): ReportRun[] {
  return benchmarks.map((b) => ({
    id: b.id,
    stageLabel: b.stageLabel,
    tool: b.tool ?? "",
    scenario: b.scenario ?? "",
    summaryMetrics: b.summaryMetrics,
    benchmark: b.missing
      ? null
      : {
          id: b.id,
          name: b.name ?? null,
          tool: b.tool ?? "",
          scenario: b.scenario ?? "",
          summaryMetrics: b.summaryMetrics,
          serverMetrics: b.serverMetrics ?? null,
        },
    paramsSummary: extractParamsSummary(b.params),
  }));
}
