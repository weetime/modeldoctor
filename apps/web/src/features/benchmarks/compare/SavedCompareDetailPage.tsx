import type { Benchmark, CompareNarrative } from "@modeldoctor/contracts";
import { ExternalLink, RefreshCw, Sparkles } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "@/components/common/page-header";
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
import { type ReportRun, ReportSections } from "./ReportSections";

function extractParamsSummary(params: unknown): {
  workload?: string;
  concurrency?: number;
  duration?: number;
} {
  if (!params || typeof params !== "object") return {};
  const p = params as Record<string, unknown>;
  return {
    workload: typeof p.workload === "string" ? p.workload : undefined,
    concurrency: typeof p.concurrency === "number" ? p.concurrency : undefined,
    duration: typeof p.duration === "number" ? p.duration : undefined,
  };
}

export function SavedCompareDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const { t } = useTranslation("benchmarks");
  const { t: tSidebar } = useTranslation("sidebar");
  const navigate = useNavigate();
  const query = useSavedCompare(id);
  const provider = useLlmJudgeProvider();
  const synth = useSynthesizeSavedCompare(id);
  const del = useDeleteSavedCompare();
  const [narrativeOverride, setNarrativeOverride] = useState<CompareNarrative | null>(null);

  if (query.isLoading) {
    return (
      <>
        <PageHeader title="…" />
        <div className="m-8 h-64 animate-pulse rounded-md border border-border bg-muted/30" />
      </>
    );
  }
  if (!query.data) return null;
  const sc = query.data;

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
  const environmentLines = sc.benchmarks.map(
    (b) =>
      `[${b.stageLabel}] ${b.missing ? t("savedCompare.detail.missingBenchmark") : `${b.name ?? b.id} · ${b.tool} · ${b.scenario}`}`,
  );
  const narrative = narrativeOverride ?? (sc.narrative as CompareNarrative | null);

  async function generate() {
    const r = await synth.mutateAsync({ locale: "zh-CN" });
    setNarrativeOverride(r.narrative);
  }

  async function onDelete() {
    await del.mutateAsync(id);
    navigate("/benchmarks/compare/saved");
  }

  function onExport() {
    const root = document.querySelector("[data-report-root]") as HTMLElement | null;
    if (root) void exportPageAsHtml(root, sc.name);
  }

  const breadcrumbs = [
    { label: tSidebar("groups.benchmarks") },
    { label: t("compare.title"), to: "/benchmarks/compare/saved" },
    { label: sc.name },
  ];

  return (
    <>
      <PageHeader
        title={sc.name}
        breadcrumbs={breadcrumbs}
        rightSlot={
          <div className="flex items-center gap-2">
            {narrative ? (
              <Button asChild>
                <Link to={`/reports/${sc.id}`}>
                  <ExternalLink className="mr-1.5 h-4 w-4" />
                  {t("savedCompare.detail.openReport", { defaultValue: "Open report" })}
                </Link>
              </Button>
            ) : null}
            <Button variant="outline" onClick={onExport}>
              {t("savedCompare.detail.export")}
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">
                  {t("compare.delete", { defaultValue: "Delete" })}
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
                  <AlertDialogAction onClick={onDelete}>
                    {t("savedCompare.detail.deleteTitle")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        }
      />
      <div className="space-y-6 px-8 py-6">
        {/* Report status / generate strip */}
        {narrative ? (
          <div className="flex items-center justify-between gap-4 rounded-md border border-emerald-200 bg-emerald-50/40 p-4 dark:border-emerald-900 dark:bg-emerald-950/20">
            <div>
              <div className="flex items-center gap-1.5 text-sm font-semibold">
                <Sparkles className="h-4 w-4 text-emerald-500" />
                {t("savedCompare.report.ready", { defaultValue: "AI report ready" })}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("savedCompare.report.readyHint", {
                  defaultValue:
                    "Open the full Primer-style report, print to PDF, or share the URL.",
                })}
                {narrative.lintWarnings.length > 0 ? (
                  <>
                    {" · "}
                    <span className="text-amber-700 dark:text-amber-300">
                      {narrative.lintWarnings.length} style warning(s)
                    </span>
                  </>
                ) : null}
              </p>
              <ReportProgress active={synth.isPending} />
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => void generate()}
                disabled={!provider.data?.enabled || synth.isPending}
              >
                <RefreshCw className={`mr-1.5 h-4 w-4 ${synth.isPending ? "animate-spin" : ""}`} />
                {t("savedCompare.report.regenerate", { defaultValue: "Regenerate" })}
              </Button>
              <Button asChild>
                <Link to={`/reports/${sc.id}`}>
                  <ExternalLink className="mr-1.5 h-4 w-4" />
                  {t("savedCompare.detail.openReport", { defaultValue: "Open report" })}
                </Link>
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-4 rounded-md border border-violet-200 bg-violet-50/40 p-4 dark:border-violet-900 dark:bg-violet-950/20">
            <div>
              <div className="flex items-center gap-1.5 text-sm font-semibold">
                <Sparkles className="h-4 w-4 text-violet-500" />
                {t("savedCompare.report.generateTitle", {
                  defaultValue: "Generate AI report",
                })}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("savedCompare.report.generateHint", {
                  defaultValue: "60-180s deep report — Hero + 6 sections + summary cards (zh-CN).",
                })}
              </p>
              {synth.error ? (
                <p className="mt-1 text-xs text-destructive">{synth.error.message}</p>
              ) : null}
              <ReportProgress active={synth.isPending} />
            </div>
            <Button
              onClick={() => void generate()}
              disabled={!provider.data?.enabled || synth.isPending}
            >
              <Sparkles className="mr-1.5 h-4 w-4" />
              {synth.isPending
                ? t("savedCompare.report.generating", { defaultValue: "Generating…" })
                : t("savedCompare.report.generateButton", { defaultValue: "Generate report" })}
            </Button>
          </div>
        )}

        <ReportSections
          runs={reportRuns}
          baselineId={sc.baselineId}
          narrative={null}
          context={sc.context}
          environmentLines={environmentLines}
        />
      </div>
    </>
  );
}
