import type { Tau3Report } from "@modeldoctor/tool-adapters/schemas";
import { useTranslation } from "react-i18next";
import { useChartTokens } from "@/components/charts/_shared";
import { StageBarChart } from "@/components/charts/StageBarChart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface CompletionBarsProps {
  perDomain: Tau3Report["perDomain"];
  numTrials: number;
}

// `Tau3Report["overall"]` and each value of `perDomain` share the same
// per-domain-metrics shape (pass1/passK/tasks/...). Naming it here (rather
// than indexing `perDomain[key]`) sidesteps `noUncheckedIndexedAccess`, which
// would otherwise widen a computed indexed-access type to `| undefined`.
type DomainMetrics = Tau3Report["overall"];

function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

/**
 * Grouped pass^1 / pass^k completion-rate bars, one group per tau3 domain.
 * Reuses the app's existing categorical-x grouped bar chart (StageBarChart,
 * ECharts under the hood) rather than adding a new chart dependency.
 *
 * A plain HTML table mirrors the chart data beneath it — the dataviz skill's
 * accessibility rule requires a table view alongside any chart, and it also
 * keeps per-domain values screen-reader / text-search friendly (the chart
 * itself renders to canvas).
 */
export function CompletionBars({ perDomain, numTrials }: CompletionBarsProps) {
  const { t } = useTranslation("benchmarks");
  const tokens = useChartTokens();
  const entries = Object.entries(perDomain) as Array<[keyof typeof perDomain, DomainMetrics]>;

  const chartData = entries.map(([d, m]) => ({ stage: d, pass1: m.pass1, passK: m.passK }));

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-muted-foreground">
        {t("reports.agent.completionBars.title", { count: numTrials })}
      </h3>
      <div className="overflow-x-auto">
        <StageBarChart
          ariaLabel={t("reports.agent.completionBars.ariaLabel")}
          data={chartData}
          series={[
            { key: "pass1", label: t("reports.agent.pass1"), color: tokens.palette[0] },
            { key: "passK", label: t("reports.agent.passK"), color: tokens.palette[1] },
          ]}
          unit="ratio"
          yLabel={t("reports.agent.completionRate")}
        />
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("reports.agent.domain")}</TableHead>
              <TableHead className="text-right">{t("reports.agent.pass1")}</TableHead>
              <TableHead className="text-right">{t("reports.agent.passK")}</TableHead>
              <TableHead className="text-right">{t("reports.agent.tasks")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map(([d, m]) => (
              <TableRow key={d}>
                <TableCell className="font-medium capitalize">{d}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtPct(m.pass1)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtPct(m.passK)}</TableCell>
                <TableCell className="text-right tabular-nums">{m.tasks}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
