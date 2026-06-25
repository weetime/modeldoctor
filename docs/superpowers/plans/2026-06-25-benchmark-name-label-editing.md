# Benchmark name/label editing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent, optional short `label` to benchmarks and make `name` editable from the benchmark list, so Compare stage labels are set once and reused instead of re-edited every comparison.

**Architecture:** New nullable `Benchmark.label` column + a `PATCH /api/benchmarks/:id` endpoint (`{name?, label?}`). The shared list table (`BenchmarkListShell`) gets click-to-edit on the NAME cell and a new LABEL column via a reusable `ClickToEditCell`. Compare's default stage label becomes `benchmark.label ?? shortRunLabels(name)`; the per-compare inline override (shipped in #335) still wins.

**Tech Stack:** Prisma + NestJS (API), Zod (`@modeldoctor/contracts`), React + TanStack Query + shadcn (web), Vitest.

## Global Constraints

- Prisma migrations are **generated** (`prisma migrate dev --create-only`), never hand-written SQL. Schema-only (a nullable column, no backfill).
- `label` max length **48**; `name` 1–128 (matches `createBenchmarkRequestSchema`).
- Empty-string `label` from the client normalizes to `null` (revert to auto-derived).
- Conventional-commit prefixes; explicit `git add <files>` (never `-A`); commit body ends with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Run all web commands from repo root via `pnpm -F @modeldoctor/web …`; API via `pnpm -F @modeldoctor/api …`.
- Worktree: `/Users/fangyong/vllm/modeldoctor/feat-benchmark-label` on branch `feat/benchmark-name-label-editing`. First-time setup: `pnpm install`, `pnpm -r build`, and `cd apps/api && npx prisma generate` (so contracts/dist + prisma client exist).

---

### Task 1: Contracts — `label` field + update schema

**Files:**
- Modify: `packages/contracts/src/benchmark.ts:50` (add `label` to `benchmarkSchema`) and after `createBenchmarkRequestSchema` (~line 138, add `benchmarkUpdateSchema`)

**Interfaces:**
- Produces: `benchmarkSchema` now has `label: string | null`; `benchmarkUpdateSchema` / `BenchmarkUpdateRequest` = `{ name?: string; label?: string | null }`.

- [ ] **Step 1: Add `label` to the persisted schema.** In `benchmarkSchema`, immediately after the `name: z.string(),` line (line 50):

```ts
  name: z.string(),
  // Optional short display label for the Compare stage axis. null = derive
  // from `name` via shortRunLabels. Set/cleared from the benchmark list.
  label: z.string().nullable(),
  description: z.string().nullable(),
```

- [ ] **Step 2: Add the update-request schema.** Immediately after `export type CreateBenchmarkRequest = …` (~line 138):

```ts
export const benchmarkUpdateSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  // Empty string is allowed on the wire; the service normalizes "" → null.
  label: z.string().max(48).nullable().optional(),
});
export type BenchmarkUpdateRequest = z.infer<typeof benchmarkUpdateSchema>;
```

- [ ] **Step 3: Build contracts.**

Run: `pnpm -F @modeldoctor/contracts build`
Expected: builds clean (emits `dist/`).

- [ ] **Step 4: Commit.**

```bash
git add packages/contracts/src/benchmark.ts
git commit -m "feat(contracts): benchmark label field + update request schema"
```

---

### Task 2: Prisma — `label` column + migration + DTO mapping

**Files:**
- Modify: `apps/api/prisma/schema.prisma:135` (add `label` to `model Benchmark`)
- Create: `apps/api/prisma/migrations/<timestamp>_benchmark_label/migration.sql` (generated)
- Modify: `apps/api/src/modules/benchmark/benchmark.service.ts:489` (`toContract` maps `label`)
- Modify: `apps/api/src/modules/benchmark/benchmark.repository.ts:29` (`UpdateBenchmarkInput` allows `name`/`label`)

**Interfaces:**
- Produces: `Benchmark` rows carry `label`; `UpdateBenchmarkInput` accepts `{ name?: string; label?: string | null }`.

- [ ] **Step 1: Add the column to the Prisma model.** In `model Benchmark`, right after the `name String` line (line 135):

```prisma
  name        String
  label       String?
  description String? @db.Text
```

- [ ] **Step 2: Generate the migration.** (DB is the local dev Postgres; this is additive/non-destructive.)

Run: `cd apps/api && npx prisma migrate dev --create-only --name benchmark_label`
Expected: creates `prisma/migrations/<ts>_benchmark_label/migration.sql` containing `ALTER TABLE "benchmarks" ADD COLUMN "label" TEXT;`. Verify the SQL is that single additive `ALTER` and nothing else.

- [ ] **Step 3: Apply the migration + regen client.**

Run: `cd apps/api && npx prisma migrate dev`
Expected: migration applies; `prisma generate` runs (seed may run — it's upsert-only, fine).

- [ ] **Step 4: Map `label` in `toContract`.** In `benchmark.service.ts`, in the `toContract` object literal after `name: row.name,` (line 489):

```ts
    name: row.name,
    label: row.label,
    description: row.description,
```

- [ ] **Step 5: Allow `name`/`label` in `UpdateBenchmarkInput`.** In `benchmark.repository.ts`, extend the `UpdateBenchmarkInput` Partial (line 29) by adding two members:

```ts
export type UpdateBenchmarkInput = Partial<{
  name: string;
  label: string | null;
  status: string;
  statusMessage: string | null;
```

- [ ] **Step 6: Typecheck the API compiles with the new field.**

Run: `pnpm -F @modeldoctor/api exec tsc -p tsconfig.json --noEmit`
Expected: no errors. (`toContract` now satisfies the `Benchmark` type that gained `label`.)

- [ ] **Step 7: Commit.**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/src/modules/benchmark/benchmark.service.ts apps/api/src/modules/benchmark/benchmark.repository.ts
git commit -m "feat(api): benchmark label column + migration + DTO mapping"
```

---

### Task 3: API — `update` service method + `PATCH` endpoint

**Files:**
- Modify: `apps/api/src/modules/benchmark/benchmark.service.ts` (add `update` after `findByIdOrFail`, ~line 71)
- Modify: `apps/api/src/modules/benchmark/benchmark.controller.ts` (add `@Patch(":id")` after `detail`, ~line 85; import `Patch`, `benchmarkUpdateSchema`, `BenchmarkUpdateRequest`)
- Test: `apps/api/src/modules/benchmark/benchmark.service.spec.ts` (add update tests)

**Interfaces:**
- Consumes: `BenchmarkUpdateRequest` (Task 1), `repo.update` (existing), `findByIdOrFail` (existing).
- Produces: `BenchmarkService.update(id: string, userId: string | undefined, req: BenchmarkUpdateRequest): Promise<Benchmark>`; `PATCH /api/benchmarks/:id`.

- [ ] **Step 1: Write the failing service test.** In `benchmark.service.spec.ts`, find the existing `describe` that constructs `svc` with a seeded benchmark (reuse its setup helpers). Add:

```ts
describe("update", () => {
  it("updates name and label, normalizing empty label to null", async () => {
    const created = await createSeededBenchmark(); // reuse existing helper
    const renamed = await svc.update(created.id, USER_ID, { name: "OFF-1", label: "OFF" });
    expect(renamed.name).toBe("OFF-1");
    expect(renamed.label).toBe("OFF");
    const cleared = await svc.update(created.id, USER_ID, { label: "" });
    expect(cleared.label).toBeNull();
  });

  it("throws NotFound when the benchmark is not owned by the user", async () => {
    const created = await createSeededBenchmark();
    await expect(svc.update(created.id, "someone-else", { name: "x" })).rejects.toThrow();
  });
});
```

> Note: match `createSeededBenchmark` / `USER_ID` to the spec's existing fixtures — read the top of the file and reuse whatever it already uses to seed a benchmark and identify the owning user.

- [ ] **Step 2: Run it to verify it fails.**

Run: `pnpm -F @modeldoctor/api exec vitest run src/modules/benchmark/benchmark.service.spec.ts -t update`
Expected: FAIL — `svc.update` is not a function.

- [ ] **Step 3: Implement `update`.** In `benchmark.service.ts`, after `findByIdOrFail` (line 71) add:

```ts
  async update(
    id: string,
    userId: string | undefined,
    req: BenchmarkUpdateRequest,
  ): Promise<Benchmark> {
    // Ownership gate (throws NotFound if missing / not owned).
    await this.findByIdOrFail(id, userId);
    const data: UpdateBenchmarkInput = {};
    if (req.name !== undefined) data.name = req.name;
    // "" → null reverts to the auto-derived compare label.
    if (req.label !== undefined) data.label = req.label === "" ? null : req.label;
    await this.repo.update(id, data);
    return this.findByIdOrFail(id, userId);
  }
```

Add imports at the top of the file if not present: `BenchmarkUpdateRequest` from `@modeldoctor/contracts`, and `UpdateBenchmarkInput` from `./benchmark.repository.js`.

- [ ] **Step 4: Run the test to verify it passes.**

Run: `pnpm -F @modeldoctor/api exec vitest run src/modules/benchmark/benchmark.service.spec.ts -t update`
Expected: PASS (both cases).

- [ ] **Step 5: Wire the controller.** In `benchmark.controller.ts`: add `Patch` to the `@nestjs/common` import; add `benchmarkUpdateSchema`, `type BenchmarkUpdateRequest` to the `@modeldoctor/contracts` import. After the `detail` handler (line 85) add:

```ts
  @ApiOperation({ summary: "Update a benchmark's name / label" })
  @Patch(":id")
  update(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(benchmarkUpdateSchema)) body: BenchmarkUpdateRequest,
  ): Promise<Benchmark> {
    return this.service.update(id, user.roles.includes("admin") ? undefined : user.sub, body);
  }
```

- [ ] **Step 6: Verify API typecheck + full benchmark suite.**

Run: `pnpm -F @modeldoctor/api exec tsc -p tsconfig.json --noEmit && pnpm -F @modeldoctor/api exec vitest run src/modules/benchmark`
Expected: typecheck clean; all benchmark specs pass.

- [ ] **Step 7: Commit.**

```bash
git add apps/api/src/modules/benchmark/benchmark.service.ts apps/api/src/modules/benchmark/benchmark.controller.ts apps/api/src/modules/benchmark/benchmark.service.spec.ts
git commit -m "feat(api): PATCH /benchmarks/:id to update name/label"
```

---

### Task 4: Web — reusable `ClickToEditCell`

**Files:**
- Create: `apps/web/src/components/common/click-to-edit-cell.tsx`
- Test: `apps/web/src/components/common/click-to-edit-cell.test.tsx`

**Interfaces:**
- Produces: `ClickToEditCell({ value, onCommit, ariaLabel, placeholder? }: { value: string; onCommit: (next: string) => void; ariaLabel: string; placeholder?: string })`. Renders text (or `placeholder` when value is empty) as a button with a pencil affordance; click → input; Enter/blur commits (only when changed); Esc cancels.

- [ ] **Step 1: Write the failing test.**

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ClickToEditCell } from "./click-to-edit-cell";

describe("ClickToEditCell", () => {
  it("commits a changed value on Enter", () => {
    const onCommit = vi.fn();
    render(<ClickToEditCell value="OFF" onCommit={onCommit} ariaLabel="Edit label" />);
    fireEvent.click(screen.getByTitle("Edit label"));
    const input = screen.getByLabelText("Edit label");
    fireEvent.change(input, { target: { value: "ON" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("ON");
  });

  it("cancels on Escape and does not commit", () => {
    const onCommit = vi.fn();
    render(<ClickToEditCell value="OFF" onCommit={onCommit} ariaLabel="Edit label" />);
    fireEvent.click(screen.getByTitle("Edit label"));
    const input = screen.getByLabelText("Edit label");
    fireEvent.change(input, { target: { value: "ON" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("does not commit an unchanged value", () => {
    const onCommit = vi.fn();
    render(<ClickToEditCell value="OFF" onCommit={onCommit} ariaLabel="Edit label" />);
    fireEvent.click(screen.getByTitle("Edit label"));
    fireEvent.keyDown(screen.getByLabelText("Edit label"), { key: "Enter" });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("shows the placeholder when value is empty", () => {
    render(
      <ClickToEditCell value="" onCommit={vi.fn()} ariaLabel="Edit label" placeholder="—" />,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `pnpm -F @modeldoctor/web exec vitest run src/components/common/click-to-edit-cell.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component.**

```tsx
import { Pencil } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";

/**
 * Click-to-edit text cell for dense list tables: renders the value as a button
 * (pencil affordance on hover); clicking swaps in an input. Enter / blur commits
 * (only when changed), Escape cancels. An empty `value` shows `placeholder`.
 * Distinct from the Compare matrix's always-on input — a list of many rows must
 * not show inputs everywhere.
 */
export function ClickToEditCell({
  value,
  onCommit,
  ariaLabel,
  placeholder,
}: {
  value: string;
  onCommit: (next: string) => void;
  ariaLabel: string;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (editing) {
    const commit = () => {
      setEditing(false);
      if (draft !== value) onCommit(draft);
    };
    return (
      <Input
        ref={(el) => el?.focus()}
        value={draft}
        aria-label={ariaLabel}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setEditing(false);
          }
        }}
        className="h-8 max-w-[16rem]"
      />
    );
  }
  return (
    <button
      type="button"
      title={ariaLabel}
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
      className="group inline-flex items-center gap-1 rounded-sm text-left hover:text-primary"
    >
      <span className={value ? "" : "text-muted-foreground"}>{value || placeholder}</span>
      <Pencil className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60" />
    </button>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `pnpm -F @modeldoctor/web exec vitest run src/components/common/click-to-edit-cell.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit.**

```bash
git add apps/web/src/components/common/click-to-edit-cell.tsx apps/web/src/components/common/click-to-edit-cell.test.tsx
git commit -m "feat(web): ClickToEditCell for dense list tables"
```

---

### Task 5: Web — `update` API client + mutation hook

**Files:**
- Modify: `apps/web/src/features/benchmarks/api.ts:35` (add `update`; import `BenchmarkUpdateRequest`)
- Modify: `apps/web/src/features/benchmarks/queries.ts` (add `useUpdateBenchmark`)

**Interfaces:**
- Consumes: `api.patch` (exists in `apps/web/src/lib/api-client.ts:117`), `benchmarkKeys` (exists).
- Produces: `benchmarkApi.update(id, body)`; `useUpdateBenchmark()` → mutation taking `{ id, body }` and invalidating `benchmarkKeys.lists()` + `benchmarkKeys.detail(id)`.

- [ ] **Step 1: Add the API method.** In `api.ts`, add `BenchmarkUpdateRequest` to the `@modeldoctor/contracts` import, then inside `benchmarkApi` after `cancel` (line 34):

```ts
  update: (id: string, body: BenchmarkUpdateRequest) =>
    api.patch<Benchmark>(`/api/benchmarks/${id}`, body),
```

- [ ] **Step 2: Add the mutation hook.** In `queries.ts`, add `BenchmarkUpdateRequest` to the contracts import if needed, then add (near the other benchmark mutations):

```ts
export function useUpdateBenchmark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: BenchmarkUpdateRequest }) =>
      benchmarkApi.update(id, body),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: benchmarkKeys.detail(id) });
      qc.invalidateQueries({ queryKey: benchmarkKeys.lists() });
    },
  });
}
```

- [ ] **Step 3: Typecheck web.**

Run: `pnpm -F @modeldoctor/web type-check`
Expected: no errors.

- [ ] **Step 4: Commit.**

```bash
git add apps/web/src/features/benchmarks/api.ts apps/web/src/features/benchmarks/queries.ts
git commit -m "feat(web): benchmark update API client + mutation hook"
```

---

### Task 6: Web — list NAME click-to-edit + LABEL column

**Files:**
- Modify: `apps/web/src/features/benchmarks/BenchmarkListShell.tsx` (NAME cell → `ClickToEditCell`; new LABEL header + cell; wire `useUpdateBenchmark`)
- Modify: `apps/web/src/locales/en-US/benchmarks.json` and `apps/web/src/locales/zh-CN/benchmarks.json` (`columns.label`, `editName`, `editLabelAria`)

**Interfaces:**
- Consumes: `ClickToEditCell` (Task 4), `useUpdateBenchmark` (Task 5), `benchmark.label` (Task 1/2).

- [ ] **Step 1: Add i18n keys.** In both locale files, inside the benchmarks `columns` object add `"label"`, and add two sibling keys near the existing list strings.

en-US:
```json
      "columns": { ... "name": "Name", "label": "Label", ... },
      "editNameAria": "Edit name",
      "editLabelAria": "Edit label (Compare X axis; empty = auto)",
      "labelPlaceholder": "—"
```
zh-CN:
```json
      "columns": { ... "name": "名称", "label": "标签", ... },
      "editNameAria": "编辑名称",
      "editLabelAria": "编辑标签(Compare X 轴;留空=自动)",
      "labelPlaceholder": "—"
```

> Match the exact nesting these files already use for `columns.*` — read the surrounding lines and insert `label` alongside `name`.

- [ ] **Step 2: Import + instantiate the mutation.** In `BenchmarkListShell.tsx`, import `ClickToEditCell` from `@/components/common/click-to-edit-cell` and `useUpdateBenchmark` from `./queries`. Inside the component:

```tsx
  const updateBenchmark = useUpdateBenchmark();
```

- [ ] **Step 3: Add the LABEL header.** After the NAME `<TableHead>` (line 395):

```tsx
                  <TableHead>{t("columns.name")}</TableHead>
                  <TableHead>{t("columns.label")}</TableHead>
```

- [ ] **Step 4: Make NAME click-to-edit + add the LABEL cell.** Replace the NAME `<TableCell>` (lines 417-424) with a click-to-edit cell that still links via a separate affordance, and add the LABEL cell right after:

```tsx
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Link
                          to={`/benchmarks/${benchmark.id}`}
                          className="text-muted-foreground hover:text-primary"
                          aria-label={`open ${benchmark.name}`}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Link>
                        <ClickToEditCell
                          value={benchmark.name}
                          ariaLabel={t("editNameAria")}
                          onCommit={(name) =>
                            updateBenchmark.mutate({ id: benchmark.id, body: { name } })
                          }
                        />
                      </div>
                    </TableCell>
                    <TableCell>
                      <ClickToEditCell
                        value={benchmark.label ?? ""}
                        ariaLabel={t("editLabelAria")}
                        placeholder={t("labelPlaceholder")}
                        onCommit={(label) =>
                          updateBenchmark.mutate({ id: benchmark.id, body: { label } })
                        }
                      />
                    </TableCell>
```

Import `ExternalLink` from `lucide-react` (the row keeps a navigation affordance now that the name text is an edit trigger, not a link).

- [ ] **Step 5: Typecheck + verify the list still renders (existing tests).**

Run: `pnpm -F @modeldoctor/web type-check && pnpm -F @modeldoctor/web exec vitest run src/features/benchmarks`
Expected: typecheck clean; existing benchmark tests pass (update any test asserting the name is a link-by-text — the name is now inside a button; adjust to `getByRole("button", { name: ... })` or query the new ExternalLink if such a test exists).

- [ ] **Step 6: Commit.**

```bash
git add apps/web/src/features/benchmarks/BenchmarkListShell.tsx apps/web/src/locales/en-US/benchmarks.json apps/web/src/locales/zh-CN/benchmarks.json
git commit -m "feat(web): inline-edit benchmark name + label column in list"
```

---

### Task 7: Web — Compare uses `benchmark.label` as default stage label

**Files:**
- Modify: `apps/web/src/features/benchmarks/compare/BenchmarkComparePage.tsx:174-183`
- Test: `apps/web/src/features/benchmarks/compare/BenchmarkComparePage.test.tsx` (create if absent) OR extend `run-label`/compare coverage

**Interfaces:**
- Consumes: `benchmark.label` (Task 1/2), existing `shortRunLabels` + `labelOverrides` (shipped in #335).

- [ ] **Step 1: Write the failing test.** Create `apps/web/src/features/benchmarks/compare/default-stage-label.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { shortRunLabels } from "./run-label";

// Mirrors BenchmarkComparePage's default-label rule so the precedence is pinned.
function defaultStageLabel(label: string | null, autoShort: string): string {
  return label ?? autoShort;
}

describe("compare default stage label", () => {
  it("prefers benchmark.label over the auto-derived short label", () => {
    const names = ["长前缀 · Qwen3 · T6N-OFF-r1", "长前缀 · Qwen3 · T6N-ON-r1"];
    const short = shortRunLabels(names);
    expect(defaultStageLabel("OFF", short[0])).toBe("OFF");
    expect(defaultStageLabel(null, short[1])).toBe(short[1]);
  });
});
```

- [ ] **Step 2: Run it to verify it passes as a spec of intent, then wire the page.**

Run: `pnpm -F @modeldoctor/web exec vitest run src/features/benchmarks/compare/default-stage-label.test.ts`
Expected: PASS (this pins the rule; next step applies it in the page).

- [ ] **Step 3: Apply the rule in `BenchmarkComparePage`.** In the `reportRuns` map (line 174-183), change `stageLabel`:

```tsx
  const reportRuns: ReportRun[] = successfulBenchmarks.map((b, i) => ({
    id: b.id,
    stageLabel: labelOverrides[b.id] ?? b.label ?? shortLabels[i],
```

(The per-compare `labelOverrides` from #335 still wins; then the persistent `b.label`; then the auto short label.)

- [ ] **Step 4: Typecheck + compare suite.**

Run: `pnpm -F @modeldoctor/web type-check && pnpm -F @modeldoctor/web exec vitest run src/features/benchmarks/compare`
Expected: clean + all pass.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/src/features/benchmarks/compare/BenchmarkComparePage.tsx apps/web/src/features/benchmarks/compare/default-stage-label.test.ts
git commit -m "feat(web): Compare defaults stage label to benchmark.label"
```

---

### Task 8: Lint + full verification + PR

- [ ] **Step 1: Biome on all changed files.**

Run: `pnpm exec biome check --write <all changed apps/web + apps/api files>`
Expected: no remaining errors (re-run without `--write` to confirm).

- [ ] **Step 2: Full typecheck + test sweep.**

Run: `pnpm -F @modeldoctor/contracts build && pnpm -F @modeldoctor/api exec tsc -p tsconfig.json --noEmit && pnpm -F @modeldoctor/web type-check && pnpm -F @modeldoctor/api exec vitest run src/modules/benchmark && pnpm -F @modeldoctor/web exec vitest run src/features/benchmarks src/components/common/click-to-edit-cell.test.tsx`
Expected: all green.

- [ ] **Step 3: Push + open PR** (base `main`), body summarizing the three-tier label model and linking the design spec. Then verify CI per the repo's PR-follow-through policy.

---

## Self-review notes

- **Spec coverage:** model `label` (T1/T2) ✓, editable `name` (T3 API + T6 list) ✓, `PATCH` endpoint (T3) ✓, list click-to-edit name + LABEL column (T6) ✓, compare default `label ?? shortRunLabels` (T7) ✓, tests (T3/T4/T7) ✓. Detail-page editing was marked "optional/defer" in the spec — intentionally **not** a task here; add later if wanted.
- **Type consistency:** `BenchmarkUpdateRequest` (T1) is the body type used by service (T3), controller (T3), api client (T5), mutation (T5). `ClickToEditCell` prop names (`value`/`onCommit`/`ariaLabel`/`placeholder`) are identical across T4 definition and T6 usage. `label: string | null` consistent across schema, DTO, `UpdateBenchmarkInput`.
- **Empty→null** normalization is owned solely by the service (T3 Step 3); the client always sends the raw string.
