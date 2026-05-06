# Endpoint Reports — Design Spec

**Date:** 2026-05-06
**Branch:** `feat/endpoint-reports` (separate from `feat/vegeta-gateway-custom-request` / PR #137)

## Problem

The "对比分析" sidebar entry (`/benchmarks/compare`) is redundant with the
list-page "对比 (N)" button — both lead to the same `BenchmarkComparePage`,
and the menu's empty-state UI duplicates a worse version of the
list-page selection flow. Users see two doors to the same room.

The slot itself, however, is valuable real estate. Users running
ModelDoctor in production / staging contexts repeatedly want to answer:

> "How is **this endpoint** performing over time? Is its p95 creeping up?
> What's the success rate trend?"

This is an *endpoint-anchored* question — natural for the user's mental
model since `Connection` already represents a saved endpoint.

## Goals

- Replace the redundant "对比分析" menu with **"端点报告" / "Endpoint
  Reports"** — a connection-anchored health overview.
- Each connection shows: 30-day benchmark count, success rate, latest
  run, and a simple p95 trend indicator.
- Click-through: each card navigates to the existing scenario list,
  filtered by `?connectionId=<id>` (the list page already supports this
  filter — no new list page).
- Existing list-page "对比 (N)" button is unchanged. Compare flow is
  unchanged.
- `/benchmarks/compare` route is preserved for `?ids=` deep-links; if
  a user lands on it without ids, redirect to `/benchmarks/inference`.

## Non-goals

- No sparkline graphs in v1 (a numeric "↑ 296ms vs ↓ 147ms" / 30d span
  delta is the trend signal). Sparkline can come in v2 if users ask.
- No cross-connection trends (e.g. "all embeddings endpoints").
- No alerting / threshold rules.
- No baseline/regression view at this level — that lives on the
  benchmark detail page (existing).
- No new aggregation indexes on the benchmark table; we do a simple
  `groupBy connectionId` over the user's recent benchmarks (≤ a few
  hundred rows in practice for any single user / 30-day window).

## Industry precedent

| Platform | Anchor | Notes |
|---|---|---|
| Datadog APM Service Page | Service | Latency / error trends per service over time |
| Datadog Synthetics, New Relic Synthetics, Pingdom | Monitor / Check (URL probe) | Long-running history per URL |
| AWS CloudWatch Synthetics | Canary (URL probe) | Same pattern |
| k6 Cloud / BlazeMeter / Artillery | Test (saved scenario) | Workload-anchored, NOT endpoint-anchored |

ModelDoctor sits between load-testing (k6/BlazeMeter — workload-anchored
via templates) and synthetics (Datadog/Pingdom — endpoint-anchored via
canaries). Templates already cover the workload axis; this design adds
the endpoint axis.

In the LLM-benchmark sub-segment specifically, **no major tool currently
ships an endpoint-anchored history view**, so this is differentiating.

## Architecture

### 1. Backend — `GET /api/benchmarks/reports/by-connection`

**Query params:**
- `range` — enum `7d | 30d | 90d`, default `30d`. Sets the lower bound
  for `createdAt`.

**Response shape** (new contract):

```ts
export const endpointReportSchema = z.object({
  connection: z.object({
    id: z.string(),
    name: z.string(),
    model: z.string(),
    baseUrl: z.string(),
    category: ModalityCategorySchema,
  }),
  totalRuns: z.number().int().nonnegative(),
  // % in [0, 100]; null if no terminal runs in range
  successRate: z.number().min(0).max(100).nullable(),
  // p95 latency in ms; first/last terminal-run reading in the range,
  // null when no terminal run with usable summary metrics.
  p95Latency: z
    .object({
      first: z.number().nullable(),
      last: z.number().nullable(),
    })
    .nullable(),
  // Latest run (any status) — for "Latest: <name> · <when> · <status>"
  latestRun: z
    .object({
      id: z.string(),
      name: z.string(),
      status: benchmarkStatusSchema,
      createdAt: z.string().datetime(),
    })
    .nullable(),
});

export const endpointReportsResponseSchema = z.object({
  range: z.enum(["7d", "30d", "90d"]),
  generatedAt: z.string().datetime(),
  items: z.array(endpointReportSchema),
});
```

**Implementation** (`benchmark.service.ts` + `benchmark.controller.ts`):

```ts
async getByConnectionReports(
  userId: string,
  range: "7d" | "30d" | "90d",
): Promise<EndpointReportsResponse> {
  const days = { "7d": 7, "30d": 30, "90d": 90 }[range];
  const since = new Date(Date.now() - days * 86400_000);

  // Pull all of user's benchmarks within the window. Connection list
  // is already small (≤ ~100 per user); benchmark count per user-window
  // is bounded too. No need for an aggregation server-side; we
  // SELECT and group in JS for simplicity + transparency.
  const rows = await this.repo.list({
    userId,
    createdAfter: since.toISOString(),
    limit: 5000, // safety cap; expected << 1000 in practice
  });

  // Bucket by connectionId. Drop rows whose connection has been deleted
  // (connection: null) — they don't belong on a connection-anchored view.
  const groups = new Map<string, BenchmarkWithRelations[]>();
  for (const r of rows.items) {
    if (!r.connection) continue;
    const arr = groups.get(r.connection.id) ?? [];
    arr.push(r);
    groups.set(r.connection.id, arr);
  }

  const items: EndpointReport[] = [];
  for (const [connId, runs] of groups.entries()) {
    const connection = runs[0].connection!;
    const terminal = runs.filter((r) => r.status === "completed" || r.status === "failed");
    const completed = runs.filter((r) => r.status === "completed");
    const successRate = terminal.length > 0
      ? (completed.length / terminal.length) * 100
      : null;

    const p95s = completed
      .map((r) => readP95LatencyMs(r.summaryMetrics)) // shared helper, mirrors FE compare/metrics.ts
      .filter((x): x is number => x != null);
    // first = oldest terminal completed run with metric; last = newest
    const completedSortedAsc = [...completed].sort(
      (a, b) => +new Date(a.createdAt) - +new Date(b.createdAt),
    );
    const firstWithMetric = completedSortedAsc.find((r) => readP95LatencyMs(r.summaryMetrics) != null);
    const lastWithMetric = [...completedSortedAsc]
      .reverse()
      .find((r) => readP95LatencyMs(r.summaryMetrics) != null);
    const p95Latency = p95s.length > 0
      ? {
          first: firstWithMetric ? readP95LatencyMs(firstWithMetric.summaryMetrics) : null,
          last: lastWithMetric ? readP95LatencyMs(lastWithMetric.summaryMetrics) : null,
        }
      : null;

    const latestRow = [...runs].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0];
    const latestRun = latestRow
      ? {
          id: latestRow.id,
          name: latestRow.name,
          status: latestRow.status as BenchmarkStatus,
          createdAt: latestRow.createdAt.toISOString(),
        }
      : null;

    // Fetch category for this connection; the embedded ref doesn't carry
    // it (see "Note on connection.category" below). Single batch query
    // outside the loop in the real impl — `prisma.connection.findMany`
    // by ids — for clarity this pseudo-code shows it inline.
    const cat = await this.prisma.connection.findUnique({
      where: { id: connection.id },
      select: { category: true },
    });
    items.push({
      connection: {
        id: connection.id,
        name: connection.name,
        model: connection.model,
        baseUrl: connection.baseUrl,
        category: cat?.category as ModalityCategory,
      },
      totalRuns: runs.length,
      successRate,
      p95Latency,
      latestRun,
    });
  }

  // Sort: most-active connection first.
  items.sort((a, b) => b.totalRuns - a.totalRuns);
  return { range, generatedAt: new Date().toISOString(), items };
}
```

**Note on `connection.category`**: `BenchmarkConnectionRef` (as of the
in-flight PR #137) carries `id, name, model, baseUrl` but NOT
`category`. The reports endpoint needs `category` to badge the card by
modality. Two options:
- (a) Extend `BenchmarkConnectionRef` to include `category` (adds it to
  the embedded ref everywhere — small contract change).
- (b) Reports endpoint's response carries an enriched connection inline
  (does its own select including category), independent of the embedded
  ref.

**Decision**: (b). The reports endpoint is independent — embedding
category into every benchmark row is wasteful since only this view needs
it. The reports service does its own JOIN-and-select.

**Helper**: `readP95LatencyMs(summaryMetrics)` already exists on the FE
(`apps/web/src/features/benchmarks/compare/metrics.ts`). It needs a
backend twin in `apps/api/src/modules/benchmark/metrics.ts` (or a
package-level helper). Shared signature (per tool):

- vegeta: `summaryMetrics.data.latencies.p95` (already in ms)
- guidellm: `summaryMetrics.data.e2eLatency.p95` (already in ms)
- genai-perf: `summaryMetrics.data.requestLatency.p95` *— needs unit
  conversion if not ms; check existing FE helper for the pattern*

**Auth**: `@UseGuards(JwtAuthGuard)` (controller-level, already in
place). User scoping via `user.sub` on the repo.list call.

### 2. Frontend — `EndpointReportsPage`

**Route**: `/benchmarks/reports`

**File**: `apps/web/src/features/benchmarks/EndpointReportsPage.tsx`

**Layout**:
```
PageHeader: 端点报告 / Endpoint Reports
   subtitle: 按连接聚合最近 N 天的基准测试，便于追踪端点健康趋势
   rightSlot: <Select> 7d / 30d / 90d (default 30d)

(Empty state)
   When items.length === 0:
     EmptyState icon=BarChart3 title="暂无报告数据"
     body="选定时间范围内没有基准测试。"

(Otherwise)
   Cards in a grid (md:grid-cols-2 lg:grid-cols-3 gap-4)
   ┌──────────────────────────────────────┐
   │ <connection.name> · <model>          │
   │ <baseUrl monospace muted>            │
   │ <category Badge>                     │
   │ ─────                                │
   │ <range> · <totalRuns> 次测试          │
   │ 成功率: <successRate%>                │
   │ p95: 147 → 296ms (▲ +149ms)          │
   │ 最近: <name> · <relative time>        │
   │ <StatusBadge status>                 │
   │                       [查看历史 →]    │
   └──────────────────────────────────────┘
```

**Click "查看历史"** → `/benchmarks/<scenario>?connectionId=<id>` where
`scenario` is derived from the connection's category (chat/audio/embeddings/
rerank/image → inference / capacity / gateway via existing
`SCENARIOS` mapping). For non-chat categories that only fit one
scenario (e.g. embeddings → only inference / gateway can target them),
default to inference; user can switch.

Actually simpler: navigate to `/benchmarks/inference?connectionId=<id>`
(the most common scenario), and rely on the user clicking sibling
scenario tabs in the sidebar to widen. Avoids a half-baked "guess
scenario from category" mapping.

**Trend signal** (no sparkline in v1):
- p95Latency.last !== null && p95Latency.first !== null:
  show "147 → 296ms" + a colored ▲/▼ delta:
  - delta > +5%  → red ▲ (regression)
  - delta < −5%  → green ▼ (improvement)
  - else → muted ▬ (stable)
- only one bound: show that single value
- both null: show "—"

### 3. Sidebar wiring

`apps/web/src/components/sidebar/sidebar-config.tsx`:

```ts
// Before:
{ to: "/benchmarks/compare", icon: GitCompare, labelKey: "items.benchmarkCompare" },

// After:
{ to: "/benchmarks/reports", icon: BarChart3, labelKey: "items.endpointReports" },
```

i18n keys (`apps/web/src/locales/{zh-CN,en-US}/sidebar.json`):
- Drop `items.benchmarkCompare`
- Add `items.endpointReports` → "端点报告" / "Endpoint Reports"

### 4. Compatibility — `/benchmarks/compare` route

The route stays mounted (existing `BenchmarkComparePage` for
`?ids=...` deep-links from the list page's "对比 (N)" button). When the
URL has no `ids` param, redirect to `/benchmarks/inference` instead of
showing the now-removed `BenchmarkCompareEmpty`.

`apps/web/src/App.tsx` (or wherever the route is declared):
```tsx
<Route path="/benchmarks/compare" element={<BenchmarkCompareGate />} />
```
where `BenchmarkCompareGate` checks `useSearchParams()` for `ids` and
either renders `<BenchmarkComparePage />` or `<Navigate to="/benchmarks/inference" replace />`.

### 5. Cleanup

- Delete `apps/web/src/features/benchmarks/compare/BenchmarkCompareEmpty.tsx`
- Delete `apps/web/src/features/benchmarks/compare/__tests__/BenchmarkCompareEmpty.test.tsx`
- Drop `compare.empty.*` from `apps/web/src/locales/{zh-CN,en-US}/benchmarks.json`

## Data flow

```
EndpointReportsPage
  ↓ uses
useEndpointReports(range)  ← new query hook in apps/web/src/features/benchmarks/queries.ts
  ↓ GET /api/benchmarks/reports/by-connection?range=30d
benchmark.controller.ts
  ↓ JwtAuthGuard → user.sub
benchmark.service.ts.getByConnectionReports(userId, range)
  ↓ benchmark.repository.list({ userId, createdAfter })
Prisma query → groupBy in JS → response
```

## Testing

**Backend**:
- `benchmark.service.spec.ts`:
  - `groupBy connectionId` correctness (3 connections, mixed scenarios)
  - successRate math (3 completed + 2 failed = 60%)
  - p95 first/last picks the chronologically-earliest/latest completed run
  - dropped rows when `connection === null`
- `benchmark.controller.spec.ts`: route returns 200 + shape validates
  against `endpointReportsResponseSchema`

**Frontend**:
- `EndpointReportsPage.test.tsx`:
  - empty state when `items === []`
  - card renders connection name + model + baseUrl + category badge
  - "查看历史" link points to `/benchmarks/inference?connectionId=<id>`
  - regression marker (▲ red) renders when last > first × 1.05
  - improvement marker (▼ green) when last < first × 0.95
  - stable marker (▬ muted) within ±5%
- `BenchmarkCompareGate.test.tsx`:
  - with `?ids=a,b` renders compare page
  - without `?ids` redirects to `/benchmarks/inference`

## Implementation order (drives the plan)

1. Contract types in `packages/contracts/src/benchmark.ts`
2. Backend metrics helper (mirror FE), service method, controller route, specs
3. FE query hook + EndpointReportsPage + tests
4. Sidebar config + i18n keys
5. App.tsx — route wiring + BenchmarkCompareGate
6. Cleanup: delete BenchmarkCompareEmpty + tests + i18n keys
7. E2E smoke: navigate to /benchmarks/reports, see at least one card
   when seed has benchmarks

## Open questions

None blocking. v1 is intentionally light on visualization (no
sparkline) so the page lands quickly; v2 can add charts once users
demand them.
