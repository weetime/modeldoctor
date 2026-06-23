# Per-pod charts → heatmap (report legibility fix) — Plan

> Inline execution. Frontend-only. Off `main` (`feat/per-pod-heatmap`). Layout-grid branch is held separately, not part of this.

**Goal:** Replace the per-pod grouped-bar charts (`pod-traffic-distribution`, `pod-hit-rate`) — which paginate their legend ("1/6") and overlap their value labels with 6 pods × 6 stages — with a readable **heatmap** (pods × stages, color = value, value printed in each cell). Reduce PDF white-space.

**Why:** User feedback (screenshots): the 6-series grouped bars are illegible (label collision, ECharts legend pagination), worst offenders in both on-screen and PDF. A heatmap scales to many pods with no legend and no label overlap.

**Approach:** Rewrite `PodDistributionChart` internals to an ECharts `heatmap` series (keep the public props stable so FigureRenderer barely changes; add an optional `scheme` for per-metric color). Truncate long pod names on the y-axis (pods are long UUIDs). Print-CSS tweak to cut figure white-space. Verify with a real PDF preview, not just classes.

**Files:**
- `apps/web/src/components/charts/PodDistributionChart.tsx` — rewrite render as heatmap; export a pure `buildPodHeatmap(data)` for test.
- `apps/web/src/components/charts/PodDistributionChart.test.ts` (new) — unit-test `buildPodHeatmap`.
- `apps/web/src/features/benchmarks/compare/FigureRenderer.tsx` — pass `scheme="positive"` (hit-rate, green) / `scheme="neutral"` (traffic, blue).
- `apps/web/src/styles/primer-report.css` — print: shorter figures / allow oversized figures to break, to cut page gaps.

---

## Task 1: `buildPodHeatmap` helper + test

**Files:** `PodDistributionChart.tsx` (export helper), `PodDistributionChart.test.ts` (new).

- [ ] Add to `PodDistributionChart.tsx` (module scope, exported):

```ts
export interface PodHeatmap {
  stages: string[];
  pods: string[];
  /** [stageIndex, podIndex, value] for ECharts heatmap. */
  cells: [number, number, number][];
  min: number;
  max: number;
}

/** Pivot per-stage pod values into a stage×pod matrix for a heatmap.
 * Pods are collected across all stages (first-seen order); a pod missing from
 * a stage simply produces no cell (renders blank). */
export function buildPodHeatmap(data: PodDistributionDatum[]): PodHeatmap {
  const pods: string[] = [];
  for (const d of data) for (const p of d.pods) if (!pods.includes(p.pod)) pods.push(p.pod);
  const stages = data.map((d) => d.stage);
  const cells: [number, number, number][] = [];
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  data.forEach((d, xi) => {
    for (const p of d.pods) {
      const yi = pods.indexOf(p.pod);
      if (yi < 0) continue;
      cells.push([xi, yi, p.value]);
      if (p.value < min) min = p.value;
      if (p.value > max) max = p.value;
    }
  });
  if (!Number.isFinite(min)) min = 0;
  if (!Number.isFinite(max)) max = 1;
  return { stages, pods, cells, min, max };
}
```

- [ ] Test `PodDistributionChart.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildPodHeatmap } from "./PodDistributionChart";

describe("buildPodHeatmap", () => {
  it("pivots stages × pods into cells with min/max", () => {
    const hm = buildPodHeatmap([
      { stage: "OFF", pods: [{ pod: "p1", value: 10 }, { pod: "p2", value: 30 }] },
      { stage: "ON", pods: [{ pod: "p1", value: 20 }, { pod: "p2", value: 40 }] },
    ]);
    expect(hm.stages).toEqual(["OFF", "ON"]);
    expect(hm.pods).toEqual(["p1", "p2"]);
    expect(hm.cells).toHaveLength(4);
    expect(hm.cells).toContainEqual([0, 0, 10]);
    expect(hm.cells).toContainEqual([1, 1, 40]);
    expect(hm.min).toBe(10);
    expect(hm.max).toBe(40);
  });
  it("omits a cell for a pod missing from a stage", () => {
    const hm = buildPodHeatmap([
      { stage: "OFF", pods: [{ pod: "p1", value: 5 }] },
      { stage: "ON", pods: [{ pod: "p1", value: 6 }, { pod: "p2", value: 7 }] },
    ]);
    expect(hm.pods).toEqual(["p1", "p2"]);
    expect(hm.cells).toHaveLength(3); // p2 absent from OFF
  });
  it("handles empty input", () => {
    const hm = buildPodHeatmap([]);
    expect(hm.cells).toHaveLength(0);
    expect(hm.min).toBe(0);
    expect(hm.max).toBe(1);
  });
});
```

- [ ] Run: `pnpm -F @modeldoctor/web exec vitest run PodDistributionChart.test` → PASS.
- [ ] Commit: `feat(web): buildPodHeatmap pivot for per-pod heatmap`.

## Task 2: PodDistributionChart → heatmap render

**Files:** `PodDistributionChart.tsx`.

- [ ] Add `scheme?: "positive" | "neutral"` to props (default `"neutral"`).
- [ ] Replace the `option` useMemo body: build via `buildPodHeatmap(data)`, render an ECharts `heatmap` series. Key option pieces:
  - `xAxis`: `{ type: "category", data: hm.stages, axisLabel: { rotate: hm.stages.length > 4 ? 30 : 0, color, fontSize: 11, interval: 0 } }`
  - `yAxis`: `{ type: "category", data: hm.pods.map(shortPod), axisLabel: { color, fontSize: 11 } }` where `shortPod(name)` = name ≤ 14 chars ? name : `…${name.slice(-10)}`.
  - `visualMap`: `{ min: hm.min, max: hm.max, calculable: false, show: true, orient: "horizontal", left: "center", bottom: 4, itemHeight: 10, itemWidth: 120, inRange: { color: scheme === "positive" ? ["#e9f5ec", "#3fa45b"] : ["#eaf2fb", "#4a8fd1"] }, text: [`${hm.max.toFixed(0)}${unit}`, `${hm.min.toFixed(0)}${unit}`], textStyle: { color: lc.baseline, fontSize: 10 } }`
  - `series`: `[{ type: "heatmap", data: hm.cells, label: { show: true, color: "#1f2328", fontSize: 11, formatter: (p) => `${(p.value[2] as number).toFixed(0)}${unit}` }, itemStyle: { borderColor: "#ffffff", borderWidth: 1 }, emphasis: { itemStyle: { borderColor: "#1f2328" } } }]`
  - `tooltip`: `{ position: "top", formatter: (p) => `${hm.pods[p.value[1]]} @ ${hm.stages[p.value[0]]}: ${(p.value[2]).toFixed(1)}${unit}` }` (full pod name in tooltip).
  - `grid`: `{ left: 90, right: 16, top: 12, bottom: 44 }` (room for long-ish y labels + bottom visualMap).
  - Keep `themed(option, tokens)`.
- [ ] Height scales with pod count: replace `height = 300` default usage — compute `const h = Math.max(220, hm.pods.length * 34 + 120)` and pass to `ChartFrame` (keep the `height` prop as an override; default to computed).
- [ ] The light-report-palette `POD_PALETTE` and legend logic are removed (heatmap uses visualMap, no legend).
- [ ] Run: `pnpm -F @modeldoctor/web type-check` → PASS.
- [ ] Commit: `feat(web): render per-pod charts as a heatmap (no legend pagination / label overlap)`.

## Task 3: FigureRenderer — per-metric color scheme

**Files:** `FigureRenderer.tsx`.

- [ ] In the `pod-traffic-distribution` branch's `<PodDistributionChart …>` add `scheme="neutral"` (share = evenness, neutral blue).
- [ ] In the `pod-hit-rate` branch add `scheme="positive"` (higher = better, green).
- [ ] Run: `pnpm -F @modeldoctor/web test -- FigureRenderer` → existing pod tests still pass (the figure still renders, just a heatmap now; tests assert the figure is present, not bar-specific internals — verify, adjust only if a test asserts bar series).
- [ ] Commit: `feat(web): color per-pod heatmaps by metric (hit-rate green, share neutral)`.

## Task 4: PDF white-space — print figure tweak

**Files:** `primer-report.css` (`@media print` block).

- [ ] In the print block, allow a figure taller than the page to break instead of jumping (cuts the gap), and tighten figure print spacing. Change the `.pr-figure … { break-inside: avoid }` group so figures use `break-inside: auto` while cards/callouts/tables keep `avoid`:

```css
  /* Cards / callouts / small tables: keep together. */
  .primer-report .pr-card,
  .primer-report .pr-callout,
  .primer-report .pr-sec table,
  .primer-report pre {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  /* Figures can be tall; let an oversized one flow across a page break rather
     than jumping to the next page and leaving a big gap. */
  .primer-report .pr-figure {
    break-inside: auto;
    page-break-inside: auto;
    margin: 8px 0;
  }
```

- [ ] Run: `pnpm -F @modeldoctor/web lint` → PASS (watch noDescendingSpecificity; if it fires, prefix the new figure selector to match existing specificity).
- [ ] Commit: `fix(web): let tall figures break across print pages to cut PDF white-space`.

## Final verification (REQUIRED — real render + PDF, not just classes)

- [ ] `pnpm -F @modeldoctor/web type-check && pnpm -F @modeldoctor/web lint && pnpm -F @modeldoctor/web test` → all green.
- [ ] Start dev (web+api, single session), Playwright to a real LB report (`/reports/cmqp9wyl700035xxt979n94ge`, owned by weetime). Screenshot on-screen: per-pod figures now heatmaps, value in each cell, no "1/6" pager, no label overlap.
- [ ] **PDF check:** emulate print media (`page.emulateMedia({ media: 'print' })`) or `page.pdf(...)`, capture — confirm the heatmaps render and white-space is reduced vs the earlier screenshots. If white-space persists materially, report it honestly as a remaining print-layout limitation.
- [ ] Kill dev server. Final whole-branch review, then push + PR.

## Notes / risk
- Pod names are long UUIDs → y-axis truncates (`shortPod`), full name in tooltip. Verify the truncation reads OK.
- A single-stage or single-pod report still renders (1×N or N×1 heatmap) — fine.
- This does NOT touch the schema/backend/availability; `readPodDistribution` data feeds the heatmap unchanged.
</content>
