# Multi-palette Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 5 first-class visual palettes (Slate / Aurora / Indigo / Plum / Clay) — each with light + dark — with a two-section dropdown toggle, palette-aware ECharts colors, and zero visual change for users who keep the default.

**Architecture:** Two independent dimensions on `<html>`: `data-palette="<name>"` × `class="dark"`. CSS variables defined per `[data-palette="<name>"]` and `[data-palette="<name>"].dark` selectors. Zustand store gains a `palette` field beside the existing `mode`. Chart tokens (palette + text/axis colors) read from CSS vars at render time and re-compute when palette or mode changes.

**Tech Stack:** Vite + React + Tailwind v3 (`hsl(var(--…))` tokens) + zustand-persist + shadcn/ui dropdown + ECharts 5 + Vitest 2 (jsdom) + Playwright.

**Spec:** `docs/superpowers/specs/2026-05-07-multi-palette-theme-design.md`

---

## File Structure

| File                                                             | Status   | Responsibility                                                                                |
| ---------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------- |
| `apps/web/src/stores/theme-store.ts`                             | modify   | Add `palette` field, `setPalette`, dataset write; reset/rehydrate cover both axes.            |
| `apps/web/src/stores/theme-store.test.ts`                        | modify   | Add tests for palette field, setPalette dataset side-effect, reset, rehydration default.     |
| `apps/web/src/styles/globals.css`                                | modify   | Rename `:root` / `.dark` to slate-scoped; add `--chart-1..8` to slate; add 4 new palettes.    |
| `apps/web/src/components/charts/theme.ts`                        | modify   | Replace const `palette` array with `getChartTokens()` reading CSS vars; keep `applyTheme`.    |
| `apps/web/src/components/charts/theme.test.ts`                   | create   | Cover `getChartTokens()`: reads from CSS vars, falls back when missing, returns 8 colors.    |
| `apps/web/src/components/charts/_shared.tsx`                     | modify   | Add `useChartTokens()`; `assignRunColors` accepts explicit palette arg.                       |
| `apps/web/src/components/charts/_shared.test.tsx`                | modify   | Update `assignRunColors` callers to pass explicit palette stub.                               |
| `apps/web/src/features/dev-charts/DevChartsPage.tsx`             | modify   | Resolve palette via `useChartTokens()` and pass to `assignRunColors`.                         |
| `apps/web/src/components/charts/Chart.tsx`                       | modify   | Use `useChartTokens()`; pass tokens into `applyTheme` instead of relying on built-in const.   |
| `apps/web/src/components/common/theme-toggle.tsx`                | modify   | Two-section dropdown: Appearance + Palette (with color swatches).                             |
| `apps/web/src/main.tsx`                                          | modify   | Set `document.documentElement.dataset.palette` from store before first render.                |
| `apps/web/src/locales/zh-CN/common.json`                         | modify   | Add `theme.appearance` + `theme.palette.{title,slate,aurora,indigo,plum,clay}`.               |
| `apps/web/src/locales/en-US/common.json`                         | modify   | English equivalents for new keys.                                                             |
| `e2e/theme-palette.spec.ts`                                      | create   | Playwright smoke: 5 palettes × 2 modes — assert `<html>` attrs + take screenshots.            |

---

## Task 1: Extend theme-store with `palette` dimension

**Files:**
- Modify: `apps/web/src/stores/theme-store.ts`
- Test:   `apps/web/src/stores/theme-store.test.ts`

- [ ] **Step 1.1 — Replace the test file with the new full contents**

Overwrite `apps/web/src/stores/theme-store.test.ts` entirely with:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { useThemeStore } from "./theme-store";

describe("themeStore", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
    document.documentElement.dataset.palette = "";
    useThemeStore.setState({ mode: "system", palette: "slate" });
  });

  it("defaults to system mode", () => {
    expect(useThemeStore.getState().mode).toBe("system");
  });

  it("setMode('dark') adds the .dark class to <html>", () => {
    useThemeStore.getState().setMode("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("setMode('light') removes the .dark class", () => {
    document.documentElement.classList.add("dark");
    useThemeStore.getState().setMode("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("setMode('system') follows prefers-color-scheme", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (q: string) => ({
        matches: q.includes("dark"),
        media: q,
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
      }),
    });
    useThemeStore.getState().setMode("system");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("defaults to slate palette", () => {
    expect(useThemeStore.getState().palette).toBe("slate");
  });

  it("setPalette('aurora') writes data-palette='aurora' on <html>", () => {
    useThemeStore.getState().setPalette("aurora");
    expect(document.documentElement.dataset.palette).toBe("aurora");
    expect(useThemeStore.getState().palette).toBe("aurora");
  });

  it("setPalette is independent of mode", () => {
    useThemeStore.getState().setMode("dark");
    useThemeStore.getState().setPalette("plum");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.dataset.palette).toBe("plum");
  });

  it("reset() restores mode=system AND palette=slate", () => {
    useThemeStore.getState().setMode("dark");
    useThemeStore.getState().setPalette("clay");
    useThemeStore.getState().reset();
    expect(useThemeStore.getState().mode).toBe("system");
    expect(useThemeStore.getState().palette).toBe("slate");
    expect(document.documentElement.dataset.palette).toBe("slate");
  });

  it("rehydrates legacy {mode} payload with default palette=slate", async () => {
    localStorage.setItem(
      "md.theme.v1",
      JSON.stringify({ state: { mode: "dark" }, version: 0 }),
    );
    await useThemeStore.persist.rehydrate();
    expect(useThemeStore.getState().palette).toBe("slate");
    expect(document.documentElement.dataset.palette).toBe("slate");
  });
});
```

- [ ] **Step 1.2 — Run tests to verify they fail**

```bash
pnpm -F @modeldoctor/web test src/stores/theme-store.test.ts --run
```

Expected: failures because `palette`, `setPalette`, the new `reset()` semantics, and the dataset assignments don't exist yet.

- [ ] **Step 1.3 — Implement palette in the store**

Replace the entire body of `apps/web/src/stores/theme-store.ts` with:

```ts
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeMode = "light" | "dark" | "system";
export type Palette = "slate" | "aurora" | "indigo" | "plum" | "clay";

export const PALETTES: readonly Palette[] = ["slate", "aurora", "indigo", "plum", "clay"];

interface ThemeStore {
  mode: ThemeMode;
  palette: Palette;
  setMode: (mode: ThemeMode) => void;
  setPalette: (palette: Palette) => void;
  /** Revert mode to "system" and palette to "slate", and update the DOM. */
  reset: () => void;
}

function applyMode(mode: ThemeMode): void {
  if (typeof document === "undefined") return;
  const isDark =
    mode === "dark" ||
    (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", isDark);
}

function applyPalette(palette: Palette): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.palette = palette;
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set) => ({
      mode: "system",
      palette: "slate",
      setMode: (mode) => {
        applyMode(mode);
        set({ mode });
      },
      setPalette: (palette) => {
        applyPalette(palette);
        set({ palette });
      },
      reset: () => {
        applyMode("system");
        applyPalette("slate");
        set({ mode: "system", palette: "slate" });
      },
    }),
    {
      name: "md.theme.v1",
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        applyMode(state.mode);
        // `palette` may be undefined for users hydrating a pre-multi-palette payload;
        // fall back to the default and persist it on next write.
        applyPalette(state.palette ?? "slate");
      },
    },
  ),
);
```

- [ ] **Step 1.4 — Run tests to verify they pass**

```bash
pnpm -F @modeldoctor/web test src/stores/theme-store.test.ts --run
```

Expected: all 9 tests pass (4 existing + 5 new).

- [ ] **Step 1.5 — Commit**

```bash
git add apps/web/src/stores/theme-store.ts apps/web/src/stores/theme-store.test.ts
git commit -m "$(cat <<'EOF'
feat(web/theme): add palette dimension to theme store

Palette is a second axis independent of light/dark mode. Defaults to
slate (= current behavior). Legacy {mode}-only persisted state hydrates
to palette=slate so existing users see no change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Slate-scope existing CSS variables + add chart channels

**Files:**
- Modify: `apps/web/src/styles/globals.css`

This task contains no behavior change beyond moving the existing `:root` block under `[data-palette="slate"]` and `[data-palette="slate"].dark`, plus adding 8 chart channels for the slate palette so charts gain a CSS-driven palette source. The `<html>` already gets `data-palette="slate"` set by Task 1 on rehydrate; for first-paint coverage, we add the attribute statically in Task 7. There is no automated test in this task — the visual-no-change check is manual.

- [ ] **Step 2.1 — Replace the `@layer base` block in `globals.css`**

Replace the entire `@layer base { :root { … } .dark { … } * { @apply border-border; } body { … } }` block with the following. The chart values are HSL components (no `hsl()` wrapper) to match the rest of the file; charts will compose them as `hsl(var(--chart-N))` at read time.

```css
@layer base {
  /* -------- Slate (default) -------- */
  [data-palette="slate"] {
    --background: 0 0% 100%;
    --foreground: 240 10% 3.9%;
    --card: 0 0% 100%;
    --card-foreground: 240 10% 3.9%;
    --popover: 0 0% 100%;
    --popover-foreground: 240 10% 3.9%;
    --primary: 240 5.9% 10%;
    --primary-foreground: 0 0% 98%;
    --secondary: 240 4.8% 95.9%;
    --secondary-foreground: 240 5.9% 10%;
    --muted: 240 4.8% 95.9%;
    --muted-foreground: 240 3.8% 46.1%;
    --accent: 240 4.8% 95.9%;
    --accent-foreground: 240 5.9% 10%;
    --destructive: 0 72% 50%;
    --destructive-foreground: 0 0% 98%;
    --border: 240 5.9% 90%;
    --input: 240 5.9% 90%;
    --ring: 240 5% 64.9%;
    --success: 142 72% 35%;
    --warning: 38 92% 50%;
    --radius: 0.5rem;

    --chart-1: 250 60% 55%;
    --chart-2: 165 50% 50%;
    --chart-3: 35 75% 55%;
    --chart-4: 305 55% 55%;
    --chart-5: 95 45% 55%;
    --chart-6: 200 50% 50%;
    --chart-7: 20 60% 50%;
    --chart-8: 130 40% 55%;
  }

  [data-palette="slate"].dark {
    --background: 240 6% 8%;
    --foreground: 0 0% 98%;
    --card: 240 6% 10%;
    --card-foreground: 0 0% 98%;
    --popover: 240 6% 10%;
    --popover-foreground: 0 0% 98%;
    --primary: 0 0% 98%;
    --primary-foreground: 240 5.9% 10%;
    --secondary: 240 3.7% 15.9%;
    --secondary-foreground: 0 0% 98%;
    --muted: 240 3.7% 15.9%;
    --muted-foreground: 240 5% 64.9%;
    --accent: 240 3.7% 15.9%;
    --accent-foreground: 0 0% 98%;
    --destructive: 0 62.8% 45%;
    --destructive-foreground: 0 0% 98%;
    --border: 240 3.7% 15.9%;
    --input: 240 3.7% 15.9%;
    --ring: 240 4.9% 63.9%;
    --success: 142 70% 45%;
    --warning: 38 92% 55%;

    --chart-1: 250 70% 65%;
    --chart-2: 165 55% 55%;
    --chart-3: 35 85% 60%;
    --chart-4: 305 60% 65%;
    --chart-5: 95 50% 60%;
    --chart-6: 200 60% 55%;
    --chart-7: 20 70% 60%;
    --chart-8: 130 50% 60%;
  }

  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground font-sans antialiased;
    font-feature-settings: "cv11", "ss01";
  }
  code,
  pre {
    @apply font-mono;
  }
}
```

- [ ] **Step 2.2 — Add the static default attribute to `index.html`**

Open `apps/web/index.html` and change `<html lang="…">` (or `<html>`) to:

```html
<html lang="en" data-palette="slate">
```

This guarantees first-paint correctness even before the JS bundle runs. Task 7 will keep this in sync with rehydrated state.

- [ ] **Step 2.3 — Verify dev server boots and rendering is unchanged**

```bash
pnpm -F @modeldoctor/web dev
```

Manually open the app, confirm visuals look identical to before. Toggle dark/light, confirm no regression. Stop the dev server.

- [ ] **Step 2.4 — Run web unit tests**

```bash
pnpm -F @modeldoctor/web test --run
```

Expected: all green. Tasks 3–4 will adapt chart tests; for now everything that doesn't depend on `--chart-*` should still pass.

- [ ] **Step 2.5 — Commit**

```bash
git add apps/web/src/styles/globals.css apps/web/index.html
git commit -m "$(cat <<'EOF'
refactor(web/theme): scope default tokens to [data-palette="slate"]

Equivalent rename of :root / .dark selectors to slate-scoped variants,
plus eight --chart-1..8 channels matching the existing hard-coded
ECharts palette. <html data-palette="slate"> in index.html keeps
first-paint correct before the JS bundle runs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Chart token resolver reads from CSS vars

**Files:**
- Modify: `apps/web/src/components/charts/theme.ts`
- Test:   `apps/web/src/components/charts/theme.test.ts` (create)

- [ ] **Step 3.1 — Write failing tests for `getChartTokens()`**

Create `apps/web/src/components/charts/theme.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
    expect(t.palette[0]).toBe("hsl(240 60% 60%)");
    expect(t.palette[7]).toBe("hsl(130 40% 55%)");
    expect(t.textColor).toBe("hsl(240 10% 3.9%)");
    expect(t.axisColor).toBe("hsl(240 3.8% 46.1% / 0.4)");
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
```

- [ ] **Step 3.2 — Run tests to verify failure**

```bash
pnpm -F @modeldoctor/web test src/components/charts/theme.test.ts --run
```

Expected: import error / missing exports.

- [ ] **Step 3.3 — Rewrite `theme.ts` with the new resolver**

Replace `apps/web/src/components/charts/theme.ts` with:

```ts
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

/** Slate-light defaults, used when the document is not yet styled (jsdom, SSR). */
export const FALLBACK_CHART_TOKENS: ChartTokens = {
  palette: [
    "hsl(250 60% 55%)",
    "hsl(165 50% 50%)",
    "hsl(35 75% 55%)",
    "hsl(305 55% 55%)",
    "hsl(95 45% 55%)",
    "hsl(200 50% 50%)",
    "hsl(20 60% 50%)",
    "hsl(130 40% 55%)",
  ],
  textColor: "hsl(240 10% 3.9%)",
  axisColor: "hsl(240 3.8% 46.1% / 0.4)",
};

export function getChartTokens(): ChartTokens {
  if (typeof document === "undefined") return FALLBACK_CHART_TOKENS;
  const style = getComputedStyle(document.documentElement);
  const palette: string[] = [];
  for (let i = 1; i <= 8; i++) {
    const raw = style.getPropertyValue(`--chart-${i}`).trim();
    if (!raw) return FALLBACK_CHART_TOKENS;
    palette.push(`hsl(${raw})`);
  }
  const fg = style.getPropertyValue("--foreground").trim();
  const mfg = style.getPropertyValue("--muted-foreground").trim();
  return {
    palette,
    textColor: fg ? `hsl(${fg})` : FALLBACK_CHART_TOKENS.textColor,
    axisColor: mfg ? `hsl(${mfg} / 0.4)` : FALLBACK_CHART_TOKENS.axisColor,
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
```

- [ ] **Step 3.4 — Run tests to verify pass**

```bash
pnpm -F @modeldoctor/web test src/components/charts/theme.test.ts --run
```

Expected: 3 tests pass.

- [ ] **Step 3.5 — Commit**

```bash
git add apps/web/src/components/charts/theme.ts apps/web/src/components/charts/theme.test.ts
git commit -m "$(cat <<'EOF'
refactor(web/charts): resolve ECharts tokens from CSS variables

getChartTokens() reads --chart-1..8, --foreground, --muted-foreground
from the document root, with a slate-light fallback for jsdom / SSR.
applyTheme now takes resolved tokens instead of a dark boolean — call
sites updated in the next task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Plumb chart tokens through `_shared.tsx` + consumers

**Files:**
- Modify: `apps/web/src/components/charts/_shared.tsx`
- Modify: `apps/web/src/components/charts/_shared.test.tsx`
- Modify: `apps/web/src/components/charts/Chart.tsx`
- Modify: `apps/web/src/features/dev-charts/DevChartsPage.tsx`

The `palette` const is gone after Task 3. `assignRunColors` and `applyTheme` (via `themed`) need an explicit palette/tokens arg, plumbed via a `useChartTokens()` hook that subscribes to the theme store.

- [ ] **Step 4.1 — Update `_shared.test.tsx` to the new `assignRunColors` signature**

Open `apps/web/src/components/charts/_shared.test.tsx` and replace its body with:

```tsx
import { describe, expect, it } from "vitest";
import { assignRunColors } from "./_shared";

const PALETTE = ["c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7"];

describe("assignRunColors", () => {
  it("returns empty map for empty input", () => {
    expect(assignRunColors([], PALETTE)).toEqual({});
  });

  it("assigns one color per runId in input order", () => {
    const m = assignRunColors(["a", "b", "c"], PALETTE);
    expect(Object.keys(m)).toEqual(["a", "b", "c"]);
    expect(m.a).toBe("c0");
    expect(m.b).toBe("c1");
    expect(m.c).toBe("c2");
  });

  it("is stable for identical input", () => {
    expect(assignRunColors(["x", "y"], PALETTE)).toEqual(assignRunColors(["x", "y"], PALETTE));
  });

  it("wraps around the 8-color palette when given more than 8 runs", () => {
    const ids = Array.from({ length: 10 }, (_, i) => `r${i}`);
    const m = assignRunColors(ids, PALETTE);
    expect(m.r0).toBe(m.r8);
    expect(m.r1).toBe(m.r9);
  });

  it("allocates by position, not by id content", () => {
    const m1 = assignRunColors(["alice", "bob"], PALETTE);
    const m2 = assignRunColors(["charlie", "alice"], PALETTE);
    expect(m1.alice).not.toBe(m2.alice);
    expect(m2.charlie).toBe(m1.alice);
  });
});
```

- [ ] **Step 4.2 — Run the test to verify failure**

```bash
pnpm -F @modeldoctor/web test src/components/charts/_shared.test.tsx --run
```

Expected: type error — `assignRunColors` doesn't accept 2 args yet.

- [ ] **Step 4.3 — Update `_shared.tsx`**

Replace `apps/web/src/components/charts/_shared.tsx` with:

```tsx
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
import { useMemo, type ReactNode } from "react";
import { useThemeStore } from "../../stores/theme-store";
import { applyTheme, getChartTokens, type ChartTokens } from "./theme";

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

/**
 * Resolve chart palette + text/axis colors from the active palette+mode.
 * Re-runs when either dimension changes so charts re-render with new colors.
 */
export function useChartTokens(): ChartTokens {
  const palette = useThemeStore((s) => s.palette);
  const mode = useThemeStore((s) => s.mode);
  // biome-ignore lint/correctness/useExhaustiveDependencies: getChartTokens reads CSS, deps trigger recompute when active palette/mode changes
  return useMemo(() => getChartTokens(), [palette, mode]);
}

export function themed(opt: EChartsOption, tokens: ChartTokens): EChartsOption {
  return applyTheme(opt, tokens);
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
export function assignRunColors(
  runIds: readonly string[],
  palette: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  runIds.forEach((id, i) => {
    out[id] = palette[i % palette.length];
  });
  return out;
}
```

- [ ] **Step 4.4 — Update `Chart.tsx` to use tokens**

Open `apps/web/src/components/charts/Chart.tsx`. Replace the `applyTheme` import + the `applyTheme(...)` call inside the render path so it uses tokens. Concretely:

1. Replace the import line `import { applyTheme } from "./theme";` with:

   ```ts
   import { useChartTokens } from "./_shared";
   ```

2. Inside the function component (near where `theme` / `dark` are computed, around the existing line 137 region), add right after `const { kind, data, options, theme = "auto", height = 360, loading, empty, ariaLabel } = props;`:

   ```ts
   const tokens = useChartTokens();
   ```

3. Find any call site that previously passed `(opt, dark)` to `applyTheme` and change it to `applyTheme(opt, tokens)`. (If `Chart.tsx` doesn't directly call `applyTheme` — only `themed` from `_shared.tsx` — skip step 3 and keep using `themed(opt, tokens)` instead.)

If your editor flags `useChartDark` as unused after this, remove the import; otherwise keep it (still used for selecting ECharts' built-in `"dark"` theme registration string).

- [ ] **Step 4.5 — Update `DevChartsPage.tsx`**

Open `apps/web/src/features/dev-charts/DevChartsPage.tsx`. Find lines around 31–32:

```ts
const colorMap = useMemo(() => assignRunColors(RUN_ID_LIST), []);
const largeColorMap = useMemo(() => assignRunColors(["large"]), []);
```

Replace with:

```ts
const tokens = useChartTokens();
const colorMap = useMemo(() => assignRunColors(RUN_ID_LIST, tokens.palette), [tokens]);
const largeColorMap = useMemo(() => assignRunColors(["large"], tokens.palette), [tokens]);
```

Add `useChartTokens` to the import from `@/components/charts` (or wherever `assignRunColors` is currently imported). If `useChartTokens` is not re-exported from the charts barrel `apps/web/src/components/charts/index.ts`, add a re-export:

```ts
export { assignRunColors, useChartTokens } from "./_shared";
```

- [ ] **Step 4.6 — Run web tests**

```bash
pnpm -F @modeldoctor/web test --run
```

Expected: all green. The two test files that mock `assignRunColors: () => ({})` (in `BenchmarkDetailPage.test.tsx` and `BenchmarkChartsSection.test.tsx`) keep working — return type is unchanged.

- [ ] **Step 4.7 — Build the web app to check types**

```bash
pnpm -F @modeldoctor/web build
```

Expected: success, no TypeScript errors.

- [ ] **Step 4.8 — Commit**

```bash
git add apps/web/src/components/charts/_shared.tsx \
        apps/web/src/components/charts/_shared.test.tsx \
        apps/web/src/components/charts/Chart.tsx \
        apps/web/src/components/charts/index.ts \
        apps/web/src/features/dev-charts/DevChartsPage.tsx
git commit -m "$(cat <<'EOF'
feat(web/charts): subscribe charts to active palette + mode

useChartTokens() resolves palette/text/axis colors from the active
[data-palette] block and recomputes on theme-store changes. Threading
tokens through assignRunColors makes chart colors switch live when the
user changes palette without remounting any chart.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Add Aurora + Indigo + Plum + Clay palette tokens

**Files:**
- Modify: `apps/web/src/styles/globals.css`

Single commit adds all four new palettes. Each palette's tokens come straight from the spec's reference table. No tests in this task — visual checks come in Task 9.

- [ ] **Step 5.1 — Append the four palette blocks to `globals.css`**

Inside `@layer base { … }`, after the slate `[data-palette="slate"].dark { … }` block but before the `* { @apply border-border; }` line, append the following 8 selectors (4 palettes × light/dark):

```css
  /* -------- Aurora (Vercel/Linear) -------- */
  [data-palette="aurora"] {
    --background: 0 0% 100%;
    --foreground: 0 0% 4%;
    --card: 0 0% 100%;
    --card-foreground: 0 0% 4%;
    --popover: 0 0% 100%;
    --popover-foreground: 0 0% 4%;
    --primary: 240 60% 60%;
    --primary-foreground: 0 0% 100%;
    --secondary: 0 0% 98%;
    --secondary-foreground: 0 0% 4%;
    --muted: 0 0% 98%;
    --muted-foreground: 0 0% 45%;
    --accent: 240 4% 96%;
    --accent-foreground: 0 0% 4%;
    --destructive: 0 72% 50%;
    --destructive-foreground: 0 0% 98%;
    --border: 0 0% 92%;
    --input: 0 0% 92%;
    --ring: 240 60% 60%;
    --success: 142 72% 35%;
    --warning: 38 92% 50%;
    --radius: 0.5rem;

    --chart-1: 240 60% 60%;
    --chart-2: 252 95% 76%;
    --chart-3: 188 91% 43%;
    --chart-4: 158 64% 40%;
    --chart-5: 38 92% 50%;
    --chart-6: 330 81% 60%;
    --chart-7: 239 84% 67%;
    --chart-8: 262 83% 58%;
  }

  [data-palette="aurora"].dark {
    --background: 0 0% 4%;
    --foreground: 0 0% 98%;
    --card: 240 4% 7%;
    --card-foreground: 0 0% 98%;
    --popover: 240 4% 7%;
    --popover-foreground: 0 0% 98%;
    --primary: 240 100% 77%;
    --primary-foreground: 240 6% 10%;
    --secondary: 240 6% 11%;
    --secondary-foreground: 0 0% 98%;
    --muted: 240 6% 11%;
    --muted-foreground: 240 5% 64%;
    --accent: 252 95% 76%;
    --accent-foreground: 0 0% 98%;
    --destructive: 0 62% 45%;
    --destructive-foreground: 0 0% 98%;
    --border: 240 6% 13%;
    --input: 240 6% 13%;
    --ring: 240 100% 77%;
    --success: 142 70% 45%;
    --warning: 38 92% 55%;

    --chart-1: 240 100% 77%;
    --chart-2: 252 95% 76%;
    --chart-3: 188 91% 53%;
    --chart-4: 158 64% 50%;
    --chart-5: 38 92% 60%;
    --chart-6: 330 81% 70%;
    --chart-7: 239 84% 75%;
    --chart-8: 262 83% 70%;
  }

  /* -------- Indigo (Stripe) -------- */
  [data-palette="indigo"] {
    --background: 60 14% 98%;
    --foreground: 226 36% 16%;
    --card: 0 0% 100%;
    --card-foreground: 226 36% 16%;
    --popover: 0 0% 100%;
    --popover-foreground: 226 36% 16%;
    --primary: 244 100% 68%;
    --primary-foreground: 0 0% 100%;
    --secondary: 213 38% 98%;
    --secondary-foreground: 226 36% 16%;
    --muted: 213 38% 98%;
    --muted-foreground: 218 13% 47%;
    --accent: 248 100% 97%;
    --accent-foreground: 244 100% 68%;
    --destructive: 0 72% 50%;
    --destructive-foreground: 0 0% 100%;
    --border: 215 22% 91%;
    --input: 215 22% 91%;
    --ring: 244 100% 68%;
    --success: 142 72% 35%;
    --warning: 38 92% 50%;
    --radius: 0.5rem;

    --chart-1: 244 100% 68%;
    --chart-2: 188 100% 50%;
    --chart-3: 158 64% 40%;
    --chart-4: 38 92% 50%;
    --chart-5: 0 72% 50%;
    --chart-6: 262 83% 58%;
    --chart-7: 45 96% 56%;
    --chart-8: 218 100% 60%;
  }

  [data-palette="indigo"].dark {
    --background: 213 65% 11%;
    --foreground: 215 33% 97%;
    --card: 213 56% 16%;
    --card-foreground: 215 33% 97%;
    --popover: 213 56% 16%;
    --popover-foreground: 215 33% 97%;
    --primary: 244 100% 73%;
    --primary-foreground: 213 65% 11%;
    --secondary: 217 49% 21%;
    --secondary-foreground: 215 33% 97%;
    --muted: 217 49% 21%;
    --muted-foreground: 217 21% 62%;
    --accent: 188 100% 50%;
    --accent-foreground: 213 65% 11%;
    --destructive: 0 62% 50%;
    --destructive-foreground: 0 0% 100%;
    --border: 215 50% 25%;
    --input: 215 50% 25%;
    --ring: 244 100% 73%;
    --success: 142 70% 45%;
    --warning: 38 92% 55%;

    --chart-1: 244 100% 73%;
    --chart-2: 188 100% 60%;
    --chart-3: 158 64% 50%;
    --chart-4: 38 92% 60%;
    --chart-5: 0 72% 60%;
    --chart-6: 262 83% 70%;
    --chart-7: 45 96% 66%;
    --chart-8: 218 100% 70%;
  }

  /* -------- Plum (Datadog/Grafana — dark-first) -------- */
  [data-palette="plum"] {
    --background: 240 14% 98%;
    --foreground: 232 21% 13%;
    --card: 0 0% 100%;
    --card-foreground: 232 21% 13%;
    --popover: 0 0% 100%;
    --popover-foreground: 232 21% 13%;
    --primary: 263 84% 58%;
    --primary-foreground: 0 0% 100%;
    --secondary: 250 100% 97%;
    --secondary-foreground: 232 21% 13%;
    --muted: 250 100% 97%;
    --muted-foreground: 220 9% 46%;
    --accent: 251 91% 92%;
    --accent-foreground: 263 70% 50%;
    --destructive: 0 72% 50%;
    --destructive-foreground: 0 0% 100%;
    --border: 240 13% 91%;
    --input: 240 13% 91%;
    --ring: 263 84% 58%;
    --success: 142 72% 35%;
    --warning: 38 92% 50%;
    --radius: 0.5rem;

    --chart-1: 263 84% 58%;
    --chart-2: 188 91% 43%;
    --chart-3: 158 64% 40%;
    --chart-4: 38 92% 50%;
    --chart-5: 330 81% 60%;
    --chart-6: 217 91% 60%;
    --chart-7: 83 75% 45%;
    --chart-8: 25 95% 53%;
  }

  [data-palette="plum"].dark {
    --background: 240 30% 8%;
    --foreground: 240 19% 92%;
    --card: 240 32% 13%;
    --card-foreground: 240 19% 92%;
    --popover: 240 32% 13%;
    --popover-foreground: 240 19% 92%;
    --primary: 252 95% 76%;
    --primary-foreground: 240 30% 8%;
    --secondary: 240 33% 18%;
    --secondary-foreground: 240 19% 92%;
    --muted: 240 33% 18%;
    --muted-foreground: 240 21% 64%;
    --accent: 188 91% 43%;
    --accent-foreground: 240 30% 8%;
    --destructive: 0 62% 50%;
    --destructive-foreground: 0 0% 100%;
    --border: 240 24% 22%;
    --input: 240 24% 22%;
    --ring: 252 95% 76%;
    --success: 142 70% 45%;
    --warning: 38 92% 55%;

    --chart-1: 252 95% 76%;
    --chart-2: 188 91% 53%;
    --chart-3: 158 64% 50%;
    --chart-4: 38 92% 60%;
    --chart-5: 330 81% 70%;
    --chart-6: 217 91% 70%;
    --chart-7: 83 75% 55%;
    --chart-8: 25 95% 63%;
  }

  /* -------- Clay (Anthropic) -------- */
  [data-palette="clay"] {
    --background: 39 47% 95%;
    --foreground: 35 33% 13%;
    --card: 48 100% 98%;
    --card-foreground: 35 33% 13%;
    --popover: 48 100% 98%;
    --popover-foreground: 35 33% 13%;
    --primary: 21 90% 40%;
    --primary-foreground: 0 0% 100%;
    --secondary: 42 47% 90%;
    --secondary-foreground: 35 33% 13%;
    --muted: 42 47% 90%;
    --muted-foreground: 38 22% 34%;
    --accent: 30 90% 37%;
    --accent-foreground: 0 0% 100%;
    --destructive: 0 72% 50%;
    --destructive-foreground: 0 0% 100%;
    --border: 39 28% 85%;
    --input: 39 28% 85%;
    --ring: 21 90% 40%;
    --success: 142 50% 35%;
    --warning: 38 92% 50%;
    --radius: 0.5rem;

    --chart-1: 21 90% 40%;
    --chart-2: 30 90% 37%;
    --chart-3: 83 64% 35%;
    --chart-4: 192 80% 30%;
    --chart-5: 0 70% 41%;
    --chart-6: 19 80% 26%;
    --chart-7: 35 90% 36%;
    --chart-8: 83 64% 30%;
  }

  [data-palette="clay"].dark {
    --background: 30 17% 9%;
    --foreground: 42 47% 90%;
    --card: 28 14% 13%;
    --card-foreground: 42 47% 90%;
    --popover: 28 14% 13%;
    --popover-foreground: 42 47% 90%;
    --primary: 25 95% 61%;
    --primary-foreground: 30 17% 9%;
    --secondary: 28 18% 15%;
    --secondary-foreground: 42 47% 90%;
    --muted: 28 18% 15%;
    --muted-foreground: 35 25% 64%;
    --accent: 43 96% 56%;
    --accent-foreground: 30 17% 9%;
    --destructive: 0 62% 50%;
    --destructive-foreground: 0 0% 100%;
    --border: 27 15% 19%;
    --input: 27 15% 19%;
    --ring: 25 95% 61%;
    --success: 142 50% 45%;
    --warning: 38 92% 55%;

    --chart-1: 25 95% 61%;
    --chart-2: 43 96% 56%;
    --chart-3: 83 64% 50%;
    --chart-4: 192 80% 50%;
    --chart-5: 0 70% 60%;
    --chart-6: 19 80% 50%;
    --chart-7: 35 90% 55%;
    --chart-8: 83 64% 45%;
  }
```

- [ ] **Step 5.2 — Smoke-check each palette in the dev server**

```bash
pnpm -F @modeldoctor/web dev
```

In a JS console on the running app, run each of:

```js
document.documentElement.dataset.palette = "aurora";
document.documentElement.dataset.palette = "indigo";
document.documentElement.dataset.palette = "plum";
document.documentElement.dataset.palette = "clay";
document.documentElement.classList.toggle("dark"); // for each palette
```

Confirm: bg/fg/primary visibly change for each combo and nothing renders unstyled (white text on white background, etc.). Stop the dev server.

- [ ] **Step 5.3 — Run web tests**

```bash
pnpm -F @modeldoctor/web test --run
```

Expected: all green.

- [ ] **Step 5.4 — Commit**

```bash
git add apps/web/src/styles/globals.css
git commit -m "$(cat <<'EOF'
feat(web/theme): add Aurora + Indigo + Plum + Clay palettes

Each palette ships light + dark CSS variable sets plus eight chart
channels. Slate stays the default. Token shades come from the design
spec; final tuning happens via the WCAG contrast pass in the e2e task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Two-section dropdown + i18n

**Files:**
- Modify: `apps/web/src/components/common/theme-toggle.tsx`
- Modify: `apps/web/src/locales/zh-CN/common.json`
- Modify: `apps/web/src/locales/en-US/common.json`

- [ ] **Step 6.1 — Add zh-CN i18n keys**

Edit `apps/web/src/locales/zh-CN/common.json`. Replace the existing `"theme": { … }` block with:

```json
  "theme": {
    "toggle": "切换主题",
    "label": "主题",
    "appearance": "外观",
    "light": "浅色",
    "dark": "深色",
    "system": "跟随系统",
    "palette": {
      "title": "主题色",
      "slate": "Slate",
      "aurora": "Aurora",
      "indigo": "Indigo",
      "plum": "Plum",
      "clay": "Clay"
    }
  },
```

(Match the surrounding indentation. Trailing comma stays as in the original file.)

- [ ] **Step 6.2 — Add en-US i18n keys**

Edit `apps/web/src/locales/en-US/common.json`. Replace its `"theme": { … }` block with:

```json
  "theme": {
    "toggle": "Toggle theme",
    "label": "Theme",
    "appearance": "Appearance",
    "light": "Light",
    "dark": "Dark",
    "system": "System",
    "palette": {
      "title": "Palette",
      "slate": "Slate",
      "aurora": "Aurora",
      "indigo": "Indigo",
      "plum": "Plum",
      "clay": "Clay"
    }
  },
```

- [ ] **Step 6.3 — Rewrite `theme-toggle.tsx`**

Replace the entire body of `apps/web/src/components/common/theme-toggle.tsx` with:

```tsx
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  PALETTES,
  type Palette,
  type ThemeMode,
  useThemeStore,
} from "@/stores/theme-store";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";

const PALETTE_SWATCH_HSL: Record<Palette, string> = {
  slate: "240 5.9% 10%",
  aurora: "240 60% 60%",
  indigo: "244 100% 68%",
  plum: "263 84% 58%",
  clay: "21 90% 40%",
};

export function ThemeToggle() {
  const { t } = useTranslation("common");
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);
  const palette = useThemeStore((s) => s.palette);
  const setPalette = useThemeStore((s) => s.setPalette);

  const TriggerIcon = mode === "light" ? Sun : mode === "dark" ? Moon : Monitor;

  const modeItems: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
    { value: "light", label: t("theme.light"), icon: Sun },
    { value: "dark", label: t("theme.dark"), icon: Moon },
    { value: "system", label: t("theme.system"), icon: Monitor },
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("theme.toggle")}>
          <TriggerIcon className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[12rem]">
        <DropdownMenuLabel className="text-xs uppercase tracking-wide text-muted-foreground">
          {t("theme.appearance")}
        </DropdownMenuLabel>
        {modeItems.map((item) => (
          <DropdownMenuItem key={item.value} onClick={() => setMode(item.value)} className="gap-2">
            <item.icon className="h-4 w-4" />
            <span>{item.label}</span>
            {mode === item.value ? (
              <span className="ml-auto text-xs text-muted-foreground">●</span>
            ) : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs uppercase tracking-wide text-muted-foreground">
          {t("theme.palette.title")}
        </DropdownMenuLabel>
        {PALETTES.map((p) => (
          <DropdownMenuItem key={p} onClick={() => setPalette(p)} className="gap-2">
            <span
              aria-hidden="true"
              className="h-3 w-3 rounded-full border border-border"
              style={{ backgroundColor: `hsl(${PALETTE_SWATCH_HSL[p]})` }}
            />
            <span>{t(`theme.palette.${p}`)}</span>
            {palette === p ? (
              <span className="ml-auto text-xs text-muted-foreground">●</span>
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 6.4 — Verify in dev server**

```bash
pnpm -F @modeldoctor/web dev
```

Open the app, click the theme icon. Confirm dropdown shows two labeled sections (Appearance + Palette), 8 items total (3 + 5), with selected dots in the right places. Click each palette and confirm the page recolors. Stop the dev server.

- [ ] **Step 6.5 — Run web tests**

```bash
pnpm -F @modeldoctor/web test --run
```

Expected: all green.

- [ ] **Step 6.6 — Commit**

```bash
git add apps/web/src/components/common/theme-toggle.tsx \
        apps/web/src/locales/zh-CN/common.json \
        apps/web/src/locales/en-US/common.json
git commit -m "$(cat <<'EOF'
feat(web/theme): two-section toggle (Appearance + Palette) with swatches

Single dropdown, two labeled sections separated by a divider. Each
palette item has a 12px color swatch derived from its primary token.
i18n keys: theme.appearance + theme.palette.{title,slate,aurora,indigo,plum,clay}.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Sync data-palette before first render

**Files:**
- Modify: `apps/web/src/main.tsx`

The static `data-palette="slate"` in `index.html` is correct for the default. But if a user's persisted state has `palette: "plum"`, we want to apply it before React mounts so the first paint matches their preference.

- [ ] **Step 7.1 — Update `main.tsx`**

Replace `apps/web/src/main.tsx` with:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/globals.css";
import i18n from "./lib/i18n";
import { useLocaleStore } from "./stores/locale-store";
import { useThemeStore } from "./stores/theme-store";

// Sync i18n to the (hydrated or detected) store locale before first render.
// Without this, first-time zh-browser visitors briefly see the en fallback
// because i18n's own default runs before persist rehydration.
void i18n.changeLanguage(useLocaleStore.getState().locale);

// Sync data-palette to the rehydrated store before first paint so users
// with a saved non-default palette don't see a slate flash.
const initialPalette = useThemeStore.getState().palette;
document.documentElement.dataset.palette = initialPalette;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

Note: `useThemeStore.getState().palette` returns the rehydrated value because zustand-persist runs synchronously on store creation when `localStorage` is available.

- [ ] **Step 7.2 — Run web tests + build**

```bash
pnpm -F @modeldoctor/web test --run
pnpm -F @modeldoctor/web build
```

Expected: both green.

- [ ] **Step 7.3 — Commit**

```bash
git add apps/web/src/main.tsx
git commit -m "$(cat <<'EOF'
feat(web/theme): apply persisted palette before first paint

Reads useThemeStore.getState().palette after persist rehydrates and
writes it to <html data-palette> before ReactDOM.render. Prevents a
brief slate flash for users with a saved non-default palette.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Playwright visual smoke + WCAG contrast pass

**Files:**
- Create: `e2e/theme-palette.spec.ts`

This task has two halves: an automated Playwright spec that asserts the DOM contract for every palette × mode and captures screenshots; and a manual contrast pass for each palette × mode against WCAG AA.

The repo uses Playwright via the `pnpm test:e2e:browser` script (defined in root `package.json` as `playwright test --config e2e/playwright.config.ts`). Most e2e specs require auth; the theme spec deliberately tests on `/login` (publicly reachable) so it doesn't need DB reset or auth helpers — the login chrome is enough surface to validate token wiring.

- [ ] **Step 8.1 — Write the Playwright smoke spec**

Create `e2e/theme-palette.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

const PALETTES = ["slate", "aurora", "indigo", "plum", "clay"] as const;
const MODES = ["light", "dark"] as const;

for (const palette of PALETTES) {
  for (const mode of MODES) {
    test(`theme: palette=${palette} mode=${mode}`, async ({ page }) => {
      await page.addInitScript(
        ([p, m]) => {
          window.localStorage.setItem(
            "md.theme.v1",
            JSON.stringify({ state: { mode: m, palette: p }, version: 0 }),
          );
        },
        [palette, mode] as const,
      );

      await page.goto("/login");
      await page.waitForLoadState("networkidle");

      await expect(page.locator("html")).toHaveAttribute("data-palette", palette);
      if (mode === "dark") {
        await expect(page.locator("html")).toHaveClass(/(?:^|\s)dark(?:\s|$)/);
      } else {
        await expect(page.locator("html")).not.toHaveClass(/(?:^|\s)dark(?:\s|$)/);
      }

      // Confirm body picked up palette tokens.
      const bg = await page.evaluate(() =>
        getComputedStyle(document.body).backgroundColor.trim(),
      );
      expect(bg.length).toBeGreaterThan(0);
      expect(bg).not.toBe("rgba(0, 0, 0, 0)");

      await expect(page).toHaveScreenshot(`theme-${palette}-${mode}.png`, {
        fullPage: false,
        maxDiffPixelRatio: 0.02,
      });
    });
  }
}
```

- [ ] **Step 8.2 — Generate baseline screenshots**

```bash
pnpm test:e2e:browser -- --update-snapshots e2e/theme-palette.spec.ts
```

Playwright writes baselines next to the spec at `e2e/theme-palette.spec.ts-snapshots/`. Inspect the 10 generated PNGs and confirm each palette/mode looks distinct and intentional. If any combination has unstyled fallbacks (white-on-white, missing token), revisit Task 5's HSL values.

- [ ] **Step 8.3 — Run the spec against the baselines**

```bash
pnpm test:e2e:browser -- e2e/theme-palette.spec.ts
```

Expected: 10 tests pass.

- [ ] **Step 8.4 — Manual WCAG contrast pass**

For each palette, in both modes, run the following pairs through a WCAG checker (e.g. https://webaim.org/resources/contrastchecker/, or the Chrome devtools color picker contrast indicator):

- `--background` ↔ `--foreground` — must be ≥ 4.5:1 (AA body text)
- `--card` ↔ `--card-foreground` — must be ≥ 4.5:1
- `--primary` ↔ `--primary-foreground` — must be ≥ 3:1 (AA Large for buttons)
- `--muted` ↔ `--muted-foreground` — must be ≥ 4.5:1 (still used as body text)
- `--background` ↔ `--border` — must be ≥ 1.5:1 (visual separation, not WCAG-required but check)

If any pair fails:
1. Open `apps/web/src/styles/globals.css`.
2. Adjust the relevant HSL value (typically nudging `L%` up or down by 5–10).
3. Re-run the visual e2e snapshot update for affected tests.
4. Re-run the contrast check until all pairs pass.

Document any adjustments in the commit message of Step 8.6.

- [ ] **Step 8.5 — Run the full web test suite**

```bash
pnpm -F @modeldoctor/web test --run
pnpm -F @modeldoctor/web build
pnpm test:e2e:browser -- e2e/theme-palette.spec.ts
```

Expected: all green.

- [ ] **Step 8.6 — Commit**

```bash
git add e2e/theme-palette.spec.ts \
        e2e/theme-palette.spec.ts-snapshots/ \
        apps/web/src/styles/globals.css  # only if WCAG pass required tweaks
git commit -m "$(cat <<'EOF'
test(web/theme): playwright visual smoke for 5 palettes × 2 modes

Asserts <html> attributes match seeded localStorage and captures a
baseline screenshot per combination. Snapshots gate visual regressions
across future style changes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final verification

After Task 8, run the full pre-PR gate from the repo's CLAUDE.md:

```bash
pnpm -r build
pnpm -F @modeldoctor/web test --run
pnpm test:e2e:browser
pnpm lint
pnpm format
```

All green → branch ready for PR. Per CLAUDE.md, push to `feat/multi-palette-theme` (or similar) and open the PR; do not merge to `main` without confirmation.
