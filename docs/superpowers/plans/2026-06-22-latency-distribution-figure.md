# Latency Distribution Figure (Phase 2 — slice 1) — Implementation Plan

> Executes via superpowers:subagent-driven-development. Checkbox steps.

**Goal:** Add a `latency-distribution` figure (multi-run e2e latency **CDF overlay**) to the SavedCompare deep report, for guidellm/vegeta-based scenarios (inference, gateway).

**Architecture (Approach A — server pre-compute):** `FigureRenderer` is a pure `memo` component and cannot fetch, so distribution data is computed server-side and shipped with the hydrated compare. `getHydrated` already loads each benchmark's `rawOutput`; we call the existing pure `BenchmarkChartsService.extract()` per non-missing benchmark and attach the parsed CDF samples to the hydrated run (downsampled to cap payload). The figure reuses the existing `LatencyCDF` component (already does colored multi-run overlay). **No LLM-prompt data change** — `latency-distribution` is a visual figure; the model only references the refId, gated by availability.

**Tool gating is automatic:** a compare is same-tool (Phase-1 invariant), so `extract()` yields a CDF for all runs (guidellm/vegeta) or none (evalscope/aiperf). Availability requires *every* non-missing run to carry a CDF.

**Worktree:** `/Users/fangyong/vllm/modeldoctor/latency-dist` on `feat/latency-distribution-figure` (set up: deps + .env + prisma generate + build already done).

**Decided:** CDF overlay (reuse `LatencyCDF`), e2e latency only (no TTFT histogram this slice). Downsample cap = 1500 samples/run.

**Key existing pieces:**
- `apps/api/src/modules/benchmark/benchmark-charts.service.ts` — `BenchmarkChartsService.extract({id,tool,status,rawOutput}) → { latencyCdf: {samples}|null, ttftHistogram: {buckets}|null }`. Pure; guidellm/vegeta only.
- `packages/contracts/src/benchmark.ts` — `benchmarkChartsResponseSchema`, `BenchmarkChartsResponse`.
- `apps/web/src/components/charts/LatencyCDF.tsx` — props include `series: {runId, runLabel, samples}[]` (multi-run overlay) + `ariaLabel`, `loading`.
- `apps/api/src/modules/saved-compares/saved-compares.service.ts` — `getHydrated` builds `HydratedBenchmarkRef[]` from `prisma.benchmark.findMany` (rawOutput already loaded).
- Mirror availability: `apps/api/.../metrics.ts` + `apps/web/.../compare/client-metrics.ts`.
- `apps/web/.../compare/to-report-runs.ts` — maps `HydratedBenchmarkRef → ReportRun` (`ReportBenchmarkSnapshot`).
- `apps/web/.../compare/FigureRenderer.tsx` — pure memo; render branch per refId.

---

## Task L1: contract — refId + carry CDF on hydrated run

**Files:** `packages/contracts/src/saved-compares/compare-narrative.ts`, `packages/contracts/src/saved-compares/saved-compares.ts`; test `packages/contracts/src/saved-compares/compare-narrative.spec.ts`.

- [ ] **Step 1** — In `figureRefIdSchema` add `"latency-distribution"` (keep all existing).
- [ ] **Step 2** — In `saved-compares.ts`, add an optional field to `HydratedBenchmarkRef`:
```ts
  /** Pre-computed latency distribution (e2e CDF samples, ms) for guidellm/vegeta
   * runs — server attaches via BenchmarkChartsService so the pure FigureRenderer
   * can draw it without fetching. Null/absent when the tool carries no samples. */
  latencyCdf?: { samples: number[] } | null;
```
- [ ] **Step 3** — Add to `compare-narrative.spec.ts`: `figureRefIdSchema.parse("latency-distribution")` returns it.
- [ ] **Step 4** — `pnpm -F @modeldoctor/contracts test -- compare-narrative.spec && pnpm -F @modeldoctor/contracts build`.
- [ ] **Step 5** — Commit: `feat(contracts): latency-distribution refId + latencyCdf on hydrated run`.

## Task L2: server — attach CDF in getHydrated

**Files:** `apps/api/src/modules/saved-compares/saved-compares.service.ts`, `apps/api/src/modules/saved-compares/saved-compares.module.ts` (wire `BenchmarkChartsService`); test `saved-compares.service.spec.ts`.

- [ ] **Step 1** — READ `benchmark-charts.service.ts` (the `extract` signature + its Nest module/export) and `saved-compares.module.ts`. Ensure `BenchmarkChartsService` is providable to `SavedComparesService` (import its module or add it to providers — follow how other cross-module services are wired in this codebase; if it's not exported from its module, export it).
- [ ] **Step 2** — Inject `BenchmarkChartsService` into `SavedComparesService` constructor.
- [ ] **Step 3** — In `getHydrated`, for each non-missing benchmark `b`, compute and attach a downsampled CDF. Add a module-scope helper:
```ts
const CDF_SAMPLE_CAP = 1500;
/** Evenly downsample to at most CDF_SAMPLE_CAP points (preserves shape, caps payload). */
export function downsampleSamples(samples: number[], cap = CDF_SAMPLE_CAP): number[] {
  if (samples.length <= cap) return samples;
  const step = samples.length / cap;
  const out: number[] = [];
  for (let i = 0; i < cap; i++) out.push(samples[Math.floor(i * step)]);
  return out;
}
```
In the non-missing branch of the `hydratedBenchmarks` map, after building the ref, set:
```ts
      latencyCdf: (() => {
        const charts = this.charts.extract({ id: b.id, tool: b.tool, status: b.status, rawOutput: b.rawOutput });
        return charts.latencyCdf ? { samples: downsampleSamples(charts.latencyCdf.samples) } : null;
      })(),
```
(Confirm `b.status` and `b.rawOutput` are present on the Prisma row from `findMany` — they are unless a `select` narrows it; if a `select` exists, add `status`/`rawOutput`.) `extract` is pure/sync, so no await.
- [ ] **Step 4** — Test in `saved-compares.service.spec.ts`: unit-test `downsampleSamples` (length ≤ cap passes through; > cap returns exactly cap; endpoints preserved-ish). Do not add a DB test.
- [ ] **Step 5** — `pnpm -F @modeldoctor/api test -- saved-compares.service.spec && pnpm -F @modeldoctor/api build`.
- [ ] **Step 6** — Commit: `feat(api): attach downsampled latency CDF to hydrated compare runs`.

## Task L3: availability mirror

**Files:** `apps/api/src/modules/saved-compares/metrics.ts`, `apps/web/src/features/benchmarks/compare/client-metrics.ts`; test `apps/api/src/modules/saved-compares/metrics.spec.ts`.

- [ ] **Step 1** — Extend the `RunMetricBlobs` interface (both files, identically) with an optional flag:
```ts
  /** True when the run carries pre-computed latency CDF samples (guidellm/vegeta). */
  hasLatencyCdf?: boolean;
```
- [ ] **Step 2** — In `availableFigureRefIds` (both files, identically), add: offer `latency-distribution` when there are ≥2 runs and EVERY run has a CDF:
```ts
  if (runs.length >= 2 && runs.every((r) => r.hasLatencyCdf)) {
    out.add("latency-distribution");
  }
```
- [ ] **Step 3** — Update callers to pass `hasLatencyCdf`:
  - Server `compare-synthesize.service.ts`: where it builds the `availableFigureRefIds(...)` input from `sc.benchmarks`, add `hasLatencyCdf: !!b.latencyCdf` (both the `buildUserPrompt` call site and `ensurePrefixCacheFigures`' own call site).
  - Client `FigureRenderer.tsx`: where it calls `availableFigureRefIds(runs.map(...))`, add `hasLatencyCdf: !!r.benchmark?.latencyCdf` (see L4 for the ReportRun field).
- [ ] **Step 4** — Test in `metrics.spec.ts`: 2 runs both `hasLatencyCdf:true` → set has `latency-distribution`; one missing → absent; single run → absent.
- [ ] **Step 5** — `pnpm -F @modeldoctor/api test -- saved-compares/metrics.spec && pnpm -F @modeldoctor/web type-check`.
- [ ] **Step 6** — Commit: `feat: latency-distribution availability (server/client mirror)`.

## Task L4: web render — map CDF through + FigureRenderer branch

**Files:** `apps/web/src/features/benchmarks/compare/to-report-runs.ts`, `apps/web/src/features/benchmarks/compare/FigureRenderer.tsx`; test `FigureRenderer.test.tsx`.

- [ ] **Step 1** — In `to-report-runs.ts`, add `latencyCdf` to `ReportBenchmarkSnapshot` and map it from `HydratedBenchmarkRef`:
```ts
  // in ReportBenchmarkSnapshot:
  latencyCdf?: { samples: number[] } | null;
  // in the snapshot object built from b:
  latencyCdf: b.latencyCdf ?? null,
```
- [ ] **Step 2** — In `FigureRenderer.tsx`, import `LatencyCDF` from `@/components/charts/LatencyCDF`. Add a render branch:
```tsx
  } else if (refId === "latency-distribution") {
    const series = summaries
      .map(({ r }) => ({ r, cdf: r.benchmark?.latencyCdf ?? null }))
      .filter((x) => x.cdf && x.cdf.samples.length > 0)
      .map(({ r, cdf }) => ({ runId: r.id, runLabel: r.stageLabel, samples: cdf!.samples }));
    chart = <LatencyCDF ariaLabel="Latency CDF by stage" series={series} />;
  }
```
(Match `LatencyCDF`'s actual prop names — READ the component first; adapt `ariaLabel`/`series`/`loading` to its real signature.)
- [ ] **Step 3** — Update the `availableFigureRefIds(...)` call in this file to pass `hasLatencyCdf: !!r.benchmark?.latencyCdf` (per L3 Step 3).
- [ ] **Step 4** — Test in `FigureRenderer.test.tsx`: a 2-run fixture where each `benchmark.latencyCdf = { samples: [...] }` renders `latency-distribution` without the "data unavailable" placeholder.
- [ ] **Step 5** — `pnpm -F @modeldoctor/web test -- FigureRenderer && pnpm -F @modeldoctor/web build`.
- [ ] **Step 6** — Commit: `feat(web): latency-distribution CDF-overlay figure`.

## Task L5: profiles + prompt union

**Files:** `apps/api/src/modules/saved-compares/report-scenarios/{gateway,inference}.ts`, `apps/api/src/modules/saved-compares/prompts.ts`; extend `profiles.spec.ts` if useful.

- [ ] **Step 1** — In `gateway.ts` add `"latency-distribution"` to `preferredFigures` (after `stage-bars-e2e-p95`). In `inference.ts` add it to BOTH the multi and single `preferredFigures` arrays (after the ttft/e2e entries).
- [ ] **Step 2** — In `prompts.ts` `COMMON_SCHEMA_BLOCK`, add `"latency-distribution"` to the `refId` union string (before `compare-grid`).
- [ ] **Step 3** — `pnpm -F @modeldoctor/api test -- report-scenarios && pnpm -F @modeldoctor/api build`.
- [ ] **Step 4** — Commit: `feat(api): offer latency-distribution in inference/gateway profiles`.

## Task L6: housekeeping — record Phase-2 verdicts

**Files:** `docs/superpowers/specs/2026-06-22-scenario-aware-ai-reports-design.md` (this branch); + open ONE GitHub issue.

- [ ] **Step 1** — In the spec, update the Phase-2 deferral list with verdicts: `latency-distribution` = DONE (this PR); `aiperf KV field` = tracked (zero-cost when aiperf emits it); `evalscope/aiperf sample histograms` = conditional follow-on (after this, if tools emit samples); `lb traffic-topology` and `lb hit-rate-timeseries` = **WON'T DO for compare reports** with rationale (per-pod distribution already covers the intent; time-series belongs to single-run monitoring, not a comparison deliverable; per-request routing capture fights the self-hosted-OSS thesis).
- [ ] **Step 2** — Commit: `docs: record Phase-2 verdicts (latency-distribution done; topology/timeseries won't-do)`.
- [ ] **Step 3** — (controller does this, not a subagent) Open a GitHub issue capturing the remaining tracked/conditional items (aiperf KV field; evalscope/aiperf histograms) so they're not lost.

---

## Final
- [ ] Whole-workspace `pnpm -r build && pnpm -r lint && pnpm -r test` green.
- [ ] Final whole-branch review (mirror check; latency-distribution present across enum/prompt/availability/renderer/profile; payload-size sanity).
- [ ] Push + PR.
</content>
