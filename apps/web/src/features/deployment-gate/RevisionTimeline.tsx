import type { AutomationRunPublic, DeploymentRevisionPublic } from "@modeldoctor/contracts";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { RelativeTime } from "@/components/common/relative-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { VerdictBadge } from "./VerdictBadge";

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

function RunCard({ run, onCancel }: { run: AutomationRunPublic; onCancel: (id: string) => void }) {
  const { t } = useTranslation("deployment-gate");
  const active = run.status === "pending" || run.status === "running";
  return (
    <div className="rounded-md border border-border p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <VerdictBadge run={run} />
        <span className="text-muted-foreground">{t(`detail.trigger.${run.trigger}`)}</span>
        <span className="text-muted-foreground">·</span>
        <RelativeTime date={run.createdAt} />
        {active && run.currentStep && (
          <span className="text-muted-foreground">· {t(`detail.steps.${run.currentStep}`)}</span>
        )}
        {active && (
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => onCancel(run.id)}>
            {t("detail.cancelRun")}
          </Button>
        )}
      </div>
      {run.summary?.steps.length ? (
        <div className="flex flex-wrap gap-2 text-xs">
          {run.summary.steps.map((s) => (
            <Badge
              key={s.step}
              variant={s.outcome === "ok" ? "outline" : "destructive"}
              title={s.message}
            >
              {t(`detail.steps.${s.step}`)}: {t(`detail.outcome.${s.outcome}`)}
            </Badge>
          ))}
        </div>
      ) : null}
      {run.summary?.gateWarning && (
        <p className="text-xs text-amber-600">{t("detail.gateWarning")}</p>
      )}
      {run.summary?.baselineEstablished && (
        <p className="text-xs text-muted-foreground">
          {t("detail.regression.baselineEstablished")}
        </p>
      )}
      {run.summary?.regression &&
        !run.summary.regression.compared &&
        !run.summary.baselineEstablished && (
          <p className="text-xs text-muted-foreground">
            {t("detail.regression.notCompared", { reason: run.summary.regression.reason ?? "" })}
          </p>
        )}
      {run.summary?.regression?.compared && (
        <table className="text-xs">
          <tbody>
            {run.summary.regression.metrics.map((m) => (
              <tr key={m.metric} className={m.exceeded ? "text-destructive" : ""}>
                <td className="pr-4">{t(`detail.regression.metric.${m.metric}`)}</td>
                <td className="pr-4 font-mono">
                  {fmt(m.baseline)} → {fmt(m.current)}
                </td>
                <td className="font-mono">
                  {m.changePct === null ? "—" : `${m.changePct.toFixed(1)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="flex gap-3 text-xs">
        {run.evaluationRunId && (
          <Link className="hover:underline" to={`/quality-gate/runs/${run.evaluationRunId}`}>
            {t("detail.links.evaluation")}
          </Link>
        )}
        {run.benchmarkId && (
          <Link className="hover:underline" to={`/benchmarks/${run.benchmarkId}`}>
            {t("detail.links.benchmark")}
          </Link>
        )}
      </div>
    </div>
  );
}

export function RevisionTimeline({
  revisions,
  onCancelRun,
}: {
  revisions: DeploymentRevisionPublic[];
  onCancelRun: (runId: string) => void;
}) {
  const { t } = useTranslation("deployment-gate");
  if (!revisions.length)
    return <p className="text-sm text-muted-foreground">{t("detail.noRevisions")}</p>;
  return (
    <ol className="space-y-6 border-l border-border pl-6">
      {revisions.map((rev, idx) => (
        <li key={rev.id} className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-mono">{rev.fingerprint.slice(0, 12)}</span>
            <Badge variant={rev.readyAt ? "outline" : "default"}>
              {rev.readyAt ? t("detail.ready") : t("detail.notReady")}
            </Badge>
            <span className="text-muted-foreground">
              {t("detail.firstSeen")} <RelativeTime date={rev.firstSeenAt} />
            </span>
          </div>
          {idx === revisions.length - 1 && rev.diff.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("detail.initialRevision")}</p>
          ) : rev.diff.length > 0 ? (
            <table className="text-xs">
              <tbody>
                {rev.diff.map((d) => (
                  <tr key={d.field}>
                    <td className="pr-4 font-mono text-muted-foreground">{d.field}</td>
                    <td className="pr-2 font-mono line-through opacity-60">{fmt(d.before)}</td>
                    <td className="font-mono">{fmt(d.after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {rev.runs.length ? (
            <div className="space-y-2">
              {rev.runs.map((r) => (
                <RunCard key={r.id} run={r} onCancel={onCancelRun} />
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t("detail.noRunsForRevision")}</p>
          )}
        </li>
      ))}
    </ol>
  );
}
