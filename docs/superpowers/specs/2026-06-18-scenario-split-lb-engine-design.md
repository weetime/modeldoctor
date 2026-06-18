# Scenario split: `lb-strategy` + `engine-kv-cache` — design

Date: 2026-06-18
Status: design approved (brainstorming), pending spec review → implementation plan

## Problem

The `prefix-cache-validation` scenario conflates **two methodologically distinct
test targets**, which caused a multi-hour false debugging chase:

1. **Load-balancer routing strategy** (gateway / multi-replica): does the LB route
   prefix-sharing requests to the same replica so the engine's prefix cache is
   reused across the fleet? Validated by comparing LB configs (e.g. Higress
   ai-load-balancer `prefix_cache` ON vs OFF). The Higress LB routes by a
   per-user-turn **message-content SHA1** (`prefix_cache/lb_policy.go::computeSHA1`),
   so the right workload is **multi-turn sticky conversations** (t1/t2/t3 templates),
   where leading turns are byte-identical across a conversation.
2. **Engine prefix/KV cache** (single instance): does the inference engine reuse KV
   blocks for shared prefixes? Validated by realistic block-level workloads. The
   **mooncake** templates (real Kimi traces: `timestamp/input_length/output_length/hash_ids`,
   block-level sharing) belong here.

Putting the mooncake templates in `prefix-cache-validation` is wrong: mooncake's
**block-level** sharing does not map to the LB's **message-level** routing, so on a
multi-replica setup the hit rate looks flat (~8%) even when the LB works perfectly —
which reads as "the LB is broken" when it is not. (Empirically confirmed: same 8B
multi-replica setup, mooncake = 8% hit, multi-turn t2_deep = ~80% hit / OFF ~35%.)

There is already a sibling scenario `kv-cache-stress` (evalscope, KV-backend
comparison) that is the natural home for engine-level cache testing.

## Decisions (locked during brainstorming)

1. **Split via semantic ID renames** (breaking; the user chose renamed IDs over
   keep-id-relabel):
   - `prefix-cache-validation` → **`lb-strategy`** — general "负载均衡策略验证".
     Tests LB routing strategies; the current one is Higress ai-load-balancer
     `prefix_cache`; future ones (multi-cluster, least-request, GPU-aware…) are
     additional strategies compared via SavedCompare across LB configs. NOT
     prefix-cache-specific in name.
   - `kv-cache-stress` → **`engine-kv-cache`** — "引擎 KV/前缀缓存". Single-instance
     engine cache effectiveness: evalscope KV backends (vanilla/LMCache/YRCache)
     **plus** aiperf realistic-traffic mooncake.
2. **Re-home templates** (seed.ts):
   - `tpl_pc_t1_article` / `tpl_pc_t2_deep` / `tpl_pc_t3_shallow` → `lb-strategy`.
   - `tpl_pc_mooncake_conv` / `tpl_pc_mooncake_agent` → `engine-kv-cache`.
3. **No traffic-governance category/grouping now** (YAGNI). The broader 流量治理
   suite (canary, A/B-染色, failover, multi-cluster) is future, each its own scenario;
   the sidebar grouping is introduced only when a 2nd traffic-governance scenario
   lands. Out of scope here.
4. **Single coupled PR** (rename cascades across contracts → tool-adapters → seed →
   migration → web/i18n).

## Non-goals

- No new "traffic-governance" category field or sidebar grouping.
- No new scenarios (canary / A-B / failover / multi-cluster).
- No change to the LB plugin or its routing algorithm.
- No change to the metrics captured (prefix-cache annotation stays as-is).

## Architecture / changes

### 1. Contracts (`packages/contracts/src/benchmark.ts`)
`scenarioIdSchema` enum: replace `"prefix-cache-validation"` → `"lb-strategy"`,
`"kv-cache-stress"` → `"engine-kv-cache"`. `ScenarioId` is inferred from it.

### 2. Tool-adapters (`packages/tool-adapters/src/`)
- `scenarios.ts`: rename the two `ScenarioId` union members + `scenarioIdSchema`
  enum + the two `SCENARIOS` keys; rewrite their `label` / `description`:
  - `lb-strategy`: label "负载均衡策略验证"; desc — tests LB routing strategies
    (current: Higress ai-load-balancer prefix_cache; compare LB configs via
    SavedCompare). tools `["aiperf"]`. reportComponent: keep `"InferenceReport"`
    (prefix-cache compare figures already work via the SavedCompare narrative).
  - `engine-kv-cache`: label "引擎 KV/前缀缓存"; desc — single-instance engine cache
    (evalscope KV backends + aiperf mooncake realistic traffic). tools
    `["evalscope", "aiperf"]` (adds aiperf). reportComponent: `"KvCacheStressReport"`
    (see report note below).
- Adapter `scenarios` arrays + the `assertScenariosInvariant` bidirectional check:
  - `aiperf/index.ts`: `["inference", "prefix-cache-validation"]` →
    `["inference", "lb-strategy", "engine-kv-cache"]`.
  - `evalscope/index.ts`: `["inference", "kv-cache-stress"]` →
    `["inference", "engine-kv-cache"]`.
- `scenarios.spec.ts`: update the enum/invariant expectations.

### 3. Seed (`apps/api/prisma/seed.ts`)
- 5 prefix-cache templates: change `scenario` field +
  - t1/t2/t3 → `lb-strategy`; descriptions → "LB prefix_cache 策略路由验证(多轮粘性,
    turn 间共享逐字节相同的前导历史 → 命中)".
  - mooncake_conv/agent → `engine-kv-cache`; descriptions → "引擎块级前缀缓存(真实
    Kimi mooncake 流量;块级共享对应引擎 APC,不是 LB 消息级路由 —— 多副本下验证 LB
    路由请用 lb-strategy 的多轮模板)".
- Each row re-validates through `aiperfParamsSchema` + `applyScenarioConstraints`
  on the NEW scenario id; aiperf must be in both scenarios' tools (it is, per §2).

### 4. Migration (`apps/api/prisma/migrations/…`)
A one-off data-fixup migration (the CLAUDE.md "enum-change data fixup" carve-out —
analogous to the tool-retirement deletes), schema-unchanged. **Only 3 tables have a
`scenario` column** (verified via information_schema): `benchmarks`,
`benchmark_templates`, `alert_events`. (`saved_compares` does NOT — no UPDATE needed.)
```sql
UPDATE benchmarks          SET scenario = 'lb-strategy'     WHERE scenario = 'prefix-cache-validation';
UPDATE benchmark_templates SET scenario = 'lb-strategy'     WHERE scenario = 'prefix-cache-validation';
UPDATE alert_events        SET scenario = 'lb-strategy'     WHERE scenario = 'prefix-cache-validation';
UPDATE benchmarks          SET scenario = 'engine-kv-cache' WHERE scenario = 'kv-cache-stress';
UPDATE benchmark_templates SET scenario = 'engine-kv-cache' WHERE scenario = 'kv-cache-stress';
UPDATE alert_events        SET scenario = 'engine-kv-cache' WHERE scenario = 'kv-cache-stress';
```
Without it, existing rows (45 + 5 on the old LB id, 3 + 6 on the old engine id) fail
`scenarioIdSchema.parse` on every list/detail/metric read. Generate via
`prisma migrate dev --create-only` per project rule.

### 5. Web (`apps/web/src`)
Rename the two scenario ids everywhere they are hardcoded:
- `features/benchmarks/scenarios.ts` `SCENARIO_ICONS` keys.
- report-component mapping + any `scenario === "prefix-cache-validation"` /
  `"kv-cache-stress"` literals (grep: `BenchmarkKvCacheStressPage.tsx`,
  `BenchmarkListShell.tsx`, `TemplateListPage.tsx`, `TemplateForm.tsx`,
  `deployment-recipes/data.ts`, plus the `SCENARIO_SIDEBAR_KEY` map referenced in
  CLAUDE.md).
- i18n: rename the scenario label/description keys under the new ids in
  `locales/{zh-CN,en-US}/benchmarks.json` + `benchmark-templates.json`.

### 6. Report rendering (`BenchmarkDetailPage.tsx` — `switch (benchmark.scenario)`)
Reports are picked by a per-scenario `switch` (verified). Today:
`prefix-cache-validation` → `<InferenceReport/> + <PrefixCachePanel/>`;
`kv-cache-stress` → `<KvCacheStressReport/>`. Changes:
- Rename `case "prefix-cache-validation"` → `case "lb-strategy"` (keep the
  InferenceReport + PrefixCachePanel body — PrefixCachePanel shows hit% / per-pod
  share, exactly what LB-routing validation needs).
- Replace `case "kv-cache-stress"` → `case "engine-kv-cache"` and make it
  **tool-aware**, because mooncake is aiperf and `KvCacheStressReport` is
  evalscope-shaped:
  ```tsx
  case "engine-kv-cache":
    return benchmark.tool === "aiperf"
      ? <div className="space-y-6"><InferenceReport benchmark={benchmark} /><PrefixCachePanel serverMetrics={benchmark.serverMetrics} /></div>
      : <KvCacheStressReport benchmark={benchmark} />;
  ```
  (aiperf mooncake gets the prefix-cache view; evalscope keeps the KV-backend view.)
- Also update the `reportComponent` field in `scenarios.ts` for the two scenarios to
  match (informational; the detail page switch is the source of truth for rendering).

## Testing
- `scenarios.spec.ts`: new enum + invariant.
- Seed validates + UPSERTs the 5 re-homed templates under their new scenarios.
- Migration applies cleanly; old rows readable under new ids (no zod parse failure).
- Web: any test referencing the old scenario ids updated; `pnpm lint` + typecheck.
- Manual: a `lb-strategy` t2_deep run + an `engine-kv-cache` mooncake run both render
  their detail report without error.

## Rollout / risk
- Breaking id rename — the migration MUST ship in the same PR (single coupled PR per
  the project convention) so deployed history stays readable.
- Prod: `migrate deploy` runs the UPDATE; then `prisma db seed` re-homes templates.
