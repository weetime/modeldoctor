import type { Benchmark } from "@modeldoctor/contracts";
import { type Tau3Report, tau3ReportSchema } from "@modeldoctor/tool-adapters/schemas";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CompletionBars } from "./agent/CompletionBars";
import { ConversationReplay } from "./agent/ConversationReplay";
import { FailureAttribution } from "./agent/FailureAttribution";
import { UnknownReport } from "./UnknownReport";

export interface AgentReportProps {
  benchmark: Benchmark;
}

type GateResultValue = "PASSED" | "WARNING" | "FAILED";

// Mirrors the color semantics of GateStatusBadge (quality-gate):
// emerald=passed, amber=warning, destructive=failed.
const GATE_BADGE_CLASS: Record<GateResultValue, string> = {
  PASSED: "border-emerald-600/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  WARNING: "border-amber-600/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  FAILED: "border-destructive/30 bg-destructive/10 text-destructive",
};

function pct0(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-2xl font-semibold">{value}</CardContent>
    </Card>
  );
}

/**
 * Agent-scenario (tau3-bench) report container. Renders overall/gate/user-sim
 * header tiles, per-domain completion-rate bars (CompletionBars), the
 * success/failure conversation highlights (ConversationReplay), and the
 * failure-attribution breakdown (FailureAttribution). Each highlight only
 * mounts when its `highlights.*SimId`/`*Domain` pair is non-null — a run
 * with too few failures (or a successful run with no failures at all) can
 * leave either or both null.
 */
export function AgentReport({ benchmark }: AgentReportProps) {
  const { t } = useTranslation("benchmarks");
  const tagged = benchmark.summaryMetrics as { tool?: string; data?: unknown } | null;
  const parsed = tau3ReportSchema.safeParse(tagged?.data);
  if (!parsed.success) {
    return <UnknownReport benchmark={benchmark} reason={parsed.error.message} />;
  }
  const data: Tau3Report = parsed.data;
  const gateResult = data.gate?.result ?? null;
  const { successSimId, successDomain, failureSimId, failureDomain } = data.highlights;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatTile label={t("reports.agent.overallPass1")} value={pct0(data.overall.pass1)} />
        <StatTile label={t("reports.agent.overallPassK")} value={pct0(data.overall.passK)} />
        <StatTile label={t("reports.agent.totalTasks")} value={String(data.overall.tasks)} />
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("reports.agent.gate.title")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {gateResult ? (
              <span
                className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-sm font-semibold ${GATE_BADGE_CLASS[gateResult]}`}
              >
                {gateResult}
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">{t("reports.agent.gate.off")}</span>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="rounded-md border border-dashed border-amber-500/40 bg-amber-500/5 p-3 text-sm">
        <div className="font-medium">
          {t("reports.agent.userSimLabel", { model: data.userSimModel })}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{t("reports.agent.userSimCaveat")}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("reports.agent.benchProvenance")}
          {data.benchVersion ? ` · ${data.benchVersion}` : null}
        </p>
      </div>

      <CompletionBars perDomain={data.perDomain} numTrials={data.numTrials} />

      <div data-testid="agent-report-replay-slot" className="space-y-6">
        {successSimId && successDomain ? (
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground">
              {t("reports.agent.replay.successHeading")}
            </h3>
            <ConversationReplay
              benchmarkId={benchmark.id}
              simId={successSimId}
              domain={successDomain}
              variant="success"
            />
          </div>
        ) : null}
        {failureSimId && failureDomain ? (
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground">
              {t("reports.agent.replay.failureHeading")}
            </h3>
            <ConversationReplay
              benchmarkId={benchmark.id}
              simId={failureSimId}
              domain={failureDomain}
              variant="failure"
            />
          </div>
        ) : null}
        {!successSimId && !failureSimId ? (
          <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {t("reports.agent.replayPlaceholder")}
          </p>
        ) : null}
      </div>

      <div data-testid="agent-report-attribution-slot">
        <FailureAttribution attribution={data.attribution} />
      </div>
    </div>
  );
}
