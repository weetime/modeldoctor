# Issue #54 — Test Plan UI + FE migration to `/api/runs` (design)

**Date:** 2026-05-02
**Issue:** [weetime/modeldoctor#54](https://github.com/weetime/modeldoctor/issues/54)
**Branch:** `feat/issue-54-test-plan-ui` (cut from `main` @ `198089c`)
**Unblocker:** #53 (Tool Adapter Framework) merged via PR #76; this PR completes the cutover.

## Summary

Single PR that:

1. Builds the slimmed-down Test Plan UI form (Connection + Tool + adapter-driven dynamic params) at a new `/runs/new` route.
2. Augments the existing run-detail page with a `discriminated-union` switch over `Run.summaryMetrics.tool` to render per-tool report views.
3. Renames the legacy `/history` feature to `/runs` (REST-resource alignment with the `Run` contract).
4. Deletes the legacy `/api/benchmarks` and `/api/load-test` controllers, their facade mappers, modules, and the two legacy contract files.
5. Deletes the legacy `apps/web/src/features/benchmark/` and `apps/web/src/features/load-test/` directories (both depend on the contracts being deleted).
6. Replaces the temporary inline admin check in the deleted facades with a spec'd `?scope=all` admin authz pattern on `/api/runs`.

## Out of scope

- `PATCH /api/runs/:id` (no surface for it yet — Run params immutability guard from #43 stays deferred until PATCH lands).
- Generic Run reconciler for runs stuck in `running` (separate issue spun out at PR-merge time per `feedback_temp_followups.md`).
- `apps/api/vitest.config.mts` `fileParallelism: false` → per-worker postgres schema isolation (separate issue spun out at PR-merge time).
- "Quick load test" rich UX (the legacy `/load-test` curl-parser + per-apiType prompt forms) — confirmed dead at the backend boundary (`legacyToCreateRun` only forwards `apiType + rate + duration` to the vegeta adapter; the rich form fields never reach vegeta). If a future "curl-import quick load test" need arises, it gets its own issue.

## Routes & file layout (end state)

### Routes

| Path | Component | Purpose |
| --- | --- | --- |
| `/runs` | `RunListPage` | Run history list (renamed from `/history`) |
| `/runs/new` | `RunCreatePage` | Test Plan UI form (new) |
| `/runs/:id` | `RunDetailPage` | Run detail + tool-discriminated `*ReportView` (renamed from `/history/:runId`, augmented) |

Sidebar gets a single "Runs" entry pointing at `/runs`. The list page's header CTA "New Run" links to `/runs/new`. Legacy "Benchmarks" and "Load Test" sidebar entries are removed.

### File layout (new + renames)

```
apps/web/src/features/runs/                       # renamed from features/history/
├── api.ts                                        # runApi (renamed from historyApi)
├── queries.ts                                    # runKeys / useRunList / useRunDetail / useCreateRun / useCancelRun / useDeleteRun
├── RunListPage.tsx                               # renamed from HistoryListPage
├── RunListFilters.tsx                            # renamed from HistoryFilters
├── RunCreatePage.tsx                             # NEW: Test Plan form shell
├── RunDetailPage.tsx                             # renamed from HistoryDetailPage + switch over summaryMetrics.tool
├── RunDetailMetadata.tsx                         # renamed from HistoryDetailMetadata
├── RunDetailRawOutput.tsx                        # renamed from HistoryDetailRawOutput
├── SetBaselineDialog.tsx                         # unchanged (baseline functionality stays)
├── components/
│   └── MetricCard.tsx                            # NEW: shared <Card>+<KV> primitive used by all *ReportView
├── forms/
│   ├── GuidellmParamsForm.tsx                    # NEW
│   ├── VegetaParamsForm.tsx                      # NEW
│   └── GenaiPerfParamsForm.tsx                   # NEW
├── reports/
│   ├── GuidellmReportView.tsx                    # NEW
│   ├── VegetaReportView.tsx                      # NEW
│   ├── GenaiPerfReportView.tsx                   # NEW
│   └── UnknownReportView.tsx                     # NEW: graceful fallback for un-recognized envelope shapes
└── __tests__/                                    # parallel test layout for the above
```

`HistoryDetailMetrics.tsx` is **deleted** — replaced by the four `reports/*ReportView.tsx` components.

### File deletions

```
apps/web/src/features/benchmark/                  # entire directory (13 files + __tests__/)
apps/web/src/features/load-test/                  # entire directory (forms/, schemas, store, page, tests)
apps/web/public/locales/en/benchmark.json
apps/web/public/locales/zh/benchmark.json
apps/web/public/locales/en/load-test.json
apps/web/public/locales/zh/load-test.json

apps/api/src/modules/benchmark/                   # 5 files: controller + spec + module + facade-mappers + spec
apps/api/src/modules/load-test/                   # 5 files: same shape
packages/contracts/src/benchmark.ts
packages/contracts/src/load-test.ts
```

`apps/api/src/app.module.ts` removes `BenchmarkModule` + `LoadTestModule` imports/providers. `packages/contracts/src/index.ts` removes the two `export * from "./benchmark.js"` / `"./load-test.js"` lines.

### i18n

- `apps/web/public/locales/{en,zh}/history.json` → `runs.json`. Existing top-level keys (`title`, `subtitle`, `columns.*`, `detail.*`, etc.) keep their paths verbatim under the renamed namespace. New sub-namespaces added on top: `create.*`, `forms.guidellm.*`, `forms.vegeta.*`, `forms.genaiPerf.*`, `reports.guidellm.*`, `reports.vegeta.*`, `reports.genaiPerf.*`, `reports.unknown.*`. All `useTranslation("history")` call-sites become `useTranslation("runs")`.
- `apps/web/public/locales/{en,zh}/{benchmark,load-test}.json` → deleted.
- Sidebar nav i18n strings: "Benchmarks" / "Load Test" removed; "History" → "Runs".

## Backend changes

### Admin authz on `/api/runs` (replaces inline temp from PR #76 commit `4b73d7b`)

Contract change in `packages/contracts/src/run.ts`:

```ts
export const listRunsQuerySchema = z.object({
  // ...existing fields...
  scope: z.enum(["own", "all"]).default("own"),
});
```

Controller in `apps/api/src/modules/run/run.controller.ts` does inline admin checks (4 endpoints, ~12 LOC total — not enough surface to justify a custom decorator):

```ts
@Get()
list(@CurrentUser() user, @Query(...) query) {
  if (query.scope === "all" && !user.roles.includes("admin")) {
    throw new ForbiddenException({
      code: "RUN_SCOPE_FORBIDDEN",
      message: "admin role required for scope=all",
    });
  }
  return this.service.list(query, query.scope === "all" ? undefined : user.sub);
}

@Get(":id")
detail(@CurrentUser() user, @Param("id") id) {
  // implicit admin elevation — admin can see any run by id
  return this.service.findByIdOrFail(id, user.roles.includes("admin") ? undefined : user.sub);
}

@Post(":id/cancel")
cancel(@CurrentUser() user, @Param("id") id) {
  return this.service.cancel(id, user.roles.includes("admin") ? undefined : user.sub);
}

@Delete(":id")
@HttpCode(204)
async delete(@CurrentUser() user, @Param("id") id) {
  await this.service.delete(id, user.roles.includes("admin") ? undefined : user.sub);
}
```

`RunService` signatures: `cancel` and `delete` currently take `userId: string` (required) — relax both to `userId?: string` with the same "undefined skips ownership check" semantics as `list` / `findByIdOrFail`. **Why:** unified ownership-check semantics across all four service methods; single concept (`undefined === unscoped`) instead of two patterns. **How to apply:** when `userId` is supplied, the run row's `userId` must match (else `NotFoundException`); when `undefined`, no ownership filter is applied.

### Backend file deletions

Delete in same PR (after FE no longer imports the legacy contracts):

```
apps/api/src/modules/benchmark/benchmark.controller.ts
apps/api/src/modules/benchmark/benchmark.controller.spec.ts
apps/api/src/modules/benchmark/benchmark.module.ts
apps/api/src/modules/benchmark/benchmark-facade.mappers.ts
apps/api/src/modules/benchmark/benchmark-facade.mappers.spec.ts
apps/api/src/modules/load-test/load-test.controller.ts
apps/api/src/modules/load-test/load-test.controller.spec.ts
apps/api/src/modules/load-test/load-test.module.ts
apps/api/src/modules/load-test/load-test-facade.mappers.ts
apps/api/src/modules/load-test/load-test-facade.mappers.spec.ts
packages/contracts/src/benchmark.ts
packages/contracts/src/load-test.ts
```

`LoadTestController.waitForTerminal` (long-poll up to 1h, no client-disconnect cancel) goes away with the controller — no separate cleanup step needed.

### Internal-callback contract — no changes

`runStateCallbackSchema`, `runLogCallbackSchema`, `runFinishCallbackSchema` (the worker → API channel) stay as-is. The legacy `/api/internal/benchmarks/*` callback paths, if still wired, are out of scope here — they are only relevant to the BenchmarkController, which is being deleted; if any worker images still POST to them, that surfaces as a runtime 404 visible during manual verification (§Verification gates).

### BE grep verification (before delete)

Confirm no other module imports the legacy contracts (`Benchmark*`, `LoadTest*`, `loadTestApiTypePath`):

```sh
grep -rn 'from "@modeldoctor/contracts"' apps/api/src \
  | grep -E 'Benchmark|LoadTest|loadTestApi' \
  | grep -v 'modules/benchmark/\|modules/load-test/'
```

Expected: empty. If non-empty, those references are migrated to `Run` contracts inline in this PR (or, if too large, split into a follow-up — but expected to be zero based on current grep).

## Frontend changes

### `RunCreatePage.tsx` (new — Test Plan UI form shell)

Top-down structure:

```
PageHeader(title="New Run", subtitle="Configure a benchmark to launch")
└─ form (react-hook-form, zodResolver(createRunRequestSchema))
   ├─ Section "Endpoint"
   │  └─ <EndpointPicker /> (existing component from features/connections; binds connectionId)
   ├─ Section "Tool"
   │  └─ <Select /> over [guidellm | vegeta | genai-perf]
   ├─ Section "Run metadata"
   │  ├─ <Input name="name" /> (required, 1-128)
   │  └─ <Textarea name="description" /> (optional, max 2048)
   ├─ Section "Parameters"
   │  └─ Tool-switched: <GuidellmParamsForm /> | <VegetaParamsForm /> | <GenaiPerfParamsForm />
   └─ Footer: [Cancel] [Submit]
```

**Tool-switch behavior:** `form.watch("tool")` triggers `form.reset({ tool, connectionId, name, description, params: byTool(tool).paramDefaults })` — clears stale per-tool params so guidellm fields never leak into a vegeta submission.

**Submit flow:**

1. `useCreateRun` mutation → `POST /api/runs` with body `{ tool, kind: "benchmark", connectionId, name, description?, params }`.
2. Success → `navigate('/runs/<id>')` + `toast.success("Run \"<name>\" submitted")`.
3. Error → `toast.error` showing backend `code` + `message` (zod 422 / `RUN_NAME_IN_USE` 409 / connection-not-found 400 / `RUN_SCOPE_FORBIDDEN` won't fire here / etc.).

### `forms/{Tool}ParamsForm.tsx` (×3 new)

Each form owns its tool's field set, shares a layout convention (shadcn `<FormField>` + `<Label>` + `<Input>` / `<Select>` / `<Switch>`). Field defaults and validation schemas are sourced by direct named imports from `@modeldoctor/tool-adapters/schemas` — the package's dedicated FE-safe subpath entry. **Why the subpath:** `@modeldoctor/tool-adapters/schemas` is documented (`packages/tool-adapters/src/schemas-entry.ts`) as the schema-only entry that does NOT transitively pull in `runtime.ts` files (which depend on `child_process` / `fs`). Importing from the package root would drag the full `ToolAdapter` registry — including `buildCommand` and `parseFinalReport` runtime methods — into the FE bundle.

`byTool` (registry lookup) lives on the root entry only and is **not** used by the FE. Each `*ParamsForm` imports its own constants directly:

```ts
// forms/GuidellmParamsForm.tsx
import { guidellmParamDefaults, guidellmParamsSchema, type GuidellmParams }
  from "@modeldoctor/tool-adapters/schemas";
```

`RunCreatePage` switches between the three `*ParamsForm` components by a literal `switch (tool)` — no runtime registry needed for form selection.

- **`GuidellmParamsForm`**: `profile`, `apiType`, `datasetName`, `requestRate`, `totalRequests`, `maxDurationSeconds`, `maxConcurrency`, `processor`, `validateBackend`. Conditionally renders `datasetInputTokens` + `datasetOutputTokens` when `datasetName === "random"` (matches the adapter's `superRefine`). Help text on `requestRate`: "0 = unlimited (open-loop max throughput)".
- **`VegetaParamsForm`**: `apiType`, `rate`, `duration`. Three fields total.
- **`GenaiPerfParamsForm`**: `endpointType`, `numPrompts`, `concurrency`, `inputTokensMean`, `inputTokensStddev`, `outputTokensMean`, `outputTokensStddev`, `streaming`.

`apps/web/package.json` adds `@modeldoctor/tool-adapters` as a workspace dep. All FE imports go through the `/schemas` subpath only.

### `RunDetailPage.tsx` (renamed from `HistoryDetailPage`, augmented)

Replaces `<HistoryDetailMetrics metrics={run.summaryMetrics} />` with a `ReportSection` that runtime-validates the envelope against the per-tool `*ReportSchema` (imported from `@modeldoctor/tool-adapters/schemas`):

```tsx
import {
  guidellmReportSchema,
  vegetaReportSchema,
  genaiPerfReportSchema,
} from "@modeldoctor/tool-adapters/schemas";

function ReportSection({ metrics }: { metrics: Run["summaryMetrics"] }) {
  if (!metrics) return <EmptyMetricsState />;

  // Run.summaryMetrics is z.record(z.unknown()).nullable() in the contract,
  // so we runtime-validate against the per-tool report schema before rendering.
  const tagged = metrics as { tool?: string; data?: unknown };
  switch (tagged.tool) {
    case "guidellm": {
      const parsed = guidellmReportSchema.safeParse(tagged.data);
      return parsed.success
        ? <GuidellmReportView data={parsed.data} />
        : <UnknownReportView raw={metrics} reason={parsed.error.message} />;
    }
    case "vegeta": {
      const parsed = vegetaReportSchema.safeParse(tagged.data);
      return parsed.success
        ? <VegetaReportView data={parsed.data} />
        : <UnknownReportView raw={metrics} reason={parsed.error.message} />;
    }
    case "genai-perf": {
      const parsed = genaiPerfReportSchema.safeParse(tagged.data);
      return parsed.success
        ? <GenaiPerfReportView data={parsed.data} />
        : <UnknownReportView raw={metrics} reason={parsed.error.message} />;
    }
    default:
      return <UnknownReportView raw={metrics} reason="unknown report envelope" />;
  }
}
```

**Why the runtime parse:** `Run.summaryMetrics` is `z.record(z.unknown()).nullable()` at the contract layer (the Run DTO is generic across tools). Per-tool report shapes are owned by `@modeldoctor/tool-adapters`. Running each tool's `*ReportSchema.safeParse` on the FE narrows the type for the view component AND survives any envelope drift (pre-#53 rows, future schema additions) by falling back to `UnknownReportView` instead of throwing.

### `reports/{Tool}ReportView.tsx` (×3 new) + `UnknownReportView.tsx`

Each takes `data: {Tool}Report` (already zod-parsed by the parent `ReportSection`) and renders a card grid of that tool's metrics:

- **`GuidellmReportView`**: 4×3 grid for `ttft / itl / e2eLatency` × `mean / p50 / p95 / p99`; throughput row for RPS / outputTPS / inputTPS / totalTPS; concurrency mean/max; requests success/error/incomplete vs total.
- **`VegetaReportView`**: requests `total / rate / throughput`; latencies `min / mean / p50 / p90 / p95 / p99 / max` (already normalized to ms by the adapter parser); success%; status-code histogram table; errors list (top N).
- **`GenaiPerfReportView`**: `requestThroughput`, `requestLatency` (full dist), `timeToFirstToken` (full dist), `interTokenLatency` (full dist), `outputTokenThroughput`, `outputSequenceLength`, `inputSequenceLength` cards.
- **`UnknownReportView`**: `<Card>` with title "Report shape not recognized", subtitle showing the `reason`, and a `<pre>` block of `JSON.stringify(raw, null, 2)`. Visual hint: amber border / muted background — degrades gracefully without breaking the page.

All four reuse a shared `components/MetricCard.tsx` primitive (Card + KV grid), colocated under `features/runs/components/`. Promotion to `apps/web/src/components/common/` is deferred until a second feature needs the primitive.

### FE grep verification (after deletes)

```sh
# Should return zero hits:
grep -rn 'from "@modeldoctor/contracts"' apps/web/src \
  | grep -E 'Benchmark|LoadTest|loadTestApi'

grep -rn '"/benchmarks\|"/load-test' apps/web/src

grep -rn 't("benchmark[.:]\|t("load-test[.:]' apps/web/src

# FE must only import via the schema-only subpath, never the package root
# (root entry transitively pulls runtime.ts files that depend on child_process / fs):
grep -rn 'from "@modeldoctor/tool-adapters"' apps/web/src    # zero hits expected
grep -rn 'from "@modeldoctor/tool-adapters/' apps/web/src    # only `/schemas` allowed
```

## Testing

### Backend (vitest@2)

`run.controller.spec.ts` (extended):

- list with `scope=all` as non-admin → 403 `RUN_SCOPE_FORBIDDEN`.
- list with `scope=all` as admin → returns runs across all users.
- list without `scope` → defaults to own.
- detail of another user's run as admin → returns it.
- detail of another user's run as non-admin → 404.
- cancel of another user's run as admin → succeeds.
- cancel of another user's run as non-admin → 404.
- delete of another user's run as admin → succeeds.
- delete of another user's run as non-admin → 404.

`run.service.spec.ts`:

- `cancel(id, undefined)` (admin elevation) succeeds across user boundaries.
- `delete(id, undefined)` succeeds across user boundaries.
- `delete` of an admin-elevated request against a baseline-linked run → P2003 surfaces as a friendly error (re-uses existing FK Restrict, confirming admin path doesn't bypass it).

### Frontend (vitest@1)

- `forms/{Tool}ParamsForm.test.tsx` ×3: defaults render correctly, required-field validation triggers, cross-field rules (guidellm random → input/output tokens required) work.
- `reports/{Tool}ReportView.test.tsx` ×3: renders all metric fields from a fixture; missing optional fields don't crash.
- `RunCreatePage.test.tsx`: tool switch resets the params subtree; happy-path submit calls `useCreateRun` with correct body; 422 → toast; 409 RUN_NAME_IN_USE → toast and name field highlighted; submit disabled when `connectionId` empty or mutation pending.
- `RunDetailPage.test.tsx`: each of the three `summaryMetrics` envelopes renders the corresponding `*ReportView`; `null` shows `<EmptyMetricsState>`; envelope with unknown `tool` field renders `<UnknownReportView>`; envelope where `data` fails zod parse renders `<UnknownReportView>`.
- `RunListPage.test.tsx`: largely inherited from `HistoryListPage.test.tsx` (rename only — paths updated to `/runs/:id`, filter behavior unchanged).

### Manual verification checklist

After landing locally:

1. Reset dev DB: `pnpm -F @modeldoctor/api prisma migrate reset --force`. Restart dev server.
2. Create connections in `/connections` (one valid OpenAI-compatible endpoint).
3. `/runs/new` → submit a guidellm run. Verify navigation lands on `/runs/<id>` and the page polls until terminal, then shows `<GuidellmReportView>`.
4. Repeat for vegeta and genai-perf.
5. Create a second user with role `admin`. From admin browser session: `/runs?scope=all` (manual URL) → list shows all users' runs. From non-admin session: same URL → 403 toast.
6. As admin, navigate directly to a non-owned run's detail page → renders normally. As non-admin, same → "Run not found" empty state.
7. Verify deleted routes 404 cleanly: `/benchmarks`, `/benchmarks/:id`, `/load-test` should hit the FE `not-found` route.

## Verification gates (pre-PR)

```sh
pnpm install --frozen-lockfile
pnpm -r build                   # confirms packages/*/dist regenerate cleanly across rename
pnpm -r typecheck
pnpm -F @modeldoctor/api test
pnpm -F @modeldoctor/web test
pnpm -F @modeldoctor/api lint && pnpm -F @modeldoctor/api format
pnpm -F @modeldoctor/web lint && pnpm -F @modeldoctor/web format
```

GitHub Actions CI must pass before merge.

## Edge cases & error handling

| Scenario | Behavior |
| --- | --- |
| Form `connectionId` empty | Submit button disabled |
| `name` collides with another active run for same user | toast `RUN_NAME_IN_USE`; form not reset; name field highlighted |
| `params` zod fails (FE schema drift bug) | toast `RUN_PARAMS_INVALID` with field path |
| Connection deleted between form-load and submit | `BadRequestException("Connection no longer exists")` → toast |
| BE driver fails to start | Run row written with `status=failed` + `statusMessage` synchronously; FE navigates and sees failed state immediately |
| `/runs/:id` unknown id | `useRunDetail` 404 → existing `EmptyState` "Run not found" (already implemented in `HistoryDetailPage`) |
| Pre-#53 raw `summaryMetrics` rows (no `{tool, data}` envelope) | `ReportSection` discriminator `undefined` → `<UnknownReportView>` shows raw JSON without crashing |
| Tool switched after partial fill | `form.reset()` clears `params` to new tool's defaults — prevents cross-tool field leakage |
| Submit clicked twice | `mutation.isPending` disables submit |

## Schema migration

No Prisma schema changes. Code-only refactor.

Pre-existing dev DB rows whose `summaryMetrics` predate the `{tool, data}` envelope (#53) will render via `<UnknownReportView>`. Per `feedback_dev_db_disposable.md`, developers should `pnpm -F @modeldoctor/api prisma migrate reset --force` after pulling this PR locally to drop those rows. No production migration required (this is pre-launch).

## Follow-up issue comments (post-merge per `feedback_temp_followups.md`)

- **#54 (this issue)**: post a "merged; remaining out-of-scope items" comment listing:
  - `apps/api/vitest.config.mts` `fileParallelism: false` → per-worker postgres schema isolation. Open as new issue.
  - Generic Run reconciler for runs stuck in `running` past their deadline. Open as new issue.
  - `LoadTestController.waitForTerminal` long-poll path is **closed** by this PR (file deleted with controller).
- **#43 (baseline immutability)**: post that admin authz tests + the existing `Baseline.run` `onDelete: Restrict` cover delete-immutability; PATCH /runs surface still doesn't exist, so the params-immutability guard remains tracked under #44's follow-up comment.
- **#44 (rerun)**: no follow-up needed; this PR neither adds nor changes `PATCH /runs`.

## CLAUDE.md update

`CLAUDE.md` (repo root) currently references `apps/web/src/features/load-test/LoadTestPage.tsx` as the canonical "non-playground page" example for the page-layout convention. That file is deleted by this PR. The reference is updated to point to a surviving non-playground page — preferred target: `apps/web/src/features/runs/RunCreatePage.tsx` (newly authored to spec, demonstrates `<PageHeader title subtitle />` + body sections cleanly).

## Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| Renaming `/history` → `/runs` breaks bookmarked URLs | Acceptable — pre-launch, no external users; documented in PR description |
| Forgetting to import schemas from the `/schemas` subpath drags Node-only `runtime.ts` modules into the FE bundle (would break Vite build with `child_process` / `fs` resolution errors) | Spec mandates the subpath everywhere; lint catches it via existing `apps/web/biome.json` no-unused-imports + a manual grep before PR push: `grep -rn 'from "@modeldoctor/tool-adapters"' apps/web/src` should return zero hits (only `/schemas` is allowed) |
| Large diff (~30 files, ~3k LOC) makes review hard | One-task-one-commit conventional-commit discipline + the PR description maps each commit to a section of this spec |
| Renames hide logic regressions in moved files | First commit of each rename is `git mv` only (no content change), so subsequent diffs are reviewable as logic changes only |
| Stale CLAUDE.md `LoadTestPage` reference left behind | Explicit CLAUDE.md edit included in the same PR (see "CLAUDE.md update" section above) |
