# Run detail page — chart section (F3 of #88)

**Status:** approved spec, awaiting implementation plan
**Date:** 2026-05-04
**Tracking issue:** #88 (item F3)
**Scope predecessor:** PR #89 (B1/B2 fixes), PR #90 (F4 rerun button)

## Goal

Add a chart section to `RunDetailPage` so terminal-state Runs render distribution
plots, not just summary `MetricCard` numbers. Specifically:

- **guidellm** Run → Latency CDF + TTFT Histogram
- **vegeta** Run → Latency CDF (no TTFT — vegeta has no first-token concept)
- **genai-perf** Run → out of scope for this spec (cut by user 2026-05-04 to keep
  this PR focused; revisit in a follow-up if needed)

The chart layer (`@/components/charts/{LatencyCDF,TTFTHistogram}`) was selected
and validated in `/dev/charts` during PR #66; this spec wires existing charts
to existing data, no new chart selection.

## Non-goals

- Multi-Run overlay on the same chart — that's F1 (`/compare?runs=…`)
- Diff badges on charts — that's F2
- Old-Run backfill — user confirmed dev DB is disposable; old vegeta/guidellm
  Runs without the new derivation path get an empty chart; new Runs work
- Server-side metrics charts (Prometheus / GPU / KV cache) — F5 was cut
- genai-perf charts — cut from this spec, revisit later
- A configurable bin count or bin strategy for the histogram — fixed 30 equal-
  width bins is deliberate

## Architecture

```
Run terminal ─┐
              │
RunDetailPage ┴─→ GET /api/runs/:id/charts ───┬─→ LatencyCDF
                          │                   │
                          │ server-side       └─→ TTFTHistogram (guidellm only)
                          │ derivation
                          │ from rawOutput.files.*
                          ↓
                  { latencyCdf, ttftHistogram }
```

**Why a new endpoint instead of widening `summaryMetrics`?**

`summaryMetrics` is a wire-shape contract consumed by the runs list, the report
view, and (eventually) the diff engine. Stuffing 10k-element sample arrays
into it would balloon every list-page payload. A separate endpoint loads on
demand only when a user opens a detail page, and only for terminal Runs.

**Why server-side derivation instead of shipping raw files to the FE?**

The runner already persists raw report files into `rawOutput.files.*` as
base64-encoded buffers (capped at 50 MB by `OUTPUT_FILE_MAX_BYTES`). Decoding
+ JSON-parsing those in the browser would push 10–50 MB through the wire on
every detail page open. The endpoint reduces that to ~30 KB gzipped per Run
by pre-extracting just the latency samples + histogram buckets.

## Data sources (per tool)

### guidellm

- **File:** `rawOutput.files.report` (base64) → JSON-parse → `report.json`
- **CDF samples:** `benchmarks[0].requests[].request_latency` (seconds → ×1000 ms)
- **TTFT samples:** `benchmarks[0].requests[].time_to_first_token_ms`
- **Bucketing (TTFT):** 30 equal-width bins from `min(samples)` to
  `max(samples)`. Empty buckets included (count=0) so the bar chart shows the
  shape of the distribution rather than a compressed range.

### vegeta

- **File:** `rawOutput.files.latencies` (base64) → UTF-8 decode → NDJSON parse
- Each line is `{"latency": <ns>, "code": …, "timestamp": …, …}`
- **CDF samples:** `latency` field (nanoseconds → ÷1_000_000 ms)
- **TTFT:** N/A (vegeta is request/response, no first-token)

This requires a runner-side change (see "Runner changes" below) to emit
`attack.ndjson` alongside `attack.bin`.

## Runner changes

**File:** `packages/tool-adapters/src/vegeta/runtime.ts` — `buildCommand`

Append `vegeta encode -to=json` to the existing pipeline:

```diff
- const cmd = `cat targets.txt | vegeta attack -rate=${params.rate} -duration=${params.duration}s | tee attack.bin | vegeta report > report.txt`;
+ const cmd = `cat targets.txt | vegeta attack -rate=${params.rate} -duration=${params.duration}s | tee attack.bin | vegeta report > report.txt && vegeta encode -to=json < attack.bin > attack.ndjson`;

  return {
    argv: ["/bin/sh", "-c", cmd],
    env: {},
    secretEnv: {},
    inputFiles: { ... },
    outputFiles: {
      report: "report.txt",
      attack: "attack.bin",
+     latencies: "attack.ndjson",
    },
  };
```

- `vegeta encode` is already in the runner image (`apps/benchmark-runner/images/vegeta.Dockerfile`); no Dockerfile change.
- `attack.bin` stays in `outputFiles` for debugging. Both files contribute to
  the 50 MB cap (`apps/benchmark-runner/runner/main.py::OUTPUT_FILE_MAX_BYTES`)
  but together they're well under it for normal runs (10k requests ≈ 1 MB
  binary + 1 MB NDJSON).
- guidellm and genai-perf runtimes are unchanged.

## API contract

### `GET /api/runs/:id/charts`

**Auth:** existing run-detail guard (per-user ownership)

**Response (200):**

```ts
type RunChartsResponse = {
  latencyCdf: { samples: number[] } | null;
  ttftHistogram: { buckets: HistogramBucket[] } | null;
};
type HistogramBucket = { lower: number; upper: number; count: number };
```

- `latencyCdf` is `null` for unknown tools or when raw files are missing/unparseable
- `ttftHistogram` is `null` for vegeta and for parse failures
- `samples` is in **milliseconds** (matches the `LatencyCDFSeries` chart contract)
- `buckets.lower` / `upper` are in **milliseconds**

**Response (404):** Run not found OR Run not in a terminal state. The FE only
calls this endpoint after `isTerminalStatus(run.status)` is true, so 404-on-
non-terminal is a safety net, not the primary signal.

**Cache headers:** `Cache-Control: private, max-age=86400, immutable`. Terminal
Run data never changes; `private` because per-user. No CDN in front of the API
so no shared-cache concerns.

### Implementation

- **New file:** `apps/api/src/modules/run/run-charts.service.ts`
  - `getCharts(runId, userId): Promise<RunChartsResponse>`
  - `extractGuidellmCharts(rawFiles): RunChartsResponse`
  - `extractVegetaCharts(rawFiles): RunChartsResponse`
  - `bucketize(samples, binCount=30): HistogramBucket[]`
- **New route:** `RunController.getCharts(:id)` → calls service
- **Wire schema:** add `runChartsResponseSchema` to `packages/contracts/src/run.ts`

The service swallows per-tool parse errors (returns the corresponding field as
`null`) so a corrupted TTFT field doesn't kill the latency CDF. Logs the
exception at `warn` level for ops visibility.

## FE changes

### New components

**`apps/web/src/features/runs/reports/RunChartsSection.tsx`**

- Props: `runId: string`, `tool: string`
- Calls `useRunCharts(runId)` (new hook in `queries.ts`)
- Layout: `grid grid-cols-1 lg:grid-cols-2 gap-4`
  - `LatencyCDF` always first
  - `TTFTHistogram` only when `data.ttftHistogram !== null`
  - When only one chart present (vegeta), it spans full width via `lg:col-span-2`
- Loading: each chart's own `loading` prop drives its skeleton
- Empty: `null` data → chart's own `empty` state (existing component)
- Error: top-level alert above the grid

### `useRunCharts(runId)` hook

```ts
// apps/web/src/features/runs/queries.ts
export function useRunCharts(runId: string) {
  return useQuery({
    queryKey: runKeys.charts(runId),
    queryFn: () => runApi.getCharts(runId),
    staleTime: Infinity,            // matches server immutable cache
    enabled: !!runId,
  });
}
```

`runKeys.charts(id) = [...runKeys.detail(id), "charts"] as const`

### `RunDetailPage` wiring

Existing structure (RunDetailPage.tsx:222-234):

```tsx
{isTerminal ? (
  <>
    <section>
      <h3>{t("detail.metrics.title")}</h3>
      <ReportSection metrics={run.summaryMetrics} />
    </section>
    <section>
      <RunDetailRawOutput ... />
    </section>
  </>
) : (
  <RunningSection run={run} />
)}
```

Insert a new section between metrics and raw output:

```tsx
<section>
  <h3>{t("detail.charts.title")}</h3>
  <RunChartsSection runId={run.id} tool={run.tool} />
</section>
```

### i18n strings (`runs.json`)

```jsonc
// zh-CN
"detail.charts.title": "分布图",
"detail.charts.latencyCdfTitle": "延迟分布 (CDF)",
"detail.charts.ttftHistogramTitle": "首 token 延迟分布",
"detail.charts.empty": "暂无图表数据",
"detail.charts.loadError": "图表加载失败"

// en-US
"detail.charts.title": "Distributions",
"detail.charts.latencyCdfTitle": "Latency CDF",
"detail.charts.ttftHistogramTitle": "TTFT Histogram",
"detail.charts.empty": "No chart data",
"detail.charts.loadError": "Failed to load charts"
```

## Testing

### API side

`apps/api/src/modules/run/run-charts.service.spec.ts` — vitest

- guidellm fixture (real `report.json` from
  `apps/benchmark-runner/tests/fixtures/guidellm_report.json` if shape matches,
  otherwise hand-written mini-fixture) → asserts non-empty `latencyCdf.samples`
  + 30-bucket TTFT histogram
- vegeta fixture (synthetic NDJSON with 100 lines) → asserts CDF samples in ms,
  histogram is `null`
- Missing `rawOutput` → both fields `null`, no throw
- Corrupt JSON → field `null`, exception logged
- Wrong tool name (e.g. `e2e`) → both `null`

`apps/api/src/modules/run/run.controller.spec.ts` — add cases

- 200 happy path for vegeta + guidellm
- 404 for missing Run
- 404 for non-terminal Run
- Cache-Control header asserted

### FE side

`apps/web/src/features/runs/reports/__tests__/RunChartsSection.test.tsx` — vitest

- Loading state renders both chart skeletons
- guidellm fixture → both charts render
- vegeta fixture → only LatencyCDF, full-width
- Endpoint 404 → empty alert
- Endpoint network error → loadError alert

### Manual smoke

- Trigger a fresh vegeta Run and a fresh guidellm Run against a local
  `localhost:8000` mock; open detail page; verify charts render with realistic
  shapes (NOT all-zero buckets, NOT a single CDF point).
- Verify `Cache-Control` header in DevTools Network tab.

## File map

**New:**
- `apps/api/src/modules/run/run-charts.service.ts`
- `apps/api/src/modules/run/run-charts.service.spec.ts`
- `apps/web/src/features/runs/reports/RunChartsSection.tsx`
- `apps/web/src/features/runs/reports/__tests__/RunChartsSection.test.tsx`
- `docs/superpowers/specs/2026-05-04-runs-detail-charts-design.md` (this file)

**Edited:**
- `packages/tool-adapters/src/vegeta/runtime.ts` — append `vegeta encode` to cmd, add `latencies` to outputFiles
- `packages/tool-adapters/src/vegeta/runtime.spec.ts` — assert new outputFile + new cmd
- `packages/contracts/src/run.ts` — add `runChartsResponseSchema`
- `apps/api/src/modules/run/run.controller.ts` — add `getCharts` route
- `apps/api/src/modules/run/run.module.ts` — wire `RunChartsService`
- `apps/api/src/modules/run/run.controller.spec.ts` — new route cases
- `apps/web/src/features/runs/queries.ts` — add `useRunCharts` + `runKeys.charts`
- `apps/web/src/features/runs/api.ts` — add `getCharts` to `runApi`
- `apps/web/src/features/runs/RunDetailPage.tsx` — insert new section
- `apps/web/src/features/runs/__tests__/RunDetailPage.test.tsx` — assert section renders
- `apps/web/src/locales/zh-CN/runs.json` + `en-US/runs.json` — chart i18n keys

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Adding `vegeta encode` to the pipeline doubles peak disk usage in the runner pod | 10k-request `attack.bin` ≈ 1 MB; doubling to 2 MB is well under any reasonable disk limit. The 50 MB output-file cap still applies; if violated, the run fails the same way it does today |
| `report.json` per-request array can be large for very long runs (100k+ requests) | The `OUTPUT_FILE_MAX_BYTES` cap (50 MB at `apps/benchmark-runner/runner/main.py`) bounds it. If the file exceeds the cap, `rawOutput.files.report` is absent → service returns `null` → empty-state UI |
| 10k-sample CDF blows up FE memory | The chart component already does `sampling: "lttb"` + `progressive: 2000` via ECharts; tested up to 10k samples in `/dev/charts` |
| Browser caches stale data after Run deletion | `Cache-Control: private` keeps it browser-only; deletion-then-re-create with the same id is impossible (cuid). Worst case: a deleted Run's charts stay in cache for 24h, but the detail page itself 404s anyway |
| TTFT samples sometimes missing for failed requests | `time_to_first_token_ms` is null on errored requests; mapper filters them out before bucketing |

## Open follow-ups (not this PR)

- After merge, tick the F3 checkbox in #88 body
- File a follow-up GitHub comment on #88 noting genai-perf charts deferred
- F1 (multi-Run overlay) will reuse `LatencyCDFSeries[]` shape; this spec is
  forward-compatible (single-element array trivially extends to N)
