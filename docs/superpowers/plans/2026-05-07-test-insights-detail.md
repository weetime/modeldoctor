# Test Insights — Detail View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a connection-level drill-in page at `/benchmarks/reports/:connectionId` (page header + summary tile + tool distribution + p95 timeseries + simplified run history); surface cancellation count on the index card so the success-rate denominator is transparent.

**Architecture:** No new backend endpoint — the page reuses `GET /api/benchmarks?connectionId=…&createdAfter=…&limit=200` and computes the timeseries client-side. Index gains a `statusCounts` field on the existing `endpointReportSchema` (counted in the existing `getByConnectionReports` groupBy loop, zero query cost). New components: a small echarts line wrapper, a read-only run table, the page itself.

**Tech Stack:** TypeScript, NestJS, Prisma, React + react-hook-form, TanStack Query, echarts-for-react (already in deps), Vitest 2, Testing Library, Playwright. Spec: `docs/superpowers/specs/2026-05-07-test-insights-detail-design.md`. Branch: `feat/test-insights-detail` (worktree at `/Users/fangyong/vllm/modeldoctor/feat-test-insights-detail/`).

---

## File Structure

**Contracts** (`packages/contracts/src/`):
- **MODIFY** `benchmark.ts` — `endpointReportSchema` gains `statusCounts`

**Backend** (`apps/api/src/modules/benchmark/`):
- **MODIFY** `benchmark.service.ts` — populate `statusCounts` in the existing groupBy loop
- **MODIFY** `benchmark.service.spec.ts` — assert breakdown math

**Frontend** (`apps/web/src/`):
- **MODIFY** `features/benchmarks/EndpointReportsPage.tsx` — render breakdown text under existing summary line; change "View history" link target to detail page
- **MODIFY** `features/benchmarks/__tests__/EndpointReportsPage.test.tsx` — fixture gains `statusCounts`; new assertions for breakdown + new link target
- **NEW** `features/benchmarks/TestInsightsP95Chart.tsx` — echarts line component
- **NEW** `features/benchmarks/__tests__/TestInsightsP95Chart.test.tsx`
- **NEW** `features/benchmarks/TestInsightsRunsTable.tsx` — simplified read-only table
- **NEW** `features/benchmarks/__tests__/TestInsightsRunsTable.test.tsx`
- **NEW** `features/benchmarks/TestInsightsDetailPage.tsx` — the page
- **NEW** `features/benchmarks/__tests__/TestInsightsDetailPage.test.tsx`
- **MODIFY** `router/index.tsx` — mount `/benchmarks/reports/:connectionId`
- **MODIFY** `locales/zh-CN/benchmarks.json` + `locales/en-US/benchmarks.json` — `reports.detail.*` keys; new `reports.summary.statusBreakdown` key; tooltip text

**E2E**:
- **NEW** `e2e/benchmarks/test-insights-detail.spec.ts`

---

## Pre-flight

- [ ] **Step 0.1: Confirm worktree + branch**

Run: `git rev-parse --abbrev-ref HEAD && pwd`
Expected:
```
feat/test-insights-detail
/Users/fangyong/vllm/modeldoctor/feat-test-insights-detail
```

- [ ] **Step 0.2: Pre-flight build (already done at worktree create)**

Run: `pnpm install --frozen-lockfile && pnpm -F @modeldoctor/api db:generate && pnpm -r build`
Expected: all packages clean.

---

## Phase A — Contract + Backend

### Task 1: Contract — `statusCounts` on endpointReportSchema

**Files:**
- Modify: `packages/contracts/src/benchmark.ts`

- [ ] **Step 1.1: Add the field**

Find `endpointReportSchema` (already defined; gained the `connection.extends` and `p95.nonnegative()` polish in PR #140). Add `statusCounts` between `totalRuns` and `successRate`:

```ts
export const endpointReportSchema = z.object({
  connection: benchmarkConnectionRefSchema.extend({
    category: ModalityCategorySchema,
  }),
  totalRuns: z.number().int().nonnegative(),
  /** Per-status row counts within the report window. The success-rate
   * denominator is `completed + failed` only — `canceled` is user
   * action, `inProgress` covers pending/submitted/running. Surfaced so
   * the index card can show the breakdown transparently. */
  statusCounts: z.object({
    completed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    canceled: z.number().int().nonnegative(),
    inProgress: z.number().int().nonnegative(),
  }),
  successRate: z.number().min(0).max(100).nullable(),
  // ... existing p95Latency + latestRun
});
```

- [ ] **Step 1.2: Build contracts**

Run: `pnpm -F @modeldoctor/contracts build`
Expected: success.

- [ ] **Step 1.3: Commit**

```bash
git add packages/contracts/src/benchmark.ts
git commit -m "$(cat <<'EOF'
feat(contracts): endpointReport.statusCounts for transparent denominator

Adds completed / failed / canceled / inProgress counts so the index
card can surface "成功 X · 失败 Y · 取消 Z" alongside the success
rate. Required field — the only consumer is our own page so we land
the breaking change atomically with the consumer change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Backend — populate `statusCounts`

**Files:**
- Modify: `apps/api/src/modules/benchmark/benchmark.service.ts`
- Modify: `apps/api/src/modules/benchmark/benchmark.service.spec.ts`

- [ ] **Step 2.1: Add failing spec case**

Append to the existing `BenchmarkService.getByConnectionReports` describe block in `benchmark.service.spec.ts`:

```ts
  it("emits statusCounts breakdown (completed / failed / canceled / inProgress)", async () => {
    const repo = makeMockRepoLocal();
    repo.list.mockResolvedValueOnce({
      items: [
        makeRow({ id: "b1", status: "completed" }),
        makeRow({ id: "b2", status: "completed" }),
        makeRow({ id: "b3", status: "completed" }),
        makeRow({ id: "b4", status: "failed" }),
        makeRow({ id: "b5", status: "canceled" }),
        makeRow({ id: "b6", status: "running" }),
        makeRow({ id: "b7", status: "submitted" }),
        makeRow({ id: "b8", status: "pending" }),
      ],
      nextCursor: null,
    });
    const prisma = makeMockPrismaLocal();
    prisma.connection.findMany.mockResolvedValueOnce([{ id: "c_1", category: "chat" }]);
    const svc = makeSvc(repo, prisma);

    const out = await svc.getByConnectionReports("u_1", "30d");
    expect(out.items[0].statusCounts).toEqual({
      completed: 3,
      failed: 1,
      canceled: 1,
      inProgress: 3, // pending + submitted + running
    });
  });
```

- [ ] **Step 2.2: Run spec to confirm failure**

Run: `pnpm -F @modeldoctor/api exec vitest run src/modules/benchmark/benchmark.service.spec.ts`
Expected: FAIL — `out.items[0].statusCounts` is undefined or missing keys.

- [ ] **Step 2.3: Implement**

Edit `apps/api/src/modules/benchmark/benchmark.service.ts`. Inside the existing `for (const [connId, runs] of groups.entries())` loop in `getByConnectionReports`, immediately after the `completed`/`failed` filters (where the spec comment about cancellation lives), add:

```ts
      const canceled = runs.filter((r) => r.status === "canceled").length;
      const inProgress = runs.filter(
        (r) =>
          r.status === "pending" || r.status === "submitted" || r.status === "running",
      ).length;
```

Then in the `items.push({...})` block, add `statusCounts` between `totalRuns` and `successRate`:

```ts
      items.push({
        connection: { /* unchanged */ },
        totalRuns: runs.length,
        statusCounts: {
          completed: completed.length,
          failed: failed.length,
          canceled,
          inProgress,
        },
        successRate,
        p95Latency,
        latestRun,
      });
```

- [ ] **Step 2.4: Run spec to confirm pass**

Run: `pnpm -F @modeldoctor/api exec vitest run src/modules/benchmark/benchmark.service.spec.ts`
Expected: PASS — original cases + 1 new case.

- [ ] **Step 2.5: Run full api specs (sanity, no regression)**

Run: `pnpm -F @modeldoctor/api test`
Expected: all green.

- [ ] **Step 2.6: Commit**

```bash
git add apps/api/src/modules/benchmark/benchmark.service.ts apps/api/src/modules/benchmark/benchmark.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(api): populate statusCounts in getByConnectionReports

Counts completed / failed / canceled / inProgress per connection group
during the existing groupBy loop — zero new query cost. Lets the index
card show the denominator math instead of a single opaque rate.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase B — Index card: breakdown + new link target

### Task 3: EndpointReportsPage — show breakdown + redirect to detail page

**Files:**
- Modify: `apps/web/src/features/benchmarks/EndpointReportsPage.tsx`
- Modify: `apps/web/src/features/benchmarks/__tests__/EndpointReportsPage.test.tsx`
- Modify: `apps/web/src/locales/zh-CN/benchmarks.json`
- Modify: `apps/web/src/locales/en-US/benchmarks.json`

- [ ] **Step 3.1: Add i18n keys**

Edit `apps/web/src/locales/zh-CN/benchmarks.json` `reports.summary` block (find it near the existing `successRate` key). Add:

```json
,
      "statusBreakdown": "成功 {{completed}} · 失败 {{failed}} · 取消 {{canceled}}",
      "statusBreakdownTooltip": "成功率分母 = 成功 + 失败；取消不计入"
```

Edit `apps/web/src/locales/en-US/benchmarks.json` similarly:

```json
,
      "statusBreakdown": "Success {{completed}} · Failed {{failed}} · Canceled {{canceled}}",
      "statusBreakdownTooltip": "Success-rate denominator = success + failed; canceled excluded"
```

Verify JSON parses:
```
node -e "['./apps/web/src/locales/zh-CN/benchmarks.json','./apps/web/src/locales/en-US/benchmarks.json'].forEach(p => require(p)); console.log('ok')"
```

- [ ] **Step 3.2: Update existing test fixture**

Edit `apps/web/src/features/benchmarks/__tests__/EndpointReportsPage.test.tsx`. Find the `oneItem` fixture (`EndpointReportsResponse`) and add `statusCounts` to it:

```ts
const oneItem: EndpointReportsResponse = {
  range: "30d",
  generatedAt: "2026-05-06T00:00:00.000Z",
  items: [
    {
      connection: { /* unchanged */ },
      totalRuns: 12,
      statusCounts: { completed: 11, failed: 1, canceled: 0, inProgress: 0 },
      successRate: 99.8,
      // ... unchanged
    },
  ],
};
```

The empty fixture (the one with `items: []`) needs no change.

- [ ] **Step 3.3: Add failing test cases**

In the same file, append to `describe("EndpointReportsPage", …)`:

```ts
  it("renders the status breakdown text with completed/failed/canceled counts", async () => {
    vi.mocked(api.get).mockResolvedValue({
      ...oneItem,
      items: [
        {
          ...oneItem.items[0],
          totalRuns: 12,
          statusCounts: { completed: 10, failed: 1, canceled: 1, inProgress: 0 },
        },
      ],
    });
    render(withProviders(<EndpointReportsPage />));
    await waitFor(() =>
      // The breakdown text fragments — exact whitespace varies by locale.
      expect(
        screen.getByText(/成功 10 · 失败 1 · 取消 1|Success 10 · Failed 1 · Canceled 1/i),
      ).toBeInTheDocument(),
    );
  });

  it("'View history' link navigates to /benchmarks/reports/<connectionId>?range=<range>", async () => {
    vi.mocked(api.get).mockResolvedValue(oneItem);
    render(withProviders(<EndpointReportsPage />));
    const link = await screen.findByRole("link", { name: /View history|查看历史/i });
    expect(link).toHaveAttribute("href", "/benchmarks/reports/c_1?range=30d");
  });
```

(Update the existing "View history" test — the older one asserting `/benchmarks/inference?connectionId=c_1`. Replace its expected href with the new one. There can only be ONE active assertion on that link.)

Find the existing test:
```ts
  it("'View history' link points to /benchmarks/inference?connectionId=<id>", async () => {
    vi.mocked(api.get).mockResolvedValue(oneItem);
    render(withProviders(<EndpointReportsPage />));
    const link = await screen.findByRole("link", { name: /View history|查看历史/i });
    expect(link).toHaveAttribute("href", "/benchmarks/inference?connectionId=c_1");
  });
```

Replace its expected `href` value (the test name + body) — or remove the duplicate; keep only the new "/benchmarks/reports/c_1?range=30d" assertion.

- [ ] **Step 3.4: Run test to confirm failure**

Run: `pnpm -F @modeldoctor/web exec vitest run src/features/benchmarks/__tests__/EndpointReportsPage.test.tsx`
Expected: FAIL — breakdown not rendered, link points to old href.

- [ ] **Step 3.5: Implement**

Edit `apps/web/src/features/benchmarks/EndpointReportsPage.tsx`.

(a) Find the existing card body summary line:

```tsx
                  <div className="text-muted-foreground">
                    {t("reports.summary.totalRuns", { count: item.totalRuns })} ·{" "}
                    {item.successRate != null
                      ? t("reports.summary.successRate", {
                          rate: item.successRate.toFixed(1),
                        })
                      : t("reports.summary.successRateMissing")}
                  </div>
```

Replace with:

```tsx
                  <div className="space-y-1 text-muted-foreground">
                    <div>
                      {t("reports.summary.totalRuns", { count: item.totalRuns })} ·{" "}
                      {item.successRate != null
                        ? t("reports.summary.successRate", {
                            rate: item.successRate.toFixed(1),
                          })
                        : t("reports.summary.successRateMissing")}
                    </div>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="cursor-help text-xs">
                          {t("reports.summary.statusBreakdown", {
                            completed: item.statusCounts.completed,
                            failed: item.statusCounts.failed,
                            canceled: item.statusCounts.canceled,
                          })}
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        {t("reports.summary.statusBreakdownTooltip")}
                      </TooltipContent>
                    </Tooltip>
                  </div>
```

Add `Tooltip, TooltipContent, TooltipTrigger` to the imports from `@/components/ui/tooltip`.

(b) Find the "View history" link block:

```tsx
                  <div className="pt-2">
                    <Button asChild variant="outline" size="sm" className="gap-1">
                      <Link to={`/benchmarks/inference?connectionId=${item.connection.id}`}>
                        {t("reports.viewHistory")}
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
```

Change the `to=` to `/benchmarks/reports/${item.connection.id}?range=${range}`. (The page already has `range` in scope from `const [range, setRange] = useState<EndpointReportRange>("30d")`.)

- [ ] **Step 3.6: Run test to confirm pass**

Run: `pnpm -F @modeldoctor/web exec vitest run src/features/benchmarks/__tests__/EndpointReportsPage.test.tsx`
Expected: PASS — all cases.

- [ ] **Step 3.7: Commit**

```bash
git add apps/web/src/features/benchmarks/EndpointReportsPage.tsx apps/web/src/features/benchmarks/__tests__/EndpointReportsPage.test.tsx apps/web/src/locales/zh-CN/benchmarks.json apps/web/src/locales/en-US/benchmarks.json
git commit -m "$(cat <<'EOF'
feat(web): index card shows status breakdown; link goes to detail page

The card now spells out completed / failed / canceled counts under the
summary line with a tooltip explaining the success-rate denominator
math. "View history" navigates to /benchmarks/reports/<id>?range=<range>
instead of the legacy benchmark list — sets up the drill-in flow that
the next tasks build out.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase C — Detail page

### Task 4: TestInsightsP95Chart — echarts line wrapper

**Files:**
- Create: `apps/web/src/features/benchmarks/TestInsightsP95Chart.tsx`
- Create: `apps/web/src/features/benchmarks/__tests__/TestInsightsP95Chart.test.tsx`

- [ ] **Step 4.1: Write failing test**

Create `apps/web/src/features/benchmarks/__tests__/TestInsightsP95Chart.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import { TestInsightsP95Chart } from "../TestInsightsP95Chart";

// echarts-for-react renders an <Echarts /> div in jsdom; we assert via
// the data-testid the wrapper exposes and the empty/single-point fallback
// text. Don't try to introspect the echarts internals in a unit test.
vi.mock("echarts-for-react", () => ({
  default: (props: { option: unknown }) => (
    <div data-testid="echarts" data-option={JSON.stringify(props.option)} />
  ),
}));

function withI18n(node: React.ReactNode) {
  return <I18nextProvider i18n={i18n}>{node}</I18nextProvider>;
}

describe("TestInsightsP95Chart", () => {
  it("renders empty placeholder when no data points", () => {
    render(withI18n(<TestInsightsP95Chart points={[]} />));
    expect(screen.getByText(/数据点不足|Not enough data/i)).toBeInTheDocument();
    expect(screen.queryByTestId("echarts")).not.toBeInTheDocument();
  });

  it("renders the line chart when at least one data point exists", () => {
    render(
      withI18n(
        <TestInsightsP95Chart
          points={[
            { ts: "2026-05-01T00:00:00.000Z", p95Ms: 147, name: "run-1" },
            { ts: "2026-05-05T00:00:00.000Z", p95Ms: 296, name: "run-2" },
          ]}
        />,
      ),
    );
    const chart = screen.getByTestId("echarts");
    const opt = JSON.parse(chart.getAttribute("data-option") ?? "{}") as {
      xAxis: { data: string[] };
      series: Array<{ data: number[] }>;
    };
    expect(opt.series[0].data).toEqual([147, 296]);
    expect(opt.xAxis.data).toHaveLength(2);
  });

  it("renders single-point chart without crashing", () => {
    render(
      withI18n(
        <TestInsightsP95Chart
          points={[{ ts: "2026-05-01T00:00:00.000Z", p95Ms: 100, name: "only" }]}
        />,
      ),
    );
    expect(screen.getByTestId("echarts")).toBeInTheDocument();
  });
});
```

- [ ] **Step 4.2: Run test to confirm failure**

Run: `pnpm -F @modeldoctor/web exec vitest run src/features/benchmarks/__tests__/TestInsightsP95Chart.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 4.3: Implement the component**

Create `apps/web/src/features/benchmarks/TestInsightsP95Chart.tsx`:

```tsx
import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

export interface P95Point {
  /** ISO timestamp string. */
  ts: string;
  /** p95 latency in ms. */
  p95Ms: number;
  /** Human-readable run name for tooltip. */
  name: string;
}

interface Props {
  points: P95Point[];
}

/**
 * p95-over-time line chart for the test insights detail page. Wraps
 * echarts-for-react with a sensible default theme. Empty state renders
 * a placeholder rather than the chart so users see the "no data" case
 * explicitly instead of an empty axis.
 */
export function TestInsightsP95Chart({ points }: Props) {
  const { t } = useTranslation("benchmarks");
  const option = useMemo<EChartsOption>(() => {
    return {
      grid: { top: 12, right: 12, bottom: 32, left: 48 },
      tooltip: {
        trigger: "axis",
        formatter: (params: unknown) => {
          // params is an array of axis-pointer entries; we only have one series.
          const arr = Array.isArray(params) ? params : [params];
          const p = arr[0] as { dataIndex: number; value: number };
          const point = points[p.dataIndex];
          if (!point) return String(p.value);
          const date = new Date(point.ts);
          return `${point.name}<br/>${date.toLocaleString()}<br/>p95: <b>${p.value} ms</b>`;
        },
      },
      xAxis: {
        type: "category",
        data: points.map((p) => p.ts),
        axisLabel: {
          formatter: (iso: string) => {
            const d = new Date(iso);
            return `${d.getMonth() + 1}/${d.getDate()}`;
          },
        },
      },
      yAxis: {
        type: "value",
        axisLabel: { formatter: "{value} ms" },
        scale: true,
      },
      series: [
        {
          type: "line",
          name: "p95",
          data: points.map((p) => p.p95Ms),
          symbolSize: 6,
          smooth: false,
          lineStyle: { width: 2 },
        },
      ],
    };
  }, [points]);

  if (points.length === 0) {
    return (
      <div
        role="status"
        className="flex h-64 items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground"
      >
        {t("reports.detail.timeseries.empty")}
      </div>
    );
  }
  return <ReactECharts option={option} style={{ height: 256, width: "100%" }} />;
}
```

- [ ] **Step 4.4: Add the i18n key referenced**

Edit `apps/web/src/locales/zh-CN/benchmarks.json` `reports.detail` block (will be added in Task 6, but add this single key now if the block doesn't exist; otherwise add inside it):

```json
,
    "detail": {
      "timeseries": {
        "title": "p95 时间序列",
        "empty": "数据点不足"
      }
    }
```

Edit `apps/web/src/locales/en-US/benchmarks.json` similarly:

```json
,
    "detail": {
      "timeseries": {
        "title": "p95 over time",
        "empty": "Not enough data"
      }
    }
```

(Other `detail.*` keys are added in Task 6 — extend this block then.)

Verify JSON: `node -e "['./apps/web/src/locales/zh-CN/benchmarks.json','./apps/web/src/locales/en-US/benchmarks.json'].forEach(p => require(p)); console.log('ok')"`

- [ ] **Step 4.5: Run test to confirm pass**

Run: `pnpm -F @modeldoctor/web exec vitest run src/features/benchmarks/__tests__/TestInsightsP95Chart.test.tsx`
Expected: PASS — 3 tests.

- [ ] **Step 4.6: Commit**

```bash
git add apps/web/src/features/benchmarks/TestInsightsP95Chart.tsx apps/web/src/features/benchmarks/__tests__/TestInsightsP95Chart.test.tsx apps/web/src/locales/zh-CN/benchmarks.json apps/web/src/locales/en-US/benchmarks.json
git commit -m "$(cat <<'EOF'
feat(web): TestInsightsP95Chart — echarts line for p95-over-time

Small wrapper around echarts-for-react. Empty state renders a dashed
placeholder so the user sees "no data" explicitly instead of an empty
axis. Single-point input renders fine (echarts handles it).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: TestInsightsRunsTable — simplified read-only table

**Files:**
- Create: `apps/web/src/features/benchmarks/TestInsightsRunsTable.tsx`
- Create: `apps/web/src/features/benchmarks/__tests__/TestInsightsRunsTable.test.tsx`

- [ ] **Step 5.1: Write failing test**

Create `apps/web/src/features/benchmarks/__tests__/TestInsightsRunsTable.test.tsx`:

```tsx
import type { Benchmark } from "@modeldoctor/contracts";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import { TestInsightsRunsTable } from "../TestInsightsRunsTable";

function withProviders(node: React.ReactNode) {
  return (
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>{node}</MemoryRouter>
    </I18nextProvider>
  );
}

function makeRun(over: Partial<Benchmark> = {}): Benchmark {
  return {
    id: over.id ?? "b_1",
    userId: "u_1",
    connectionId: "c_1",
    connection: { id: "c_1", name: "conn", model: "m", baseUrl: "http://x" },
    scenario: "inference",
    tool: "guidellm",
    toolVersion: null,
    name: over.name ?? "run-1",
    description: null,
    status: over.status ?? "completed",
    statusMessage: null,
    progress: 1,
    driverHandle: null,
    params: {},
    rawOutput: null,
    summaryMetrics: over.summaryMetrics ?? {
      tool: "guidellm",
      data: {
        e2eLatency: { p95: 100 },
        requests: { total: 100, error: 1 },
      },
    },
    serverMetrics: null,
    templateId: null,
    parentBenchmarkId: null,
    baselineId: null,
    logs: null,
    createdAt: over.createdAt ?? "2026-05-01T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
    baselineFor: null,
    ...over,
  };
}

describe("TestInsightsRunsTable", () => {
  it("renders one row per run with name link, tool badge, status, p95, errorRate", () => {
    render(
      withProviders(
        <TestInsightsRunsTable
          runs={[
            makeRun({ id: "b1", name: "alpha" }),
            makeRun({ id: "b2", name: "beta", status: "failed" }),
          ]}
        />,
      ),
    );
    const alphaLink = screen.getByRole("link", { name: "alpha" });
    expect(alphaLink).toHaveAttribute("href", "/benchmarks/b1");
    expect(screen.getByRole("link", { name: "beta" })).toHaveAttribute("href", "/benchmarks/b2");

    // tool badges (rendered twice — once per row)
    expect(screen.getAllByText(/guidellm/i)).toHaveLength(2);

    // p95 values: 100ms (alpha) and 100ms (beta — same fixture)
    expect(screen.getAllByText(/100/).length).toBeGreaterThanOrEqual(2);
  });

  it("renders dash when summary metrics are absent", () => {
    render(
      withProviders(
        <TestInsightsRunsTable runs={[makeRun({ id: "b1", summaryMetrics: null })]} />,
      ),
    );
    // Find the table cell containing "—". It appears in p95 + errorRate columns.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("renders empty placeholder when runs is []", () => {
    render(withProviders(<TestInsightsRunsTable runs={[]} />));
    expect(screen.getByText(/选定时间范围内没有基准测试|No benchmarks within/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 5.2: Run test to confirm failure**

Run: `pnpm -F @modeldoctor/web exec vitest run src/features/benchmarks/__tests__/TestInsightsRunsTable.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 5.3: Add i18n key for the empty state**

Edit the existing `reports.detail` block in both locales (added in Task 4) to include the `runs` sub-block:

zh-CN `reports.detail`:
```json
    "detail": {
      "timeseries": { "title": "p95 时间序列", "empty": "数据点不足" },
      "runs": {
        "title": "运行历史",
        "empty": "选定时间范围内没有基准测试",
        "columns": {
          "name": "名称",
          "createdAt": "创建时间",
          "tool": "工具",
          "status": "状态",
          "p95": "p95 (ms)",
          "errorRate": "错误率"
        }
      }
    }
```

en-US:
```json
    "detail": {
      "timeseries": { "title": "p95 over time", "empty": "Not enough data" },
      "runs": {
        "title": "Run history",
        "empty": "No benchmarks within the selected window",
        "columns": {
          "name": "Name",
          "createdAt": "Created",
          "tool": "Tool",
          "status": "Status",
          "p95": "p95 (ms)",
          "errorRate": "Error rate"
        }
      }
    }
```

- [ ] **Step 5.4: Implement the component**

Create `apps/web/src/features/benchmarks/TestInsightsRunsTable.tsx`:

```tsx
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Benchmark } from "@modeldoctor/contracts";
import { formatDistanceToNow } from "date-fns";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { readErrorRate, readP95Latency } from "./compare/metrics";
import { StatusBadge } from "./status-display";

interface Props {
  runs: Benchmark[];
}

function fmtNum(n: number | null | undefined, digits = 1): string {
  if (n == null) return "—";
  return n.toFixed(digits);
}

/**
 * Read-only run history for the test-insights detail page. Same data
 * the BenchmarkListShell shows but without selection / actions / compare —
 * users come here to inspect, not manage.
 */
export function TestInsightsRunsTable({ runs }: Props) {
  const { t } = useTranslation("benchmarks");
  if (runs.length === 0) {
    return (
      <div
        role="status"
        className="flex h-32 items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground"
      >
        {t("reports.detail.runs.empty")}
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("reports.detail.runs.columns.name")}</TableHead>
            <TableHead>{t("reports.detail.runs.columns.createdAt")}</TableHead>
            <TableHead>{t("reports.detail.runs.columns.tool")}</TableHead>
            <TableHead>{t("reports.detail.runs.columns.status")}</TableHead>
            <TableHead className="text-right">
              {t("reports.detail.runs.columns.p95")}
            </TableHead>
            <TableHead className="text-right">
              {t("reports.detail.runs.columns.errorRate")}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((b) => (
            <TableRow key={b.id}>
              <TableCell className="font-medium">
                <Link
                  to={`/benchmarks/${b.id}`}
                  className="hover:text-primary hover:underline"
                >
                  {b.name}
                </Link>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDistanceToNow(new Date(b.createdAt), { addSuffix: true })}
              </TableCell>
              <TableCell>
                <Badge variant="default">{b.tool}</Badge>
              </TableCell>
              <TableCell>
                <StatusBadge status={b.status} />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {fmtNum(readP95Latency(b.summaryMetrics))}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {fmtNum(readErrorRate(b.summaryMetrics), 4)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 5.5: Run test to confirm pass**

Run: `pnpm -F @modeldoctor/web exec vitest run src/features/benchmarks/__tests__/TestInsightsRunsTable.test.tsx`
Expected: PASS — 3 tests.

- [ ] **Step 5.6: Commit**

```bash
git add apps/web/src/features/benchmarks/TestInsightsRunsTable.tsx apps/web/src/features/benchmarks/__tests__/TestInsightsRunsTable.test.tsx apps/web/src/locales/zh-CN/benchmarks.json apps/web/src/locales/en-US/benchmarks.json
git commit -m "$(cat <<'EOF'
feat(web): TestInsightsRunsTable — read-only run history

Simplified table for the detail page: name (link to detail) · created
(relative) · tool badge · status badge · p95 ms · error rate. No
selection / compare / row-actions menu — this view is for inspection,
not management.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: TestInsightsDetailPage

**Files:**
- Create: `apps/web/src/features/benchmarks/TestInsightsDetailPage.tsx`
- Create: `apps/web/src/features/benchmarks/__tests__/TestInsightsDetailPage.test.tsx`
- Modify: `apps/web/src/locales/zh-CN/benchmarks.json` (add remaining `detail.*` keys)
- Modify: `apps/web/src/locales/en-US/benchmarks.json`

- [ ] **Step 6.1: Add remaining i18n keys**

Extend the `reports.detail` block (already created in Tasks 4 + 5) with the page-level keys.

zh-CN — final shape of `reports.detail`:
```json
    "detail": {
      "backToIndex": "返回测试洞察",
      "summary": {
        "title": "概要",
        "toolDistribution": "工具分布"
      },
      "timeseries": { "title": "p95 时间序列", "empty": "数据点不足" },
      "runs": {
        "title": "运行历史",
        "empty": "选定时间范围内没有基准测试",
        "columns": {
          "name": "名称",
          "createdAt": "创建时间",
          "tool": "工具",
          "status": "状态",
          "p95": "p95 (ms)",
          "errorRate": "错误率"
        }
      },
      "notFound": {
        "title": "未找到此连接",
        "body": "它可能已被删除"
      }
    }
```

en-US — final shape:
```json
    "detail": {
      "backToIndex": "Back to Test Insights",
      "summary": {
        "title": "Summary",
        "toolDistribution": "Tool distribution"
      },
      "timeseries": { "title": "p95 over time", "empty": "Not enough data" },
      "runs": {
        "title": "Run history",
        "empty": "No benchmarks within the selected window",
        "columns": {
          "name": "Name",
          "createdAt": "Created",
          "tool": "Tool",
          "status": "Status",
          "p95": "p95 (ms)",
          "errorRate": "Error rate"
        }
      },
      "notFound": {
        "title": "Connection not found",
        "body": "It may have been deleted"
      }
    }
```

Verify JSON.

- [ ] **Step 6.2: Write failing test**

Create `apps/web/src/features/benchmarks/__tests__/TestInsightsDetailPage.test.tsx`:

```tsx
import type { Benchmark, ConnectionPublic, ListBenchmarksResponse } from "@modeldoctor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import { TestInsightsDetailPage } from "../TestInsightsDetailPage";

vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
import { api } from "@/lib/api-client";

// echarts wrapper is verified in its own spec; stub here to keep the
// page test fast.
vi.mock("../TestInsightsP95Chart", () => ({
  TestInsightsP95Chart: ({ points }: { points: unknown[] }) => (
    <div data-testid="p95-chart" data-len={points.length} />
  ),
}));

const conn: ConnectionPublic = {
  id: "c_1",
  userId: "u_1",
  name: "bge-by-mis-tei",
  baseUrl: "http://x",
  apiKeyPreview: "sk-...",
  model: "m1",
  customHeaders: "",
  queryParams: "",
  category: "embeddings",
  tags: [],
  prometheusUrl: null,
  serverKind: null,
  tokenizerHfId: null,
  createdAt: "2026-05-06T00:00:00.000Z",
  updatedAt: "2026-05-06T00:00:00.000Z",
};

function makeRun(over: Partial<Benchmark> = {}): Benchmark {
  return {
    id: over.id ?? "b_1",
    userId: "u_1",
    connectionId: "c_1",
    connection: { id: "c_1", name: "bge-by-mis-tei", model: "m1", baseUrl: "http://x" },
    scenario: "inference",
    tool: "guidellm",
    toolVersion: null,
    name: over.name ?? "run",
    description: null,
    status: over.status ?? "completed",
    statusMessage: null,
    progress: 1,
    driverHandle: null,
    params: {},
    rawOutput: null,
    summaryMetrics: over.summaryMetrics ?? {
      tool: "guidellm",
      data: { e2eLatency: { p95: 100 }, requests: { total: 100, error: 0 } },
    },
    serverMetrics: null,
    templateId: null,
    parentBenchmarkId: null,
    baselineId: null,
    logs: null,
    createdAt: over.createdAt ?? "2026-05-01T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
    baselineFor: null,
    ...over,
  };
}

function withProviders(initialUrl = "/benchmarks/reports/c_1") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (children: React.ReactNode) => (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[initialUrl]}>
          <Routes>
            <Route path="/benchmarks/reports/:connectionId" element={children} />
            <Route path="/benchmarks/reports" element={<div>insights index</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>
  );
}

describe("TestInsightsDetailPage", () => {
  it("renders notFound state when /api/connections/:id 404s", async () => {
    const err = new Error("not found") as Error & { status: number };
    err.status = 404;
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.startsWith("/api/connections/")) return Promise.reject(err) as never;
      return Promise.resolve({ items: [], nextCursor: null }) as never;
    });
    const wrap = withProviders();
    render(wrap(<TestInsightsDetailPage />));
    await waitFor(() =>
      expect(screen.getByText(/Connection not found|未找到此连接/i)).toBeInTheDocument(),
    );
  });

  it("renders header + empty body when connection has no runs in window", async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.startsWith("/api/connections/")) return Promise.resolve(conn) as never;
      return Promise.resolve({
        items: [],
        nextCursor: null,
      } satisfies ListBenchmarksResponse) as never;
    });
    const wrap = withProviders();
    render(wrap(<TestInsightsDetailPage />));
    await waitFor(() => expect(screen.getByText("bge-by-mis-tei")).toBeInTheDocument());
    expect(
      screen.getByText(/No benchmarks within|选定时间范围内没有基准测试/i),
    ).toBeInTheDocument();
  });

  it("renders summary tile + chart + table when runs exist", async () => {
    const runs: ListBenchmarksResponse = {
      items: [
        makeRun({ id: "b1", name: "alpha" }),
        makeRun({ id: "b2", name: "beta", tool: "vegeta" }),
      ],
      nextCursor: null,
    };
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.startsWith("/api/connections/")) return Promise.resolve(conn) as never;
      return Promise.resolve(runs) as never;
    });
    const wrap = withProviders();
    render(wrap(<TestInsightsDetailPage />));

    // Page header.
    await waitFor(() => expect(screen.getByText("bge-by-mis-tei")).toBeInTheDocument());
    expect(screen.getByText("http://x")).toBeInTheDocument();

    // Tool distribution renders both tools.
    expect(screen.getByText(/guidellm/)).toBeInTheDocument();
    expect(screen.getByText(/vegeta/)).toBeInTheDocument();

    // Chart placeholder receives 1 point (only completed runs with p95 — both have it).
    const chart = screen.getByTestId("p95-chart");
    expect(chart).toHaveAttribute("data-len", "2");

    // Run history table has both rows (links to detail).
    expect(screen.getByRole("link", { name: "alpha" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "beta" })).toBeInTheDocument();
  });

  it("'Back to insights' link points to /benchmarks/reports", async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.startsWith("/api/connections/")) return Promise.resolve(conn) as never;
      return Promise.resolve({ items: [], nextCursor: null }) as never;
    });
    const wrap = withProviders();
    render(wrap(<TestInsightsDetailPage />));
    const back = await screen.findByRole("link", {
      name: /Back to Test Insights|返回测试洞察/i,
    });
    expect(back).toHaveAttribute("href", "/benchmarks/reports");
  });
});
```

- [ ] **Step 6.3: Run test to confirm failure**

Run: `pnpm -F @modeldoctor/web exec vitest run src/features/benchmarks/__tests__/TestInsightsDetailPage.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 6.4: Implement the page**

Create `apps/web/src/features/benchmarks/TestInsightsDetailPage.tsx`:

```tsx
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConnection } from "@/features/connections/queries";
import type { EndpointReportRange } from "@modeldoctor/contracts";
import { ArrowLeft, BarChart3, SearchX } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { readP95Latency } from "./compare/metrics";
import { useBenchmarkList } from "./queries";
import { TestInsightsP95Chart } from "./TestInsightsP95Chart";
import { TestInsightsRunsTable } from "./TestInsightsRunsTable";

const RANGES: EndpointReportRange[] = ["7d", "30d", "90d"];

function rangeToISO(range: EndpointReportRange): string {
  const days = ({ "7d": 7, "30d": 30, "90d": 90 } as const)[range];
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export function TestInsightsDetailPage() {
  const { t } = useTranslation("benchmarks");
  const { connectionId = "" } = useParams<{ connectionId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const range = (searchParams.get("range") ?? "30d") as EndpointReportRange;

  const conn = useConnection(connectionId);
  const list = useBenchmarkList({
    connectionId,
    createdAfter: rangeToISO(range),
    limit: 200,
    scope: "own",
  });

  // Flatten the first page (we ask for limit=200; never paginate).
  const runs = useMemo(() => list.data?.pages[0]?.items ?? [], [list.data]);

  // Tool distribution: counts by tool, sorted by count desc.
  const toolCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of runs) m.set(r.tool, (m.get(r.tool) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [runs]);
  const maxToolCount = toolCounts[0]?.[1] ?? 1;

  // p95 chart points: completed runs with usable metrics, oldest → newest.
  const chartPoints = useMemo(() => {
    return runs
      .filter((r) => r.status === "completed")
      .map((r) => {
        const p95 = readP95Latency(r.summaryMetrics);
        return p95 != null
          ? { ts: r.createdAt, p95Ms: p95, name: r.name, id: r.id }
          : null;
      })
      .filter((x): x is { ts: string; p95Ms: number; name: string; id: string } => x !== null)
      .sort((a, b) => +new Date(a.ts) - +new Date(b.ts));
  }, [runs]);

  // Connection 404 → notFound state.
  if ((conn.error as { status?: number } | null)?.status === 404) {
    return (
      <>
        <PageHeader title={connectionId} />
        <div className="px-8 py-6">
          <EmptyState
            icon={SearchX}
            title={t("reports.detail.notFound.title")}
            body={t("reports.detail.notFound.body")}
          />
        </div>
      </>
    );
  }

  if (conn.isLoading) {
    return (
      <>
        <PageHeader title="…" />
        <div className="m-8 h-64 animate-pulse rounded-md border border-border bg-muted/30" />
      </>
    );
  }

  if (!conn.data) return null;

  function setRange(next: EndpointReportRange) {
    const sp = new URLSearchParams(searchParams);
    sp.set("range", next);
    setSearchParams(sp);
  }

  return (
    <>
      <PageHeader
        title={conn.data.name}
        subtitle={`${conn.data.baseUrl} · ${conn.data.model}`}
        rightSlot={
          <div className="flex items-center gap-3">
            <Badge variant="outline">{conn.data.category}</Badge>
            <Select value={range} onValueChange={(v) => setRange(v as EndpointReportRange)}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RANGES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {t(`reports.ranges.${r}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button asChild variant="ghost" size="sm">
              <Link to="/benchmarks/reports">
                <ArrowLeft className="mr-1 h-4 w-4" />
                {t("reports.detail.backToIndex")}
              </Link>
            </Button>
          </div>
        }
      />
      <div className="space-y-6 px-8 py-6">
        {/* Summary + tool distribution (2-col on md+) */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold">{t("reports.detail.summary.title")}</h3>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div>{t("reports.summary.totalRuns", { count: runs.length })}</div>
              {/* No statusCounts here — that's on the index card; the detail
                  page already shows status per row in the table. */}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold">
                {t("reports.detail.summary.toolDistribution")}
              </h3>
            </CardHeader>
            <CardContent className="space-y-2">
              {toolCounts.length === 0 ? (
                <div className="text-sm text-muted-foreground">—</div>
              ) : (
                toolCounts.map(([tool, count]) => (
                  <div key={tool} className="flex items-center gap-3 text-sm">
                    <span className="w-20 truncate font-mono text-xs">{tool}</span>
                    <div className="flex-1 overflow-hidden rounded bg-muted">
                      <div
                        className="h-1.5 bg-primary/60"
                        style={{ width: `${(count / maxToolCount) * 100}%` }}
                      />
                    </div>
                    <span className="w-8 text-right tabular-nums text-xs text-muted-foreground">
                      {count}
                    </span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        {/* p95 timeseries */}
        <Card>
          <CardHeader>
            <h3 className="text-sm font-semibold">{t("reports.detail.timeseries.title")}</h3>
          </CardHeader>
          <CardContent>
            <TestInsightsP95Chart points={chartPoints} />
          </CardContent>
        </Card>

        {/* Run history */}
        <Card>
          <CardHeader>
            <h3 className="text-sm font-semibold">{t("reports.detail.runs.title")}</h3>
          </CardHeader>
          <CardContent>
            <TestInsightsRunsTable runs={runs} />
          </CardContent>
        </Card>

        {runs.length === 0 ? (
          <EmptyState
            icon={BarChart3}
            title={t("reports.detail.runs.empty")}
            body={t("reports.empty.body")}
          />
        ) : null}
      </div>
    </>
  );
}
```

- [ ] **Step 6.5: Run test to confirm pass**

Run: `pnpm -F @modeldoctor/web exec vitest run src/features/benchmarks/__tests__/TestInsightsDetailPage.test.tsx`
Expected: PASS — 4 tests.

- [ ] **Step 6.6: Run full web suite (no regressions)**

Run: `pnpm -F @modeldoctor/web test`
Expected: green.

- [ ] **Step 6.7: Commit**

```bash
git add apps/web/src/features/benchmarks/TestInsightsDetailPage.tsx apps/web/src/features/benchmarks/__tests__/TestInsightsDetailPage.test.tsx apps/web/src/locales/zh-CN/benchmarks.json apps/web/src/locales/en-US/benchmarks.json
git commit -m "$(cat <<'EOF'
feat(web): TestInsightsDetailPage — per-connection drill-in

Header (name + baseUrl + model + category + range picker + back-to-
insights), 2-col summary tile, p95 timeseries chart, simplified run
history table. URL-persisted range via ?range=.

Reuses the existing GET /api/benchmarks?connectionId=… endpoint and
the existing useConnection hook — no new backend.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase D — Routing + e2e

### Task 7: Mount `/benchmarks/reports/:connectionId`

**Files:**
- Modify: `apps/web/src/router/index.tsx`

- [ ] **Step 7.1: Wire the route**

Edit `apps/web/src/router/index.tsx`. Add the import:

```tsx
import { TestInsightsDetailPage } from "@/features/benchmarks/TestInsightsDetailPage";
```

Add the route immediately after the existing `/benchmarks/reports` route:

```tsx
{ path: "benchmarks/reports", element: <EndpointReportsPage /> },
{ path: "benchmarks/reports/:connectionId", element: <TestInsightsDetailPage /> },
```

- [ ] **Step 7.2: Type-check**

Run: `pnpm -F @modeldoctor/web type-check`
Expected: clean.

- [ ] **Step 7.3: Commit**

```bash
git add apps/web/src/router/index.tsx
git commit -m "$(cat <<'EOF'
feat(web): mount /benchmarks/reports/:connectionId for the detail view

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: E2E smoke

**Files:**
- Create: `e2e/benchmarks/test-insights-detail.spec.ts`

- [ ] **Step 8.1: Write the spec**

Create `e2e/benchmarks/test-insights-detail.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { registerAndLogin } from "../helpers/auth";
import { resetTestDb } from "../helpers/db";

test.beforeEach(async ({ page }) => {
  resetTestDb();
  await registerAndLogin(page);
});

test("detail page: notFound state for unknown connectionId", async ({ page }) => {
  // Fresh DB has no connections; navigating to a fake id triggers 404.
  await page.goto("/benchmarks/reports/does-not-exist");
  await expect(
    page.getByText(/Connection not found|未找到此连接/i),
  ).toBeVisible({ timeout: 10_000 });
});

test("detail page: empty state when connection exists but has no runs", async ({
  page,
  request,
}) => {
  // Create a connection via the UI helper-style flow: API request scoped
  // to the test session via Playwright's storage state (auth cookie set
  // by registerAndLogin).
  // We use the page's request context (carries auth) to POST a connection.
  const ctx = page.context();
  const apiBase = process.env.E2E_API_BASE ?? "http://localhost:3401";
  const created = await ctx.request.post(`${apiBase}/api/connections`, {
    data: {
      name: "e2e-empty",
      baseUrl: "http://example.test:8000",
      apiKey: "sk-e2e",
      model: "test-model",
      category: "chat",
    },
  });
  expect(created.ok()).toBeTruthy();
  const body = (await created.json()) as { id: string };

  await page.goto(`/benchmarks/reports/${body.id}`);
  await expect(page.getByText("e2e-empty")).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByText(/No benchmarks within|选定时间范围内没有基准测试/i),
  ).toBeVisible();
});

test("detail page: range picker URL-persists via ?range=", async ({ page, request }) => {
  const ctx = page.context();
  const apiBase = process.env.E2E_API_BASE ?? "http://localhost:3401";
  const created = await ctx.request.post(`${apiBase}/api/connections`, {
    data: {
      name: "e2e-range",
      baseUrl: "http://example.test:8000",
      apiKey: "sk-e2e",
      model: "test-model",
      category: "chat",
    },
  });
  const body = (await created.json()) as { id: string };

  await page.goto(`/benchmarks/reports/${body.id}`);

  // Open range picker, pick 7d.
  await page.getByRole("combobox").first().click();
  await page.getByRole("option", { name: /Last 7 days|近 7 天/i }).click();

  await expect(page).toHaveURL(/\?range=7d/);
});
```

- [ ] **Step 8.2: Run e2e**

Run: `pnpm test:e2e:browser e2e/benchmarks/test-insights-detail.spec.ts`
Expected: 3/3 PASS.

If a test fails, iterate on selectors. Common pitfall: `e2e/playwright.config.ts` already starts api on port 3401 by default; the `E2E_API_BASE` env var is just a fallback. The `ctx.request` carries auth cookies from `registerAndLogin`.

- [ ] **Step 8.3: Commit**

```bash
git add e2e/benchmarks/test-insights-detail.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): TestInsightsDetailPage smoke — notFound, empty state, range URL

Three tests:
- /benchmarks/reports/<bogus> → "Connection not found"
- /benchmarks/reports/<empty-conn> → header + "no benchmarks" body
- range picker writes ?range=<n>d to the URL

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final verification

- [ ] **Step F.1: Workspace-wide checks**

Run, in order:
- `pnpm -r build`
- `pnpm -r --if-present lint`
- `pnpm -r test`

Expected: all green. If lint complains, run `pnpm -F @modeldoctor/web exec biome check --write src` (and same for `apps/api` if needed) — biome's stricter format wins over local stale cache.

- [ ] **Step F.2: Push + open PR**

```bash
git push -u origin feat/test-insights-detail
gh pr create --title "feat(benchmarks): test-insights detail view + cancellation visibility" --body "$(cat <<'EOF'
## Summary
- New per-connection drill-in page at \`/benchmarks/reports/:connectionId\` (page header + 2-col summary tile + tool distribution + p95 timeseries chart + simplified run-history table).
- Range picker (7d / 30d / 90d) URL-persisted via \`?range=\`.
- Index card now surfaces the cancellation count: "成功 X · 失败 Y · 取消 Z" with a tooltip explaining the success-rate denominator math.
- Index card "View history" navigates to the new detail page (was the legacy benchmark list).
- New contract field \`endpointReport.statusCounts\` (counted in the existing service groupBy loop — zero new query cost).

Design: \`docs/superpowers/specs/2026-05-07-test-insights-detail-design.md\`
Plan: \`docs/superpowers/plans/2026-05-07-test-insights-detail.md\`

## Test plan
- [x] \`pnpm -r test\` — full unit suite green
- [x] \`pnpm test:e2e:browser e2e/benchmarks/test-insights-detail.spec.ts\` — 3/3 pass
- [ ] Manual: pick a real connection from /benchmarks/reports, click "View history", verify chart + run list + range picker behavior.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Then per project memory: surface CI signals, but only when the user asks (per "no auto CI watch" preference).

---

## Self-review

- **Spec coverage**: every spec section maps to ≥1 task. Schema → Task 1; service breakdown → Task 2; index card breakdown + link → Task 3; chart → Task 4; table → Task 5; page → Task 6; route → Task 7; e2e → Task 8. ✓
- **Type consistency**: `EndpointReport.statusCounts` shape matches contract Task 1 → service Task 2 → page Task 3 (index card). `EndpointReportRange` enum same across pages 6, 7. `P95Point` shape consistent in chart Task 4 + page Task 6. ✓
- **Placeholder scan**: no "TBD" / "implement later" / "similar to Task N". Each test has full code. ✓
- **Decomposition**: 8 tasks, each 3–6 bite-sized steps, each ends with a commit.
