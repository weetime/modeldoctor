# Run compare page + diff verdict badges (F1 + F2 of #88)

**Status:** approved spec, awaiting implementation plan
**Date:** 2026-05-04
**Tracking issue:** #88 (items F1 + F2)
**Predecessors:** PR #89 (B1/B2 fixes; multi-tool metric extractors), PR #90 (F4 rerun), PR #91 (F3 charts)

## Goal

Add multi-Run comparison capability to ModelDoctor:

- **F1**: a `/runs/compare?ids=…` page that side-by-side compares 2..N selected Runs in a metric × Run grid
- **F2**: pure-frontend diff verdict (`regressed | improved | unchanged`) badges on three core metrics (latency p95, error rate, throughput), shown both on the new compare page (against a user-selectable baseline) and on the existing detail page (against `Run.baselineId`)

Threshold semantics from #88: `p95 +10% / errorRate +0.5pp / throughput -5%` triggers `regressed` (and the symmetric improvements trigger `improved`); anything inside the band is `unchanged`.

No new API endpoint, no new DB column. The frontend already receives `summaryMetrics` for every Run via `GET /api/runs/:id`; verdict is computed in the browser from those numbers.

## Non-goals

- Server-side `GET /runs/:id/diff` endpoint — pure frontend computation suffices; revisit only when per-baseline custom thresholds become a real requirement
- Multi-baseline comparison (compare against more than one baseline simultaneously)
- Cross-tool comparison (e.g. vegeta vs guidellm) — Compare button disabled when selection mixes tools
- Chart rendering on the compare page (no Latency CDF / TTFT histogram in the grid; details remain on the per-Run detail page from F3)
- Persisted "Saved Compares" objects — sharing is via URL since `?ids=…&baseline=…` carries all state
- Sortable / collapsible / draggable rows in the grid — YAGNI

## Architecture

```
RunListPage (multi-select state already exists from PR #89)
    ├── selection size 0-1            → Compare button disabled
    ├── selection ≥2, mixed tools     → Compare button disabled (new tooltip)
    └── selection ≥2, same tool       → Compare button enabled
            ↓ onClick
        navigate('/runs/compare?ids=a,b,c,d')

RunComparePage
    ├── parse URL: ids[] + optional baseline
    ├── fetch each Run via existing useRunDetail hook (react-query cache hits)
    ├── verify all same tool (defensive — list page already filtered)
    ├── default baseline = first selected Run that has baselineFor !== null,
    │   else "None" (no verdict badges, just a plain side-by-side view)
    └── render <CompareToolbar baseline=…/> + <CompareGrid runs=… verdict=…/>

verdict.ts (pure module, zero React)
    ├── VERDICT_THRESHOLDS = { latencyPct: 0.10, errorRatePp: 0.005, throughputPct: 0.05 }
    └── three pure functions: verdictForLatency / verdictForErrorRate / verdictForThroughput

RunDetailPage (existing, terminal state branch)
    └── if run.baselineId !== null → render <DetailVerdictRow runId baselineId/>
        which fetches the baseline run and renders 3 verdict badges using the same verdict.ts
```

**No backend change.** Reusing `GET /api/runs/:id` for both the compare-page run fetches and the detail-page baseline fetch.

## Scope decisions (from brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| 2-Run vs N-Run | N-Run with one optional baseline (Q1 → option 3) | Covers 2-Run as a degenerate case; baseline is opt-in |
| Baseline required? | No — default `None`, dropdown lets user select (Q2 / Q3) | "Just compare these runs" is the common case; verdicts are opt-in |
| Diff computation location | Pure frontend (Q4 → option 1) | summaryMetrics already in browser; thresholds are constants; no per-baseline overrides yet |
| Layout style | Grid table — metric rows × Run columns (Q5 → option A) | All metrics on one screen; cross-Run scan of any one metric is direct |
| Cross-tool support | Disallowed — Compare button gated on same-tool selection (Q6 → option 1) | Cross-tool metric semantics don't align; revisit if user demand emerges |
| Metric coverage in grid | Full per-tool metrics (Q7 → option 3) | Not just verdict-eligible 3; show every field the user might care about |

## Routing

### New route

`apps/web/src/router/index.tsx` — add inside the existing `<Route path="runs">` children block:

```tsx
{ path: "compare", element: <RunComparePage /> }
```

Placed before the `:id` route's children so the literal `compare` segment is matched first (no ambiguity since `compare` is not a valid cuid prefix).

### URL shape

```
/runs/compare?ids=<cuid>,<cuid>,<cuid>&baseline=<cuid>
```

- `ids` (required): comma-separated cuids; order is preserved (left-to-right column order)
- `baseline` (optional): one of the cuids in `ids`; setting via dropdown writes through `setSearchParams` so URL stays canonical

### Empty / error states

| URL state | Render |
|---|---|
| `?ids` missing or has 0 elements | `<EmptyState>` "Select 2+ Runs from the list to compare" + Back to list link |
| `?ids` has exactly 1 element | Same EmptyState, "At least 2 Runs are required" |
| One of the ids 404s (deleted / cross-user) | Top-of-page Alert "{{failed}} Run(s) no longer accessible — comparing the remaining N". Grid renders only when ≥2 Runs survive — a single-Run grid carries no comparison value, so when only 1 survives the alert is shown but the grid is hidden (user can use the back link to return to list and re-select) |
| All Runs are different tools | Top-of-page Alert "Compare requires the same tool. Selected: guidellm × 2 + vegeta × 1." + no grid |
| `baseline` is not in `ids` | Silently treat as `None` (no Alert; minor edge case from URL editing) |

## Compare button behavior

`apps/web/src/features/runs/RunListPage.tsx` — the existing `<Button>` for compare currently has `disabled={true}` always; change to:

| Selection | `disabled` | Tooltip i18n key |
|---|---|---|
| 0 or 1 selected | `true` | `runs.compareDisabledNeedTwo` |
| ≥2 same tool | `false` (new `onClick` → navigate) | none (button enabled) |
| ≥2 mixed tools | `true` | `runs.compareDisabledMixedTools` (interpolated with the tool counts) |

The existing single-key `compareDisabledTooltip` is removed (it was a placeholder pointing at #88 anyway). Both new keys take an interpolation argument.

## Verdict computation

### Thresholds (`apps/web/src/features/runs/compare/verdict.ts`)

```ts
export const VERDICT_THRESHOLDS = {
  // higher is worse (latency)
  latencyPct: 0.10,
  // higher is worse (error rate); absolute percentage points, not ratio
  errorRatePp: 0.005,
  // higher is better (throughput)
  throughputPct: 0.05,
} as const;

export type Verdict = "regressed" | "improved" | "unchanged";
```

### Verdict-eligible fields

Three core fields get a colored verdict badge. All other metric rows in the grid show plain numbers + a gray Δpct text (no color, no icon).

| Field | guidellm reader | vegeta reader | genai-perf reader | Direction |
|---|---|---|---|---|
| Latency p95 (ms) | `e2eLatency.p95` | `latencies.p95` | `requestLatency.p95` | higher worse |
| Error rate (0–1 ratio) | `requests.error / requests.total` | `1 - success/100` | N/A — show `—` | higher worse |
| Throughput | `requestsPerSecond.mean` (req/s) | `requests.throughput` (req/s) | `requestThroughput.avg` (req/s) | higher better |

genai-perf has no error rate field in its schema; that grid cell renders `—` and verdict is skipped.

### Algorithms (pure functions)

```ts
export function verdictForLatency(baseline: number, current: number): Verdict {
  if (baseline === 0) return "unchanged";
  const pct = (current - baseline) / baseline;
  if (pct >= VERDICT_THRESHOLDS.latencyPct) return "regressed";
  if (pct <= -VERDICT_THRESHOLDS.latencyPct) return "improved";
  return "unchanged";
}

export function verdictForErrorRate(baseline: number, current: number): Verdict {
  const pp = current - baseline;
  if (pp >= VERDICT_THRESHOLDS.errorRatePp) return "regressed";
  if (pp <= -VERDICT_THRESHOLDS.errorRatePp) return "improved";
  return "unchanged";
}

export function verdictForThroughput(baseline: number, current: number): Verdict {
  if (baseline === 0) return "unchanged";
  const pct = (current - baseline) / baseline;
  if (pct <= -VERDICT_THRESHOLDS.throughputPct) return "regressed";
  if (pct >= VERDICT_THRESHOLDS.throughputPct) return "improved";
  return "unchanged";
}
```

`baseline === 0` guard: latency and throughput shouldn't be 0 in a successful Run, but error rate often is — and the symmetric `current === 0 ∧ baseline === 0` case is `unchanged` either way; the guard just avoids the division.

### Visual

- **regressed** — `text-destructive` foreground; icon `TrendingUp` for latency/error (going up = bad), `TrendingDown` for throughput
- **improved** — `text-green-700` (or theme-equivalent); inverse icons
- **unchanged** — `text-muted-foreground`; `Minus` icon (or no icon for compactness)

Badge text format: `±X.X% ↑` (latency / throughput) or `±X.Xpp ↑` (error rate). Sign always shown.

## Component decomposition

### New files

```
apps/web/src/features/runs/compare/
├── RunComparePage.tsx              # route component; URL parsing; multi-Run fetch; layout
├── CompareToolbar.tsx              # baseline dropdown; back link; tool indicator
├── CompareGrid.tsx                 # the metric × Run table; receives precomputed verdict matrix
├── MetricRow.tsx                   # one row (one metric across all Runs); decides cell rendering
├── VerdictBadge.tsx                # { verdict, deltaText } → styled span with icon
├── DetailVerdictRow.tsx            # used on RunDetailPage when run.baselineId !== null
├── verdict.ts                      # thresholds + three pure verdict functions
├── metrics.ts                      # per-tool metric extractors (factored out from RunListPage readers)
└── __tests__/
    ├── verdict.test.ts             # ~12 cases: 3 funcs × (regressed/improved/unchanged + edge cases)
    ├── metrics.test.ts             # ~6 cases: 3 readers × 3 tools; vegeta unit conversion; null on missing
    ├── RunComparePage.test.tsx     # ~6 cases: happy 2-Run / 4-Run / no ids / 1 id / mixed tools / one 404
    ├── CompareGrid.test.tsx        # ~3 cases: baseline column highlight / None hides badges / re-rerender on baseline change
    ├── VerdictBadge.test.tsx       # ~3 cases: each verdict color + icon
    └── DetailVerdictRow.test.tsx   # ~3 cases: with baseline / without / baseline fetch error
```

### Modified files

```
apps/web/src/router/index.tsx                              # add /runs/compare route
apps/web/src/features/runs/RunListPage.tsx                 # Compare button onClick + tri-state disabled
apps/web/src/features/runs/__tests__/RunListPage.test.tsx  # +3 cases (0/1/≥2 same/mixed selection)
apps/web/src/features/runs/RunDetailPage.tsx               # mount <DetailVerdictRow> when baselineId !== null
apps/web/src/features/runs/__tests__/RunDetailPage.test.tsx # +1 case (renders verdict row when baseline linked)
apps/web/src/locales/en-US/runs.json                       # add compare.* and detail.verdict.* namespaces
apps/web/src/locales/zh-CN/runs.json                       # same
docs/superpowers/specs/2026-05-04-runs-compare-diff-design.md   # this file
```

### Key architectural points

- **`verdict.ts` is pure.** Zero React imports. Vitest only; no RTL needed.
- **`metrics.ts` factors out the existing `readP95` / `readErrorRate` / `readThroughput`** from `RunListPage.tsx` (they live as local helpers there today after PR #89). Both the list page and the compare page import from `metrics.ts`. This is the "improving code we're touching" guideline — leaves the codebase cleaner without unrelated refactoring.
- **`CompareGrid` is presentational only.** It receives `runs: Run[]`, `baselineId: string | null`, and `verdictMatrix: Record<runId, Record<metric, Verdict>>`; doesn't know how the matrix was computed. `RunComparePage` calls `useMemo` to compute the matrix once whenever runs/baseline change.
- **`DetailVerdictRow` is pure presentation around one `useRunDetail(baseline.runId)` call** (assuming `Run.baselineId` is the Baseline.id, which then has `.runId` pointing to the baseline-marked Run; verify in implementation against the Prisma schema and adjust if the indirection differs).

### URL state via React Router

`useSearchParams()` with two params (`ids`, `baseline`). Setting baseline writes `setSearchParams({ ids, baseline })` so refresh / share preserves the user's selection.

## i18n keys (new)

```jsonc
// runs.json

"compare": {
  "title": "Compare Runs",
  "subtitle": "{{n}} runs • {{tool}}",
  "back": "Back to list",
  "baselineLabel": "Baseline",
  "baselineNone": "None (no verdict)",
  "baselineMissing": "{{failed}} Run(s) no longer accessible — comparing the remaining {{n}}",
  "mixedToolsAlert": "Compare requires the same tool. Selected: {{summary}}",
  "needTwoEmpty": "Select 2+ Runs from the list to compare",
  "metricRowLabel": {
    "latencyP50": "Latency p50 (ms)",
    "latencyP95": "Latency p95 (ms)",
    "latencyP99": "Latency p99 (ms)",
    "errorRate": "Error rate",
    "throughput": "Throughput (req/s)",
    "ttftP95": "TTFT p95 (ms)",
    "ttftP50": "TTFT p50 (ms)",
    "itlP95": "ITL p95 (ms)",
    "successCount": "Successful requests",
    "errorCount": "Errored requests",
    "concurrencyMean": "Concurrency (mean)",
    "outputTokensPerSecond": "Output TPS"
    // exact label set is the union of fields any selected tool exposes;
    // metrics.ts owns the canonical list and label mapping
  },
  "verdict": {
    "regressed": "regressed",
    "improved": "improved",
    "unchanged": "unchanged"
  }
},

// existing key → split into two
"compareDisabledTooltip": (removed),
"compareDisabledNeedTwo": "Select at least 2 Runs to compare",
"compareDisabledMixedTools": "Compare requires the same tool ({{summary}})",

// detail page additions
"detail.verdict": {
  "title": "vs baseline",
  "loading": "Loading baseline…",
  "loadError": "Could not load baseline for comparison"
}
```

zh-CN gets parallel translations.

## Testing matrix

| Layer | File | Cases | What it locks down |
|---|---|---|---|
| Pure logic | `verdict.test.ts` | ~12 | Each of 3 functions × regressed/improved/unchanged + boundary (exactly threshold) + baseline=0 |
| Pure logic | `metrics.test.ts` | ~6 | All 3 readers across all 3 tools; vegeta success-percent inversion; null on missing field |
| Component | `VerdictBadge.test.tsx` | ~3 | Color class + icon per verdict |
| Component | `CompareGrid.test.tsx` | ~3 | Baseline column highlight; baseline=None hides badges; baseline change re-renders matrix |
| Page | `RunComparePage.test.tsx` | ~6 | happy 2-Run / 4-Run / no ids / 1 id / mixed tools / one Run 404 |
| Page | `DetailVerdictRow.test.tsx` | ~3 | With baseline / without / baseline fetch error |
| Existing | `RunListPage.test.tsx` (+3) | 3 | Tri-state Compare button disabled |
| Existing | `RunDetailPage.test.tsx` (+1) | 1 | Verdict row renders when baselineId set |

`@/lib/api-client` mocked at the top of every page test (sequential `mockResolvedValueOnce` for each Run fetched, same pattern as F3's RunDetailPage tests).

No `@/components/charts` mocking needed — compare page does not render charts.

## File map summary

**New (14):** see `apps/web/src/features/runs/compare/` listing above (8 source files + 6 test files).

**Modified (8):** router, RunListPage + test, RunDetailPage + test, en-US/zh-CN runs.json, this spec.

**No backend, contracts, or Prisma changes.**

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| User selects ≥2 Runs across tools, hits Compare anyway via deep link | Page-level Alert + no grid; Compare button gating is the primary defense |
| baseline Run is deleted between page open and dropdown change | `useRunDetail` for that id 404s; dropdown filters it out and falls back to `None`; the page-level "Run no longer accessible" Alert from §"Empty / error states" already surfaces the situation to the user |
| Verdict math overflows on extreme values | Pure division/subtraction on JS numbers; ranges (latency ms, throughput RPS, error 0-1) all stay well within IEEE-754 |
| Refactoring `readP95`/`readErrorRate`/`readThroughput` out of RunListPage breaks list page tests | Tests should be unchanged behavior; if any breaks, that's a real regression to fix |
| Re-running fetches per Run on a 4-Run compare is 4 sequential / parallel API calls | react-query parallelizes them; same-page detail navigation will be cache-hit |

## Open follow-ups

- After merge, tick F1 + F2 checkboxes in #88 body
- File a follow-up if/when the per-baseline custom thresholds become needed (would justify lifting computation server-side and reading thresholds from `Baseline` model)
