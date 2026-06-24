import { useTranslation } from "react-i18next";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatLatencyMs, formatPct, formatPercentFromFraction, formatThroughput } from "./format";
import { deltaText, type MetricRowDescriptor } from "./metrics";
import type { ReportBenchmarkSnapshot } from "./ReportSections";
import { isOutlier, rowStats } from "./row-stats";
import { VERDICT_COLOR_CLASSES, VerdictBadge, verdictIcon } from "./VerdictBadge";
import type { Verdict } from "./verdict";
import { verdictFor } from "./verdict";

export interface MetricRowProps {
  descriptor: MetricRowDescriptor;
  runs: ReportBenchmarkSnapshot[];
  baselineId: string | null;
}

/** Cell value text. A named `format` wins; otherwise fall back to the legacy
 * fixed-digits + suffix path (vegeta raw rows that opt out of named formats). */
function fmtCell(n: number | null, descriptor: MetricRowDescriptor): string {
  switch (descriptor.format) {
    case "latencyMs":
      return formatLatencyMs(n);
    case "percent":
      return formatPercentFromFraction(n);
    case "throughput":
      return formatThroughput(n);
    case "pct":
      return formatPct(n);
    default: {
      if (n == null) return "—";
      const digits = descriptor.digits ?? 1;
      return `${n.toFixed(digits)}${descriptor.unitSuffix ? ` ${descriptor.unitSuffix}` : ""}`;
    }
  }
}

// Background tint for a strong outlier cell (no-baseline mode). Direction comes
// from the metric's verdictKind vs the row mean: a worse-direction outlier is
// red, a better-direction one green; a metric with no direction (raw rows) gets
// a neutral amber wash so it still stands out without implying good/bad.
const OUTLIER_TINT: Record<Verdict, string> = {
  regressed: "bg-red-50 dark:bg-red-950/30",
  improved: "bg-green-50 dark:bg-green-950/30",
  unchanged: "bg-amber-50 dark:bg-amber-950/30",
};

export function MetricRow({ descriptor, runs, baselineId }: MetricRowProps) {
  const { t } = useTranslation("benchmarks");
  // Engine-metric rows read the whole run (serverMetrics); tool-metric rows read
  // summaryMetrics. `readRun` wins when present.
  const readValue = (run: (typeof runs)[number]): number | null =>
    descriptor.readRun ? descriptor.readRun(run) : descriptor.read(run.summaryMetrics);
  const baseline = baselineId ? runs.find((r) => r.id === baselineId) : null;
  const baselineValue = baseline ? readValue(baseline) : null;
  const verdictKind = descriptor.verdictKind;

  const values = runs.map((run) => readValue(run));
  // Mean-relative orientation (arrows + outlier heatmap) only kicks in when no
  // baseline is chosen — with a baseline the vs-baseline VerdictBadge owns the
  // good/bad story, and mixing two reference frames would be confusing.
  const meanMode = baselineId === null;
  const stats = meanMode ? rowStats(values) : null;

  return (
    <TableRow>
      <TableCell className="text-xs text-muted-foreground">
        {descriptor.label ?? t(`compare.metricRowLabel.${descriptor.labelKey}`)}
      </TableCell>
      {runs.map((run, i) => {
        const v = values[i];
        const isBaseline = run.id === baselineId;

        // No-baseline orientation vs the row mean.
        const meanVerdict =
          stats && v !== null && verdictKind ? verdictFor(verdictKind, stats.mean, v) : null;
        const outlier = stats !== null && v !== null && isOutlier(v, stats);
        const Arrow =
          meanVerdict && meanVerdict !== "unchanged" && verdictKind
            ? verdictIcon(meanVerdict, verdictKind)
            : null;
        const outlierTint = outlier ? OUTLIER_TINT[meanVerdict ?? "unchanged"] : undefined;
        const outlierTitle =
          outlier && stats && v !== null && verdictKind
            ? t("compare.outlierTitle", {
                delta: deltaText(verdictKind, stats.mean, v),
                defaultValue: `${deltaText(verdictKind, stats.mean, v)} vs mean`,
              })
            : undefined;

        return (
          <TableCell
            key={run.id}
            title={outlierTitle}
            className={cn(
              "text-right tabular-nums",
              isBaseline ? "bg-amber-50 dark:bg-amber-950/30" : outlierTint,
            )}
          >
            <div className="flex flex-col items-end gap-0.5">
              <span className="inline-flex items-center justify-end gap-1">
                {Arrow && meanVerdict && (
                  <Arrow
                    className={cn("h-3 w-3 shrink-0", VERDICT_COLOR_CLASSES[meanVerdict])}
                    aria-hidden="true"
                  />
                )}
                <span>{fmtCell(v, descriptor)}</span>
              </span>
              {/* Inline predicate so TS narrows verdictKind / baselineValue / v
                  through the && chain — see PR review on Task 5. */}
              {verdictKind !== undefined && !isBaseline && baselineValue !== null && v !== null && (
                <VerdictBadge
                  verdict={verdictFor(verdictKind, baselineValue, v)}
                  verdictKind={verdictKind}
                  deltaText={deltaText(verdictKind, baselineValue, v)}
                />
              )}
            </div>
          </TableCell>
        );
      })}
    </TableRow>
  );
}
