# Quality Gate — Model Evaluation as Deployment Safety Net

Status: draft → review
Owner: weetime
Reference issue: [#179 — integrate evalscope as new 'model-eval' scenario](https://github.com/weetime/modeldoctor/issues/179)
Related PRs: [#173](https://github.com/weetime/modeldoctor/pull/173) Global AI Diagnostics · [#174](https://github.com/weetime/modeldoctor/pull/174) Saved Compares + AI Report

## Goal

Add a quality evaluation track to ModelDoctor whose first-class job is **answering "did this configuration change degrade the model's answers?"** — not academic leaderboard scoring.

Position: a new top-level domain "质量门 / Quality Gate", same level as 基准测试 (Benchmarks). The first user journey is **A vs B comparison**: pick the old endpoint and the new endpoint, pick an evaluation set, run, get pass/warning/fail verdict in 5 minutes with sample-level regression diff. The result enters Saved Compares so performance gains and quality losses sit in one report.

Success criteria:

- From left nav, user can build an evaluation set (handwritten or JSON/CSV upload), trigger a dual-endpoint run, see verdict + regression samples, and save to Saved Compares — under 10 minutes round trip.
- 50-sample dual-endpoint run completes in ≤ 6 minutes on a working endpoint pair.
- Saved Compare detail view shows performance run cards and evaluation run cards in the same comparison column, with one AI narrative covering both.
- `pnpm type-check / lint / test` all green; new modules have unit + integration + at least one e2e.

## Non-goals (V1)

- **Academic benchmarks (MMLU / GSM8K / HumanEval / C-Eval)** — not integrated in V1. Issue #179's `evalscope` adapter explicitly deferred to Phase 3 (low alignment with the "deployment safety net" narrative; leaderboards already public).
- **Playground → evaluation set reverse import.** V1 is one-way (evaluation report → "reproduce in Playground"). Reverse import deferred to Phase 2.
- **Evaluation set sharing / multi-user.** Owner-only, mirrors Benchmark / Saved Compares pattern.
- **Evaluation set version history with diff.** V1 stores a snapshot inside each run for reproducibility, but does not expose a version diff UI.
- **Traffic-sampled evaluation sets** (replay real traffic as eval). Deferred (needs request capture infra).
- **Custom script judges** (Python / JS sandbox). Deferred. V1 ships 4 built-in judge kinds.
- **Similarity judges** (BLEU / ROUGE / embedding). Deferred. Most regression cases are covered by `contains` + `llm-judge`.
- **Scheduled / API-triggered runs** (nightly regression, CI gate). Deferred until needed; requires queue infra.
- **Multi-endpoint horizontal comparison** (A vs B vs C). Deferred to Phase 2 schema extension.
- **SSE / WebSocket live progress.** V1 polls every 2s.
- **Auto-notification on FAILED Gate.** Deferred to Phase 2 (will sit on Notifications module #170-171).
- **External eval tool adapters** (promptfoo / lm-evaluation-harness / OpenAI Evals). V1 ships a self-contained Eval Engine. Adapters considered in Phase 3 if there's a real interop need.

## Architecture decisions

### A1. Top-level domain, not a Benchmark scenario

Quality Gate is a new top-level route `/quality-gate`, same depth as `/benchmarks`. Rationale:

- Quality run and performance run differ in **metric kind** (correctness vs throughput), **report core** (sample table vs time series), **data governance** (eval set lifecycle), **frequency** (per change vs continuous), **consumer** (algorithm/PM vs SRE), **debug surface** (per-sample Playground reproduction vs N/A).
- Reusing the `BenchmarkRun` entity for both would pollute its semantics; downstream code (Saved Compares, AI narrative, Insights) would have to branch on every read.
- "Quality Gate" wins the naming game over "Evaluation" because it directly mirrors the narrative ("variable-change safety net"), avoids overlap with the existing `Baseline` feature, and tracks with the industry term used in SonarQube / GitLab CI quality gates.

Sub-pages:

```
/quality-gate
├─ /evaluations              评测集列表 + 详情 + 新建
├─ /runs                     评测运行列表 + 详情 + 新建
└─ /templates                内置评测集模板（V1 放 1-2 个 seed 示例）
```

### A2. Data model — 3 new tables + 1 SavedCompare extension

```prisma
model Evaluation {
  id           String   @id @default(cuid())
  userId       String   @map("user_id")
  name         String
  description  String?
  version      Int      @default(1)
  samples      Json     // EvaluationSample[]; see contracts for shape
  totalSamples Int      @default(0) @map("total_samples")
  createdAt    DateTime @default(now())  @map("created_at") @db.Timestamptz(3)
  updatedAt    DateTime @updatedAt        @map("updated_at") @db.Timestamptz(3)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  runs EvaluationRun[]

  @@index([userId, createdAt])
  @@map("evaluations")
}

model EvaluationRun {
  id                  String    @id @default(cuid())
  userId              String    @map("user_id")
  evaluationId        String    @map("evaluation_id")
  evaluationVersion   Int       @map("evaluation_version")
  evaluationSnapshot  Json      @map("evaluation_snapshot")  // 全量 samples 快照
  endpointAId         String    @map("endpoint_a_id")
  endpointBId         String?   @map("endpoint_b_id")
  gateConfig          Json      @map("gate_config")  // { passRateMin?, regressionMax?, judgeScoreMin? }
  status              EvaluationRunStatus  @default(PENDING)
  gateResult          EvaluationGateResult?
  aggregateMetrics    Json?     @map("aggregate_metrics")
  processedSamples    Int       @default(0) @map("processed_samples")
  totalSamples        Int       @map("total_samples")
  startedAt           DateTime? @map("started_at") @db.Timestamptz(3)
  finishedAt          DateTime? @map("finished_at") @db.Timestamptz(3)
  errorMessage        String?   @map("error_message")
  createdAt           DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)

  user        User                  @relation(fields: [userId], references: [id], onDelete: Cascade)
  evaluation  Evaluation            @relation(fields: [evaluationId], references: [id], onDelete: Restrict)
  endpointA   Connection            @relation("EvalEndpointA", fields: [endpointAId], references: [id], onDelete: Restrict)
  endpointB   Connection?           @relation("EvalEndpointB", fields: [endpointBId], references: [id], onDelete: Restrict)
  samples     EvaluationRunSample[]

  @@index([userId, createdAt])
  @@index([evaluationId])
  @@index([status])
  @@map("evaluation_runs")
}

model EvaluationRunSample {
  id          String   @id @default(cuid())
  runId       String   @map("run_id")
  sampleId    String   @map("sample_id")
  sampleIdx   Int      @map("sample_idx")
  resultA     Json     @map("result_a")        // { rawAnswer, latencyMs, tokensIn/Out, passed, judgeScore?, judgeReason?, error? }
  resultB     Json?    @map("result_b")
  delta       SampleDelta
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(3)

  run EvaluationRun @relation(fields: [runId], references: [id], onDelete: Cascade)

  @@index([runId])
  @@index([runId, delta])
  @@map("evaluation_run_samples")
}

enum EvaluationRunStatus {
  PENDING
  RUNNING
  COMPLETED
  FAILED
  CANCELLED
}

enum EvaluationGateResult {
  PASSED
  WARNING
  FAILED
}

enum SampleDelta {
  REGRESSION
  IMPROVEMENT
  BOTH_PASS
  BOTH_FAIL
  NA
}

// SavedCompare 扩字段
model SavedCompare {
  // ... existing fields preserved ...
  evaluationRunIds  String[]  @default([]) @map("evaluation_run_ids")
}
```

Rationale:

- **Samples as JSONB inside `Evaluation`**: write-rarely / edit-as-whole, JSONB simplifies CRUD. 50-200 samples ≈ 5-30 KB.
- **Run sample results as a separate table**: high write rate, filtered/paginated/sorted by `delta` on read.
- **Snapshot the evaluation samples into the run row**: guarantees historical run reproducibility even after the evaluation set is edited or deleted (delete uses `onDelete: Restrict` to fail fast if runs reference it).
- **`status` vs `gateResult` are separate fields**: status is the execution state machine; gateResult is the business verdict computed after `status=COMPLETED`.
- **`processedSamples + totalSamples` columns** for UI progress, updated every 5 samples to keep DB writes bounded.
- **Per-sample judge config** (lives inside `samples` JSONB): mixed evaluation sets need this — one sample can be exact-match, another llm-judge.

### A3. Judge architecture — discriminated union with shared interface

```ts
// packages/contracts/src/quality-gate/judge-config.ts
export type JudgeConfig =
  | { kind: 'exact-match'; caseSensitive?: boolean; trim?: boolean }
  | { kind: 'contains'; substrings: string[]; mode: 'all' | 'any'; caseSensitive?: boolean }
  | { kind: 'regex'; pattern: string; flags?: string }
  | { kind: 'llm-judge'; rubric: string; scale: '0-1' | '0-5' | 'pass-fail'; passThreshold?: number; judgeModel?: JudgeModelRef };

// apps/api/src/modules/quality-gate/judges/types.ts
export interface JudgeContext { question: string; expected: string; answer: string }
export interface JudgeResult  { passed: boolean; score?: number; reason?: string; raw?: unknown; error?: string }

export interface Judge<T extends JudgeConfig = JudgeConfig> {
  readonly kind: T['kind'];
  evaluate(config: T, ctx: JudgeContext): Promise<JudgeResult>;
}
```

Registry pattern:

```ts
const judges: Record<JudgeConfig['kind'], Judge> = {
  'exact-match': exactMatchJudge,
  'contains':    containsJudge,
  'regex':       regexJudge,
  'llm-judge':   llmJudgeFactory(aiDiagnosticsService),
};

export async function applyJudge(config: JudgeConfig, ctx: JudgeContext) {
  return judges[config.kind].evaluate(config as never, ctx);
}
```

`llm-judge` is a **thin wrapper over the existing AI Diagnostics service** (PR #173). It does NOT re-implement model client / API key management / encryption:

- Prompt = `rubric + question + expected + answer`, asks for structured JSON `{ score: number, reason: string }`.
- `passThreshold` defaults: `0-1 → 0.5`, `0-5 → 3.0`, `pass-fail → 0.5` (treats `1` as pass).
- `temperature=0` enforced for consistency.
- Separate in-memory `pLimit(2)` rate gate to prevent saturating the judge model when sample concurrency is 4.

Judges live in `apps/api/src/modules/quality-gate/judges/` for V1. If V2 needs client-side judge preview in the evaluation editor, extract to `packages/eval-judges/`.

### A4. Gate computation — three thresholds with a WARNING buffer

```ts
export function computeGateResult(metrics: AggregateMetrics, gateConfig: GateConfig): GateOutcome {
  const failures: string[] = [];
  const warnings: string[] = [];

  // Pass-rate gate: dual mode reads B (new), single mode reads A
  const passRate = metrics.passRateB ?? metrics.passRateA;
  if (gateConfig.passRateMin != null) {
    if (passRate < gateConfig.passRateMin - 0.05) failures.push('passRate');
    else if (passRate < gateConfig.passRateMin) warnings.push('passRate');
  }

  // Regression-count gate: dual mode only
  if (gateConfig.regressionMax != null && metrics.regressionCount != null) {
    if (metrics.regressionCount > gateConfig.regressionMax * 1.5) failures.push('regression');
    else if (metrics.regressionCount > gateConfig.regressionMax) warnings.push('regression');
  }

  // Judge average gate
  if (gateConfig.judgeScoreMin != null && metrics.judgeAvgB != null) {
    if (metrics.judgeAvgB < gateConfig.judgeScoreMin - 0.5) failures.push('judgeScore');
    else if (metrics.judgeAvgB < gateConfig.judgeScoreMin) warnings.push('judgeScore');
  }

  if (failures.length) return { result: 'FAILED', failures, warnings };
  if (warnings.length) return { result: 'WARNING', warnings };
  return { result: 'PASSED' };
}
```

WARNING buffer (`-0.05` / `× 1.5` / `-0.5`) is hard-coded in V1. Reasoning: tiny regressions (e.g. 89.9% vs 90% threshold) should not produce a red status. V2 may make these tunable.

### A5. Execution model — in-process async, no Redis, no K8s Job

Evaluation runs are I/O-bound HTTP calls plus in-memory judging. No heavy native deps, no Python toolchain. Therefore:

- **Not** the `K8s Job` path used by performance benchmarks (e.g. `k8s-benchmark-runner.ts`). That path's value is isolating heavy native runtimes (guidellm, vegeta); evaluation has none.
- **Not** BullMQ + Redis. ModelDoctor currently has no Redis. The 6 problems Redis solves (persistence, cross-process, retry, scheduling, priority, horizontal scaling) are not present in V1 scope.
- **In-process async** with `pLimit(4)` sample concurrency and `pLimit(2)` judge concurrency, fired-and-forget from the API controller and observed via DB row state.

```ts
@Injectable()
export class QualityGateRunExecutor {
  private active = new Map<string, AbortController>();

  async start(runId: string) {
    const ac = new AbortController();
    this.active.set(runId, ac);
    try {
      const run = await this.repo.markRunning(runId);
      const samples = run.evaluationSnapshot.samples;
      const sampleLimit = pLimit(4);
      const judgeLimit  = pLimit(2);
      let processed = 0;

      await Promise.all(samples.map(s => sampleLimit(async () => {
        if (ac.signal.aborted) return;
        const [resA, resB] = await Promise.all([
          this.endpointCaller.call(run.endpointAId, s.prompt, ac.signal),
          run.endpointBId ? this.endpointCaller.call(run.endpointBId, s.prompt, ac.signal) : null,
        ]);
        const judgedA = await judgeLimit(() => applyJudge(s.judgeConfig, { question: s.prompt, expected: s.expected, answer: resA.rawAnswer }));
        const judgedB = resB ? await judgeLimit(() => applyJudge(s.judgeConfig, { question: s.prompt, expected: s.expected, answer: resB.rawAnswer })) : null;
        const delta = computeDelta(judgedA, judgedB);
        await this.repo.saveSample({ runId, sample: s, resA, resB, judgedA, judgedB, delta });
        processed++;
        if (processed % 5 === 0) await this.repo.updateProgress(runId, processed);
      })));

      if (ac.signal.aborted) return this.repo.markCancelled(runId);
      const metrics = await this.repo.computeAggregates(runId);
      const gate = computeGateResult(metrics, run.gateConfig);
      await this.repo.markCompleted(runId, metrics, gate);
    } catch (err) {
      await this.repo.markFailed(runId, err instanceof Error ? err.message : String(err));
    } finally {
      this.active.delete(runId);
    }
  }

  cancel(runId: string) { this.active.get(runId)?.abort(); }

  @OnModuleInit()
  async onModuleInit() {
    await this.repo.sweepRunningOnBoot(); // RUNNING → FAILED w/ "server restarted, retrigger to resume"
  }
}
```

When V1 ships, document the trigger conditions that would force migration to BullMQ or K8s Job:

- API horizontally scaled to ≥ 2 nodes
- 5+ async task categories share queue infra
- User asks for "nightly regression"
- User asks for "restart should resume runs"

### A6. Endpoint caller — OpenAI-compatible, retry once, 30s timeout

- `POST {baseUrl}/v1/chat/completions` with the prompt as a single user turn.
- `model` field comes from the Connection (existing schema).
- API key dispatch follows the existing Connection auth pattern.
- Timeout per sample: 30s (configurable per-evaluation in V2).
- One retry on transient error; second failure → write to `result.error`, `passed=false`.
- No streaming — only `choices[0].message.content` matters.
- Pre-flight: before the executor starts, ping endpoint A (and B if dual) once. If ping fails, mark the run `FAILED` with `errorMessage="endpoint A unreachable: ..."` — do not enter the sample loop. Prevents 50 sample-level errors looking like a quality regression.

### A7. Saved Compares integration — extend `benchmarkIds` constraint, not new table

Existing schema requires `benchmarkIds.length >= 2`. New constraint:

```ts
.refine(s => s.benchmarkIds.length + s.evaluationRunIds.length >= 2)
.refine(s => s.benchmarkIds.length + s.evaluationRunIds.length <= 10)
```

`stageLabels` keys may be either benchmarkId or evaluationRunId; collision impossible because IDs are cuid namespaces. UI renders performance-run and evaluation-run cards in the same comparison column (column = "this is endpoint B / new vLLM"). AI narrative prompt (PR #174) extends to include evaluation-run aggregates and top regression samples; narrative shape unchanged.

### A8. Playground integration — one-way V1 (report → Playground)

Report page row action: `[在 Playground 复现]` → `/playground/chat?from=evaluation&runId=<id>&sampleId=<id>&endpoint=B`.

Playground page reads query params:
- Auto-select endpoint by id
- Pre-fill prompt with the sample question
- Show top banner: "复现自评测 X · #03 样本 · 期望: <expected snippet>"
- User can edit prompt / system / temperature freely

**No reverse import button in V1.** Deferred. Not even a disabled placeholder — that would mislead users.

## API surface

```
GET    /api/quality-gate/evaluations                # list (owner-only)
POST   /api/quality-gate/evaluations                # create
GET    /api/quality-gate/evaluations/:id            # detail
PATCH  /api/quality-gate/evaluations/:id            # update name/desc/samples
DELETE /api/quality-gate/evaluations/:id            # 409 if any non-deleted run references it
POST   /api/quality-gate/evaluations/import         # body: { format: 'json'|'csv', payload: string }

GET    /api/quality-gate/runs                       # ?status=&evaluationId=&page=
POST   /api/quality-gate/runs                       # create + auto-start (fired async)
GET    /api/quality-gate/runs/:id                   # status + aggregateMetrics + gateResult
POST   /api/quality-gate/runs/:id/cancel
DELETE /api/quality-gate/runs/:id
GET    /api/quality-gate/runs/:id/samples           # ?filter=regression|improvement|both-pass|both-fail|all&page=&pageSize=&sortBy=idx|delta|judgeScore
```

All routes are owner-scoped (filter `userId = req.user.id`), mirroring `BenchmarkService`.

## Module / package layout

```
packages/contracts/src/quality-gate/
├─ evaluations.ts        # Evaluation + EvaluationSample
├─ judge-config.ts       # JudgeConfig discriminated union
├─ runs.ts               # EvaluationRun + GateConfig + GateResult + statuses
├─ run-samples.ts        # EvaluationRunSample + list filter/sort schema
└─ index.ts

apps/api/src/modules/quality-gate/
├─ quality-gate.module.ts
├─ controllers/
│  ├─ evaluations.controller.ts
│  └─ runs.controller.ts
├─ services/
│  ├─ evaluations.service.ts
│  ├─ runs.service.ts
│  └─ run-executor.service.ts
├─ judges/
│  ├─ exact-match.ts
│  ├─ contains.ts
│  ├─ regex.ts
│  ├─ llm-judge.ts        # depends on AiDiagnosticsService
│  ├─ registry.ts
│  └─ types.ts
├─ gate/
│  └─ compute-gate-result.ts
├─ endpoint-caller.ts
└─ repositories/
   ├─ evaluations.repository.ts
   └─ runs.repository.ts

apps/web/src/features/quality-gate/
├─ EvaluationsListPage.tsx
├─ EvaluationDetailPage.tsx
├─ EvaluationCreatePage.tsx
├─ RunsListPage.tsx
├─ RunCreatePage.tsx
├─ RunReportPage.tsx
├─ components/
│  ├─ JudgeConfigEditor.tsx
│  ├─ GateConfigForm.tsx
│  ├─ GateStatusBadge.tsx
│  ├─ SamplesTable.tsx
│  └─ SampleDetailDrawer.tsx
├─ api.ts
├─ queries.ts
└─ types.ts
```

## i18n

New namespaces with zh-CN + en-US parallel (per `feedback_list_page_actions_pattern`):

- `apps/web/src/locales/{zh-CN,en-US}/quality-gate.json`

Term map:

| 中文 | 英文 |
|---|---|
| 质量门 | Quality Gate |
| 评测集 | Evaluation Set |
| 评测运行 | Evaluation Run |
| 判分器 | Judge |
| 通过率 | Pass Rate |
| 回归 / 改善 / 都过 / 都挂 | Regression / Improvement / Both Passed / Both Failed |
| 在 Playground 复现 | Reproduce in Playground |

`saved-compares.json` namespace extends with `evaluation` keys for the new column type and AI narrative phrasing.

## Migrations & seed

Two `prisma migrate dev --create-only` steps (per `feedback_prisma_migrations`):

1. **Create `evaluations`, `evaluation_runs`, `evaluation_run_samples` tables + 3 enums.**
2. **Add `evaluation_run_ids` column to `saved_compares`.**

`apps/api/prisma/seed.ts` adds 1-2 built-in evaluation sets (per `feedback_prisma_seed_for_builtins`), e.g. "中文客服 QA 示例 · 10 条" — mixed `exact-match` + `contains` + `llm-judge` to demonstrate all judge kinds.

**Dev DB drift caveat** (per `feedback_dev_db_disposable`): the PR description and any in-progress branch must surface the schema diff upfront. Reset is not pre-authorized; the user runs it manually.

## Testing strategy

- **Unit**: each judge (6+ cases including edge cases) · `computeGateResult` (typical + buffer-band boundaries) · `computeDelta` (5 transition matrix) · endpoint-caller retry/timeout
- **Integration** (`testcontainers/postgresql`): evaluations.repository + runs.repository — write/read snapshot, sample-result filter+sort, cascade delete
- **Service** (mock endpoint + mock judge): run executor — concurrency limit, cancel during run, boot sweep, all-error run handling
- **Controller (e2e)**: create evaluation → trigger run → poll until COMPLETED → fetch samples by `filter=regression` → verify shape
- **Web** (vitest + RTL): JudgeConfigEditor discriminated form switches · SamplesTable filter/pagination · GateStatusBadge color states · RunReportPage status polling

## Risks

| Risk | Mitigation |
|---|---|
| LLM-judge consistency (same Q+A may score 1-2 points differently across runs) | Doc the limitation; default `temperature=0`; V2 add "run judge N times, take median" toggle |
| LLM-judge token cost opaque | Report page surfaces judge call count + estimated tokens; V2 Settings adds monthly budget warning routed through Notifications |
| Evaluation snapshot inflates DB | 100-sample snapshot ≈ 30 KB; 1000 runs ≈ 30 MB acceptable; if hit `>1000` per user, consider snapshot deduplication pool |
| Process restart drops RUNNING runs | Boot sweep marks RUNNING → FAILED w/ message; UI shows a 重跑 button; documented for users |
| Bad judge config (invalid regex / empty contains array) | zod strict validation on save; runtime fallback writes `error` into result, sample marked `passed=false` |
| SavedCompare 校验放宽 breaks existing tests | Audit all SavedCompare list/detail/AI tests; add fixtures for the new mixed shape |
| Endpoint auth failure looks like quality regression | Pre-flight ping before run; fail the run early with clear error |
| Prisma migration drift in dev | Surface up-front per `feedback_dev_db_disposable`; do not auto-reset |

## Engineering breakdown

| Module | Days |
|---|---|
| Prisma schema + 2 migrations + seed | 0.5 |
| Contracts package (zod schemas) | 1 |
| Judges (4 kinds + registry + units) | 1.5 |
| Gate compute + units | 0.5 |
| Endpoint caller + retry + units | 1 |
| Run executor + cancel + boot sweep + integration test | 2 |
| Repositories + integration test (testcontainers) | 1 |
| Controllers + DTOs + e2e | 1.5 |
| Web: Evaluation list / detail / create | 2 |
| Web: Run list / create form / gate config | 1.5 |
| Web: Report page (overview / samples / filter / drawer) | 2 |
| Web: Saved Compares integration (evaluation column + AI prompt extension) | 1 |
| Web: Playground reproduce jump + banner | 0.5 |
| i18n (zh + en parallel) | 0.5 |
| Docs + verification + bug fix | 0.5-1 |
| **Total** | **17 days** (with buffer) |

If schedule pressure requires hitting 13-15 days, the cheapest cuts are: ship only `exact-match + llm-judge` (drop `contains` + `regex`, save ~1 day), skip CSV import (JSON only, save 0.5 day), reduce e2e coverage to one happy path (save 0.5 day). **Not recommended**: `contains` is the most common business-regression judge in practice and CSV is the format non-engineers use.

## Acceptance

- Create evaluation set via 3 inputs (manual / JSON upload / CSV upload), see it in list
- Edit / delete evaluation set; delete blocked when runs reference it
- Trigger single-endpoint and dual-endpoint runs; both produce reports
- All 4 judge kinds have at least one passing e2e sample
- Gate result correctly computed for typical and buffer-band cases (PASSED / WARNING / FAILED)
- Report page: overview, sample table with `regression` default filter, sorting, sample drawer with side-by-side A/B answers
- "Reproduce in Playground" button routes with correct params and Playground pre-fills
- Saved Compare can mix one performance run + one evaluation run; AI narrative covers both
- Cancel a RUNNING run: status flips to CANCELLED, executor actually stops issuing requests
- After API restart, any prior RUNNING is marked FAILED with `server restarted` message
- Seed evaluation set "中文客服 QA 示例" runs end-to-end against a working endpoint
- `pnpm type-check / lint / test` all green

## Phase 2 / 3 outlook (deferred items)

- Phase 2 (3-5 days): Playground reverse import · evaluation version diff UI · multi-endpoint horizontal compare · FAILED-Gate auto-notification
- Phase 3 (open-ended): traffic-sampled evaluation sets · academic benchmark adapter (lm-evaluation-harness preferred over evalscope for international comparability) · custom script judge · similarity judges · scheduled/CI-triggered runs · SSE progress
