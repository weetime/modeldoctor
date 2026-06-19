import type { Benchmark, HydratedBenchmarkRef } from "@modeldoctor/contracts";
import type { ReportRun } from "./ReportSections";

/** Params blob → the compact summary the report header renders. */
function extractParamsSummary(params: unknown): ReportRun["paramsSummary"] {
  if (!params || typeof params !== "object") return {};
  const p = params as Record<string, unknown>;
  return {
    workload: typeof p.workload === "string" ? p.workload : undefined,
    concurrency: typeof p.concurrency === "number" ? p.concurrency : undefined,
    duration: typeof p.duration === "number" ? p.duration : undefined,
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
 * prefix-cache figures; `?? null` matches the `Benchmark.serverMetrics`
 * nullable type. The synthetic snapshot only fills the fields the report
 * actually reads off `ReportRun.benchmark`.
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
      : ({
          id: b.id,
          name: b.name ?? null,
          tool: b.tool ?? "",
          scenario: b.scenario ?? "",
          summaryMetrics: b.summaryMetrics,
          serverMetrics: b.serverMetrics ?? null,
          params: b.params,
        } as Benchmark),
    paramsSummary: extractParamsSummary(b.params),
  }));
}
