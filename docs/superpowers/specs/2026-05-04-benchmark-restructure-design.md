# Benchmark restructure: scenario-driven UX, e2e split, templates, run→benchmark rename

**Status:** approved spec, awaiting implementation plan
**Date:** 2026-05-04
**Scope:** P0 of the benchmark module restructure
**DB strategy:** full reset (dev DB only; no production data to preserve)

## Goal

Restructure the current "Run" module so that:

1. **Scenario becomes a first-class organizing principle.** Users see menu entries by *what they are testing* (推理性能基准 / 容量规划 / 网关压测), not by which tool they happen to be using.
2. **Naming debt is paid off.** Drop the legacy "Run" naming (`runs` table, `run.ts` contracts, `RunController`, `/api/runs/*`, `/runs/*` web routes) and rename to "Benchmark" everywhere; the `kind: 'benchmark' | 'e2e'` discriminator is retired.
3. **e2e is fully decoupled.** The diagnostics (e2e probe) module gets its own table, repository, and contracts, removing the incidental coupling where it writes into the same `runs` table as benchmark runs.
4. **Templates land as a first-class concept.** Single `benchmark_templates` table with an `isOfficial` flag; users save successful runs as templates and bootstrap new runs from them.
5. **Three-tab create flow.** From a scenario page, "新建" opens a Modal/Drawer with three start points: from template / from history / from blank.

The DB is reset; no migration of existing run rows.

## Non-goals

- **Model evaluation / accuracy.** Out of scope. If ever built, an entirely separate top-level menu and data model — never reuse benchmark tables with a `kind=eval` discriminator.
- **DB-driven tool registry / YAML schemas.** The existing `packages/tool-adapters/` strongly-typed `ToolAdapter` interface (frozen at issue-53 Phase 4) stays as the single source of truth. No `benchmark_tools` table.
- **DynamicForm.** Per-tool tsx forms (`GuidellmParamsForm`, `VegetaParamsForm`, `GenaiPerfParamsForm`) are richer than what schema-driven generic rendering would give.
- **MinIO sidecar pattern.** Keep the existing HMAC callback pipeline (runner pod posts stdout/stderr/files back to BFF); no `mc cp` from the runner.
- **Layer 2 metrics materialized in DB.** The current read-time normalization in `apps/web/src/features/runs/compare/metrics.ts` is sufficient; cross-tool compare is intentionally blocked, so a DB-level `StandardMetrics` shape would have no consumer.
- **User-selectable tool versions.** `toolVersion` is captured forensically (runner reports it via callback) and surfaced read-only in the detail page; users do not pick versions, no `(tool, version)` registry.
- **Template scope (team / personal / official).** Single flat table with an `isOfficial` boolean; everyone can read all templates, only owner/admin can write. Multi-tenant template sharing is deferred to P1+.
- **Real GenAI-Perf integration.** Today's GenAI-Perf adapter is an MVP placeholder kept visible in the inference scenario; this restructure preserves its current state without trying to fix it. Real implementation lives in a follow-up PR.
- **Template usage statistics** (`usageCount` / `lastUsedAt`). Deferred to P1 — has no impact on the user's primary flow.

## Background — what's wrong with the current shape

| Pain | Where it bites |
|---|---|
| `runs` table mixes benchmark + e2e via `kind` discriminator | `apps/api/src/modules/e2e-test/e2e-test.service.ts` L63 writes `kind: "e2e"` into the same table as benchmarks; e2e is in-process synchronous and has zero overlap with benchmark's K8s/runner/HMAC pipeline. They share a table only by historical accident. |
| Naming says "Run" everywhere; product menu says "基准测试" | `runs` table, `Run` model, `RunController`, `/api/runs/*`, `/runs/*` URL prefix — every layer has the legacy name. UI no longer matches. |
| Tool selection happens at create time on a single flat page | `apps/web/src/features/runs/RunCreatePage.tsx` makes the user pick `tool` from a dropdown; no scenario/intent grouping; scenario is implicit ("did you pick guidellm? must be inference"). |
| No template concept | `Run.templateId` column is reserved but unused; users have no way to save and re-launch a known-good config. |
| `mode`, `scenario`, `kind`, `'custom'` tool: dead/unused fields | `Run.mode` is always `'fixed'`; `Run.scenario: Json` is a free-form bag never read after write; `tool: 'custom'` is in the enum but no adapter implements it. |
| GuideLLM straddles two distinct user intents | One tool, two completely different report shapes (sweep curves vs. single-load distributions). Today's `GuidellmReportView` tries to be both at once. |

## Architecture

### Scenarios as first-class

Each "scenario" represents a distinct user intent with its own form constraints and report UX. Scenarios live as a code constant in `packages/tool-adapters/`, not in the database:

```typescript
// packages/tool-adapters/src/scenarios.ts (new)
export type ScenarioId = 'inference' | 'capacity' | 'gateway'

export interface ScenarioConfig {
  label: string                                       // shown in menu + headers
  description: string
  tools: readonly ToolName[]                          // adapters available in this scenario
  paramsConstraints: Partial<Record<ToolName, ScenarioParamsConstraint>>
  reportComponent: 'InferenceReport' | 'CapacityReport' | 'GatewayReport'
}

export const SCENARIOS: Record<ScenarioId, ScenarioConfig> = {
  inference: {
    label: '推理性能基准',
    description: 'TTFT / TPOT / 单次吞吐基线',
    tools: ['guidellm', 'genai-perf'],
    paramsConstraints: {
      guidellm: { rateType: ['constant', 'poisson', 'throughput', 'synchronous'] },
    },
    reportComponent: 'InferenceReport',
  },
  capacity: {
    label: '容量规划',
    description: 'SLO 驱动的负载阶梯扫描',
    tools: ['guidellm'],
    paramsConstraints: {
      guidellm: { rateType: ['sweep'], slo: { required: true } },
    },
    reportComponent: 'CapacityReport',
  },
  gateway: {
    label: '网关压测',
    description: 'Higress / API 链路 HTTP 性能',
    tools: ['vegeta'],
    paramsConstraints: {},
    reportComponent: 'GatewayReport',
  },
}
```

Each `ToolAdapter` declares which scenarios it serves:

```typescript
// packages/tool-adapters/src/core/interface.ts (extended)
export interface ToolAdapter {
  readonly name: ToolName
  readonly scenarios: readonly ScenarioId[]   // NEW
  readonly paramsSchema: z.ZodTypeAny
  ...
}

// packages/tool-adapters/src/guidellm/index.ts
export const guidellmAdapter: ToolAdapter = {
  name: 'guidellm',
  scenarios: ['inference', 'capacity'],       // one tool, two scenarios
  ...
}
```

A build-time invariant in `tool-adapters` verifies `SCENARIOS[s].tools ⊆ adapters.filter(a => a.scenarios.includes(s))` and the reverse.

### DB stores `scenario` per benchmark row

`benchmarks.scenario` captures the user's intent at create time — *not* derived from `(tool, params)`. A guidellm sweep launched from the inference scenario page records `scenario='inference'`, even though sweep is more typical of capacity, because that's where the user came from. Detail page report routing keys off this field.

### e2e fully separated

Today's `e2e-test.service.ts` runs probes synchronously inside the BFF Node process via `PROBES[name](ctx)` and persists each run by writing into the `runs` table through `RunRepository`. Total module is ~300 LOC. It uses none of the K8s/driver/runner/HMAC infrastructure that benchmarks need.

After restructure:

- New table `diagnostics_runs` with a tailored schema (probe list, per-probe results, summary; no `tool`/`params`/`driverKind`/`templateId`/`baselineId` fields).
- New module `apps/api/src/modules/diagnostics/` with its own `DiagnosticsRepository`, `DiagnosticsService`, `DiagnosticsController`. No dependency on `BenchmarkRepository`.
- Probes themselves (`apps/api/src/integrations/probes/*`) are unchanged — only the persistence layer moves.
- Web feature renames `apps/web/src/features/e2e-smoke/` → `apps/web/src/features/diagnostics/`.

### Tool versioning is forensic only

Adding `toolVersion: string` to the benchmark row, populated by the runner pod via callback (e.g. runner exec's `<tool> --version` at startup and includes the parsed version in the `state=running` callback body, or in the existing `/finish` callback). UI surfaces this read-only on the detail page so old reports can be interpreted after a tool image upgrade. **No version selection UI, no `(tool, version)` registry, no version-locked templates.**

## Database schema

```sql
-- benchmarks (replaces runs; reset)
CREATE TABLE benchmarks (
  id              VARCHAR PRIMARY KEY,
  user_id         VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  connection_id   VARCHAR REFERENCES connections(id) ON DELETE SET NULL,

  -- user intent
  scenario        VARCHAR(20) NOT NULL,                 -- 'inference' | 'capacity' | 'gateway'
  tool            VARCHAR(20) NOT NULL,                 -- 'guidellm' | 'vegeta' | 'genai-perf'
  tool_version    VARCHAR(50),                          -- forensic; runner-reported
  driver_kind     VARCHAR(20) NOT NULL,                 -- 'local' | 'k8s'

  -- identification
  name            VARCHAR(128),
  description     TEXT,

  -- lifecycle
  status          VARCHAR(20) NOT NULL DEFAULT 'pending',
  status_message  TEXT,
  progress        REAL,
  driver_handle   VARCHAR(255),

  -- snapshots
  params          JSONB NOT NULL,
  raw_output      JSONB,
  summary_metrics JSONB,

  -- cross-references
  template_id     VARCHAR REFERENCES benchmark_templates(id) ON DELETE SET NULL,
  parent_benchmark_id VARCHAR REFERENCES benchmarks(id) ON DELETE SET NULL,
  baseline_id     VARCHAR REFERENCES baselines(id) ON DELETE SET NULL,

  logs            TEXT,
  created_at      TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  started_at      TIMESTAMPTZ(3),
  completed_at    TIMESTAMPTZ(3)
);

CREATE INDEX idx_benchmarks_user_created ON benchmarks(user_id, created_at DESC);
CREATE INDEX idx_benchmarks_scenario_status ON benchmarks(scenario, status);
CREATE INDEX idx_benchmarks_tool ON benchmarks(tool, created_at DESC);
CREATE INDEX idx_benchmarks_connection ON benchmarks(connection_id);
CREATE INDEX idx_benchmarks_template ON benchmarks(template_id) WHERE template_id IS NOT NULL;
CREATE INDEX idx_benchmarks_parent ON benchmarks(parent_benchmark_id);
CREATE INDEX idx_benchmarks_baseline ON benchmarks(baseline_id);
```

```sql
-- benchmark_templates (new)
CREATE TABLE benchmark_templates (
  id            VARCHAR PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  description   TEXT,
  scenario      VARCHAR(20) NOT NULL,
  tool          VARCHAR(20) NOT NULL,
  config        JSONB NOT NULL,                          -- snapshot of form values
  is_official   BOOLEAN NOT NULL DEFAULT false,          -- only admins can set true
  created_by    VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  tags          TEXT[] NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE INDEX idx_templates_scenario ON benchmark_templates(scenario);
CREATE INDEX idx_templates_tool ON benchmark_templates(tool);
CREATE INDEX idx_templates_official ON benchmark_templates(is_official) WHERE is_official = true;
CREATE INDEX idx_templates_owner ON benchmark_templates(created_by);
```

```sql
-- diagnostics_runs (new — e2e moves here)
CREATE TABLE diagnostics_runs (
  id            VARCHAR PRIMARY KEY,
  user_id       VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  connection_id VARCHAR REFERENCES connections(id) ON DELETE SET NULL,

  status        VARCHAR(20) NOT NULL,                    -- 'completed' | 'failed' (synchronous)
  status_message TEXT,
  probes        TEXT[] NOT NULL,                         -- which probes ran
  path_override JSONB NOT NULL DEFAULT '{}',
  results       JSONB NOT NULL,                          -- per-probe details
  summary       JSONB NOT NULL,                          -- {total, passed, failed}

  started_at    TIMESTAMPTZ(3),
  completed_at  TIMESTAMPTZ(3),
  created_at    TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE INDEX idx_diagnostics_user_created ON diagnostics_runs(user_id, created_at DESC);
CREATE INDEX idx_diagnostics_connection ON diagnostics_runs(connection_id);
```

```sql
-- baselines (foreign key rename only; rest unchanged)
ALTER TABLE baselines RENAME COLUMN run_id TO benchmark_id;
-- (in practice, in a reset-DB world the table is just recreated with the new column name)
```

### Fields dropped vs current `runs` table

| Field | Reason |
|---|---|
| `kind` | No more `'e2e'`; benchmarks are uniformly benchmarks |
| `mode` | Always `'fixed'` in current code; never read meaningfully |
| `scenario` (old, JSONB free-form bag) | Replaced by typed `scenario VARCHAR(20)` |
| `tool='custom'`, `tool='e2e'` enum values | No `'custom'` adapter exists; e2e moves to its own table |

### Forensic vs intent

`tool_version` is forensic (after-the-fact, runner-reported), `scenario` is intent (user-declared at create). Two different reasons to store, two different ergonomics — version goes into a small read-only badge on the detail page; scenario drives major UX routing.

## Code architecture

### `packages/contracts`

```
packages/contracts/src/
├── benchmark.ts               (renamed from run.ts; adds scenario)
├── benchmark-template.ts      NEW
├── benchmark-charts.ts        (renamed from run-charts.ts)
├── baseline.ts                (refs benchmarkId)
├── diagnostics.ts             (renamed from e2e-test.ts; persisted shape changes)
└── index.ts
```

`benchmark.ts` mirrors today's `run.ts` minus the dropped fields plus `scenario: ScenarioId`, `toolVersion: string | null`. The `createBenchmarkRequestSchema` makes `scenario` required.

### `packages/tool-adapters`

```
packages/tool-adapters/src/
├── core/interface.ts          (ToolAdapter gains `scenarios: readonly ScenarioId[]`)
├── scenarios.ts               NEW — SCENARIOS constant + ScenarioParamsConstraint type
├── guidellm/                  (scenarios = ['inference', 'capacity'])
├── vegeta/                    (scenarios = ['gateway'])
└── genai-perf/                (scenarios = ['inference'])
```

A new exported helper `applyScenarioConstraints(scenario, tool, params)` merges per-tool scenario constraints into the adapter's base zod schema before validation.

### `apps/api/src/modules`

```
apps/api/src/modules/
├── benchmark/                 (renamed from run/)
│   ├── benchmark.controller.ts
│   ├── benchmark.service.ts        (validates scenario × tool; applies paramsConstraints)
│   ├── benchmark.repository.ts
│   ├── benchmark-charts.service.ts
│   ├── callbacks/                  (HMAC callback handlers)
│   ├── drivers/                    (subprocess + k8s driver, factory, manifest)
│   └── sse/                        (sse-hub stays inside this module)
├── benchmark-template/        NEW
│   ├── benchmark-template.controller.ts
│   ├── benchmark-template.service.ts
│   └── benchmark-template.repository.ts
├── baseline/                  (renames runId→benchmarkId end-to-end)
└── diagnostics/               (renamed from e2e-test/)
    ├── diagnostics.controller.ts
    ├── diagnostics.service.ts      (no longer depends on RunRepository)
    └── diagnostics.repository.ts   NEW
```

API surface:

| Old | New |
|---|---|
| `POST /api/runs` | `POST /api/benchmarks` |
| `GET /api/runs` | `GET /api/benchmarks` (gains `scenario` filter) |
| `GET /api/runs/:id` | `GET /api/benchmarks/:id` |
| `POST /api/runs/:id/cancel` | `POST /api/benchmarks/:id/cancel` |
| `DELETE /api/runs/:id` | `DELETE /api/benchmarks/:id` |
| `GET /api/runs/:id/charts` | `GET /api/benchmarks/:id/charts` |
| `POST /api/internal/runs/:id/{state,log,finish}` | `POST /api/internal/benchmarks/:id/{state,log,finish}` |
| `POST /api/e2e-test` | `POST /api/diagnostics/runs` |
| (none) | `GET/POST /api/benchmark-templates` etc. |

The internal HMAC callback path also moves; the runner image's outbound URL must be updated in the same release. Since the runner image is owned by this repo (`apps/benchmark-runner/`), we ship a new image tag in the same PR.

### `apps/web/src/features`

```
apps/web/src/features/
├── benchmarks/                        (renamed from runs/)
│   ├── BenchmarkInferencePage.tsx     /benchmarks/inference
│   ├── BenchmarkCapacityPage.tsx      /benchmarks/capacity
│   ├── BenchmarkGatewayPage.tsx       /benchmarks/gateway
│   ├── BenchmarkComparePage.tsx       /benchmarks/compare
│   ├── BenchmarkDetailPage.tsx        /benchmarks/:id
│   ├── BenchmarkDetailMetadata.tsx
│   ├── BenchmarkDetailRawOutput.tsx
│   ├── BenchmarkListFilters.tsx       (per-scenario filter chips)
│   ├── api.ts / queries.ts
│   ├── compare/                       (existing compare/* moves here, refs benchmarkId)
│   ├── reports/
│   │   ├── InferenceReport.tsx        NEW — single-load distributions, gluing TTFT/ITL/E2E
│   │   ├── CapacityReport.tsx         NEW — sweep curves, Goodput, knee point
│   │   ├── GatewayReport.tsx          NEW — status code pie, HDR latency, success rate
│   │   ├── BenchmarkChartsSection.tsx (renamed from RunChartsSection)
│   │   └── UnknownReport.tsx          (defensive fallback)
│   └── forms/                         (per-tool tsx forms, unchanged structure)
├── benchmark-templates/               NEW
│   ├── TemplateListPage.tsx           /benchmark-templates
│   ├── TemplateEditPage.tsx           /benchmark-templates/:id
│   └── TemplateCreatePage.tsx         /benchmark-templates/new
└── diagnostics/                       (renamed from e2e-smoke/)
    └── DiagnosticsPage.tsx            /diagnostics
```

The legacy `GuidellmReportView` / `VegetaReportView` / `GenaiPerfReportView` files are deleted; their useful pieces (sub-components) get redistributed into the three scenario reports above.

### Sidebar (`apps/web/src/components/sidebar/sidebar-config.tsx`)

Rewritten:

```typescript
export const sidebarGroups: SidebarGroup[] = [
  { id: 'playground', labelKey: 'groups.playground', items: [/* unchanged */] },
  {
    id: 'benchmarks',
    labelKey: 'groups.benchmarks',                       // 基准测试
    items: [
      { to: '/benchmarks/inference', icon: Gauge,    labelKey: 'items.benchmarkInference' },
      { to: '/benchmarks/capacity',  icon: Activity, labelKey: 'items.benchmarkCapacity' },
      { to: '/benchmarks/gateway',   icon: Network,  labelKey: 'items.benchmarkGateway' },
      { to: '/benchmarks/compare',   icon: GitCompare, labelKey: 'items.benchmarkCompare' },
      { to: '/benchmark-templates',  icon: Layers,  labelKey: 'items.benchmarkTemplates' },
    ],
  },
  {
    id: 'diagnostics',
    labelKey: 'groups.diagnostics',                      // 诊断
    items: [
      { to: '/debug',        icon: Bug,         labelKey: 'items.requestDebug' },
      { to: '/diagnostics',  icon: CheckCircle2, labelKey: 'items.diagnostics' },
    ],
  },
  { id: 'dev', labelKey: 'groups.dev', items: [/* unchanged */] },
]
```

### Router (`apps/web/src/router/index.tsx`)

```typescript
{ index: true, element: <Navigate to="/benchmarks/inference" replace /> },
{ path: 'benchmarks', element: <Navigate to="/benchmarks/inference" replace /> },
{ path: 'benchmarks/inference', element: <BenchmarkInferencePage /> },
{ path: 'benchmarks/capacity',  element: <BenchmarkCapacityPage /> },
{ path: 'benchmarks/gateway',   element: <BenchmarkGatewayPage /> },
{ path: 'benchmarks/compare',   element: <BenchmarkComparePage /> },
{ path: 'benchmarks/:id',       element: <BenchmarkDetailPage /> },
{ path: 'benchmark-templates',     element: <TemplateListPage /> },
{ path: 'benchmark-templates/new', element: <TemplateCreatePage /> },
{ path: 'benchmark-templates/:id', element: <TemplateEditPage /> },
{ path: 'diagnostics',          element: <DiagnosticsPage /> },
// /e2e and /runs routes removed
```

## UX flows

### Create benchmark (three-tab Modal/Drawer)

```
User on /benchmarks/inference, clicks [新建]
  │
  ▼
Modal opens, top of body shows: "新建推理性能基准"
  │
  ├── Tab 1: 从模板
  │     └── List of templates where scenario='inference' (filterable by tool, isOfficial)
  │         Card click → form prefills with template.config + connection picker
  │
  ├── Tab 2: 从历史
  │     └── List of recent benchmarks where scenario='inference' (descending createdAt)
  │         Card click → form prefills with that benchmark's params + connection
  │         → on submit, parentBenchmarkId is set
  │
  └── Tab 3: 从空白
        ├── (when scenario has >1 tool) Tool dropdown: GuideLLM / GenAI-Perf
        ├── Connection picker
        └── Tool-specific params form, with SCENARIOS.inference.paramsConstraints[tool] applied
            (e.g. guidellm in inference scenario does NOT show 'sweep' rate type)
```

The submit body is the unified `POST /api/benchmarks`:

```json
{
  "scenario": "inference",
  "tool": "guidellm",
  "connectionId": "…",
  "name": "…",
  "params": { … },
  "templateId": "…",      // optional
  "parentBenchmarkId": "…"  // optional
}
```

Service-side validation order:

1. Verify `scenario ∈ adapter(tool).scenarios` (HTTP 400 if not).
2. Apply `SCENARIOS[scenario].paramsConstraints[tool]` over the adapter's base zod schema (e.g. force `rateType: z.literal('sweep')` for capacity+guidellm).
3. Run the resulting merged schema against `params`.
4. Insert row, kick driver.

### Detail page: scenario-routed report

```typescript
// BenchmarkDetailPage.tsx
const ReportComponent = {
  inference: InferenceReport,
  capacity: CapacityReport,
  gateway: GatewayReport,
}[benchmark.scenario] ?? UnknownReport

return (
  <>
    <PageHeader title={benchmark.name ?? benchmark.id} subtitle={SCENARIOS[benchmark.scenario].label} />
    <BenchmarkDetailMetadata benchmark={benchmark} />
    <ReportComponent benchmark={benchmark} />
  </>
)
```

The same guidellm raw output renders very differently in `InferenceReport` (single-load distribution histograms) vs `CapacityReport` (sweep curves + Goodput + knee point) — driven solely by `benchmark.scenario`.

### Compare flow

Two entry points, one page:

- **From a scenario list page**: select 2..N benchmarks of the same scenario, click "对比" → `/benchmarks/compare?scenario=inference&ids=a,b,c`
- **From the menu**: navigate to `/benchmarks/compare` with no params → empty state asks the user to pick a scenario first, then shows recent benchmarks from that scenario for selection

Cross-scenario compare is forbidden (e.g. comparing an inference benchmark to a gateway benchmark makes no sense). Cross-tool *within* a scenario remains forbidden as today (e.g. guidellm vs genai-perf both being inference still doesn't compare).

### Save as template

On `BenchmarkDetailPage`, when `status === 'completed'`, a "保存为模板" button opens a small dialog:

- name (required)
- description (optional)
- tags (optional)
- (admin only) `isOfficial` checkbox

On submit, BFF builds `config` from the benchmark's stored `params` snapshot and POSTs to `/api/benchmark-templates`. The new template inherits `scenario` and `tool` from the source benchmark.

Officials are seeded by hand: after PR4 merges, an admin manually creates 4–5 templates through this flow with `isOfficial=true`. No seed script.

## Decisions (with rejected alternatives)

| Decision | Choice | Rejected alternative | Why |
|---|---|---|---|
| Tool registry | Code, in `packages/tool-adapters/` | DB table with JSONB schemas, hot-loaded YAML | Strong typing > runtime configurability; tool churn rate is too low to justify the complexity. ToolAdapter interface already frozen at issue-53 Phase 4. |
| Scenarios in DB? | Yes — typed `scenario VARCHAR(20)` per benchmark row | Derive from `(tool, params)` at query time | Scenario captures user *intent*, not parameter shape. A guidellm sweep launched from inference page must keep its inference identity even though sweep is more typical of capacity. Plus: `WHERE scenario=?` is a one-line list-page filter. |
| Tool versions UI | None — forensic field only | Pickable per benchmark | No mainstream load-test platform exposes this; cross-version metric comparability is bogus; maintenance multiplied per version isn't worth it. |
| e2e shares run-execution layer | No, fully separate | Keep BenchmarkRepository / driver shared with diagnostics | e2e is in-process synchronous; uses zero of the K8s/runner/HMAC pipeline. Sharing was incidental, not architectural. |
| Layer 2 metrics in DB | No — read-time normalization in `metrics.ts` | Materialize `StandardMetrics` JSONB column on each row | Cross-tool compare is intentionally blocked (`isMixed` check on compare page); a normalized layer with no consumer is pure overhead. |
| Templates: scope/permissions | Single flat table + `isOfficial` boolean | `scope: 'official'/'team'/'personal'`, owner_id, team_id | YAGNI — no team_id model exists today. Add when there's actual team-sharing usage data. |
| Menu structure | Scenario-driven (`推理性能基准 / 容量规划 / 网关压测`) | Single `基准测试` entry with scenario as Step-1 form choice | Real industry platforms (LangSmith, W&B Sweeps, MLflow) classify by user intent, not by tool. With GuideLLM legitimately serving two distinct intents (single-load perf vs sweep capacity), a single menu can't disambiguate the report shape the user expects. |
| Model evaluation | Out of scope, out of menu | Add as 4th scenario in benchmark module | Different domain (datasets + ground truth + accuracy metrics), different audience (model team vs infra team). Mixing it would repeat the original "Run.kind" mistake. |
| GenAI-Perf | Keep visible as inference-scenario tool | Hide from UI / remove adapter | Adapter is implemented and tested; just unfinished end-to-end. Hiding loses the visible inventory. Real fix is a follow-up PR, not part of this restructure. |

## Implementation plan (PR split)

The work decomposes into four PRs. PR1 must merge before any other; PR2/3 can run in parallel after PR1; PR4 depends on both.

### PR1: data layer + rename + scenario architecture

**Branch**: `feat/benchmark-restructure-pr1`
**Size**: large but atomic — rename + schema reset + module move are unsplittable.

Work items:

1. **Prisma schema**: drop `Run` model, add `Benchmark`, `BenchmarkTemplate`, `DiagnosticsRun`; rename `Baseline.runId` → `benchmarkId`; create migration.
2. **Contracts package** (`packages/contracts`): rename `run.ts` → `benchmark.ts`; add `scenario` field; add `toolVersion`; drop `kind`/`mode`; rename `e2e-test.ts` → `diagnostics.ts` and reshape.
3. **Tool-adapters package**: add `scenarios.ts` constant module; extend `ToolAdapter` with `scenarios: readonly ScenarioId[]`; declare `scenarios` on each adapter; export `applyScenarioConstraints` helper; build-time invariant test.
4. **Backend `benchmark/` module**: rename `run/` directory; rename classes; controller routes change to `/api/benchmarks/*`; service applies scenario constraints in `create()`; HMAC callback URL/path renames.
5. **Backend `diagnostics/` module**: rename `e2e-test/` directory; new `DiagnosticsRepository` (no longer uses `RunRepository`); routes change to `/api/diagnostics/runs`.
6. **Backend `baseline/` module**: rename `runId` → `benchmarkId` end-to-end (Prisma model, contract, controller, repository).
7. **Runner image** (`apps/benchmark-runner/`): update outbound callback paths to new routes; report `toolVersion` via the existing callback channel (parse `<tool> --version` at boot, include in `state=running` payload).
8. **Frontend rename**: `apps/web/src/features/runs/` → `benchmarks/`; `e2e-smoke/` → `diagnostics/`; sidebar config rewritten; router rewritten with three scenario pages + compare + detail.
9. **Frontend three scenario list pages**: `BenchmarkInferencePage`, `BenchmarkCapacityPage`, `BenchmarkGatewayPage`. Each page shares a `BenchmarkListShell` component that takes a `scenario` prop; new-button emits the create flow.
10. **Frontend three scenario report components**: `InferenceReport` / `CapacityReport` / `GatewayReport`. Capacity and Gateway exist standalone; inference absorbs the salvageable parts of `GuidellmReportView` and `GenaiPerfReportView`.
11. **Frontend compare page**: rename and re-base on `benchmarkId`; add scenario gating (mixed-scenario alert in addition to existing mixed-tool alert).
12. **Tests**: rename + scenario validation tests; old `runs.repository.spec.ts` becomes `benchmarks.repository.spec.ts`; new `scenarios.spec.ts` for invariants; new `diagnostics.repository.spec.ts`.
13. **i18n**: new keys (`groups.benchmarks`, `groups.diagnostics`, `items.benchmarkInference/Capacity/Gateway/Compare/Templates`, `items.diagnostics`); old keys (`items.runs`, `items.e2e`) deleted.

Acceptance:

- All `pnpm -r build / test / lint` pass.
- Manual: log in, click 基准测试 → 推理性能基准, list shows old guidellm/genai-perf benchmarks (after a fresh DB reset, list will be empty; create one through 从空白 tab and verify it ends up in inference list).
- Manual: 容量规划 forces sweep mode in the form (no other rate-type options).
- Manual: 诊断 → 端点检测 still runs probes synchronously; diagnostics_runs row inserted.
- All `/api/runs/*` and `/runs` routes return 404; old links surface as broken (acceptable since DB reset means old link IDs don't resolve anyway).

Risk: this is a single huge PR. Reviewability is the main concern; mitigated by structuring commits within the branch (one per work item above), so reviewers can read it commit-by-commit.

### PR2: benchmark-template backend + UI

**Branch**: `feat/benchmark-restructure-pr2`
**Depends on**: PR1.

Work items:

1. Prisma model `BenchmarkTemplate` is already in PR1 (table created); PR2 builds the module/controller/service/repository.
2. API: `GET /api/benchmark-templates` with `scenario` and `isOfficial` filters; `GET /:id`; `POST`; `PATCH /:id`; `DELETE /:id`. Permission: any authenticated user can read; only `created_by === user.sub` or admin can write; only admin can set `is_official=true`.
3. Frontend pages: `TemplateListPage` (tabs by scenario, filter by isOfficial, search by name/tags), `TemplateCreatePage`, `TemplateEditPage`. Form uses the same `<ScenarioToolSelector>` and `<ScenarioParamsForm>` components introduced in PR1.
4. Tests: controller (auth, isOfficial gating), service (CRUD), repository.

Acceptance:

- Admin user creates a template with `isOfficial=true`, non-admin sees it but cannot edit; non-admin can create personal templates.
- Edit existing template, save, then verify the updated config is what subsequent benchmarks pick up.

### PR3: three-tab create flow

**Branch**: `feat/benchmark-restructure-pr3`
**Depends on**: PR1; nicer with PR2 (template tab is more useful with templates available).

Work items:

1. New shared component `<NewBenchmarkDrawer scenario>` rendered on each scenario list page's [新建] button.
2. Three tabs: `FromTemplateTab` (template card list, prefill form on click), `FromHistoryTab` (recent same-scenario benchmark list, prefill on click), `FromBlankTab` (existing form behavior).
3. The drawer closes and navigates to `/benchmarks/:id` after successful submit.
4. Connection picker shared across tabs.
5. Tests: drawer open/close, prefill behavior, submit.

Acceptance:

- Land on inference list, click 新建, choose 从模板, pick a template → form prefills correctly → submit creates benchmark → ends up in inference list.
- Same with 从历史 (parentBenchmarkId is set on the new row).
- 从空白 tab matches existing flow exactly.

### PR4: save-as-template + manual official seeding

**Branch**: `feat/benchmark-restructure-pr4`
**Depends on**: PR2 + PR3.

Work items:

1. "保存为模板" button on `BenchmarkDetailPage`, visible only when `benchmark.status === 'completed'`.
2. Dialog: name / description / tags (admin sees `isOfficial` checkbox).
3. POST to `/api/benchmark-templates` with `config = benchmark.params`, inheriting `scenario` and `tool`.
4. Manual seed step (post-merge ops task, NOT part of the PR): admin user creates 4–5 official templates via UI:
   - GuideLLM 推理基线短文本 (inference, constant rate, prompt=128 / output=64)
   - GuideLLM 推理基线长文本 (inference, constant rate, prompt=2048 / output=512)
   - GuideLLM 容量规划基础 (capacity, sweep with default SLO)
   - Vegeta Higress 网关基线 (gateway, OpenAI-compatible body, 500 RPS / 60s)
   - Vegeta 高 QPS 稳定性 (gateway, 2000 RPS / 120s)

Acceptance:

- Run a guidellm inference benchmark to completion, click 保存为模板, see it appear in 测试模板 list under the inference tab.

### Deferred (P1 candidates)

- Template `usage_count` + `last_used_at` columns and increment-on-launch logic
- "Trending templates" sort on template list
- Real GenAI-Perf integration (replacing today's MVP placeholder)
- WebSocket progress push to detail page (today is poll-based)
- Template version evolution / migration when adapter schema changes

## Open questions

None at spec time. Rejected alternatives are documented in the Decisions table; deferred work is in P1 candidates.

## Risks

| Risk | Mitigation |
|---|---|
| PR1 review fatigue (sheer size) | Structure commits one-per-work-item; reviewers can read commit-by-commit; reviewer pre-pairs with author for live walkthrough if needed. |
| Runner image deploy lag (BFF and runner image must update together) | Same PR ships both; deploy order: build runner image → push → bump image tag in BFF env → BFF rolls. |
| Loss of dev DB data | Acceptable per project context (no production data). User has confirmed. |
| Adapter scenario invariant violation (a scenario references a tool that doesn't declare it) | Add a `scenarios.spec.ts` build-time check in `tool-adapters` that asserts both directions of the subset relation. |
| Mixed-scenario benchmark in compare URL | Compare page validates and shows a `MixedScenariosAlert` similar to the existing `MixedToolsAlert`, blocking the grid render. |

## Tracking

- Spec: this document, branch `docs/benchmark-restructure-design`
- Implementation plan: TBD via writing-plans skill (see Implementation plan section above)
- Implementation tasks will be filed as GitHub issues, one per PR plus separate issues for the deferred P1 items, after the implementation plan is approved.
