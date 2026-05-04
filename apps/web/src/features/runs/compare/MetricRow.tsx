import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { Run } from "@modeldoctor/contracts";
import { useTranslation } from "react-i18next";
import { VerdictBadge } from "./VerdictBadge";
import type { MetricRowDescriptor, VerdictKind } from "./metrics";
import {
  type Verdict,
  verdictForErrorRate,
  verdictForLatency,
  verdictForThroughput,
} from "./verdict";

export interface MetricRowProps {
  descriptor: MetricRowDescriptor;
  runs: Run[];
  baselineId: string | null;
}

function fmtNum(n: number | null, digits: number, suffix?: string): string {
  if (n == null) return "—";
  return `${n.toFixed(digits)}${suffix ? ` ${suffix}` : ""}`;
}

function computeVerdict(kind: VerdictKind, baselineValue: number, currentValue: number): Verdict {
  switch (kind) {
    case "latency":
      return verdictForLatency(baselineValue, currentValue);
    case "errorRate":
      return verdictForErrorRate(baselineValue, currentValue);
    case "throughput":
      return verdictForThroughput(baselineValue, currentValue);
  }
}

function deltaText(kind: VerdictKind, baselineValue: number, currentValue: number): string {
  if (kind === "errorRate") {
    const pp = (currentValue - baselineValue) * 100;
    return `${pp >= 0 ? "+" : ""}${pp.toFixed(2)}pp`;
  }
  if (baselineValue === 0) return "—";
  const pct = ((currentValue - baselineValue) / baselineValue) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

export function MetricRow({ descriptor, runs, baselineId }: MetricRowProps) {
  const { t } = useTranslation("runs");
  const digits = descriptor.digits ?? 1;
  const baseline = baselineId ? runs.find((r) => r.id === baselineId) : null;
  const baselineValue = baseline ? descriptor.read(baseline.summaryMetrics) : null;

  return (
    <TableRow>
      <TableCell className="text-xs text-muted-foreground">
        {t(`compare.metricRowLabel.${descriptor.labelKey}`)}
      </TableCell>
      {runs.map((run) => {
        const v = descriptor.read(run.summaryMetrics);
        const isBaseline = run.id === baselineId;
        const verdictKind = descriptor.verdictKind;
        const showBadge =
          verdictKind !== undefined && !isBaseline && baselineValue !== null && v !== null;

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
              {showBadge && verdictKind !== undefined && baselineValue !== null && v !== null && (
                <VerdictBadge
                  verdict={computeVerdict(verdictKind, baselineValue, v)}
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
