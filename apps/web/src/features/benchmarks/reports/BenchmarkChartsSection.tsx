import type { BenchmarkTool } from "@modeldoctor/contracts";
import { useTranslation } from "react-i18next";
import { LatencyCDF, TTFTHistogram } from "@/components/charts";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useBenchmarkCharts } from "../queries";

export interface BenchmarkChartsSectionProps {
  benchmarkId: string;
  tool: BenchmarkTool;
}

export function BenchmarkChartsSection({ benchmarkId, tool }: BenchmarkChartsSectionProps) {
  const { t } = useTranslation("benchmarks");
  const { data, isLoading, isError } = useBenchmarkCharts(benchmarkId);

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{t("detail.charts.loadError")}</AlertDescription>
      </Alert>
    );
  }

  const hasCdf = (data?.latencyCdf?.samples?.length ?? 0) > 0;
  const hasHistogram = (data?.ttftHistogram?.buckets?.length ?? 0) > 0;

  if (!isLoading && !hasCdf && !hasHistogram) {
    return (
      <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        {t("detail.charts.empty")}
      </div>
    );
  }

  // Stacked single-column: TTFT histogram x-axis labels (long bucket ranges)
  // and CDF zoom slider all need real horizontal room — side-by-side made
  // both unreadable.
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-card p-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">
          {t("detail.charts.latencyCdfTitle")}
        </div>
        <LatencyCDF
          ariaLabel={`${tool} latency CDF`}
          loading={isLoading}
          series={
            data?.latencyCdf
              ? [{ runId: benchmarkId, runLabel: tool, samples: data.latencyCdf.samples }]
              : []
          }
        />
      </div>
      {hasHistogram && (
        <div className="rounded-md border border-border bg-card p-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            {t("detail.charts.ttftHistogramTitle")}
          </div>
          <TTFTHistogram
            ariaLabel={`${tool} TTFT histogram`}
            loading={isLoading}
            series={
              data?.ttftHistogram
                ? [{ runId: benchmarkId, runLabel: tool, buckets: data.ttftHistogram.buckets }]
                : []
            }
          />
        </div>
      )}
    </div>
  );
}
