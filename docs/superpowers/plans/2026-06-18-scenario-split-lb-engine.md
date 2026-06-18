# Scenario split (`lb-strategy` + `engine-kv-cache`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the conflated `prefix-cache-validation` → `lb-strategy` and `kv-cache-stress` → `engine-kv-cache`, re-home the mooncake templates to `engine-kv-cache`, and make the engine-cache report tool-aware — so LB-routing validation and engine prefix-cache validation are cleanly separated.

**Architecture:** The two scenario ids are unique string tokens, so a scoped find-replace across `packages/` + `apps/` does the mechanical rename (code + i18n keys + tests). Structural edits then layer on: scenario labels/descriptions/tools, aiperf added to `engine-kv-cache`, mooncake templates moved to `engine-kv-cache`, a tool-aware report branch, a data-fixup migration, and i18n description text.

**Tech Stack:** TypeScript, zod (`scenarioIdSchema`), NestJS + Prisma (seed + migration), React + react-i18next (web), Vitest, biome, pnpm monorepo.

---

## File Structure

- **Mechanical rename (Task 1):** every `.ts/.tsx/.json` under `packages/` + `apps/` containing the literal `prefix-cache-validation` or `kv-cache-stress` (≈40 code files + 4 i18n + 5 test files). EXCLUDES `docs/` (the spec/plan intentionally name the old ids).
- **`packages/tool-adapters/src/scenarios.ts`** — the two `SCENARIOS` config bodies (labels/descriptions/tools) + the report-component field.
- **`packages/tool-adapters/src/aiperf/index.ts`** — add `engine-kv-cache` to aiperf's scenarios.
- **`apps/api/prisma/seed.ts`** — move the 2 mooncake templates to `engine-kv-cache` + descriptions.
- **`apps/web/src/features/benchmarks/BenchmarkDetailPage.tsx`** — tool-aware `engine-kv-cache` report branch.
- **`apps/api/prisma/migrations/<ts>_rename_scenarios/migration.sql`** — data fixup on `benchmarks` / `benchmark_templates` / `alert_events`.
- **`apps/web/src/locales/{zh-CN,en-US}/benchmarks.json` + `benchmark-templates.json`** — scenario label/description text.

---

## Task 1: Mechanical id rename (code + i18n keys + tests)

**Files:** all `.ts/.tsx/.json` under `packages/` + `apps/` with the two literals (NOT `docs/`).

- [ ] **Step 1: Replace the two id strings everywhere except docs**

Run (from repo root):
```bash
grep -rl --include='*.ts' --include='*.tsx' --include='*.json' \
  -e 'prefix-cache-validation' -e 'kv-cache-stress' packages apps \
  | grep -v node_modules | grep -v '/dist/' \
  | xargs sed -i '' \
      -e 's/prefix-cache-validation/lb-strategy/g' \
      -e 's/kv-cache-stress/engine-kv-cache/g'
```
(macOS `sed -i ''`. This renames the scenario-id occurrences in code, i18n keys, and tests. The shorter substrings `prefix-cache` / `kv-cache` WITHOUT the suffix are untouched, so prose like "prefix-cache 策略" survives.)

- [ ] **Step 2: Verify no stray old ids remain in code (docs are expected to keep them)**

Run: `grep -rn 'prefix-cache-validation\|kv-cache-stress' packages apps | grep -v node_modules | grep -v '/dist/'`
Expected: no output (empty).

- [ ] **Step 3: Build the renamed packages so downstream typechecks see new enum**

Run: `pnpm -F @modeldoctor/contracts -F @modeldoctor/tool-adapters build`
Expected: both build (the `scenarioIdSchema` enum now has `lb-strategy` / `engine-kv-cache`).

- [ ] **Step 4: Commit the mechanical rename**

```bash
git add -u packages apps
git commit -m "$(printf 'refactor(scenarios): rename ids prefix-cache-validation->lb-strategy, kv-cache-stress->engine-kv-cache\n\nMechanical id rename across code, i18n keys, and tests (docs keep old ids).\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 2: Scenario configs — labels, descriptions, tools

**Files:** Modify `packages/tool-adapters/src/scenarios.ts`

After Task 1 the keys are already `lb-strategy` / `engine-kv-cache`. Now fix their bodies.

- [ ] **Step 1: Rewrite the `lb-strategy` config body**

Replace the `"lb-strategy": { ... }` block with:
```ts
  "lb-strategy": {
    label: "负载均衡策略验证",
    description:
      "验证不同负载均衡策略对路由 / 缓存复用 / 延迟的影响,跨 LB 配置对照。当前:Higress ai-load-balancer prefix_cache(同前缀粘到同副本);后续可扩展 least-request / GPU-aware / 多集群等策略。",
    tools: ["aiperf"],
    paramsConstraints: {},
    reportComponent: "PrefixCachePanel",
  },
```

- [ ] **Step 2: Rewrite the `engine-kv-cache` config body (add aiperf)**

Replace the `"engine-kv-cache": { ... }` block with:
```ts
  "engine-kv-cache": {
    label: "引擎 KV / 前缀缓存",
    description:
      "单实例 / 引擎级缓存有效性:evalscope 对比不同 KV 卸载后端(vanilla / LMCache / YRCache),aiperf 用 mooncake 真实生产 trace 测块级前缀复用。注:块级共享对应引擎 APC,多副本下的 LB 路由验证请用 lb-strategy。",
    tools: ["evalscope", "aiperf"],
    paramsConstraints: {},
    reportComponent: "KvCacheStressReport",
  },
```

- [ ] **Step 3: Add `"PrefixCachePanel"` to the `reportComponent` union if missing**

In the `ScenarioConfig` interface `reportComponent` union, ensure `"PrefixCachePanel"` is a member (it already is per the existing type). If not present, add it.

- [ ] **Step 4: Verify tool-adapters builds + lint**

Run: `pnpm -F @modeldoctor/tool-adapters build && pnpm -F @modeldoctor/tool-adapters lint`
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add packages/tool-adapters/src/scenarios.ts
git commit -m "$(printf 'feat(scenarios): reframe lb-strategy (general LB) + engine-kv-cache (+aiperf)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 3: aiperf adapter — add `engine-kv-cache` scenario

**Files:** Modify `packages/tool-adapters/src/aiperf/index.ts:10`; Test `packages/tool-adapters/src/scenarios.spec.ts`

After Task 1, aiperf's scenarios is `["inference", "lb-strategy"]`. It must also list `engine-kv-cache` (mooncake moves there) or the invariant fails.

- [ ] **Step 1: Run the invariant test to see it fail**

Run: `pnpm -F @modeldoctor/tool-adapters test -- scenarios`
Expected: FAIL — `assertScenariosInvariant` reports `engine-kv-cache.tools includes 'aiperf'` (from Task 2) but `aiperf.scenarios` does not include `engine-kv-cache`.

- [ ] **Step 2: Add `engine-kv-cache` to aiperf scenarios**

In `aiperf/index.ts`, change:
```ts
  scenarios: ["inference", "lb-strategy"] as const,
```
to:
```ts
  scenarios: ["inference", "lb-strategy", "engine-kv-cache"] as const,
```

- [ ] **Step 3: Run the invariant test to verify it passes**

Run: `pnpm -F @modeldoctor/tool-adapters test -- scenarios`
Expected: PASS (bidirectional invariant holds: evalscope + aiperf both list engine-kv-cache; engine-kv-cache.tools = [evalscope, aiperf]).

- [ ] **Step 4: Commit**

```bash
git add packages/tool-adapters/src/aiperf/index.ts packages/tool-adapters/src/scenarios.spec.ts
git commit -m "$(printf 'feat(scenarios): aiperf valid in engine-kv-cache (mooncake home)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 4: Re-home mooncake templates to `engine-kv-cache` (seed.ts)

**Files:** Modify `apps/api/prisma/seed.ts`

After Task 1 all 5 prefix-cache templates have `scenario: "lb-strategy"`. The 2 mooncake ones must move to `engine-kv-cache`; update the 5 descriptions.

- [ ] **Step 1: Move the two mooncake templates' scenario to engine-kv-cache**

In `tpl_pc_mooncake_conv` and `tpl_pc_mooncake_agent` rows, change `scenario: "lb-strategy"` → `scenario: "engine-kv-cache"`. (Find them by the ids `tpl_pc_mooncake_conv` / `tpl_pc_mooncake_agent`; the t1/t2/t3 rows keep `lb-strategy`.)

- [ ] **Step 2: Update the 5 descriptions for the new framing**

For `tpl_pc_t1_article` / `tpl_pc_t2_deep` / `tpl_pc_t3_shallow`, prepend to their `description`:
`"【LB prefix_cache 策略路由验证 · 多轮粘性】"`.
For `tpl_pc_mooncake_conv` / `tpl_pc_mooncake_agent`, prepend:
`"【引擎块级前缀缓存 · 真实 Kimi 流量;多副本 LB 路由验证见 lb-strategy】"`.

- [ ] **Step 3: Run the seed to verify validation + upsert under the new scenarios**

Run: `pnpm -F @modeldoctor/api db:seed`
Expected: completes without zod error (templates re-validate via `aiperfParamsSchema` + `applyScenarioConstraints` on the new scenario ids; aiperf is valid in both per Tasks 2-3).

- [ ] **Step 4: Verify the scenario landed**

Run: `PGPASSWORD=modeldoctor psql -h localhost -U modeldoctor -d modeldoctor -t -A -F'|' -c "select id, scenario from benchmark_templates where id like 'tpl_pc_%' order by id;"`
Expected: t1/t2/t3 = `lb-strategy`; mooncake_conv/agent = `engine-kv-cache`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/seed.ts
git commit -m "$(printf 'feat(seed): re-home mooncake templates to engine-kv-cache\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 5: Tool-aware report for `engine-kv-cache`

**Files:** Modify `apps/web/src/features/benchmarks/BenchmarkDetailPage.tsx` (the `switch (benchmark.scenario)`)

After Task 1, the switch cases are `case "lb-strategy"` (renders InferenceReport + PrefixCachePanel — correct, keep) and `case "engine-kv-cache"` (renders `<KvCacheStressReport/>` — wrong for aiperf mooncake, which is evalscope-shaped).

- [ ] **Step 1: Make the engine-kv-cache case tool-aware**

Replace:
```tsx
    case "engine-kv-cache":
      return <KvCacheStressReport benchmark={benchmark} />;
```
with:
```tsx
    case "engine-kv-cache":
      // evalscope = KV-backend view; aiperf mooncake = prefix-cache view.
      return benchmark.tool === "aiperf" ? (
        <div className="space-y-6">
          <InferenceReport benchmark={benchmark} />
          <PrefixCachePanel serverMetrics={benchmark.serverMetrics} />
        </div>
      ) : (
        <KvCacheStressReport benchmark={benchmark} />
      );
```
(`InferenceReport` and `PrefixCachePanel` are already imported in this file — they're used by the `lb-strategy` case.)

- [ ] **Step 2: Typecheck web**

Run: `pnpm -F @modeldoctor/web exec tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/benchmarks/BenchmarkDetailPage.tsx
git commit -m "$(printf 'feat(web): tool-aware engine-kv-cache report (aiperf mooncake -> prefix-cache view)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 6: Data-fixup migration (rename scenario in existing rows)

**Files:** Create `apps/api/prisma/migrations/<timestamp>_rename_scenarios/migration.sql`

The enum rename orphans existing rows; UPDATE them. Only `benchmarks` / `benchmark_templates` / `alert_events` have a `scenario` column (verified).

- [ ] **Step 1: Create an empty migration (no schema change)**

Run: `pnpm -F @modeldoctor/api exec prisma migrate dev --create-only --name rename_scenarios`
Expected: creates `apps/api/prisma/migrations/<ts>_rename_scenarios/migration.sql` (likely empty — schema unchanged).

- [ ] **Step 2: Write the data-fixup SQL into that migration file**

Set the file contents to:
```sql
-- Scenario id rename (enum-change data fixup; CLAUDE.md carve-out).
UPDATE "benchmarks"          SET "scenario" = 'lb-strategy'     WHERE "scenario" = 'prefix-cache-validation';
UPDATE "benchmark_templates" SET "scenario" = 'lb-strategy'     WHERE "scenario" = 'prefix-cache-validation';
UPDATE "alert_events"        SET "scenario" = 'lb-strategy'     WHERE "scenario" = 'prefix-cache-validation';
UPDATE "benchmarks"          SET "scenario" = 'engine-kv-cache' WHERE "scenario" = 'kv-cache-stress';
UPDATE "benchmark_templates" SET "scenario" = 'engine-kv-cache' WHERE "scenario" = 'kv-cache-stress';
UPDATE "alert_events"        SET "scenario" = 'engine-kv-cache' WHERE "scenario" = 'kv-cache-stress';
```

- [ ] **Step 3: Apply the migration to dev DB**

Run: `pnpm -F @modeldoctor/api exec prisma migrate dev`
Expected: applies; no rows left with the old ids.

- [ ] **Step 4: Verify no old-id rows remain**

Run: `PGPASSWORD=modeldoctor psql -h localhost -U modeldoctor -d modeldoctor -t -A -c "select count(*) from benchmarks where scenario in ('prefix-cache-validation','kv-cache-stress');"`
Expected: `0`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/migrations
git commit -m "$(printf 'feat(api): migration renaming scenario ids on existing rows\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 7: i18n scenario label / description text

**Files:** Modify `apps/web/src/locales/{zh-CN,en-US}/benchmarks.json`

Task 1 renamed the JSON KEYS to `lb-strategy` / `engine-kv-cache`. The VALUE text still says "Prefix-cache" / old framing. Update the user-facing strings.

- [ ] **Step 1: Find the renamed scenario text entries**

Run: `grep -n '"lb-strategy"\|"engine-kv-cache"\|kvCacheStress' apps/web/src/locales/zh-CN/benchmarks.json apps/web/src/locales/en-US/benchmarks.json`

- [ ] **Step 2: Update zh-CN values**

For the `lb-strategy` create-title + description entries, set:
- title: `"新建 负载均衡策略验证"`
- description: `"验证不同 LB 策略(当前 ai-load-balancer prefix_cache)下相同前缀请求是否粘到同一副本"`
For `engine-kv-cache` entries, set the label/description to the "引擎 KV / 前缀缓存" framing (evalscope 后端 + aiperf mooncake).

- [ ] **Step 3: Update en-US values**

Mirror in English: `"New LB-strategy validation"` / `"Validate LB routing strategies (currently ai-load-balancer prefix_cache) pin same-prefix requests to one replica"`; engine-kv-cache → "Engine KV / prefix cache".

- [ ] **Step 4: Validate JSON parses**

Run: `node -e "['zh-CN','en-US'].forEach(l=>JSON.parse(require('fs').readFileSync('apps/web/src/locales/'+l+'/benchmarks.json','utf8')));console.log('ok')"`
Expected: `ok`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/locales
git commit -m "$(printf 'feat(web): i18n text for renamed scenarios (zh-CN + en-US)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 8: Full verification + PR

- [ ] **Step 1: Build workspace**

Run: `pnpm -r build`
Expected: all packages build (api needs `prisma generate` first if a fresh worktree — run `pnpm -F @modeldoctor/api exec prisma generate` then rebuild if it errors on the client).

- [ ] **Step 2: Lint + tests across touched packages**

Run:
```bash
pnpm -F @modeldoctor/tool-adapters test
pnpm lint
```
Expected: green. Fix any test still asserting the old ids (Task 1 should have renamed them; verify `scenarios.spec.ts`, `report-loader.spec.ts`, `KvCacheStressReport.test.tsx`, the insights tests).

- [ ] **Step 3: Push**

```bash
git push -u origin refactor/scenario-split-lb-engine
```

- [ ] **Step 4: Open PR (do NOT merge — user confirms)**

```bash
gh pr create --base main --title "refactor: split prefix-cache-validation into lb-strategy + engine-kv-cache" --body "$(cat <<'BODY'
## What
Splits the conflated `prefix-cache-validation` scenario:
- `prefix-cache-validation` → **`lb-strategy`** — general LB routing-strategy validation (current: ai-load-balancer prefix_cache). Multi-turn templates (t1/t2/t3).
- `kv-cache-stress` → **`engine-kv-cache`** — single-instance engine cache (evalscope KV backends + aiperf realistic mooncake). Mooncake templates re-homed here.

Mooncake's block-level sharing doesn't map to the LB's per-message-SHA1 routing, so it belongs in engine-cache, not LB-routing. (Empirically: same 8B fleet, mooncake ~8% hit vs multi-turn t2_deep ~80% / OFF ~35%.)

Breaking id rename → ships a data-fixup migration (benchmarks/templates/alert_events) in the same PR. engine-kv-cache report is tool-aware (aiperf → prefix-cache view, evalscope → KV-backend view).

Spec: `docs/superpowers/specs/2026-06-18-scenario-split-lb-engine-design.md`

## Test
- `scenarios.spec.ts` enum + invariant; seed re-validates + re-homes templates; migration leaves 0 old-id rows; `pnpm -r build` + `pnpm lint` green.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

- [ ] **Step 5: Verify CI** (per CLAUDE.md PR follow-through)

Run: `gh pr checks` and `gh api repos/weetime/modeldoctor/commits/$(git rev-parse HEAD)/check-runs --jq '.check_runs[]|"\(.name): \(.status)/\(.conclusion)"'`
Surface results; do not declare done until checks resolve.

---

## Self-Review

- **Spec coverage:** rename (T1) ✓; scenario configs + tools (T2) ✓; aiperf+engine-kv-cache invariant (T3) ✓; template re-home + descriptions (T4) ✓; tool-aware report (T5) ✓; migration on the 3 verified tables (T6) ✓; i18n text (T7) ✓; verify+PR (T8) ✓. No traffic-governance category (out of scope) — not in any task ✓.
- **Placeholders:** none — exact sed, exact config bodies, exact SQL, exact report branch.
- **Type consistency:** new ids `lb-strategy` / `engine-kv-cache` used identically in every task; `reportComponent` values `PrefixCachePanel` / `KvCacheStressReport` match the interface union; aiperf scenarios list matches engine-kv-cache.tools (invariant pinned by T3).
- **Risk note:** if Task 1's sed renames a test fixture string that should stay (unlikely — ids are unique), Task 8 lint/test catches it.
