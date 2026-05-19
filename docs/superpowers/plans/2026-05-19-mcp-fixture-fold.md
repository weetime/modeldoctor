# MCP e2e fixture fold-in Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold `MCP_BEARER_TOKEN` / `MCP_USER_ID` into `E2E_ENV_DEFAULTS`, delete the redundant `503-when-unset` e2e block, and make the fixture the single source of truth for ALL e2e secrets.

**Architecture:** Pure test refactor. The "missing secret → 503" path is already covered by `apps/api/src/modules/mcp/mcp.guard.spec.ts` (L34–44), so the matching e2e `describe` block in `mcp.e2e-spec.ts` adds no unique coverage and only forces the `process.env` carve-out. Delete it, then move MCP_* into the shared fixture and rewrite the surviving `tools registry` block to import the fixture constants instead of mutating `process.env` in lifecycle hooks.

**Tech Stack:** Vitest 2 (api e2e via supertest + Nest TestingModule), TypeScript, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-05-19-mcp-fixture-fold-design.md`
**Issue:** [#206](https://github.com/weetime/modeldoctor/issues/206)
**Branch:** `test/206-mcp-fixture-fold` (worktree at `/Users/fangyong/vllm/modeldoctor/test-206-mcp-fixture-fold`)

---

## File Structure

**Modified files (3):**
- `apps/api/test/setup/e2e-env-defaults.ts` — add MCP_* keys, drop carve-out docstring
- `apps/api/test/e2e/mcp.e2e-spec.ts` — delete first `describe`, refactor second to use fixture
- `apps/api/vitest.e2e.config.mts` — drop MCP_* carve-out from inline comment

**Read-only references:**
- `apps/api/src/modules/mcp/mcp.guard.spec.ts` — pre-existing unit coverage for the unset path
- `apps/api/test/e2e/alerts.e2e-spec.ts` — exemplar of "import constant from fixture" pattern (L23, 29)

**Not touched:**
- `apps/api/src/modules/mcp/mcp.guard.ts` — runtime behaviour unchanged
- Any other e2e spec — they already use the fixture

---

## Task 0: Workspace baseline

**Files:** none (preflight)

- [ ] **Step 1: Confirm worktree is on the right branch**

```bash
cd /Users/fangyong/vllm/modeldoctor/test-206-mcp-fixture-fold
git status
git log --oneline -3
```

Expected: working tree clean, HEAD on `test/206-mcp-fixture-fold`, top commit is `docs: spec for #206 — fold MCP_* into E2E_ENV_DEFAULTS fixture`.

- [ ] **Step 2: Install deps + build packages (worktree-first-run requirement)**

```bash
pnpm install
pnpm -r build
```

Expected: install completes, `packages/contracts/dist/` and `packages/tool-adapters/dist/` populated. (Per project memory: a fresh worktree's first api typecheck fails until `pnpm -r build` runs once.)

- [ ] **Step 3: Baseline — run the MCP unit guard spec to lock the safety net**

```bash
pnpm -F @modeldoctor/api test -- src/modules/mcp/mcp.guard.spec.ts --run
```

Expected: 6 tests pass (503-token-unset, 503-user-unset, 401-no-header, 401-mismatch, 401-prefix-shorter, pass+stamp). This is the coverage the refactor will lean on.

- [ ] **Step 4: Baseline — run the current MCP e2e to confirm it's green pre-refactor**

```bash
pnpm -F @modeldoctor/api test:e2e -- test/e2e/mcp.e2e-spec.ts --run
```

Expected: 2 tests pass — `503 when MCP_BEARER_TOKEN / MCP_USER_ID are unset` and `tools/list exposes the alert-loop tools (...)`. If the baseline fails, **stop and surface the failure** — do not start the refactor on a red baseline.

---

## Task 1: Fold MCP_* into `E2E_ENV_DEFAULTS`

**Files:**
- Modify: `apps/api/test/setup/e2e-env-defaults.ts`

- [ ] **Step 1: Replace the docstring carve-out + add the two new keys**

Edit `apps/api/test/setup/e2e-env-defaults.ts`. Replace the "NOT included by design" block in the file-level docstring so it reads:

```ts
 * NOT included by design:
 * - DATABASE_URL — computed dynamically by pickTestDatabaseUrl()
 */
```

(The MCP_* paragraph is gone; DATABASE_URL stays — it's still computed per-run by `pickTestDatabaseUrl`.)

Append the two new keys to the `E2E_ENV_DEFAULTS` object, after `ALERTMANAGER_WEBHOOK_SECRET`:

```ts
  // McpAuthGuard.canActivate() reads both MCP_BEARER_TOKEN and MCP_USER_ID
  // via ConfigService. mcp.e2e-spec.ts sends `Bearer ${MCP_BEARER_TOKEN}` and
  // expects mcpUserId to be stamped from MCP_USER_ID; both must match exactly,
  // so they live here for a single source of truth. The "missing secret → 503"
  // branch is covered by the guard's unit spec (mcp.guard.spec.ts), so the
  // fixture safely defines real values here without losing coverage.
  MCP_BEARER_TOKEN: "test-mcp-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  MCP_USER_ID: "e2e-mcp-test-user",
```

(40-char token, same shape as the prior inline literal in the e2e spec. The user id is opaque to `tools/list` — no DB row needed.)

- [ ] **Step 2: Verify the file compiles standalone**

```bash
pnpm -F @modeldoctor/api exec tsc --noEmit -p tsconfig.json
```

Expected: no errors. The fixture is a typed `as const` literal, so a typo in the new keys would surface as a TS error at any importing call site once Task 2 lands.

- [ ] **Step 3: Do NOT commit yet**

Task 2's edits to `mcp.e2e-spec.ts` will reference these new keys via import. Commit at the end of Task 2 so the fixture-addition and its consumer ship as one atomic change. (No commit step here.)

---

## Task 2: Rewrite `mcp.e2e-spec.ts` to use the fixture

**Files:**
- Modify: `apps/api/test/e2e/mcp.e2e-spec.ts`

- [ ] **Step 1: Rewrite the file**

Replace the entire contents of `apps/api/test/e2e/mcp.e2e-spec.ts` with:

```ts
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type E2EContext, bootE2E } from "../helpers/app.js";
import { E2E_ENV_DEFAULTS } from "../setup/e2e-env-defaults.js";

/**
 * MCP route smoke tests. The full JSON-RPC handshake + tool roundtrip is the
 * SDK's responsibility (covered by its own tests); we verify our own additions:
 * that all expected tools are registered and exposed at the configured path.
 *
 * The McpAuthGuard's 503-when-unset and 401 bearer-mismatch branches are
 * unit-tested in apps/api/src/modules/mcp/mcp.guard.spec.ts — no need to
 * re-assert them through the HTTP layer (and doing so would force the
 * brittle `delete process.env.MCP_*` carve-out we deliberately removed).
 *
 * MCP_BEARER_TOKEN / MCP_USER_ID come from E2E_ENV_DEFAULTS so the Bearer the
 * test sends matches the value ConfigService loaded at app boot. Mutating
 * process.env in beforeAll is the anti-pattern E2E_ENV_DEFAULTS exists to
 * prevent (see that file's docstring for the alerts 401 backstory).
 */
describe("MCP /mcp tools registry (e2e)", () => {
  let ctx: E2EContext;
  const TOKEN = E2E_ENV_DEFAULTS.MCP_BEARER_TOKEN;

  beforeAll(async () => {
    ctx = await bootE2E();
  }, 120_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  it("tools/list exposes the alert-loop tools (list_alerts / get_alert_explanation / subscribe_connection)", async () => {
    const res = await request(ctx.app.getHttpServer())
      .post("/api/mcp")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("Accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", method: "tools/list", id: 1, params: {} })
      .buffer(true);

    // StreamableHTTPServerTransport responds as SSE; supertest captures
    // the raw body in res.text. Pluck the first `data:` line and parse.
    const raw = (res.text ?? "").toString();
    const m = raw.match(/^data:\s*(\{.*\})\s*$/m);
    expect(m).not.toBeNull();
    const json = JSON.parse(m?.[1] ?? "{}") as {
      result?: { tools?: Array<{ name: string }> };
    };
    const names = (json.result?.tools ?? []).map((t) => t.name);
    expect(names).toContain("list_alerts");
    expect(names).toContain("get_alert_explanation");
    expect(names).toContain("subscribe_connection");
  });
});
```

Diff summary (for the reviewer):
- Deleted the entire first `describe("MCP /mcp (e2e)")` block including its `beforeAll` that called `delete process.env.MCP_*`.
- In the surviving block: removed the `FAKE_USER_ID` local constant (unused — `tools/list` doesn't care about the user id), removed `process.env.MCP_BEARER_TOKEN = TOKEN` and `process.env.MCP_USER_ID = FAKE_USER_ID` from `beforeAll`, removed the matching `delete` lines from `afterAll`.
- Replaced the inline `const TOKEN = "test-mcp-token-..."` with `const TOKEN = E2E_ENV_DEFAULTS.MCP_BEARER_TOKEN`.
- Top docstring rewritten to explain why no 503/401 e2e (and pointers back to the unit spec + fixture).

- [ ] **Step 2: Type-check the e2e spec**

```bash
pnpm -F @modeldoctor/api exec tsc --noEmit -p tsconfig.json
```

Expected: no errors. The new `E2E_ENV_DEFAULTS.MCP_BEARER_TOKEN` reference resolves to a `string` literal via the `as const` typing.

- [ ] **Step 3: Run the MCP e2e**

```bash
pnpm -F @modeldoctor/api test:e2e -- test/e2e/mcp.e2e-spec.ts --run
```

Expected: 1 test passes (`tools/list exposes the alert-loop tools (...)`). The deleted 503 test no longer runs; the surviving test runs against a fixture-loaded `MCP_BEARER_TOKEN` instead of `beforeAll`-mutated `process.env`.

- [ ] **Step 4: Run the guard unit spec to confirm the unset coverage is still green**

```bash
pnpm -F @modeldoctor/api test -- src/modules/mcp/mcp.guard.spec.ts --run
```

Expected: 6 tests pass, including `503 when MCP_BEARER_TOKEN is unset` and `503 when MCP_USER_ID is unset`. These are the assertions the deleted e2e block was duplicating.

---

## Task 3: Drop the carve-out comment in `vitest.e2e.config.mts`

**Files:**
- Modify: `apps/api/vitest.e2e.config.mts`

- [ ] **Step 1: Update the inline comment**

Replace the 3-line inline comment above `...E2E_ENV_DEFAULTS,` (currently lines 33–35) with:

```ts
      // Shared fixture so spec files can import the same constants they
      // expect ConfigService to see. See test/setup/e2e-env-defaults.ts for
      // per-key rationale.
```

(Removed: the trailing "and the MCP_* carve-out" sentence — there is no carve-out anymore.)

- [ ] **Step 2: Final full-suite verification**

Run, from the worktree root:

```bash
pnpm -F @modeldoctor/api lint
pnpm -F @modeldoctor/api exec tsc --noEmit -p tsconfig.json
pnpm -F @modeldoctor/api test -- src/modules/mcp --run
pnpm -F @modeldoctor/api test:e2e -- test/e2e/mcp.e2e-spec.ts --run
```

Expected: lint clean, no TS errors, MCP unit specs all pass, MCP e2e (1 test) passes.

- [ ] **Step 3: Sanity-grep for residual `process.env.MCP_`**

```bash
grep -rn "process\.env\.MCP_" apps/api/ --include="*.ts"
```

Expected: **zero hits** under `apps/api/`. (The only legitimate read of those env vars is via `ConfigService` inside `mcp.guard.ts`, which goes through `this.config.get(...)`, not `process.env`.)

- [ ] **Step 4: Sanity-grep that `E2E_ENV_DEFAULTS` now covers MCP_***

```bash
grep -n "MCP_BEARER_TOKEN\|MCP_USER_ID" apps/api/test/setup/e2e-env-defaults.ts
```

Expected: 2 hits inside the object (the new fields), plus any docstring references.

---

## Task 4: Commit + push + PR

**Files:** none (delivery)

- [ ] **Step 1: Stage the three modified files**

```bash
git add \
  apps/api/test/setup/e2e-env-defaults.ts \
  apps/api/test/e2e/mcp.e2e-spec.ts \
  apps/api/vitest.e2e.config.mts
git status
```

Expected: those three files staged, nothing else.

- [ ] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
test(api): fold MCP_* into E2E_ENV_DEFAULTS fixture (closes #206)

The McpAuthGuard "missing secret → 503" path is already covered by
mcp.guard.spec.ts. The matching e2e describe block in mcp.e2e-spec.ts
only existed to exercise that same canActivate branch through HTTP,
and it required keeping MCP_BEARER_TOKEN / MCP_USER_ID out of the
shared E2E_ENV_DEFAULTS fixture so the unset path stayed reachable.

Delete the redundant e2e block, fold both env vars into the fixture,
and rewrite the surviving tools/list e2e to import the fixture's
MCP_BEARER_TOKEN instead of mutating process.env in beforeAll. The
fixture is now the single source of truth for ALL e2e secrets — no
more brittle "set process.env in beforeAll" anti-pattern.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Push branch**

```bash
git push -u origin test/206-mcp-fixture-fold
```

- [ ] **Step 4: Open PR**

```bash
gh pr create --title "test(api): fold MCP_* into E2E_ENV_DEFAULTS fixture (closes #206)" --body "$(cat <<'EOF'
## Summary

- Delete the redundant `503-when-unset` e2e describe in `mcp.e2e-spec.ts` — `mcp.guard.spec.ts` already unit-covers that branch end-to-end (`503 when MCP_BEARER_TOKEN is unset`, `503 when MCP_USER_ID is unset`).
- Fold `MCP_BEARER_TOKEN` / `MCP_USER_ID` into `E2E_ENV_DEFAULTS`. Rewrite the surviving `tools/list` e2e to read `E2E_ENV_DEFAULTS.MCP_BEARER_TOKEN` instead of mutating `process.env` in `beforeAll`.
- Drop the carve-out paragraph from the fixture docstring and the matching reference in `vitest.e2e.config.mts`. The fixture is now the single source of truth for every e2e secret.

Closes #206.

## Test plan

- [ ] `pnpm -F @modeldoctor/api test -- src/modules/mcp/mcp.guard.spec.ts --run` — 6 unit tests green (incl. both 503-unset cases)
- [ ] `pnpm -F @modeldoctor/api test:e2e -- test/e2e/mcp.e2e-spec.ts --run` — `tools/list` e2e green
- [ ] `grep -rn "process\.env\.MCP_" apps/api/ --include="*.ts"` — zero hits
- [ ] `pnpm -F @modeldoctor/api lint` clean

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: PR follow-through**

After `gh pr create` returns a URL:

```bash
PR=$(gh pr view --json number -q .number)
gh pr view "$PR" --json comments,reviews,statusCheckRollup,mergeStateStatus
gh pr checks "$PR"
```

Watch CI to green. If a check fails, treat the CI signal as authoritative (per `main/CLAUDE.md`) and fix in a follow-up commit; do not declare done while red.

---

## Self-review summary

- **Spec coverage:**
  - "Add MCP_BEARER_TOKEN + MCP_USER_ID to E2E_ENV_DEFAULTS" → Task 1
  - "Remove their process.env = lines from mcp.e2e-spec.ts" → Task 2
  - "Update fixture docstring to drop the carve-out" → Task 1 step 1
  - "vitest.e2e.config.mts carve-out comment" → Task 3 step 1
  - "503 guarantee still has test coverage" → leaned on existing `mcp.guard.spec.ts`; Tasks 0/2/3 all re-run it as part of verification
- **Placeholder scan:** every code block contains full, runnable code or full commands; no TODOs.
- **Type consistency:** `E2E_ENV_DEFAULTS.MCP_BEARER_TOKEN` is the same name used in both Task 1 (definition) and Task 2 (consumer).
- **Scope:** pure test refactor; no runtime changes; one atomic commit.
