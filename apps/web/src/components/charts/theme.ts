// ECharts theme tokens aligned to Tailwind CSS variables (oklch-based).
// Light + dark variants; `Chart` selects via `theme` prop or DOM theme.
import type { EChartsOption } from "echarts";

const palette = {
  primary: "oklch(0.62 0.19 250)",
  primary2: "oklch(0.74 0.15 165)",
  primary3: "oklch(0.7 0.16 35)",
  primary4: "oklch(0.62 0.18 305)",
  primary5: "oklch(0.7 0.13 95)",
  primary6: "oklch(0.6 0.14 200)",
  primary7: "oklch(0.55 0.15 20)",
  primary8: "oklch(0.65 0.12 130)",
};

const baseColors = Object.values(palette);

export const lightTheme = {
  color: baseColors,
  backgroundColor: "transparent",
  textStyle: { color: "rgb(15 23 42)" },
  axisPointer: { lineStyle: { color: "rgba(15,23,42,0.3)" } },
  splitLine: { lineStyle: { color: "rgba(15,23,42,0.1)" } },
};

export const darkTheme = {
  color: baseColors,
  backgroundColor: "transparent",
  textStyle: { color: "rgb(226 232 240)" },
  axisPointer: { lineStyle: { color: "rgba(226,232,240,0.3)" } },
  splitLine: { lineStyle: { color: "rgba(226,232,240,0.1)" } },
};

export function applyTheme(opt: EChartsOption, dark: boolean): EChartsOption {
  const t = dark ? darkTheme : lightTheme;
  return {
    color: t.color,
    backgroundColor: t.backgroundColor,
    textStyle: t.textStyle,
    ...opt,
  };
}
