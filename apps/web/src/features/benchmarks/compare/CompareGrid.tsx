import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { MetricRow } from "./MetricRow";
import { rowDescriptorsForTool } from "./metrics";
import type { ReportBenchmarkSnapshot } from "./ReportSections";

export interface CompareGridProps {
  runs: ReportBenchmarkSnapshot[];
  baselineId: string | null;
}

export function CompareGrid({ runs, baselineId }: CompareGridProps) {
  const { t } = useTranslation("benchmarks");

  // All runs share one tool by the time CompareGrid mounts (validated upstream).
  // If the array is empty just render nothing — BenchmarkComparePage shows EmptyState.
  const tool = runs[0]?.tool;
  const descriptors = useMemo(() => (tool ? rowDescriptorsForTool(tool) : []), [tool]);

  if (descriptors.length === 0) return null;

  return (
    <div className="rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-48 text-xs text-muted-foreground">
              {t("compare.metricColumnLabel", { defaultValue: "Metric" })}
            </TableHead>
            {runs.map((run) => (
              <TableHead
                key={run.id}
                className={cn(
                  "text-right",
                  run.id === baselineId && "bg-amber-50 dark:bg-amber-950/30",
                )}
              >
                {run.name}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {descriptors.map((d) => (
            <MetricRow key={d.labelKey} descriptor={d} runs={runs} baselineId={baselineId} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
