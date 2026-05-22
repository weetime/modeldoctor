import type { Benchmark } from "@modeldoctor/contracts";
import { useTranslation } from "react-i18next";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { deltaText, type MetricRowDescriptor } from "./metrics";
import { VerdictBadge } from "./VerdictBadge";
import { verdictFor } from "./verdict";

export interface MetricRowProps {
  descriptor: MetricRowDescriptor;
  runs: Benchmark[];
  baselineId: string | null;
}

function fmtNum(n: number | null, digits: number, suffix?: string): string {
  if (n == null) return "—";
  return `${n.toFixed(digits)}${suffix ? ` ${suffix}` : ""}`;
}

export function MetricRow({ descriptor, runs, baselineId }: MetricRowProps) {
  const { t } = useTranslation("benchmarks");
  const digits = descriptor.digits ?? 1;
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
              <span>{fmtNum(v, digits, descriptor.unitSuffix)}</span>
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
