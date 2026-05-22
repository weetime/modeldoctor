import type { AggregateMetrics, ConnectionRef, EvaluationRun } from "@modeldoctor/contracts";
import { Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
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
    <Card className="p-4 space-y-4">
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

      <EndpointsSection
        endpointA={run.endpointA}
        endpointB={run.endpointB}
        endpointBId={run.endpointBId}
      />

      <GateRulesSection gateConfig={run.gateConfig} metrics={m} />

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

function EndpointsSection({
  endpointA,
  endpointB,
  endpointBId,
}: {
  endpointA: ConnectionRef | null;
  endpointB: ConnectionRef | null;
  endpointBId: string | null;
}) {
  const { t } = useTranslation("quality-gate");
  const hasB = endpointBId != null;
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t("runs.report.endpointsTitle")}
      </div>
      <div className={`grid gap-3 ${hasB ? "md:grid-cols-2" : "grid-cols-1"}`}>
        <EndpointCard label={t("runs.report.endpointAColumn")} connection={endpointA} />
        {hasB && <EndpointCard label={t("runs.report.endpointBColumn")} connection={endpointB} />}
      </div>
    </div>
  );
}

function EndpointCard({ label, connection }: { label: string; connection: ConnectionRef | null }) {
  const { t } = useTranslation("quality-gate");
  return (
    <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-sm">
      <div className="text-xs text-muted-foreground">{label}</div>
      {connection ? (
        <div className="mt-1 space-y-0.5">
          <div className="font-medium">{connection.model}</div>
          <div className="text-xs text-muted-foreground">
            {connection.name} · <span className="font-mono">{connection.baseUrl}</span>
          </div>
        </div>
      ) : (
        <div className="mt-1 text-muted-foreground italic">{t("runs.report.endpointMissing")}</div>
      )}
    </div>
  );
}

function GateRulesSection({
  gateConfig,
  metrics,
}: {
  gateConfig: EvaluationRun["gateConfig"];
  metrics: AggregateMetrics | null;
}) {
  const { t } = useTranslation("quality-gate");
  const rules: Array<{ label: string; threshold: string; actual: string; passed: boolean }> = [];

  if (gateConfig.passRateMin != null) {
    const actual = metrics?.passRateA;
    const passed = actual != null && actual >= gateConfig.passRateMin;
    rules.push({
      label: t("runs.report.gateRulePassRateMin"),
      threshold: `≥ ${(gateConfig.passRateMin * 100).toFixed(1)}%`,
      actual: actual == null ? "—" : `${(actual * 100).toFixed(1)}%`,
      passed,
    });
  }
  if (gateConfig.regressionMax != null) {
    const actual = metrics?.regressionCount ?? null;
    const passed = actual != null && actual <= gateConfig.regressionMax;
    rules.push({
      label: t("runs.report.gateRuleRegressionMax"),
      threshold: `≤ ${gateConfig.regressionMax}`,
      actual: actual == null ? "—" : String(actual),
      passed,
    });
  }
  if (gateConfig.judgeScoreMin != null) {
    const actual = metrics?.judgeAvgA;
    const passed = actual != null && actual >= gateConfig.judgeScoreMin;
    rules.push({
      label: t("runs.report.gateRuleJudgeScoreMin"),
      threshold: `≥ ${gateConfig.judgeScoreMin.toFixed(2)}`,
      actual: actual == null ? "—" : actual.toFixed(2),
      passed,
    });
  }

  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t("runs.report.gateRulesTitle")}
      </div>
      {rules.length === 0 ? (
        <div className="text-sm text-muted-foreground">{t("runs.report.gateRulesNone")}</div>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {rules.map((r) => (
            <li
              key={r.label}
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/20 px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <div className="truncate text-xs text-muted-foreground">{r.label}</div>
                <div className="font-mono text-xs">
                  {r.threshold} · {t("runs.report.gateRuleActual")} {r.actual}
                </div>
              </div>
              {metrics == null ? (
                <span className="text-xs text-muted-foreground">—</span>
              ) : r.passed ? (
                <Check className="h-4 w-4 shrink-0 text-emerald-500" aria-label="pass" />
              ) : (
                <X className="h-4 w-4 shrink-0 text-destructive" aria-label="fail" />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
