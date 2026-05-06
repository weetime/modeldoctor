import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

export interface P95Point {
  /** ISO timestamp string. */
  ts: string;
  /** p95 latency in ms. */
  p95Ms: number;
  /** Human-readable run name for tooltip. */
  name: string;
}

interface Props {
  points: P95Point[];
}

/**
 * p95-over-time line chart for the test insights detail page. Wraps
 * echarts-for-react with a sensible default theme. Empty state renders
 * a placeholder rather than the chart so users see the "no data" case
 * explicitly instead of an empty axis.
 */
export function TestInsightsP95Chart({ points }: Props) {
  const { t } = useTranslation("benchmarks");
  const option = useMemo<EChartsOption>(() => {
    return {
      grid: { top: 12, right: 12, bottom: 32, left: 48 },
      tooltip: {
        trigger: "axis",
        formatter: (params: unknown) => {
          // params is an array of axis-pointer entries; we only have one series.
          const arr = Array.isArray(params) ? params : [params];
          const p = arr[0] as { dataIndex: number; value: number };
          const point = points[p.dataIndex];
          if (!point) return String(p.value);
          const date = new Date(point.ts);
          return `${point.name}<br/>${date.toLocaleString()}<br/>p95: <b>${p.value} ms</b>`;
        },
      },
      xAxis: {
        type: "category",
        data: points.map((p) => p.ts),
        axisLabel: {
          formatter: (iso: string) => {
            const d = new Date(iso);
            return `${d.getMonth() + 1}/${d.getDate()}`;
          },
        },
      },
      yAxis: {
        type: "value",
        axisLabel: { formatter: "{value} ms" },
        scale: true,
      },
      series: [
        {
          type: "line",
          name: "p95",
          data: points.map((p) => p.p95Ms),
          symbolSize: 6,
          smooth: false,
          lineStyle: { width: 2 },
        },
      ],
    };
  }, [points]);

  if (points.length === 0) {
    return (
      <div
        role="status"
        className="flex h-64 items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground"
      >
        {t("reports.detail.timeseries.empty")}
      </div>
    );
  }
  return <ReactECharts option={option} style={{ height: 256, width: "100%" }} />;
}
