// apps/web/src/features/insights/ScenarioPanel.tsx
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { Benchmark, Finding, ScenarioId } from "@modeldoctor/contracts";
import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { FindingsCard } from "./FindingsCard";
import { RadarChart } from "./RadarChart";

interface Props {
  scenario: ScenarioId;
  subScore: number | null;
  axisValues: Record<string, number | null>;
  findings: Finding[];
  runs: Benchmark[];
  connectionId: string;
  rangeFromISO: string;
}

export function ScenarioPanel({
  scenario,
  subScore,
  axisValues,
  findings,
  runs,
  connectionId,
  rangeFromISO,
}: Props) {
  const { t } = useTranslation("insights");
  const hasData = runs.length > 0;
  if (!hasData) {
    return (
      <Card>
        <CardHeader>
          <h3 className="text-sm font-semibold">{t(`detail.scenario.${scenario}`)}</h3>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">
            {t("detail.scenario.empty.title", { scenario: t(`detail.scenario.${scenario}`) })}
          </div>
          <div className="mt-2">
            <Button asChild variant="outline" size="sm">
              <Link to={`/benchmarks/${scenario}`}>{t("detail.scenario.empty.cta")}</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }
  const tools = [...new Set(runs.map((r) => r.tool))];
  return (
    <Card>
      <CardHeader className="flex-row items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {t(`detail.scenario.${scenario}`)}{" "}
          {subScore != null && (
            <span className="ml-2 text-base font-bold tabular-nums">{subScore}</span>
          )}
        </h3>
        <span className="text-xs text-muted-foreground">
          {t("detail.runs", { count: runs.length })} · {tools.join(", ")}
        </span>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-[140px_1fr]">
        <div className="flex justify-center">
          <RadarChart values={axisValues} size={140} />
        </div>
        <div className="space-y-2">
          <FindingsCard findings={findings} defaultLimit={3} />
          <div>
            <Button asChild variant="ghost" size="sm" className="gap-1">
              <Link
                to={`/benchmarks/${scenario}?connectionId=${encodeURIComponent(connectionId)}&createdAfter=${encodeURIComponent(rangeFromISO)}`}
              >
                {t("detail.scenario.viewAll", { count: runs.length })}
                <ArrowRight className="h-3 w-3" />
              </Link>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
