import { Card } from "@/components/ui/card";
import type { EvaluationRun } from "@modeldoctor/contracts";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { GateStatusBadge } from "./GateStatusBadge";

function pct(n: number | undefined) {
  return n == null ? "—" : `${(n * 100).toFixed(1)}%`;
}
function num(n: number | undefined) {
  return n == null ? "—" : n.toFixed(2);
}

export function RunOverview({ run }: { run: EvaluationRun }) {
  const { t } = useTranslation("quality-gate");
  const m = run.aggregateMetrics;
  const wallClock =
    run.startedAt && run.finishedAt
      ? `${Math.round((+new Date(run.finishedAt) - +new Date(run.startedAt)) / 1000)}s`
      : null;
  const baselineMode = run.baselineRunIdAtExecution != null;
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <GateStatusBadge status={run.status} gateResult={run.gateResult} />
        <span className="text-sm text-muted-foreground">
          {run.processedSamples}/{run.totalSamples}
          {wallClock ? ` · ${wallClock}` : ""}
        </span>
      </div>
      {baselineMode && (
        <div className="text-sm rounded-md bg-primary/5 border border-primary/20 px-3 py-2 flex items-center justify-between">
          <span>
            {t("runs.report.baselineModeBanner", {
              runId: run.baselineRunIdAtExecution?.slice(0, 12),
            })}
          </span>
          <Link
            to={`/quality-gate/runs/${run.baselineRunIdAtExecution}`}
            className="text-primary hover:underline"
          >
            {t("runs.report.baselineViewLink")}
          </Link>
        </div>
      )}
      {m && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <div>
            <div className="text-xs text-muted-foreground">
              {baselineMode ? t("runs.report.passRateCurrent") : t("report.metrics.passRateA")}
            </div>
            <div className="text-2xl">{pct(m.passRateA)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">
              {baselineMode ? t("runs.report.passRateBaseline") : t("report.metrics.passRateB")}
            </div>
            <div className="text-2xl">{pct(m.passRateB)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">
              {t("report.metrics.regressionImprovement")}
            </div>
            <div className="text-2xl">
              {m.regressionCount ?? "—"} / {m.improvementCount ?? "—"}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">
              {baselineMode ? t("runs.report.judgeAvgCurrent") : t("report.metrics.judgeAvgA")}
            </div>
            <div className="text-2xl">{num(m.judgeAvgA)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">
              {baselineMode ? t("runs.report.judgeAvgBaseline") : t("report.metrics.judgeAvgB")}
            </div>
            <div className="text-2xl">{num(m.judgeAvgB)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">
              {t("report.metrics.judgeCallCount")}
            </div>
            <div className="text-2xl">{m.judgeCallCount}</div>
          </div>
        </div>
      )}
      {run.errorMessage && <div className="text-destructive text-sm">{run.errorMessage}</div>}
    </Card>
  );
}
