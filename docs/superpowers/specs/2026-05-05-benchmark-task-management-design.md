# Benchmark Task Management Fixes (#102 Class A)

**Date:** 2026-05-05
**Branch:** `fix/benchmark-task-management`
**Closes:** #102 (after Class B is split out as a new issue)
**Out of scope (split into new issue):** ImagePullBackOff awareness + task SSE logs (#102 sub-bug 5)

## Problem

[#102](https://github.com/weetime/modeldoctor/issues/102) reports five self-test bugs in the benchmark module. After triage, four are small frontend/contract changes that share one mental model ("task management actions and identification"). The fifth — perceiving K8s pod-level failures and streaming runner logs — needs a K8s pod watcher and SSE log channel; that work has its own architecture decisions and gets a separate issue.

This spec covers the first four:

1. Submitted-state benchmarks cannot be deleted (no button + backend rejects).
2. Detail page "back to list" link goes to `/benchmarks`, which is not a real list page (the actual lists live at `/benchmarks/{gateway,inference,capacity}`).
3. List page does not show task name.
4. Detail page has no Cancel button; users have no way to stop a running benchmark short of deleting it.

## Design

### bug 1 + 4 — Cancel and Delete semantics

**Backend (`apps/api/src/modules/benchmark/benchmark.service.ts`)**

- `service.delete`: remove the `TERMINAL_STATES` guard. When called on a non-terminal benchmark with a `driverHandle`, attempt `driver.cancel(driverHandle)` first on a best-effort basis (swallow errors and log a warning — `K8sJobDriver.cancel` already treats 404 as idempotent), then proceed with `repo.delete`. The user contract becomes: "Delete always works; cleanup of any backing K8s job is automatic."
- `service.cancel`: unchanged. Still only valid for non-terminal states; returns the benchmark in `canceled` state. `K8sJobDriver.cancel` already calls `deleteNamespacedJob`, so K8s cleanup on cancel is already correct.

**Frontend (`apps/web/src/features/benchmarks/BenchmarkDetailPage.tsx`)**

- Add a Cancel button (rendered only when `!isTerminal`). Wire to existing `useCancelBenchmark` hook in `queries.ts`.
- Relax Delete button visibility: render in **all** states (today it is gated by `isTerminal`).
- Disambiguate destructive-action UX: confirm dialogs for Cancel ("Cancel this running task?") and Delete ("Delete this task and clean up its K8s job?") stay distinct — no merged "force delete" flow.

**i18n** — add `detail.cancel.button`, `detail.cancel.confirmTitle`, `detail.cancel.confirmBody`, `detail.cancel.confirmAction` keys to `apps/web/public/locales/{en,zh}/benchmarks.json`.

### bug 2 — Detail-page back link

`BenchmarkDetailPage.tsx:332` currently renders `<Link to="/benchmarks">`. The router has no `/benchmarks` index route — only `/benchmarks/{gateway,inference,capacity}`. Replace with `<Link to={`/benchmarks/${benchmark.scenario}`}>` (scenario is on the loaded benchmark).

Sibling sweep:
- `apps/web/src/features/benchmarks/compare/BenchmarkComparePage.tsx` — check the back/cancel link.
- Any other route inside `features/benchmarks/` whose back action targets `/benchmarks`. Grep `to="/benchmarks"` in that subtree.

### bug 3 — List page shows name + name becomes required

**Schema migration**

- `apps/api/prisma/schema.prisma`: `name String?` → `name String` on `model Benchmark`.
- Generated migration via `pnpm -F api prisma migrate dev --create-only --name benchmark_name_required`.
  - Migration body: `ALTER TABLE "benchmarks" ALTER COLUMN "name" SET NOT NULL;`.
  - Pre-flight verified locally: `SELECT count(*) FROM benchmarks WHERE name IS NULL;` returns 0. `createBenchmarkRequestSchema.name` is already `z.string().min(1).max(128)`, so any new row already had a non-empty name. **No backfill needed.**

**Contract (`packages/contracts/src/benchmark.ts`)**

- `benchmarkSchema.name`: `z.string().nullable()` → `z.string()`.

**Frontend**

- `BenchmarkListShell.tsx`: add a "name" column as the first content column (after the checkbox, before `createdAt`). Cell renders `benchmark.name` directly — no `??` fallback.
- Sweep all `benchmark.name`-fallback sites; remove the fallback. Confirmed sites under `apps/web/src/features/benchmarks/`:
  - `BenchmarkDetailPage.tsx:188` — `title={benchmark.name ?? benchmark.id}` becomes `title={benchmark.name}`.
  - `BenchmarkDetailPage.tsx:166` — `const sourceName = benchmark.name?.trim() || \`run-${benchmark.id.slice(0, 8)}\`` (rerun source-name derivation) becomes `const sourceName = benchmark.name`.
  - `BenchmarkCreatePage.tsx:134` — toast message `t("create.submitted", { name: benchmark.name ?? benchmark.id })` becomes `name: benchmark.name`.
- i18n: add `columns.name` key to benchmarks namespace.

## Test plan

- **Backend unit:** `benchmark.service.spec.ts` — extend the delete describe block:
  - delete on `submitted` calls `driver.cancel` and then `repo.delete`.
  - delete on `submitted` proceeds even when `driver.cancel` throws (best-effort).
  - delete on `completed` does not call `driver.cancel`.
- **Frontend component:** `BenchmarkDetailPage.test.tsx`
  - Cancel button visible for non-terminal statuses (`pending`, `submitted`, `running`); hidden for terminal (`completed`, `failed`, `canceled`).
  - Delete button visible in all six states.
- **Frontend component:** `BenchmarkListShell` (add or extend test) — first row renders `benchmark.name`.
- **Migration smoke:** run `pnpm -F api prisma migrate dev` on local DB; confirm column shows NOT NULL (`\d benchmarks`).
- **Manual:** `pnpm dev`, navigate `/benchmarks/gateway` → click into a detail page → "back" returns to `/benchmarks/gateway` (not `/benchmarks`). Try Cancel on a submitted run, confirm K8s job is deleted (`kubectl get jobs -n modeldoctor-benchmarks`).

## Commit plan (one PR, sequenced commits)

1. `feat(contracts,api): require non-null benchmark name` — Prisma migration + schema update + contract change.
2. `fix(api): allow delete on non-terminal benchmark with best-effort driver cancel` — `service.delete` change + unit tests.
3. `fix(web): scenario-aware back link on benchmark detail and compare pages` — bug 2.
4. `feat(web): add cancel action to benchmark detail page` — Cancel button + i18n + tests.
5. `feat(web): show benchmark name in list and remove id fallbacks` — list column + remove `?? id` sites.

## Out of scope — to be split into new issue

**Title:** "K8s pod watcher + benchmark task SSE logs"

**Body draft:**

> Currently the benchmark API only learns about run state via the callback v2 channel from the runner pod (post `state=running`). Pre-runner-start failures — `ImagePullBackOff`, `CrashLoopBackOff`, scheduler errors, image pull timeouts — never trigger a callback, so the benchmark sits in `submitted` indefinitely.
>
> Repro: create a benchmark whose container image cannot be pulled (e.g. typo'd image tag).
> Expected: benchmark transitions to `failed` with a `statusMessage` describing the K8s reason within ~30s.
> Actual: benchmark stays `submitted` forever; only `kubectl get pods` reveals the cause.
>
> **Required work:**
>
> 1. **K8s pod watcher in `apps/api/src/modules/benchmark/`** — informer or polling loop that watches pods labeled with the benchmark's `runId`. On Pending+ImagePullBackOff/CrashLoopBackOff/Error past a threshold (e.g. 60s), call `service.markFailed(runId, statusMessage=<reason: message>)`.
> 2. **Streaming task logs over SSE** — extend `SseHub` or add a sibling channel (`SseHub` today only carries `ProgressEvent` from runner). Pull pod logs via the K8s logs API (follow=true) and forward chunks as SSE events keyed on `runId`. Frontend detail page subscribes and renders a log panel.
>
> Open design questions:
>
> - Single watcher process vs. per-runId goroutine/Subject. NestJS singleton service hosting an `Informer` is probably simplest.
> - Log retention: do we persist the streamed logs to DB / object store, or are they ephemeral and only visible while the pod still exists?
> - Behavior on pod restart (CrashLoopBackOff) — emit one combined log stream or one per attempt?
>
> **Split off from #102 (sub-bug 5)** so the simpler task-management fixes can ship first.

The new issue is created during implementation (before merging this PR) so the closing commit can reference both: `closes #102` and `refs #<new>` for the carry-over.

## Risks and notes

- The Prisma migration is the only DB-touching change. It is non-destructive (no data backfill, no column drop), but per repo policy any DB change requires the user to apply it locally — agent will not run `prisma migrate dev` without explicit approval if it would conflict with local drift. We will verify with a dry-run plan first.
- The relaxed `service.delete` semantics break the previous "must cancel first" contract. Any caller that relied on a 4xx for delete-on-non-terminal will now get 200. Search confirms only the frontend Detail page invokes delete; no other internal caller.
- Bug 5 carry-over is tracked via the new issue. The Class A PR uses `closes #102` because all of #102's listed sub-bugs except sub-bug 5 are addressed, and sub-bug 5 explicitly migrates to the new issue.
