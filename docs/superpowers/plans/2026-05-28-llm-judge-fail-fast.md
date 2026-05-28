# LLM Judge fail-fast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop reporting "missing LLM judge provider" as a fake 0% quality fail. Reject `POST /api/quality-gate/runs` with `400` at creation time when the evaluation needs an `llm-judge` but no enabled provider exists, and remove the dead `judgeModel.connectionId` schema field.

**Architecture:** Add a single guard call inside `RunsService.create()` (the one funnel for all run creations) that consults `LlmJudgeService.getDecrypted()` before persisting a PENDING row. Delete the phantom `judgeModel` field from contracts + the matching plumbing in the judge factory — no DB migration needed (verified 0 rows carry it).

**Tech Stack:** TypeScript, NestJS, Vitest (api e2e via supertest), pnpm workspaces, Prisma over Postgres (`modeldoctor_test` DB for e2e).

**Spec:** [`docs/superpowers/specs/2026-05-28-llm-judge-fail-fast-design.md`](../specs/2026-05-28-llm-judge-fail-fast-design.md)

**Branch:** `fix/llm-judge-fail-fast` (already created; spec committed as `c9e77f0`)

---

## File map

| File | Action | Why |
|---|---|---|
| `packages/contracts/src/quality-gate/judge-config.ts` | Modify (delete L27) | Remove phantom `judgeModel` schema field |
| `apps/api/src/modules/quality-gate/judges/llm-judge.ts` | Modify (L6-7 comment, L9 interface, L53 call site) | Remove dead `connectionId` plumbing; tighten comment |
| `apps/api/src/modules/quality-gate/services/runs.service.ts` | Modify (inject `LlmJudgeService`, add guard in `create()`) | Core fail-fast behavior |
| `apps/api/test/e2e/quality-gate.e2e-spec.ts` | Modify (append new `describe` block, 4 cases) | E2E coverage for the guard |

No new files. No DB migration. No web-side change.

---

## Task 1: Cleanup phantom `judgeModel` field (no behavioral change)

**Files:**
- Modify: `packages/contracts/src/quality-gate/judge-config.ts:27`
- Modify: `apps/api/src/modules/quality-gate/judges/llm-judge.ts:6-9,53`

- [ ] **Step 1: Verify current state — exactly 2 source-code hits expected**

Run:
```bash
cd /Users/fangyong/vllm/modeldoctor/main
rg -n 'judgeModel' apps packages 2>/dev/null
```

Expected output (exactly 2 lines):
```
apps/api/src/modules/quality-gate/judges/llm-judge.ts:53:          connectionId: config.judgeModel?.connectionId,
packages/contracts/src/quality-gate/judge-config.ts:27:  judgeModel: z.object({ connectionId: z.string() }).optional(),
```

If you see more than these 2, stop and investigate — the dead-code sweep was wrong.

- [ ] **Step 2: Remove `judgeModel` from the `llmJudge` schema**

In `packages/contracts/src/quality-gate/judge-config.ts`, locate the `llmJudge` z.object (lines 22-28) and delete line 27:

```diff
 const llmJudge = z.object({
   kind: z.literal("llm-judge"),
   rubric: z.string().min(10).max(4000),
   scale: z.enum(["0-1", "0-5", "pass-fail"]),
   passThreshold: z.number().optional(),
-  judgeModel: z.object({ connectionId: z.string() }).optional(),
 });
```

- [ ] **Step 3: Remove `connectionId` from the `LlmJudgeService` interface + the call site, and tighten the comment**

In `apps/api/src/modules/quality-gate/judges/llm-judge.ts`, replace the comment block (lines 6-7) and the interface (lines 8-12):

```diff
-// Thin shape from the AI Diagnostics service: factory only needs runJudge(prompts) → { content }.
-// At wiring time the real adapter delegates to the diagnostics service.
+// Thin shape over the singleton LLM judge provider. At wiring time the real
+// adapter delegates to `LlmJudgeService.getDecrypted()` + `chatCompletion`.
 export interface LlmJudgeService {
-  runJudge(input: { systemPrompt: string; userPrompt: string; connectionId?: string }): Promise<{
+  runJudge(input: { systemPrompt: string; userPrompt: string }): Promise<{
     content: string;
   }>;
 }
```

And in the same file, inside `createLlmJudge(service)` → `evaluate()` (around line 49-54), drop the `connectionId` arg:

```diff
         const resp = await service.runJudge({
           systemPrompt: buildSystemPrompt(config.rubric, config.scale),
           userPrompt: buildUserPrompt(ctx),
-          connectionId: config.judgeModel?.connectionId,
         });
```

- [ ] **Step 4: Verify zero remaining references**

Run:
```bash
rg -n 'judgeModel' apps packages 2>/dev/null
```

Expected: empty output (exit code 1 from ripgrep is normal here — it means no matches).

- [ ] **Step 5: Build contracts so the api can consume the new types**

Run:
```bash
pnpm -F @modeldoctor/contracts build
```

Expected: success, no errors. The contracts package emits to `packages/contracts/dist`.

- [ ] **Step 6: Type-check contracts + api (catches any stale callers we missed)**

Run:
```bash
pnpm -F @modeldoctor/contracts type-check && pnpm -F @modeldoctor/api type-check
```

Expected: no type errors. If you see a `Property 'judgeModel' does not exist` error, that's a missed caller — find it with `rg judgeModel` and remove it before continuing.

- [ ] **Step 7: Run contracts + judge unit tests (regression guard)**

Run:
```bash
pnpm -F @modeldoctor/contracts test && pnpm -F @modeldoctor/api test -- judges
```

Expected: all green. If a contracts test asserted the shape of `llmJudge` (it doesn't today, verified by `rg judgeModel packages/contracts/src/quality-gate/__tests__/`), update it to drop the `judgeModel` field.

- [ ] **Step 8: Commit**

Run:
```bash
git add packages/contracts/src/quality-gate/judge-config.ts \
        apps/api/src/modules/quality-gate/judges/llm-judge.ts
git status --short
```

Expected output:
```
M  packages/contracts/src/quality-gate/judge-config.ts
M  apps/api/src/modules/quality-gate/judges/llm-judge.ts
```

Then:
```bash
git commit -m "refactor(quality-gate): drop phantom judgeModel.connectionId field

The schema-level judgeModel.connectionId allowed per-llm-judge connection
override, but: (1) the runtime adapter in judges.service.ts ignores
input.connectionId, (2) 0 seeded evals use it, (3) the web UI never
exposes it, (4) no DB row carries it. Pure dead surface — removing
across schema + interface + call site.

Refs spec: docs/superpowers/specs/2026-05-28-llm-judge-fail-fast-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Write the failing e2e tests (TDD — red)

**Files:**
- Modify: `apps/api/test/e2e/quality-gate.e2e-spec.ts` (append new `describe` block)

This task writes 4 new e2e cases. They all fail because the guard does not exist yet — that's the point. Do **not** commit at the end of this task; Task 3 implements the guard and the combined diff lands as one TDD commit.

- [ ] **Step 1: Append the new describe block to `apps/api/test/e2e/quality-gate.e2e-spec.ts`**

The existing file already has `beforeAll`/`afterAll`/`createConnection`/`waitForRunStatus` at file scope (lines 5-57). Reuse them. Append this block **after** the existing `describe("baseline pin flow", …)` block at end of file:

```ts
describe("LLM judge guard at run creation", () => {
  // The LLM judge provider is a singleton row in llm_judge_providers.
  // Each test below sets the desired state explicitly via the /api/llm-judge/provider
  // endpoint, then exercises POST /api/quality-gate/runs to assert the guard.

  async function deleteProvider() {
    // Tolerate 404 (no row to delete) so tests are independent of file ordering.
    await request(ctx.app.getHttpServer())
      .delete("/api/llm-judge/provider")
      .set("Authorization", `Bearer ${token}`)
      .then(() => undefined)
      .catch(() => undefined);
  }

  async function upsertProvider(opts: { enabled: boolean }) {
    await request(ctx.app.getHttpServer())
      .put("/api/llm-judge/provider")
      .set("Authorization", `Bearer ${token}`)
      .send({
        baseUrl: "https://judge.example/v1",
        apiKey: "sk-test",
        model: "judge-model",
        enabled: opts.enabled,
      })
      .expect(200);
  }

  async function createLlmJudgeEval(name: string) {
    const r = await request(ctx.app.getHttpServer())
      .post("/api/quality-gate/evaluations")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name,
        samples: [
          {
            id: "s0",
            idx: 0,
            prompt: "summarise: the sky is blue",
            expected: "blue sky",
            judgeConfig: {
              kind: "llm-judge",
              rubric:
                "Score 1 if the summary mentions blue and sky, otherwise 0.",
              scale: "pass-fail",
            },
          },
        ],
      })
      .expect(201);
    return r.body.id as string;
  }

  async function createExactMatchEval(name: string) {
    const r = await request(ctx.app.getHttpServer())
      .post("/api/quality-gate/evaluations")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name,
        samples: [
          {
            id: "s0",
            idx: 0,
            prompt: "echo hi",
            expected: "hi",
            judgeConfig: { kind: "exact-match" },
          },
        ],
      })
      .expect(201);
    return r.body.id as string;
  }

  it("rejects with 400 when eval has llm-judge samples and no provider configured", async () => {
    await deleteProvider();
    const evalId = await createLlmJudgeEval("guard-no-provider");
    const conn = await createConnection("guard-target-1");

    const r = await request(ctx.app.getHttpServer())
      .post("/api/quality-gate/runs")
      .set("Authorization", `Bearer ${token}`)
      .send({
        evaluationId: evalId,
        endpointAId: conn,
        gateConfig: { passRateMin: 0.9 },
      })
      .expect(400);

    expect(String(r.body.message ?? r.text)).toMatch(
      /No enabled LLM judge provider/i,
    );
  }, 60_000);

  it("rejects with 400 when provider exists but enabled=false", async () => {
    await upsertProvider({ enabled: false });
    const evalId = await createLlmJudgeEval("guard-disabled-provider");
    const conn = await createConnection("guard-target-2");

    const r = await request(ctx.app.getHttpServer())
      .post("/api/quality-gate/runs")
      .set("Authorization", `Bearer ${token}`)
      .send({
        evaluationId: evalId,
        endpointAId: conn,
        gateConfig: { passRateMin: 0.9 },
      })
      .expect(400);

    expect(String(r.body.message ?? r.text)).toMatch(
      /No enabled LLM judge provider/i,
    );
  }, 60_000);

  it("succeeds when llm-judge eval has an enabled provider", async () => {
    await upsertProvider({ enabled: true });
    const evalId = await createLlmJudgeEval("guard-happy-path");
    const conn = await createConnection("guard-target-3");

    const r = await request(ctx.app.getHttpServer())
      .post("/api/quality-gate/runs")
      .set("Authorization", `Bearer ${token}`)
      .send({
        evaluationId: evalId,
        endpointAId: conn,
        gateConfig: { passRateMin: 0.9 },
      })
      .expect(201);

    expect(r.body.id).toBeTruthy();
    expect(["PENDING", "RUNNING", "COMPLETED", "FAILED"]).toContain(
      r.body.status,
    );
  }, 60_000);

  it("succeeds when eval has only non-llm-judge samples even without provider", async () => {
    await deleteProvider();
    const evalId = await createExactMatchEval("guard-no-llm-judge-needed");
    const conn = await createConnection("guard-target-4");

    const r = await request(ctx.app.getHttpServer())
      .post("/api/quality-gate/runs")
      .set("Authorization", `Bearer ${token}`)
      .send({
        evaluationId: evalId,
        endpointAId: conn,
        gateConfig: { passRateMin: 0.9 },
      })
      .expect(201);

    expect(r.body.id).toBeTruthy();
  }, 60_000);
});
```

- [ ] **Step 2: Run only the new describe block to observe the expected red state**

Run:
```bash
pnpm -F @modeldoctor/api test:e2e -- quality-gate.e2e-spec.ts -t "LLM judge guard at run creation"
```

(If the api package script is named differently, the canonical command is `pnpm test:e2e:api -- quality-gate.e2e-spec.ts -t "LLM judge guard"` from repo root.)

Expected behavior:
- **3 of 4 tests FAIL** with "expected 400, got 201" (the guard does not exist yet — `POST /api/quality-gate/runs` happily creates runs even with no provider).
- **1 of 4 PASSES**: the last case ("only non-llm-judge samples even without provider") — that path doesn't need the guard at all and already works.

If you see all 4 pass: the guard already exists (maybe shipped in a parallel commit) — verify with `git log` and skip to Task 3 Step 4. If all 4 fail with something other than the status assertion (e.g., schema validation error 400 from a different path): inspect the response body and adjust the test eval shape.

- [ ] **Step 3: Do NOT commit yet**

The failing tests stay uncommitted; Task 3 implements the guard and the final diff (tests + implementation) is one TDD commit.

---

## Task 3: Implement the guard (TDD — green)

**Files:**
- Modify: `apps/api/src/modules/quality-gate/services/runs.service.ts`

- [ ] **Step 1: Inject `LlmJudgeService` into `RunsService`**

Open `apps/api/src/modules/quality-gate/services/runs.service.ts`. At the top, add the import (place it alphabetically with other module imports):

```ts
import { LlmJudgeService } from "../../llm-judge/llm-judge.service.js";
```

Then add `LlmJudgeService` as a constructor parameter. The existing constructor looks like:

```ts
constructor(
  private readonly repo: RunsRepository,
  private readonly evaluations: EvaluationsService,
  private readonly connections: ConnectionService,
  private readonly executor: QualityGateRunExecutor,
) {}
```

Add `private readonly llmJudge: LlmJudgeService,` as the last parameter (no DI module change needed — `LlmJudgeModule` is already in `quality-gate.module.ts` imports at line 3 + 16; `LlmJudgeService` is exported from there):

```ts
constructor(
  private readonly repo: RunsRepository,
  private readonly evaluations: EvaluationsService,
  private readonly connections: ConnectionService,
  private readonly executor: QualityGateRunExecutor,
  private readonly llmJudge: LlmJudgeService,
) {}
```

If `BadRequestException` is not already imported from `@nestjs/common`, add it to the existing import line, e.g.:

```ts
import { BadRequestException, Injectable } from "@nestjs/common";
```

- [ ] **Step 2: Add the guard check inside `create()`**

The existing `create()` body (verbatim head):

```ts
async create(userId: string, body: CreateRunRequest): Promise<EvaluationRun> {
  const evaluation = await this.evaluations.get(userId, body.evaluationId);
  if (!evaluation) throw new NotFoundException(`evaluation ${body.evaluationId} not found`);
  const connA = await this.connections
    .findOwnedPublic(userId, body.endpointAId)
    .catch(() => null);
  // …continues with endpointA / endpointB / baseline resolution / repo.createPending
```

Insert the guard **between** the `if (!evaluation)` line and the `const connA =` line. The full insertion:

```ts
  if (!evaluation) throw new NotFoundException(`evaluation ${body.evaluationId} not found`);

  const needsLlmJudge = evaluation.samples.some(
    (s) => s.judgeConfig.kind === "llm-judge",
  );
  if (needsLlmJudge) {
    const provider = await this.llmJudge.getDecrypted();
    if (!provider?.enabled) {
      throw new BadRequestException(
        "This evaluation requires an LLM judge. " +
          "No enabled LLM judge provider is configured. " +
          "Configure one at Settings → AI Diagnostics.",
      );
    }
  }

  const connA = await this.connections
```

Placing it before endpoint-connection validation means the most actionable error fires first when multiple validations would fail. `NotFoundException` for the eval itself stays primary (you can't validate the judge requirement on an eval that doesn't exist).

- [ ] **Step 3: Re-run the failing tests — expect green**

Run:
```bash
pnpm -F @modeldoctor/api test:e2e -- quality-gate.e2e-spec.ts -t "LLM judge guard at run creation"
```

Expected: **all 4 cases pass**. If any still fail:
- Read the response body in the test output — the message should match `/No enabled LLM judge provider/i`. If it doesn't, you probably placed the check after another exception path; move it earlier in `create()`.
- If a 500 surfaces instead of 400: `LlmJudgeService` injection probably didn't wire — confirm the import path and that `LlmJudgeModule` is in `quality-gate.module.ts` `imports`.

- [ ] **Step 4: Run the entire quality-gate e2e file (catch regressions in existing happy paths)**

Run:
```bash
pnpm -F @modeldoctor/api test:e2e -- quality-gate.e2e-spec.ts
```

Expected: all 4 new cases + the existing `Quality Gate e2e` + `baseline pin flow` describes all pass. If the existing "trigger dual-endpoint run" case now fails with a 400 it means it was incidentally using `llm-judge` with no provider — but it isn't (it uses `exact-match` + `contains`, see lines 73-82). No regression should occur.

- [ ] **Step 5: Run the related unit tests**

Run:
```bash
pnpm -F @modeldoctor/api test -- runs
pnpm -F @modeldoctor/api test -- judges
```

Expected: green. The existing `runs.controller.spec.ts` test should still pass — controller-layer mocks `RunsService` so DI changes to the service are invisible. If a service spec exists (`runs.service.spec.ts`) it may need a mock `LlmJudgeService` provider — supply a minimal mock returning `{ enabled: true }`.

- [ ] **Step 6: Commit (TDD pair: tests + implementation)**

```bash
git add apps/api/src/modules/quality-gate/services/runs.service.ts \
        apps/api/test/e2e/quality-gate.e2e-spec.ts
git status --short
```

Expected:
```
M  apps/api/src/modules/quality-gate/services/runs.service.ts
M  apps/api/test/e2e/quality-gate.e2e-spec.ts
```

Then:
```bash
git commit -m "fix(quality-gate): reject run creation when llm-judge eval has no provider

When llm_judge_providers is empty (or the row is disabled), evaluations
containing kind:\"llm-judge\" samples used to complete with status=COMPLETED
+ gate_result=FAILED + fake 0% pass rate (the no-provider error was caught
inside the judge factory and silently downgraded to passed:false). Users
misread this as a model regression.

Guard at the run-creation funnel: RunsService.create() now consults
LlmJudgeService.getDecrypted() when any sample is kind:\"llm-judge\", and
throws BadRequestException → 400 + actionable message if no enabled provider
is configured. No PENDING row is persisted. Existing non-llm-judge evals
(exact-match / contains / regex) are unaffected.

4 new e2e cases cover: no provider, disabled provider, enabled provider
(happy path), and the no-llm-judge-needed false-positive guard.

Out of scope: per-run / per-eval judge override, in-flight provider-disable
race protection. Refs spec:
docs/superpowers/specs/2026-05-28-llm-judge-fail-fast-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Workspace verification (no commit)

- [ ] **Step 1: Lint the whole workspace**

Run:
```bash
pnpm -r lint
```

Expected: green across all packages. If biome flags the new `BadRequestException` import as unused (false positive on Nest decorators), run with `--apply` only if biome itself fixes it — never silence by hand.

- [ ] **Step 2: Type-check the whole workspace**

Run:
```bash
pnpm -r type-check
```

Expected: green. CI mirrors this exact command, so a local pass means CI typecheck will pass.

- [ ] **Step 3: Run the full api unit suite**

Run:
```bash
pnpm -F @modeldoctor/api test
```

Expected: green. ~few hundred unit tests should run in 10-30s.

- [ ] **Step 4: Run the full api e2e suite**

Run:
```bash
pnpm test:e2e:api
```

Expected: green. ~couple minutes. This is the authoritative gate before pushing.

- [ ] **Step 5: Confirm zero `judgeModel` references workspace-wide**

Run:
```bash
rg -n 'judgeModel' .
```

Expected: empty output (exit code 1). If anything matches (other than this plan file or the spec file), the cleanup missed a spot — go back and fix.

- [ ] **Step 6: Confirm the branch + commit log look right**

Run:
```bash
git log --oneline -5
git status
```

Expected:
- Current branch: `fix/llm-judge-fail-fast`
- Top 3 commits (most recent first):
  - `fix(quality-gate): reject run creation when llm-judge eval has no provider`
  - `refactor(quality-gate): drop phantom judgeModel.connectionId field`
  - `docs: spec — LLM judge fail-fast + judgeModel phantom-schema cleanup`
- Working tree clean.

---

## Acceptance checklist (mirror of spec)

- [ ] Missing enabled provider + llm-judge eval → 400 + clear message; no PENDING row persisted
- [ ] Enabled provider + llm-judge eval → 201 (existing happy path preserved)
- [ ] Non-llm-judge eval without provider → 201 (no false-positive guard)
- [ ] `judgeModel` removed from schema + interface + call site; `rg judgeModel` workspace-wide = 0
- [ ] 4 new e2e cases green
- [ ] Existing api unit + e2e suites green; `pnpm -r lint` + `pnpm -r type-check` green

## Push handoff (manual — owner decides)

After Task 4 passes, the branch is ready to push and open a PR. Per project convention this is an owner decision — do NOT push or open a PR autonomously unless the owner explicitly authorizes it in this session. The expected one-liners when authorized:

```bash
git push -u origin fix/llm-judge-fail-fast
gh pr create --base main --title "fix(quality-gate): LLM judge fail-fast + phantom schema cleanup" \
  --body-file <( printf '%s\n' \
    "Closes the silent-failure UX bug where evals containing \`llm-judge\` samples report a fake 0% quality fail when no LLM judge provider is configured." \
    "" \
    "**Spec:** \`docs/superpowers/specs/2026-05-28-llm-judge-fail-fast-design.md\`" \
    "" \
    "**Commits:**" \
    "1. docs spec" \
    "2. refactor: drop phantom \`judgeModel.connectionId\`" \
    "3. fix: guard run creation when llm-judge needs a provider" \
    "" \
    "🤖 Generated with [Claude Code](https://claude.com/claude-code)" )
```
