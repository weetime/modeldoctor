# Benchmark Phase 5 Web UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the user-facing web UI for the Benchmark feature: list page, detail page (with polling), and a two-tab create/duplicate modal — bringing Phases 1-4 to a full feature visible to end users.

**Architecture:** New folder `apps/web/src/features/benchmark/` with TanStack Query for server state, RHF + zod-resolver bound to `CreateBenchmarkRequestSchema` from contracts, URL search params (`?create=1` / `?duplicate=:id`) driving modal lifecycle, conservative polling (2s, pause-on-hidden, error backoff, re-fetch on terminal). Reuses existing Radix primitives (Tabs, Dialog, AlertDialog, DropdownMenu) and components (`EndpointSelector`, `PageHeader`, `EmptyState`, `Table`).

**Tech Stack:** Vite + React 18 + TypeScript, TanStack Query v5, react-hook-form + @hookform/resolvers/zod, react-router-dom v7, Radix UI primitives, sonner toasts, lucide-react icons, vitest + @testing-library/react, i18next.

**Spec:** `docs/superpowers/specs/2026-04-26-benchmark-phase-5-web-ui-design.md` (master) and `docs/superpowers/specs/2026-04-25-benchmark-design.md` (parent §8).

**Branch:** `feat/benchmark-phase-5-web-ui` (already exists; cut from `feat/benchmark-phase-3` which carries Phases 1-4).

---

## File Structure

### Created

```
apps/web/src/features/benchmark/
├── BenchmarkListPage.tsx
├── BenchmarkDetailPage.tsx
├── BenchmarkCreateModal.tsx
├── BenchmarkEndpointFields.tsx
├── BenchmarkProfilePicker.tsx
├── BenchmarkMetricsGrid.tsx
├── BenchmarkLogsPanel.tsx
├── BenchmarkStateBadge.tsx
├── BenchmarkActionsCell.tsx
├── api.ts
├── profiles.ts
├── queries.ts
├── schemas.ts
└── __tests__/
    ├── BenchmarkListPage.test.tsx
    ├── BenchmarkDetailPage.test.tsx
    ├── BenchmarkCreateModal.test.tsx
    ├── BenchmarkProfilePicker.test.tsx
    ├── BenchmarkEndpointFields.test.tsx
    ├── BenchmarkMetricsGrid.test.tsx
    ├── BenchmarkLogsPanel.test.tsx
    └── queries.test.tsx

apps/web/src/locales/zh-CN/benchmark.json
apps/web/src/locales/en-US/benchmark.json
```

### Modified

- `apps/web/src/lib/api-client.ts` — add `del` method to support `DELETE /api/benchmarks/:id`
- `apps/web/src/lib/i18n.ts` — register `benchmark` namespace
- `apps/web/src/router/index.tsx` — add `/benchmarks` and `/benchmarks/:id` routes
- `apps/web/src/components/sidebar/sidebar-config.tsx` — add "基准测试" entry in `performance` group
- `apps/web/src/locales/zh-CN/sidebar.json` and `en-US/sidebar.json` — add `items.benchmark` key

---

## Task 1: Scaffold benchmark feature folder

Establishes the route, sidebar entry, i18n namespace, and stub components. After this task `pnpm dev` shows a "基准测试" sidebar entry; clicking it lands on a placeholder list page; `pnpm -F web type-check && pnpm -F web test` are green.

**Files:**
- Create: all stub files listed above (one-line default exports for components, full content for `benchmark.json` locales, full content for `api.ts` skeleton, `queries.ts` skeleton)
- Modify: `apps/web/src/lib/api-client.ts`, `apps/web/src/lib/i18n.ts`, `apps/web/src/router/index.tsx`, `apps/web/src/components/sidebar/sidebar-config.tsx`, both `sidebar.json` files

- [ ] **Step 1.1: Add `del` method to api-client**

Edit `apps/web/src/lib/api-client.ts` — extend the exported `api` object:

```ts
export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
```

(Named `del` because `delete` is a reserved word.)

- [ ] **Step 1.2: Write failing test for api-client.del**

Add to `apps/web/src/lib/api-client.test.ts`:

```ts
it("del() issues DELETE", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("", { status: 204 }),
  );
  await api.del("/api/foo/123");
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/foo/123",
    expect.objectContaining({ method: "DELETE" }),
  );
});
```

Run: `pnpm -F web test src/lib/api-client.test.ts -- --run`
Expected: PASS (since the implementation in 1.1 already exists). If this is run before 1.1, FAIL with "del is not a function".

- [ ] **Step 1.3: Create `apps/web/src/features/benchmark/api.ts`**

```ts
import { api } from "@/lib/api-client";
import type {
  BenchmarkRun,
  CreateBenchmarkRequest,
  ListBenchmarksQuery,
  ListBenchmarksResponse,
} from "@modeldoctor/contracts";

function buildListQuery(q: Partial<ListBenchmarksQuery>): string {
  const usp = new URLSearchParams();
  if (q.limit !== undefined) usp.set("limit", String(q.limit));
  if (q.cursor) usp.set("cursor", q.cursor);
  if (q.state) usp.set("state", q.state);
  if (q.profile) usp.set("profile", q.profile);
  if (q.search) usp.set("search", q.search);
  const qs = usp.toString();
  return qs ? `?${qs}` : "";
}

export const benchmarkApi = {
  list: (q: Partial<ListBenchmarksQuery>) =>
    api.get<ListBenchmarksResponse>(`/api/benchmarks${buildListQuery(q)}`),
  get: (id: string) => api.get<BenchmarkRun>(`/api/benchmarks/${id}`),
  create: (body: CreateBenchmarkRequest) =>
    api.post<BenchmarkRun>("/api/benchmarks", body),
  cancel: (id: string) =>
    api.post<BenchmarkRun>(`/api/benchmarks/${id}/cancel`, {}),
  delete: (id: string) => api.del<void>(`/api/benchmarks/${id}`),
};
```

- [ ] **Step 1.4: Create `apps/web/src/features/benchmark/queries.ts` (skeleton)**

```ts
import type { ListBenchmarksQuery } from "@modeldoctor/contracts";

export const benchmarkKeys = {
  all: ["benchmarks"] as const,
  lists: () => [...benchmarkKeys.all, "list"] as const,
  list: (q: Partial<ListBenchmarksQuery>) =>
    [...benchmarkKeys.lists(), q] as const,
  details: () => [...benchmarkKeys.all, "detail"] as const,
  detail: (id: string) => [...benchmarkKeys.details(), id] as const,
};

export const TERMINAL_STATES = ["completed", "failed", "canceled"] as const;
export type TerminalState = (typeof TERMINAL_STATES)[number];

// Hooks added in Task 2 (list) and Task 5 (detail).
```

- [ ] **Step 1.5: Create the eight component stubs**

Each file gets a one-line default + named export so `tsc` is happy and routes can resolve. Example:

`apps/web/src/features/benchmark/BenchmarkListPage.tsx`:

```tsx
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/common/page-header";

export function BenchmarkListPage() {
  const { t } = useTranslation("benchmark");
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="px-8 py-6 text-sm text-muted-foreground">
        Benchmark list — implementation arrives in Task 2.
      </div>
    </>
  );
}
```

`apps/web/src/features/benchmark/BenchmarkDetailPage.tsx`:

```tsx
import { useParams } from "react-router-dom";
import { PageHeader } from "@/components/common/page-header";

export function BenchmarkDetailPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <>
      <PageHeader title="Benchmark" />
      <div className="px-8 py-6 text-sm text-muted-foreground">
        Detail for {id} — implementation arrives in Task 5.
      </div>
    </>
  );
}
```

For the remaining six (`BenchmarkCreateModal`, `BenchmarkEndpointFields`, `BenchmarkProfilePicker`, `BenchmarkMetricsGrid`, `BenchmarkLogsPanel`, `BenchmarkStateBadge`, `BenchmarkActionsCell`), create empty named-export stubs:

```tsx
export function BenchmarkCreateModal() { return null; }
```

(Replace the name per file. They are not yet used; this is purely to make the directory typecheck-clean before Task 2 starts importing.)

Also create empty placeholders for `profiles.ts` and `schemas.ts`:

`profiles.ts`:
```ts
// Filled in Task 4.
export {};
```

`schemas.ts`:
```ts
// Filled in Task 3.
export {};
```

- [ ] **Step 1.6: Create `apps/web/src/locales/en-US/benchmark.json`**

```json
{
  "title": "Benchmark",
  "subtitle": "Measure token-level latency and throughput against an OpenAI-compatible target endpoint with guidellm.",
  "actions": {
    "create": "New",
    "duplicate": "Duplicate",
    "cancel": "Cancel",
    "delete": "Delete",
    "retry": "Retry",
    "clearFilters": "Clear filters",
    "loadMore": "Load more",
    "refresh": "Refresh",
    "openDetail": "Open"
  },
  "list": {
    "columns": {
      "name": "Name",
      "model": "Model",
      "profile": "Profile",
      "state": "State",
      "outputTps": "Output tok/s",
      "ttftMean": "TTFT mean",
      "createdAt": "Created"
    },
    "filters": {
      "state": "State",
      "profile": "Profile",
      "search": "Search name…"
    },
    "empty": {
      "title": "No benchmarks yet",
      "description": "Click \"New\" to start a benchmark run.",
      "filtered": "No benchmarks match these filters."
    }
  },
  "create": {
    "title": "New benchmark",
    "subtitle": "Configure target endpoint and workload",
    "tabs": { "basic": "Basic Info", "config": "Configuration" },
    "fields": {
      "name": "Name",
      "description": "Description",
      "apiType": "API type",
      "apiUrl": "API URL",
      "apiKey": "API Key",
      "model": "Model",
      "profile": "Profile",
      "dataset": "Dataset",
      "inputTokens": "Input tokens",
      "outputTokens": "Output tokens",
      "seed": "Seed (optional)",
      "requestRate": "Request rate (0 = unlimited)",
      "totalRequests": "Total requests"
    },
    "duplicateBanner": "Duplicating from {{name}}. All fields prefilled except API Key — please re-enter for security.",
    "presetLoaded": "{{profile}} preset loaded. Edit any field — chip stays {{profile}} (label, not lock). Switch to Custom to start blank.",
    "loadFromConnection": "Load from saved connection…",
    "submit": "Run benchmark"
  },
  "detail": {
    "config": {
      "target": "Target",
      "model": "Model",
      "apiType": "API type",
      "dataset": "Dataset",
      "rate": "Rate",
      "totalRequests": "Total requests",
      "success": "Success",
      "errors": "Errors"
    },
    "metrics": {
      "ttftMean": "TTFT mean",
      "ttftP95": "TTFT p95",
      "ttftP99": "TTFT p99",
      "itlMean": "ITL mean",
      "itlP95": "ITL p95",
      "itlP99": "ITL p99",
      "outputTps": "Output tok/s",
      "rps": "Requests/s",
      "concurrencyMean": "Concurrency mean",
      "concurrencyMax": "Concurrency max",
      "successCount": "Success",
      "errorCount": "Errors"
    },
    "logs": {
      "title": "Logs",
      "pendingMessage": "Logs available after run completes.",
      "size": "{{size}}"
    },
    "states": {
      "pending": "Pending",
      "submitted": "Submitted",
      "running": "Running",
      "completed": "Completed",
      "failed": "Failed",
      "canceled": "Canceled"
    },
    "errors": {
      "loadFailed": "Couldn't load this benchmark",
      "notFound": "Benchmark not found",
      "runFailed": "Run failed",
      "polling": "Lost connection while polling. Retrying…"
    }
  },
  "profiles": {
    "throughput": "Throughput",
    "latency": "Latency",
    "longContext": "Long Context",
    "generationHeavy": "Generation Heavy",
    "shareGpt": "ShareGPT",
    "custom": "Custom"
  },
  "datasets": { "random": "Random", "sharegpt": "ShareGPT" },
  "comingSoon": "(coming soon)"
}
```

- [ ] **Step 1.7: Create `apps/web/src/locales/zh-CN/benchmark.json`**

Mirror of 1.6 with translations:

```json
{
  "title": "基准测试",
  "subtitle": "用 guidellm 测量目标 OpenAI 兼容端点的 token 级延迟与吞吐。",
  "actions": {
    "create": "新建",
    "duplicate": "复制配置",
    "cancel": "取消",
    "delete": "删除",
    "retry": "重试",
    "clearFilters": "清除筛选",
    "loadMore": "加载更多",
    "refresh": "刷新",
    "openDetail": "查看详情"
  },
  "list": {
    "columns": {
      "name": "名称",
      "model": "模型",
      "profile": "Profile",
      "state": "状态",
      "outputTps": "Output tok/s",
      "ttftMean": "TTFT 平均",
      "createdAt": "创建时间"
    },
    "filters": { "state": "状态", "profile": "Profile", "search": "按名称搜索…" },
    "empty": {
      "title": "还没有 benchmark",
      "description": "点击右上角"新建"以开始压测。",
      "filtered": "没有匹配的 benchmark。"
    }
  },
  "create": {
    "title": "新建 benchmark",
    "subtitle": "配置目标端点和压测参数",
    "tabs": { "basic": "基本信息", "config": "配置" },
    "fields": {
      "name": "名称",
      "description": "描述",
      "apiType": "API 类型",
      "apiUrl": "API URL",
      "apiKey": "API Key",
      "model": "模型",
      "profile": "Profile",
      "dataset": "数据集",
      "inputTokens": "输入 tokens",
      "outputTokens": "输出 tokens",
      "seed": "Seed（可选）",
      "requestRate": "速率（0 = 不限）",
      "totalRequests": "请求总数"
    },
    "duplicateBanner": "正在从 {{name}} 复制配置。除 API Key 外所有字段已预填——出于安全请重新输入。",
    "presetLoaded": "已加载 {{profile}} 预设。修改任意字段后 chip 仍显示 {{profile}}（这是标签而非锁定）。切换到 Custom 可清空开始。",
    "loadFromConnection": "从已保存连接加载…",
    "submit": "运行 benchmark"
  },
  "detail": {
    "config": {
      "target": "目标",
      "model": "模型",
      "apiType": "API 类型",
      "dataset": "数据集",
      "rate": "速率",
      "totalRequests": "请求总数",
      "success": "成功",
      "errors": "错误"
    },
    "metrics": {
      "ttftMean": "TTFT 平均",
      "ttftP95": "TTFT p95",
      "ttftP99": "TTFT p99",
      "itlMean": "ITL 平均",
      "itlP95": "ITL p95",
      "itlP99": "ITL p99",
      "outputTps": "Output tok/s",
      "rps": "Requests/s",
      "concurrencyMean": "并发平均",
      "concurrencyMax": "并发最大",
      "successCount": "成功",
      "errorCount": "错误"
    },
    "logs": {
      "title": "日志",
      "pendingMessage": "运行结束后查看日志。",
      "size": "{{size}}"
    },
    "states": {
      "pending": "等待",
      "submitted": "已提交",
      "running": "运行中",
      "completed": "完成",
      "failed": "失败",
      "canceled": "已取消"
    },
    "errors": {
      "loadFailed": "加载失败",
      "notFound": "Benchmark 未找到",
      "runFailed": "运行失败",
      "polling": "轮询连接中断。正在重试…"
    }
  },
  "profiles": {
    "throughput": "Throughput",
    "latency": "Latency",
    "longContext": "Long Context",
    "generationHeavy": "Generation Heavy",
    "shareGpt": "ShareGPT",
    "custom": "Custom"
  },
  "datasets": { "random": "Random", "sharegpt": "ShareGPT" },
  "comingSoon": "（即将推出）"
}
```

- [ ] **Step 1.8: Add `benchmark` namespace to i18n**

Edit `apps/web/src/lib/i18n.ts`:

```ts
import enBenchmark from "@/locales/en-US/benchmark.json";
import zhBenchmark from "@/locales/zh-CN/benchmark.json";
```

In the `resources` block, add `benchmark: enBenchmark` to `en-US` and `benchmark: zhBenchmark` to `zh-CN`. In the `ns` array, append `"benchmark"`.

- [ ] **Step 1.9: Add sidebar key**

Edit `apps/web/src/locales/en-US/sidebar.json`: under `items`, add `"benchmark": "Benchmark"`.

Edit `apps/web/src/locales/zh-CN/sidebar.json`: under `items`, add `"benchmark": "基准测试"`.

- [ ] **Step 1.10: Add sidebar entry**

Edit `apps/web/src/components/sidebar/sidebar-config.tsx`. Import `Gauge` from `lucide-react` (alongside existing icons), then in the `performance` group items array insert after `loadTest`:

```ts
{ to: "/benchmarks", icon: Gauge, labelKey: "items.benchmark" },
```

- [ ] **Step 1.11: Add routes**

Edit `apps/web/src/router/index.tsx`. Import the two pages:

```tsx
import { BenchmarkListPage } from "@/features/benchmark/BenchmarkListPage";
import { BenchmarkDetailPage } from "@/features/benchmark/BenchmarkDetailPage";
```

Inside the `AppShell` `children` array (after `{ path: "load-test", element: <LoadTestPage /> }`), add:

```tsx
{ path: "benchmarks", element: <BenchmarkListPage /> },
{ path: "benchmarks/:id", element: <BenchmarkDetailPage /> },
```

- [ ] **Step 1.12: Verify**

Run: `pnpm -F @modeldoctor/web type-check`
Expected: 0 errors.

Run: `pnpm -F @modeldoctor/web test -- --run`
Expected: all existing tests pass; new `del()` test passes.

Run: `pnpm dev` (manual quick check) — visit `http://localhost:5173/benchmarks` while logged in; sidebar shows "基准测试"; placeholder page renders.

- [ ] **Step 1.13: Commit**

```bash
git add apps/web/src/features/benchmark \
        apps/web/src/locales/en-US/benchmark.json \
        apps/web/src/locales/zh-CN/benchmark.json \
        apps/web/src/locales/en-US/sidebar.json \
        apps/web/src/locales/zh-CN/sidebar.json \
        apps/web/src/lib/i18n.ts \
        apps/web/src/lib/api-client.ts \
        apps/web/src/lib/api-client.test.ts \
        apps/web/src/router/index.tsx \
        apps/web/src/components/sidebar/sidebar-config.tsx
git commit -m "$(cat <<'EOF'
feat(web): scaffold benchmark feature folder

Folder, route, sidebar entry, i18n namespace, and component stubs for
Phase 5. api-client gains a del() method to support DELETE
/api/benchmarks/:id. Visiting /benchmarks now lands on a placeholder
page with the correct title and sidebar context; subsequent tasks fill
in real list, detail, and modal behavior.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: List page — fetch, render, filter, paginate, row actions

Implements the list page from spec §6: 8-column table, state/profile/search filters with debounced search, "Load more" pagination, empty/filtered/error/loading states, row Cancel/Delete via Radix DropdownMenu + AlertDialog confirmation. Adds `BenchmarkStateBadge` and `BenchmarkActionsCell` shared components.

**Files:**
- Create: `BenchmarkStateBadge.tsx`, `BenchmarkActionsCell.tsx`, `__tests__/BenchmarkListPage.test.tsx`
- Modify: `BenchmarkListPage.tsx`, `queries.ts`

- [ ] **Step 2.1: Add list/mutation hooks to queries.ts**

Replace the body of `apps/web/src/features/benchmark/queries.ts` (keep `benchmarkKeys` and `TERMINAL_STATES` from Task 1, append):

```ts
import {
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { benchmarkApi } from "./api";
import type {
  BenchmarkRun,
  BenchmarkRunSummary,
  CreateBenchmarkRequest,
  ListBenchmarksQuery,
  ListBenchmarksResponse,
} from "@modeldoctor/contracts";

export function useBenchmarkList(q: Partial<ListBenchmarksQuery>) {
  return useQuery({
    queryKey: benchmarkKeys.list(q),
    queryFn: () => benchmarkApi.list(q),
  });
}

export function useCreateBenchmark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateBenchmarkRequest) => benchmarkApi.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: benchmarkKeys.lists() });
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useCancelBenchmark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => benchmarkApi.cancel(id),
    onSuccess: (run) => {
      qc.invalidateQueries({ queryKey: benchmarkKeys.lists() });
      qc.invalidateQueries({ queryKey: benchmarkKeys.detail(run.id) });
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useDeleteBenchmark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => benchmarkApi.delete(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: benchmarkKeys.lists() });
      qc.removeQueries({ queryKey: benchmarkKeys.detail(id) });
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
```

- [ ] **Step 2.2: Implement BenchmarkStateBadge**

`apps/web/src/features/benchmark/BenchmarkStateBadge.tsx`:

```tsx
import { Badge } from "@/components/ui/badge";
import { useTranslation } from "react-i18next";
import type { BenchmarkState } from "@modeldoctor/contracts";

const VARIANT: Record<BenchmarkState, string> = {
  pending: "bg-zinc-100 text-zinc-700 border-zinc-200",
  submitted: "bg-zinc-100 text-zinc-700 border-zinc-200",
  running: "bg-blue-100 text-blue-700 border-blue-200",
  completed: "bg-green-100 text-green-700 border-green-200",
  failed: "bg-red-100 text-red-700 border-red-200",
  canceled: "bg-zinc-100 text-zinc-600 border-zinc-200",
};

export function BenchmarkStateBadge({ state }: { state: BenchmarkState }) {
  const { t } = useTranslation("benchmark");
  return (
    <Badge variant="outline" className={VARIANT[state]}>
      {t(`detail.states.${state}`)}
    </Badge>
  );
}
```

- [ ] **Step 2.3: Implement BenchmarkActionsCell**

`apps/web/src/features/benchmark/BenchmarkActionsCell.tsx`:

```tsx
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { MoreHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { TERMINAL_STATES } from "./queries";
import type { BenchmarkRunSummary } from "@modeldoctor/contracts";

interface Props {
  run: BenchmarkRunSummary;
  onCancel: (id: string) => void;
  onDelete: (id: string) => void;
}

export function BenchmarkActionsCell({ run, onCancel, onDelete }: Props) {
  const { t } = useTranslation("benchmark");
  const navigate = useNavigate();
  const isTerminal = TERMINAL_STATES.includes(
    run.state as (typeof TERMINAL_STATES)[number],
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Actions for ${run.name}`}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => navigate(`/benchmarks/${run.id}`)}>
          {t("actions.openDetail")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => navigate(`/benchmarks?duplicate=${run.id}`)}
        >
          {t("actions.duplicate")}
        </DropdownMenuItem>
        {!isTerminal && (
          <DropdownMenuItem onClick={() => onCancel(run.id)}>
            {t("actions.cancel")}
          </DropdownMenuItem>
        )}
        {isTerminal && (
          <DropdownMenuItem
            onClick={() => onDelete(run.id)}
            className="text-destructive focus:text-destructive"
          >
            {t("actions.delete")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 2.4: Write failing list-page test (loading + empty + columns)**

`apps/web/src/features/benchmark/__tests__/BenchmarkListPage.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";
import { BenchmarkListPage } from "../BenchmarkListPage";
import type { ListBenchmarksResponse } from "@modeldoctor/contracts";

vi.mock("@/lib/api-client", () => {
  class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  }
  return { ApiError, api: { get: vi.fn(), post: vi.fn(), del: vi.fn() } };
});

import { api } from "@/lib/api-client";

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/benchmarks"]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

const EMPTY: ListBenchmarksResponse = { items: [], nextCursor: null };

const ONE_COMPLETED: ListBenchmarksResponse = {
  items: [
    {
      id: "r1",
      userId: "u1",
      name: "vllm-llama3-tput",
      profile: "throughput",
      apiType: "chat",
      apiUrl: "https://api.example.com/v1",
      model: "llama-3-8b",
      datasetName: "random",
      state: "completed",
      progress: 1,
      metricsSummary: {
        ttft: { mean: 142, p50: 137, p95: 198, p99: 240 },
        itl: { mean: 14.2, p50: 13.8, p95: 18.4, p99: 22.1 },
        e2eLatency: { mean: 1200, p50: 1180, p95: 1500, p99: 1800 },
        requestsPerSecond: { mean: 8.4 },
        outputTokensPerSecond: { mean: 142.3 },
        inputTokensPerSecond: { mean: 1024 },
        totalTokensPerSecond: { mean: 1166.3 },
        concurrency: { mean: 12.1, max: 32 },
        requests: { total: 1000, success: 998, error: 2, incomplete: 0 },
      },
      createdAt: "2026-04-26T14:22:00Z",
      startedAt: "2026-04-26T14:22:18Z",
      completedAt: "2026-04-26T14:24:45Z",
    },
  ],
  nextCursor: null,
};

describe("BenchmarkListPage", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.del).mockReset();
  });

  it("renders empty state when there are no runs", async () => {
    vi.mocked(api.get).mockResolvedValue(EMPTY);
    render(<BenchmarkListPage />, { wrapper: Wrapper });
    expect(await screen.findByText(/no benchmarks yet/i)).toBeInTheDocument();
  });

  it("renders the 8 columns + a row when data arrives", async () => {
    vi.mocked(api.get).mockResolvedValue(ONE_COMPLETED);
    render(<BenchmarkListPage />, { wrapper: Wrapper });
    expect(await screen.findByText("vllm-llama3-tput")).toBeInTheDocument();
    expect(screen.getByText("llama-3-8b")).toBeInTheDocument();
    expect(screen.getByText("Throughput")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("142.3")).toBeInTheDocument(); // outputTps
    expect(screen.getByText(/142(\.0)?\s*ms/i)).toBeInTheDocument(); // ttft mean
  });

  it("shows filtered-empty message when filters yield no rows", async () => {
    vi.mocked(api.get).mockResolvedValue(EMPTY);
    render(<BenchmarkListPage />, { wrapper: Wrapper });
    const stateFilter = await screen.findByLabelText(/state/i);
    await userEvent.click(stateFilter);
    await userEvent.click(screen.getByRole("option", { name: /running/i }));
    await waitFor(() =>
      expect(screen.getByText(/no benchmarks match these filters/i)).toBeInTheDocument(),
    );
  });

  it("renders inline alert on query error", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("server down"));
    render(<BenchmarkListPage />, { wrapper: Wrapper });
    expect(await screen.findByText(/server down/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
```

Run: `pnpm -F @modeldoctor/web test BenchmarkListPage -- --run`
Expected: FAIL — list page is still the placeholder.

- [ ] **Step 2.5: Implement BenchmarkListPage**

Replace `apps/web/src/features/benchmark/BenchmarkListPage.tsx`:

```tsx
import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { BenchmarkStateBadge } from "./BenchmarkStateBadge";
import { BenchmarkActionsCell } from "./BenchmarkActionsCell";
import {
  benchmarkKeys,
  useBenchmarkList,
  useCancelBenchmark,
  useDeleteBenchmark,
} from "./queries";
import type {
  BenchmarkProfile,
  BenchmarkState,
} from "@modeldoctor/contracts";
import { Activity } from "lucide-react";

const PROFILES: BenchmarkProfile[] = [
  "throughput",
  "latency",
  "long_context",
  "generation_heavy",
  "sharegpt",
  "custom",
];
const STATES: BenchmarkState[] = [
  "pending",
  "submitted",
  "running",
  "completed",
  "failed",
  "canceled",
];

const ALL = "__all__";

function fmtMs(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n.toFixed(1)} ms`;
}
function fmtNum(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toFixed(1);
}

export function BenchmarkListPage() {
  const { t } = useTranslation("benchmark");
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();

  const [stateFilter, setStateFilter] = useState<BenchmarkState | undefined>();
  const [profileFilter, setProfileFilter] =
    useState<BenchmarkProfile | undefined>();
  const [search, setSearch] = useState("");
  const [pendingCancel, setPendingCancel] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const query = useMemo(
    () => ({
      limit: 20,
      state: stateFilter,
      profile: profileFilter,
      search: search.trim() || undefined,
    }),
    [stateFilter, profileFilter, search],
  );

  const { data, isLoading, isError, error, refetch } = useBenchmarkList(query);
  const cancelMut = useCancelBenchmark();
  const deleteMut = useDeleteBenchmark();

  const isFiltered =
    stateFilter !== undefined ||
    profileFilter !== undefined ||
    search.trim() !== "";

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        rightSlot={
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                qc.invalidateQueries({ queryKey: benchmarkKeys.lists() })
              }
            >
              {t("actions.refresh")}
            </Button>
            <Button
              size="sm"
              onClick={() => setSearchParams({ create: "1" })}
            >
              {t("actions.create")}
            </Button>
          </div>
        }
      />

      <div className="space-y-4 px-8 py-6">
        <div className="flex flex-wrap gap-2">
          <Select
            value={stateFilter ?? ALL}
            onValueChange={(v) =>
              setStateFilter(v === ALL ? undefined : (v as BenchmarkState))
            }
          >
            <SelectTrigger
              className="w-[180px]"
              aria-label={t("list.filters.state")}
            >
              <SelectValue placeholder={t("list.filters.state")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("list.filters.state")}</SelectItem>
              {STATES.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`detail.states.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={profileFilter ?? ALL}
            onValueChange={(v) =>
              setProfileFilter(v === ALL ? undefined : (v as BenchmarkProfile))
            }
          >
            <SelectTrigger
              className="w-[180px]"
              aria-label={t("list.filters.profile")}
            >
              <SelectValue placeholder={t("list.filters.profile")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("list.filters.profile")}</SelectItem>
              {PROFILES.map((p) => (
                <SelectItem key={p} value={p}>
                  {t(`profiles.${p === "long_context" ? "longContext" : p === "generation_heavy" ? "generationHeavy" : p === "sharegpt" ? "shareGpt" : p}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            placeholder={t("list.filters.search")}
            className="w-[240px]"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {isFiltered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setStateFilter(undefined);
                setProfileFilter(undefined);
                setSearch("");
              }}
            >
              {t("actions.clearFilters")}
            </Button>
          )}
        </div>

        {isError ? (
          <Alert variant="destructive">
            <AlertDescription className="flex items-center justify-between">
              <span>{(error as Error).message}</span>
              <Button size="sm" variant="outline" onClick={() => refetch()}>
                {t("actions.retry")}
              </Button>
            </AlertDescription>
          </Alert>
        ) : isLoading ? (
          <div
            role="status"
            aria-label="loading"
            className="h-64 animate-pulse rounded-md border border-border bg-muted/30"
          />
        ) : data && data.items.length === 0 ? (
          isFiltered ? (
            <Alert>
              <AlertDescription>{t("list.empty.filtered")}</AlertDescription>
            </Alert>
          ) : (
            <EmptyState
              icon={Activity}
              title={t("list.empty.title")}
              body={t("list.empty.description")}
            />
          )
        ) : (
          <>
            <div className="rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("list.columns.name")}</TableHead>
                    <TableHead>{t("list.columns.model")}</TableHead>
                    <TableHead>{t("list.columns.profile")}</TableHead>
                    <TableHead>{t("list.columns.state")}</TableHead>
                    <TableHead className="text-right">
                      {t("list.columns.outputTps")}
                    </TableHead>
                    <TableHead className="text-right">
                      {t("list.columns.ttftMean")}
                    </TableHead>
                    <TableHead>{t("list.columns.createdAt")}</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.items.map((run) => (
                    <TableRow key={run.id}>
                      <TableCell>
                        <Link
                          to={`/benchmarks/${run.id}`}
                          className="text-foreground hover:underline"
                        >
                          {run.name}
                        </Link>
                      </TableCell>
                      <TableCell>{run.model}</TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {t(
                            `profiles.${run.profile === "long_context" ? "longContext" : run.profile === "generation_heavy" ? "generationHeavy" : run.profile === "sharegpt" ? "shareGpt" : run.profile}`,
                          )}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <BenchmarkStateBadge state={run.state} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtNum(run.metricsSummary?.outputTokensPerSecond.mean)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtMs(run.metricsSummary?.ttft.mean)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDistanceToNow(new Date(run.createdAt), {
                          addSuffix: true,
                        })}
                      </TableCell>
                      <TableCell>
                        <BenchmarkActionsCell
                          run={run}
                          onCancel={(id) => setPendingCancel(id)}
                          onDelete={(id) => setPendingDelete(id)}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {data?.nextCursor && (
              <div className="flex justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    /* Phase 6: append next page; spec §1.2 keeps it explicit */
                  }}
                  disabled
                >
                  {t("actions.loadMore")}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Cancel confirmation */}
      <AlertDialog
        open={pendingCancel !== null}
        onOpenChange={(open) => !open && setPendingCancel(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("actions.cancel")}?</AlertDialogTitle>
            <AlertDialogDescription>
              In-flight requests will be terminated.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingCancel) cancelMut.mutate(pendingCancel);
                setPendingCancel(null);
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirmation */}
      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("actions.delete")}?</AlertDialogTitle>
            <AlertDialogDescription>
              Metrics and logs will be lost permanently.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => {
                if (pendingDelete) deleteMut.mutate(pendingDelete);
                setPendingDelete(null);
              }}
            >
              {t("actions.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
```

- [ ] **Step 2.6: Run list-page tests**

Run: `pnpm -F @modeldoctor/web test BenchmarkListPage -- --run`
Expected: 4 tests pass.

- [ ] **Step 2.7: Run full type-check + tests**

Run: `pnpm -F @modeldoctor/web type-check && pnpm -F @modeldoctor/web test -- --run`
Expected: 0 type errors; full vitest suite green.

- [ ] **Step 2.8: Commit**

```bash
git add apps/web/src/features/benchmark
git commit -m "$(cat <<'EOF'
feat(web/benchmark): list page

Implements spec §6 list page: 8-column table (name, model, profile,
state, output tok/s, TTFT mean, created at, actions), state/profile/
search filters, empty/filtered/error/loading states, row Cancel/Delete
via DropdownMenu + AlertDialog. Adds shared BenchmarkStateBadge and
BenchmarkActionsCell components, plus list/mutation hooks
(useBenchmarkList, useCreateBenchmark, useCancelBenchmark,
useDeleteBenchmark) in queries.ts. List does not poll per spec §3.2;
the reconciler closes the loop server-side within 30s.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Create modal — basic tab + endpoint fields

Adds the modal shell with two Radix Tabs, `?create=1` URL-driven open/close, `BenchmarkEndpointFields` (slim variant, four labeled inputs + connection selector), and RHF + zodResolver wired to `CreateBenchmarkRequestSchema`. Submit is stubbed (toast "submitted" with form values) — real submit in Task 4.

**Files:**
- Create: `BenchmarkEndpointFields.tsx`, `__tests__/BenchmarkCreateModal.test.tsx`, `__tests__/BenchmarkEndpointFields.test.tsx`
- Modify: `BenchmarkCreateModal.tsx`, `schemas.ts`, `BenchmarkListPage.tsx` (mount the modal)

- [ ] **Step 3.1: Implement schemas.ts**

`apps/web/src/features/benchmark/schemas.ts`:

```ts
import {
  CreateBenchmarkRequestSchema,
  type CreateBenchmarkRequest,
} from "@modeldoctor/contracts";

export { CreateBenchmarkRequestSchema };
export type { CreateBenchmarkRequest };
```

(Re-export so the modal pulls from one local file. Future form-only refinements live here without touching contracts.)

- [ ] **Step 3.2: Write failing test for endpoint fields**

`apps/web/src/features/benchmark/__tests__/BenchmarkEndpointFields.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm, FormProvider } from "react-hook-form";
import { describe, it, expect } from "vitest";
import "@/lib/i18n";
import { BenchmarkEndpointFields } from "../BenchmarkEndpointFields";
import type { CreateBenchmarkRequest } from "../schemas";

function Harness({
  defaultValues,
}: {
  defaultValues?: Partial<CreateBenchmarkRequest>;
}) {
  const form = useForm<CreateBenchmarkRequest>({
    defaultValues: {
      name: "",
      profile: "throughput",
      apiType: "chat",
      apiUrl: "",
      apiKey: "",
      model: "",
      datasetName: "random",
      requestRate: 0,
      totalRequests: 1000,
      ...defaultValues,
    },
  });
  return (
    <FormProvider {...form}>
      <BenchmarkEndpointFields />
    </FormProvider>
  );
}

describe("BenchmarkEndpointFields", () => {
  it("renders four labeled fields", () => {
    render(<Harness />);
    expect(screen.getByLabelText(/api type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/api url/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/api key/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^model$/i)).toBeInTheDocument();
  });

  it("apiType select offers chat and completion only", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByLabelText(/api type/i));
    expect(screen.getByRole("option", { name: /chat/i })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /completion/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /embedding/i })).toBeNull();
  });

  it("typing in apiUrl updates the form value", async () => {
    render(<Harness />);
    await userEvent.type(
      screen.getByLabelText(/api url/i),
      "https://api.test/v1",
    );
    expect(screen.getByLabelText(/api url/i)).toHaveValue(
      "https://api.test/v1",
    );
  });
});
```

Run: `pnpm -F @modeldoctor/web test BenchmarkEndpointFields -- --run`
Expected: FAIL.

- [ ] **Step 3.3: Implement BenchmarkEndpointFields**

`apps/web/src/features/benchmark/BenchmarkEndpointFields.tsx`:

```tsx
import { useId } from "react";
import { useFormContext, Controller } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConnectionsStore } from "@/stores/connections-store";
import type { CreateBenchmarkRequest } from "./schemas";

export function BenchmarkEndpointFields() {
  const { t } = useTranslation("benchmark");
  const { register, setValue, watch, control, formState } =
    useFormContext<CreateBenchmarkRequest>();
  const apiTypeId = useId();
  const apiUrlId = useId();
  const apiKeyId = useId();
  const modelId = useId();
  const connId = useId();

  const conns = useConnectionsStore((s) => s.list());

  const onPickConnection = (connectionId: string) => {
    if (connectionId === "__manual__") return;
    const conn = conns.find((c) => c.id === connectionId);
    if (!conn) return;
    setValue("apiUrl", conn.apiUrl, { shouldValidate: true });
    setValue("apiKey", conn.apiKey ?? "", { shouldValidate: true });
    setValue("model", conn.model ?? "", { shouldValidate: true });
  };

  const errors = formState.errors;

  return (
    <div className="rounded-md border border-dashed border-border bg-muted/30 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          {t("create.fields.apiUrl")}
        </span>
        {conns.length > 0 && (
          <div className="flex items-center gap-2">
            <Label htmlFor={connId} className="text-xs text-muted-foreground">
              {t("create.loadFromConnection")}
            </Label>
            <Select onValueChange={onPickConnection}>
              <SelectTrigger id={connId} className="h-8 w-[180px] text-xs">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__manual__">Manual</SelectItem>
                {conns.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-1">
          <Label htmlFor={apiTypeId}>{t("create.fields.apiType")}</Label>
          <Controller
            name="apiType"
            control={control}
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id={apiTypeId}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="chat">chat</SelectItem>
                  <SelectItem value="completion">completion</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
        </div>
        <div className="col-span-2">
          <Label htmlFor={modelId}>{t("create.fields.model")}</Label>
          <Input
            id={modelId}
            {...register("model")}
            aria-invalid={!!errors.model}
          />
        </div>
      </div>

      <div>
        <Label htmlFor={apiUrlId}>{t("create.fields.apiUrl")}</Label>
        <Input
          id={apiUrlId}
          {...register("apiUrl")}
          aria-invalid={!!errors.apiUrl}
        />
      </div>
      <div>
        <Label htmlFor={apiKeyId}>{t("create.fields.apiKey")}</Label>
        <Input
          id={apiKeyId}
          type="password"
          {...register("apiKey")}
          aria-invalid={!!errors.apiKey}
        />
      </div>
    </div>
  );
}
```

Run: `pnpm -F @modeldoctor/web test BenchmarkEndpointFields -- --run`
Expected: 3 tests pass.

- [ ] **Step 3.4: Write failing test for create modal — open via ?create=1**

`apps/web/src/features/benchmark/__tests__/BenchmarkCreateModal.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";

vi.mock("@/lib/api-client", () => {
  class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  }
  return { ApiError, api: { get: vi.fn(), post: vi.fn(), del: vi.fn() } };
});

import { api } from "@/lib/api-client";
import { BenchmarkCreateModal } from "../BenchmarkCreateModal";

function Wrapper({
  children,
  initialEntries = ["/benchmarks"],
}: {
  children: ReactNode;
  initialEntries?: string[];
}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/benchmarks" element={children} />
          <Route
            path="/benchmarks/:id"
            element={<div>detail page for navigation target</div>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("BenchmarkCreateModal — basic tab", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
  });

  it("is closed by default", () => {
    render(<BenchmarkCreateModal />, { wrapper: Wrapper });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens when ?create=1 is in the URL", () => {
    render(<BenchmarkCreateModal />, {
      wrapper: ({ children }) => (
        <Wrapper initialEntries={["/benchmarks?create=1"]}>{children}</Wrapper>
      ),
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/new benchmark/i)).toBeInTheDocument();
  });

  it("renders both tab triggers", () => {
    render(<BenchmarkCreateModal />, {
      wrapper: ({ children }) => (
        <Wrapper initialEntries={["/benchmarks?create=1"]}>{children}</Wrapper>
      ),
    });
    expect(screen.getByRole("tab", { name: /basic info/i })).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /configuration/i }),
    ).toBeInTheDocument();
  });

  it("closes when Cancel is clicked and clears the URL search param", async () => {
    render(<BenchmarkCreateModal />, {
      wrapper: ({ children }) => (
        <Wrapper initialEntries={["/benchmarks?create=1"]}>{children}</Wrapper>
      ),
    });
    await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
```

Run: `pnpm -F @modeldoctor/web test BenchmarkCreateModal -- --run`
Expected: FAIL — modal still returns null.

- [ ] **Step 3.5: Implement BenchmarkCreateModal (basic tab only)**

`apps/web/src/features/benchmark/BenchmarkCreateModal.tsx`:

```tsx
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BenchmarkEndpointFields } from "./BenchmarkEndpointFields";
import {
  CreateBenchmarkRequestSchema,
  type CreateBenchmarkRequest,
} from "./schemas";

const BASIC_FIELDS: (keyof CreateBenchmarkRequest)[] = [
  "name",
  "description",
  "apiType",
  "apiUrl",
  "apiKey",
  "model",
];

export function BenchmarkCreateModal() {
  const { t } = useTranslation("benchmark");
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const open = searchParams.get("create") === "1";

  const form = useForm<CreateBenchmarkRequest>({
    resolver: zodResolver(CreateBenchmarkRequestSchema),
    mode: "onChange",
    defaultValues: {
      name: "",
      description: "",
      profile: "throughput",
      apiType: "chat",
      apiUrl: "",
      apiKey: "",
      model: "",
      datasetName: "random",
      datasetInputTokens: 1024,
      datasetOutputTokens: 128,
      requestRate: 0,
      totalRequests: 1000,
    },
  });

  useEffect(() => {
    if (!open) form.reset();
  }, [open, form]);

  const close = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("create");
    setSearchParams(next, { replace: true });
  };

  const onSubmit = form.handleSubmit((values) => {
    // Real submit lands in Task 4.
    toast.success("Submitted (stub)");
    console.info("benchmark submit stub", values);
    close();
  });

  const errors = form.formState.errors;
  const basicHasError = BASIC_FIELDS.some((f) => errors[f]);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) close();
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("create.title")}</DialogTitle>
          <DialogDescription>{t("create.subtitle")}</DialogDescription>
        </DialogHeader>

        <FormProvider {...form}>
          <form onSubmit={onSubmit} className="space-y-4">
            <Tabs defaultValue="basic">
              <TabsList>
                <TabsTrigger value="basic">
                  {t("create.tabs.basic")}
                  {basicHasError && (
                    <span
                      data-testid="basic-error-dot"
                      className="ml-1 inline-block size-1.5 rounded-full bg-destructive"
                    />
                  )}
                </TabsTrigger>
                <TabsTrigger value="config">
                  {t("create.tabs.config")}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="basic" className="space-y-3 pt-2">
                <div>
                  <Label>{t("create.fields.name")}</Label>
                  <Input {...form.register("name")} />
                </div>
                <div>
                  <Label>{t("create.fields.description")}</Label>
                  <Textarea rows={2} {...form.register("description")} />
                </div>
                <BenchmarkEndpointFields />
              </TabsContent>

              <TabsContent value="config" className="pt-2">
                <p className="text-sm text-muted-foreground">
                  Configuration tab implementation arrives in Task 4.
                </p>
              </TabsContent>
            </Tabs>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                {t("actions.cancel")}
              </Button>
              <Button type="submit" disabled={!form.formState.isValid}>
                {t("create.submit")}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3.6: Mount modal in list page**

In `apps/web/src/features/benchmark/BenchmarkListPage.tsx`, import the modal at the top and render it next to the existing `<AlertDialog>`s near the bottom of the JSX (still inside the fragment):

```tsx
import { BenchmarkCreateModal } from "./BenchmarkCreateModal";
// ...
<BenchmarkCreateModal />
```

- [ ] **Step 3.7: Run modal tests**

Run: `pnpm -F @modeldoctor/web test BenchmarkCreateModal -- --run`
Expected: 4 tests pass.

Run: `pnpm -F @modeldoctor/web type-check && pnpm -F @modeldoctor/web test -- --run`
Expected: green.

- [ ] **Step 3.8: Commit**

```bash
git add apps/web/src/features/benchmark
git commit -m "$(cat <<'EOF'
feat(web/benchmark): create modal — basic tab

Two-tab Radix Dialog opened by ?create=1 search param. Tab 1 (basic
info) holds name, description, and BenchmarkEndpointFields — a slim
endpoint editor (apiType limited to chat/completion, optional
"Load from saved connection" dropdown over the existing connections
store). Form is RHF + zodResolver bound to CreateBenchmarkRequestSchema.
Tab 2 is a placeholder; profile presets and submit wiring land in
Task 4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Create modal — config tab + profile presets + real submit

Implements `BenchmarkProfilePicker` with five live chips + a disabled ShareGPT chip, the config tab fields (dataset, tokens, rate, total requests), and wires up the real submit (`useCreateBenchmark`) with navigation to the new run's detail page.

**Files:**
- Create: `__tests__/BenchmarkProfilePicker.test.tsx`
- Modify: `profiles.ts`, `BenchmarkProfilePicker.tsx`, `BenchmarkCreateModal.tsx`

- [ ] **Step 4.1: Implement profiles.ts**

`apps/web/src/features/benchmark/profiles.ts`:

```ts
import type {
  BenchmarkDataset,
  BenchmarkProfile,
} from "@modeldoctor/contracts";

export type LivePreset = Exclude<BenchmarkProfile, "custom" | "sharegpt">;

export const PROFILE_DEFAULTS: Record<
  LivePreset,
  {
    datasetName: BenchmarkDataset;
    datasetInputTokens: number;
    datasetOutputTokens: number;
    requestRate: number;
    totalRequests: number;
  }
> = {
  throughput: {
    datasetName: "random",
    datasetInputTokens: 1024,
    datasetOutputTokens: 128,
    requestRate: 0,
    totalRequests: 1000,
  },
  latency: {
    datasetName: "random",
    datasetInputTokens: 128,
    datasetOutputTokens: 128,
    requestRate: 1,
    totalRequests: 100,
  },
  long_context: {
    datasetName: "random",
    datasetInputTokens: 32_000,
    datasetOutputTokens: 100,
    requestRate: 1,
    totalRequests: 100,
  },
  generation_heavy: {
    datasetName: "random",
    datasetInputTokens: 1000,
    datasetOutputTokens: 2000,
    requestRate: 1,
    totalRequests: 200,
  },
};

export const PROFILE_ORDER: BenchmarkProfile[] = [
  "throughput",
  "latency",
  "long_context",
  "generation_heavy",
  "sharegpt",
  "custom",
];

export function profileLabelKey(p: BenchmarkProfile): string {
  switch (p) {
    case "long_context":
      return "longContext";
    case "generation_heavy":
      return "generationHeavy";
    case "sharegpt":
      return "shareGpt";
    default:
      return p;
  }
}
```

- [ ] **Step 4.2: Write failing test for BenchmarkProfilePicker**

`apps/web/src/features/benchmark/__tests__/BenchmarkProfilePicker.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm, FormProvider } from "react-hook-form";
import { describe, expect, it } from "vitest";
import "@/lib/i18n";
import { BenchmarkProfilePicker } from "../BenchmarkProfilePicker";
import type { CreateBenchmarkRequest } from "../schemas";

function Harness({
  defaultValues,
}: {
  defaultValues?: Partial<CreateBenchmarkRequest>;
}) {
  const form = useForm<CreateBenchmarkRequest>({
    defaultValues: {
      name: "x",
      profile: "custom",
      apiType: "chat",
      apiUrl: "https://api/v1",
      apiKey: "k",
      model: "m",
      datasetName: "random",
      datasetInputTokens: 1,
      datasetOutputTokens: 1,
      requestRate: 0,
      totalRequests: 1,
      ...defaultValues,
    },
  });
  return (
    <FormProvider {...form}>
      <BenchmarkProfilePicker />
      <output data-testid="snapshot">
        {JSON.stringify(form.watch())}
      </output>
    </FormProvider>
  );
}

describe("BenchmarkProfilePicker", () => {
  it("clicking Throughput chip fills 5 fields", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: /throughput/i }));
    const snap = JSON.parse(screen.getByTestId("snapshot").textContent ?? "{}");
    expect(snap.profile).toBe("throughput");
    expect(snap.datasetInputTokens).toBe(1024);
    expect(snap.datasetOutputTokens).toBe(128);
    expect(snap.requestRate).toBe(0);
    expect(snap.totalRequests).toBe(1000);
    expect(snap.datasetName).toBe("random");
  });

  it("switching to Latency overwrites previous Throughput values", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: /throughput/i }));
    await userEvent.click(screen.getByRole("button", { name: /latency/i }));
    const snap = JSON.parse(screen.getByTestId("snapshot").textContent ?? "{}");
    expect(snap.datasetInputTokens).toBe(128);
    expect(snap.totalRequests).toBe(100);
  });

  it("switching to Custom does NOT clear current values", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: /throughput/i }));
    await userEvent.click(screen.getByRole("button", { name: /^custom$/i }));
    const snap = JSON.parse(screen.getByTestId("snapshot").textContent ?? "{}");
    expect(snap.profile).toBe("custom");
    expect(snap.datasetInputTokens).toBe(1024);
    expect(snap.totalRequests).toBe(1000);
  });

  it("ShareGPT chip is aria-disabled and clicking it does not change profile", async () => {
    render(<Harness />);
    const chip = screen.getByRole("button", { name: /sharegpt/i });
    expect(chip).toBeDisabled();
    const snap = JSON.parse(screen.getByTestId("snapshot").textContent ?? "{}");
    expect(snap.profile).toBe("custom");
  });
});
```

Run: `pnpm -F @modeldoctor/web test BenchmarkProfilePicker -- --run`
Expected: FAIL.

- [ ] **Step 4.3: Implement BenchmarkProfilePicker**

`apps/web/src/features/benchmark/BenchmarkProfilePicker.tsx`:

```tsx
import { useFormContext } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  PROFILE_DEFAULTS,
  PROFILE_ORDER,
  profileLabelKey,
  type LivePreset,
} from "./profiles";
import type { BenchmarkProfile } from "@modeldoctor/contracts";
import type { CreateBenchmarkRequest } from "./schemas";

export function BenchmarkProfilePicker() {
  const { t } = useTranslation("benchmark");
  const { setValue, watch } = useFormContext<CreateBenchmarkRequest>();
  const current = watch("profile");

  const onPick = (p: BenchmarkProfile) => {
    if (p === "sharegpt") return;
    setValue("profile", p, { shouldValidate: true });
    if (p !== "custom") {
      const d = PROFILE_DEFAULTS[p as LivePreset];
      setValue("datasetName", d.datasetName, { shouldValidate: true });
      setValue("datasetInputTokens", d.datasetInputTokens, {
        shouldValidate: true,
      });
      setValue("datasetOutputTokens", d.datasetOutputTokens, {
        shouldValidate: true,
      });
      setValue("requestRate", d.requestRate, { shouldValidate: true });
      setValue("totalRequests", d.totalRequests, { shouldValidate: true });
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      {PROFILE_ORDER.map((p) => {
        const label = t(`profiles.${profileLabelKey(p)}`);
        const selected = current === p;
        const disabled = p === "sharegpt";
        const className = cn(
          "rounded-full border px-3 py-1 text-xs",
          selected
            ? "bg-primary text-primary-foreground border-primary"
            : "bg-background border-border text-foreground",
          disabled && "opacity-50 cursor-not-allowed",
        );
        const button = (
          <Button
            key={p}
            type="button"
            variant="ghost"
            disabled={disabled}
            onClick={() => onPick(p)}
            className={className}
          >
            {label}
            {disabled && (
              <span className="ml-1 text-[10px] text-muted-foreground">
                {t("comingSoon")}
              </span>
            )}
          </Button>
        );
        return disabled ? (
          <Tooltip key={p}>
            <TooltipTrigger asChild>
              <span>{button}</span>
            </TooltipTrigger>
            <TooltipContent>{t("comingSoon")}</TooltipContent>
          </Tooltip>
        ) : (
          button
        );
      })}
    </div>
  );
}
```

Run: `pnpm -F @modeldoctor/web test BenchmarkProfilePicker -- --run`
Expected: 4 tests pass.

- [ ] **Step 4.4: Wire config tab + real submit in modal**

Edit `apps/web/src/features/benchmark/BenchmarkCreateModal.tsx`:

a) At the top of the file, import:

```tsx
import { useNavigate } from "react-router-dom";
import { BenchmarkProfilePicker } from "./BenchmarkProfilePicker";
import { useCreateBenchmark } from "./queries";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
```

b) Add `CONFIG_FIELDS` next to `BASIC_FIELDS`:

```tsx
const CONFIG_FIELDS: (keyof CreateBenchmarkRequest)[] = [
  "profile",
  "datasetName",
  "datasetInputTokens",
  "datasetOutputTokens",
  "requestRate",
  "totalRequests",
  "datasetSeed",
];
```

c) Inside the component, after `basicHasError`, add:

```tsx
const configHasError = CONFIG_FIELDS.some((f) => errors[f]);
const navigate = useNavigate();
const createMut = useCreateBenchmark();
```

d) Replace the existing `onSubmit` with:

```tsx
const onSubmit = form.handleSubmit(async (values) => {
  const run = await createMut.mutateAsync(values);
  toast.success(`Benchmark "${run.name}" submitted`);
  close();
  navigate(`/benchmarks/${run.id}`);
});
```

e) Replace the placeholder TabsContent for `value="config"` with the real form:

```tsx
<TabsContent value="config" className="space-y-3 pt-2">
  <BenchmarkProfilePicker />
  {form.watch("profile") !== "custom" &&
    form.watch("profile") !== "sharegpt" && (
      <Alert>
        <AlertDescription>
          {t("create.presetLoaded", {
            profile: t(
              `profiles.${
                form.watch("profile") === "long_context"
                  ? "longContext"
                  : form.watch("profile") === "generation_heavy"
                    ? "generationHeavy"
                    : form.watch("profile")
              }`,
            ),
          })}
        </AlertDescription>
      </Alert>
    )}

  <div className="grid grid-cols-2 gap-3">
    <div>
      <Label>{t("create.fields.dataset")}</Label>
      <Select
        value={form.watch("datasetName")}
        onValueChange={(v) =>
          form.setValue("datasetName", v as "random" | "sharegpt", {
            shouldValidate: true,
          })
        }
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="random">{t("datasets.random")}</SelectItem>
          <SelectItem value="sharegpt" disabled>
            {t("datasets.sharegpt")} {t("comingSoon")}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
    <div>
      <Label>{t("create.fields.seed")}</Label>
      <Input
        type="number"
        {...form.register("datasetSeed", {
          setValueAs: (v) => (v === "" ? undefined : Number(v)),
        })}
      />
    </div>
  </div>

  <div className="grid grid-cols-2 gap-3">
    <div>
      <Label>{t("create.fields.inputTokens")}</Label>
      <Input
        type="number"
        {...form.register("datasetInputTokens", { valueAsNumber: true })}
      />
    </div>
    <div>
      <Label>{t("create.fields.outputTokens")}</Label>
      <Input
        type="number"
        {...form.register("datasetOutputTokens", { valueAsNumber: true })}
      />
    </div>
  </div>

  <div className="grid grid-cols-2 gap-3">
    <div>
      <Label>{t("create.fields.requestRate")}</Label>
      <Input
        type="number"
        {...form.register("requestRate", { valueAsNumber: true })}
      />
    </div>
    <div>
      <Label>{t("create.fields.totalRequests")}</Label>
      <Input
        type="number"
        {...form.register("totalRequests", { valueAsNumber: true })}
      />
    </div>
  </div>
</TabsContent>
```

f) Replace the config tab's `TabsTrigger` to also show a red dot:

```tsx
<TabsTrigger value="config">
  {t("create.tabs.config")}
  {configHasError && (
    <span
      data-testid="config-error-dot"
      className="ml-1 inline-block size-1.5 rounded-full bg-destructive"
    />
  )}
</TabsTrigger>
```

g) Update the submit button to also disable while pending:

```tsx
<Button
  type="submit"
  disabled={!form.formState.isValid || createMut.isPending}
>
  {createMut.isPending ? "…" : t("create.submit")}
</Button>
```

- [ ] **Step 4.5: Add submit-flow test**

Append to `apps/web/src/features/benchmark/__tests__/BenchmarkCreateModal.test.tsx` inside the existing `describe`:

```tsx
import type { BenchmarkRun } from "@modeldoctor/contracts";

const FAKE_RUN: BenchmarkRun = {
  id: "newid",
  userId: "u1",
  name: "smoke",
  description: null,
  profile: "throughput",
  apiType: "chat",
  apiUrl: "https://api.test/v1",
  model: "m",
  datasetName: "random",
  datasetInputTokens: 1024,
  datasetOutputTokens: 128,
  datasetSeed: null,
  requestRate: 0,
  totalRequests: 1000,
  state: "pending",
  stateMessage: null,
  jobName: null,
  progress: null,
  metricsSummary: null,
  rawMetrics: null,
  logs: null,
  createdAt: new Date().toISOString(),
  startedAt: null,
  completedAt: null,
};

it("submitting fills form, calls api.post, navigates to detail", async () => {
  vi.mocked(api.post).mockResolvedValue(FAKE_RUN);

  render(<BenchmarkCreateModal />, {
    wrapper: ({ children }) => (
      <Wrapper initialEntries={["/benchmarks?create=1"]}>{children}</Wrapper>
    ),
  });

  await userEvent.type(screen.getByLabelText(/^name$/i), "smoke");
  await userEvent.type(
    screen.getByLabelText(/api url/i),
    "https://api.test/v1",
  );
  await userEvent.type(screen.getByLabelText(/api key/i), "k");
  await userEvent.type(screen.getByLabelText(/^model$/i), "m");

  const submit = screen.getByRole("button", { name: /run benchmark/i });
  await userEvent.click(submit);

  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith(
      "/api/benchmarks",
      expect.objectContaining({
        name: "smoke",
        apiUrl: "https://api.test/v1",
        apiKey: "k",
        model: "m",
        profile: "throughput",
      }),
    ),
  );
  expect(
    await screen.findByText(/detail page for navigation target/i),
  ).toBeInTheDocument();
});
```

Add `waitFor` to the existing import line at the top.

Run: `pnpm -F @modeldoctor/web test BenchmarkCreateModal -- --run`
Expected: previous 4 + this 1 = 5 pass.

- [ ] **Step 4.6: Verify and commit**

Run: `pnpm -F @modeldoctor/web type-check && pnpm -F @modeldoctor/web test -- --run`
Expected: green.

```bash
git add apps/web/src/features/benchmark
git commit -m "$(cat <<'EOF'
feat(web/benchmark): create modal — config tab + profile presets

Adds BenchmarkProfilePicker (5 live chips + disabled ShareGPT chip with
coming-soon tooltip) wired to PROFILE_DEFAULTS auto-fill. Config tab
gains the dataset select, seed, input/output tokens, request rate, and
total requests fields. Submit calls useCreateBenchmark, toasts on
success, closes the modal, and navigates to the new run's detail page.
Both tab triggers now show a red error dot when their fields have RHF
validation errors.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Detail page (no polling yet)

Implements detail page from spec §7: header (name + state badge + duration + actions per state), config card, 4×3 metrics grid with mean-tile subtitles, collapsible logs panel with state-aware messaging, AlertDialog confirmations for Cancel/Delete. Polling not added yet — query uses constant `staleTime`.

**Files:**
- Create: `__tests__/BenchmarkDetailPage.test.tsx`, `__tests__/BenchmarkMetricsGrid.test.tsx`, `__tests__/BenchmarkLogsPanel.test.tsx`
- Modify: `BenchmarkDetailPage.tsx`, `BenchmarkMetricsGrid.tsx`, `BenchmarkLogsPanel.tsx`, `queries.ts`

- [ ] **Step 5.1: Add useBenchmarkDetail hook (no polling yet)**

Append to `apps/web/src/features/benchmark/queries.ts`:

```ts
export function useBenchmarkDetail(id: string) {
  return useQuery({
    queryKey: benchmarkKeys.detail(id),
    queryFn: () => benchmarkApi.get(id),
    // Polling rules added in Task 6.
    staleTime: 0,
  });
}
```

- [ ] **Step 5.2: Write failing test for BenchmarkMetricsGrid**

`apps/web/src/features/benchmark/__tests__/BenchmarkMetricsGrid.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@/lib/i18n";
import { BenchmarkMetricsGrid } from "../BenchmarkMetricsGrid";
import type { BenchmarkMetricsSummary } from "@modeldoctor/contracts";

const SUMMARY: BenchmarkMetricsSummary = {
  ttft: { mean: 142, p50: 137, p95: 198, p99: 240 },
  itl: { mean: 14.2, p50: 13.8, p95: 18.4, p99: 22.1 },
  e2eLatency: { mean: 1200, p50: 1180, p95: 1500, p99: 1800 },
  requestsPerSecond: { mean: 8.4 },
  outputTokensPerSecond: { mean: 142.3 },
  inputTokensPerSecond: { mean: 1024 },
  totalTokensPerSecond: { mean: 1166.3 },
  concurrency: { mean: 12.1, max: 32 },
  requests: { total: 1000, success: 998, error: 2, incomplete: 0 },
};

describe("BenchmarkMetricsGrid", () => {
  it("renders all 12 tile labels", () => {
    render(<BenchmarkMetricsGrid summary={SUMMARY} />);
    expect(screen.getByText(/TTFT mean/i)).toBeInTheDocument();
    expect(screen.getByText(/TTFT p95/i)).toBeInTheDocument();
    expect(screen.getByText(/TTFT p99/i)).toBeInTheDocument();
    expect(screen.getByText(/ITL mean/i)).toBeInTheDocument();
    expect(screen.getByText(/ITL p95/i)).toBeInTheDocument();
    expect(screen.getByText(/ITL p99/i)).toBeInTheDocument();
    expect(screen.getByText(/Output tok\/s/i)).toBeInTheDocument();
    expect(screen.getByText(/Requests\/s/i)).toBeInTheDocument();
    expect(screen.getByText(/Concurrency mean/i)).toBeInTheDocument();
    expect(screen.getByText(/Concurrency max/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Success/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Errors?/i).length).toBeGreaterThan(0);
  });

  it("mean tile carries p50/p95/p99 subtitle", () => {
    render(<BenchmarkMetricsGrid summary={SUMMARY} />);
    expect(screen.getByText(/p50 137/)).toBeInTheDocument();
    expect(screen.getByText(/p95 198/)).toBeInTheDocument();
    expect(screen.getByText(/p99 240/)).toBeInTheDocument();
  });

  it("renders em dashes when summary is null", () => {
    render(<BenchmarkMetricsGrid summary={null} />);
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(12);
  });
});
```

Run: `pnpm -F @modeldoctor/web test BenchmarkMetricsGrid -- --run`
Expected: FAIL.

- [ ] **Step 5.3: Implement BenchmarkMetricsGrid**

`apps/web/src/features/benchmark/BenchmarkMetricsGrid.tsx`:

```tsx
import { useTranslation } from "react-i18next";
import type { BenchmarkMetricsSummary } from "@modeldoctor/contracts";

interface TileProps {
  label: string;
  value: string;
  unit?: string;
  subtitle?: string;
  tone?: "success" | "danger" | "default";
}

function Tile({ label, value, unit, subtitle, tone = "default" }: TileProps) {
  const valueColor =
    tone === "success"
      ? "text-green-600"
      : tone === "danger"
        ? "text-red-600"
        : "text-foreground";
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-1 text-2xl font-semibold tabular-nums ${valueColor}`}
      >
        {value}
        {unit && (
          <span className="ml-1 text-sm font-normal text-muted-foreground">
            {unit}
          </span>
        )}
      </div>
      {subtitle && (
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          {subtitle}
        </div>
      )}
    </div>
  );
}

const fmt = (n: number | undefined) =>
  n === undefined ? "—" : n.toFixed(1);

export function BenchmarkMetricsGrid({
  summary,
}: {
  summary: BenchmarkMetricsSummary | null | undefined;
}) {
  const { t } = useTranslation("benchmark");
  const m = summary;

  return (
    <div className="grid grid-cols-4 gap-2">
      <Tile
        label={t("detail.metrics.ttftMean")}
        value={fmt(m?.ttft.mean)}
        unit={m ? "ms" : undefined}
        subtitle={
          m
            ? `p50 ${m.ttft.p50.toFixed(0)} / p95 ${m.ttft.p95.toFixed(0)} / p99 ${m.ttft.p99.toFixed(0)}`
            : undefined
        }
      />
      <Tile
        label={t("detail.metrics.ttftP95")}
        value={fmt(m?.ttft.p95)}
        unit={m ? "ms" : undefined}
      />
      <Tile
        label={t("detail.metrics.ttftP99")}
        value={fmt(m?.ttft.p99)}
        unit={m ? "ms" : undefined}
      />
      <Tile
        label={t("detail.metrics.itlMean")}
        value={fmt(m?.itl.mean)}
        unit={m ? "ms" : undefined}
        subtitle={
          m
            ? `p50 ${m.itl.p50.toFixed(1)} / p95 ${m.itl.p95.toFixed(1)} / p99 ${m.itl.p99.toFixed(1)}`
            : undefined
        }
      />

      <Tile
        label={t("detail.metrics.itlP95")}
        value={fmt(m?.itl.p95)}
        unit={m ? "ms" : undefined}
      />
      <Tile
        label={t("detail.metrics.itlP99")}
        value={fmt(m?.itl.p99)}
        unit={m ? "ms" : undefined}
      />
      <Tile
        label={t("detail.metrics.outputTps")}
        value={fmt(m?.outputTokensPerSecond.mean)}
      />
      <Tile
        label={t("detail.metrics.rps")}
        value={fmt(m?.requestsPerSecond.mean)}
      />

      <Tile
        label={t("detail.metrics.concurrencyMean")}
        value={fmt(m?.concurrency.mean)}
      />
      <Tile
        label={t("detail.metrics.concurrencyMax")}
        value={
          m?.concurrency.max === undefined ? "—" : String(m.concurrency.max)
        }
      />
      <Tile
        label={t("detail.metrics.successCount")}
        value={
          m?.requests.success === undefined ? "—" : String(m.requests.success)
        }
        tone="success"
      />
      <Tile
        label={t("detail.metrics.errorCount")}
        value={m?.requests.error === undefined ? "—" : String(m.requests.error)}
        tone={(m?.requests.error ?? 0) > 0 ? "danger" : "default"}
      />
    </div>
  );
}
```

Run: `pnpm -F @modeldoctor/web test BenchmarkMetricsGrid -- --run`
Expected: 3 pass.

- [ ] **Step 5.4: Write failing test for BenchmarkLogsPanel**

`apps/web/src/features/benchmark/__tests__/BenchmarkLogsPanel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@/lib/i18n";
import { BenchmarkLogsPanel } from "../BenchmarkLogsPanel";

describe("BenchmarkLogsPanel", () => {
  it("shows pending message when run is non-terminal and logs are null", () => {
    render(<BenchmarkLogsPanel logs={null} state="running" />);
    expect(
      screen.getByText(/logs available after run completes/i),
    ).toBeInTheDocument();
  });

  it("renders logs in a <pre> when present", () => {
    const logs = "line1\nline2\nline3";
    render(<BenchmarkLogsPanel logs={logs} state="completed" />);
    expect(screen.getByText(/line2/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /logs/i })).toBeInTheDocument();
  });

  it("formats size as KB", () => {
    const logs = "x".repeat(3200);
    render(<BenchmarkLogsPanel logs={logs} state="completed" />);
    expect(screen.getByText(/3\.\d KB/)).toBeInTheDocument();
  });
});
```

Run: `pnpm -F @modeldoctor/web test BenchmarkLogsPanel -- --run`
Expected: FAIL.

- [ ] **Step 5.5: Implement BenchmarkLogsPanel**

`apps/web/src/features/benchmark/BenchmarkLogsPanel.tsx`:

```tsx
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { BenchmarkState } from "@modeldoctor/contracts";
import { TERMINAL_STATES } from "./queries";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function BenchmarkLogsPanel({
  logs,
  state,
}: {
  logs: string | null | undefined;
  state: BenchmarkState;
}) {
  const { t } = useTranslation("benchmark");
  const preRef = useRef<HTMLPreElement>(null);
  const isTerminal = (TERMINAL_STATES as readonly string[]).includes(state);

  useEffect(() => {
    if (preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [logs]);

  if (!logs) {
    return (
      <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        {isTerminal ? "No logs available." : t("detail.logs.pendingMessage")}
      </div>
    );
  }

  const size = new TextEncoder().encode(logs).length;

  return (
    <details
      className="rounded-md border border-border"
      open={isTerminal}
      role="region"
      aria-label={t("detail.logs.title")}
    >
      <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground select-none">
        ▾ {t("detail.logs.title")}{" "}
        <span className="ml-1">({formatSize(size)})</span>
      </summary>
      <pre
        ref={preRef}
        className="m-0 max-h-[300px] overflow-auto rounded-b-md bg-zinc-900 p-3 text-[11px] text-zinc-200"
      >
        {logs}
      </pre>
    </details>
  );
}
```

Run: `pnpm -F @modeldoctor/web test BenchmarkLogsPanel -- --run`
Expected: 3 pass.

- [ ] **Step 5.6: Write failing detail-page test (state variations)**

`apps/web/src/features/benchmark/__tests__/BenchmarkDetailPage.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";

vi.mock("@/lib/api-client", () => {
  class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  }
  return { ApiError, api: { get: vi.fn(), post: vi.fn(), del: vi.fn() } };
});

import { api } from "@/lib/api-client";
import { BenchmarkDetailPage } from "../BenchmarkDetailPage";
import type { BenchmarkRun } from "@modeldoctor/contracts";

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/benchmarks/r1"]}>
        <Routes>
          <Route path="/benchmarks/:id" element={children} />
          <Route path="/benchmarks" element={<div>list</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const BASE: BenchmarkRun = {
  id: "r1",
  userId: "u1",
  name: "smoke",
  description: null,
  profile: "throughput",
  apiType: "chat",
  apiUrl: "https://api.test/v1",
  model: "m",
  datasetName: "random",
  datasetInputTokens: 1024,
  datasetOutputTokens: 128,
  datasetSeed: null,
  requestRate: 0,
  totalRequests: 1000,
  state: "completed",
  stateMessage: null,
  jobName: "benchmark-r1",
  progress: 1,
  metricsSummary: {
    ttft: { mean: 142, p50: 137, p95: 198, p99: 240 },
    itl: { mean: 14, p50: 13, p95: 18, p99: 22 },
    e2eLatency: { mean: 1200, p50: 1180, p95: 1500, p99: 1800 },
    requestsPerSecond: { mean: 8.4 },
    outputTokensPerSecond: { mean: 142.3 },
    inputTokensPerSecond: { mean: 1024 },
    totalTokensPerSecond: { mean: 1166.3 },
    concurrency: { mean: 12, max: 32 },
    requests: { total: 1000, success: 998, error: 2, incomplete: 0 },
  },
  rawMetrics: null,
  logs: "guidellm log line 1\nguidellm log line 2",
  createdAt: "2026-04-26T14:22:00Z",
  startedAt: "2026-04-26T14:22:18Z",
  completedAt: "2026-04-26T14:24:45Z",
};

describe("BenchmarkDetailPage", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
  });

  it("renders completed run with metrics + Duplicate + Delete", async () => {
    vi.mocked(api.get).mockResolvedValue(BASE);
    render(<BenchmarkDetailPage />, { wrapper: Wrapper });
    expect(await screen.findByText("smoke")).toBeInTheDocument();
    expect(screen.getByText(/Completed/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /duplicate/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^delete$/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^cancel$/i })).toBeNull();
    expect(screen.getByText(/142/)).toBeInTheDocument(); // some metric number
  });

  it("renders running run with Cancel only and pending logs message", async () => {
    vi.mocked(api.get).mockResolvedValue({
      ...BASE,
      state: "running",
      progress: 0.42,
      metricsSummary: null,
      logs: null,
    });
    render(<BenchmarkDetailPage />, { wrapper: Wrapper });
    expect(await screen.findByText(/Running/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^cancel$/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^delete$/i })).toBeNull();
    expect(
      screen.getByText(/logs available after run completes/i),
    ).toBeInTheDocument();
  });

  it("renders failed run with red Alert and stateMessage", async () => {
    vi.mocked(api.get).mockResolvedValue({
      ...BASE,
      state: "failed",
      stateMessage: "connection refused",
      metricsSummary: null,
      logs: "ERROR: connection refused",
    });
    render(<BenchmarkDetailPage />, { wrapper: Wrapper });
    expect(await screen.findByText(/connection refused/)).toBeInTheDocument();
  });

  it("renders 404 EmptyState on ApiError 404", async () => {
    vi.mocked(api.get).mockRejectedValue(
      Object.assign(new Error("not found"), { status: 404 }),
    );
    render(<BenchmarkDetailPage />, { wrapper: Wrapper });
    expect(await screen.findByText(/not found/i)).toBeInTheDocument();
  });
});
```

Run: `pnpm -F @modeldoctor/web test BenchmarkDetailPage -- --run`
Expected: FAIL.

- [ ] **Step 5.7: Implement BenchmarkDetailPage**

`apps/web/src/features/benchmark/BenchmarkDetailPage.tsx`:

```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams, Link } from "react-router-dom";
import { format, formatDistanceStrict } from "date-fns";
import { ArrowLeft, SearchX } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { BenchmarkStateBadge } from "./BenchmarkStateBadge";
import { BenchmarkMetricsGrid } from "./BenchmarkMetricsGrid";
import { BenchmarkLogsPanel } from "./BenchmarkLogsPanel";
import {
  TERMINAL_STATES,
  useBenchmarkDetail,
  useCancelBenchmark,
  useDeleteBenchmark,
} from "./queries";
import { profileLabelKey } from "./profiles";

export function BenchmarkDetailPage() {
  const { t } = useTranslation("benchmark");
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading, isError, error, refetch } = useBenchmarkDetail(
    id ?? "",
  );
  const cancelMut = useCancelBenchmark();
  const deleteMut = useDeleteBenchmark();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!id) {
    return (
      <>
        <PageHeader title={t("detail.errors.notFound")} />
        <div className="px-8 py-6">
          <EmptyState icon={SearchX} title={t("detail.errors.notFound")} />
        </div>
      </>
    );
  }

  if (isLoading) {
    return (
      <>
        <PageHeader title="…" />
        <div className="space-y-4 px-8 py-6">
          <div
            role="status"
            aria-label="loading"
            className="h-24 animate-pulse rounded-md border border-border bg-muted/30"
          />
          <div className="grid grid-cols-4 gap-2">
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className="h-20 animate-pulse rounded-md border border-border bg-muted/30"
              />
            ))}
          </div>
        </div>
      </>
    );
  }

  if (isError || !data) {
    const err = error as Error & { status?: number };
    if (err?.status === 404) {
      return (
        <>
          <PageHeader title={t("detail.errors.notFound")} />
          <div className="px-8 py-6">
            <EmptyState
              icon={SearchX}
              title={t("detail.errors.notFound")}
              actions={
                <Link to="/benchmarks" className="text-sm underline">
                  ← Back to list
                </Link>
              }
            />
          </div>
        </>
      );
    }
    return (
      <>
        <PageHeader title={t("detail.errors.loadFailed")} />
        <div className="px-8 py-6">
          <Alert variant="destructive">
            <AlertDescription className="flex items-center justify-between">
              <span>{err?.message ?? "Unknown error"}</span>
              <Button size="sm" variant="outline" onClick={() => refetch()}>
                {t("actions.retry")}
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      </>
    );
  }

  const isTerminal = (TERMINAL_STATES as readonly string[]).includes(
    data.state,
  );
  const duration =
    data.startedAt && (data.completedAt ?? null)
      ? formatDistanceStrict(
          new Date(data.startedAt),
          new Date(data.completedAt ?? Date.now()),
        )
      : null;

  return (
    <>
      <PageHeader
        title={data.name}
        subtitle={`${t(`profiles.${profileLabelKey(data.profile)}`)}`}
        rightSlot={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/benchmarks")}
            >
              <ArrowLeft className="mr-1 size-4" />
              List
            </Button>
            {!isTerminal && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setConfirmCancel(true)}
              >
                {t("actions.cancel")}
              </Button>
            )}
            {isTerminal && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    navigate(`/benchmarks?duplicate=${data.id}`)
                  }
                >
                  {t("actions.duplicate")}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setConfirmDelete(true)}
                >
                  {t("actions.delete")}
                </Button>
              </>
            )}
          </div>
        }
      />

      <div className="space-y-4 px-8 py-6">
        <div className="flex items-center gap-3">
          <BenchmarkStateBadge state={data.state} />
          {duration && (
            <span className="text-xs text-muted-foreground">{duration}</span>
          )}
          {data.startedAt && (
            <span className="text-xs text-muted-foreground">
              {format(new Date(data.startedAt), "yyyy-MM-dd HH:mm")}
              {data.completedAt
                ? ` → ${format(new Date(data.completedAt), "HH:mm")}`
                : ""}
            </span>
          )}
        </div>

        {data.state === "failed" && data.stateMessage && (
          <Alert variant="destructive">
            <AlertDescription>
              <strong>{t("detail.errors.runFailed")}:</strong> {data.stateMessage}
            </AlertDescription>
          </Alert>
        )}
        {data.state === "canceled" && (
          <Alert>
            <AlertDescription>Run was canceled.</AlertDescription>
          </Alert>
        )}
        {!isTerminal && (
          <Progress
            value={data.progress != null ? data.progress * 100 : undefined}
            className="h-1"
          />
        )}

        <div className="grid grid-cols-4 gap-x-6 gap-y-2 rounded-md border border-border bg-muted/30 p-4">
          <KV label={t("detail.config.target")} value={data.apiUrl} />
          <KV label={t("detail.config.model")} value={data.model} />
          <KV label={t("detail.config.apiType")} value={data.apiType} />
          <KV
            label={t("detail.config.dataset")}
            value={
              data.datasetName === "random"
                ? `random · ${data.datasetInputTokens ?? "?"}/${
                    data.datasetOutputTokens ?? "?"
                  } tok`
                : "ShareGPT"
            }
          />
          <KV
            label={t("detail.config.rate")}
            value={
              data.requestRate === 0 ? "unlimited" : `${data.requestRate}/s`
            }
          />
          <KV
            label={t("detail.config.totalRequests")}
            value={String(data.totalRequests)}
          />
          <KV
            label={t("detail.config.success")}
            value={
              data.metricsSummary
                ? `${data.metricsSummary.requests.success} / ${data.metricsSummary.requests.total}`
                : "—"
            }
          />
          <KV
            label={t("detail.config.errors")}
            value={
              data.metricsSummary
                ? String(data.metricsSummary.requests.error)
                : "—"
            }
          />
        </div>

        <BenchmarkMetricsGrid summary={data.metricsSummary} />

        <BenchmarkLogsPanel logs={data.logs} state={data.state} />
      </div>

      {/* Cancel confirm */}
      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("actions.cancel")}?</AlertDialogTitle>
            <AlertDialogDescription>
              In-flight requests will be terminated.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                cancelMut.mutate(data.id);
                setConfirmCancel(false);
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirm */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("actions.delete")}?</AlertDialogTitle>
            <AlertDialogDescription>
              Metrics and logs will be lost permanently.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => {
                deleteMut.mutate(data.id, {
                  onSuccess: () => navigate("/benchmarks"),
                });
                setConfirmDelete(false);
              }}
            >
              {t("actions.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}
```

Run: `pnpm -F @modeldoctor/web test BenchmarkDetailPage -- --run`
Expected: 4 tests pass.

- [ ] **Step 5.8: Verify and commit**

Run: `pnpm -F @modeldoctor/web type-check && pnpm -F @modeldoctor/web test -- --run`
Expected: green.

```bash
git add apps/web/src/features/benchmark
git commit -m "$(cat <<'EOF'
feat(web/benchmark): detail page

Implements spec §7 detail page: header with name + state badge +
duration + state-aware action buttons (Cancel for non-terminal;
Duplicate + Delete for terminal — matches backend service.delete
terminal-only constraint), config card (8 KV pairs), 4×3 BenchmarkMetricsGrid
with mean-tile p50/p95/p99 subtitles, BenchmarkLogsPanel
(collapsible <pre>, scrolls to bottom, KB-formatted size, "logs
available after run completes" placeholder), red Alert on failed runs
showing stateMessage, gray Alert on canceled runs, indeterminate
progress bar while non-terminal, AlertDialog confirmations for
Cancel/Delete, EmptyState for 404. Polling not yet enabled —
useBenchmarkDetail uses constant staleTime; Task 6 adds the rules.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Polling rules

Adds the five polling rules from spec §3.3 to `useBenchmarkDetail`: 2 s while non-terminal, pause when tab hidden, error backoff, stop on terminal, plus a re-fetch-on-terminal `useEffect` in the detail page. Implements with `vi.useFakeTimers()` tests verifying exact poll counts.

**Files:**
- Modify: `queries.ts`, `BenchmarkDetailPage.tsx`
- Create: `__tests__/queries.test.tsx`

- [ ] **Step 6.1: Write failing polling tests**

`apps/web/src/features/benchmark/__tests__/queries.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => {
  class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  }
  return { ApiError, api: { get: vi.fn(), post: vi.fn(), del: vi.fn() } };
});

import { api } from "@/lib/api-client";
import { useBenchmarkDetail } from "../queries";
import type { BenchmarkRun } from "@modeldoctor/contracts";

function makeRun(overrides: Partial<BenchmarkRun> = {}): BenchmarkRun {
  return {
    id: "r1",
    userId: "u1",
    name: "x",
    description: null,
    profile: "throughput",
    apiType: "chat",
    apiUrl: "https://api/v1",
    model: "m",
    datasetName: "random",
    datasetInputTokens: 1024,
    datasetOutputTokens: 128,
    datasetSeed: null,
    requestRate: 0,
    totalRequests: 1000,
    state: "running",
    stateMessage: null,
    jobName: "j",
    progress: 0.5,
    metricsSummary: null,
    rawMetrics: null,
    logs: null,
    createdAt: "2026-04-26T14:22:00Z",
    startedAt: "2026-04-26T14:22:00Z",
    completedAt: null,
    ...overrides,
  };
}

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("useBenchmarkDetail polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(api.get).mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls every 2s while non-terminal", async () => {
    vi.mocked(api.get).mockResolvedValue(makeRun({ state: "running" }));
    renderHook(() => useBenchmarkDetail("r1"), { wrapper: makeWrapper() });

    await vi.advanceTimersByTimeAsync(0);
    expect(api.get).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2000);
    expect(api.get).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(2000);
    expect(api.get).toHaveBeenCalledTimes(3);
  });

  it("stops polling when state becomes terminal", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce(makeRun({ state: "running" }))
      .mockResolvedValueOnce(makeRun({ state: "completed" }));

    renderHook(() => useBenchmarkDetail("r1"), { wrapper: makeWrapper() });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2000);

    expect(api.get).toHaveBeenCalledTimes(2);

    // Wait an additional 5s — no further calls.
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it("pauses polling when document is hidden", async () => {
    vi.mocked(api.get).mockResolvedValue(makeRun({ state: "running" }));
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });

    renderHook(() => useBenchmarkDetail("r1"), { wrapper: makeWrapper() });

    await vi.advanceTimersByTimeAsync(0);
    expect(api.get).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.get).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
  });
});
```

Run: `pnpm -F @modeldoctor/web test queries -- --run`
Expected: FAIL — current `useBenchmarkDetail` has no `refetchInterval`.

- [ ] **Step 6.2: Implement polling rules**

Replace the `useBenchmarkDetail` function in `apps/web/src/features/benchmark/queries.ts`:

```ts
export function useBenchmarkDetail(id: string) {
  return useQuery({
    queryKey: benchmarkKeys.detail(id),
    queryFn: () => benchmarkApi.get(id),
    enabled: id.length > 0,
    refetchInterval: (query) => {
      const data = query.state.data as BenchmarkRun | undefined;
      if (!data) return 2000;
      if ((TERMINAL_STATES as readonly string[]).includes(data.state)) {
        return false;
      }
      return 2000;
    },
    refetchIntervalInBackground: false,
    retry: (failureCount) => failureCount < 3,
    retryDelay: (failureCount) => Math.min(5000 * failureCount, 30_000),
  });
}
```

Run: `pnpm -F @modeldoctor/web test queries -- --run`
Expected: 3 tests pass.

- [ ] **Step 6.3: Add re-fetch-on-terminal effect to detail page**

In `apps/web/src/features/benchmark/BenchmarkDetailPage.tsx`, add imports:

```tsx
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { benchmarkKeys } from "./queries";
```

Inside the component (after `const { data, ... } = useBenchmarkDetail(...)`), add:

```tsx
const qc = useQueryClient();
const prevState = useRef<string | undefined>();
useEffect(() => {
  const next = data?.state;
  const prev = prevState.current;
  prevState.current = next;
  if (
    prev !== undefined &&
    next !== undefined &&
    prev !== next &&
    (TERMINAL_STATES as readonly string[]).includes(next)
  ) {
    qc.invalidateQueries({ queryKey: benchmarkKeys.detail(data!.id) });
  }
}, [data?.state, data?.id, qc]);
```

Note: `useRef` was already imported above? It needs to be — confirm the import block reflects:

```tsx
import { useEffect, useRef, useState } from "react";
```

- [ ] **Step 6.4: Verify the existing detail-page tests still pass under polling**

Run: `pnpm -F @modeldoctor/web test BenchmarkDetailPage -- --run`
Expected: 4 tests still pass. Note the tests don't use fake timers, so they observe the initial fetch only.

- [ ] **Step 6.5: Verify and commit**

Run: `pnpm -F @modeldoctor/web type-check && pnpm -F @modeldoctor/web test -- --run`
Expected: green.

```bash
git add apps/web/src/features/benchmark
git commit -m "$(cat <<'EOF'
feat(web/benchmark): polling rules

Implements spec §3.3 five rules on useBenchmarkDetail:
1. List page does not poll (no change — list already plain).
2. Detail polls every 2s while non-terminal, stops on terminal.
3. Polling pauses when tab is hidden (refetchIntervalInBackground:false).
4. Errors back off: retry 3x with 5s/10s/15s delays capped at 30s.
5. Detail page useEffect fires invalidateQueries on transition into a
   terminal state so logs/rawMetrics that arrive in the runner's
   second callback (after the state callback) are not lost.

queries.test.tsx uses vi.useFakeTimers() to assert exact poll counts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Duplicate flow

Reads `?duplicate=:id`, fetches the source run via `useBenchmarkDetail` (already polling-aware), prefills the create form with everything but the API key, shows a yellow banner, and red-borders the empty `apiKey` field. Adds Duplicate buttons on list-page rows (already present from Task 2 actions cell) and detail-page header (already present from Task 5).

**Files:**
- Modify: `BenchmarkCreateModal.tsx`, `__tests__/BenchmarkCreateModal.test.tsx`

- [ ] **Step 7.1: Write failing test for duplicate flow**

Append to `apps/web/src/features/benchmark/__tests__/BenchmarkCreateModal.test.tsx`:

```tsx
const SOURCE_RUN: BenchmarkRun = {
  id: "src1",
  userId: "u1",
  name: "vllm-llama3-tput",
  description: "first run",
  profile: "throughput",
  apiType: "chat",
  apiUrl: "https://api.test/v1",
  model: "llama-3-8b",
  datasetName: "random",
  datasetInputTokens: 2048,
  datasetOutputTokens: 256,
  datasetSeed: 42,
  requestRate: 0,
  totalRequests: 500,
  state: "completed",
  stateMessage: null,
  jobName: "j",
  progress: 1,
  metricsSummary: null,
  rawMetrics: null,
  logs: null,
  createdAt: "2026-04-26T14:22:00Z",
  startedAt: "2026-04-26T14:22:00Z",
  completedAt: "2026-04-26T14:24:00Z",
};

it("?duplicate=src1 prefills form with source values and blanks apiKey", async () => {
  vi.mocked(api.get).mockResolvedValue(SOURCE_RUN);

  render(<BenchmarkCreateModal />, {
    wrapper: ({ children }) => (
      <Wrapper initialEntries={["/benchmarks?duplicate=src1"]}>
        {children}
      </Wrapper>
    ),
  });

  expect(
    await screen.findByText(/duplicating from/i),
  ).toBeInTheDocument();
  expect(screen.getByLabelText(/^name$/i)).toHaveValue("vllm-llama3-tput-2");
  expect(screen.getByLabelText(/api url/i)).toHaveValue(
    "https://api.test/v1",
  );
  expect(screen.getByLabelText(/^model$/i)).toHaveValue("llama-3-8b");
  expect(screen.getByLabelText(/api key/i)).toHaveValue("");
  expect(screen.getByLabelText(/api key/i)).toHaveAttribute(
    "aria-invalid",
    "true",
  );
});
```

Run: `pnpm -F @modeldoctor/web test BenchmarkCreateModal -- --run`
Expected: FAIL — duplicate flow not implemented.

- [ ] **Step 7.2: Implement duplicate flow**

Edit `apps/web/src/features/benchmark/BenchmarkCreateModal.tsx`. Add imports at the top:

```tsx
import { useEffect, useMemo } from "react";
import { useBenchmarkDetail } from "./queries";
import type { BenchmarkRun, CreateBenchmarkRequest } from "./schemas";
```

(If `BenchmarkRun` is not already exported from `./schemas`, re-export it there:

```ts
export type {
  BenchmarkRun,
  CreateBenchmarkRequest,
} from "@modeldoctor/contracts";
```
)

Add a helper function near the top of the file (outside the component):

```tsx
function mapDuplicateToDefaults(run: BenchmarkRun): CreateBenchmarkRequest {
  return {
    name: `${run.name}-2`,
    description: run.description ?? undefined,
    profile: run.profile,
    apiType: run.apiType,
    apiUrl: run.apiUrl,
    apiKey: "",
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

Inside the component, replace the open detection / form construction:

```tsx
const duplicateId = searchParams.get("duplicate");
const open = searchParams.get("create") === "1" || duplicateId !== null;

const sourceQuery = useBenchmarkDetail(duplicateId ?? "");
const sourceRun = duplicateId ? sourceQuery.data : undefined;
```

Update the `useEffect` that resets the form:

```tsx
useEffect(() => {
  if (!open) {
    form.reset();
    return;
  }
  if (sourceRun) {
    form.reset(mapDuplicateToDefaults(sourceRun));
  }
}, [open, sourceRun, form]);
```

Update `close()` to clear both params:

```tsx
const close = () => {
  const next = new URLSearchParams(searchParams);
  next.delete("create");
  next.delete("duplicate");
  setSearchParams(next, { replace: true });
};
```

Inside the `DialogContent`, before the `<FormProvider>`, render the banner when in duplicate mode:

```tsx
{duplicateId && sourceRun && (
  <Alert className="border-yellow-300 bg-yellow-50 text-yellow-900">
    <AlertDescription>
      {t("create.duplicateBanner", { name: sourceRun.name })}
    </AlertDescription>
  </Alert>
)}
```

(`Alert` and `AlertDescription` were imported in Task 4.)

Update `BenchmarkEndpointFields` so the apiKey field shows aria-invalid + red border when in duplicate mode and value is empty. Easiest: pass a prop. Inside `BenchmarkCreateModal.tsx`, when rendering `<BenchmarkEndpointFields />`, pass:

```tsx
<BenchmarkEndpointFields requireApiKeyHighlight={!!duplicateId} />
```

And in `BenchmarkEndpointFields.tsx`, accept the prop and apply it:

```tsx
export function BenchmarkEndpointFields({
  requireApiKeyHighlight = false,
}: {
  requireApiKeyHighlight?: boolean;
}) {
  // ... existing body, but for the apiKey Input:
  const apiKey = watch("apiKey");
  const apiKeyError = !!errors.apiKey || (requireApiKeyHighlight && !apiKey);
  // ...
  <Input
    id={apiKeyId}
    type="password"
    {...register("apiKey")}
    aria-invalid={apiKeyError}
    className={apiKeyError ? "border-destructive" : undefined}
  />
}
```

- [ ] **Step 7.3: Run duplicate test + full suite**

Run: `pnpm -F @modeldoctor/web test BenchmarkCreateModal -- --run`
Expected: all tests pass (5 from Task 3+4 + 1 new).

Run: `pnpm -F @modeldoctor/web type-check && pnpm -F @modeldoctor/web test -- --run`
Expected: green.

- [ ] **Step 7.4: Manual smoke check**

(Optional but recommended before commit — full smoke test happens in Task 8.) Start `pnpm dev`, log in, create one benchmark, then on its detail page click "Duplicate". Verify the modal opens, the URL changes to `?duplicate=:id`, fields are prefilled (including the original profile chip), apiKey is empty + red, name has `-2` suffix.

- [ ] **Step 7.5: Commit**

```bash
git add apps/web/src/features/benchmark
git commit -m "$(cat <<'EOF'
feat(web/benchmark): duplicate flow

Reads ?duplicate=:id, fetches the source run via useBenchmarkDetail,
prefills the create form with mapDuplicateToDefaults() — copying
everything except the API key (per spec §6 the API never returns it).
Shows a yellow banner identifying the source run and red-borders the
empty apiKey field via aria-invalid until the user re-enters it. Name
is suffixed "-2" to avoid accidental same-name resubmits. List-row
"Duplicate" action and detail-page "Duplicate" button (both already
present) navigate here.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Manual smoke test + PR

End-to-end real run against a local target, per spec §12. Not a code task — operational verification before PR. Outputs: a smoke checklist with results in the PR description.

**Files:** none (operational)

- [ ] **Step 8.1: Prereqs**

```bash
# In a conda env you use for ModelDoctor:
pip install guidellm

# Ensure local Postgres is up and migrations applied:
pnpm -F api prisma migrate status   # should report "up to date"

# Generate secrets if not already in .env.local:
node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))'
# Append to apps/api/.env.local:
#   BENCHMARK_DRIVER=subprocess
#   BENCHMARK_CALLBACK_URL=http://localhost:3001
#   BENCHMARK_CALLBACK_SECRET=<generated>
#   BENCHMARK_API_KEY_ENCRYPTION_KEY=<generated>
```

In a separate terminal, start a small target:

```bash
# Option A — local vLLM (CPU-runnable):
vllm serve facebook/opt-125m --port 8000

# Option B — your own OpenAI-compatible endpoint
# (e.g. an existing 4pd staging vLLM with a port-forward).
```

Start the app:

```bash
pnpm dev
```

- [ ] **Step 8.2: Run the smoke checklist**

Run through every step in spec §12; record results in `docs/superpowers/plans/smoke-2026-04-26-phase-5.md` (gitignored if you prefer; otherwise commit it as part of Task 8). Capture screenshots of the completed run + the failed run + a canceled run.

Cross-validation step from the spec: after a completed run, manually invoke

```bash
guidellm benchmark \
  --target http://localhost:8000/v1 \
  --model facebook/opt-125m \
  --rate-type throughput \
  --max-requests 20 \
  --data prompt_tokens=1024,output_tokens=128 \
  --output-path /tmp/smoke-cli.json
```

Compare `/tmp/smoke-cli.json` numbers (TTFT mean, output-tokens-per-second) to the UI tiles for the same config — should match within ±5%.

- [ ] **Step 8.3: Push branch and open PR**

```bash
git push -u origin feat/benchmark-phase-5-web-ui
gh pr create --title "feat(web): Phase 5 — benchmark UI (list, detail, modal, polling, duplicate)" --body "$(cat <<'EOF'
## Summary
- Implements Phase 5 web UI per spec `docs/superpowers/specs/2026-04-26-benchmark-phase-5-web-ui-design.md`
- 7 commits, one logical change each: scaffold → list → modal basic tab → modal config tab + presets → detail → polling rules → duplicate flow
- First list/detail/polling feature in `apps/web`; sets the pattern future history/regression pages will follow
- No new top-level dependencies

## Test plan
- [x] `pnpm -F @modeldoctor/web type-check` clean
- [x] `pnpm -F @modeldoctor/web test -- --run` all green (X tests added)
- [x] Manual smoke checklist (spec §12) — see attached recordings/screenshots
- [x] Cross-validated guidellm CLI output vs UI tiles within ±5%
- [x] Tab-hidden polling pause confirmed via DevTools Network panel
- [x] Verified Cancel/Delete confirmation dialogs and AlertDialog focus management

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

(Replace "X tests added" with the actual count.)

- [ ] **Step 8.4: Confirm Tasks 1–7 commits land cleanly on `feat/restructure`**

Once Phase 4 (`feat/restructure`) is the merge target the PR will rebase onto it. Review CI; address any reviewer feedback before requesting approval and merge.

---

## Self-review

Done. The plan covers every section of `docs/superpowers/specs/2026-04-26-benchmark-phase-5-web-ui-design.md`:

- **§1–§2 architecture/folder layout** — Task 1.
- **§2.3 routing + §2.4 sidebar** — Task 1.
- **§3.1–§3.4 query keys, list query, mutations** — Tasks 1, 2.
- **§3.3 polling rules** — Task 6.
- **§3.5 error handling** — Tasks 2, 5, 6 (toast throttle in 2.1 mutation handlers).
- **§4 PROFILE_DEFAULTS** — Task 4.
- **§5 form strategy (RHF/zod, slim endpoint, tab error indicator)** — Tasks 3, 4.
- **§6 list page (8 columns, filters, empty/error/loading, pagination)** — Task 2.
- **§7 detail page (header per state, config card, 4×3 grid, logs panel, confirmations)** — Task 5.
- **§8 empty/loading/error states** — Tasks 2, 5.
- **§9 i18n** — Task 1.
- **§10 testing matrix** — every test file is created and exercised.
- **§11 phase decomposition** — Tasks 1–7 map 1:1 to the seven planned commits.
- **§12 manual smoke** — Task 8.
- **§13 risks** — addressed in tests (StrictMode polling: queries.test.tsx uses fake timers + tracks counts; URL race: close() uses replace; duplicate prefill: dedicated test).
- **§14 open items** — submitted=gray (in `BenchmarkStateBadge`), default page size 20 (Task 2 query), striped progress bar (Radix `<Progress>` with `value=undefined` renders indeterminate; CSS animation deferred — fine for MVP), filter URL mirroring (not in scope per spec §1.2).
