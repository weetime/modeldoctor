import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useMemo } from "react";
import { ChartFrame, themed, useChartTokens } from "./_shared";

export interface ThroughputConcurrencySeries {
  stage: string;
  points: { concurrency: number; rps: number }[];
}

export interface ThroughputConcurrencyChartProps {
  title: string;
  series: ThroughputConcurrencySeries[];
  height?: number;
}

/** Fixed report light palette — mirrors REPORT_PALETTE in FigureRenderer so
 * line colors are consistent across all figures on the always-light report paper. */
const REPORT_PALETTE = [
  "hsl(98, 38%, 46%)",
  "hsl(43, 81%, 47%)",
  "hsl(190, 65%, 50%)",
  "hsl(22, 85%, 48%)",
  "hsl(4, 75%, 47%)",
  "hsl(208, 73%, 44%)",
  "hsl(308, 47%, 45%)",
  "hsl(260, 28%, 42%)",
] as const;

/**
 * Line chart: x-axis = concurrency, y-axis = throughput (rps), one line per
 * stage/run. Uses log-scale x-axis (concurrency 1→4→16→64 spans multiple
 * octaves and reads poorly on a linear axis). Markers are shown on every point
 * so the chart reads correctly in print / PDF / HTML export without hover.
 * Colors come from the fixed report light palette — the report "paper" is
 * always light so we never follow the app theme.
 */
export function ThroughputConcurrencyChart({
  title,
  series,
  height = 300,
}: ThroughputConcurrencyChartProps): JSX.Element {
  const tokens = useChartTokens();
  const isEmpty = series.length === 0 || series.every((s) => s.points.length === 0);

  const option = useMemo<EChartsOption>(() => {
    // Fixed label colors for the always-light report paper.
    const lc = {
      value: "#1f2328",
      baseline: "#59636e",
    };

    const ecSeries = series.map((s, idx) => {
      // Sort points by concurrency ascending before plotting.
      const sorted = [...s.points].sort((a, b) => a.concurrency - b.concurrency);
      const color = REPORT_PALETTE[idx % REPORT_PALETTE.length];
      return {
        name: s.stage,
        type: "line" as const,
        data: sorted.map((p) => [p.concurrency, p.rps]),
        itemStyle: { color },
        lineStyle: { color, width: 2 },
        // Markers on every point — required for print-safe rendering.
        symbol: "circle" as const,
        symbolSize: 6,
        label: {
          show: true,
          position: "top" as const,
          color: lc.value,
          fontSize: 10,
          fontWeight: 500 as const,
          formatter: (p: { value: [number, number] | unknown }) => {
            const v = Array.isArray(p.value) ? p.value[1] : null;
            return typeof v === "number" ? v.toFixed(1) : "";
          },
        },
      };
    });

    return themed(
      {
        tooltip: {
          trigger: "axis",
          valueFormatter: (val: unknown) =>
            typeof val === "number" ? `${val.toFixed(2)} rps` : String(val ?? ""),
        },
        legend:
          series.length > 1
            ? { type: "scroll", top: 0, textStyle: { color: lc.value } }
            : undefined,
        xAxis: {
          type: "log" as const,
          name: "concurrency",
          nameLocation: "middle" as const,
          nameGap: 28,
          axisLabel: {
            color: lc.baseline,
            formatter: (v: number) => String(v),
          },
        },
        yAxis: {
          type: "value" as const,
          name: "rps",
          nameLocation: "middle" as const,
          nameGap: 40,
          min: 0,
          max: (v: { max: number }) => (v.max > 0 ? v.max * 1.15 : 1),
          axisLabel: {
            color: lc.baseline,
            formatter: (v: number) => v.toFixed(0),
          },
        },
        grid: {
          left: 64,
          right: 24,
          top: series.length > 1 ? 56 : 32,
          bottom: 48,
        },
        series: ecSeries,
      },
      tokens,
    );
  }, [series, tokens]);

  return (
    <div className="rounded-md border border-border p-4">
      {title ? <div className="mb-2 text-sm font-medium">{title}</div> : null}
      <ChartFrame ariaLabel={title} height={height} empty={isEmpty}>
        <ReactECharts
          option={option}
          style={{ height: "100%", width: "100%" }}
          notMerge
          lazyUpdate
        />
      </ChartFrame>
    </div>
  );
}
