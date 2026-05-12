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
import { Card } from "@/components/ui/card";
import { GateStatusBadge } from "@/features/quality-gate/components/GateStatusBadge";
import { useLlmJudgeProvider } from "@/features/settings/queries";
import type { Benchmark, CompareNarrative } from "@modeldoctor/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { AiAnalysisPanel } from "./AiAnalysisPanel";
import { type ReportRun, ReportSections } from "./ReportSections";
import { exportPageAsHtml } from "./exportHtml";
import { useDeleteSavedCompare, useSavedCompare, useSynthesizeSavedCompare } from "./queries";

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
        <ReportSections
          runs={reportRuns}
          baselineId={sc.baselineId}
          narrative={narrative}
          context={sc.context}
          environmentLines={environmentLines}
        />
        {sc.evaluationRuns && sc.evaluationRuns.length > 0 && (
          <div className="mt-6">
            <h3 className="text-sm font-medium mb-2">质量评测</h3>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
              {sc.evaluationRuns.map((r) => (
                <Card key={r.id} className="p-3 space-y-2">
                  <GateStatusBadge
                    status={(r.status ?? "PENDING") as import("@modeldoctor/contracts").RunStatus}
                    gateResult={(r.gateResult ?? null) as import("@modeldoctor/contracts").GateResult | null}
                  />
                  <div className="text-xs text-muted-foreground">
                    {sc.stageLabels[r.id] ?? r.id.slice(0, 8)}
                  </div>
                  <div className="text-sm">
                    通过率 A:{" "}
                    {r.aggregateMetrics?.passRateA != null
                      ? (r.aggregateMetrics.passRateA * 100).toFixed(1) + "%"
                      : "—"}
                  </div>
                  {r.aggregateMetrics?.passRateB != null && (
                    <div className="text-sm">
                      通过率 B: {(r.aggregateMetrics.passRateB * 100).toFixed(1)}%
                    </div>
                  )}
                  {r.aggregateMetrics?.regressionCount != null && (
                    <div className="text-sm">回归: {r.aggregateMetrics.regressionCount}</div>
                  )}
                </Card>
              ))}
            </div>
          </div>
        )}
        <AiAnalysisPanel
          narrative={narrative}
          onGenerate={() => void generate()}
          canGenerate={!!provider.data?.enabled}
          isGenerating={synth.isPending}
          errorMessage={synth.error?.message}
        />
      </div>
    </>
  );
}
