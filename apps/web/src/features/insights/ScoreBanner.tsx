import type { ScenarioId } from "@modeldoctor/contracts";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { RadarChart } from "./RadarChart";

type Sub = Record<ScenarioId, number | null>;

interface Props {
  composite: number | null;
  perScenario: Sub;
  totalChecks: number;
  totalRuns: number;
  rangeDays: number;
  axisValues?: Record<string, number | null>;
  /** When true, stack vertically for narrow sidebar placement. */
  compact?: boolean;
}

const SCEN: ScenarioId[] = ["inference", "capacity", "gateway"];

function severityClass(score: number | null) {
  if (score == null) return "text-muted-foreground";
  if (score >= 85) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 60) return "text-amber-600 dark:text-amber-400";
  return "text-rose-600 dark:text-rose-400";
}

export function ScoreBanner({
  composite,
  perScenario,
  totalChecks,
  totalRuns,
  rangeDays,
  axisValues,
  compact,
}: Props) {
  const { t } = useTranslation("insights");
  if (compact) {
    return (
      <Card className="overflow-hidden">
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-center">
            <RadarChart values={axisValues ?? {}} size={160} />
          </div>
          <div className="text-center">
            <div className="flex items-baseline justify-center gap-1.5">
              <div
                data-testid="composite-score"
                className={`text-4xl font-bold tabular-nums ${severityClass(composite)}`}
              >
                {composite ?? "—"}
              </div>
              <div className="text-sm text-muted-foreground">/ 100</div>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{t("detail.compositeScore")}</div>
          </div>
          <div className="space-y-1 text-xs">
            {SCEN.map((s) => (
              <div key={s} className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">{t(`detail.scenario.${s}`)}</span>
                <span
                  data-testid={`subscore-${s}`}
                  className={`font-semibold tabular-nums ${severityClass(perScenario[s])}`}
                >
                  {perScenario[s] ?? "—"}
                </span>
              </div>
            ))}
          </div>
          <div className="border-t border-border pt-2 text-center text-[11px] text-muted-foreground">
            {t("detail.checks", { count: totalChecks })} · {t("detail.runs", { count: totalRuns })}{" "}
            · {t("detail.in", { days: rangeDays })}
          </div>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className="overflow-hidden">
      <CardContent className="grid grid-cols-1 gap-6 p-6 md:grid-cols-[200px_1fr]">
        <div className="flex items-center justify-center">
          <RadarChart values={axisValues ?? {}} size={180} />
        </div>
        <div className="space-y-3">
          <div className="flex items-baseline gap-3">
            <div
              data-testid="composite-score"
              className={`text-5xl font-bold tabular-nums ${severityClass(composite)}`}
            >
              {composite ?? "—"}
            </div>
            <div className="text-lg text-muted-foreground">/ 100</div>
            <div className="text-sm text-muted-foreground">· {t("detail.compositeScore")}</div>
          </div>
          <div className="text-sm text-muted-foreground">
            {t("detail.checks", { count: totalChecks })} · {t("detail.runs", { count: totalRuns })}{" "}
            · {t("detail.in", { days: rangeDays })}
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            {SCEN.map((s) => (
              <div key={s} className="flex items-center gap-1.5">
                <span className="text-muted-foreground">{t(`detail.scenario.${s}`)}:</span>
                <span
                  data-testid={`subscore-${s}`}
                  className={`font-semibold tabular-nums ${severityClass(perScenario[s])}`}
                >
                  {perScenario[s] ?? "—"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
