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
  const { data: run } = useRun(id, { pollWhileRunning: true });
  const cancel = useCancelRun(id);
  const [openSampleId, setOpenSampleId] = useState<string | null>(null);
  // Load all samples once (paged in table; for drawer lookup we re-fetch the full list)
  const allSamples = useRunSamples(run?.status === "COMPLETED" ? id : undefined, {
    filter: "all",
    pageSize: 500,
  });
  const sampleRow: RunSample | null = openSampleId
    ? (allSamples.data?.items.find((s) => s.id === openSampleId) ?? null)
    : null;
  const snapshotSamples: EvaluationSample[] = (run?.evaluationSnapshot.samples ??
    []) as EvaluationSample[];

  if (!run) return null;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t("runs.report.title")}</h1>
        {run.status === "RUNNING" && (
          <Button variant="outline" onClick={() => cancel.mutate()}>
            {t("runs.report.cancel")}
          </Button>
        )}
      </div>
      <RunOverview run={run} />
      {run.status === "COMPLETED" && <SamplesTable runId={run.id} onOpenSample={setOpenSampleId} />}
      <SampleDetailDrawer
        runId={run.id}
        row={sampleRow}
        snapshotSamples={snapshotSamples}
        onClose={() => setOpenSampleId(null)}
      />
    </div>
  );
}
