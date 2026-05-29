import type { Benchmark, CompareNarrative } from "@modeldoctor/contracts";
import { ArrowLeft, Printer } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useSavedCompare } from "./queries";
import { type ReportRun, type ReportSectionsProps } from "./ReportSections";
import { SavedCompareReport } from "./SavedCompareReport";

function extractParamsSummary(
  params: unknown,
): ReportSectionsProps["runs"][number]["paramsSummary"] {
  if (!params || typeof params !== "object") return {};
  const p = params as Record<string, unknown>;
  return {
    workload: typeof p.workload === "string" ? p.workload : undefined,
    concurrency: typeof p.concurrency === "number" ? p.concurrency : undefined,
    duration: typeof p.duration === "number" ? p.duration : undefined,
  };
}

/**
 * Standalone report viewer route: `/reports/:id`.
 *
 * Sits outside `<AppShell>` so the report takes the full viewport width
 * without the sidebar or app chrome competing for space. Its only non-report
 * UI is a slim top bar with brand + back-to-app + print button. The top bar
 * is hidden under `@media print` so PDF output starts straight at the Hero.
 *
 * Use cases:
 *   - Read the AI-generated deep report
 *   - Share the URL with partner / client (still gated by JWT auth)
 *   - Print to PDF via window.print() (Primer print stylesheet kicks in)
 */
export function ReportPage() {
  const { id = "" } = useParams<{ id: string }>();
  const { t } = useTranslation("benchmarks");
  const query = useSavedCompare(id);

  if (query.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 text-sm text-muted-foreground">
        {t("savedCompare.reportPage.loading", { defaultValue: "Loading report…" })}
      </div>
    );
  }
  if (!query.data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2">
        <p className="text-sm text-muted-foreground">
          {t("savedCompare.reportPage.notFound", { defaultValue: "Report not found" })}
        </p>
        <Button variant="outline" asChild>
          <Link to="/benchmarks/compare/saved">
            {t("savedCompare.reportPage.backToList", { defaultValue: "Back to comparisons" })}
          </Link>
        </Button>
      </div>
    );
  }

  const sc = query.data;
  const narrative = sc.narrative as CompareNarrative | null;

  if (!narrative) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">
          {t("savedCompare.reportPage.notGenerated", {
            defaultValue: "This comparison does not have an AI report yet.",
          })}
        </p>
        <Button asChild>
          <Link to={`/benchmarks/compare/saved/${sc.id}`}>
            {t("savedCompare.reportPage.openDetailToGenerate", {
              defaultValue: "Open detail page to generate",
            })}
          </Link>
        </Button>
      </div>
    );
  }

  const reportRuns: ReportRun[] = sc.benchmarks.map((b) => ({
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
          params: b.params,
        } as Benchmark),
    paramsSummary: extractParamsSummary(b.params),
  }));

  function onPrint() {
    window.print();
  }

  return (
    <div className="min-h-screen bg-[var(--pr-bg-subtle,#f6f8fa)]">
      {/* Slim brand bar — hidden in print */}
      <header className="pr-app-bar sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[1760px] items-center justify-between gap-4 px-8 py-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link to={`/benchmarks/compare/saved/${sc.id}`}>
                <ArrowLeft className="mr-1 h-4 w-4" />
                {t("savedCompare.reportPage.backToDetail", { defaultValue: "Back to detail" })}
              </Link>
            </Button>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">ModelDoctor</span>
              <span>·</span>
              <span className="truncate">{sc.name}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onPrint}>
              <Printer className="mr-1.5 h-4 w-4" />
              {t("savedCompare.reportPage.printPdf", { defaultValue: "Print / PDF" })}
            </Button>
          </div>
        </div>
      </header>

      <SavedCompareReport
        narrative={narrative}
        runs={reportRuns}
        printHeader={`ModelDoctor · ${sc.name}`}
      />
    </div>
  );
}
