import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useMemo } from "react";
import { ChartFrame, themed, useChartTokens } from "./_shared";
import type { StageBarLabelColors } from "./StageBarChart";

export interface PodDistributionDatum {
  stage: string;
  pods: { pod: string; value: number }[];
}

export interface PodHeatmap {
  stages: string[];
  pods: string[];
  /** [stageIndex, podIndex, value] tuples for an ECharts heatmap. */
  cells: [number, number, number][];
  min: number;
  max: number;
}

/**
 * Pivot per-stage pod values into a stage×pod matrix for a heatmap. Pods are
 * collected across all stages (first-seen order); a pod missing from a stage
 * simply yields no cell (renders blank). Empty input → empty cells, [0,1] range.
 */
export function buildPodHeatmap(data: PodDistributionDatum[]): PodHeatmap {
  const pods: string[] = [];
  for (const d of data) {
    for (const p of d.pods) {
      if (!pods.includes(p.pod)) pods.push(p.pod);
    }
  }
  const stages = data.map((d) => d.stage);
  const cells: [number, number, number][] = [];
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  data.forEach((d, xi) => {
    for (const p of d.pods) {
      const yi = pods.indexOf(p.pod);
      if (yi < 0) continue;
      cells.push([xi, yi, p.value]);
      if (p.value < min) min = p.value;
      if (p.value > max) max = p.value;
    }
  });
  if (!Number.isFinite(min)) min = 0;
  if (!Number.isFinite(max)) max = 1;
  return { stages, pods, cells, min, max };
}

/** Long pod names are UUID-ish; keep the trailing, distinguishing part. */
function shortPod(name: string): string {
  return name.length <= 14 ? name : `…${name.slice(-10)}`;
}

export interface PodDistributionChartProps {
  title: string;
  data: PodDistributionDatum[];
  /** Unit suffix appended to cell labels, e.g. "%" */
  unit: string;
  /** Fixed report light palette — pass REPORT_LABEL_COLORS so labels stay
   * readable on the always-light "paper" regardless of app theme. */
  labelColors: StageBarLabelColors;
  /** Color ramp: "positive" (higher=better, green) or "neutral" (blue). */
  scheme?: "positive" | "neutral";
  height?: number;
}

const RAMP = {
  positive: ["#e9f5ec", "#3fa45b"],
  neutral: ["#eaf2fb", "#4a8fd1"],
} as const;

/**
 * Heatmap: y-axis = pod, x-axis = stage, cell color = value with the exact
 * value printed in each cell. Replaces the old per-pod grouped bar chart, which
 * paginated its legend and overlapped labels once there were several pods.
 * Static cell labels keep it readable in print / PDF without hover; full pod
 * name shows on hover. Uses the fixed report light palette, not app theme.
 */
export function PodDistributionChart({
  title,
  data,
  unit,
  labelColors,
  scheme = "neutral",
  height,
}: PodDistributionChartProps): JSX.Element {
  const tokens = useChartTokens();
  const hm = useMemo(() => buildPodHeatmap(data), [data]);
  const isEmpty = hm.cells.length === 0;
  const computedHeight = Math.max(220, hm.pods.length * 34 + 120);

  const option = useMemo<EChartsOption>(() => {
    const value = labelColors.value ?? "#1f2328";
    const baseline = labelColors.baseline ?? "#59636e";
    const ramp = RAMP[scheme];

    return themed(
      {
        tooltip: {
          // Full (untruncated) pod name + stage + value; the y-axis label is
          // shortened, so the tooltip is where the whole pod id shows.
          formatter: (p: { value?: unknown }) => {
            const v = (p.value ?? []) as number[];
            const pod = hm.pods[v[1]] ?? "";
            const stage = hm.stages[v[0]] ?? "";
            return `${pod} @ ${stage}: ${(v[2] ?? 0).toFixed(1)}${unit}`;
          },
        } as EChartsOption["tooltip"],
        grid: { left: 96, right: 16, top: 12, bottom: 44 },
        xAxis: {
          type: "category",
          data: hm.stages,
          splitArea: { show: true },
          axisLabel: {
            color: value,
            fontWeight: 600,
            fontSize: 11,
            interval: 0,
            rotate: hm.stages.length > 4 ? 30 : 0,
          },
        },
        yAxis: {
          type: "category",
          data: hm.pods.map(shortPod),
          splitArea: { show: true },
          axisLabel: { color: value, fontSize: 11 },
        },
        visualMap: {
          min: hm.min,
          max: hm.max,
          calculable: false,
          orient: "horizontal",
          left: "center",
          bottom: 4,
          itemWidth: 12,
          itemHeight: 120,
          inRange: { color: [ramp[0], ramp[1]] },
          text: [`${hm.max.toFixed(0)}${unit}`, `${hm.min.toFixed(0)}${unit}`],
          textStyle: { color: baseline, fontSize: 10 },
        },
        series: [
          {
            type: "heatmap",
            data: hm.cells,
            label: {
              show: true,
              color: value,
              fontSize: 11,
              formatter: (p: { value?: unknown }) => {
                const v = (p.value ?? []) as number[];
                return typeof v[2] === "number" ? `${v[2].toFixed(0)}${unit}` : "";
              },
            },
            itemStyle: { borderColor: "#ffffff", borderWidth: 1 },
            emphasis: { itemStyle: { borderColor: value, borderWidth: 1.5 } },
          },
        ],
      },
      tokens,
    );
  }, [hm, unit, labelColors.value, labelColors.baseline, scheme, tokens]);

  return (
    <div className="rounded-md border border-border p-4">
      {title ? <div className="mb-2 text-sm font-medium">{title}</div> : null}
      <ChartFrame ariaLabel={title} height={height ?? computedHeight} empty={isEmpty}>
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
