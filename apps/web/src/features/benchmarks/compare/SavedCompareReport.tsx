import type { CompareNarrative, SectionId } from "@modeldoctor/contracts";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import { Link } from "react-router-dom";
import remarkGfm from "remark-gfm";
import { FigureRenderer } from "./FigureRenderer";
import type { ReportRun } from "./ReportSections";

export interface SavedCompareReportProps {
  narrative: CompareNarrative;
  runs: ReportRun[];
  /** Optional print-time header text (one-line, gray). */
  printHeader?: string;
  /** Inline on the compare page: no TOC, no scroll-spy, no data-report-root. */
  embedded?: boolean;
}

/**
 * Primer-flavored deep report. The whole component is wrapped in the
 * `.primer-report` class so the standalone CSS tokens in primer-report.css
 * apply — keeps Primer styling self-contained without polluting global CSS.
 *
 * Layout matches ~/vllm/repots/templates/report-html-primer/index.html:
 *   - Hero (eyebrow + h1 + subtitle + meta row)
 *   - Summary cards (2-4, top color stripe)
 *   - 6 numbered sections; each carries figures whose `anchorSection` matches
 *   - Lint-warning callout (when present)
 *   - Sticky left-rail TOC with scroll-spy
 */
export function SavedCompareReport({
  narrative,
  runs,
  printHeader,
  embedded = false,
}: SavedCompareReportProps) {
  const { t } = useTranslation("benchmarks");
  const sections = narrative.sections;
  const figuresBySection = useMemo(() => {
    const map = new Map<SectionId, typeof narrative.figures>();
    for (const f of narrative.figures) {
      const key = f.anchorSection ?? "results";
      const arr = map.get(key) ?? [];
      arr.push(f);
      map.set(key, arr);
    }
    return map;
  }, [narrative.figures]);

  // Scroll-spy: highlight TOC entry for the section currently in view.
  const [activeId, setActiveId] = useState<string>(sections[0]?.id ?? "");
  useEffect(() => {
    if (embedded) return;
    function onScroll() {
      let nearest: string = sections[0]?.id ?? "";
      for (const s of sections) {
        const el = document.getElementById(`pr-section-${s.id}`);
        if (!el) continue;
        if (el.getBoundingClientRect().top - 96 <= 0) {
          nearest = s.id;
        }
      }
      setActiveId(nearest);
    }
    document.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => document.removeEventListener("scroll", onScroll);
  }, [sections, embedded]);

  let figureCounter = 0;
  function nextFigureNumber(): number {
    figureCounter += 1;
    return figureCounter;
  }

  return (
    <div
      className="primer-report"
      {...(embedded ? {} : { "data-report-root": true })}
      data-print-header={printHeader ?? ""}
    >
      <div className={`pr-layout${embedded ? " pr-layout-embedded" : ""}`}>
        {embedded ? null : (
          <nav
            className="pr-toc"
            aria-label={t("savedCompare.report.toc", { defaultValue: "Contents" })}
          >
            <div className="pr-toc-title">
              {t("savedCompare.report.toc", { defaultValue: "Contents" })}
            </div>
            <ul>
              {sections.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#pr-section-${s.id}`}
                    className={activeId === s.id ? "active" : undefined}
                  >
                    {s.num} {s.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}

        <main className="pr-canvas">
          {/* Hero */}
          <header className="pr-hero">
            <span className="pr-eyebrow">{narrative.hero.eyebrow}</span>
            <h1>{narrative.hero.title}</h1>
            <p className="pr-hero-sub">{narrative.hero.subtitle}</p>
            {narrative.hero.metaItems.length > 0 ? (
              <div className="pr-hero-meta">
                {narrative.hero.metaItems.map((m) => (
                  <span key={m.label} className="pr-hero-meta-item">
                    <strong>{m.label}</strong> {m.value}
                  </span>
                ))}
              </div>
            ) : null}
          </header>

          {/* Summary cards */}
          {narrative.summaryCards.length > 0 ? (
            <div
              className="pr-summary-cards"
              style={
                {
                  "--pr-card-count": narrative.summaryCards.length,
                } as React.CSSProperties
              }
            >
              {narrative.summaryCards.map((c) => (
                <div key={c.label} className="pr-card" data-tone={c.tone}>
                  <div className="pr-card-label">{c.label}</div>
                  <div className="pr-card-value">
                    {c.value}
                    {c.unit ? <span className="pr-unit">{c.unit}</span> : null}
                  </div>
                  {c.trend ? <div className="pr-card-trend">{c.trend}</div> : null}
                  {c.foot ? <div className="pr-card-foot">{c.foot}</div> : null}
                </div>
              ))}
            </div>
          ) : null}

          {/* Lint-warning callout (if any) */}
          {narrative.lintWarnings.length > 0 ? (
            <div className="pr-callout pr-callout-attention">
              <span className="pr-callout-title">
                ⚠ Style warnings ({narrative.lintWarnings.length})
              </span>
              <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
                {narrative.lintWarnings.slice(0, 10).map((w) => (
                  <li key={`${w.code}-${w.sectionId ?? "_"}-${w.sample}`}>
                    <code>{w.code}</code>
                    {w.sectionId ? <> @ {w.sectionId}</> : null}
                    {w.sample ? <> — &quot;{w.sample}&quot;</> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Sections */}
          {sections.map((s) => (
            <section key={s.id} className="pr-sec" id={`pr-section-${s.id}`}>
              <h2>
                <span className="pr-num">{s.num}</span>
                {s.title}
              </h2>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{s.bodyMarkdown}</ReactMarkdown>
              {(figuresBySection.get(s.id) ?? []).map((f) => (
                <FigureRenderer
                  key={f.id}
                  refId={f.refId}
                  runs={runs}
                  caption={f.caption}
                  figureNumber={nextFigureNumber()}
                />
              ))}
            </section>
          ))}

          {/* Data source — which benchmarks this report is built from. Identity
              columns only (no metrics); names deep-link to the benchmark detail.
              Sits before the footer so the footer truly closes the document. */}
          {runs.length > 0 ? (
            <section className="pr-sec">
              <h3>{t("savedCompare.report.sourceTitle")}</h3>
              <table>
                <thead>
                  <tr>
                    <th>{t("savedCompare.report.sourceStage")}</th>
                    <th>{t("savedCompare.report.sourceName")}</th>
                    <th>{t("savedCompare.report.sourceTool")}</th>
                    <th>{t("savedCompare.report.sourceScenario")}</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id}>
                      <td>{r.stageLabel}</td>
                      <td>
                        {r.benchmark ? (
                          <Link to={`/benchmarks/${r.id}`}>{r.benchmark.name ?? r.id}</Link>
                        ) : (
                          <span style={{ opacity: 0.6 }}>
                            {t("savedCompare.detail.missingBenchmark")}
                          </span>
                        )}
                      </td>
                      <td>{r.tool || "—"}</td>
                      <td>{r.scenario || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}

          <div className="pr-footer">
            ModelDoctor SavedCompare report · schemaVersion {narrative.schemaVersion} ·{" "}
            {narrative.locale}
          </div>
        </main>
      </div>
    </div>
  );
}
