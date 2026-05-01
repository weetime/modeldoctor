# Issue #38 Closure + #39 /history Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close issue #38 (add `Connection.prometheusUrl` / `Connection.serverKind`; defer `POST /runs` to #54) and light up issue #39 (`/history` list + kind-aware thin detail page) on top of the unified `Run` model already shipped by PR #61.

**Architecture:** Backend = 1 prisma migration + 2 Zod contract extensions + 2 service-layer passthroughs. Frontend = new `apps/web/src/features/history/` feature folder with list + detail pages, two new i18n namespaces, and 2 router entries replacing existing `ComingSoonRoute` placeholders. Zero new HTTP endpoints (consume existing `GET /runs` + `GET /runs/:id`).

**Tech Stack:** NestJS 10 / Prisma 5 / PostgreSQL / TypeScript — backend. React 18 / React Router 6 / TanStack Query 5 / shadcn/ui / react-i18next / vitest — frontend. Spec at `docs/superpowers/specs/2026-05-01-issue-38-closure-and-history-design.md`.

**Worktree:** This plan executes in `/Users/fangyong/vllm/modeldoctor/feat-history` on branch `feat/history-page` cut from `main` at `5a81a71`. Per-worktree Postgres DB to avoid migration cross-contamination with the `main` worktree.

---

## Task 0: Worktree Bootstrap

**Files:**
- Modify: `apps/api/.env` (in this worktree only — gitignored)

- [ ] **Step 1: Verify worktree state**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat-history
git status
git rev-parse --abbrev-ref HEAD
```

Expected: clean tree (only the spec doc committed); branch = `feat/history-page`.

- [ ] **Step 2: Install deps in this worktree**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat-history
pnpm install
```

Expected: lockfile honored, no warnings about peer deps.

- [ ] **Step 3: Provision per-worktree DB**

```bash
psql -h localhost -U postgres -c "CREATE DATABASE modeldoctor_history;" || echo "(already exists)"
```

If the local Postgres setup uses a different superuser, adjust `-U`. The `|| echo` swallows the "already exists" error so re-runs are idempotent.

- [ ] **Step 4: Copy `.env` from `main` worktree and override DB name**

```bash
cp /Users/fangyong/vllm/modeldoctor/main/.env apps/api/.env
```

Edit `apps/api/.env` and change `DATABASE_URL` to point at `modeldoctor_history`:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/modeldoctor_history?schema=public"
```

- [ ] **Step 5: Apply existing migrations to new DB**

```bash
pnpm -F @modeldoctor/api prisma migrate deploy
```

Expected: all migrations from `20260427080425_init` through `20260501080853_connections_credentials_refactor` apply cleanly.

- [ ] **Step 6: Verify baseline test pass**

```bash
pnpm -F @modeldoctor/api test --no-file-parallelism
pnpm -F @modeldoctor/web test
pnpm -r type-check
```

Expected: all green. If anything fails on baseline, stop and report — the plan assumes a green starting point.

No commit in this task — `.env` is gitignored and there are no source changes.

---

## Task 1: Add `Connection.prometheusUrl` + `Connection.serverKind` to Prisma Schema

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_connection_prometheus_fields/migration.sql` (auto-generated)

- [ ] **Step 1: Edit `apps/api/prisma/schema.prisma`**

Locate the `Connection` model (~line 57). Add two fields right after `tags`:

```prisma
model Connection {
  id            String   @id @default(cuid())
  userId        String   @map("user_id")
  name          String
  baseUrl       String   @map("base_url")
  apiKeyCipher  String   @map("api_key_cipher")  // AES-256-GCM v1, see common/crypto/aes-gcm.ts
  model         String
  customHeaders String   @default("") @map("custom_headers")
  queryParams   String   @default("") @map("query_params")
  category      String
  tags          String[] @default([])

  // Reserved for #60 Prometheus integration. Nullable on purpose: existing
  // connections (created before this migration) have no value, and the UI
  // does not expose these fields yet.
  prometheusUrl String? @map("prometheus_url")
  serverKind    String? @map("server_kind") // 'vllm' | 'sglang' | 'tgi' | 'higress' | 'generic'

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  user User  @relation(fields: [userId], references: [id], onDelete: Cascade)
  runs Run[]

  @@unique([userId, name])
  @@index([userId])
  @@map("connections")
}
```

- [ ] **Step 2: Generate migration**

```bash
pnpm -F @modeldoctor/api prisma migrate dev --name connection_prometheus_fields
```

Expected: a new directory `apps/api/prisma/migrations/<timestamp>_connection_prometheus_fields/` with `migration.sql` containing:

```sql
-- AlterTable
ALTER TABLE "connections" ADD COLUMN     "prometheus_url" TEXT,
ADD COLUMN     "server_kind" TEXT;
```

- [ ] **Step 3: Verify Prisma client regenerated**

```bash
pnpm -F @modeldoctor/api prisma generate
```

Expected: success message. No need to inspect; regeneration is automatic on `migrate dev` but explicit re-run is harmless.

- [ ] **Step 4: Commit**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat-history
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "$(cat <<'EOF'
feat(api/prisma): add Connection.prometheusUrl + Connection.serverKind

Reserve nullable storage for the Prometheus integration in #60.
UI does not expose these fields yet; ConnectionService passthrough
follows in next commit.

Closes part of #38.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Extend Connection Zod Schemas

**Files:**
- Modify: `packages/contracts/src/connection.ts`

- [ ] **Step 1: Edit `packages/contracts/src/connection.ts`**

Add `serverKindSchema` near the top of the file (after the existing imports). Then extend the public, create, and update schemas:

```ts
import { z } from "zod";
import { ModalityCategorySchema } from "./modality.js";

export const serverKindSchema = z.enum([
  "vllm",
  "sglang",
  "tgi",
  "higress",
  "generic",
]);
export type ServerKind = z.infer<typeof serverKindSchema>;

/** What clients see on list / detail. No plaintext apiKey, only preview. */
export const connectionPublicSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string().min(1).max(120),
  baseUrl: z.string().url(),
  apiKeyPreview: z.string(),
  model: z.string().min(1),
  customHeaders: z.string(),
  queryParams: z.string(),
  category: ModalityCategorySchema,
  tags: z.array(z.string()),
  prometheusUrl: z.string().url().nullable(),
  serverKind: serverKindSchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ConnectionPublic = z.infer<typeof connectionPublicSchema>;

/** Returned exactly once by POST /api/connections, and by PATCH when apiKey is rotated. */
export const connectionWithSecretSchema = connectionPublicSchema.extend({
  apiKey: z.string(),
});
export type ConnectionWithSecret = z.infer<typeof connectionWithSecretSchema>;

export const createConnectionSchema = z.object({
  name: z.string().min(1).max(120),
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  model: z.string().min(1),
  customHeaders: z.string().default(""),
  queryParams: z.string().default(""),
  category: ModalityCategorySchema,
  tags: z.array(z.string()).default([]),
  prometheusUrl: z.string().url().nullable().optional(),
  serverKind: serverKindSchema.nullable().optional(),
});
export type CreateConnection = z.infer<typeof createConnectionSchema>;

export const updateConnectionSchema = createConnectionSchema.partial();
export type UpdateConnection = z.infer<typeof updateConnectionSchema>;

export const listConnectionsResponseSchema = z.object({
  items: z.array(connectionPublicSchema),
});
export type ListConnectionsResponse = z.infer<typeof listConnectionsResponseSchema>;
```

- [ ] **Step 2: Build the contracts package**

```bash
pnpm -F @modeldoctor/contracts build
```

Expected: a fresh `dist/` is produced. No type errors.

- [ ] **Step 3: Type-check the api package against the new contract**

```bash
pnpm -F @modeldoctor/api type-check
```

Expected: FAIL — `ConnectionService.toContractPublic` does not include `prometheusUrl` / `serverKind` and does not satisfy the extended `ConnectionPublic` shape. This is the desired starting state; Task 3 will fix it.

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/src/connection.ts
git commit -m "$(cat <<'EOF'
feat(contracts): add Connection.prometheusUrl / serverKind to public + create + update

Public schema returns the fields nullable; create/update accept them
optional + nullable so the existing POST/PATCH bodies remain valid
(both default to null when unspecified). serverKind locked to the
five values listed in #38 / #60.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: ConnectionService Passthrough + Tests

**Files:**
- Modify: `apps/api/src/modules/connection/connection.service.ts`
- Modify: `apps/api/src/modules/connection/connection.service.spec.ts`

- [ ] **Step 1: Add a failing test for `create` passthrough**

Open `apps/api/src/modules/connection/connection.service.spec.ts`. In the `describe("create", ...)` block, after the existing `it("encrypts apiKey, ...")` test, append:

```ts
it("persists prometheusUrl + serverKind when provided", async () => {
  let storedData: Record<string, unknown> = {};
  prismaMock.connection.create.mockImplementation(
    async (args: { data: Record<string, unknown> & { apiKeyCipher: string } }) => {
      storedData = args.data;
      return makeRow({
        apiKeyCipher: args.data.apiKeyCipher as string,
        prometheusUrl: "http://prom:9090",
        serverKind: "vllm",
      });
    },
  );
  const out = await service.create("u_1", {
    name: "vllm-prod",
    baseUrl: "http://10.x.x.x:30888",
    apiKey: "sk-abc",
    model: "qwen2.5",
    customHeaders: "",
    queryParams: "",
    category: "chat",
    tags: [],
    prometheusUrl: "http://prom:9090",
    serverKind: "vllm",
  });
  expect(storedData.prometheusUrl).toBe("http://prom:9090");
  expect(storedData.serverKind).toBe("vllm");
  expect(out.prometheusUrl).toBe("http://prom:9090");
  expect(out.serverKind).toBe("vllm");
});

it("defaults prometheusUrl + serverKind to null when omitted", async () => {
  prismaMock.connection.create.mockImplementation(
    async (args: { data: Record<string, unknown> & { apiKeyCipher: string } }) => {
      return makeRow({ apiKeyCipher: args.data.apiKeyCipher as string });
    },
  );
  const out = await service.create("u_1", {
    name: "x",
    baseUrl: "http://x",
    apiKey: "k",
    model: "m",
    customHeaders: "",
    queryParams: "",
    category: "chat",
    tags: [],
  });
  expect(out.prometheusUrl).toBeNull();
  expect(out.serverKind).toBeNull();
});
```

Then update the `makeRow` helper (top of file, ~line 23) to include the new fields with defaults:

```ts
function makeRow(overrides: Partial<PrismaConnection> = {}): PrismaConnection {
  return {
    id: "c_1",
    userId: "u_1",
    name: "vllm-prod",
    baseUrl: "http://10.x.x.x:30888",
    apiKeyCipher: "v1:placeholder",
    model: "qwen2.5",
    customHeaders: "",
    queryParams: "",
    category: "chat",
    tags: [],
    prometheusUrl: null,
    serverKind: null,
    createdAt: new Date("2026-05-01T00:00:00Z"),
    updatedAt: new Date("2026-05-01T00:00:00Z"),
    ...overrides,
  };
}
```

- [ ] **Step 2: Run the new tests, expect failure**

```bash
pnpm -F @modeldoctor/api test connection.service.spec
```

Expected: the two new tests fail (service ignores `prometheusUrl` / `serverKind`; DTO doesn't include them).

- [ ] **Step 3: Update `ConnectionService.create`**

In `apps/api/src/modules/connection/connection.service.ts`, change `create` to thread the new fields:

```ts
async create(userId: string, input: CreateConnection): Promise<ConnectionWithSecret> {
  const apiKeyCipher = encrypt(input.apiKey, this.key);
  const row = await this.prisma.connection.create({
    data: {
      userId,
      name: input.name,
      baseUrl: input.baseUrl,
      apiKeyCipher,
      model: input.model,
      customHeaders: input.customHeaders,
      queryParams: input.queryParams,
      category: input.category,
      tags: input.tags,
      prometheusUrl: input.prometheusUrl ?? null,
      serverKind: input.serverKind ?? null,
    },
  });
  return this.toContractWithSecret(row, input.apiKey);
}
```

- [ ] **Step 4: Update `ConnectionService.update`**

Append to the existing `update` method's `data` builder (after the existing `if (input.tags !== undefined) ...` line, before `if (input.apiKey !== undefined) ...`):

```ts
if (input.prometheusUrl !== undefined) data.prometheusUrl = input.prometheusUrl;
if (input.serverKind !== undefined) data.serverKind = input.serverKind;
```

- [ ] **Step 5: Update `ConnectionService.toContractPublic`**

Add the two fields to the returned object:

```ts
private toContractPublic(row: PrismaConnection): ConnectionPublic {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    baseUrl: row.baseUrl,
    apiKeyPreview: this.makePreview(decrypt(row.apiKeyCipher, this.key)),
    model: row.model,
    customHeaders: row.customHeaders,
    queryParams: row.queryParams,
    category: row.category as ModalityCategory,
    tags: row.tags,
    prometheusUrl: row.prometheusUrl,
    serverKind: row.serverKind as ConnectionPublic["serverKind"],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
```

- [ ] **Step 6: Run all connection tests**

```bash
pnpm -F @modeldoctor/api test connection
```

Expected: all green (existing tests + the two new ones).

- [ ] **Step 7: Type-check**

```bash
pnpm -F @modeldoctor/api type-check
```

Expected: green.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/connection/
git commit -m "$(cat <<'EOF'
feat(api/connection): persist + return prometheusUrl + serverKind

create / update / toContractPublic thread the new optional fields.
Tests cover both provided and omitted inputs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Extend `listRunsQuerySchema` with `createdAfter` / `createdBefore`

**Files:**
- Modify: `packages/contracts/src/run.ts`
- Modify: `apps/api/src/modules/run/run.repository.ts`
- Modify: `apps/api/src/modules/run/run.repository.spec.ts`

- [ ] **Step 1: Add a failing test in `run.repository.spec.ts`**

Append a new test case at the end of the `describe("RunRepository", ...)` block:

```ts
it("filters by createdAt range", async () => {
  const user = await prisma.user.create({
    data: { email: "time-range@example.com", passwordHash: "x" },
  });
  // Create three runs with explicit timestamps (1 hour apart)
  for (let i = 0; i < 3; i++) {
    await prisma.run.create({
      data: {
        userId: user.id,
        kind: "benchmark",
        tool: "guidellm",
        scenario: {},
        mode: "fixed",
        driverKind: "local",
        params: {},
        createdAt: new Date(`2026-04-30T0${i}:00:00Z`),
      },
    });
  }
  const between = await repo.list({
    createdAfter: "2026-04-30T01:00:00Z",
    createdBefore: "2026-04-30T01:30:00Z",
  });
  expect(between.items).toHaveLength(1);
  expect(between.items[0].createdAt.toISOString()).toBe("2026-04-30T01:00:00.000Z");

  const fromOne = await repo.list({ createdAfter: "2026-04-30T01:00:00Z" });
  expect(fromOne.items).toHaveLength(2);

  const untilOne = await repo.list({ createdBefore: "2026-04-30T01:00:00Z" });
  expect(untilOne.items).toHaveLength(2);
});
```

- [ ] **Step 2: Run new test, expect failure**

```bash
pnpm -F @modeldoctor/api test run.repository.spec
```

Expected: TS error — `ListRunsInput` does not include `createdAfter` / `createdBefore`.

- [ ] **Step 3: Extend `listRunsQuerySchema` in contracts**

Edit `packages/contracts/src/run.ts`. Replace the existing `listRunsQuerySchema` block:

```ts
export const listRunsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
  kind: runKindSchema.optional(),
  tool: runToolSchema.optional(),
  status: runStatusSchema.optional(),
  connectionId: z.string().optional(),
  parentRunId: z.string().optional(),
  search: z.string().optional(),
  createdAfter: z.string().datetime().optional(),
  createdBefore: z.string().datetime().optional(),
});
export type ListRunsQuery = z.infer<typeof listRunsQuerySchema>;
```

- [ ] **Step 4: Rebuild contracts**

```bash
pnpm -F @modeldoctor/contracts build
```

Expected: success.

- [ ] **Step 5: Extend `RunRepository.list`**

Edit `apps/api/src/modules/run/run.repository.ts`. Update `ListRunsInput`:

```ts
export type ListRunsInput = {
  kind?: "benchmark" | "e2e";
  tool?: string;
  status?: string;
  connectionId?: string;
  parentRunId?: string;
  userId?: string;
  search?: string;
  createdAfter?: string;
  createdBefore?: string;
  cursor?: string;
  limit?: number;
};
```

In the `list` method, after the existing `if (input.search) ...` block, insert:

```ts
if (input.createdAfter || input.createdBefore) {
  where.createdAt = {
    ...(input.createdAfter && { gte: new Date(input.createdAfter) }),
    ...(input.createdBefore && { lte: new Date(input.createdBefore) }),
  };
}
```

- [ ] **Step 6: Run tests, expect green**

```bash
pnpm -F @modeldoctor/api test run.repository.spec
```

Expected: all green including the new time-range test.

- [ ] **Step 7: Type-check**

```bash
pnpm -F @modeldoctor/api type-check
pnpm -F @modeldoctor/web type-check
```

Expected: green. Web side picks up the contract change automatically (no consumers yet — Task 7+ will add them).

- [ ] **Step 8: Commit**

```bash
git add packages/contracts/src/run.ts apps/api/src/modules/run/
git commit -m "$(cat <<'EOF'
feat(api/run): list filter by createdAt range

listRunsQuerySchema gains optional createdAfter / createdBefore (ISO
datetime). RunRepository.list translates them to Prisma where.createdAt
gte / lte. Test covers both ends, half-open, and the precise boundary.

Closes part of #38 (history view filter primitive).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: history Feature Folder — `api.ts` + `queries.ts`

**Files:**
- Create: `apps/web/src/features/history/api.ts`
- Create: `apps/web/src/features/history/queries.ts`

- [ ] **Step 1: Create `apps/web/src/features/history/api.ts`**

```ts
import { api } from "@/lib/api-client";
import type { ListRunsQuery, ListRunsResponse, Run } from "@modeldoctor/contracts";

function buildListQuery(q: Partial<ListRunsQuery>): string {
  const usp = new URLSearchParams();
  if (q.limit !== undefined) usp.set("limit", String(q.limit));
  if (q.cursor) usp.set("cursor", q.cursor);
  if (q.kind) usp.set("kind", q.kind);
  if (q.tool) usp.set("tool", q.tool);
  if (q.status) usp.set("status", q.status);
  if (q.connectionId) usp.set("connectionId", q.connectionId);
  if (q.search) usp.set("search", q.search);
  if (q.createdAfter) usp.set("createdAfter", q.createdAfter);
  if (q.createdBefore) usp.set("createdBefore", q.createdBefore);
  const qs = usp.toString();
  return qs ? `?${qs}` : "";
}

export const historyApi = {
  list: (q: Partial<ListRunsQuery>) =>
    api.get<ListRunsResponse>(`/api/runs${buildListQuery(q)}`),
  get: (id: string) => api.get<Run>(`/api/runs/${id}`),
};
```

- [ ] **Step 2: Create `apps/web/src/features/history/queries.ts`**

```ts
import type { ListRunsQuery } from "@modeldoctor/contracts";
import { useQuery } from "@tanstack/react-query";
import { historyApi } from "./api";

export const historyKeys = {
  all: ["history"] as const,
  lists: () => [...historyKeys.all, "list"] as const,
  list: (q: Partial<ListRunsQuery>) => [...historyKeys.lists(), q] as const,
  details: () => [...historyKeys.all, "detail"] as const,
  detail: (id: string) => [...historyKeys.details(), id] as const,
};

export function useRunsList(q: Partial<ListRunsQuery>) {
  return useQuery({
    queryKey: historyKeys.list(q),
    queryFn: () => historyApi.list(q),
    staleTime: 30_000,
  });
}

export function useRunDetail(id: string) {
  return useQuery({
    queryKey: historyKeys.detail(id),
    queryFn: () => historyApi.get(id),
    enabled: id.length > 0,
  });
}
```

- [ ] **Step 3: Type-check**

```bash
pnpm -F @modeldoctor/web type-check
```

Expected: green.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/history/
git commit -m "$(cat <<'EOF'
feat(web/history): api + queries scaffolding for /runs consumption

Lays down historyApi.list / historyApi.get and React-Query hooks. No
component consumers yet; pages added in subsequent commits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: history i18n Locale Files + Registration

**Files:**
- Create: `apps/web/src/locales/zh-CN/history.json`
- Create: `apps/web/src/locales/en-US/history.json`
- Modify: `apps/web/src/lib/i18n.ts`

- [ ] **Step 1: Create `apps/web/src/locales/en-US/history.json`**

```json
{
  "title": "Run History",
  "subtitle": "All Runs across benchmark and e2e, newest first",
  "filters": {
    "kind": "Kind",
    "tool": "Tool",
    "status": "Status",
    "connection": "Connection",
    "createdAfter": "From",
    "createdBefore": "Until",
    "search": "Search by name or description",
    "any": "Any",
    "clear": "Clear filters"
  },
  "columns": {
    "selected": "",
    "createdAt": "Created",
    "kind": "Kind",
    "tool": "Tool",
    "connection": "Connection",
    "status": "Status",
    "p95": "p95 (ms)",
    "errorRate": "Error rate",
    "open": ""
  },
  "compareButton": "Compare ({{n}})",
  "compareDisabledTooltip": "Enabled once #46 (report page) ships",
  "empty": {
    "title": "No runs yet",
    "filtered": "No runs match these filters",
    "description": "Trigger a benchmark, load test, or e2e check from the corresponding page."
  },
  "loadMore": "Load more",
  "errorBanner": "Failed to load runs",
  "retry": "Retry",
  "detail": {
    "back": "Back to history",
    "subtitle": "{{kind}} · {{tool}} · {{when}}",
    "metadata": {
      "kind": "Kind",
      "tool": "Tool",
      "mode": "Mode",
      "driverKind": "Driver",
      "status": "Status",
      "connection": "Connection",
      "connectionMissing": "(deleted)",
      "createdAt": "Created",
      "startedAt": "Started",
      "completedAt": "Completed",
      "duration": "Duration",
      "notStarted": "—"
    },
    "metrics": {
      "title": "Summary metrics",
      "empty": "No metrics recorded for this run."
    },
    "rawOutput": {
      "toggle": "Raw output (JSON)"
    },
    "logs": {
      "toggle": "Logs"
    },
    "notFound": {
      "title": "Run not found",
      "body": "It may have been deleted, or you may not own it."
    },
    "loadError": "Failed to load run"
  }
}
```

- [ ] **Step 2: Create `apps/web/src/locales/zh-CN/history.json`**

```json
{
  "title": "运行历史",
  "subtitle": "所有 Run（benchmark + e2e）按时间倒序",
  "filters": {
    "kind": "类型",
    "tool": "工具",
    "status": "状态",
    "connection": "Connection",
    "createdAfter": "起",
    "createdBefore": "止",
    "search": "按名称或备注搜索",
    "any": "全部",
    "clear": "清除筛选"
  },
  "columns": {
    "selected": "",
    "createdAt": "创建时间",
    "kind": "类型",
    "tool": "工具",
    "connection": "Connection",
    "status": "状态",
    "p95": "p95 (ms)",
    "errorRate": "错误率",
    "open": ""
  },
  "compareButton": "对比 ({{n}})",
  "compareDisabledTooltip": "等 #46 报告页上线后启用",
  "empty": {
    "title": "暂无 Run",
    "filtered": "没有符合筛选条件的 Run",
    "description": "去对应页面触发一次 benchmark、负载测试或 e2e 检查。"
  },
  "loadMore": "加载更多",
  "errorBanner": "加载 Run 失败",
  "retry": "重试",
  "detail": {
    "back": "返回 history",
    "subtitle": "{{kind}} · {{tool}} · {{when}}",
    "metadata": {
      "kind": "类型",
      "tool": "工具",
      "mode": "模式",
      "driverKind": "Driver",
      "status": "状态",
      "connection": "Connection",
      "connectionMissing": "(已删除)",
      "createdAt": "创建于",
      "startedAt": "开始于",
      "completedAt": "结束于",
      "duration": "时长",
      "notStarted": "—"
    },
    "metrics": {
      "title": "汇总指标",
      "empty": "本次 Run 没有记录指标。"
    },
    "rawOutput": {
      "toggle": "原始输出（JSON）"
    },
    "logs": {
      "toggle": "日志"
    },
    "notFound": {
      "title": "Run 不存在",
      "body": "可能已被删除，或不属于你的账户。"
    },
    "loadError": "加载 Run 失败"
  }
}
```

- [ ] **Step 3: Register the new namespace in `apps/web/src/lib/i18n.ts`**

Open the file and add the imports + namespace entries. The exact diff:

After `import enE2E from "@/locales/en-US/e2e.json";`, add:

```ts
import enHistory from "@/locales/en-US/history.json";
```

After `import zhE2E from "@/locales/zh-CN/e2e.json";`, add:

```ts
import zhHistory from "@/locales/zh-CN/history.json";
```

In the `resources["en-US"]` block, add `history: enHistory,` after `e2e: enE2E,`.
In the `resources["zh-CN"]` block, add `history: zhHistory,` after `e2e: zhE2E,`.

- [ ] **Step 4: Type-check + run web tests**

```bash
pnpm -F @modeldoctor/web type-check
pnpm -F @modeldoctor/web test
```

Expected: green (no consumer of the namespace yet, so existing tests don't change).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/locales/zh-CN/history.json apps/web/src/locales/en-US/history.json apps/web/src/lib/i18n.ts
git commit -m "$(cat <<'EOF'
feat(web/i18n): add history namespace (zh-CN + en-US)

Covers list page (PageHeader / filters / columns / compare button /
empty + error states) and detail page (metadata block / metrics /
raw output / logs / not-found). Compare button copy explicitly
points at #46.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Wire `/history` and `/history/:runId` Routes

**Files:**
- Modify: `apps/web/src/router/index.tsx`
- Create: `apps/web/src/features/history/HistoryListPage.tsx` (skeleton)
- Create: `apps/web/src/features/history/HistoryDetailPage.tsx` (skeleton)

- [ ] **Step 1: Create `apps/web/src/features/history/HistoryListPage.tsx` skeleton**

This is just enough to compile. Filters / table land in Task 8 / 9.

```tsx
import { PageHeader } from "@/components/common/page-header";
import { useTranslation } from "react-i18next";

export function HistoryListPage() {
  const { t } = useTranslation("history");
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="px-8 py-6 text-muted-foreground">…</div>
    </>
  );
}
```

- [ ] **Step 2: Create `apps/web/src/features/history/HistoryDetailPage.tsx` skeleton**

```tsx
import { PageHeader } from "@/components/common/page-header";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";

export function HistoryDetailPage() {
  const { t } = useTranslation("history");
  const { runId } = useParams<{ runId: string }>();
  return (
    <>
      <PageHeader title={runId ?? "—"} subtitle={t("detail.subtitle", { kind: "?", tool: "?", when: "?" })} />
      <div className="px-8 py-6 text-muted-foreground">…</div>
    </>
  );
}
```

- [ ] **Step 3: Edit `apps/web/src/router/index.tsx`**

Add the imports near the top (alphabetical placement among `@/features/*` imports):

```ts
import { HistoryDetailPage } from "@/features/history/HistoryDetailPage";
import { HistoryListPage } from "@/features/history/HistoryListPage";
```

The `History as HistoryIcon` import from `lucide-react` should now be unused; remove it from the lucide-react import list.

Replace the existing `/history` route entry:

```tsx
{
  path: "history",
  element: <HistoryListPage />,
},
{
  path: "history/:runId",
  element: <HistoryDetailPage />,
},
```

- [ ] **Step 4: Type-check + dev smoke**

```bash
pnpm -F @modeldoctor/web type-check
pnpm -F @modeldoctor/api dev &
API_PID=$!
sleep 4
pnpm -F @modeldoctor/web dev &
WEB_PID=$!
sleep 6
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/history
kill $API_PID $WEB_PID 2>/dev/null
```

Expected: type-check green; dev smoke returns 200 (the SPA shell). If the dev servers were already running, skip the spawn and just `curl`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/history/HistoryListPage.tsx apps/web/src/features/history/HistoryDetailPage.tsx apps/web/src/router/index.tsx
git commit -m "$(cat <<'EOF'
feat(web/history): replace ComingSoonRoute with HistoryListPage + HistoryDetailPage shells

Routes /history and /history/:runId now render real components
(skeletons only — filters / table / detail body land in next commits).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: HistoryListPage — Table + Pagination + Loading/Error/Empty States

**Files:**
- Modify: `apps/web/src/features/history/HistoryListPage.tsx`

- [ ] **Step 1: Replace the skeleton with a full implementation**

```tsx
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ListRunsQuery, Run } from "@modeldoctor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { History as HistoryIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { historyKeys, useRunsList } from "./queries";

function readP95(metrics: Run["summaryMetrics"]): number | null {
  if (!metrics) return null;
  // vegeta: latencies.p95 (ns or ms); guidellm: tokens.ttftMs.p95 etc.
  // Best-effort surface — if a tool stores p95 elsewhere, the cell shows '—'.
  const m = metrics as Record<string, unknown>;
  const latency = m.latencies as { p95?: number } | undefined;
  if (latency?.p95 !== undefined) return latency.p95;
  const ttft = (m.tokens as { ttftMs?: { p95?: number } } | undefined)?.ttftMs;
  if (ttft?.p95 !== undefined) return ttft.p95;
  return null;
}

function readErrorRate(metrics: Run["summaryMetrics"]): number | null {
  if (!metrics) return null;
  const m = metrics as Record<string, unknown>;
  if (typeof m.errorRate === "number") return m.errorRate;
  const success = m.success as { rate?: number } | undefined;
  if (typeof success?.rate === "number") return 1 - success.rate;
  return null;
}

function fmtNum(n: number | null | undefined, digits = 1): string {
  if (n == null) return "—";
  return n.toFixed(digits);
}

export function HistoryListPage() {
  const { t } = useTranslation("history");
  const qc = useQueryClient();

  // Filters land in Task 9; for now hold an empty query.
  const [query] = useState<Partial<ListRunsQuery>>({ limit: 20 });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data, isLoading, isError, error, refetch } = useRunsList(query);

  const isFiltered = useMemo(
    () =>
      query.kind !== undefined ||
      query.tool !== undefined ||
      query.status !== undefined ||
      query.connectionId !== undefined ||
      query.search !== undefined ||
      query.createdAfter !== undefined ||
      query.createdBefore !== undefined,
    [query],
  );

  function toggleRow(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const compareDisabled = selected.size < 2;

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
              onClick={() => qc.invalidateQueries({ queryKey: historyKeys.lists() })}
            >
              {t("retry")}
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button size="sm" disabled={true}>
                    {t("compareButton", { n: selected.size })}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {compareDisabled ? t("filters.any") : t("compareDisabledTooltip")}
              </TooltipContent>
            </Tooltip>
          </div>
        }
      />

      <div className="space-y-4 px-8 py-6">
        {/* Filters land in Task 9 */}

        {isError ? (
          <Alert variant="destructive">
            <AlertDescription className="flex items-center justify-between">
              <span>{(error as Error).message || t("errorBanner")}</span>
              <Button size="sm" variant="outline" onClick={() => refetch()}>
                {t("retry")}
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
              <AlertDescription>{t("empty.filtered")}</AlertDescription>
            </Alert>
          ) : (
            <EmptyState
              icon={HistoryIcon}
              title={t("empty.title")}
              body={t("empty.description")}
            />
          )
        ) : (
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>{t("columns.createdAt")}</TableHead>
                  <TableHead>{t("columns.kind")}</TableHead>
                  <TableHead>{t("columns.tool")}</TableHead>
                  <TableHead>{t("columns.connection")}</TableHead>
                  <TableHead>{t("columns.status")}</TableHead>
                  <TableHead className="text-right">{t("columns.p95")}</TableHead>
                  <TableHead className="text-right">{t("columns.errorRate")}</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.items.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell>
                      <Checkbox
                        checked={selected.has(run.id)}
                        onCheckedChange={(c) => toggleRow(run.id, c === true)}
                        aria-label={`select ${run.id}`}
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDistanceToNow(new Date(run.createdAt), { addSuffix: true })}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{run.kind}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{run.tool}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {run.connectionId ?? "—"}
                    </TableCell>
                    <TableCell>{run.status}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtNum(readP95(run.summaryMetrics))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtNum(readErrorRate(run.summaryMetrics), 4)}
                    </TableCell>
                    <TableCell>
                      <Link
                        to={`/history/${run.id}`}
                        className="text-primary hover:underline"
                      >
                        →
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {data?.nextCursor && (
          <div className="flex justify-center">
            <Button variant="outline" size="sm" disabled>
              {t("loadMore")}
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
```

Note: the "Load more" button is disabled in this task — pagination state ties in with filter URL state, both land in Task 9.

- [ ] **Step 2: Type-check**

```bash
pnpm -F @modeldoctor/web type-check
```

Expected: green.

- [ ] **Step 3: Manual smoke (dev server)**

```bash
pnpm -F @modeldoctor/api dev &
pnpm -F @modeldoctor/web dev &
sleep 6
open http://localhost:5173/history
```

Visit `/history` in browser. Expected: empty state (no runs in this fresh DB) — or, if you've used /benchmarks etc. in this worktree, a list of runs. Compare button is disabled with tooltip. Click "→" → navigates to `/history/:runId` (skeleton page). Kill dev servers when done: `pkill -f 'pnpm.*dev'`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/history/HistoryListPage.tsx
git commit -m "$(cat <<'EOF'
feat(web/history): list page renders rows + states + compare-disabled stub

Full table renders (selection / kind+tool badges / status / p95 /
error rate / link to detail). Loading skeleton, error banner with
retry, two empty variants. Compare button always disabled with
tooltip pointing at #46. Filters and load-more wiring follow.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: HistoryFilters Component + URL Query Wiring

**Files:**
- Create: `apps/web/src/features/history/HistoryFilters.tsx`
- Modify: `apps/web/src/features/history/HistoryListPage.tsx`

- [ ] **Step 1: Create `apps/web/src/features/history/HistoryFilters.tsx`**

```tsx
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  ListRunsQuery,
  RunKind,
  RunStatus,
  RunTool,
} from "@modeldoctor/contracts";
import { useTranslation } from "react-i18next";

const ALL = "__all__";

const KINDS: RunKind[] = ["benchmark", "e2e"];
const TOOLS: RunTool[] = ["guidellm", "genai-perf", "vegeta", "e2e", "custom"];
const STATUSES: RunStatus[] = [
  "pending",
  "submitted",
  "running",
  "completed",
  "failed",
  "canceled",
];

export interface HistoryFiltersProps {
  query: Partial<ListRunsQuery>;
  onChange: (next: Partial<ListRunsQuery>) => void;
}

export function HistoryFilters({ query, onChange }: HistoryFiltersProps) {
  const { t } = useTranslation("history");

  function patch(p: Partial<ListRunsQuery>) {
    onChange({ ...query, ...p });
  }

  const isFiltered =
    query.kind !== undefined ||
    query.tool !== undefined ||
    query.status !== undefined ||
    query.connectionId !== undefined ||
    query.search !== undefined ||
    query.createdAfter !== undefined ||
    query.createdBefore !== undefined;

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Select
        value={query.kind ?? ALL}
        onValueChange={(v) => patch({ kind: v === ALL ? undefined : (v as RunKind) })}
      >
        <SelectTrigger className="w-[140px]" aria-label={t("filters.kind")}>
          <SelectValue placeholder={t("filters.kind")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("filters.any")}</SelectItem>
          {KINDS.map((k) => (
            <SelectItem key={k} value={k}>
              {k}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={query.tool ?? ALL}
        onValueChange={(v) => patch({ tool: v === ALL ? undefined : (v as RunTool) })}
      >
        <SelectTrigger className="w-[160px]" aria-label={t("filters.tool")}>
          <SelectValue placeholder={t("filters.tool")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("filters.any")}</SelectItem>
          {TOOLS.map((tool) => (
            <SelectItem key={tool} value={tool}>
              {tool}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={query.status ?? ALL}
        onValueChange={(v) => patch({ status: v === ALL ? undefined : (v as RunStatus) })}
      >
        <SelectTrigger className="w-[160px]" aria-label={t("filters.status")}>
          <SelectValue placeholder={t("filters.status")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("filters.any")}</SelectItem>
          {STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {s}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Input
        placeholder={t("filters.search")}
        className="w-[220px]"
        value={query.search ?? ""}
        onChange={(e) => patch({ search: e.target.value || undefined })}
      />

      <div className="flex items-center gap-1 text-sm">
        <span className="text-muted-foreground">{t("filters.createdAfter")}</span>
        <Input
          type="datetime-local"
          className="w-[200px]"
          value={query.createdAfter?.slice(0, 16) ?? ""}
          onChange={(e) =>
            patch({
              createdAfter: e.target.value ? new Date(e.target.value).toISOString() : undefined,
            })
          }
        />
      </div>

      <div className="flex items-center gap-1 text-sm">
        <span className="text-muted-foreground">{t("filters.createdBefore")}</span>
        <Input
          type="datetime-local"
          className="w-[200px]"
          value={query.createdBefore?.slice(0, 16) ?? ""}
          onChange={(e) =>
            patch({
              createdBefore: e.target.value ? new Date(e.target.value).toISOString() : undefined,
            })
          }
        />
      </div>

      {isFiltered && (
        <Button variant="ghost" size="sm" onClick={() => onChange({ limit: query.limit })}>
          {t("filters.clear")}
        </Button>
      )}
    </div>
  );
}
```

(Connection select intentionally omitted from this MVP — adding it requires loading the user's connections via React Query in this component, which is a follow-up. The contract field `connectionId` is still wired up on the backend so a future drop-in is trivial.)

- [ ] **Step 2: Wire filter state into `HistoryListPage`**

Replace the early `const [query] = useState<Partial<ListRunsQuery>>({ limit: 20 });` block in `HistoryListPage.tsx` with URL-driven state:

```tsx
import { useSearchParams } from "react-router-dom";
import { HistoryFilters } from "./HistoryFilters";

// inside HistoryListPage()
const [searchParams, setSearchParams] = useSearchParams();
const query: Partial<ListRunsQuery> = useMemo(() => {
  const q: Partial<ListRunsQuery> = { limit: 20 };
  const get = (k: string) => searchParams.get(k) ?? undefined;
  if (get("kind")) q.kind = get("kind") as RunKind;
  if (get("tool")) q.tool = get("tool") as RunTool;
  if (get("status")) q.status = get("status") as RunStatus;
  if (get("connectionId")) q.connectionId = get("connectionId");
  if (get("search")) q.search = get("search");
  if (get("createdAfter")) q.createdAfter = get("createdAfter");
  if (get("createdBefore")) q.createdBefore = get("createdBefore");
  if (get("cursor")) q.cursor = get("cursor");
  return q;
}, [searchParams]);

function patchQuery(next: Partial<ListRunsQuery>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(next)) {
    if (v !== undefined && k !== "limit") sp.set(k, String(v));
  }
  setSearchParams(sp);
}
```

You'll need to import `RunKind`, `RunTool`, `RunStatus` types at the top of the file:

```tsx
import type {
  ListRunsQuery,
  Run,
  RunKind,
  RunStatus,
  RunTool,
} from "@modeldoctor/contracts";
```

Then add the filters render right above the table block, in the `<div className="space-y-4 px-8 py-6">`:

```tsx
<HistoryFilters query={query} onChange={patchQuery} />
```

- [ ] **Step 3: Wire "Load more" button to set `cursor` in URL**

In the existing `data?.nextCursor && (...)` block, change the disabled button into:

```tsx
{data?.nextCursor && (
  <div className="flex justify-center">
    <Button
      variant="outline"
      size="sm"
      onClick={() => patchQuery({ ...query, cursor: data.nextCursor ?? undefined })}
    >
      {t("loadMore")}
    </Button>
  </div>
)}
```

- [ ] **Step 4: Type-check**

```bash
pnpm -F @modeldoctor/web type-check
```

Expected: green.

- [ ] **Step 5: Manual smoke**

Restart dev servers, open `/history`, change each filter, observe:
- URL updates (`?kind=benchmark&status=completed`)
- Refresh keeps the filter
- "Clear filters" empties the query
- Date pickers post ISO strings; results filter accordingly

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/history/
git commit -m "$(cat <<'EOF'
feat(web/history): wire filters + cursor pagination via URL state

HistoryFilters component handles kind / tool / status / search +
createdAfter / createdBefore. State lives in URL search params so
refreshes preserve view. Connection-select deferred (needs a
connections fetch in this component).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: HistoryListPage Tests

**Files:**
- Create: `apps/web/src/features/history/__tests__/HistoryListPage.test.tsx`

- [ ] **Step 1: Find the existing test pattern**

Read `apps/web/src/features/benchmark/__tests__/BenchmarkListPage.test.tsx` (or similar adjacent test) to copy MSW / QueryClient setup conventions.

```bash
ls apps/web/src/features/benchmark/__tests__ 2>/dev/null
ls apps/web/src/features/load-test/ | grep test
cat apps/web/src/features/load-test/LoadTestPage.test.tsx | head -40
```

The web side uses vitest + @testing-library/react + MemoryRouter. Look for the helper that wraps a component with `<QueryClientProvider>` + `<MemoryRouter>` + `<I18nextProvider>` (or `i18n.init` in setup). If a shared helper exists (e.g. `apps/web/src/test/render.tsx` or similar), reuse it; otherwise inline the setup as below.

- [ ] **Step 2: Create the test file**

```tsx
import type { ListRunsResponse, Run } from "@modeldoctor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HistoryListPage } from "../HistoryListPage";

vi.mock("@/lib/api-client", () => {
  const list: ListRunsResponse = {
    items: [makeRun("r1", "benchmark", "guidellm", "completed")],
    nextCursor: null,
  };
  return {
    api: {
      get: vi.fn(async (_path: string) => list),
      post: vi.fn(),
      patch: vi.fn(),
      del: vi.fn(),
    },
  };
});

function makeRun(
  id: string,
  kind: Run["kind"],
  tool: Run["tool"],
  status: Run["status"],
): Run {
  return {
    id,
    userId: "u1",
    connectionId: "c1",
    kind,
    tool,
    scenario: {},
    mode: "fixed",
    driverKind: "local",
    name: id,
    description: null,
    status,
    statusMessage: null,
    progress: null,
    driverHandle: null,
    params: {},
    canonicalReport: null,
    rawOutput: null,
    summaryMetrics: { latencies: { p95: 123.4 }, errorRate: 0.001 },
    serverMetrics: null,
    templateId: null,
    templateVersion: null,
    parentRunId: null,
    baselineId: null,
    logs: null,
    createdAt: "2026-04-30T12:00:00.000Z",
    startedAt: "2026-04-30T12:00:01.000Z",
    completedAt: "2026-04-30T12:00:30.000Z",
  };
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/history"]}>
        <Routes>
          <Route path="/history" element={<HistoryListPage />} />
          <Route path="/history/:runId" element={<div>detail</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("HistoryListPage", () => {
  it("renders a row with kind / tool / status / p95", async () => {
    renderPage();
    expect(await screen.findByText("benchmark")).toBeInTheDocument();
    expect(screen.getByText("guidellm")).toBeInTheDocument();
    expect(screen.getByText("completed")).toBeInTheDocument();
    expect(screen.getByText("123.4")).toBeInTheDocument();
  });

  it("compare button is disabled by default", async () => {
    renderPage();
    await screen.findByText("benchmark"); // wait for load
    const compare = screen.getByRole("button", { name: /compare/i });
    expect(compare).toBeDisabled();
  });

  it("selecting two rows keeps compare button disabled (placeholder)", async () => {
    // Override mock to return two rows.
    const { api } = await import("@/lib/api-client");
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      items: [
        makeRun("r1", "benchmark", "guidellm", "completed"),
        makeRun("r2", "benchmark", "vegeta", "completed"),
      ],
      nextCursor: null,
    });
    renderPage();
    await screen.findByText("guidellm");
    const checkboxes = screen.getAllByRole("checkbox");
    const user = userEvent.setup();
    await user.click(checkboxes[0]);
    await user.click(checkboxes[1]);
    const compare = screen.getByRole("button", { name: /compare/i });
    // Disabled by spec: this is the placeholder for #46.
    expect(compare).toBeDisabled();
  });

  it("renders empty state when there are no runs", async () => {
    const { api } = await import("@/lib/api-client");
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      items: [],
      nextCursor: null,
    });
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/No runs yet|暂无 Run/i)).toBeInTheDocument(),
    );
  });
});
```

- [ ] **Step 3: Run web tests**

```bash
pnpm -F @modeldoctor/web test HistoryListPage
```

Expected: 4 tests pass. If a test fails because the i18n bundle isn't loaded, ensure `apps/web/src/lib/i18n.ts` is imported via `apps/web/src/test/setup.ts` (or whatever the existing setup file is). Read `apps/web/vitest.config.ts` to confirm the setup file path; if `i18n` isn't loaded there, add `import "@/lib/i18n";` to the setup file.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/history/__tests__/HistoryListPage.test.tsx
git commit -m "$(cat <<'EOF'
test(web/history): cover list rendering, compare-disabled, empty state

Mocks @/lib/api-client; verifies row content, compare button stays
disabled in 0/1/2 selected modes (placeholder for #46), and the
empty-state branch.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: HistoryDetailPage — Metadata + Metrics + RawOutput + Logs Components

**Files:**
- Create: `apps/web/src/features/history/HistoryDetailMetadata.tsx`
- Create: `apps/web/src/features/history/HistoryDetailMetrics.tsx`
- Create: `apps/web/src/features/history/HistoryDetailRawOutput.tsx`
- Modify: `apps/web/src/features/history/HistoryDetailPage.tsx`

- [ ] **Step 1: Create `HistoryDetailMetadata.tsx`**

```tsx
import type { Run } from "@modeldoctor/contracts";
import { format, formatDistanceStrict } from "date-fns";
import { useTranslation } from "react-i18next";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return format(new Date(iso), "yyyy-MM-dd HH:mm:ss");
}

function fmtDuration(start: string | null, end: string | null): string {
  if (!start || !end) return "—";
  return formatDistanceStrict(new Date(end), new Date(start));
}

export function HistoryDetailMetadata({ run }: { run: Run }) {
  const { t } = useTranslation("history");
  return (
    <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
      <Row label={t("detail.metadata.kind")}>{run.kind}</Row>
      <Row label={t("detail.metadata.tool")}>{run.tool}</Row>
      <Row label={t("detail.metadata.mode")}>{run.mode}</Row>
      <Row label={t("detail.metadata.driverKind")}>{run.driverKind}</Row>
      <Row label={t("detail.metadata.status")}>{run.status}</Row>
      <Row label={t("detail.metadata.connection")}>
        {run.connectionId ?? t("detail.metadata.connectionMissing")}
      </Row>
      <Row label={t("detail.metadata.createdAt")}>{fmtDate(run.createdAt)}</Row>
      <Row label={t("detail.metadata.startedAt")}>{fmtDate(run.startedAt)}</Row>
      <Row label={t("detail.metadata.completedAt")}>{fmtDate(run.completedAt)}</Row>
      <Row label={t("detail.metadata.duration")}>
        {fmtDuration(run.startedAt, run.completedAt)}
      </Row>
    </dl>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}
```

- [ ] **Step 2: Create `HistoryDetailMetrics.tsx`**

```tsx
import type { Run } from "@modeldoctor/contracts";
import { useTranslation } from "react-i18next";

export function HistoryDetailMetrics({
  metrics,
}: {
  metrics: Run["summaryMetrics"];
}) {
  const { t } = useTranslation("history");
  if (!metrics || Object.keys(metrics).length === 0) {
    return <p className="text-sm text-muted-foreground">{t("detail.metrics.empty")}</p>;
  }
  const entries = Object.entries(metrics as Record<string, unknown>);
  return (
    <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
      {entries.map(([k, v]) => (
        <div key={k}>
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="font-mono text-xs">{renderValue(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
```

- [ ] **Step 3: Create `HistoryDetailRawOutput.tsx`**

```tsx
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export function HistoryDetailRawOutput({
  rawOutput,
  logs,
}: {
  rawOutput: Record<string, unknown> | null;
  logs: string | null;
}) {
  const { t } = useTranslation("history");
  const [showRaw, setShowRaw] = useState(false);
  const [showLogs, setShowLogs] = useState(false);

  return (
    <div className="space-y-3">
      {rawOutput && Object.keys(rawOutput).length > 0 && (
        <div>
          <Button variant="ghost" size="sm" onClick={() => setShowRaw((s) => !s)}>
            {showRaw ? "▼" : "▶"} {t("detail.rawOutput.toggle")}
          </Button>
          {showRaw && (
            <pre className="mt-2 max-h-[400px] overflow-auto rounded-md border border-border bg-muted/30 p-3 text-xs">
              {JSON.stringify(rawOutput, null, 2)}
            </pre>
          )}
        </div>
      )}
      {logs && (
        <div>
          <Button variant="ghost" size="sm" onClick={() => setShowLogs((s) => !s)}>
            {showLogs ? "▼" : "▶"} {t("detail.logs.toggle")}
          </Button>
          {showLogs && (
            <pre className="mt-2 max-h-[400px] overflow-auto rounded-md border border-border bg-muted/30 p-3 text-xs">
              {logs}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Replace `HistoryDetailPage.tsx`**

```tsx
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { ArrowLeft, SearchX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { HistoryDetailMetadata } from "./HistoryDetailMetadata";
import { HistoryDetailMetrics } from "./HistoryDetailMetrics";
import { HistoryDetailRawOutput } from "./HistoryDetailRawOutput";
import { useRunDetail } from "./queries";

export function HistoryDetailPage() {
  const { t } = useTranslation("history");
  const { runId } = useParams<{ runId: string }>();
  const { data: run, isLoading, isError, error } = useRunDetail(runId ?? "");

  if (isLoading) {
    return (
      <>
        <PageHeader title="…" />
        <div
          role="status"
          aria-label="loading"
          className="m-8 h-64 animate-pulse rounded-md border border-border bg-muted/30"
        />
      </>
    );
  }

  if (isError) {
    const status = (error as { status?: number } | null)?.status;
    if (status === 404) {
      return (
        <>
          <PageHeader title={runId ?? "—"} />
          <EmptyState
            icon={SearchX}
            title={t("detail.notFound.title")}
            body={t("detail.notFound.body")}
          />
        </>
      );
    }
    return (
      <>
        <PageHeader title={runId ?? "—"} />
        <Alert variant="destructive" className="mx-8 mt-6">
          <AlertDescription>
            {(error as Error)?.message ?? t("detail.loadError")}
          </AlertDescription>
        </Alert>
      </>
    );
  }

  if (!run) return null;

  const subtitle = t("detail.subtitle", {
    kind: run.kind,
    tool: run.tool,
    when: format(new Date(run.createdAt), "yyyy-MM-dd HH:mm"),
  });

  return (
    <>
      <PageHeader
        title={run.name ?? run.id}
        subtitle={subtitle}
        rightSlot={
          <Button asChild variant="ghost" size="sm">
            <Link to="/history">
              <ArrowLeft className="mr-1 h-4 w-4" />
              {t("detail.back")}
            </Link>
          </Button>
        }
      />
      <div className="space-y-8 px-8 py-6">
        <section>
          <HistoryDetailMetadata run={run} />
        </section>
        <section>
          <h3 className="mb-3 text-sm font-semibold">{t("detail.metrics.title")}</h3>
          <HistoryDetailMetrics metrics={run.summaryMetrics} />
        </section>
        <section>
          <HistoryDetailRawOutput
            rawOutput={run.rawOutput as Record<string, unknown> | null}
            logs={run.logs}
          />
        </section>
      </div>
    </>
  );
}
```

- [ ] **Step 5: Type-check**

```bash
pnpm -F @modeldoctor/web type-check
```

Expected: green.

- [ ] **Step 6: Manual smoke**

Restart dev servers, click a row in `/history`, observe:
- Metadata block renders all 10 fields
- Metrics block renders the JSON keys verbatim (vegeta latencies / guidellm tokens)
- Raw output toggle expands, shows pretty JSON
- Logs toggle (only if a run has logs)
- Back button returns to `/history`

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/history/
git commit -m "$(cat <<'EOF'
feat(web/history): kind-aware detail page (metadata + metrics + raw output + logs)

Read-only thin shell. Metadata renders the unified Run fields
(kind/tool/mode/driverKind/status/connection/timestamps/duration).
Metrics flattens summaryMetrics top-level keys; rawOutput + logs
are collapsible with code blocks. 404 maps to EmptyState; other
errors land in an Alert. No mutation actions — cancel/delete still
live on /benchmarks/:id.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: HistoryDetailPage Tests

**Files:**
- Create: `apps/web/src/features/history/__tests__/HistoryDetailPage.test.tsx`

- [ ] **Step 1: Create the test file**

```tsx
import type { Run } from "@modeldoctor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HistoryDetailPage } from "../HistoryDetailPage";

vi.mock("@/lib/api-client", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    del: vi.fn(),
  },
}));

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "r1",
    userId: "u1",
    connectionId: "c1",
    kind: "benchmark",
    tool: "guidellm",
    scenario: { model: "qwen2.5" },
    mode: "fixed",
    driverKind: "local",
    name: "smoke",
    description: null,
    status: "completed",
    statusMessage: null,
    progress: null,
    driverHandle: null,
    params: { profile: "throughput" },
    canonicalReport: null,
    rawOutput: { stdout: "ok" },
    summaryMetrics: { latencies: { p95: 100 }, errorRate: 0.0 },
    serverMetrics: null,
    templateId: null,
    templateVersion: null,
    parentRunId: null,
    baselineId: null,
    logs: "log line 1\nlog line 2",
    createdAt: "2026-04-30T12:00:00.000Z",
    startedAt: "2026-04-30T12:00:01.000Z",
    completedAt: "2026-04-30T12:00:30.000Z",
    ...overrides,
  };
}

function renderPage(initial = "/history/r1") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/history" element={<div>list</div>} />
          <Route path="/history/:runId" element={<HistoryDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("HistoryDetailPage", () => {
  it("renders metadata, metrics, raw output toggle", async () => {
    const { api } = await import("@/lib/api-client");
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(makeRun());
    renderPage();
    expect(await screen.findByText("smoke")).toBeInTheDocument();
    expect(screen.getByText("benchmark")).toBeInTheDocument();
    expect(screen.getByText("guidellm")).toBeInTheDocument();
    expect(screen.getByText(/Raw output|原始输出/i)).toBeInTheDocument();
    expect(screen.getByText(/Logs|日志/i)).toBeInTheDocument();
  });

  it("renders metrics empty when summaryMetrics is null", async () => {
    const { api } = await import("@/lib/api-client");
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeRun({ summaryMetrics: null }),
    );
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/No metrics|没有记录指标/i)).toBeInTheDocument(),
    );
  });

  it("shows not-found state on 404", async () => {
    const { api } = await import("@/lib/api-client");
    const err = new Error("not found") as Error & { status: number };
    err.status = 404;
    (api.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(err);
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/Run not found|Run 不存在/i)).toBeInTheDocument(),
    );
  });
});
```

- [ ] **Step 2: Run tests**

```bash
pnpm -F @modeldoctor/web test HistoryDetailPage
```

Expected: 3 tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/history/__tests__/HistoryDetailPage.test.tsx
git commit -m "$(cat <<'EOF'
test(web/history): cover detail page render, empty metrics, 404

Mocks @/lib/api-client; tests metadata + raw-output/logs toggles
render, that empty summaryMetrics shows the empty copy, and that
a 404 from /api/runs/:id surfaces the EmptyState.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Full Verification (Type Check + All Tests + Manual E2E)

**Files:**
- None (verification only)

- [ ] **Step 1: Run all type-checks**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat-history
pnpm -r type-check
```

Expected: green across api, web, contracts.

- [ ] **Step 2: Run api unit + e2e tests**

```bash
pnpm -F @modeldoctor/api test --no-file-parallelism
pnpm -F @modeldoctor/api test:e2e
```

Expected: 100% green. The new schema additions should not regress any existing connection or run e2e specs (the new columns default to NULL).

- [ ] **Step 3: Run web tests**

```bash
pnpm -F @modeldoctor/web test
```

Expected: 100% green including the two new history test files.

- [ ] **Step 4: Manual E2E in browser**

Start both dev servers and walk the spec §7.2 path:

```bash
docker compose up -d postgres   # if not already up
pnpm -F @modeldoctor/api dev &
pnpm -F @modeldoctor/web dev &
sleep 6
open http://localhost:5173
```

Walk:

1. Login (use existing test user or register one)
2. Go to `/load-test`, run a vegeta load test → completes
3. Go to `/benchmarks`, create a guidellm run → completes (small fixed profile)
4. Go to `/e2e`, run a probe → completes
5. Go to `/history`:
   - All three runs visible (3 rows, mixed kind/tool)
   - Click filter `kind = benchmark` → 2 rows (guidellm + vegeta both have kind=benchmark)
   - Click filter `tool = vegeta` → 1 row
   - Set `createdAfter` to 5 minutes ago → still 3
   - Search by run name → narrows
   - Select 2 rows → compare button enabled-ish but disabled w/ tooltip
6. Click "→" on a row → detail page opens, all sections render
7. Direct-load `/history/nope` → not-found EmptyState
8. Open in private window with second user → /history shows zero rows of the first user's runs (cross-user isolation)

Kill dev servers:

```bash
pkill -f 'pnpm.*dev'
```

- [ ] **Step 5: No commit (verification step)**

If all checks pass, proceed to Task 14. If anything fails, file a fix on this branch in a new commit before continuing.

---

## Task 14: Sidebar Verification + i18n Completeness Check

**Files:**
- Inspect: `apps/web/src/locales/{en-US,zh-CN}/sidebar.json`
- Inspect: `apps/web/src/layouts/AppShell.tsx` or wherever the sidebar lives

- [ ] **Step 1: Confirm sidebar `items.history` translation key exists**

```bash
grep -n "history" apps/web/src/locales/en-US/sidebar.json
grep -n "history" apps/web/src/locales/zh-CN/sidebar.json
```

Expected: both files already contain a `history` entry under `items` (the placeholder route was using it). No edit needed. If missing in either, add it: `"history": "History"` / `"history": "历史"`.

- [ ] **Step 2: Confirm the sidebar entry is wired and clickable**

Find the sidebar component:

```bash
grep -rn "items.history" apps/web/src/
```

Expected: a sidebar nav config (likely in `apps/web/src/layouts/`) that links to `/history`. No edit needed — replacing the route element in Task 7 means clicking that sidebar entry now lands on `HistoryListPage`.

If the sidebar entry was hidden or commented out (occasionally happens for ComingSoon routes), un-hide it.

- [ ] **Step 3: Manual click-through**

While dev servers are running, click "History" in the sidebar → should land on `/history` and render the list page (not ComingSoon).

- [ ] **Step 4: No commit unless an i18n key was added**

If you had to add a missing key:

```bash
git add apps/web/src/locales/
git commit -m "$(cat <<'EOF'
chore(web/i18n/sidebar): backfill missing history label
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Push, Open PR, Edit Issue #38 Description, Close Issues

**Files:**
- None (PR + GitHub housekeeping only)

- [ ] **Step 1: Push the branch**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat-history
git push -u origin feat/history-page
```

Expected: branch pushed to origin.

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "feat: close #38 (Connection prom fields) + light up #39 /history" --body "$(cat <<'EOF'
## Summary

Closes #38 by:
- Adding `Connection.prometheusUrl` + `Connection.serverKind` (nullable) for #60 Prometheus integration
- Extending `listRunsQuerySchema` with `createdAfter` / `createdBefore`
- Deferring `POST /runs` to #54 (waits on Tool Adapter from #53)

Closes #39 by lighting up `/history` and `/history/:runId` from `ComingSoonRoute` placeholders into a real list + kind-aware thin detail shell that consumes the existing `GET /api/runs` and `GET /api/runs/:id`.

## What's in scope

- 1 prisma migration: `connection_prometheus_fields` (adds 2 nullable TEXT columns)
- Contract: `connection.ts` (public + create + update + new `serverKindSchema`), `run.ts` (`listRunsQuerySchema` time range)
- API: `ConnectionService.create / update / toContractPublic` passthrough; `RunRepository.list` time range filter
- Web: new `apps/web/src/features/history/` (list page, detail page, 4 sub-components, queries, api), 2 new i18n bundles, router replaces 2 ComingSoonRoute entries
- Tests: 4 new unit tests in api, 7 new tests in web

## What's deferred

- `POST /runs` → #54 (with Tool Adapter from #53)
- Connection UI exposure of `prometheusUrl` / `serverKind` → #60
- `/history` baseline filter → #43 (Baseline epic)
- `/history` connection-name select filter (currently `connectionId` only via URL) → small follow-up

## Test plan

- [x] `pnpm -F @modeldoctor/api test --no-file-parallelism` — green
- [x] `pnpm -F @modeldoctor/api test:e2e` — green
- [x] `pnpm -F @modeldoctor/web test` — green
- [x] `pnpm -r type-check` — green
- [x] Manual E2E walked in browser: 3 kinds of runs → /history lists all → filters work → detail renders

## Migration notes

This branch was developed in `/Users/fangyong/vllm/modeldoctor/feat-history` against its own Postgres DB (`modeldoctor_history`). The migration adds 2 nullable columns to `connections`, so applying to a populated DB is safe (no backfill needed).

Closes #38, Closes #39

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Wait for CI green, then edit issue #38 description**

```bash
gh pr checks
```

Once green:

```bash
gh issue edit 38 --body "$(cat <<'EOF'
## 背景

当前架构有三个互相重叠的"测试 endpoint"功能：

| 功能 | 引擎 | 数据落点 |
|------|------|----------|
| `/load-test` | Vegeta | 临时 |
| `/benchmarks` | guidellm | Postgres |
| `/e2e` | 内置 | 临时 |

**新认识：** 它们不是"三种产品"，是**同一 benchmark 工作流的不同 tool 选择**：

- Vegeta = 通用 HTTP fuzzer tool
- guidellm = LLM-aware tool
- E2E = 性质不同（correctness 而非 perf）—— 暂时仍作为独立 `kind`

## 目标（架构关键石）

设计并落地**统一 Run 模型**作为 benchmark 的核心实体。

- [x] Prisma schema：Run 表（kind + tool / scenario / mode / driverKind 四元组，含 `summaryMetrics` / `serverMetrics` / `canonicalReport` / `rawOutput` / `parentRunId` / `baselineId`） — PR #61
- [x] `Connection` 加字段：`prometheusUrl?` / `serverKind?`（为 #60 预留） — PR #<this-pr>
- [x] **五层概念**明确分工（Connection / Template / Plan / Run / Baseline） — 文档化于 #52 路线图
- [x] 现有 `/load-test` / `/benchmarks` / `/e2e` 后端写到统一表 — PR #61

## 推迟事项

- `POST /runs`（按 tool 路由到 adapter + driver） → 移到 **#54** 与 Tool Adapter（**#53**）一起做。提前实现是过渡代码，#53 落地后必然返工。

## 实施轨迹

- PR #61 — Run 模型主体
- PR #<this-pr> — Connection 字段补全 + #39 /history
- #54 — `POST /runs`（依赖 #53）

## 关联

- 阻塞：#53、#54、#59、#43–#46、#39
- Phase：A-foundations
EOF
)"
```

Replace `<this-pr>` with the actual PR number after `gh pr create` returns it.

- [ ] **Step 4: Verify automatic close behavior**

After PR merges, both `#38` and `#39` should auto-close because of the `Closes #38, Closes #39` lines in the PR body. If they don't (rare GitHub quirk):

```bash
gh issue close 38
gh issue close 39
```

- [ ] **Step 5: Cross-post pointers in #54 and #60**

```bash
gh issue comment 54 --body "Schema-side dependencies for POST /runs are in place (Run table from #61, listRunsQuerySchema from PR #<this-pr>). Pick this up after #53 Tool Adapter lands."
gh issue comment 60 --body "Connection fields prometheusUrl / serverKind are now in the schema + contract + ConnectionService passthrough (PR #<this-pr>). UI exposure + Prometheus query layer are scoped here."
```

---

## Self-Review

After writing this plan, I checked it against the spec sections (`docs/superpowers/specs/2026-05-01-issue-38-closure-and-history-design.md`):

- §3 改动范围 (7 file targets): All 7 covered — schema (Task 1), Connection contract (Task 2), Run contract (Task 4), ConnectionService (Task 3), RunRepository (Task 4), web feature folder (Tasks 5–12), router (Task 7).
- §4 Schema: Task 1 (prisma) + Task 2 (Connection Zod) + Task 4 (run Zod) cover §4.1–§4.3.
- §5 UI: Tasks 6–12 cover routes (§5.1), file structure (§5.2), list (§5.3), detail (§5.4), i18n (§5.5).
- §6 Issue #38 description rewrite: Task 15 step 3.
- §7 Testing: Task 13 (auto + manual) + Tasks 10/12 (component tests) + Tasks 3/4 (service-level tests).
- §9 收尾动作: Task 15 covers PR, issue edit, close, cross-post.

Type / signature consistency check:
- `historyApi` / `historyKeys` defined in Task 5 → consumed in Tasks 8 / 11 with same names.
- `useRunsList` / `useRunDetail` signatures match across Tasks 5, 8, 11.
- `serverKindSchema` exported from contracts in Task 2 → not directly consumed by any later task (it's only used via `ConnectionPublic.serverKind`); consistent.
- `HistoryFiltersProps.onChange` accepts `Partial<ListRunsQuery>` (Task 9) ↔ `patchQuery` in HistoryListPage produces `Partial<ListRunsQuery>` (Task 9) — match.

No placeholders. No "implement later". All code blocks contain runnable code (modulo i18n strings being JSON, not code).
