# PR1: Benchmark Restructure — Data Layer + Rename + Scenarios

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** End-to-end restructure of the benchmark module: rename `Run` → `Benchmark` everywhere, drop the `kind`/`mode` discriminators, add scenario as a first-class field, split e2e into a standalone `diagnostics` module with its own table, and rebuild the frontend around three scenario pages (推理性能基准 / 容量规划 / 网关压测) plus updated compare. Database is reset (no data preservation).

**Architecture:** Scenarios live as a code constant in `packages/tool-adapters/scenarios.ts` plus a `scenarios: readonly ScenarioId[]` field on each `ToolAdapter`. The benchmark row records the user's intent at create time (`scenario: 'inference' | 'capacity' | 'gateway'`); detail page reports route off this field. e2e probes still execute synchronously inside the BFF Node process, but persistence moves to a dedicated `diagnostics_runs` table behind a brand-new `DiagnosticsRepository` — zero coupling to benchmark's K8s/runner/HMAC pipeline.

**Tech Stack:** TypeScript 5.x; pnpm workspaces; NestJS 10 + Prisma 5 + PostgreSQL 16 (`apps/api`); React 18 + Vite + react-router-dom v6 + react-i18next + @tanstack/react-query@5 + biome (`apps/web`); Python 3.12 runner (`apps/benchmark-runner`); vitest@2 (`apps/api`) and vitest@1 (`apps/web`); zod 3.

**Spec:** `docs/superpowers/specs/2026-05-04-benchmark-restructure-design.md`

**Branch:** `feat/benchmark-restructure-pr1` (this plan is on `docs/benchmark-restructure-design`; create the feature branch in Task 0).

**Worktree:** `/Users/fangyong/vllm/modeldoctor/feat-benchmark-restructure-pr1`

---

## File Structure

### New files

#### Contracts (`packages/contracts/src/`)

- `benchmark.ts` — replaces `run.ts`; `Benchmark`, `ListBenchmarksQuery`, `ListBenchmarksResponse`, `CreateBenchmarkRequest`, callback schemas (`BenchmarkStateCallback`, `BenchmarkLogCallback`, `BenchmarkFinishCallback`), charts response. Adds `scenario`, `toolVersion`, `parentBenchmarkId`. Drops `kind`, `mode`, `scenario` (old JSONB), `tool='custom'`/`'e2e'` enum values.
- `benchmark-template.ts` — `BenchmarkTemplate`, `ListBenchmarkTemplatesQuery`, `CreateBenchmarkTemplateRequest`, `UpdateBenchmarkTemplateRequest` (no controller/service yet — those land in PR2).
- `diagnostics.ts` — replaces `e2e-test.ts`; reshape: `DiagnosticsRun` is the persisted row, `DiagnosticsRunRequest` (request body), `DiagnosticsRunResponse` (sync return).

#### tool-adapters (`packages/tool-adapters/src/`)

- `scenarios.ts` — `ScenarioId` type, `SCENARIOS` constant, `ScenarioParamsConstraint` interface, `applyScenarioConstraints` helper, `assertScenariosInvariant` build-time check.
- `scenarios.spec.ts` — invariant + helper tests.

#### Backend (`apps/api/src/modules/`)

- `benchmark/` — renamed from `run/` (see Rename Map below for file list).
- `benchmark-template/`
  - `benchmark-template.module.ts` — registered for completeness so `Module.imports` already exist; controller/service/repository are placeholders that throw `NotImplementedException` in PR1, real impl lands in PR2.
  - (No controller endpoints registered in PR1; just a Prisma model + a no-op `BenchmarkTemplateRepository` so other modules can `Inject` it without breaking the DI graph.)
  - `benchmark-template.repository.ts` — minimal: `findByIdOrNull(id)` only, used by `BenchmarkService` to validate `templateId` references at create time.
  - `benchmark-template.repository.spec.ts`
- `diagnostics/` — renamed from `e2e-test/`; new `DiagnosticsRepository` (no `RunRepository` dep).
  - `diagnostics.module.ts`
  - `diagnostics.controller.ts`
  - `diagnostics.service.ts`
  - `diagnostics.repository.ts`
  - `diagnostics.service.spec.ts`
  - `diagnostics.repository.spec.ts`

#### Frontend (`apps/web/src/features/`)

- `benchmarks/` — renamed from `runs/` (most files renamed; see Rename Map below).
- `benchmarks/BenchmarkInferencePage.tsx` — replaces `RunListPage` for `/benchmarks/inference`.
- `benchmarks/BenchmarkCapacityPage.tsx` — for `/benchmarks/capacity`.
- `benchmarks/BenchmarkGatewayPage.tsx` — for `/benchmarks/gateway`.
- `benchmarks/BenchmarkListShell.tsx` — shared component the three list pages render with their `scenario` prop.
- `benchmarks/reports/InferenceReport.tsx` — replaces `GuidellmReportView` + `GenaiPerfReportView` for `scenario='inference'`.
- `benchmarks/reports/CapacityReport.tsx` — new; `scenario='capacity'`.
- `benchmarks/reports/GatewayReport.tsx` — replaces `VegetaReportView` for `scenario='gateway'`.
- `benchmarks/reports/UnknownReport.tsx` — defensive fallback.
- `benchmarks/scenarios.ts` — frontend re-export of `SCENARIOS` from `tool-adapters` plus icon mapping.
- `diagnostics/` — renamed from `e2e-smoke/`.

### Modified files (rename + content edit)

#### Rename map (no content changes beyond imports)

These moves are pure path renames; the only content edits are import path fixes and class/type/symbol renames.

| From | To |
|---|---|
| `apps/api/src/modules/run/run.module.ts` | `apps/api/src/modules/benchmark/benchmark.module.ts` |
| `apps/api/src/modules/run/run.controller.ts` | `apps/api/src/modules/benchmark/benchmark.controller.ts` |
| `apps/api/src/modules/run/run.controller.spec.ts` | `apps/api/src/modules/benchmark/benchmark.controller.spec.ts` |
| `apps/api/src/modules/run/run.service.ts` | `apps/api/src/modules/benchmark/benchmark.service.ts` |
| `apps/api/src/modules/run/run.service.spec.ts` | `apps/api/src/modules/benchmark/benchmark.service.spec.ts` |
| `apps/api/src/modules/run/run.repository.ts` | `apps/api/src/modules/benchmark/benchmark.repository.ts` |
| `apps/api/src/modules/run/run.repository.spec.ts` | `apps/api/src/modules/benchmark/benchmark.repository.spec.ts` |
| `apps/api/src/modules/run/run-charts.service.ts` | `apps/api/src/modules/benchmark/benchmark-charts.service.ts` |
| `apps/api/src/modules/run/run-charts.service.spec.ts` | `apps/api/src/modules/benchmark/benchmark-charts.service.spec.ts` |
| `apps/api/src/modules/run/__fixtures__/` | `apps/api/src/modules/benchmark/__fixtures__/` |
| `apps/api/src/modules/run/callbacks/run-callback.controller.ts` | `apps/api/src/modules/benchmark/callbacks/benchmark-callback.controller.ts` |
| `apps/api/src/modules/run/callbacks/run-callback.controller.spec.ts` | `apps/api/src/modules/benchmark/callbacks/benchmark-callback.controller.spec.ts` |
| `apps/api/src/modules/run/drivers/*` | `apps/api/src/modules/benchmark/drivers/*` (filenames unchanged) |
| `apps/api/src/modules/run/sse/*` | `apps/api/src/modules/benchmark/sse/*` (filenames unchanged) |
| `apps/api/src/modules/e2e-test/e2e-test.module.ts` | `apps/api/src/modules/diagnostics/diagnostics.module.ts` |
| `apps/api/src/modules/e2e-test/e2e-test.controller.ts` | `apps/api/src/modules/diagnostics/diagnostics.controller.ts` |
| `apps/api/src/modules/e2e-test/e2e-test.service.ts` | `apps/api/src/modules/diagnostics/diagnostics.service.ts` |
| `apps/api/src/modules/e2e-test/e2e-test.service.spec.ts` | `apps/api/src/modules/diagnostics/diagnostics.service.spec.ts` |
| `packages/contracts/src/run.ts` | `packages/contracts/src/benchmark.ts` |
| `packages/contracts/src/run.spec.ts` (if present) | `packages/contracts/src/benchmark.spec.ts` |
| `packages/contracts/src/run-charts.spec.ts` | `packages/contracts/src/benchmark-charts.spec.ts` |
| `packages/contracts/src/e2e-test.ts` | `packages/contracts/src/diagnostics.ts` |
| `apps/web/src/features/runs/` | `apps/web/src/features/benchmarks/` (entire tree) |
| `apps/web/src/features/runs/RunListPage.tsx` | (split into `BenchmarkInferencePage.tsx` / `BenchmarkCapacityPage.tsx` / `BenchmarkGatewayPage.tsx` + shared `BenchmarkListShell.tsx`) |
| `apps/web/src/features/runs/RunCreatePage.tsx` | `apps/web/src/features/benchmarks/BenchmarkCreatePage.tsx` |
| `apps/web/src/features/runs/RunDetailPage.tsx` | `apps/web/src/features/benchmarks/BenchmarkDetailPage.tsx` |
| `apps/web/src/features/runs/RunDetailMetadata.tsx` | `apps/web/src/features/benchmarks/BenchmarkDetailMetadata.tsx` |
| `apps/web/src/features/runs/RunDetailRawOutput.tsx` | `apps/web/src/features/benchmarks/BenchmarkDetailRawOutput.tsx` |
| `apps/web/src/features/runs/RunListFilters.tsx` | `apps/web/src/features/benchmarks/BenchmarkListFilters.tsx` |
| `apps/web/src/features/runs/SetBaselineDialog.tsx` | `apps/web/src/features/benchmarks/SetBaselineDialog.tsx` |
| `apps/web/src/features/runs/compare/RunComparePage.tsx` | `apps/web/src/features/benchmarks/compare/BenchmarkComparePage.tsx` |
| `apps/web/src/features/runs/compare/CompareGrid.tsx` | (path moves; class names stay) |
| `apps/web/src/features/runs/compare/MetricRow.tsx` | (path moves) |
| `apps/web/src/features/runs/compare/CompareToolbar.tsx` | (path moves) |
| `apps/web/src/features/runs/compare/DetailVerdictRow.tsx` | (path moves) |
| `apps/web/src/features/runs/compare/VerdictBadge.tsx` | (path moves) |
| `apps/web/src/features/runs/compare/metrics.ts` | (path moves; one new descriptor) |
| `apps/web/src/features/runs/compare/verdict.ts` | (path moves) |
| `apps/web/src/features/e2e-smoke/` | `apps/web/src/features/diagnostics/` (entire tree) |

#### Other modified files (content edits)

- `apps/api/prisma/schema.prisma` — drop `Run` model, add `Benchmark`, `BenchmarkTemplate`, `DiagnosticsRun`; rename `Baseline.runId` → `benchmarkId`; new fields/indexes per spec.
- `packages/tool-adapters/src/core/interface.ts` — extend `ToolAdapter` with `scenarios: readonly ScenarioId[]`.
- `packages/tool-adapters/src/guidellm/index.ts` — declare `scenarios: ['inference', 'capacity']`.
- `packages/tool-adapters/src/vegeta/index.ts` — declare `scenarios: ['gateway']`.
- `packages/tool-adapters/src/genai-perf/index.ts` — declare `scenarios: ['inference']`.
- `packages/tool-adapters/src/index.ts` — re-export `scenarios.ts`.
- `packages/tool-adapters/src/core/registry.ts` — extend `byTool()` callers don't change; add `byScenario(s)` for completeness.
- `packages/tool-adapters/src/core/registry.spec.ts` — add tests for `byScenario`.
- `packages/tool-adapters/src/schemas-entry.ts` — re-export `scenarios.ts` types.
- `packages/contracts/src/index.ts` — replace `run.ts` exports with `benchmark.ts`; add `benchmark-template.ts`; replace `e2e-test.ts` with `diagnostics.ts`.
- `packages/contracts/src/baseline.ts` — `Baseline.runId` → `benchmarkId`; `BaselineSummary` unchanged.
- `apps/api/src/modules/baseline/baseline.controller.ts` — rename routes/DTO field.
- `apps/api/src/modules/baseline/baseline.service.ts` — rename internal references.
- `apps/api/src/modules/baseline/baseline.repository.ts` — rename Prisma reads.
- `apps/api/src/modules/baseline/baseline.controller.spec.ts` — update test data.
- `apps/api/src/modules/baseline/baseline.service.spec.ts`
- `apps/api/src/modules/baseline/baseline.repository.spec.ts`
- `apps/api/src/app.module.ts` — replace `RunModule`/`E2ETestModule` with `BenchmarkModule`/`BenchmarkTemplateModule`/`DiagnosticsModule`.
- `apps/api/src/config/env.schema.ts` — `BENCHMARK_DRIVER`, `BENCHMARK_CALLBACK_URL`, `BENCHMARK_CALLBACK_SECRET` keep their names (already use the BENCHMARK_ prefix); update `BENCHMARK_IMAGE_*` env keys (currently they exist for guidellm/vegeta/genai-perf — keep names).
- `apps/benchmark-runner/runner/main.py` — update outbound callback paths from `/api/internal/runs/:id/{state,log,finish}` to `/api/internal/benchmarks/:id/{state,log,finish}`; capture `<tool> --version` at boot and include in the `state=running` body as `toolVersion`.
- `apps/benchmark-runner/runner/callback.py` — extend the state callback payload schema with `toolVersion: str | None`.
- `apps/benchmark-runner/tests/test_callback.py` — assert toolVersion forwarded.
- `apps/web/src/router/index.tsx` — full route rewrite; remove `/runs/*` and `/e2e`; add `/benchmarks/{inference,capacity,gateway,compare,:id,new}`, `/diagnostics`.
- `apps/web/src/components/sidebar/sidebar-config.tsx` — full sidebar rewrite per spec.
- `apps/web/src/components/sidebar/Sidebar.tsx` (if it references group/item label keys directly, update them; otherwise no change).
- `apps/web/src/locales/en-US/sidebar.json` — replace `groups.performance` → `groups.benchmarks`; `groups.debug` → `groups.diagnostics`; replace `items.runs` → `items.benchmarkInference`/`items.benchmarkCapacity`/`items.benchmarkGateway`/`items.benchmarkCompare`/`items.benchmarkTemplates`; replace `items.e2e` → `items.diagnostics`.
- `apps/web/src/locales/zh-CN/sidebar.json` — same with Chinese values.
- `apps/web/src/locales/en-US/runs.json` → `apps/web/src/locales/en-US/benchmarks.json` (rename file, update keys).
- `apps/web/src/locales/zh-CN/runs.json` → `apps/web/src/locales/zh-CN/benchmarks.json`.
- `apps/web/src/locales/en-US/e2e.json` → `apps/web/src/locales/en-US/diagnostics.json`.
- `apps/web/src/locales/zh-CN/e2e.json` → `apps/web/src/locales/zh-CN/diagnostics.json`.
- `apps/web/src/lib/i18n.ts` — namespace registration changes.
- `apps/web/src/features/baseline/queries.ts` — rename references from `run` → `benchmark`.
- `apps/web/src/features/baseline/queries.test.ts`

### Deleted files

- `apps/api/src/modules/run/` — entire directory after files migrate to `benchmark/`.
- `apps/api/src/modules/e2e-test/` — entire directory after migration to `diagnostics/`.
- `packages/contracts/src/run.ts` — content migrated to `benchmark.ts`.
- `packages/contracts/src/e2e-test.ts` — content migrated to `diagnostics.ts`.
- `apps/web/src/features/runs/` — entire directory after migration to `benchmarks/`.
- `apps/web/src/features/e2e-smoke/` — entire directory after migration to `diagnostics/`.
- `apps/web/src/locales/{en-US,zh-CN}/runs.json` — replaced by `benchmarks.json`.
- `apps/web/src/locales/{en-US,zh-CN}/e2e.json` — replaced by `diagnostics.json`.
- Three legacy report views deleted as their content folds into the scenario reports:
  - `apps/web/src/features/benchmarks/reports/GuidellmReportView.tsx`
  - `apps/web/src/features/benchmarks/reports/VegetaReportView.tsx`
  - `apps/web/src/features/benchmarks/reports/GenaiPerfReportView.tsx`

---

## Task 0: Worktree bootstrap

**Files:** none modified.

- [ ] **Step 0.1: Create the worktree on a new feature branch**

```bash
cd /Users/fangyong/vllm/modeldoctor
git worktree add feat-benchmark-restructure-pr1 -b feat/benchmark-restructure-pr1
cd feat-benchmark-restructure-pr1
```

Expected: `Preparing worktree (new branch 'feat/benchmark-restructure-pr1')` + `HEAD is now at <commit>`.

- [ ] **Step 0.2: Install dependencies**

```bash
pnpm install --frozen-lockfile
```

Expected: install completes; no errors.

- [ ] **Step 0.3: Generate Prisma client**

```bash
pnpm -F @modeldoctor/api exec prisma generate
```

Expected: `✔ Generated Prisma Client`. Required before `apps/api` typechecks.

- [ ] **Step 0.4: Build all workspace packages once**

Per project memory `project_worktree_build_first.md`, freshly added worktrees have empty `packages/*/dist/` and downstream typechecks fail until this runs once.

```bash
pnpm -r build
```

Expected: every `packages/*/dist/` populated; `apps/api/dist` populated; build exits 0.

- [ ] **Step 0.5: Sanity-check baseline tests pass before any changes**

```bash
pnpm -r test
```

Expected: all green. If anything fails on `main`, fix that first or pull the fix.

---

## Phase 1: Database schema reset

The user has authorized full DB reset (per spec; dev-only DB). We replace `Run` with `Benchmark`, drop `kind`/`mode`, add `scenario` and `toolVersion`, rename `Baseline.runId` → `benchmarkId`, and add `BenchmarkTemplate` and `DiagnosticsRun` tables.

### Task 1.1: Rewrite `schema.prisma`

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

- [ ] **Step 1.1.1: Replace the `Run` model + add new models**

Open `apps/api/prisma/schema.prisma`. Delete the existing `Run` model (lines 92–147 in current `main`). Update `User` to remove the `runs Run[]` relation and add `benchmarks Benchmark[]` and `diagnosticsRuns DiagnosticsRun[]`. Update `Connection` similarly.

Add the following new models (place after `Connection` and before `Baseline`):

```prisma
model Benchmark {
  id           String  @id @default(cuid())
  userId       String? @map("user_id")
  connectionId String? @map("connection_id")

  scenario    String  // 'inference' | 'capacity' | 'gateway'
  tool        String  // 'guidellm' | 'vegeta' | 'genai-perf'
  toolVersion String? @map("tool_version")
  driverKind  String  @map("driver_kind") // 'local' | 'k8s'

  name        String?
  description String? @db.Text

  status        String  @default("pending")
  statusMessage String? @map("status_message") @db.Text
  progress      Float?

  driverHandle String? @map("driver_handle")

  params         Json
  rawOutput      Json? @map("raw_output")
  summaryMetrics Json? @map("summary_metrics")
  serverMetrics  Json? @map("server_metrics")

  templateId          String? @map("template_id")
  parentBenchmarkId   String? @map("parent_benchmark_id")
  baselineId          String? @map("baseline_id")

  logs String? @db.Text

  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  startedAt   DateTime? @map("started_at") @db.Timestamptz(3)
  completedAt DateTime? @map("completed_at") @db.Timestamptz(3)

  user        User?              @relation(fields: [userId], references: [id], onDelete: SetNull)
  connection  Connection?        @relation(fields: [connectionId], references: [id], onDelete: SetNull)
  template    BenchmarkTemplate? @relation(fields: [templateId], references: [id], onDelete: SetNull)
  parent      Benchmark?         @relation("BenchmarkParent", fields: [parentBenchmarkId], references: [id], onDelete: SetNull)
  children    Benchmark[]        @relation("BenchmarkParent")
  baseline    Baseline?          @relation("BenchmarkReferencingBaseline", fields: [baselineId], references: [id], onDelete: SetNull)
  baselineFor Baseline?          @relation("BaselineCanonicalBenchmark")

  @@index([userId, createdAt])
  @@index([scenario, status])
  @@index([tool, createdAt])
  @@index([connectionId])
  @@index([parentBenchmarkId])
  @@index([baselineId])
  @@index([templateId])
  @@map("benchmarks")
}

model BenchmarkTemplate {
  id          String   @id @default(cuid())
  name        String
  description String?  @db.Text
  scenario    String
  tool        String
  config      Json
  isOfficial  Boolean  @default(false) @map("is_official")
  createdBy   String?  @map("created_by")
  tags        String[] @default([])

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  benchmarks Benchmark[]
  creator    User?       @relation("UserCreatedTemplates", fields: [createdBy], references: [id], onDelete: SetNull)

  @@index([scenario])
  @@index([tool])
  @@index([isOfficial])
  @@index([createdBy])
  @@map("benchmark_templates")
}

model DiagnosticsRun {
  id            String  @id @default(cuid())
  userId        String? @map("user_id")
  connectionId  String? @map("connection_id")

  status        String
  statusMessage String? @map("status_message") @db.Text
  probes        String[]
  pathOverride  Json    @default("{}") @map("path_override")
  results       Json
  summary       Json

  startedAt   DateTime? @map("started_at") @db.Timestamptz(3)
  completedAt DateTime? @map("completed_at") @db.Timestamptz(3)
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)

  user       User?       @relation(fields: [userId], references: [id], onDelete: SetNull)
  connection Connection? @relation(fields: [connectionId], references: [id], onDelete: SetNull)

  @@index([userId, createdAt])
  @@index([connectionId])
  @@map("diagnostics_runs")
}
```

Update the `Baseline` model — replace `runId` with `benchmarkId`, replace the two `Run` relations with the matching `Benchmark` ones:

```prisma
model Baseline {
  id              String   @id @default(cuid())
  userId          String   @map("user_id")
  benchmarkId     String   @unique @map("benchmark_id")
  name            String
  description     String?  @db.Text
  tags            String[] @default([])
  templateId      String?  @map("template_id")
  active          Boolean  @default(true)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  user        User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  benchmark   Benchmark  @relation("BaselineCanonicalBenchmark", fields: [benchmarkId], references: [id], onDelete: Restrict)
  referencers Benchmark[] @relation("BenchmarkReferencingBaseline")

  @@index([userId])
  @@map("baselines")
}
```

(Note: dropped `templateVersion` field — spec says no template version locking.)

Update `User`:

```prisma
model User {
  id           String   @id @default(cuid())
  // ...existing fields unchanged...

  refreshTokens     RefreshToken[]
  benchmarks        Benchmark[]
  connections       Connection[]
  baselines         Baseline[]
  diagnosticsRuns   DiagnosticsRun[]
  createdTemplates  BenchmarkTemplate[] @relation("UserCreatedTemplates")
  // (drop: runs Run[])

  @@index([email])
  @@map("users")
}
```

Update `Connection`:

```prisma
model Connection {
  // ...existing fields unchanged...

  user             User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  benchmarks       Benchmark[]
  diagnosticsRuns  DiagnosticsRun[]
  // (drop: runs Run[])

  @@unique([userId, name])
  @@index([userId])
  @@map("connections")
}
```

- [ ] **Step 1.1.2: Validate the Prisma schema parses**

```bash
pnpm -F @modeldoctor/api exec prisma validate
```

Expected: `The schema at apps/api/prisma/schema.prisma is valid 🚀`.

If validation fails, re-read the error and fix referenced relations/types before proceeding.

### Task 1.2: Reset DB and create migration

**Files:**
- Create: `apps/api/prisma/migrations/<timestamp>_benchmark_restructure/migration.sql`

- [ ] **Step 1.2.1: Reset the dev DB and apply the new schema as a fresh migration**

Per project memory `feedback_dev_db_disposable.md`, DB resets are NOT pre-authorized — but the spec explicitly authorizes a reset for this restructure, and the user has confirmed in spec review. So:

```bash
pnpm -F @modeldoctor/api exec prisma migrate reset --force --skip-seed
```

Expected: existing migrations roll back; DB drops; no migrations re-applied yet (since we're about to delete the old ones).

- [ ] **Step 1.2.2: Delete all old migration directories**

```bash
rm -rf apps/api/prisma/migrations/0_init \
       apps/api/prisma/migrations/20260501153605_use_timestamptz \
       apps/api/prisma/migrations/20260501231211_baseline_run_immutability \
       apps/api/prisma/migrations/20260502032922_issue_53_canonical_drop \
       apps/api/prisma/migrations/20260503053611_add_connection_tokenizer_hf_id
ls apps/api/prisma/migrations/
```

Expected: only `migration_lock.toml` remains.

- [ ] **Step 1.2.3: Generate the new initial migration from the rewritten schema**

Per project memory `feedback_prisma_migrations.md`, never hand-write SQL. Use Prisma's generator:

```bash
pnpm -F @modeldoctor/api exec prisma migrate dev --create-only --name benchmark_restructure
```

Expected: a new directory `apps/api/prisma/migrations/<timestamp>_benchmark_restructure/migration.sql` is created. Inspect the generated SQL to confirm: `CREATE TABLE benchmarks`, `CREATE TABLE benchmark_templates`, `CREATE TABLE diagnostics_runs`, `CREATE TABLE baselines` (with `benchmark_id` column), and all indexes from the schema.

- [ ] **Step 1.2.4: Apply the migration**

```bash
pnpm -F @modeldoctor/api exec prisma migrate dev
```

Expected: migration applied; `prisma generate` runs automatically; client regenerates.

- [ ] **Step 1.2.5: Verify with psql**

```bash
psql postgresql://modeldoctor:modeldoctor@localhost:5432/modeldoctor -c "\dt"
```

Expected: tables listed include `benchmarks`, `benchmark_templates`, `diagnostics_runs`, `baselines`, `connections`, `users`, `refresh_tokens`. No `runs` table.

```bash
psql postgresql://modeldoctor:modeldoctor@localhost:5432/modeldoctor -c "\d benchmarks"
```

Expected: column list shows `scenario`, `tool`, `tool_version`, `parent_benchmark_id`, etc.; no `kind`, no `mode`.

### Task 1.3: Commit Phase 1

- [ ] **Step 1.3.1: Stage and commit**

```bash
git add apps/api/prisma/schema.prisma \
        apps/api/prisma/migrations/
git commit -m "$(cat <<'EOF'
build(api): reset DB schema for benchmark restructure

Drops Run/E2E unified model. New tables:
- benchmarks (replaces runs; adds scenario, tool_version; drops kind/mode)
- benchmark_templates (skeleton; module follows in PR2)
- diagnostics_runs (e2e probes get their own table)

baselines.run_id → benchmarks.benchmark_id; template_version dropped
(spec drops template version locking).

DB reset is authorized by the benchmark-restructure design spec; no
production data is impacted.

Refs spec: docs/superpowers/specs/2026-05-04-benchmark-restructure-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2: tool-adapters scenarios module

Add `scenarios.ts` to `packages/tool-adapters` defining the `ScenarioId` type, the `SCENARIOS` constant, the `applyScenarioConstraints` helper, and a build-time invariant.

### Task 2.1: Write the failing scenarios spec

**Files:**
- Create: `packages/tool-adapters/src/scenarios.spec.ts`

- [ ] **Step 2.1.1: Author the spec file**

```typescript
import { describe, expect, it } from "vitest";
import {
  SCENARIOS,
  applyScenarioConstraints,
  assertScenariosInvariant,
  type ScenarioId,
} from "./scenarios.js";
import { byTool } from "./core/registry.js";

describe("SCENARIOS constant", () => {
  it("declares inference, capacity, gateway", () => {
    expect(Object.keys(SCENARIOS).sort()).toEqual(["capacity", "gateway", "inference"]);
  });

  it("inference scenario lists guidellm and genai-perf", () => {
    expect([...SCENARIOS.inference.tools].sort()).toEqual(["genai-perf", "guidellm"]);
  });

  it("capacity scenario lists guidellm only", () => {
    expect(SCENARIOS.capacity.tools).toEqual(["guidellm"]);
  });

  it("gateway scenario lists vegeta only", () => {
    expect(SCENARIOS.gateway.tools).toEqual(["vegeta"]);
  });
});

describe("invariant: SCENARIOS.tools ⊆ adapters that declare the scenario", () => {
  it("every tool in SCENARIOS[s].tools has s in its adapter.scenarios", () => {
    for (const [scenarioId, cfg] of Object.entries(SCENARIOS)) {
      for (const tool of cfg.tools) {
        const adapter = byTool(tool);
        expect(adapter.scenarios).toContain(scenarioId as ScenarioId);
      }
    }
  });

  it("every adapter scenario is mirrored in SCENARIOS[s].tools", () => {
    // We exercise three known adapters explicitly.
    for (const tool of ["guidellm", "vegeta", "genai-perf"] as const) {
      const adapter = byTool(tool);
      for (const scenarioId of adapter.scenarios) {
        expect(SCENARIOS[scenarioId].tools).toContain(tool);
      }
    }
  });

  it("assertScenariosInvariant passes for the current registry", () => {
    expect(() => assertScenariosInvariant()).not.toThrow();
  });
});

describe("applyScenarioConstraints", () => {
  it("inference + guidellm narrows rateType to non-sweep values", () => {
    const merged = applyScenarioConstraints("inference", "guidellm");
    const rateTypeSchema = merged.shape.rateType;
    // Sweep must not be a permitted enum value under inference.
    expect(() => rateTypeSchema.parse("sweep")).toThrow();
    expect(() => rateTypeSchema.parse("constant")).not.toThrow();
  });

  it("capacity + guidellm forces rateType=sweep", () => {
    const merged = applyScenarioConstraints("capacity", "guidellm");
    expect(() => merged.shape.rateType.parse("sweep")).not.toThrow();
    expect(() => merged.shape.rateType.parse("constant")).toThrow();
  });

  it("gateway + vegeta has no rateType (returns base schema)", () => {
    const merged = applyScenarioConstraints("gateway", "vegeta");
    // vegeta params don't have rateType; merged should still parse a valid base body.
    expect(merged).toBeDefined();
  });

  it("throws when scenario+tool combination is invalid", () => {
    // capacity does NOT include vegeta.
    expect(() => applyScenarioConstraints("capacity", "vegeta")).toThrow(
      /scenario 'capacity' does not support tool 'vegeta'/,
    );
  });
});
```

- [ ] **Step 2.1.2: Run the spec — confirm it fails because the module doesn't exist**

```bash
pnpm -F @modeldoctor/tool-adapters test scenarios
```

Expected: failure messages mentioning `Cannot find module './scenarios.js'` or `applyScenarioConstraints is not defined`.

### Task 2.2: Implement `scenarios.ts`

**Files:**
- Create: `packages/tool-adapters/src/scenarios.ts`

- [ ] **Step 2.2.1: Author the module**

```typescript
import { z } from "zod";
import type { ToolName } from "./core/interface.js";
import { byTool, registry } from "./core/registry.js";

// ── Scenario taxonomy ────────────────────────────────────────────────
export type ScenarioId = "inference" | "capacity" | "gateway";

export const scenarioIdSchema = z.enum(["inference", "capacity", "gateway"]);

export interface ScenarioConfig {
  /** Sidebar / page header label (Chinese; UI may i18n via key derivation). */
  readonly label: string;
  readonly description: string;
  /** Tools available under this scenario. */
  readonly tools: readonly ToolName[];
  /**
   * Per-tool zod overlay. Keys are tool names; values are zod ZodObject
   * shapes that REPLACE the matching keys on the adapter's base
   * paramsSchema. Missing keys = no constraint on that field.
   */
  readonly paramsConstraints: Partial<Record<ToolName, z.ZodRawShape>>;
  /** Detail-page report component dispatch key. */
  readonly reportComponent: "InferenceReport" | "CapacityReport" | "GatewayReport";
}

// ── Scenario constants ───────────────────────────────────────────────
//
// `paramsConstraints` values are zod `ZodRawShape` (NOT full ZodObject) —
// they get merged onto the adapter's `paramsSchema.shape` with .merge() at
// validation time. This lets a scenario narrow a single field (e.g.
// guidellm.rateType) without redefining every other field.
export const SCENARIOS: Record<ScenarioId, ScenarioConfig> = {
  inference: {
    label: "推理性能基准",
    description: "TTFT / TPOT / 单次吞吐基线",
    tools: ["guidellm", "genai-perf"],
    paramsConstraints: {
      guidellm: {
        rateType: z.enum(["constant", "poisson", "throughput", "synchronous"]),
      },
    },
    reportComponent: "InferenceReport",
  },
  capacity: {
    label: "容量规划",
    description: "SLO 驱动的负载阶梯扫描",
    tools: ["guidellm"],
    paramsConstraints: {
      guidellm: {
        rateType: z.literal("sweep"),
      },
    },
    reportComponent: "CapacityReport",
  },
  gateway: {
    label: "网关压测",
    description: "Higress / API 链路 HTTP 性能",
    tools: ["vegeta"],
    paramsConstraints: {},
    reportComponent: "GatewayReport",
  },
};

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Merge per-scenario constraints onto a tool adapter's base paramsSchema.
 *
 * Implementation note: assumes the adapter's paramsSchema is a ZodObject
 * (or ZodEffects-wrapped object). All current adapters comply (guidellm/
 * vegeta/genai-perf). If a future adapter uses a non-object root, extend
 * this helper with a new branch and add a test.
 */
export function applyScenarioConstraints(scenario: ScenarioId, tool: ToolName): z.AnyZodObject {
  const cfg = SCENARIOS[scenario];
  if (!cfg.tools.includes(tool)) {
    throw new Error(`scenario '${scenario}' does not support tool '${tool}'`);
  }
  const adapter = byTool(tool);
  const baseSchema = adapter.paramsSchema as z.AnyZodObject;
  const constraint = cfg.paramsConstraints[tool];
  if (!constraint || Object.keys(constraint).length === 0) return baseSchema;
  return baseSchema.merge(z.object(constraint));
}

/**
 * Build-time invariant: SCENARIOS[s].tools is consistent with each
 * adapter's `scenarios` declaration.
 *
 * Called from the spec file; if we ever wire up a startup self-test in
 * the API, call it from there too.
 */
export function assertScenariosInvariant(): void {
  for (const [scenarioId, cfg] of Object.entries(SCENARIOS)) {
    for (const tool of cfg.tools) {
      const adapter = byTool(tool);
      if (!adapter.scenarios.includes(scenarioId as ScenarioId)) {
        throw new Error(
          `invariant: SCENARIOS['${scenarioId}'].tools includes '${tool}', but ` +
            `'${tool}'.scenarios = [${adapter.scenarios.join(",")}] does not include '${scenarioId}'`,
        );
      }
    }
  }
  for (const adapter of registry.all()) {
    for (const scenarioId of adapter.scenarios) {
      if (!SCENARIOS[scenarioId].tools.includes(adapter.name)) {
        throw new Error(
          `invariant: '${adapter.name}'.scenarios includes '${scenarioId}', but ` +
            `SCENARIOS['${scenarioId}'].tools = [${SCENARIOS[scenarioId].tools.join(",")}] ` +
            `does not include '${adapter.name}'`,
        );
      }
    }
  }
}
```

- [ ] **Step 2.2.2: Re-run the spec; verify still failing on adapter changes (next task)**

```bash
pnpm -F @modeldoctor/tool-adapters test scenarios
```

Expected: failures now mention `byTool(...).scenarios is undefined` because adapters haven't been extended yet. That's covered in Task 2.3.

### Task 2.3: Extend ToolAdapter interface and adapters

**Files:**
- Modify: `packages/tool-adapters/src/core/interface.ts`
- Modify: `packages/tool-adapters/src/guidellm/index.ts`
- Modify: `packages/tool-adapters/src/vegeta/index.ts`
- Modify: `packages/tool-adapters/src/genai-perf/index.ts`
- Modify: `packages/tool-adapters/src/core/registry.ts`

- [ ] **Step 2.3.1: Add `scenarios` to the ToolAdapter interface**

In `packages/tool-adapters/src/core/interface.ts`, locate the `export interface ToolAdapter {` block. Add a new field at the top of the body, right after `readonly name: ToolName`:

```typescript
export interface ToolAdapter {
  readonly name: ToolName;
  readonly scenarios: readonly import("../scenarios.js").ScenarioId[];
  readonly paramsSchema: z.ZodTypeAny;
  // ...rest unchanged
}
```

(Type-only import via `import("...")` avoids the circular-dep issue described in the existing comment about `ToolReport`.)

- [ ] **Step 2.3.2: Update guidellmAdapter**

In `packages/tool-adapters/src/guidellm/index.ts`, find the exported adapter object. Add `scenarios: ['inference', 'capacity'] as const` immediately after `name: 'guidellm'`:

```typescript
export const guidellmAdapter: ToolAdapter = {
  name: "guidellm",
  scenarios: ["inference", "capacity"] as const,
  // ...rest unchanged
};
```

- [ ] **Step 2.3.3: Update vegetaAdapter**

In `packages/tool-adapters/src/vegeta/index.ts`:

```typescript
export const vegetaAdapter: ToolAdapter = {
  name: "vegeta",
  scenarios: ["gateway"] as const,
  // ...rest unchanged
};
```

- [ ] **Step 2.3.4: Update genaiPerfAdapter**

In `packages/tool-adapters/src/genai-perf/index.ts`:

```typescript
export const genaiPerfAdapter: ToolAdapter = {
  name: "genai-perf",
  scenarios: ["inference"] as const,
  // ...rest unchanged
};
```

- [ ] **Step 2.3.5: Add `byScenario` helper to the registry**

In `packages/tool-adapters/src/core/registry.ts`, add (or update — the existing file already has a `byTool` function):

```typescript
import type { ScenarioId } from "../scenarios.js";

export function byScenario(scenario: ScenarioId): ToolAdapter[] {
  return registry.all().filter((a) => a.scenarios.includes(scenario));
}
```

(If `registry.all()` doesn't exist, expose it: `export const registry = { all: () => [...adapters] };` based on the existing pattern.)

- [ ] **Step 2.3.6: Re-run the scenarios spec**

```bash
pnpm -F @modeldoctor/tool-adapters test scenarios
```

Expected: all green.

- [ ] **Step 2.3.7: Run the full tool-adapters test suite**

```bash
pnpm -F @modeldoctor/tool-adapters test
```

Expected: all green. If existing adapter unit tests break because they construct mock adapters without `scenarios`, update those mocks to include a `scenarios: []` (or appropriate value). Prefer the real values where the test exercises tool selection, empty array where the test only exercises buildCommand/parseFinalReport.

### Task 2.4: Re-export scenarios from package entry points

**Files:**
- Modify: `packages/tool-adapters/src/index.ts`
- Modify: `packages/tool-adapters/src/schemas-entry.ts`

- [ ] **Step 2.4.1: Update `index.ts`**

Add at the bottom of `packages/tool-adapters/src/index.ts`:

```typescript
export * from "./scenarios.js";
```

- [ ] **Step 2.4.2: Update `schemas-entry.ts`**

`schemas-entry.ts` is the entry that `apps/web` consumes via `@modeldoctor/tool-adapters/schemas`. Add at the bottom:

```typescript
export {
  SCENARIOS,
  scenarioIdSchema,
  type ScenarioId,
  type ScenarioConfig,
} from "./scenarios.js";
```

- [ ] **Step 2.4.3: Build the package**

```bash
pnpm -F @modeldoctor/tool-adapters build
```

Expected: build exits 0; `dist/scenarios.js` and `dist/scenarios.d.ts` produced.

### Task 2.5: Commit Phase 2

- [ ] **Step 2.5.1: Stage and commit**

```bash
git add packages/tool-adapters/
git commit -m "$(cat <<'EOF'
feat(tool-adapters): add scenarios module and per-adapter scenarios field

ToolAdapter gains `scenarios: readonly ScenarioId[]`; guidellm declares
['inference','capacity'], vegeta ['gateway'], genai-perf ['inference'].

scenarios.ts exports SCENARIOS const + applyScenarioConstraints helper
that overlays a per-scenario zod refinement onto the adapter's base
paramsSchema (e.g. capacity+guidellm forces rateType=sweep).

assertScenariosInvariant guards SCENARIOS.tools / adapter.scenarios
mutual consistency at test time.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3: contracts package — rename `run.ts` → `benchmark.ts`, add scenario fields, add `benchmark-template.ts`, reshape `e2e-test.ts` → `diagnostics.ts`

### Task 3.1: Author `benchmark.ts`

**Files:**
- Create: `packages/contracts/src/benchmark.ts`
- (Will Delete in Task 3.6: `packages/contracts/src/run.ts`)

- [ ] **Step 3.1.1: Write the new contract module**

```typescript
import { z } from "zod";
import { baselineSummarySchema } from "./baseline.js";

// ── Discriminators ───────────────────────────────────────────────────
export const scenarioIdSchema = z.enum(["inference", "capacity", "gateway"]);
export type ScenarioId = z.infer<typeof scenarioIdSchema>;

export const benchmarkToolSchema = z.enum(["guidellm", "genai-perf", "vegeta"]);
export type BenchmarkTool = z.infer<typeof benchmarkToolSchema>;

export const benchmarkStatusSchema = z.enum([
  "pending",
  "submitted",
  "running",
  "completed",
  "failed",
  "canceled",
]);
export type BenchmarkStatus = z.infer<typeof benchmarkStatusSchema>;

export const benchmarkDriverKindSchema = z.enum(["local", "k8s"]);
export type BenchmarkDriverKind = z.infer<typeof benchmarkDriverKindSchema>;

export const benchmarkConnectionRefSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type BenchmarkConnectionRef = z.infer<typeof benchmarkConnectionRefSchema>;

// ── Persisted shape (GET /api/benchmarks/:id) ────────────────────────
export const benchmarkSchema = z.object({
  id: z.string(),
  userId: z.string().nullable(),
  connectionId: z.string().nullable(),
  connection: benchmarkConnectionRefSchema.nullable(),

  scenario: scenarioIdSchema,
  tool: benchmarkToolSchema,
  toolVersion: z.string().nullable(),
  driverKind: benchmarkDriverKindSchema,

  name: z.string().nullable(),
  description: z.string().nullable(),

  status: benchmarkStatusSchema,
  statusMessage: z.string().nullable(),
  progress: z.number().nullable(),

  driverHandle: z.string().nullable(),

  params: z.record(z.unknown()),
  rawOutput: z.record(z.unknown()).nullable(),
  summaryMetrics: z.record(z.unknown()).nullable(),
  serverMetrics: z.record(z.unknown()).nullable(),

  templateId: z.string().nullable(),
  parentBenchmarkId: z.string().nullable(),
  baselineId: z.string().nullable(),

  logs: z.string().nullable(),

  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),

  baselineFor: baselineSummarySchema.nullable(),
});
export type Benchmark = z.infer<typeof benchmarkSchema>;

// ── List query ───────────────────────────────────────────────────────
export const listBenchmarksQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
  scenario: scenarioIdSchema.optional(),
  tool: benchmarkToolSchema.optional(),
  status: benchmarkStatusSchema.optional(),
  connectionId: z.string().optional(),
  parentBenchmarkId: z.string().optional(),
  templateId: z.string().optional(),
  search: z.string().optional(),
  createdAfter: z.string().datetime().optional(),
  createdBefore: z.string().datetime().optional(),
  isBaseline: z
    .preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean())
    .optional(),
  referencesBaseline: z
    .preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean())
    .optional(),
  scope: z.enum(["own", "all"]).default("own"),
});
export type ListBenchmarksQuery = z.infer<typeof listBenchmarksQuerySchema>;

export const listBenchmarksResponseSchema = z.object({
  items: z.array(benchmarkSchema),
  nextCursor: z.string().nullable(),
});
export type ListBenchmarksResponse = z.infer<typeof listBenchmarksResponseSchema>;

// ── Create request ───────────────────────────────────────────────────
export const createBenchmarkRequestSchema = z.object({
  scenario: scenarioIdSchema,
  tool: benchmarkToolSchema,
  connectionId: z.string().min(1),
  name: z.string().min(1).max(128),
  description: z.string().max(2048).optional(),
  params: z.record(z.unknown()),
  templateId: z.string().optional(),
  parentBenchmarkId: z.string().optional(),
  baselineId: z.string().optional(),
});
export type CreateBenchmarkRequest = z.infer<typeof createBenchmarkRequestSchema>;

// ── Internal callback schemas (runner pod → API) ─────────────────────
export const benchmarkStateCallbackSchema = z.object({
  state: z.literal("running"),
  toolVersion: z.string().max(50).optional(),
});
export type BenchmarkStateCallback = z.infer<typeof benchmarkStateCallbackSchema>;

export const benchmarkLogCallbackSchema = z.object({
  stream: z.enum(["stdout", "stderr"]),
  lines: z.array(z.string().max(64 * 1024)).max(2000),
});
export type BenchmarkLogCallback = z.infer<typeof benchmarkLogCallbackSchema>;

export const benchmarkFinishCallbackSchema = z.object({
  state: z.enum(["completed", "failed"]),
  exitCode: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
  files: z.record(z.string()),
  message: z.string().max(2048).optional(),
});
export type BenchmarkFinishCallback = z.infer<typeof benchmarkFinishCallbackSchema>;

// ── Charts response (GET /api/benchmarks/:id/charts) ─────────────────
export const histogramBucketSchema = z.object({
  lower: z.number(),
  upper: z.number(),
  count: z.number().int().nonnegative(),
});
export type HistogramBucket = z.infer<typeof histogramBucketSchema>;

export const benchmarkChartsResponseSchema = z.object({
  latencyCdf: z.object({ samples: z.array(z.number()) }).nullable(),
  ttftHistogram: z.object({ buckets: z.array(histogramBucketSchema) }).nullable(),
});
export type BenchmarkChartsResponse = z.infer<typeof benchmarkChartsResponseSchema>;
```

### Task 3.2: Author `benchmark-template.ts`

**Files:**
- Create: `packages/contracts/src/benchmark-template.ts`

- [ ] **Step 3.2.1: Write the contract module**

```typescript
import { z } from "zod";
import { benchmarkToolSchema, scenarioIdSchema } from "./benchmark.js";

export const benchmarkTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  scenario: scenarioIdSchema,
  tool: benchmarkToolSchema,
  config: z.record(z.unknown()),
  isOfficial: z.boolean(),
  createdBy: z.string().nullable(),
  tags: z.array(z.string()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type BenchmarkTemplate = z.infer<typeof benchmarkTemplateSchema>;

export const listBenchmarkTemplatesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
  scenario: scenarioIdSchema.optional(),
  tool: benchmarkToolSchema.optional(),
  isOfficial: z
    .preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean())
    .optional(),
  search: z.string().optional(),
});
export type ListBenchmarkTemplatesQuery = z.infer<typeof listBenchmarkTemplatesQuerySchema>;

export const listBenchmarkTemplatesResponseSchema = z.object({
  items: z.array(benchmarkTemplateSchema),
  nextCursor: z.string().nullable(),
});
export type ListBenchmarkTemplatesResponse = z.infer<typeof listBenchmarkTemplatesResponseSchema>;

export const createBenchmarkTemplateRequestSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(2048).optional(),
  scenario: scenarioIdSchema,
  tool: benchmarkToolSchema,
  config: z.record(z.unknown()),
  tags: z.array(z.string().min(1).max(40)).max(20).default([]),
  isOfficial: z.boolean().default(false), // server enforces admin-only
});
export type CreateBenchmarkTemplateRequest = z.infer<typeof createBenchmarkTemplateRequestSchema>;

export const updateBenchmarkTemplateRequestSchema =
  createBenchmarkTemplateRequestSchema.partial();
export type UpdateBenchmarkTemplateRequest = z.infer<typeof updateBenchmarkTemplateRequestSchema>;
```

### Task 3.3: Author `diagnostics.ts`

**Files:**
- Create: `packages/contracts/src/diagnostics.ts`
- (Will Delete in Task 3.6: `packages/contracts/src/e2e-test.ts`)

- [ ] **Step 3.3.1: Write the contract module**

Inspect the existing `packages/contracts/src/e2e-test.ts` to capture the `ProbeName` enum and probe-result shape currently in use. The persisted-row schema is new (today there's no per-run DTO; e2e returns results synchronously and writes to the runs table). Write:

```typescript
import { z } from "zod";

// ── Probes (mirror existing values; keep stable for runner compat) ──
// Source these from the existing PROBES constant in apps/api; this
// schema is the authoritative public contract.
export const probeNameSchema = z.enum([
  "chat",
  "embeddings",
  "rerank",
  "imageGenerate",
  "imageEdit",
  "audioTts",
  "audioStt",
]);
export type ProbeName = z.infer<typeof probeNameSchema>;

// ── Per-probe result ────────────────────────────────────────────────
export const probeCheckSchema = z.object({
  name: z.string(),
  pass: z.boolean(),
  info: z.string().optional(),
});

export const probeResultSchema = z.object({
  probe: probeNameSchema,
  pass: z.boolean(),
  latencyMs: z.number().nullable(),
  checks: z.array(probeCheckSchema),
  details: z.record(z.unknown()).optional(),
});
export type ProbeResult = z.infer<typeof probeResultSchema>;

// ── Persisted row (DiagnosticsRun) ──────────────────────────────────
export const diagnosticsStatusSchema = z.enum(["completed", "failed"]);
export type DiagnosticsStatus = z.infer<typeof diagnosticsStatusSchema>;

export const diagnosticsRunSchema = z.object({
  id: z.string(),
  userId: z.string().nullable(),
  connectionId: z.string().nullable(),
  status: diagnosticsStatusSchema,
  statusMessage: z.string().nullable(),
  probes: z.array(probeNameSchema),
  pathOverride: z.record(z.unknown()),
  results: z.array(probeResultSchema),
  summary: z.object({
    total: z.number().int().nonnegative(),
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type DiagnosticsRun = z.infer<typeof diagnosticsRunSchema>;

// ── Request bodies ──────────────────────────────────────────────────
export const diagnosticsRunRequestSchema = z.object({
  connectionId: z.string().min(1),
  probes: z.array(probeNameSchema).min(1),
  pathOverride: z.record(z.string()).optional(),
});
export type DiagnosticsRunRequest = z.infer<typeof diagnosticsRunRequestSchema>;

export const diagnosticsRunResponseSchema = z.object({
  diagnosticsRunId: z.string(),
  success: z.boolean(),
  results: z.array(probeResultSchema),
});
export type DiagnosticsRunResponse = z.infer<typeof diagnosticsRunResponseSchema>;

// ── List query ──────────────────────────────────────────────────────
export const listDiagnosticsRunsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
  connectionId: z.string().optional(),
});
export type ListDiagnosticsRunsQuery = z.infer<typeof listDiagnosticsRunsQuerySchema>;

export const listDiagnosticsRunsResponseSchema = z.object({
  items: z.array(diagnosticsRunSchema),
  nextCursor: z.string().nullable(),
});
export type ListDiagnosticsRunsResponse = z.infer<typeof listDiagnosticsRunsResponseSchema>;
```

(Keep the existing `e2e-test.ts` alive temporarily — Task 3.6 removes it.)

### Task 3.4: Update `baseline.ts` (`runId` → `benchmarkId`)

**Files:**
- Modify: `packages/contracts/src/baseline.ts`

- [ ] **Step 3.4.1: Rename the field across the schema**

Find every occurrence of `runId` in `packages/contracts/src/baseline.ts` and rename to `benchmarkId`. Find every occurrence of `run` (the resolved relation) in the schema and rename to `benchmark`. Verify zod field names also match.

```bash
# Sanity check after edits
grep -n "runId\|\\brun\\b" packages/contracts/src/baseline.ts
```

Expected: no matches except inside English prose / comments (where you should still update for consistency). The `BaselineSummary` type may have a `runId` field — also rename to `benchmarkId`.

- [ ] **Step 3.4.2: Update baseline spec**

`packages/contracts/src/baseline.spec.ts` — same rename. Run:

```bash
pnpm -F @modeldoctor/contracts test baseline
```

Expected: green.

### Task 3.5: Update `index.ts` to export new modules

**Files:**
- Modify: `packages/contracts/src/index.ts`

- [ ] **Step 3.5.1: Replace `run` exports with `benchmark`/`benchmark-template`/`diagnostics`**

Open `packages/contracts/src/index.ts`. Replace the line(s) that export from `./run.js` with:

```typescript
export * from "./benchmark.js";
export * from "./benchmark-template.js";
export * from "./diagnostics.js";
```

Remove any `export * from "./run.js"` and `export * from "./e2e-test.js"` lines.

### Task 3.6: Delete legacy contract files

**Files:**
- Delete: `packages/contracts/src/run.ts`
- Delete: `packages/contracts/src/run-charts.spec.ts` (if test only ran against the deleted module)
- Delete: `packages/contracts/src/e2e-test.ts`

- [ ] **Step 3.6.1: Remove the files**

```bash
rm packages/contracts/src/run.ts \
   packages/contracts/src/e2e-test.ts
# run-charts.spec.ts: only delete if test exclusively imports from run.ts;
# otherwise rename to benchmark-charts.spec.ts and update imports.
git mv packages/contracts/src/run-charts.spec.ts packages/contracts/src/benchmark-charts.spec.ts || true
```

- [ ] **Step 3.6.2: Update `benchmark-charts.spec.ts` imports**

Replace any `from "./run.js"` with `from "./benchmark.js"`; replace symbol names (`runChartsResponseSchema` → `benchmarkChartsResponseSchema`, etc.) per the new contract.

- [ ] **Step 3.6.3: Build + test contracts**

```bash
pnpm -F @modeldoctor/contracts build
pnpm -F @modeldoctor/contracts test
```

Expected: build green, tests green.

### Task 3.7: Commit Phase 3

- [ ] **Step 3.7.1: Stage and commit**

```bash
git add packages/contracts/src/benchmark.ts \
        packages/contracts/src/benchmark-template.ts \
        packages/contracts/src/diagnostics.ts \
        packages/contracts/src/baseline.ts \
        packages/contracts/src/baseline.spec.ts \
        packages/contracts/src/index.ts \
        packages/contracts/src/benchmark-charts.spec.ts \
        ':(exclude)packages/contracts/src/run.ts' \
        ':(exclude)packages/contracts/src/e2e-test.ts'
git rm packages/contracts/src/run.ts packages/contracts/src/e2e-test.ts
# (The exclude pattern above is just defensive; git rm handles deletes.)
git commit -m "$(cat <<'EOF'
feat(contracts): rename Run→Benchmark, add scenario, split Diagnostics

- benchmark.ts replaces run.ts; gains scenario/toolVersion/parentBenchmarkId
- benchmark-template.ts is the new contract for templates table
- diagnostics.ts replaces e2e-test.ts and adds DiagnosticsRun persisted shape
- baseline.ts: runId → benchmarkId
- index.ts re-exports the new modules; old files deleted

Drops: kind enum, mode enum, scenario JSONB free-form bag,
       tool='custom'/'e2e' enum values, templateVersion field.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4: Backend benchmark module rename

This is a mechanical move + class/symbol rename. The behaviors are unchanged; scenario validation lands in Phase 5.

### Task 4.1: Move the `run/` directory to `benchmark/`

**Files:** entire directory move per Rename Map above.

- [ ] **Step 4.1.1: Move via git**

```bash
git mv apps/api/src/modules/run apps/api/src/modules/benchmark
ls apps/api/src/modules/
```

Expected: the `benchmark/` directory now exists with the old run-module contents; `run/` is gone.

- [ ] **Step 4.1.2: Rename the four top-level files inside benchmark/**

```bash
cd apps/api/src/modules/benchmark
git mv run.module.ts benchmark.module.ts
git mv run.controller.ts benchmark.controller.ts
git mv run.controller.spec.ts benchmark.controller.spec.ts
git mv run.service.ts benchmark.service.ts
git mv run.service.spec.ts benchmark.service.spec.ts
git mv run.repository.ts benchmark.repository.ts
git mv run.repository.spec.ts benchmark.repository.spec.ts
git mv run-charts.service.ts benchmark-charts.service.ts
git mv run-charts.service.spec.ts benchmark-charts.service.spec.ts
cd callbacks
git mv run-callback.controller.ts benchmark-callback.controller.ts
git mv run-callback.controller.spec.ts benchmark-callback.controller.spec.ts
cd ../drivers
git mv run-driver.factory.ts benchmark-driver.factory.ts
git mv run-driver.factory.spec.ts benchmark-driver.factory.spec.ts
git mv run-driver.token.ts benchmark-driver.token.ts
git mv execution-driver.interface.ts execution-driver.interface.ts # unchanged name; keep
cd /Users/fangyong/vllm/modeldoctor/feat-benchmark-restructure-pr1
```

(`subprocess-driver.ts`, `k8s-job-driver.ts`, `k8s-job-manifest.ts` keep their filenames — they're tool-agnostic execution.)

- [ ] **Step 4.1.3: Verify the new tree**

```bash
ls apps/api/src/modules/benchmark/ apps/api/src/modules/benchmark/callbacks/ apps/api/src/modules/benchmark/drivers/
```

Expected: filenames now use `benchmark.*` and `benchmark-*` prefixes; old run.* files absent.

### Task 4.2: Class and symbol rename

**Files:** all files moved in Task 4.1.

- [ ] **Step 4.2.1: Rename classes inside benchmark module files**

The renames follow a pattern. Use a small script-style sequence — for each file, rewrite the class name and exported symbols:

```bash
# For each file pair, use sed (macOS BSD sed; -i '' required)
cd apps/api/src/modules/benchmark
for f in benchmark.module.ts benchmark.controller.ts benchmark.controller.spec.ts \
         benchmark.service.ts benchmark.service.spec.ts \
         benchmark.repository.ts benchmark.repository.spec.ts \
         benchmark-charts.service.ts benchmark-charts.service.spec.ts \
         callbacks/benchmark-callback.controller.ts callbacks/benchmark-callback.controller.spec.ts \
         drivers/benchmark-driver.factory.ts drivers/benchmark-driver.factory.spec.ts \
         drivers/benchmark-driver.token.ts; do
  sed -i '' \
    -e 's/RunModule/BenchmarkModule/g' \
    -e 's/RunController/BenchmarkController/g' \
    -e 's/RunService/BenchmarkService/g' \
    -e 's/RunRepository/BenchmarkRepository/g' \
    -e 's/RunChartsService/BenchmarkChartsService/g' \
    -e 's/RunCallbackController/BenchmarkCallbackController/g' \
    -e 's/RunDriverFactory/BenchmarkDriverFactory/g' \
    -e 's/RUN_DRIVER/BENCHMARK_DRIVER/g' \
    -e 's/RunExecutionDriver/BenchmarkExecutionDriver/g' \
    -e 's/RunDriver/BenchmarkDriver/g' \
    -e 's/runDriverKindSchema/benchmarkDriverKindSchema/g' \
    -e 's/RunWithRelations/BenchmarkWithRelations/g' \
    "$f"
done
cd /Users/fangyong/vllm/modeldoctor/feat-benchmark-restructure-pr1
```

(The sed approach is mechanical; if it produces an unwanted side-effect — e.g. a comment containing "Run" gets mangled — fix that file by hand.)

- [ ] **Step 4.2.2: Update import paths in the renamed files**

The internal imports change from `./run.repository.js` etc. to `./benchmark.repository.js`:

```bash
cd apps/api/src/modules/benchmark
sed -i '' \
  -e 's|/run\.repository\.js|/benchmark.repository.js|g' \
  -e 's|/run\.service\.js|/benchmark.service.js|g' \
  -e 's|/run\.controller\.js|/benchmark.controller.js|g' \
  -e 's|/run\.module\.js|/benchmark.module.js|g' \
  -e 's|/run-charts\.service\.js|/benchmark-charts.service.js|g' \
  -e 's|/run-callback\.controller\.js|/benchmark-callback.controller.js|g' \
  -e 's|/run-driver\.factory\.js|/benchmark-driver.factory.js|g' \
  -e 's|/run-driver\.token\.js|/benchmark-driver.token.js|g' \
  *.ts callbacks/*.ts drivers/*.ts
cd /Users/fangyong/vllm/modeldoctor/feat-benchmark-restructure-pr1
```

- [ ] **Step 4.2.3: Update `benchmark.service.ts` to use new contract types**

Open `apps/api/src/modules/benchmark/benchmark.service.ts`. Replace contract import lines from `@modeldoctor/contracts` such as `CreateRunRequest`, `Run`, `ListRunsQuery`, `ListRunsResponse` with the new names:

```typescript
import {
  type CreateBenchmarkRequest,
  type ListBenchmarksQuery,
  type ListBenchmarksResponse,
  type Benchmark,
} from "@modeldoctor/contracts";
```

Update method signatures:

```typescript
async findById(id: string): Promise<Benchmark | null> { /* ... */ }
async findByIdOrFail(id: string, userId?: string): Promise<Benchmark> { /* ... */ }
async list(query: ListBenchmarksQuery, userId?: string): Promise<ListBenchmarksResponse> { /* ... */ }
async create(userId: string, req: CreateBenchmarkRequest): Promise<Benchmark> { /* ... */ }
async start(benchmarkId: string): Promise<Benchmark> { /* ... */ }
async cancel(id: string, userId?: string): Promise<Benchmark> { /* ... */ }
```

The body of `create()` will be replaced in Phase 5 to apply scenario constraints; for now it remains structurally identical (just pass `req.scenario` through to the repository call).

Inside the `toContract()` helper at the bottom of the file:

```typescript
function toContract(row: BenchmarkWithRelations): Benchmark {
  return {
    id: row.id,
    userId: row.userId,
    connectionId: row.connectionId,
    connection: row.connection ? { id: row.connection.id, name: row.connection.name } : null,
    scenario: row.scenario as Benchmark["scenario"],
    tool: row.tool as Benchmark["tool"],
    toolVersion: row.toolVersion,
    driverKind: row.driverKind as Benchmark["driverKind"],
    name: row.name,
    description: row.description,
    status: row.status as Benchmark["status"],
    statusMessage: row.statusMessage,
    progress: row.progress,
    driverHandle: row.driverHandle,
    params: row.params as Benchmark["params"],
    rawOutput: row.rawOutput as Benchmark["rawOutput"],
    summaryMetrics: row.summaryMetrics as Benchmark["summaryMetrics"],
    serverMetrics: row.serverMetrics as Benchmark["serverMetrics"],
    templateId: row.templateId,
    parentBenchmarkId: row.parentBenchmarkId,
    baselineId: row.baselineId,
    baselineFor: row.baselineFor
      ? {
          id: row.baselineFor.id,
          name: row.baselineFor.name,
          createdAt: row.baselineFor.createdAt.toISOString(),
        }
      : null,
    logs: row.logs,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

export { toContract as benchmarkRowToContract };
```

(Drops: `kind`, `mode`, `scenario` JSON, `templateVersion`. Adds: `scenario` typed, `toolVersion`, `parentBenchmarkId`.)

- [ ] **Step 4.2.4: Update `benchmark.repository.ts`**

Open `apps/api/src/modules/benchmark/benchmark.repository.ts`. Update Prisma model references: `prisma.run.*` → `prisma.benchmark.*`. Drop the `kind` filter if present in `list()` (no longer in query schema — replaced by `scenario`). Add `scenario`/`templateId`/`parentBenchmarkId` to query support.

The `BenchmarkWithRelations` exported type signature:

```typescript
import type { Prisma } from "@prisma/client";

export type BenchmarkWithRelations = Prisma.BenchmarkGetPayload<{
  include: {
    connection: { select: { id: true; name: true } };
    baselineFor: { select: { id: true; name: true; createdAt: true } };
  };
}>;
```

The `create()` method:

```typescript
async create(input: {
  userId: string | null;
  connectionId: string;
  scenario: string;
  tool: string;
  driverKind: string;
  name: string;
  description: string | null;
  params: Prisma.InputJsonValue;
  templateId: string | null;
  parentBenchmarkId: string | null;
  baselineId: string | null;
}): Promise<BenchmarkWithRelations> {
  return this.prisma.benchmark.create({
    data: {
      userId: input.userId,
      connectionId: input.connectionId,
      scenario: input.scenario,
      tool: input.tool,
      driverKind: input.driverKind,
      name: input.name,
      description: input.description,
      params: input.params,
      templateId: input.templateId,
      parentBenchmarkId: input.parentBenchmarkId,
      baselineId: input.baselineId,
      status: "pending",
    },
    include: {
      connection: { select: { id: true, name: true } },
      baselineFor: { select: { id: true, name: true, createdAt: true } },
    },
  });
}
```

The `list()` method:

```typescript
async list(query: {
  userId?: string;
  cursor?: string;
  limit?: number;
  scenario?: string;
  tool?: string;
  status?: string;
  connectionId?: string;
  parentBenchmarkId?: string;
  templateId?: string;
  search?: string;
  createdAfter?: string;
  createdBefore?: string;
  isBaseline?: boolean;
  referencesBaseline?: boolean;
}): Promise<{ items: BenchmarkWithRelations[]; nextCursor: string | null }> {
  // Construct the where clause similarly to the existing implementation;
  // replace the dropped `kind` filter with the new `scenario` filter.
  // The rest (cursor pagination, isBaseline join, etc.) is identical.
  // ...keep the existing implementation logic, just rename Run→Benchmark
}
```

The `countActiveByName()` method also moves from `prisma.run` to `prisma.benchmark` and any other references.

- [ ] **Step 4.2.5: Update `benchmark.controller.ts`**

Replace route base + types:

```typescript
import {
  type CreateBenchmarkRequest,
  type ListBenchmarksQuery,
  type ListBenchmarksResponse,
  type Benchmark,
  type BenchmarkChartsResponse,
  createBenchmarkRequestSchema,
  listBenchmarksQuerySchema,
} from "@modeldoctor/contracts";
// ...

@Controller("benchmarks")
@UseGuards(JwtAuthGuard)
export class BenchmarkController {
  constructor(
    private readonly service: BenchmarkService,
    private readonly charts: BenchmarkChartsService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: JwtPayload,
    @Query(new ZodValidationPipe(listBenchmarksQuerySchema)) query: ListBenchmarksQuery,
  ): Promise<ListBenchmarksResponse> { /* ...same logic */ }

  // ...other route handlers similarly renamed; route paths stay relative to /benchmarks
}
```

Error codes likewise rename: `RUN_PARAMS_INVALID` → `BENCHMARK_PARAMS_INVALID`, `RUN_NAME_IN_USE` → `BENCHMARK_NAME_IN_USE`, `RUN_NOT_TERMINAL` → `BENCHMARK_NOT_TERMINAL`, `RUN_ALREADY_TERMINAL` → `BENCHMARK_ALREADY_TERMINAL`, `RUN_SCOPE_FORBIDDEN` → `BENCHMARK_SCOPE_FORBIDDEN`. Apply via sed:

```bash
sed -i '' \
  -e 's/RUN_PARAMS_INVALID/BENCHMARK_PARAMS_INVALID/g' \
  -e 's/RUN_NAME_IN_USE/BENCHMARK_NAME_IN_USE/g' \
  -e 's/RUN_NOT_TERMINAL/BENCHMARK_NOT_TERMINAL/g' \
  -e 's/RUN_ALREADY_TERMINAL/BENCHMARK_ALREADY_TERMINAL/g' \
  -e 's/RUN_SCOPE_FORBIDDEN/BENCHMARK_SCOPE_FORBIDDEN/g' \
  apps/api/src/modules/benchmark/*.ts apps/api/src/modules/benchmark/**/*.ts
```

- [ ] **Step 4.2.6: Update HMAC callback controller paths**

`benchmark-callback.controller.ts` currently registers `@Controller('internal/runs')`. Change to:

```typescript
@Controller("internal/benchmarks")
export class BenchmarkCallbackController {
  // ...
  @Post(":id/state")
  state(/* args */) { /* ... */ }
  @Post(":id/log")
  log(/* args */) { /* ... */ }
  @Post(":id/finish")
  finish(/* args */) { /* ... */ }
}
```

The body validation switches to the new schemas (`benchmarkStateCallbackSchema`, etc.), and the state callback now accepts an optional `toolVersion: string`. When it's present, persist it:

```typescript
@Post(":id/state")
async state(
  @Param("id") id: string,
  @Body(new ZodValidationPipe(benchmarkStateCallbackSchema)) body: BenchmarkStateCallback,
  @Headers("x-callback-token") token: string | undefined,
): Promise<{ ok: true }> {
  await this.verifyToken(id, token);
  await this.repo.update(id, {
    status: "running",
    startedAt: new Date(),
    ...(body.toolVersion ? { toolVersion: body.toolVersion } : {}),
  });
  return { ok: true };
}
```

(The `repo.update` signature should already accept partial updates; if not, extend it to include `toolVersion`.)

### Task 4.3: Update `app.module.ts`

**Files:**
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 4.3.1: Replace module imports**

```typescript
// Before:
import { RunModule } from "./modules/run/run.module.js";
import { E2ETestModule } from "./modules/e2e-test/e2e-test.module.js";

// After (BenchmarkTemplateModule and DiagnosticsModule wired in Tasks 4.4 / 6):
import { BenchmarkModule } from "./modules/benchmark/benchmark.module.js";
import { BenchmarkTemplateModule } from "./modules/benchmark-template/benchmark-template.module.js";
import { DiagnosticsModule } from "./modules/diagnostics/diagnostics.module.js";

@Module({
  imports: [
    // ...
    BenchmarkModule,
    BenchmarkTemplateModule,
    DiagnosticsModule,
    // ...
  ],
})
export class AppModule {}
```

(Compile errors from missing `BenchmarkTemplateModule` / `DiagnosticsModule` will resolve in Tasks 4.4 and 6 respectively.)

### Task 4.4: Skeleton `benchmark-template` module (placeholder for PR2)

**Files:**
- Create: `apps/api/src/modules/benchmark-template/benchmark-template.module.ts`
- Create: `apps/api/src/modules/benchmark-template/benchmark-template.repository.ts`
- Create: `apps/api/src/modules/benchmark-template/benchmark-template.repository.spec.ts`

PR1 needs the module wired so the DI graph resolves and `BenchmarkService` can validate `templateId` references. Full CRUD lands in PR2.

- [ ] **Step 4.4.1: Author the repository (minimal)**

```typescript
// apps/api/src/modules/benchmark-template/benchmark-template.repository.ts
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/prisma.service.js";

@Injectable()
export class BenchmarkTemplateRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByIdOrNull(id: string) {
    return this.prisma.benchmarkTemplate.findUnique({ where: { id } });
  }
}
```

(`PrismaService` path matches existing module convention; verify by inspecting `apps/api/src/modules/connection/connection.repository.ts` import path and mirror it.)

- [ ] **Step 4.4.2: Author the module**

```typescript
// apps/api/src/modules/benchmark-template/benchmark-template.module.ts
import { Module } from "@nestjs/common";
import { PrismaModule } from "../../common/prisma.module.js";
import { BenchmarkTemplateRepository } from "./benchmark-template.repository.js";

@Module({
  imports: [PrismaModule],
  providers: [BenchmarkTemplateRepository],
  exports: [BenchmarkTemplateRepository],
})
export class BenchmarkTemplateModule {}
```

- [ ] **Step 4.4.3: Author a minimal repository test**

```typescript
// apps/api/src/modules/benchmark-template/benchmark-template.repository.spec.ts
import { describe, expect, it, beforeEach } from "vitest";
import { BenchmarkTemplateRepository } from "./benchmark-template.repository.js";
import { createTestPrisma } from "../../testing/test-prisma.js"; // mirror existing convention

describe("BenchmarkTemplateRepository", () => {
  let repo: BenchmarkTemplateRepository;
  beforeEach(() => {
    repo = new BenchmarkTemplateRepository(createTestPrisma());
  });

  it("findByIdOrNull returns null for missing id", async () => {
    const found = await repo.findByIdOrNull("nonexistent");
    expect(found).toBeNull();
  });
});
```

- [ ] **Step 4.4.4: Run the spec**

```bash
pnpm -F @modeldoctor/api test benchmark-template
```

Expected: green.

### Task 4.5: Verify `benchmark` module typechecks and tests pass

- [ ] **Step 4.5.1: Typecheck**

```bash
pnpm -F @modeldoctor/api type-check
```

Expected: zero errors. If errors mention things from the diagnostics or baseline modules (which we haven't migrated yet), they'll be addressed in Phases 5 and 6 — capture them in a notes file and revisit there.

- [ ] **Step 4.5.2: Test**

```bash
pnpm -F @modeldoctor/api test benchmark
```

Expected: tests pass; the renamed test files validate the renamed implementations.

### Task 4.6: Commit Phase 4

- [ ] **Step 4.6.1: Stage and commit**

```bash
git add apps/api/src/modules/benchmark \
        apps/api/src/modules/benchmark-template \
        apps/api/src/app.module.ts
git rm -r apps/api/src/modules/run 2>/dev/null || true
git commit -m "$(cat <<'EOF'
refactor(api): rename run module to benchmark; route /api/benchmarks/*

Mechanical rename: directory, filenames, classes, exported tokens,
error codes (RUN_* → BENCHMARK_*), and HMAC callback path
(/api/internal/runs → /api/internal/benchmarks).

Adds skeleton BenchmarkTemplateModule with a no-op
BenchmarkTemplateRepository so BenchmarkService can validate
templateId references at create time. Full CRUD lands in PR2.

Phase 5 follows: scenario validation in BenchmarkService.create.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 5: Backend benchmark scenario validation

Wire scenario into the create path: validate `(scenario, tool)` is a permitted pair and apply scenario-specific param constraints.

### Task 5.1: TDD — failing tests for scenario validation

**Files:**
- Modify: `apps/api/src/modules/benchmark/benchmark.service.spec.ts`

- [ ] **Step 5.1.1: Add three failing tests**

Append to the existing service spec:

```typescript
describe("BenchmarkService.create — scenario validation", () => {
  it("rejects (scenario='capacity', tool='vegeta') — vegeta does not serve capacity", async () => {
    const req = {
      scenario: "capacity",
      tool: "vegeta",
      connectionId: "conn-1",
      name: "should-fail",
      params: { /* any */ },
    } as const;
    await expect(service.create("user-1", req)).rejects.toThrow(/scenario .* does not support tool/);
  });

  it("rejects guidellm with rateType=sweep under inference scenario", async () => {
    const req = {
      scenario: "inference",
      tool: "guidellm",
      connectionId: "conn-1",
      name: "no-sweep-here",
      params: {
        profile: "throughput",
        apiType: "chat",
        datasetName: "random",
        datasetInputTokens: 256,
        datasetOutputTokens: 64,
        rateType: "sweep", // ← should be rejected
        // ...other required fields filled in
      },
    } as const;
    await expect(service.create("user-1", req)).rejects.toThrow(/rateType/i);
  });

  it("rejects guidellm without rateType=sweep under capacity scenario", async () => {
    const req = {
      scenario: "capacity",
      tool: "guidellm",
      connectionId: "conn-1",
      name: "must-be-sweep",
      params: { rateType: "constant" /* + required fields */ },
    } as const;
    await expect(service.create("user-1", req)).rejects.toThrow(/rateType/i);
  });
});
```

(Fill in the placeholder `params` fields with the minimum the adapter's base schema requires; consult `packages/tool-adapters/src/guidellm/schema.ts`.)

- [ ] **Step 5.1.2: Run tests; expect three new failures**

```bash
pnpm -F @modeldoctor/api test benchmark.service
```

Expected: three failures matching the new describe block.

### Task 5.2: Wire scenario into BenchmarkService.create

**Files:**
- Modify: `apps/api/src/modules/benchmark/benchmark.service.ts`

- [ ] **Step 5.2.1: Replace the params validation in `create()`**

Find the existing `adapter.paramsSchema.parse(req.params)` call. Replace with a scenario-aware version:

```typescript
import { applyScenarioConstraints, byTool } from "@modeldoctor/tool-adapters";
import type { ScenarioId } from "@modeldoctor/contracts";

async create(userId: string, req: CreateBenchmarkRequest): Promise<Benchmark> {
  const conn = await this.connections.getOwnedDecrypted(userId, req.connectionId);
  const adapter = byTool(req.tool);

  // Validate scenario × tool compatibility before zod parse — gives a
  // crisper error than "rateType not allowed".
  if (!adapter.scenarios.includes(req.scenario)) {
    throw new BadRequestException({
      code: "BENCHMARK_SCENARIO_TOOL_MISMATCH",
      message: `scenario '${req.scenario}' does not support tool '${req.tool}'`,
    });
  }

  // Apply scenario-specific overlays (e.g. force rateType=sweep for capacity).
  let params: unknown;
  try {
    const merged = applyScenarioConstraints(req.scenario, req.tool);
    params = merged.parse(req.params);
  } catch (e) {
    throw new BadRequestException({
      code: "BENCHMARK_PARAMS_INVALID",
      message: `params validation failed: ${(e as Error).message}`,
    });
  }

  const dupes = await this.repo.countActiveByName(userId, req.name);
  if (dupes > 0) {
    throw new ConflictException({
      code: "BENCHMARK_NAME_IN_USE",
      message: `An active benchmark named '${req.name}' already exists`,
    });
  }

  if (req.templateId) {
    const tpl = await this.templates.findByIdOrNull(req.templateId);
    if (!tpl) {
      throw new BadRequestException({
        code: "BENCHMARK_TEMPLATE_NOT_FOUND",
        message: `templateId '${req.templateId}' does not exist`,
      });
    }
    if (tpl.scenario !== req.scenario || tpl.tool !== req.tool) {
      throw new BadRequestException({
        code: "BENCHMARK_TEMPLATE_MISMATCH",
        message: `template scenario/tool does not match requested benchmark`,
      });
    }
  }

  const created = await this.repo.create({
    userId,
    connectionId: conn.id,
    scenario: req.scenario,
    tool: req.tool,
    driverKind: this.driverKind,
    name: req.name,
    description: req.description ?? null,
    params: params as Prisma.InputJsonValue,
    templateId: req.templateId ?? null,
    parentBenchmarkId: req.parentBenchmarkId ?? null,
    baselineId: req.baselineId ?? null,
  });

  return await this.start(created.id);
}
```

- [ ] **Step 5.2.2: Inject `BenchmarkTemplateRepository`**

Update the constructor:

```typescript
constructor(
  private readonly repo: BenchmarkRepository,
  @Inject(BENCHMARK_DRIVER) private readonly driver: BenchmarkExecutionDriver,
  private readonly config: ConfigService<Env, true>,
  private readonly connections: ConnectionService,
  private readonly templates: BenchmarkTemplateRepository,
) {
  // ...existing body unchanged
}
```

Update `benchmark.module.ts` to import `BenchmarkTemplateModule`:

```typescript
@Module({
  imports: [/* ... */, BenchmarkTemplateModule],
  // ...
})
export class BenchmarkModule {}
```

- [ ] **Step 5.2.3: Re-run the failing tests**

```bash
pnpm -F @modeldoctor/api test benchmark.service
```

Expected: all green, including the three new scenario tests.

### Task 5.3: Commit Phase 5

- [ ] **Step 5.3.1: Stage and commit**

```bash
git add apps/api/src/modules/benchmark/benchmark.service.ts \
        apps/api/src/modules/benchmark/benchmark.service.spec.ts \
        apps/api/src/modules/benchmark/benchmark.module.ts
git commit -m "$(cat <<'EOF'
feat(api): wire scenario validation into BenchmarkService.create

- Reject (scenario, tool) pairs not allowed by adapter.scenarios
- Apply applyScenarioConstraints overlays before zod parse
- Validate templateId points to a real template with matching scenario/tool

New error codes: BENCHMARK_SCENARIO_TOOL_MISMATCH,
                 BENCHMARK_TEMPLATE_NOT_FOUND,
                 BENCHMARK_TEMPLATE_MISMATCH.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 6: Backend baseline rename

Update the baseline module to use `benchmarkId` everywhere.

### Task 6.1: Rename `runId` → `benchmarkId` across the baseline module

**Files:**
- Modify: `apps/api/src/modules/baseline/baseline.controller.ts`
- Modify: `apps/api/src/modules/baseline/baseline.controller.spec.ts`
- Modify: `apps/api/src/modules/baseline/baseline.service.ts`
- Modify: `apps/api/src/modules/baseline/baseline.service.spec.ts`
- Modify: `apps/api/src/modules/baseline/baseline.repository.ts`
- Modify: `apps/api/src/modules/baseline/baseline.repository.spec.ts`

- [ ] **Step 6.1.1: Sed-based rename**

```bash
cd apps/api/src/modules/baseline
sed -i '' \
  -e 's/runId/benchmarkId/g' \
  -e 's/\\brun\\b/benchmark/g' \
  -e 's/Run\\b/Benchmark/g' \
  -e 's|runs\\.findById|benchmarks.findById|g' \
  *.ts
cd /Users/fangyong/vllm/modeldoctor/feat-benchmark-restructure-pr1
```

(Sed regex `\\b...\\b` is conservative; review the diff manually before staging.)

- [ ] **Step 6.1.2: Update Prisma references**

`baseline.repository.ts` — replace `prisma.run.*` with `prisma.benchmark.*`; update relation includes (`run` → `benchmark`).

- [ ] **Step 6.1.3: Run tests**

```bash
pnpm -F @modeldoctor/api test baseline
```

Expected: green.

### Task 6.2: Commit Phase 6

- [ ] **Step 6.2.1: Stage and commit**

```bash
git add apps/api/src/modules/baseline
git commit -m "$(cat <<'EOF'
refactor(api): baseline.runId → benchmarkId

Mechanical rename across baseline.controller / .service / .repository
and their specs. Prisma relations updated.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 7: Backend diagnostics module split

Move `e2e-test/` to `diagnostics/`, replace `RunRepository` with a new `DiagnosticsRepository`, and route under `/api/diagnostics/*`.

### Task 7.1: Move the directory + rename top-level files

**Files:** entire directory move per Rename Map.

- [ ] **Step 7.1.1: Move via git**

```bash
git mv apps/api/src/modules/e2e-test apps/api/src/modules/diagnostics
cd apps/api/src/modules/diagnostics
git mv e2e-test.module.ts diagnostics.module.ts
git mv e2e-test.controller.ts diagnostics.controller.ts
git mv e2e-test.service.ts diagnostics.service.ts
git mv e2e-test.service.spec.ts diagnostics.service.spec.ts
cd /Users/fangyong/vllm/modeldoctor/feat-benchmark-restructure-pr1
```

### Task 7.2: TDD — failing tests for the new repository

**Files:**
- Create: `apps/api/src/modules/diagnostics/diagnostics.repository.spec.ts`

- [ ] **Step 7.2.1: Author the repository spec**

```typescript
import { beforeEach, describe, expect, it } from "vitest";
import { DiagnosticsRepository } from "./diagnostics.repository.js";
import { createTestPrisma } from "../../testing/test-prisma.js";

describe("DiagnosticsRepository", () => {
  let repo: DiagnosticsRepository;
  beforeEach(() => { repo = new DiagnosticsRepository(createTestPrisma()); });

  it("create + findById round-trips a row", async () => {
    const created = await repo.create({
      userId: null,
      connectionId: null,
      probes: ["chat"],
      pathOverride: {},
    });
    expect(created.id).toBeTruthy();
    expect(created.status).toBe("completed"); // initial status set by service before create finalize
  });

  it("update marks the row as failed and writes statusMessage", async () => {
    const row = await repo.create({ userId: null, connectionId: null, probes: ["chat"], pathOverride: {} });
    await repo.update(row.id, {
      status: "failed",
      statusMessage: "boom",
      results: [],
      summary: { total: 0, passed: 0, failed: 0 },
      completedAt: new Date(),
    });
    const re = await repo.findById(row.id);
    expect(re?.status).toBe("failed");
    expect(re?.statusMessage).toBe("boom");
  });
});
```

- [ ] **Step 7.2.2: Run; expect failure**

```bash
pnpm -F @modeldoctor/api test diagnostics.repository
```

Expected: file not found / module not found.

### Task 7.3: Implement `DiagnosticsRepository`

**Files:**
- Create: `apps/api/src/modules/diagnostics/diagnostics.repository.ts`

- [ ] **Step 7.3.1: Author the repository**

```typescript
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/prisma.service.js";
import type { Prisma } from "@prisma/client";

@Injectable()
export class DiagnosticsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: {
    userId: string | null;
    connectionId: string | null;
    probes: string[];
    pathOverride: Prisma.InputJsonValue;
  }) {
    return this.prisma.diagnosticsRun.create({
      data: {
        userId: input.userId,
        connectionId: input.connectionId,
        status: "completed",
        statusMessage: null,
        probes: input.probes,
        pathOverride: input.pathOverride,
        results: [] as Prisma.InputJsonValue,
        summary: { total: 0, passed: 0, failed: 0 } as Prisma.InputJsonValue,
        startedAt: new Date(),
      },
    });
  }

  async update(id: string, patch: {
    status?: "completed" | "failed";
    statusMessage?: string | null;
    results?: Prisma.InputJsonValue;
    summary?: Prisma.InputJsonValue;
    completedAt?: Date;
  }) {
    return this.prisma.diagnosticsRun.update({ where: { id }, data: patch });
  }

  async findById(id: string) {
    return this.prisma.diagnosticsRun.findUnique({ where: { id } });
  }
}
```

- [ ] **Step 7.3.2: Run tests**

```bash
pnpm -F @modeldoctor/api test diagnostics.repository
```

Expected: green.

### Task 7.4: Refactor `DiagnosticsService` to drop `RunRepository`

**Files:**
- Modify: `apps/api/src/modules/diagnostics/diagnostics.service.ts`
- Modify: `apps/api/src/modules/diagnostics/diagnostics.service.spec.ts`

- [ ] **Step 7.4.1: Replace the service body**

```typescript
import type {
  DiagnosticsRunRequest,
  DiagnosticsRunResponse,
  ProbeName,
  ProbeResult,
} from "@modeldoctor/contracts";
import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PROBES, type ProbeCtx } from "../../integrations/probes/index.js";
import type { DecryptedConnection } from "../connection/connection.service.js";
import { DiagnosticsRepository } from "./diagnostics.repository.js";

function parseHeaderLines(s: string | undefined): Record<string, string> {
  // identical to current implementation; copy verbatim
  const out: Record<string, string> = {};
  if (!s || !s.trim()) return out;
  for (const rawLine of s.split("\n").map((l) => l.trim())) {
    if (!rawLine || !rawLine.includes(":")) continue;
    const idx = rawLine.indexOf(":");
    out[rawLine.slice(0, idx).trim()] = rawLine.slice(idx + 1).trim();
  }
  return out;
}

@Injectable()
export class DiagnosticsService {
  constructor(private readonly repo: DiagnosticsRepository) {}

  private async executeProbes(
    conn: DecryptedConnection,
    req: DiagnosticsRunRequest,
  ): Promise<ProbeResult[]> {
    const extraHeaders = parseHeaderLines(conn.customHeaders);
    return Promise.all(
      req.probes.map(async (name: ProbeName) => {
        const ctx: ProbeCtx = {
          apiBaseUrl: conn.baseUrl,
          apiKey: conn.apiKey,
          model: conn.model,
          extraHeaders,
          pathOverride: req.pathOverride?.[name],
        };
        try {
          const r = await PROBES[name](ctx);
          return { probe: name, ...r };
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          return {
            probe: name,
            pass: false,
            latencyMs: null,
            checks: [{ name: "probe execution", pass: false, info: msg }],
            details: { error: msg },
          };
        }
      }),
    );
  }

  async run(
    userId: string | undefined,
    conn: DecryptedConnection,
    req: DiagnosticsRunRequest,
  ): Promise<DiagnosticsRunResponse> {
    const created = await this.repo.create({
      userId: userId ?? null,
      connectionId: conn.id,
      probes: req.probes,
      pathOverride: (req.pathOverride ?? {}) as Prisma.InputJsonValue,
    });

    try {
      const results = await this.executeProbes(conn, req);
      const allPassed = results.every((r) => r.pass);
      await this.repo.update(created.id, {
        status: allPassed ? "completed" : "failed",
        completedAt: new Date(),
        results: results as unknown as Prisma.InputJsonValue,
        summary: {
          total: results.length,
          passed: results.filter((r) => r.pass).length,
          failed: results.filter((r) => !r.pass).length,
        } as Prisma.InputJsonValue,
      });
      return { diagnosticsRunId: created.id, success: allPassed, results };
    } catch (err) {
      await this.repo.update(created.id, {
        status: "failed",
        statusMessage: err instanceof Error ? err.message : String(err),
        completedAt: new Date(),
      });
      throw err;
    }
  }
}
```

(Note: `conn.id` was nullable on the parent type previously. Verify and adjust `DecryptedConnection.id` references; `connectionId` in the repository accepts `null` if the connection was deleted, but the typical flow always has a real connection.)

- [ ] **Step 7.4.2: Update `diagnostics.service.spec.ts`**

The existing spec uses `prisma.run.deleteMany({ where: { kind: 'e2e' } })` for setup. Replace with `prisma.diagnosticsRun.deleteMany({})`. Update assertions: `row.kind === 'e2e'` → `row.status` (just verify `status === 'completed'`/`'failed'` per the test scenario); rename `runId` field on response to `diagnosticsRunId`.

```typescript
// example replacement for the existing test "creates a Run row with kind=e2e and returns runId"
it("creates a DiagnosticsRun row and returns diagnosticsRunId", async () => {
  const result = await service.run("user-1", conn, { probes: ["chat"], pathOverride: {} });
  expect(result.diagnosticsRunId).toBeTruthy();
  const row = await prisma.diagnosticsRun.findUnique({ where: { id: result.diagnosticsRunId } });
  expect(row).toBeTruthy();
  expect(row?.probes).toEqual(["chat"]);
});
```

- [ ] **Step 7.4.3: Update `diagnostics.controller.ts`**

```typescript
@Controller("diagnostics")
@UseGuards(JwtAuthGuard)
export class DiagnosticsController {
  constructor(
    private readonly service: DiagnosticsService,
    private readonly connections: ConnectionService,
  ) {}

  @Post("runs")
  async run(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(diagnosticsRunRequestSchema)) body: DiagnosticsRunRequest,
  ): Promise<DiagnosticsRunResponse> {
    const conn = await this.connections.getOwnedDecrypted(user.sub, body.connectionId);
    return this.service.run(user.sub, conn, body);
  }

  // (Optional list endpoint can land in PR3+ when web wants pagination)
}
```

- [ ] **Step 7.4.4: Update `diagnostics.module.ts`**

```typescript
@Module({
  imports: [PrismaModule, ConnectionModule],
  controllers: [DiagnosticsController],
  providers: [DiagnosticsService, DiagnosticsRepository],
  exports: [DiagnosticsService],
})
export class DiagnosticsModule {}
```

- [ ] **Step 7.4.5: Run all diagnostics tests**

```bash
pnpm -F @modeldoctor/api test diagnostics
```

Expected: green.

### Task 7.5: Commit Phase 7

- [ ] **Step 7.5.1: Stage and commit**

```bash
git add apps/api/src/modules/diagnostics
git rm -r apps/api/src/modules/e2e-test 2>/dev/null || true
git commit -m "$(cat <<'EOF'
refactor(api): split e2e probes into diagnostics module

- Renames apps/api/src/modules/e2e-test/ → diagnostics/
- New DiagnosticsRepository writes diagnostics_runs table
  (no more dependency on RunRepository / runs table)
- DiagnosticsController routes under /api/diagnostics/runs
- Persisted shape adds explicit probes / pathOverride / results / summary

Probes themselves (apps/api/src/integrations/probes/) unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 8: Runner image — new callback paths + toolVersion reporting

### Task 8.1: Update runner outbound URLs

**Files:**
- Modify: `apps/benchmark-runner/runner/main.py`
- Modify: `apps/benchmark-runner/runner/callback.py`

- [ ] **Step 8.1.1: Update path constants**

In `apps/benchmark-runner/runner/main.py` (or wherever the callback URLs are constructed), replace:

```python
# Before:
state_url = f"{callback_base}/api/internal/runs/{run_id}/state"
log_url   = f"{callback_base}/api/internal/runs/{run_id}/log"
finish_url = f"{callback_base}/api/internal/runs/{run_id}/finish"

# After:
state_url = f"{callback_base}/api/internal/benchmarks/{benchmark_id}/state"
log_url   = f"{callback_base}/api/internal/benchmarks/{benchmark_id}/log"
finish_url = f"{callback_base}/api/internal/benchmarks/{benchmark_id}/finish"
```

(The variable name `run_id` → `benchmark_id` is also a rename; keep them consistent.)

- [ ] **Step 8.1.2: Capture tool version at boot**

Add a helper in `apps/benchmark-runner/runner/main.py`:

```python
import subprocess

def detect_tool_version(tool: str) -> str | None:
    """Run `<tool> --version` and return the first stdout line stripped.
    Returns None if the tool is missing or the call fails.
    """
    try:
        result = subprocess.run([tool, "--version"], capture_output=True, text=True, timeout=10)
        if result.returncode != 0:
            return None
        line = (result.stdout or result.stderr).strip().split("\n", 1)[0].strip()
        return line[:50] if line else None
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None
```

Call it before posting the `state=running` callback:

```python
tool_version = detect_tool_version(tool_name)  # e.g. "guidellm"
post_state_callback(state_url, token, body={"state": "running", "toolVersion": tool_version})
```

- [ ] **Step 8.1.3: Update callback payload schema in `callback.py`**

If `callback.py` uses a typed dict / pydantic model for the state payload, extend it:

```python
class StateCallbackBody(TypedDict, total=False):
    state: str  # required
    toolVersion: str | None  # optional
```

Adjust the post helper's signature to accept the optional field.

### Task 8.2: TDD — runner test for toolVersion

**Files:**
- Modify: `apps/benchmark-runner/tests/test_callback.py` (or create if absent — mirror existing test files)

- [ ] **Step 8.2.1: Author the test**

```python
import respx
import httpx
from runner.callback import post_state

@respx.mock
def test_post_state_includes_tool_version():
    route = respx.post("http://api.local/api/internal/benchmarks/abc/state").mock(
        return_value=httpx.Response(200, json={"ok": True})
    )
    post_state("http://api.local/api/internal/benchmarks/abc/state", "tok", "guidellm 0.5.2")
    assert route.called
    assert route.calls[0].request.read().startswith(b"{")  # body is JSON
    payload = route.calls[0].request.read().decode()
    assert "\"toolVersion\":\"guidellm 0.5.2\"" in payload
```

(Adjust to whatever HTTP testing utility the project already uses — `responses`, `respx`, or `requests-mock`. Match the existing test file's style.)

- [ ] **Step 8.2.2: Run**

```bash
cd apps/benchmark-runner && pytest -q
cd /Users/fangyong/vllm/modeldoctor/feat-benchmark-restructure-pr1
```

Expected: pass for the new test; existing tests still green.

### Task 8.3: Build a fresh runner image and bump tag

**Files:**
- Modify: `apps/api/src/config/env.schema.ts` (image tag bump)
- Modify: `apps/api/.env.example` (image tag bump)

- [ ] **Step 8.3.1: Build the local image**

```bash
cd apps/benchmark-runner
docker build -t modeldoctor-runner:pr1 -f images/Dockerfile .
cd /Users/fangyong/vllm/modeldoctor/feat-benchmark-restructure-pr1
```

Expected: image builds successfully.

- [ ] **Step 8.3.2: Bump `BENCHMARK_IMAGE_*` defaults / examples**

If `.env.example` references the runner image tag, update; if env defaults are set in `apps/api/src/config/env.schema.ts` defaults, update too. Specific tag string is `modeldoctor-runner:pr1` (or whatever the team's tagging convention prefers).

### Task 8.4: Commit Phase 8

- [ ] **Step 8.4.1: Stage and commit**

```bash
git add apps/benchmark-runner apps/api/.env.example apps/api/src/config/env.schema.ts
git commit -m "$(cat <<'EOF'
feat(runner): post toolVersion in state callback; rename callback paths

- Runner posts to /api/internal/benchmarks/:id/{state,log,finish}
  (was: /api/internal/runs/:id/...)
- state=running body now includes optional toolVersion captured from
  `<tool> --version` at boot
- Bumps default runner image tag

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 9: Frontend — features rename (`runs/` → `benchmarks/`, `e2e-smoke/` → `diagnostics/`)

This is purely structural; behavior changes land in Phases 10–14.

### Task 9.1: Move directories

- [ ] **Step 9.1.1: Move both directories**

```bash
git mv apps/web/src/features/runs apps/web/src/features/benchmarks
git mv apps/web/src/features/e2e-smoke apps/web/src/features/diagnostics
```

- [ ] **Step 9.1.2: Rename top-level component files inside benchmarks/**

```bash
cd apps/web/src/features/benchmarks
git mv RunListPage.tsx BenchmarkListShell.tsx       # gets refactored in Phase 10
git mv RunCreatePage.tsx BenchmarkCreatePage.tsx
git mv RunDetailPage.tsx BenchmarkDetailPage.tsx
git mv RunDetailMetadata.tsx BenchmarkDetailMetadata.tsx
git mv RunDetailRawOutput.tsx BenchmarkDetailRawOutput.tsx
git mv RunListFilters.tsx BenchmarkListFilters.tsx
# SetBaselineDialog.tsx keeps its name
cd compare
git mv RunComparePage.tsx BenchmarkComparePage.tsx
cd ../..
cd /Users/fangyong/vllm/modeldoctor/feat-benchmark-restructure-pr1
```

- [ ] **Step 9.1.3: Rename the test files**

```bash
cd apps/web/src/features/benchmarks/__tests__
git mv RunListPage.test.tsx BenchmarkListShell.test.tsx
git mv RunCreatePage.test.tsx BenchmarkCreatePage.test.tsx
git mv RunDetailPage.test.tsx BenchmarkDetailPage.test.tsx
cd /Users/fangyong/vllm/modeldoctor/feat-benchmark-restructure-pr1
```

(`HistoryFilters.test.tsx` and `SetBaselineDialog.test.tsx` keep their names; their imports change.)

- [ ] **Step 9.1.4: Rename diagnostics top-level**

```bash
cd apps/web/src/features/diagnostics
git mv E2ESmokePage.tsx DiagnosticsPage.tsx
git mv E2ESmokePage.test.tsx DiagnosticsPage.test.tsx 2>/dev/null || true
cd /Users/fangyong/vllm/modeldoctor/feat-benchmark-restructure-pr1
```

### Task 9.2: Sed-based class/symbol/import rename across frontend

- [ ] **Step 9.2.1: Bulk rename inside benchmarks/**

```bash
cd apps/web/src/features/benchmarks
find . -type f \( -name "*.ts" -o -name "*.tsx" \) -print0 | xargs -0 sed -i '' \
  -e 's/RunListPage/BenchmarkListShell/g' \
  -e 's/RunCreatePage/BenchmarkCreatePage/g' \
  -e 's/RunDetailPage/BenchmarkDetailPage/g' \
  -e 's/RunDetailMetadata/BenchmarkDetailMetadata/g' \
  -e 's/RunDetailRawOutput/BenchmarkDetailRawOutput/g' \
  -e 's/RunListFilters/BenchmarkListFilters/g' \
  -e 's/RunComparePage/BenchmarkComparePage/g' \
  -e 's/from "@\\/features\\/runs/from "@\\/features\\/benchmarks/g' \
  -e 's|from "\\.\\./runs|from "../benchmarks|g' \
  -e 's/useCreateRun/useCreateBenchmark/g' \
  -e 's/useRunDetail/useBenchmarkDetail/g' \
  -e 's/useRuns/useBenchmarks/g' \
  -e 's/useCancelRun/useCancelBenchmark/g' \
  -e 's/useDeleteRun/useDeleteBenchmark/g' \
  -e 's/runQueryKeys/benchmarkQueryKeys/g'
cd /Users/fangyong/vllm/modeldoctor/feat-benchmark-restructure-pr1
```

- [ ] **Step 9.2.2: Repeat for the rest of the web app (any references to runs/)**

```bash
cd apps/web/src
find . -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.json" \) -print0 | xargs -0 sed -i '' \
  -e 's|@\\/features\\/runs|@/features/benchmarks|g' \
  -e 's|@\\/features\\/e2e-smoke|@/features/diagnostics|g' \
  -e 's|/runs/|/benchmarks/|g'
cd /Users/fangyong/vllm/modeldoctor/feat-benchmark-restructure-pr1
```

(Be careful — `/runs/` may appear in user-facing strings; review the diff and revert any false positives like template literal i18n keys. We do an i18n update separately in Phase 14.)

- [ ] **Step 9.2.3: Update `api.ts` and `queries.ts` inside benchmarks/**

Open `apps/web/src/features/benchmarks/api.ts` and replace:
- Endpoint constants `/api/runs/*` → `/api/benchmarks/*`
- Type imports from contracts: `Run` → `Benchmark`, `CreateRunRequest` → `CreateBenchmarkRequest`, etc.

Open `apps/web/src/features/benchmarks/queries.ts` and rename hook names + query keys.

- [ ] **Step 9.2.4: Type-check and run web tests**

```bash
pnpm -F @modeldoctor/web type-check
pnpm -F @modeldoctor/web test
```

Expected: type-check green; tests may fail on the still-monolithic list page (gets refactored in Phase 10) — note the failures and proceed.

### Task 9.3: Commit Phase 9

- [ ] **Step 9.3.1: Stage and commit**

```bash
git add apps/web/src
git commit -m "$(cat <<'EOF'
refactor(web): rename runs/ → benchmarks/, e2e-smoke/ → diagnostics/

Mechanical rename: file paths, class names, hook names, API URLs,
import paths. Behavior unchanged in this commit; subsequent phases
add scenario list pages and scenario reports.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 10: Frontend — three scenario list pages + shared shell

### Task 10.1: Build the shared list shell

**Files:**
- Modify: `apps/web/src/features/benchmarks/BenchmarkListShell.tsx` (rebuilt; was the old monolithic list page)
- Create: `apps/web/src/features/benchmarks/scenarios.ts`

- [ ] **Step 10.1.1: Author the frontend SCENARIOS re-export with icons**

```typescript
// apps/web/src/features/benchmarks/scenarios.ts
import { Activity, Gauge, Network, type LucideIcon } from "lucide-react";
import { SCENARIOS, type ScenarioId } from "@modeldoctor/tool-adapters/schemas";

export const SCENARIO_ICONS: Record<ScenarioId, LucideIcon> = {
  inference: Gauge,
  capacity: Activity,
  gateway: Network,
};

export { SCENARIOS, type ScenarioId };
```

- [ ] **Step 10.1.2: Refactor `BenchmarkListShell.tsx` to take `scenario` as a prop**

The existing list-page logic becomes a shared shell that:
- Accepts `scenario: ScenarioId` as a prop.
- Filters the benchmarks query by `scenario`.
- Filters the form select for "create benchmark" by `SCENARIOS[scenario].tools`.
- Renders the standard PageHeader with `SCENARIOS[scenario].label` as title and `SCENARIOS[scenario].description` as subtitle.

```tsx
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useBenchmarks } from "./queries";
import { SCENARIOS, type ScenarioId } from "./scenarios";
// ...other existing imports

interface Props { scenario: ScenarioId; }

export function BenchmarkListShell({ scenario }: Props) {
  const { t } = useTranslation("benchmarks");
  const cfg = SCENARIOS[scenario];
  const { data } = useBenchmarks({ scenario });

  return (
    <>
      <PageHeader title={cfg.label} subtitle={cfg.description} />
      <div className="px-8 py-6">
        <div className="mb-4 flex justify-end">
          <Button asChild>
            <Link to={`/benchmarks/new?scenario=${scenario}`}>{t("actions.new")}</Link>
          </Button>
        </div>
        {/* keep the existing table/filters logic from the old list page,
            scoped to this scenario */}
        {/* ... */}
      </div>
    </>
  );
}
```

(Migrate the existing table + filter logic verbatim, just constraining the queried `scenario` and removing any tool-only filter dropdown when the scenario has only one tool.)

### Task 10.2: Build the three scenario pages

**Files:**
- Create: `apps/web/src/features/benchmarks/BenchmarkInferencePage.tsx`
- Create: `apps/web/src/features/benchmarks/BenchmarkCapacityPage.tsx`
- Create: `apps/web/src/features/benchmarks/BenchmarkGatewayPage.tsx`

- [ ] **Step 10.2.1: Author each page**

```tsx
// BenchmarkInferencePage.tsx
import { BenchmarkListShell } from "./BenchmarkListShell";
export function BenchmarkInferencePage() {
  return <BenchmarkListShell scenario="inference" />;
}
```

```tsx
// BenchmarkCapacityPage.tsx
import { BenchmarkListShell } from "./BenchmarkListShell";
export function BenchmarkCapacityPage() {
  return <BenchmarkListShell scenario="capacity" />;
}
```

```tsx
// BenchmarkGatewayPage.tsx
import { BenchmarkListShell } from "./BenchmarkListShell";
export function BenchmarkGatewayPage() {
  return <BenchmarkListShell scenario="gateway" />;
}
```

### Task 10.3: Update `useBenchmarks` to accept scenario filter

**Files:**
- Modify: `apps/web/src/features/benchmarks/queries.ts`

- [ ] **Step 10.3.1: Add scenario param to query options**

```typescript
import type { ScenarioId } from "@modeldoctor/tool-adapters/schemas";

export function useBenchmarks(opts: { scenario?: ScenarioId; cursor?: string } = {}) {
  return useQuery({
    queryKey: benchmarkQueryKeys.list(opts),
    queryFn: () => listBenchmarks(opts),
  });
}
```

Update `listBenchmarks` in `api.ts` to forward `scenario` as a query string param.

### Task 10.4: Commit Phase 10

- [ ] **Step 10.4.1: Stage and commit**

```bash
git add apps/web/src/features/benchmarks
git commit -m "$(cat <<'EOF'
feat(web): scenario-driven list pages (inference / capacity / gateway)

BenchmarkListShell takes a scenario prop; three thin pages wrap it.
useBenchmarks accepts a scenario filter and forwards it to the API.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 11: Frontend — three scenario report components

### Task 11.1: Build `InferenceReport`, `CapacityReport`, `GatewayReport`

**Files:**
- Create: `apps/web/src/features/benchmarks/reports/InferenceReport.tsx`
- Create: `apps/web/src/features/benchmarks/reports/CapacityReport.tsx`
- Create: `apps/web/src/features/benchmarks/reports/GatewayReport.tsx`
- Create: `apps/web/src/features/benchmarks/reports/UnknownReport.tsx`

- [ ] **Step 11.1.1: Author `InferenceReport`**

This component absorbs the salvageable parts of `GuidellmReportView` and `GenaiPerfReportView`. It dispatches by `benchmark.tool` internally:

```tsx
import type { Benchmark } from "@modeldoctor/contracts";
import { GuidellmInferenceMetrics } from "./guidellm/InferenceMetrics";
import { GenaiPerfInferenceMetrics } from "./genai-perf/InferenceMetrics";

interface Props { benchmark: Benchmark; }

export function InferenceReport({ benchmark }: Props) {
  switch (benchmark.tool) {
    case "guidellm":   return <GuidellmInferenceMetrics benchmark={benchmark} />;
    case "genai-perf": return <GenaiPerfInferenceMetrics benchmark={benchmark} />;
    default:           return <UnknownReport benchmark={benchmark} />;
  }
}
```

Move the relevant TTFT/ITL/E2E-latency/throughput rendering bits from `GuidellmReportView.tsx` into a new file `apps/web/src/features/benchmarks/reports/guidellm/InferenceMetrics.tsx`. Same for genai-perf. (Keep deltas minimal — copy verbatim, adjust import paths.)

- [ ] **Step 11.1.2: Author `CapacityReport`**

```tsx
import type { Benchmark } from "@modeldoctor/contracts";
import { GuidellmCapacityMetrics } from "./guidellm/CapacityMetrics";

interface Props { benchmark: Benchmark; }

export function CapacityReport({ benchmark }: Props) {
  // Capacity scenario only supports guidellm at present
  if (benchmark.tool !== "guidellm") return <UnknownReport benchmark={benchmark} />;
  return <GuidellmCapacityMetrics benchmark={benchmark} />;
}
```

`GuidellmCapacityMetrics` component skeleton:

```tsx
// apps/web/src/features/benchmarks/reports/guidellm/CapacityMetrics.tsx
import type { Benchmark } from "@modeldoctor/contracts";

interface Props { benchmark: Benchmark; }

export function GuidellmCapacityMetrics({ benchmark }: Props) {
  // PR1 scope: render the existing single-load metrics same as inference for now,
  // plus a placeholder banner that says "Sweep curve visualization coming in PR2".
  // This keeps PR1 deployable; the actual sweep curve implementation follows.
  return (
    <div className="space-y-4">
      <div className="rounded border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
        Sweep curve visualization is coming in a follow-up release. Raw output is
        available below.
      </div>
      {/* Reuse the inference metrics for now; sweep raw_output is still a valid
          guidellm summary even if we don't render the staircase yet. */}
      <GuidellmInferenceMetrics benchmark={benchmark} />
    </div>
  );
}
```

- [ ] **Step 11.1.3: Author `GatewayReport`**

```tsx
import type { Benchmark } from "@modeldoctor/contracts";
import { VegetaGatewayMetrics } from "./vegeta/GatewayMetrics";

interface Props { benchmark: Benchmark; }

export function GatewayReport({ benchmark }: Props) {
  if (benchmark.tool !== "vegeta") return <UnknownReport benchmark={benchmark} />;
  return <VegetaGatewayMetrics benchmark={benchmark} />;
}
```

`VegetaGatewayMetrics` absorbs all of the existing `VegetaReportView` content; copy verbatim into `apps/web/src/features/benchmarks/reports/vegeta/GatewayMetrics.tsx`, fix imports.

- [ ] **Step 11.1.4: Author `UnknownReport`**

```tsx
import type { Benchmark } from "@modeldoctor/contracts";
interface Props { benchmark: Benchmark; }

export function UnknownReport({ benchmark }: Props) {
  return (
    <div className="rounded border border-destructive/30 bg-destructive/5 p-4 text-sm">
      No report renderer for scenario={benchmark.scenario} / tool={benchmark.tool}.
    </div>
  );
}
```

### Task 11.2: Wire detail page to dispatch by `scenario`

**Files:**
- Modify: `apps/web/src/features/benchmarks/BenchmarkDetailPage.tsx`

- [ ] **Step 11.2.1: Replace the existing tool-keyed switch**

Find the existing rendering block that dispatches by `benchmark.tool` to one of `GuidellmReportView`/`VegetaReportView`/`GenaiPerfReportView`. Replace with:

```tsx
import { CapacityReport } from "./reports/CapacityReport";
import { GatewayReport } from "./reports/GatewayReport";
import { InferenceReport } from "./reports/InferenceReport";
import { UnknownReport } from "./reports/UnknownReport";

// Inside the JSX:
{benchmark.scenario === "inference" && <InferenceReport benchmark={benchmark} />}
{benchmark.scenario === "capacity" && <CapacityReport benchmark={benchmark} />}
{benchmark.scenario === "gateway" && <GatewayReport benchmark={benchmark} />}
{!["inference","capacity","gateway"].includes(benchmark.scenario) &&
  <UnknownReport benchmark={benchmark} />}
```

### Task 11.3: Delete the legacy report views

**Files:**
- Delete: `apps/web/src/features/benchmarks/reports/GuidellmReportView.tsx`
- Delete: `apps/web/src/features/benchmarks/reports/GenaiPerfReportView.tsx`
- Delete: `apps/web/src/features/benchmarks/reports/VegetaReportView.tsx`

- [ ] **Step 11.3.1: Remove unused legacy files**

```bash
git rm apps/web/src/features/benchmarks/reports/GuidellmReportView.tsx \
       apps/web/src/features/benchmarks/reports/GenaiPerfReportView.tsx \
       apps/web/src/features/benchmarks/reports/VegetaReportView.tsx
```

(`RunChartsSection.tsx` keeps its content but renames to `BenchmarkChartsSection.tsx`; do that move now too.)

```bash
git mv apps/web/src/features/benchmarks/reports/RunChartsSection.tsx \
       apps/web/src/features/benchmarks/reports/BenchmarkChartsSection.tsx
```

### Task 11.4: Update report tests

**Files:**
- Modify (rename): `apps/web/src/features/benchmarks/reports/__tests__/*.test.tsx`

- [ ] **Step 11.4.1: Rename test files and update imports**

```bash
cd apps/web/src/features/benchmarks/reports/__tests__
git mv GuidellmReportView.test.tsx GuidellmInferenceMetrics.test.tsx 2>/dev/null || true
git mv VegetaReportView.test.tsx VegetaGatewayMetrics.test.tsx 2>/dev/null || true
git mv GenaiPerfReportView.test.tsx GenaiPerfInferenceMetrics.test.tsx 2>/dev/null || true
cd /Users/fangyong/vllm/modeldoctor/feat-benchmark-restructure-pr1
```

Run them:

```bash
pnpm -F @modeldoctor/web test reports
```

Expected: all green after import fixes.

### Task 11.5: Commit Phase 11

- [ ] **Step 11.5.1: Stage and commit**

```bash
git add apps/web/src/features/benchmarks
git commit -m "$(cat <<'EOF'
feat(web): scenario-routed reports (Inference / Capacity / Gateway)

Detail page now dispatches by benchmark.scenario:
- InferenceReport (guidellm + genai-perf)
- CapacityReport (guidellm; sweep curve placeholder for follow-up)
- GatewayReport (vegeta)

Legacy *ReportView.tsx files retired; their content folds into the
new scenario reports.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 12: Frontend — compare page rebase

### Task 12.1: Add scenario-mismatch alert

**Files:**
- Modify: `apps/web/src/features/benchmarks/compare/BenchmarkComparePage.tsx`
- Modify: `apps/web/src/features/benchmarks/compare/__tests__/BenchmarkComparePage.test.tsx`

- [ ] **Step 12.1.1: TDD — failing test for mixed-scenario alert**

In `BenchmarkComparePage.test.tsx`, add:

```typescript
it("shows MixedScenariosAlert when selected benchmarks span scenarios", () => {
  const queryClient = new QueryClient(/* ... */);
  // Pre-fill cache with two benchmarks of different scenarios:
  queryClient.setQueryData(benchmarkQueryKeys.detail("a"), { /* scenario: "inference", tool: "guidellm" */ });
  queryClient.setQueryData(benchmarkQueryKeys.detail("b"), { /* scenario: "gateway", tool: "vegeta" */ });
  render(<BenchmarkComparePage />, { route: "/benchmarks/compare?ids=a,b" });
  expect(screen.getByRole("alert")).toHaveTextContent(/different scenarios/i);
  expect(screen.queryByTestId("compare-grid")).not.toBeInTheDocument();
});
```

- [ ] **Step 12.1.2: Implement the gating**

In `BenchmarkComparePage.tsx`, after the existing `isMixed = tools.size > 1` check, add:

```typescript
const scenarios = new Set(successfulBenchmarks.map((b) => b.scenario));
const isMixedScenarios = scenarios.size > 1;
```

Render an alert when `isMixedScenarios` is true; suppress the grid:

```tsx
{isMixedScenarios && (
  <Alert variant="destructive">
    <AlertTitle>{t("compare.mixedScenariosTitle")}</AlertTitle>
    <AlertDescription>
      {t("compare.mixedScenariosBody", { scenarios: [...scenarios].join(", ") })}
    </AlertDescription>
  </Alert>
)}
{!isMixed && !isMixedScenarios && <CompareGrid runs={successfulBenchmarks} {...props} />}
```

(Update the i18n keys in Phase 14.)

- [ ] **Step 12.1.3: Run the test**

```bash
pnpm -F @modeldoctor/web test BenchmarkComparePage
```

Expected: new test passes.

### Task 12.2: Add empty-state entry from menu

**Files:**
- Modify: `apps/web/src/features/benchmarks/compare/BenchmarkComparePage.tsx`

- [ ] **Step 12.2.1: Empty state when URL has no `ids` param**

```tsx
const ids = useMemo(() => parseIds(searchParams.get("ids")), [searchParams]);
if (ids.length === 0) {
  return <BenchmarkCompareEmpty />; // a thin component that shows scenario selector + recent-benchmarks picker
}
```

`BenchmarkCompareEmpty` is the menu-entry experience:

```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { SCENARIOS } from "../scenarios";
import { useBenchmarks } from "../queries";

export function BenchmarkCompareEmpty() {
  const navigate = useNavigate();
  const [scenario, setScenario] = useState<ScenarioId | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const { data } = useBenchmarks({ scenario: scenario ?? undefined });
  // Render a scenario picker + a list of completed benchmarks with checkboxes
  // On submit: navigate(`/benchmarks/compare?scenario=${scenario}&ids=${selected.join(",")}`);
  return (/* picker UI */ <div>{/* ... */}</div>);
}
```

(This empty-state is small but functional; iterate UX in PR3.)

### Task 12.3: Commit Phase 12

- [ ] **Step 12.3.1: Stage and commit**

```bash
git add apps/web/src/features/benchmarks/compare
git commit -m "$(cat <<'EOF'
feat(web/compare): add mixed-scenarios gating + menu empty-state entry

Compare page now blocks rendering when the selection spans more than
one scenario (in addition to the existing mixed-tools gate).

Empty URL (no ?ids=) renders BenchmarkCompareEmpty: scenario picker
+ recent-benchmark list, so the new top-level menu entry is functional.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 13: Frontend — create page accepts scenario from URL

### Task 13.1: Read scenario from query string

**Files:**
- Modify: `apps/web/src/features/benchmarks/BenchmarkCreatePage.tsx`

- [ ] **Step 13.1.1: Wire scenario into the form default**

```tsx
import { useSearchParams } from "react-router-dom";
import { scenarioIdSchema, type ScenarioId } from "@modeldoctor/contracts";
import { SCENARIOS } from "./scenarios";

export function BenchmarkCreatePage() {
  const [params] = useSearchParams();
  const scenarioParam = params.get("scenario");
  const scenarioParse = scenarioIdSchema.safeParse(scenarioParam);
  const scenario: ScenarioId = scenarioParse.success ? scenarioParse.data : "inference";

  // Use SCENARIOS[scenario].tools as the available tools list — narrow the
  // tool select to scenario-permitted values.
  const availableTools = SCENARIOS[scenario].tools;
  // ...rest of form unchanged, but tool select options sourced from availableTools.
}
```

- [ ] **Step 13.1.2: Submit body includes scenario**

```typescript
const onSubmit = form.handleSubmit(async (values) => {
  const body: CreateBenchmarkRequest = {
    scenario,
    tool: values.tool,
    connectionId: values.connectionId,
    name: values.name,
    description: values.description,
    params: values.params,
    templateId: values.templateId,
    parentBenchmarkId: values.parentBenchmarkId,
  };
  const benchmark = await createMut.mutateAsync(body);
  navigate(`/benchmarks/${benchmark.id}`);
});
```

- [ ] **Step 13.1.3: Update test**

`BenchmarkCreatePage.test.tsx` — add a case verifying `?scenario=capacity` constrains the tool dropdown to `['guidellm']`.

### Task 13.2: Commit Phase 13

- [ ] **Step 13.2.1: Stage and commit**

```bash
git add apps/web/src/features/benchmarks
git commit -m "$(cat <<'EOF'
feat(web/create): scenario from URL drives tool dropdown

BenchmarkCreatePage reads ?scenario=… from the URL (default: inference);
narrows the tool select to SCENARIOS[scenario].tools; sends scenario in
the create request body.

3-tab Modal/Drawer UX (template/history/blank) is PR3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 14: Frontend — router + sidebar + i18n

### Task 14.1: Rewrite the router

**Files:**
- Modify: `apps/web/src/router/index.tsx`

- [ ] **Step 14.1.1: Replace the runs/e2e routes**

```tsx
{ index: true, element: <Navigate to="/benchmarks/inference" replace /> },
{ path: "benchmarks", element: <Navigate to="/benchmarks/inference" replace /> },
{ path: "benchmarks/inference", element: <BenchmarkInferencePage /> },
{ path: "benchmarks/capacity",  element: <BenchmarkCapacityPage /> },
{ path: "benchmarks/gateway",   element: <BenchmarkGatewayPage /> },
{ path: "benchmarks/compare",   element: <BenchmarkComparePage /> },
{ path: "benchmarks/new",       element: <BenchmarkCreatePage /> },
{ path: "benchmarks/:id",       element: <BenchmarkDetailPage /> },
{ path: "diagnostics",          element: <DiagnosticsPage /> },
// Drop the old /runs/* and /e2e routes entirely.
```

Update top-of-file imports.

### Task 14.2: Rewrite the sidebar config

**Files:**
- Modify: `apps/web/src/components/sidebar/sidebar-config.tsx`

- [ ] **Step 14.2.1: Replace the groups**

```tsx
import {
  Activity, Boxes, Bug, CheckCircle2, Database,
  Gauge, GitCompare, Image as ImageIcon, Layers, LineChart,
  type LucideIcon, MessageSquare, Mic, Network, Settings,
} from "lucide-react";

export const sidebarGroups: SidebarGroup[] = [
  {
    id: "playground",
    labelKey: "groups.playground",
    items: [
      { to: "/playground/chat", icon: MessageSquare, labelKey: "items.playgroundChat" },
      { to: "/playground/image", icon: ImageIcon, labelKey: "items.playgroundImage" },
      { to: "/playground/audio", icon: Mic, labelKey: "items.playgroundAudio" },
      { to: "/playground/embeddings", icon: Boxes, labelKey: "items.playgroundEmbeddings" },
      { to: "/playground/rerank", icon: ListOrdered, labelKey: "items.playgroundRerank" },
    ],
  },
  {
    id: "benchmarks",
    labelKey: "groups.benchmarks",
    items: [
      { to: "/benchmarks/inference", icon: Gauge, labelKey: "items.benchmarkInference" },
      { to: "/benchmarks/capacity",  icon: Activity, labelKey: "items.benchmarkCapacity" },
      { to: "/benchmarks/gateway",   icon: Network, labelKey: "items.benchmarkGateway" },
      { to: "/benchmarks/compare",   icon: GitCompare, labelKey: "items.benchmarkCompare" },
      // benchmark-templates entry is omitted in PR1; lands in PR2.
    ],
  },
  {
    id: "diagnostics",
    labelKey: "groups.diagnostics",
    items: [
      { to: "/debug",       icon: Bug, labelKey: "items.requestDebug" },
      { to: "/diagnostics", icon: CheckCircle2, labelKey: "items.diagnostics" },
    ],
  },
  {
    id: "dev",
    labelKey: "groups.dev",
    items: [{ to: "/dev/charts", icon: LineChart, labelKey: "items.devCharts", devOnly: true }],
  },
];

export const sidebarUtilityItems: SidebarItem[] = [
  { to: "/connections", icon: Database, labelKey: "items.connections" },
  { to: "/settings", icon: Settings, labelKey: "items.settings" },
];
```

### Task 14.3: Update i18n files

**Files:**
- Modify: `apps/web/src/locales/en-US/sidebar.json`
- Modify: `apps/web/src/locales/zh-CN/sidebar.json`
- Rename: `apps/web/src/locales/en-US/runs.json` → `benchmarks.json`
- Rename: `apps/web/src/locales/zh-CN/runs.json` → `benchmarks.json`
- Rename: `apps/web/src/locales/en-US/e2e.json` → `diagnostics.json`
- Rename: `apps/web/src/locales/zh-CN/e2e.json` → `diagnostics.json`
- Modify: `apps/web/src/lib/i18n.ts`

- [ ] **Step 14.3.1: Update sidebar.json (en-US)**

Drop `groups.performance`, `groups.debug`, `items.runs`, `items.e2e`. Add:

```json
{
  "groups": {
    "playground": "Playground",
    "benchmarks": "Benchmarks",
    "diagnostics": "Diagnostics",
    "dev": "Developer"
  },
  "items": {
    "playgroundChat": "Chat",
    "playgroundImage": "Image",
    "playgroundAudio": "Audio",
    "playgroundEmbeddings": "Embeddings",
    "playgroundRerank": "Rerank",
    "benchmarkInference": "Inference Performance",
    "benchmarkCapacity": "Capacity Planning",
    "benchmarkGateway": "Gateway Load Test",
    "benchmarkCompare": "Compare",
    "requestDebug": "Request Debug",
    "diagnostics": "Endpoint Health",
    "connections": "Connections",
    "settings": "Settings",
    "devCharts": "Dev Charts"
  }
}
```

- [ ] **Step 14.3.2: Update sidebar.json (zh-CN)**

```json
{
  "groups": {
    "playground": "Playground",
    "benchmarks": "基准测试",
    "diagnostics": "诊断",
    "dev": "开发工具"
  },
  "items": {
    "playgroundChat": "对话",
    "playgroundImage": "图像",
    "playgroundAudio": "语音",
    "playgroundEmbeddings": "嵌入",
    "playgroundRerank": "重排",
    "benchmarkInference": "推理性能基准",
    "benchmarkCapacity": "容量规划",
    "benchmarkGateway": "网关压测",
    "benchmarkCompare": "对比分析",
    "requestDebug": "请求调试",
    "diagnostics": "端点检测",
    "connections": "连接",
    "settings": "设置",
    "devCharts": "图表调试"
  }
}
```

- [ ] **Step 14.3.3: Rename runs.json → benchmarks.json**

```bash
git mv apps/web/src/locales/en-US/runs.json apps/web/src/locales/en-US/benchmarks.json
git mv apps/web/src/locales/zh-CN/runs.json apps/web/src/locales/zh-CN/benchmarks.json
```

Inside each, replace user-facing strings ("Test Plan" → "Benchmark", "Run" → "Benchmark", etc.). Add new keys:

- `compare.mixedScenariosTitle` — "Different scenarios" / "场景不一致"
- `compare.mixedScenariosBody` — "Selected benchmarks span scenarios: {{scenarios}}. Compare is restricted to a single scenario." / "所选 benchmark 跨多个场景:{{scenarios}}。对比仅支持同一场景。"

- [ ] **Step 14.3.4: Rename e2e.json → diagnostics.json**

```bash
git mv apps/web/src/locales/en-US/e2e.json apps/web/src/locales/en-US/diagnostics.json
git mv apps/web/src/locales/zh-CN/e2e.json apps/web/src/locales/zh-CN/diagnostics.json
```

Update the strings inside (probe names, page titles).

- [ ] **Step 14.3.5: Update `lib/i18n.ts` namespace registration**

```typescript
// Before:
i18n.use(...).init({
  // ...
  ns: ["common", "auth", /* ... */, "runs", "e2e", /* ... */],
  // ...
});

// After:
ns: ["common", "auth", /* ... */, "benchmarks", "diagnostics", /* ... */],
```

Also update the resource map if it explicitly registers JSON files by namespace.

### Task 14.4: Run frontend full test suite

- [ ] **Step 14.4.1: Type-check + test**

```bash
pnpm -F @modeldoctor/web type-check
pnpm -F @modeldoctor/web test
```

Expected: green. If any test references an i18n key that no longer exists, update the assertion to the new key.

### Task 14.5: Commit Phase 14

- [ ] **Step 14.5.1: Stage and commit**

```bash
git add apps/web
git commit -m "$(cat <<'EOF'
feat(web): rewrite router + sidebar + i18n for benchmark restructure

Sidebar now exposes scenario-driven entries:
- Benchmarks group: Inference / Capacity / Gateway / Compare
- Diagnostics group: Request Debug / Endpoint Health (renamed from Debug)

i18n: runs.json → benchmarks.json; e2e.json → diagnostics.json.
Old keys (groups.performance, items.runs, items.e2e) removed; new keys
added for scenarios, compare mixed-scenario alerts.

/runs/* and /e2e routes removed; redirect to /benchmarks/inference.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 15: End-to-end smoke + final verification

### Task 15.1: Boot the full stack and exercise each menu

**Files:** none modified.

- [ ] **Step 15.1.1: Boot dev server**

```bash
pnpm dev
```

Expected: API on :3000, web on :5173, no startup errors.

- [ ] **Step 15.1.2: Verify each route**

In the browser, navigate to each:
- `/benchmarks/inference` — list page renders, headline "推理性能基准"
- `/benchmarks/capacity` — list page renders, headline "容量规划"
- `/benchmarks/gateway` — list page renders, headline "网关压测"
- `/benchmarks/compare` — empty state with scenario picker
- `/benchmarks/new?scenario=capacity` — tool select shows only GuideLLM; rateType locked to sweep
- `/diagnostics` — page renders; running a probe writes to `diagnostics_runs`
- `/runs` and `/e2e` — 404 (or redirect via the index/`/benchmarks` rule, as configured)

- [ ] **Step 15.1.3: Submit a real inference benchmark**

From `/benchmarks/inference` → 新建 → fill in connection/name/params → submit. Wait for completion. Detail page should:
- Show `InferenceReport`
- Display `toolVersion` in the metadata row (small "Tool: guidellm 0.5.x" badge)

- [ ] **Step 15.1.4: Confirm DB schema in psql**

```bash
psql postgresql://modeldoctor:modeldoctor@localhost:5432/modeldoctor \
  -c "SELECT id, scenario, tool, tool_version, status FROM benchmarks ORDER BY created_at DESC LIMIT 5;"
```

Expected: rows show typed `scenario`/`tool` and a non-null `tool_version` after the runner reports back.

### Task 15.2: Run all test suites top to bottom

- [ ] **Step 15.2.1: pnpm -r test**

```bash
pnpm -r test
```

Expected: all packages green.

- [ ] **Step 15.2.2: pnpm -r build**

```bash
pnpm -r build
```

Expected: build clean.

- [ ] **Step 15.2.3: pnpm -r lint**

```bash
pnpm -r lint
```

Expected: clean.

### Task 15.3: Push branch and open PR

- [ ] **Step 15.3.1: Push**

```bash
git push -u origin feat/benchmark-restructure-pr1
```

- [ ] **Step 15.3.2: Create the PR**

```bash
gh pr create --title "feat: benchmark module restructure (PR1: data layer + rename + scenarios)" --body "$(cat <<'EOF'
## Summary

Phase 1 of the benchmark restructure spec
(`docs/superpowers/specs/2026-05-04-benchmark-restructure-design.md`).

- Rename Run → Benchmark across DB, contracts, backend, frontend
- Drop kind/mode discriminators
- Add scenario as a first-class field (inference / capacity / gateway)
- Split e2e probes into a dedicated diagnostics module + table
- Three scenario list pages and three scenario report components
- toolVersion captured forensically by the runner

DB is reset (dev only). PR2 follows with benchmark_templates CRUD;
PR3 with the three-tab create flow Modal; PR4 with save-as-template.

## Test plan
- [ ] All tests pass: `pnpm -r test`
- [ ] Type-check clean: `pnpm -r type-check`
- [ ] Lint clean: `pnpm -r lint`
- [ ] Submit guidellm benchmark from `/benchmarks/inference`; detail page renders InferenceReport with tool_version populated
- [ ] Submit vegeta benchmark from `/benchmarks/gateway`; GatewayReport renders
- [ ] `/benchmarks/capacity` form forces rateType=sweep
- [ ] `/diagnostics` runs probes; row inserted into `diagnostics_runs`
- [ ] `/runs` returns 404
- [ ] Existing baselines feature still works against new benchmark IDs

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 15.3.3: Verify CI signals**

```bash
gh pr view --json comments,reviews,statusCheckRollup,mergeStateStatus
gh pr checks
```

If pending: `gh run watch <run-id> --exit-status`.

If any check fails, fix locally + push to the same branch; re-run `gh pr checks` until clean.

---

## Self-review checklist

- [x] Spec coverage: every section of the spec maps to a Phase here.
  - Goal §1–5 → Phases 1–14 (data, scenarios, e2e split, templates skeleton, three-tab create deferred to PR3)
  - Non-goals: respected (no DB-driven tools, no DynamicForm, no MinIO, no Layer 2 in DB, no version UI, no team/personal scope, no GenAI-Perf rework, no usage stats)
  - Architecture (scenarios as first-class) → Phase 2 + 5 + 11
  - Database schema → Phase 1
  - Code architecture (packages/contracts/tool-adapters/modules/features) → Phases 2–14
  - UX flows: list pages → 10; reports → 11; compare → 12; create (basic) → 13; menu → 14
  - Decisions table: implemented per spec, no deviations.
- [x] Placeholders: searched for "TBD"/"TODO" — only ones intentionally tied to follow-up PRs (e.g. sweep curve placeholder banner) are documented and inline.
- [x] Type consistency: `Benchmark`, `BenchmarkRepository`, `BenchmarkService`, `BenchmarkController`, `BENCHMARK_DRIVER` token, `BENCHMARK_*` error codes used uniformly.

## Open questions

None at plan time. Implementation surprises will surface during execution; per project policy, report deviations in the turn they're discovered.

## Tracking

- Spec: `docs/superpowers/specs/2026-05-04-benchmark-restructure-design.md`
- Issue: TBD — file the umbrella tracking issue plus 15 sub-issues (one per Phase 1–15) before kicking off subagent-driven execution.
