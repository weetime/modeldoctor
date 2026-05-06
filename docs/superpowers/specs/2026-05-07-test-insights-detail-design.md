# Test Insights — Connection Detail View — Design Spec

**Date:** 2026-05-07
**Branch:** `feat/test-insights-detail` (separate from the merged endpoint-reports v1 / PR #140)

## Problem

The Test Insights index (`/benchmarks/reports`) shipped in PR #140 ends at
"billboard" cards: per-connection aggregates and a "View history" button
that drops the user into a generic benchmark list, losing all trend
context.

Two concrete gaps:

1. **No drill-in.** Users want to click a card and see *why* a connection
   shows ▲ (regression) — they need a p95 timeseries, the run list that
   produced the aggregate, and tool distribution. Currently the only way
   is to leave the insights area entirely.

2. **Cancellation is invisible.** v1 deliberately excluded `canceled`
   runs from the success-rate denominator (cancellation is user action,
   not endpoint signal — see `benchmark.service.ts:getByConnectionReports`).
   That decision is correct but **opaque**: a card showing "12 次测试 ·
   成功率 91.7%" with `1 canceled / 1 failed / 10 completed` reads like
   "1 missing run" to the user. They need the breakdown surfaced.

## Goals

- New per-connection detail page at `/benchmarks/reports/:connectionId`
  with: page header, summary tile, tool distribution, p95 timeseries
  chart, simplified run-history table.
- Detail page has its own range picker (7d / 30d / 90d), URL-persisted
  via `?range=` so links are shareable.
- Index card "View history" button now navigates to the detail page
  (not the legacy benchmark list).
- Surface cancellation count on the index card so users see how each
  status bucket contributes to the denominator.

## Non-goals

- No new backend endpoint. Reuse `GET /api/benchmarks?connectionId=…&createdAfter=…&limit=200`.
- No threshold alerting / regression notifications.
- No cross-connection compare on the detail page (that's the existing
  `BenchmarkComparePage` flow).
- No bulk actions / checkboxes on the run-history table — this view is
  for inspection, not management.
- No editing the connection from this page.

## Architecture

### 1. Backend (no changes)

Reuse the existing list endpoint. The detail page issues:

```
GET /api/benchmarks?connectionId=<id>&createdAfter=<since>&limit=200&scope=own
```

200 is a comfortable cap — a heavy-use connection might log a few dozen
runs in 30d; 200 covers the 90d range with margin. If a user ever
exceeds 200, the page renders the most-recent 200 (acceptable).

We **do** need the connection's full row for the page header (name,
model, baseUrl, category). Reuse the existing `useConnection(id)` hook
(`apps/web/src/features/connections/queries.ts`) — it returns
`ConnectionPublic` from `GET /api/connections/:id`. The page issues both
queries in parallel.

### 2. Frontend route

Add a route at `/benchmarks/reports/:connectionId` mounting a new
`TestInsightsDetailPage` component. Place it in
`apps/web/src/router/index.tsx` immediately after the existing
`/benchmarks/reports` route.

### 3. New components

**`apps/web/src/features/benchmarks/TestInsightsDetailPage.tsx`** — the
page itself. Layout (top-down):

```
PageHeader
  title:    {connection.name}
  subtitle: {baseUrl}  ·  {model}
  rightSlot:
    - Category Badge
    - Range picker (7d / 30d / 90d) — URL-persisted via ?range=

Summary card (full width, grid 2-col on md+)
  Left:                          Right:
  N 次测试                         工具分布
  成功 X / 失败 Y / 取消 Z          - vegeta · 8   ▰▰▰▰▰▰▰▰
  成功率 99.8%                    - guidellm · 4 ▰▰▰▰
  p95: 147 → 296ms ▲              (count + filled-bar visualization
                                   sized proportionally; no chart lib —
                                   just `<div className="h-1.5 bg-primary/60">`)

p95 时间序列 card (full width)
  echarts line chart:
    X: run.createdAt (timestamp)
    Y: p95 latency in ms (uses readP95Latency / FE helper)
    Tooltip per point: run name + status badge + p95 value
    Click point: navigate to run detail page

运行历史 card (full width)
  Simplified table — columns:
    名称 (link to /benchmarks/<id>) · 创建时间 (relative) ·
    工具 (badge) · 状态 (StatusBadge) · p95 (ms, formatted) ·
    错误率 (digits=4)
  Sort: createdAt desc (most recent first).
  No checkboxes, no compare button, no row-actions menu.
```

**Empty / error states:**

- **Connection not found (404)**: render `EmptyState` with message
  "未找到此连接 — 它可能已被删除"
- **Connection found, 0 runs in window**: render the page header +
  `EmptyState` for the body with "选定时间范围内没有基准测试"
- **Loading**: `<div role="status" className="animate-pulse">` placeholder

**`apps/web/src/features/benchmarks/TestInsightsP95Chart.tsx`** — small
echarts wrapper for the p95 timeseries. Mirrors the pattern of
existing chart components in `apps/web/src/components/charts/`. Takes
`{ runs: Array<{ id, name, status, createdAt, p95Ms }> }` and renders
the line chart. Click → navigate to run detail.

**`apps/web/src/features/benchmarks/TestInsightsRunsTable.tsx`** —
simplified read-only table. Renders the same row data BenchmarkListShell
does, but no selection / actions / compare. Reuse helpers
`readP95Latency` and `readErrorRate` from `compare/metrics.ts`.

### 4. Index changes (re-route + cancellation breakdown)

`EndpointReportsPage.tsx`:

1. **"View history" link** — was `to={`/benchmarks/inference?connectionId=${id}`}`.
   Change to `to={`/benchmarks/reports/${id}?range=${range}`}` — preserves
   the user's range choice across the index → detail handoff.

2. **Cancellation count** — currently the card renders:
   ```
   12 次测试 · 成功率 99.8%
   ```
   Change to:
   ```
   12 次测试 · 成功 10 / 失败 1 / 取消 1 · 成功率 99.8%
   ```
   (Or similar split layout — exact wording goes through i18n.)

   Backend already returns `totalRuns`, but the breakdown by status
   isn't on the response. **Schema change**: extend `endpointReportSchema`
   with a `statusCounts` block:
   ```ts
   statusCounts: z.object({
     completed: z.number().int().nonnegative(),
     failed: z.number().int().nonnegative(),
     canceled: z.number().int().nonnegative(),
     // pending/submitted/running collapse into "inProgress" — they
     // shouldn't appear in a 30d window for a healthy connection but
     // showing them is honest.
     inProgress: z.number().int().nonnegative(),
   }),
   ```
   Service-side: count once during the existing groupBy loop
   (`runs.filter(r => r.status === "..."`)`). One extra `.length` per
   bucket, zero query cost.

### 5. i18n

Add to `benchmarks.json` under `reports`:

- `reports.detail.backToIndex` → "返回测试洞察" / "Back to Test Insights"
- `reports.detail.summary` (new sub-block):
  - `summary.totalRuns` → existing
  - `summary.statusBreakdown` → "成功 {{completed}} / 失败 {{failed}} / 取消 {{canceled}}" / "Success {{completed}} / Failed {{failed}} / Canceled {{canceled}}"
  - `summary.toolDistribution` → "工具分布" / "Tool distribution"
- `reports.detail.timeseries.title` → "p95 时间序列" / "p95 over time"
- `reports.detail.runs.title` → "运行历史" / "Run history"
- `reports.detail.runs.empty` → "选定时间范围内没有基准测试" / "No benchmarks within the selected window"
- `reports.detail.notFound` → "未找到此连接" / "Connection not found"
- `reports.detail.notFoundBody` → "它可能已被删除" / "It may have been deleted"

### 6. Cancellation visibility on the index card

`EndpointReportsPage.tsx`'s card body, currently:
```tsx
<div className="text-muted-foreground">
  {t("reports.summary.totalRuns", { count: item.totalRuns })} ·{" "}
  {item.successRate != null
    ? t("reports.summary.successRate", { rate: ... })
    : t("reports.summary.successRateMissing")}
</div>
```

Becomes:
```tsx
<div className="text-muted-foreground">
  {t("reports.summary.totalRuns", { count: item.totalRuns })}
  {" · "}
  {t("reports.summary.statusBreakdown", {
    completed: item.statusCounts.completed,
    failed: item.statusCounts.failed,
    canceled: item.statusCounts.canceled,
  })}
  {" · "}
  {item.successRate != null
    ? t("reports.summary.successRate", { rate: ... })
    : t("reports.summary.successRateMissing")}
</div>
```

Tooltip on the breakdown explains: "成功率分母 = 成功 + 失败；取消不计入"
(en: "Success rate denominator = success + failed; canceled excluded").

### 7. Contract changes (backwards compatible)

`packages/contracts/src/benchmark.ts` `endpointReportSchema` gains
`statusCounts` (required field). Existing FE consumers must read it.
The reports endpoint always populates it (zero data-loss path), so no
optional-typing needed.

This is a **breaking change** to the response shape, but the only
client is our own EndpointReportsPage which we control — so the change
lands atomically in this PR.

## Data flow

```
TestInsightsDetailPage
  ↓ uses
useConnection(connectionId)            ← existing hook
  + useBenchmarkList({ connectionId,  ← existing query, with new filter combo
       createdAfter: rangeToISO(range),
       limit: 200,
       scope: "own" })
  ↓ joins on the page

Index card (EndpointReportsPage)
  ↓ already uses
useEndpointReports(range)
  → response now carries `statusCounts`
```

## Testing

**Backend:**
- `benchmark.service.spec.ts`: extend the `getByConnectionReports`
  describe with a test that asserts `statusCounts` math (3 completed,
  2 failed, 1 canceled, 1 running → 3/2/1/1).

**Frontend (vitest + RTL):**
- `EndpointReportsPage.test.tsx`: existing tests + new case asserting
  the breakdown text renders ("成功 10 / 失败 1 / 取消 1") and the
  tooltip explains the denominator.
- `TestInsightsDetailPage.test.tsx`:
  - 404 connection → notFound empty state
  - connection + 0 runs → header + empty body
  - connection + N runs → summary tile, tool distribution, chart and
    table render with right counts
  - "View history" link from index has been updated to point at
    `/benchmarks/reports/<id>?range=<range>`
- `TestInsightsP95Chart.test.tsx`: mounts with sample data, asserts the
  echarts instance gets the expected `xAxis.data` length

**E2E:**
- `e2e/benchmarks/test-insights-detail.spec.ts`: navigate to insights,
  click "View history" on a card, land on detail page, assert URL +
  page header + chart presence (the chart is async — assert via the
  card titles surrounding it).

## Implementation order (drives the plan)

1. Contracts: extend `endpointReportSchema` with `statusCounts`
2. Backend: count statuses in the existing service loop + spec
3. FE: index card displays breakdown + tooltip; route changes for
   "View history" link
4. New components: `TestInsightsP95Chart`, `TestInsightsRunsTable`
5. New page: `TestInsightsDetailPage` + tests
6. Router: mount `/benchmarks/reports/:connectionId`
7. i18n keys
8. E2E smoke

## Open questions

None blocking. The chart click → run detail is a "nice to have"; if
the echarts click-handler integration is awkward we can drop it for
v1 of the detail page (the Run History table below already gives one-
click access to each run).
