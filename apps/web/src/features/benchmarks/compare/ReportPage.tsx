import type { Benchmark, CompareNarrative } from "@modeldoctor/contracts";
import { ArrowLeft, Download, Printer, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useLlmJudgeProvider } from "@/features/settings/queries";
import { exportPageAsHtml } from "./exportHtml";
import { useDeleteSavedCompare, useSavedCompare, useSynthesizeSavedCompare } from "./queries";
import { ReportProgress } from "./ReportProgress";
import type { ReportRun } from "./ReportSections";
import { SavedCompareReport } from "./SavedCompareReport";

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
 * Single saved-comparison report page: `/reports/:id`.
 *
 * Sits outside `<AppShell>` so the report takes the full viewport width without
 * the sidebar competing for space. It is BOTH the management surface (generate /
 * regenerate / export / delete, in the slim top bar) and the reading/print
 * surface — there is no separate detail page. The top bar is hidden under
 * `@media print` so PDF output starts straight at the Hero.
 *
 * States:
 *   - loading / not-found
 *   - no narrative yet → inline "Generate report" card (auto-fires when the
 *     save-and-generate flow lands here with `?generate=1`)
 *   - narrative present → the Primer-styled report + a "Data source" table
 */
export function ReportPage() {
  const { id = "" } = useParams<{ id: string }>();
  const { t } = useTranslation("benchmarks");
  const navigate = useNavigate();
  const query = useSavedCompare(id);
  const provider = useLlmJudgeProvider();
  const synth = useSynthesizeSavedCompare(id);
  const del = useDeleteSavedCompare();
  const [narrativeOverride, setNarrativeOverride] = useState<CompareNarrative | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const generateParam = searchParams.get("generate");
  const autoGenFired = useRef(false);
  const reportRef = useRef<HTMLDivElement>(null);

  const generate = useCallback(() => {
    synth.mutate({ locale: "zh-CN" }, { onSuccess: (r) => setNarrativeOverride(r.narrative) });
  }, [synth.mutate]);

  // NOTE: this component is remounted on `/reports/:id` param changes via a
  // `key={id}` wrapper in the router, so per-report state (narrativeOverride,
  // autoGenFired) resets naturally — no manual reset-on-id effect needed.

  // Depend on primitives, not the whole query.data / searchParams objects, so
  // background refetches and unrelated URL changes don't re-run this effect.
  const scId = query.data?.id;
  const hasNarrative = !!query.data?.narrative;

  // Save-and-generate bridge: SaveCompareDialog navigates here with ?generate=1
  // after a save-and-generate. Fire synthesize once, then strip the flag. Always
  // strip the flag once we've made a decision (even when there's nothing to
  // generate) so it doesn't linger in the URL.
  useEffect(() => {
    if (autoGenFired.current) return;
    if (generateParam !== "1") return;
    if (!scId) return; // data not loaded yet — wait, don't strip
    if (hasNarrative) {
      autoGenFired.current = true;
      setSearchParams({}, { replace: true });
      return;
    }
    if (provider.isLoading) return; // provider state unknown yet — wait
    if (!provider.data?.enabled) {
      autoGenFired.current = true;
      setSearchParams({}, { replace: true });
      return;
    }
    if (synth.isPending) return;
    autoGenFired.current = true;
    setSearchParams({}, { replace: true });
    generate();
  }, [
    generateParam,
    scId,
    hasNarrative,
    provider.isLoading,
    provider.data?.enabled,
    synth.isPending,
    setSearchParams,
    generate,
  ]);

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
  const narrative = narrativeOverride ?? (sc.narrative as CompareNarrative | null);

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

  function onDelete() {
    del.mutate(id, { onSuccess: () => navigate("/benchmarks/compare/saved") });
  }

  function onExport() {
    if (reportRef.current) void exportPageAsHtml(reportRef.current, sc.name);
  }

  function onPrint() {
    window.print();
  }

  const canGenerate = !!provider.data?.enabled && !synth.isPending;

  return (
    <div className="min-h-screen bg-[var(--pr-bg-subtle,#f6f8fa)]">
      {/* Slim management/brand bar — hidden in print */}
      <header className="pr-app-bar sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[1760px] items-center justify-between gap-4 px-8 py-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/benchmarks/compare/saved">
                <ArrowLeft className="mr-1 h-4 w-4" />
                {t("savedCompare.reportPage.backToList", { defaultValue: "Back to comparisons" })}
              </Link>
            </Button>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">ModelDoctor</span>
              <span>·</span>
              <span className="truncate">{sc.name}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {narrative ? (
              <>
                <Button variant="outline" size="sm" onClick={generate} disabled={!canGenerate}>
                  <RefreshCw
                    className={`mr-1.5 h-4 w-4 ${synth.isPending ? "animate-spin" : ""}`}
                  />
                  {t("savedCompare.detail.regenerate")}
                </Button>
                <Button variant="outline" size="sm" onClick={onExport}>
                  <Download className="mr-1.5 h-4 w-4" />
                  {t("savedCompare.detail.export")}
                </Button>
                <Button variant="outline" size="sm" onClick={onPrint}>
                  <Printer className="mr-1.5 h-4 w-4" />
                  {t("savedCompare.reportPage.printPdf", { defaultValue: "Print / PDF" })}
                </Button>
              </>
            ) : null}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="mr-1.5 h-4 w-4" />
                  {t("savedCompare.detail.deleteTitle")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("savedCompare.detail.deleteTitle")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("savedCompare.detail.deleteBody")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("savedCompare.dialog.cancel")}</AlertDialogCancel>
                  <AlertDialogAction onClick={onDelete} disabled={del.isPending}>
                    {t("savedCompare.detail.deleteTitle")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
        {synth.isPending ? (
          <div className="mx-auto max-w-[1760px] px-8 pb-3">
            <ReportProgress active={synth.isPending} />
          </div>
        ) : null}
      </header>

      {narrative ? (
        <div ref={reportRef}>
          <SavedCompareReport
            narrative={narrative}
            runs={reportRuns}
            printHeader={`ModelDoctor · ${sc.name}`}
          />
        </div>
      ) : (
        <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 px-8 py-24 text-center">
          <div className="flex items-center gap-2 text-base font-semibold">
            <Sparkles className="h-5 w-5 text-violet-500" />
            {t("savedCompare.reportPage.notGenerated", {
              defaultValue: "This comparison does not have an AI report yet.",
            })}
          </div>
          <p className="text-sm text-muted-foreground">
            {t("savedCompare.report.generateHint", {
              defaultValue: "60-180s deep report — Hero + 6 sections + summary cards (zh-CN).",
            })}
          </p>
          {synth.error ? <p className="text-sm text-destructive">{synth.error.message}</p> : null}
          <Button onClick={generate} disabled={!canGenerate}>
            <Sparkles className="mr-1.5 h-4 w-4" />
            {synth.isPending
              ? t("savedCompare.report.generating", { defaultValue: "Generating…" })
              : t("savedCompare.report.generateButton")}
          </Button>
          {!provider.data?.enabled ? (
            <p className="text-xs text-muted-foreground">
              {t("savedCompare.report.providerDisabledHint", {
                defaultValue:
                  "Configure an LLM judge provider in Settings to enable report generation.",
              })}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
