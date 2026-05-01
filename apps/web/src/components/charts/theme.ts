// ECharts theme tokens aligned to Tailwind CSS variables (oklch-based).
// Light + dark variants; `Chart` selects via `theme` prop or DOM theme.
import type { EChartsOption } from "echarts";

export const palette: readonly string[] = [
  "oklch(0.62 0.19 250)",
  "oklch(0.74 0.15 165)",
  "oklch(0.7 0.16 35)",
  "oklch(0.62 0.18 305)",
  "oklch(0.7 0.13 95)",
  "oklch(0.6 0.14 200)",
  "oklch(0.55 0.15 20)",
  "oklch(0.65 0.12 130)",
];

const baseColors = [...palette];

export const lightTheme = {
  color: baseColors,
  backgroundColor: "transparent",
  textStyle: { color: "rgb(15 23 42)" },
  axisPointer: { lineStyle: { color: "rgba(15,23,42,0.3)" } },
};

export const darkTheme = {
  color: baseColors,
  backgroundColor: "transparent",
  textStyle: { color: "rgb(226 232 240)" },
  axisPointer: { lineStyle: { color: "rgba(226,232,240,0.3)" } },
};

export function applyTheme(opt: EChartsOption, dark: boolean): EChartsOption {
  const t = dark ? darkTheme : lightTheme;
  return {
    color: t.color,
    backgroundColor: t.backgroundColor,
    textStyle: t.textStyle,
    axisPointer: t.axisPointer,
    ...opt,
  };
}
