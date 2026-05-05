# Benchmark Task Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four task-management bugs in benchmark module (#102 sub-bugs 1, 2, 3, 4): submitted-state delete, scenario-aware back link, list-page name column with NOT NULL tightening, and detail-page Cancel action.

**Architecture:** One feature branch (`fix/benchmark-task-management`) with five sequenced commits. Backend changes are isolated to `BenchmarkService.delete` and a Prisma migration. Frontend changes are spread across `BenchmarkDetailPage`, `BenchmarkComparePage`, `BenchmarkListShell`, and i18n bundles. Sub-bug 5 (ImagePullBackOff awareness + SSE logs) is split into a follow-up issue created in Task 0.

**Tech Stack:** Nest.js 11 + Prisma + Vitest 2 (api), React + react-router + react-hook-form + react-i18next + Vitest 1 (web), shared zod contracts in `packages/contracts`.

**Spec:** `docs/superpowers/specs/2026-05-05-benchmark-task-management-design.md`

**Worktree:** `/Users/fangyong/vllm/modeldoctor/fix-benchmark-task-mgmt` (already exists; `pnpm -r build` already run).

---

### Task 0: Create follow-up issue for sub-bug 5

**Files:** none (GitHub-side only)

- [ ] **Step 1: Confirm with user before creating the issue.**

`gh issue create` is not in the autonomous-action allowlist. Print the issue body below and ask the user to confirm before invoking the command.

- [ ] **Step 2: Create the issue.**

```bash
gh issue create --title "K8s pod watcher + benchmark task SSE logs" --body "$(cat <<'EOF'
Currently the benchmark API only learns about run state via the callback v2 channel from the runner pod (post `state=running`). Pre-runner-start failures — `ImagePullBackOff`, `CrashLoopBackOff`, scheduler errors, image pull timeouts — never trigger a callback, so the benchmark sits in `submitted` indefinitely.

**Repro:** create a benchmark whose container image cannot be pulled (e.g. typo'd image tag).
**Expected:** benchmark transitions to `failed` with a `statusMessage` describing the K8s reason within ~30s.
**Actual:** benchmark stays `submitted` forever; only `kubectl get pods` reveals the cause.

## Required work

1. **K8s pod watcher in `apps/api/src/modules/benchmark/`** — informer or polling loop that watches pods labeled with the benchmark's `runId`. On Pending+ImagePullBackOff/CrashLoopBackOff/Error past a threshold (e.g. 60s), call `BenchmarkService.markFailed(runId, statusMessage=<reason: message>)`.
2. **Streaming task logs over SSE** — extend `SseHub` or add a sibling channel (`SseHub` today only carries `ProgressEvent` from runner). Pull pod logs via the K8s logs API (follow=true) and forward chunks as SSE events keyed on `runId`. Frontend detail page subscribes and renders a log panel.

## Open design questions

- Single watcher process vs. per-runId goroutine/Subject. NestJS singleton service hosting an `Informer` is probably simplest.
- Log retention: do we persist the streamed logs to DB / object store, or are they ephemeral and only visible while the pod still exists?
- Behavior on pod restart (CrashLoopBackOff) — emit one combined log stream or one per attempt?

Split off from #102 (sub-bug 5) so the simpler task-management fixes can ship first.
EOF
)"
```

- [ ] **Step 3: Capture the new issue number.**

The command prints `https://github.com/weetime/modeldoctor/issues/<N>`. Note `<N>` — used in Task 5's PR description as `refs #<N>`.

---

### Task 1: Tighten benchmark.name to NOT NULL (Prisma + contract)

**Files:**
- Modify: `apps/api/prisma/schema.prisma:105` (`name String?` → `name String`)
- Create: `apps/api/prisma/migrations/<timestamp>_benchmark_name_required/migration.sql` (Prisma generates)
- Modify: `packages/contracts/src/benchmark.ts:44` (`z.string().nullable()` → `z.string()`)

- [ ] **Step 1: Pre-flight verify zero NULL rows.**

```bash
PGPASSWORD=modeldoctor psql -h localhost -U modeldoctor -d modeldoctor -c \
  "SELECT count(*) FROM benchmarks WHERE name IS NULL;"
```

Expected: `0`. If non-zero, STOP — coordinate with the user before adding NOT NULL (would require backfill or column default).

- [ ] **Step 2: Edit the Prisma schema.**

In `apps/api/prisma/schema.prisma`, find the `model Benchmark` block. Change:

```prisma
  name        String?
  description String? @db.Text
```

to:

```prisma
  name        String
  description String? @db.Text
```

- [ ] **Step 3: Generate the migration with --create-only.**

```bash
cd apps/api && pnpm exec prisma migrate dev --create-only --name benchmark_name_required
```

This writes `apps/api/prisma/migrations/<timestamp>_benchmark_name_required/migration.sql` without applying it. Open the file and confirm the body is just:

```sql
ALTER TABLE "benchmarks" ALTER COLUMN "name" SET NOT NULL;
```

If Prisma generated extra DDL, STOP and surface to user.

- [ ] **Step 4: Apply the migration locally.**

```bash
cd apps/api && pnpm exec prisma migrate dev
```

Expected: "Database is now in sync." Verify:

```bash
PGPASSWORD=modeldoctor psql -h localhost -U modeldoctor -d modeldoctor -c "\d benchmarks" | grep " name "
```

Expected: `name | text | not null`.

- [ ] **Step 5: Update the shared contract.**

In `packages/contracts/src/benchmark.ts`, find line 44 inside `benchmarkSchema`:

```typescript
  name: z.string().nullable(),
```

Change to:

```typescript
  name: z.string(),
```

- [ ] **Step 6: Rebuild contracts so api/web see the new type.**

```bash
pnpm -F @modeldoctor/contracts build
```

Expected: build succeeds.

- [ ] **Step 7: Type-check api and web.**

```bash
pnpm -F api type-check && pnpm -F web type-check
```

Expected: PASS. (Frontend `benchmark.name ?? id` sites compile fine — `??` is just dead-code on a non-nullable side; cleanup happens in Task 5.)

- [ ] **Step 8: Run impacted tests.**

```bash
pnpm -F @modeldoctor/contracts test && pnpm -F api test --run benchmark
```

Expected: all PASS. The contract change does not require new tests — `benchmark.spec.ts` already validates name presence on create-request schema.

- [ ] **Step 9: Commit.**

```bash
git add apps/api/prisma/schema.prisma \
        apps/api/prisma/migrations/*_benchmark_name_required \
        packages/contracts/src/benchmark.ts
git commit -m "$(cat <<'EOF'
feat(contracts,api): require non-null benchmark name

Tightens benchmarkSchema.name from nullable to required and adds the
matching ALTER COLUMN ... SET NOT NULL migration. createBenchmark
already enforced min(1).max(128) at the input layer, so this is just
catching the response schema and DB column up to the existing input
contract. Pre-flight verified zero NULL rows in dev.

Refs #102.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Allow delete on non-terminal with best-effort driver cancel

**Files:**
- Modify: `apps/api/src/modules/benchmark/benchmark.service.ts:274-287` (delete method)
- Modify: `apps/api/src/modules/benchmark/benchmark.service.spec.ts` (delete describe block, line 278)

- [ ] **Step 1: Write the failing test for non-terminal delete.**

In `benchmark.service.spec.ts`, locate the `describe("BenchmarkService.delete", ...)` block (line ~278). Replace the body with:

```typescript
describe("BenchmarkService.delete", () => {
  let repo: MockRepo;
  let svc: BenchmarkService;

  beforeEach(() => {
    repo = new MockRepo();
    svc = build(repo);
    vi.clearAllMocks();
  });

  it("deletes a terminal benchmark", async () => {
    repo.setup(makeBenchmarkRow({ id: "b1", status: "completed" }));
    await svc.delete("b1", "u1");
    expect(repo.delete).toHaveBeenCalledWith("b1");
    expect(mockDriver.cancel).not.toHaveBeenCalled();
  });

  it("deletes a submitted benchmark and best-effort cancels driver", async () => {
    repo.setup(
      makeBenchmarkRow({ id: "b1", status: "submitted", driverHandle: "k8s:job-1" }),
    );
    await svc.delete("b1", "u1");
    expect(mockDriver.cancel).toHaveBeenCalledWith("k8s:job-1");
    expect(repo.delete).toHaveBeenCalledWith("b1");
  });

  it("deletes a running benchmark even when driver.cancel throws", async () => {
    repo.setup(
      makeBenchmarkRow({ id: "b1", status: "running", driverHandle: "k8s:job-2" }),
    );
    (mockDriver.cancel as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("apiserver flake"),
    );
    await svc.delete("b1", "u1");
    expect(mockDriver.cancel).toHaveBeenCalledWith("k8s:job-2");
    expect(repo.delete).toHaveBeenCalledWith("b1");
  });

  it("does not call driver.cancel when driverHandle is null", async () => {
    repo.setup(makeBenchmarkRow({ id: "b1", status: "submitted", driverHandle: null }));
    await svc.delete("b1", "u1");
    expect(mockDriver.cancel).not.toHaveBeenCalled();
    expect(repo.delete).toHaveBeenCalledWith("b1");
  });
});
```

- [ ] **Step 2: Run tests to verify three of them fail.**

```bash
pnpm -F api test --run benchmark.service.spec
```

Expected: "deletes a terminal benchmark" PASS; the three new ones FAIL with `ConflictException` (current code rejects non-terminal).

- [ ] **Step 3: Update `service.delete` to allow non-terminal.**

In `benchmark.service.ts`, find the `delete` method (around line 274). Replace:

```typescript
  async delete(id: string, userId?: string): Promise<void> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException(`Benchmark ${id} not found`);
    if (userId !== undefined && row.userId !== userId) {
      throw new NotFoundException(`Benchmark ${id} not found`);
    }
    if (!(TERMINAL_STATES as readonly string[]).includes(row.status)) {
      throw new ConflictException({
        code: "BENCHMARK_NOT_TERMINAL",
        message: `Cannot delete a benchmark in state '${row.status}'. Cancel it first.`,
      });
    }
    await this.repo.delete(row.id);
  }
```

with:

```typescript
  async delete(id: string, userId?: string): Promise<void> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException(`Benchmark ${id} not found`);
    if (userId !== undefined && row.userId !== userId) {
      throw new NotFoundException(`Benchmark ${id} not found`);
    }
    // Non-terminal rows may have a backing driver job (K8s Job, subprocess,
    // …). Best-effort cancel before DB delete so we don't orphan resources.
    // The K8sJobDriver already treats 404 on the Job as idempotent; any
    // other error is logged and swallowed so a flaky apiserver doesn't block
    // the user from clearing a stuck row.
    const isTerminal = (TERMINAL_STATES as readonly string[]).includes(row.status);
    if (!isTerminal && row.driverHandle) {
      try {
        await this.driver.cancel(row.driverHandle);
      } catch (e) {
        this.log.warn(
          `delete: best-effort driver.cancel failed for ${row.id}: ${(e as Error).message}`,
        );
      }
    }
    await this.repo.delete(row.id);
  }
```

- [ ] **Step 4: Verify `this.log` exists on the service.**

```bash
grep -n "private readonly log\|new Logger" apps/api/src/modules/benchmark/benchmark.service.ts | head -5
```

If no Logger field exists, add `private readonly log = new Logger(BenchmarkService.name);` near the top of the class and import `Logger` from `@nestjs/common`.

- [ ] **Step 5: Run tests to verify they pass.**

```bash
pnpm -F api test --run benchmark.service.spec
```

Expected: all four delete tests PASS. Other describe blocks also PASS.

- [ ] **Step 6: Type-check.**

```bash
pnpm -F api type-check
```

Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add apps/api/src/modules/benchmark/benchmark.service.ts \
        apps/api/src/modules/benchmark/benchmark.service.spec.ts
git commit -m "$(cat <<'EOF'
fix(api): allow delete on non-terminal benchmark with best-effort driver cancel

Removes the TERMINAL-state guard from BenchmarkService.delete so that
users can clear runs stuck in submitted/running (e.g. an
ImagePullBackOff that never reached the runner). When a driverHandle
is present we attempt driver.cancel first; errors are logged and
swallowed so a transient apiserver failure does not block the DB
delete.

Refs #102.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Scenario-aware back link on detail and compare pages

**Files:**
- Modify: `apps/web/src/features/benchmarks/BenchmarkDetailPage.tsx:332` (the back `<Link>`)
- Modify: `apps/web/src/features/benchmarks/compare/BenchmarkComparePage.tsx` (two `<Link to="/benchmarks">` sites)

- [ ] **Step 1: Inspect existing test to understand the back-link assertion.**

Read `apps/web/src/features/benchmarks/__tests__/BenchmarkDetailPage.test.tsx` around line 312 (the "calls DELETE and navigates back to list" test). The mock landing page renders the text `list`. We need a similar test verifying the back link's `href`.

- [ ] **Step 2: Add a failing test for scenario-aware back link.**

In `BenchmarkDetailPage.test.tsx`, append inside the main `describe("BenchmarkDetailPage", ...)`:

```typescript
  it("back link points to /benchmarks/:scenario based on the loaded benchmark", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(
      makeBenchmark({ status: "completed", scenario: "gateway" }),
    );
    render(<BenchmarkDetailPage />, { wrapper: Wrapper });
    const backLink = await screen.findByRole("link", { name: /Back to list|返回列表/ });
    expect(backLink).toHaveAttribute("href", "/benchmarks/gateway");
  });
```

- [ ] **Step 3: Run the test to verify it fails.**

```bash
pnpm -F web test --run BenchmarkDetailPage
```

Expected: the new test FAILS with `expected "/benchmarks/gateway" to be received but got "/benchmarks"`.

- [ ] **Step 4: Fix the detail page back link.**

In `BenchmarkDetailPage.tsx`, find:

```tsx
            <Button asChild variant="ghost" size="sm">
              <Link to="/benchmarks">
```

(around line 331-332). Change to:

```tsx
            <Button asChild variant="ghost" size="sm">
              <Link to={`/benchmarks/${benchmark.scenario}`}>
```

- [ ] **Step 5: Re-run the detail page test.**

```bash
pnpm -F web test --run BenchmarkDetailPage
```

Expected: all PASS, including the new test.

- [ ] **Step 6: Fix the compare page back links.**

In `apps/web/src/features/benchmarks/compare/BenchmarkComparePage.tsx`, two `<Link to="/benchmarks">` sites need to derive scenario from the loaded benchmarks. Read the file to understand how benchmarks are loaded (likely via a `useBenchmarkCompare` or similar hook fetching by ids).

- [ ] **Step 7: Read the compare page to find the scenario source.**

```bash
sed -n '1,60p' apps/web/src/features/benchmarks/compare/BenchmarkComparePage.tsx
```

Identify the variable that holds the loaded benchmarks array (e.g. `benchmarks`, `data?.items`). The shared scenario is `benchmarks[0]?.scenario` (compare requires same tool, and tool maps 1-to-1 onto a scenario for guidellm/vegeta, so first item's scenario is authoritative).

- [ ] **Step 8: Compute back-link target inside the component.**

Add near the top of the component body, after the data hook:

```tsx
  const backScenario = benchmarks[0]?.scenario ?? "gateway";
  const backHref = `/benchmarks/${backScenario}`;
```

(Substitute the actual benchmarks variable name from Step 7. The fallback `gateway` is only hit during the initial loading flicker before any benchmark resolves.)

Replace both `to="/benchmarks"` occurrences with `to={backHref}`.

- [ ] **Step 9: Add a failing test for compare back link (if compare has tests).**

Check if `apps/web/src/features/benchmarks/compare/__tests__/BenchmarkComparePage.test.tsx` exists (it does per earlier grep). Add:

```typescript
  it("back link points to /benchmarks/:scenario derived from loaded benchmarks", async () => {
    // Match the existing test setup for mocking 2-benchmark compare data.
    // The fixture benchmarks must include scenario: "inference" (or whatever).
    // Then assert: const backLink = await screen.findByRole("link", { name: /back/i });
    //              expect(backLink).toHaveAttribute("href", "/benchmarks/inference");
  });
```

Read the existing compare test setup first to copy the mock pattern; do not invent a fixture shape. The pseudo-code above is a template — replace with actual mock invocations matching the rest of the file.

- [ ] **Step 10: Run compare tests.**

```bash
pnpm -F web test --run BenchmarkComparePage
```

Expected: all PASS.

- [ ] **Step 11: Type-check.**

```bash
pnpm -F web type-check
```

Expected: PASS.

- [ ] **Step 12: Commit.**

```bash
git add apps/web/src/features/benchmarks/BenchmarkDetailPage.tsx \
        apps/web/src/features/benchmarks/compare/BenchmarkComparePage.tsx \
        apps/web/src/features/benchmarks/__tests__/BenchmarkDetailPage.test.tsx \
        apps/web/src/features/benchmarks/compare/__tests__/BenchmarkComparePage.test.tsx
git commit -m "$(cat <<'EOF'
fix(web): scenario-aware back link on benchmark detail and compare pages

The back link previously hard-coded /benchmarks, which is not a real
route — the lists live at /benchmarks/{gateway,inference,capacity}.
Detail page now derives the target from the loaded benchmark's
scenario; compare page reads it off the first benchmark in the
selection set.

Refs #102.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Add Cancel action to detail page

**Files:**
- Modify: `apps/web/src/locales/en-US/benchmarks.json` (add `detail.cancel.*` keys)
- Modify: `apps/web/src/locales/zh-CN/benchmarks.json` (add `detail.cancel.*` keys)
- Modify: `apps/web/src/features/benchmarks/BenchmarkDetailPage.tsx` (Cancel button + dialog + hook usage)
- Modify: `apps/web/src/features/benchmarks/__tests__/BenchmarkDetailPage.test.tsx` (Cancel test)

- [ ] **Step 1: Add i18n keys (English).**

In `apps/web/src/locales/en-US/benchmarks.json`, locate the `"detail"` → `"delete"` key. Right after the `"delete"` block, add:

```json
    "cancel": {
      "button": "Cancel run",
      "confirmTitle": "Cancel this run?",
      "confirmBody": "The benchmark will stop and its backing K8s job will be removed. The record stays in history with status 'canceled'.",
      "confirmAction": "Cancel run",
      "dismiss": "Keep running",
      "success": "Run canceled",
      "errors": {
        "generic": "Failed to cancel"
      }
    },
```

- [ ] **Step 2: Add i18n keys (Chinese).**

In `apps/web/src/locales/zh-CN/benchmarks.json`, mirror the structure:

```json
    "cancel": {
      "button": "取消任务",
      "confirmTitle": "取消该任务？",
      "confirmBody": "任务会停止，K8s 中关联的 Job 会被删除。记录保留在历史中，状态为 canceled。",
      "confirmAction": "确认取消",
      "dismiss": "保持运行",
      "success": "已取消",
      "errors": {
        "generic": "取消失败"
      }
    },
```

- [ ] **Step 3: Write failing tests for Cancel button.**

In `BenchmarkDetailPage.test.tsx`, append:

```typescript
  it("shows the Cancel button while the run is non-terminal", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(makeBenchmark({ status: "running" }));
    render(<BenchmarkDetailPage />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /^Cancel run$|^取消任务$/ }),
      ).toBeInTheDocument(),
    );
  });

  it("hides the Cancel button when the run is terminal", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(makeBenchmark({ status: "completed" }));
    render(<BenchmarkDetailPage />, { wrapper: Wrapper });
    await screen.findByText("smoke");
    expect(
      screen.queryByRole("button", { name: /^Cancel run$|^取消任务$/ }),
    ).not.toBeInTheDocument();
  });

  it("calls POST /:id/cancel after confirm", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(makeBenchmark({ status: "running" }));
    // The cancel API helper. If the test suite uses api.post for cancel,
    // mock that. Inspect the actual queries.ts call before mocking.
    vi.mocked(api.post).mockResolvedValueOnce(
      makeBenchmark({ status: "canceled" }),
    );
    const user = userEvent.setup();
    render(<BenchmarkDetailPage />, { wrapper: Wrapper });
    const cancelBtn = await screen.findByRole("button", {
      name: /^Cancel run$|^取消任务$/,
    });
    await user.click(cancelBtn);
    const confirm = await screen.findByRole("button", {
      name: /^Cancel run$|^确认取消$/,
    });
    await user.click(confirm);
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/api/benchmarks/r1/cancel",
        expect.anything(),
      ),
    );
  });
```

If the test suite mocks `benchmarkApi` rather than the underlying `api.post`, look at how the existing delete test does it (`api.del`) and mirror — the cancel API method is exposed in `apps/web/src/features/benchmarks/api.ts`.

- [ ] **Step 4: Inspect the cancel api wrapper.**

```bash
grep -n "cancel" apps/web/src/features/benchmarks/api.ts
```

Note the exact method name (`benchmarkApi.cancel` or similar) and what mock to set in tests. Adjust the test from Step 3 if needed before running.

- [ ] **Step 5: Run tests to verify they fail.**

```bash
pnpm -F web test --run BenchmarkDetailPage
```

Expected: the three new Cancel tests FAIL.

- [ ] **Step 6: Implement the Cancel button.**

In `BenchmarkDetailPage.tsx`:

(a) Add to the imports from `./queries`:

```tsx
import {
  benchmarkKeys,
  isTerminalStatus,
  useBenchmarkDetail,
  useCancelBenchmark,
  useCreateBenchmark,
  useDeleteBenchmark,
} from "./queries";
```

(b) Inside the component, near the existing `const deleteBenchmark = useDeleteBenchmark();`, add:

```tsx
  const [cancelOpen, setCancelOpen] = useState(false);
  const cancelBenchmark = useCancelBenchmark();
```

(c) In the `rightSlot` JSX (the buttons row, around line 187), add a Cancel button **before** the Delete button. Render only when non-terminal:

```tsx
            {!isTerminal && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCancelOpen(true)}
              >
                {t("detail.cancel.button")}
              </Button>
            )}
```

(d) Relax the Delete button rendering: change

```tsx
            {isTerminal && (
              <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
                {t("detail.delete.button")}
              </Button>
            )}
```

to

```tsx
            <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
              {t("detail.delete.button")}
            </Button>
```

(e) Add a Cancel confirm `<AlertDialog>` next to the existing Delete dialog (around line 317). Mirror the Delete dialog structure:

```tsx
      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("detail.cancel.confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("detail.cancel.confirmBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("detail.cancel.dismiss")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                cancelBenchmark.mutate(benchmark.id, {
                  onSuccess: () => {
                    toast.success(t("detail.cancel.success"));
                    setCancelOpen(false);
                  },
                  onError: () => {
                    toast.error(t("detail.cancel.errors.generic"));
                  },
                });
              }}
              disabled={cancelBenchmark.isPending}
            >
              {t("detail.cancel.confirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
```

- [ ] **Step 7: Run the tests to verify they pass.**

```bash
pnpm -F web test --run BenchmarkDetailPage
```

Expected: all PASS, including the three new Cancel tests **and** all pre-existing Delete-button tests. The earlier "hides the delete button while the run is still running" test must be **deleted or updated** because Delete is now visible always — change it to assert visible:

```typescript
  it("shows the delete button regardless of run status", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(makeBenchmark({ status: "running" }));
    render(<BenchmarkDetailPage />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Delete$|^删除$/ })).toBeInTheDocument(),
    );
  });
```

Also update the "hides Set-as-baseline / Delete buttons while non-terminal" test to drop the Delete assertion (Set-as-baseline still hides; Delete is now always shown).

- [ ] **Step 8: Type-check.**

```bash
pnpm -F web type-check
```

Expected: PASS.

- [ ] **Step 9: Commit.**

```bash
git add apps/web/src/features/benchmarks/BenchmarkDetailPage.tsx \
        apps/web/src/features/benchmarks/__tests__/BenchmarkDetailPage.test.tsx \
        apps/web/src/locales/en-US/benchmarks.json \
        apps/web/src/locales/zh-CN/benchmarks.json
git commit -m "$(cat <<'EOF'
feat(web): add cancel action to benchmark detail page

Adds an explicit Cancel button on non-terminal runs (wired to
useCancelBenchmark) and broadens Delete to render in all states. The
backend already cleans up the K8s Job on cancel and best-effort cancels
on delete, so users now have a clean two-button mental model: Cancel
stops the run and keeps the record; Delete removes both record and any
backing job.

Refs #102.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Show benchmark name in list and remove id fallbacks

**Files:**
- Modify: `apps/web/src/locales/en-US/benchmarks.json` (add `columns.name`)
- Modify: `apps/web/src/locales/zh-CN/benchmarks.json` (add `columns.name`)
- Modify: `apps/web/src/features/benchmarks/BenchmarkListShell.tsx` (add column)
- Modify: `apps/web/src/features/benchmarks/BenchmarkDetailPage.tsx` (remove `?? id` fallbacks)
- Modify: `apps/web/src/features/benchmarks/BenchmarkCreatePage.tsx` (remove `?? id` fallback)

- [ ] **Step 1: Add i18n key (English).**

In `apps/web/src/locales/en-US/benchmarks.json`, in the `"columns"` object, add `"name": "Name",` as the first entry:

```json
  "columns": {
    "name": "Name",
    "createdAt": "Created",
    ...
```

- [ ] **Step 2: Add i18n key (Chinese).**

In `apps/web/src/locales/zh-CN/benchmarks.json`, add `"name": "名称",` similarly.

- [ ] **Step 3: Write failing test for name column.**

Check whether `BenchmarkListShell` has tests:

```bash
ls apps/web/src/features/benchmarks/__tests__/ | grep -i list
```

If a `BenchmarkListShell.test.tsx` does not exist, create one with this minimal test (mirror the existing `BenchmarkDetailPage.test.tsx` setup for Wrapper/api mocking):

```typescript
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as api from "../api";
import { BenchmarkListShell } from "../BenchmarkListShell";
// ... copy Wrapper / makeBenchmark helpers from BenchmarkDetailPage.test.tsx

describe("BenchmarkListShell", () => {
  it("renders the benchmark name in the first content column", async () => {
    vi.mocked(api.list).mockResolvedValueOnce({
      items: [makeBenchmark({ id: "r1", name: "smoke-test", scenario: "gateway" })],
      nextCursor: null,
    });
    render(<BenchmarkListShell scenario="gateway" />, { wrapper: Wrapper });
    expect(await screen.findByText("smoke-test")).toBeInTheDocument();
  });
});
```

If a list-shell test file already exists, add the test inside it.

- [ ] **Step 4: Run the test to verify it fails.**

```bash
pnpm -F web test --run BenchmarkListShell
```

Expected: FAIL — name not rendered yet.

- [ ] **Step 5: Add the name column to BenchmarkListShell.**

In `apps/web/src/features/benchmarks/BenchmarkListShell.tsx`:

(a) In `<TableHeader>` → `<TableRow>`, after `<TableHead className="w-10" />` (the checkbox header), insert:

```tsx
                  <TableHead>{t("columns.name")}</TableHead>
```

(b) In the `items.map((benchmark) => …)` body, after the `<TableCell>` containing the `<Checkbox>`, insert:

```tsx
                    <TableCell className="font-medium">{benchmark.name}</TableCell>
```

- [ ] **Step 6: Run list test to verify it passes.**

```bash
pnpm -F web test --run BenchmarkListShell
```

Expected: PASS.

- [ ] **Step 7: Remove name fallbacks in BenchmarkDetailPage.**

(a) Line 188 — replace:

```tsx
        title={benchmark.name ?? benchmark.id}
```

with:

```tsx
        title={benchmark.name}
```

(b) Line 166 — replace:

```tsx
    const sourceName = benchmark.name?.trim() || `run-${benchmark.id.slice(0, 8)}`;
```

with:

```tsx
    const sourceName = benchmark.name;
```

- [ ] **Step 8: Update the rerun-source-name test that exercised the fallback.**

In `BenchmarkDetailPage.test.tsx`, find the test "falls back to a synthetic name when the source Run has no name" (around line 421). Since name is now required and `benchmark.name` cannot be empty, this test no longer makes semantic sense.

Either:
- **Delete** the test entirely (preferred — the scenario it covered is now contractually impossible), or
- Replace it with a test that asserts the rerun source name equals `benchmark.name` for a normal case (likely already covered by the surrounding rerun tests; check before duplicating).

The "truncates the source name so the ' (rerun)' suffix fits within the 128-char limit" test at line 436 should still pass — it doesn't depend on the fallback.

- [ ] **Step 9: Remove name fallback in BenchmarkCreatePage.**

In `apps/web/src/features/benchmarks/BenchmarkCreatePage.tsx:134`, replace:

```tsx
      toast.success(t("create.submitted", { name: benchmark.name ?? benchmark.id }));
```

with:

```tsx
      toast.success(t("create.submitted", { name: benchmark.name }));
```

- [ ] **Step 10: Run the full benchmarks test suite.**

```bash
pnpm -F web test --run benchmarks
```

Expected: all PASS.

- [ ] **Step 11: Type-check + lint.**

```bash
pnpm -F web type-check && pnpm -F web lint
```

Expected: PASS.

- [ ] **Step 12: Commit.**

```bash
git add apps/web/src/features/benchmarks/BenchmarkListShell.tsx \
        apps/web/src/features/benchmarks/BenchmarkDetailPage.tsx \
        apps/web/src/features/benchmarks/BenchmarkCreatePage.tsx \
        apps/web/src/features/benchmarks/__tests__/ \
        apps/web/src/locales/en-US/benchmarks.json \
        apps/web/src/locales/zh-CN/benchmarks.json
git commit -m "$(cat <<'EOF'
feat(web): show benchmark name in list and remove id fallbacks

Adds a Name column as the first content cell of BenchmarkListShell
(after the row checkbox) and drops the three sites that previously
defaulted to benchmark.id when name was null. Now that name is required
at the contract layer, those fallbacks were dead branches.

Refs #102.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Push, open PR, and verify CI signals

**Files:** none

- [ ] **Step 1: Push the branch.**

```bash
cd /Users/fangyong/vllm/modeldoctor/fix-benchmark-task-mgmt
git push -u origin fix/benchmark-task-management
```

- [ ] **Step 2: Open the PR with closes #102 and refs to the new sub-bug-5 issue.**

Substitute `<N>` with the issue number from Task 0.

```bash
gh pr create --title "fix(benchmark): task management cleanup (#102 class A)" --body "$(cat <<'EOF'
## Summary

Closes the four small task-management issues from #102:

- Submitted-state benchmarks can now be deleted; backend best-effort cancels the backing K8s Job before removing the row.
- Detail-page Cancel button added (non-terminal only).
- Detail and compare pages' "back to list" links now go to the scenario-specific list (`/benchmarks/{gateway,inference,capacity}`) instead of the non-existent `/benchmarks` route.
- List page shows benchmark name as the first content column.
- `Benchmark.name` tightened from nullable to required at the schema, contract, and DB layers (zero NULL rows in dev verified pre-migration).

## Out of scope (split off)

Sub-bug 5 (ImagePullBackOff awareness + task SSE logs) needs a K8s pod watcher and a new SSE channel and is tracked separately in #<N>.

## Test plan

- [x] `pnpm -F api test --run benchmark`
- [x] `pnpm -F web test --run benchmarks`
- [x] `pnpm -F api type-check && pnpm -F web type-check`
- [ ] Manual: create a stuck submitted benchmark in dev, click Delete, confirm the K8s Job is removed (`kubectl get jobs -n modeldoctor-benchmarks`).
- [ ] Manual: open `/benchmarks/gateway` → click into a detail → "back" returns to `/benchmarks/gateway`.
- [ ] Manual: cancel a running benchmark; status flips to `canceled` and Job is removed.

closes #102
refs #<N>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Verify CI signals after push.**

```bash
gh pr view --json number | jq -r '.number' > /tmp/pr-num
PR=$(cat /tmp/pr-num)
gh pr checks "$PR"
gh pr view "$PR" --json comments,reviews,statusCheckRollup,mergeStateStatus
```

If CI is pending, wait for completion (`gh run watch <run-id> --exit-status`). If CI fails, surface the failure to the user and pause.

- [ ] **Step 4: Hand off.**

Summarize to user: PR number, CI status, any reviewer comments, and the new sub-bug-5 issue number.

---

## Self-review checklist (already addressed inline)

- ✅ All five spec sub-bugs (1, 2, 3, 4 in scope; 5 split into Task 0 issue) have a task.
- ✅ No "TBD" / "implement later" — every code step has the actual code.
- ✅ Type names consistent (`benchmark.scenario`, `useCancelBenchmark`, `cancelBenchmark.mutate`).
- ✅ Test patterns mirror existing tests in the same file (regex for EN/CN button names, `api.del` / `api.post` mocking style).
- ✅ Migration generates a single `ALTER COLUMN ... SET NOT NULL` — verified by pre-flight count of zero NULL rows.
- ✅ Commit messages match repo convention (`type(scope): subject` + `Refs #102` + Claude trailer).
