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
  narrative: CompareNarrative | null;
  context: string | null;
  /** Pre-derived per-run "connection / model / tool / version" lines. */
  environmentLines: string[];
}

/**
 * 7-section saved-compare report layout shared between the ad-hoc Compare page and the
 * SavedCompareDetail page. Sections (in order):
 *   1. TL;DR (narrative.tldr)
 *   2. Test matrix (per-run table)
 *   3. CompareGrid (existing metric grid)
 *   4. Charts (StageBarChartsSection — bare grid, no extra border; chart already has chrome)
 *   5. Analysis (narrative.analysis)
 *   6. Conclusion (narrative.conclusion)
 *   7. Test environment (environmentLines + free-text context)
 *
 * `data-report-root` is exposed for the future export-as-HTML utility (Task 18) so it
 * can serialize a single subtree.
 */
export function ReportSections({
  runs,
  baselineId,
  narrative,
  context,
  environmentLines,
}: ReportSectionsProps) {
  const { t } = useTranslation("benchmarks");
  const livingRuns = runs.filter((r) => r.benchmark !== null);

  return (
    <div data-report-root className="space-y-8">
      {/* 1. TL;DR */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">{t("savedCompare.report.sectionTldr")}</h2>
        {narrative ? (
          <ul className="space-y-2">
            {narrative.tldr.map((row, i) => (
              <li key={i} className="rounded-md border border-border p-3">
                <div className="font-medium">{row.headline}</div>
                <div className="text-sm text-muted-foreground">{row.oneLine}</div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-sm text-muted-foreground">
            {t("savedCompare.report.narrativeMissing")}
          </div>
        )}
      </section>

      {/* 2. Test matrix */}
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

      {/* 3. CompareGrid */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">{t("savedCompare.report.sectionGrid")}</h2>
        <CompareGrid
          runs={livingRuns.map((r) => r.benchmark) as Benchmark[]}
          baselineId={baselineId}
        />
      </section>

      {/* 4. Charts — bare grid; StageBarChart already provides border+padding chrome. */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">{t("savedCompare.report.sectionCharts")}</h2>
        <StageBarChartsSection runs={livingRuns} />
      </section>

      {/* 5. Analysis */}
      {narrative && narrative.analysis.length > 0 ? (
        <section>
          <h2 className="mb-3 text-lg font-semibold">{t("savedCompare.report.sectionAnalysis")}</h2>
          <div className="space-y-3">
            {narrative.analysis.map((row, i) => (
              <div key={i}>
                <div className="text-sm font-medium">{row.metricLabel}</div>
                <div className="text-sm text-muted-foreground">{row.body}</div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* 6. Conclusion */}
      {narrative ? (
        <section>
          <h2 className="mb-3 text-lg font-semibold">
            {t("savedCompare.report.sectionConclusion")}
          </h2>
          <p>{narrative.conclusion.recommendation}</p>
          {narrative.conclusion.caveats.length > 0 ? (
            <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">
              {narrative.conclusion.caveats.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {/* 7. Test environment */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">{t("savedCompare.report.sectionEnv")}</h2>
        <ul className="space-y-1 text-sm text-muted-foreground">
          {environmentLines.map((line, i) => (
            <li key={i}>{line}</li>
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
