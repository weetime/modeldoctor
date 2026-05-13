# Quality Gate — Pinned Baseline + Saved Compare UX Polish

**Status:** Approved 2026-05-13
**Author:** weetime + Claude
**Related:** Issue #179 (Quality Gate V1 — landed via PR #180)

---

## Goal

Two related improvements to the Quality Gate experience that landed in PR #180:

1. **Pinned baseline runs** — let users "set a run as baseline" for an evaluation set, so subsequent runs auto-compare against it and produce a gate verdict (PASSED / WARNING / FAILED). Industry-standard pattern (Braintrust / Vellum / Chromatic).
2. **Saved Compare UX polish** — reduce the friction of putting two evaluation runs into a saved compare (multi-select batch action, one-click "Add to compare" from a run, smarter stage label defaults).

The two phases are independent in scope but share file-edit territory (RunReportPage, RunsListPage, SavedCompares). Ship them together in one feature branch / one PR with phase-per-commit ordering.

## Non-goals

- Cross-evaluation comparison (baseline must share `evaluation_id`)
- Automatic baseline by lineage (no implicit "previous run" — user explicitly pins)
- Scheduled runs / cron-triggered evaluations (separate follow-up)
- 3-way comparisons (dual A/B + historical baseline at once) — V1 enforces mutual exclusivity

---

## Background — Industry Pattern Research

Industry LLM evaluation platforms have converged on **"Set Baseline" pin model** (pattern C):

| Platform | Mechanism |
|---|---|
| Braintrust | `Experiment.baseExperiment` field + "Set Baseline" UI; can re-pin |
| Vellum | Mark a Test Run as baseline; subsequent runs auto-compare; re-pin allowed |
| Chromatic | Last "accepted" screenshot is baseline; re-approve to update |
| LangSmith / W&B / MLflow | No baseline concept — ad-hoc compare only |

Almost no platform **copies baseline data into the new run's storage**. The diff is either computed at executor time (and the result stored, the source data not) or computed at read time via join.

We adopt:
- Pattern C (Set Baseline pin) for the user experience.
- **Hybrid storage**: executor reads baseline samples at run start, stores baseline's `resultA` into the new run's `resultB` slot together with the new run's own `resultA`. Reasoning: keeps `computeDelta` unchanged, makes each run self-contained for audit (baseline mutations don't retroactively change historical comparisons), reuses the existing UI's resultA / resultB rendering.

---

## Phase 1 — Pinned Baseline

### 1.1 Data Model

```prisma
model Evaluation {
  // ... existing fields
  baselineRunId  String?  @map("baseline_run_id")
  baselineRun    EvaluationRun?  @relation("EvalBaseline",
                                          fields: [baselineRunId],
                                          references: [id],
                                          onDelete: SetNull)
}

model EvaluationRun {
  // ... existing fields
  baselineRunIdAtExecution  String?  @map("baseline_run_id_at_execution")
  // ↑ Audit-only: snapshot of Evaluation.baselineRunId at run start time.
  //   No FK relation — survives baseline deletion so historical runs stay
  //   traceable to "what was the baseline at the time".

  // Reverse relation:
  pinnedAsBaselineFor  Evaluation[]  @relation("EvalBaseline")
}
```

**Constraints:**

- Pin lives at the `Evaluation` row level (1:1 — each evaluation has ≤1 pinned baseline). Re-pin = update the field.
- `Evaluation.baselineRunId` uses `onDelete: SetNull` so deleting a run automatically clears the pin.
- A run can be pinned only if `status = COMPLETED` AND `evaluation_id = this evaluation's id` AND `user_id = current user`. Enforced at service layer, not DB.
- `EvaluationRun.baselineRunIdAtExecution` is set by the executor at start and never modified.

**Migration:**

- Single `prisma migrate dev --create-only` adds the two fields. Both nullable, no backfill needed.

### 1.2 Executor Behavior

```
start(runId):
  run = repo.findFullRun(runId)

  # 1. Snapshot the pin (lock against mid-flight re-pins)
  baselineRunId = run.baselineRunIdAtExecution
  # ↑ already set at create time by RunsService.create

  baselineSamplesById: Map<sampleId, EvaluationRunSample> = {}
  if baselineRunId:
    rows = await repo.loadCompletedSamples(baselineRunId)
    baselineSamplesById = indexBy(rows, "sampleId")

  for sample in run.evaluationSnapshot.samples:
    callA = endpointCaller.call(run.endpointAId, sample.prompt)
    judgedA = judges.apply(sample.judgeConfig, callA.rawAnswer)

    callB, judgedB = null, null
    if baselineRunId:
      baseRow = baselineSamplesById[sample.id]
      if baseRow != null:
        callB = baseRow.resultA.call         # ← baseline's primary call
        judgedB = baseRow.resultA.judge
      # missing in baseline → callB stays null, delta = NA
    elif run.endpointBId:
      callB = endpointCaller.call(run.endpointBId, sample.prompt)
      judgedB = judges.apply(sample.judgeConfig, callB.rawAnswer)

    delta = computeDelta(judgedA, judgedB)  # unchanged

    saveSample({
      resultA: { call: callA, judge: judgedA },           # always today's
      resultB: callB ? { call: callB, judge: judgedB } : null,
      delta,
    })

  computeAggregates + computeGateResult → markCompleted
```

**Edge cases:**

- Pinned baseline deleted before executor reads its samples → `loadCompletedSamples` returns empty → all delta = NA, run still completes, gate verdict skips regression check + warning logged.
- Baseline sample set ⊂ current evaluation snapshot (evaluation set was extended after baseline was pinned) → samples missing in baseline get `delta = NA`, included in pass-rate but excluded from regression count.
- Pinned run is not yet COMPLETED at create time → `RunsService.create` rejects with 400.

### 1.3 API

PATCH the existing `/api/quality-gate/evaluations/:id` (don't add new sub-routes):

```ts
updateEvaluationRequestSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  samples: z.array(evaluationSampleInputSchema).min(1).max(500).optional(),
  baselineRunId: z.string().nullable().optional(),
  // null = unpin / undefined = unchanged / string = pin to this run
});
```

Service-level validation when `baselineRunId` is a string:
- Run exists + owned by user + same evaluation_id + `status = COMPLETED`

Run-create schema gets `baselineRunIdOverride`:

```ts
createRunRequestSchema = z.object({
  evaluationId: z.string(),
  endpointAId: z.string(),
  endpointBId: z.string().optional(),
  baselineRunIdOverride: z.string().nullable().optional(),
  // undefined = use evaluation's pinned baseline (if any)
  // null = explicit skip (single-endpoint, no comparison even if evaluation has pin)
  // string = override baseline for this run only (does not change pin)
  gateConfig: gateConfigSchema,
})
  .refine(
    r => !(r.endpointBId != null && r.baselineRunIdOverride !== null),
    { message: "validation.runDualVsBaselineExclusive", path: ["endpointBId"] },
  );
```

`RunsService.create` resolves `baselineRunIdAtExecution`:
- `undefined` → load `Evaluation.baselineRunId`
- `null` → null (skip)
- `string` → validate + use the override

### 1.4 Run Create UX

New banner appears when the selected evaluation has a pinned baseline:

```
┌─ New Run ────────────────────────────────────────────────┐
│ TARGET                                                   │
│ Evaluation Set *  [▾ test (1)              ]             │
│                                                          │
│ ┌──────────────────────────────────────────────────┐    │
│ │ 📌 与 baseline 对比                              │    │
│ │ 将与 Run #abc12345 (2026-05-10 PASS) 对比        │    │
│ │ [ 更换 baseline ▾ ]    [ 跳过 baseline ]         │    │
│ └──────────────────────────────────────────────────┘    │
│                                                          │
│ Endpoint A *                                             │
│ [▾ gen-studio_Qwen…                                ]    │
│ ↑ Endpoint B (optional) field is HIDDEN when baseline   │
│   mode is active (mutually exclusive)                   │
│                                                          │
│ GATE RULES                                               │
│ [●] Min Pass Rate    0.9                                 │
│ [●] Max Regressions  3   ← can be enabled                │
│ [ ] Min Judge Score                                      │
│                                                          │
│              [Cancel]  [Run Evaluation]                  │
└──────────────────────────────────────────────────────────┘
```

**Banner behavior:**

- Evaluation has pin → banner shows with "更换" and "跳过" buttons; endpointB field hidden.
- "更换 baseline" → open a small Dialog listing last 10 completed runs for this evaluation, descending by createdAt; user picks → state stored in `baselineRunIdOverride: <id>`.
- "跳过 baseline" → set `baselineRunIdOverride: null`; banner is replaced with a thin "已忽略 baseline" hint; endpointB field reappears.
- Evaluation has no pin → no banner; UI behaves exactly as today.
- `Max Regressions` toggle is disabled (with tooltip "钉一个 baseline run 后可启用") when neither baseline nor endpointB is active.

### 1.5 Run Detail UX

**Pin button placement:** `<PageHeader rightSlot>` on `RunReportPage`, only when `run.status === "COMPLETED"`.

**Three button states:**

| Condition | Button(s) |
|---|---|
| Status != COMPLETED | (no button) |
| Status == COMPLETED, NOT this evaluation's current pin | `[ 📌 钉为 baseline ]` (outline variant) |
| Status == COMPLETED, IS this evaluation's current pin | `[ 📌 已钉为 baseline ]` (filled) + `[ 解钉 ]` (ghost destructive) |

**Pin click flow:**

- No existing pin → PATCH `/evaluations/:id` `{ baselineRunId: thisRunId }` → toast success → button updates.
- Existing pin on different run → open `<AlertDialog>` confirming replacement:

```
┌─ 替换 baseline? ─────────────────────────────┐
│ 当前 baseline: Run #def67890 (2026-05-10)    │
│ 将替换为: Run #abc12345 (本 run)              │
│                                              │
│ 之前用旧 baseline 跑过的对比结果保留不变。      │
│                                              │
│             [取消]  [替换 baseline]           │
└──────────────────────────────────────────────┘
```

**Unpin click flow:** AlertDialog confirm → PATCH `{ baselineRunId: null }`.

**RunOverview additions** when `run.baselineRunIdAtExecution != null`:

- Header row: `📌 与 baseline 对比: Run #def67890 (2026-05-10 PASS)` + "查看 baseline →" link.
- Metric labels change: "Pass Rate A / Pass Rate B" → "通过率 (本次) / 通过率 (baseline)" via mode-aware i18n key selection.

**SamplesTable** column header change is parallel: A 通过 / B 通过 → 本次通过 / baseline 通过. Same i18n switch.

### 1.6 Evaluation Detail UX

New "Pinned Baseline" card above the existing Basics / Samples sections:

```
┌─ Evaluation: 客服回答质量 ─────────────────────────────┐
│ 📌 Pinned Baseline                                    │
│ ┌─────────────────────────────────────────────────┐   │
│ │ Run #def67890                                   │   │
│ │ 2026-05-10 14:23 · ✅ PASSED · pass rate 95%    │   │
│ │ [查看 run]  [更改…]  [解钉]                     │   │
│ └─────────────────────────────────────────────────┘   │
│ ...                                                   │
└───────────────────────────────────────────────────────┘
```

- No pin → card not rendered.
- "更改…" → opens the same picker Dialog as Run create's "更换 baseline".
- "解钉" → AlertDialog confirm → PATCH null.

### 1.7 i18n Keys (new)

`quality-gate.json`:

- `evaluations.baseline.cardTitle` ("📌 Pinned Baseline")
- `evaluations.baseline.view` / `change` / `unpin`
- `evaluations.baseline.changePickerTitle` / `noRunsAvailable`
- `evaluations.baseline.unpinConfirmTitle` / `Body`
- `runs.baseline.banner` (used as "将与 Run #{{id}} ({{date}} {{verdict}}) 对比")
- `runs.baseline.changeButton` / `skipButton` / `skippedHint`
- `runs.baseline.modeLabel` (e.g. "单端点 vs baseline run")
- `runs.report.pinButton` / `pinnedBadge` / `unpinButton`
- `runs.report.replaceConfirmTitle` / `Body`
- `runs.report.passRateCurrent` / `passRateBaseline` / `judgeAvgCurrent` / `judgeAvgBaseline`
- `runs.samplesTable.headerPassedCurrent` / `headerPassedBaseline`
- `validation.runDualVsBaselineExclusive` (under common.validation)

---

## Phase 2 — Saved Compare UX Polish

Three changes (in priority order):

### 2.1 RunsListPage — Multi-select + "Compare selected"

- Add a leading checkbox column to the runs table.
- Selecting ≥1 row shows a sticky toolbar above the table:

```
┌─ 选中 2 个 ──────────────────────────────────────┐
│ [📊 对比所选 (2)]                  [取消选择]    │
└──────────────────────────────────────────────────┘
```

- Click "对比所选" → navigate to `/benchmarks/compare/saved/new?evaluationRunIds=id1,id2,...` with the IDs preselected in URL.
- The Saved Compare creation page already accepts `evaluationRunIds` (we extended it in PR #178); it just needs to read the query param and prefill.

### 2.2 Run Detail — "Add to Compare" button

`<PageHeader rightSlot>` gets a second action next to the pin button:

```
[ 📌 钉为 baseline ]    [ 📊 加入对比 ]
```

V1 scope: only "新建对比 (with this run preselected)" — navigates to `/benchmarks/compare/saved/new?evaluationRunIds=<thisId>`. Future V2 can add a dropdown to merge into an existing saved compare.

### 2.3 Smart StageLabel Defaults

Saved Compare creation page when prefilled with N evaluation runs:

- Auto-fill `stageLabels[runId]` with `"最新"`, `"前一次"`, `"再前一次"` (descending by createdAt) — i18n string templates `compare.autoLabel.latest` / `compare.autoLabel.previous` / `compare.autoLabel.older`.
- For ≥4 runs, use date format: `"2026-05-13"` / `"2026-05-12"` / etc.
- Labels remain user-editable.

### 2.4 Out of scope for V1 (deferred follow-ups)

- 5.4 Relative delta display between cards in SavedCompareDetailPage
- 5.5 Reverse-reference "this run is referenced in …" footer on RunReportPage
- Dropdown "加入已有对比" in Add-to-Compare button

---

## Testing Strategy

### Unit tests

**API services:**
- `RunsService.create` baseline resolution: undefined / null / string → correct `baselineRunIdAtExecution` value (3 cases).
- `RunsService.create` rejects when baseline run is wrong evaluation / wrong user / not COMPLETED (3 cases).
- `RunsService.create` rejects when both `endpointBId` and `baselineRunIdOverride: string` provided.
- `EvaluationsService.setBaseline` (via PATCH) validates run COMPLETED + same evaluation + same user.

**Executor:**
- Baseline mode happy path: 3 samples, 1 matches baseline, computes delta correctly.
- Baseline samples partially missing: delta = NA for missing samples, run still completes.
- Baseline run deleted between create + start: loads empty, all delta = NA, gate skips regression check.
- Snapshot-locked baseline: changing `Evaluation.baselineRunId` mid-run doesn't affect current run.

### E2E (`apps/api/test/e2e/quality-gate.e2e-spec.ts`)

- Pin → create new run → run completes with baseline-mode delta + gate verdict.
- Unpin → new run runs single-endpoint, no delta.

### Frontend (Vitest + RTL)

- RunCreatePage shows banner when evaluation has pin; "跳过" hides banner + reveals endpointB.
- RunReportPage pin button mutates evaluation; AlertDialog appears on replace.
- RunsListPage multi-select toolbar appears when ≥1 checked.
- EvaluationDetailPage baseline card appears when pinned, renders run summary.

---

## Implementation Order (one PR, phase-per-commit)

1. **Schema migration** — `Evaluation.baselineRunId` + `EvaluationRun.baselineRunIdAtExecution` (single Prisma migration).
2. **Contracts** — extend `updateEvaluationRequestSchema` + `createRunRequestSchema` + validation key.
3. **Backend — services** — `EvaluationsService` setBaseline / `RunsService.create` resolution / `QualityGateRunExecutor` baseline branch.
4. **Backend — controller/tests** — PATCH route updates + unit + e2e.
5. **Frontend — Run create UX** — banner, picker Dialog, gate toggle interaction.
6. **Frontend — Run detail UX** — pin button + AlertDialog + RunOverview banner + SamplesTable column rename.
7. **Frontend — Evaluation detail UX** — baseline card.
8. **i18n** — all new keys for zh-CN + en-US.
9. **Phase 2 — RunsListPage multi-select + "对比所选" toolbar.**
10. **Phase 2 — Run detail "加入对比" button.**
11. **Phase 2 — Saved Compare create page reads `evaluationRunIds` query param + auto stage labels.**

Each numbered item is a commit (some may split if large). The branch `feat-qg-baseline` lives until all are landed in one PR.

---

## Open Questions (call out before plan)

None — all major decisions confirmed in brainstorm:

- ✅ Pin storage location: `Evaluation.baselineRunId` (1:1 with evaluation)
- ✅ Snapshot at executor start to `EvaluationRun.baselineRunIdAtExecution`
- ✅ Store baseline's resultA into new run's resultB slot (don't read-time join)
- ✅ Mutual exclusivity: baseline mode ↔ dual A/B endpoint mode
- ✅ Pin selection mechanism: Set Baseline pin (industry pattern C), not per-run manual picker
- ✅ API: PATCH `/evaluations/:id` (reuse, no new route)
- ✅ Phase 1 + Phase 2 ship together in one PR with phase-per-commit ordering
