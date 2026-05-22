import type { EvaluationSample, RunSample } from "@modeldoctor/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { PinBaselineButton } from "./components/PinBaselineButton";
import { RunOverview } from "./components/RunOverview";
import { SampleDetailDrawer } from "./components/SampleDetailDrawer";
import { SamplesTable } from "./components/SamplesTable";
import { useCancelRun, useRun } from "./queries";

export function RunReportPage() {
  const { id = "" } = useParams();
  const { t } = useTranslation("quality-gate");
  const { t: tSidebar } = useTranslation("sidebar");
  const { data: run } = useRun(id, { pollWhileRunning: true });
  const cancel = useCancelRun(id);
  const [openSample, setOpenSample] = useState<RunSample | null>(null);
  const snapshotSamples: EvaluationSample[] = (run?.evaluationSnapshot.samples ??
    []) as EvaluationSample[];

  const breadcrumbs = [
    { label: tSidebar("groups.qualityGate") },
    { label: tSidebar("items.qualityGateRuns"), to: "/quality-gate/runs" },
    { label: run ? run.id.slice(0, 12) : t("runs.report.title") },
  ];

  // Loading / 404: keep breadcrumbs row stable, skeleton for the body.
  if (!run) {
    return (
      <>
        <PageHeader
          title={t("runs.report.title")}
          subtitle={t("runs.report.subtitle")}
          breadcrumbs={breadcrumbs}
        />
        <div className="space-y-6 px-8 py-6">
          <div className="h-64 animate-pulse rounded-md border border-border bg-muted/30" />
        </div>
      </>
    );
  }

  const baselineMode = run.baselineRunIdAtExecution != null;
  const hasComparison = baselineMode || run.endpointBId != null;

  return (
    <>
      <PageHeader
        title={t("runs.report.title")}
        subtitle={t("runs.report.subtitle")}
        breadcrumbs={breadcrumbs}
        rightSlot={
          <div className="flex items-center gap-2">
            {run.status === "RUNNING" && (
              <Button variant="outline" onClick={() => cancel.mutate()}>
                {t("runs.report.cancel")}
              </Button>
            )}
            {run.status === "COMPLETED" && (
              <>
                <PinBaselineButton evaluationId={run.evaluationId} runId={run.id} />
                <Button variant="outline" size="sm" asChild>
                  <Link to={`/benchmarks/compare/saved/new?evaluationRunIds=${run.id}`}>
                    {t("runs.report.addToCompareButton")}
                  </Link>
                </Button>
              </>
            )}
          </div>
        }
      />
      <div className="px-8 py-6 space-y-6">
        <RunOverview run={run} />
        {run.status === "COMPLETED" && (
          <SamplesTable
            runId={run.id}
            baselineMode={baselineMode}
            hasComparison={hasComparison}
            onOpenSample={setOpenSample}
          />
        )}
        <SampleDetailDrawer
          runId={run.id}
          row={openSample}
          snapshotSamples={snapshotSamples}
          onClose={() => setOpenSample(null)}
        />
      </div>
    </>
  );
}
