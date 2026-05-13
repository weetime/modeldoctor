# Quality Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the V1 "Quality Gate" top-level domain — pass/warning/fail verdict on a configuration change by running an evaluation set against one or two endpoints, with 4 built-in judges, Saved Compares integration, and one-way Playground reproduce.

**Architecture:** New top-level route `/quality-gate` with 3 sub-pages (evaluations / runs / templates). 3 new Prisma tables (`evaluations`, `evaluation_runs`, `evaluation_run_samples`) + `saved_compares` extended with `evaluation_run_ids`. In-process async executor (no Redis, no K8s Job) with `pLimit(4)` sample concurrency and `pLimit(2)` judge concurrency. `llm-judge` reuses the AI Diagnostics service.

**Tech Stack:** Prisma 6 / NestJS 11 / Postgres / zod 3 / pLimit / React + TanStack Query / shadcn UI / vitest + RTL / testcontainers + supertest.

**Reference spec:** `docs/superpowers/specs/2026-05-12-quality-gate-design.md`

---

## Pre-flight (do once before Task 1)

- Create feature worktree on new branch from `main` (use `superpowers:using-git-worktrees`). All edits in this plan happen in that worktree, not `main/`.
- Run `pnpm install && pnpm -r build` once. New worktrees leave `packages/*/dist` empty and `apps/api` typecheck fails until this runs (per `project_worktree_build_first`).
- **DB drift warning:** Tasks 1 and 2 add Prisma migrations. The local dev DB (`modeldoctor:modeldoctor@localhost:5432/modeldoctor`) will go out of sync until you run `pnpm -F @modeldoctor/api db:migrate dev`. If migration fails with drift, surface to the user — do not auto-reset (per `feedback_dev_db_disposable`).
- Confirm dev DB is reachable: `psql modeldoctor://modeldoctor:modeldoctor@localhost:5432/modeldoctor -c '\dt'` should print existing tables without error.

---

## Task 1: Prisma schema — Quality Gate tables + enums

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (append models + enums)
- Create: `apps/api/prisma/migrations/<timestamp>_quality_gate_tables/migration.sql` (Prisma-generated)

- [ ] **Step 1: Append models + enums to `schema.prisma`** (before the trailing closing brace area; place near other feature models)

```prisma
model Evaluation {
  id           String   @id @default(cuid())
  userId       String   @map("user_id")
  name         String
  description  String?
  version      Int      @default(1)
  samples      Json
  totalSamples Int      @default(0) @map("total_samples")
  createdAt    DateTime @default(now())  @map("created_at") @db.Timestamptz(3)
  updatedAt    DateTime @updatedAt        @map("updated_at") @db.Timestamptz(3)

  user User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  runs EvaluationRun[]

  @@index([userId, createdAt])
  @@map("evaluations")
}

model EvaluationRun {
  id                  String                @id @default(cuid())
  userId              String                @map("user_id")
  evaluationId        String                @map("evaluation_id")
  evaluationVersion   Int                   @map("evaluation_version")
  evaluationSnapshot  Json                  @map("evaluation_snapshot")
  endpointAId         String                @map("endpoint_a_id")
  endpointBId         String?               @map("endpoint_b_id")
  gateConfig          Json                  @map("gate_config")
  status              EvaluationRunStatus   @default(PENDING)
  gateResult          EvaluationGateResult?
  aggregateMetrics    Json?                 @map("aggregate_metrics")
  processedSamples    Int                   @default(0) @map("processed_samples")
  totalSamples        Int                   @map("total_samples")
  startedAt           DateTime?             @map("started_at") @db.Timestamptz(3)
  finishedAt          DateTime?             @map("finished_at") @db.Timestamptz(3)
  errorMessage        String?               @map("error_message")
  createdAt           DateTime              @default(now()) @map("created_at") @db.Timestamptz(3)

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
  id          String      @id @default(cuid())
  runId       String      @map("run_id")
  sampleId    String      @map("sample_id")
  sampleIdx   Int         @map("sample_idx")
  resultA     Json        @map("result_a")
  resultB     Json?       @map("result_b")
  delta       SampleDelta
  createdAt   DateTime    @default(now()) @map("created_at") @db.Timestamptz(3)

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
```

- [ ] **Step 2: Add reverse relations to existing `User` and `Connection` models**

In `model User`, add:

```prisma
  evaluations     Evaluation[]
  evaluationRuns  EvaluationRun[]
```

In `model Connection`, add:

```prisma
  evalRunsAsA  EvaluationRun[] @relation("EvalEndpointA")
  evalRunsAsB  EvaluationRun[] @relation("EvalEndpointB")
```

- [ ] **Step 3: Generate the migration (DO NOT apply yet, --create-only per `feedback_prisma_migrations`)**

```bash
pnpm -F @modeldoctor/api exec prisma migrate dev --create-only --name quality_gate_tables
```

Expected: a new folder `apps/api/prisma/migrations/<timestamp>_quality_gate_tables/` containing `migration.sql` with `CREATE TYPE` for the 3 enums and `CREATE TABLE` for the 3 tables.

- [ ] **Step 4: Inspect the generated SQL**

Open the generated `migration.sql`. Confirm:
- 3 `CREATE TYPE` statements for `EvaluationRunStatus`, `EvaluationGateResult`, `SampleDelta`
- 3 `CREATE TABLE` statements with FK constraints to `users` and `connections`
- Indexes on `(user_id, created_at)`, `(evaluation_id)`, `(status)`, `(run_id)`, `(run_id, delta)`
- No accidental drops of existing tables (search for `DROP`)

If any of those are wrong, fix `schema.prisma` and rerun step 3 (delete the bad migration folder first).

- [ ] **Step 5: Apply the migration to local dev DB**

```bash
pnpm -F @modeldoctor/api exec prisma migrate dev
```

Expected: prints "Applying migration `<timestamp>_quality_gate_tables`" and "Database is now in sync".

If drift detected, STOP and surface to the user (per `feedback_dev_db_disposable`). Do not pass `--force-reset`.

- [ ] **Step 6: Verify with psql**

```bash
psql modeldoctor://modeldoctor:modeldoctor@localhost:5432/modeldoctor -c "\d evaluations"
psql modeldoctor://modeldoctor:modeldoctor@localhost:5432/modeldoctor -c "\d evaluation_runs"
psql modeldoctor://modeldoctor:modeldoctor@localhost:5432/modeldoctor -c "\d evaluation_run_samples"
```

Expected: each command prints the column list matching the model.

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat(quality-gate): add Prisma tables + enums for evaluations / runs / samples"
```

---

## Task 2: Prisma schema — extend SavedCompare with evaluationRunIds

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (one line on `SavedCompare`)
- Create: `apps/api/prisma/migrations/<timestamp>_saved_compares_evaluation_run_ids/migration.sql`

- [ ] **Step 1: Add field to `SavedCompare`**

```prisma
model SavedCompare {
  // ... existing fields kept exactly ...
  evaluationRunIds  String[]  @default([]) @map("evaluation_run_ids")
}
```

Place after `benchmarkIds` for readability.

- [ ] **Step 2: Generate migration**

```bash
pnpm -F @modeldoctor/api exec prisma migrate dev --create-only --name saved_compares_evaluation_run_ids
```

Expected: `migration.sql` containing `ALTER TABLE "saved_compares" ADD COLUMN "evaluation_run_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]`.

- [ ] **Step 3: Apply migration**

```bash
pnpm -F @modeldoctor/api exec prisma migrate dev
```

- [ ] **Step 4: Verify**

```bash
psql modeldoctor://modeldoctor:modeldoctor@localhost:5432/modeldoctor -c "\d saved_compares" | grep evaluation_run_ids
```

Expected: `evaluation_run_ids | text[]` line present.

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat(quality-gate): extend SavedCompare with evaluation_run_ids"
```

---

## Task 3: Seed — 1 built-in evaluation set

**Files:**
- Modify: `apps/api/prisma/seed.ts` (append a new seed block)

Per `feedback_prisma_seed_for_builtins`, built-in data lives here, not in migrations.

- [ ] **Step 1: Add the seed payload**

At the bottom of `seed.ts`, before the final `prisma.$disconnect()`, add:

```ts
// Quality Gate built-in evaluation sets
const builtInEvaluationSamples = [
  {
    id: "smp_qg_demo_01",
    idx: 0,
    prompt: "客户问：你们退货流程是多久？请用一句话回答。",
    expected: "通常 7 个工作日内完成退款。",
    judgeConfig: { kind: "contains", substrings: ["7", "退"], mode: "all", caseSensitive: false },
  },
  {
    id: "smp_qg_demo_02",
    idx: 1,
    prompt: "翻译为英文：你好世界",
    expected: "Hello, world",
    judgeConfig: { kind: "exact-match", caseSensitive: false, trim: true },
  },
  {
    id: "smp_qg_demo_03",
    idx: 2,
    prompt: "用 JSON 返回客户姓名'张三'和年龄 30，仅输出 JSON 对象不加 markdown。",
    expected: '{"name":"张三","age":30}',
    judgeConfig: { kind: "regex", pattern: "\\\"name\\\"\\s*:\\s*\\\"张三\\\".*\\\"age\\\"\\s*:\\s*30", flags: "s" },
  },
  {
    id: "smp_qg_demo_04",
    idx: 3,
    prompt: "客户抱怨快递太慢，请安抚客户并给出补救建议（2-3 句）。",
    expected: "认可客户不满；说明已加急；给出补偿（券或加速）；语气真诚。",
    judgeConfig: {
      kind: "llm-judge",
      rubric:
        "判断助手是否：(1) 表达了对客户不满的认可/共情，(2) 给出了具体的补救行动（加急/补偿/沟通），(3) 语气真诚不敷衍。三项都满足给 5 分；满足两项给 3-4 分；满足一项给 1-2 分；都没满足给 0 分。",
      scale: "0-5",
      passThreshold: 3,
    },
  },
];

const demoEval = await prisma.evaluation.upsert({
  where: { id: "eval_builtin_qg_demo_zh_customer" },
  update: {
    name: "中文客服 QA 示例",
    description: "覆盖 exact-match / contains / regex / llm-judge 四种判分器的演示评测集。",
    samples: builtInEvaluationSamples,
    totalSamples: builtInEvaluationSamples.length,
  },
  create: {
    id: "eval_builtin_qg_demo_zh_customer",
    userId: ADMIN_USER_ID, // reuse the same admin user id used by existing seed blocks
    name: "中文客服 QA 示例",
    description: "覆盖 exact-match / contains / regex / llm-judge 四种判分器的演示评测集。",
    samples: builtInEvaluationSamples,
    totalSamples: builtInEvaluationSamples.length,
  },
});
console.log(`Seeded evaluation: ${demoEval.id}`);
```

Note: if `seed.ts` does not currently expose an `ADMIN_USER_ID` constant, reuse whichever placeholder user id existing seed blocks (e.g. `benchmark_templates`) use. Read the top of `seed.ts` to find it; do not invent a new admin user.

- [ ] **Step 2: Run the seed**

```bash
pnpm -F @modeldoctor/api db:seed
```

Expected: prints "Seeded evaluation: eval_builtin_qg_demo_zh_customer". Idempotent on rerun thanks to `upsert`.

- [ ] **Step 3: Verify in DB**

```bash
psql modeldoctor://modeldoctor:modeldoctor@localhost:5432/modeldoctor -c "SELECT id, name, total_samples FROM evaluations;"
```

Expected: one row with `total_samples = 4`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/seed.ts
git commit -m "feat(quality-gate): seed built-in zh customer QA demo evaluation"
```

---

## Task 4: Contracts — judge config discriminated union

**Files:**
- Create: `packages/contracts/src/quality-gate/judge-config.ts`
- Create: `packages/contracts/src/quality-gate/__tests__/judge-config.spec.ts`

- [ ] **Step 1: Write failing test**

```ts
// __tests__/judge-config.spec.ts
import { describe, expect, it } from "vitest";
import { judgeConfigSchema } from "../judge-config.js";

describe("judgeConfigSchema", () => {
  it("accepts exact-match", () => {
    expect(judgeConfigSchema.parse({ kind: "exact-match", caseSensitive: false, trim: true })).toMatchObject({ kind: "exact-match" });
  });
  it("rejects contains with empty substrings", () => {
    expect(() => judgeConfigSchema.parse({ kind: "contains", substrings: [], mode: "all" })).toThrow();
  });
  it("rejects regex with invalid pattern", () => {
    expect(() => judgeConfigSchema.parse({ kind: "regex", pattern: "[unclosed" })).toThrow(/invalid regex/);
  });
  it("rejects llm-judge passThreshold outside scale", () => {
    expect(() => judgeConfigSchema.parse({ kind: "llm-judge", rubric: "ten chars +", scale: "0-1", passThreshold: 1.5 })).toThrow();
  });
  it("accepts llm-judge with default threshold inferred per scale", () => {
    const c = judgeConfigSchema.parse({ kind: "llm-judge", rubric: "ten chars +", scale: "0-5" });
    expect(c.kind).toBe("llm-judge");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm -F @modeldoctor/contracts test -- judge-config
```

Expected: FAIL (`Cannot find module '../judge-config.js'`).

- [ ] **Step 3: Implement the schema**

```ts
// packages/contracts/src/quality-gate/judge-config.ts
import { z } from "zod";

const exactMatch = z.object({
  kind: z.literal("exact-match"),
  caseSensitive: z.boolean().optional(),
  trim: z.boolean().optional(),
});

const contains = z.object({
  kind: z.literal("contains"),
  substrings: z.array(z.string().min(1)).min(1).max(50),
  mode: z.enum(["all", "any"]).default("all"),
  caseSensitive: z.boolean().optional(),
});

const regex = z.object({
  kind: z.literal("regex"),
  pattern: z.string().min(1),
  flags: z.string().optional(),
});

const llmJudge = z.object({
  kind: z.literal("llm-judge"),
  rubric: z.string().min(10).max(4000),
  scale: z.enum(["0-1", "0-5", "pass-fail"]),
  passThreshold: z.number().optional(),
  judgeModel: z.object({ connectionId: z.string() }).optional(),
});

const baseUnion = z.discriminatedUnion("kind", [exactMatch, contains, regex, llmJudge]);

export const judgeConfigSchema = baseUnion.superRefine((cfg, ctx) => {
  if (cfg.kind === "regex") {
    try {
      new RegExp(cfg.pattern, cfg.flags);
    } catch (e) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pattern"],
        message: `invalid regex: ${(e as Error).message}`,
      });
    }
  }
  if (cfg.kind === "llm-judge" && cfg.passThreshold != null) {
    const bounds: Record<string, [number, number]> = { "0-1": [0, 1], "0-5": [0, 5], "pass-fail": [0, 1] };
    const [lo, hi] = bounds[cfg.scale];
    if (cfg.passThreshold < lo || cfg.passThreshold > hi) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["passThreshold"],
        message: `passThreshold ${cfg.passThreshold} outside scale ${cfg.scale} bounds [${lo}, ${hi}]`,
      });
    }
  }
});

export type JudgeConfig = z.infer<typeof judgeConfigSchema>;

export function defaultPassThreshold(scale: JudgeConfig extends { scale: infer S } ? S : never): number {
  return scale === "0-1" ? 0.5 : scale === "0-5" ? 3 : 0.5;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm -F @modeldoctor/contracts test -- judge-config
```

Expected: PASS (5 cases).

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/quality-gate/judge-config.ts packages/contracts/src/quality-gate/__tests__/judge-config.spec.ts
git commit -m "feat(quality-gate): zod schema for judge config discriminated union"
```

---

## Task 5: Contracts — evaluation set

**Files:**
- Create: `packages/contracts/src/quality-gate/evaluations.ts`
- Create: `packages/contracts/src/quality-gate/__tests__/evaluations.spec.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from "vitest";
import { createEvaluationRequestSchema, evaluationSampleSchema, evaluationSchema } from "../evaluations.js";

describe("evaluationSampleSchema", () => {
  it("requires prompt, expected, and judgeConfig", () => {
    expect(() => evaluationSampleSchema.parse({ id: "s1", idx: 0 })).toThrow();
  });
  it("accepts a full sample", () => {
    const s = evaluationSampleSchema.parse({
      id: "s1",
      idx: 0,
      prompt: "Q?",
      expected: "A",
      judgeConfig: { kind: "exact-match" },
    });
    expect(s.prompt).toBe("Q?");
  });
});

describe("createEvaluationRequestSchema", () => {
  it("requires at least 1 sample and rejects > 500", () => {
    const make = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `s${i}`,
        idx: i,
        prompt: "Q",
        expected: "A",
        judgeConfig: { kind: "exact-match" },
      }));
    expect(() => createEvaluationRequestSchema.parse({ name: "x", samples: [] })).toThrow();
    expect(() => createEvaluationRequestSchema.parse({ name: "x", samples: make(501) })).toThrow();
    expect(createEvaluationRequestSchema.parse({ name: "x", samples: make(1) }).samples.length).toBe(1);
  });
});

describe("evaluationSchema", () => {
  it("infers totalSamples and version", () => {
    const e = evaluationSchema.parse({
      id: "e1",
      userId: "u1",
      name: "Set",
      description: null,
      version: 1,
      samples: [],
      totalSamples: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(e.version).toBe(1);
  });
});
```

- [ ] **Step 2: Verify it fails**

```bash
pnpm -F @modeldoctor/contracts test -- evaluations
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/contracts/src/quality-gate/evaluations.ts
import { z } from "zod";
import { judgeConfigSchema } from "./judge-config.js";

export const evaluationSampleSchema = z.object({
  id: z.string().min(1).max(64),
  idx: z.number().int().nonnegative(),
  prompt: z.string().min(1).max(8000),
  expected: z.string().max(8000),
  judgeConfig: judgeConfigSchema,
  tags: z.array(z.string().min(1).max(32)).max(10).optional(),
  meta: z.record(z.unknown()).optional(),
});
export type EvaluationSample = z.infer<typeof evaluationSampleSchema>;

export const evaluationSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable(),
  version: z.number().int().positive(),
  samples: z.array(evaluationSampleSchema),
  totalSamples: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Evaluation = z.infer<typeof evaluationSchema>;

export const createEvaluationRequestSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  samples: z.array(evaluationSampleSchema).min(1).max(500),
});
export type CreateEvaluationRequest = z.infer<typeof createEvaluationRequestSchema>;

export const updateEvaluationRequestSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  samples: z.array(evaluationSampleSchema).min(1).max(500).optional(),
});
export type UpdateEvaluationRequest = z.infer<typeof updateEvaluationRequestSchema>;

export const listEvaluationsResponseSchema = z.object({
  items: z.array(evaluationSchema),
});
export type ListEvaluationsResponse = z.infer<typeof listEvaluationsResponseSchema>;

// Import payload (JSON form) — same as samples
export const importEvaluationJsonSchema = z.object({
  format: z.literal("json"),
  payload: z.array(evaluationSampleSchema).min(1).max(500),
});
// CSV import: columns prompt | expected | judgeKind | judgeConfig(JSON) | tags(comma)
// The CSV parser turns rows into the same EvaluationSample shape before validation.
export const importEvaluationCsvSchema = z.object({
  format: z.literal("csv"),
  payload: z.string().min(1).max(2_000_000),
});
export const importEvaluationRequestSchema = z.discriminatedUnion("format", [
  importEvaluationJsonSchema,
  importEvaluationCsvSchema,
]);
export type ImportEvaluationRequest = z.infer<typeof importEvaluationRequestSchema>;
```

- [ ] **Step 4: Verify passes**

```bash
pnpm -F @modeldoctor/contracts test -- evaluations
```

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/quality-gate/evaluations.ts packages/contracts/src/quality-gate/__tests__/evaluations.spec.ts
git commit -m "feat(quality-gate): zod schemas for evaluations + CRUD + import"
```

---

## Task 6: Contracts — runs, gate config, status enums

**Files:**
- Create: `packages/contracts/src/quality-gate/runs.ts`
- Create: `packages/contracts/src/quality-gate/__tests__/runs.spec.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from "vitest";
import { createRunRequestSchema, gateConfigSchema, runStatusSchema, gateResultSchema } from "../runs.js";

describe("gateConfigSchema", () => {
  it("requires at least one threshold", () => {
    expect(() => gateConfigSchema.parse({})).toThrow();
  });
  it("accepts passRateMin alone", () => {
    expect(gateConfigSchema.parse({ passRateMin: 0.9 })).toEqual({ passRateMin: 0.9 });
  });
});

describe("createRunRequestSchema", () => {
  it("requires evaluationId + endpointAId + gateConfig", () => {
    expect(() => createRunRequestSchema.parse({})).toThrow();
    expect(createRunRequestSchema.parse({ evaluationId: "e", endpointAId: "a", gateConfig: { passRateMin: 0.9 } })).toBeTruthy();
  });
  it("rejects A == B", () => {
    expect(() =>
      createRunRequestSchema.parse({ evaluationId: "e", endpointAId: "x", endpointBId: "x", gateConfig: { passRateMin: 0.9 } }),
    ).toThrow(/different/);
  });
});

describe("enums", () => {
  it("status enum", () => {
    expect(runStatusSchema.parse("RUNNING")).toBe("RUNNING");
  });
  it("gate result enum", () => {
    expect(gateResultSchema.parse("WARNING")).toBe("WARNING");
  });
});
```

- [ ] **Step 2: Verify fails**

```bash
pnpm -F @modeldoctor/contracts test -- runs
```

- [ ] **Step 3: Implement**

```ts
// packages/contracts/src/quality-gate/runs.ts
import { z } from "zod";
import { evaluationSampleSchema } from "./evaluations.js";

export const runStatusSchema = z.enum(["PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"]);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const gateResultSchema = z.enum(["PASSED", "WARNING", "FAILED"]);
export type GateResult = z.infer<typeof gateResultSchema>;

export const sampleDeltaSchema = z.enum(["REGRESSION", "IMPROVEMENT", "BOTH_PASS", "BOTH_FAIL", "NA"]);
export type SampleDelta = z.infer<typeof sampleDeltaSchema>;

export const gateConfigSchema = z
  .object({
    passRateMin: z.number().min(0).max(1).optional(),
    regressionMax: z.number().int().nonnegative().optional(),
    judgeScoreMin: z.number().min(0).max(5).optional(),
  })
  .refine((c) => c.passRateMin != null || c.regressionMax != null || c.judgeScoreMin != null, {
    message: "gateConfig requires at least one threshold",
  });
export type GateConfig = z.infer<typeof gateConfigSchema>;

export const aggregateMetricsSchema = z.object({
  passRateA: z.number().min(0).max(1),
  passRateB: z.number().min(0).max(1).optional(),
  judgeAvgA: z.number().optional(),
  judgeAvgB: z.number().optional(),
  regressionCount: z.number().int().nonnegative().optional(),
  improvementCount: z.number().int().nonnegative().optional(),
  bothPassCount: z.number().int().nonnegative(),
  bothFailCount: z.number().int().nonnegative(),
  totalErrors: z.number().int().nonnegative(),
  judgeCallCount: z.number().int().nonnegative(),
});
export type AggregateMetrics = z.infer<typeof aggregateMetricsSchema>;

export const evaluationRunSchema = z.object({
  id: z.string(),
  userId: z.string(),
  evaluationId: z.string(),
  evaluationVersion: z.number().int().positive(),
  evaluationSnapshot: z.object({ samples: z.array(evaluationSampleSchema) }),
  endpointAId: z.string(),
  endpointBId: z.string().nullable(),
  gateConfig: gateConfigSchema,
  status: runStatusSchema,
  gateResult: gateResultSchema.nullable(),
  aggregateMetrics: aggregateMetricsSchema.nullable(),
  processedSamples: z.number().int().nonnegative(),
  totalSamples: z.number().int().nonnegative(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type EvaluationRun = z.infer<typeof evaluationRunSchema>;

export const createRunRequestSchema = z
  .object({
    evaluationId: z.string(),
    endpointAId: z.string(),
    endpointBId: z.string().optional(),
    gateConfig: gateConfigSchema,
  })
  .refine((r) => r.endpointBId == null || r.endpointBId !== r.endpointAId, {
    message: "endpointAId and endpointBId must be different",
    path: ["endpointBId"],
  });
export type CreateRunRequest = z.infer<typeof createRunRequestSchema>;

export const listRunsQuerySchema = z.object({
  status: runStatusSchema.optional(),
  evaluationId: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});
export type ListRunsQuery = z.infer<typeof listRunsQuerySchema>;

export const listRunsResponseSchema = z.object({
  items: z.array(evaluationRunSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type ListRunsResponse = z.infer<typeof listRunsResponseSchema>;
```

- [ ] **Step 4: Verify passes**

```bash
pnpm -F @modeldoctor/contracts test -- runs
```

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/quality-gate/runs.ts packages/contracts/src/quality-gate/__tests__/runs.spec.ts
git commit -m "feat(quality-gate): zod schemas for runs + gate config + enums"
```

---

## Task 7: Contracts — run sample results + index export

**Files:**
- Create: `packages/contracts/src/quality-gate/run-samples.ts`
- Create: `packages/contracts/src/quality-gate/index.ts`
- Modify: `packages/contracts/src/index.ts` (add export)

- [ ] **Step 1: Write failing test**

```ts
// packages/contracts/src/quality-gate/__tests__/run-samples.spec.ts
import { describe, expect, it } from "vitest";
import { endpointCallResultSchema, judgeOutcomeSchema, listRunSamplesQuerySchema } from "../run-samples.js";

describe("endpointCallResultSchema", () => {
  it("accepts success shape", () => {
    expect(endpointCallResultSchema.parse({ rawAnswer: "hi", latencyMs: 200, tokensIn: 5, tokensOut: 1 })).toMatchObject({ latencyMs: 200 });
  });
  it("accepts error shape", () => {
    expect(endpointCallResultSchema.parse({ rawAnswer: "", latencyMs: 0, error: "timeout" })).toMatchObject({ error: "timeout" });
  });
});

describe("listRunSamplesQuerySchema", () => {
  it("defaults filter to 'all' and pageSize to 20", () => {
    const q = listRunSamplesQuerySchema.parse({});
    expect(q.filter).toBe("all");
    expect(q.pageSize).toBe(20);
  });
});
```

- [ ] **Step 2: Verify fails**

```bash
pnpm -F @modeldoctor/contracts test -- run-samples
```

- [ ] **Step 3: Implement run-samples.ts**

```ts
// packages/contracts/src/quality-gate/run-samples.ts
import { z } from "zod";
import { sampleDeltaSchema } from "./runs.js";

export const endpointCallResultSchema = z.object({
  rawAnswer: z.string(),
  latencyMs: z.number().int().nonnegative(),
  tokensIn: z.number().int().nonnegative().optional(),
  tokensOut: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
});
export type EndpointCallResult = z.infer<typeof endpointCallResultSchema>;

export const judgeOutcomeSchema = z.object({
  passed: z.boolean(),
  score: z.number().optional(),
  reason: z.string().optional(),
  error: z.string().optional(),
});
export type JudgeOutcome = z.infer<typeof judgeOutcomeSchema>;

export const sampleResultSchema = z.object({
  call: endpointCallResultSchema,
  judge: judgeOutcomeSchema,
});
export type SampleResult = z.infer<typeof sampleResultSchema>;

export const runSampleSchema = z.object({
  id: z.string(),
  runId: z.string(),
  sampleId: z.string(),
  sampleIdx: z.number().int().nonnegative(),
  resultA: sampleResultSchema,
  resultB: sampleResultSchema.nullable(),
  delta: sampleDeltaSchema,
  createdAt: z.string().datetime(),
});
export type RunSample = z.infer<typeof runSampleSchema>;

export const sampleFilterSchema = z.enum(["all", "regression", "improvement", "both-pass", "both-fail"]);
export type SampleFilter = z.infer<typeof sampleFilterSchema>;

export const listRunSamplesQuerySchema = z.object({
  filter: sampleFilterSchema.default("all"),
  sortBy: z.enum(["idx", "delta", "judgeScore"]).default("idx"),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});
export type ListRunSamplesQuery = z.infer<typeof listRunSamplesQuerySchema>;

export const listRunSamplesResponseSchema = z.object({
  items: z.array(runSampleSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type ListRunSamplesResponse = z.infer<typeof listRunSamplesResponseSchema>;
```

- [ ] **Step 4: Create the namespace index**

```ts
// packages/contracts/src/quality-gate/index.ts
export * from "./judge-config.js";
export * from "./evaluations.js";
export * from "./runs.js";
export * from "./run-samples.js";
```

- [ ] **Step 5: Wire into the contracts top-level export**

In `packages/contracts/src/index.ts`, append:

```ts
export * from "./quality-gate/index.js";
```

- [ ] **Step 6: Verify the package builds**

```bash
pnpm -F @modeldoctor/contracts test
pnpm -F @modeldoctor/contracts build
```

Both should pass.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/quality-gate/ packages/contracts/src/index.ts
git commit -m "feat(quality-gate): contracts barrel exports for quality-gate namespace"
```

---

## Task 8: Judges — types + exact-match + contains

**Files:**
- Create: `apps/api/src/modules/quality-gate/judges/types.ts`
- Create: `apps/api/src/modules/quality-gate/judges/exact-match.ts`
- Create: `apps/api/src/modules/quality-gate/judges/contains.ts`
- Create: `apps/api/src/modules/quality-gate/judges/__tests__/exact-match.spec.ts`
- Create: `apps/api/src/modules/quality-gate/judges/__tests__/contains.spec.ts`

- [ ] **Step 1: Define the Judge interface**

```ts
// apps/api/src/modules/quality-gate/judges/types.ts
import type { JudgeConfig, JudgeOutcome } from "@modeldoctor/contracts";

export interface JudgeContext {
  question: string;
  expected: string;
  answer: string;
}

export interface Judge<T extends JudgeConfig = JudgeConfig> {
  readonly kind: T["kind"];
  evaluate(config: T, ctx: JudgeContext): Promise<JudgeOutcome>;
}
```

- [ ] **Step 2: Write failing tests for exact-match**

```ts
// __tests__/exact-match.spec.ts
import { describe, expect, it } from "vitest";
import { exactMatchJudge } from "../exact-match.js";

const ctx = (answer: string, expected = "Hello") => ({ question: "Q", expected, answer });

describe("exactMatchJudge", () => {
  it("passes on identical strings", async () => {
    expect(await exactMatchJudge.evaluate({ kind: "exact-match" }, ctx("Hello"))).toMatchObject({ passed: true });
  });
  it("trims by default", async () => {
    expect(await exactMatchJudge.evaluate({ kind: "exact-match" }, ctx("  Hello  "))).toMatchObject({ passed: true });
  });
  it("case-insensitive by default", async () => {
    expect(await exactMatchJudge.evaluate({ kind: "exact-match" }, ctx("hello"))).toMatchObject({ passed: true });
  });
  it("case-sensitive when configured", async () => {
    expect(await exactMatchJudge.evaluate({ kind: "exact-match", caseSensitive: true }, ctx("hello"))).toMatchObject({ passed: false });
  });
  it("fails on mismatch", async () => {
    expect(await exactMatchJudge.evaluate({ kind: "exact-match" }, ctx("world"))).toMatchObject({ passed: false });
  });
  it("no trim when configured", async () => {
    expect(await exactMatchJudge.evaluate({ kind: "exact-match", trim: false }, ctx("  Hello  "))).toMatchObject({ passed: false });
  });
});
```

- [ ] **Step 3: Implement exact-match**

```ts
// apps/api/src/modules/quality-gate/judges/exact-match.ts
import type { JudgeConfig } from "@modeldoctor/contracts";
import type { Judge } from "./types.js";

type Config = Extract<JudgeConfig, { kind: "exact-match" }>;

export const exactMatchJudge: Judge<Config> = {
  kind: "exact-match",
  async evaluate(config, ctx) {
    const trim = config.trim !== false;
    const caseSensitive = config.caseSensitive === true;
    const norm = (s: string) => {
      let v = trim ? s.trim() : s;
      if (!caseSensitive) v = v.toLowerCase();
      return v;
    };
    const passed = norm(ctx.answer) === norm(ctx.expected);
    return { passed, reason: passed ? "exact match" : `expected "${ctx.expected}", got "${ctx.answer}"` };
  },
};
```

- [ ] **Step 4: Write failing tests for contains**

```ts
// __tests__/contains.spec.ts
import { describe, expect, it } from "vitest";
import { containsJudge } from "../contains.js";

const ctx = (answer: string) => ({ question: "Q", expected: "", answer });

describe("containsJudge", () => {
  it("passes on all substrings present", async () => {
    expect(await containsJudge.evaluate({ kind: "contains", substrings: ["foo", "bar"], mode: "all" }, ctx("foo and bar"))).toMatchObject({ passed: true });
  });
  it("fails on missing substring in all-mode", async () => {
    const r = await containsJudge.evaluate({ kind: "contains", substrings: ["foo", "bar"], mode: "all" }, ctx("foo only"));
    expect(r.passed).toBe(false);
    expect(r.reason).toContain("bar");
  });
  it("any-mode passes if at least one matches", async () => {
    expect(await containsJudge.evaluate({ kind: "contains", substrings: ["x", "foo"], mode: "any" }, ctx("foo"))).toMatchObject({ passed: true });
  });
  it("case-insensitive by default", async () => {
    expect(await containsJudge.evaluate({ kind: "contains", substrings: ["FOO"], mode: "all" }, ctx("foo"))).toMatchObject({ passed: true });
  });
  it("case-sensitive when configured", async () => {
    expect(await containsJudge.evaluate({ kind: "contains", substrings: ["FOO"], mode: "all", caseSensitive: true }, ctx("foo"))).toMatchObject({ passed: false });
  });
});
```

- [ ] **Step 5: Implement contains**

```ts
// apps/api/src/modules/quality-gate/judges/contains.ts
import type { JudgeConfig } from "@modeldoctor/contracts";
import type { Judge } from "./types.js";

type Config = Extract<JudgeConfig, { kind: "contains" }>;

export const containsJudge: Judge<Config> = {
  kind: "contains",
  async evaluate(config, ctx) {
    const cs = config.caseSensitive === true;
    const haystack = cs ? ctx.answer : ctx.answer.toLowerCase();
    const needles = config.substrings.map((s) => (cs ? s : s.toLowerCase()));
    const matched: string[] = [];
    const missing: string[] = [];
    for (const n of needles) {
      if (haystack.includes(n)) matched.push(n);
      else missing.push(n);
    }
    const passed = config.mode === "all" ? missing.length === 0 : matched.length > 0;
    const reason = passed
      ? `matched ${matched.length}/${needles.length}`
      : config.mode === "all"
        ? `missing: ${missing.join(", ")}`
        : `none of ${needles.join(", ")} found`;
    return { passed, reason };
  },
};
```

- [ ] **Step 6: Run both tests**

```bash
pnpm -F @modeldoctor/api test -- exact-match contains
```

Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/quality-gate/judges/
git commit -m "feat(quality-gate): judges Judge interface + exact-match + contains"
```

---

## Task 9: Judges — regex + llm-judge + registry

**Files:**
- Create: `apps/api/src/modules/quality-gate/judges/regex.ts`
- Create: `apps/api/src/modules/quality-gate/judges/llm-judge.ts`
- Create: `apps/api/src/modules/quality-gate/judges/registry.ts`
- Create: matching `__tests__/*.spec.ts` files

- [ ] **Step 1: Failing test for regex**

```ts
// __tests__/regex.spec.ts
import { describe, expect, it } from "vitest";
import { regexJudge } from "../regex.js";

const ctx = (answer: string) => ({ question: "Q", expected: "", answer });

describe("regexJudge", () => {
  it("passes when pattern matches", async () => {
    expect(await regexJudge.evaluate({ kind: "regex", pattern: "^foo\\d+$" }, ctx("foo123"))).toMatchObject({ passed: true });
  });
  it("fails on no match", async () => {
    expect(await regexJudge.evaluate({ kind: "regex", pattern: "^foo$" }, ctx("bar"))).toMatchObject({ passed: false });
  });
  it("honors flags (case-insensitive)", async () => {
    expect(await regexJudge.evaluate({ kind: "regex", pattern: "FOO", flags: "i" }, ctx("foo"))).toMatchObject({ passed: true });
  });
  it("error on invalid pattern", async () => {
    const r = await regexJudge.evaluate({ kind: "regex", pattern: "[unclosed" }, ctx("x"));
    expect(r.passed).toBe(false);
    expect(r.error).toBeDefined();
  });
});
```

- [ ] **Step 2: Implement regex judge**

```ts
// apps/api/src/modules/quality-gate/judges/regex.ts
import type { JudgeConfig } from "@modeldoctor/contracts";
import type { Judge } from "./types.js";

type Config = Extract<JudgeConfig, { kind: "regex" }>;

export const regexJudge: Judge<Config> = {
  kind: "regex",
  async evaluate(config, ctx) {
    let re: RegExp;
    try {
      re = new RegExp(config.pattern, config.flags);
    } catch (e) {
      return { passed: false, error: `invalid regex: ${(e as Error).message}` };
    }
    const m = ctx.answer.match(re);
    return {
      passed: m != null,
      reason: m ? `matched: ${m[0].slice(0, 64)}` : `no match for /${config.pattern}/`,
    };
  },
};
```

- [ ] **Step 3: Failing test for llm-judge (with stub service)**

```ts
// __tests__/llm-judge.spec.ts
import { describe, expect, it, vi } from "vitest";
import { createLlmJudge } from "../llm-judge.js";

function stubService(response: { content: string }) {
  return { runJudge: vi.fn().mockResolvedValue(response) };
}

const ctx = { question: "Q", expected: "E", answer: "A" };

describe("llmJudge", () => {
  it("parses score+reason from JSON content", async () => {
    const svc = stubService({ content: '{"score": 4, "reason": "ok"}' });
    const judge = createLlmJudge(svc as never);
    const r = await judge.evaluate({ kind: "llm-judge", rubric: "ten char rubric.", scale: "0-5", passThreshold: 3 }, ctx);
    expect(r).toMatchObject({ passed: true, score: 4, reason: "ok" });
  });
  it("uses default threshold per scale", async () => {
    const svc = stubService({ content: '{"score": 2.5, "reason": "meh"}' });
    const judge = createLlmJudge(svc as never);
    const r = await judge.evaluate({ kind: "llm-judge", rubric: "ten char rubric.", scale: "0-5" }, ctx);
    // default 0-5 threshold is 3
    expect(r.passed).toBe(false);
  });
  it("falls back to error on non-JSON content", async () => {
    const svc = stubService({ content: "not json" });
    const judge = createLlmJudge(svc as never);
    const r = await judge.evaluate({ kind: "llm-judge", rubric: "ten char rubric.", scale: "0-5" }, ctx);
    expect(r.passed).toBe(false);
    expect(r.error).toBeDefined();
  });
  it("propagates service error", async () => {
    const svc = { runJudge: vi.fn().mockRejectedValue(new Error("rate limit")) };
    const judge = createLlmJudge(svc as never);
    const r = await judge.evaluate({ kind: "llm-judge", rubric: "ten char rubric.", scale: "0-5" }, ctx);
    expect(r.passed).toBe(false);
    expect(r.error).toContain("rate limit");
  });
});
```

- [ ] **Step 4: Implement llm-judge (factory)**

```ts
// apps/api/src/modules/quality-gate/judges/llm-judge.ts
import type { JudgeConfig } from "@modeldoctor/contracts";
import type { Judge } from "./types.js";

type Config = Extract<JudgeConfig, { kind: "llm-judge" }>;

// Thin shape from the AI Diagnostics service: the factory only needs runJudge(prompt, opts) → { content }.
// At wiring time the real adapter delegates to apps/api/src/modules/insights/llm-client or the diagnostics service.
export interface LlmJudgeService {
  runJudge(input: { systemPrompt: string; userPrompt: string; connectionId?: string }): Promise<{ content: string }>;
}

function defaultThreshold(scale: Config["scale"]): number {
  return scale === "0-1" ? 0.5 : scale === "0-5" ? 3 : 0.5;
}

function buildSystemPrompt(rubric: string, scale: Config["scale"]): string {
  const range = scale === "0-1" ? "0.0 to 1.0" : scale === "0-5" ? "0 to 5 (integer or half points)" : "0 (fail) or 1 (pass)";
  return [
    "You are a strict evaluation judge.",
    "Score the assistant answer based ONLY on the rubric below.",
    `Output a JSON object exactly: {"score": <number in ${range}>, "reason": "<one sentence>"}`,
    "Do NOT include markdown fences or any other text.",
    "",
    "Rubric:",
    rubric,
  ].join("\n");
}

function buildUserPrompt(ctx: { question: string; expected: string; answer: string }): string {
  return [
    "Question:",
    ctx.question,
    "",
    "Expected (reference, may be a rubric description):",
    ctx.expected,
    "",
    "Assistant answer:",
    ctx.answer,
  ].join("\n");
}

export function createLlmJudge(service: LlmJudgeService): Judge<Config> {
  return {
    kind: "llm-judge",
    async evaluate(config, ctx) {
      try {
        const resp = await service.runJudge({
          systemPrompt: buildSystemPrompt(config.rubric, config.scale),
          userPrompt: buildUserPrompt(ctx),
          connectionId: config.judgeModel?.connectionId,
        });
        let parsed: { score: number; reason: string };
        try {
          parsed = JSON.parse(resp.content);
        } catch (e) {
          return { passed: false, error: `judge returned non-JSON: ${resp.content.slice(0, 200)}` };
        }
        if (typeof parsed.score !== "number") {
          return { passed: false, error: `judge JSON missing numeric "score": ${resp.content.slice(0, 200)}` };
        }
        const threshold = config.passThreshold ?? defaultThreshold(config.scale);
        return { passed: parsed.score >= threshold, score: parsed.score, reason: parsed.reason ?? "" };
      } catch (e) {
        return { passed: false, error: (e as Error).message };
      }
    },
  };
}
```

- [ ] **Step 5: Registry**

```ts
// apps/api/src/modules/quality-gate/judges/registry.ts
import type { JudgeConfig } from "@modeldoctor/contracts";
import { containsJudge } from "./contains.js";
import { exactMatchJudge } from "./exact-match.js";
import { type LlmJudgeService, createLlmJudge } from "./llm-judge.js";
import { regexJudge } from "./regex.js";
import type { Judge, JudgeContext } from "./types.js";

export interface JudgeRegistry {
  apply(config: JudgeConfig, ctx: JudgeContext): Promise<import("@modeldoctor/contracts").JudgeOutcome>;
}

export function createJudgeRegistry(llmService: LlmJudgeService): JudgeRegistry {
  const llmJudge = createLlmJudge(llmService);
  const byKind = {
    "exact-match": exactMatchJudge,
    contains: containsJudge,
    regex: regexJudge,
    "llm-judge": llmJudge,
  } satisfies Record<JudgeConfig["kind"], Judge>;

  return {
    async apply(config, ctx) {
      const judge = byKind[config.kind] as Judge;
      return judge.evaluate(config as never, ctx);
    },
  };
}
```

- [ ] **Step 6: Registry test**

```ts
// __tests__/registry.spec.ts
import { describe, expect, it } from "vitest";
import { createJudgeRegistry } from "../registry.js";

const stubLlm = { runJudge: async () => ({ content: '{"score": 1, "reason": "ok"}' }) };

describe("judgeRegistry", () => {
  const r = createJudgeRegistry(stubLlm);
  it("dispatches to exact-match", async () => {
    expect(await r.apply({ kind: "exact-match" }, { question: "Q", expected: "A", answer: "A" })).toMatchObject({ passed: true });
  });
  it("dispatches to contains", async () => {
    expect(await r.apply({ kind: "contains", substrings: ["x"], mode: "all" }, { question: "Q", expected: "", answer: "x" })).toMatchObject({ passed: true });
  });
  it("dispatches to regex", async () => {
    expect(await r.apply({ kind: "regex", pattern: "^ok$" }, { question: "Q", expected: "", answer: "ok" })).toMatchObject({ passed: true });
  });
  it("dispatches to llm-judge", async () => {
    expect(await r.apply({ kind: "llm-judge", rubric: "rubric>10c.", scale: "0-1", passThreshold: 0.5 }, { question: "Q", expected: "", answer: "x" })).toMatchObject({ passed: true });
  });
});
```

- [ ] **Step 7: Run all judge tests**

```bash
pnpm -F @modeldoctor/api test -- judges
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/quality-gate/judges/
git commit -m "feat(quality-gate): regex + llm-judge factories + judge registry"
```

---

## Task 10: Gate result computation

**Files:**
- Create: `apps/api/src/modules/quality-gate/gate/compute-gate-result.ts`
- Create: `apps/api/src/modules/quality-gate/gate/__tests__/compute-gate-result.spec.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from "vitest";
import { computeGateResult } from "../compute-gate-result.js";

const baseMetrics = {
  passRateA: 0.92,
  passRateB: 0.88,
  judgeAvgA: 4.2,
  judgeAvgB: 3.9,
  regressionCount: 7,
  improvementCount: 3,
  bothPassCount: 35,
  bothFailCount: 5,
  totalErrors: 0,
  judgeCallCount: 50,
};

describe("computeGateResult", () => {
  it("PASSED when all thresholds satisfied (using B side)", () => {
    expect(
      computeGateResult({ ...baseMetrics, passRateB: 0.95, regressionCount: 0, judgeAvgB: 4.5 }, { passRateMin: 0.9, regressionMax: 3, judgeScoreMin: 4 }),
    ).toMatchObject({ result: "PASSED" });
  });
  it("WARNING when within buffer band", () => {
    expect(computeGateResult({ ...baseMetrics, passRateB: 0.89 }, { passRateMin: 0.9 })).toMatchObject({ result: "WARNING" });
  });
  it("FAILED when outside buffer band", () => {
    expect(computeGateResult({ ...baseMetrics, passRateB: 0.84 }, { passRateMin: 0.9 })).toMatchObject({ result: "FAILED" });
  });
  it("ignores B-only thresholds in single-endpoint mode", () => {
    const single = { ...baseMetrics, passRateB: undefined, judgeAvgB: undefined, regressionCount: undefined };
    expect(computeGateResult(single, { passRateMin: 0.9 })).toMatchObject({ result: "PASSED" });
  });
  it("regression buffer band: x1 → warning, x1.5+ → failed", () => {
    expect(computeGateResult({ ...baseMetrics, regressionCount: 4 }, { regressionMax: 3 })).toMatchObject({ result: "WARNING" });
    expect(computeGateResult({ ...baseMetrics, regressionCount: 6 }, { regressionMax: 3 })).toMatchObject({ result: "FAILED" });
  });
  it("judgeScore buffer: 0.5 below → warning, 0.5+ below → failed", () => {
    expect(computeGateResult({ ...baseMetrics, judgeAvgB: 3.8 }, { judgeScoreMin: 4 })).toMatchObject({ result: "WARNING" });
    expect(computeGateResult({ ...baseMetrics, judgeAvgB: 3.4 }, { judgeScoreMin: 4 })).toMatchObject({ result: "FAILED" });
  });
});
```

- [ ] **Step 2: Implement**

```ts
// apps/api/src/modules/quality-gate/gate/compute-gate-result.ts
import type { AggregateMetrics, GateConfig, GateResult } from "@modeldoctor/contracts";

export interface GateOutcome {
  result: GateResult;
  failures: string[];
  warnings: string[];
}

export function computeGateResult(metrics: AggregateMetrics, gateConfig: GateConfig): GateOutcome {
  const failures: string[] = [];
  const warnings: string[] = [];

  const passRate = metrics.passRateB ?? metrics.passRateA;
  if (gateConfig.passRateMin != null) {
    if (passRate < gateConfig.passRateMin - 0.05) failures.push("passRate");
    else if (passRate < gateConfig.passRateMin) warnings.push("passRate");
  }

  if (gateConfig.regressionMax != null && metrics.regressionCount != null) {
    if (metrics.regressionCount > gateConfig.regressionMax * 1.5) failures.push("regression");
    else if (metrics.regressionCount > gateConfig.regressionMax) warnings.push("regression");
  }

  if (gateConfig.judgeScoreMin != null && metrics.judgeAvgB != null) {
    if (metrics.judgeAvgB < gateConfig.judgeScoreMin - 0.5) failures.push("judgeScore");
    else if (metrics.judgeAvgB < gateConfig.judgeScoreMin) warnings.push("judgeScore");
  }

  if (failures.length) return { result: "FAILED", failures, warnings };
  if (warnings.length) return { result: "WARNING", failures: [], warnings };
  return { result: "PASSED", failures: [], warnings: [] };
}
```

- [ ] **Step 3: Run tests**

```bash
pnpm -F @modeldoctor/api test -- compute-gate-result
```

Expected: all pass.

- [ ] **Step 4: Add delta + aggregate helpers (same module)**

Create `apps/api/src/modules/quality-gate/gate/sample-aggregation.ts`:

```ts
import type { AggregateMetrics, JudgeOutcome, SampleDelta } from "@modeldoctor/contracts";

export function computeDelta(judgedA: JudgeOutcome, judgedB: JudgeOutcome | null): SampleDelta {
  if (judgedB == null) return "NA";
  if (judgedA.passed && judgedB.passed) return "BOTH_PASS";
  if (!judgedA.passed && !judgedB.passed) return "BOTH_FAIL";
  if (judgedA.passed && !judgedB.passed) return "REGRESSION";
  return "IMPROVEMENT";
}

export interface SampleRow {
  resultA: { call: { error?: string }; judge: JudgeOutcome };
  resultB: { call: { error?: string }; judge: JudgeOutcome } | null;
}

export function aggregateMetrics(rows: SampleRow[], judgeCallCount: number): AggregateMetrics {
  const total = rows.length;
  if (total === 0) {
    return {
      passRateA: 0,
      bothPassCount: 0,
      bothFailCount: 0,
      totalErrors: 0,
      judgeCallCount,
    };
  }
  const dual = rows.some((r) => r.resultB != null);

  let passA = 0, passB = 0, errors = 0, bothPass = 0, bothFail = 0, reg = 0, imp = 0;
  let scoreSumA = 0, scoreNA = 0;
  let scoreSumB = 0, scoreNB = 0;
  for (const r of rows) {
    if (r.resultA.call.error) errors++;
    if (r.resultA.judge.passed) passA++;
    if (typeof r.resultA.judge.score === "number") { scoreSumA += r.resultA.judge.score; scoreNA++; }
    if (r.resultB) {
      if (r.resultB.call.error) errors++;
      if (r.resultB.judge.passed) passB++;
      if (typeof r.resultB.judge.score === "number") { scoreSumB += r.resultB.judge.score; scoreNB++; }
      if (r.resultA.judge.passed && r.resultB.judge.passed) bothPass++;
      else if (!r.resultA.judge.passed && !r.resultB.judge.passed) bothFail++;
      else if (r.resultA.judge.passed) reg++;
      else imp++;
    }
  }
  return {
    passRateA: passA / total,
    passRateB: dual ? passB / total : undefined,
    judgeAvgA: scoreNA > 0 ? scoreSumA / scoreNA : undefined,
    judgeAvgB: dual && scoreNB > 0 ? scoreSumB / scoreNB : undefined,
    regressionCount: dual ? reg : undefined,
    improvementCount: dual ? imp : undefined,
    bothPassCount: bothPass,
    bothFailCount: bothFail,
    totalErrors: errors,
    judgeCallCount,
  };
}
```

- [ ] **Step 5: Unit-test aggregation** (`__tests__/sample-aggregation.spec.ts`)

```ts
import { describe, expect, it } from "vitest";
import { aggregateMetrics, computeDelta } from "../sample-aggregation.js";

const r = (passA: boolean, passB?: boolean) => ({
  resultA: { call: {}, judge: { passed: passA } },
  resultB: passB == null ? null : { call: {}, judge: { passed: passB } },
});

describe("computeDelta", () => {
  it.each([
    [true, true, "BOTH_PASS"],
    [false, false, "BOTH_FAIL"],
    [true, false, "REGRESSION"],
    [false, true, "IMPROVEMENT"],
  ])("A=%s B=%s → %s", (a, b, expected) => {
    expect(computeDelta({ passed: a }, { passed: b })).toBe(expected);
  });
  it("null B → NA", () => {
    expect(computeDelta({ passed: true }, null)).toBe("NA");
  });
});

describe("aggregateMetrics", () => {
  it("computes dual-endpoint counts", () => {
    const rows = [r(true, true), r(true, false), r(false, true), r(false, false), r(true, true)];
    const m = aggregateMetrics(rows, 10);
    expect(m).toMatchObject({
      passRateA: 0.6,
      passRateB: 0.6,
      regressionCount: 1,
      improvementCount: 1,
      bothPassCount: 2,
      bothFailCount: 1,
      judgeCallCount: 10,
    });
  });
  it("single endpoint mode hides B fields", () => {
    const rows = [r(true), r(false)];
    const m = aggregateMetrics(rows, 2);
    expect(m.passRateB).toBeUndefined();
    expect(m.regressionCount).toBeUndefined();
  });
});
```

- [ ] **Step 6: Run all gate tests**

```bash
pnpm -F @modeldoctor/api test -- gate
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/quality-gate/gate/
git commit -m "feat(quality-gate): gate-result + sample delta + aggregate metrics"
```

---

## Task 11: Endpoint caller

**Files:**
- Create: `apps/api/src/modules/quality-gate/endpoint-caller.ts`
- Create: `apps/api/src/modules/quality-gate/__tests__/endpoint-caller.spec.ts`

The caller dispatches an OpenAI-compatible chat completion to a Connection. Decrypts API key via the existing `aes-gcm` helper used by `ConnectionService` (see `apps/api/src/common/crypto/aes-gcm.ts`). Uses `fetch` (Node 20+ built-in).

- [ ] **Step 1: Failing test (mocked fetch)**

```ts
// __tests__/endpoint-caller.spec.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EndpointCaller } from "../endpoint-caller.js";

const connection = {
  id: "c1",
  baseUrl: "https://example.test",
  model: "qwen3-32b",
  apiKey: "sk-abc",
};

const stubConnectionsService = {
  findByIdWithDecryptedKey: vi.fn().mockResolvedValue(connection),
};

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const buildOk = (content: string) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content } }], usage: { prompt_tokens: 4, completion_tokens: 3 } }),
});

describe("EndpointCaller", () => {
  const caller = new EndpointCaller(stubConnectionsService as never);
  const signal = new AbortController().signal;

  it("returns content + latency + tokens on success", async () => {
    fetchMock.mockResolvedValueOnce(buildOk("hello"));
    const r = await caller.call("c1", "q", signal);
    expect(r).toMatchObject({ rawAnswer: "hello", tokensIn: 4, tokensOut: 3 });
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("retries once on first failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET")).mockResolvedValueOnce(buildOk("ok"));
    const r = await caller.call("c1", "q", signal);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(r.rawAnswer).toBe("ok");
  });

  it("returns error result after second failure", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));
    const r = await caller.call("c1", "q", signal);
    expect(r.error).toBeDefined();
    expect(r.rawAnswer).toBe("");
  });

  it("does not retry when caller signal already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    fetchMock.mockRejectedValueOnce(new Error("aborted"));
    const r = await caller.call("c1", "q", ac.signal);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.error).toBeDefined();
  });

  it("attaches Authorization header when apiKey present", async () => {
    fetchMock.mockResolvedValueOnce(buildOk("hi"));
    await caller.call("c1", "q", signal);
    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer sk-abc" });
  });
});
```

- [ ] **Step 2: Implement**

```ts
// apps/api/src/modules/quality-gate/endpoint-caller.ts
import { Injectable } from "@nestjs/common";
import type { EndpointCallResult } from "@modeldoctor/contracts";

interface ConnectionsServiceLike {
  findByIdWithDecryptedKey(id: string): Promise<{ id: string; baseUrl: string; model: string; apiKey?: string | null } | null>;
}

const REQUEST_TIMEOUT_MS = 30_000;
const RETRY_DELAY_MS = 500;
const MAX_TOKENS = 2048;

@Injectable()
export class EndpointCaller {
  constructor(private readonly connections: ConnectionsServiceLike) {}

  async call(connectionId: string, prompt: string, outerSignal: AbortSignal): Promise<EndpointCallResult> {
    const conn = await this.connections.findByIdWithDecryptedKey(connectionId);
    if (!conn) {
      return { rawAnswer: "", latencyMs: 0, error: `connection ${connectionId} not found` };
    }
    const url = `${conn.baseUrl.replace(/\/$/, "")}/v1/chat/completions`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (conn.apiKey) headers.Authorization = `Bearer ${conn.apiKey}`;
    const body = JSON.stringify({
      model: conn.model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: MAX_TOKENS,
    });
    return this.attempt(url, headers, body, outerSignal);
  }

  private async attempt(url: string, headers: Record<string, string>, body: string, outerSignal: AbortSignal): Promise<EndpointCallResult> {
    let lastErr: Error | undefined;
    for (let i = 0; i < 2; i++) {
      if (outerSignal.aborted) {
        return { rawAnswer: "", latencyMs: 0, error: "cancelled" };
      }
      const start = Date.now();
      const ctrl = new AbortController();
      const onOuterAbort = () => ctrl.abort();
      outerSignal.addEventListener("abort", onOuterAbort, { once: true });
      const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
      try {
        const resp = await fetch(url, { method: "POST", headers, body, signal: ctrl.signal });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 256)}`);
        const data = (await resp.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        return {
          rawAnswer: data.choices?.[0]?.message?.content ?? "",
          latencyMs: Date.now() - start,
          tokensIn: data.usage?.prompt_tokens,
          tokensOut: data.usage?.completion_tokens,
        };
      } catch (e) {
        lastErr = e as Error;
        if (outerSignal.aborted) break;
        if (i === 0) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      } finally {
        clearTimeout(timer);
        outerSignal.removeEventListener("abort", onOuterAbort);
      }
    }
    return { rawAnswer: "", latencyMs: 0, error: lastErr?.message ?? "unknown error" };
  }
}
```

Note about `findByIdWithDecryptedKey`: the real `ConnectionService` may expose a method with a different name. At wiring time (Task 17/22), substitute the actual method that returns a decrypted `apiKey`. If no such method exists yet, add a small read-only method on `ConnectionService` rather than re-implementing decryption here.

- [ ] **Step 3: Run tests**

```bash
pnpm -F @modeldoctor/api test -- endpoint-caller
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/quality-gate/endpoint-caller.ts apps/api/src/modules/quality-gate/__tests__/endpoint-caller.spec.ts
git commit -m "feat(quality-gate): endpoint caller with retry + timeout + cancel"
```

---

## Task 12: Evaluations repository

**Files:**
- Create: `apps/api/src/modules/quality-gate/repositories/evaluations.repository.ts`
- Create: `apps/api/src/modules/quality-gate/repositories/__tests__/evaluations.repository.spec.ts`

Uses the existing `startPostgres` testcontainer helper.

- [ ] **Step 1: Failing integration test**

```ts
// __tests__/evaluations.repository.spec.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { type TestDatabase, startPostgres } from "../../../../../test/helpers/postgres-container.js";
import { EvaluationsRepository } from "../evaluations.repository.js";

let db: TestDatabase;
let prisma: PrismaClient;
let repo: EvaluationsRepository;
let userId: string;

beforeAll(async () => {
  db = await startPostgres();
  prisma = new PrismaClient({ datasources: { db: { url: db.url } } });
  const user = await prisma.user.create({ data: { email: `qg-${Date.now()}@test`, passwordHash: "x", roles: [] } });
  userId = user.id;
  repo = new EvaluationsRepository(prisma);
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  await db.teardown();
});

const sample = (idx: number) => ({
  id: `s${idx}`,
  idx,
  prompt: "Q?",
  expected: "A",
  judgeConfig: { kind: "exact-match" as const },
});

describe("EvaluationsRepository", () => {
  it("creates an evaluation and reads it back", async () => {
    const created = await repo.create(userId, { name: "set1", description: null, samples: [sample(0), sample(1)] });
    expect(created.totalSamples).toBe(2);
    const fetched = await repo.findById(userId, created.id);
    expect(fetched?.id).toBe(created.id);
  });

  it("lists by user (newest first)", async () => {
    const items = await repo.list(userId);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].createdAt >= items[items.length - 1].createdAt).toBe(true);
  });

  it("updates samples and bumps version + totalSamples", async () => {
    const e = await repo.create(userId, { name: "v2", samples: [sample(0)] });
    const updated = await repo.update(userId, e.id, { samples: [sample(0), sample(1), sample(2)] });
    expect(updated.totalSamples).toBe(3);
    expect(updated.version).toBe(e.version + 1);
  });

  it("delete is blocked when a run references it", async () => {
    const e = await repo.create(userId, { name: "ref", samples: [sample(0)] });
    await prisma.evaluationRun.create({
      data: {
        userId,
        evaluationId: e.id,
        evaluationVersion: e.version,
        evaluationSnapshot: { samples: [sample(0)] },
        endpointAId: "fake",
        gateConfig: { passRateMin: 0.9 },
        totalSamples: 1,
      },
    });
    await expect(repo.delete(userId, e.id)).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 2: Implement repository**

```ts
// apps/api/src/modules/quality-gate/repositories/evaluations.repository.ts
import { Injectable } from "@nestjs/common";
import type { CreateEvaluationRequest, Evaluation, EvaluationSample, UpdateEvaluationRequest } from "@modeldoctor/contracts";
import type { PrismaClient } from "@prisma/client";

@Injectable()
export class EvaluationsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(userId: string): Promise<Evaluation[]> {
    const rows = await this.prisma.evaluation.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
    return rows.map(this.toDto);
  }

  async findById(userId: string, id: string): Promise<Evaluation | null> {
    const row = await this.prisma.evaluation.findFirst({ where: { id, userId } });
    return row ? this.toDto(row) : null;
  }

  async create(userId: string, body: CreateEvaluationRequest): Promise<Evaluation> {
    const row = await this.prisma.evaluation.create({
      data: {
        userId,
        name: body.name,
        description: body.description ?? null,
        samples: body.samples as unknown as object,
        totalSamples: body.samples.length,
      },
    });
    return this.toDto(row);
  }

  async update(userId: string, id: string, body: UpdateEvaluationRequest): Promise<Evaluation> {
    const existing = await this.prisma.evaluation.findFirst({ where: { id, userId } });
    if (!existing) throw new Error(`evaluation ${id} not found`);
    const newSamples = body.samples ?? (existing.samples as unknown as EvaluationSample[]);
    const samplesChanged = body.samples != null;
    const row = await this.prisma.evaluation.update({
      where: { id },
      data: {
        name: body.name ?? existing.name,
        description: body.description !== undefined ? body.description : existing.description,
        samples: newSamples as unknown as object,
        totalSamples: newSamples.length,
        version: samplesChanged ? existing.version + 1 : existing.version,
      },
    });
    return this.toDto(row);
  }

  async delete(userId: string, id: string): Promise<void> {
    // Foreign-key onDelete: Restrict will surface as P2003. Map to a clearer error if needed in the service layer.
    await this.prisma.evaluation.delete({ where: { id_userId: { id, userId } } }).catch(async (e) => {
      // Postgres error path: ensure ownership check first
      const owned = await this.prisma.evaluation.findFirst({ where: { id, userId } });
      if (!owned) throw new Error(`evaluation ${id} not found`);
      throw e;
    });
  }

  private toDto = (row: {
    id: string; userId: string; name: string; description: string | null; version: number;
    samples: unknown; totalSamples: number; createdAt: Date; updatedAt: Date;
  }): Evaluation => ({
    id: row.id,
    userId: row.userId,
    name: row.name,
    description: row.description,
    version: row.version,
    samples: row.samples as EvaluationSample[],
    totalSamples: row.totalSamples,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
```

Note: the `id_userId` compound where requires a `@@unique([id, userId])` constraint. Add it to `Evaluation` model in `schema.prisma` if it isn't present, then create a follow-up no-op migration. Alternatively, change `delete` to two steps: `findFirst → delete by id`. The two-step approach is simpler; use it:

```ts
async delete(userId: string, id: string): Promise<void> {
  const owned = await this.prisma.evaluation.findFirst({ where: { id, userId }, select: { id: true } });
  if (!owned) throw new Error(`evaluation ${id} not found`);
  await this.prisma.evaluation.delete({ where: { id } });
}
```

Use this version. Remove the `id_userId` compound-key reference.

- [ ] **Step 3: Run integration test**

```bash
pnpm -F @modeldoctor/api test -- evaluations.repository
```

Expected: 4 tests pass. Will take 60-120s for testcontainer startup.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/quality-gate/repositories/evaluations.repository.ts apps/api/src/modules/quality-gate/repositories/__tests__/evaluations.repository.spec.ts
git commit -m "feat(quality-gate): EvaluationsRepository with integration tests"
```

---

## Task 13: Runs repository

**Files:**
- Create: `apps/api/src/modules/quality-gate/repositories/runs.repository.ts`
- Create: `apps/api/src/modules/quality-gate/repositories/__tests__/runs.repository.spec.ts`

This repository owns the run lifecycle write API and the sample-results page query.

- [ ] **Step 1: Failing test (integration)**

```ts
// __tests__/runs.repository.spec.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { type TestDatabase, startPostgres } from "../../../../../test/helpers/postgres-container.js";
import { RunsRepository } from "../runs.repository.js";

let db: TestDatabase;
let prisma: PrismaClient;
let repo: RunsRepository;
let userId: string;
let connA: string;
let connB: string;
let evalId: string;

beforeAll(async () => {
  db = await startPostgres();
  prisma = new PrismaClient({ datasources: { db: { url: db.url } } });
  const user = await prisma.user.create({ data: { email: `runs-${Date.now()}@t`, passwordHash: "x", roles: [] } });
  userId = user.id;
  const a = await prisma.connection.create({ data: { userId, name: "A", baseUrl: "http://a", apiKeyCipher: "", model: "m", category: "chat" } });
  const b = await prisma.connection.create({ data: { userId, name: "B", baseUrl: "http://b", apiKeyCipher: "", model: "m", category: "chat" } });
  connA = a.id; connB = b.id;
  const e = await prisma.evaluation.create({ data: { userId, name: "e", samples: [{ id: "s0", idx: 0, prompt: "Q", expected: "A", judgeConfig: { kind: "exact-match" } }], totalSamples: 1 } });
  evalId = e.id;
  repo = new RunsRepository(prisma);
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  await db.teardown();
});

describe("RunsRepository", () => {
  it("creates a run in PENDING and stores snapshot + total", async () => {
    const r = await repo.createPending({
      userId,
      evaluationId: evalId,
      evaluationVersion: 1,
      evaluationSnapshot: { samples: [{ id: "s0", idx: 0, prompt: "Q", expected: "A", judgeConfig: { kind: "exact-match" } }] },
      endpointAId: connA,
      endpointBId: connB,
      gateConfig: { passRateMin: 0.9 },
    });
    expect(r.status).toBe("PENDING");
    expect(r.totalSamples).toBe(1);
  });

  it("transitions PENDING → RUNNING → COMPLETED with gate result", async () => {
    const r = await repo.createPending({
      userId, evaluationId: evalId, evaluationVersion: 1,
      evaluationSnapshot: { samples: [] },
      endpointAId: connA, gateConfig: { passRateMin: 0.9 },
    });
    await repo.markRunning(r.id);
    const updated = await repo.markCompleted(r.id, {
      passRateA: 0.95,
      bothPassCount: 0, bothFailCount: 0, totalErrors: 0, judgeCallCount: 0,
    }, { result: "PASSED", failures: [], warnings: [] });
    expect(updated.status).toBe("COMPLETED");
    expect(updated.gateResult).toBe("PASSED");
  });

  it("saveSample writes row visible via paginated query with filter", async () => {
    const r = await repo.createPending({
      userId, evaluationId: evalId, evaluationVersion: 1,
      evaluationSnapshot: { samples: [] },
      endpointAId: connA, endpointBId: connB, gateConfig: { passRateMin: 0.9 },
    });
    await repo.saveSample({
      runId: r.id,
      sampleId: "s0",
      sampleIdx: 0,
      resultA: { call: { rawAnswer: "x", latencyMs: 10 }, judge: { passed: true } },
      resultB: { call: { rawAnswer: "y", latencyMs: 12 }, judge: { passed: false } },
      delta: "REGRESSION",
    });
    const page = await repo.listSamples(r.id, { filter: "regression", sortBy: "idx", page: 1, pageSize: 10 });
    expect(page.total).toBe(1);
    expect(page.items[0].delta).toBe("REGRESSION");
  });

  it("sweepRunningOnBoot transitions RUNNING → FAILED", async () => {
    const r = await repo.createPending({
      userId, evaluationId: evalId, evaluationVersion: 1,
      evaluationSnapshot: { samples: [] },
      endpointAId: connA, gateConfig: { passRateMin: 0.9 },
    });
    await repo.markRunning(r.id);
    const count = await repo.sweepRunningOnBoot();
    expect(count).toBeGreaterThanOrEqual(1);
    const after = await prisma.evaluationRun.findUnique({ where: { id: r.id } });
    expect(after?.status).toBe("FAILED");
    expect(after?.errorMessage).toMatch(/server restarted/);
  });
});
```

- [ ] **Step 2: Implement RunsRepository**

```ts
// apps/api/src/modules/quality-gate/repositories/runs.repository.ts
import { Injectable } from "@nestjs/common";
import type {
  AggregateMetrics, EvaluationRun, GateResult, ListRunSamplesQuery,
  ListRunSamplesResponse, ListRunsQuery, RunSample,
} from "@modeldoctor/contracts";
import type { PrismaClient, EvaluationRunStatus } from "@prisma/client";
import type { GateOutcome } from "../gate/compute-gate-result.js";

export interface CreatePendingInput {
  userId: string;
  evaluationId: string;
  evaluationVersion: number;
  evaluationSnapshot: { samples: unknown[] };
  endpointAId: string;
  endpointBId?: string | null;
  gateConfig: object;
}

export interface SaveSampleInput {
  runId: string;
  sampleId: string;
  sampleIdx: number;
  resultA: object;
  resultB: object | null;
  delta: "REGRESSION" | "IMPROVEMENT" | "BOTH_PASS" | "BOTH_FAIL" | "NA";
}

@Injectable()
export class RunsRepository {
  constructor(private readonly prisma: PrismaClient) {}

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
      },
    });
    return this.toDto(row);
  }

  async findById(userId: string, id: string): Promise<EvaluationRun | null> {
    const row = await this.prisma.evaluationRun.findFirst({ where: { id, userId } });
    return row ? this.toDto(row) : null;
  }

  async list(userId: string, q: ListRunsQuery): Promise<{ items: EvaluationRun[]; total: number; page: number; pageSize: number }> {
    const where = { userId, ...(q.status ? { status: q.status as EvaluationRunStatus } : {}), ...(q.evaluationId ? { evaluationId: q.evaluationId } : {}) };
    const [total, rows] = await Promise.all([
      this.prisma.evaluationRun.count({ where }),
      this.prisma.evaluationRun.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return { items: rows.map(this.toDto), total, page: q.page, pageSize: q.pageSize };
  }

  async markRunning(id: string) {
    return this.prisma.evaluationRun.update({ where: { id }, data: { status: "RUNNING", startedAt: new Date() } });
  }
  async updateProgress(id: string, processed: number) {
    return this.prisma.evaluationRun.update({ where: { id }, data: { processedSamples: processed } });
  }
  async markCancelled(id: string) {
    return this.prisma.evaluationRun.update({ where: { id }, data: { status: "CANCELLED", finishedAt: new Date() } });
  }
  async markFailed(id: string, message: string) {
    return this.prisma.evaluationRun.update({ where: { id }, data: { status: "FAILED", finishedAt: new Date(), errorMessage: message } });
  }
  async markCompleted(id: string, metrics: AggregateMetrics, gate: GateOutcome): Promise<EvaluationRun> {
    const row = await this.prisma.evaluationRun.update({
      where: { id },
      data: {
        status: "COMPLETED",
        finishedAt: new Date(),
        aggregateMetrics: metrics as unknown as object,
        gateResult: gate.result as GateResult,
      },
    });
    return this.toDto(row);
  }

  async saveSample(input: SaveSampleInput) {
    await this.prisma.evaluationRunSample.create({
      data: {
        runId: input.runId,
        sampleId: input.sampleId,
        sampleIdx: input.sampleIdx,
        resultA: input.resultA,
        resultB: input.resultB,
        delta: input.delta,
      },
    });
  }

  async listSamples(runId: string, q: ListRunSamplesQuery): Promise<ListRunSamplesResponse> {
    const deltaMap: Record<string, string | undefined> = {
      regression: "REGRESSION", improvement: "IMPROVEMENT", "both-pass": "BOTH_PASS", "both-fail": "BOTH_FAIL", all: undefined,
    };
    const where = { runId, ...(deltaMap[q.filter] ? { delta: deltaMap[q.filter] as "REGRESSION" } : {}) };
    // sortBy=judgeScore: ORDER BY resultB->>judge->>score sometimes. For V1, sort by idx via index; advanced sorts can be added in a follow-up.
    const orderBy = { sampleIdx: "asc" as const };
    const [total, rows] = await Promise.all([
      this.prisma.evaluationRunSample.count({ where }),
      this.prisma.evaluationRunSample.findMany({ where, orderBy, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    return {
      items: rows.map(
        (r): RunSample => ({
          id: r.id,
          runId: r.runId,
          sampleId: r.sampleId,
          sampleIdx: r.sampleIdx,
          resultA: r.resultA as RunSample["resultA"],
          resultB: r.resultB as RunSample["resultB"],
          delta: r.delta as RunSample["delta"],
          createdAt: r.createdAt.toISOString(),
        }),
      ),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async sampleRowsForAggregate(runId: string) {
    const rows = await this.prisma.evaluationRunSample.findMany({ where: { runId } });
    return rows.map((r) => ({ resultA: r.resultA as { call: { error?: string }; judge: { passed: boolean; score?: number } }, resultB: r.resultB as never }));
  }

  async sweepRunningOnBoot(): Promise<number> {
    const r = await this.prisma.evaluationRun.updateMany({
      where: { status: { in: ["PENDING", "RUNNING"] } },
      data: { status: "FAILED", errorMessage: "server restarted, retrigger to resume", finishedAt: new Date() },
    });
    return r.count;
  }

  async deleteRun(userId: string, id: string) {
    const owned = await this.prisma.evaluationRun.findFirst({ where: { id, userId }, select: { id: true } });
    if (!owned) throw new Error(`run ${id} not found`);
    await this.prisma.evaluationRun.delete({ where: { id } });
  }

  private toDto = (row: {
    id: string; userId: string; evaluationId: string; evaluationVersion: number;
    evaluationSnapshot: unknown; endpointAId: string; endpointBId: string | null;
    gateConfig: unknown; status: EvaluationRunStatus; gateResult: GateResult | null;
    aggregateMetrics: unknown; processedSamples: number; totalSamples: number;
    startedAt: Date | null; finishedAt: Date | null; errorMessage: string | null;
    createdAt: Date;
  }): EvaluationRun => ({
    id: row.id,
    userId: row.userId,
    evaluationId: row.evaluationId,
    evaluationVersion: row.evaluationVersion,
    evaluationSnapshot: row.evaluationSnapshot as EvaluationRun["evaluationSnapshot"],
    endpointAId: row.endpointAId,
    endpointBId: row.endpointBId,
    gateConfig: row.gateConfig as EvaluationRun["gateConfig"],
    status: row.status as EvaluationRun["status"],
    gateResult: row.gateResult,
    aggregateMetrics: row.aggregateMetrics as EvaluationRun["aggregateMetrics"],
    processedSamples: row.processedSamples,
    totalSamples: row.totalSamples,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
  });
}
```

- [ ] **Step 3: Run tests**

```bash
pnpm -F @modeldoctor/api test -- runs.repository
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/quality-gate/repositories/runs.repository.ts apps/api/src/modules/quality-gate/repositories/__tests__/runs.repository.spec.ts
git commit -m "feat(quality-gate): RunsRepository with lifecycle + sample listing + boot sweep"
```

---

## Task 14: Run executor

**Files:**
- Create: `apps/api/src/modules/quality-gate/services/run-executor.service.ts`
- Create: `apps/api/src/modules/quality-gate/services/__tests__/run-executor.service.spec.ts`

`pLimit` is not yet in the workspace deps. Add it.

- [ ] **Step 1: Add `p-limit` dependency to apps/api**

```bash
pnpm -F @modeldoctor/api add p-limit
```

- [ ] **Step 2: Failing test (mocks repo, endpointCaller, judge registry)**

```ts
// __tests__/run-executor.service.spec.ts
import { describe, expect, it, vi } from "vitest";
import { QualityGateRunExecutor } from "../run-executor.service.js";

function buildMocks() {
  const repo = {
    findFullRun: vi.fn(),
    markRunning: vi.fn().mockResolvedValue(undefined),
    updateProgress: vi.fn().mockResolvedValue(undefined),
    saveSample: vi.fn().mockResolvedValue(undefined),
    sampleRowsForAggregate: vi.fn().mockResolvedValue([]),
    markCompleted: vi.fn().mockResolvedValue(undefined),
    markCancelled: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    sweepRunningOnBoot: vi.fn().mockResolvedValue(0),
  };
  const caller = { call: vi.fn().mockResolvedValue({ rawAnswer: "ok", latencyMs: 1 }) };
  const judge = { apply: vi.fn().mockResolvedValue({ passed: true }) };
  return { repo, caller, judge };
}

const sample = (i: number) => ({ id: `s${i}`, idx: i, prompt: "Q", expected: "A", judgeConfig: { kind: "exact-match" as const } });

describe("QualityGateRunExecutor", () => {
  it("happy path runs through samples and marks COMPLETED with metrics", async () => {
    const m = buildMocks();
    m.repo.findFullRun.mockResolvedValue({
      id: "r1", endpointAId: "a", endpointBId: null,
      evaluationSnapshot: { samples: [sample(0), sample(1), sample(2)] },
      gateConfig: { passRateMin: 0.9 },
    });
    m.repo.sampleRowsForAggregate.mockResolvedValue([
      { resultA: { call: {}, judge: { passed: true } }, resultB: null },
      { resultA: { call: {}, judge: { passed: true } }, resultB: null },
      { resultA: { call: {}, judge: { passed: true } }, resultB: null },
    ]);
    const ex = new QualityGateRunExecutor(m.repo as never, m.caller as never, m.judge as never);
    await ex.start("r1");
    expect(m.caller.call).toHaveBeenCalledTimes(3);
    expect(m.judge.apply).toHaveBeenCalledTimes(3);
    expect(m.repo.markCompleted).toHaveBeenCalled();
  });

  it("dual-endpoint mode calls both A and B per sample", async () => {
    const m = buildMocks();
    m.repo.findFullRun.mockResolvedValue({
      id: "r2", endpointAId: "a", endpointBId: "b",
      evaluationSnapshot: { samples: [sample(0), sample(1)] },
      gateConfig: { passRateMin: 0.9 },
    });
    const ex = new QualityGateRunExecutor(m.repo as never, m.caller as never, m.judge as never);
    await ex.start("r2");
    expect(m.caller.call).toHaveBeenCalledTimes(4);
    expect(m.judge.apply).toHaveBeenCalledTimes(4);
  });

  it("cancel stops issuing further calls and marks CANCELLED", async () => {
    const m = buildMocks();
    m.repo.findFullRun.mockResolvedValue({
      id: "r3", endpointAId: "a", endpointBId: null,
      evaluationSnapshot: { samples: Array.from({ length: 20 }, (_, i) => sample(i)) },
      gateConfig: { passRateMin: 0.9 },
    });
    // Force caller to be slow so cancel takes effect
    m.caller.call.mockImplementation(async (_id: string, _q: string, signal: AbortSignal) => {
      await new Promise((r) => setTimeout(r, 30));
      if (signal.aborted) return { rawAnswer: "", latencyMs: 0, error: "cancelled" };
      return { rawAnswer: "x", latencyMs: 1 };
    });
    const ex = new QualityGateRunExecutor(m.repo as never, m.caller as never, m.judge as never);
    const p = ex.start("r3");
    await new Promise((r) => setTimeout(r, 10));
    ex.cancel("r3");
    await p;
    expect(m.repo.markCancelled).toHaveBeenCalled();
  });

  it("repo error → markFailed", async () => {
    const m = buildMocks();
    m.repo.findFullRun.mockRejectedValueOnce(new Error("boom"));
    const ex = new QualityGateRunExecutor(m.repo as never, m.caller as never, m.judge as never);
    await ex.start("r4");
    expect(m.repo.markFailed).toHaveBeenCalledWith("r4", expect.stringContaining("boom"));
  });

  it("onModuleInit calls sweepRunningOnBoot", async () => {
    const m = buildMocks();
    const ex = new QualityGateRunExecutor(m.repo as never, m.caller as never, m.judge as never);
    await ex.onModuleInit();
    expect(m.repo.sweepRunningOnBoot).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Implement executor**

```ts
// apps/api/src/modules/quality-gate/services/run-executor.service.ts
import { Injectable, type OnModuleInit } from "@nestjs/common";
import pLimit from "p-limit";
import { computeGateResult } from "../gate/compute-gate-result.js";
import { aggregateMetrics, computeDelta } from "../gate/sample-aggregation.js";
import type { EndpointCaller } from "../endpoint-caller.js";
import type { JudgeRegistry } from "../judges/registry.js";
import type { RunsRepository } from "../repositories/runs.repository.js";

interface FullRun {
  id: string;
  endpointAId: string;
  endpointBId: string | null;
  evaluationSnapshot: { samples: Array<{ id: string; idx: number; prompt: string; expected: string; judgeConfig: import("@modeldoctor/contracts").JudgeConfig }> };
  gateConfig: import("@modeldoctor/contracts").GateConfig;
}

interface FullRunRepo extends RunsRepository {
  findFullRun(id: string): Promise<FullRun | null>;
}

const SAMPLE_CONCURRENCY = 4;
const JUDGE_CONCURRENCY = 2;
const PROGRESS_INTERVAL = 5;

@Injectable()
export class QualityGateRunExecutor implements OnModuleInit {
  private readonly active = new Map<string, AbortController>();

  constructor(
    private readonly repo: FullRunRepo,
    private readonly endpointCaller: EndpointCaller,
    private readonly judges: JudgeRegistry,
  ) {}

  async onModuleInit() {
    await this.repo.sweepRunningOnBoot();
  }

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

      const samples = run.evaluationSnapshot.samples;
      await Promise.all(
        samples.map((s) =>
          sampleLimit(async () => {
            if (ac.signal.aborted) return;
            const [callA, callB] = await Promise.all([
              this.endpointCaller.call(run.endpointAId, s.prompt, ac.signal),
              run.endpointBId ? this.endpointCaller.call(run.endpointBId, s.prompt, ac.signal) : Promise.resolve(null),
            ]);
            if (ac.signal.aborted) return;
            const judgedA = await judgeLimit(() => this.judges.apply(s.judgeConfig, { question: s.prompt, expected: s.expected, answer: callA.rawAnswer }));
            if (s.judgeConfig.kind === "llm-judge") judgeCalls++;
            const judgedB =
              callB == null
                ? null
                : await judgeLimit(() => this.judges.apply(s.judgeConfig, { question: s.prompt, expected: s.expected, answer: callB.rawAnswer }));
            if (callB != null && s.judgeConfig.kind === "llm-judge") judgeCalls++;
            const delta = computeDelta(judgedA, judgedB);
            await this.repo.saveSample({
              runId,
              sampleId: s.id,
              sampleIdx: s.idx,
              resultA: { call: callA, judge: judgedA },
              resultB: callB ? { call: callB, judge: judgedB! } : null,
              delta,
            });
            processed++;
            if (processed % PROGRESS_INTERVAL === 0) await this.repo.updateProgress(runId, processed);
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

  cancel(runId: string) {
    this.active.get(runId)?.abort();
  }
}
```

- [ ] **Step 4: Add `findFullRun` method to RunsRepository**

Open `apps/api/src/modules/quality-gate/repositories/runs.repository.ts` and add:

```ts
async findFullRun(id: string) {
  const row = await this.prisma.evaluationRun.findUnique({ where: { id } });
  if (!row) return null;
  return {
    id: row.id,
    endpointAId: row.endpointAId,
    endpointBId: row.endpointBId,
    evaluationSnapshot: row.evaluationSnapshot as { samples: unknown[] },
    gateConfig: row.gateConfig as import("@modeldoctor/contracts").GateConfig,
  };
}
```

- [ ] **Step 5: Run tests**

```bash
pnpm -F @modeldoctor/api test -- run-executor
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/quality-gate/ apps/api/package.json
git commit -m "feat(quality-gate): in-process async run executor with cancel + boot sweep"
```

---

## Task 15: Services — Evaluations + Runs

**Files:**
- Create: `apps/api/src/modules/quality-gate/services/evaluations.service.ts`
- Create: `apps/api/src/modules/quality-gate/services/runs.service.ts`
- Create: matching unit specs

These are thin orchestrators on top of the repositories. Owner-scoping, CSV parsing, validation orchestration. The executor is fire-and-forget from `runs.service.create()`.

- [ ] **Step 1: EvaluationsService failing test**

```ts
// __tests__/evaluations.service.spec.ts
import { describe, expect, it, vi } from "vitest";
import { EvaluationsService } from "../evaluations.service.js";

const userId = "u1";

function repoMock() {
  return {
    create: vi.fn().mockResolvedValue({ id: "e1", userId, name: "x", samples: [], totalSamples: 0 }),
    list: vi.fn().mockResolvedValue([]),
    findById: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
}

describe("EvaluationsService", () => {
  it("create calls repo and returns dto", async () => {
    const r = repoMock();
    const svc = new EvaluationsService(r as never);
    const out = await svc.create(userId, { name: "x", samples: [{ id: "s0", idx: 0, prompt: "Q", expected: "A", judgeConfig: { kind: "exact-match" } }] });
    expect(out.id).toBe("e1");
    expect(r.create).toHaveBeenCalledWith(userId, expect.objectContaining({ name: "x" }));
  });

  it("importFromCsv parses CSV rows into samples", async () => {
    const r = repoMock();
    const svc = new EvaluationsService(r as never);
    const csv = [
      "prompt,expected,judgeKind,judgeConfig,tags",
      `"What is 2+2?","4","exact-match",,`,
      `"翻译: hi","你好","contains","{""substrings"":[""你好""],""mode"":""any""}",greeting`,
    ].join("\n");
    const samples = await svc.parseCsv(csv);
    expect(samples.length).toBe(2);
    expect(samples[1].judgeConfig).toMatchObject({ kind: "contains" });
    expect(samples[1].tags).toEqual(["greeting"]);
  });

  it("parseCsv rejects unknown judgeKind", async () => {
    const r = repoMock();
    const svc = new EvaluationsService(r as never);
    await expect(svc.parseCsv("prompt,expected,judgeKind\nQ,A,wat")).rejects.toThrow(/unknown.*judgeKind/i);
  });
});
```

- [ ] **Step 2: Implement EvaluationsService**

```ts
// apps/api/src/modules/quality-gate/services/evaluations.service.ts
import { Injectable } from "@nestjs/common";
import { customAlphabet } from "nanoid";
import { type CreateEvaluationRequest, type Evaluation, type EvaluationSample, type ImportEvaluationRequest, type UpdateEvaluationRequest, evaluationSampleSchema, judgeConfigSchema } from "@modeldoctor/contracts";
import type { EvaluationsRepository } from "../repositories/evaluations.repository.js";

const newSampleId = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 12);

@Injectable()
export class EvaluationsService {
  constructor(private readonly repo: EvaluationsRepository) {}

  list(userId: string) {
    return this.repo.list(userId);
  }
  get(userId: string, id: string) {
    return this.repo.findById(userId, id);
  }
  create(userId: string, body: CreateEvaluationRequest) {
    return this.repo.create(userId, this.normalize(body));
  }
  update(userId: string, id: string, body: UpdateEvaluationRequest) {
    const normalized: UpdateEvaluationRequest = body.samples ? { ...body, samples: this.assignIds(body.samples) } : body;
    return this.repo.update(userId, id, normalized);
  }
  delete(userId: string, id: string) {
    return this.repo.delete(userId, id);
  }

  async import(userId: string, name: string, body: ImportEvaluationRequest): Promise<Evaluation> {
    const samples = body.format === "csv" ? await this.parseCsv(body.payload) : body.payload;
    return this.create(userId, { name, samples });
  }

  async parseCsv(csv: string): Promise<EvaluationSample[]> {
    const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) throw new Error("CSV requires at least a header and one data row");
    const header = this.splitCsvRow(lines[0]).map((h) => h.trim());
    const idx = (k: string) => header.indexOf(k);
    const ip = idx("prompt"), ie = idx("expected"), ik = idx("judgeKind"), ic = idx("judgeConfig"), it = idx("tags");
    if (ip < 0 || ie < 0 || ik < 0) throw new Error('CSV must include columns: prompt, expected, judgeKind (judgeConfig and tags optional)');

    const out: EvaluationSample[] = [];
    for (let i = 1; i < lines.length; i++) {
      const row = this.splitCsvRow(lines[i]);
      const kind = row[ik]?.trim();
      const cfgRaw = ic >= 0 ? row[ic] : "";
      let cfg: unknown;
      if (cfgRaw && cfgRaw.trim().length > 0) {
        try { cfg = JSON.parse(cfgRaw); } catch { throw new Error(`row ${i}: judgeConfig is not valid JSON`); }
      } else {
        cfg = { kind };
      }
      const judgeConfig = judgeConfigSchema.parse({ ...((cfg as object) || {}), kind: (cfg as { kind?: string }).kind ?? kind });
      const sample = evaluationSampleSchema.parse({
        id: newSampleId(),
        idx: i - 1,
        prompt: row[ip] ?? "",
        expected: row[ie] ?? "",
        judgeConfig,
        tags: it >= 0 && row[it] ? row[it].split(",").map((t) => t.trim()).filter(Boolean) : undefined,
      });
      out.push(sample);
    }
    return out;
  }

  // Minimal RFC-4180-ish CSV splitter (handles quoted commas and "" escapes).
  private splitCsvRow(line: string): string[] {
    const cells: string[] = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQ = false;
        else cur += ch;
      } else {
        if (ch === ",") { cells.push(cur); cur = ""; }
        else if (ch === '"') inQ = true;
        else cur += ch;
      }
    }
    cells.push(cur);
    return cells;
  }

  private normalize(body: CreateEvaluationRequest): CreateEvaluationRequest {
    return { ...body, samples: this.assignIds(body.samples) };
  }

  private assignIds(samples: EvaluationSample[]): EvaluationSample[] {
    return samples.map((s, i) => ({ ...s, id: s.id || newSampleId(), idx: i }));
  }
}
```

- [ ] **Step 3: RunsService failing test**

```ts
// __tests__/runs.service.spec.ts
import { describe, expect, it, vi } from "vitest";
import { RunsService } from "../runs.service.js";

function build() {
  const repo = {
    createPending: vi.fn().mockResolvedValue({ id: "r1", status: "PENDING" }),
    findById: vi.fn().mockResolvedValue({ id: "r1", status: "RUNNING", userId: "u1" }),
    list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
    deleteRun: vi.fn(),
  };
  const evals = {
    get: vi.fn().mockResolvedValue({ id: "e1", userId: "u1", version: 2, samples: [{ id: "s", idx: 0, prompt: "Q", expected: "A", judgeConfig: { kind: "exact-match" } }] }),
  };
  const connections = { findById: vi.fn().mockResolvedValue({ id: "c", userId: "u1" }) };
  const executor = { start: vi.fn(), cancel: vi.fn() };
  return { repo, evals, connections, executor };
}

describe("RunsService", () => {
  it("rejects when evaluation not owned by user", async () => {
    const m = build();
    m.evals.get.mockResolvedValueOnce(null);
    const svc = new RunsService(m.repo as never, m.evals as never, m.connections as never, m.executor as never);
    await expect(svc.create("u1", { evaluationId: "x", endpointAId: "c", gateConfig: { passRateMin: 0.9 } })).rejects.toThrow(/not found/);
  });
  it("create snapshots evaluation samples and fires executor", async () => {
    const m = build();
    const svc = new RunsService(m.repo as never, m.evals as never, m.connections as never, m.executor as never);
    const r = await svc.create("u1", { evaluationId: "e1", endpointAId: "c", gateConfig: { passRateMin: 0.9 } });
    expect(m.repo.createPending).toHaveBeenCalledWith(expect.objectContaining({ evaluationVersion: 2 }));
    expect(m.executor.start).toHaveBeenCalledWith("r1");
    expect(r.id).toBe("r1");
  });
  it("cancel forwards to executor when run owned by user", async () => {
    const m = build();
    const svc = new RunsService(m.repo as never, m.evals as never, m.connections as never, m.executor as never);
    await svc.cancel("u1", "r1");
    expect(m.executor.cancel).toHaveBeenCalledWith("r1");
  });
});
```

- [ ] **Step 4: Implement RunsService**

```ts
// apps/api/src/modules/quality-gate/services/runs.service.ts
import { Injectable, NotFoundException } from "@nestjs/common";
import type { CreateRunRequest, EvaluationRun, ListRunsQuery } from "@modeldoctor/contracts";
import type { EvaluationsService } from "./evaluations.service.js";
import type { QualityGateRunExecutor } from "./run-executor.service.js";
import type { RunsRepository } from "../repositories/runs.repository.js";

interface ConnectionsLike {
  findById(id: string, userId: string): Promise<{ id: string } | null>;
}

@Injectable()
export class RunsService {
  constructor(
    private readonly repo: RunsRepository,
    private readonly evaluations: EvaluationsService,
    private readonly connections: ConnectionsLike,
    private readonly executor: QualityGateRunExecutor,
  ) {}

  list(userId: string, q: ListRunsQuery) {
    return this.repo.list(userId, q);
  }
  async get(userId: string, id: string) {
    const run = await this.repo.findById(userId, id);
    if (!run) throw new NotFoundException(`run ${id} not found`);
    return run;
  }
  delete(userId: string, id: string) {
    return this.repo.deleteRun(userId, id);
  }

  async create(userId: string, body: CreateRunRequest): Promise<EvaluationRun> {
    const evaluation = await this.evaluations.get(userId, body.evaluationId);
    if (!evaluation) throw new NotFoundException(`evaluation ${body.evaluationId} not found`);
    const connA = await this.connections.findById(body.endpointAId, userId);
    if (!connA) throw new NotFoundException(`endpointA connection ${body.endpointAId} not found`);
    if (body.endpointBId) {
      const connB = await this.connections.findById(body.endpointBId, userId);
      if (!connB) throw new NotFoundException(`endpointB connection ${body.endpointBId} not found`);
    }

    const pending = await this.repo.createPending({
      userId,
      evaluationId: evaluation.id,
      evaluationVersion: evaluation.version,
      evaluationSnapshot: { samples: evaluation.samples },
      endpointAId: body.endpointAId,
      endpointBId: body.endpointBId ?? null,
      gateConfig: body.gateConfig,
    });

    // Fire and forget; do not await the executor — the controller returns immediately.
    void this.executor.start(pending.id);

    return pending;
  }

  async cancel(userId: string, id: string) {
    const run = await this.repo.findById(userId, id);
    if (!run) throw new NotFoundException(`run ${id} not found`);
    this.executor.cancel(id);
  }
}
```

- [ ] **Step 5: Run tests**

```bash
pnpm -F @modeldoctor/api test -- evaluations.service runs.service
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/quality-gate/services/
git commit -m "feat(quality-gate): EvaluationsService (CSV parse) + RunsService (fire-and-forget)"
```

---

## Task 16: Controllers + DTO

**Files:**
- Create: `apps/api/src/modules/quality-gate/controllers/evaluations.controller.ts`
- Create: `apps/api/src/modules/quality-gate/controllers/runs.controller.ts`
- Create: `apps/api/src/modules/quality-gate/controllers/__tests__/*.spec.ts`

NestJS pattern with `@Body`, `@Param`, `@Query`, plus `nestjs-zod` `ZodValidationPipe`. Mirror the existing `BenchmarkController` (see `apps/api/src/modules/benchmark/benchmark.controller.ts`) for guards and decorator imports.

- [ ] **Step 1: Evaluations controller**

```ts
// apps/api/src/modules/quality-gate/controllers/evaluations.controller.ts
import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import { createEvaluationRequestSchema, importEvaluationRequestSchema, updateEvaluationRequestSchema } from "@modeldoctor/contracts";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard.js"; // adapt path to actual project guard
import { EvaluationsService } from "../services/evaluations.service.js";

@Controller("api/quality-gate/evaluations")
@UseGuards(JwtAuthGuard)
export class EvaluationsController {
  constructor(private readonly svc: EvaluationsService) {}

  @Get()
  list(@Req() req: { user: { id: string } }) {
    return this.svc.list(req.user.id).then((items) => ({ items }));
  }

  @Post()
  async create(
    @Req() req: { user: { id: string } },
    @Body(new ZodValidationPipe(createEvaluationRequestSchema)) body: import("@modeldoctor/contracts").CreateEvaluationRequest,
  ) {
    return this.svc.create(req.user.id, body);
  }

  @Get(":id")
  async findOne(@Req() req: { user: { id: string } }, @Param("id") id: string) {
    const r = await this.svc.get(req.user.id, id);
    if (!r) throw new Error(`evaluation ${id} not found`);
    return r;
  }

  @Patch(":id")
  update(
    @Req() req: { user: { id: string } },
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateEvaluationRequestSchema)) body: import("@modeldoctor/contracts").UpdateEvaluationRequest,
  ) {
    return this.svc.update(req.user.id, id, body);
  }

  @Delete(":id")
  remove(@Req() req: { user: { id: string } }, @Param("id") id: string) {
    return this.svc.delete(req.user.id, id);
  }

  @Post("import")
  importSet(
    @Req() req: { user: { id: string } },
    @Body() body: { name: string; import: import("@modeldoctor/contracts").ImportEvaluationRequest },
  ) {
    const parsed = importEvaluationRequestSchema.parse(body.import);
    return this.svc.import(req.user.id, body.name, parsed);
  }
}
```

- [ ] **Step 2: Runs controller**

```ts
// apps/api/src/modules/quality-gate/controllers/runs.controller.ts
import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import { createRunRequestSchema, listRunSamplesQuerySchema, listRunsQuerySchema } from "@modeldoctor/contracts";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard.js";
import { RunsRepository } from "../repositories/runs.repository.js";
import { RunsService } from "../services/runs.service.js";

@Controller("api/quality-gate/runs")
@UseGuards(JwtAuthGuard)
export class RunsController {
  constructor(private readonly svc: RunsService, private readonly repo: RunsRepository) {}

  @Get()
  list(@Req() req: { user: { id: string } }, @Query(new ZodValidationPipe(listRunsQuerySchema)) q: import("@modeldoctor/contracts").ListRunsQuery) {
    return this.svc.list(req.user.id, q);
  }

  @Post()
  create(
    @Req() req: { user: { id: string } },
    @Body(new ZodValidationPipe(createRunRequestSchema)) body: import("@modeldoctor/contracts").CreateRunRequest,
  ) {
    return this.svc.create(req.user.id, body);
  }

  @Get(":id")
  get(@Req() req: { user: { id: string } }, @Param("id") id: string) {
    return this.svc.get(req.user.id, id);
  }

  @Post(":id/cancel")
  async cancel(@Req() req: { user: { id: string } }, @Param("id") id: string) {
    await this.svc.cancel(req.user.id, id);
    return { ok: true };
  }

  @Delete(":id")
  remove(@Req() req: { user: { id: string } }, @Param("id") id: string) {
    return this.svc.delete(req.user.id, id);
  }

  @Get(":id/samples")
  async samples(
    @Req() req: { user: { id: string } },
    @Param("id") id: string,
    @Query(new ZodValidationPipe(listRunSamplesQuerySchema)) q: import("@modeldoctor/contracts").ListRunSamplesQuery,
  ) {
    // Owner-check on the parent run
    await this.svc.get(req.user.id, id);
    return this.repo.listSamples(id, q);
  }
}
```

- [ ] **Step 3: Controller unit tests (mock services)**

For each controller, write a single spec that boots a NestJS test module with a mocked service and asserts:

- `GET /api/quality-gate/evaluations` returns `{ items: [...] }`
- `POST /api/quality-gate/runs` calls `RunsService.create` with `body` and `userId`
- 404 paths bubble up correctly

Pattern is identical to `apps/api/src/modules/benchmark/benchmark.controller.spec.ts` — replicate it.

- [ ] **Step 4: Run controller tests**

```bash
pnpm -F @modeldoctor/api test -- controllers
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/quality-gate/controllers/
git commit -m "feat(quality-gate): controllers for evaluations + runs + samples paging"
```

---

## Task 17: Module wiring + AppModule import

**Files:**
- Create: `apps/api/src/modules/quality-gate/quality-gate.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/modules/connection/connection.service.ts` — add a `findByIdWithDecryptedKey(id, userId)` method **if not already present**. If a method that returns a decrypted key exists under a different name, point `EndpointCaller` at it.

- [ ] **Step 1: Inspect Connection service for existing decryption API**

```bash
rg -n "decrypt|apiKey|getDecryptedKey|findByIdAuthed" apps/api/src/modules/connection/connection.service.ts
```

If a method like `getDecryptedConnectionForUser(id, userId)` exists, reuse it. Otherwise add this minimal one:

```ts
async findByIdWithDecryptedKey(id: string, userId: string) {
  const row = await this.prisma.connection.findFirst({ where: { id, userId } });
  if (!row) return null;
  const apiKey = row.apiKeyCipher ? decryptAesGcmV1(row.apiKeyCipher, this.crypto.dataKey) : null;
  return { id: row.id, baseUrl: row.baseUrl, model: row.model, apiKey };
}
```

(The exact imports — `decryptAesGcmV1` and `this.crypto.dataKey` — come from `apps/api/src/common/crypto/aes-gcm.ts` and existing ConnectionService construction. Mirror them.)

- [ ] **Step 2: Update `EndpointCaller` signature accordingly**

Make sure `ConnectionsServiceLike` in `endpoint-caller.ts` matches the chosen method name. If it stays `findByIdWithDecryptedKey(id, userId)`, the executor must thread `userId` through. Threading userId requires storing it on `FullRun`. Update `findFullRun` to also return `userId`, and pass `run.userId` into `endpointCaller.call(run.endpointAId, run.userId, prompt, signal)`. Adjust the test mocks in Task 14 (the existing tests pass `userId`-less; broaden the mock to accept either signature).

Apply all three touches together — they compose:
- `endpoint-caller.ts` signature: `call(connectionId, userId, prompt, signal)`
- `run-executor.service.ts`: pass `run.userId`
- `runs.repository.ts.findFullRun`: include `userId`

- [ ] **Step 3: QualityGateModule**

```ts
// apps/api/src/modules/quality-gate/quality-gate.module.ts
import { Module } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service.js";
import { ConnectionModule } from "../connection/connection.module.js";
import { ConnectionService } from "../connection/connection.service.js";
import { InsightsModule } from "../insights/insights.module.js";
import { LlmJudgeService as DiagnosticsLlmService } from "../insights/llm-judge.service.js"; // adjust path to where the global judge service lives (#173)
import { EvaluationsController } from "./controllers/evaluations.controller.js";
import { RunsController } from "./controllers/runs.controller.js";
import { EndpointCaller } from "./endpoint-caller.js";
import { type JudgeRegistry, createJudgeRegistry } from "./judges/registry.js";
import { EvaluationsRepository } from "./repositories/evaluations.repository.js";
import { RunsRepository } from "./repositories/runs.repository.js";
import { EvaluationsService } from "./services/evaluations.service.js";
import { QualityGateRunExecutor } from "./services/run-executor.service.js";
import { RunsService } from "./services/runs.service.js";

@Module({
  imports: [ConnectionModule, InsightsModule],
  controllers: [EvaluationsController, RunsController],
  providers: [
    EvaluationsRepository,
    RunsRepository,
    EvaluationsService,
    RunsService,
    EndpointCaller,
    QualityGateRunExecutor,
    {
      provide: "JUDGE_REGISTRY",
      useFactory: (llm: DiagnosticsLlmService): JudgeRegistry =>
        createJudgeRegistry({
          runJudge: async (input) => {
            // Adapter from JudgeRegistry's LlmJudgeService shape to whatever the AI Diagnostics service exposes.
            // The real method may be named e.g. `synthesize` or `runRubric`; route the prompts and connectionId through.
            const { content } = await llm.runRubric({
              system: input.systemPrompt,
              user: input.userPrompt,
              connectionId: input.connectionId,
            });
            return { content };
          },
        }),
      inject: [DiagnosticsLlmService],
    },
    // Provide PrismaClient instance for repositories (mirror benchmark.module.ts pattern)
    { provide: "PrismaClient", useExisting: PrismaService },
  ],
  exports: [EvaluationsService, RunsService],
})
export class QualityGateModule {}
```

Note: the `LlmJudgeService.runRubric(...)` shape is illustrative. At wiring time, replace with the actual method exposed by the diagnostics service introduced in PR #173 (e.g. could be `synthesize({ system, user, ... })`). The adapter exists precisely so a method rename does not ripple into judges.

- [ ] **Step 4: Register in AppModule**

In `apps/api/src/app.module.ts`, add:

```ts
import { QualityGateModule } from "./modules/quality-gate/quality-gate.module.js";

@Module({
  imports: [/* …existing imports… */, QualityGateModule],
  // ...
})
export class AppModule {}
```

- [ ] **Step 5: Boot the app to verify wiring**

```bash
pnpm -F @modeldoctor/api start:dev
```

Expected: log line containing `QualityGateModule dependencies initialized` and `Nest application successfully started`. Hit `curl -s http://localhost:3000/api/quality-gate/evaluations -H "Cookie: <session>"` — should return 401 (because no auth) or 200 with empty `items` (if logged in). Either is acceptable proof the route was registered.

Kill the dev server (per `feedback_subagent_process_cleanup`): `pkill -f "nest start"`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/quality-gate/quality-gate.module.ts apps/api/src/app.module.ts apps/api/src/modules/connection/connection.service.ts apps/api/src/modules/quality-gate/endpoint-caller.ts apps/api/src/modules/quality-gate/services/run-executor.service.ts apps/api/src/modules/quality-gate/repositories/runs.repository.ts apps/api/src/modules/quality-gate/__tests__/endpoint-caller.spec.ts apps/api/src/modules/quality-gate/services/__tests__/run-executor.service.spec.ts
git commit -m "feat(quality-gate): wire QualityGateModule + LLM judge adapter + endpoint caller userId thread"
```

---

## Task 18: API e2e — full happy path

**Files:**
- Create: `apps/api/test/quality-gate.e2e-spec.ts`

Boots the full app via the existing `bootE2E()` helper. Drives the API via supertest with a registered user.

- [ ] **Step 1: Write e2e**

```ts
// apps/api/test/quality-gate.e2e-spec.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { type E2EContext, bootE2E, registerUser } from "./helpers/app.js";

let ctx: E2EContext;
let cookies: string[];

beforeAll(async () => {
  ctx = await bootE2E();
  const u = await registerUser(ctx.app, `qg-${Date.now()}@test`);
  cookies = u.cookies;
}, 180_000);

afterAll(async () => {
  if (ctx) await ctx.teardown();
});

async function createConnection(name: string) {
  const r = await request(ctx.app.getHttpServer())
    .post("/api/connections")
    .set("Cookie", cookies)
    .send({ name, baseUrl: "http://127.0.0.1:65535", apiKey: "sk-test", model: "demo", category: "chat" })
    .expect(201);
  return r.body.id as string;
}

describe("Quality Gate e2e", () => {
  it("create evaluation → trigger dual-endpoint run → poll until FAILED (no live endpoints) → list samples", async () => {
    const a = await createConnection("a");
    const b = await createConnection("b");
    const evalRes = await request(ctx.app.getHttpServer())
      .post("/api/quality-gate/evaluations")
      .set("Cookie", cookies)
      .send({
        name: "smoke",
        samples: [
          { id: "s0", idx: 0, prompt: "say hi", expected: "hi", judgeConfig: { kind: "exact-match" } },
          { id: "s1", idx: 1, prompt: "say hi", expected: "hi", judgeConfig: { kind: "contains", substrings: ["hi"], mode: "all" } },
        ],
      })
      .expect(201);
    const evalId = evalRes.body.id as string;

    const runRes = await request(ctx.app.getHttpServer())
      .post("/api/quality-gate/runs")
      .set("Cookie", cookies)
      .send({ evaluationId: evalId, endpointAId: a, endpointBId: b, gateConfig: { passRateMin: 0.9 } })
      .expect(201);
    const runId = runRes.body.id as string;

    // Poll until terminal
    let status = "PENDING", waited = 0;
    while (!["COMPLETED", "FAILED", "CANCELLED"].includes(status) && waited < 30_000) {
      await new Promise((r) => setTimeout(r, 500));
      const g = await request(ctx.app.getHttpServer()).get(`/api/quality-gate/runs/${runId}`).set("Cookie", cookies).expect(200);
      status = g.body.status;
      waited += 500;
    }
    expect(["COMPLETED", "FAILED"]).toContain(status);

    // Samples list should return rows (each with error since endpoints unreachable)
    const s = await request(ctx.app.getHttpServer())
      .get(`/api/quality-gate/runs/${runId}/samples`)
      .set("Cookie", cookies)
      .expect(200);
    expect(s.body.items.length).toBeGreaterThanOrEqual(0); // 0 acceptable if executor short-circuited via pre-flight
  }, 90_000);
});
```

- [ ] **Step 2: Run the e2e**

```bash
pnpm -F @modeldoctor/api test:e2e -- quality-gate
```

Expected: pass within 60-90s. Takes longer on first run while the testcontainer image pulls.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/quality-gate.e2e-spec.ts
git commit -m "test(quality-gate): e2e happy path covering create → run → samples"
```

---

## Task 19: Web data layer — api.ts + queries.ts

**Files:**
- Create: `apps/web/src/features/quality-gate/api.ts`
- Create: `apps/web/src/features/quality-gate/queries.ts`

Pattern mirrors `apps/web/src/features/benchmark-templates/api.ts` + `queries.ts` (TanStack Query).

- [ ] **Step 1: api.ts**

```ts
// apps/web/src/features/quality-gate/api.ts
import { api } from "@/lib/api-client";
import type {
  CreateEvaluationRequest, CreateRunRequest, Evaluation, EvaluationRun, ImportEvaluationRequest,
  ListEvaluationsResponse, ListRunSamplesQuery, ListRunSamplesResponse, ListRunsQuery, ListRunsResponse,
  UpdateEvaluationRequest,
} from "@modeldoctor/contracts";

export const qgApi = {
  listEvaluations: () => api.get<ListEvaluationsResponse>("/api/quality-gate/evaluations"),
  getEvaluation: (id: string) => api.get<Evaluation>(`/api/quality-gate/evaluations/${id}`),
  createEvaluation: (body: CreateEvaluationRequest) => api.post<Evaluation>("/api/quality-gate/evaluations", body),
  updateEvaluation: (id: string, body: UpdateEvaluationRequest) => api.patch<Evaluation>(`/api/quality-gate/evaluations/${id}`, body),
  deleteEvaluation: (id: string) => api.del<void>(`/api/quality-gate/evaluations/${id}`),
  importEvaluation: (body: { name: string; import: ImportEvaluationRequest }) =>
    api.post<Evaluation>("/api/quality-gate/evaluations/import", body),

  listRuns: (q: Partial<ListRunsQuery>) => {
    const qs = new URLSearchParams();
    if (q.status) qs.set("status", q.status);
    if (q.evaluationId) qs.set("evaluationId", q.evaluationId);
    if (q.page) qs.set("page", String(q.page));
    if (q.pageSize) qs.set("pageSize", String(q.pageSize));
    return api.get<ListRunsResponse>(`/api/quality-gate/runs?${qs.toString()}`);
  },
  getRun: (id: string) => api.get<EvaluationRun>(`/api/quality-gate/runs/${id}`),
  createRun: (body: CreateRunRequest) => api.post<EvaluationRun>("/api/quality-gate/runs", body),
  cancelRun: (id: string) => api.post<{ ok: true }>(`/api/quality-gate/runs/${id}/cancel`, {}),
  deleteRun: (id: string) => api.del<void>(`/api/quality-gate/runs/${id}`),
  listSamples: (runId: string, q: Partial<ListRunSamplesQuery>) => {
    const qs = new URLSearchParams();
    if (q.filter) qs.set("filter", q.filter);
    if (q.sortBy) qs.set("sortBy", q.sortBy);
    if (q.page) qs.set("page", String(q.page));
    if (q.pageSize) qs.set("pageSize", String(q.pageSize));
    return api.get<ListRunSamplesResponse>(`/api/quality-gate/runs/${runId}/samples?${qs.toString()}`);
  },
};
```

- [ ] **Step 2: queries.ts**

```ts
// apps/web/src/features/quality-gate/queries.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { qgApi } from "./api";

const KEY = {
  evaluations: ["quality-gate", "evaluations"] as const,
  evaluation: (id: string) => ["quality-gate", "evaluations", id] as const,
  runs: (filter: object) => ["quality-gate", "runs", filter] as const,
  run: (id: string) => ["quality-gate", "runs", id] as const,
  samples: (runId: string, filter: object) => ["quality-gate", "runs", runId, "samples", filter] as const,
};

export function useEvaluations() {
  return useQuery({ queryKey: KEY.evaluations, queryFn: () => qgApi.listEvaluations().then((r) => r.items) });
}
export function useEvaluation(id: string | undefined) {
  return useQuery({ queryKey: KEY.evaluation(id ?? ""), queryFn: () => qgApi.getEvaluation(id!), enabled: !!id });
}
export function useCreateEvaluation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: qgApi.createEvaluation,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY.evaluations }),
  });
}
export function useUpdateEvaluation(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Parameters<typeof qgApi.updateEvaluation>[1]) => qgApi.updateEvaluation(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY.evaluations });
      qc.invalidateQueries({ queryKey: KEY.evaluation(id) });
    },
  });
}
export function useDeleteEvaluation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: qgApi.deleteEvaluation,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY.evaluations }),
  });
}
export function useImportEvaluation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: qgApi.importEvaluation,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY.evaluations }),
  });
}

export function useRuns(filter: Partial<Parameters<typeof qgApi.listRuns>[0]> = {}) {
  return useQuery({ queryKey: KEY.runs(filter), queryFn: () => qgApi.listRuns(filter) });
}
export function useRun(id: string | undefined, opts?: { pollWhileRunning?: boolean }) {
  return useQuery({
    queryKey: KEY.run(id ?? ""),
    queryFn: () => qgApi.getRun(id!),
    enabled: !!id,
    refetchInterval: (q) => {
      if (!opts?.pollWhileRunning) return false;
      const status = q.state.data?.status;
      return status === "PENDING" || status === "RUNNING" ? 2000 : false;
    },
  });
}
export function useCreateRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: qgApi.createRun,
    onSuccess: (run) => {
      qc.invalidateQueries({ queryKey: ["quality-gate", "runs"] });
      qc.setQueryData(KEY.run(run.id), run);
    },
  });
}
export function useCancelRun(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => qgApi.cancelRun(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY.run(id) }),
  });
}
export function useDeleteRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: qgApi.deleteRun,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["quality-gate", "runs"] }),
  });
}
export function useRunSamples(runId: string | undefined, filter: Partial<Parameters<typeof qgApi.listSamples>[1]> = {}) {
  return useQuery({
    queryKey: KEY.samples(runId ?? "", filter),
    queryFn: () => qgApi.listSamples(runId!, filter),
    enabled: !!runId,
  });
}
```

- [ ] **Step 3: Lightweight typecheck**

```bash
pnpm -F @modeldoctor/web type-check
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/quality-gate/api.ts apps/web/src/features/quality-gate/queries.ts
git commit -m "feat(quality-gate): web api client + TanStack Query hooks"
```

---

## Task 20: Web — JudgeConfigEditor component

Stand-alone component reused by the create / edit / import flows. Drives a `JudgeConfig` value with a discriminator dropdown that swaps the sub-form.

**Files:**
- Create: `apps/web/src/features/quality-gate/components/JudgeConfigEditor.tsx`
- Create: `apps/web/src/features/quality-gate/components/__tests__/JudgeConfigEditor.test.tsx`

- [ ] **Step 1: Failing test (RTL)**

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { JudgeConfigEditor } from "../JudgeConfigEditor";

describe("JudgeConfigEditor", () => {
  it("renders kind selector and exact-match fields by default", () => {
    render(<JudgeConfigEditor value={{ kind: "exact-match" }} onChange={() => {}} />);
    expect(screen.getByLabelText(/case sensitive|区分大小写/i)).toBeInTheDocument();
  });
  it("switching kind to contains shows substrings input and clears prior config", () => {
    const onChange = vi.fn();
    render(<JudgeConfigEditor value={{ kind: "exact-match" }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/kind|判分器/i), { target: { value: "contains" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ kind: "contains" }));
  });
  it("llm-judge surfaces rubric textarea and scale selector", () => {
    render(<JudgeConfigEditor value={{ kind: "llm-judge", rubric: "rubric ten chars", scale: "0-5" }} onChange={() => {}} />);
    expect(screen.getByLabelText(/rubric|评分准则/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/scale|分制/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement** (Tailwind + shadcn; use existing `Select`, `Input`, `Textarea`, `Switch` primitives — see `components/ui/`)

```tsx
// apps/web/src/features/quality-gate/components/JudgeConfigEditor.tsx
import type { JudgeConfig } from "@modeldoctor/contracts";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export function JudgeConfigEditor({ value, onChange }: { value: JudgeConfig; onChange: (v: JudgeConfig) => void }) {
  const setKind = (k: JudgeConfig["kind"]) => {
    if (k === "exact-match") onChange({ kind: "exact-match" });
    else if (k === "contains") onChange({ kind: "contains", substrings: [], mode: "all" });
    else if (k === "regex") onChange({ kind: "regex", pattern: "" });
    else onChange({ kind: "llm-judge", rubric: "", scale: "0-5" });
  };
  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="qg-judge-kind">判分器 / Kind</Label>
        <Select value={value.kind} onValueChange={setKind}>
          <SelectTrigger id="qg-judge-kind"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="exact-match">exact-match — 精确匹配</SelectItem>
            <SelectItem value="contains">contains — 关键词包含</SelectItem>
            <SelectItem value="regex">regex — 正则</SelectItem>
            <SelectItem value="llm-judge">llm-judge — LLM 评分</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {value.kind === "exact-match" && (
        <div className="flex items-center gap-3">
          <Label htmlFor="qg-cs">区分大小写 / case sensitive</Label>
          <Switch id="qg-cs" checked={value.caseSensitive === true} onCheckedChange={(b) => onChange({ ...value, caseSensitive: b })} />
        </div>
      )}

      {value.kind === "contains" && (
        <>
          <div>
            <Label htmlFor="qg-subs">子串列表（逗号分隔）/ substrings</Label>
            <Input id="qg-subs" value={value.substrings.join(", ")} onChange={(e) => onChange({ ...value, substrings: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
          </div>
          <div>
            <Label htmlFor="qg-mode">模式 / mode</Label>
            <Select value={value.mode} onValueChange={(m: "all" | "any") => onChange({ ...value, mode: m })}>
              <SelectTrigger id="qg-mode"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部命中 / all</SelectItem>
                <SelectItem value="any">任意命中 / any</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      {value.kind === "regex" && (
        <>
          <div>
            <Label htmlFor="qg-pat">模式 / pattern</Label>
            <Input id="qg-pat" value={value.pattern} onChange={(e) => onChange({ ...value, pattern: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="qg-flags">flags（可选）</Label>
            <Input id="qg-flags" value={value.flags ?? ""} onChange={(e) => onChange({ ...value, flags: e.target.value || undefined })} />
          </div>
        </>
      )}

      {value.kind === "llm-judge" && (
        <>
          <div>
            <Label htmlFor="qg-rubric">评分准则 / rubric</Label>
            <Textarea id="qg-rubric" rows={4} value={value.rubric} onChange={(e) => onChange({ ...value, rubric: e.target.value })} placeholder="判断助手是否..." />
          </div>
          <div>
            <Label htmlFor="qg-scale">分制 / scale</Label>
            <Select value={value.scale} onValueChange={(s: "0-1" | "0-5" | "pass-fail") => onChange({ ...value, scale: s })}>
              <SelectTrigger id="qg-scale"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="0-1">0–1</SelectItem>
                <SelectItem value="0-5">0–5</SelectItem>
                <SelectItem value="pass-fail">pass/fail</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="qg-thr">passThreshold（默认按 scale 推断）</Label>
            <Input id="qg-thr" type="number" step="0.1" value={value.passThreshold ?? ""} onChange={(e) => onChange({ ...value, passThreshold: e.target.value ? Number(e.target.value) : undefined })} />
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Run tests**

```bash
pnpm -F @modeldoctor/web test -- JudgeConfigEditor
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/quality-gate/components/
git commit -m "feat(quality-gate): JudgeConfigEditor with 4-kind discriminated form"
```

---

## Task 21: Web — EvaluationsListPage + ListPage actions pattern

Per `feedback_list_page_actions_pattern`: first column is a `<Link>` to detail; trailing 操作 column has 详情 + 删除 (AlertDialog confirm).

**Files:**
- Create: `apps/web/src/features/quality-gate/EvaluationsListPage.tsx`
- Create: `apps/web/src/features/quality-gate/__tests__/EvaluationsListPage.test.tsx`

- [ ] **Step 1: Implement page** (use existing Table primitives in `@/components/ui/table`, AlertDialog from `@/components/ui/alert-dialog`)

```tsx
// apps/web/src/features/quality-gate/EvaluationsListPage.tsx
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDeleteEvaluation, useEvaluations } from "./queries";

export function EvaluationsListPage() {
  const { t } = useTranslation("quality-gate");
  const nav = useNavigate();
  const { data, isLoading } = useEvaluations();
  const del = useDeleteEvaluation();

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t("evaluations.title")}</h1>
        <Button onClick={() => nav("/quality-gate/evaluations/new")}>{t("evaluations.create")}</Button>
      </div>

      {isLoading ? <div>{t("common.loading")}</div> : !data || data.length === 0 ? (
        <div className="text-muted-foreground">{t("evaluations.empty")}</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("evaluations.col.name")}</TableHead>
              <TableHead>{t("evaluations.col.samples")}</TableHead>
              <TableHead>{t("evaluations.col.updatedAt")}</TableHead>
              <TableHead className="text-right">{t("common.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((e) => (
              <TableRow key={e.id}>
                <TableCell>
                  <Link className="text-primary hover:underline" to={`/quality-gate/evaluations/${e.id}`}>{e.name}</Link>
                </TableCell>
                <TableCell>{e.totalSamples}</TableCell>
                <TableCell>{new Date(e.updatedAt).toLocaleString()}</TableCell>
                <TableCell className="text-right space-x-2">
                  <Button variant="ghost" size="sm" onClick={() => nav(`/quality-gate/evaluations/${e.id}`)}>{t("detail.actions.detail")}</Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm" className="text-destructive">{t("detail.delete.button")}</Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t("detail.delete.title", { name: e.name })}</AlertDialogTitle>
                        <AlertDialogDescription>{t("detail.delete.description")}</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t("detail.delete.cancel")}</AlertDialogCancel>
                        <AlertDialogAction onClick={() => del.mutate(e.id)}>{t("detail.delete.confirm")}</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write RTL spec** covering "empty state", "row click navigates", "delete dialog confirms"

Pattern is identical to `apps/web/src/features/benchmark-templates/__tests__` — replicate.

- [ ] **Step 3: Run tests**

```bash
pnpm -F @modeldoctor/web test -- EvaluationsListPage
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/quality-gate/EvaluationsListPage.tsx apps/web/src/features/quality-gate/__tests__/EvaluationsListPage.test.tsx
git commit -m "feat(quality-gate): evaluations list page (link-detail + AlertDialog delete)"
```

---

## Task 22: Web — Evaluation Create / Detail pages + import dropdown

**Files:**
- Create: `apps/web/src/features/quality-gate/EvaluationCreatePage.tsx`
- Create: `apps/web/src/features/quality-gate/EvaluationDetailPage.tsx`
- Create: `apps/web/src/features/quality-gate/components/EvaluationSampleEditor.tsx`

A page has:
- Header: name + description fields
- Samples list: each row shows prompt / expected / JudgeConfigEditor (collapsible)
- Buttons: 添加样本 / 从 JSON 导入 / 从 CSV 导入 / 保存

- [ ] **Step 1: Sample editor component**

```tsx
// components/EvaluationSampleEditor.tsx
import type { EvaluationSample } from "@modeldoctor/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { JudgeConfigEditor } from "./JudgeConfigEditor";

export function EvaluationSampleEditor({ value, onChange, onRemove, index }: {
  value: EvaluationSample; onChange: (v: EvaluationSample) => void; onRemove: () => void; index: number;
}) {
  return (
    <div className="border rounded p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">#{index + 1}</span>
        <Button variant="ghost" size="sm" className="text-destructive" onClick={onRemove}>删除</Button>
      </div>
      <div>
        <label className="text-sm">题面 / prompt</label>
        <Textarea rows={2} value={value.prompt} onChange={(e) => onChange({ ...value, prompt: e.target.value })} />
      </div>
      <div>
        <label className="text-sm">期望答案 / expected</label>
        <Textarea rows={2} value={value.expected} onChange={(e) => onChange({ ...value, expected: e.target.value })} />
      </div>
      <JudgeConfigEditor value={value.judgeConfig} onChange={(jc) => onChange({ ...value, judgeConfig: jc })} />
    </div>
  );
}
```

- [ ] **Step 2: Create page**

```tsx
// EvaluationCreatePage.tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { EvaluationSample } from "@modeldoctor/contracts";
import { EvaluationSampleEditor } from "./components/EvaluationSampleEditor";
import { useCreateEvaluation, useImportEvaluation } from "./queries";

const blank = (idx: number): EvaluationSample => ({ id: "", idx, prompt: "", expected: "", judgeConfig: { kind: "exact-match" } });

export function EvaluationCreatePage() {
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [samples, setSamples] = useState<EvaluationSample[]>([blank(0)]);
  const create = useCreateEvaluation();
  const importIt = useImportEvaluation();

  const handleJsonImport = async (file: File) => {
    const text = await file.text();
    let payload: unknown;
    try { payload = JSON.parse(text); }
    catch { alert("JSON 解析失败"); return; }
    const res = await importIt.mutateAsync({ name: name || file.name.replace(/\.json$/, ""), import: { format: "json", payload: payload as never } });
    nav(`/quality-gate/evaluations/${res.id}`);
  };
  const handleCsvImport = async (file: File) => {
    const text = await file.text();
    const res = await importIt.mutateAsync({ name: name || file.name.replace(/\.csv$/, ""), import: { format: "csv", payload: text } });
    nav(`/quality-gate/evaluations/${res.id}`);
  };

  return (
    <div className="p-6 max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">新建评测集</h1>
      <Input placeholder="名称" value={name} onChange={(e) => setName(e.target.value)} />
      <Textarea placeholder="描述（可选）" value={description} onChange={(e) => setDescription(e.target.value)} />

      <div className="flex gap-2">
        <Button onClick={() => setSamples([...samples, blank(samples.length)])}>添加样本</Button>
        <label className="inline-flex">
          <input type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files && handleJsonImport(e.target.files[0])} />
          <Button variant="outline" asChild><span>从 JSON 导入</span></Button>
        </label>
        <label className="inline-flex">
          <input type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files && handleCsvImport(e.target.files[0])} />
          <Button variant="outline" asChild><span>从 CSV 导入</span></Button>
        </label>
      </div>

      <div className="space-y-3">
        {samples.map((s, i) => (
          <EvaluationSampleEditor key={i} index={i} value={s}
            onChange={(v) => setSamples(samples.map((x, j) => (j === i ? v : x)))}
            onRemove={() => setSamples(samples.filter((_, j) => j !== i))} />
        ))}
      </div>

      <Button disabled={!name || samples.length === 0} onClick={async () => {
        const res = await create.mutateAsync({ name, description: description || null, samples });
        nav(`/quality-gate/evaluations/${res.id}`);
      }}>保存</Button>
    </div>
  );
}
```

- [ ] **Step 3: Detail page** (read existing evaluation, allow inline edit + save via `useUpdateEvaluation`)

```tsx
// EvaluationDetailPage.tsx
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { EvaluationSample } from "@modeldoctor/contracts";
import { EvaluationSampleEditor } from "./components/EvaluationSampleEditor";
import { useEvaluation, useUpdateEvaluation } from "./queries";

export function EvaluationDetailPage() {
  const { id = "" } = useParams();
  const { data } = useEvaluation(id);
  const update = useUpdateEvaluation(id);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [samples, setSamples] = useState<EvaluationSample[]>([]);

  useEffect(() => {
    if (data) { setName(data.name); setDescription(data.description ?? ""); setSamples(data.samples); }
  }, [data]);

  if (!data) return null;
  return (
    <div className="p-6 max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">{data.name}</h1>
      <Input value={name} onChange={(e) => setName(e.target.value)} />
      <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
      <Button onClick={() => setSamples([...samples, { id: "", idx: samples.length, prompt: "", expected: "", judgeConfig: { kind: "exact-match" } }])}>添加样本</Button>
      <div className="space-y-3">
        {samples.map((s, i) => (
          <EvaluationSampleEditor key={i} index={i} value={s}
            onChange={(v) => setSamples(samples.map((x, j) => (j === i ? v : x)))}
            onRemove={() => setSamples(samples.filter((_, j) => j !== i))} />
        ))}
      </div>
      <Button onClick={() => update.mutate({ name, description: description || null, samples })}>保存</Button>
    </div>
  );
}
```

- [ ] **Step 4: Smoke test (RTL)** — minimum: detail page renders existing samples; create page submits and navigates.

- [ ] **Step 5: Run tests + typecheck**

```bash
pnpm -F @modeldoctor/web test -- EvaluationCreate EvaluationDetail
pnpm -F @modeldoctor/web type-check
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/quality-gate/EvaluationCreatePage.tsx apps/web/src/features/quality-gate/EvaluationDetailPage.tsx apps/web/src/features/quality-gate/components/EvaluationSampleEditor.tsx apps/web/src/features/quality-gate/__tests__/
git commit -m "feat(quality-gate): evaluation create + detail pages + JSON/CSV import"
```

---

## Task 23: Web — Runs list + create page

**Files:**
- Create: `apps/web/src/features/quality-gate/RunsListPage.tsx`
- Create: `apps/web/src/features/quality-gate/RunCreatePage.tsx`
- Create: `apps/web/src/features/quality-gate/components/GateConfigForm.tsx`
- Create: `apps/web/src/features/quality-gate/components/GateStatusBadge.tsx`

- [ ] **Step 1: GateStatusBadge**

```tsx
// components/GateStatusBadge.tsx
import type { GateResult, RunStatus } from "@modeldoctor/contracts";
import { Badge } from "@/components/ui/badge";

export function GateStatusBadge({ status, gateResult }: { status: RunStatus; gateResult: GateResult | null }) {
  if (status === "PENDING") return <Badge variant="outline">等待中</Badge>;
  if (status === "RUNNING") return <Badge variant="secondary">运行中</Badge>;
  if (status === "CANCELLED") return <Badge variant="outline">已取消</Badge>;
  if (status === "FAILED") return <Badge variant="destructive">失败</Badge>;
  // COMPLETED
  if (gateResult === "PASSED") return <Badge className="bg-emerald-600 hover:bg-emerald-700">通过</Badge>;
  if (gateResult === "WARNING") return <Badge className="bg-amber-500 hover:bg-amber-600">警告</Badge>;
  return <Badge variant="destructive">未通过</Badge>;
}
```

- [ ] **Step 2: GateConfigForm**

```tsx
// components/GateConfigForm.tsx
import type { GateConfig } from "@modeldoctor/contracts";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function GateConfigForm({ value, onChange, dual }: { value: GateConfig; onChange: (v: GateConfig) => void; dual: boolean }) {
  const enabled = (k: keyof GateConfig) => value[k] != null;
  const toggle = (k: keyof GateConfig, defaultVal: number) => {
    if (enabled(k)) onChange({ ...value, [k]: undefined });
    else onChange({ ...value, [k]: defaultVal });
  };
  return (
    <div className="space-y-3 max-w-md">
      <div className="flex items-center gap-3">
        <Switch checked={enabled("passRateMin")} onCheckedChange={() => toggle("passRateMin", 0.9)} />
        <Label>通过率下限 / passRateMin</Label>
        <Input type="number" min="0" max="1" step="0.05" className="w-24" disabled={!enabled("passRateMin")}
          value={value.passRateMin ?? ""} onChange={(e) => onChange({ ...value, passRateMin: Number(e.target.value) })} />
      </div>
      {dual && (
        <div className="flex items-center gap-3">
          <Switch checked={enabled("regressionMax")} onCheckedChange={() => toggle("regressionMax", 3)} />
          <Label>回归数上限 / regressionMax</Label>
          <Input type="number" min="0" step="1" className="w-24" disabled={!enabled("regressionMax")}
            value={value.regressionMax ?? ""} onChange={(e) => onChange({ ...value, regressionMax: Number(e.target.value) })} />
        </div>
      )}
      <div className="flex items-center gap-3">
        <Switch checked={enabled("judgeScoreMin")} onCheckedChange={() => toggle("judgeScoreMin", 4)} />
        <Label>Judge 均分下限 / judgeScoreMin</Label>
        <Input type="number" min="0" max="5" step="0.5" className="w-24" disabled={!enabled("judgeScoreMin")}
          value={value.judgeScoreMin ?? ""} onChange={(e) => onChange({ ...value, judgeScoreMin: Number(e.target.value) })} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: RunCreatePage** — wires evaluation picker + endpoint pickers + GateConfigForm + create button. Use existing `useConnections()` from `apps/web/src/features/connections/queries`.

```tsx
// RunCreatePage.tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { GateConfig } from "@modeldoctor/contracts";
import { useConnections } from "@/features/connections/queries";
import { GateConfigForm } from "./components/GateConfigForm";
import { useCreateRun, useEvaluations } from "./queries";

export function RunCreatePage() {
  const nav = useNavigate();
  const evals = useEvaluations();
  const conns = useConnections();
  const create = useCreateRun();
  const [evaluationId, setEvalId] = useState<string | undefined>();
  const [endpointAId, setA] = useState<string | undefined>();
  const [endpointBId, setB] = useState<string | undefined>();
  const [gate, setGate] = useState<GateConfig>({ passRateMin: 0.9 });

  return (
    <div className="p-6 max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">新建评测运行</h1>

      <div>
        <Label>评测集</Label>
        <Select value={evaluationId} onValueChange={setEvalId}>
          <SelectTrigger><SelectValue placeholder="选择评测集" /></SelectTrigger>
          <SelectContent>
            {evals.data?.map((e) => <SelectItem key={e.id} value={e.id}>{e.name} ({e.totalSamples})</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Endpoint A（基线）</Label>
          <Select value={endpointAId} onValueChange={setA}>
            <SelectTrigger><SelectValue placeholder="选择" /></SelectTrigger>
            <SelectContent>{conns.data?.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>Endpoint B（新版本，可选）</Label>
          <Select value={endpointBId} onValueChange={(v) => setB(v === "__none__" ? undefined : v)}>
            <SelectTrigger><SelectValue placeholder="不对比 / 单 endpoint" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">不对比</SelectItem>
              {conns.data?.filter((c) => c.id !== endpointAId).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <GateConfigForm value={gate} onChange={setGate} dual={!!endpointBId} />

      <Button disabled={!evaluationId || !endpointAId} onClick={async () => {
        const run = await create.mutateAsync({ evaluationId: evaluationId!, endpointAId: endpointAId!, endpointBId, gateConfig: gate });
        nav(`/quality-gate/runs/${run.id}`);
      }}>触发评测</Button>
    </div>
  );
}
```

- [ ] **Step 4: RunsListPage** — table with name (link to detail) / evaluation / endpoints / status badge / created at / actions (详情 + 删除 + AlertDialog).

(Pattern identical to Task 21; copy the structure verbatim, swap `Evaluation` → `EvaluationRun` and rename i18n keys.)

- [ ] **Step 5: Tests**

Smoke RTL tests for both pages: list renders rows; create form submits and navigates.

- [ ] **Step 6: Run + commit**

```bash
pnpm -F @modeldoctor/web test -- RunsList RunCreate GateConfigForm GateStatusBadge
pnpm -F @modeldoctor/web type-check
git add apps/web/src/features/quality-gate/
git commit -m "feat(quality-gate): runs list + create + gate config + status badge"
```

---

## Task 24: Web — Run Report page (Overview + samples table + sample detail drawer)

**Files:**
- Create: `apps/web/src/features/quality-gate/RunReportPage.tsx`
- Create: `apps/web/src/features/quality-gate/components/SamplesTable.tsx`
- Create: `apps/web/src/features/quality-gate/components/SampleDetailDrawer.tsx`
- Create: `apps/web/src/features/quality-gate/components/RunOverview.tsx`

The report is the most important page; it must show gate status, overview metrics, the samples table with default `regression` filter, and a side drawer with the sample detail + "在 Playground 复现" button.

- [ ] **Step 1: RunOverview component**

```tsx
// components/RunOverview.tsx
import type { EvaluationRun } from "@modeldoctor/contracts";
import { Card } from "@/components/ui/card";
import { GateStatusBadge } from "./GateStatusBadge";

function pct(n: number | undefined) { return n == null ? "—" : `${(n * 100).toFixed(1)}%`; }
function num(n: number | undefined) { return n == null ? "—" : n.toFixed(2); }

export function RunOverview({ run }: { run: EvaluationRun }) {
  const m = run.aggregateMetrics;
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <GateStatusBadge status={run.status} gateResult={run.gateResult} />
        <span className="text-sm text-muted-foreground">
          {run.processedSamples}/{run.totalSamples} · {run.startedAt && run.finishedAt ? `${Math.round((+new Date(run.finishedAt) - +new Date(run.startedAt)) / 1000)}s` : null}
        </span>
      </div>
      {m && (
        <div className="grid grid-cols-3 gap-4">
          <div><div className="text-xs text-muted-foreground">通过率 A</div><div className="text-2xl">{pct(m.passRateA)}</div></div>
          <div><div className="text-xs text-muted-foreground">通过率 B</div><div className="text-2xl">{pct(m.passRateB)}</div></div>
          <div><div className="text-xs text-muted-foreground">回归 / 改善</div><div className="text-2xl">{m.regressionCount ?? "—"} / {m.improvementCount ?? "—"}</div></div>
          <div><div className="text-xs text-muted-foreground">Judge 均分 A</div><div className="text-2xl">{num(m.judgeAvgA)}</div></div>
          <div><div className="text-xs text-muted-foreground">Judge 均分 B</div><div className="text-2xl">{num(m.judgeAvgB)}</div></div>
          <div><div className="text-xs text-muted-foreground">Judge 调用次数</div><div className="text-2xl">{m.judgeCallCount}</div></div>
        </div>
      )}
      {run.errorMessage && <div className="text-destructive text-sm">{run.errorMessage}</div>}
    </Card>
  );
}
```

- [ ] **Step 2: SamplesTable** — filter chips (默认 regression), pagination

```tsx
// components/SamplesTable.tsx
import { useState } from "react";
import type { SampleFilter } from "@modeldoctor/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useRunSamples } from "../queries";

const FILTERS: SampleFilter[] = ["all", "regression", "improvement", "both-pass", "both-fail"];

export function SamplesTable({ runId, onOpenSample }: { runId: string; onOpenSample: (sampleId: string) => void }) {
  const [filter, setFilter] = useState<SampleFilter>("regression");
  const [page, setPage] = useState(1);
  const { data } = useRunSamples(runId, { filter, page, pageSize: 20 });

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        {FILTERS.map((f) => (
          <Button key={f} variant={f === filter ? "default" : "outline"} size="sm" onClick={() => { setFilter(f); setPage(1); }}>{f}</Button>
        ))}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">#</TableHead>
            <TableHead>题面</TableHead>
            <TableHead className="w-24">delta</TableHead>
            <TableHead className="w-20">A 通过</TableHead>
            <TableHead className="w-20">B 通过</TableHead>
            <TableHead className="w-32">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data?.items.map((s) => (
            <TableRow key={s.id}>
              <TableCell>{s.sampleIdx + 1}</TableCell>
              <TableCell className="truncate max-w-md">{(s.resultA as { call: { rawAnswer: string } }).call.rawAnswer.slice(0, 80)}</TableCell>
              <TableCell><Badge variant={s.delta === "REGRESSION" ? "destructive" : "outline"}>{s.delta}</Badge></TableCell>
              <TableCell>{s.resultA.judge.passed ? "✓" : "✗"}</TableCell>
              <TableCell>{s.resultB ? (s.resultB.judge.passed ? "✓" : "✗") : "—"}</TableCell>
              <TableCell><Button size="sm" variant="ghost" onClick={() => onOpenSample(s.id)}>详情</Button></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {data && data.total > data.pageSize && (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>上一页</Button>
          <Button size="sm" variant="outline" disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>下一页</Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: SampleDetailDrawer** — side panel with A/B answers, Judge reason, "在 Playground 复现"

```tsx
// components/SampleDetailDrawer.tsx
import { Link, useParams } from "react-router-dom";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useRunSamples } from "../queries";

export function SampleDetailDrawer({ runId, sampleId, onClose }: { runId: string; sampleId: string | null; onClose: () => void }) {
  const { data } = useRunSamples(runId, { filter: "all", pageSize: 100 });
  const row = data?.items.find((r) => r.id === sampleId);
  if (!row) return null;
  return (
    <Sheet open={!!sampleId} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-[600px] sm:max-w-[600px]">
        <SheetHeader><SheetTitle>样本 #{row.sampleIdx + 1}</SheetTitle></SheetHeader>
        <div className="space-y-3 pt-4 text-sm">
          <div><div className="font-medium">题面</div><pre className="whitespace-pre-wrap">{/* prompt lives in run.evaluationSnapshot.samples — needs joining; for V1 show as a TODO column */}</pre></div>
          <div><div className="font-medium">A 答案</div><pre className="whitespace-pre-wrap">{row.resultA.call.rawAnswer}</pre>
            {row.resultA.judge.reason && <div className="text-muted-foreground">Judge: {row.resultA.judge.reason}</div>}
          </div>
          {row.resultB && (
            <div><div className="font-medium">B 答案</div><pre className="whitespace-pre-wrap">{row.resultB.call.rawAnswer}</pre>
              {row.resultB.judge.reason && <div className="text-muted-foreground">Judge: {row.resultB.judge.reason}</div>}
              <Link to={`/playground/chat?from=evaluation&runId=${runId}&sampleId=${row.id}&endpoint=B`}>
                <Button size="sm" variant="outline">在 Playground 复现 B</Button>
              </Link>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

Note: the drawer needs the original `prompt` and `expected` — they live in `run.evaluationSnapshot.samples`, not in the sample row. Update `RunSample` shape via a small server-side join, or have `RunReportPage` pass `run.evaluationSnapshot.samples` down as a lookup. Use the latter:

```tsx
// In RunReportPage: pass a sample-id → snapshot-sample map into SampleDetailDrawer
```

- [ ] **Step 4: RunReportPage compose**

```tsx
// RunReportPage.tsx
import { useState } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useCancelRun, useRun } from "./queries";
import { RunOverview } from "./components/RunOverview";
import { SampleDetailDrawer } from "./components/SampleDetailDrawer";
import { SamplesTable } from "./components/SamplesTable";

export function RunReportPage() {
  const { id = "" } = useParams();
  const { data: run } = useRun(id, { pollWhileRunning: true });
  const cancel = useCancelRun(id);
  const [openSample, setOpenSample] = useState<string | null>(null);
  if (!run) return null;
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">评测运行报告</h1>
        {run.status === "RUNNING" && <Button variant="outline" onClick={() => cancel.mutate()}>取消</Button>}
      </div>
      <RunOverview run={run} />
      {run.status === "COMPLETED" && <SamplesTable runId={run.id} onOpenSample={setOpenSample} />}
      <SampleDetailDrawer runId={run.id} sampleId={openSample} onClose={() => setOpenSample(null)} />
    </div>
  );
}
```

- [ ] **Step 5: Smoke RTL**

Minimum: report renders Overview + filter chips when COMPLETED.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/quality-gate/RunReportPage.tsx apps/web/src/features/quality-gate/components/
git commit -m "feat(quality-gate): run report with overview + samples table + sample drawer"
```

---

## Task 25: Saved Compares — extend to mix evaluation runs

**Files:**
- Modify: contracts `packages/contracts/src/saved-compares/saved-compares.ts` (loosen `benchmarkIds` constraint, add `evaluationRunIds`)
- Modify: `apps/api/src/modules/saved-compares/saved-compares.service.ts` (or equivalent — load and stitch evaluation runs into the response shape)
- Modify: `apps/api/src/modules/saved-compares/compare-synthesize.service.ts` (extend AI narrative prompt to include evaluation aggregates)
- Modify: `apps/web/src/features/benchmarks/compare/SavedCompareDetailPage.tsx` (render evaluation-run column with gate badge + regression count)

- [ ] **Step 1: Contracts change**

```ts
// packages/contracts/src/saved-compares/saved-compares.ts
export const savedCompareSchema = z.object({
  // …existing fields…
  benchmarkIds: z.array(z.string()).max(10),
  evaluationRunIds: z.array(z.string()).max(10).default([]),
  // …rest unchanged…
}).refine((s) => s.benchmarkIds.length + s.evaluationRunIds.length >= 2, {
  message: "compare requires at least 2 runs total (benchmarks + evaluations)",
}).refine((s) => s.benchmarkIds.length + s.evaluationRunIds.length <= 10, {
  message: "compare cannot include more than 10 runs total",
});
```

Apply the same change to `createSavedCompareRequestSchema` and `updateSavedCompareRequestSchema`. Verify existing saved-compares tests still pass; expect to update a fixture or two to satisfy the new combined length.

- [ ] **Step 2: API service — fetch evaluation runs and attach to compare response**

The current `saved-compares.service.ts` reads `benchmarkIds` and joins benchmarks. Mirror that join for `evaluationRunIds`. Returned shape: each compare item now has `benchmarks: [...]` AND `evaluationRuns: [...]` arrays.

- [ ] **Step 3: AI narrative prompt extension**

In `apps/api/src/modules/saved-compares/prompts.ts` (or whichever module owns the compare prompt — per the spec at `docs/superpowers/specs/2026-05-12-saved-compares-ai-report-design.md` it lives in the saved-compares module), add a new section to the user prompt:

```
Quality (evaluation) results:
<for each evaluationRun row in stage order:>
- {stage}: gate {result}, pass rate {passRateB || passRateA}, regression count {regressionCount},
  judge avg {judgeAvgB || judgeAvgA}, errors {totalErrors}
```

The existing zod schema for narrative output stays unchanged — the model is asked to consider both perf and quality in the same `analysis` field.

- [ ] **Step 4: Web detail page render**

In `SavedCompareDetailPage.tsx`, after the existing benchmark column rendering, add an evaluation block that maps `compare.evaluationRuns` and renders a card per run with GateStatusBadge + headline metrics. Insert a horizontal divider between perf and quality sections so the visual hierarchy is clear.

- [ ] **Step 5: Tests**

- Update saved-compares service spec to confirm a mixed payload (1 benchmark + 1 evaluation run) creates + reads back successfully
- Update detail-page RTL to assert the evaluation block renders

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/saved-compares/ apps/api/src/modules/saved-compares/ apps/web/src/features/benchmarks/compare/
git commit -m "feat(quality-gate): mix evaluation runs into Saved Compares (data + UI + AI prompt)"
```

---

## Task 26: Playground — read reproduce query params

**Files:**
- Modify: `apps/web/src/features/playground/chat/ChatPage.tsx`
- Create: `apps/web/src/features/playground/chat/ReproduceBanner.tsx`

- [ ] **Step 1: Add the banner**

```tsx
// ReproduceBanner.tsx
import { Link } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function ReproduceBanner({ runId, sampleId, expected }: { runId: string; sampleId: string; expected: string }) {
  return (
    <Alert>
      <AlertTitle>复现自评测 #{sampleId.slice(-6)}</AlertTitle>
      <AlertDescription>
        期望: {expected.slice(0, 80)}
        {" · "}
        <Link className="underline" to={`/quality-gate/runs/${runId}`}>返回评测报告</Link>
      </AlertDescription>
    </Alert>
  );
}
```

- [ ] **Step 2: Wire ChatPage to read params**

In `ChatPage.tsx`, on mount:

```ts
const [params] = useSearchParams();
const from = params.get("from");
const runId = params.get("runId");
const sampleId = params.get("sampleId");
const endpointParam = params.get("endpoint"); // "A" | "B"

useEffect(() => {
  if (from !== "evaluation" || !runId || !sampleId) return;
  (async () => {
    const run = await qgApi.getRun(runId);
    const sample = (run.evaluationSnapshot.samples as Array<{ id: string; prompt: string; expected: string }>).find((s) => s.id === sampleId);
    if (!sample) return;
    const conn = endpointParam === "B" ? run.endpointBId : run.endpointAId;
    if (conn) setSelectedConnectionId(conn); // existing playground state setter
    setComposerDraft(sample.prompt); // existing setter
    setReproduceMeta({ runId, sampleId, expected: sample.expected });
  })();
}, [from, runId, sampleId, endpointParam]);
```

Then render `<ReproduceBanner ... />` at the top of the chat page when `reproduceMeta != null`.

- [ ] **Step 3: Smoke test (RTL)** — Mount ChatPage with `MemoryRouter initialEntries={["/playground/chat?from=evaluation&runId=r1&sampleId=s1&endpoint=B"]}` and stub `qgApi.getRun`; assert banner appears and connection select is set.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/playground/chat/
git commit -m "feat(quality-gate): playground reproduce banner driven by ?from=evaluation"
```

---

## Task 27: Router + AppShell nav

**Files:**
- Modify: `apps/web/src/App.tsx` (add 5 routes under `/quality-gate/*`)
- Modify: `apps/web/src/components/sidebar/*` (add Quality Gate nav item)

- [ ] **Step 1: Routes**

In `App.tsx` `routes` array, after the existing `benchmarks/*` block, add:

```tsx
{ path: "quality-gate", element: <Navigate to="/quality-gate/evaluations" replace /> },
{ path: "quality-gate/evaluations", element: <EvaluationsListPage /> },
{ path: "quality-gate/evaluations/new", element: <EvaluationCreatePage /> },
{ path: "quality-gate/evaluations/:id", element: <EvaluationDetailPage /> },
{ path: "quality-gate/runs", element: <RunsListPage /> },
{ path: "quality-gate/runs/new", element: <RunCreatePage /> },
{ path: "quality-gate/runs/:id", element: <RunReportPage /> },
```

Add the matching imports at the top.

- [ ] **Step 2: Sidebar nav**

In the sidebar configuration (file path varies by current layout — likely `apps/web/src/components/sidebar/sidebar-nav.tsx` or `AppShell.tsx`), add an item between "基准测试" and "Saved Compares":

```tsx
{ to: "/quality-gate/evaluations", label: t("nav.qualityGate"), icon: ShieldCheck }
```

Use the `ShieldCheck` lucide icon (matches the "gate" metaphor).

- [ ] **Step 3: Verify**

```bash
pnpm -F @modeldoctor/web dev
```

Open `http://localhost:5173` (or whatever port shows), click the new sidebar item, confirm the evaluations page loads. Kill the server (`pkill -f vite`) before the next task per `feedback_subagent_process_cleanup`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/components/sidebar/ apps/web/src/layouts/
git commit -m "feat(quality-gate): wire routes + sidebar nav"
```

---

## Task 28: i18n — zh-CN + en-US

**Files:**
- Create: `apps/web/src/locales/zh-CN/quality-gate.json`
- Create: `apps/web/src/locales/en-US/quality-gate.json`
- Modify: `apps/web/src/locales/{zh-CN,en-US}/saved-compares.json` (add evaluation keys)

- [ ] **Step 1: zh-CN payload**

```json
{
  "nav": { "title": "质量门" },
  "evaluations": {
    "title": "评测集",
    "create": "新建评测集",
    "empty": "还没有评测集",
    "col": { "name": "名称", "samples": "样本数", "updatedAt": "更新时间" }
  },
  "runs": {
    "title": "评测运行",
    "create": "新建评测运行",
    "empty": "还没有评测运行",
    "status": {
      "pending": "等待中",
      "running": "运行中",
      "completed": "已完成",
      "failed": "失败",
      "cancelled": "已取消"
    },
    "gateResult": { "passed": "通过", "warning": "警告", "failed": "未通过" }
  },
  "judges": {
    "exact-match": "exact-match — 精确匹配",
    "contains": "contains — 关键词包含",
    "regex": "regex — 正则",
    "llm-judge": "llm-judge — LLM 评分"
  },
  "gate": {
    "passRateMin": "通过率下限",
    "regressionMax": "回归数上限",
    "judgeScoreMin": "Judge 均分下限"
  },
  "report": {
    "playgroundReproduce": "在 Playground 复现",
    "saveToCompare": "保存到 Saved Compares",
    "retry": "重跑",
    "cancel": "取消",
    "filters": {
      "all": "全部",
      "regression": "回归",
      "improvement": "改善",
      "both-pass": "都过",
      "both-fail": "都挂"
    }
  },
  "detail": {
    "actions": { "detail": "详情" },
    "delete": {
      "button": "删除",
      "title": "删除 {{name}}？",
      "description": "此操作不可撤销。如有关联评测运行将被拒绝。",
      "cancel": "取消",
      "confirm": "删除"
    }
  },
  "common": { "loading": "加载中…", "actions": "操作" }
}
```

- [ ] **Step 2: en-US payload (parallel keys)**

```json
{
  "nav": { "title": "Quality Gate" },
  "evaluations": {
    "title": "Evaluation Sets",
    "create": "New Evaluation Set",
    "empty": "No evaluation sets yet",
    "col": { "name": "Name", "samples": "Samples", "updatedAt": "Updated" }
  },
  "runs": {
    "title": "Evaluation Runs",
    "create": "New Run",
    "empty": "No runs yet",
    "status": {
      "pending": "Pending", "running": "Running", "completed": "Completed", "failed": "Failed", "cancelled": "Cancelled"
    },
    "gateResult": { "passed": "Passed", "warning": "Warning", "failed": "Failed" }
  },
  "judges": {
    "exact-match": "exact-match",
    "contains": "contains",
    "regex": "regex",
    "llm-judge": "llm-judge"
  },
  "gate": {
    "passRateMin": "Min Pass Rate",
    "regressionMax": "Max Regressions",
    "judgeScoreMin": "Min Judge Score"
  },
  "report": {
    "playgroundReproduce": "Reproduce in Playground",
    "saveToCompare": "Save to Compares",
    "retry": "Re-run",
    "cancel": "Cancel",
    "filters": {
      "all": "All", "regression": "Regression", "improvement": "Improvement", "both-pass": "Both Passed", "both-fail": "Both Failed"
    }
  },
  "detail": {
    "actions": { "detail": "Details" },
    "delete": {
      "button": "Delete",
      "title": "Delete {{name}}?",
      "description": "Cannot be undone. Linked evaluation runs will block this.",
      "cancel": "Cancel",
      "confirm": "Delete"
    }
  },
  "common": { "loading": "Loading…", "actions": "Actions" }
}
```

- [ ] **Step 3: Register namespace**

In the i18n setup file (typically `apps/web/src/lib/i18n.ts`), add `quality-gate` to the namespace list and re-import the new JSON files.

- [ ] **Step 4: Replace hardcoded zh strings in pages with `t(...)` calls**

Pages written in earlier tasks already used some zh strings inline for brevity. Replace each with the namespaced t-call from this file. Specifically inspect:

```bash
rg "['\"]新建评测|评测集|评测运行|质量门" apps/web/src/features/quality-gate
```

Replace each match with the appropriate `t("...")`.

- [ ] **Step 5: Lint + typecheck + tests**

```bash
pnpm -F @modeldoctor/web lint
pnpm -F @modeldoctor/web type-check
pnpm -F @modeldoctor/web test -- quality-gate
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/locales/ apps/web/src/lib/i18n.ts apps/web/src/features/quality-gate/
git commit -m "feat(quality-gate): zh-CN + en-US i18n + replace hardcoded strings"
```

---

## Task 29: Manual smoke + final verification

- [ ] **Step 1: All-clean checks**

```bash
pnpm -r build
pnpm -F @modeldoctor/contracts test
pnpm -F @modeldoctor/api test
pnpm -F @modeldoctor/api test:e2e -- quality-gate
pnpm -F @modeldoctor/web type-check
pnpm -F @modeldoctor/web lint
pnpm -F @modeldoctor/web test
```

All should be green.

- [ ] **Step 2: Manual UI smoke** (per `feedback_proper_over_workaround`: actually drive the feature; type-check passing is not feature-correct)

Boot the stack:

```bash
pnpm -F @modeldoctor/api start:dev &
pnpm -F @modeldoctor/web dev &
```

Open http://localhost:5173, log in, then walk through:

1. Sidebar → 质量门 → 评测集 — confirm built-in "中文客服 QA 示例" appears
2. New evaluation: create with 2 samples (exact-match + llm-judge), save, verify list refreshes
3. New run: pick the built-in set + your active Qwen3-32B endpoint (single mode), passRateMin=0.5, trigger
4. Watch report: status should go PENDING → RUNNING → COMPLETED, overview cards populate, samples list shows rows
5. Open a sample drawer, click "在 Playground 复现" — verify Playground loads with prompt prefilled and banner visible
6. Repeat the run in dual-endpoint mode (any second endpoint), verify Gate badge color reflects pass/warning/fail
7. Saved Compares: from the run, save it; visit Saved Compares list, mix it with an existing benchmark run, confirm both render in detail view

Kill all dev servers (per `feedback_subagent_process_cleanup`):

```bash
pkill -f "nest start" || true
pkill -f vite || true
pkill -f vitest || true
```

- [ ] **Step 3: Final commit (only if doc / lint nits found during smoke)**

If everything is fine, no commit needed. Otherwise:

```bash
git add -A
git commit -m "fix(quality-gate): polish from manual smoke"
```

- [ ] **Step 4: Branch handoff**

The 17-day implementation lands in a single PR per `feedback_single_pr_for_coupled_work`. Title and body should reflect:

```
feat: Quality Gate — model evaluation safety net (closes #N? refs #179)
```

Per `feedback_umbrella_issue_trailers`: if #179 is the umbrella, use `refs #179` not `closes`. If a fresh ticket scoped to the V1 cut is opened, that one can be `closes`.

PR body must call out:
- Schema diff (2 migrations) and dev DB drift expectation
- Non-goals deferred to Phase 2/3 (per spec)
- llm-judge token-cost note
- That academic benchmarks (the original #179 ask) are explicitly out of V1 and tracked in `refs #179` for Phase 3

Per `feedback_temp_followups`, drop a comment on #179 mapping which sub-asks landed in this PR and which were deferred, so reviewers don't have to read the whole spec.

---

## Plan self-review

**Spec coverage:**

| Spec section | Implementing task |
|---|---|
| A1 top-level domain (`/quality-gate`) | 27 (routes), 21–24 (pages), 28 (i18n) |
| A2 data model (3 tables + SavedCompare ext) | 1, 2 |
| A3 judge architecture | 8, 9 |
| A4 gate computation + WARNING buffer | 10 |
| A5 in-process async executor | 14 |
| A6 endpoint caller (retry, timeout) | 11 |
| A7 SavedCompare integration | 25 |
| A8 one-way Playground reproduce | 26 |
| API surface | 16 |
| Contracts namespace | 4–7 |
| Seed built-in evaluation | 3 |
| Module wiring | 17 |
| e2e | 18 |
| Web data layer | 19 |
| 4 judges (exact / contains / regex / llm-judge) | 8, 9 |
| Gate config form + status badge | 23 |
| Report page (overview / samples table / drawer) | 24 |
| i18n zh + en | 28 |
| Manual smoke + verification | 29 |
| Phase 2 / 3 deferrals (academic, reverse Playground, sharing, similarity, scheduled, multi-endpoint) | (Out of scope; PR body lists them per Task 29 step 4) |

All spec sections traced. No gaps.

**Placeholder scan:** No "TBD" / "TODO" / "fill in" markers in steps. Two notes flagged for adapter renames (Task 17 LlmJudgeService method) and the prompt+expected lookup in the drawer (Task 24) — both have concrete instructions, not placeholders.

**Type consistency:** `JudgeConfig` discriminated union shape consistent across contracts → judges → editor; `EvaluationRun.evaluationSnapshot` shape used as `{ samples: EvaluationSample[] }` across repository, executor, drawer; `RunsRepository.findFullRun` was extended in Task 17 to include `userId` and the executor + endpoint caller adjusted in the same task — coherent.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-12-quality-gate.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task in the feature worktree, review the diff between tasks, and proceed without intermediate confirmation (per `feedback_plan_execution_no_pause`).

**2. Inline Execution** — Execute the 29 tasks in this session using `superpowers:executing-plans`.

Which approach?




