# Issue #54 — Test Plan UI + FE migration to `/api/runs` (implementation plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Single PR that closes out #54: ships the slimmed Test Plan UI form at `/runs/new`, augments the run-detail page with a tool-discriminated `ReportView` switch, renames `/history` → `/runs` (REST-resource alignment), deletes the `/api/benchmarks` and `/api/load-test` facade controllers + their FE consumers, and replaces the inline admin check with a spec'd `?scope=all` admin authz pattern on `/api/runs`.

**Architecture:** Back-end first (admin authz is independent + small + safe). FE second (rename `history` → `runs` then build new components purely additively). Cutover last (delete legacy FE, then BE facades — order matters because BE deletes break the build until FE no longer imports the legacy contracts). Each task = exactly one commit; each task is self-contained so a fresh subagent can execute it from the plan alone.

**Tech stack:** NestJS 10 + Prisma + Postgres + Vitest@2 (BE); React 18 + react-router-dom + react-hook-form + zod + Tailwind/shadcn + Vitest@1 (FE); pnpm workspace; TypeScript strict mode.

**Spec reference:** `docs/superpowers/specs/2026-05-02-issue-54-test-plan-ui-and-runs-migration-design.md` (commit `0c88810`).

**Branch:** `feat/issue-54-test-plan-ui` (cut from `main` @ `198089c`). Worktree at `/Users/fangyong/vllm/modeldoctor/issue-54-test-plan-ui`. Worktree was set up + `pnpm install --frozen-lockfile` + `prisma generate` + `pnpm -r build` already completed.

---

## File structure (end state)

**Backend:**

- Modify: `packages/contracts/src/run.ts` — add `scope: z.enum(["own", "all"]).default("own")` to `listRunsQuerySchema`
- Modify: `apps/api/src/modules/run/run.controller.ts` — inline admin check on 4 endpoints
- Modify: `apps/api/src/modules/run/run.service.ts` — relax `cancel` and `delete` to accept `userId?: string`
- Modify: `apps/api/src/modules/run/run.controller.spec.ts` — extend with 9 admin authz cases
- Modify: `apps/api/src/modules/run/run.service.spec.ts` — 3 new cases (cancel/delete admin elevation; baseline-FK still blocks delete)
- Modify: `apps/api/src/app.module.ts` — remove `BenchmarkModule`, `LoadTestModule`
- Modify: `packages/contracts/src/index.ts` — remove benchmark/load-test exports
- Delete: `apps/api/src/modules/benchmark/` (5 files)
- Delete: `apps/api/src/modules/load-test/` (5 files)
- Delete: `packages/contracts/src/benchmark.ts`, `packages/contracts/src/load-test.ts`

**Frontend (renames via `git mv`):**

- `apps/web/src/features/history/` → `apps/web/src/features/runs/` (whole directory)
- `RunListPage.tsx` ← from `HistoryListPage.tsx`
- `RunListFilters.tsx` ← from `HistoryFilters.tsx`
- `RunDetailPage.tsx` ← from `HistoryDetailPage.tsx`
- `RunDetailMetadata.tsx` ← from `HistoryDetailMetadata.tsx`
- `RunDetailRawOutput.tsx` ← from `HistoryDetailRawOutput.tsx`
- `apps/web/src/locales/en-US/history.json` → `runs.json` (and `zh-CN`)

**Frontend (new files):**

- `apps/web/src/features/runs/RunCreatePage.tsx`
- `apps/web/src/features/runs/components/MetricCard.tsx`
- `apps/web/src/features/runs/forms/GuidellmParamsForm.tsx`
- `apps/web/src/features/runs/forms/VegetaParamsForm.tsx`
- `apps/web/src/features/runs/forms/GenaiPerfParamsForm.tsx`
- `apps/web/src/features/runs/reports/UnknownReportView.tsx`
- `apps/web/src/features/runs/reports/GuidellmReportView.tsx`
- `apps/web/src/features/runs/reports/VegetaReportView.tsx`
- `apps/web/src/features/runs/reports/GenaiPerfReportView.tsx`
- Tests parallel to each new file under `__tests__/`

**Frontend (modify):**

- `apps/web/src/router/index.tsx` — drop `/load-test`, `/benchmarks`, `/benchmarks/:id`, `/history`, `/history/:runId`; add `/runs`, `/runs/new`, `/runs/:id`; change index `<Navigate to="/load-test" />` → `<Navigate to="/runs" />`
- `apps/web/src/components/sidebar/sidebar-config.tsx` — remove `loadTest`, `benchmark` items; rename `history` item to `runs` (path `/runs`, label key `items.runs`)
- `apps/web/src/locales/{en-US,zh-CN}/sidebar.json` — remove `loadTest` + `benchmark` keys, rename `history` → `runs`
- `apps/web/src/lib/i18n.ts` — drop benchmark/load-test imports + namespace registrations; rename `enHistory` → `enRuns` etc.
- `apps/web/package.json` — add `"@modeldoctor/tool-adapters": "workspace:*"` to dependencies
- `apps/web/src/features/runs/queries.ts` (renamed) — rename `historyKeys` → `runKeys`, `useRunsInfiniteList` → `useRunList`; add `useCreateRun`, `useCancelRun`, `useDeleteRun` mutations
- `apps/web/src/features/runs/api.ts` (renamed) — add `runApi.create()`, `runApi.cancel()`, `runApi.delete()` matching RunController endpoints

**Frontend (delete):**

- `apps/web/src/features/benchmark/` (entire directory, 12 files + `__tests__/`)
- `apps/web/src/features/load-test/` (entire directory)
- `apps/web/src/features/runs/HistoryDetailMetrics.tsx` (after rename, becomes `RunDetailMetrics.tsx`, then deleted in Task 9 — replaced by `<ReportSection>` switch in `RunDetailPage`)
- `apps/web/src/features/runs/__tests__/HistoryDetailMetrics.test.tsx` (parallel)
- `apps/web/src/locales/{en-US,zh-CN}/{benchmark,load-test}.json`

**Other:**

- Modify: `CLAUDE.md` — replace `apps/web/src/features/load-test/LoadTestPage.tsx` reference with `apps/web/src/features/runs/RunCreatePage.tsx`

---

## Task ordering rationale

1. Tasks 1-2 (BE admin authz) are completely independent of FE work — safe to land first.
2. Task 3 (rename `history` → `runs`) is a pure mechanical rename; it must precede any new FE work that lives under `features/runs/`.
3. Tasks 4-9 (new FE components: tool-adapters dep + ReportViews + RunDetailPage augment) are purely additive.
4. Tasks 10-13 (Form components + RunCreatePage) are also purely additive; needs Task 3 (rename) done so the new files land in the right directory.
5. Task 14 deletes the legacy FE feature directories. Must happen AFTER all FE consumers of legacy contracts are gone (i.e., after Task 13).
6. Task 15 deletes BE facades + contracts. Must happen AFTER Task 14 (FE no longer imports legacy contracts) — otherwise `pnpm -r build` breaks.
7. Task 16 (CLAUDE.md update + final verification) runs last to lock everything in.

Each task ends with `pnpm -r typecheck` + targeted vitest + a commit. The build stays green at every commit boundary.

---

## Conventions

- **Conventional commits:** `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `build:`, `chore:`. Issue tag `(#54)` in the subject.
- **Commit body:** ends with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- **Stage files explicitly:** `git add <path>` only — never `git add -A` or `git add .`.
- **Test framework:** `apps/api` uses vitest@2; `apps/web` uses vitest@1. Do NOT unify (per `CLAUDE.md`).
- **One-task-one-commit:** if a task fails verification mid-way, fix and stage additional changes into the same commit (or stash + redo) — do NOT split into a follow-up commit.
- **Pre-flight before each task:** `cd /Users/fangyong/vllm/modeldoctor/issue-54-test-plan-ui && git status` should be clean (no uncommitted leftover from prior task).

---

## Task 1: Backend admin authz on `/api/runs`

**Files:**

- Modify: `packages/contracts/src/run.ts`
- Modify: `apps/api/src/modules/run/run.controller.ts`
- Modify: `apps/api/src/modules/run/run.service.ts`
- Modify: `apps/api/src/modules/run/run.controller.spec.ts`

- [ ] **Step 1: Extend `listRunsQuerySchema` with `scope`**

Edit `packages/contracts/src/run.ts`. Find `export const listRunsQuerySchema = z.object({` (around line 83). Inside the object literal, after the `referencesBaseline` field but before the closing `})`, add:

```ts
  scope: z.enum(["own", "all"]).default("own"),
```

- [ ] **Step 2: Inline admin check + scope handling in RunController**

Edit `apps/api/src/modules/run/run.controller.ts`. Replace the entire `list`, `detail`, `cancel`, and `delete` method bodies with these versions:

```ts
import {
  // ...existing imports
  ForbiddenException,
} from "@nestjs/common";

  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query(new ZodValidationPipe(listRunsQuerySchema)) query: ListRunsQuery,
  ): Promise<ListRunsResponse> {
    if (query.scope === "all" && !user.roles.includes("admin")) {
      throw new ForbiddenException({
        code: "RUN_SCOPE_FORBIDDEN",
        message: "admin role required for scope=all",
      });
    }
    return this.service.list(query, query.scope === "all" ? undefined : user.sub);
  }

  @Get(":id")
  detail(@CurrentUser() user: JwtPayload, @Param("id") id: string): Promise<Run> {
    return this.service.findByIdOrFail(id, user.roles.includes("admin") ? undefined : user.sub);
  }

  @Post(":id/cancel")
  cancel(@CurrentUser() user: JwtPayload, @Param("id") id: string): Promise<Run> {
    return this.service.cancel(id, user.roles.includes("admin") ? undefined : user.sub);
  }

  @Delete(":id")
  @HttpCode(204)
  async delete(@CurrentUser() user: JwtPayload, @Param("id") id: string): Promise<void> {
    await this.service.delete(id, user.roles.includes("admin") ? undefined : user.sub);
  }
```

(The `Get`, `Param`, `Body`, `HttpCode`, etc. imports from `@nestjs/common` already exist; only `ForbiddenException` is new — add it to the import list.)

- [ ] **Step 3: Relax `cancel` and `delete` service signatures to accept `userId?: string`**

Edit `apps/api/src/modules/run/run.service.ts`. Find `async cancel(id: string, userId: string): Promise<Run>` and change signature to:

```ts
  async cancel(id: string, userId?: string): Promise<Run> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException(`Run ${id} not found`);
    if (userId !== undefined && row.userId !== userId) {
      throw new NotFoundException(`Run ${id} not found`);
    }
    // ...rest of method unchanged
  }
```

(Replace the existing `if (row.userId !== userId)` check with the `userId !== undefined &&` guarded version. The rest of the method body — the TERMINAL_STATES check, `this.driver.cancel(row.driverHandle)`, the update, the reload — stays unchanged.)

Apply the same change to `delete`:

```ts
  async delete(id: string, userId?: string): Promise<void> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException(`Run ${id} not found`);
    if (userId !== undefined && row.userId !== userId) {
      throw new NotFoundException(`Run ${id} not found`);
    }
    // ...rest of method unchanged
  }
```

- [ ] **Step 4: Add 9 admin authz test cases**

Edit `apps/api/src/modules/run/run.controller.spec.ts`. After the existing `it("delete removes a terminal run", ...)` block (last test in the file), append before the closing `});` of `describe("RunController", ...)`:

```ts
  describe("admin authz", () => {
    it("rejects scope=all from non-admin caller (403)", async () => {
      const user = { sub: "u1", email: "u1@x", roles: [] };
      await expect(
        controller.list(user as never, { limit: 10, scope: "all" } as never),
      ).rejects.toThrow(/admin role required/i);
    });

    it("returns runs across all users when admin requests scope=all", async () => {
      const a = await prisma.user.create({ data: { email: "azz-1@x", passwordHash: "x" } });
      const b = await prisma.user.create({ data: { email: "azz-2@x", passwordHash: "x" } });
      for (const userId of [a.id, b.id]) {
        await prisma.run.create({
          data: {
            userId,
            kind: "benchmark",
            tool: "guidellm",
            scenario: {},
            mode: "fixed",
            driverKind: "local",
            params: {},
          },
        });
      }
      const admin = { sub: a.id, email: a.email, roles: ["admin"] };
      const result = await controller.list(admin as never, {
        limit: 10,
        scope: "all",
      } as never);
      expect(result.items).toHaveLength(2);
    });

    it("scopes to own when scope omitted", async () => {
      const a = await prisma.user.create({ data: { email: "azz-3@x", passwordHash: "x" } });
      const b = await prisma.user.create({ data: { email: "azz-4@x", passwordHash: "x" } });
      for (const userId of [a.id, b.id]) {
        await prisma.run.create({
          data: {
            userId,
            kind: "benchmark",
            tool: "guidellm",
            scenario: {},
            mode: "fixed",
            driverKind: "local",
            params: {},
          },
        });
      }
      const ua = { sub: a.id, email: a.email, roles: [] };
      const result = await controller.list(ua as never, { limit: 10 } as never);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].userId).toBe(a.id);
    });

    it("admin can read another user's run by id", async () => {
      const owner = await prisma.user.create({ data: { email: "azz-5@x", passwordHash: "x" } });
      const admin = await prisma.user.create({ data: { email: "azz-6@x", passwordHash: "x" } });
      const run = await prisma.run.create({
        data: {
          userId: owner.id,
          kind: "benchmark",
          tool: "guidellm",
          scenario: {},
          mode: "fixed",
          driverKind: "local",
          params: {},
        },
      });
      const adminArg = { sub: admin.id, email: admin.email, roles: ["admin"] };
      const dto = await controller.detail(adminArg as never, run.id);
      expect(dto.id).toBe(run.id);
      expect(dto.userId).toBe(owner.id);
    });

    it("non-admin gets 404 reading another user's run", async () => {
      const owner = await prisma.user.create({ data: { email: "azz-7@x", passwordHash: "x" } });
      const stranger = await prisma.user.create({
        data: { email: "azz-8@x", passwordHash: "x" },
      });
      const run = await prisma.run.create({
        data: {
          userId: owner.id,
          kind: "benchmark",
          tool: "guidellm",
          scenario: {},
          mode: "fixed",
          driverKind: "local",
          params: {},
        },
      });
      const strangerArg = { sub: stranger.id, email: stranger.email, roles: [] };
      await expect(controller.detail(strangerArg as never, run.id)).rejects.toThrow(/not found/i);
    });

    it("admin can cancel another user's running run", async () => {
      const owner = await prisma.user.create({ data: { email: "azz-9@x", passwordHash: "x" } });
      const admin = await prisma.user.create({ data: { email: "azz-10@x", passwordHash: "x" } });
      const run = await prisma.run.create({
        data: {
          userId: owner.id,
          kind: "benchmark",
          tool: "guidellm",
          scenario: {},
          mode: "fixed",
          driverKind: "local",
          params: {},
          status: "running",
          driverHandle: "subprocess:cancel-me",
        },
      });
      const adminArg = { sub: admin.id, email: admin.email, roles: ["admin"] };
      const dto = await controller.cancel(adminArg as never, run.id);
      expect(dto.status).toBe("canceled");
    });

    it("non-admin gets 404 cancelling another user's run", async () => {
      const owner = await prisma.user.create({ data: { email: "azz-11@x", passwordHash: "x" } });
      const stranger = await prisma.user.create({
        data: { email: "azz-12@x", passwordHash: "x" },
      });
      const run = await prisma.run.create({
        data: {
          userId: owner.id,
          kind: "benchmark",
          tool: "guidellm",
          scenario: {},
          mode: "fixed",
          driverKind: "local",
          params: {},
          status: "running",
        },
      });
      const strangerArg = { sub: stranger.id, email: stranger.email, roles: [] };
      await expect(controller.cancel(strangerArg as never, run.id)).rejects.toThrow(/not found/i);
    });

    it("admin can delete another user's terminal run", async () => {
      const owner = await prisma.user.create({ data: { email: "azz-13@x", passwordHash: "x" } });
      const admin = await prisma.user.create({ data: { email: "azz-14@x", passwordHash: "x" } });
      const run = await prisma.run.create({
        data: {
          userId: owner.id,
          kind: "benchmark",
          tool: "guidellm",
          scenario: {},
          mode: "fixed",
          driverKind: "local",
          params: {},
          status: "completed",
        },
      });
      const adminArg = { sub: admin.id, email: admin.email, roles: ["admin"] };
      await controller.delete(adminArg as never, run.id);
      const after = await prisma.run.findUnique({ where: { id: run.id } });
      expect(after).toBeNull();
    });

    it("non-admin gets 404 deleting another user's run", async () => {
      const owner = await prisma.user.create({ data: { email: "azz-15@x", passwordHash: "x" } });
      const stranger = await prisma.user.create({
        data: { email: "azz-16@x", passwordHash: "x" },
      });
      const run = await prisma.run.create({
        data: {
          userId: owner.id,
          kind: "benchmark",
          tool: "guidellm",
          scenario: {},
          mode: "fixed",
          driverKind: "local",
          params: {},
          status: "completed",
        },
      });
      const strangerArg = { sub: stranger.id, email: stranger.email, roles: [] };
      await expect(controller.delete(strangerArg as never, run.id)).rejects.toThrow(/not found/i);
    });
  });
```

- [ ] **Step 5: Run typecheck + tests**

```sh
cd /Users/fangyong/vllm/modeldoctor/issue-54-test-plan-ui
pnpm -F @modeldoctor/contracts build      # contract change must rebuild
pnpm -F @modeldoctor/api typecheck
pnpm -F @modeldoctor/api test -- run.controller.spec
```

Expected: all tests pass, including the 9 new admin authz cases.

- [ ] **Step 6: Commit**

```sh
git add packages/contracts/src/run.ts \
        apps/api/src/modules/run/run.controller.ts \
        apps/api/src/modules/run/run.service.ts \
        apps/api/src/modules/run/run.controller.spec.ts
git commit -m "$(cat <<'EOF'
feat(api): admin authz on /api/runs via ?scope=all (#54)

Replaces the inline `user.roles.includes("admin") ? undefined : user.sub`
temp from PR #76 (commit 4b73d7b) with a spec'd pattern: list takes
optional ?scope=own|all (admin-only for `all`); detail/cancel/delete
implicitly elevate when caller is admin.

RunService.cancel and .delete relax their userId param to optional
to match the existing list/findByIdOrFail "undefined === unscoped"
semantics.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Backend admin elevation tests in `run.service.spec.ts`

**Files:**

- Modify: `apps/api/src/modules/run/run.service.spec.ts`

- [ ] **Step 1: Find the existing service spec structure**

```sh
cd /Users/fangyong/vllm/modeldoctor/issue-54-test-plan-ui
grep -n "describe\|it(" apps/api/src/modules/run/run.service.spec.ts | head -40
```

You'll see the existing test cases. New cases go inside the same outer `describe("RunService", ...)` block, as a sub-describe.

- [ ] **Step 2: Append admin elevation cases**

At the bottom of `apps/api/src/modules/run/run.service.spec.ts`, before the final `});` of the outer `describe("RunService", ...)`, append:

```ts
  describe("admin elevation (userId === undefined)", () => {
    it("cancel succeeds across user boundaries when userId is undefined", async () => {
      const owner = await prisma.user.create({
        data: { email: "rs-cancel-elev@x", passwordHash: "x" },
      });
      const run = await prisma.run.create({
        data: {
          userId: owner.id,
          kind: "benchmark",
          tool: "guidellm",
          scenario: {},
          mode: "fixed",
          driverKind: "local",
          params: {},
          status: "running",
          driverHandle: "subprocess:elev",
        },
      });
      const dto = await service.cancel(run.id, undefined);
      expect(dto.status).toBe("canceled");
    });

    it("delete succeeds across user boundaries when userId is undefined", async () => {
      const owner = await prisma.user.create({
        data: { email: "rs-delete-elev@x", passwordHash: "x" },
      });
      const run = await prisma.run.create({
        data: {
          userId: owner.id,
          kind: "benchmark",
          tool: "guidellm",
          scenario: {},
          mode: "fixed",
          driverKind: "local",
          params: {},
          status: "completed",
        },
      });
      await service.delete(run.id, undefined);
      const after = await prisma.run.findUnique({ where: { id: run.id } });
      expect(after).toBeNull();
    });

    it("delete still blocked by FK when target run is the canonical run of a baseline", async () => {
      const owner = await prisma.user.create({
        data: { email: "rs-delete-baseline@x", passwordHash: "x" },
      });
      const run = await prisma.run.create({
        data: {
          userId: owner.id,
          kind: "benchmark",
          tool: "guidellm",
          scenario: {},
          mode: "fixed",
          driverKind: "local",
          params: {},
          status: "completed",
        },
      });
      await prisma.baseline.create({
        data: { name: "rs-elev-baseline", runId: run.id, userId: owner.id },
      });
      // Even with admin elevation (userId=undefined), Baseline.run onDelete:Restrict
      // should surface as a Prisma P2003 error (FK violation).
      await expect(service.delete(run.id, undefined)).rejects.toThrow();
      const stillThere = await prisma.run.findUnique({ where: { id: run.id } });
      expect(stillThere).not.toBeNull();
    });
  });
```

- [ ] **Step 3: Run targeted spec**

```sh
pnpm -F @modeldoctor/api test -- run.service.spec
```

Expected: all tests pass including the 3 new ones.

- [ ] **Step 4: Commit**

```sh
git add apps/api/src/modules/run/run.service.spec.ts
git commit -m "$(cat <<'EOF'
test(api): admin elevation + baseline-FK guard cases for RunService (#54)

Covers: cancel/delete with userId=undefined succeeds across owners;
delete still raises Prisma P2003 when target run is a baseline.runId
(existing onDelete: Restrict; this just confirms admin path doesn't
bypass it).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Rename `features/history` → `features/runs` (mechanical move + reference updates)

**Files (rename):**

- `apps/web/src/features/history/` → `apps/web/src/features/runs/`
- `HistoryListPage.tsx` → `RunListPage.tsx`
- `HistoryFilters.tsx` → `RunListFilters.tsx`
- `HistoryDetailPage.tsx` → `RunDetailPage.tsx`
- `HistoryDetailMetadata.tsx` → `RunDetailMetadata.tsx`
- `HistoryDetailRawOutput.tsx` → `RunDetailRawOutput.tsx`
- `apps/web/src/locales/en-US/history.json` → `runs.json` (and `zh-CN`)
- All `__tests__/History*.test.tsx` → `__tests__/Run*.test.tsx`

**Files (modify):**

- All files inside the renamed dir (export name changes)
- `apps/web/src/router/index.tsx`
- `apps/web/src/components/sidebar/sidebar-config.tsx`
- `apps/web/src/locales/{en-US,zh-CN}/sidebar.json`
- `apps/web/src/lib/i18n.ts`
- Anywhere else importing from `@/features/history/...`

`HistoryDetailMetrics.tsx` is **not renamed** in this task — it gets deleted in Task 9 (replaced by ReportSection switch). It can stay named `HistoryDetailMetrics.tsx` until then.

- [ ] **Step 1: `git mv` the directory**

```sh
cd /Users/fangyong/vllm/modeldoctor/issue-54-test-plan-ui
git mv apps/web/src/features/history apps/web/src/features/runs
```

- [ ] **Step 2: `git mv` individual component files**

```sh
cd apps/web/src/features/runs
git mv HistoryListPage.tsx          RunListPage.tsx
git mv HistoryFilters.tsx           RunListFilters.tsx
git mv HistoryDetailPage.tsx        RunDetailPage.tsx
git mv HistoryDetailMetadata.tsx    RunDetailMetadata.tsx
git mv HistoryDetailRawOutput.tsx   RunDetailRawOutput.tsx
git mv __tests__/HistoryListPage.test.tsx     __tests__/RunListPage.test.tsx
git mv __tests__/HistoryDetailPage.test.tsx   __tests__/RunDetailPage.test.tsx
# leave HistoryDetailMetrics.tsx + its test alone — they get deleted in Task 9
cd ../../../..
```

(Verify with `ls apps/web/src/features/runs/` — you should see 5 renamed components, 1 unchanged `HistoryDetailMetrics.tsx`, plus `api.ts`, `queries.ts`, `SetBaselineDialog.tsx`, `__tests__/`.)

- [ ] **Step 3: `git mv` i18n files**

```sh
cd /Users/fangyong/vllm/modeldoctor/issue-54-test-plan-ui
git mv apps/web/src/locales/en-US/history.json apps/web/src/locales/en-US/runs.json
git mv apps/web/src/locales/zh-CN/history.json apps/web/src/locales/zh-CN/runs.json
```

- [ ] **Step 4: Rename exports inside renamed component files**

For each renamed component file, rewrite the `export function HistoryX(...)` to `export function RunX(...)`. Use `Edit` per file:

`apps/web/src/features/runs/RunListPage.tsx`:
- Replace `export function HistoryListPage()` → `export function RunListPage()`

`apps/web/src/features/runs/RunListFilters.tsx`:
- Replace `export function HistoryFilters(` → `export function RunListFilters(` (preserve the `props` parameter list verbatim)
- Also replace any `HistoryFilters` references in the same file (the `interface HistoryFiltersProps` if present → `RunListFiltersProps`).

`apps/web/src/features/runs/RunDetailPage.tsx`:
- Replace `export function HistoryDetailPage()` → `export function RunDetailPage()`
- Inside the JSX, replace any `<HistoryDetailMetadata` / `</HistoryDetailMetadata>` → `<RunDetailMetadata` / `</RunDetailMetadata>`
- Replace `<HistoryDetailRawOutput` → `<RunDetailRawOutput`
- Update import lines at top of file: `import { HistoryDetailMetadata } from "./HistoryDetailMetadata"` → `import { RunDetailMetadata } from "./RunDetailMetadata"` (same for `HistoryDetailRawOutput` → `RunDetailRawOutput`)
- Update import line: `import { useRunDetail }` source path stays `"./queries"` (queries.ts not renamed yet) — leave it
- `HistoryDetailMetrics` import + JSX usage stays unchanged (deleted in Task 9, not now)

`apps/web/src/features/runs/RunDetailMetadata.tsx`:
- `export function HistoryDetailMetadata(` → `export function RunDetailMetadata(`
- Any `interface HistoryDetailMetadataProps` → `interface RunDetailMetadataProps`

`apps/web/src/features/runs/RunDetailRawOutput.tsx`:
- `export function HistoryDetailRawOutput(` → `export function RunDetailRawOutput(`

- [ ] **Step 5: Rename hooks/keys in `queries.ts`**

Edit `apps/web/src/features/runs/queries.ts`. Replace identifier names:
- `historyKeys` → `runKeys` (everywhere in the file)
- `useRunsInfiniteList` → `useRunList` (everywhere)
- The exported `historyApi` import (if it exists) is renamed in the next step

(Use `Edit` with `replace_all: true` for each token.)

- [ ] **Step 6: Rename `apps/web/src/features/runs/api.ts` exports**

Open the file. Find the exported object literal. Replace whatever the export is named (likely `historyApi` or just `api`) — search for the name with `grep -n "export" apps/web/src/features/runs/api.ts`. Rename to `runApi` consistently.

If the file currently exports e.g. `historyApi`, rename:

```ts
// before
export const historyApi = { ... };
// after
export const runApi = { ... };
```

(Internal route strings like `/api/runs` stay as-is — the API path was never `/api/history`.)

- [ ] **Step 7: Update `i18n.ts` namespace registrations**

Edit `apps/web/src/lib/i18n.ts`:

- Replace `import enHistory from "@/locales/en-US/history.json";` → `import enRuns from "@/locales/en-US/runs.json";`
- Replace `import zhHistory from "@/locales/zh-CN/history.json";` → `import zhRuns from "@/locales/zh-CN/runs.json";`
- In the `resources["en-US"]` object: change `history: enHistory,` → `runs: enRuns,`
- In the `resources["zh-CN"]` object: change `history: zhHistory,` → `runs: zhRuns,`

- [ ] **Step 8: Update `useTranslation("history")` → `useTranslation("runs")` everywhere**

```sh
cd /Users/fangyong/vllm/modeldoctor/issue-54-test-plan-ui
grep -rln 'useTranslation("history")' apps/web/src
```

For each file in the output, edit and replace `useTranslation("history")` → `useTranslation("runs")`. Expected files: at minimum the renamed pages in `features/runs/` (RunListPage, RunDetailPage, RunListFilters, RunDetailMetadata, RunDetailRawOutput) and possibly tests inside `features/runs/__tests__/`.

- [ ] **Step 9: Update router**

Edit `apps/web/src/router/index.tsx`:

- Replace import line `import { HistoryDetailPage } from "@/features/history/HistoryDetailPage";` → `import { RunDetailPage } from "@/features/runs/RunDetailPage";`
- Replace import line `import { HistoryListPage } from "@/features/history/HistoryListPage";` → `import { RunListPage } from "@/features/runs/RunListPage";`
- In the `routes` array, replace the two `path: "history"` and `path: "history/:runId"` entries with:

```ts
          {
            path: "runs",
            element: <RunListPage />,
          },
          {
            path: "runs/:id",
            element: <RunDetailPage />,
          },
```

Note: param name changed from `:runId` to `:id` to align with `Run.id` contract. **Therefore** `RunDetailPage.tsx` must be edited to read `useParams<{ id: string }>()` instead of `useParams<{ runId: string }>()`. Find the `useParams` call in `RunDetailPage.tsx` and update accordingly. Also update any internal references from `runId` to `id` in that file.

- [ ] **Step 10: Update sidebar config**

Edit `apps/web/src/components/sidebar/sidebar-config.tsx`. In the `observability` group's `items` array, replace the `history` entry with:

```ts
      {
        to: "/runs",
        icon: History,
        labelKey: "items.runs",
      },
```

- [ ] **Step 11: Update sidebar i18n**

Edit `apps/web/src/locales/en-US/sidebar.json`. In the `items` object, replace `"history": "History"` with `"runs": "Runs"`.

Edit `apps/web/src/locales/zh-CN/sidebar.json`. Same: replace whatever the `history` Chinese label is with `"runs": "运行"` (or check the existing translation convention by reading the file first; if a more nuanced word is preferred, use it). Quick check command:

```sh
grep -A1 -B1 '"history"' apps/web/src/locales/zh-CN/sidebar.json
```

Replace `"history": "<existing>"` → `"runs": "运行"`.

- [ ] **Step 12: Verify no stale `history` references remain**

```sh
cd /Users/fangyong/vllm/modeldoctor/issue-54-test-plan-ui
grep -rn "@/features/history\|HistoryListPage\|HistoryDetailPage\|HistoryDetailMetadata\|HistoryDetailRawOutput\|HistoryFilters\|historyKeys\|useRunsInfiniteList\|historyApi\|useTranslation(\"history\")" apps/web/src
grep -rn '"/history' apps/web/src
```

Expected: zero hits for both. (HistoryDetailMetrics.tsx is the lone exception — it stays named with `History*` until Task 9.)

```sh
grep -rn "HistoryDetailMetrics" apps/web/src
```

Expected: 1-2 hits (the file itself + import in RunDetailPage.tsx).

- [ ] **Step 13: Typecheck + run renamed tests**

```sh
pnpm -F @modeldoctor/web typecheck
pnpm -F @modeldoctor/web test -- features/runs
```

Expected: typecheck clean, all tests in `features/runs/__tests__/` pass.

- [ ] **Step 14: Commit**

```sh
git add -A apps/web/src/features/runs apps/web/src/features/history \
        apps/web/src/router/index.tsx \
        apps/web/src/components/sidebar/sidebar-config.tsx \
        apps/web/src/locales/en-US/sidebar.json apps/web/src/locales/zh-CN/sidebar.json \
        apps/web/src/locales/en-US/runs.json apps/web/src/locales/zh-CN/runs.json \
        apps/web/src/lib/i18n.ts
# (`git mv` already staged the rename pairs; -A captures the resulting state for safety. Verify staged set with `git status` before commit.)
git status                                # confirm only intended files are staged
git commit -m "$(cat <<'EOF'
refactor(web): rename features/history → features/runs (#54)

Pure mechanical rename: directory + 5 page components + 2 i18n locale
files + router paths /history → /runs (param :runId → :id) + sidebar
nav entry. RQ keys: historyKeys → runKeys; useRunsInfiniteList →
useRunList. No behavior changes; HistoryDetailMetrics stays named for
Task 9 deletion.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Add `@modeldoctor/tool-adapters` workspace dep to `apps/web`

**Files:**

- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml` (regenerated by pnpm)

- [ ] **Step 1: Add the dep**

Edit `apps/web/package.json`. Find the `dependencies` block (NOT `devDependencies`). Find an existing `@modeldoctor/contracts` line — add immediately after it:

```json
    "@modeldoctor/tool-adapters": "workspace:*",
```

(Maintain alphabetical order: `tool-adapters` comes after `contracts`. JSON commas correct.)

- [ ] **Step 2: Install + regenerate lockfile**

```sh
cd /Users/fangyong/vllm/modeldoctor/issue-54-test-plan-ui
pnpm install
```

Expected: lockfile updates, no errors. The package is workspace-local so install is fast.

- [ ] **Step 3: Smoke-test the FE-safe import path**

Create a temporary smoke file to confirm the subpath import works (delete after verification):

```sh
cat > /tmp/smoke-tool-adapters.ts <<'EOF'
import {
  guidellmParamDefaults,
  guidellmReportSchema,
  vegetaParamsSchema,
  type GenaiPerfReport,
} from "@modeldoctor/tool-adapters/schemas";

console.log(
  Object.keys(guidellmParamDefaults).length,
  guidellmReportSchema._def.typeName,
  vegetaParamsSchema._def.typeName,
);
EOF
cd /Users/fangyong/vllm/modeldoctor/issue-54-test-plan-ui/apps/web
npx tsc --noEmit --target esnext --moduleResolution bundler /tmp/smoke-tool-adapters.ts
```

Expected: no TS errors. (If the import resolves and types check, the dep + subpath are wired correctly.) Delete the temp file:

```sh
rm /tmp/smoke-tool-adapters.ts
```

- [ ] **Step 4: Verify web typecheck still clean**

```sh
cd /Users/fangyong/vllm/modeldoctor/issue-54-test-plan-ui
pnpm -F @modeldoctor/web typecheck
```

Expected: pass.

- [ ] **Step 5: Commit**

```sh
git add apps/web/package.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
build(web): add @modeldoctor/tool-adapters workspace dep (#54)

Required by the upcoming forms/ + reports/ components. Imports must go
through the dedicated /schemas subpath (FE-safe; no runtime.ts pulled
in transitively).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Create `components/MetricCard.tsx` shared primitive

**Files:**

- Create: `apps/web/src/features/runs/components/MetricCard.tsx`
- Create: `apps/web/src/features/runs/__tests__/components/MetricCard.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/runs/__tests__/components/MetricCard.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MetricCard } from "../../components/MetricCard";

describe("MetricCard", () => {
  it("renders title and rows", () => {
    render(
      <MetricCard
        title="Latency"
        rows={[
          { label: "p50", value: "12.3 ms" },
          { label: "p95", value: "45.6 ms" },
        ]}
      />,
    );
    expect(screen.getByText("Latency")).toBeInTheDocument();
    expect(screen.getByText("p50")).toBeInTheDocument();
    expect(screen.getByText("12.3 ms")).toBeInTheDocument();
    expect(screen.getByText("p95")).toBeInTheDocument();
    expect(screen.getByText("45.6 ms")).toBeInTheDocument();
  });

  it("renders empty value as em-dash", () => {
    render(<MetricCard title="X" rows={[{ label: "v", value: null }]} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```sh
cd /Users/fangyong/vllm/modeldoctor/issue-54-test-plan-ui
pnpm -F @modeldoctor/web test -- features/runs/__tests__/components/MetricCard
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `apps/web/src/features/runs/components/MetricCard.tsx`:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface MetricRow {
  label: string;
  value: string | number | null | undefined;
}

export interface MetricCardProps {
  title: string;
  rows: MetricRow[];
}

function fmt(v: MetricRow["value"]): string {
  if (v === null || v === undefined) return "—";
  return String(v);
}

export function MetricCard({ title, rows }: MetricCardProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 pt-0">
        {rows.map((r) => (
          <div key={r.label} className="flex justify-between text-sm">
            <span className="text-muted-foreground">{r.label}</span>
            <span className="font-medium tabular-nums">{fmt(r.value)}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Run test, verify pass**

```sh
pnpm -F @modeldoctor/web test -- features/runs/__tests__/components/MetricCard
```

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add apps/web/src/features/runs/components/MetricCard.tsx \
        apps/web/src/features/runs/__tests__/components/MetricCard.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): MetricCard shared primitive for run report views (#54)

Card+KV grid used by GuidellmReportView / VegetaReportView /
GenaiPerfReportView / UnknownReportView. Colocated under features/runs/
for now; promote to components/common/ when a second feature needs it.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `reports/UnknownReportView.tsx`

**Files:**

- Create: `apps/web/src/features/runs/reports/UnknownReportView.tsx`
- Create: `apps/web/src/features/runs/__tests__/reports/UnknownReportView.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/runs/__tests__/reports/UnknownReportView.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UnknownReportView } from "../../reports/UnknownReportView";

describe("UnknownReportView", () => {
  it("renders the reason and pretty-printed JSON", () => {
    render(
      <UnknownReportView
        raw={{ tool: "future-tool", payload: { x: 1 } }}
        reason="unknown tool"
      />,
    );
    expect(screen.getByText(/Report shape not recognized/i)).toBeInTheDocument();
    expect(screen.getByText(/unknown tool/i)).toBeInTheDocument();
    expect(screen.getByText(/"future-tool"/)).toBeInTheDocument();
  });

  it("survives null raw input", () => {
    render(<UnknownReportView raw={null} reason="missing" />);
    expect(screen.getByText(/Report shape not recognized/i)).toBeInTheDocument();
    expect(screen.getByText("null")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```sh
pnpm -F @modeldoctor/web test -- features/runs/__tests__/reports/UnknownReportView
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `apps/web/src/features/runs/reports/UnknownReportView.tsx`:

```tsx
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export interface UnknownReportViewProps {
  raw: unknown;
  reason: string;
}

export function UnknownReportView({ raw, reason }: UnknownReportViewProps) {
  return (
    <Alert className="border-amber-300 bg-amber-50/50 dark:bg-amber-950/20">
      <AlertTitle>Report shape not recognized</AlertTitle>
      <AlertDescription className="space-y-2">
        <div className="text-xs text-muted-foreground">{reason}</div>
        <pre className="overflow-x-auto rounded bg-muted/50 p-2 text-xs">
          {JSON.stringify(raw, null, 2)}
        </pre>
      </AlertDescription>
    </Alert>
  );
}
```

- [ ] **Step 4: Run test, verify pass**

```sh
pnpm -F @modeldoctor/web test -- features/runs/__tests__/reports/UnknownReportView
```

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add apps/web/src/features/runs/reports/UnknownReportView.tsx \
        apps/web/src/features/runs/__tests__/reports/UnknownReportView.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): UnknownReportView graceful fallback (#54)

Catches future schema drift / pre-#53 envelope rows in the run detail
page so summaryMetrics never crashes the page; renders raw JSON in an
amber-highlighted card.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `reports/GuidellmReportView.tsx`

**Files:**

- Create: `apps/web/src/features/runs/reports/GuidellmReportView.tsx`
- Create: `apps/web/src/features/runs/__tests__/reports/GuidellmReportView.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/runs/__tests__/reports/GuidellmReportView.test.tsx`:

```tsx
import type { GuidellmReport } from "@modeldoctor/tool-adapters/schemas";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GuidellmReportView } from "../../reports/GuidellmReportView";

const fixture: GuidellmReport = {
  ttft: { mean: 12.3, p50: 11, p90: 14, p95: 18, p99: 25 },
  itl: { mean: 5.2, p50: 5, p90: 6, p95: 7, p99: 8 },
  e2eLatency: { mean: 100, p50: 95, p90: 130, p95: 150, p99: 200 },
  requestsPerSecond: { mean: 42.5 },
  outputTokensPerSecond: { mean: 1500 },
  inputTokensPerSecond: { mean: 800 },
  totalTokensPerSecond: { mean: 2300 },
  concurrency: { mean: 16, max: 24 },
  requests: { total: 1000, success: 985, error: 10, incomplete: 5 },
};

describe("GuidellmReportView", () => {
  it("renders all primary distribution rows", () => {
    render(<GuidellmReportView data={fixture} />);
    // TTFT mean
    expect(screen.getByText(/12.3/)).toBeInTheDocument();
    // E2E p99
    expect(screen.getByText(/200/)).toBeInTheDocument();
    // Throughput mean
    expect(screen.getByText(/42.5/)).toBeInTheDocument();
    // Requests success / total
    expect(screen.getByText(/985/)).toBeInTheDocument();
    expect(screen.getByText(/1000/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```sh
pnpm -F @modeldoctor/web test -- features/runs/__tests__/reports/GuidellmReportView
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `apps/web/src/features/runs/reports/GuidellmReportView.tsx`:

```tsx
import type { GuidellmReport } from "@modeldoctor/tool-adapters/schemas";
import { MetricCard } from "../components/MetricCard";

export interface GuidellmReportViewProps {
  data: GuidellmReport;
}

function fmt(n: number, digits = 1): string {
  return n.toFixed(digits);
}

export function GuidellmReportView({ data }: GuidellmReportViewProps) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      <MetricCard
        title="TTFT (ms)"
        rows={[
          { label: "mean", value: fmt(data.ttft.mean) },
          { label: "p50", value: fmt(data.ttft.p50) },
          { label: "p90", value: fmt(data.ttft.p90) },
          { label: "p95", value: fmt(data.ttft.p95) },
          { label: "p99", value: fmt(data.ttft.p99) },
        ]}
      />
      <MetricCard
        title="ITL (ms)"
        rows={[
          { label: "mean", value: fmt(data.itl.mean) },
          { label: "p50", value: fmt(data.itl.p50) },
          { label: "p90", value: fmt(data.itl.p90) },
          { label: "p95", value: fmt(data.itl.p95) },
          { label: "p99", value: fmt(data.itl.p99) },
        ]}
      />
      <MetricCard
        title="E2E latency (ms)"
        rows={[
          { label: "mean", value: fmt(data.e2eLatency.mean) },
          { label: "p50", value: fmt(data.e2eLatency.p50) },
          { label: "p90", value: fmt(data.e2eLatency.p90) },
          { label: "p95", value: fmt(data.e2eLatency.p95) },
          { label: "p99", value: fmt(data.e2eLatency.p99) },
        ]}
      />
      <MetricCard
        title="Throughput"
        rows={[
          { label: "RPS", value: fmt(data.requestsPerSecond.mean) },
          { label: "Output TPS", value: fmt(data.outputTokensPerSecond.mean) },
          { label: "Input TPS", value: fmt(data.inputTokensPerSecond.mean) },
          { label: "Total TPS", value: fmt(data.totalTokensPerSecond.mean) },
        ]}
      />
      <MetricCard
        title="Concurrency"
        rows={[
          { label: "mean", value: fmt(data.concurrency.mean) },
          { label: "max", value: data.concurrency.max },
        ]}
      />
      <MetricCard
        title="Requests"
        rows={[
          { label: "total", value: data.requests.total },
          { label: "success", value: data.requests.success },
          { label: "error", value: data.requests.error },
          { label: "incomplete", value: data.requests.incomplete },
        ]}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run test, verify pass**

```sh
pnpm -F @modeldoctor/web test -- features/runs/__tests__/reports/GuidellmReportView
```

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add apps/web/src/features/runs/reports/GuidellmReportView.tsx \
        apps/web/src/features/runs/__tests__/reports/GuidellmReportView.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): GuidellmReportView (#54)

Renders TTFT/ITL/E2E latency distributions, throughput trio,
concurrency, and request totals from a parsed GuidellmReport.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `reports/VegetaReportView.tsx`

**Files:**

- Create: `apps/web/src/features/runs/reports/VegetaReportView.tsx`
- Create: `apps/web/src/features/runs/__tests__/reports/VegetaReportView.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/runs/__tests__/reports/VegetaReportView.test.tsx`:

```tsx
import type { VegetaReport } from "@modeldoctor/tool-adapters/schemas";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VegetaReportView } from "../../reports/VegetaReportView";

const fixture: VegetaReport = {
  requests: { total: 600, rate: 10, throughput: 9.8 },
  duration: { totalSeconds: 60, attackSeconds: 60, waitSeconds: 0 },
  latencies: { min: 5, mean: 25.4, p50: 22, p90: 38, p95: 45.6, p99: 80, max: 120 },
  bytesIn: { total: 1024000, mean: 1706 },
  bytesOut: { total: 200000, mean: 333 },
  success: 99.5,
  statusCodes: { "200": 597, "500": 3 },
  errors: ["timeout", "connection refused"],
};

describe("VegetaReportView", () => {
  it("renders requests, latency dist, success%, status codes", () => {
    render(<VegetaReportView data={fixture} />);
    expect(screen.getByText(/600/)).toBeInTheDocument();
    expect(screen.getByText(/45.6/)).toBeInTheDocument();
    expect(screen.getByText(/99.5/)).toBeInTheDocument();
    expect(screen.getByText("200")).toBeInTheDocument();
    expect(screen.getByText("597")).toBeInTheDocument();
  });

  it("lists errors when present", () => {
    render(<VegetaReportView data={fixture} />);
    expect(screen.getByText(/timeout/i)).toBeInTheDocument();
    expect(screen.getByText(/connection refused/i)).toBeInTheDocument();
  });

  it("hides errors section when array empty", () => {
    render(<VegetaReportView data={{ ...fixture, errors: [] }} />);
    expect(screen.queryByText(/Errors/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```sh
pnpm -F @modeldoctor/web test -- features/runs/__tests__/reports/VegetaReportView
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Create `apps/web/src/features/runs/reports/VegetaReportView.tsx`:

```tsx
import type { VegetaReport } from "@modeldoctor/tool-adapters/schemas";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "../components/MetricCard";

export interface VegetaReportViewProps {
  data: VegetaReport;
}

function fmt(n: number, digits = 1): string {
  return n.toFixed(digits);
}

export function VegetaReportView({ data }: VegetaReportViewProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        <MetricCard
          title="Requests"
          rows={[
            { label: "total", value: data.requests.total },
            { label: "rate", value: fmt(data.requests.rate) },
            { label: "throughput", value: fmt(data.requests.throughput) },
          ]}
        />
        <MetricCard
          title="Latency (ms)"
          rows={[
            { label: "min", value: fmt(data.latencies.min) },
            { label: "mean", value: fmt(data.latencies.mean) },
            { label: "p50", value: fmt(data.latencies.p50) },
            { label: "p90", value: fmt(data.latencies.p90) },
            { label: "p95", value: fmt(data.latencies.p95) },
            { label: "p99", value: fmt(data.latencies.p99) },
            { label: "max", value: fmt(data.latencies.max) },
          ]}
        />
        <MetricCard
          title="Success"
          rows={[
            { label: "success%", value: fmt(data.success, 2) },
            { label: "duration (s)", value: fmt(data.duration.totalSeconds) },
            { label: "bytes in (avg)", value: fmt(data.bytesIn.mean, 0) },
            { label: "bytes out (avg)", value: fmt(data.bytesOut.mean, 0) },
          ]}
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Status codes
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-1 pt-0 text-sm sm:grid-cols-4">
          {Object.entries(data.statusCodes).map(([code, count]) => (
            <div key={code} className="flex justify-between">
              <span className="text-muted-foreground">{code}</span>
              <span className="font-medium tabular-nums">{count}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {data.errors.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Errors
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 pt-0 text-sm">
            {data.errors.map((err) => (
              <div key={err} className="font-mono text-xs text-destructive">
                {err}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test, verify pass**

```sh
pnpm -F @modeldoctor/web test -- features/runs/__tests__/reports/VegetaReportView
```

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add apps/web/src/features/runs/reports/VegetaReportView.tsx \
        apps/web/src/features/runs/__tests__/reports/VegetaReportView.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): VegetaReportView (#54)

Renders requests/latency/success cards, status code histogram, and
error list (when non-empty).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `reports/GenaiPerfReportView.tsx`

**Files:**

- Create: `apps/web/src/features/runs/reports/GenaiPerfReportView.tsx`
- Create: `apps/web/src/features/runs/__tests__/reports/GenaiPerfReportView.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/runs/__tests__/reports/GenaiPerfReportView.test.tsx`:

```tsx
import type { GenaiPerfReport } from "@modeldoctor/tool-adapters/schemas";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GenaiPerfReportView } from "../../reports/GenaiPerfReportView";

const dist = {
  avg: 12.5,
  min: 10,
  max: 30,
  p50: 12,
  p90: 18,
  p95: 22,
  p99: 28,
  stddev: 4,
  unit: "ms",
};

const fixture: GenaiPerfReport = {
  requestThroughput: { avg: 50.2, unit: "req/s" },
  requestLatency: dist,
  timeToFirstToken: dist,
  interTokenLatency: { ...dist, avg: 5.1 },
  outputTokenThroughput: { avg: 1200, unit: "tok/s" },
  outputSequenceLength: { avg: 256, p50: 250, p99: 400 },
  inputSequenceLength: { avg: 128, p50: 120, p99: 200 },
};

describe("GenaiPerfReportView", () => {
  it("renders throughput + latency + sequence-length cards", () => {
    render(<GenaiPerfReportView data={fixture} />);
    expect(screen.getByText(/50.2/)).toBeInTheDocument();
    expect(screen.getByText(/12.5/)).toBeInTheDocument();
    expect(screen.getByText(/5.1/)).toBeInTheDocument();
    expect(screen.getByText(/1200/)).toBeInTheDocument();
    expect(screen.getByText(/256/)).toBeInTheDocument();
    expect(screen.getByText(/128/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```sh
pnpm -F @modeldoctor/web test -- features/runs/__tests__/reports/GenaiPerfReportView
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Create `apps/web/src/features/runs/reports/GenaiPerfReportView.tsx`:

```tsx
import type { GenaiPerfReport } from "@modeldoctor/tool-adapters/schemas";
import { MetricCard } from "../components/MetricCard";

export interface GenaiPerfReportViewProps {
  data: GenaiPerfReport;
}

function fmt(n: number, digits = 1): string {
  return n.toFixed(digits);
}

export function GenaiPerfReportView({ data }: GenaiPerfReportViewProps) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      <MetricCard
        title={`Request throughput (${data.requestThroughput.unit})`}
        rows={[{ label: "avg", value: fmt(data.requestThroughput.avg) }]}
      />
      <MetricCard
        title={`Output throughput (${data.outputTokenThroughput.unit})`}
        rows={[{ label: "avg", value: fmt(data.outputTokenThroughput.avg) }]}
      />
      <MetricCard
        title={`Request latency (${data.requestLatency.unit})`}
        rows={[
          { label: "avg", value: fmt(data.requestLatency.avg) },
          { label: "p50", value: fmt(data.requestLatency.p50) },
          { label: "p90", value: fmt(data.requestLatency.p90) },
          { label: "p95", value: fmt(data.requestLatency.p95) },
          { label: "p99", value: fmt(data.requestLatency.p99) },
        ]}
      />
      <MetricCard
        title={`TTFT (${data.timeToFirstToken.unit})`}
        rows={[
          { label: "avg", value: fmt(data.timeToFirstToken.avg) },
          { label: "p50", value: fmt(data.timeToFirstToken.p50) },
          { label: "p90", value: fmt(data.timeToFirstToken.p90) },
          { label: "p95", value: fmt(data.timeToFirstToken.p95) },
          { label: "p99", value: fmt(data.timeToFirstToken.p99) },
        ]}
      />
      <MetricCard
        title={`Inter-token latency (${data.interTokenLatency.unit})`}
        rows={[
          { label: "avg", value: fmt(data.interTokenLatency.avg) },
          { label: "p50", value: fmt(data.interTokenLatency.p50) },
          { label: "p90", value: fmt(data.interTokenLatency.p90) },
          { label: "p95", value: fmt(data.interTokenLatency.p95) },
          { label: "p99", value: fmt(data.interTokenLatency.p99) },
        ]}
      />
      <MetricCard
        title="Sequence length"
        rows={[
          { label: "input avg", value: fmt(data.inputSequenceLength.avg, 0) },
          { label: "input p99", value: fmt(data.inputSequenceLength.p99, 0) },
          { label: "output avg", value: fmt(data.outputSequenceLength.avg, 0) },
          { label: "output p99", value: fmt(data.outputSequenceLength.p99, 0) },
        ]}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run test, verify pass**

```sh
pnpm -F @modeldoctor/web test -- features/runs/__tests__/reports/GenaiPerfReportView
```

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add apps/web/src/features/runs/reports/GenaiPerfReportView.tsx \
        apps/web/src/features/runs/__tests__/reports/GenaiPerfReportView.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): GenaiPerfReportView (#54)

Renders request/output throughput, request latency / TTFT / ITL
distributions, and input/output sequence length cards.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Augment `RunDetailPage` with `<ReportSection>` switch + delete `HistoryDetailMetrics`

**Files:**

- Modify: `apps/web/src/features/runs/RunDetailPage.tsx`
- Modify: `apps/web/src/features/runs/__tests__/RunDetailPage.test.tsx`
- Delete: `apps/web/src/features/runs/HistoryDetailMetrics.tsx`
- Delete: `apps/web/src/features/runs/__tests__/HistoryDetailMetrics.test.tsx` (if it exists)

- [ ] **Step 1: Find `HistoryDetailMetrics` test (if any)**

```sh
cd /Users/fangyong/vllm/modeldoctor/issue-54-test-plan-ui
ls apps/web/src/features/runs/__tests__/ | grep -i metrics || echo "no metrics test"
```

If a metrics test file exists, note its name for deletion in Step 6.

- [ ] **Step 2: Update `RunDetailPage.tsx` to use `ReportSection`**

Edit `apps/web/src/features/runs/RunDetailPage.tsx`. Find the import line `import { HistoryDetailMetrics } from "./HistoryDetailMetrics"` and the JSX usage `<HistoryDetailMetrics metrics={run.summaryMetrics} />`.

Replace the import with:

```ts
import {
  guidellmReportSchema,
  vegetaReportSchema,
  genaiPerfReportSchema,
  type GuidellmReport,
  type VegetaReport,
  type GenaiPerfReport,
} from "@modeldoctor/tool-adapters/schemas";
import { GuidellmReportView } from "./reports/GuidellmReportView";
import { VegetaReportView } from "./reports/VegetaReportView";
import { GenaiPerfReportView } from "./reports/GenaiPerfReportView";
import { UnknownReportView } from "./reports/UnknownReportView";
import type { Run } from "@modeldoctor/contracts";
```

(If `Run` is already imported elsewhere in the file, dedupe — don't double-import.)

Add the `ReportSection` function above the `RunDetailPage` component:

```tsx
function ReportSection({ metrics }: { metrics: Run["summaryMetrics"] }) {
  if (!metrics) {
    return (
      <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        No metrics yet
      </div>
    );
  }
  const tagged = metrics as { tool?: string; data?: unknown };
  switch (tagged.tool) {
    case "guidellm": {
      const parsed = guidellmReportSchema.safeParse(tagged.data);
      return parsed.success ? (
        <GuidellmReportView data={parsed.data as GuidellmReport} />
      ) : (
        <UnknownReportView raw={metrics} reason={parsed.error.message} />
      );
    }
    case "vegeta": {
      const parsed = vegetaReportSchema.safeParse(tagged.data);
      return parsed.success ? (
        <VegetaReportView data={parsed.data as VegetaReport} />
      ) : (
        <UnknownReportView raw={metrics} reason={parsed.error.message} />
      );
    }
    case "genai-perf": {
      const parsed = genaiPerfReportSchema.safeParse(tagged.data);
      return parsed.success ? (
        <GenaiPerfReportView data={parsed.data as GenaiPerfReport} />
      ) : (
        <UnknownReportView raw={metrics} reason={parsed.error.message} />
      );
    }
    default:
      return <UnknownReportView raw={metrics} reason="unknown report envelope" />;
  }
}
```

In the JSX, replace `<HistoryDetailMetrics metrics={run.summaryMetrics} />` with `<ReportSection metrics={run.summaryMetrics} />`.

- [ ] **Step 3: Update `RunDetailPage.test.tsx`**

Open `apps/web/src/features/runs/__tests__/RunDetailPage.test.tsx`. Look at the existing structure (which renders the page with mocked `useRunDetail`). Find any test that asserts content rendered by `HistoryDetailMetrics` and update it.

After all existing test cases (still inside the same `describe`), append four new cases covering the four switch branches:

```tsx
  it("renders GuidellmReportView when summaryMetrics.tool === 'guidellm'", async () => {
    // pseudo: replace mock to return a Run with the guidellm envelope
    mockUseRunDetail({
      ...baseRun,
      summaryMetrics: {
        tool: "guidellm",
        data: {
          ttft: { mean: 12, p50: 11, p90: 14, p95: 18, p99: 25 },
          itl: { mean: 5, p50: 5, p90: 6, p95: 7, p99: 8 },
          e2eLatency: { mean: 100, p50: 95, p90: 130, p95: 150, p99: 200 },
          requestsPerSecond: { mean: 42 },
          outputTokensPerSecond: { mean: 1500 },
          inputTokensPerSecond: { mean: 800 },
          totalTokensPerSecond: { mean: 2300 },
          concurrency: { mean: 16, max: 24 },
          requests: { total: 1000, success: 985, error: 10, incomplete: 5 },
        },
      },
    });
    render(<RunDetailPage />, { wrapper });
    await screen.findByText(/TTFT/i);
  });

  it("renders VegetaReportView when summaryMetrics.tool === 'vegeta'", async () => {
    mockUseRunDetail({
      ...baseRun,
      summaryMetrics: {
        tool: "vegeta",
        data: {
          requests: { total: 600, rate: 10, throughput: 9.8 },
          duration: { totalSeconds: 60, attackSeconds: 60, waitSeconds: 0 },
          latencies: { min: 5, mean: 25, p50: 22, p90: 38, p95: 45, p99: 80, max: 120 },
          bytesIn: { total: 1000, mean: 16 },
          bytesOut: { total: 500, mean: 8 },
          success: 99.5,
          statusCodes: { "200": 597, "500": 3 },
          errors: [],
        },
      },
    });
    render(<RunDetailPage />, { wrapper });
    await screen.findByText(/Status codes/i);
  });

  it("renders GenaiPerfReportView when summaryMetrics.tool === 'genai-perf'", async () => {
    mockUseRunDetail({
      ...baseRun,
      summaryMetrics: {
        tool: "genai-perf",
        data: {
          requestThroughput: { avg: 50, unit: "req/s" },
          requestLatency: { avg: 12, min: 10, max: 30, p50: 12, p90: 18, p95: 22, p99: 28, stddev: 4, unit: "ms" },
          timeToFirstToken: { avg: 12, min: 10, max: 30, p50: 12, p90: 18, p95: 22, p99: 28, stddev: 4, unit: "ms" },
          interTokenLatency: { avg: 5, min: 3, max: 10, p50: 5, p90: 7, p95: 8, p99: 9, stddev: 1, unit: "ms" },
          outputTokenThroughput: { avg: 1200, unit: "tok/s" },
          outputSequenceLength: { avg: 256, p50: 250, p99: 400 },
          inputSequenceLength: { avg: 128, p50: 120, p99: 200 },
        },
      },
    });
    render(<RunDetailPage />, { wrapper });
    await screen.findByText(/Sequence length/i);
  });

  it("renders UnknownReportView for unrecognized envelope", async () => {
    mockUseRunDetail({
      ...baseRun,
      summaryMetrics: { tool: "future-tool", data: { something: "else" } },
    });
    render(<RunDetailPage />, { wrapper });
    await screen.findByText(/Report shape not recognized/i);
  });
```

**Important:** the actual structure of `mockUseRunDetail`, `baseRun`, and `wrapper` depends on what the existing `RunDetailPage.test.tsx` already uses (it was renamed from `HistoryDetailPage.test.tsx`). Open the file FIRST, see how the existing test mocks `useRunDetail` and constructs the wrapper (likely with QueryClientProvider + MemoryRouter), then adapt the four new cases to match that exact pattern. The pseudo-API above uses placeholder names — replace with the file's actual conventions.

- [ ] **Step 4: Delete `HistoryDetailMetrics.tsx`**

```sh
cd /Users/fangyong/vllm/modeldoctor/issue-54-test-plan-ui
git rm apps/web/src/features/runs/HistoryDetailMetrics.tsx
```

If the metrics test file exists (per Step 1):

```sh
git rm apps/web/src/features/runs/__tests__/HistoryDetailMetrics.test.tsx
```

- [ ] **Step 5: Verify no other references**

```sh
grep -rn "HistoryDetailMetrics" apps/web/src
```

Expected: zero hits.

- [ ] **Step 6: Run typecheck + tests**

```sh
pnpm -F @modeldoctor/web typecheck
pnpm -F @modeldoctor/web test -- features/runs/__tests__/RunDetailPage
```

Expected: typecheck clean, all RunDetailPage tests pass (existing + 4 new).

- [ ] **Step 7: Commit**

```sh
git add apps/web/src/features/runs/RunDetailPage.tsx \
        apps/web/src/features/runs/__tests__/RunDetailPage.test.tsx
git status                              # confirm HistoryDetailMetrics deletes are also staged
git commit -m "$(cat <<'EOF'
feat(web): RunDetailPage discriminated-union ReportSection (#54)

Replaces opaque HistoryDetailMetrics with a switch over
summaryMetrics.tool that runtime-validates the envelope's `data`
against the per-tool report schema and dispatches to
GuidellmReportView / VegetaReportView / GenaiPerfReportView /
UnknownReportView (graceful fallback).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: `forms/GuidellmParamsForm.tsx`

**Files:**

- Create: `apps/web/src/features/runs/forms/GuidellmParamsForm.tsx`
- Create: `apps/web/src/features/runs/__tests__/forms/GuidellmParamsForm.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/runs/__tests__/forms/GuidellmParamsForm.test.tsx`:

```tsx
import { zodResolver } from "@hookform/resolvers/zod";
import { guidellmParamsSchema } from "@modeldoctor/tool-adapters/schemas";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { GuidellmParamsForm } from "../../forms/GuidellmParamsForm";

const wrapperSchema = z.object({ params: guidellmParamsSchema });

function Wrapper({ children, defaults }: { children: React.ReactNode; defaults?: unknown }) {
  const form = useForm({
    resolver: zodResolver(wrapperSchema),
    defaultValues: {
      params: defaults ?? {
        profile: "throughput",
        apiType: "chat",
        datasetName: "random",
        datasetInputTokens: 1024,
        datasetOutputTokens: 128,
        requestRate: 0,
        totalRequests: 1000,
        maxDurationSeconds: 1800,
        maxConcurrency: 100,
        validateBackend: true,
      },
    },
  });
  return <FormProvider {...form}>{children}</FormProvider>;
}

describe("GuidellmParamsForm", () => {
  it("renders all primary fields", () => {
    render(
      <Wrapper>
        <GuidellmParamsForm />
      </Wrapper>,
    );
    expect(screen.getByLabelText(/profile/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/total requests/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/max concurrency/i)).toBeInTheDocument();
  });

  it("shows datasetInputTokens + datasetOutputTokens when datasetName === random", () => {
    render(
      <Wrapper>
        <GuidellmParamsForm />
      </Wrapper>,
    );
    expect(screen.getByLabelText(/input tokens/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/output tokens/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```sh
pnpm -F @modeldoctor/web test -- features/runs/__tests__/forms/GuidellmParamsForm
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Create `apps/web/src/features/runs/forms/GuidellmParamsForm.tsx`:

```tsx
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { GuidellmParams } from "@modeldoctor/tool-adapters/schemas";
import { useFormContext, useWatch } from "react-hook-form";

const PROFILES: GuidellmParams["profile"][] = [
  "throughput",
  "latency",
  "long_context",
  "generation_heavy",
  "sharegpt",
  "custom",
];

const API_TYPES: GuidellmParams["apiType"][] = ["chat", "completion"];
const DATASETS: GuidellmParams["datasetName"][] = ["random", "sharegpt"];

export function GuidellmParamsForm() {
  const { register, setValue, control } = useFormContext();
  const datasetName = useWatch({ control, name: "params.datasetName" });
  const validateBackend = useWatch({ control, name: "params.validateBackend" });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Profile</Label>
          <Select
            onValueChange={(v) =>
              setValue("params.profile", v as GuidellmParams["profile"], {
                shouldValidate: true,
              })
            }
            defaultValue={undefined}
          >
            <SelectTrigger aria-label="Profile">
              <SelectValue placeholder="Select profile" />
            </SelectTrigger>
            <SelectContent>
              {PROFILES.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>API type</Label>
          <Select
            onValueChange={(v) =>
              setValue("params.apiType", v as GuidellmParams["apiType"], {
                shouldValidate: true,
              })
            }
            defaultValue={undefined}
          >
            <SelectTrigger aria-label="API type">
              <SelectValue placeholder="Select API type" />
            </SelectTrigger>
            <SelectContent>
              {API_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Dataset</Label>
          <Select
            onValueChange={(v) =>
              setValue("params.datasetName", v as GuidellmParams["datasetName"], {
                shouldValidate: true,
              })
            }
            defaultValue={undefined}
          >
            <SelectTrigger aria-label="Dataset">
              <SelectValue placeholder="Select dataset" />
            </SelectTrigger>
            <SelectContent>
              {DATASETS.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Dataset seed (optional)</Label>
          <Input
            type="number"
            {...register("params.datasetSeed", {
              setValueAs: (v) => (v === "" || v === undefined ? undefined : Number(v)),
            })}
          />
        </div>
      </div>

      {datasetName === "random" && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Input tokens</Label>
            <Input
              type="number"
              {...register("params.datasetInputTokens", { valueAsNumber: true })}
            />
          </div>
          <div>
            <Label>Output tokens</Label>
            <Input
              type="number"
              {...register("params.datasetOutputTokens", { valueAsNumber: true })}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Request rate (0 = unlimited)</Label>
          <Input
            type="number"
            step="0.1"
            {...register("params.requestRate", { valueAsNumber: true })}
          />
        </div>
        <div>
          <Label>Total requests</Label>
          <Input
            type="number"
            {...register("params.totalRequests", { valueAsNumber: true })}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Max duration (s)</Label>
          <Input
            type="number"
            {...register("params.maxDurationSeconds", { valueAsNumber: true })}
          />
        </div>
        <div>
          <Label>Max concurrency</Label>
          <Input
            type="number"
            {...register("params.maxConcurrency", { valueAsNumber: true })}
          />
        </div>
      </div>

      <div>
        <Label>Processor (optional)</Label>
        <Input
          {...register("params.processor", {
            setValueAs: (v) => (v === "" || v === undefined ? undefined : v),
          })}
          placeholder="HuggingFace tokenizer name"
        />
      </div>

      <div className="flex items-center gap-3">
        <Switch
          checked={validateBackend === true}
          onCheckedChange={(v) =>
            setValue("params.validateBackend", v, { shouldValidate: true })
          }
          aria-label="Validate backend"
        />
        <Label>Validate backend before run</Label>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test, verify pass**

```sh
pnpm -F @modeldoctor/web test -- features/runs/__tests__/forms/GuidellmParamsForm
```

Expected: PASS. (If shadcn `<Select>` requires a controlled `value` for Radix tests, you may need to switch to a `value={...}` controlled approach driven by `useWatch`. If that comes up, switch each Select to controlled — see VegetaParamsForm in Task 12 for the controlled pattern.)

- [ ] **Step 5: Commit**

```sh
git add apps/web/src/features/runs/forms/GuidellmParamsForm.tsx \
        apps/web/src/features/runs/__tests__/forms/GuidellmParamsForm.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): GuidellmParamsForm (#54)

Renders profile / apiType / dataset / token-count (when random) /
rate / totals / concurrency / processor / validateBackend fields,
driven by react-hook-form + the adapter's GuidellmParams shape.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: `forms/VegetaParamsForm.tsx`

**Files:**

- Create: `apps/web/src/features/runs/forms/VegetaParamsForm.tsx`
- Create: `apps/web/src/features/runs/__tests__/forms/VegetaParamsForm.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/runs/__tests__/forms/VegetaParamsForm.test.tsx`:

```tsx
import { zodResolver } from "@hookform/resolvers/zod";
import { vegetaParamsSchema } from "@modeldoctor/tool-adapters/schemas";
import { render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { VegetaParamsForm } from "../../forms/VegetaParamsForm";

const wrapperSchema = z.object({ params: vegetaParamsSchema });

function Wrapper({ children }: { children: React.ReactNode }) {
  const form = useForm({
    resolver: zodResolver(wrapperSchema),
    defaultValues: {
      params: { apiType: "chat", rate: 10, duration: 30 },
    },
  });
  return <FormProvider {...form}>{children}</FormProvider>;
}

describe("VegetaParamsForm", () => {
  it("renders apiType, rate, duration fields", () => {
    render(
      <Wrapper>
        <VegetaParamsForm />
      </Wrapper>,
    );
    expect(screen.getByLabelText(/api type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^rate/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/duration/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```sh
pnpm -F @modeldoctor/web test -- features/runs/__tests__/forms/VegetaParamsForm
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Create `apps/web/src/features/runs/forms/VegetaParamsForm.tsx`:

```tsx
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { VegetaParams } from "@modeldoctor/tool-adapters/schemas";
import { useFormContext, useWatch } from "react-hook-form";

const API_TYPES: VegetaParams["apiType"][] = [
  "chat",
  "embeddings",
  "rerank",
  "images",
  "chat-vision",
  "chat-audio",
];

export function VegetaParamsForm() {
  const { register, setValue, control } = useFormContext();
  const apiType = useWatch({ control, name: "params.apiType" });

  return (
    <div className="space-y-4">
      <div>
        <Label>API type</Label>
        <Select
          value={apiType ?? ""}
          onValueChange={(v) =>
            setValue("params.apiType", v as VegetaParams["apiType"], {
              shouldValidate: true,
            })
          }
        >
          <SelectTrigger aria-label="API type">
            <SelectValue placeholder="Select API type" />
          </SelectTrigger>
          <SelectContent>
            {API_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Rate (req/s)</Label>
          <Input type="number" {...register("params.rate", { valueAsNumber: true })} />
        </div>
        <div>
          <Label>Duration (s)</Label>
          <Input type="number" {...register("params.duration", { valueAsNumber: true })} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test, verify pass**

```sh
pnpm -F @modeldoctor/web test -- features/runs/__tests__/forms/VegetaParamsForm
```

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add apps/web/src/features/runs/forms/VegetaParamsForm.tsx \
        apps/web/src/features/runs/__tests__/forms/VegetaParamsForm.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): VegetaParamsForm (#54)

Three fields: apiType (6-variant enum), rate, duration. Controlled
Select drives the apiType.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: `forms/GenaiPerfParamsForm.tsx`

**Files:**

- Create: `apps/web/src/features/runs/forms/GenaiPerfParamsForm.tsx`
- Create: `apps/web/src/features/runs/__tests__/forms/GenaiPerfParamsForm.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/runs/__tests__/forms/GenaiPerfParamsForm.test.tsx`:

```tsx
import { zodResolver } from "@hookform/resolvers/zod";
import { genaiPerfParamsSchema } from "@modeldoctor/tool-adapters/schemas";
import { render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { GenaiPerfParamsForm } from "../../forms/GenaiPerfParamsForm";

const wrapperSchema = z.object({ params: genaiPerfParamsSchema });

function Wrapper({ children }: { children: React.ReactNode }) {
  const form = useForm({
    resolver: zodResolver(wrapperSchema),
    defaultValues: {
      params: {
        endpointType: "chat",
        numPrompts: 100,
        concurrency: 1,
        inputTokensStddev: 0,
        outputTokensStddev: 0,
        streaming: true,
      },
    },
  });
  return <FormProvider {...form}>{children}</FormProvider>;
}

describe("GenaiPerfParamsForm", () => {
  it("renders all fields", () => {
    render(
      <Wrapper>
        <GenaiPerfParamsForm />
      </Wrapper>,
    );
    expect(screen.getByLabelText(/endpoint type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/num prompts/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/concurrency/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/streaming/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```sh
pnpm -F @modeldoctor/web test -- features/runs/__tests__/forms/GenaiPerfParamsForm
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Create `apps/web/src/features/runs/forms/GenaiPerfParamsForm.tsx`:

```tsx
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { GenaiPerfParams } from "@modeldoctor/tool-adapters/schemas";
import { useFormContext, useWatch } from "react-hook-form";

const ENDPOINT_TYPES: GenaiPerfParams["endpointType"][] = [
  "chat",
  "completions",
  "embeddings",
  "rankings",
];

export function GenaiPerfParamsForm() {
  const { register, setValue, control } = useFormContext();
  const endpointType = useWatch({ control, name: "params.endpointType" });
  const streaming = useWatch({ control, name: "params.streaming" });

  return (
    <div className="space-y-4">
      <div>
        <Label>Endpoint type</Label>
        <Select
          value={endpointType ?? ""}
          onValueChange={(v) =>
            setValue("params.endpointType", v as GenaiPerfParams["endpointType"], {
              shouldValidate: true,
            })
          }
        >
          <SelectTrigger aria-label="Endpoint type">
            <SelectValue placeholder="Select endpoint type" />
          </SelectTrigger>
          <SelectContent>
            {ENDPOINT_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Num prompts</Label>
          <Input type="number" {...register("params.numPrompts", { valueAsNumber: true })} />
        </div>
        <div>
          <Label>Concurrency</Label>
          <Input
            type="number"
            {...register("params.concurrency", { valueAsNumber: true })}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Input tokens mean (optional)</Label>
          <Input
            type="number"
            {...register("params.inputTokensMean", {
              setValueAs: (v) => (v === "" || v === undefined ? undefined : Number(v)),
            })}
          />
        </div>
        <div>
          <Label>Input tokens stddev</Label>
          <Input
            type="number"
            {...register("params.inputTokensStddev", { valueAsNumber: true })}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Output tokens mean (optional)</Label>
          <Input
            type="number"
            {...register("params.outputTokensMean", {
              setValueAs: (v) => (v === "" || v === undefined ? undefined : Number(v)),
            })}
          />
        </div>
        <div>
          <Label>Output tokens stddev</Label>
          <Input
            type="number"
            {...register("params.outputTokensStddev", { valueAsNumber: true })}
          />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Switch
          checked={streaming === true}
          onCheckedChange={(v) =>
            setValue("params.streaming", v, { shouldValidate: true })
          }
          aria-label="Streaming"
        />
        <Label>Streaming</Label>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test, verify pass**

```sh
pnpm -F @modeldoctor/web test -- features/runs/__tests__/forms/GenaiPerfParamsForm
```

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add apps/web/src/features/runs/forms/GenaiPerfParamsForm.tsx \
        apps/web/src/features/runs/__tests__/forms/GenaiPerfParamsForm.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): GenaiPerfParamsForm (#54)

Renders endpointType / numPrompts / concurrency / input+output token
mean+stddev / streaming fields per the GenaiPerfParams schema.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: `RunCreatePage.tsx` + `useCreateRun` mutation + route + sidebar CTA

**Files:**

- Modify: `apps/web/src/features/runs/api.ts` — add `runApi.create`, `runApi.cancel`, `runApi.delete` if missing
- Modify: `apps/web/src/features/runs/queries.ts` — add `useCreateRun`, `useCancelRun`, `useDeleteRun` hooks
- Create: `apps/web/src/features/runs/RunCreatePage.tsx`
- Create: `apps/web/src/features/runs/__tests__/RunCreatePage.test.tsx`
- Modify: `apps/web/src/router/index.tsx` — register `/runs/new` + change index Navigate
- Modify: `apps/web/src/features/runs/RunListPage.tsx` — add "New Run" CTA in header
- Modify: `apps/web/src/locales/en-US/runs.json` — add `create.*` keys + `actions.new`
- Modify: `apps/web/src/locales/zh-CN/runs.json` — same in Chinese

- [ ] **Step 1: Inspect current `api.ts` + `queries.ts` to know what already exists**

```sh
cd /Users/fangyong/vllm/modeldoctor/issue-54-test-plan-ui
cat apps/web/src/features/runs/api.ts
cat apps/web/src/features/runs/queries.ts
```

Identify whether `create` / `cancel` / `delete` already exist in `runApi` and corresponding mutations in `queries.ts`. Plan steps below assume they do NOT exist; if some are present, skip the matching parts.

- [ ] **Step 2: Add missing methods to `runApi`**

Edit `apps/web/src/features/runs/api.ts`. After the existing `list` / `get` (or whatever's there), add:

```ts
import type { CreateRunRequest, Run } from "@modeldoctor/contracts";

// inside `runApi` object:
  create: (body: CreateRunRequest) => api.post<Run>("/api/runs", body),
  cancel: (id: string) => api.post<Run>(`/api/runs/${id}/cancel`, {}),
  delete: (id: string) => api.del<void>(`/api/runs/${id}`),
```

(`api.del` may be named differently — check the existing import; benchmark `api.ts` used `api.del`. If the FE wrapper doesn't have `del`, use whatever DELETE helper is there; check `apps/web/src/lib/api-client.ts`.)

- [ ] **Step 3: Add mutations to `queries.ts`**

Edit `apps/web/src/features/runs/queries.ts`. After the existing query hooks, add:

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateRunRequest } from "@modeldoctor/contracts";
import { runApi } from "./api";

export function useCreateRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateRunRequest) => runApi.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: runKeys.lists() });
    },
  });
}

export function useCancelRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => runApi.cancel(id),
    onSuccess: (_run, id) => {
      qc.invalidateQueries({ queryKey: runKeys.detail(id) });
      qc.invalidateQueries({ queryKey: runKeys.lists() });
    },
  });
}

export function useDeleteRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => runApi.delete(id),
    onSuccess: (_v, id) => {
      qc.removeQueries({ queryKey: runKeys.detail(id) });
      qc.invalidateQueries({ queryKey: runKeys.lists() });
    },
  });
}
```

(If `runKeys.lists()` and `runKeys.detail(id)` aren't already defined, define them next to `runKeys`. Pattern from `useBenchmarkList`/`useBenchmarkDetail` — e.g.:)

```ts
export const runKeys = {
  all: ["runs"] as const,
  lists: () => [...runKeys.all, "list"] as const,
  list: (q: unknown) => [...runKeys.lists(), q] as const,
  details: () => [...runKeys.all, "detail"] as const,
  detail: (id: string) => [...runKeys.details(), id] as const,
};
```

- [ ] **Step 4: Add i18n keys for create + actions**

Edit `apps/web/src/locales/en-US/runs.json`. Inside the top-level object, add (alongside existing `title` etc.):

```json
  "actions": {
    "new": "New Run",
    "cancel": "Cancel",
    "submit": "Submit"
  },
  "create": {
    "title": "New Run",
    "subtitle": "Configure a benchmark or load test, then submit",
    "sections": {
      "endpoint": "Endpoint",
      "tool": "Tool",
      "metadata": "Run details",
      "parameters": "Parameters"
    },
    "fields": {
      "name": "Name",
      "description": "Description (optional)",
      "tool": "Tool"
    },
    "tools": {
      "guidellm": "guidellm",
      "vegeta": "vegeta",
      "genai-perf": "genai-perf"
    },
    "errors": {
      "submitFailed": "Failed to submit run"
    },
    "submitted": "Run \"{{name}}\" submitted"
  }
```

(Merge into existing JSON without removing existing keys. JSON commas correct.)

Edit `apps/web/src/locales/zh-CN/runs.json` to add Chinese equivalents (translate accordingly; e.g. `"new": "新建运行"`, `"submit": "提交"`).

- [ ] **Step 5: Write the failing test for `RunCreatePage`**

Create `apps/web/src/features/runs/__tests__/RunCreatePage.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { RunCreatePage } from "../RunCreatePage";

vi.mock("@/features/connections/queries", () => ({
  useConnectionList: () => ({
    data: [{ id: "c1", name: "test-conn", baseUrl: "http://x", model: "m" }],
    isLoading: false,
  }),
}));

const mockMutate = vi.fn();
vi.mock("../queries", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    useCreateRun: () => ({
      mutate: mockMutate,
      mutateAsync: mockMutate,
      isPending: false,
    }),
  };
});

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("RunCreatePage", () => {
  it("renders endpoint, tool, name, description sections", () => {
    render(<RunCreatePage />, { wrapper: Wrapper });
    expect(screen.getByText(/Endpoint/i)).toBeInTheDocument();
    expect(screen.getByText(/Tool/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Name/i)).toBeInTheDocument();
  });

  it("disables submit when no connection selected", () => {
    render(<RunCreatePage />, { wrapper: Wrapper });
    const submit = screen.getByRole("button", { name: /Submit/i });
    expect(submit).toBeDisabled();
  });
});
```

(The `vi.mock` of `"@/features/connections/queries"` may need adjusting to the actual hook name in this repo — replace `useConnectionList` with whatever `EndpointPicker` uses to fetch connections. Run `grep -rn "EndpointPicker" apps/web/src/components` to find the picker, then look at its props/data source.)

- [ ] **Step 6: Run to verify failure**

```sh
pnpm -F @modeldoctor/web test -- features/runs/__tests__/RunCreatePage
```

Expected: FAIL — module not found.

- [ ] **Step 7: Implement `RunCreatePage`**

Create `apps/web/src/features/runs/RunCreatePage.tsx`:

```tsx
import { PageHeader } from "@/components/common/page-header";
import { EndpointPicker } from "@/components/connection/EndpointPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { zodResolver } from "@hookform/resolvers/zod";
import { type CreateRunRequest, createRunRequestSchema } from "@modeldoctor/contracts";
import {
  type ToolName,
  guidellmParamDefaults,
  vegetaParamDefaults,
  genaiPerfParamDefaults,
} from "@modeldoctor/tool-adapters/schemas";
import { useEffect, useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { GenaiPerfParamsForm } from "./forms/GenaiPerfParamsForm";
import { GuidellmParamsForm } from "./forms/GuidellmParamsForm";
import { VegetaParamsForm } from "./forms/VegetaParamsForm";
import { useCreateRun } from "./queries";

const TOOL_DEFAULTS: Record<ToolName, unknown> = {
  guidellm: guidellmParamDefaults,
  vegeta: vegetaParamDefaults,
  "genai-perf": genaiPerfParamDefaults,
};

const TOOLS: ToolName[] = ["guidellm", "vegeta", "genai-perf"];

export function RunCreatePage() {
  const { t } = useTranslation("runs");
  const navigate = useNavigate();
  const createMut = useCreateRun();
  const [tool, setTool] = useState<ToolName>("guidellm");
  const [connectionId, setConnectionId] = useState<string>("");

  const form = useForm<CreateRunRequest>({
    resolver: zodResolver(createRunRequestSchema),
    mode: "onChange",
    defaultValues: {
      tool: "guidellm",
      kind: "benchmark",
      connectionId: "",
      name: "",
      description: "",
      params: TOOL_DEFAULTS.guidellm as Record<string, unknown>,
    },
  });

  // When tool changes, reset params to that tool's defaults (and keep
  // user-entered name/description/connection).
  useEffect(() => {
    const cur = form.getValues();
    form.reset({
      ...cur,
      tool,
      params: TOOL_DEFAULTS[tool] as Record<string, unknown>,
    });
  }, [tool, form]);

  // Keep connectionId in form state in sync with EndpointPicker selection.
  useEffect(() => {
    form.setValue("connectionId", connectionId, { shouldValidate: true });
  }, [connectionId, form]);

  const ParamsForm =
    tool === "guidellm"
      ? GuidellmParamsForm
      : tool === "vegeta"
        ? VegetaParamsForm
        : GenaiPerfParamsForm;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const run = await createMut.mutateAsync(values);
      toast.success(t("create.submitted", { name: run.name ?? run.id }));
      navigate(`/runs/${run.id}`);
    } catch (e) {
      const err = e as { code?: string; message?: string; status?: number };
      toast.error(err.message ?? t("create.errors.submitFailed"));
    }
  });

  const submitDisabled = !form.formState.isValid || createMut.isPending || !connectionId;

  return (
    <>
      <PageHeader title={t("create.title")} subtitle={t("create.subtitle")} />
      <div className="mx-auto max-w-3xl space-y-6 px-8 py-6">
        <FormProvider {...form}>
          <form onSubmit={onSubmit} className="space-y-6">
            <section className="rounded-lg border border-border bg-card p-4">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {t("create.sections.endpoint")}
              </h2>
              <EndpointPicker
                selectedConnectionId={connectionId}
                onSelect={(id) => setConnectionId(id ?? "")}
              />
            </section>

            <section className="rounded-lg border border-border bg-card p-4">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {t("create.sections.tool")}
              </h2>
              <div className="max-w-xs">
                <Label>{t("create.fields.tool")}</Label>
                <Select value={tool} onValueChange={(v) => setTool(v as ToolName)}>
                  <SelectTrigger aria-label="Tool">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TOOLS.map((tn) => (
                      <SelectItem key={tn} value={tn}>
                        {t(`create.tools.${tn}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </section>

            <section className="rounded-lg border border-border bg-card p-4 space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {t("create.sections.metadata")}
              </h2>
              <div>
                <Label htmlFor="run-name">{t("create.fields.name")}</Label>
                <Input id="run-name" {...form.register("name")} />
              </div>
              <div>
                <Label htmlFor="run-desc">{t("create.fields.description")}</Label>
                <Textarea
                  id="run-desc"
                  rows={2}
                  {...form.register("description", {
                    setValueAs: (v) => (v === "" || v === undefined ? undefined : v),
                  })}
                />
              </div>
            </section>

            <section className="rounded-lg border border-border bg-card p-4">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {t("create.sections.parameters")}
              </h2>
              <ParamsForm />
            </section>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => navigate("/runs")}>
                {t("actions.cancel")}
              </Button>
              <Button type="submit" disabled={submitDisabled}>
                {createMut.isPending ? "…" : t("actions.submit")}
              </Button>
            </div>
          </form>
        </FormProvider>
      </div>
    </>
  );
}
```

**Note on `EndpointPicker` props:** the actual prop signature comes from `apps/web/src/components/connection/EndpointPicker.tsx`. The example above assumes `selectedConnectionId` + `onSelect` (matching how `LoadTestPage.tsx` used it). Open `EndpointPicker.tsx` and verify the props before keeping or adjusting. If it requires more props (`endpoint`, `onEndpointChange`, `onCurlParsed`, `previewUrl`), supply minimal stubs — the Test Plan UI doesn't use curl import, so an empty/no-op pattern suffices. If passing full required props proves complex, build a thin `<SavedConnectionPicker>` inline that just lists the user's connections via `useConnectionList`/whatever hook exists.

- [ ] **Step 8: Run RunCreatePage tests**

```sh
pnpm -F @modeldoctor/web test -- features/runs/__tests__/RunCreatePage
```

Expected: PASS. If `EndpointPicker` mock is incomplete, the test may need `vi.mock("@/components/connection/EndpointPicker", () => ({ EndpointPicker: ({ onSelect }: any) => <button onClick={() => onSelect("c1")}>Pick</button> }))` added.

- [ ] **Step 9: Register the `/runs/new` route + change index Navigate**

Edit `apps/web/src/router/index.tsx`. Add the import:

```ts
import { RunCreatePage } from "@/features/runs/RunCreatePage";
```

In the `routes` array, after the `runs` and before `runs/:id`, add:

```ts
          { path: "runs/new", element: <RunCreatePage /> },
```

(Order matters: literal `runs/new` must come before parametric `runs/:id` for some router versions; current React Router v6 sorts by specificity automatically, but explicit order is safer.)

Find `{ index: true, element: <Navigate to="/load-test" replace /> }` (line ~51 of the original file) and change to:

```ts
          { index: true, element: <Navigate to="/runs" replace /> },
```

- [ ] **Step 10: Add "New Run" CTA to `RunListPage`**

Edit `apps/web/src/features/runs/RunListPage.tsx`. Find the `PageHeader`'s `rightSlot` (it currently has a refresh + compare button). Add a new `<Link>`-wrapped `<Button>` between Refresh and Compare:

```tsx
import { Link } from "react-router-dom";
// ...

            <Button asChild size="sm">
              <Link to="/runs/new">{t("actions.new")}</Link>
            </Button>
```

(Keep the existing buttons. Place the new one as the primary action — typically first or last in the rightSlot row; pick by reading the file.)

- [ ] **Step 11: Typecheck + run all renamed-feature tests**

```sh
pnpm -F @modeldoctor/web typecheck
pnpm -F @modeldoctor/web test -- features/runs
```

Expected: typecheck clean, all `features/runs` tests pass.

- [ ] **Step 12: Commit**

```sh
git add apps/web/src/features/runs/RunCreatePage.tsx \
        apps/web/src/features/runs/api.ts \
        apps/web/src/features/runs/queries.ts \
        apps/web/src/features/runs/RunListPage.tsx \
        apps/web/src/features/runs/__tests__/RunCreatePage.test.tsx \
        apps/web/src/router/index.tsx \
        apps/web/src/locales/en-US/runs.json apps/web/src/locales/zh-CN/runs.json
git commit -m "$(cat <<'EOF'
feat(web): RunCreatePage Test Plan UI form at /runs/new (#54)

Single page: EndpointPicker + tool select + name/description +
per-tool params subform (Guidellm/Vegeta/GenaiPerf). On submit calls
useCreateRun → POST /api/runs and navigates to /runs/<id>. Tool
switch resets params to that tool's adapter defaults. RunListPage
gets a primary "New Run" CTA in its header.

Default landing route changes from /load-test to /runs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Delete legacy FE feature directories + sidebar/router cleanup

**Files (delete):**

- `apps/web/src/features/benchmark/` (entire directory)
- `apps/web/src/features/load-test/` (entire directory)
- `apps/web/src/locales/en-US/benchmark.json`
- `apps/web/src/locales/zh-CN/benchmark.json`
- `apps/web/src/locales/en-US/load-test.json`
- `apps/web/src/locales/zh-CN/load-test.json`

**Files (modify):**

- `apps/web/src/router/index.tsx` — drop `/benchmarks`, `/benchmarks/:id`, `/load-test`
- `apps/web/src/components/sidebar/sidebar-config.tsx` — drop `loadTest`, `benchmark` items
- `apps/web/src/locales/{en-US,zh-CN}/sidebar.json` — drop `loadTest`, `benchmark` keys
- `apps/web/src/lib/i18n.ts` — drop benchmark + load-test imports + namespace registrations

- [ ] **Step 1: Delete the FE feature directories**

```sh
cd /Users/fangyong/vllm/modeldoctor/issue-54-test-plan-ui
git rm -r apps/web/src/features/benchmark
git rm -r apps/web/src/features/load-test
```

- [ ] **Step 2: Delete legacy locale files**

```sh
git rm apps/web/src/locales/en-US/benchmark.json apps/web/src/locales/zh-CN/benchmark.json \
       apps/web/src/locales/en-US/load-test.json apps/web/src/locales/zh-CN/load-test.json
```

- [ ] **Step 3: Drop legacy router entries + imports**

Edit `apps/web/src/router/index.tsx`. Remove the import lines:

```ts
import { BenchmarkDetailPage } from "@/features/benchmark/BenchmarkDetailPage";
import { BenchmarkListPage } from "@/features/benchmark/BenchmarkListPage";
import { LoadTestPage } from "@/features/load-test/LoadTestPage";
```

Remove these route entries from the `routes` array:

```ts
          { path: "load-test", element: <LoadTestPage /> },
          { path: "benchmarks", element: <BenchmarkListPage /> },
          { path: "benchmarks/:id", element: <BenchmarkDetailPage /> },
```

- [ ] **Step 4: Drop sidebar items**

Edit `apps/web/src/components/sidebar/sidebar-config.tsx`. In the `performance` group's `items` array, remove:

```ts
      { to: "/load-test", icon: Activity, labelKey: "items.loadTest" },
      { to: "/benchmarks", icon: Gauge, labelKey: "items.benchmark" },
```

Remove the now-unused `Activity` and `Gauge` icon imports from the `lucide-react` import statement at the top of the file (only if no other items reference them; check the rest of the file).

- [ ] **Step 5: Drop sidebar i18n keys**

Edit `apps/web/src/locales/en-US/sidebar.json`. Remove the `"loadTest": "Load Test"` and `"benchmark": "Benchmark"` lines from the `items` object.

Edit `apps/web/src/locales/zh-CN/sidebar.json`. Same removals.

- [ ] **Step 6: Drop benchmark + load-test from `i18n.ts`**

Edit `apps/web/src/lib/i18n.ts`. Remove these lines from the imports:

```ts
import enBenchmark from "@/locales/en-US/benchmark.json";
import enLoadTest from "@/locales/en-US/load-test.json";
import zhBenchmark from "@/locales/zh-CN/benchmark.json";
import zhLoadTest from "@/locales/zh-CN/load-test.json";
```

Remove these lines from `resources["en-US"]` and `resources["zh-CN"]`:

```ts
      "load-test": enLoadTest,
      benchmark: enBenchmark,
      // (and the zh equivalents under "zh-CN")
```

- [ ] **Step 7: FE grep verification (must all return zero)**

```sh
cd /Users/fangyong/vllm/modeldoctor/issue-54-test-plan-ui

# legacy contract types
grep -rn 'from "@modeldoctor/contracts"' apps/web/src \
  | grep -E 'Benchmark|LoadTest|loadTestApi'

# legacy URL strings
grep -rn '"/benchmarks\|"/load-test' apps/web/src

# legacy i18n keys
grep -rn 'useTranslation("benchmark")\|useTranslation("load-test")' apps/web/src

# legacy feature dir imports
grep -rn '@/features/benchmark\|@/features/load-test' apps/web/src

# tool-adapters root import — must be empty (subpath /schemas only)
grep -rn 'from "@modeldoctor/tool-adapters"' apps/web/src
```

Each command should print nothing. If any prints something, fix that file before proceeding.

- [ ] **Step 8: Typecheck + full FE test run**

```sh
pnpm -F @modeldoctor/web typecheck
pnpm -F @modeldoctor/web test
```

Expected: typecheck clean, all FE tests pass.

- [ ] **Step 9: Commit**

```sh
git add apps/web/src/router/index.tsx \
        apps/web/src/components/sidebar/sidebar-config.tsx \
        apps/web/src/locales/en-US/sidebar.json apps/web/src/locales/zh-CN/sidebar.json \
        apps/web/src/lib/i18n.ts
git status                              # confirm legacy dir + locale deletes are also staged
git commit -m "$(cat <<'EOF'
refactor(web): remove legacy benchmark + load-test FE pages (#54)

Test Plan UI at /runs/new + RunDetailPage now cover everything the
legacy pages did. Drops:
- features/benchmark/ (List/Detail/Create modal/etc.)
- features/load-test/ (page + curl-parser forms — confirmed dead at
  the BE boundary in Task 0; vegeta adapter never consumed those
  fields)
- locale files for both
- sidebar entries + router routes + i18n.ts namespace registrations

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: Delete BE facades + legacy contracts

**Files (delete):**

- `apps/api/src/modules/benchmark/` (5 files: controller, controller.spec, module, facade-mappers, facade-mappers.spec)
- `apps/api/src/modules/load-test/` (same shape)
- `packages/contracts/src/benchmark.ts`
- `packages/contracts/src/load-test.ts`

**Files (modify):**

- `apps/api/src/app.module.ts` — remove `BenchmarkModule`, `LoadTestModule` imports + `imports` array entries
- `packages/contracts/src/index.ts` — remove `export * from "./benchmark.js"` + `export * from "./load-test.js"`

- [ ] **Step 1: Delete BE module directories**

```sh
cd /Users/fangyong/vllm/modeldoctor/issue-54-test-plan-ui
git rm -r apps/api/src/modules/benchmark
git rm -r apps/api/src/modules/load-test
```

- [ ] **Step 2: Drop module registrations from `app.module.ts`**

Edit `apps/api/src/app.module.ts`. Remove:

```ts
import { BenchmarkModule } from "./modules/benchmark/benchmark.module.js";
import { LoadTestModule } from "./modules/load-test/load-test.module.js";
```

Remove `BenchmarkModule` and `LoadTestModule` from the `@Module({ imports: [...] })` array.

- [ ] **Step 3: Delete legacy contract files**

```sh
git rm packages/contracts/src/benchmark.ts packages/contracts/src/load-test.ts
```

- [ ] **Step 4: Drop exports from contracts index**

Edit `packages/contracts/src/index.ts`. Remove:

```ts
export * from "./benchmark.js";
export * from "./load-test.js";
```

(Other exports stay.)

- [ ] **Step 5: BE grep verification (must all return zero)**

```sh
cd /Users/fangyong/vllm/modeldoctor/issue-54-test-plan-ui

# legacy contract type imports anywhere in BE
grep -rn 'from "@modeldoctor/contracts"' apps/api/src \
  | grep -E 'Benchmark|LoadTest|loadTestApi'

# legacy module references
grep -rn '@/modules/benchmark\|@/modules/load-test\|modules/benchmark/\|modules/load-test/' apps/api/src
```

Each must print nothing.

- [ ] **Step 6: Build + typecheck + full API test run**

```sh
pnpm -F @modeldoctor/contracts build       # rebuilds without legacy exports
pnpm -F @modeldoctor/api typecheck
pnpm -F @modeldoctor/api test
```

Expected: contracts build clean (no benchmark.js/load-test.js artifacts), API typecheck clean, API tests all pass (run.controller.spec / run.service.spec / etc. — anything depending on the deleted facades is itself deleted).

- [ ] **Step 7: Commit**

```sh
git add apps/api/src/app.module.ts \
        packages/contracts/src/index.ts
git status                              # confirm BE module + contract deletes are also staged
git commit -m "$(cat <<'EOF'
refactor: delete /api/benchmark + /api/load-test facades and legacy contracts (#54)

FE no longer imports them (Task 15). Removes:
- apps/api/src/modules/benchmark/ (controller + facade-mappers + module + specs)
- apps/api/src/modules/load-test/ (same shape)
- packages/contracts/src/{benchmark,load-test}.ts
- BenchmarkModule + LoadTestModule registrations from app.module.ts
- legacy index.ts exports

LoadTestController.waitForTerminal long-poll path (deferred from PR #76)
goes away with the controller.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: Update `CLAUDE.md` reference + final verification gates

**Files:**

- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md page-layout reference**

Edit `CLAUDE.md`. Find the line:

```
Render `<PageHeader title=... subtitle=... />` directly at the top of the page, then page body. Reference: `apps/web/src/features/load-test/LoadTestPage.tsx`.
```

Replace with:

```
Render `<PageHeader title=... subtitle=... />` directly at the top of the page, then page body. Reference: `apps/web/src/features/runs/RunCreatePage.tsx`.
```

- [ ] **Step 2: Run full verification gates**

```sh
cd /Users/fangyong/vllm/modeldoctor/issue-54-test-plan-ui
pnpm install --frozen-lockfile           # confirm lockfile is in good state
pnpm -r build                            # all packages build cleanly
pnpm -r typecheck                        # full workspace typecheck
pnpm -F @modeldoctor/api test
pnpm -F @modeldoctor/web test
pnpm -F @modeldoctor/api lint
pnpm -F @modeldoctor/web lint
pnpm -F @modeldoctor/api format
pnpm -F @modeldoctor/web format
```

If any gate fails, fix the issue and append the fix to this commit (use `git add` + `git commit --amend --no-edit` — but ONLY for the unfinished Task 17; never amend a prior task's commit).

- [ ] **Step 3: Commit (only if there are stageable changes)**

```sh
git status
git add CLAUDE.md
# include any lint/format auto-fixes that landed:
git add -u                              # stages ONLY modifications, not new untracked files
git commit -m "$(cat <<'EOF'
docs: update CLAUDE.md page-layout reference + final lint/format pass (#54)

Replaces stale reference to deleted apps/web/src/features/load-test/
LoadTestPage.tsx with apps/web/src/features/runs/RunCreatePage.tsx.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

(If `git status` shows no changes after lint/format, the CLAUDE.md edit is the only thing to commit; the add/commit is still required.)

- [ ] **Step 4: Push branch**

```sh
git log --oneline main..HEAD              # review the commit series
git push -u origin feat/issue-54-test-plan-ui
```

Expected: 17 commits in topological order (admin authz → service spec → rename → tool-adapters dep → MetricCard → 4 reports → RunDetailPage augment → 3 forms → RunCreatePage → FE delete → BE delete → final). Push succeeds.

- [ ] **Step 5: Open PR**

```sh
gh pr create --title "feat: Test Plan UI + FE migration to /api/runs (#54)" --body "$(cat <<'EOF'
## Summary

Closes #54. Single PR cutover:

- New `/runs/new` Test Plan UI form (Connection + Tool + per-tool dynamic params).
- `/runs/:id` detail page now switches `summaryMetrics` over the discriminated `tool` field, dispatching to per-tool report views.
- Renames `/history` → `/runs` (REST-resource alignment with the `Run` contract).
- Deletes `/api/benchmarks` + `/api/load-test` facade controllers and their FE consumers.
- Replaces inline admin check (PR #76 commit `4b73d7b`) with spec'd `?scope=all` admin authz on `/api/runs`.

Spec: [`docs/superpowers/specs/2026-05-02-issue-54-test-plan-ui-and-runs-migration-design.md`](./docs/superpowers/specs/2026-05-02-issue-54-test-plan-ui-and-runs-migration-design.md)
Plan: [`docs/superpowers/plans/2026-05-02-issue-54-test-plan-ui-and-runs-migration.md`](./docs/superpowers/plans/2026-05-02-issue-54-test-plan-ui-and-runs-migration.md)

Builds on:
- #53 (Tool Adapter Framework, merged via PR #76 — provides the per-tool `paramsSchema` + `reportSchema` consumed by both forms and views).

## Commit map

1. `feat(api)` admin authz on `/api/runs` via `?scope=all`
2. `test(api)` admin elevation + baseline-FK guard cases
3. `refactor(web)` rename `features/history` → `features/runs`
4. `build(web)` add `@modeldoctor/tool-adapters` workspace dep
5. `feat(web)` MetricCard shared primitive
6. `feat(web)` UnknownReportView graceful fallback
7. `feat(web)` GuidellmReportView
8. `feat(web)` VegetaReportView
9. `feat(web)` GenaiPerfReportView
10. `feat(web)` RunDetailPage discriminated-union ReportSection
11. `feat(web)` GuidellmParamsForm
12. `feat(web)` VegetaParamsForm
13. `feat(web)` GenaiPerfParamsForm
14. `feat(web)` RunCreatePage Test Plan UI form
15. `refactor(web)` remove legacy benchmark + load-test FE
16. `refactor` delete `/api/benchmark` + `/api/load-test` facades and contracts
17. `docs` update CLAUDE.md reference + final lint/format

## Test plan

- [ ] `pnpm -r build` (all packages green)
- [ ] `pnpm -r typecheck`
- [ ] `pnpm -F @modeldoctor/api test`
- [ ] `pnpm -F @modeldoctor/web test`
- [ ] `pnpm -F @modeldoctor/{api,web} lint && format`
- [ ] CI green
- [ ] Manual: `prisma migrate reset --force` → submit guidellm/vegeta/genai-perf runs from `/runs/new` → verify navigation lands on `/runs/<id>` → wait for terminal → verify per-tool ReportView renders
- [ ] Manual: admin user can `/runs?scope=all`; non-admin gets 403
- [ ] Manual: admin can read/cancel/delete other users' runs by id; non-admin gets 404

## Out of scope (follow-ups posted to issue #54 on merge)

- Per-worker postgres schema isolation (replaces `vitest.config.mts` `fileParallelism: false`) — separate issue
- Generic Run reconciler for runs stuck in `running` past their deadline — separate issue
- `PATCH /api/runs/:id` not implemented; #43 `params` immutability guard remains tracked under #44 follow-up

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

(After the PR is created, post the follow-up comments to issue #54, #43 per the spec's "Follow-up issue comments" section. PR merge is gated on user approval per `CLAUDE.md` — do NOT run `gh pr merge`.)

---

## Self-review checklist

After completing all 17 tasks, verify:

- [ ] All 17 commits present in `git log --oneline main..HEAD`, in plan order
- [ ] `git diff main..HEAD --stat` shows ~30 files changed, ~3k LOC churn
- [ ] All grep verifications from Task 15 + Task 16 still return zero
- [ ] `pnpm -r build && pnpm -r typecheck && pnpm -F @modeldoctor/{api,web} test` all green
- [ ] PR description matches the spec's scope (no out-of-scope drift)
- [ ] No `TODO` / `FIXME` / placeholder comments introduced
- [ ] No `as any` introduced (the spec's `as Run["summaryMetrics"]` cast is the only allowed `as` per the design rationale)

If a check fails, the failure goes into a small follow-up commit on the same branch (NOT amended into a prior task commit).
