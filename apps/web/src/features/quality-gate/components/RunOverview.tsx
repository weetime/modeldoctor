import type { EvaluationRun } from "@modeldoctor/contracts";
import { Card } from "@/components/ui/card";
import { GateStatusBadge } from "./GateStatusBadge";

function pct(n: number | undefined) {
  return n == null ? "—" : `${(n * 100).toFixed(1)}%`;
}
function num(n: number | undefined) {
  return n == null ? "—" : n.toFixed(2);
}

export function RunOverview({ run }: { run: EvaluationRun }) {
  const m = run.aggregateMetrics;
  const wallClock =
    run.startedAt && run.finishedAt
      ? `${Math.round((+new Date(run.finishedAt) - +new Date(run.startedAt)) / 1000)}s`
      : null;
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <GateStatusBadge status={run.status} gateResult={run.gateResult} />
        <span className="text-sm text-muted-foreground">
          {run.processedSamples}/{run.totalSamples}
          {wallClock ? ` · ${wallClock}` : ""}
        </span>
      </div>
      {m && (
        <div className="grid grid-cols-3 gap-4">
          <div>
            <div className="text-xs text-muted-foreground">通过率 A</div>
            <div className="text-2xl">{pct(m.passRateA)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">通过率 B</div>
            <div className="text-2xl">{pct(m.passRateB)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">回归 / 改善</div>
            <div className="text-2xl">
              {m.regressionCount ?? "—"} / {m.improvementCount ?? "—"}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Judge 均分 A</div>
            <div className="text-2xl">{num(m.judgeAvgA)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Judge 均分 B</div>
            <div className="text-2xl">{num(m.judgeAvgB)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Judge 调用次数</div>
            <div className="text-2xl">{m.judgeCallCount}</div>
          </div>
        </div>
      )}
      {run.errorMessage && (
        <div className="text-destructive text-sm">{run.errorMessage}</div>
      )}
    </Card>
  );
}
