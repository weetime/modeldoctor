# Issue #41 — First-class chart layer for benchmark reports

**Status:** Draft — pending user approval
**Date:** 2026-05-01
**Branch:** `feat/charts-domain-components`
**Issue:** [#41 — `[B2] 接入一等图表层（CDF / 直方图 / 时间序列百分位）`](https://github.com/weetime/modeldoctor/issues/41)

ModelDoctor is a benchmark / perf product, so charts are part of the product, not decoration. Today the only chart consumer is `apps/web/src/features/playground/embeddings/EmbeddingsScatter.tsx` (uses the generic `<Chart kind="scatter">`). The benchmark report (#46), diff view (#45), history (#39), and health dashboard (#48) all need real perf-domain charts: percentile time series, latency CDFs, TTFT histograms, QPS time series — each capable of overlaying multiple Runs for regression compare.

This spec adds those four chart components on top of the existing ECharts wrapper, plus a developer-only demo route to verify them visually before downstream consumers (#46, #48) land.

## 1. Purpose and Scope

### 1.1 Problem

Downstream issues need four perf-domain chart shapes that the current `<Chart>` generic does not express idiomatically:

- **Percentile time series** — `p50/p90/p95/p99` lines over time, multi-Run overlay for regression compare.
- **Latency CDF** — cumulative distribution; either raw samples (compute client-side) or pre-bucketed.
- **TTFT histogram** — bucketed counts with bucket alignment across Runs.
- **QPS time series** — single value (qps) over time, multi-Run overlay.

Each downstream consumer would otherwise duplicate the same `buildOption(...)` + theme + multi-Run color management code. There is also no mechanism today to keep the same Run a stable color across charts on the same page (Run A blue in CDF, green in histogram → broken UX).

### 1.2 What this spec delivers

- **Four domain components** under `apps/web/src/components/charts/`, each:
  - Accepts a `series` array shaped per its purpose.
  - Accepts a `colorMap?: Record<runId, string>` for cross-chart Run color stability.
  - Renders loading / empty / charted states via a shared `<ChartFrame>`.
  - Reuses the existing `theme.ts` palette and dark-mode detection.
- **Shared module `_shared.tsx`** owns:
  - Idempotent ECharts module registration (line, bar, grid, tooltip, legend, dataZoom, canvas renderer).
  - `useChartDark()` theme hook (mirrors current `<Chart>` logic).
  - `themed(option, dark)` apply.
  - `<ChartFrame>` loading/empty wrapper with `role="status"` + `aria-label`.
  - **`assignRunColors(runIds: string[]): Record<runId, string>`** palette helper.
  - `DomainChartProps` base type (`ariaLabel`, `height`, `loading`, `empty`, `theme`).
- **Dev-only demo route `/dev/charts`** (`apps/web/src/features/dev-charts/`):
  - One section per component with mock fixtures across scenarios: small data, 10k points, 3-Run overlay, loading skeleton, empty state.
  - Mounted in sidebar only when `import.meta.env.DEV` is truthy.
  - Lets a developer eyeball the perf claim and visual correctness before #46 ships real consumers.
- **Vitest perf smoke** asserts each component mounts a 10k-point dataset within a budget (1s) without throwing — guards against accidental O(N²) regressions.
- **`assignRunColors` palette helper**: deterministic round-robin over the existing 8-color palette in `theme.ts`. Same input → same output (call site can rely on stability across renders).

### 1.3 Explicit non-goals

- **No coupling to `@modeldoctor/contracts`.** Components own their input shape; the mapper from `Run.canonicalReport` to chart props is the consumer's responsibility (#46 will write it). #38's canonical schema is still in flux; binding now would force concurrent edits.
- **No refactor of existing `<Chart>` wrapper.** It keeps serving the embeddings scatter use case unchanged. New domain components live alongside it, sharing only the registration + theme primitives via `_shared.tsx`.
- **No `markLine` thresholds, no brush selections, no live data subscriptions.** These are real product needs but belong to #46 / #45 / #43. This spec ships the rendering primitives only.
- **No E2E / Playwright.** The repo doesn't run browser E2E; vitest + jsdom + a manual dev route is the convention.
- **No new charting library.** ECharts is already chosen and tree-shaken in `Chart.tsx`; we extend that registration in `_shared.tsx` rather than swapping libraries.
- **No real backend data.** The dev route uses pure local mock fixtures.

### 1.4 Why one PR

All four components share `_shared.tsx`; landing them separately would mean three PRs each touching the same shared module. The dev route + perf smoke verify the whole batch together. One feature branch, logically grouped commits.

## 2. Architecture

### 2.1 Module layout

```
apps/web/src/components/charts/
├── Chart.tsx                       # existing, untouched
├── Chart.test.tsx                  # existing, untouched
├── theme.ts                        # existing, untouched
├── index.ts                        # MODIFY: re-export new components + helpers
├── _shared.tsx                     # MODIFY: add assignRunColors + DomainChartProps
├── PercentileTimeseries.tsx        # MODIFY: accept colorMap
├── PercentileTimeseries.test.tsx   # NEW
├── LatencyCDF.tsx                  # MODIFY: accept colorMap
├── LatencyCDF.test.tsx             # NEW
├── TTFTHistogram.tsx               # MODIFY: accept colorMap
├── TTFTHistogram.test.tsx          # NEW
├── QPSTimeseries.tsx               # NEW
├── QPSTimeseries.test.tsx          # NEW
└── perf.test.tsx                   # NEW (10k-point smoke per component)

apps/web/src/features/dev-charts/
├── DevChartsPage.tsx               # NEW
├── fixtures.ts                     # NEW (mock data per scenario)
└── index.ts                        # NEW
```

Routes / sidebar wiring is in whatever file the existing app router and sidebar use (resolved during plan, gated on `import.meta.env.DEV`).

### 2.2 Component responsibilities

| Component | Series item shape | Renders | Multi-Run |
|---|---|---|---|
| `<PercentileTimeseries>` | `{ runId, runLabel?, percentiles: { p50?, p90?, p95?, p99? }: Array<[tsMs, valueMs]> }` | line, time x-axis, value y-axis (ms), LTTB sampling, dataZoom | one line per `(run × percentile)`; legend `runLabel · pXX` when multi-Run, just `pXX` when single-Run |
| `<LatencyCDF>` | `{ runId, runLabel?, samples?: number[], cdf?: Array<[ms, frac]> }` | step line, value x-axis (ms), value y-axis (0..1, formatted as %) | one line per Run; samples sorted client-side if `cdf` not provided |
| `<TTFTHistogram>` | `{ runId, runLabel?, buckets: Array<{ lower, upper, count }> }` | grouped bars, category x-axis (`[lo, hi)` labels) | bucket boundaries unioned across Runs, missing bins zero-filled |
| `<QPSTimeseries>` | `{ runId, runLabel?, points: Array<[tsMs, qps]> }` | line, time x-axis, value y-axis (qps), LTTB sampling, dataZoom | one line per Run |

All four implement `DomainChartProps`:

```ts
interface DomainChartProps {
  ariaLabel: string;          // required for accessibility
  height?: number | string;   // default 360
  loading?: boolean;
  empty?: boolean | string;   // string overrides "No data" message
  theme?: "auto" | "light" | "dark";  // default "auto"
}
```

…plus `colorMap?: Record<string, string>` and a `series` array of the per-component shape.

### 2.3 `assignRunColors` semantics

```ts
// _shared.tsx
export function assignRunColors(runIds: string[]): Record<string, string>;
```

- Iterates `runIds` in order; assigns `palette[i % palette.length]` from the existing 8-color base palette.
- Stable: identical input array → identical output map.
- No de-duplication: caller passes unique runIds. (Cheap; if duplicates appear we silently overwrite with the later index — acceptable since unique runIds is a parent-side invariant.)
- Used by consumers like:

  ```tsx
  const runIds = useMemo(() => series.map((s) => s.runId), [series]);
  const colorMap = useMemo(() => assignRunColors(runIds), [runIds]);
  // pass colorMap to every chart on the page
  ```

### 2.4 `colorMap` consumption inside components

When `colorMap` is provided, each generated ECharts series sets `itemStyle.color` (and `lineStyle.color` for line series) from `colorMap[runId]`. When absent, ECharts falls back to the theme's default palette order (current behavior). For `<PercentileTimeseries>` (one Run → multiple percentiles), all percentile lines for that Run share the same Run color but vary `lineStyle.opacity` per percentile (`p50: 1.0, p90: 0.8, p95: 0.6, p99: 0.45`) so they remain visually distinguishable while keeping the Run identity. (We don't use `lineStyle.type` because ECharts only supports `solid | dashed | dotted` — three values for four percentiles.)

### 2.5 Data flow

```
Parent (e.g. ReportPage)
  ├─ runs: Run[]                         (from #38 canonical, opaque to charts)
  ├─ series = runs.map(toLatencySamples) (parent-owned mapper)
  ├─ runIds = series.map((s) => s.runId)
  ├─ colorMap = assignRunColors(runIds)
  └─ <LatencyCDF series={...} colorMap={colorMap} ariaLabel="Latency CDF" />

LatencyCDF
  ├─ useChartDark(theme) → dark
  ├─ useMemo(buildOption(series, colorMap), [series, colorMap])
  ├─ themed(option, dark)
  └─ <ChartFrame ariaLabel ...><ReactECharts option={...} /></ChartFrame>
```

### 2.6 Theme integration

`useChartDark()` reads from `useThemeStore((s) => s.mode)`. Same precedence as today's `Chart.tsx`: explicit `theme` prop wins; otherwise `"system"` consults `prefers-color-scheme`. SSR-safe (`typeof window !== "undefined"` guard kept). `themed(opt, dark)` calls the existing `applyTheme` from `theme.ts` — no new palette work.

## 3. Verification

### 3.1 Unit tests (per component)

Mock `echarts-for-react` exactly like the existing `Chart.test.tsx`:

```ts
vi.mock("echarts-for-react", () => ({
  default: ({ option, style }) => (
    <div data-testid="echart" data-option={JSON.stringify(option)} style={style} />
  ),
}));
```

Each component's `.test.tsx` covers:

- Renders correct number of ECharts series for given input
- Series `type` matches expected (`line` / `bar`)
- `colorMap` correctly applied to series colors when provided
- Empty state renders when `series=[]` or all-empty payload
- Loading state renders when `loading=true`
- `ariaLabel` propagates to the rendered container
- Component-specific:
  - `<PercentileTimeseries>` legend: single-Run uses `pXX`, multi-Run uses `runLabel · pXX`
  - `<LatencyCDF>`: when `samples` given, computed CDF has correct length and final y = 1
  - `<TTFTHistogram>`: bucket alignment unions across Runs and zero-fills missing bins

### 3.2 Perf smoke (`perf.test.tsx`)

One file, four tests (one per component). Each:

1. Generate a 10 000-point dataset (samples / time-series points / buckets, as appropriate).
2. `const t0 = performance.now(); render(<Component series={...} />); const t1 = performance.now();`
3. `expect(t1 - t0).toBeLessThan(1000);`

This is a regression guard, not a real perf benchmark — jsdom doesn't render real canvas. It catches the case where someone introduces O(N²) work in `buildOption` or a misuse of `useMemo`.

The 1s budget assumes the ECharts perf knobs already configured in the line-chart components stay in place: `sampling: "lttb"`, `progressive: 2000`, `progressiveThreshold: 5000`. For `<TTFTHistogram>` (bar) the equivalent is `large: true` + `largeThreshold: 2000`. If a future change strips these, the smoke test will fail and force a conscious decision rather than silent degradation.

### 3.3 Dev demo route

`/dev/charts` is a single page with one section per component. Each section shows the component four ways:

- Single Run, ~50 points (quick visual sanity)
- Three Runs overlaid (verifies `colorMap` + multi-Run rendering)
- 10 000 points, single Run (eyeball the perf claim with real canvas)
- Loading state and empty state side by side

Mock fixtures in `apps/web/src/features/dev-charts/fixtures.ts` are pure functions (`makeLatencySeries(n)` etc.) so the same data shape is reused across components.

The route is gated on `import.meta.env.DEV` at sidebar-entry level; the route itself stays defined (so deep-linking to `/dev/charts` in dev still works) but no production users see the entry. If it were accessed in production it would still render — that's acceptable for a non-secret debug page.

## 4. Cleanup Obligations

These are committed to the spec so they survive past the implementation session:

1. **#51 (sidebar reorganize)** must remove the `/dev/charts` route AND its sidebar entry as part of its sidebar collapse work. A comment is added to #51 with this checklist item linking back to this spec.
2. **#46 (report page)** ships consumers of these components. When it lands, the dev route's mock fixtures should be either deleted or shrunk to a minimal regression set used only by the perf smoke. Tracked as a follow-up note in the #41 PR description (no separate issue — it's tied to #46 ship).

## 5. Out-of-scope (re-statement, for clarity)

- No `@modeldoctor/contracts` dependency
- No refactor of existing `<Chart>` generic
- No `markLine`, `brush`, server-side data
- No E2E / Playwright
- No new charting library
- No production banner / feature flag for `/dev/charts`

## 6. Acceptance Criteria

- [ ] `pnpm -F @modeldoctor/web type-check` passes
- [ ] `pnpm -F @modeldoctor/web lint` passes (no NEW errors; pre-existing errors in `connections/queries.test.tsx` are out-of-scope)
- [ ] `pnpm -F @modeldoctor/web test` passes — all new component tests + perf smoke
- [ ] `apps/web/src/components/charts/index.ts` re-exports the four components and `assignRunColors`
- [ ] Visiting `/dev/charts` in dev shows all four components rendering across the five scenarios
- [ ] `<PercentileTimeseries>` shows distinguishable line styles per percentile when single-color (multi-Run) is in effect
- [ ] Same Run renders with the same color in all four chart types when the same `colorMap` is passed
- [ ] Comment posted on #51 with the cleanup obligation
- [ ] Spec + plan committed under `docs/superpowers/{specs,plans}/`

## 7. Files Touched (high-level — exact paths in plan)

**Create (9):**
- `apps/web/src/components/charts/QPSTimeseries.tsx` (1)
- `apps/web/src/components/charts/{PercentileTimeseries,LatencyCDF,TTFTHistogram,QPSTimeseries}.test.tsx` (4)
- `apps/web/src/components/charts/perf.test.tsx` (1)
- `apps/web/src/features/dev-charts/{DevChartsPage,fixtures,index}.tsx` (3)

**Modify (~6):**
- `apps/web/src/components/charts/_shared.tsx` (add `assignRunColors`)
- `apps/web/src/components/charts/{PercentileTimeseries,LatencyCDF,TTFTHistogram}.tsx` (consume `colorMap`, line-style differentiation in PercentileTimeseries)
- `apps/web/src/components/charts/index.ts` (re-exports)
- App router config (add `/dev/charts` route)
- Sidebar component (add dev-only entry)
