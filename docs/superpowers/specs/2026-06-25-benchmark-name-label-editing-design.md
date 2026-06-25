# Benchmark name/label editing — design

## Problem

Every time a user opens the live Compare page, the stage labels (chart X-axis,
e.g. `OFF-1` / `ON-1`) are derived on the fly by `shortRunLabels()` stripping the
shared prefix from benchmark names. For names like
`长前缀t6 · Qwen3-32B · T6N-OFF-r1-a1` that yields `T6N-OFF-r1-a1`, so the user
hand-shortens to `OFF-1` **on every comparison** — the edit never persists.

Two distinct wants:

1. **Persist a short compare label** so it's set once and reused across every
   future comparison (the core ask).
2. **Rename a benchmark** — the auto-generated `name` is sometimes wrong/unclear
   and should be editable.

These are different needs: renaming `name` to a short label would sacrifice the
list/detail/report readability that the rich descriptive name provides. So we
keep `name` rich and editable, and add a separate short `label`.

## Approach (chosen: A)

A persistent, optional short `label` on the benchmark, plus making `name`
editable. Compare's default stage label becomes `label ?? shortRunLabels(name)`.

This yields three tiers, each with a clear owner:

| Tier | Lives on | Scope | Set where |
|---|---|---|---|
| `benchmark.label` | Benchmark row | Global default, reused everywhere | Benchmark list (click-to-edit) |
| compare override | `BenchmarkComparePage` component state | This live comparison only | Compare matrix inline input (shipped in #335) |
| saved snapshot | `SavedCompare.stageLabels` | Frozen at save time | Save dialog (existing) |

The compare override (already shipped) sits on top of the new persistent default;
the saved snapshot is unaffected (it freezes whatever labels were active at save).

### Rejected alternatives

- **B — only make `name` editable.** No new field; compare keeps deriving from
  `name`. Cheapest, but to get a short label the user must rename the benchmark
  short, losing the descriptive name in the list/detail/reports.
- **C — only add `label`.** Satisfies persistence but not the "name should be
  editable" ask.

## Data model

`Benchmark` gains one nullable column:

```prisma
model Benchmark {
  ...
  name        String
  label       String?   // short display label for compare stage axis; null = derive from name
  description String?  @db.Text
  ...
}
```

- Prisma **generated** migration (`prisma migrate dev --create-only`), no
  hand-written SQL. Schema-only (adds a nullable column; no data backfill).
- `@modeldoctor/contracts` benchmark schema: add `label: z.string().max(48).nullable()`.
- New update-request schema: `benchmarkUpdateSchema = z.object({ name: z.string().min(1).max(128).optional(), label: z.string().max(48).nullable().optional() })`.

`label` max length 48: long enough for `OFF-r1-a1`-style labels, short enough to
stay a chart-axis label rather than a second name.

## API

Net-new — benchmarks currently have no update endpoint.

- `PATCH /api/benchmarks/:id`, body `benchmarkUpdateSchema`.
- Auth: scoped to the requesting `userId` (same ownership check as
  `benchmark.service` reads). 404 if not found / not owned.
- Empty-string `label` is normalized to `null` (revert to auto-derived).
- Returns the updated `Benchmark` (same shape the list/detail already consume).
- Layers: `BenchmarkController.update` → `BenchmarkService.update`.

## Frontend

### Editing — `BenchmarkListShell`

The shared list table (NAME / CREATED / DURATION / TOOL / CONNECTION / STATUS /
P95 / ERROR / ACTIONS) used by every scenario page.

- **NAME** cell → **click-to-edit** (Linear-style): renders as text/link; click a
  pencil affordance to swap in an input. Enter/blur commits, Esc cancels. A list
  of dozens of rows must not show always-on inputs (too noisy) — this is the
  opposite choice from the Compare matrix (an editing surface, always-on there).
- New **LABEL** column (after NAME) → same click-to-edit. Empty commit clears the
  label (reverts to auto-derived). Shows a muted placeholder (e.g. `—`) when null.
- Commit → `PATCH` mutation → optimistic update + `invalidateQueries` on the list
  key. Reuse the existing list query keys.
- A small shared `ClickToEditCell` component (click → input, Enter/Esc/blur),
  colocated with the list; the Compare matrix's always-on input stays separate
  (different interaction model).

### Editing — detail page (secondary, optional within this PR)

`BenchmarkDetailMetadata` may also expose name/label editing for parity, but the
list is the primary surface. Keep it in scope only if cheap; otherwise defer.

### Compare integration — `BenchmarkComparePage`

`reportRuns[].stageLabel` default changes from `shortLabels[i]` to
`b.label ?? shortLabels[i]`. `shortRunLabels` still runs for the fallback. The
shipped per-compare inline override (the `labelOverrides` state) continues to win
over both.

## Testing

- **API**: `PATCH /api/benchmarks/:id` e2e/service spec — update name, update
  label, clear label (empty → null), validation (name length, label length),
  ownership scoping (other user's benchmark → 404).
- **Web**: `ClickToEditCell` component test (click → input, Enter commits, Esc
  cancels, empty clears); `BenchmarkComparePage`/`run-label` test that
  `b.label` wins over `shortRunLabels` and null falls back.

## Out of scope

- Bulk relabeling. Auto-suggesting labels from a naming convention.
- Touching the SavedCompare snapshot semantics.
- The Compare matrix inline editor (already shipped in #335).
