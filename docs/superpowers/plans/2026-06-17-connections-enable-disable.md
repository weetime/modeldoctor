# Connections enable/disable + on-demand health test — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `enabled` (archive) state to connections — list + every endpoint picker default to enabled-only, with a status filter and "…"-menu Enable/Disable — plus an on-demand "Test connection" action that probes `/v1/models`.

**Architecture:** Additive `enabled` column on `Connection` (default true). `GET /api/connections?status=enabled|disabled|all` defaults to `enabled` so the 6 `ConnectionPicker` consumers exclude disabled connections with no code change; history filters opt into `all`. Enable/disable reuses `PATCH :id { enabled }`. Health is `POST :id/health` reusing `getOwnedDecrypted` + `safeFetch` + `parseCustomHeaders`.

**Tech Stack:** NestJS + Prisma (apps/api), React + TanStack Query + shadcn (apps/web), zod contracts (packages/contracts), Vitest.

Spec: `docs/superpowers/specs/2026-06-17-connections-enable-disable-health-design.md`. Branch `feat/connections-enable-disable` already exists with the spec committed.

---

## Task 1: Contract — enabled field, status filter, health response

**Files:**
- Modify: `packages/contracts/src/connection.ts`
- Test: `packages/contracts/src/connection.spec.ts` (create if absent — check first with `ls packages/contracts/src/connection.spec.ts`)

- [ ] **Step 1: Add the new schemas/fields**

In `packages/contracts/src/connection.ts`, add `enabled` to `connectionPublicSchema` (after `tags`):

```typescript
  tags: z.array(z.string()),
  enabled: z.boolean(),
```

After `updateConnectionSchema`, change it to carry `enabled`:

```typescript
// PATCH semantics: every field is optional, but if the client sends apiKey /
// model / category, the same shape rules apply (non-empty, trimmed apiKey, etc.).
// `enabled` is update-only (a connection is always created enabled).
export const updateConnectionSchema = createConnectionSchema.partial().extend({
  enabled: z.boolean().optional(),
});
export type UpdateConnection = z.infer<typeof updateConnectionSchema>;
```

After `listConnectionsResponseSchema`, add the status filter + health response:

```typescript
export const connectionStatusFilterSchema = z.enum(["enabled", "disabled", "all"]);
export type ConnectionStatusFilter = z.infer<typeof connectionStatusFilterSchema>;

export const connectionHealthResponseSchema = z.object({
  status: z.enum(["online", "offline"]),
  latencyMs: z.number().int().nonnegative().optional(),
  modelCount: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
});
export type ConnectionHealthResponse = z.infer<typeof connectionHealthResponseSchema>;
```

- [ ] **Step 2: Add a test for the new schemas**

Append to `packages/contracts/src/connection.spec.ts` (create with the imports if the file does not exist):

```typescript
import { describe, expect, it } from "vitest";
import {
  connectionHealthResponseSchema,
  connectionStatusFilterSchema,
  updateConnectionSchema,
} from "./connection.js";

describe("connection enable/disable contract", () => {
  it("updateConnectionSchema accepts enabled", () => {
    expect(updateConnectionSchema.parse({ enabled: false })).toEqual({ enabled: false });
  });
  it("status filter rejects unknown values", () => {
    expect(connectionStatusFilterSchema.safeParse("bogus").success).toBe(false);
    expect(connectionStatusFilterSchema.parse("all")).toBe("all");
  });
  it("health response validates online + latency", () => {
    expect(
      connectionHealthResponseSchema.parse({ status: "online", latencyMs: 12, modelCount: 3 }),
    ).toMatchObject({ status: "online" });
  });
});
```

- [ ] **Step 3: Build contracts + run the test**

Run: `pnpm -F @modeldoctor/contracts build && pnpm -F @modeldoctor/contracts test connection.spec`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/src/connection.ts packages/contracts/src/connection.spec.ts
git commit -m "feat(contracts): connection enabled field + status filter + health response"
```

---

## Task 2: Prisma schema + migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (model `Connection`, ~line 84)
- Create: `apps/api/prisma/migrations/<ts>_connection_enabled/migration.sql` (generated)

- [ ] **Step 1: Add the column**

In `model Connection`, after the `tags` line, add:

```prisma
  tags          String[] @default([])

  // Archive flag. Disabled connections are hidden from the list (by default)
  // and from every endpoint picker, but their history + referencing evaluation
  // runs stay intact. Lets users get rid of connections they can't delete.
  enabled       Boolean  @default(true)
```

- [ ] **Step 2: Generate the migration (create-only) and review it**

Run: `cd apps/api && pnpm prisma migrate dev --create-only --name connection_enabled`
Then: `cat apps/api/prisma/migrations/*_connection_enabled/migration.sql`
Expected SQL (additive column with default — no backfill, no table rewrite risk):

```sql
ALTER TABLE "connections" ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true;
```

- [ ] **Step 3: Apply the migration**

Run: `cd apps/api && pnpm prisma migrate dev`
Expected: "Your database is now in sync", Prisma Client regenerated.

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(db): add Connection.enabled column (default true)"
```

---

## Task 3: Backend — list status filter, update enabled, toContractPublic

**Files:**
- Modify: `apps/api/src/modules/connection/connection.service.ts` (`list` ~118, `toContractPublic` ~315, `update` field-mapping ~170)
- Modify: `apps/api/src/modules/connection/connection.controller.ts` (`list` ~45)
- Test: `apps/api/src/modules/connection/connection.service.spec.ts`

- [ ] **Step 1: Write failing service tests for status filtering + enabled mapping**

In `connection.service.spec.ts`, inside the top-level `describe("ConnectionService")`, add a new block (the `prismaMock.connection.findMany`/`update`/`findUnique` mocks already exist):

```typescript
  describe("list status filter", () => {
    it("defaults to enabled-only", async () => {
      prismaMock.connection.findMany.mockResolvedValue([]);
      await service.list("u_1");
      expect(prismaMock.connection.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: "u_1", enabled: true } }),
      );
    });
    it("disabled-only sets enabled:false", async () => {
      prismaMock.connection.findMany.mockResolvedValue([]);
      await service.list("u_1", "disabled");
      expect(prismaMock.connection.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: "u_1", enabled: false } }),
      );
    });
    it("all omits the enabled clause", async () => {
      prismaMock.connection.findMany.mockResolvedValue([]);
      await service.list("u_1", "all");
      expect(prismaMock.connection.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: "u_1" } }),
      );
    });
  });

  describe("update enabled", () => {
    it("maps enabled into the prisma update data", async () => {
      prismaMock.connection.findUnique.mockResolvedValue(makeRow());
      prismaMock.connection.update.mockResolvedValue(makeRow({ enabled: false }));
      await service.update("u_1", "c_1", { enabled: false });
      expect(prismaMock.connection.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ enabled: false }) }),
      );
    });
  });
```

Note: `makeRow` must include `enabled`. Add `enabled: true,` to the `makeRow` defaults object (alongside `tags: [],`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -F @modeldoctor/api test connection.service.spec`
Expected: FAIL — `list` ignores the 2nd arg; `enabled` not in update data; `makeRow` type error until enabled added.

- [ ] **Step 3: Implement list filter**

Replace `list` in `connection.service.ts`:

```typescript
  async list(
    userId: string,
    status: ConnectionStatusFilter = "enabled",
  ): Promise<ListConnectionsResponse> {
    const where: Prisma.ConnectionWhereInput = { userId };
    if (status === "enabled") where.enabled = true;
    else if (status === "disabled") where.enabled = false;
    const rows = await this.prisma.connection.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: CONNECTION_INCLUDES,
    });
    return { items: rows.map((r) => this.toContractPublic(r)) };
  }
```

Add `ConnectionStatusFilter` to the type imports from `@modeldoctor/contracts` at the top of the file. `Prisma` is already imported.

- [ ] **Step 4: Implement enabled in update + toContractPublic**

In `update`, after the `data.tags` line, add:

```typescript
    if (input.enabled !== undefined) data.enabled = input.enabled;
```

In `toContractPublic`, after `tags: row.tags,`, add:

```typescript
      enabled: row.enabled,
```

- [ ] **Step 5: Wire the controller query param**

In `connection.controller.ts`, add to the contracts import: `type ConnectionStatusFilter,` and `connectionStatusFilterSchema,`. Add `Query` to the `@nestjs/common` import. Replace `list`:

```typescript
  @ApiOperation({ summary: "List connections (model endpoints + gateways) owned by the user" })
  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query("status", new ZodValidationPipe(connectionStatusFilterSchema.optional()))
    status: ConnectionStatusFilter | undefined,
  ): Promise<ListConnectionsResponse> {
    return this.service.list(user.sub, status ?? "enabled");
  }
```

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm -F @modeldoctor/api test connection.service.spec && pnpm -F @modeldoctor/api type-check`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/connection/connection.service.ts apps/api/src/modules/connection/connection.controller.ts apps/api/src/modules/connection/connection.service.spec.ts
git commit -m "feat(connections): list status filter + enabled update mapping"
```

---

## Task 4: Backend — health test endpoint

**Files:**
- Modify: `apps/api/src/modules/connection/connection.service.ts` (new `testHealth` method)
- Modify: `apps/api/src/modules/connection/connection.controller.ts` (new `POST :id/health`)
- Test: `apps/api/src/modules/connection/connection.service.spec.ts`

- [ ] **Step 1: Write a failing test for testHealth**

`testHealth` issues a `safeFetch` to `{baseUrl}/v1/models`. Mock `safeFetch` at the top of the spec file (add near the other imports, before `describe`):

```typescript
import { vi } from "vitest";
vi.mock("./discovery/safe-fetch.js", () => ({
  safeFetch: vi.fn(),
}));
import { safeFetch } from "./discovery/safe-fetch.js";
```

(If `vi` is already imported, don't re-import it.) Then add:

```typescript
  describe("testHealth", () => {
    it("returns online with modelCount on a 200 /v1/models", async () => {
      prismaMock.connection.findUnique.mockResolvedValue(makeRow());
      vi.mocked(safeFetch).mockResolvedValue(
        new Response(JSON.stringify({ data: [{ id: "m1" }, { id: "m2" }] }), { status: 200 }),
      );
      const r = await service.testHealth("u_1", "c_1");
      expect(r.status).toBe("online");
      expect(r.modelCount).toBe(2);
    });
    it("returns offline on a non-2xx", async () => {
      prismaMock.connection.findUnique.mockResolvedValue(makeRow());
      vi.mocked(safeFetch).mockResolvedValue(new Response("", { status: 503 }));
      const r = await service.testHealth("u_1", "c_1");
      expect(r.status).toBe("offline");
      expect(r.error).toContain("503");
    });
    it("returns offline when the fetch throws", async () => {
      prismaMock.connection.findUnique.mockResolvedValue(makeRow());
      vi.mocked(safeFetch).mockRejectedValue(new Error("ECONNREFUSED"));
      const r = await service.testHealth("u_1", "c_1");
      expect(r.status).toBe("offline");
    });
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -F @modeldoctor/api test connection.service.spec`
Expected: FAIL — `service.testHealth` is not a function.

- [ ] **Step 3: Implement testHealth**

Add imports at the top of `connection.service.ts`:

```typescript
import type { ConnectionHealthResponse } from "@modeldoctor/contracts";
import { parseCustomHeaders } from "../../common/http/parse-custom-headers.js";
import { safeFetch } from "./discovery/safe-fetch.js";
```

Add the method (place it right after `delete`):

```typescript
  /**
   * On-demand health probe. Hits the connection's `/v1/models` with its
   * decrypted apiKey + custom headers (every OpenAI-compatible endpoint
   * exposes it, so a 200 means the inference path is actually reachable).
   * Never throws on a dead endpoint — returns `offline` with the reason.
   */
  async testHealth(userId: string, id: string): Promise<ConnectionHealthResponse> {
    const conn = await this.getOwnedDecrypted(userId, id);
    const start = Date.now();
    try {
      const res = await safeFetch(`${conn.baseUrl.replace(/\/+$/, "")}/v1/models`, {
        apiKey: conn.apiKey || undefined,
        extraHeaders: parseCustomHeaders(conn.customHeaders),
      });
      const latencyMs = Date.now() - start;
      if (!res.ok) {
        return { status: "offline", latencyMs, error: `HTTP ${res.status}` };
      }
      let modelCount: number | undefined;
      try {
        const json = (await res.json()) as { data?: unknown };
        if (Array.isArray(json?.data)) modelCount = json.data.length;
      } catch {
        // 200 but unparseable body still counts as reachable.
      }
      return { status: "online", latencyMs, modelCount };
    } catch (err) {
      return {
        status: "offline",
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : "unknown error",
      };
    }
  }
```

- [ ] **Step 4: Add the controller route**

In `connection.controller.ts`, add to the contracts import: `type ConnectionHealthResponse,`. Add the route (place after the `delete` route):

```typescript
  @ApiOperation({ summary: "On-demand health probe of a connection's /v1/models" })
  @Post(":id/health")
  @HttpCode(HttpStatus.OK)
  testHealth(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
  ): Promise<ConnectionHealthResponse> {
    return this.service.testHealth(user.sub, id);
  }
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm -F @modeldoctor/api test connection.service.spec && pnpm -F @modeldoctor/api type-check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/connection/connection.service.ts apps/api/src/modules/connection/connection.controller.ts apps/api/src/modules/connection/connection.service.spec.ts
git commit -m "feat(connections): on-demand health test endpoint (POST :id/health)"
```

---

## Task 5: Frontend queries — status param + enabled toggle + health

**Files:**
- Modify: `apps/web/src/features/connections/queries.ts`
- Test: `apps/web/src/features/connections/queries.test.tsx` (extend existing)

- [ ] **Step 1: Update useConnections + add mutations**

Replace `useConnections` and add two hooks in `queries.ts`. Add to the contracts type import at the top: `ConnectionHealthResponse, ConnectionStatusFilter`.

```typescript
export function useConnections(params?: { status?: ConnectionStatusFilter }) {
  const status = params?.status ?? "enabled";
  return useQuery({
    queryKey: [...KEY, { status }] as const,
    queryFn: () =>
      api.get<ListConnectionsResponse>(`/api/connections?status=${status}`),
    select: (r) => r.items,
  });
}

export function useSetConnectionEnabled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch<ConnectionPublic>(`/api/connections/${id}`, { enabled }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: detailKey(vars.id) });
    },
  });
}

export function useTestConnection() {
  return useMutation({
    mutationFn: (id: string) =>
      api.post<ConnectionHealthResponse>(`/api/connections/${id}/health`, {}),
  });
}
```

Note: `qc.invalidateQueries({ queryKey: KEY })` prefix-matches all `[...KEY, {status}]` variants, so every filter view refreshes after a toggle.

- [ ] **Step 2: Add a test**

In `queries.test.tsx`, add (follow the existing render/wrapper pattern in that file):

```typescript
  it("useConnections defaults to status=enabled in the URL", async () => {
    const get = vi.fn().mockResolvedValue({ items: [] });
    // (Match however the existing tests stub `api`; assert the URL.)
    // Expectation: get called with "/api/connections?status=enabled"
  });
```

If the existing test file already stubs `api.get`, assert `expect(api.get).toHaveBeenCalledWith("/api/connections?status=enabled")` after rendering `useConnections()`; and `?status=all` for `useConnections({ status: "all" })`.

- [ ] **Step 3: Run + typecheck**

Run: `pnpm -F @modeldoctor/web test queries.test && pnpm -F @modeldoctor/web type-check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/connections/queries.ts apps/web/src/features/connections/queries.test.tsx
git commit -m "feat(web): useConnections status param + enable/disable + test-connection hooks"
```

---

## Task 6: Frontend — ConnectionsPage status filter + row actions

**Files:**
- Modify: `apps/web/src/features/connections/ConnectionsPage.tsx`
- Test: `apps/web/src/features/connections/ConnectionsPage.test.tsx`

- [ ] **Step 1: Add status filter state + wire useConnections**

In `ConnectionsPage.tsx`:
- Import `toast` from `"sonner"` (if not already), and the hooks `useSetConnectionEnabled, useTestConnection` from `"./queries"`, plus `Power, PowerOff, Activity` from `"lucide-react"`.
- Import `type ConnectionStatusFilter` from `"@modeldoctor/contracts"`.
- Add state: `const [filterStatus, setFilterStatus] = useState<ConnectionStatusFilter>("enabled");`
- Change the list query to `const listQuery = useConnections({ status: filterStatus });`
- Add mutations: `const setEnabled = useSetConnectionEnabled();` and `const testConn = useTestConnection();`

- [ ] **Step 2: Add the status filter Select**

In the filters row (alongside the category/tags `<Select>`s), add as the first filter:

```tsx
              <Select
                value={filterStatus}
                onValueChange={(v) => setFilterStatus(v as ConnectionStatusFilter)}
              >
                <SelectTrigger className="h-8 w-32 text-xs" aria-label={t("filters.status")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="enabled">{t("filters.statusEnabled")}</SelectItem>
                  <SelectItem value="disabled">{t("filters.statusDisabled")}</SelectItem>
                  <SelectItem value="all">{t("filters.statusAll")}</SelectItem>
                </SelectContent>
              </Select>
```

- [ ] **Step 3: Add menu actions + disabled-row styling**

In the per-row `<DropdownMenuContent align="end">`, add ABOVE the existing Delete item:

```tsx
                              <DropdownMenuItem
                                onClick={() => {
                                  testConn.mutate(c.id, {
                                    onSuccess: (h) =>
                                      h.status === "online"
                                        ? toast.success(
                                            t("test.online", { ms: h.latencyMs ?? 0 }),
                                          )
                                        : toast.error(
                                            t("test.offline", { reason: h.error ?? "" }),
                                          ),
                                  });
                                }}
                              >
                                <Activity className="mr-2 h-4 w-4" />
                                {t("actions.test")}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() =>
                                  setEnabled.mutate(
                                    { id: c.id, enabled: !c.enabled },
                                    {
                                      onSuccess: () =>
                                        toast.success(
                                          c.enabled
                                            ? t("toggle.disabled")
                                            : t("toggle.enabled"),
                                        ),
                                      onError: () => toast.error(t("toggle.error")),
                                    },
                                  )
                                }
                              >
                                {c.enabled ? (
                                  <PowerOff className="mr-2 h-4 w-4" />
                                ) : (
                                  <Power className="mr-2 h-4 w-4" />
                                )}
                                {c.enabled ? t("actions.disable") : t("actions.enable")}
                              </DropdownMenuItem>
```

In the row's name cell, show a Disabled badge when archived — change the name `<button>` wrapper to:

```tsx
                      <TableCell className="font-medium">
                        <button
                          type="button"
                          className="text-left hover:text-primary hover:underline"
                          onClick={() => setDialogMode({ kind: "edit", existing: c })}
                        >
                          {c.name}
                        </button>
                        {!c.enabled && (
                          <Badge variant="outline" className="ml-2 text-xs text-muted-foreground">
                            {t("badges.disabled")}
                          </Badge>
                        )}
                      </TableCell>
```

(`Badge` is already imported.)

- [ ] **Step 4: Add/extend a component test**

In `ConnectionsPage.test.tsx`, the existing mock stubs `useConnections`/`useDeleteConnection`. Extend the `vi.mock("./queries", ...)` to also return `useSetConnectionEnabled: () => ({ mutate: setEnabledMutate, isPending: false })` and `useTestConnection: () => ({ mutate: testMutate, isPending: false })` (declare `const setEnabledMutate = vi.fn();` / `const testMutate = vi.fn();` near the top). Add a test:

```typescript
  it("disable menu action calls setEnabled with enabled:false", async () => {
    render(<ConnectionsPage />, { wrapper });
    await userEvent.click(screen.getAllByLabelText(/actions/i)[0]);
    await userEvent.click(await screen.findByText(/Disable|关闭/));
    expect(setEnabledMutate).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
      expect.anything(),
    );
  });
```

(Ensure a seed connection has `enabled: true`; add `enabled: true` to the seed objects in the existing `seedList`.)

- [ ] **Step 5: Run + typecheck**

Run: `pnpm -F @modeldoctor/web test ConnectionsPage.test && pnpm -F @modeldoctor/web type-check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/connections/ConnectionsPage.tsx apps/web/src/features/connections/ConnectionsPage.test.tsx
git commit -m "feat(web): connections status filter + enable/disable/test row actions"
```

---

## Task 7: History filters opt into status=all + i18n + final checks

**Files:**
- Modify: `apps/web/src/features/benchmarks/BenchmarkListFilters.tsx:47`
- Modify: `apps/web/src/features/quality-gate/components/RunsListFilters.tsx:31`
- Modify: `apps/web/src/locales/en-US/connections.json`, `apps/web/src/locales/zh-CN/connections.json`

- [ ] **Step 1: Opt history filters into all connections**

`BenchmarkListFilters.tsx:47` — change to:

```typescript
  const connections = useConnections({ status: "all" }).data ?? [];
```

`RunsListFilters.tsx:31` — change to:

```typescript
  const { data: connections } = useConnections({ status: "all" });
```

- [ ] **Step 2: Add i18n keys (both locales, keep parity)**

In `en-US/connections.json` add under `actions` (`test`/`enable`/`disable`) and new top-level blocks:

```json
  "actions": {
    "new": "New connection",
    "import": "Import",
    "export": "Export",
    "delete": "Delete",
    "edit": "Edit",
    "test": "Test connection",
    "enable": "Enable",
    "disable": "Disable"
  },
```

```json
  "filters": {
    "label": "Filter",
    "allCategories": "All categories",
    "allTags": "All tags",
    "status": "Status",
    "statusEnabled": "Enabled",
    "statusDisabled": "Disabled",
    "statusAll": "All"
  },
  "badges": { "disabled": "Disabled" },
  "toggle": {
    "enabled": "Connection enabled",
    "disabled": "Connection disabled",
    "error": "Failed to change status"
  },
  "test": {
    "online": "Online ({{ms}} ms)",
    "offline": "Offline — {{reason}}"
  }
```

In `zh-CN/connections.json`, the parallel keys:

```json
  "actions": {
    "new": "新建连接",
    "import": "导入",
    "export": "导出",
    "delete": "删除",
    "edit": "编辑",
    "test": "测试连接",
    "enable": "启用",
    "disable": "关闭"
  },
```

```json
  "filters": {
    "label": "筛选",
    "allCategories": "全部分类",
    "allTags": "全部标签",
    "status": "状态",
    "statusEnabled": "已启用",
    "statusDisabled": "已关闭",
    "statusAll": "全部"
  },
  "badges": { "disabled": "已关闭" },
  "toggle": {
    "enabled": "连接已启用",
    "disabled": "连接已关闭",
    "error": "状态切换失败"
  },
  "test": {
    "online": "在线（{{ms}} ms）",
    "offline": "离线 —— {{reason}}"
  }
```

- [ ] **Step 3: Full verification**

Run:
```bash
pnpm -F @modeldoctor/contracts build
pnpm -F @modeldoctor/api type-check && pnpm -F @modeldoctor/api lint
pnpm -F @modeldoctor/web type-check && pnpm -F @modeldoctor/web lint
pnpm -F @modeldoctor/api test connection
pnpm -F @modeldoctor/web test connections
```
Expected: all PASS; web lint's `check:i18n` confirms zh/en parity.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/benchmarks/BenchmarkListFilters.tsx apps/web/src/features/quality-gate/components/RunsListFilters.tsx apps/web/src/locales/en-US/connections.json apps/web/src/locales/zh-CN/connections.json
git commit -m "feat(web): history filters list all connections + connections i18n"
```

- [ ] **Step 5: Push + open PR**

```bash
git push -u origin feat/connections-enable-disable
gh pr create --base main --title "feat(connections): enable/disable (archive) + on-demand health test" --body "<summary referencing the spec>"
```

---

## Verification checklist (whole feature)

- [ ] Disabling a connection removes it from the list (default Enabled view) and from a benchmark/playground ConnectionPicker.
- [ ] "All"/"Disabled" filter shows it again with a Disabled badge.
- [ ] Enabling restores it everywhere.
- [ ] "Test connection" toasts Online (latency) for a reachable endpoint, Offline (reason) for a dead one.
- [ ] A connection referenced by an evaluation run can now be archived (disabled) instead of hitting the un-deletable wall.
- [ ] Benchmark list connection filter + eval-runs endpoint filter still list disabled connections (history stays filterable).
</content>
