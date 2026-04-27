# Benchmark Phase 5 — Web UI

**Status:** Draft — pending user approval
**Date:** 2026-04-26
**Predecessors:**

- Spec 1 (`2026-04-20-modeldoctor-restructure-design.md`) — Vite + React + TypeScript frontend.
- Spec 2 (`2026-04-22-nestjs-backend-refactor-design.md`) — NestJS + Prisma + auth/RBAC.
- Spec 3 (`2026-04-25-benchmark-design.md`) — full benchmark feature; this doc extends §8.

This spec elaborates §8 of the benchmark spec into a concrete implementation design for the web UI. Backend phases (1–4) are already merged into `feat/restructure`; this is the last MVP phase before the feature is user-visible.

## 1. Purpose and Scope

### 1.1 What this phase delivers

The first list/detail/polling feature in `apps/web`. Mounted at `/benchmarks` (list) and `/benchmarks/:id` (detail) with a two-tab create modal driven by URL search params (`?create=1`, `?duplicate=:id`). Five client-side profile presets auto-fill the config tab. Detail page polls every 2 s while the run is non-terminal, with conservative pause/backoff/re-fetch rules. zh-CN + en-US i18n. New sidebar entry "基准测试" in the `performance` group, between `loadTest` and `soak`.

### 1.2 Explicit non-goals

- **No charts.** Numbers in tiles only — spec §8.4 carry-over.
- **No live log streaming.** Logs are emitted in one chunk by the runner on its terminal callback; the panel reads from `BenchmarkRun.logs` and shows "Logs available after run completes" while non-terminal.
- **No edit/PATCH.** Runs are immutable once created; "re-run with changes" is the Duplicate flow.
- **No infinite-scroll.** Cursor pagination via "Load more" button (spec §4.1's `?cursor` already supports it; UI keeps it explicit).
- **No SSE/WebSocket.** Plain polling; same posture as backend §1.3.
- **No new top-level dependencies.** All needed primitives (TanStack Query, Radix Tabs/Dialog/AlertDialog, RHF, zod, sonner, lucide-react) are already in `apps/web/package.json`.

### 1.3 Why this is the first list/detail page in the codebase

Existing features (`LoadTest`, `E2ESmoke`, `RequestDebug`) are single-shot mutation forms. `Connections` is a list but client-only (Zustand-backed local store, no polling). Benchmark introduces:

- TanStack Query for **server state** (cache, invalidation, polling) — instead of Zustand for everything;
- search-param-driven modal — instead of Zustand-only modal flags;
- a long-running async resource visible to the user — requiring polling, terminal-state detection, and stale data handling.

These patterns will be reused by future "history" / "regression" / "soak" pages, so the implementation aims to be exemplary rather than minimal.

## 2. Architecture

### 2.1 Folder layout

```
apps/web/src/features/benchmark/
├── BenchmarkListPage.tsx          # /benchmarks
├── BenchmarkDetailPage.tsx        # /benchmarks/:id
├── BenchmarkCreateModal.tsx       # both create and duplicate
├── BenchmarkEndpointFields.tsx    # tab 1 endpoint fields (slim)
├── BenchmarkProfilePicker.tsx     # tab 2 chip row + auto-fill
├── BenchmarkMetricsGrid.tsx       # 4×3 metric tiles
├── BenchmarkLogsPanel.tsx         # collapsible <pre>
├── BenchmarkStateBadge.tsx        # shared list + detail badge
├── BenchmarkActionsCell.tsx       # row ⋯ menu (open/duplicate/cancel/delete)
├── api.ts                         # typed fetch wrappers around api.{get,post}
├── profiles.ts                    # PROFILE_DEFAULTS data table
├── queries.ts                     # query keys + useBenchmarkList/useBenchmarkDetail
├── schemas.ts                     # form-only zod (re-export + extend contracts)
└── __tests__/
    ├── BenchmarkListPage.test.tsx
    ├── BenchmarkDetailPage.test.tsx
    ├── BenchmarkCreateModal.test.tsx
    ├── BenchmarkProfilePicker.test.tsx
    ├── BenchmarkEndpointFields.test.tsx
    ├── BenchmarkMetricsGrid.test.tsx
    ├── BenchmarkLogsPanel.test.tsx
    └── queries.test.tsx
```

### 2.2 State boundaries

| Concern | Where it lives | Why |
|---|---|---|
| Run list, single run data | TanStack Query cache | server state; need invalidation, polling, retry |
| Modal open + active tab | URL search params (`?create=1`, `?duplicate=:id`) + Radix Tabs uncontrolled | shareable URL, browser-back closes modal |
| Pending confirm dialogs (Cancel/Delete) | Local `useState` in the page | scoped to component lifetime |
| Theme / locale / connections | Existing Zustand stores | unchanged |

**No new Zustand store for benchmark.** This is an **intentional deviation from `LoadTest`'s pattern**, which puts the last result in Zustand. With list+detail+polling that pattern creates two sources of truth (Zustand vs. TanStack cache) and goes wrong fast. If a future need arises (e.g. cross-page filter persistence) a `store.ts` can be added then; YAGNI for Phase 5. Flagged in Phase 5 plan rationale.

### 2.3 Routing

```ts
// apps/web/src/router/index.tsx
{ path: "benchmarks", element: <BenchmarkListPage /> },
{ path: "benchmarks/:id", element: <BenchmarkDetailPage /> },
```

Modal lives on the list page, opened by search params:

| URL | Modal | Initial values |
|---|---|---|
| `/benchmarks` | closed | — |
| `/benchmarks?create=1` | open | empty form, profile=`throughput` preset loaded |
| `/benchmarks?duplicate=cln4xq…` | open | prefilled from `GET /api/benchmarks/:id`; `apiKey=""`; `name="${original}-2"`; banner shown |

Closing the modal (X, ESC, Cancel) calls `navigate("/benchmarks", { replace: true })` so back-stack stays clean.

### 2.4 Sidebar

`components/sidebar/sidebar-config.tsx` — `performance` group, after `loadTest`:

```ts
{ to: "/benchmarks", icon: Gauge, labelKey: "items.benchmark" },
```

`Gauge` icon from `lucide-react` (instrument metaphor). i18n key `sidebar.items.benchmark` added to both locales.

## 3. Data Flow

### 3.1 Query keys

```ts
const benchmarkKeys = {
  all: ["benchmarks"] as const,
  lists: () => [...benchmarkKeys.all, "list"] as const,
  list: (q: ListBenchmarksQuery) => [...benchmarkKeys.lists(), q] as const,
  details: () => [...benchmarkKeys.all, "detail"] as const,
  detail: (id: string) => [...benchmarkKeys.details(), id] as const,
};
```

### 3.2 List query

Plain `useQuery`, no polling, no `refetchOnWindowFocus`. Invalidated by:

- `useCreateBenchmark` → on success: `qc.invalidateQueries({ queryKey: benchmarkKeys.lists() })`
- `useCancelBenchmark` → ditto
- `useDeleteBenchmark` → ditto
- Manual "Refresh" button in the page header (small ghost button next to the "New" button)

Background reconciler (every 30 s, server-side) keeps stale runs converging; the user does not need real-time list updates to know "did my run finish?" because they'll be on the detail page for that.

### 3.3 Detail query — the polling rules

```ts
const TERMINAL_STATES = ["completed", "failed", "canceled"] as const;

useQuery({
  queryKey: benchmarkKeys.detail(id),
  queryFn: () => benchmarkApi.get(id),
  refetchInterval: (q) => {
    const data = q.state.data;
    if (data && TERMINAL_STATES.includes(data.state)) return false;
    return 2000;
  },
  refetchIntervalInBackground: false,    // pause when tab hidden
  retry: (count) => count < 3,
  retryDelay: (count) => Math.min(5000 * count, 30000),
});
```

**Five rules** (each independently testable):

1. **List page does not poll.** Reconciler closes the loop within 30 s and most users will be on detail anyway.
2. **Detail polls every 2 s while non-terminal**, stops on `{completed, failed, canceled}`.
3. **Polling pauses when the tab is hidden** (`refetchIntervalInBackground: false`, TanStack v5 default — declared explicitly to prevent regression).
4. **Polling failures back off**: 5 s × 3 → 10 s × 5 → stop; toast once on first failure, no toast on recovery.
5. **Re-fetch once on transition into terminal state**: a `useEffect` watches `data?.state`; when it transitions from non-terminal → terminal, fire `qc.invalidateQueries({ queryKey: benchmarkKeys.detail(id) })`. Reason: runner posts `state=completed` on one HTTP call and `metrics+logs` on a second; the polling tick that observes `state=completed` may land between the two, so logs/rawMetrics can be missing on first read.

### 3.4 Mutations

| Hook | Path | Method | onSuccess |
|---|---|---|---|
| `useCreateBenchmark` | `/api/benchmarks` | POST | invalidate list; toast success; `navigate(/benchmarks/${result.id})` |
| `useCancelBenchmark(id)` | `/api/benchmarks/:id/cancel` | POST | invalidate detail; **do not stop polling** (cancel is async — reconciler/driver flips state to `canceled`) |
| `useDeleteBenchmark(id)` | `/api/benchmarks/:id` | DELETE | invalidate list; if currently on detail page of this id, `navigate("/benchmarks")` |

### 3.5 Error handling

| Layer | UI |
|---|---|
| Mutation error (cancel/delete/create) | `toast.error(err.message)` — sonner |
| List query error | inline `<Alert variant="destructive">` row in table body with Retry |
| Detail query error | full-page `<EmptyState>` with Retry |
| 404 (id not found / deleted under us) | full-page `<EmptyState icon={SearchX}>` "Benchmark not found" + Back to list |
| Form submit zod errors | RHF field-level errors; tabs with errors get a red dot indicator |
| Polling failures | first one toasts, subsequent silent (avoid spam) |

## 4. Profile Presets

`profiles.ts` — pure data, the single source of truth on the client:

```ts
export const PROFILE_DEFAULTS: Record<
  Exclude<BenchmarkProfile, "custom" | "sharegpt">,
  {
    datasetName: BenchmarkDataset;
    datasetInputTokens: number;
    datasetOutputTokens: number;
    requestRate: number;
    totalRequests: number;
  }
> = {
  throughput:       { datasetName: "random", datasetInputTokens: 1024,  datasetOutputTokens: 128,  requestRate: 0, totalRequests: 1000 },
  latency:          { datasetName: "random", datasetInputTokens: 128,   datasetOutputTokens: 128,  requestRate: 1, totalRequests: 100  },
  long_context:     { datasetName: "random", datasetInputTokens: 32000, datasetOutputTokens: 100,  requestRate: 1, totalRequests: 100  },
  generation_heavy: { datasetName: "random", datasetInputTokens: 1000,  datasetOutputTokens: 2000, requestRate: 1, totalRequests: 200  },
};
```

Numbers come straight from spec §1.4 profile table. ShareGPT chip is rendered but `disabled` with a "(coming soon)" tooltip — so `PROFILE_DEFAULTS` does not need to include it. `custom` is the only profile that does not preload anything.

**Picking a profile chip is "load preset", not "lock to preset"** (spec §4.1). After loading, the user can still tweak any field — chip stays on the chosen profile (it's a label, not a constraint). This is implemented as a one-shot `setValue` per field, with no further side effect.

**Switching to `custom`** does not clear current values — preserves the user's edits. Only the chip changes, signaling "I'm not following a preset anymore."

## 5. Form Strategy

### 5.1 RHF + zod resolver

Form schema = `CreateBenchmarkRequestSchema` from `@modeldoctor/contracts` directly. This is the same schema the API validates against, so what passes the form passes the API (no double-spec).

```ts
const form = useForm<CreateBenchmarkRequest>({
  resolver: zodResolver(CreateBenchmarkRequestSchema),
  defaultValues: duplicateOf
    ? mapDuplicateToDefaults(duplicateOf)   // apiKey:"", name:"…-2"
    : { profile: "throughput", ...PROFILE_DEFAULTS.throughput, /* … */ },
});
```

### 5.2 Endpoint fields — slim, not the LoadTest picker

Spec §8.3 says "laid out same as LoadTest's endpoint picker so the components can be reused." On inspection the existing `EndpointPicker` is too heavy for a modal:

- bundles cURL paste + save-as-connection + custom headers + custom query params (none of which `guidellm` honors);
- defaults `apiType` to LoadTest's `chat | embeddings | rerank | images | chat-vision | chat-audio` enum, **incompatible** with benchmark's `BenchmarkApiType = chat | completion`.

So Phase 5 ships a new `BenchmarkEndpointFields` component (~60 lines): a Connection dropdown (reusing the existing `EndpointSelector` to get "Load from saved connection") plus four labeled fields (URL / Key / Model / API type with two options). This is the spirit of "reuse the connection-loading behavior + visual pattern" without inheriting dead code.

### 5.3 Tab error indicator

Both tabs visible always; submit always visible in the footer. To prevent the "I clicked submit and nothing happened — turns out the error is on the other tab" trap:

```tsx
<TabsTrigger value="basic">
  {t("create.tabs.basic")}
  {hasErrorsIn(BASIC_FIELDS) && <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-destructive" />}
</TabsTrigger>
```

Submit button: `disabled={!formState.isValid}`. First click while disabled is intercepted to switch to whichever tab has the first error.

### 5.4 Duplicate prefill

```ts
function mapDuplicateToDefaults(run: BenchmarkRun): CreateBenchmarkRequest {
  return {
    name: `${run.name}-2`,
    description: run.description ?? undefined,
    profile: run.profile,
    apiType: run.apiType,
    apiBaseUrl: run.apiBaseUrl,
    apiKey: "",                           // never returned; user must re-enter
    model: run.model,
    datasetName: run.datasetName,
    datasetInputTokens: run.datasetInputTokens ?? undefined,
    datasetOutputTokens: run.datasetOutputTokens ?? undefined,
    datasetSeed: run.datasetSeed ?? undefined,
    requestRate: run.requestRate,
    totalRequests: run.totalRequests,
  };
}
```

Rendering: yellow `<Alert>` banner at top of modal: "Duplicating from {{name}}. All fields prefilled except API Key — please re-enter for security." `apiKey` field gets a red border via `aria-invalid` until filled.

## 6. List Page

Per spec §8.2 column set (chosen variant A in brainstorm):

| Column | Source | Notes |
|---|---|---|
| Name | `summary.name` | links to detail page |
| Model | `summary.model` | truncated with tooltip on overflow |
| Profile | `summary.profile` | `<Badge>` (purple) |
| State | `summary.state` | `<BenchmarkStateBadge>` — color per spec §8.2 (running=blue, completed=green, failed=red, pending/submitted/canceled=gray) |
| Output tok/s | `summary.metricsSummary?.outputTokensPerSecond.mean` | tabular-nums; `—` while non-terminal |
| TTFT mean | `summary.metricsSummary?.ttft.mean` | ms; `—` while non-terminal |
| Created | `summary.createdAt` | `formatDistanceToNow` via `date-fns` |
| (actions) | — | `<BenchmarkActionsCell>` — ⋯ dropdown: Open · Duplicate · Cancel (only if non-terminal) · Delete (only if terminal — matches backend constraint) |

**Filters** above the table: state Select, profile Select, name Input (debounced 300 ms). All bound to query state in the `useBenchmarkList` hook (search params optional — could mirror to URL in Phase 6 for shareable filtered views; not in scope).

**Empty/loading/error states** — see §8.

**Pagination** — "Load more" button below table; appends `nextCursor` page to the displayed list. No infinite-scroll.

## 7. Detail Page

### 7.1 Layout

```
┌────────────────────────────────────────────────────────────────┐
│ name                                       [Duplicate] [Delete]│
│ [profile] [state] · duration · started→completed               │
├────────────────────────────────────────────────────────────────┤
│ Config card (4-col grid: target, model, apiType, dataset, ...) │
├────────────────────────────────────────────────────────────────┤
│ ┌────┬────┬────┬────┐                                          │
│ │TTFT│TTFT│TTFT│ITL │   Metrics grid 4×3                       │
│ │mean│p95 │p99 │mean│   "mean" tiles include subtitle:         │
│ ├────┼────┼────┼────┤    "p50 X / p95 Y / p99 Z"               │
│ │ITL │ITL │OUT │RPS │                                          │
│ │p95 │p99 │tok/s   │                                           │
│ ├────┼────┼────┼────┤                                          │
│ │CONC│CONC│SUC │ERR │                                          │
│ │mean│max │    │    │                                          │
│ └────┴────┴────┴────┘                                          │
├────────────────────────────────────────────────────────────────┤
│ ▾ Logs (3.2 KB) — black <pre>, monospace, scrolls to bottom    │
└────────────────────────────────────────────────────────────────┘
```

Twelve tiles per spec §8.4. The three "mean" tiles (TTFT/ITL/E2E) carry a subtitle line `p50 X / p95 Y / p99 Z` so distribution information is visible without three extra tiles per metric. This **stays inside the spec's 12-tile 4×3 layout**; the subtitle is a presentational bonus, not a layout deviation.

(Note: the grid as drawn includes ITL family tiles that overlap with the "mean" tile's subtitle; this is intentional repetition for users who want to scan one column for "all p95s" — it costs nothing and helps glanceability.)

**Header action buttons by state:**

| State | Visible buttons |
|---|---|
| `pending`, `submitted`, `running` | Cancel (only) |
| `completed`, `failed`, `canceled` | Duplicate + Delete |

This matches the backend constraints: `cancel` requires non-terminal state, `delete` requires terminal state (commit `c4defea feat(api/benchmark): service.delete (terminal only)`). The list page row actions follow the same logic.

### 7.2 State variations

| State | Header | Metrics grid | Logs panel | Banner |
|---|---|---|---|---|
| `pending` | striped indeterminate progress bar | all `—` | "Logs available after run completes." | — |
| `submitted` | striped indeterminate progress bar | all `—` | same | — |
| `running` | progress bar bound to `progress` (0..1) + Cancel button | all `—`, "Requests so far" tile may show partial count | same | — |
| `completed` | duration + timestamps | full data | open by default | — |
| `failed` | duration | partial / `—` | open by default | red `<Alert>` showing `stateMessage` |
| `canceled` | duration | partial | open by default | gray `<Alert>` "Run was canceled." |
| 404 | — | — | — | `<EmptyState icon={SearchX}>` |

### 7.3 Cancel and Delete confirmation

Both use Radix `<AlertDialog>`:

- **Cancel:** "Cancel this benchmark? In-flight requests will be terminated." → calls cancel mutation → modal closes → polling continues until backend reports `canceled`.
- **Delete:** "Delete this benchmark permanently? Metrics and logs will be lost." → calls delete mutation → modal closes → if on detail page, navigate to list.

No confirm-by-typing-name pattern. Delete is reversible only at the DB level; users who delete by accident can re-run.

## 8. Empty / Loading / Error States

| Page | Initial load | Empty | Filtered empty | Error |
|---|---|---|---|---|
| List | `<Skeleton>` 8 rows | `<EmptyState>` "No benchmarks yet · New" | "No benchmarks match these filters · Clear filters" | inline `<Alert variant="destructive">` with Retry |
| Detail | header + grid skeleton | (n/a — page can't be empty if id resolves) | (n/a) | `<EmptyState icon={SearchX}>` "Benchmark not found · Back to list" or "Couldn't load · Retry" |

Skeletons mirror the final layout (4 row × N col grid for metrics, etc.) — keeps perceived performance high.

## 9. i18n

New namespace `benchmark`, registered in `apps/web/src/lib/i18n.ts`. zh-CN + en-US, mirroring `load-test.json`'s structure. The full key tree:

```
benchmark
├── title
├── subtitle
├── actions.{create, duplicate, cancel, delete, retry, clearFilters, loadMore, refresh}
├── list
│   ├── columns.{name, model, profile, state, outputTps, ttftMean, createdAt}
│   ├── filters.{state, profile, search}
│   └── empty.{title, description, filtered}
├── create
│   ├── title, subtitle
│   ├── tabs.{basic, config}
│   ├── fields.{name, description, apiType, apiBaseUrl, apiKey, model, profile,
│   │           dataset, inputTokens, outputTokens, seed, requestRate, totalRequests}
│   ├── duplicateBanner   (interpolation: {{name}})
│   └── presetLoaded      (interpolation: {{profile}})
├── detail
│   ├── config.{target, model, apiType, dataset, rate, totalRequests, success, errors}
│   ├── metrics.{ttftMean, ttftP95, ttftP99, itlMean, itlP95, itlP99,
│   │            outputTps, rps, concurrencyMean, concurrencyMax, successCount, errorCount}
│   ├── logs.{title, pendingMessage, size}
│   ├── states.{pending, submitted, running, completed, failed, canceled}
│   └── errors.{loadFailed, notFound, runFailed, polling}
├── profiles.{throughput, latency, longContext, generationHeavy, shareGpt, custom}
├── datasets.{random, sharegpt}
└── comingSoon
```

Sidebar key `sidebar.items.benchmark` added to both `sidebar.json` files: zh = "基准测试" / en = "Benchmark".

State labels and profile names live under `benchmark.detail.states.*` and `benchmark.profiles.*` so other features can reference them later (history page, regression page, etc.).

## 10. Testing

| File | Coverage focus |
|---|---|
| `BenchmarkListPage.test.tsx` | columns, filters, row actions, empty/filtered/error states |
| `BenchmarkDetailPage.test.tsx` | each state variation; transition into terminal triggers re-fetch; 404; Cancel/Delete dialog flows |
| `BenchmarkCreateModal.test.tsx` | tab switching keeps form state; submit-disabled jumps to first errored tab; create vs duplicate paths |
| `BenchmarkProfilePicker.test.tsx` | preset auto-fill; switch to Custom preserves values; ShareGPT chip is `aria-disabled` |
| `BenchmarkEndpointFields.test.tsx` | load from saved connection populates 4 fields; manual edit reverts selector to "Manual"; apiType limited to chat/completion |
| `BenchmarkMetricsGrid.test.tsx` | 12 tiles render; mean-tile subtitle renders; nullish data shows `—` |
| `BenchmarkLogsPanel.test.tsx` | placeholder when null; renders `<pre>` and auto-scrolls; size formatting (`3.2 KB`) |
| `queries.test.tsx` | polling cadence (`vi.useFakeTimers`); pause on hidden tab; backoff on errors; stop on terminal; re-fetch fires on transition |

**Mocks:** `api.get` / `api.post` via `vi.mock`; `useNavigate` via `MemoryRouter`; new `QueryClient` per test (`retry:false`, `gcTime:0`) — same template as existing `LoadTestPage.test.tsx` and `RequestDebugPage.test.tsx`.

**Out of scope:** Playwright e2e (deferred to spec §10 Phase 6). Backend integration is already covered by Phase 1–4 specs.

## 11. Phase Decomposition

Single PR `feat/benchmark-phase-5-web-ui`, cut from `feat/restructure` (not `main`, because Phases 1–4 are merged to `feat/restructure` but not yet to main). Seven commits, conventional-commits prefixes:

1. `feat(web): scaffold benchmark feature folder` — stub files, i18n registration, sidebar entry, router wiring; type-check green; sidebar shows entry → placeholder page.
2. `feat(web/benchmark): list page` — table + filters + pagination + empty/error/loading; row Cancel/Delete with AlertDialog; tests.
3. `feat(web/benchmark): create modal — basic tab` — modal scaffold + slim endpoint fields + RHF + zodResolver + `?create=1` driver; submit stub.
4. `feat(web/benchmark): create modal — config tab + profile presets` — chip row + auto-fill + dataset/numeric fields + tab error dot + real submit + navigate to detail.
5. `feat(web/benchmark): detail page` — header + config card + 4×3 grid (with subtitles) + logs panel + state branches + Cancel/Delete dialogs; **no polling yet** (constant `staleTime`).
6. `feat(web/benchmark): polling rules` — `refetchInterval` + pause-on-hidden + backoff + transition-to-terminal re-fetch + toast throttling.
7. `feat(web/benchmark): duplicate flow` — `?duplicate=:id` prefill + apiKey blanking + banner + "Duplicate" buttons in list/detail.

Every commit ships its own tests; CI must be green to advance. All commit bodies end with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

## 12. Manual Smoke Test (PR gate)

Phase 5 PR description must include a smoke checklist run against Workflow A (`BENCHMARK_DRIVER=subprocess`, no K8s required):

**Prereqs**

- Local Postgres (brew-managed) running.
- `pip install guidellm` in the active conda env.
- Real OpenAI-compatible target (e.g. `vllm serve facebook/opt-125m --port 8000` — CPU-runnable).
- `.env.local` with `BENCHMARK_DRIVER=subprocess`, `BENCHMARK_CALLBACK_SECRET`, `BENCHMARK_API_KEY_ENCRYPTION_KEY`.
- `pnpm dev`.

**Checklist**

- [ ] Sidebar shows "基准测试" entry.
- [ ] `/benchmarks` shows empty state.
- [ ] "New" opens modal; URL becomes `?create=1`.
- [ ] Basic tab fields validate; advancing to Config tab, picking Throughput auto-fills 5 fields.
- [ ] Submit → modal closes → navigates to `/benchmarks/:id`.
- [ ] State progresses: pending → submitted → running with progress bar.
- [ ] On completion: state → completed, 12 tiles populated with **real** numbers.
- [ ] **Cross-validate**: run `guidellm benchmark` directly in shell with same config; UI numbers should match within ±5%.
- [ ] Logs panel shows guidellm output.
- [ ] List page shows the run with TTFT mean column populated.
- [ ] Detail "Duplicate" → modal opens with prefilled fields, apiKey blank with red border, banner visible.
- [ ] Failure path: bad URL → state goes to failed → red Alert + logs auto-open.
- [ ] Cancel: long-running benchmark + click Cancel + confirm → state → canceled with gray Alert.
- [ ] Tab hidden 30 s: devtools Network shows polling paused.
- [ ] Delete: confirm dialog + row disappears from list.

Screenshot or screen-recording attached to PR description; not a CI gate.

## 13. Risks

1. **TanStack Query v5 polling under StrictMode** — first use of `refetchInterval` callback form in this repo. Mitigated by `queries.test.tsx` using `vi.useFakeTimers()` to assert exact poll counts.
2. **`?create=1` / `?duplicate=:id` and browser back stack** — closing the modal must call `navigate(..., { replace: true })` so back doesn't toggle the modal. Tested in `BenchmarkCreateModal.test.tsx`.
3. **Duplicate prefill while target run is non-terminal** — `BenchmarkRun.metricsSummary` may be null but `apiBaseUrl/model/apiType/dataset*` are set at create time, so prefill works. Tested.
4. **Logs size** — runner posts logs in one chunk on terminal callback. Spec §6 says `logs` is `@db.Text`; large logs (e.g. 1 MB on a noisy run) make the detail JSON heavy. Phase 5 truncates display at 64 KB with a "Show full logs" toggle that fetches the same record again — out of scope here, deferred to Phase 6.
5. **Profile defaults drift from spec** — `PROFILE_DEFAULTS` and spec §1.4 / §8.3 must stay in sync. A single-line code comment pins this; future changes to profile semantics must update the spec table and the constant together.

## 14. Open Items (resolved at plan stage)

- `submitted` state badge color (proposed: gray, same as pending).
- Default page size (proposed: 20; max 100 already in contracts).
- Striped progress bar implementation — Radix `<Progress>` doesn't include indeterminate variant; implement via Tailwind animation utility.
- Whether to mirror filter state to URL search params for shareable list views (proposed: not in Phase 5).

---

## Appendix A — Brainstorm convergence

This spec is the output of a brainstorm session held on 2026-04-26. Key decisions:

| # | Question | Outcome |
|---|---|---|
| Q1 | MVP scope | Strict §8 (logs panel + 4×3 metrics + filters) |
| Q2 | Re-run UX | Duplicate button → prefill (apiKey blanked + banner) |
| Q3 | Polling strategy | List no poll; detail 2 s + pause-when-hidden + error backoff + re-fetch on terminal + keep polling through cancel |
| Q4 | List columns | Spec §8.2 exact (8 columns including Created) |
| Q5 | Detail metrics | Spec 4×3 with mean-tile subtitle showing p50/p95/p99 |
| Q6 | Modal endpoint | Slim `BenchmarkEndpointFields` + reuse `EndpointSelector`; tabs without Next/Back; submit always visible |

Visual mockups for Q4–Q6 archived under `.superpowers/brainstorm/` (gitignored).
