import type { EChartsOption } from "echarts";
import { BarChart, LineChart } from "echarts/charts";
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import type { ReactNode } from "react";
import { useThemeStore } from "../../stores/theme-store";
import { applyTheme, palette } from "./theme";

echarts.use([
  LineChart,
  BarChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  DataZoomComponent,
  CanvasRenderer,
]);

export type ChartTheme = "auto" | "light" | "dark";

export function useChartDark(theme: ChartTheme = "auto"): boolean {
  const storeMode = useThemeStore((s) => s.mode);
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return (
    storeMode === "dark" ||
    (storeMode === "system" &&
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches)
  );
}

export function themed(opt: EChartsOption, dark: boolean): EChartsOption {
  return applyTheme(opt, dark);
}

export interface ChartFrameProps {
  ariaLabel: string;
  height: number | string;
  loading?: boolean;
  empty?: boolean | string;
  children: ReactNode;
}

export function ChartFrame({ ariaLabel, height, loading, empty, children }: ChartFrameProps) {
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
      // biome-ignore lint/a11y/useSemanticElements: matches existing convention in Chart.tsx
      <div
        role="status"
        aria-label={ariaLabel}
        style={{ height }}
        className="flex items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground"
      >
        {msg}
      </div>
    );
  }
  return (
    <div aria-label={ariaLabel} style={{ height }}>
      {children}
    </div>
  );
}

export interface DomainChartProps {
  ariaLabel: string;
  height?: number | string;
  loading?: boolean;
  empty?: boolean | string;
  theme?: ChartTheme;
}

/**
 * Assigns a stable round-robin color from the chart palette to each run.
 * Caller must ensure `runIds` contains no duplicates; duplicates silently
 * retain the color of the last occurrence.
 */
export function assignRunColors(runIds: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  runIds.forEach((id, i) => {
    out[id] = palette[i % palette.length];
  });
  return out;
}
