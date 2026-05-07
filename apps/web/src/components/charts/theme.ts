// ECharts theme tokens resolved from Tailwind CSS variables.
// Palette + text/axis colors come from the active [data-palette] block.
import type { EChartsOption } from "echarts";

export interface ChartTokens {
  /** 8-color round-robin palette. */
  palette: readonly string[];
  /** Body text color for chart labels. */
  textColor: string;
  /** Axis-pointer line color (semi-transparent). */
  axisColor: string;
}

/**
 * Convert an HSL token in shadcn's space-separated form (e.g. `"240 60% 60%"`)
 * to a comma-separated CSS3 string. ECharts/zrender's color parser stumbles on
 * CSS Color Module Level 4 syntax (`hsl(240 60% 60%)` / `hsl(... / 0.4)`) under
 * the emphasis/hover state — it parses fine at render but can drop fill/stroke
 * mid-interaction, which manifested as lines vanishing while a tooltip showed.
 * Comma syntax sidesteps the parser entirely.
 */
function hslFromTokens(raw: string, alpha?: number): string {
  const parts = raw.split(/\s+/);
  if (alpha == null) return `hsl(${parts.join(", ")})`;
  return `hsla(${parts.join(", ")}, ${alpha})`;
}

/** Slate-light defaults, used when the document is not yet styled (jsdom, SSR). */
export const FALLBACK_CHART_TOKENS: ChartTokens = {
  palette: [
    "hsl(250, 60%, 55%)",
    "hsl(165, 50%, 50%)",
    "hsl(35, 75%, 55%)",
    "hsl(305, 55%, 55%)",
    "hsl(95, 45%, 55%)",
    "hsl(200, 50%, 50%)",
    "hsl(20, 60%, 50%)",
    "hsl(130, 40%, 55%)",
  ],
  textColor: "hsl(240, 10%, 3.9%)",
  axisColor: "hsla(240, 3.8%, 46.1%, 0.4)",
};

export function getChartTokens(): ChartTokens {
  if (typeof document === "undefined") return FALLBACK_CHART_TOKENS;
  const style = getComputedStyle(document.documentElement);
  const palette: string[] = [];
  for (let i = 1; i <= 8; i++) {
    const raw = style.getPropertyValue(`--chart-${i}`).trim();
    if (!raw) return FALLBACK_CHART_TOKENS;
    palette.push(hslFromTokens(raw));
  }
  const fg = style.getPropertyValue("--foreground").trim();
  const mfg = style.getPropertyValue("--muted-foreground").trim();
  return {
    palette,
    textColor: fg ? hslFromTokens(fg) : FALLBACK_CHART_TOKENS.textColor,
    axisColor: mfg ? hslFromTokens(mfg, 0.4) : FALLBACK_CHART_TOKENS.axisColor,
  };
}

export function applyTheme(opt: EChartsOption, tokens: ChartTokens): EChartsOption {
  return {
    color: tokens.palette as string[],
    backgroundColor: "transparent",
    textStyle: { color: tokens.textColor },
    axisPointer: { lineStyle: { color: tokens.axisColor } },
    ...opt,
  };
}
