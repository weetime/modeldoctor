import { Alert, AlertDescription } from "@/components/ui/alert";
import { useBaselineById } from "@/features/baseline/queries";
import type { Run } from "@modeldoctor/contracts";
import { useTranslation } from "react-i18next";
import { useRunDetail } from "../queries";
import { VerdictBadge } from "./VerdictBadge";
import {
  type VerdictKind,
  deltaText,
  readErrorRate,
  readP95Latency,
  readThroughput,
} from "./metrics";
import { verdictFor } from "./verdict";

export interface DetailVerdictRowProps {
  run: Run;
  baselineId: string;
}

interface VerdictItem {
  kind: VerdictKind;
  labelKey: string;
  baseline: number | null;
  current: number | null;
}

export function DetailVerdictRow({ run, baselineId }: DetailVerdictRowProps) {
  const { t } = useTranslation("runs");
  const baselineQuery = useBaselineById(baselineId);
  const baselineRunId = baselineQuery.data?.runId ?? "";
  const baselineRun = useRunDetail(baselineRunId);

  if (baselineQuery.isLoading || (baselineRunId.length > 0 && baselineRun.isLoading)) {
    return <div className="text-xs text-muted-foreground">{t("detail.verdict.loading")}</div>;
  }

  if (baselineQuery.isError || baselineRun.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{t("detail.verdict.loadError")}</AlertDescription>
      </Alert>
    );
  }

  const baseline = baselineRun.data;
  if (!baseline) return null;

  const items: VerdictItem[] = [
    {
      kind: "latency",
      labelKey: "compare.metricRowLabel.latencyP95",
      baseline: readP95Latency(baseline.summaryMetrics),
      current: readP95Latency(run.summaryMetrics),
    },
    {
      kind: "errorRate",
      labelKey: "compare.metricRowLabel.errorRate",
      baseline: readErrorRate(baseline.summaryMetrics),
      current: readErrorRate(run.summaryMetrics),
    },
    {
      kind: "throughput",
      labelKey: "compare.metricRowLabel.throughput",
      baseline: readThroughput(baseline.summaryMetrics),
      current: readThroughput(run.summaryMetrics),
    },
  ];

  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="mb-2 text-xs font-medium text-muted-foreground">
        {t("detail.verdict.title")}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        {items.map((item) => {
          if (item.baseline === null || item.current === null) {
            return (
              <div key={item.kind} className="flex items-center gap-1 text-xs">
                <span className="text-muted-foreground">{t(item.labelKey)}:</span>
                <span>—</span>
              </div>
            );
          }
          return (
            <div key={item.kind} className="flex items-center gap-1 text-xs">
              <span className="text-muted-foreground">{t(item.labelKey)}:</span>
              <VerdictBadge
                verdict={verdictFor(item.kind, item.baseline, item.current)}
                verdictKind={item.kind}
                deltaText={deltaText(item.kind, item.baseline, item.current)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
