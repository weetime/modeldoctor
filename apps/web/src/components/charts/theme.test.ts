import { afterEach, describe, expect, it } from "vitest";
import { FALLBACK_CHART_TOKENS, getChartTokens } from "./theme";

const STYLE_ID = "test-chart-tokens";

function setVars(vars: Record<string, string>): void {
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  const body = Object.entries(vars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n");
  style.textContent = `:root {\n${body}\n}`;
}

describe("getChartTokens", () => {
  afterEach(() => {
    document.getElementById(STYLE_ID)?.remove();
  });

  it("falls back when no chart vars are defined", () => {
    const t = getChartTokens();
    expect(t.palette).toEqual(FALLBACK_CHART_TOKENS.palette);
    expect(t.textColor).toBe(FALLBACK_CHART_TOKENS.textColor);
  });

  it("reads --chart-1..8 from the document root", () => {
    setVars({
      "--chart-1": "240 60% 60%",
      "--chart-2": "165 50% 50%",
      "--chart-3": "35 75% 55%",
      "--chart-4": "305 55% 55%",
      "--chart-5": "95 45% 55%",
      "--chart-6": "200 50% 50%",
      "--chart-7": "20 60% 50%",
      "--chart-8": "130 40% 55%",
      "--foreground": "240 10% 3.9%",
      "--muted-foreground": "240 3.8% 46.1%",
    });
    const t = getChartTokens();
    expect(t.palette).toHaveLength(8);
    expect(t.palette[0]).toBe("hsl(240, 60%, 60%)");
    expect(t.palette[7]).toBe("hsl(130, 40%, 55%)");
    expect(t.textColor).toBe("hsl(240, 10%, 3.9%)");
    expect(t.axisColor).toBe("hsla(240, 3.8%, 46.1%, 0.4)");
  });

  it("falls back wholly when even one chart var is missing", () => {
    setVars({
      "--chart-1": "240 60% 60%",
      // --chart-2..8 missing
    });
    const t = getChartTokens();
    expect(t.palette).toEqual(FALLBACK_CHART_TOKENS.palette);
  });
});
