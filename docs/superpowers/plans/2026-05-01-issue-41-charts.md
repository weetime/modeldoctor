# Issue #41 — First-class chart layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land `<PercentileTimeseries>`, `<LatencyCDF>`, `<TTFTHistogram>`, `<QPSTimeseries>`, an `assignRunColors` palette helper, a perf smoke at 10k points, and a dev-only `/dev/charts` demo route, so #46 / #45 / #48 can consume canonical perf charts without re-implementing them.

**Architecture:** Each component owns its props shape (no `@modeldoctor/contracts` coupling), wraps `ReactECharts` directly, and shares ECharts module registration + theme + frame primitives via `_shared.tsx`. Cross-chart Run color stability comes from a parent-computed `colorMap` passed to every chart on the page. The 3 already-committed components (`feat/charts-domain-components`, commit `ebc7cfa`) are extended in place to consume `colorMap`; `<QPSTimeseries>` is added; tests + perf smoke + dev demo round it out.

**Tech Stack:** React 18, TypeScript, Vitest 1, `echarts` 6, `echarts-for-react` 3, react-router-dom 7, Tailwind, Biome.

**Branch:** `feat/charts-domain-components` (already cut from `main` via `claude/review-open-issues-HiNNH`).

**Spec:** [`docs/superpowers/specs/2026-05-01-issue-41-charts-design.md`](../specs/2026-05-01-issue-41-charts-design.md)

---

## Pre-flight (already done on this branch)

- ✅ Branch `feat/charts-domain-components` cut.
- ✅ `_shared.tsx` exists with `ChartFrame` / `useChartDark` / `themed` / `DomainChartProps`. Commit `ebc7cfa`.
- ✅ `PercentileTimeseries.tsx` / `LatencyCDF.tsx` / `TTFTHistogram.tsx` exist (initial versions, no `colorMap` support yet). Commit `ebc7cfa`.
- ✅ `pnpm -F @modeldoctor/web type-check` passes.
- ✅ `pnpm -F @modeldoctor/web exec biome check src/components/charts/` passes.
- ✅ Spec committed `dcd1f81`.
- ✅ The pre-existing lint failures in `src/features/connections/queries.test.tsx` are out-of-scope; do **not** touch.

---

## Task 1: `assignRunColors` helper + palette export

**Files:**
- Modify: `apps/web/src/components/charts/theme.ts:5-16` (export the palette array)
- Modify: `apps/web/src/components/charts/_shared.tsx` (add `assignRunColors`)
- Test: `apps/web/src/components/charts/_shared.test.tsx` (new)

- [ ] **Step 1: Write the failing test** — create `apps/web/src/components/charts/_shared.test.tsx`:

  ```tsx
  import { describe, expect, it } from "vitest";
  import { assignRunColors } from "./_shared";

  describe("assignRunColors", () => {
    it("returns empty map for empty input", () => {
      expect(assignRunColors([])).toEqual({});
    });

    it("assigns one color per runId in input order", () => {
      const m = assignRunColors(["a", "b", "c"]);
      expect(Object.keys(m)).toEqual(["a", "b", "c"]);
      expect(m.a).not.toBe(m.b);
      expect(m.b).not.toBe(m.c);
    });

    it("is stable for identical input", () => {
      expect(assignRunColors(["x", "y"])).toEqual(assignRunColors(["x", "y"]));
    });

    it("wraps around the 8-color palette when given more than 8 runs", () => {
      const ids = Array.from({ length: 10 }, (_, i) => `r${i}`);
      const m = assignRunColors(ids);
      expect(m.r0).toBe(m.r8);
      expect(m.r1).toBe(m.r9);
    });
  });
  ```

- [ ] **Step 2: Run the test to verify it fails**

  Run: `pnpm -F @modeldoctor/web test --run src/components/charts/_shared.test.tsx`
  Expected: FAIL — `assignRunColors` is not exported from `./_shared`.

- [ ] **Step 3: Export `palette` from `theme.ts`** — modify `apps/web/src/components/charts/theme.ts`. Replace the `const palette = {...}` block at lines 5–16 with:

  ```ts
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
  ```

  Leave `lightTheme` / `darkTheme` / `applyTheme` below unchanged — they consume `baseColors` already.

- [ ] **Step 4: Add `assignRunColors` to `_shared.tsx`** — append to `apps/web/src/components/charts/_shared.tsx` (after the `DomainChartProps` interface):

  ```ts
  import { palette } from "./theme";

  export function assignRunColors(runIds: readonly string[]): Record<string, string> {
    const out: Record<string, string> = {};
    runIds.forEach((id, i) => {
      out[id] = palette[i % palette.length];
    });
    return out;
  }
  ```

  Make sure the new `import { palette } from "./theme";` line is added at the top with the other imports (Biome enforces import ordering — alphabetized within groups).

- [ ] **Step 5: Run the test to verify it passes**

  Run: `pnpm -F @modeldoctor/web test --run src/components/charts/_shared.test.tsx`
  Expected: PASS, 4 tests.

- [ ] **Step 6: Lint + type-check**

  ```bash
  pnpm -F @modeldoctor/web exec biome check --write src/components/charts/
  pnpm -F @modeldoctor/web type-check
  ```
  Expected: both clean.

- [ ] **Step 7: Commit**

  ```bash
  git add apps/web/src/components/charts/theme.ts \
          apps/web/src/components/charts/_shared.tsx \
          apps/web/src/components/charts/_shared.test.tsx
  git commit -m "$(cat <<'EOF'
  feat(web/charts): add assignRunColors palette helper

  Exports the 8-color base palette from theme.ts and adds
  assignRunColors(runIds) → Record<runId, string> for parent components
  to compute a stable Run-to-color map and pass it down to all charts on
  a page. Round-robin over the palette; identical input → identical
  output, so memoization at the call site is straightforward.

  Refs #41.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 2: `<PercentileTimeseries>` colorMap + opacity-per-percentile + tests

**Files:**
- Modify: `apps/web/src/components/charts/PercentileTimeseries.tsx`
- Test: `apps/web/src/components/charts/PercentileTimeseries.test.tsx` (new)

- [ ] **Step 1: Write the failing test** — create `apps/web/src/components/charts/PercentileTimeseries.test.tsx`:

  ```tsx
  import { render, screen } from "@testing-library/react";
  import { describe, expect, it, vi } from "vitest";
  import { PercentileTimeseries } from "./PercentileTimeseries";

  vi.mock("echarts-for-react", () => ({
    default: ({ option, style }: { option: unknown; style?: React.CSSProperties }) => (
      <div data-testid="echart" data-option={JSON.stringify(option)} style={style} />
    ),
  }));

  function readOption(): {
    series: Array<{
      name: string;
      type: string;
      data: unknown[];
      lineStyle?: { color?: string; opacity?: number };
      itemStyle?: { color?: string; opacity?: number };
    }>;
    legend: { data: string[] };
  } {
    return JSON.parse(screen.getByTestId("echart").getAttribute("data-option") ?? "{}");
  }

  describe("<PercentileTimeseries>", () => {
    it("renders one line series per (run × percentile)", () => {
      render(
        <PercentileTimeseries
          ariaLabel="pt"
          series={[
            {
              runId: "a",
              percentiles: {
                p50: [[0, 1]],
                p95: [[0, 2]],
              },
            },
          ]}
        />,
      );
      const opt = readOption();
      expect(opt.series).toHaveLength(2);
      expect(opt.series.every((s) => s.type === "line")).toBe(true);
    });

    it("uses bare percentile names in legend when single-Run", () => {
      render(
        <PercentileTimeseries
          ariaLabel="pt"
          series={[{ runId: "a", percentiles: { p50: [[0, 1]], p95: [[0, 2]] } }]}
        />,
      );
      expect(readOption().legend.data).toEqual(["p50", "p95"]);
    });

    it("uses 'runLabel · pXX' names in legend when multi-Run", () => {
      render(
        <PercentileTimeseries
          ariaLabel="pt"
          series={[
            { runId: "a", runLabel: "Run A", percentiles: { p50: [[0, 1]] } },
            { runId: "b", runLabel: "Run B", percentiles: { p50: [[0, 2]] } },
          ]}
        />,
      );
      expect(readOption().legend.data).toEqual(["Run A · p50", "Run B · p50"]);
    });

    it("applies colorMap[runId] as line color, varies opacity per percentile", () => {
      render(
        <PercentileTimeseries
          ariaLabel="pt"
          series={[
            {
              runId: "a",
              percentiles: { p50: [[0, 1]], p90: [[0, 1]], p95: [[0, 1]], p99: [[0, 1]] },
            },
          ]}
          colorMap={{ a: "#ff0000" }}
        />,
      );
      const opt = readOption();
      expect(opt.series.map((s) => s.lineStyle?.color)).toEqual([
        "#ff0000",
        "#ff0000",
        "#ff0000",
        "#ff0000",
      ]);
      expect(opt.series.map((s) => s.lineStyle?.opacity)).toEqual([1, 0.8, 0.6, 0.45]);
    });

    it("renders empty state when all percentiles are absent", () => {
      render(<PercentileTimeseries ariaLabel="pt" series={[{ runId: "a", percentiles: {} }]} />);
      expect(screen.getByText(/no data/i)).toBeInTheDocument();
    });

    it("renders loading state", () => {
      render(<PercentileTimeseries ariaLabel="pt" series={[]} loading />);
      expect(screen.getByRole("status", { name: /loading/i })).toBeInTheDocument();
    });

    it("propagates ariaLabel", () => {
      render(<PercentileTimeseries ariaLabel="my-pt" series={[]} />);
      expect(screen.getByLabelText("my-pt")).toBeInTheDocument();
    });
  });
  ```

- [ ] **Step 2: Run the test to verify it fails**

  Run: `pnpm -F @modeldoctor/web test --run src/components/charts/PercentileTimeseries.test.tsx`
  Expected: FAIL — `colorMap` prop not supported, opacity not set, single-Run legend probably already correct (existing impl passes that test); the colorMap + opacity tests fail.

- [ ] **Step 3: Update `PercentileTimeseries.tsx`** — replace the file at `apps/web/src/components/charts/PercentileTimeseries.tsx` with:

  ```tsx
  import type { EChartsOption } from "echarts";
  import ReactECharts from "echarts-for-react";
  import { useMemo } from "react";
  import { ChartFrame, type DomainChartProps, themed, useChartDark } from "./_shared";

  export type Percentile = "p50" | "p90" | "p95" | "p99";

  export interface PercentileTimeseriesSeries {
    runId: string;
    runLabel?: string;
    percentiles: Partial<Record<Percentile, Array<[number, number]>>>;
  }

  export interface PercentileTimeseriesProps extends DomainChartProps {
    series: PercentileTimeseriesSeries[];
    yLabel?: string;
    colorMap?: Record<string, string>;
  }

  const PERCENTILE_ORDER: Percentile[] = ["p50", "p90", "p95", "p99"];

  const PERCENTILE_OPACITY: Record<Percentile, number> = {
    p50: 1,
    p90: 0.8,
    p95: 0.6,
    p99: 0.45,
  };

  function buildOption(
    series: PercentileTimeseriesSeries[],
    yLabel: string,
    colorMap: Record<string, string> | undefined,
  ): EChartsOption {
    const multiRun = series.length > 1;
    const flat = series.flatMap((s) =>
      PERCENTILE_ORDER.flatMap((p) => {
        const data = s.percentiles[p];
        if (!data || data.length === 0) return [];
        const runName = s.runLabel ?? s.runId;
        const name = multiRun ? `${runName} · ${p}` : p;
        const color = colorMap?.[s.runId];
        const opacity = PERCENTILE_OPACITY[p];
        const styled = color ? { color, opacity } : { opacity };
        return [
          {
            name,
            type: "line" as const,
            showSymbol: false,
            sampling: "lttb" as const,
            progressive: 2000,
            progressiveThreshold: 5000,
            data,
            lineStyle: styled,
            itemStyle: styled,
          },
        ];
      }),
    );
    return {
      tooltip: { trigger: "axis" },
      legend: { data: flat.map((s) => s.name) },
      xAxis: { type: "time" },
      yAxis: { type: "value", name: yLabel, nameLocation: "middle", nameGap: 40 },
      grid: { left: 56, right: 24, top: 40, bottom: 40 },
      dataZoom: [{ type: "inside" }, { type: "slider", height: 18 }],
      series: flat,
    };
  }

  export function PercentileTimeseries(props: PercentileTimeseriesProps) {
    const {
      series,
      yLabel = "Latency (ms)",
      colorMap,
      ariaLabel,
      height = 360,
      loading,
      empty,
      theme = "auto",
    } = props;

    const dark = useChartDark(theme);
    const isEmpty =
      empty ??
      (series.length === 0 ||
        series.every((s) =>
          PERCENTILE_ORDER.every((p) => !s.percentiles[p] || s.percentiles[p]?.length === 0),
        ));

    const option = useMemo(
      () => themed(buildOption(series, yLabel, colorMap), dark),
      [series, yLabel, colorMap, dark],
    );

    return (
      <ChartFrame ariaLabel={ariaLabel} height={height} loading={loading} empty={isEmpty}>
        <ReactECharts option={option} style={{ height: "100%", width: "100%" }} notMerge lazyUpdate />
      </ChartFrame>
    );
  }
  ```

- [ ] **Step 4: Run the test to verify it passes**

  Run: `pnpm -F @modeldoctor/web test --run src/components/charts/PercentileTimeseries.test.tsx`
  Expected: PASS, 7 tests.

- [ ] **Step 5: Lint + type-check**

  ```bash
  pnpm -F @modeldoctor/web exec biome check --write src/components/charts/
  pnpm -F @modeldoctor/web type-check
  ```

- [ ] **Step 6: Commit**

  ```bash
  git add apps/web/src/components/charts/PercentileTimeseries.tsx \
          apps/web/src/components/charts/PercentileTimeseries.test.tsx
  git commit -m "$(cat <<'EOF'
  feat(web/charts): PercentileTimeseries colorMap + opacity-per-percentile

  - Accepts colorMap prop; when present, applies the Run color to all
    percentile lines for that Run via lineStyle.color / itemStyle.color.
  - Differentiates p50/p90/p95/p99 within a Run via lineStyle.opacity
    (1.0 / 0.8 / 0.6 / 0.45) so a multi-Run report keeps Run identity
    legible. ECharts only supports three line-style types, so opacity
    is the natural fourth dimension.

  Refs #41.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 3: `<LatencyCDF>` colorMap + tests

**Files:**
- Modify: `apps/web/src/components/charts/LatencyCDF.tsx`
- Test: `apps/web/src/components/charts/LatencyCDF.test.tsx` (new)

- [ ] **Step 1: Write the failing test** — create `apps/web/src/components/charts/LatencyCDF.test.tsx`:

  ```tsx
  import { render, screen } from "@testing-library/react";
  import { describe, expect, it, vi } from "vitest";
  import { LatencyCDF } from "./LatencyCDF";

  vi.mock("echarts-for-react", () => ({
    default: ({ option, style }: { option: unknown; style?: React.CSSProperties }) => (
      <div data-testid="echart" data-option={JSON.stringify(option)} style={style} />
    ),
  }));

  function readOption(): {
    series: Array<{
      name: string;
      type: string;
      step: string;
      data: Array<[number, number]>;
      lineStyle?: { color?: string };
      itemStyle?: { color?: string };
    }>;
    legend: { data: string[] };
  } {
    return JSON.parse(screen.getByTestId("echart").getAttribute("data-option") ?? "{}");
  }

  describe("<LatencyCDF>", () => {
    it("renders one step-line series per Run", () => {
      render(
        <LatencyCDF
          ariaLabel="cdf"
          series={[
            { runId: "a", runLabel: "A", samples: [10, 20] },
            { runId: "b", runLabel: "B", samples: [30, 40] },
          ]}
        />,
      );
      const opt = readOption();
      expect(opt.series).toHaveLength(2);
      expect(opt.series[0].type).toBe("line");
      expect(opt.series[0].step).toBe("end");
    });

    it("computes CDF from samples: sorted ascending, final y = 1", () => {
      render(<LatencyCDF ariaLabel="cdf" series={[{ runId: "a", samples: [30, 10, 20] }]} />);
      const data = readOption().series[0].data;
      expect(data.map((p) => p[0])).toEqual([10, 20, 30]);
      expect(data[data.length - 1][1]).toBeCloseTo(1, 5);
    });

    it("uses pre-computed cdf when provided, ignoring samples", () => {
      render(
        <LatencyCDF
          ariaLabel="cdf"
          series={[
            {
              runId: "a",
              cdf: [
                [5, 0.5],
                [10, 1],
              ],
            },
          ]}
        />,
      );
      expect(readOption().series[0].data).toEqual([
        [5, 0.5],
        [10, 1],
      ]);
    });

    it("applies colorMap to series colors", () => {
      render(
        <LatencyCDF
          ariaLabel="cdf"
          series={[{ runId: "a", samples: [1, 2] }]}
          colorMap={{ a: "#00ff00" }}
        />,
      );
      const opt = readOption();
      expect(opt.series[0].lineStyle?.color).toBe("#00ff00");
      expect(opt.series[0].itemStyle?.color).toBe("#00ff00");
    });

    it("uses runLabel in legend when provided, runId otherwise", () => {
      render(
        <LatencyCDF
          ariaLabel="cdf"
          series={[
            { runId: "a", runLabel: "First", samples: [1] },
            { runId: "b", samples: [2] },
          ]}
        />,
      );
      expect(readOption().legend.data).toEqual(["First", "b"]);
    });

    it("renders empty state when no samples and no cdf", () => {
      render(<LatencyCDF ariaLabel="cdf" series={[{ runId: "a" }]} />);
      expect(screen.getByText(/no data/i)).toBeInTheDocument();
    });

    it("renders loading state", () => {
      render(<LatencyCDF ariaLabel="cdf" series={[]} loading />);
      expect(screen.getByRole("status", { name: /loading/i })).toBeInTheDocument();
    });
  });
  ```

- [ ] **Step 2: Run the test to verify it fails**

  Run: `pnpm -F @modeldoctor/web test --run src/components/charts/LatencyCDF.test.tsx`
  Expected: FAIL on the colorMap test (current impl doesn't accept `colorMap`); other tests likely pass against existing impl.

- [ ] **Step 3: Update `LatencyCDF.tsx`** — replace the file at `apps/web/src/components/charts/LatencyCDF.tsx` with:

  ```tsx
  import type { EChartsOption } from "echarts";
  import ReactECharts from "echarts-for-react";
  import { useMemo } from "react";
  import { ChartFrame, type DomainChartProps, themed, useChartDark } from "./_shared";

  export interface LatencyCDFSeries {
    runId: string;
    runLabel?: string;
    samples?: number[];
    cdf?: Array<[number, number]>;
  }

  export interface LatencyCDFProps extends DomainChartProps {
    series: LatencyCDFSeries[];
    xLabel?: string;
    colorMap?: Record<string, string>;
  }

  function computeCDF(samples: number[]): Array<[number, number]> {
    const n = samples.length;
    if (n === 0) return [];
    const sorted = [...samples].sort((a, b) => a - b);
    return sorted.map((x, i) => [x, (i + 1) / n]);
  }

  function resolveCDF(s: LatencyCDFSeries): Array<[number, number]> {
    if (s.cdf && s.cdf.length > 0) return s.cdf;
    if (s.samples && s.samples.length > 0) return computeCDF(s.samples);
    return [];
  }

  function buildOption(
    series: LatencyCDFSeries[],
    xLabel: string,
    colorMap: Record<string, string> | undefined,
  ): EChartsOption {
    const ecSeries = series
      .map((s) => ({ raw: s, data: resolveCDF(s) }))
      .filter(({ data }) => data.length > 0)
      .map(({ raw, data }) => {
        const color = colorMap?.[raw.runId];
        return {
          name: raw.runLabel ?? raw.runId,
          type: "line" as const,
          step: "end" as const,
          showSymbol: false,
          sampling: "lttb" as const,
          progressive: 2000,
          progressiveThreshold: 5000,
          data,
          ...(color ? { itemStyle: { color }, lineStyle: { color } } : {}),
        };
      });

    return {
      tooltip: { trigger: "axis" },
      legend: { data: ecSeries.map((s) => s.name) },
      xAxis: { type: "value", name: xLabel, nameLocation: "middle", nameGap: 28 },
      yAxis: {
        type: "value",
        min: 0,
        max: 1,
        name: "Cumulative",
        nameLocation: "middle",
        nameGap: 48,
        axisLabel: { formatter: (v: number) => `${Math.round(v * 100)}%` },
      },
      grid: { left: 64, right: 24, top: 40, bottom: 48 },
      dataZoom: [{ type: "inside" }, { type: "slider", height: 18 }],
      series: ecSeries,
    };
  }

  export function LatencyCDF(props: LatencyCDFProps) {
    const {
      series,
      xLabel = "Latency (ms)",
      colorMap,
      ariaLabel,
      height = 360,
      loading,
      empty,
      theme = "auto",
    } = props;

    const dark = useChartDark(theme);
    const isEmpty =
      empty ?? (series.length === 0 || series.every((s) => resolveCDF(s).length === 0));

    const option = useMemo(
      () => themed(buildOption(series, xLabel, colorMap), dark),
      [series, xLabel, colorMap, dark],
    );

    return (
      <ChartFrame ariaLabel={ariaLabel} height={height} loading={loading} empty={isEmpty}>
        <ReactECharts option={option} style={{ height: "100%", width: "100%" }} notMerge lazyUpdate />
      </ChartFrame>
    );
  }
  ```

- [ ] **Step 4: Run tests + lint + type-check**

  ```bash
  pnpm -F @modeldoctor/web test --run src/components/charts/LatencyCDF.test.tsx
  pnpm -F @modeldoctor/web exec biome check --write src/components/charts/
  pnpm -F @modeldoctor/web type-check
  ```
  Expected: 7 tests pass; lint + type-check clean.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/web/src/components/charts/LatencyCDF.tsx \
          apps/web/src/components/charts/LatencyCDF.test.tsx
  git commit -m "$(cat <<'EOF'
  feat(web/charts): LatencyCDF colorMap + unit tests

  Adds colorMap prop (Record<runId, string>) so report pages can keep
  the same Run a stable color across CDF / Histogram / Timeseries.
  Tests cover sample-to-CDF computation, pre-computed CDF passthrough,
  multi-Run legend, color application, empty / loading.

  Refs #41.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 4: `<TTFTHistogram>` colorMap + tests

**Files:**
- Modify: `apps/web/src/components/charts/TTFTHistogram.tsx`
- Test: `apps/web/src/components/charts/TTFTHistogram.test.tsx` (new)

- [ ] **Step 1: Write the failing test** — create `apps/web/src/components/charts/TTFTHistogram.test.tsx`:

  ```tsx
  import { render, screen } from "@testing-library/react";
  import { describe, expect, it, vi } from "vitest";
  import { TTFTHistogram } from "./TTFTHistogram";

  vi.mock("echarts-for-react", () => ({
    default: ({ option, style }: { option: unknown; style?: React.CSSProperties }) => (
      <div data-testid="echart" data-option={JSON.stringify(option)} style={style} />
    ),
  }));

  function readOption(): {
    xAxis: { data: string[] };
    series: Array<{
      name: string;
      type: string;
      data: number[];
      itemStyle?: { color?: string };
    }>;
    legend: { data: string[] };
  } {
    return JSON.parse(screen.getByTestId("echart").getAttribute("data-option") ?? "{}");
  }

  describe("<TTFTHistogram>", () => {
    it("renders one bar series per Run", () => {
      render(
        <TTFTHistogram
          ariaLabel="hist"
          series={[
            {
              runId: "a",
              runLabel: "A",
              buckets: [{ lower: 0, upper: 100, count: 5 }],
            },
            {
              runId: "b",
              runLabel: "B",
              buckets: [{ lower: 0, upper: 100, count: 7 }],
            },
          ]}
        />,
      );
      const opt = readOption();
      expect(opt.series).toHaveLength(2);
      expect(opt.series[0].type).toBe("bar");
    });

    it("aligns bucket boundaries across Runs and zero-fills missing bins", () => {
      render(
        <TTFTHistogram
          ariaLabel="hist"
          series={[
            {
              runId: "a",
              buckets: [
                { lower: 0, upper: 100, count: 5 },
                { lower: 100, upper: 200, count: 3 },
              ],
            },
            {
              runId: "b",
              buckets: [
                { lower: 100, upper: 200, count: 8 },
                { lower: 200, upper: 300, count: 2 },
              ],
            },
          ]}
        />,
      );
      const opt = readOption();
      expect(opt.xAxis.data).toEqual(["[0, 100)", "[100, 200)", "[200, 300)"]);
      expect(opt.series[0].data).toEqual([5, 3, 0]);
      expect(opt.series[1].data).toEqual([0, 8, 2]);
    });

    it("applies colorMap to series itemStyle.color", () => {
      render(
        <TTFTHistogram
          ariaLabel="hist"
          series={[{ runId: "a", buckets: [{ lower: 0, upper: 1, count: 1 }] }]}
          colorMap={{ a: "#0000ff" }}
        />,
      );
      expect(readOption().series[0].itemStyle?.color).toBe("#0000ff");
    });

    it("uses runLabel in legend when provided, runId otherwise", () => {
      render(
        <TTFTHistogram
          ariaLabel="hist"
          series={[
            { runId: "a", runLabel: "First", buckets: [{ lower: 0, upper: 1, count: 1 }] },
            { runId: "b", buckets: [{ lower: 0, upper: 1, count: 1 }] },
          ]}
        />,
      );
      expect(readOption().legend.data).toEqual(["First", "b"]);
    });

    it("renders empty state when all buckets are empty", () => {
      render(<TTFTHistogram ariaLabel="hist" series={[{ runId: "a", buckets: [] }]} />);
      expect(screen.getByText(/no data/i)).toBeInTheDocument();
    });

    it("renders loading state", () => {
      render(<TTFTHistogram ariaLabel="hist" series={[]} loading />);
      expect(screen.getByRole("status", { name: /loading/i })).toBeInTheDocument();
    });
  });
  ```

- [ ] **Step 2: Run the test to verify it fails**

  Run: `pnpm -F @modeldoctor/web test --run src/components/charts/TTFTHistogram.test.tsx`
  Expected: FAIL on colorMap test.

- [ ] **Step 3: Update `TTFTHistogram.tsx`** — replace the file at `apps/web/src/components/charts/TTFTHistogram.tsx` with:

  ```tsx
  import type { EChartsOption } from "echarts";
  import ReactECharts from "echarts-for-react";
  import { useMemo } from "react";
  import { ChartFrame, type DomainChartProps, themed, useChartDark } from "./_shared";

  export interface HistogramBucket {
    lower: number;
    upper: number;
    count: number;
  }

  export interface TTFTHistogramSeries {
    runId: string;
    runLabel?: string;
    buckets: HistogramBucket[];
  }

  export interface TTFTHistogramProps extends DomainChartProps {
    series: TTFTHistogramSeries[];
    xLabel?: string;
    yLabel?: string;
    colorMap?: Record<string, string>;
  }

  function bucketKey(b: { lower: number; upper: number }): string {
    return `${b.lower}|${b.upper}`;
  }

  function bucketLabel(b: { lower: number; upper: number }): string {
    return `[${b.lower}, ${b.upper})`;
  }

  function alignBuckets(series: TTFTHistogramSeries[]): {
    labels: string[];
    perRun: Array<{ runId: string; name: string; data: number[] }>;
  } {
    const ordered = new Map<string, { lower: number; upper: number }>();
    for (const s of series) {
      for (const b of s.buckets) {
        const k = bucketKey(b);
        if (!ordered.has(k)) ordered.set(k, { lower: b.lower, upper: b.upper });
      }
    }
    const sorted = [...ordered.values()].sort((a, b) => a.lower - b.lower || a.upper - b.upper);
    const labels = sorted.map(bucketLabel);
    const perRun = series.map((s) => {
      const m = new Map(s.buckets.map((b) => [bucketKey(b), b.count]));
      return {
        runId: s.runId,
        name: s.runLabel ?? s.runId,
        data: sorted.map((b) => m.get(bucketKey(b)) ?? 0),
      };
    });
    return { labels, perRun };
  }

  function buildOption(
    series: TTFTHistogramSeries[],
    xLabel: string,
    yLabel: string,
    colorMap: Record<string, string> | undefined,
  ): EChartsOption {
    const { labels, perRun } = alignBuckets(series);
    return {
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      legend: { data: perRun.map((r) => r.name) },
      xAxis: {
        type: "category",
        data: labels,
        name: xLabel,
        nameLocation: "middle",
        nameGap: 28,
        axisLabel: { interval: "auto", rotate: labels.length > 12 ? 30 : 0 },
      },
      yAxis: { type: "value", name: yLabel, nameLocation: "middle", nameGap: 40 },
      grid: { left: 56, right: 24, top: 40, bottom: 56 },
      series: perRun.map((r) => {
        const color = colorMap?.[r.runId];
        return {
          name: r.name,
          type: "bar" as const,
          barGap: "10%",
          data: r.data,
          large: true,
          largeThreshold: 2000,
          ...(color ? { itemStyle: { color } } : {}),
        };
      }),
    };
  }

  export function TTFTHistogram(props: TTFTHistogramProps) {
    const {
      series,
      xLabel = "TTFT (ms)",
      yLabel = "Count",
      colorMap,
      ariaLabel,
      height = 360,
      loading,
      empty,
      theme = "auto",
    } = props;

    const dark = useChartDark(theme);
    const isEmpty =
      empty ?? (series.length === 0 || series.every((s) => s.buckets.length === 0));

    const option = useMemo(
      () => themed(buildOption(series, xLabel, yLabel, colorMap), dark),
      [series, xLabel, yLabel, colorMap, dark],
    );

    return (
      <ChartFrame ariaLabel={ariaLabel} height={height} loading={loading} empty={isEmpty}>
        <ReactECharts option={option} style={{ height: "100%", width: "100%" }} notMerge lazyUpdate />
      </ChartFrame>
    );
  }
  ```

- [ ] **Step 4: Tests + lint + type-check**

  ```bash
  pnpm -F @modeldoctor/web test --run src/components/charts/TTFTHistogram.test.tsx
  pnpm -F @modeldoctor/web exec biome check --write src/components/charts/
  pnpm -F @modeldoctor/web type-check
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add apps/web/src/components/charts/TTFTHistogram.tsx \
          apps/web/src/components/charts/TTFTHistogram.test.tsx
  git commit -m "$(cat <<'EOF'
  feat(web/charts): TTFTHistogram colorMap + unit tests

  Adds colorMap prop. Tests cover bucket alignment with zero-fill across
  Runs (the cross-Run union of bucket boundaries with missing-bin
  zero-fill is the one piece of non-trivial logic in this component).

  Refs #41.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 5: `<QPSTimeseries>` (new) + index.ts re-exports

**Files:**
- Create: `apps/web/src/components/charts/QPSTimeseries.tsx`
- Create: `apps/web/src/components/charts/QPSTimeseries.test.tsx`
- Modify: `apps/web/src/components/charts/index.ts`

- [ ] **Step 1: Write the failing test** — create `apps/web/src/components/charts/QPSTimeseries.test.tsx`:

  ```tsx
  import { render, screen } from "@testing-library/react";
  import { describe, expect, it, vi } from "vitest";
  import { QPSTimeseries } from "./QPSTimeseries";

  vi.mock("echarts-for-react", () => ({
    default: ({ option, style }: { option: unknown; style?: React.CSSProperties }) => (
      <div data-testid="echart" data-option={JSON.stringify(option)} style={style} />
    ),
  }));

  function readOption(): {
    series: Array<{
      name: string;
      type: string;
      data: Array<[number, number]>;
      lineStyle?: { color?: string };
    }>;
    legend: { data: string[] };
    xAxis: { type: string };
  } {
    return JSON.parse(screen.getByTestId("echart").getAttribute("data-option") ?? "{}");
  }

  describe("<QPSTimeseries>", () => {
    it("renders one line series per Run on a time x-axis", () => {
      render(
        <QPSTimeseries
          ariaLabel="qps"
          series={[
            {
              runId: "a",
              runLabel: "A",
              points: [
                [0, 10],
                [1, 12],
              ],
            },
            {
              runId: "b",
              runLabel: "B",
              points: [
                [0, 20],
                [1, 22],
              ],
            },
          ]}
        />,
      );
      const opt = readOption();
      expect(opt.series).toHaveLength(2);
      expect(opt.series[0].type).toBe("line");
      expect(opt.xAxis.type).toBe("time");
    });

    it("uses runLabel in legend when provided, runId otherwise", () => {
      render(
        <QPSTimeseries
          ariaLabel="qps"
          series={[
            { runId: "a", runLabel: "First", points: [[0, 1]] },
            { runId: "b", points: [[0, 1]] },
          ]}
        />,
      );
      expect(readOption().legend.data).toEqual(["First", "b"]);
    });

    it("applies colorMap to series colors", () => {
      render(
        <QPSTimeseries
          ariaLabel="qps"
          series={[{ runId: "a", points: [[0, 1]] }]}
          colorMap={{ a: "#ff0000" }}
        />,
      );
      expect(readOption().series[0].lineStyle?.color).toBe("#ff0000");
    });

    it("renders empty state when series has no points", () => {
      render(<QPSTimeseries ariaLabel="qps" series={[{ runId: "a", points: [] }]} />);
      expect(screen.getByText(/no data/i)).toBeInTheDocument();
    });

    it("renders loading state", () => {
      render(<QPSTimeseries ariaLabel="qps" series={[]} loading />);
      expect(screen.getByRole("status", { name: /loading/i })).toBeInTheDocument();
    });
  });
  ```

- [ ] **Step 2: Run the test to verify it fails**

  Run: `pnpm -F @modeldoctor/web test --run src/components/charts/QPSTimeseries.test.tsx`
  Expected: FAIL — `QPSTimeseries.tsx` does not exist.

- [ ] **Step 3: Create `QPSTimeseries.tsx`** at `apps/web/src/components/charts/QPSTimeseries.tsx`:

  ```tsx
  import type { EChartsOption } from "echarts";
  import ReactECharts from "echarts-for-react";
  import { useMemo } from "react";
  import { ChartFrame, type DomainChartProps, themed, useChartDark } from "./_shared";

  export interface QPSTimeseriesSeries {
    runId: string;
    runLabel?: string;
    points: Array<[number, number]>;
  }

  export interface QPSTimeseriesProps extends DomainChartProps {
    series: QPSTimeseriesSeries[];
    yLabel?: string;
    colorMap?: Record<string, string>;
  }

  function buildOption(
    series: QPSTimeseriesSeries[],
    yLabel: string,
    colorMap: Record<string, string> | undefined,
  ): EChartsOption {
    const ecSeries = series.map((s) => {
      const color = colorMap?.[s.runId];
      return {
        name: s.runLabel ?? s.runId,
        type: "line" as const,
        showSymbol: false,
        sampling: "lttb" as const,
        progressive: 2000,
        progressiveThreshold: 5000,
        data: s.points,
        ...(color ? { itemStyle: { color }, lineStyle: { color } } : {}),
      };
    });
    return {
      tooltip: { trigger: "axis" },
      legend: { data: ecSeries.map((s) => s.name) },
      xAxis: { type: "time" },
      yAxis: { type: "value", name: yLabel, nameLocation: "middle", nameGap: 40 },
      grid: { left: 56, right: 24, top: 40, bottom: 40 },
      dataZoom: [{ type: "inside" }, { type: "slider", height: 18 }],
      series: ecSeries,
    };
  }

  export function QPSTimeseries(props: QPSTimeseriesProps) {
    const {
      series,
      yLabel = "QPS",
      colorMap,
      ariaLabel,
      height = 360,
      loading,
      empty,
      theme = "auto",
    } = props;

    const dark = useChartDark(theme);
    const isEmpty =
      empty ?? (series.length === 0 || series.every((s) => s.points.length === 0));

    const option = useMemo(
      () => themed(buildOption(series, yLabel, colorMap), dark),
      [series, yLabel, colorMap, dark],
    );

    return (
      <ChartFrame ariaLabel={ariaLabel} height={height} loading={loading} empty={isEmpty}>
        <ReactECharts option={option} style={{ height: "100%", width: "100%" }} notMerge lazyUpdate />
      </ChartFrame>
    );
  }
  ```

- [ ] **Step 4: Run the test to verify it passes**

  Run: `pnpm -F @modeldoctor/web test --run src/components/charts/QPSTimeseries.test.tsx`
  Expected: PASS, 5 tests.

- [ ] **Step 5: Update `index.ts` re-exports** — replace the contents of `apps/web/src/components/charts/index.ts` with:

  ```ts
  export { Chart } from "./Chart";
  export type {
    ChartKind,
    ChartProps,
    ChartData,
    ScatterPoint,
    LineBarSeries,
    HeatmapCell,
  } from "./Chart";

  export { PercentileTimeseries } from "./PercentileTimeseries";
  export type {
    PercentileTimeseriesProps,
    PercentileTimeseriesSeries,
    Percentile,
  } from "./PercentileTimeseries";

  export { LatencyCDF } from "./LatencyCDF";
  export type { LatencyCDFProps, LatencyCDFSeries } from "./LatencyCDF";

  export { TTFTHistogram } from "./TTFTHistogram";
  export type {
    TTFTHistogramProps,
    TTFTHistogramSeries,
    HistogramBucket,
  } from "./TTFTHistogram";

  export { QPSTimeseries } from "./QPSTimeseries";
  export type { QPSTimeseriesProps, QPSTimeseriesSeries } from "./QPSTimeseries";

  export { assignRunColors } from "./_shared";
  export type { ChartTheme, DomainChartProps } from "./_shared";
  ```

- [ ] **Step 6: Lint + type-check**

  ```bash
  pnpm -F @modeldoctor/web exec biome check --write src/components/charts/
  pnpm -F @modeldoctor/web type-check
  ```

- [ ] **Step 7: Commit**

  ```bash
  git add apps/web/src/components/charts/QPSTimeseries.tsx \
          apps/web/src/components/charts/QPSTimeseries.test.tsx \
          apps/web/src/components/charts/index.ts
  git commit -m "$(cat <<'EOF'
  feat(web/charts): QPSTimeseries + barrel re-exports

  Adds the fourth domain chart (QPS over time, multi-Run overlay) with
  the same colorMap + DomainChartProps surface as the other three.
  Updates charts/index.ts to re-export every domain component, the
  assignRunColors helper, and DomainChartProps / ChartTheme types so
  consumers (#46 report page, #45 diff view, #48 health) only need a
  single import path.

  Refs #41.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 6: 10k-point perf smoke

**Files:**
- Test: `apps/web/src/components/charts/perf.test.tsx` (new)

- [ ] **Step 1: Create the perf smoke** at `apps/web/src/components/charts/perf.test.tsx`:

  ```tsx
  import { render } from "@testing-library/react";
  import type { CSSProperties } from "react";
  import { describe, expect, it, vi } from "vitest";
  import { LatencyCDF } from "./LatencyCDF";
  import { PercentileTimeseries } from "./PercentileTimeseries";
  import { QPSTimeseries } from "./QPSTimeseries";
  import { TTFTHistogram } from "./TTFTHistogram";

  vi.mock("echarts-for-react", () => ({
    default: ({ style }: { style?: CSSProperties }) => (
      <div data-testid="echart" style={style} />
    ),
  }));

  const N = 10_000;
  const BUDGET_MS = 1000;

  function genTimeseries(n: number): Array<[number, number]> {
    const start = Date.now();
    const out: Array<[number, number]> = new Array(n);
    for (let i = 0; i < n; i++) {
      out[i] = [start + i * 100, Math.random() * 1000];
    }
    return out;
  }

  function genSamples(n: number): number[] {
    const out = new Array<number>(n);
    for (let i = 0; i < n; i++) out[i] = Math.random() * 5000;
    return out;
  }

  function genBuckets(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      lower: i * 10,
      upper: (i + 1) * 10,
      count: Math.floor(Math.random() * 100),
    }));
  }

  describe("chart perf smoke (10k points)", () => {
    it("PercentileTimeseries renders 10k points within budget", () => {
      const t0 = performance.now();
      render(
        <PercentileTimeseries
          ariaLabel="perf"
          series={[
            {
              runId: "r",
              percentiles: { p50: genTimeseries(N), p95: genTimeseries(N) },
            },
          ]}
        />,
      );
      expect(performance.now() - t0).toBeLessThan(BUDGET_MS);
    });

    it("LatencyCDF renders 10k samples within budget", () => {
      const t0 = performance.now();
      render(<LatencyCDF ariaLabel="perf" series={[{ runId: "r", samples: genSamples(N) }]} />);
      expect(performance.now() - t0).toBeLessThan(BUDGET_MS);
    });

    it("TTFTHistogram renders 10k buckets within budget", () => {
      const t0 = performance.now();
      render(
        <TTFTHistogram ariaLabel="perf" series={[{ runId: "r", buckets: genBuckets(N) }]} />,
      );
      expect(performance.now() - t0).toBeLessThan(BUDGET_MS);
    });

    it("QPSTimeseries renders 10k points within budget", () => {
      const t0 = performance.now();
      render(<QPSTimeseries ariaLabel="perf" series={[{ runId: "r", points: genTimeseries(N) }]} />);
      expect(performance.now() - t0).toBeLessThan(BUDGET_MS);
    });
  });
  ```

- [ ] **Step 2: Run the perf smoke**

  Run: `pnpm -F @modeldoctor/web test --run src/components/charts/perf.test.tsx`
  Expected: PASS, 4 tests, each well under 1s in jsdom.

- [ ] **Step 3: Lint + type-check**

  ```bash
  pnpm -F @modeldoctor/web exec biome check --write src/components/charts/
  pnpm -F @modeldoctor/web type-check
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add apps/web/src/components/charts/perf.test.tsx
  git commit -m "$(cat <<'EOF'
  test(web/charts): 10k-point perf smoke for all four domain charts

  jsdom does not render real canvas, so this is a regression guard, not
  a true perf benchmark. It catches accidental O(N²) work in
  buildOption / useMemo misuse / stripped sampling-and-progressive
  knobs. Budget: 1s per component for 10k points.

  Refs #41.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 7: dev-charts feature (page + fixtures)

**Files:**
- Create: `apps/web/src/features/dev-charts/fixtures.ts`
- Create: `apps/web/src/features/dev-charts/DevChartsPage.tsx`
- Create: `apps/web/src/features/dev-charts/index.ts`

- [ ] **Step 1: Create `fixtures.ts`** at `apps/web/src/features/dev-charts/fixtures.ts`:

  ```ts
  import type {
    LatencyCDFSeries,
    PercentileTimeseriesSeries,
    QPSTimeseriesSeries,
    TTFTHistogramSeries,
  } from "@/components/charts";

  const RUN_IDS = ["run-a", "run-b", "run-c"] as const;

  function genTimeseries(
    n: number,
    base: number,
    jitter: number,
  ): Array<[number, number]> {
    const start = Date.now() - n * 100;
    const out: Array<[number, number]> = new Array(n);
    for (let i = 0; i < n; i++) {
      out[i] = [start + i * 100, base + (Math.random() - 0.5) * jitter];
    }
    return out;
  }

  function genSamples(n: number, mean: number, sigma: number): number[] {
    // Box–Muller approximation for a roughly-normal distribution.
    const out = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      const u1 = Math.random() || 1e-9;
      const u2 = Math.random();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      out[i] = Math.max(0, mean + z * sigma);
    }
    return out;
  }

  function genBuckets(centerBin: number, peak: number) {
    return Array.from({ length: 10 }, (_, i) => ({
      lower: i * 50,
      upper: (i + 1) * 50,
      count: Math.max(0, Math.floor(peak - Math.abs(i - centerBin) * 12)),
    }));
  }

  export const RUN_ID_LIST: readonly string[] = RUN_IDS;

  export const fixtures = {
    threeRunPercentile: RUN_IDS.map((id, i): PercentileTimeseriesSeries => ({
      runId: id,
      runLabel: `Run ${i + 1}`,
      percentiles: {
        p50: genTimeseries(50, 100 + i * 10, 30),
        p95: genTimeseries(50, 200 + i * 20, 50),
        p99: genTimeseries(50, 300 + i * 30, 80),
      },
    })),
    threeRunCDF: RUN_IDS.map((id, i): LatencyCDFSeries => ({
      runId: id,
      runLabel: `Run ${i + 1}`,
      samples: genSamples(500, 200 + i * 50, 80),
    })),
    threeRunHistogram: RUN_IDS.map((id, i): TTFTHistogramSeries => ({
      runId: id,
      runLabel: `Run ${i + 1}`,
      buckets: genBuckets(4 + i, 80),
    })),
    threeRunQPS: RUN_IDS.map((id, i): QPSTimeseriesSeries => ({
      runId: id,
      runLabel: `Run ${i + 1}`,
      points: genTimeseries(50, 50 + i * 10, 15),
    })),
    largePercentile: [
      {
        runId: "large",
        runLabel: "10k points",
        percentiles: {
          p50: genTimeseries(10_000, 100, 30),
          p95: genTimeseries(10_000, 200, 50),
        },
      },
    ] satisfies PercentileTimeseriesSeries[],
    largeCDF: [
      { runId: "large", runLabel: "10k samples", samples: genSamples(10_000, 200, 80) },
    ] satisfies LatencyCDFSeries[],
    largeHistogram: [
      {
        runId: "large",
        runLabel: "10k buckets",
        buckets: Array.from({ length: 10_000 }, (_, i) => ({
          lower: i,
          upper: i + 1,
          count: Math.floor(Math.random() * 100),
        })),
      },
    ] satisfies TTFTHistogramSeries[],
    largeQPS: [
      { runId: "large", runLabel: "10k points", points: genTimeseries(10_000, 50, 15) },
    ] satisfies QPSTimeseriesSeries[],
  };
  ```

- [ ] **Step 2: Create `DevChartsPage.tsx`** at `apps/web/src/features/dev-charts/DevChartsPage.tsx`:

  ```tsx
  import {
    LatencyCDF,
    PercentileTimeseries,
    QPSTimeseries,
    TTFTHistogram,
    assignRunColors,
  } from "@/components/charts";
  import type { ReactNode } from "react";
  import { useMemo } from "react";
  import { RUN_ID_LIST, fixtures } from "./fixtures";

  function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
      <section className="space-y-3 border-b border-border pb-6">
        <h2 className="text-base font-semibold">{title}</h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">{children}</div>
      </section>
    );
  }

  function Card({ title, children }: { title: string; children: ReactNode }) {
    return (
      <div className="rounded-md border border-border bg-card p-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">{title}</div>
        {children}
      </div>
    );
  }

  export function DevChartsPage() {
    const colorMap = useMemo(() => assignRunColors(RUN_ID_LIST), []);
    const largeColorMap = useMemo(() => assignRunColors(["large"]), []);

    return (
      <div className="space-y-6 p-6">
        <header>
          <h1 className="text-lg font-semibold">Charts dev demo</h1>
          <p className="text-sm text-muted-foreground">
            Visual QA for the chart layer. Mock data only; remove during the #51 sidebar
            reorganize.
          </p>
        </header>

        <Section title="PercentileTimeseries">
          <Card title="3-Run overlay (50pts)">
            <PercentileTimeseries
              ariaLabel="3-run percentile"
              series={fixtures.threeRunPercentile}
              colorMap={colorMap}
            />
          </Card>
          <Card title="10k points">
            <PercentileTimeseries
              ariaLabel="10k percentile"
              series={fixtures.largePercentile}
              colorMap={largeColorMap}
            />
          </Card>
          <Card title="Loading">
            <PercentileTimeseries ariaLabel="loading" series={[]} loading />
          </Card>
          <Card title="Empty">
            <PercentileTimeseries ariaLabel="empty" series={[]} />
          </Card>
        </Section>

        <Section title="LatencyCDF">
          <Card title="3-Run overlay">
            <LatencyCDF ariaLabel="3-run cdf" series={fixtures.threeRunCDF} colorMap={colorMap} />
          </Card>
          <Card title="10k samples">
            <LatencyCDF
              ariaLabel="10k cdf"
              series={fixtures.largeCDF}
              colorMap={largeColorMap}
            />
          </Card>
          <Card title="Loading">
            <LatencyCDF ariaLabel="loading" series={[]} loading />
          </Card>
          <Card title="Empty">
            <LatencyCDF ariaLabel="empty" series={[]} />
          </Card>
        </Section>

        <Section title="TTFTHistogram">
          <Card title="3-Run overlay">
            <TTFTHistogram
              ariaLabel="3-run hist"
              series={fixtures.threeRunHistogram}
              colorMap={colorMap}
            />
          </Card>
          <Card title="10k buckets">
            <TTFTHistogram
              ariaLabel="10k hist"
              series={fixtures.largeHistogram}
              colorMap={largeColorMap}
            />
          </Card>
          <Card title="Loading">
            <TTFTHistogram ariaLabel="loading" series={[]} loading />
          </Card>
          <Card title="Empty">
            <TTFTHistogram ariaLabel="empty" series={[]} />
          </Card>
        </Section>

        <Section title="QPSTimeseries">
          <Card title="3-Run overlay">
            <QPSTimeseries ariaLabel="3-run qps" series={fixtures.threeRunQPS} colorMap={colorMap} />
          </Card>
          <Card title="10k points">
            <QPSTimeseries
              ariaLabel="10k qps"
              series={fixtures.largeQPS}
              colorMap={largeColorMap}
            />
          </Card>
          <Card title="Loading">
            <QPSTimeseries ariaLabel="loading" series={[]} loading />
          </Card>
          <Card title="Empty">
            <QPSTimeseries ariaLabel="empty" series={[]} />
          </Card>
        </Section>
      </div>
    );
  }
  ```

- [ ] **Step 3: Create `index.ts` barrel** at `apps/web/src/features/dev-charts/index.ts`:

  ```ts
  export { DevChartsPage } from "./DevChartsPage";
  ```

- [ ] **Step 4: Lint + type-check**

  ```bash
  pnpm -F @modeldoctor/web exec biome check --write src/features/dev-charts/
  pnpm -F @modeldoctor/web type-check
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add apps/web/src/features/dev-charts/
  git commit -m "$(cat <<'EOF'
  feat(web/dev-charts): demo page + mock fixtures for chart layer QA

  Per spec, /dev/charts is a permanent dev-only page that renders every
  domain chart across small / 10k / multi-Run / loading / empty
  scenarios. Mock fixtures are pure and approximate-normally-distributed
  so the visuals look like real benchmark data.

  Cleanup obligation: route + sidebar entry removed in #51; fixtures
  shrunk or removed when #46 ships real consumers (recorded in spec).

  Refs #41.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 8: Wire `/dev/charts` route + dev-only sidebar entry

**Files:**
- Modify: `apps/web/src/router/index.tsx:1-30,43-95`
- Modify: `apps/web/src/components/sidebar/sidebar-config.tsx:21-32,95-101`
- Modify: `apps/web/src/components/sidebar/Sidebar.tsx:145-180`
- Modify: `apps/web/src/locales/en-US/sidebar.json`
- Modify: `apps/web/src/locales/zh-CN/sidebar.json`

- [ ] **Step 1: Add the route** — modify `apps/web/src/router/index.tsx`:

  Add this import alongside the others (line 19 area, alphabetized):
  ```ts
  import { DevChartsPage } from "@/features/dev-charts";
  ```

  Add this route to the children array (after the existing `playground/rerank` line, before `path: "*"`):
  ```ts
  { path: "dev/charts", element: <DevChartsPage /> },
  ```

  The route stays defined in production builds (deep-linking works); only the sidebar entry is gated.

- [ ] **Step 2: Add `devOnly` flag to `SidebarItem`** — modify `apps/web/src/components/sidebar/sidebar-config.tsx`. Replace the `SidebarItem` interface (lines 21–26) with:

  ```ts
  export interface SidebarItem {
    to: string;
    icon: LucideIcon;
    labelKey: string; // sidebar:items.X
    comingSoon?: boolean;
    devOnly?: boolean;
  }
  ```

  Add `LineChart` to the lucide-react import block at the top of the file. Append a new group at the end of `sidebarGroups`, just before the closing `];`:

  ```ts
    {
      id: "dev",
      labelKey: "groups.dev",
      items: [
        {
          to: "/dev/charts",
          icon: LineChart,
          labelKey: "items.devCharts",
          devOnly: true,
        },
      ],
    },
  ```

- [ ] **Step 3: Filter dev items in the sidebar component** — modify `apps/web/src/components/sidebar/Sidebar.tsx`. Replace the `{sidebarGroups.map(...)}` block starting at line 146 so the inner items list filters out `devOnly` entries when not in dev. Replace lines 146–179 with:

  ```tsx
        {sidebarGroups.map((group) => {
          const isCollapsed = collapsed[group.id];
          const visibleItems = group.items.filter(
            (item) => !item.devOnly || import.meta.env.DEV,
          );
          if (visibleItems.length === 0) return null;
          return (
            <div key={group.id} className="mb-3">
              {railCollapsed ? (
                <div className="mx-2 mb-1 h-px bg-border/60" aria-hidden />
              ) : (
                <button
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  className="flex w-full items-center justify-between px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                >
                  <span>{t(group.labelKey)}</span>
                  <ChevronDown
                    className={cn("h-3 w-3 transition-transform", isCollapsed && "-rotate-90")}
                    strokeWidth={2}
                  />
                </button>
              )}
              {!railCollapsed && isCollapsed ? null : (
                <div className="mt-1 flex flex-col gap-px">
                  {visibleItems.map((item) => (
                    <ItemRow
                      key={item.to}
                      item={item}
                      t={(k) => t(k)}
                      railCollapsed={railCollapsed}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
  ```

- [ ] **Step 4: Add i18n labels** — modify `apps/web/src/locales/en-US/sidebar.json`:

  Add a `"dev": "Dev"` entry under `"groups"` (between `"debug"` and the closing brace; comma needed). Add `"devCharts": "Charts demo"` under `"items"` (after `"settings"`, comma before).

  Modify `apps/web/src/locales/zh-CN/sidebar.json` similarly: `"dev": "开发"` under `"groups"`, `"devCharts": "图表 Demo"` under `"items"`.

- [ ] **Step 5: Verify in dev**

  ```bash
  pnpm -F @modeldoctor/web exec biome check --write src/
  pnpm -F @modeldoctor/web type-check
  pnpm -F @modeldoctor/web test --run
  ```

  Then start the dev server in the background and confirm `/dev/charts` renders:

  ```bash
  pnpm -F @modeldoctor/web dev &
  # Wait ~3s for vite, then curl the route to confirm 200 + HTML root.
  sleep 3 && curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5173/dev/charts
  # Expected: 200
  # Kill the dev server.
  jobs -p | xargs -r kill
  ```

  (For real visual confirmation, the engineer should also open the URL in a browser; the curl check is a lightweight smoke that the route is mounted.)

- [ ] **Step 6: Commit**

  ```bash
  git add apps/web/src/router/index.tsx \
          apps/web/src/components/sidebar/sidebar-config.tsx \
          apps/web/src/components/sidebar/Sidebar.tsx \
          apps/web/src/locales/en-US/sidebar.json \
          apps/web/src/locales/zh-CN/sidebar.json
  git commit -m "$(cat <<'EOF'
  feat(web/sidebar): wire /dev/charts route with devOnly sidebar gating

  - Adds /dev/charts route (always defined; deep-link works in prod).
  - Adds SidebarItem.devOnly flag and a "dev" group; Sidebar filters
    devOnly items when import.meta.env.DEV is falsy.
  - i18n strings in both locales.

  Cleanup recorded in spec: this group + entry are removed during the
  #51 sidebar reorganize.

  Refs #41.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 9: Final verification + #51 comment + plan retrospective

**Files:** none modified.

- [ ] **Step 1: Full repo-level verify on the branch**

  ```bash
  pnpm -F @modeldoctor/web type-check
  pnpm -F @modeldoctor/web exec biome check src/components/charts/ src/features/dev-charts/ src/router/ src/components/sidebar/ src/locales/
  pnpm -F @modeldoctor/web test --run
  ```

  Expected: type-check clean; biome clean for the directories above (pre-existing failures in `src/features/connections/queries.test.tsx` are out-of-scope and unaffected); all tests pass including the four `*.test.tsx` files for charts, the perf smoke, and `_shared.test.tsx`.

- [ ] **Step 2: Comment cleanup obligations on #51**

  Use the GitHub MCP tool (`mcp__github__add_issue_comment`) to post on issue 51 with this body (Markdown):

  ```markdown
  Cleanup checklist added by #41 (charts layer):

  - [ ] Remove the `dev` sidebar group and the `/dev/charts` sidebar entry from `apps/web/src/components/sidebar/sidebar-config.tsx`.
  - [ ] Remove the `/dev/charts` route from `apps/web/src/router/index.tsx`.
  - [ ] Delete `apps/web/src/features/dev-charts/` (or shrink `fixtures.ts` to a minimal regression set if anything still depends on it after #46 lands).
  - [ ] Drop the `dev` / `devCharts` i18n keys in `apps/web/src/locales/{en-US,zh-CN}/sidebar.json`.
  - [ ] Drop `SidebarItem.devOnly` from `sidebar-config.tsx` and the corresponding `import.meta.env.DEV` filter in `Sidebar.tsx` if no other devOnly entries exist by then.

  Source: `docs/superpowers/specs/2026-05-01-issue-41-charts-design.md` §4.
  ```

  Repo: `weetime/modeldoctor`. Issue number: `51`.

- [ ] **Step 3: Verify the comment landed**

  Use `mcp__github__issue_read` with `method: "get_comments"` on issue 51; the latest comment should be the cleanup checklist above.

- [ ] **Step 4: Status check before push**

  ```bash
  git -C /home/user/modeldoctor log --oneline ^main HEAD
  git -C /home/user/modeldoctor status
  ```

  Expected: ~9 commits on `feat/charts-domain-components` ahead of `main`; working tree clean.

- [ ] **Step 5: STOP — ask the user about push.**

  Per project conventions and the parent system policy, do NOT push without confirmation. Present a summary:

  - Branch: `feat/charts-domain-components`
  - Commits ahead of main: list with `git log --oneline ^main HEAD`
  - All checks: type-check ✓, lint (charts dir) ✓, tests ✓
  - Cleanup obligation: comment on #51 ✓

  Ask: "Push `feat/charts-domain-components` to origin and open a PR? Or hold for additional review first?"

---

## Self-Review Notes

- **Spec coverage check**: every requirement in the spec maps to a task — `assignRunColors` (T1), the three existing components' `colorMap` + tests (T2/T3/T4), `<QPSTimeseries>` + index re-exports (T5), perf smoke (T6), dev demo (T7), routing + sidebar gating (T8), cleanup obligation comment (T9).
- **Placeholder scan**: all code is concrete; all paths are exact; no "TBD" or "implement later".
- **Type consistency**: `PercentileTimeseriesSeries` / `LatencyCDFSeries` / `TTFTHistogramSeries` / `QPSTimeseriesSeries` / `HistogramBucket` / `Percentile` / `DomainChartProps` are the exact symbols re-exported from `index.ts` in T5 and consumed in `fixtures.ts` in T7. The `colorMap` prop has the same shape (`Record<string, string>`) on every component. `assignRunColors` returns `Record<string, string>` which is directly assignable to `colorMap`.
- **Open risk**: T8 step 5 starts a vite dev server in the background and curls the route. If the local environment has port 5173 occupied, the curl will fail — but the test would surface a real conflict and the engineer can pick a different port via `--port`. The full app's dev server is the same one used in normal development, so this is not a privileged operation.
