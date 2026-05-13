# Quality Gate — Pinned Baseline + Saved Compare Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the pinned-baseline pattern for Quality Gate evaluation runs and add multi-select / one-click affordances to Saved Compare creation.

**Architecture:** Phase 1 adds a 1:1 baseline pin on `Evaluation` (data) with action buttons on Run detail / Eval detail (UX). The executor reads pinned baseline at run start, snapshot-locks the id into a run-audit field, and reuses the existing dual A/B `computeDelta` by storing baseline's `resultA` into the new run's `resultB` slot. Phase 2 adds checkboxes + a sticky toolbar to RunsListPage and a deep-link query-param prefill to the Saved Compare creation page.

**Tech Stack:** Prisma (Postgres), NestJS, react-hook-form + zodResolver, TanStack Query, shadcn/Radix UI, vitest, biome.

**Spec reference:** `docs/superpowers/specs/2026-05-13-qg-baseline-and-compare-polish-design.md`

---

## File Structure

### Backend

- **Modify** `apps/api/prisma/schema.prisma` — add `Evaluation.baselineRunId` + `EvaluationRun.baselineRunIdAtExecution`.
- **Create** `apps/api/prisma/migrations/<timestamp>_qg_baseline_pin/migration.sql` — Prisma-generated.
- **Modify** `apps/api/src/modules/quality-gate/services/evaluations.service.ts` — add `setBaseline()` method.
- **Modify** `apps/api/src/modules/quality-gate/repositories/evaluations.repository.ts` — `update` now passes through `baselineRunId`.
- **Modify** `apps/api/src/modules/quality-gate/repositories/runs.repository.ts` — add `loadCompletedSamplesById(runId)` helper for executor; extend `createPending` input to include `baselineRunIdAtExecution`.
- **Modify** `apps/api/src/modules/quality-gate/services/runs.service.ts` — resolve `baselineRunIdOverride` to `baselineRunIdAtExecution`.
- **Modify** `apps/api/src/modules/quality-gate/services/run-executor.service.ts` — baseline branch in the per-sample loop.
- **Modify** `apps/api/src/modules/quality-gate/controllers/evaluations.controller.ts` — already accepts PATCH; new field flows through.

### Contracts

- **Modify** `packages/contracts/src/quality-gate/evaluations.ts` — extend `updateEvaluationRequestSchema` and `evaluationSchema` with `baselineRunId`.
- **Modify** `packages/contracts/src/quality-gate/runs.ts` — extend `createRunRequestSchema` + `evaluationRunSchema` with new fields + refinement.

### Frontend

- **Create** `apps/web/src/features/quality-gate/components/BaselinePickerDialog.tsx` — Dialog listing recent completed runs of an evaluation.
- **Create** `apps/web/src/features/quality-gate/components/PinBaselineButton.tsx` — pin/unpin button + AlertDialog confirmation.
- **Create** `apps/web/src/features/quality-gate/components/PinnedBaselineCard.tsx` — card on EvaluationDetailPage showing current pin.
- **Modify** `apps/web/src/features/quality-gate/RunCreatePage.tsx` — baseline banner + endpointB hide logic.
- **Modify** `apps/web/src/features/quality-gate/RunReportPage.tsx` — pin button + baseline header info.
- **Modify** `apps/web/src/features/quality-gate/EvaluationDetailPage.tsx` — render PinnedBaselineCard.
- **Modify** `apps/web/src/features/quality-gate/components/RunOverview.tsx` — baseline metadata row + mode-aware metric labels.
- **Modify** `apps/web/src/features/quality-gate/components/SamplesTable.tsx` — mode-aware column headers.
- **Modify** `apps/web/src/features/quality-gate/api.ts` — `patchEvaluation` body type accepts `baselineRunId`.
- **Modify** `apps/web/src/features/quality-gate/queries.ts` — add `useSetBaseline(evaluationId)` mutation hook.
- **Modify** `apps/web/src/features/quality-gate/RunsListPage.tsx` — checkbox column + sticky toolbar.
- **Modify** `apps/web/src/features/benchmarks/compare/SavedCompareCreatePage.tsx` — read `evaluationRunIds` query param + auto stage labels.
- **Modify** `apps/web/src/locales/zh-CN/quality-gate.json` and `apps/web/src/locales/en-US/quality-gate.json` — new keys.
- **Modify** `apps/web/src/locales/zh-CN/common.json` and `apps/web/src/locales/en-US/common.json` — `validation.runDualVsBaselineExclusive`.

### Tests

- **Modify** `apps/api/src/modules/quality-gate/services/__tests__/evaluations.service.spec.ts` — setBaseline tests.
- **Modify** `apps/api/src/modules/quality-gate/services/__tests__/runs.service.spec.ts` — baseline resolution tests.
- **Create** `apps/api/src/modules/quality-gate/services/__tests__/run-executor.baseline.spec.ts` — executor baseline mode happy path + edge cases.
- **Modify** `apps/api/test/e2e/quality-gate.e2e-spec.ts` — pin → new run → completes with delta.
- **Modify** existing web page tests (`RunCreatePage.test.tsx`, `RunReportPage.test.tsx`, `EvaluationDetailPage.test.tsx`, `RunsListPage.test.tsx`) and add `PinBaselineButton.test.tsx` / `PinnedBaselineCard.test.tsx`.

---

## Task 1: Prisma schema + migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_qg_baseline_pin/migration.sql`

- [ ] **Step 1: Edit schema.prisma — add fields**

Open `apps/api/prisma/schema.prisma`. Find the `model Evaluation { ... }` block (search `model Evaluation`). Add `baselineRunId` field + relation, right after `description`:

```prisma
model Evaluation {
  id           String   @id @default(cuid())
  userId       String   @map("user_id")
  name         String
  description  String?  @db.Text
  version      Int      @default(1)
  samples      Json
  totalSamples Int      @default(0) @map("total_samples")
  baselineRunId String? @map("baseline_run_id")
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt    DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  user         User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  runs         EvaluationRun[] @relation("EvalRuns")
  baselineRun  EvaluationRun?  @relation("EvalBaseline", fields: [baselineRunId], references: [id], onDelete: SetNull)

  @@index([userId, createdAt])
  @@map("evaluations")
}
```

Note: the existing `runs` relation may not have a name. If it currently reads `runs EvaluationRun[]`, change it to `runs EvaluationRun[] @relation("EvalRuns")` and add the matching `@relation("EvalRuns")` on the `EvaluationRun.evaluation` field below.

Find `model EvaluationRun { ... }` block. Add the audit field after `errorMessage`:

```prisma
model EvaluationRun {
  // ... all existing fields unchanged
  errorMessage           String?               @map("error_message") @db.Text
  baselineRunIdAtExecution String?             @map("baseline_run_id_at_execution")
  createdAt              DateTime              @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt              DateTime              @updatedAt @map("updated_at") @db.Timestamptz(3)

  user        User                  @relation(fields: [userId], references: [id], onDelete: Cascade)
  evaluation  Evaluation            @relation("EvalRuns", fields: [evaluationId], references: [id], onDelete: Restrict)
  endpointA   Connection            @relation("EvalEndpointA", fields: [endpointAId], references: [id], onDelete: Restrict)
  endpointB   Connection?           @relation("EvalEndpointB", fields: [endpointBId], references: [id], onDelete: Restrict)
  samples     EvaluationRunSample[]
  pinnedAsBaselineFor  Evaluation[] @relation("EvalBaseline")
  // ...
}
```

- [ ] **Step 2: Generate migration**

Run from repo root:

```bash
pnpm -F @modeldoctor/api exec prisma migrate dev --create-only --name qg_baseline_pin
```

Expected: prints `Prisma Migrate created the following migration without applying it ...` and writes a `migration.sql` to a new dated folder under `apps/api/prisma/migrations/`.

- [ ] **Step 3: Verify the migration SQL**

Read the generated `migration.sql`. Should contain:

```sql
-- AlterTable
ALTER TABLE "evaluations" ADD COLUMN "baseline_run_id" TEXT;
-- AlterTable
ALTER TABLE "evaluation_runs" ADD COLUMN "baseline_run_id_at_execution" TEXT;
-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_baseline_run_id_fkey"
  FOREIGN KEY ("baseline_run_id") REFERENCES "evaluation_runs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
```

If the SQL contains anything else (DROP, RENAME), STOP and investigate.

- [ ] **Step 4: Apply migration**

```bash
pnpm -F @modeldoctor/api exec prisma migrate dev
```

Expected output ends with: `Already in sync, no schema change or pending migration was found.` (because we ran `dev` which both applies and regenerates client).

- [ ] **Step 5: Run prisma test reset to also apply on test DB**

```bash
DATABASE_URL=postgresql://modeldoctor:modeldoctor@localhost:5432/modeldoctor_test \
  pnpm -F @modeldoctor/api exec prisma migrate deploy
```

Expected: `All migrations have been successfully applied.`

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "$(cat <<'EOF'
feat(quality-gate): schema for pinned baseline

Add Evaluation.baselineRunId (1:1 nullable FK to EvaluationRun, onDelete
SetNull) and EvaluationRun.baselineRunIdAtExecution (audit-only, no FK).
The pin lives on Evaluation; the snapshot field lets us trace which
baseline a completed run was actually compared against.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Extend contracts schemas

**Files:**
- Modify: `packages/contracts/src/quality-gate/evaluations.ts`
- Modify: `packages/contracts/src/quality-gate/runs.ts`
- Modify: `apps/web/src/locales/zh-CN/common.json`
- Modify: `apps/web/src/locales/en-US/common.json`
- Test: `packages/contracts/src/quality-gate/__tests__/runs.spec.ts`

- [ ] **Step 1: Extend evaluation schemas**

Open `packages/contracts/src/quality-gate/evaluations.ts`. Find `export const evaluationSchema = z.object({...})` (around line 15). Add `baselineRunId: z.string().nullable(),` right before `createdAt`. Then find `updateEvaluationRequestSchema` (around line 35). Add `baselineRunId: z.string().nullable().optional(),` at the end of its `z.object({...})`.

The complete blocks:

```ts
export const evaluationSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable(),
  version: z.number().int().positive(),
  samples: z.array(evaluationSampleSchema),
  totalSamples: z.number().int().nonnegative(),
  baselineRunId: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Evaluation = z.infer<typeof evaluationSchema>;
```

```ts
export const updateEvaluationRequestSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  samples: z.array(evaluationSampleInputSchema).min(1).max(500).optional(),
  baselineRunId: z.string().nullable().optional(),
});
export type UpdateEvaluationRequest = z.infer<typeof updateEvaluationRequestSchema>;
```

- [ ] **Step 2: Extend run schemas**

Open `packages/contracts/src/quality-gate/runs.ts`. Find `evaluationRunSchema = z.object({...})` (around line 30). Add `baselineRunIdAtExecution: z.string().nullable(),` right before `errorMessage`. Then find `createRunRequestSchema` (around line 65). Add `baselineRunIdOverride` and refinement:

```ts
export const createRunRequestSchema = z
  .object({
    evaluationId: z.string(),
    endpointAId: z.string(),
    endpointBId: z.string().optional(),
    baselineRunIdOverride: z.string().nullable().optional(),
    gateConfig: gateConfigSchema,
  })
  .refine((r) => r.endpointBId == null || r.endpointBId !== r.endpointAId, {
    message: "validation.endpointABMustDiffer",
    path: ["endpointBId"],
  })
  .refine(
    (r) => !(r.endpointBId != null && r.baselineRunIdOverride !== null),
    {
      message: "validation.runDualVsBaselineExclusive",
      path: ["baselineRunIdOverride"],
    },
  );
export type CreateRunRequest = z.infer<typeof createRunRequestSchema>;
```

Important: the second refine triggers when both `endpointBId` is set AND `baselineRunIdOverride` is not explicit-null (i.e. either undefined falls back to evaluation's pin, OR a string id is provided). Both compete with endpointB and must be rejected.

Note: the existing first refine had message text `"endpointAId and endpointBId must be different"`. Replace with i18n key `validation.endpointABMustDiffer`. Add that key in step 4 too if not already present.

- [ ] **Step 3: Add contracts test**

Open `packages/contracts/src/quality-gate/__tests__/runs.spec.ts`. Find the `describe("createRunRequestSchema"...)` block, add three new tests at the bottom of the block:

```ts
  it("accepts baselineRunIdOverride alone (no endpointBId)", () => {
    const r = createRunRequestSchema.safeParse({
      evaluationId: "ev",
      endpointAId: "a",
      baselineRunIdOverride: "run-xyz",
      gateConfig: { passRateMin: 0.9 },
    });
    expect(r.success).toBe(true);
  });

  it("accepts undefined baselineRunIdOverride (falls back to evaluation pin)", () => {
    const r = createRunRequestSchema.safeParse({
      evaluationId: "ev",
      endpointAId: "a",
      gateConfig: { passRateMin: 0.9 },
    });
    expect(r.success).toBe(true);
  });

  it("rejects endpointBId + baselineRunIdOverride combination", () => {
    const r = createRunRequestSchema.safeParse({
      evaluationId: "ev",
      endpointAId: "a",
      endpointBId: "b",
      baselineRunIdOverride: "run-xyz",
      gateConfig: { passRateMin: 0.9 },
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].message).toBe("validation.runDualVsBaselineExclusive");
    }
  });

  it("accepts endpointBId + baselineRunIdOverride=null (explicit skip)", () => {
    const r = createRunRequestSchema.safeParse({
      evaluationId: "ev",
      endpointAId: "a",
      endpointBId: "b",
      baselineRunIdOverride: null,
      gateConfig: { passRateMin: 0.9 },
    });
    expect(r.success).toBe(true);
  });
```

- [ ] **Step 4: Add i18n key**

Open `apps/web/src/locales/zh-CN/common.json`. Find the `"validation": {...}` object. Add inside it:

```json
"runDualVsBaselineExclusive": "双端点对比与历史 baseline 对比不能同时启用",
"endpointABMustDiffer": "Endpoint A 和 Endpoint B 不能选择同一个连接"
```

Same in `apps/web/src/locales/en-US/common.json`:

```json
"runDualVsBaselineExclusive": "Cannot enable dual-endpoint and baseline-run comparison at the same time",
"endpointABMustDiffer": "Endpoint A and Endpoint B must be different connections"
```

- [ ] **Step 5: Run contract tests**

```bash
pnpm -F @modeldoctor/contracts test --run
```

Expected: all tests pass, 4 new ones in `runs.spec.ts` pass.

- [ ] **Step 6: Build contracts and run i18n parity check**

```bash
pnpm -F @modeldoctor/contracts build && pnpm -F @modeldoctor/web check:i18n
```

Expected: build succeeds, parity check passes.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/quality-gate apps/web/src/locales
git commit -m "$(cat <<'EOF'
feat(quality-gate): contracts for pinned baseline

- evaluationSchema + updateEvaluationRequestSchema: baselineRunId field
- evaluationRunSchema: baselineRunIdAtExecution audit field
- createRunRequestSchema: baselineRunIdOverride (undefined | null | string)
  + refine that it cannot coexist with endpointBId
- i18n: validation.runDualVsBaselineExclusive + endpointABMustDiffer

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Backend — EvaluationsService.setBaseline

**Files:**
- Modify: `apps/api/src/modules/quality-gate/services/evaluations.service.ts`
- Modify: `apps/api/src/modules/quality-gate/repositories/evaluations.repository.ts`
- Test: `apps/api/src/modules/quality-gate/services/__tests__/evaluations.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Open `apps/api/src/modules/quality-gate/services/__tests__/evaluations.service.spec.ts`. Add a new `describe("setBaseline", ...)` block at the end:

```ts
describe("setBaseline", () => {
  const userId = "u1";
  const evaluationId = "ev1";
  const runId = "run-pinned";

  function build() {
    const repo = {
      findById: vi.fn().mockResolvedValue({
        id: evaluationId,
        userId,
        name: "demo",
        baselineRunId: null,
      }),
      update: vi.fn().mockImplementation(async (_u, id, body) => ({
        id,
        userId,
        name: "demo",
        baselineRunId: body.baselineRunId ?? null,
      })),
    };
    const runsRepo = {
      findById: vi.fn().mockResolvedValue({
        id: runId,
        userId,
        evaluationId,
        status: "COMPLETED",
      }),
    };
    return { repo, runsRepo };
  }

  it("pins a completed run owned by the user", async () => {
    const { repo, runsRepo } = build();
    const svc = new EvaluationsService(repo as never, runsRepo as never);
    const out = await svc.setBaseline(userId, evaluationId, runId);
    expect(out.baselineRunId).toBe(runId);
    expect(repo.update).toHaveBeenCalledWith(userId, evaluationId, { baselineRunId: runId });
  });

  it("unpins when runId is null", async () => {
    const { repo, runsRepo } = build();
    const svc = new EvaluationsService(repo as never, runsRepo as never);
    const out = await svc.setBaseline(userId, evaluationId, null);
    expect(out.baselineRunId).toBeNull();
    expect(repo.update).toHaveBeenCalledWith(userId, evaluationId, { baselineRunId: null });
  });

  it("rejects when run belongs to different evaluation", async () => {
    const { repo, runsRepo } = build();
    runsRepo.findById.mockResolvedValueOnce({
      id: runId,
      userId,
      evaluationId: "different-eval",
      status: "COMPLETED",
    });
    const svc = new EvaluationsService(repo as never, runsRepo as never);
    await expect(svc.setBaseline(userId, evaluationId, runId)).rejects.toThrow(
      /belongs to a different evaluation/,
    );
  });

  it("rejects when run is not COMPLETED", async () => {
    const { repo, runsRepo } = build();
    runsRepo.findById.mockResolvedValueOnce({
      id: runId,
      userId,
      evaluationId,
      status: "RUNNING",
    });
    const svc = new EvaluationsService(repo as never, runsRepo as never);
    await expect(svc.setBaseline(userId, evaluationId, runId)).rejects.toThrow(
      /must be COMPLETED/,
    );
  });

  it("rejects when run not found / not owned", async () => {
    const { repo, runsRepo } = build();
    runsRepo.findById.mockResolvedValueOnce(null);
    const svc = new EvaluationsService(repo as never, runsRepo as never);
    await expect(svc.setBaseline(userId, evaluationId, runId)).rejects.toThrow(
      /run .* not found/,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm -F @modeldoctor/api test evaluations.service.spec --run
```

Expected: 5 new tests fail with `svc.setBaseline is not a function` or similar.

- [ ] **Step 3: Implement setBaseline**

Open `apps/api/src/modules/quality-gate/services/evaluations.service.ts`. Add `RunsRepository` to imports and constructor, then add `setBaseline` method:

```ts
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { customAlphabet } from "nanoid";
import { EvaluationsRepository } from "../repositories/evaluations.repository.js";
import { RunsRepository } from "../repositories/runs.repository.js";
// ... existing imports unchanged

@Injectable()
export class EvaluationsService {
  constructor(
    private readonly repo: EvaluationsRepository,
    private readonly runsRepo: RunsRepository,
  ) {}

  // ... existing methods unchanged

  async setBaseline(userId: string, evaluationId: string, runId: string | null) {
    // Existence + ownership of evaluation (throws if not owned)
    const evaluation = await this.repo.findById(userId, evaluationId);
    if (!evaluation) throw new NotFoundException(`evaluation ${evaluationId} not found`);

    if (runId !== null) {
      const run = await this.runsRepo.findById(userId, runId);
      if (!run) throw new NotFoundException(`run ${runId} not found`);
      if (run.evaluationId !== evaluationId) {
        throw new BadRequestException(
          `run ${runId} belongs to a different evaluation`,
        );
      }
      if (run.status !== "COMPLETED") {
        throw new BadRequestException(`run ${runId} must be COMPLETED to be pinned as baseline`);
      }
    }

    return this.repo.update(userId, evaluationId, { baselineRunId: runId });
  }
}
```

- [ ] **Step 4: Extend repository update to accept baselineRunId**

Open `apps/api/src/modules/quality-gate/repositories/evaluations.repository.ts`. Find the `update` method. It currently spreads `body` into the Prisma data argument. The new `baselineRunId` field is part of `UpdateEvaluationRequest`, so this should flow through, BUT samples handling does a separate `version` bump. Make sure the update method's data assembly includes `baselineRunId` without bumping version:

Find the current `update` method (approximate signature `update(userId, id, body: UpdateEvaluationRequest)`). It should look like:

```ts
async update(
  userId: string,
  id: string,
  body: UpdateEvaluationRequest,
): Promise<Evaluation> {
  const existing = await this.prisma.evaluation.findFirst({
    where: { id, userId },
    select: { version: true },
  });
  if (!existing) throw new NotFoundException(`evaluation ${id} not found`);

  const data: Prisma.EvaluationUpdateInput = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.description !== undefined) data.description = body.description;
  if (body.samples !== undefined) {
    data.samples = body.samples as unknown as Prisma.InputJsonValue;
    data.version = existing.version + 1;
    data.totalSamples = body.samples.length;
  }
  if (body.baselineRunId !== undefined) {
    data.baselineRun = body.baselineRunId === null
      ? { disconnect: true }
      : { connect: { id: body.baselineRunId } };
  }

  const row = await this.prisma.evaluation.update({ where: { id }, data });
  return this.toDto(row);
}
```

Note the use of relational `connect` / `disconnect` rather than `baselineRunId: body.baselineRunId` — Prisma requires the relation syntax when `baselineRunId` is the FK column.

Also update the `toDto` mapper to include the field:

```ts
private toDto(row: PrismaEvaluation): Evaluation {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    description: row.description,
    version: row.version,
    samples: row.samples as unknown as EvaluationSample[],
    totalSamples: row.totalSamples,
    baselineRunId: row.baselineRunId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
```

- [ ] **Step 5: Inject RunsRepository into EvaluationsService (DI wiring)**

Open `apps/api/src/modules/quality-gate/quality-gate.module.ts`. The module already provides both `EvaluationsRepository` and `RunsRepository`. Since `EvaluationsService` now depends on `RunsRepository`, no module changes needed — Nest's standard providers list resolves it. Confirm `EvaluationsService` is in `providers: [...]` and `RunsRepository` precedes nothing — order doesn't matter for standard class providers.

- [ ] **Step 6: Run tests**

```bash
pnpm -F @modeldoctor/api test evaluations.service.spec --run
```

Expected: all setBaseline tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/quality-gate/services/evaluations.service.ts \
        apps/api/src/modules/quality-gate/repositories/evaluations.repository.ts \
        apps/api/src/modules/quality-gate/services/__tests__/evaluations.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(quality-gate): EvaluationsService.setBaseline

Pin (or unpin) a completed run as the baseline of an evaluation.
Validates that the run is owned by the same user, belongs to the
same evaluation, and is COMPLETED. Used by:
- PATCH /api/quality-gate/evaluations/:id { baselineRunId } via the
  existing update method (baselineRunId flows through update body).
- Run-detail "Set as baseline" button via a dedicated route to be
  added when the controller is wired.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Backend — RunsService baseline resolution

**Files:**
- Modify: `apps/api/src/modules/quality-gate/services/runs.service.ts`
- Modify: `apps/api/src/modules/quality-gate/repositories/runs.repository.ts`
- Test: `apps/api/src/modules/quality-gate/services/__tests__/runs.service.spec.ts`

- [ ] **Step 1: Write failing tests in runs.service.spec.ts**

Open the spec file. Find the existing `describe("RunsService", ...)`. Add four new tests:

```ts
  it("create with baselineRunIdOverride=undefined picks up evaluation's pinned baseline", async () => {
    const m = build();
    m.evaluationsRepo.get.mockResolvedValue({
      id: "e1",
      userId: "u1",
      version: 2,
      samples: [{ id: "s", idx: 0, prompt: "Q", expected: "A", judgeConfig: { kind: "exact-match" } }],
      baselineRunId: "pinned-run",
    });
    const svc = new RunsService(m.repo as never, m.evaluationsRepo as never, m.connections as never, m.executor as never);
    await svc.create("u1", {
      evaluationId: "e1",
      endpointAId: "c",
      gateConfig: { passRateMin: 0.9 },
    });
    expect(m.repo.createPending).toHaveBeenCalledWith(
      expect.objectContaining({ baselineRunIdAtExecution: "pinned-run" }),
    );
  });

  it("create with baselineRunIdOverride=null explicitly skips evaluation's pin", async () => {
    const m = build();
    m.evaluationsRepo.get.mockResolvedValue({
      id: "e1",
      userId: "u1",
      version: 2,
      samples: [{ id: "s", idx: 0, prompt: "Q", expected: "A", judgeConfig: { kind: "exact-match" } }],
      baselineRunId: "pinned-run",
    });
    const svc = new RunsService(m.repo as never, m.evaluationsRepo as never, m.connections as never, m.executor as never);
    await svc.create("u1", {
      evaluationId: "e1",
      endpointAId: "c",
      baselineRunIdOverride: null,
      gateConfig: { passRateMin: 0.9 },
    });
    expect(m.repo.createPending).toHaveBeenCalledWith(
      expect.objectContaining({ baselineRunIdAtExecution: null }),
    );
  });

  it("create with baselineRunIdOverride=string validates the run and uses it", async () => {
    const m = build();
    m.repo.findById.mockResolvedValueOnce({
      id: "override-run",
      userId: "u1",
      evaluationId: "e1",
      status: "COMPLETED",
    });
    const svc = new RunsService(m.repo as never, m.evaluationsRepo as never, m.connections as never, m.executor as never);
    await svc.create("u1", {
      evaluationId: "e1",
      endpointAId: "c",
      baselineRunIdOverride: "override-run",
      gateConfig: { passRateMin: 0.9 },
    });
    expect(m.repo.findById).toHaveBeenCalledWith("u1", "override-run");
    expect(m.repo.createPending).toHaveBeenCalledWith(
      expect.objectContaining({ baselineRunIdAtExecution: "override-run" }),
    );
  });

  it("create rejects baselineRunIdOverride pointing to RUNNING run", async () => {
    const m = build();
    m.repo.findById.mockResolvedValueOnce({
      id: "override-run",
      userId: "u1",
      evaluationId: "e1",
      status: "RUNNING",
    });
    const svc = new RunsService(m.repo as never, m.evaluationsRepo as never, m.connections as never, m.executor as never);
    await expect(
      svc.create("u1", {
        evaluationId: "e1",
        endpointAId: "c",
        baselineRunIdOverride: "override-run",
        gateConfig: { passRateMin: 0.9 },
      }),
    ).rejects.toThrow(/must be COMPLETED/);
  });
```

Make sure the `build()` helper's `evaluationsRepo.get` mock returns `baselineRunId: null` by default:

```ts
const evaluationsRepo = {
  get: vi.fn().mockResolvedValue({
    id: "e1",
    userId: "u1",
    version: 2,
    samples: [...],
    baselineRunId: null,
  }),
};
```

And `repo.findById` mock returns `null` by default (so "override not found" path works without explicit override).

- [ ] **Step 2: Run tests — verify failures**

```bash
pnpm -F @modeldoctor/api test runs.service.spec --run
```

Expected: 4 new tests fail (Cannot read undefined fields on createPending args).

- [ ] **Step 3: Implement baseline resolution in RunsService.create**

Open `apps/api/src/modules/quality-gate/services/runs.service.ts`. Modify `create`:

```ts
async create(userId: string, body: CreateRunRequest): Promise<EvaluationRun> {
  const evaluation = await this.evaluations.get(userId, body.evaluationId);
  if (!evaluation) throw new NotFoundException(`evaluation ${body.evaluationId} not found`);
  const connA = await this.connections
    .findOwnedPublic(userId, body.endpointAId)
    .catch(() => null);
  if (!connA) throw new NotFoundException(`endpointA connection ${body.endpointAId} not found`);
  if (body.endpointBId) {
    const connB = await this.connections
      .findOwnedPublic(userId, body.endpointBId)
      .catch(() => null);
    if (!connB) throw new NotFoundException(`endpointB connection ${body.endpointBId} not found`);
  }

  // Resolve baseline:
  // undefined → use evaluation.baselineRunId (pin)
  // null      → explicit skip, no baseline
  // string    → validate + use that run
  let baselineRunIdAtExecution: string | null = null;
  if (body.baselineRunIdOverride === undefined) {
    baselineRunIdAtExecution = evaluation.baselineRunId ?? null;
  } else if (body.baselineRunIdOverride === null) {
    baselineRunIdAtExecution = null;
  } else {
    const override = await this.repo.findById(userId, body.baselineRunIdOverride);
    if (!override) {
      throw new NotFoundException(`baseline run ${body.baselineRunIdOverride} not found`);
    }
    if (override.evaluationId !== evaluation.id) {
      throw new BadRequestException(
        `baseline run ${body.baselineRunIdOverride} belongs to a different evaluation`,
      );
    }
    if (override.status !== "COMPLETED") {
      throw new BadRequestException(
        `baseline run ${body.baselineRunIdOverride} must be COMPLETED`,
      );
    }
    baselineRunIdAtExecution = override.id;
  }

  const pending = await this.repo.createPending({
    userId,
    evaluationId: evaluation.id,
    evaluationVersion: evaluation.version,
    evaluationSnapshot: { samples: evaluation.samples },
    endpointAId: body.endpointAId,
    endpointBId: body.endpointBId ?? null,
    gateConfig: body.gateConfig,
    baselineRunIdAtExecution,
  });

  void this.executor.start(pending.id);
  return pending;
}
```

Add `BadRequestException` to the existing nestjs imports if not present.

- [ ] **Step 4: Extend RunsRepository.createPending input + createPending impl**

Open `apps/api/src/modules/quality-gate/repositories/runs.repository.ts`. Find the `CreatePendingInput` interface and add the field:

```ts
export interface CreatePendingInput {
  userId: string;
  evaluationId: string;
  evaluationVersion: number;
  evaluationSnapshot: { samples: unknown[] };
  endpointAId: string;
  endpointBId?: string | null;
  gateConfig: object;
  baselineRunIdAtExecution?: string | null;
}
```

Find `createPending` method body. Pass the new field through to Prisma:

```ts
async createPending(input: CreatePendingInput): Promise<EvaluationRun> {
  const total = (input.evaluationSnapshot.samples as unknown[]).length;
  const row = await this.prisma.evaluationRun.create({
    data: {
      userId: input.userId,
      evaluationId: input.evaluationId,
      evaluationVersion: input.evaluationVersion,
      evaluationSnapshot: input.evaluationSnapshot as unknown as object,
      endpointAId: input.endpointAId,
      endpointBId: input.endpointBId ?? null,
      gateConfig: input.gateConfig,
      totalSamples: total,
      baselineRunIdAtExecution: input.baselineRunIdAtExecution ?? null,
    },
  });
  return this.toDto(row);
}
```

Update `toDto` to surface the new field on the returned `EvaluationRun`:

```ts
private toDto(row: { /* existing fields */; baselineRunIdAtExecution: string | null }): EvaluationRun {
  return {
    id: row.id,
    // ... all existing fields
    baselineRunIdAtExecution: row.baselineRunIdAtExecution,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
  };
}
```

- [ ] **Step 5: Run tests**

```bash
pnpm -F @modeldoctor/api test runs.service.spec --run
```

Expected: all 4 new + existing pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/quality-gate/services/runs.service.ts \
        apps/api/src/modules/quality-gate/repositories/runs.repository.ts \
        apps/api/src/modules/quality-gate/services/__tests__/runs.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(quality-gate): resolve baseline run at create time

RunsService.create resolves baselineRunIdOverride into a concrete
baselineRunIdAtExecution snapshot persisted on the run:
- undefined → use Evaluation.baselineRunId pin (if any)
- null      → explicit skip
- string    → validate (exists + owned + same evaluation + COMPLETED)

Pass it through to RunsRepository.createPending and into the
EvaluationRun DTO.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Backend — Executor baseline branch

**Files:**
- Modify: `apps/api/src/modules/quality-gate/services/run-executor.service.ts`
- Modify: `apps/api/src/modules/quality-gate/repositories/runs.repository.ts`
- Create: `apps/api/src/modules/quality-gate/services/__tests__/run-executor.baseline.spec.ts`

- [ ] **Step 1: Add `loadCompletedSamplesById` to RunsRepository**

Open `apps/api/src/modules/quality-gate/repositories/runs.repository.ts`. Add a new public method (near `listSamples`):

```ts
/** Load all samples of a completed run, indexed by sampleId. Used by the
 * executor in baseline mode to fetch the reference sample for each id. */
async loadCompletedSamplesById(
  runId: string,
): Promise<Map<string, { resultA: unknown; resultB: unknown }>> {
  const rows = await this.prisma.evaluationRunSample.findMany({
    where: { runId },
    select: { sampleId: true, resultA: true, resultB: true },
  });
  const map = new Map<string, { resultA: unknown; resultB: unknown }>();
  for (const r of rows) {
    map.set(r.sampleId, { resultA: r.resultA, resultB: r.resultB });
  }
  return map;
}
```

- [ ] **Step 2: Extend findFullRun to include baselineRunIdAtExecution**

In the same file, find `findFullRun` (returns FullRun shape). Add the field to the select / shape so the executor can read it:

```ts
async findFullRun(id: string): Promise<{
  // existing fields
  baselineRunIdAtExecution: string | null;
} | null> {
  const row = await this.prisma.evaluationRun.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      endpointAId: true,
      endpointBId: true,
      evaluationSnapshot: true,
      gateConfig: true,
      baselineRunIdAtExecution: true,
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    userId: row.userId,
    endpointAId: row.endpointAId,
    endpointBId: row.endpointBId,
    evaluationSnapshot: row.evaluationSnapshot as never,
    gateConfig: row.gateConfig as never,
    baselineRunIdAtExecution: row.baselineRunIdAtExecution,
  };
}
```

- [ ] **Step 3: Write executor baseline-mode test**

Create new file `apps/api/src/modules/quality-gate/services/__tests__/run-executor.baseline.spec.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { QualityGateRunExecutor } from "../run-executor.service.js";

function judgePass() {
  return { passed: true };
}
function judgeFail() {
  return { passed: false };
}

function buildExecutor(overrides: {
  baselineRunIdAtExecution?: string | null;
  baselineSamples?: Map<string, { resultA: unknown }>;
  endpointAReturns?: Array<{ rawAnswer: string; latencyMs: number }>;
} = {}) {
  const samples = [
    { id: "s0", idx: 0, prompt: "Q1", expected: "A", judgeConfig: { kind: "exact-match" as const } },
    { id: "s1", idx: 1, prompt: "Q2", expected: "B", judgeConfig: { kind: "exact-match" as const } },
  ];
  const repo = {
    findFullRun: vi.fn().mockResolvedValue({
      id: "r1",
      userId: "u1",
      endpointAId: "epA",
      endpointBId: null,
      evaluationSnapshot: { samples },
      gateConfig: { passRateMin: 0.5 },
      baselineRunIdAtExecution: overrides.baselineRunIdAtExecution ?? null,
    }),
    loadCompletedSamplesById: vi
      .fn()
      .mockResolvedValue(overrides.baselineSamples ?? new Map()),
    markRunning: vi.fn(),
    saveSample: vi.fn(),
    updateProgress: vi.fn(),
    sampleRowsForAggregate: vi.fn().mockResolvedValue([]),
    markCompleted: vi.fn(),
    markFailed: vi.fn(),
    markCancelled: vi.fn(),
    sweepRunningOnBoot: vi.fn(),
  };
  const endpointCaller = {
    call: vi.fn(async (_id, _u, prompt) => {
      const idx = prompt === "Q1" ? 0 : 1;
      return (
        overrides.endpointAReturns?.[idx] ?? { rawAnswer: prompt === "Q1" ? "A" : "B", latencyMs: 10 }
      );
    }),
  };
  const judges = {
    apply: vi.fn(async (_cfg, { expected, answer }) =>
      expected === answer ? judgePass() : judgeFail(),
    ),
  };
  return {
    executor: new QualityGateRunExecutor(repo as never, endpointCaller as never, judges as never),
    repo,
    endpointCaller,
    judges,
  };
}

describe("QualityGateRunExecutor baseline mode", () => {
  it("loads baseline samples when baselineRunIdAtExecution is set", async () => {
    const baseline = new Map([
      ["s0", { resultA: { call: { rawAnswer: "A", latencyMs: 5 }, judge: { passed: true } } }],
      ["s1", { resultA: { call: { rawAnswer: "B", latencyMs: 5 }, judge: { passed: true } } }],
    ]);
    const { executor, repo } = buildExecutor({
      baselineRunIdAtExecution: "baseline-r",
      baselineSamples: baseline as never,
    });
    await executor.start("r1");
    expect(repo.loadCompletedSamplesById).toHaveBeenCalledWith("baseline-r");
    // Two saveSample calls, both with resultB populated from baseline
    expect(repo.saveSample).toHaveBeenCalledTimes(2);
    const calls = repo.saveSample.mock.calls.map((c: never[]) => c[0] as { resultB: unknown });
    expect(calls.every((c) => c.resultB !== null)).toBe(true);
  });

  it("does NOT load baseline when baselineRunIdAtExecution is null", async () => {
    const { executor, repo } = buildExecutor({ baselineRunIdAtExecution: null });
    await executor.start("r1");
    expect(repo.loadCompletedSamplesById).not.toHaveBeenCalled();
  });

  it("falls back to delta=NA when baseline is missing a sample", async () => {
    const baseline = new Map([
      ["s0", { resultA: { call: { rawAnswer: "A", latencyMs: 5 }, judge: { passed: true } } }],
      // s1 missing
    ]);
    const { executor, repo } = buildExecutor({
      baselineRunIdAtExecution: "baseline-r",
      baselineSamples: baseline as never,
    });
    await executor.start("r1");
    const calls = repo.saveSample.mock.calls.map((c: never[]) => c[0] as { sampleId: string; delta: string; resultB: unknown });
    const s1 = calls.find((c) => c.sampleId === "s1");
    expect(s1).toBeDefined();
    expect(s1?.delta).toBe("NA");
    expect(s1?.resultB).toBeNull();
  });

  it("computes REGRESSION when today fails but baseline passed", async () => {
    const baseline = new Map([
      ["s0", { resultA: { call: { rawAnswer: "A", latencyMs: 5 }, judge: { passed: true } } }],
    ]);
    const { executor, repo, endpointCaller } = buildExecutor({
      baselineRunIdAtExecution: "baseline-r",
      baselineSamples: baseline as never,
      endpointAReturns: [{ rawAnswer: "wrong", latencyMs: 10 }, { rawAnswer: "B", latencyMs: 10 }],
    });
    await executor.start("r1");
    const calls = repo.saveSample.mock.calls.map((c: never[]) => c[0] as { sampleId: string; delta: string });
    expect(calls.find((c) => c.sampleId === "s0")?.delta).toBe("REGRESSION");
  });
});
```

**Argument-swap rule for baseline mode.** The existing `computeDelta(judgedA, judgedB)` (see `gate/sample-aggregation.ts`) treats A as the baseline and B as the candidate: A failed + B passed → IMPROVEMENT; A passed + B failed → REGRESSION. We store today's call into `resultA` (preserves the `endpointAId → resultA` invariant) and the pinned baseline's call into `resultB`. To keep REGRESSION semantic correct, the executor MUST pass arguments to `computeDelta` in baseline order: `computeDelta(judgedFromBaseline, judgedToday)`. Storage stays as-is; only the delta computation swaps.

In the executor's baseline branch:
```ts
const delta = baselineMode
  ? computeDelta(judgedFromBaseline, judgedToday)  // baseline=A, today=B → REGRESSION when today fails
  : computeDelta(judgedA, judgedB);                // existing: A=baseline (endpoint), B=candidate (endpoint)
```

And for storage: keep "resultA = today's call, resultB = baseline's call" (matches the endpointAId → resultA invariant). The delta value is still computed correctly because we passed baseline first.

Update the test's `REGRESSION` assertion accordingly. The test setup has today returning `wrong` for s0 → judge fail, baseline judge passed → computeDelta(baselinePassed, todayFailed) → REGRESSION. Correct.

- [ ] **Step 4: Run test — verify it fails**

```bash
pnpm -F @modeldoctor/api test run-executor.baseline.spec --run
```

Expected: tests fail (executor doesn't yet have baseline branch).

- [ ] **Step 5: Implement baseline branch in executor**

Open `apps/api/src/modules/quality-gate/services/run-executor.service.ts`. Replace the `start` method body's per-sample loop with the baseline-aware version:

```ts
async start(runId: string): Promise<void> {
  const ac = new AbortController();
  this.active.set(runId, ac);
  try {
    const run = await this.repo.findFullRun(runId);
    if (!run) throw new Error(`run ${runId} not found`);
    await this.repo.markRunning(runId);

    const sampleLimit = pLimit(SAMPLE_CONCURRENCY);
    const judgeLimit = pLimit(JUDGE_CONCURRENCY);
    let processed = 0;
    let judgeCalls = 0;

    // Snapshot-locked baseline: load once at start (mid-flight repins won't affect this run)
    const baselineSamplesById = run.baselineRunIdAtExecution
      ? await this.repo.loadCompletedSamplesById(run.baselineRunIdAtExecution)
      : new Map<string, { resultA: unknown }>();
    const baselineMode = run.baselineRunIdAtExecution != null;

    const samples = run.evaluationSnapshot.samples;
    await Promise.all(
      samples.map((s) =>
        sampleLimit(async () => {
          if (ac.signal.aborted) return;

          // 1. Today's call (always endpointAId)
          const callA = await this.endpointCaller.call(
            run.endpointAId,
            run.userId,
            s.prompt,
            ac.signal,
          );
          if (ac.signal.aborted) return;
          const judgedA = await judgeLimit(() =>
            this.judges.apply(s.judgeConfig, {
              question: s.prompt,
              expected: s.expected,
              answer: callA.rawAnswer,
            }),
          );
          if (s.judgeConfig.kind === "llm-judge") judgeCalls++;

          // 2. B side: either baseline lookup or endpointBId call
          let callB: typeof callA | null = null;
          let judgedB: typeof judgedA | null = null;
          if (baselineMode) {
            const baseRow = baselineSamplesById.get(s.id);
            if (baseRow && (baseRow.resultA as { call?: unknown; judge?: unknown })?.call) {
              const baselineResultA = baseRow.resultA as {
                call: typeof callA;
                judge: typeof judgedA;
              };
              callB = baselineResultA.call;
              judgedB = baselineResultA.judge;
            }
            // else: sample missing in baseline → keep B null → delta=NA
          } else if (run.endpointBId) {
            callB = await this.endpointCaller.call(
              run.endpointBId,
              run.userId,
              s.prompt,
              ac.signal,
            );
            if (callB && !ac.signal.aborted) {
              judgedB = await judgeLimit(() =>
                this.judges.apply(s.judgeConfig, {
                  question: s.prompt,
                  expected: s.expected,
                  answer: callB.rawAnswer,
                }),
              );
              if (s.judgeConfig.kind === "llm-judge") judgeCalls++;
            }
          }

          // 3. Delta — semantic always "A=baseline, B=candidate" for computeDelta.
          //    Storage invariant: resultA = today's call (preserves endpointAId → resultA).
          //    Dual mode:     A=baselineEndpoint, B=candidateEndpoint → computeDelta(judgedA, judgedB)
          //    Baseline mode: resultA=today (candidate), resultB=baseline.resultA → computeDelta(judgedB, judgedA)
          //    Null-guard: computeDelta's null check is on its 2nd arg; in baseline mode the
          //    baseline judge sits on judgedB, so if judgedB is null (missing baseline sample)
          //    we must short-circuit to "NA" before calling.
          const delta = baselineMode
            ? judgedB != null
              ? computeDelta(judgedB, judgedA)
              : "NA"
            : computeDelta(judgedA, judgedB);

          await this.repo.saveSample({
            runId,
            sampleId: s.id,
            sampleIdx: s.idx,
            resultA: { call: callA, judge: judgedA },
            resultB: callB != null && judgedB != null ? { call: callB, judge: judgedB } : null,
            delta,
          });
          processed++;
          if (processed % PROGRESS_INTERVAL === 0)
            await this.repo.updateProgress(runId, processed);
        }),
      ),
    );

    if (ac.signal.aborted) {
      await this.repo.markCancelled(runId);
      return;
    }
    const rows = await this.repo.sampleRowsForAggregate(runId);
    const metrics = aggregateMetrics(rows as never, judgeCalls);
    const gate = computeGateResult(metrics, run.gateConfig);
    await this.repo.markCompleted(runId, metrics, gate);
  } catch (e) {
    await this.repo.markFailed(runId, e instanceof Error ? e.message : String(e));
  } finally {
    this.active.delete(runId);
  }
}
```

Note the inline-comment-rich documentation of the swap. The reasoning is critical to preserve for future maintainers.

- [ ] **Step 6: Run all executor tests**

```bash
pnpm -F @modeldoctor/api test run-executor --run
```

Expected: all 4 new baseline tests pass + existing tests continue to pass.

- [ ] **Step 7: Run full api test suite**

```bash
pnpm -F @modeldoctor/api test --run
```

Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/quality-gate/services/run-executor.service.ts \
        apps/api/src/modules/quality-gate/repositories/runs.repository.ts \
        apps/api/src/modules/quality-gate/services/__tests__/run-executor.baseline.spec.ts
git commit -m "$(cat <<'EOF'
feat(quality-gate): executor baseline-mode branch

When baselineRunIdAtExecution is set on the run, the executor:
- Loads baseline's samples once at start (snapshot-locked)
- For each sample: today's call → resultA, baseline.resultA → resultB
- Calls computeDelta(baseline_judge, today_judge) so REGRESSION /
  IMPROVEMENT semantics stay consistent with dual A/B mode
- Samples missing in baseline → resultB=null, delta=NA, run completes

When baselineRunIdAtExecution is null, behavior is unchanged.

Repository: add loadCompletedSamplesById helper + surface
baselineRunIdAtExecution in findFullRun.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Backend — Controller + e2e

**Files:**
- Modify: `apps/api/test/e2e/quality-gate.e2e-spec.ts`

The existing PATCH `/api/quality-gate/evaluations/:id` already accepts the request body shaped by `updateEvaluationRequestSchema`, which now includes `baselineRunId`. No controller changes needed.

- [ ] **Step 1: Add e2e test for pin → new run flow**

Open `apps/api/test/e2e/quality-gate.e2e-spec.ts`. Add a new `describe("baseline pin flow", ...)` block. The existing helpers (`createConnection`, registering user etc) are already in the file. Add at the end:

```ts
describe("baseline pin flow", () => {
  it("pin → new run completes with baseline delta + gate verdict", async () => {
    // 1. Create an evaluation with a small sample set
    const ev = await request(ctx.app.getHttpServer())
      .post("/api/quality-gate/evaluations")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "pin-flow-test",
        samples: [
          { prompt: "Q1", expected: "A", judgeConfig: { kind: "exact-match" } },
          { prompt: "Q2", expected: "B", judgeConfig: { kind: "exact-match" } },
        ],
      })
      .expect(201);
    const evaluationId = ev.body.id;

    // 2. Create a baseline run (single-endpoint, no comparison)
    const conn = await createConnection("conn-baseline");
    const baselineRun = await request(ctx.app.getHttpServer())
      .post("/api/quality-gate/runs")
      .set("Authorization", `Bearer ${token}`)
      .send({
        evaluationId,
        endpointAId: conn.id,
        gateConfig: { passRateMin: 0.5 },
      })
      .expect(201);

    // Wait for the executor to complete (poll up to 30s)
    await waitForRunStatus(ctx, token, baselineRun.body.id, "COMPLETED", 30_000);

    // 3. Pin this run as baseline
    await request(ctx.app.getHttpServer())
      .patch(`/api/quality-gate/evaluations/${evaluationId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ baselineRunId: baselineRun.body.id })
      .expect(200);

    // Verify pin shows up in GET
    const evAfter = await request(ctx.app.getHttpServer())
      .get(`/api/quality-gate/evaluations/${evaluationId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(evAfter.body.baselineRunId).toBe(baselineRun.body.id);

    // 4. Create a new run; should auto-use the pin
    const newRun = await request(ctx.app.getHttpServer())
      .post("/api/quality-gate/runs")
      .set("Authorization", `Bearer ${token}`)
      .send({
        evaluationId,
        endpointAId: conn.id,
        gateConfig: { passRateMin: 0.5, regressionMax: 0 },
      })
      .expect(201);
    expect(newRun.body.baselineRunIdAtExecution).toBe(baselineRun.body.id);

    await waitForRunStatus(ctx, token, newRun.body.id, "COMPLETED", 30_000);

    // Sanity: aggregate metrics + gate result populated
    const finalRun = await request(ctx.app.getHttpServer())
      .get(`/api/quality-gate/runs/${newRun.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(finalRun.body.status).toBe("COMPLETED");
    expect(finalRun.body.gateResult).toBeDefined();
    expect(finalRun.body.aggregateMetrics?.regressionCount).toBeDefined();
  }, 120_000);

  it("explicit baselineRunIdOverride=null skips the pin", async () => {
    // ... similar setup with pin, then POST run with baselineRunIdOverride: null
    // → expect newRun.body.baselineRunIdAtExecution to be null
    const ev2 = await request(ctx.app.getHttpServer())
      .post("/api/quality-gate/evaluations")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "pin-flow-test-2",
        samples: [{ prompt: "Q", expected: "A", judgeConfig: { kind: "exact-match" } }],
      })
      .expect(201);
    const conn = await createConnection("conn-skip");
    const baselineRun = await request(ctx.app.getHttpServer())
      .post("/api/quality-gate/runs")
      .set("Authorization", `Bearer ${token}`)
      .send({ evaluationId: ev2.body.id, endpointAId: conn.id, gateConfig: { passRateMin: 0.5 } })
      .expect(201);
    await waitForRunStatus(ctx, token, baselineRun.body.id, "COMPLETED", 30_000);
    await request(ctx.app.getHttpServer())
      .patch(`/api/quality-gate/evaluations/${ev2.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ baselineRunId: baselineRun.body.id })
      .expect(200);

    const newRun = await request(ctx.app.getHttpServer())
      .post("/api/quality-gate/runs")
      .set("Authorization", `Bearer ${token}`)
      .send({
        evaluationId: ev2.body.id,
        endpointAId: conn.id,
        baselineRunIdOverride: null,
        gateConfig: { passRateMin: 0.5 },
      })
      .expect(201);
    expect(newRun.body.baselineRunIdAtExecution).toBeNull();
  }, 120_000);
});
```

The `waitForRunStatus` helper may need to be added — check if it exists. If not, add at top of file (after imports):

```ts
async function waitForRunStatus(
  ctx: E2EContext,
  token: string,
  runId: string,
  expected: string,
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await request(ctx.app.getHttpServer())
      .get(`/api/quality-gate/runs/${runId}`)
      .set("Authorization", `Bearer ${token}`);
    if (r.body.status === expected) return r.body;
    if (["FAILED", "CANCELLED"].includes(r.body.status) && r.body.status !== expected) {
      throw new Error(`run ${runId} finished with ${r.body.status}, expected ${expected}`);
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  throw new Error(`run ${runId} did not reach ${expected} within ${timeoutMs}ms`);
}
```

- [ ] **Step 2: Run e2e**

```bash
pnpm test:e2e:api
```

Expected: existing QG e2e passes + the 2 new baseline-flow tests pass. Total runtime may exceed 4-5 minutes if real endpoint calls happen — in this e2e the `endpointCaller` will likely fail (no real endpoint) but result.error gets stored and run still moves to COMPLETED with the gate verdict reflecting actual outcomes. That's fine for the test.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/e2e/quality-gate.e2e-spec.ts
git commit -m "$(cat <<'EOF'
test(quality-gate): e2e baseline pin flow

Two new tests cover the full pin → new run flow over real HTTP:
- pin a completed run, create a new run, verify
  baselineRunIdAtExecution is set + run completes with delta metrics
- explicit baselineRunIdOverride=null skips the evaluation's pin

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Frontend — Run create UX (banner + picker dialog)

**Files:**
- Create: `apps/web/src/features/quality-gate/components/BaselinePickerDialog.tsx`
- Modify: `apps/web/src/features/quality-gate/RunCreatePage.tsx`
- Modify: `apps/web/src/features/quality-gate/queries.ts`
- Modify: `apps/web/src/features/quality-gate/api.ts`
- Modify: `apps/web/src/locales/zh-CN/quality-gate.json`
- Modify: `apps/web/src/locales/en-US/quality-gate.json`
- Test: `apps/web/src/features/quality-gate/__tests__/RunCreatePage.test.tsx`

- [ ] **Step 1: Add i18n keys**

Open `apps/web/src/locales/zh-CN/quality-gate.json`. Find the `"runs": { "form": {...} }` block. Add new keys at the end of the `form` object:

```json
      "baselineBanner": "📌 与 baseline 对比",
      "baselineBannerBody": "将与 Run #{{runId}} ({{date}} {{verdict}}) 对比",
      "baselineChangeButton": "更换 baseline",
      "baselineSkipButton": "跳过 baseline",
      "baselineSkippedHint": "已忽略本评测集的 baseline，本次单端点运行",
      "baselinePickerTitle": "选择 baseline run",
      "baselinePickerDescription": "选择同一评测集的某次已完成 run 作为本次对比的基线（不会修改钉住的 baseline）。",
      "baselinePickerEmpty": "该评测集还没有已完成的 run",
      "baselinePickerConfirm": "使用此 run",
      "baselinePickerColumnId": "Run ID",
      "baselinePickerColumnCreatedAt": "时间",
      "baselinePickerColumnVerdict": "门禁结果",
      "maxRegressionsDisabledHint": "钉一个 baseline run 后可启用"
```

Same in `apps/web/src/locales/en-US/quality-gate.json`:

```json
      "baselineBanner": "📌 Compare against baseline",
      "baselineBannerBody": "Will compare against Run #{{runId}} ({{date}} {{verdict}})",
      "baselineChangeButton": "Change baseline",
      "baselineSkipButton": "Skip baseline",
      "baselineSkippedHint": "Ignoring this evaluation's baseline for this run",
      "baselinePickerTitle": "Pick a baseline run",
      "baselinePickerDescription": "Choose a completed run of the same evaluation as the comparison reference (does not change the pinned baseline).",
      "baselinePickerEmpty": "No completed runs yet for this evaluation",
      "baselinePickerConfirm": "Use this run",
      "baselinePickerColumnId": "Run ID",
      "baselinePickerColumnCreatedAt": "Created",
      "baselinePickerColumnVerdict": "Gate result",
      "maxRegressionsDisabledHint": "Pin a baseline run to enable"
```

Run i18n parity check:

```bash
pnpm -F @modeldoctor/web check:i18n
```

Expected: passes.

- [ ] **Step 2: Add api.patchEvaluation (or extend existing)**

Open `apps/web/src/features/quality-gate/api.ts`. The existing `updateEvaluation` already takes `UpdateEvaluationRequest` body. No new function needed — the schema now accepts `baselineRunId`. Confirm `qgApi.updateEvaluation` exists and accepts the new field through `body`. If not, add it:

```ts
updateEvaluation: (id: string, body: UpdateEvaluationRequest) =>
  api.patch<Evaluation>(`/api/quality-gate/evaluations/${id}`, body),
```

- [ ] **Step 3: Add `useSetBaseline` mutation hook**

Open `apps/web/src/features/quality-gate/queries.ts`. Add:

```ts
export function useSetBaseline(evaluationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string | null) =>
      qgApi.updateEvaluation(evaluationId, { baselineRunId: runId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY.evaluation(evaluationId) });
      qc.invalidateQueries({ queryKey: KEY.evaluations });
    },
  });
}
```

- [ ] **Step 4: Create BaselinePickerDialog component**

Create `apps/web/src/features/quality-gate/components/BaselinePickerDialog.tsx`:

```tsx
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useRuns } from "../queries";
import { GateStatusBadge } from "./GateStatusBadge";

interface Props {
  evaluationId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Currently selected (highlighted) run id. */
  initialRunId?: string | null;
  onPick: (runId: string) => void;
}

export function BaselinePickerDialog({
  evaluationId,
  open,
  onOpenChange,
  initialRunId,
  onPick,
}: Props) {
  const { t } = useTranslation("quality-gate");
  const { data } = useRuns({ evaluationId, pageSize: 10 });
  const completed = (data?.items ?? []).filter((r) => r.status === "COMPLETED");
  const [picked, setPicked] = useState<string | null>(initialRunId ?? null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("runs.form.baselinePickerTitle")}</DialogTitle>
          <DialogDescription>
            {t("runs.form.baselinePickerDescription")}
          </DialogDescription>
        </DialogHeader>
        {completed.length === 0 ? (
          <div className="text-muted-foreground py-8 text-center">
            {t("runs.form.baselinePickerEmpty")}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12"></TableHead>
                <TableHead>{t("runs.form.baselinePickerColumnId")}</TableHead>
                <TableHead>{t("runs.form.baselinePickerColumnCreatedAt")}</TableHead>
                <TableHead>{t("runs.form.baselinePickerColumnVerdict")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {completed.map((r) => (
                <TableRow
                  key={r.id}
                  className={picked === r.id ? "bg-accent/40" : "cursor-pointer"}
                  onClick={() => setPicked(r.id)}
                >
                  <TableCell>
                    <input
                      type="radio"
                      name="baseline-pick"
                      checked={picked === r.id}
                      onChange={() => setPicked(r.id)}
                    />
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.id.slice(0, 12)}</TableCell>
                  <TableCell>{new Date(r.createdAt).toLocaleString()}</TableCell>
                  <TableCell>
                    <GateStatusBadge status={r.status} gateResult={r.gateResult} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("evaluations.form.cancel")}
          </Button>
          <Button
            disabled={!picked}
            onClick={() => {
              if (picked) {
                onPick(picked);
                onOpenChange(false);
              }
            }}
          >
            {t("runs.form.baselinePickerConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Update RunCreatePage to integrate banner + picker**

Open `apps/web/src/features/quality-gate/RunCreatePage.tsx`. Key changes:

1. Watch the `evaluationId` field, fetch the evaluation, derive `pinnedBaselineId`.
2. Track local state `baselineMode` (active when pin or override exists) and `baselineRunIdOverride` (the form field).
3. Banner conditionally rendered.
4. Hide endpointB FormField when baseline mode is active.
5. Disable `Max Regressions` gate toggle when not in any comparison mode.

Replace the body of the component (between the page-shell pieces; keep imports + breadcrumbs etc.):

```tsx
import { useState } from "react";
import { useEvaluation } from "./queries";
import { BaselinePickerDialog } from "./components/BaselinePickerDialog";

// ... existing imports

export function RunCreatePage() {
  // ... existing useNavigate, useTranslation hooks

  const form = useForm<CreateRunRequest>({
    resolver: zodResolver(createRunRequestSchema),
    mode: "onChange",
    defaultValues: {
      evaluationId: "",
      endpointAId: "",
      endpointBId: undefined,
      baselineRunIdOverride: undefined,
      gateConfig: { passRateMin: 0.9 },
    },
  });

  const evaluationId = form.watch("evaluationId");
  const endpointAId = form.watch("endpointAId");
  const endpointBId = form.watch("endpointBId");
  const baselineOverride = form.watch("baselineRunIdOverride");
  const evaluation = useEvaluation(evaluationId || undefined);
  const pinnedBaselineId = evaluation.data?.baselineRunId ?? null;

  // Effective baseline = pin unless explicitly overridden:
  //  override === undefined → use pin
  //  override === null      → skip (no baseline)
  //  override is string     → use that
  const effectiveBaselineId =
    baselineOverride === undefined
      ? pinnedBaselineId
      : baselineOverride === null
        ? null
        : baselineOverride;
  const baselineModeActive = effectiveBaselineId !== null;

  // Auto-clear endpointB if user enters baseline mode (and vice versa)
  useEffect(() => {
    if (baselineModeActive && endpointBId) {
      form.setValue("endpointBId", undefined, { shouldDirty: true, shouldValidate: true });
    }
  }, [baselineModeActive, endpointBId, form]);

  const [pickerOpen, setPickerOpen] = useState(false);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const run = await create.mutateAsync(values);
      nav(`/quality-gate/runs/${run.id}`);
    } catch (err) {
      toast.error(t("runs.form.saveError", { message: (err as Error).message }));
    }
  });

  // ... existing breadcrumbs

  return (
    <>
      <PageHeader title={t("runs.form.newTitle")} subtitle={t("runs.form.newSubtitle")} breadcrumbs={breadcrumbs} />
      <div className="space-y-6 px-8 py-6">
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-6">
            <FormSection title={t("runs.form.sectionTarget")}>
              <FormField
                control={form.control}
                name="evaluationId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t("runs.form.evaluationLabel")}</FormLabel>
                    <FormControl>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger>
                          <SelectValue placeholder={t("runs.form.evaluationPlaceholder")} />
                        </SelectTrigger>
                        <SelectContent>
                          {evaluations.data?.map((e) => (
                            <SelectItem key={e.id} value={e.id}>
                              {e.name} ({e.totalSamples})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Baseline banner */}
              {evaluationId && pinnedBaselineId && baselineOverride !== null && (
                <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm space-y-2">
                  <div className="font-medium">{t("runs.form.baselineBanner")}</div>
                  <div className="text-muted-foreground">
                    {t("runs.form.baselineBannerBody", {
                      runId: effectiveBaselineId?.slice(0, 12),
                      date: "",
                      verdict: "",
                    })}
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => setPickerOpen(true)}>
                      {t("runs.form.baselineChangeButton")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => form.setValue("baselineRunIdOverride", null, { shouldDirty: true })}
                    >
                      {t("runs.form.baselineSkipButton")}
                    </Button>
                  </div>
                </div>
              )}
              {baselineOverride === null && pinnedBaselineId && (
                <div className="text-xs text-muted-foreground">
                  {t("runs.form.baselineSkippedHint")}
                </div>
              )}

              <FormField
                control={form.control}
                name="endpointAId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t("runs.form.endpointA")}</FormLabel>
                    <FormControl>
                      <ConnectionPicker
                        selectedConnectionId={field.value || null}
                        onSelect={(id) => field.onChange(id ?? "")}
                        allowManual={false}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Endpoint B hidden in baseline mode */}
              {!baselineModeActive && (
                <FormField
                  control={form.control}
                  name="endpointBId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("runs.form.endpointB")}</FormLabel>
                      <FormControl>
                        <ConnectionPicker
                          selectedConnectionId={field.value ?? null}
                          onSelect={(id) => field.onChange(id ?? undefined)}
                          allowManual={false}
                          excludeIds={endpointAId ? [endpointAId] : undefined}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </FormSection>

            <FormSection title={t("runs.form.sectionGate")}>
              <GateConfigForm
                namePrefix="gateConfig"
                dual={!!endpointBId || baselineModeActive}
                maxRegressionsDisabledHint={
                  !endpointBId && !baselineModeActive
                    ? t("runs.form.maxRegressionsDisabledHint")
                    : undefined
                }
              />
            </FormSection>

            <FormActions
              onCancel={() => nav("/quality-gate/runs")}
              cancelLabel={t("evaluations.form.cancel")}
              submitLabel={t("runs.form.trigger")}
              disabled={!form.formState.isValid}
              pending={create.isPending}
            />
          </form>
        </Form>

        <BaselinePickerDialog
          evaluationId={evaluationId}
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          initialRunId={effectiveBaselineId}
          onPick={(runId) => form.setValue("baselineRunIdOverride", runId, { shouldDirty: true, shouldValidate: true })}
        />
      </div>
    </>
  );
}
```

- [ ] **Step 6: Extend GateConfigForm with disabled hint**

Open `apps/web/src/features/quality-gate/components/GateConfigForm.tsx`. Add `maxRegressionsDisabledHint` prop. The component already conditionally renders the regressionMax Row when `dual=true`. Change logic: render the regressionMax Row always, but disable the toggle + show hint when `!dual`:

```tsx
interface Props {
  namePrefix: string;
  dual: boolean;
  maxRegressionsDisabledHint?: string;
}

export function GateConfigForm({ namePrefix, dual, maxRegressionsDisabledHint }: Props) {
  const { t } = useTranslation("quality-gate");
  return (
    <div className="space-y-3 max-w-md">
      <Row namePrefix={namePrefix} fieldKey="passRateMin" label={t("gate.passRateMin")} />
      <Row
        namePrefix={namePrefix}
        fieldKey="regressionMax"
        label={t("gate.regressionMax")}
        disabled={!dual}
        disabledHint={!dual ? maxRegressionsDisabledHint : undefined}
      />
      <Row namePrefix={namePrefix} fieldKey="judgeScoreMin" label={t("gate.judgeScoreMin")} />
    </div>
  );
}
```

And the `Row` component takes additional props:

```tsx
function Row({
  namePrefix,
  fieldKey,
  label,
  disabled,
  disabledHint,
}: {
  namePrefix: string;
  fieldKey: Key;
  label: string;
  disabled?: boolean;
  disabledHint?: string;
}) {
  // ... existing logic
  // wrap the existing render in a wrapper that shows the hint when disabled
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3">
        <Switch
          checked={enabled && !disabled}
          disabled={disabled}
          onCheckedChange={(b) =>
            setValue(`${namePrefix}.${fieldKey}`, b ? DEFAULTS[fieldKey] : undefined, {
              shouldDirty: true,
              shouldValidate: true,
            })
          }
        />
        {/* existing FormField with Label + Input */}
      </div>
      {disabled && disabledHint && (
        <div className="text-xs text-muted-foreground ml-12">{disabledHint}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Run tests + lint + build**

```bash
pnpm -F @modeldoctor/web test --run && \
pnpm -F @modeldoctor/web exec biome check --write src && \
pnpm -F @modeldoctor/web lint
```

Expected: tests pass (existing RunCreatePage.test.tsx tests still pass — the banner not rendered when mock evaluation has no pin); lint clean.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/quality-gate/components/BaselinePickerDialog.tsx \
        apps/web/src/features/quality-gate/components/GateConfigForm.tsx \
        apps/web/src/features/quality-gate/RunCreatePage.tsx \
        apps/web/src/features/quality-gate/queries.ts \
        apps/web/src/locales/zh-CN/quality-gate.json \
        apps/web/src/locales/en-US/quality-gate.json
git commit -m "$(cat <<'EOF'
feat(quality-gate): Run create baseline banner + picker dialog

When the selected evaluation has a pinned baseline:
- Show a banner "📌 与 baseline 对比" with Change / Skip buttons
- Hide the Endpoint B FormField (mutually exclusive at schema level)
- Enable the Max Regressions gate toggle (otherwise disabled with hint)

Change button opens a Dialog listing the evaluation's recent COMPLETED
runs; the picked run becomes baselineRunIdOverride for this submit
only (doesn't repin the evaluation).

Skip button sets baselineRunIdOverride=null, banner disappears, endpoint
B re-appears, gate Max Regressions disables.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Frontend — Run detail UX (pin button + baseline info)

**Files:**
- Create: `apps/web/src/features/quality-gate/components/PinBaselineButton.tsx`
- Modify: `apps/web/src/features/quality-gate/RunReportPage.tsx`
- Modify: `apps/web/src/features/quality-gate/components/RunOverview.tsx`
- Modify: `apps/web/src/features/quality-gate/components/SamplesTable.tsx`
- Modify: `apps/web/src/locales/zh-CN/quality-gate.json` + `en-US`
- Test: `apps/web/src/features/quality-gate/components/__tests__/PinBaselineButton.test.tsx` (new)
- Test: `apps/web/src/features/quality-gate/__tests__/RunReportPage.test.tsx`

- [ ] **Step 1: Add i18n keys**

In zh-CN/quality-gate.json `"runs.report"` block, add:

```json
      "pinButton": "📌 钉为 baseline",
      "pinnedBadge": "📌 已钉为 baseline",
      "unpinButton": "解钉",
      "replaceConfirmTitle": "替换 baseline?",
      "replaceConfirmBody": "当前 baseline: Run #{{currentId}}\n将替换为: 本 run\n\n之前用旧 baseline 跑过的对比结果保留不变。",
      "replaceConfirmAction": "替换 baseline",
      "unpinConfirmTitle": "解钉 baseline?",
      "unpinConfirmBody": "本评测集后续 run 将默认不带 baseline 对比。",
      "unpinConfirmAction": "解钉",
      "passRateCurrent": "通过率 (本次)",
      "passRateBaseline": "通过率 (baseline)",
      "judgeAvgCurrent": "Judge 均分 (本次)",
      "judgeAvgBaseline": "Judge 均分 (baseline)",
      "baselineModeBanner": "📌 与 baseline 对比: Run #{{runId}}",
      "baselineViewLink": "查看 baseline →",
      "pinSuccessToast": "已钉为 baseline",
      "unpinSuccessToast": "已解钉",
      "pinErrorToast": "操作失败: {{message}}"
```

en-US equivalents:

```json
      "pinButton": "📌 Set as baseline",
      "pinnedBadge": "📌 Pinned baseline",
      "unpinButton": "Unpin",
      "replaceConfirmTitle": "Replace baseline?",
      "replaceConfirmBody": "Current baseline: Run #{{currentId}}\nWill be replaced by: this run\n\nPrevious comparisons against the old baseline are preserved.",
      "replaceConfirmAction": "Replace baseline",
      "unpinConfirmTitle": "Unpin baseline?",
      "unpinConfirmBody": "Future runs of this evaluation will run single-endpoint by default.",
      "unpinConfirmAction": "Unpin",
      "passRateCurrent": "Pass Rate (current)",
      "passRateBaseline": "Pass Rate (baseline)",
      "judgeAvgCurrent": "Judge Avg (current)",
      "judgeAvgBaseline": "Judge Avg (baseline)",
      "baselineModeBanner": "📌 Compared against Run #{{runId}}",
      "baselineViewLink": "View baseline →",
      "pinSuccessToast": "Pinned as baseline",
      "unpinSuccessToast": "Unpinned",
      "pinErrorToast": "Operation failed: {{message}}"
```

In SamplesTable headers section, add `headerPassedCurrent` / `headerPassedBaseline`:

```json
    "samplesTable": {
      "headers": {
        ...,
        "passedCurrent": "本次通过",
        "passedBaseline": "baseline 通过"
      },
      ...
    }
```

(en-US: `"passedCurrent": "Current passed", "passedBaseline": "Baseline passed"`)

- [ ] **Step 2: Create PinBaselineButton component**

Create `apps/web/src/features/quality-gate/components/PinBaselineButton.tsx`:

```tsx
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useEvaluation, useSetBaseline } from "../queries";

interface Props {
  evaluationId: string;
  runId: string;
}

export function PinBaselineButton({ evaluationId, runId }: Props) {
  const { t } = useTranslation("quality-gate");
  const evaluation = useEvaluation(evaluationId);
  const setBaseline = useSetBaseline(evaluationId);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [unpinOpen, setUnpinOpen] = useState(false);

  const currentPin = evaluation.data?.baselineRunId ?? null;
  const isThisPinned = currentPin === runId;
  const hasOtherPin = currentPin !== null && !isThisPinned;

  async function pin(target: string | null, successKey: string) {
    try {
      await setBaseline.mutateAsync(target);
      toast.success(t(successKey));
    } catch (err) {
      toast.error(t("runs.report.pinErrorToast", { message: (err as Error).message }));
    }
  }

  if (isThisPinned) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-primary font-medium">{t("runs.report.pinnedBadge")}</span>
        <AlertDialog open={unpinOpen} onOpenChange={setUnpinOpen}>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="sm" className="text-destructive">
              {t("runs.report.unpinButton")}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("runs.report.unpinConfirmTitle")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("runs.report.unpinConfirmBody")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("evaluations.form.cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={() => pin(null, "runs.report.unpinSuccessToast")}>
                {t("runs.report.unpinConfirmAction")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  if (hasOtherPin) {
    return (
      <AlertDialog open={replaceOpen} onOpenChange={setReplaceOpen}>
        <AlertDialogTrigger asChild>
          <Button variant="outline" size="sm">
            {t("runs.report.pinButton")}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("runs.report.replaceConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-line">
              {t("runs.report.replaceConfirmBody", { currentId: currentPin?.slice(0, 12) })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("evaluations.form.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => pin(runId, "runs.report.pinSuccessToast")}>
              {t("runs.report.replaceConfirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => pin(runId, "runs.report.pinSuccessToast")}
      disabled={setBaseline.isPending}
    >
      {t("runs.report.pinButton")}
    </Button>
  );
}
```

- [ ] **Step 3: Wire PinBaselineButton into RunReportPage**

Open `apps/web/src/features/quality-gate/RunReportPage.tsx`. In `<PageHeader rightSlot={...}>`, render the pin button when status is COMPLETED, alongside the existing cancel/whatever button:

```tsx
rightSlot={
  <div className="flex items-center gap-2">
    {run.status === "RUNNING" && (
      <Button variant="outline" onClick={() => cancel.mutate()}>
        {t("runs.report.cancel")}
      </Button>
    )}
    {run.status === "COMPLETED" && (
      <PinBaselineButton evaluationId={run.evaluationId} runId={run.id} />
    )}
  </div>
}
```

Add the import at the top:

```tsx
import { PinBaselineButton } from "./components/PinBaselineButton";
```

Note `run.evaluationId` should be available on the EvaluationRun DTO. Verify by searching for `evaluationId` in `evaluationRunSchema`.

- [ ] **Step 4: Update RunOverview to show baseline metadata**

Open `apps/web/src/features/quality-gate/components/RunOverview.tsx`. Add a baseline banner row at the top when `run.baselineRunIdAtExecution != null`, and switch metric labels:

```tsx
import { Link } from "react-router-dom";

export function RunOverview({ run }: { run: EvaluationRun }) {
  const { t } = useTranslation("quality-gate");
  const m = run.aggregateMetrics;
  const wallClock =
    run.startedAt && run.finishedAt
      ? `${Math.round((+new Date(run.finishedAt) - +new Date(run.startedAt)) / 1000)}s`
      : null;
  const baselineMode = run.baselineRunIdAtExecution != null;
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <GateStatusBadge status={run.status} gateResult={run.gateResult} />
        <span className="text-sm text-muted-foreground">
          {run.processedSamples}/{run.totalSamples}
          {wallClock ? ` · ${wallClock}` : ""}
        </span>
      </div>
      {baselineMode && (
        <div className="text-sm rounded-md bg-primary/5 border border-primary/20 px-3 py-2 flex items-center justify-between">
          <span>
            {t("runs.report.baselineModeBanner", {
              runId: run.baselineRunIdAtExecution?.slice(0, 12),
            })}
          </span>
          <Link
            to={`/quality-gate/runs/${run.baselineRunIdAtExecution}`}
            className="text-primary hover:underline"
          >
            {t("runs.report.baselineViewLink")}
          </Link>
        </div>
      )}
      {m && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <div>
            <div className="text-xs text-muted-foreground">
              {baselineMode ? t("runs.report.passRateCurrent") : t("report.metrics.passRateA")}
            </div>
            <div className="text-2xl">{pct(m.passRateA)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">
              {baselineMode ? t("runs.report.passRateBaseline") : t("report.metrics.passRateB")}
            </div>
            <div className="text-2xl">{pct(m.passRateB)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">
              {t("report.metrics.regressionImprovement")}
            </div>
            <div className="text-2xl">
              {m.regressionCount ?? "—"} / {m.improvementCount ?? "—"}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">
              {baselineMode ? t("runs.report.judgeAvgCurrent") : t("report.metrics.judgeAvgA")}
            </div>
            <div className="text-2xl">{num(m.judgeAvgA)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">
              {baselineMode ? t("runs.report.judgeAvgBaseline") : t("report.metrics.judgeAvgB")}
            </div>
            <div className="text-2xl">{num(m.judgeAvgB)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">{t("report.metrics.judgeCallCount")}</div>
            <div className="text-2xl">{m.judgeCallCount}</div>
          </div>
        </div>
      )}
      {run.errorMessage && <div className="text-destructive text-sm">{run.errorMessage}</div>}
    </Card>
  );
}
```

- [ ] **Step 5: Update SamplesTable column header logic**

Open `apps/web/src/features/quality-gate/components/SamplesTable.tsx`. SamplesTable currently takes `runId` only; to know mode we need either to also pass `baselineMode` from the parent OR fetch the run inside. Cleaner: pass a prop:

```tsx
export function SamplesTable({
  runId,
  baselineMode,
  onOpenSample,
}: {
  runId: string;
  baselineMode: boolean;
  onOpenSample: (sampleId: string) => void;
}) {
```

Change the column header text:

```tsx
<TableHead className="w-20">
  {baselineMode
    ? t("report.samplesTable.headers.passedCurrent")
    : t("report.samplesTable.headers.passedA")}
</TableHead>
<TableHead className="w-20">
  {baselineMode
    ? t("report.samplesTable.headers.passedBaseline")
    : t("report.samplesTable.headers.passedB")}
</TableHead>
```

Update the caller in RunReportPage:

```tsx
<SamplesTable
  runId={run.id}
  baselineMode={run.baselineRunIdAtExecution != null}
  onOpenSample={setOpenSampleId}
/>
```

- [ ] **Step 6: Update existing RunReportPage test for new prop**

Open `apps/web/src/features/quality-gate/__tests__/RunReportPage.test.tsx`. The mock run should include `baselineRunIdAtExecution: null` (or test both branches). Adjust the mock fixture in the file. If the test currently smoke-renders, just ensure `baselineRunIdAtExecution: null` is on the mock run object.

- [ ] **Step 7: Add PinBaselineButton component test**

Create `apps/web/src/features/quality-gate/components/__tests__/PinBaselineButton.test.tsx`:

```tsx
import i18n from "@/lib/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PinBaselineButton } from "../PinBaselineButton";

vi.mock("../../queries", () => ({
  useEvaluation: vi.fn(),
  useSetBaseline: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { useEvaluation } from "../../queries";

beforeAll(async () => {
  await i18n.changeLanguage("zh-CN");
});

function P({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </QueryClientProvider>
  );
}

describe("PinBaselineButton", () => {
  it("renders 'Pin' button when evaluation has no baseline", () => {
    (useEvaluation as never as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { id: "e1", baselineRunId: null },
    });
    render(<PinBaselineButton evaluationId="e1" runId="r1" />, { wrapper: P });
    expect(screen.getByRole("button", { name: /钉为 baseline/ })).toBeInTheDocument();
  });

  it("renders 'Pinned + Unpin' when this run is the pin", () => {
    (useEvaluation as never as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { id: "e1", baselineRunId: "r1" },
    });
    render(<PinBaselineButton evaluationId="e1" runId="r1" />, { wrapper: P });
    expect(screen.getByText(/已钉为 baseline/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /解钉/ })).toBeInTheDocument();
  });

  it("renders 'Pin' (AlertDialog trigger) when another run is the pin", () => {
    (useEvaluation as never as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { id: "e1", baselineRunId: "other-run" },
    });
    render(<PinBaselineButton evaluationId="e1" runId="r1" />, { wrapper: P });
    expect(screen.getByRole("button", { name: /钉为 baseline/ })).toBeInTheDocument();
  });
});
```

- [ ] **Step 8: Run tests**

```bash
pnpm -F @modeldoctor/web test --run
```

Expected: 3 new PinBaselineButton tests pass, existing tests still pass.

- [ ] **Step 9: Lint + commit**

```bash
pnpm -F @modeldoctor/web exec biome check --write src && pnpm -F @modeldoctor/web lint
git add apps/web/src/features/quality-gate \
        apps/web/src/locales/zh-CN/quality-gate.json \
        apps/web/src/locales/en-US/quality-gate.json
git commit -m "$(cat <<'EOF'
feat(quality-gate): Run detail Pin/Unpin button + baseline UI

PinBaselineButton component handles all three states in the Run detail
page header rightSlot:
- No pin → outline 'Set as baseline' button (immediate mutation)
- This run is pinned → 'Pinned' badge + ghost 'Unpin' button (confirm)
- Another run is pinned → 'Set as baseline' button (replace confirm)

All mutations go through useSetBaseline → PATCH /evaluations/:id with
{ baselineRunId } and invalidate the evaluation cache.

RunOverview shows a baseline banner row + 'View baseline →' link when
run.baselineRunIdAtExecution is set. Metric labels switch from
'Pass Rate A / B' to 'Pass Rate (current) / (baseline)' in baseline
mode (and the same for judge averages).

SamplesTable column headers switch the same way: A 通过 / B 通过 →
本次通过 / baseline 通过.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Frontend — Evaluation detail UX (baseline card)

**Files:**
- Create: `apps/web/src/features/quality-gate/components/PinnedBaselineCard.tsx`
- Modify: `apps/web/src/features/quality-gate/EvaluationDetailPage.tsx`
- Modify: `apps/web/src/locales/zh-CN/quality-gate.json` + `en-US`
- Test: `apps/web/src/features/quality-gate/components/__tests__/PinnedBaselineCard.test.tsx` (new)

- [ ] **Step 1: Add i18n keys**

In `evaluations.baseline.*` of both locale files:

```json
"baseline": {
  "cardTitle": "📌 Pinned Baseline",
  "view": "查看 run",
  "change": "更改…",
  "unpin": "解钉",
  "loading": "加载中…",
  "unpinConfirmTitle": "解钉 baseline?",
  "unpinConfirmBody": "本评测集后续 run 将默认不带 baseline 对比。",
  "unpinConfirmAction": "解钉"
}
```

(en-US: cardTitle "📌 Pinned Baseline", view "View run", change "Change…", unpin "Unpin", etc.)

- [ ] **Step 2: Create PinnedBaselineCard component**

Create `apps/web/src/features/quality-gate/components/PinnedBaselineCard.tsx`:

```tsx
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useRun, useSetBaseline } from "../queries";
import { BaselinePickerDialog } from "./BaselinePickerDialog";
import { GateStatusBadge } from "./GateStatusBadge";

interface Props {
  evaluationId: string;
  baselineRunId: string;
}

export function PinnedBaselineCard({ evaluationId, baselineRunId }: Props) {
  const { t } = useTranslation("quality-gate");
  const { data: run } = useRun(baselineRunId);
  const setBaseline = useSetBaseline(evaluationId);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [unpinOpen, setUnpinOpen] = useState(false);

  async function doUnpin() {
    try {
      await setBaseline.mutateAsync(null);
      toast.success(t("runs.report.unpinSuccessToast"));
    } catch (err) {
      toast.error(t("runs.report.pinErrorToast", { message: (err as Error).message }));
    }
  }

  async function doChange(newRunId: string) {
    try {
      await setBaseline.mutateAsync(newRunId);
      toast.success(t("runs.report.pinSuccessToast"));
    } catch (err) {
      toast.error(t("runs.report.pinErrorToast", { message: (err as Error).message }));
    }
  }

  return (
    <div className="rounded-md border bg-card p-4 space-y-2">
      <div className="font-medium">{t("evaluations.baseline.cardTitle")}</div>
      {!run ? (
        <div className="text-sm text-muted-foreground">
          {t("evaluations.baseline.loading")}
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 text-sm">
            <span className="font-mono">{run.id.slice(0, 12)}</span>
            <span className="text-muted-foreground">·</span>
            <span>{new Date(run.createdAt).toLocaleString()}</span>
            <span className="text-muted-foreground">·</span>
            <GateStatusBadge status={run.status} gateResult={run.gateResult} />
          </div>
          <div className="flex gap-2 pt-1">
            <Button asChild size="sm" variant="outline">
              <Link to={`/quality-gate/runs/${run.id}`}>{t("evaluations.baseline.view")}</Link>
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)}>
              {t("evaluations.baseline.change")}
            </Button>
            <AlertDialog open={unpinOpen} onOpenChange={setUnpinOpen}>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="ghost" className="text-destructive">
                  {t("evaluations.baseline.unpin")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("evaluations.baseline.unpinConfirmTitle")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("evaluations.baseline.unpinConfirmBody")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("evaluations.form.cancel")}</AlertDialogCancel>
                  <AlertDialogAction onClick={doUnpin}>
                    {t("evaluations.baseline.unpinConfirmAction")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </>
      )}
      <BaselinePickerDialog
        evaluationId={evaluationId}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        initialRunId={baselineRunId}
        onPick={doChange}
      />
    </div>
  );
}
```

- [ ] **Step 3: Wire into EvaluationDetailPage**

Open `apps/web/src/features/quality-gate/EvaluationDetailPage.tsx`. After the page header and inside the body, ABOVE the FormSections, conditionally render the card:

```tsx
import { PinnedBaselineCard } from "./components/PinnedBaselineCard";

// inside the JSX, after PageHeader, before the <Form>:
<div className="space-y-6 px-8 py-6">
  {data.baselineRunId && (
    <PinnedBaselineCard
      evaluationId={data.id}
      baselineRunId={data.baselineRunId}
    />
  )}
  <Form {...form}>
    {/* ...existing content... */}
  </Form>
</div>
```

- [ ] **Step 4: Add test**

Create `apps/web/src/features/quality-gate/components/__tests__/PinnedBaselineCard.test.tsx`:

```tsx
import i18n from "@/lib/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PinnedBaselineCard } from "../PinnedBaselineCard";

const mockRun = {
  id: "baseline-run-123",
  status: "COMPLETED" as const,
  gateResult: "PASSED" as const,
  createdAt: "2026-05-10T14:23:00Z",
};

vi.mock("../../queries", () => ({
  useRun: () => ({ data: mockRun }),
  useSetBaseline: () => ({ mutateAsync: vi.fn() }),
  useRuns: () => ({ data: { items: [] } }),
}));

beforeAll(async () => {
  await i18n.changeLanguage("zh-CN");
});

function P({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>{children}</MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>
  );
}

describe("PinnedBaselineCard", () => {
  it("renders baseline run summary with three action buttons", () => {
    render(<PinnedBaselineCard evaluationId="e1" baselineRunId="baseline-run-123" />, {
      wrapper: P,
    });
    expect(screen.getByText(/Pinned Baseline/)).toBeInTheDocument();
    expect(screen.getByText(/baseline-run/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /查看 run/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /更改/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /解钉/ })).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run all web tests + lint**

```bash
pnpm -F @modeldoctor/web test --run && \
pnpm -F @modeldoctor/web exec biome check --write src && \
pnpm -F @modeldoctor/web lint
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/quality-gate/components/PinnedBaselineCard.tsx \
        apps/web/src/features/quality-gate/components/__tests__/PinnedBaselineCard.test.tsx \
        apps/web/src/features/quality-gate/EvaluationDetailPage.tsx \
        apps/web/src/locales/zh-CN/quality-gate.json \
        apps/web/src/locales/en-US/quality-gate.json
git commit -m "$(cat <<'EOF'
feat(quality-gate): EvaluationDetailPage baseline card

When the evaluation has a pinned baseline, render a card above the
form sections showing:
- The pinned run's id (truncated), createdAt, and gate badge
- View run link (→ run detail page)
- Change… button (opens BaselinePickerDialog → picks → repin)
- Unpin button (AlertDialog confirm → PATCH baselineRunId=null)

Reuses BaselinePickerDialog from Task 7.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Phase 2 — RunsListPage multi-select toolbar

**Files:**
- Modify: `apps/web/src/features/quality-gate/RunsListPage.tsx`
- Modify: `apps/web/src/locales/zh-CN/quality-gate.json` + `en-US`
- Test: `apps/web/src/features/quality-gate/__tests__/RunsListPage.test.tsx`

- [ ] **Step 1: Add i18n keys**

Both locale files, under `runs`:

```json
"selection": {
  "count": "已选 {{count}}",
  "compareSelected": "📊 对比所选",
  "clear": "取消选择",
  "needTwo": "至少选择 2 个 run 才能对比"
}
```

en-US: "Selected {{count}}", "📊 Compare selected", "Clear", "Select at least 2 runs to compare".

- [ ] **Step 2: Add checkbox column + state + toolbar to RunsListPage**

Open `apps/web/src/features/quality-gate/RunsListPage.tsx`. Add Checkbox import:

```tsx
import { Checkbox } from "@/components/ui/checkbox";
import { useState } from "react";
```

Inside the component, add selection state and helpers:

```tsx
const [selected, setSelected] = useState<Set<string>>(new Set());
const toggle = (id: string) => {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  setSelected(next);
};
const clearSelection = () => setSelected(new Set());
const compareSelected = () => {
  const ids = Array.from(selected).join(",");
  nav(`/benchmarks/compare/saved/new?evaluationRunIds=${ids}`);
};
```

Add a sticky toolbar ABOVE the table when selected.size > 0:

```tsx
{selected.size > 0 && (
  <div className="sticky top-0 z-10 bg-card border rounded-md p-2 flex items-center justify-between">
    <span className="text-sm">{t("runs.selection.count", { count: selected.size })}</span>
    <div className="flex gap-2">
      <Button
        size="sm"
        disabled={selected.size < 2}
        onClick={compareSelected}
        title={selected.size < 2 ? t("runs.selection.needTwo") : undefined}
      >
        {t("runs.selection.compareSelected")} ({selected.size})
      </Button>
      <Button size="sm" variant="ghost" onClick={clearSelection}>
        {t("runs.selection.clear")}
      </Button>
    </div>
  </div>
)}
```

Add a leading checkbox column to the TableRow:

```tsx
<TableHeader>
  <TableRow>
    <TableHead className="w-8"></TableHead>
    <TableHead>{t("evaluations.runsCol.id")}</TableHead>
    ...
  </TableRow>
</TableHeader>
<TableBody>
  {items.map((r) => (
    <TableRow key={r.id}>
      <TableCell>
        <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} />
      </TableCell>
      <TableCell>
        <Link ...>{r.id.slice(0, 12)}</Link>
      </TableCell>
      ...
    </TableRow>
  ))}
</TableBody>
```

- [ ] **Step 3: Update RunsListPage test**

Open `apps/web/src/features/quality-gate/__tests__/RunsListPage.test.tsx`. Add:

```tsx
it("shows compare toolbar when ≥1 row selected", async () => {
  // ... use a fixture with 2+ items
  render(<RunsListPage />, { wrapper: P });
  // The default mock should have items now; if not, update the mock fixture
  // For brevity assume test fixture has 2 runs in COMPLETED status.
  const checkboxes = screen.getAllByRole("checkbox");
  await userEvent.click(checkboxes[0]);
  expect(screen.getByText(/已选 1/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /对比所选/ })).toBeDisabled();
  await userEvent.click(checkboxes[1]);
  expect(screen.getByRole("button", { name: /对比所选/ })).toBeEnabled();
});
```

The existing mock returns empty list, so update the mock to include 2 items:

```ts
vi.mock("../queries", () => ({
  useRuns: () => ({
    data: {
      items: [
        { id: "r1", status: "COMPLETED", createdAt: "2026-05-12T00:00:00Z", processedSamples: 3, totalSamples: 3, gateResult: "PASSED" },
        { id: "r2", status: "COMPLETED", createdAt: "2026-05-13T00:00:00Z", processedSamples: 3, totalSamples: 3, gateResult: "PASSED" },
      ],
      total: 2, page: 1, pageSize: 20,
    },
    isLoading: false,
  }),
  useDeleteRun: () => ({ mutate: vi.fn() }),
}));
```

Add `userEvent` import:

```tsx
import userEvent from "@testing-library/user-event";
```

- [ ] **Step 4: Run tests**

```bash
pnpm -F @modeldoctor/web test RunsListPage --run
```

Expected: tests pass.

- [ ] **Step 5: Lint + commit**

```bash
pnpm -F @modeldoctor/web exec biome check --write src && pnpm -F @modeldoctor/web lint
git add apps/web/src/features/quality-gate/RunsListPage.tsx \
        apps/web/src/features/quality-gate/__tests__/RunsListPage.test.tsx \
        apps/web/src/locales/zh-CN/quality-gate.json \
        apps/web/src/locales/en-US/quality-gate.json
git commit -m "$(cat <<'EOF'
feat(quality-gate): RunsListPage multi-select + 'compare selected'

Add a leading checkbox column. When ≥1 row is selected, a sticky
toolbar appears above the table showing the count and a 'Compare
selected' button (disabled until ≥2). Clicking the button navigates
to /benchmarks/compare/saved/new?evaluationRunIds=id1,id2,...

The Saved Compare creation page (Task 11) reads that query param and
prefills its evaluationRunIds + auto stage labels.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Phase 2 — Add-to-Compare + Smart stageLabels

**Files:**
- Modify: `apps/web/src/features/quality-gate/RunReportPage.tsx`
- Modify: `apps/web/src/features/benchmarks/compare/SavedCompareCreatePage.tsx`
- Modify: `apps/web/src/locales/zh-CN/quality-gate.json` + `en-US`
- Modify: `apps/web/src/locales/zh-CN/benchmarks.json` + `en-US` (for compare.autoLabel.*)
- Test: relevant pages

- [ ] **Step 1: Add i18n keys**

In quality-gate.json both locales, under `runs.report`:

```json
"addToCompareButton": "📊 加入对比",
```

In benchmarks.json under `compare`:

```json
"autoLabel": {
  "latest": "最新",
  "previous": "前一次",
  "older": "再前一次"
}
```

(en-US: "Latest", "Previous", "Earlier")

- [ ] **Step 2: Add 'Add to Compare' button on RunReportPage**

In `<PageHeader rightSlot>`, add a new button next to the pin button:

```tsx
{run.status === "COMPLETED" && (
  <Button
    variant="outline"
    size="sm"
    asChild
  >
    <Link to={`/benchmarks/compare/saved/new?evaluationRunIds=${run.id}`}>
      {t("runs.report.addToCompareButton")}
    </Link>
  </Button>
)}
```

So the rightSlot is now: `[Cancel (if RUNNING)] / [Pin][Add to compare] (if COMPLETED)`.

- [ ] **Step 3: Modify SavedCompareCreatePage to read query param + auto stageLabels**

Open `apps/web/src/features/benchmarks/compare/SavedCompareCreatePage.tsx`. Find where evaluationRunIds is managed in form state. Add a `useSearchParams` hook:

```tsx
import { useSearchParams } from "react-router-dom";

const [searchParams] = useSearchParams();
const prefilledIdsParam = searchParams.get("evaluationRunIds");
const prefilledIds = prefilledIdsParam ? prefilledIdsParam.split(",").filter(Boolean) : [];
```

In the form's defaultValues, preload `evaluationRunIds: prefilledIds`. Also fetch all selected runs (using `useRuns` or per-id `useRun` fetches) to get their `createdAt`, then sort + assign stage labels:

```tsx
import { useEvaluationRunsByIds } from "@/features/quality-gate/queries"; // see step 3.5

const selected = useEvaluationRunsByIds(prefilledIds);

useEffect(() => {
  if (!selected.data) return;
  if (form.formState.dirtyFields.stageLabels) return;  // user already edited

  const sorted = [...selected.data].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const labels = sorted.map((r, i) => {
    if (i === 0) return [r.id, t("compare.autoLabel.latest", { ns: "benchmarks" })];
    if (i === 1) return [r.id, t("compare.autoLabel.previous", { ns: "benchmarks" })];
    if (i === 2) return [r.id, t("compare.autoLabel.older", { ns: "benchmarks" })];
    return [r.id, new Date(r.createdAt).toISOString().slice(0, 10)];
  });
  form.setValue("stageLabels", Object.fromEntries(labels));
}, [selected.data, form, t]);
```

- [ ] **Step 3.5: Add `useEvaluationRunsByIds` query helper**

Open `apps/web/src/features/quality-gate/queries.ts`. Add:

```ts
export function useEvaluationRunsByIds(ids: string[]) {
  return useQuery({
    queryKey: ["quality-gate", "runs-by-ids", ids.sort().join(",")],
    queryFn: async () => {
      const results = await Promise.all(ids.map((id) => qgApi.getRun(id)));
      return results;
    },
    enabled: ids.length > 0,
  });
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm -F @modeldoctor/web test --run
```

Expected: all pass. (No new tests written for this task — the change is wiring-level; existing SavedCompareCreatePage tests should still pass.)

- [ ] **Step 5: Manual smoke check description**

This task is hard to fully unit-test without overhead. Add a comment in the SavedCompareCreatePage explaining the query-param shape so the smoke check is documented:

```tsx
// Deep link: /benchmarks/compare/saved/new?evaluationRunIds=id1,id2
// Triggered from RunsListPage (multi-select toolbar) and RunReportPage
// (Add to Compare button). On mount we prefill evaluationRunIds and,
// once their createdAt timestamps load, auto-fill stageLabels with
// "Latest / Previous / Older" or YYYY-MM-DD strings.
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/quality-gate/RunReportPage.tsx \
        apps/web/src/features/quality-gate/queries.ts \
        apps/web/src/features/benchmarks/compare/SavedCompareCreatePage.tsx \
        apps/web/src/locales/zh-CN/quality-gate.json \
        apps/web/src/locales/en-US/quality-gate.json \
        apps/web/src/locales/zh-CN/benchmarks.json \
        apps/web/src/locales/en-US/benchmarks.json
git commit -m "$(cat <<'EOF'
feat(quality-gate): RunReportPage 'add to compare' + auto stage labels

Run detail header gains an 'Add to compare' button (next to the pin
button) that deep-links to /benchmarks/compare/saved/new with the
current run preselected. Same query-param shape as Task 10's
RunsListPage multi-select toolbar.

SavedCompareCreatePage reads evaluationRunIds from the URL query
param and, once the selected runs' createdAt timestamps load, auto-
fills stageLabels using i18n strings (Latest / Previous / Older or
YYYY-MM-DD for ≥4 runs). User can still edit any label before submit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final verification

After all tasks:

```bash
# Full test suite
pnpm -F @modeldoctor/api test --run
pnpm -F @modeldoctor/web test --run
pnpm -F @modeldoctor/contracts test --run

# Type-check + lint
pnpm -r type-check
pnpm -F @modeldoctor/api lint
pnpm -F @modeldoctor/web lint

# Build
pnpm -r --filter "@modeldoctor/*" build

# i18n parity
pnpm -F @modeldoctor/web check:i18n
```

All must be green before push.

```bash
git push -u origin feat-qg-baseline
gh pr create --title "feat(quality-gate): pinned baseline + saved compare polish (refs #179)" --body "$(cat <<'EOF'
## Summary
- **Phase 1 — Pinned Baseline**: Per-evaluation 1:1 baseline pin (`Evaluation.baselineRunId`). Run detail "Set as baseline" button. Run create auto-uses pin (with override / skip). Executor reads pinned baseline snapshot at start (locked into `EvaluationRun.baselineRunIdAtExecution`), stores today's call into `resultA` and baseline's `resultA` into `resultB`, computes delta with semantic-preserving argument swap. Reuses existing dual A/B `computeDelta` unchanged. `regressionMax` gate threshold becomes usable in single-endpoint runs.
- **Phase 2 — Saved Compare UX**: Multi-select checkboxes + "Compare selected" toolbar on RunsListPage. "Add to compare" deep link on Run detail. SavedCompareCreatePage reads `evaluationRunIds` query param and auto-fills stage labels by createdAt order.

Industry pattern reference: Braintrust / Vellum / Chromatic ("Set Baseline" pin model).

## Test Plan
- [ ] api unit tests pass (services, executor, controller)
- [ ] api e2e: pin → new run → completes with delta + gate verdict
- [ ] web unit tests pass (component + page tests)
- [ ] Manual: pin a run, create new run, verify banner / hidden endpoint B / delta in samples table
- [ ] Manual: select 2 runs in RunsListPage, "Compare selected" navigates to saved-compare create with prefill

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
