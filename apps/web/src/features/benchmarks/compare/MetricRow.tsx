import type { Benchmark } from "@modeldoctor/contracts";
import { useTranslation } from "react-i18next";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatLatencyMs, formatPct, formatPercentFromFraction, formatThroughput } from "./format";
import { deltaText, type MetricRowDescriptor } from "./metrics";
import { VerdictBadge } from "./VerdictBadge";
import { verdictFor } from "./verdict";

export interface MetricRowProps {
  descriptor: MetricRowDescriptor;
  runs: Benchmark[];
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

export function MetricRow({ descriptor, runs, baselineId }: MetricRowProps) {
  const { t } = useTranslation("benchmarks");
  const baseline = baselineId ? runs.find((r) => r.id === baselineId) : null;
  const baselineValue = baseline ? descriptor.read(baseline.summaryMetrics) : null;
  const verdictKind = descriptor.verdictKind;

  return (
    <TableRow>
      <TableCell className="text-xs text-muted-foreground">
        {t(`compare.metricRowLabel.${descriptor.labelKey}`)}
      </TableCell>
      {runs.map((run) => {
        const v = descriptor.read(run.summaryMetrics);
        const isBaseline = run.id === baselineId;

        return (
          <TableCell
            key={run.id}
            className={cn(
              "text-right tabular-nums",
              isBaseline && "bg-amber-50 dark:bg-amber-950/30",
            )}
          >
            <div className="flex flex-col items-end gap-0.5">
              <span>{fmtCell(v, descriptor)}</span>
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
