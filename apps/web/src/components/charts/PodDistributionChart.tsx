import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useMemo } from "react";
import { ChartFrame, themed, useChartTokens } from "./_shared";
import type { StageBarLabelColors } from "./StageBarChart";

export interface PodDistributionDatum {
  stage: string;
  pods: { pod: string; value: number }[];
}

export interface PodDistributionChartProps {
  title: string;
  data: PodDistributionDatum[];
  /** Unit suffix appended to static value labels, e.g. "%" */
  unit: string;
  /** Fixed report light palette — pass REPORT_LABEL_COLORS so labels stay
   * readable on the always-light "paper" regardless of app theme. */
  labelColors: StageBarLabelColors;
  height?: number;
}

/**
 * Grouped bar chart: x-axis = stage (compare bucket), one bar per pod within
 * each stage group. Static value labels (suffixed with `unit`) are rendered on
 * every bar so the chart reads correctly in print / PDF / HTML export without
 * hover. Uses the fixed report light palette — not the app's theme tokens —
 * so it stays consistent with StageBarChart in the same "paper".
 */
export function PodDistributionChart({
  title,
  data,
  unit,
  labelColors,
  height = 300,
}: PodDistributionChartProps): JSX.Element {
  const tokens = useChartTokens();
  const isEmpty = data.length === 0;

  const option = useMemo<EChartsOption>(() => {
    const lc = {
      value: labelColors.value ?? "#1f2328",
      baseline: labelColors.baseline ?? "#59636e",
    };

    // Collect all pod names across all stages (preserving first-seen order).
    const podNamesSet = new Set<string>();
    for (const datum of data) {
      for (const p of datum.pods) podNamesSet.add(p.pod);
    }
    const podNames = Array.from(podNamesSet);

    // Fixed report palette — 8 colors, cycling for pods beyond 8.
    const POD_PALETTE = [
      "hsl(98, 38%, 46%)",
      "hsl(43, 81%, 47%)",
      "hsl(190, 65%, 50%)",
      "hsl(22, 85%, 48%)",
      "hsl(4, 75%, 47%)",
      "hsl(208, 73%, 44%)",
      "hsl(308, 47%, 45%)",
      "hsl(260, 28%, 42%)",
    ] as const;

    const categories = data.map((d) => d.stage);

    // One ECharts series per pod; each series has one value per stage (x-category).
    const ecSeries = podNames.map((pod, podIdx) => {
      const values = data.map((datum) => {
        const entry = datum.pods.find((p) => p.pod === pod);
        return entry !== undefined ? entry.value : null;
      });
      const color = POD_PALETTE[podIdx % POD_PALETTE.length];
      return {
        name: pod,
        type: "bar" as const,
        data: values,
        itemStyle: { color },
        label: {
          show: true,
          position: "top" as const,
          color: lc.value,
          fontSize: 11,
          fontWeight: 500 as const,
          lineHeight: 14,
          formatter: (p: { value: unknown }) =>
            typeof p.value === "number" ? `${p.value.toFixed(1)}${unit}` : "",
        },
      };
    });

    return themed(
      {
        tooltip: {
          trigger: "axis",
          valueFormatter: (val: unknown) =>
            typeof val === "number" ? `${val.toFixed(1)}${unit}` : String(val ?? ""),
        },
        legend:
          podNames.length > 1
            ? { type: "scroll", top: 0, textStyle: { color: lc.value } }
            : undefined,
        xAxis: {
          type: "category",
          data: categories,
          axisLabel: { color: lc.value, fontWeight: 600, fontSize: 12 },
        },
        yAxis: {
          type: "value",
          max: (v: { max: number }) => (v.max > 0 ? v.max * 1.2 : 1),
          axisLabel: {
            color: lc.baseline,
            formatter: (v: number) => `${v.toFixed(0)}${unit}`,
          },
        },
        grid: {
          left: 56,
          right: 24,
          top: podNames.length > 1 ? 56 : 24,
          bottom: 32,
        },
        series: ecSeries,
      },
      tokens,
    );
  }, [data, unit, labelColors.value, labelColors.baseline, tokens]);

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
