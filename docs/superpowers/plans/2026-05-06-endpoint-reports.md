# Endpoint Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the redundant "对比分析" sidebar with a connection-anchored endpoint health page (`/benchmarks/reports`) showing 30-day stats per connection (run count, success rate, p95 first→last delta, latest run).

**Architecture:** New `GET /api/benchmarks/reports/by-connection` aggregates user's recent benchmarks in JS (groupBy connectionId — bounded data per user/window), emitting one card per connection. FE `EndpointReportsPage` renders cards in a responsive grid; "查看历史" hands off to the existing list filtered by `?connectionId=`. Existing `/benchmarks/compare` route stays for `?ids=` deep-links; without ids, redirect to `/benchmarks/inference`.

**Tech Stack:** TypeScript, NestJS, Prisma (existing benchmarks table), React + react-hook-form, Vitest 2, Testing Library, Playwright. Spec: `docs/superpowers/specs/2026-05-06-endpoint-reports-design.md`. Branch: `feat/endpoint-reports` (worktree at `/Users/fangyong/vllm/modeldoctor/feat-endpoint-reports/`).

---

## File Structure

**Contracts** (`packages/contracts/src/`):
- **MODIFY** `benchmark.ts` — add `endpointReportSchema`, `endpointReportsResponseSchema`, query enum

**Backend** (`apps/api/src/modules/benchmark/`):
- **NEW** `metrics.ts` — backend p95 reader (mirror of `apps/web/src/features/benchmarks/compare/metrics.ts`)
- **NEW** `metrics.spec.ts`
- **MODIFY** `benchmark.service.ts` — add `getByConnectionReports(userId, range)`
- **MODIFY** `benchmark.service.spec.ts`
- **MODIFY** `benchmark.controller.ts` — add `GET /reports/by-connection`
- **MODIFY** `benchmark.controller.spec.ts`

**Frontend** (`apps/web/src/`):
- **MODIFY** `features/benchmarks/queries.ts` — add `useEndpointReports(range)` hook
- **NEW** `features/benchmarks/EndpointReportsPage.tsx` — the page
- **NEW** `features/benchmarks/__tests__/EndpointReportsPage.test.tsx`
- **NEW** `features/benchmarks/TrendIndicator.tsx` — shared p95 first→last delta widget
- **NEW** `features/benchmarks/__tests__/TrendIndicator.test.tsx`
- **MODIFY** `components/sidebar/sidebar-config.tsx` — swap compare for reports
- **MODIFY** `locales/zh-CN/sidebar.json` + `locales/en-US/sidebar.json`
- **MODIFY** `locales/zh-CN/benchmarks.json` + `locales/en-US/benchmarks.json` — add `reports.*` block, drop `compare.empty.*`
- **MODIFY** `router/index.tsx` — mount `/benchmarks/reports`, route `/benchmarks/compare` through a gate
- **NEW** `features/benchmarks/compare/BenchmarkCompareGate.tsx` — gate that redirects when no `ids`
- **DELETE** `features/benchmarks/compare/BenchmarkCompareEmpty.tsx`
- **DELETE** `features/benchmarks/compare/__tests__/BenchmarkCompareEmpty.test.tsx`
- **MODIFY** `features/benchmarks/compare/BenchmarkComparePage.tsx` — drop empty fallback (gate handles it)

**E2E**:
- **NEW** `e2e/benchmarks/endpoint-reports.spec.ts`

---

## Pre-flight

- [ ] **Step 0.1: Confirm worktree + branch**

Run: `git rev-parse --abbrev-ref HEAD && pwd`
Expected:
```
feat/endpoint-reports
/Users/fangyong/vllm/modeldoctor/feat-endpoint-reports
```

- [ ] **Step 0.2: Pre-flight build**

Per project memory: a fresh worktree needs `pnpm install` + `pnpm -F @modeldoctor/api db:generate` + `pnpm -r build` once before `apps/api` typecheck succeeds. (Already done during worktree setup; if a fresh checkout, repeat.)

Run: `pnpm install --frozen-lockfile && pnpm -F @modeldoctor/api db:generate && pnpm -r build`
Expected: all packages build clean.

---

## Phase A — Contracts

### Task 1: Endpoint reports contract schemas

**Files:**
- Modify: `packages/contracts/src/benchmark.ts`

- [ ] **Step 1.1: Add the schemas**

Append to `packages/contracts/src/benchmark.ts` (after the existing `benchmarkChartsResponseSchema` block, before the file end):

```ts
// ── Endpoint reports (GET /api/benchmarks/reports/by-connection) ─────
import { ModalityCategorySchema } from "./modality.js";

export const endpointReportRangeSchema = z.enum(["7d", "30d", "90d"]);
export type EndpointReportRange = z.infer<typeof endpointReportRangeSchema>;

export const endpointReportSchema = z.object({
  connection: z.object({
    id: z.string(),
    name: z.string(),
    model: z.string(),
    baseUrl: z.string(),
    category: ModalityCategorySchema,
  }),
  totalRuns: z.number().int().nonnegative(),
  // % in [0, 100]; null when no terminal (completed|failed) runs in the window.
  successRate: z.number().min(0).max(100).nullable(),
  // p95 latency in ms (mirrors what FE compare/metrics.ts reads). first =
  // chronologically-earliest completed run with a usable p95; last =
  // chronologically-latest. null when no completed run carries metrics.
  p95Latency: z
    .object({
      first: z.number().nullable(),
      last: z.number().nullable(),
    })
    .nullable(),
  // Latest run regardless of status — drives "Latest: <name> · <when>".
  latestRun: z
    .object({
      id: z.string(),
      name: z.string(),
      status: benchmarkStatusSchema,
      createdAt: z.string().datetime(),
    })
    .nullable(),
});
export type EndpointReport = z.infer<typeof endpointReportSchema>;

export const endpointReportsResponseSchema = z.object({
  range: endpointReportRangeSchema,
  generatedAt: z.string().datetime(),
  items: z.array(endpointReportSchema),
});
export type EndpointReportsResponse = z.infer<typeof endpointReportsResponseSchema>;
```

Note: `ModalityCategorySchema` may already be re-exported via the package index; if the import causes a circular dep flag, move the import to top of file with the existing imports.

- [ ] **Step 1.2: Build contracts**

Run: `pnpm -F @modeldoctor/contracts build`
Expected: success.

- [ ] **Step 1.3: Commit**

```bash
git add packages/contracts/src/benchmark.ts
git commit -m "$(cat <<'EOF'
feat(contracts): endpoint-reports schemas (GET /benchmarks/reports/by-connection)

Adds endpointReportSchema (per-connection 30d health card) and
endpointReportsResponseSchema (the wrapper). range enum is "7d|30d|90d".

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase B — Backend

### Task 2: Backend p95 metrics helper

**Files:**
- Create: `apps/api/src/modules/benchmark/metrics.ts`
- Create: `apps/api/src/modules/benchmark/metrics.spec.ts`

- [ ] **Step 2.1: Write the failing spec**

Create `apps/api/src/modules/benchmark/metrics.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readP95LatencyMs } from "./metrics.js";

describe("readP95LatencyMs", () => {
  it("reads guidellm e2eLatency.p95", () => {
    expect(
      readP95LatencyMs({
        tool: "guidellm",
        data: { e2eLatency: { p95: 491.2 } },
      }),
    ).toBe(491.2);
  });

  it("reads vegeta latencies.p95", () => {
    expect(
      readP95LatencyMs({
        tool: "vegeta",
        data: { latencies: { p95: 147 } },
      }),
    ).toBe(147);
  });

  it("reads genai-perf requestLatency.p95", () => {
    expect(
      readP95LatencyMs({
        tool: "genai-perf",
        data: { requestLatency: { p95: 220.5 } },
      }),
    ).toBe(220.5);
  });

  it("returns null when summaryMetrics is null", () => {
    expect(readP95LatencyMs(null)).toBeNull();
  });

  it("returns null when tool is unknown", () => {
    expect(
      readP95LatencyMs({
        tool: "unknown",
        data: { p95: 100 },
      }),
    ).toBeNull();
  });

  it("returns null when distribution missing", () => {
    expect(readP95LatencyMs({ tool: "guidellm", data: {} })).toBeNull();
  });

  it("returns null for non-finite values (NaN / Infinity)", () => {
    expect(
      readP95LatencyMs({
        tool: "vegeta",
        data: { latencies: { p95: Number.NaN } },
      }),
    ).toBeNull();
  });
});
```

- [ ] **Step 2.2: Run test to confirm failure**

Run: `pnpm -F @modeldoctor/api vitest run src/modules/benchmark/metrics.spec.ts`
Expected: FAIL — module missing.

- [ ] **Step 2.3: Implement the helper**

Create `apps/api/src/modules/benchmark/metrics.ts`:

```ts
import type { Prisma } from "@prisma/client";

/**
 * Backend twin of the FE `readP95Latency` reader
 * (apps/web/src/features/benchmarks/compare/metrics.ts). Kept in sync
 * with the tool-adapter parseFinalReport shapes:
 *   guidellm → data.e2eLatency.p95     (ms)
 *   vegeta   → data.latencies.p95      (ms; runtime normalizes from
 *                                        Go-duration units before persist)
 *   genai-perf → data.requestLatency.p95 (ms)
 *
 * Returns null whenever the metric is missing or non-finite. The reports
 * service treats null as "no data point in this run".
 */
type Tagged = { tool?: unknown; data?: Record<string, unknown> };

function asTagged(metrics: Prisma.JsonValue | null): Tagged | null {
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) return null;
  const m = metrics as Tagged;
  return m.data && typeof m.data === "object" && !Array.isArray(m.data) ? m : null;
}

function asFiniteNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function fromDist(
  data: Record<string, unknown>,
  key: string,
  field: string,
): number | null {
  const dist = data[key] as Record<string, unknown> | undefined;
  return asFiniteNumber(dist?.[field]);
}

export function readP95LatencyMs(metrics: Prisma.JsonValue | null): number | null {
  const m = asTagged(metrics);
  if (!m?.data) return null;
  switch (m.tool) {
    case "guidellm":
      return fromDist(m.data, "e2eLatency", "p95");
    case "vegeta":
      return fromDist(m.data, "latencies", "p95");
    case "genai-perf":
      return fromDist(m.data, "requestLatency", "p95");
    default:
      return null;
  }
}
```

- [ ] **Step 2.4: Run test to confirm pass**

Run: `pnpm -F @modeldoctor/api vitest run src/modules/benchmark/metrics.spec.ts`
Expected: PASS — 7 tests.

- [ ] **Step 2.5: Commit**

```bash
git add apps/api/src/modules/benchmark/metrics.ts apps/api/src/modules/benchmark/metrics.spec.ts
git commit -m "$(cat <<'EOF'
feat(api): backend p95 latency reader (mirrors FE compare/metrics.ts)

Tool-aware reader for the discriminated summaryMetrics union written by
parseFinalReport in tool-adapters. Used by the upcoming endpoint-reports
service to compute per-connection p95 first/last across recent runs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Service method `getByConnectionReports`

**Files:**
- Modify: `apps/api/src/modules/benchmark/benchmark.service.ts`
- Modify: `apps/api/src/modules/benchmark/benchmark.service.spec.ts`

- [ ] **Step 3.1: Write failing service spec**

Add to `apps/api/src/modules/benchmark/benchmark.service.spec.ts` a new describe at the bottom of the file:

```ts
describe("BenchmarkService.getByConnectionReports", () => {
  // Set up: real BenchmarkService with mocked repo + prisma. Pattern
  // matches the existing service spec setup. Only the new method is
  // exercised here.

  function makeRow(
    overrides: Partial<{
      id: string;
      connectionId: string;
      connection: { id: string; name: string; model: string; baseUrl: string };
      tool: "guidellm" | "vegeta" | "genai-perf";
      status: string;
      summaryMetrics: unknown;
      createdAt: Date;
      name: string;
    }> = {},
  ) {
    return {
      id: overrides.id ?? "b1",
      userId: "u_1",
      connectionId: overrides.connectionId ?? "c_1",
      connection: overrides.connection ?? {
        id: "c_1",
        name: "conn-1",
        model: "m1",
        baseUrl: "http://x/1",
      },
      scenario: "inference",
      tool: overrides.tool ?? "guidellm",
      toolVersion: null,
      name: overrides.name ?? "run",
      description: null,
      status: overrides.status ?? "completed",
      statusMessage: null,
      progress: 1,
      driverHandle: null,
      params: {},
      rawOutput: null,
      summaryMetrics: overrides.summaryMetrics ?? {
        tool: "guidellm",
        data: { e2eLatency: { p95: 100 } },
      },
      serverMetrics: null,
      templateId: null,
      parentBenchmarkId: null,
      baselineId: null,
      logs: null,
      createdAt: overrides.createdAt ?? new Date("2026-05-01T00:00:00Z"),
      startedAt: null,
      completedAt: null,
      baselineFor: null,
    };
  }

  it("groups runs by connection and returns one entry per group", async () => {
    const repo = makeMockRepo();
    repo.list.mockResolvedValueOnce({
      items: [
        makeRow({ id: "b1", connectionId: "c_a" }),
        makeRow({ id: "b2", connectionId: "c_a" }),
        makeRow({ id: "b3", connectionId: "c_b" }),
      ],
      nextCursor: null,
    });
    const prisma = makeMockPrisma();
    prisma.connection.findUnique
      .mockResolvedValueOnce({ category: "chat" })
      .mockResolvedValueOnce({ category: "embeddings" });
    const svc = new BenchmarkService(repo as never, prisma as never, /* k8sRunner */ {} as never);

    const out = await svc.getByConnectionReports("u_1", "30d");

    expect(out.range).toBe("30d");
    expect(out.items).toHaveLength(2);
    const byId = Object.fromEntries(out.items.map((i) => [i.connection.id, i]));
    expect(byId.c_a.totalRuns).toBe(2);
    expect(byId.c_b.totalRuns).toBe(1);
  });

  it("sorts items by totalRuns descending", async () => {
    const repo = makeMockRepo();
    repo.list.mockResolvedValueOnce({
      items: [
        makeRow({ id: "b1", connectionId: "c_a" }),
        makeRow({ id: "b2", connectionId: "c_b" }),
        makeRow({ id: "b3", connectionId: "c_b" }),
        makeRow({ id: "b4", connectionId: "c_b" }),
      ],
      nextCursor: null,
    });
    const prisma = makeMockPrisma();
    prisma.connection.findUnique.mockResolvedValue({ category: "chat" });
    const svc = new BenchmarkService(repo as never, prisma as never, {} as never);

    const out = await svc.getByConnectionReports("u_1", "30d");
    expect(out.items.map((i) => i.connection.id)).toEqual(["c_b", "c_a"]);
  });

  it("computes successRate from terminal runs only", async () => {
    const repo = makeMockRepo();
    repo.list.mockResolvedValueOnce({
      items: [
        makeRow({ id: "b1", status: "completed" }),
        makeRow({ id: "b2", status: "completed" }),
        makeRow({ id: "b3", status: "completed" }),
        makeRow({ id: "b4", status: "failed" }),
        makeRow({ id: "b5", status: "failed" }),
        makeRow({ id: "b6", status: "running" }), // ignored
      ],
      nextCursor: null,
    });
    const prisma = makeMockPrisma();
    prisma.connection.findUnique.mockResolvedValue({ category: "chat" });
    const svc = new BenchmarkService(repo as never, prisma as never, {} as never);

    const out = await svc.getByConnectionReports("u_1", "30d");
    expect(out.items[0].successRate).toBe(60); // 3 / (3+2) = 60%
  });

  it("p95Latency.first picks the chronologically-earliest completed run with metrics", async () => {
    const repo = makeMockRepo();
    repo.list.mockResolvedValueOnce({
      items: [
        makeRow({
          id: "old",
          createdAt: new Date("2026-04-20"),
          summaryMetrics: { tool: "guidellm", data: { e2eLatency: { p95: 100 } } },
        }),
        makeRow({
          id: "mid",
          createdAt: new Date("2026-04-25"),
          summaryMetrics: { tool: "guidellm", data: { e2eLatency: { p95: 150 } } },
        }),
        makeRow({
          id: "new",
          createdAt: new Date("2026-05-01"),
          summaryMetrics: { tool: "guidellm", data: { e2eLatency: { p95: 250 } } },
        }),
      ],
      nextCursor: null,
    });
    const prisma = makeMockPrisma();
    prisma.connection.findUnique.mockResolvedValue({ category: "chat" });
    const svc = new BenchmarkService(repo as never, prisma as never, {} as never);

    const out = await svc.getByConnectionReports("u_1", "30d");
    expect(out.items[0].p95Latency).toEqual({ first: 100, last: 250 });
  });

  it("drops rows whose connection is null (deleted connection)", async () => {
    const repo = makeMockRepo();
    repo.list.mockResolvedValueOnce({
      items: [
        makeRow({ id: "b1", connectionId: "c_a" }),
        // Orphaned row: connection deleted, FK is null.
        { ...makeRow({ id: "b2" }), connection: null, connectionId: null },
      ],
      nextCursor: null,
    });
    const prisma = makeMockPrisma();
    prisma.connection.findUnique.mockResolvedValue({ category: "chat" });
    const svc = new BenchmarkService(repo as never, prisma as never, {} as never);

    const out = await svc.getByConnectionReports("u_1", "30d");
    expect(out.items).toHaveLength(1);
    expect(out.items[0].connection.id).toBe("c_a");
  });

  it("returns p95Latency=null when no completed run carries usable metrics", async () => {
    const repo = makeMockRepo();
    repo.list.mockResolvedValueOnce({
      items: [
        makeRow({ id: "b1", status: "failed", summaryMetrics: null }),
        makeRow({ id: "b2", status: "running", summaryMetrics: null }),
      ],
      nextCursor: null,
    });
    const prisma = makeMockPrisma();
    prisma.connection.findUnique.mockResolvedValue({ category: "chat" });
    const svc = new BenchmarkService(repo as never, prisma as never, {} as never);

    const out = await svc.getByConnectionReports("u_1", "30d");
    expect(out.items[0].p95Latency).toBeNull();
  });

  it("range '7d' lower-bounds repo.list via createdAfter", async () => {
    const repo = makeMockRepo();
    repo.list.mockResolvedValueOnce({ items: [], nextCursor: null });
    const prisma = makeMockPrisma();
    const svc = new BenchmarkService(repo as never, prisma as never, {} as never);

    await svc.getByConnectionReports("u_1", "7d");
    const call = repo.list.mock.calls[0][0];
    expect(call.userId).toBe("u_1");
    expect(call.createdAfter).toBeDefined();
    const lowerBound = new Date(call.createdAfter as string);
    const expected = Date.now() - 7 * 86400_000;
    // Allow ±2s skew for the time it takes the test to run.
    expect(Math.abs(lowerBound.getTime() - expected)).toBeLessThan(2000);
  });
});
```

`makeMockRepo` and `makeMockPrisma` helpers — look at the existing `benchmark.service.spec.ts` for the patterns; if absent, define them at the top of the new describe:

```ts
function makeMockRepo() {
  return {
    list: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    countActiveByName: vi.fn(),
    existsById: vi.fn(),
  };
}
function makeMockPrisma() {
  return {
    connection: { findUnique: vi.fn() },
  } as unknown as { connection: { findUnique: ReturnType<typeof vi.fn> } };
}
```

(If the existing spec already exports something equivalent, prefer reuse.)

- [ ] **Step 3.2: Run spec to confirm failure**

Run: `pnpm -F @modeldoctor/api vitest run src/modules/benchmark/benchmark.service.spec.ts`
Expected: FAIL — `svc.getByConnectionReports is not a function`.

- [ ] **Step 3.3: Implement the service method**

Edit `apps/api/src/modules/benchmark/benchmark.service.ts`. Add imports near the top:

```ts
import type { EndpointReport, EndpointReportRange, EndpointReportsResponse } from "@modeldoctor/contracts";
import { readP95LatencyMs } from "./metrics.js";
```

(`PrismaService` is already a constructor-injected dependency on most NestJS services in this repo; if `BenchmarkService` doesn't already inject it, add `private readonly prisma: PrismaService` to the constructor and import `PrismaService` from `../../database/prisma.service.js`. Confirm by reading the existing constructor.)

Inside the `BenchmarkService` class, add:

```ts
  /**
   * Connection-anchored 30/7/90-day report. Pulls all of `userId`'s
   * benchmarks within the window in one query, buckets them by
   * connectionId in JS, and emits one summary per connection. Bounded
   * because user × window is small (≤ a few hundred rows in practice).
   *
   * Orphaned benchmarks (connection deleted) are dropped — they don't
   * belong on a connection-anchored view.
   */
  async getByConnectionReports(
    userId: string,
    range: EndpointReportRange,
  ): Promise<EndpointReportsResponse> {
    const days = ({ "7d": 7, "30d": 30, "90d": 90 } as const)[range];
    const since = new Date(Date.now() - days * 86_400_000);

    const result = await this.repo.list({
      userId,
      createdAfter: since.toISOString(),
      limit: 5000,
    });

    type Row = (typeof result)["items"][number];
    const groups = new Map<string, Row[]>();
    for (const r of result.items) {
      if (!r.connection) continue;
      const arr = groups.get(r.connection.id) ?? [];
      arr.push(r);
      groups.set(r.connection.id, arr);
    }

    // Batch-load category for every grouped connection in one query.
    const connectionIds = [...groups.keys()];
    const categoryRows =
      connectionIds.length > 0
        ? await this.prisma.connection.findMany({
            where: { id: { in: connectionIds } },
            select: { id: true, category: true },
          })
        : [];
    const categoryById = new Map(categoryRows.map((r) => [r.id, r.category]));

    const items: EndpointReport[] = [];
    for (const [connId, runs] of groups.entries()) {
      const connection = runs[0].connection!;
      const terminal = runs.filter(
        (r) => r.status === "completed" || r.status === "failed",
      );
      const completed = runs.filter((r) => r.status === "completed");

      const successRate =
        terminal.length > 0
          ? (completed.length / terminal.length) * 100
          : null;

      const completedAsc = [...completed].sort(
        (a, b) => +new Date(a.createdAt) - +new Date(b.createdAt),
      );
      const firstWithMetric = completedAsc.find(
        (r) => readP95LatencyMs(r.summaryMetrics) != null,
      );
      const lastWithMetric = [...completedAsc]
        .reverse()
        .find((r) => readP95LatencyMs(r.summaryMetrics) != null);
      const p95Latency = firstWithMetric || lastWithMetric
        ? {
            first: firstWithMetric ? readP95LatencyMs(firstWithMetric.summaryMetrics) : null,
            last: lastWithMetric ? readP95LatencyMs(lastWithMetric.summaryMetrics) : null,
          }
        : null;

      const latestRow = [...runs].sort(
        (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt),
      )[0];
      const latestRun = latestRow
        ? {
            id: latestRow.id,
            name: latestRow.name,
            status: latestRow.status as EndpointReport["latestRun"] extends {
              status: infer S;
            }
              ? S
              : never,
            createdAt: latestRow.createdAt.toISOString(),
          }
        : null;

      items.push({
        connection: {
          id: connection.id,
          name: connection.name,
          model: connection.model,
          baseUrl: connection.baseUrl,
          category: (categoryById.get(connId) ?? "chat") as EndpointReport["connection"]["category"],
        },
        totalRuns: runs.length,
        successRate,
        p95Latency,
        latestRun,
      });
    }

    items.sort((a, b) => b.totalRuns - a.totalRuns);
    return {
      range,
      generatedAt: new Date().toISOString(),
      items,
    };
  }
```

Note on the `latestRun.status` type assertion: contract uses
`benchmarkStatusSchema` enum; the repo row's `status` is `string` from
Prisma. The cast is safe because `repo.list` returns Prisma rows whose
status column is one of the enum values.

- [ ] **Step 3.4: Run spec to confirm pass**

Run: `pnpm -F @modeldoctor/api vitest run src/modules/benchmark/benchmark.service.spec.ts`
Expected: PASS — original cases + 7 new cases.

- [ ] **Step 3.5: Commit**

```bash
git add apps/api/src/modules/benchmark/benchmark.service.ts apps/api/src/modules/benchmark/benchmark.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(api): BenchmarkService.getByConnectionReports

Aggregates the user's last N days of benchmarks by connection: total
runs, success rate, p95 first→last delta, latest row reference. Drops
orphaned (connection-deleted) rows. Items sorted by activity (most
runs first).

Single Prisma query for the benchmark window + a batch findMany for
connection categories. Bounded data per user/window — no streaming
needed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Controller route `GET /reports/by-connection`

**Files:**
- Modify: `apps/api/src/modules/benchmark/benchmark.controller.ts`
- Modify: `apps/api/src/modules/benchmark/benchmark.controller.spec.ts`

- [ ] **Step 4.1: Add controller spec cases**

Append to `apps/api/src/modules/benchmark/benchmark.controller.spec.ts`:

```ts
describe("BenchmarkController.reportsByConnection", () => {
  let controller: BenchmarkController;
  let svc: ReturnType<typeof makeMockService>;

  beforeEach(async () => {
    svc = makeMockService();
    const moduleRef = await Test.createTestingModule({
      controllers: [BenchmarkController],
      providers: [{ provide: BenchmarkService, useValue: svc }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(BenchmarkController);
  });

  it("forwards user.sub and default range '30d' to the service", async () => {
    svc.getByConnectionReports.mockResolvedValue({
      range: "30d",
      generatedAt: "2026-05-06T00:00:00.000Z",
      items: [],
    });
    const result = await controller.reportsByConnection(USER, undefined);
    expect(svc.getByConnectionReports).toHaveBeenCalledWith(USER.sub, "30d");
    expect(result.range).toBe("30d");
  });

  it("forwards explicit range when provided", async () => {
    svc.getByConnectionReports.mockResolvedValue({
      range: "7d",
      generatedAt: "2026-05-06T00:00:00.000Z",
      items: [],
    });
    await controller.reportsByConnection(USER, "7d");
    expect(svc.getByConnectionReports).toHaveBeenCalledWith(USER.sub, "7d");
  });

  it("rejects unknown range value via Zod pipe", async () => {
    // The actual ZodValidationPipe rejection happens at framework-level
    // before our handler runs; verify the route signature accepts only
    // the enum values by attempting a bad string.
    await expect(
      controller.reportsByConnection(USER, "1y" as unknown as "7d"),
    ).rejects.toThrow();
    // (If our handler validates internally we'd assert that here. With
    // the Zod pipe, framework throws before handler is reached.)
  });
});
```

Extend `makeMockService()` (search for it in this file) to include
`getByConnectionReports: vi.fn()`.

The third case (Zod-pipe rejection) may need adjustment depending on
where validation lives. If pipe-level: we can drop the case. The
controller-level cases (1, 2) are the must-haves.

- [ ] **Step 4.2: Run spec to confirm failure**

Run: `pnpm -F @modeldoctor/api vitest run src/modules/benchmark/benchmark.controller.spec.ts`
Expected: FAIL — `controller.reportsByConnection is not a function`.

- [ ] **Step 4.3: Implement the route**

Edit `apps/api/src/modules/benchmark/benchmark.controller.ts`. Add to the imports:

```ts
import {
  type EndpointReportRange,
  type EndpointReportsResponse,
  endpointReportRangeSchema,
} from "@modeldoctor/contracts";
import { Query } from "@nestjs/common";
```

Add a `Get` mapping inside the controller class (near the existing list/detail routes):

```ts
  @Get("reports/by-connection")
  reportsByConnection(
    @CurrentUser() user: JwtPayload,
    @Query("range", new ZodValidationPipe(endpointReportRangeSchema.optional()))
    range: EndpointReportRange | undefined,
  ): Promise<EndpointReportsResponse> {
    return this.service.getByConnectionReports(user.sub, range ?? "30d");
  }
```

Note: this route is a literal-segment GET at `reports/by-connection`. NestJS resolves it before the param route `:id`, but if any existing route is more permissive, place this method **above** any `@Get(":id")` declaration to be safe.

- [ ] **Step 4.4: Run controller spec**

Run: `pnpm -F @modeldoctor/api vitest run src/modules/benchmark/benchmark.controller.spec.ts`
Expected: PASS — original + 3 new cases.

- [ ] **Step 4.5: Run full api specs**

Run: `pnpm -F @modeldoctor/api vitest run`
Expected: all green.

- [ ] **Step 4.6: Commit**

```bash
git add apps/api/src/modules/benchmark/benchmark.controller.ts apps/api/src/modules/benchmark/benchmark.controller.spec.ts
git commit -m "$(cat <<'EOF'
feat(api): GET /api/benchmarks/reports/by-connection

Connection-anchored health card data. Optional ?range=7d|30d|90d
(default 30d), JwtAuthGuard scopes to the calling user.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase C — Frontend

### Task 5: `useEndpointReports` query hook

**Files:**
- Modify: `apps/web/src/features/benchmarks/queries.ts`

- [ ] **Step 5.1: Add the hook**

Append to `apps/web/src/features/benchmarks/queries.ts`:

```ts
import type {
  EndpointReportRange,
  EndpointReportsResponse,
} from "@modeldoctor/contracts";

const reportsKey = (range: EndpointReportRange) =>
  [...benchmarkKeys.all, "reports", "by-connection", range] as const;

export function useEndpointReports(range: EndpointReportRange = "30d") {
  return useQuery({
    queryKey: reportsKey(range),
    queryFn: () =>
      api.get<EndpointReportsResponse>(
        `/api/benchmarks/reports/by-connection?range=${range}`,
      ),
    // Reports are aggregations of historical data; refetching often is
    // expensive (5000-row scan). 60s stale window keeps the page feeling
    // live without pounding the API.
    staleTime: 60_000,
  });
}
```

(Add `EndpointReportRange` and `EndpointReportsResponse` to the existing top-of-file imports from `@modeldoctor/contracts`.)

- [ ] **Step 5.2: Type-check**

Run: `pnpm -F @modeldoctor/web type-check`
Expected: success.

- [ ] **Step 5.3: Commit**

```bash
git add apps/web/src/features/benchmarks/queries.ts
git commit -m "$(cat <<'EOF'
feat(web): useEndpointReports hook against /reports/by-connection

60s staleTime — reports are coarse aggregations, no need for
sub-minute polling. Used by the upcoming EndpointReportsPage.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `<TrendIndicator>` component

**Files:**
- Create: `apps/web/src/features/benchmarks/TrendIndicator.tsx`
- Create: `apps/web/src/features/benchmarks/__tests__/TrendIndicator.test.tsx`

- [ ] **Step 6.1: Write failing test**

Create `apps/web/src/features/benchmarks/__tests__/TrendIndicator.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import { TrendIndicator } from "../TrendIndicator";

function withI18n(node: React.ReactNode) {
  return <I18nextProvider i18n={i18n}>{node}</I18nextProvider>;
}

describe("TrendIndicator", () => {
  it("renders both values + ▲ red marker when last > first × 1.05 (regression)", () => {
    render(withI18n(<TrendIndicator first={147} last={296} unitSuffix="ms" />));
    expect(screen.getByText("147")).toBeInTheDocument();
    expect(screen.getByText(/296/)).toBeInTheDocument();
    const arrow = screen.getByLabelText(/regression|劣化/i);
    expect(arrow).toBeInTheDocument();
    expect(arrow).toHaveTextContent(/▲/);
  });

  it("renders ▼ green marker when last < first × 0.95 (improvement)", () => {
    render(withI18n(<TrendIndicator first={300} last={200} unitSuffix="ms" />));
    const arrow = screen.getByLabelText(/improvement|改善/i);
    expect(arrow).toHaveTextContent(/▼/);
  });

  it("renders ▬ muted marker within ±5% (stable)", () => {
    render(withI18n(<TrendIndicator first={100} last={102} unitSuffix="ms" />));
    const arrow = screen.getByLabelText(/stable|稳定/i);
    expect(arrow).toHaveTextContent(/▬/);
  });

  it("renders single value when only `last` is provided", () => {
    render(withI18n(<TrendIndicator first={null} last={147} unitSuffix="ms" />));
    expect(screen.getByText(/147/)).toBeInTheDocument();
    expect(screen.queryByText(/▲|▼|▬/)).not.toBeInTheDocument();
  });

  it("renders an em dash when both null", () => {
    render(withI18n(<TrendIndicator first={null} last={null} unitSuffix="ms" />));
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
```

- [ ] **Step 6.2: Run test to confirm failure**

Run: `pnpm -F @modeldoctor/web vitest run src/features/benchmarks/__tests__/TrendIndicator.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 6.3: Implement the component**

Create `apps/web/src/features/benchmarks/TrendIndicator.tsx`:

```tsx
import { useTranslation } from "react-i18next";

interface Props {
  first: number | null;
  last: number | null;
  /** Unit shown after the value(s) (e.g. "ms"). */
  unitSuffix?: string;
}

const REGRESSION_RATIO = 1.05;
const IMPROVEMENT_RATIO = 0.95;

/**
 * Compact "first → last" indicator with an arrow that color-codes the
 * delta. Used in the endpoint-reports cards to flag p95 drift over the
 * report window without pulling in a chart library.
 */
export function TrendIndicator({ first, last, unitSuffix = "" }: Props) {
  const { t } = useTranslation("benchmarks");

  if (first == null && last == null) {
    return <span className="text-muted-foreground">—</span>;
  }
  if (first == null && last != null) {
    return (
      <span className="font-mono text-sm">
        {fmt(last)}
        {unitSuffix}
      </span>
    );
  }
  if (first != null && last == null) {
    return (
      <span className="font-mono text-sm">
        {fmt(first)}
        {unitSuffix}
      </span>
    );
  }
  // Both non-null at this point — TS guard for the branch.
  if (first == null || last == null) return null;

  const ratio = last / first;
  let kind: "regression" | "improvement" | "stable";
  if (ratio > REGRESSION_RATIO) kind = "regression";
  else if (ratio < IMPROVEMENT_RATIO) kind = "improvement";
  else kind = "stable";

  const arrowSymbol = kind === "regression" ? "▲" : kind === "improvement" ? "▼" : "▬";
  const arrowColor =
    kind === "regression"
      ? "text-destructive"
      : kind === "improvement"
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-muted-foreground";

  return (
    <span className="inline-flex items-center gap-1 font-mono text-sm">
      <span>{fmt(first)}</span>
      <span className="text-muted-foreground">→</span>
      <span>{fmt(last)}</span>
      {unitSuffix ? <span className="text-muted-foreground">{unitSuffix}</span> : null}
      <span aria-label={t(`reports.trend.${kind}`)} className={arrowColor}>
        {arrowSymbol}
      </span>
    </span>
  );
}

function fmt(n: number): string {
  // 1 decimal, trims trailing .0 for tighter density.
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? rounded.toString() : rounded.toFixed(1);
}
```

- [ ] **Step 6.4: Run test to confirm pass**

Run: `pnpm -F @modeldoctor/web vitest run src/features/benchmarks/__tests__/TrendIndicator.test.tsx`
Expected: PASS — 5 tests. (The test asserts on i18n labels for arrow `aria-label`. Add the keys in the next step or make the assertions tolerate missing keys via the `i18nResolvedTo` warning.)

- [ ] **Step 6.5: Add i18n keys for trend labels**

Edit `apps/web/src/locales/zh-CN/benchmarks.json` — add a `reports` block at the end (before final `}`):

```json
,
  "reports": {
    "title": "端点报告",
    "subtitle": "按连接聚合最近 N 天的基准测试，便于追踪端点健康趋势",
    "rangeLabel": "时间范围",
    "ranges": {
      "7d": "近 7 天",
      "30d": "近 30 天",
      "90d": "近 90 天"
    },
    "summary": {
      "totalRuns": "{{count}} 次测试",
      "successRate": "成功率 {{rate}}%",
      "successRateMissing": "成功率 —",
      "latest": "最近：{{name}} · {{when}}"
    },
    "trend": {
      "regression": "p95 劣化",
      "improvement": "p95 改善",
      "stable": "p95 稳定"
    },
    "viewHistory": "查看历史",
    "empty": {
      "title": "暂无报告数据",
      "body": "选定时间范围内没有基准测试。"
    }
  }
```

Edit `apps/web/src/locales/en-US/benchmarks.json` — same shape:

```json
,
  "reports": {
    "title": "Endpoint Reports",
    "subtitle": "Per-connection benchmark aggregates over a recent window",
    "rangeLabel": "Range",
    "ranges": {
      "7d": "Last 7 days",
      "30d": "Last 30 days",
      "90d": "Last 90 days"
    },
    "summary": {
      "totalRuns": "{{count}} runs",
      "successRate": "Success {{rate}}%",
      "successRateMissing": "Success —",
      "latest": "Latest: {{name}} · {{when}}"
    },
    "trend": {
      "regression": "p95 regression",
      "improvement": "p95 improvement",
      "stable": "p95 stable"
    },
    "viewHistory": "View history",
    "empty": {
      "title": "No report data",
      "body": "No benchmarks within the selected window."
    }
  }
```

Verify JSON parses: `node -e "require('./apps/web/src/locales/zh-CN/benchmarks.json'); require('./apps/web/src/locales/en-US/benchmarks.json'); console.log('ok')"`

- [ ] **Step 6.6: Re-run test**

Run: `pnpm -F @modeldoctor/web vitest run src/features/benchmarks/__tests__/TrendIndicator.test.tsx`
Expected: PASS — 5 tests, with `aria-label` resolving to the new i18n strings.

- [ ] **Step 6.7: Commit**

```bash
git add apps/web/src/features/benchmarks/TrendIndicator.tsx apps/web/src/features/benchmarks/__tests__/TrendIndicator.test.tsx apps/web/src/locales/zh-CN/benchmarks.json apps/web/src/locales/en-US/benchmarks.json
git commit -m "$(cat <<'EOF'
feat(web): TrendIndicator component for p95 first→last delta

Inline indicator with a color-coded ▲ / ▼ / ▬ marker:
- regression  (last > first × 1.05) → red ▲
- improvement (last < first × 0.95) → emerald ▼
- stable      (within ±5%)          → muted ▬

Used by the EndpointReportsPage cards. Pure presentational; no chart
dep needed for v1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `EndpointReportsPage`

**Files:**
- Create: `apps/web/src/features/benchmarks/EndpointReportsPage.tsx`
- Create: `apps/web/src/features/benchmarks/__tests__/EndpointReportsPage.test.tsx`

- [ ] **Step 7.1: Write failing test**

Create `apps/web/src/features/benchmarks/__tests__/EndpointReportsPage.test.tsx`:

```tsx
import type { EndpointReportsResponse } from "@modeldoctor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import { EndpointReportsPage } from "../EndpointReportsPage";

vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
import { api } from "@/lib/api-client";

function withProviders(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={qc}>
        <MemoryRouter>{node}</MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>
  );
}

const oneItem: EndpointReportsResponse = {
  range: "30d",
  generatedAt: "2026-05-06T00:00:00.000Z",
  items: [
    {
      connection: {
        id: "c_1",
        name: "bge-by-mis-tei",
        model: "gen-studio_bge-m3-uZbs",
        baseUrl: "http://183.240.109.2:30888",
        category: "embeddings",
      },
      totalRuns: 12,
      successRate: 99.8,
      p95Latency: { first: 147, last: 296 },
      latestRun: {
        id: "b_99",
        name: "weetime-04",
        status: "completed",
        createdAt: "2026-05-05T16:53:00.000Z",
      },
    },
  ],
};

describe("EndpointReportsPage", () => {
  it("renders empty state when items is []", async () => {
    vi.mocked(api.get).mockResolvedValue({
      range: "30d",
      generatedAt: "2026-05-06T00:00:00.000Z",
      items: [],
    } satisfies EndpointReportsResponse);
    render(withProviders(<EndpointReportsPage />));
    await waitFor(() =>
      expect(screen.getByText(/No report data|暂无报告数据/i)).toBeInTheDocument(),
    );
  });

  it("renders one card per connection with name, model, baseUrl, runs, success rate", async () => {
    vi.mocked(api.get).mockResolvedValue(oneItem);
    render(withProviders(<EndpointReportsPage />));

    await waitFor(() =>
      expect(screen.getByText("bge-by-mis-tei")).toBeInTheDocument(),
    );
    expect(screen.getByText("gen-studio_bge-m3-uZbs")).toBeInTheDocument();
    expect(screen.getByText("http://183.240.109.2:30888")).toBeInTheDocument();
    expect(screen.getByText(/12/)).toBeInTheDocument(); // run count
    expect(screen.getByText(/99\.8/)).toBeInTheDocument(); // success rate %
  });

  it("renders the regression marker when p95 last > first × 1.05", async () => {
    vi.mocked(api.get).mockResolvedValue(oneItem);
    render(withProviders(<EndpointReportsPage />));
    await waitFor(() =>
      expect(screen.getByLabelText(/regression|劣化/i)).toBeInTheDocument(),
    );
  });

  it("'View history' link points to /benchmarks/inference?connectionId=<id>", async () => {
    vi.mocked(api.get).mockResolvedValue(oneItem);
    render(withProviders(<EndpointReportsPage />));
    const link = await screen.findByRole("link", { name: /View history|查看历史/i });
    expect(link).toHaveAttribute("href", "/benchmarks/inference?connectionId=c_1");
  });
});
```

- [ ] **Step 7.2: Run test to confirm failure**

Run: `pnpm -F @modeldoctor/web vitest run src/features/benchmarks/__tests__/EndpointReportsPage.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 7.3: Implement the page**

Create `apps/web/src/features/benchmarks/EndpointReportsPage.tsx`:

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
import type { EndpointReportRange } from "@modeldoctor/contracts";
import { formatDistanceToNow } from "date-fns";
import { ArrowRight, BarChart3 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useEndpointReports } from "./queries";
import { StatusBadge } from "./status-display";
import { TrendIndicator } from "./TrendIndicator";

const RANGES: EndpointReportRange[] = ["7d", "30d", "90d"];

export function EndpointReportsPage() {
  const { t } = useTranslation("benchmarks");
  const [range, setRange] = useState<EndpointReportRange>("30d");
  const { data, isLoading } = useEndpointReports(range);

  return (
    <>
      <PageHeader
        title={t("reports.title")}
        subtitle={t("reports.subtitle")}
        rightSlot={
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{t("reports.rangeLabel")}</span>
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
          </div>
        }
      />
      <div className="space-y-6 px-8 py-6">
        {isLoading ? (
          <div
            role="status"
            aria-label="loading"
            className="h-64 animate-pulse rounded-md border border-border bg-muted/30"
          />
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            icon={BarChart3}
            title={t("reports.empty.title")}
            body={t("reports.empty.body")}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {data.items.map((item) => (
              <Card key={item.connection.id}>
                <CardHeader className="space-y-1.5">
                  <div className="flex items-baseline gap-2">
                    <h3 className="font-semibold leading-tight">{item.connection.name}</h3>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-xs text-muted-foreground">{item.connection.model}</span>
                  </div>
                  <div className="font-mono text-[11px] text-muted-foreground/70">
                    {item.connection.baseUrl}
                  </div>
                  <div>
                    <Badge variant="outline" className="text-[10px]">
                      {item.connection.category}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="text-muted-foreground">
                    {t("reports.summary.totalRuns", { count: item.totalRuns })} ·{" "}
                    {item.successRate != null
                      ? t("reports.summary.successRate", {
                          rate: item.successRate.toFixed(1),
                        })
                      : t("reports.summary.successRateMissing")}
                  </div>
                  <div>
                    p95:{" "}
                    <TrendIndicator
                      first={item.p95Latency?.first ?? null}
                      last={item.p95Latency?.last ?? null}
                      unitSuffix="ms"
                    />
                  </div>
                  {item.latestRun ? (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">
                        {t("reports.summary.latest", {
                          name: item.latestRun.name,
                          when: formatDistanceToNow(new Date(item.latestRun.createdAt), {
                            addSuffix: true,
                          }),
                        })}
                      </span>
                      <StatusBadge status={item.latestRun.status} iconOnly />
                    </div>
                  ) : null}
                  <div className="pt-2">
                    <Button asChild variant="outline" size="sm" className="gap-1">
                      <Link
                        to={`/benchmarks/inference?connectionId=${item.connection.id}`}
                      >
                        {t("reports.viewHistory")}
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
```

If `EmptyState` doesn't exist, check `apps/web/src/components/common/empty-state.tsx` and adjust. (`BenchmarkListShell` already imports it, so it exists.)

- [ ] **Step 7.4: Run test to confirm pass**

Run: `pnpm -F @modeldoctor/web vitest run src/features/benchmarks/__tests__/EndpointReportsPage.test.tsx`
Expected: PASS — 4 tests.

- [ ] **Step 7.5: Run full web test suite**

Run: `pnpm -F @modeldoctor/web vitest run`
Expected: green; no regressions in BenchmarkComparePage tests yet (the gate change happens in Task 9).

- [ ] **Step 7.6: Commit**

```bash
git add apps/web/src/features/benchmarks/EndpointReportsPage.tsx apps/web/src/features/benchmarks/__tests__/EndpointReportsPage.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): EndpointReportsPage — connection-anchored 30d health view

Cards render: name + model + baseUrl + category badge + total runs +
success rate + p95 trend (first→last) + latest run with status icon +
"View history" link to the scenario list filtered by connectionId.

Empty state when the query returns 0 items. Range picker (7d/30d/90d)
in the page header right slot.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase D — Routing & cleanup

### Task 8: `BenchmarkCompareGate` — redirect when no `?ids=`

**Files:**
- Create: `apps/web/src/features/benchmarks/compare/BenchmarkCompareGate.tsx`
- Create: `apps/web/src/features/benchmarks/compare/__tests__/BenchmarkCompareGate.test.tsx`
- Modify: `apps/web/src/features/benchmarks/compare/BenchmarkComparePage.tsx` — drop `BenchmarkCompareEmpty` fallback

- [ ] **Step 8.1: Write failing test**

Create `apps/web/src/features/benchmarks/compare/__tests__/BenchmarkCompareGate.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { BenchmarkCompareGate } from "../BenchmarkCompareGate";

function renderAt(initialUrl: string) {
  return render(
    <MemoryRouter initialEntries={[initialUrl]}>
      <Routes>
        <Route path="/benchmarks/compare" element={<BenchmarkCompareGate />} />
        <Route path="/benchmarks/inference" element={<div>inference list</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("BenchmarkCompareGate", () => {
  it("redirects to /benchmarks/inference when ?ids is missing", () => {
    renderAt("/benchmarks/compare");
    expect(screen.getByText("inference list")).toBeInTheDocument();
  });

  it("redirects to /benchmarks/inference when ?ids is empty string", () => {
    renderAt("/benchmarks/compare?ids=");
    expect(screen.getByText("inference list")).toBeInTheDocument();
  });

  it("renders <BenchmarkComparePage /> when ?ids has at least one entry", () => {
    // The compare page itself fetches benchmarks; here we just confirm
    // the gate hands off (page renders its own loading state).
    renderAt("/benchmarks/compare?ids=a,b");
    expect(screen.queryByText("inference list")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 8.2: Run test to confirm failure**

Run: `pnpm -F @modeldoctor/web vitest run src/features/benchmarks/compare/__tests__/BenchmarkCompareGate.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 8.3: Implement the gate**

Create `apps/web/src/features/benchmarks/compare/BenchmarkCompareGate.tsx`:

```tsx
import { Navigate, useSearchParams } from "react-router-dom";
import { BenchmarkComparePage } from "./BenchmarkComparePage";

/**
 * Pre-empts BenchmarkComparePage: when the URL has no `?ids=…` (or an
 * empty value), redirect to the default scenario list. The list page
 * is the only legit way to start a comparison; this gate ensures the
 * compare URL never lands on a redundant picker.
 */
export function BenchmarkCompareGate() {
  const [searchParams] = useSearchParams();
  const raw = searchParams.get("ids") ?? "";
  const hasIds = raw.split(",").some((s) => s.trim().length > 0);
  if (!hasIds) return <Navigate to="/benchmarks/inference" replace />;
  return <BenchmarkComparePage />;
}
```

- [ ] **Step 8.4: Drop the empty fallback inside `BenchmarkComparePage`**

Edit `apps/web/src/features/benchmarks/compare/BenchmarkComparePage.tsx`:
- Remove the `import { BenchmarkCompareEmpty } from "./BenchmarkCompareEmpty";` line.
- Find the block `if (ids.length === 0) { return <BenchmarkCompareEmpty />; }` and replace with a defensive throw / fallback (the gate guarantees we never hit this, but keep it safe):
  ```tsx
  if (ids.length === 0) {
    // Unreachable: BenchmarkCompareGate routes empty `ids` to /benchmarks/inference.
    // Keep a minimal fallback in case the page is mounted directly somehow.
    return null;
  }
  ```

- [ ] **Step 8.5: Run gate spec**

Run: `pnpm -F @modeldoctor/web vitest run src/features/benchmarks/compare/__tests__/BenchmarkCompareGate.test.tsx`
Expected: PASS — 3 tests.

- [ ] **Step 8.6: Commit**

```bash
git add apps/web/src/features/benchmarks/compare/BenchmarkCompareGate.tsx apps/web/src/features/benchmarks/compare/__tests__/BenchmarkCompareGate.test.tsx apps/web/src/features/benchmarks/compare/BenchmarkComparePage.tsx
git commit -m "$(cat <<'EOF'
feat(web): BenchmarkCompareGate — redirect /compare without ids → list

The list page's "Compare (N)" button is now the only legit entry into
the compare flow. Direct navigation to /benchmarks/compare without ids
redirects to /benchmarks/inference (default scenario list), which is
where the user picks rows to compare.

Strips the now-unreachable BenchmarkCompareEmpty fallback inside the
compare page.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Mount `/benchmarks/reports` + gate `/benchmarks/compare`

**Files:**
- Modify: `apps/web/src/router/index.tsx`

- [ ] **Step 9.1: Wire the new route + gate**

Edit `apps/web/src/router/index.tsx`. Two changes:

1. Add the EndpointReportsPage import near the other benchmark page imports:
```tsx
import { EndpointReportsPage } from "@/features/benchmarks/EndpointReportsPage";
```

2. Replace the current compare route with the gate, and add the reports route:

Before (around line 49):
```tsx
{ path: "benchmarks/compare", element: <BenchmarkComparePage /> },
```

After:
```tsx
{ path: "benchmarks/compare", element: <BenchmarkCompareGate /> },
{ path: "benchmarks/reports", element: <EndpointReportsPage /> },
```

Update the `BenchmarkComparePage` import to use the gate instead:
```tsx
// Replace:
// import { BenchmarkComparePage } from "@/features/benchmarks/compare/BenchmarkComparePage";
// With:
import { BenchmarkCompareGate } from "@/features/benchmarks/compare/BenchmarkCompareGate";
```

- [ ] **Step 9.2: Type-check**

Run: `pnpm -F @modeldoctor/web type-check`
Expected: success.

- [ ] **Step 9.3: Commit**

```bash
git add apps/web/src/router/index.tsx
git commit -m "$(cat <<'EOF'
feat(web): mount /benchmarks/reports; gate /benchmarks/compare

EndpointReportsPage at /benchmarks/reports replaces the redundant
"对比分析" sidebar entry's destination. /benchmarks/compare now goes
through BenchmarkCompareGate which redirects to the inference list
when ids is missing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Sidebar — replace compare entry with reports

**Files:**
- Modify: `apps/web/src/components/sidebar/sidebar-config.tsx`
- Modify: `apps/web/src/locales/zh-CN/sidebar.json`
- Modify: `apps/web/src/locales/en-US/sidebar.json`

- [ ] **Step 10.1: Update sidebar config**

Edit `apps/web/src/components/sidebar/sidebar-config.tsx`. Replace the GitCompare item in the benchmarks group:

Before:
```tsx
{ to: "/benchmarks/compare", icon: GitCompare, labelKey: "items.benchmarkCompare" },
```

After:
```tsx
{ to: "/benchmarks/reports", icon: BarChart3, labelKey: "items.endpointReports" },
```

Update the lucide imports — drop `GitCompare`, add `BarChart3`:

```tsx
// Find the lucide-react import block. Remove `GitCompare` from the named imports
// (if it's only used here) and add `BarChart3`.
import {
  Activity,
  BarChart3,
  Boxes,
  Bug,
  CheckCircle2,
  Database,
  Gauge,
  Image as ImageIcon,
  Layers,
  LineChart,
  ListOrdered,
  type LucideIcon,
  MessageSquare,
  Mic,
  Network,
  Settings,
} from "lucide-react";
```

- [ ] **Step 10.2: Update i18n**

Edit `apps/web/src/locales/zh-CN/sidebar.json` — find the `items` block and:
- Remove `"benchmarkCompare": "..."` line
- Add `"endpointReports": "端点报告",`

Edit `apps/web/src/locales/en-US/sidebar.json` — same:
- Remove `"benchmarkCompare": "..."`
- Add `"endpointReports": "Endpoint Reports",`

(Place near the other benchmark items so the alphabetical ordering doesn't shift much.)

Verify JSON: `node -e "require('./apps/web/src/locales/zh-CN/sidebar.json'); require('./apps/web/src/locales/en-US/sidebar.json'); console.log('ok')"`

- [ ] **Step 10.3: Run web suite**

Run: `pnpm -F @modeldoctor/web vitest run`
Expected: all green; no test asserts on the removed sidebar key.

- [ ] **Step 10.4: Commit**

```bash
git add apps/web/src/components/sidebar/sidebar-config.tsx apps/web/src/locales/zh-CN/sidebar.json apps/web/src/locales/en-US/sidebar.json
git commit -m "$(cat <<'EOF'
feat(web): sidebar — 对比分析 → 端点报告 / Endpoint Reports

Swap the redundant compare entry for the new connection-anchored
reports page. Icon changes from GitCompare to BarChart3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Cleanup — delete BenchmarkCompareEmpty + i18n

**Files:**
- Delete: `apps/web/src/features/benchmarks/compare/BenchmarkCompareEmpty.tsx`
- Delete: `apps/web/src/features/benchmarks/compare/__tests__/BenchmarkCompareEmpty.test.tsx`
- Modify: `apps/web/src/locales/zh-CN/benchmarks.json` — drop `compare.empty.*`
- Modify: `apps/web/src/locales/en-US/benchmarks.json` — drop `compare.empty.*`

- [ ] **Step 11.1: Delete the old empty component + test**

Run:
```bash
rm apps/web/src/features/benchmarks/compare/BenchmarkCompareEmpty.tsx
rm apps/web/src/features/benchmarks/compare/__tests__/BenchmarkCompareEmpty.test.tsx
```

- [ ] **Step 11.2: Drop the now-unused i18n keys**

Edit `apps/web/src/locales/zh-CN/benchmarks.json` — find the `compare` block:

```json
  "compare": {
    "title": "...",
    "subtitle": "...",
    "back": "返回列表",
    "baselineLabel": "基准",
    ...
    "empty": {
      "title": "...",
      "scenarioLabel": "...",
      ...
    }
  }
```

Remove the entire `"empty": { ... }` sub-block. The remaining `compare.*` keys (title, back, baselineLabel, etc.) stay because they're still used by the actual compare page.

Same edit in `apps/web/src/locales/en-US/benchmarks.json`.

Verify JSON: `node -e "require('./apps/web/src/locales/zh-CN/benchmarks.json'); require('./apps/web/src/locales/en-US/benchmarks.json'); console.log('ok')"`

- [ ] **Step 11.3: Type-check + run web suite**

Run: `pnpm -F @modeldoctor/web type-check && pnpm -F @modeldoctor/web vitest run`
Expected: type-check clean; all tests pass (the BenchmarkCompareEmpty test was deleted, the page test now goes through the gate).

- [ ] **Step 11.4: Commit**

```bash
git add -A apps/web/src/features/benchmarks/compare/ apps/web/src/locales/zh-CN/benchmarks.json apps/web/src/locales/en-US/benchmarks.json
git commit -m "$(cat <<'EOF'
chore(web): drop BenchmarkCompareEmpty + compare.empty.* i18n

Replaced by BenchmarkCompareGate (which redirects no-ids navigation
to the inference list). The picker UI it provided was a worse copy of
what BenchmarkListShell already does — net 120+ LOC removal.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase E — E2E

### Task 12: Playwright smoke

**Files:**
- Create: `e2e/benchmarks/endpoint-reports.spec.ts`

- [ ] **Step 12.1: Write the spec**

Create `e2e/benchmarks/endpoint-reports.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { registerAndLogin } from "../helpers/auth";
import { resetTestDb } from "../helpers/db";

test.beforeEach(async ({ page }) => {
  resetTestDb();
  await registerAndLogin(page);
});

test("Endpoint Reports: empty state then sidebar nav", async ({ page }) => {
  // Fresh DB has zero benchmarks → empty state.
  await page.goto("/benchmarks/reports");
  await expect(
    page.getByText(/No report data|暂无报告数据/i),
  ).toBeVisible({ timeout: 10_000 });

  // Sidebar entry navigates here.
  await page.getByRole("link", { name: /Endpoint Reports|端点报告/i }).click();
  await expect(page).toHaveURL(/\/benchmarks\/reports$/);
});

test("/benchmarks/compare without ids redirects to /benchmarks/inference", async ({ page }) => {
  await page.goto("/benchmarks/compare");
  await expect(page).toHaveURL(/\/benchmarks\/inference$/);
});
```

- [ ] **Step 12.2: Run e2e**

Run: `pnpm test:e2e:browser e2e/benchmarks/endpoint-reports.spec.ts`
Expected: PASS — both tests.

- [ ] **Step 12.3: Commit**

```bash
git add e2e/benchmarks/endpoint-reports.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): EndpointReportsPage smoke + compare-redirect verification

Two tests:
- /benchmarks/reports renders the empty state on a fresh DB and is
  reachable from the new sidebar entry.
- /benchmarks/compare with no ids redirects to /benchmarks/inference
  (gate behavior).

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

Expected: all green. If anything fails, fix root cause; don't skip.

- [ ] **Step F.2: Push + open PR**

```bash
git push -u origin feat/endpoint-reports
gh pr create --title "feat(benchmarks): endpoint reports — connection-anchored 30d health page" --body "$(cat <<'EOF'
## Summary
- Replaces the redundant "对比分析" sidebar with **"端点报告" / Endpoint Reports** at `/benchmarks/reports` — one card per saved connection, showing 30-day run count, success rate, p95 first→last delta, and latest run.
- New backend endpoint `GET /api/benchmarks/reports/by-connection?range=7d|30d|90d` aggregates the user's recent benchmarks by connection.
- `/benchmarks/compare` route stays for `?ids=…` deep-links from the list page; without ids, redirects to `/benchmarks/inference` (the gate replaces the old picker UI).
- Drops `BenchmarkCompareEmpty.tsx` (120+ LOC) and its `compare.empty.*` i18n.

Design: `docs/superpowers/specs/2026-05-06-endpoint-reports-design.md`
Plan: `docs/superpowers/plans/2026-05-06-endpoint-reports.md`

## Test plan
- [x] `pnpm -r test` passes
- [x] `pnpm -F @modeldoctor/api test:e2e` passes
- [x] `pnpm test:e2e:browser e2e/benchmarks/endpoint-reports.spec.ts` passes
- [ ] Manual: pick a real connection, run a few benchmarks, navigate to /benchmarks/reports, verify the card shows the right counts + p95 trend marker.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Then per project memory: `gh pr view <N> --json comments,reviews,statusCheckRollup,mergeStateStatus`, watch CI, surface red signals.

---

## Self-review

- **Spec coverage**: Every spec section has ≥1 task. Schemas → Task 1; backend service + helper + route → Tasks 2–4; FE hook + indicator + page → Tasks 5–7; gate + redirect → Task 8; routing + sidebar + cleanup → Tasks 9–11; e2e → Task 12. ✓
- **Type consistency**: `EndpointReport.connection.category` is `ModalityCategory` everywhere. `EndpointReportRange` enum is `7d|30d|90d` consistent across contracts → service → controller → hook → page. `readP95LatencyMs` (backend) name matches; FE `readP95Latency` already exists with same meaning. ✓
- **Placeholder scan**: No "TBD", no "implement later", no "similar to Task N" without code. The `makeMockRepo` / `makeMockPrisma` helpers are inlined when needed. ✓
- **Decomposition**: 12 tasks, each with bite-sized steps (2–5 min each). Each task ends with a commit. ✓
