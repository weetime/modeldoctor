# Issue #43 — Benchmark Baseline: mark a Run as the comparison anchor

**Status:** Draft — pending user approval
**Date:** 2026-05-02
**Branch:** `feat/benchmark-baseline` (cut from `main` after #69 merges)
**Issue:** [#43 — `[F.C1] Benchmark Baseline：把一次 Run 标记为参照`](https://github.com/weetime/modeldoctor/issues/43)

ModelDoctor's regression-comparison loop starts with the ability to freeze "this Run was the good one" as a stable anchor for future Runs to diff against. The schema work has already landed via #38 (the `Baseline` table exists, `Run.baselineId` and `Run.baselineFor` relations are wired), so this spec covers the missing CRUD module, the FK semantic correction that makes a baseline-anchored Run actually immutable, and the minimum UI surface that lets a user create / inspect / delete a baseline before #46 (the report page) lands.

This PR unblocks #44 (Re-run from baseline) and #45 (Diff engine) by giving them a baseline entity to reference.

## 1. Purpose and Scope

### 1.1 Problem

Without a "set as baseline" flow:

- There is no stable anchor for the diff engine in #45 (you can compare any two Runs, but you can't say "regress me against my known-good Run").
- "Re-run from baseline" in #44 has no source-of-truth Run to clone configuration from — the Run table has `baselineId` / `baselineFor` columns wired but nothing to populate them.
- /history is just a flat list with no marker for which Runs are reference points; the user can't filter to "show me my baselines" or "show me Runs that compare against a baseline".

### 1.2 What this spec delivers

- **`apps/api/src/modules/baseline/`** — new NestJS module with three JWT-guarded endpoints (`POST /baselines`, `GET /baselines`, `DELETE /baselines/:id`), modeled after the existing `connection` module.
- **Schema FK semantic fix** — `Baseline.run` flips from `onDelete: Cascade` to `onDelete: Restrict` so the database physically rejects `DELETE FROM runs WHERE id = <baseline-canonical>` instead of silently cascading to wipe the baseline. Issue #43 says "禁止删除", and `Cascade` is the opposite of that.
- **Run module extensions** — `GET /runs/:id` includes `baselineFor` so the detail page can render the toggle button without a second request; `GET /runs` accepts two new boolean filters (`isBaseline`, `referencesBaseline`) so /history can offer a baseline-axis filter.
- **`packages/contracts/src/baseline.ts`** — `BaselineDto`, `BaselineSummaryDto`, `CreateBaselineRequest`, `BaselineListResponse`. Plus `RunListQuery` adds `isBaseline` / `referencesBaseline`, and `RunDto` adds `baselineFor: BaselineSummaryDto | null`.
- **HistoryDetailPage UI** — a Set / Unset baseline toggle button in `PageHeader.rightSlot`, a `SetBaselineDialog` (name / description / tags), and an Unset confirm dialog.
- **HistoryFilters UI** — a three-state Baseline dropdown (`Any` / `Is a baseline` / `References a baseline`) wired to URL state.
- **`apps/web/src/features/baseline/`** — new feature directory with API client + react-query hooks (`useCreateBaseline`, `useDeleteBaseline`, `useBaselines`).
- **Tests** — Vitest specs covering happy paths, ownership scoping, 409-on-duplicate, and the FK-Restrict immutability check at the DB level.
- **Browser verification** — manual smoke documented in the PR description.

### 1.3 Explicit non-goals

- **Templates / TemplateVersion (#56)** — `Baseline.templateId` and `templateVersion` already exist on the schema as nullable. In #43 they are populated by copying from the source Run's columns, both of which are always `NULL` today. We do **not** introduce a `(userId, templateId)` unique constraint or "auto-deactivate prior baseline of same template" behavior. Tracked via an inline comment posted to #56.
- **Re-run (#44), Diff engine (#45), Report page (#46)** — the consumers of baseline. None implemented here.
- **Standalone `/baselines` list page** — issue #43 only specifies "Set as baseline" entry on the Run detail. Bulk view is a follow-up. Users delete baselines via the Unset button on the Run detail page, not a list-page row action.
- **POST /runs / Run params PATCH guards (#54)** — Run params immutability is enforced at the DB level (FK Restrict catches DELETE) but not at the service level for hypothetical future PATCH routes. The Run controller currently exposes only `@Get`, so service-level guards have no caller. Tracked via comment on #54.
- **"References baseline X" picker filter** — the filter dropdown is three-state today; the fourth state ("References baseline X" with a per-baseline picker) is deferred until #45 lands and the use case becomes concrete. Tracked via comment on #45.
- **`active` flag user-facing semantics** — the column exists and defaults `true`; #43 does not expose a deactivate / reactivate action. Becomes meaningful in #56.
- **Pagination on `GET /baselines`** — returns the full `items[]` for now. Cursor pagination is a trivial follow-up if the list grows.

### 1.4 Why one PR

The five layers (contracts, schema, baseline module, run module extensions, web UI) are the smallest unit that produces a usable feature. Splitting along layers (e.g. "API only this PR, UI next PR") would land an unused endpoint or an unwired button. The commits inside the PR are sequenced so that each one is independently reviewable and locally testable (see §2.5).

## 2. Architecture

### 2.1 Module layout

```
apps/api/src/modules/baseline/                   NEW
├── baseline.module.ts
├── baseline.controller.ts
├── baseline.controller.spec.ts
├── baseline.service.ts
└── baseline.service.spec.ts

apps/api/src/modules/run/
├── run.repository.ts                            MODIFY: add isBaseline / referencesBaseline filters; include baselineFor
├── run.repository.spec.ts                       MODIFY: cover the new filters and the include
├── run.service.ts                               MODIFY: pass baselineFor through to DTO
└── run.controller.ts                            unchanged

apps/api/prisma/
├── schema.prisma                                MODIFY: Baseline.run onDelete: Restrict
└── migrations/<TS>_baseline_run_immutability/   NEW (prisma-generated)
    └── migration.sql

apps/api/src/app.module.ts                       MODIFY: register BaselineModule

packages/contracts/src/
├── baseline.ts                                  NEW
├── baseline.spec.ts                             NEW
├── run.ts                                       MODIFY: add baselineFor to RunDto, isBaseline / referencesBaseline to RunListQuery
└── index.ts                                     MODIFY: re-export baseline.ts

apps/web/src/features/baseline/                  NEW
├── api.ts                                       fetch wrappers (createBaseline / deleteBaseline / listBaselines)
├── queries.ts                                   useCreateBaseline / useDeleteBaseline / useBaselines
└── queries.test.tsx

apps/web/src/features/history/
├── HistoryDetailPage.tsx                        MODIFY: Set/Unset button in PageHeader.rightSlot
├── SetBaselineDialog.tsx                        NEW
├── HistoryFilters.tsx                           MODIFY: Baseline three-state dropdown
├── HistoryListPage.tsx                          MODIFY: thread baseline filter through URL ↔ query
├── queries.ts                                   MODIFY: extend RunQuery with the two new filters
└── __tests__/
    ├── HistoryDetailPage.test.tsx               MODIFY: button states + dialog open
    ├── SetBaselineDialog.test.tsx               NEW
    └── HistoryFilters.test.tsx                  NEW (or MODIFY if exists)
```

i18n keys for the new affordances live in the existing `history` namespace; locale files are updated in the same commit that introduces each UI piece.

### 2.2 Data model

The `Baseline` Prisma model exists since #38. Only one field changes:

```prisma
model Baseline {
  // ... unchanged fields ...
  run Run @relation(
    "BaselineCanonicalRun",
    fields: [runId],
    references: [id],
    onDelete: Restrict   // was: Cascade
  )
  // ... unchanged ...
}
```

Effect: when something attempts `DELETE FROM runs WHERE id = <baseline.runId>`, Postgres raises a foreign-key violation (Prisma surfaces P2003) and the row is preserved. `Run.baseline` (the inverse — `Run.baselineId` referencing a baseline that the Run compares against) keeps `onDelete: SetNull`: deleting a baseline simply un-links the Runs that referenced it; their data stays intact.

`Baseline.runId` is already `@unique`; that constraint enforces "one baseline per Run" — the second attempt surfaces as P2002 and the service translates it to 409.

`templateId` / `templateVersion`: copied from the source Run on POST. Both fields on `Run` are always `NULL` today (no template feature), so both fields on `Baseline` will also always be `NULL`. The columns and copy logic exist in #43 so #56 does not need to backfill anything later.

`active`: column stays at default `true`. No code path in #43 sets it to `false`; #56's "auto-deactivate prior baseline when a new one for the same template arrives" logic will use this column.

The migration is produced by `pnpm prisma migrate dev --name baseline_run_immutability` and contains a single `ALTER TABLE "baselines" DROP CONSTRAINT ... ADD CONSTRAINT ... ON DELETE RESTRICT` pair.

### 2.3 API contract

#### POST /baselines

Request body (`CreateBaselineRequest`):

```ts
{
  runId: string;            // required, must belong to current user
  name: string;             // required, 1..200 chars
  description?: string;     // optional, defaults to null
  tags?: string[];          // optional, defaults to []
}
```

Server-side fills:

- `userId` from JWT
- `templateId`, `templateVersion` copied from source Run (always `null` today)
- `active` defaults to `true`

Responses:

- 201 → `BaselineDto` of the created row
- 400 → validation error (zod)
- 401 → no JWT
- 404 → `runId` not found, or not owned by current user
- 409 → P2002 on `runId` unique → `{ code: "BASELINE_ALREADY_EXISTS", message: "this Run already has a baseline" }`

#### GET /baselines

Request: no query parameters in #43.

Response 200:

```ts
{ items: BaselineDto[] }   // current user's baselines, createdAt desc
```

#### DELETE /baselines/:id

- 204 No Content on success. The canonical Run is untouched. Runs with `baselineId === <id>` get `baselineId = NULL` automatically via the existing `onDelete: SetNull` FK.
- 401 / 404 as expected.

#### Run module extensions (no new routes, additive only)

- `RunListQuery` adds:
  - `isBaseline?: boolean` → `where.baselineFor = { isNot: null }` (or `is: null`)
  - `referencesBaseline?: boolean` → `where.baselineId = { not: null }` (or `null`)
  - The two filters are independent; the UI in §2.4 uses at most one at a time.
- `RunDto` adds:
  - `baselineFor: BaselineSummaryDto | null` — populated by `prisma.run.findUnique({ include: { baselineFor: true } })`
- `BaselineSummaryDto` is `Pick<BaselineDto, "id" | "name" | "createdAt">`. It's the minimum needed for the detail page to know "is this a baseline, and what's it called". Full `BaselineDto` is fetched separately if a deeper view becomes necessary.

### 2.4 Frontend

#### HistoryDetailPage button states

```
run.baselineFor === null          →  [ Set as baseline ]            (variant: outline)
run.baselineFor !== null          →  [ ✓ Baseline · Unset ]         (variant: secondary)
```

Both buttons live in `PageHeader.rightSlot`, to the left of the existing Back button. Click handlers:

- `Set as baseline` → opens `<SetBaselineDialog runId={run.id} />`. On submit (POST /baselines), the dialog closes and react-query invalidates `["run", run.id]`, `["runs"]`, `["baselines"]`. The page re-renders with the Unset variant.
- `Unset` → opens a confirm dialog ("This will remove the baseline mark; the Run itself stays."). On confirm (DELETE /baselines/:id), same invalidations. The page re-renders with the Set variant.

`SetBaselineDialog` fields:

- `name` (required textbox, 1..200) — placeholder `"e.g. throughput-baseline-v1"`
- `description` (optional textarea)
- `tags` (optional comma-separated textbox; we don't introduce a new chips component in #43)

#### HistoryFilters Baseline dropdown

Single dropdown with three options:

```
Baseline:  [Any                       ▼]
              Any
              Is a baseline
              References a baseline
```

URL encoding: a single param `baseline` with values `is` / `ref` / absent. `HistoryListPage`'s existing `useSearchParams`-driven filter object reads/writes this and maps to `RunListQuery.{isBaseline | referencesBaseline}`.

#### `apps/web/src/features/baseline/`

A small feature directory whose purpose is the API client + react-query hooks. Putting it under `features/history/` would conflate it with the consumer; keeping it separate gives the future baselines list page a natural home.

```ts
// api.ts
export async function createBaseline(req: CreateBaselineRequest): Promise<BaselineDto>;
export async function deleteBaseline(id: string): Promise<void>;
export async function listBaselines(): Promise<BaselineListResponse>;

// queries.ts
export function useCreateBaseline(): UseMutationResult<BaselineDto, ApiError, CreateBaselineRequest>;
export function useDeleteBaseline(): UseMutationResult<void, ApiError, string>;
export function useBaselines(): UseQueryResult<BaselineListResponse, ApiError>;
```

`useCreateBaseline` and `useDeleteBaseline` invalidate `["run", runId]` (passed as `meta`), `["runs"]`, `["baselines"]` on success; surface 409 → toast `"This Run already has a baseline"`.

### 2.5 Commit sequencing

The PR contains 7 commits in this dependency order. Each compiles and lints independently; tests for the new code live in the same commit that introduces it.

| # | Commit | Notes |
|---|---|---|
| 1 | `build(contracts): add baseline DTOs + extend RunDto with baselineFor + RunListQuery filters` | Pure type / zod additions. No runtime change. |
| 2 | `build(api/prisma): flip Baseline.run FK to onDelete: Restrict` | Schema + prisma migration only. |
| 3 | `feat(api/baseline): POST/GET/DELETE /baselines + service guards` | New module + specs. |
| 4 | `feat(api/run): expose baselineFor on RunDto + isBaseline / referencesBaseline filters` | Extends repo + DTO mapping + specs. |
| 5 | `feat(web/baseline): API client + react-query hooks` | New feature directory; no UI yet. |
| 6 | `feat(web/history): Set/Unset baseline button + SetBaselineDialog on detail page` | Detail-page changes + i18n + tests. |
| 7 | `feat(web/history): baseline three-state filter dropdown` | Filter row + URL state + tests. |

Parallelizable: 5 with 3/4 (after 1 lands, contracts are stable); 6 with 7 (both depend on 5, independent of each other).

## 3. Verification

### 3.1 Unit tests

**Backend (`apps/api/`, vitest@2)**:

- `baseline.service.spec.ts`
  - create happy path → row inserted, returns DTO
  - create 404 when `runId` doesn't belong to current user
  - create 404 when `runId` doesn't exist
  - create 409 on duplicate `runId` (P2002 caught and translated)
  - list scoped to `userId`, ordered `createdAt desc`
  - delete happy path → `Baseline` row gone, referencing Runs' `baselineId` set to `NULL` (verified with explicit setup of a referencing Run)
  - delete 404 if not owned
  - **immutability**: explicit `prisma.run.delete({ where: { id: canonicalRunId } })` should reject with P2003
- `baseline.controller.spec.ts`
  - 401 without JWT for all three routes
  - happy paths return correct status codes (201 / 200 / 204)
- `run.repository.spec.ts` additions
  - `list({ isBaseline: true })` returns only Runs with non-null `baselineFor`
  - `list({ referencesBaseline: true })` returns only Runs with non-null `baselineId`
  - `findById` includes `baselineFor` in result

**Frontend (`apps/web/`, vitest@1 + jsdom)**:

- `HistoryDetailPage.test.tsx` additions
  - `baselineFor === null` → "Set as baseline" button rendered
  - `baselineFor !== null` → "✓ Baseline · Unset" button rendered
  - clicking Set opens `SetBaselineDialog`
  - clicking Unset opens confirm dialog
- `SetBaselineDialog.test.tsx`
  - required-field validation on name
  - submit calls mutation hook with correct payload
  - cancel closes without firing mutation
- `HistoryFilters.test.tsx` (or its existing equivalent)
  - dropdown three-state ↔ URL param round-trip
- `baseline/queries.test.tsx`
  - `useCreateBaseline` 409 → translated toast string

### 3.2 Browser smoke (documented in PR description)

1. `pnpm dev`; log in as `tz-verify@test.com` (account exists post-#69's verify pass).
2. Trigger a Run via `/load-test` or `/e2e` (whichever has the simplest one-click path at PR time).
3. From `/history`, open the run's detail page. Click "Set as baseline". Fill `name = "smoke-1"`. Submit.
4. Button flips to "✓ Baseline · Unset". `/history` filter "Is a baseline" includes this row; "References a baseline" excludes it.
5. Trigger a second Run (becomes a regular non-baseline Run). On its detail page the button is "Set as baseline" again.
6. From a shell: `psql ... -c "DELETE FROM runs WHERE id='<smoke-1-canonical>'"` → should reject with FK violation P2003.
7. On the smoke-1 detail page click "Unset". Confirm. Button flips back to "Set as baseline"; the underlying Run row is untouched; the Baseline row is gone (verifiable in psql).

### 3.3 Acceptance criteria

- [ ] `pnpm -r type-check` passes
- [ ] `pnpm -F @modeldoctor/web test` passes
- [ ] `pnpm -F @modeldoctor/api exec vitest run --no-file-parallelism` passes (parallel-flake against shared dev DB is pre-existing; not in scope)
- [ ] `pnpm -F @modeldoctor/api lint` and `pnpm -F @modeldoctor/web lint` introduce no new errors (the pre-existing biome format error in `packages/contracts/src/connection.ts` is out of scope)
- [ ] Browser smoke (§3.2) passes; screenshots in PR description
- [ ] `/history` filter URL ↔ state survives page refresh
- [ ] PR description closes #43

## 4. Cleanup obligations

Tracked as inline comments on the target issues so each future PR has the context inline:

1. **#56 (Templates)** — when templates land, add the deferred `(userId, templateId)` unique constraint plus auto-deactivate-old logic. [Comment posted](https://github.com/weetime/modeldoctor/issues/56#issuecomment-4361967360).
2. **#46 (Report page)** — relocate the Set/Unset button from `HistoryDetailPage.PageHeader.rightSlot` to the report-page header; `SetBaselineDialog` may move with it. [Comment posted](https://github.com/weetime/modeldoctor/issues/46#issuecomment-4362022809).
3. **#54 (POST /runs / Run mutation routes)** — add service-layer guards that refuse PATCH-style edits when `run.baselineFor != null`; catch P2003 on the existing internal Run delete path and surface a friendly error. [Comment posted](https://github.com/weetime/modeldoctor/issues/54#issuecomment-4362023294).
4. **#45 (Diff engine)** — extend `HistoryFilters` with a "References baseline X" fourth state backed by a `referencesBaselineId?: string` filter once a concrete navigation flow exists. [Comment posted](https://github.com/weetime/modeldoctor/issues/45#issuecomment-4362023704).

## 5. Out-of-scope (re-statement)

- Templates / TemplateVersion (#56)
- Re-run from baseline (#44)
- Diff engine (#45)
- Benchmark report page (#46)
- Standalone `/baselines` list page
- Pagination on GET /baselines
- POST /runs and Run params PATCH guards (#54)
- Baseline `active` flag user-facing toggles
- Per-baseline picker filter on /history

## 6. Files Touched (high-level — exact paths in plan)

**Create (~14):**
- `apps/api/src/modules/baseline/{baseline.module, baseline.controller, baseline.controller.spec, baseline.service, baseline.service.spec}.ts` (5)
- `apps/api/prisma/migrations/<TS>_baseline_run_immutability/migration.sql` (1)
- `packages/contracts/src/{baseline, baseline.spec}.ts` (2)
- `apps/web/src/features/baseline/{api, queries}.ts` + `queries.test.tsx` (3)
- `apps/web/src/features/history/SetBaselineDialog.tsx` + `__tests__/SetBaselineDialog.test.tsx` (2)
- `apps/web/src/features/history/__tests__/HistoryFilters.test.tsx` (1, NEW)

**Modify (~13):**
- `apps/api/prisma/schema.prisma` (FK Restrict)
- `apps/api/src/app.module.ts` (register BaselineModule)
- `apps/api/src/modules/run/run.repository.ts` (filters + include)
- `apps/api/src/modules/run/run.repository.spec.ts` (cover the new filters)
- `apps/api/src/modules/run/run.service.ts` (DTO mapping for `baselineFor`)
- `packages/contracts/src/run.ts` (filters + DTO field)
- `packages/contracts/src/index.ts` (re-export `baseline.ts`)
- `apps/web/src/features/history/HistoryDetailPage.tsx` (button + dialog wiring)
- `apps/web/src/features/history/HistoryListPage.tsx` (URL ↔ baseline filter param)
- `apps/web/src/features/history/HistoryFilters.tsx` (Baseline dropdown)
- `apps/web/src/features/history/queries.ts` (extend `RunQuery` filters)
- `apps/web/src/features/history/__tests__/HistoryDetailPage.test.tsx` (button states + dialog open)
- `apps/web/public/locales/<lang>/history.json` (i18n keys, one entry per existing locale)
