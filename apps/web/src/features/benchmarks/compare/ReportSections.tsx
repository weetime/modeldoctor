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
 * Phase 1 transitional report layout. The narrative is now produced under the
 * new (schemaVersion: 2) shape with hero / summaryCards / sections / figures,
 * but is rendered here in plain (non-Primer) chrome. Phase 2 replaces this file
 * with `SavedCompareReport.tsx` running the full Primer visual system.
 *
 * Structure (in order):
 *   - Test matrix (per-run table)
 *   - CompareGrid (metric grid)
 *   - Charts (StageBarChartsSection)
 *   - Narrative (Hero + Summary Cards + 6 sections + figure captions) — when present
 *   - Test environment (environmentLines + free-text context)
 *
 * `data-report-root` is exposed for the existing export-as-HTML utility.
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

      {/* 4. Narrative (Phase 1 placeholder rendering) */}
      {narrative ? (
        <section className="space-y-6">
          <header className="space-y-2">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              {narrative.hero.eyebrow}
            </div>
            <h2 className="text-2xl font-semibold leading-tight">{narrative.hero.title}</h2>
            <p className="text-base text-muted-foreground">{narrative.hero.subtitle}</p>
            {narrative.hero.metaItems.length > 0 ? (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1 pt-2 text-sm md:grid-cols-4">
                {narrative.hero.metaItems.map((m) => (
                  <div key={m.label} className="flex gap-2">
                    <dt className="text-muted-foreground">{m.label}</dt>
                    <dd className="font-medium">{m.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </header>

          {narrative.summaryCards.length > 0 ? (
            <div
              className="grid gap-3"
              style={{
                gridTemplateColumns: `repeat(${narrative.summaryCards.length}, minmax(0, 1fr))`,
              }}
            >
              {narrative.summaryCards.map((c) => (
                <div
                  key={c.label}
                  className="rounded-md border border-border bg-card p-4"
                  data-tone={c.tone}
                >
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">
                    {c.label}
                  </div>
                  <div className="mt-1 text-2xl font-semibold leading-none">
                    {c.value}
                    {c.unit ? (
                      <span className="ml-1 text-sm font-normal text-muted-foreground">
                        {c.unit}
                      </span>
                    ) : null}
                  </div>
                  {c.trend ? (
                    <div className="mt-1 text-sm text-muted-foreground">{c.trend}</div>
                  ) : null}
                  {c.foot ? (
                    <div className="mt-1 text-xs text-muted-foreground">{c.foot}</div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {narrative.sections.map((s) => (
            <article key={s.id} className="space-y-3" id={`section-${s.id}`}>
              <h3 className="text-lg font-semibold">
                <span className="mr-2 font-mono text-sm text-muted-foreground">{s.num}</span>
                {s.title}
              </h3>
              {/* Phase 1: render bodyMarkdown as paragraph-separated preformatted text.
                  Phase 2 swaps in react-markdown + remark-gfm for tables and bold. */}
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                {s.bodyMarkdown}
              </div>
            </article>
          ))}

          {narrative.figures.length > 0 ? (
            <div className="space-y-1 border-t border-border pt-4 text-xs text-muted-foreground">
              <div className="font-medium">Figure captions:</div>
              <ul className="list-disc pl-5">
                {narrative.figures.map((f) => (
                  <li key={f.id}>
                    <span className="font-mono text-xs">{f.refId}</span> · {f.caption}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {narrative.lintWarnings.length > 0 ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
              <div className="mb-1 font-semibold">
                {t("savedCompare.report.lintWarnings", { defaultValue: "Style warnings" })} (
                {narrative.lintWarnings.length})
              </div>
              <ul className="list-disc pl-4">
                {narrative.lintWarnings.slice(0, 10).map((w, i) => (
                  <li key={i}>
                    <span className="font-mono">{w.code}</span>
                    {w.sectionId ? <span> @ {w.sectionId}</span> : null}
                    {w.sample ? <span> — &quot;{w.sample}&quot;</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* 5. Test environment */}
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
