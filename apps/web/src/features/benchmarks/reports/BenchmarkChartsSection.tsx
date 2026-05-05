import { LatencyCDF, TTFTHistogram } from "@/components/charts";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { BenchmarkTool } from "@modeldoctor/contracts";
import { useTranslation } from "react-i18next";
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

  // vegeta has no TTFT — single chart spans full width on lg.
  const cdfClass = hasHistogram ? "" : "lg:col-span-2";

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className={`rounded-md border border-border bg-card p-3 ${cdfClass}`.trim()}>
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
