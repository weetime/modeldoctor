import type { CompareNarrative } from "@modeldoctor/contracts";
import { Eye, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ConfirmDeleteDialog } from "@/components/common/confirm-delete-dialog";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { useLlmJudgeProvider } from "@/features/llm-judge-providers/queries";
import { useDeleteSavedCompare, useSavedCompare, useSynthesizeSavedCompare } from "./queries";
import { ReportProgress } from "./ReportProgress";
import { SavedCompareReport } from "./SavedCompareReport";
import { toReportRuns } from "./to-report-runs";

/**
 * In-app saved-comparison detail: `/reports/:id` (inside `<AppShell>`).
 *
 * The themed reading + management surface. It follows the app theme (sidebar +
 * top-bar theme toggle) and renders the report as a light Primer "paper"
 * document on the themed canvas — document-viewer style — via the embedded
 * report (no internal TOC; the app sidebar already provides nav). Actions:
 * Preview (→ `/reports/:id/preview` for print / export), Regenerate, Delete, and
 * an inline Generate empty state. The print/export-only surface is the
 * standalone `ReportPreviewPage`.
 *
 * Remounted on `:id` change via a `key={id}` wrapper in the router, so
 * `narrativeOverride` / `autoGenFired` reset across reports.
 */
export function ReportDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const { t, i18n } = useTranslation("benchmarks");
  const { t: tSidebar } = useTranslation("sidebar");
  const navigate = useNavigate();
  const query = useSavedCompare(id);
  const provider = useLlmJudgeProvider();
  const synth = useSynthesizeSavedCompare(id);
  const del = useDeleteSavedCompare();
  const [narrativeOverride, setNarrativeOverride] = useState<CompareNarrative | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const generateParam = searchParams.get("generate");
  const autoGenFired = useRef(false);

  const generate = useCallback(() => {
    // Report language follows the app's UI language (Settings → Language); the
    // synthesize endpoint already supports both locales. Fall back to zh-CN for
    // any unmapped i18n language so the enum stays valid.
    const locale = i18n.language === "en-US" ? "en-US" : "zh-CN";
    synth.mutate({ locale }, { onSuccess: (r) => setNarrativeOverride(r.narrative) });
  }, [synth.mutate, i18n.language]);

  // Depend on primitives, not the whole query.data / searchParams objects, so
  // background refetches and unrelated URL changes don't re-run this effect.
  const scId = query.data?.id;
  const hasNarrative = !!query.data?.narrative;

  // Save-and-generate bridge: SaveCompareDialog navigates here with ?generate=1
  // after a save-and-generate. Fire synthesize once, then strip the flag — even
  // when there's nothing to generate — so it doesn't linger in the URL.
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

  const breadcrumbs = [
    { label: tSidebar("groups.benchmarks") },
    { label: t("compare.title"), to: "/benchmarks/compare/saved" },
    { label: query.data?.name ?? t("savedCompare.reportPage.loading", { defaultValue: "…" }) },
  ];

  if (query.isLoading) {
    return (
      <>
        <PageHeader title="…" breadcrumbs={breadcrumbs} />
        <div className="m-8 h-64 animate-pulse rounded-md border border-border bg-muted/30" />
      </>
    );
  }
  if (!query.data) {
    return (
      <>
        <PageHeader
          title={t("savedCompare.reportPage.notFound", { defaultValue: "Report not found" })}
          breadcrumbs={breadcrumbs}
        />
        <div className="px-8 py-6">
          <Button variant="outline" asChild>
            <Link to="/benchmarks/compare/saved">
              {t("savedCompare.reportPage.backToList", { defaultValue: "Back to comparisons" })}
            </Link>
          </Button>
        </div>
      </>
    );
  }

  const sc = query.data;
  const narrative = narrativeOverride ?? (sc.narrative as CompareNarrative | null);

  const reportRuns = toReportRuns(sc.benchmarks);

  function onDelete() {
    del.mutate(id, { onSuccess: () => navigate("/benchmarks/compare/saved") });
  }

  const canGenerate = !!provider.data?.enabled && !synth.isPending;

  return (
    <>
      <PageHeader
        title={sc.name}
        breadcrumbs={breadcrumbs}
        rightSlot={
          <div className="flex items-center gap-2">
            {narrative ? (
              <>
                <Button variant="outline" asChild>
                  <Link to={`/reports/${sc.id}/preview`}>
                    <Eye className="mr-1.5 h-4 w-4" />
                    {t("savedCompare.detail.preview", { defaultValue: "Preview" })}
                  </Link>
                </Button>
                <Button variant="outline" onClick={generate} disabled={!canGenerate}>
                  <RefreshCw
                    className={`mr-1.5 h-4 w-4 ${synth.isPending ? "animate-spin" : ""}`}
                  />
                  {t("savedCompare.detail.regenerate")}
                </Button>
              </>
            ) : null}
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="mr-1.5 h-4 w-4" />
              {t("savedCompare.detail.deleteTitle")}
            </Button>
            <ConfirmDeleteDialog
              open={deleteOpen}
              onOpenChange={setDeleteOpen}
              title={t("savedCompare.detail.deleteTitle")}
              description={t("savedCompare.detail.deleteBody")}
              confirmLabel={t("savedCompare.detail.deleteTitle")}
              pending={del.isPending}
              onConfirm={onDelete}
            />
          </div>
        }
      />
      <div className="space-y-4 px-8 py-6">
        {narrative ? (
          <>
            {synth.isPending ? <ReportProgress active={synth.isPending} /> : null}
            {/* Document-viewer: the light Primer "paper" sits inside a themed
                bordered card on the (theme-following) page background. */}
            <div className="overflow-hidden rounded-lg border border-border">
              <SavedCompareReport
                narrative={narrative}
                runs={reportRuns}
                baselineId={sc.baselineId}
                embedded
                showDataSource
              />
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between gap-4 rounded-md border border-violet-200 bg-violet-50/40 p-4 dark:border-violet-900 dark:bg-violet-950/20">
            <div>
              <div className="flex items-center gap-1.5 text-sm font-semibold">
                <Sparkles className="h-4 w-4 text-violet-500" />
                {t("savedCompare.report.generateTitle", { defaultValue: "Generate AI report" })}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("savedCompare.report.generateHint", {
                  defaultValue: "60-180s deep report — Hero + 6 sections + summary cards (zh-CN).",
                })}
              </p>
              {synth.error ? (
                <p className="mt-1 text-xs text-destructive">{synth.error.message}</p>
              ) : null}
              {!provider.data?.enabled && !provider.isLoading ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("savedCompare.report.providerDisabledHint", {
                    defaultValue:
                      "Configure an LLM judge provider in Settings to enable report generation.",
                  })}
                </p>
              ) : null}
              <ReportProgress active={synth.isPending} />
            </div>
            <Button onClick={generate} disabled={!canGenerate}>
              <Sparkles className="mr-1.5 h-4 w-4" />
              {synth.isPending
                ? t("savedCompare.report.generating", { defaultValue: "Generating…" })
                : t("savedCompare.report.generateButton")}
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
