import { useTranslation } from "react-i18next";
import { useChartTokens } from "@/components/charts/_shared";
import { PieChart } from "@/components/charts/PieChart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface FailureAttributionProps {
  /**
   * Bucket → fraction (of failed episodes) map. Buckets are one of
   * `agent_crash|no_completion|wrong_action|wrong_final_state|missing_info|other`
   * but the map is intentionally kept as `Record<string, number>` — unknown
   * bucket keys fall back to rendering the raw key as their label.
   */
  attribution: Record<string, number>;
}

function fmtPct0(v: number): string {
  return `${Math.round(v)}%`;
}

/**
 * Failure-attribution chart: a donut of the tau2 failure buckets plus a
 * one-line conclusion naming the largest bucket. Reuses the app's existing
 * `PieChart` (ECharts, same as `CompletionBars`' `StageBarChart`) — no new
 * chart dependency.
 *
 * The bucket assignment is DETERMINISTIC (derived from `reward_info` /
 * `termination_reason` on the runner side, not an LLM judge), so — unlike
 * the AI-narrative sections elsewhere in the app — this intentionally does
 * NOT carry an "automatic classification may be inaccurate" disclaimer.
 *
 * Percentage shares are computed as `value / sum(values)` rather than
 * assuming the input already sums to 1 — this keeps the component correct
 * whether the runner reports true fractions or raw failure counts.
 */
export function FailureAttribution({ attribution }: FailureAttributionProps) {
  const { t } = useTranslation("benchmarks");
  const tokens = useChartTokens();

  const entries = Object.entries(attribution);
  const total = entries.reduce((sum, [, v]) => sum + v, 0);

  if (entries.length === 0 || total <= 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        {t("reports.agent.attribution.empty")}
      </div>
    );
  }

  const labelFor = (key: string): string =>
    t(`reports.agent.attribution.buckets.${key}`, { defaultValue: key });

  const rows = entries
    .map(([key, value]) => ({
      key,
      label: labelFor(key),
      value,
      pct: (value / total) * 100,
    }))
    .sort((a, b) => b.value - a.value);

  const top = rows[0];

  const pieData = rows.map((r, i) => ({
    name: r.label,
    value: r.value,
    color: tokens.palette[i % tokens.palette.length],
  }));

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-muted-foreground">
        {t("reports.agent.attribution.title")}
      </h3>
      <div className="overflow-x-auto">
        <PieChart ariaLabel={t("reports.agent.attribution.ariaLabel")} data={pieData} />
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("reports.agent.attribution.bucketColumn")}</TableHead>
              <TableHead className="text-right">
                {t("reports.agent.attribution.shareColumn")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.key}>
                <TableCell className="font-medium">{r.label}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtPct0(r.pct)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-sm">
        {t("reports.agent.attribution.conclusion", {
          label: top.label,
          pct: fmtPct0(top.pct),
        })}
      </p>
    </div>
  );
}
