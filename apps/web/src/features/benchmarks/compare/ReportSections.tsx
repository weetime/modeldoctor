import type { Benchmark, CompareNarrative } from "@modeldoctor/contracts";
import { useTranslation } from "react-i18next";
import { CompareGrid } from "./CompareGrid";
import { StageBarChartsSection, type StageRun } from "./StageBarChartsSection";

export interface ReportRun extends StageRun {
  /** Full benchmark snapshot, or null if the underlying benchmark was deleted. */
  benchmark: Benchmark | null;
  paramsSummary: { workload?: string; concurrency?: number; duration?: number };
  scenario: string;
}

export interface ReportSectionsProps {
  runs: ReportRun[];
  baselineId: string | null;
  /** Kept for backward compatibility with BenchmarkComparePage callers — narrative
   *  rendering itself now lives in `<SavedCompareReport>`. */
  narrative: CompareNarrative | null;
  context: string | null;
  /** Pre-derived per-run "connection / model / tool / version" lines. */
  environmentLines: string[];
}

/**
 * Pre-narrative "raw matrix" preview. Renders the per-run table + the metric
 * grid + the four bar charts. Used by:
 *   - BenchmarkComparePage (ad-hoc compare, no narrative)
 *
 * The narrative deep report (Hero + summary cards + 6 sections + figures)
 * is rendered by `<SavedCompareReport>`, not here.
 *
 * `data-report-root` is exposed for the export-as-HTML utility.
 */
export function ReportSections({
  runs,
  baselineId,
  context,
  environmentLines,
}: ReportSectionsProps) {
  const { t } = useTranslation("benchmarks");
  const livingRuns = runs.filter((r) => r.benchmark !== null);

  return (
    <div data-report-root className="space-y-8">
      {/* 1. Test matrix */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">{t("savedCompare.report.sectionMatrix")}</h2>
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">stage</th>
                <th className="px-3 py-2">name</th>
                <th className="px-3 py-2">tool</th>
                <th className="px-3 py-2">scenario</th>
                <th className="px-3 py-2">workload</th>
                <th className="px-3 py-2">concurrency</th>
                <th className="px-3 py-2">duration</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-border border-t">
                  <td className="px-3 py-2 font-medium">{r.stageLabel}</td>
                  <td className="px-3 py-2">
                    {r.benchmark === null
                      ? t("savedCompare.detail.missingBenchmark")
                      : r.benchmark.name}
                  </td>
                  <td className="px-3 py-2">{r.benchmark?.tool ?? "—"}</td>
                  <td className="px-3 py-2">{r.scenario}</td>
                  <td className="px-3 py-2">{r.paramsSummary.workload ?? "—"}</td>
                  <td className="px-3 py-2">{r.paramsSummary.concurrency ?? "—"}</td>
                  <td className="px-3 py-2">{r.paramsSummary.duration ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 2. CompareGrid */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">{t("savedCompare.report.sectionGrid")}</h2>
        <CompareGrid
          runs={livingRuns.map((r) => r.benchmark) as Benchmark[]}
          baselineId={baselineId}
        />
      </section>

      {/* 3. Charts */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">{t("savedCompare.report.sectionCharts")}</h2>
        <StageBarChartsSection runs={livingRuns} />
      </section>

      {/* 4. Test environment */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">{t("savedCompare.report.sectionEnv")}</h2>
        <ul className="space-y-1 text-sm text-muted-foreground">
          {environmentLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {context ? (
          <div className="mt-3 whitespace-pre-wrap rounded-md border border-border bg-muted/20 p-3 text-sm">
            {context}
          </div>
        ) : null}
      </section>
    </div>
  );
}
