import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import type { EvaluationSample, RunSample } from "@modeldoctor/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { RunOverview } from "./components/RunOverview";
import { SampleDetailDrawer } from "./components/SampleDetailDrawer";
import { SamplesTable } from "./components/SamplesTable";
import { useCancelRun, useRun, useRunSamples } from "./queries";

export function RunReportPage() {
  const { id = "" } = useParams();
  const { t } = useTranslation("quality-gate");
  const { t: tSidebar } = useTranslation("sidebar");
  const { data: run } = useRun(id, { pollWhileRunning: true });
  const cancel = useCancelRun(id);
  const [openSampleId, setOpenSampleId] = useState<string | null>(null);
  const allSamples = useRunSamples(run?.status === "COMPLETED" ? id : undefined, {
    filter: "all",
    pageSize: 500,
  });
  const sampleRow: RunSample | null = openSampleId
    ? (allSamples.data?.items.find((s) => s.id === openSampleId) ?? null)
    : null;
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

  return (
    <>
      <PageHeader
        title={t("runs.report.title")}
        subtitle={t("runs.report.subtitle")}
        breadcrumbs={breadcrumbs}
        rightSlot={
          run.status === "RUNNING" ? (
            <Button variant="outline" onClick={() => cancel.mutate()}>
              {t("runs.report.cancel")}
            </Button>
          ) : undefined
        }
      />
      <div className="px-8 py-6 space-y-6">
        <RunOverview run={run} />
        {run.status === "COMPLETED" && (
          <SamplesTable runId={run.id} onOpenSample={setOpenSampleId} />
        )}
        <SampleDetailDrawer
          runId={run.id}
          row={sampleRow}
          snapshotSamples={snapshotSamples}
          onClose={() => setOpenSampleId(null)}
        />
      </div>
    </>
  );
}
