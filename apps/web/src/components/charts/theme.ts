// ECharts theme tokens resolved from Tailwind CSS variables.
// Palette + text/axis colors come from the active :root / .dark block.
import type { EChartsOption } from "echarts";

export interface ChartTokens {
  /** 8-color round-robin palette. */
  palette: readonly string[];
  /** Body text color for chart labels. */
  textColor: string;
  /** Axis-line color (the literal axis baseline + axis-pointer crosshair). */
  axisColor: string;
  /** Axis tick-label color — readable but slightly muted vs body text. */
  axisLabelColor: string;
  /** Horizontal/vertical splitLine color — subtle, Grafana-like. */
  gridLineColor: string;
  /** Tooltip card background — slight elevation from --card. */
  tooltipBg: string;
  /** Tooltip border color — matches --border. */
  tooltipBorder: string;
  /** Tooltip body text — high contrast, matches --foreground. */
  tooltipText: string;
  /** Fill color for `markArea` overlays (e.g., benchmark-window shading). */
  markAreaColor: string;
  /** Border color (dashed) for `markArea` overlays — same hue, ~3× opacity. */
  markAreaBorderColor: string;
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

/** Grafana-classic-light fallback, used when the document is not yet styled
 * (jsdom, SSR). Mirrors --chart-* tokens in the :root block of globals.css. */
export const FALLBACK_CHART_TOKENS: ChartTokens = {
  palette: [
    "hsl(98, 38%, 46%)",
    "hsl(43, 81%, 47%)",
    "hsl(190, 65%, 50%)",
    "hsl(22, 85%, 48%)",
    "hsl(4, 75%, 47%)",
    "hsl(208, 73%, 44%)",
    "hsl(308, 47%, 45%)",
    "hsl(260, 28%, 42%)",
  ],
  textColor: "hsl(220, 13%, 9%)",
  axisColor: "hsla(220, 9%, 46%, 0.4)",
  axisLabelColor: "hsla(220, 13%, 9%, 0.92)",
  gridLineColor: "hsla(220, 13%, 9%, 0.12)",
  tooltipBg: "hsl(0, 0%, 100%)",
  tooltipBorder: "hsl(220, 13%, 91%)",
  tooltipText: "hsl(220, 13%, 9%)",
  markAreaColor: "hsla(220, 9%, 46%, 0.18)",
  markAreaBorderColor: "hsla(220, 9%, 46%, 0.55)",
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
  const popover = style.getPropertyValue("--popover").trim();
  const popoverFg = style.getPropertyValue("--popover-foreground").trim();
  const border = style.getPropertyValue("--border").trim();
  return {
    palette,
    textColor: fg ? hslFromTokens(fg) : FALLBACK_CHART_TOKENS.textColor,
    axisColor: mfg ? hslFromTokens(mfg, 0.4) : FALLBACK_CHART_TOKENS.axisColor,
    // Axis labels (tick numbers, time stamps) — Grafana uses ~92% opacity
    // (rgba(204,204,220,0.92)) so labels are clearly readable but slightly
    // recessed vs body text.
    axisLabelColor: fg ? hslFromTokens(fg, 0.92) : FALLBACK_CHART_TOKENS.axisLabelColor,
    // Horizontal/vertical grid lines — Grafana ~12% opacity so they're
    // visible enough to anchor the eye but stay behind series lines.
    gridLineColor: fg ? hslFromTokens(fg, 0.12) : FALLBACK_CHART_TOKENS.gridLineColor,
    tooltipBg: popover ? hslFromTokens(popover) : FALLBACK_CHART_TOKENS.tooltipBg,
    tooltipBorder: border ? hslFromTokens(border) : FALLBACK_CHART_TOKENS.tooltipBorder,
    tooltipText: popoverFg ? hslFromTokens(popoverFg) : FALLBACK_CHART_TOKENS.tooltipText,
    markAreaColor: mfg ? hslFromTokens(mfg, 0.18) : FALLBACK_CHART_TOKENS.markAreaColor,
    markAreaBorderColor: mfg ? hslFromTokens(mfg, 0.55) : FALLBACK_CHART_TOKENS.markAreaBorderColor,
  };
}

/**
 * Inject Grafana-style axis defaults into a single axis option object. Each
 * property is shallow-merged so chart-specific overrides win — the user's
 * `axisLabel.formatter`, `axisLine.show: false` etc. are preserved.
 */
function withAxisDefaults(
  axis: Record<string, unknown> | undefined,
  tokens: ChartTokens,
): Record<string, unknown> {
  const a: Record<string, unknown> = { ...(axis ?? {}) };
  const axisLine = (a.axisLine ?? {}) as Record<string, unknown>;
  a.axisLine = {
    ...axisLine,
    lineStyle: {
      color: tokens.axisColor,
      ...((axisLine.lineStyle ?? {}) as Record<string, unknown>),
    },
  };
  a.axisLabel = {
    color: tokens.axisLabelColor,
    ...((a.axisLabel ?? {}) as Record<string, unknown>),
  };
  const splitLine = (a.splitLine ?? {}) as Record<string, unknown>;
  a.splitLine = {
    show: true,
    ...splitLine,
    lineStyle: {
      color: tokens.gridLineColor,
      type: "solid",
      ...((splitLine.lineStyle ?? {}) as Record<string, unknown>),
    },
  };
  return a;
}

function withAxis<T>(axis: T, tokens: ChartTokens): T {
  if (axis == null) return axis;
  if (Array.isArray(axis)) {
    return axis.map((a) => withAxisDefaults(a as Record<string, unknown>, tokens)) as unknown as T;
  }
  return withAxisDefaults(axis as Record<string, unknown>, tokens) as unknown as T;
}

export function applyTheme(opt: EChartsOption, tokens: ChartTokens): EChartsOption {
  // Merge tooltip first so chart-specific tooltip props (formatter, trigger,
  // valueFormatter) win over our defaults.
  const userTooltip = (opt.tooltip ?? {}) as Record<string, unknown>;
  const tooltip = {
    backgroundColor: tokens.tooltipBg,
    borderColor: tokens.tooltipBorder,
    borderWidth: 1,
    textStyle: {
      color: tokens.tooltipText,
      ...((userTooltip.textStyle ?? {}) as Record<string, unknown>),
    },
    extraCssText: "box-shadow: 0 4px 12px rgba(0,0,0,0.18); border-radius: 6px; padding: 8px 12px;",
    ...userTooltip,
  };

  const result: EChartsOption = {
    color: tokens.palette as string[],
    backgroundColor: "transparent",
    textStyle: { color: tokens.textColor },
    axisPointer: { lineStyle: { color: tokens.axisColor } },
    ...opt,
    tooltip: tooltip as EChartsOption["tooltip"],
  };

  if (result.xAxis !== undefined) result.xAxis = withAxis(result.xAxis, tokens);
  if (result.yAxis !== undefined) result.yAxis = withAxis(result.yAxis, tokens);

  return result;
}
