import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { BarChart, HeatmapChart, LineChart, ScatterChart } from "echarts/charts";
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useMemo } from "react";
import { applyTheme } from "./theme";

// Tree-shake ECharts: register only what we use.
echarts.use([
  ScatterChart,
  LineChart,
  BarChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  DataZoomComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

export type ChartKind = "scatter" | "line" | "bar" | "heatmap";

export interface ScatterPoint {
  x: number;
  y: number;
  label?: string;
  color?: string;
}
export interface LineBarSeries {
  name: string;
  data: Array<[number | string, number]>;
  color?: string;
}
export interface HeatmapCell {
  x: number | string;
  y: number | string;
  value: number;
}

export type ChartData<K extends ChartKind> = K extends "scatter"
  ? { points: ScatterPoint[]; xLabel?: string; yLabel?: string }
  : K extends "line" | "bar"
    ? { series: LineBarSeries[]; xLabel?: string; yLabel?: string }
    : K extends "heatmap"
      ? {
          cells: HeatmapCell[];
          xLabels: (string | number)[];
          yLabels: (string | number)[];
        }
      : never;

export interface ChartProps<K extends ChartKind> {
  kind: K;
  data: ChartData<K>;
  options?: Partial<EChartsOption>;
  theme?: "auto" | "light" | "dark";
  height?: number | string;
  loading?: boolean;
  empty?: boolean | string;
  ariaLabel: string;
}

function buildOption<K extends ChartKind>(
  kind: K,
  data: ChartData<K>,
  extra?: Partial<EChartsOption>,
): EChartsOption {
  if (kind === "scatter") {
    const d = data as ChartData<"scatter">;
    const opt: EChartsOption = {
      tooltip: { trigger: "item" },
      xAxis: { type: "value", name: d.xLabel ?? "" },
      yAxis: { type: "value", name: d.yLabel ?? "" },
      series: [
        {
          type: "scatter",
          data: d.points.map((p) => [p.x, p.y, p.label ?? ""]),
          symbolSize: 8,
        },
      ],
      dataZoom: [{ type: "inside" }, { type: "inside", orient: "vertical" }],
    };
    return { ...opt, ...extra };
  }
  if (kind === "line" || kind === "bar") {
    const d = data as ChartData<"line"> | ChartData<"bar">;
    const opt: EChartsOption = {
      tooltip: { trigger: "axis" },
      legend: { data: d.series.map((s) => s.name) },
      xAxis: { type: "category", name: d.xLabel ?? "" },
      yAxis: { type: "value", name: d.yLabel ?? "" },
      series: d.series.map((s) => ({
        name: s.name,
        type: kind as "line" | "bar",
        data: s.data,
      })),
    };
    return { ...opt, ...extra };
  }
  // heatmap
  const d = data as ChartData<"heatmap">;
  const opt: EChartsOption = {
    tooltip: { position: "top" },
    xAxis: { type: "category", data: d.xLabels.map(String) },
    yAxis: { type: "category", data: d.yLabels.map(String) },
    visualMap: {
      min: 0,
      max: 1,
      calculable: true,
      orient: "horizontal",
      left: "center",
      bottom: 0,
    },
    series: [
      {
        type: "heatmap",
        data: d.cells.map((c) => [String(c.x), String(c.y), c.value]),
      },
    ],
  };
  return { ...opt, ...extra };
}

function isDarkTheme(modeProp: ChartProps<ChartKind>["theme"]): boolean {
  if (modeProp === "dark") return true;
  if (modeProp === "light") return false;
  if (typeof window === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}

export function Chart<K extends ChartKind>(props: ChartProps<K>) {
  const { kind, data, options, theme = "auto", height = 360, loading, empty, ariaLabel } = props;

  const dark = isDarkTheme(theme);
  const option = useMemo(
    () => applyTheme(buildOption(kind, data, options), dark),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, data, options, dark],
  );

  if (loading) {
    return (
      <div
        role="status"
        aria-label="Loading chart"
        style={{ height }}
        className="animate-pulse rounded-md bg-muted/40"
      />
    );
  }
  if (empty) {
    const msg = typeof empty === "string" ? empty : "No data";
    return (
      <output
        aria-label={ariaLabel}
        style={{ height }}
        className="flex items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground"
      >
        {msg}
      </output>
    );
  }
  return (
    <div aria-label={ariaLabel} style={{ height }}>
      <ReactECharts option={option} style={{ height: "100%", width: "100%" }} />
    </div>
  );
}
