# Prefix-cache validation: retire bespoke probe, rebase on standard aiperf + Prometheus annotation

**Date:** 2026-06-09
**Branch:** `feat/prefix-cache-aiperf`
**Status:** Approved design, pre-implementation

## Background & motivation

The `prefix-cache-validation` scenario today runs a **self-built** load generator,
`apps/benchmark-runner/scripts/prefix_cache_probe.py`. That script couples two
responsibilities: (1) generating same-prefix load and (2) scraping per-pod
`vllm:prefix_cache_queries_total` deltas from Prometheus to compute a stickiness %.

Two problems:

1. **It is a bespoke script.** The industry-standard way to benchmark cache-aware
   routing is to drive a prefix-reusing workload with a standard load tool
   (vLLM `bench serve`, SGLang `bench_serving`, NVIDIA aiperf, inference-perf) and
   read cache hit rate from Prometheus — not a custom per-pod attribution probe.
2. **The platform already integrates Prometheus.** `packages/contracts/src/engine-metrics/manifests/vllm.ts`
   already computes `prefix_cache_hit_rate`. The per-pod label exists on the series;
   the probe's attribution logic is just a Prometheus query wrapped in a script.

We are reproducing the `higress-prefix-routing-benchmark` experiment
(`~/vllm/repots/experiments/higress-prefix-routing-benchmark`) on the platform.
The experiment's aiperf portion was **already 100% standard aiperf**; only the
stickiness probe was custom. This is the trigger to align the platform with mainstream:
retire the probe, drive load with standard aiperf (multi-turn synthetic + Mooncake
trace), and surface cache metrics through the platform's existing Prometheus layer.

## Goals

- Retire the `prefix-cache-probe` tool entirely (adapter, report component, runner
  image, script) — clean break.
- Keep `prefix-cache-validation` as a **thin shell scenario** on top of the standard
  `aiperf` tool (kept for product discoverability — cache-aware routing is a headline
  capability for private multi-engine deployments).
- Extend the aiperf adapter to expose aiperf's **native** flags for prefix-reusing
  workloads: multi-turn synthetic (closed-loop) and Mooncake trace (open-loop).
- Capture cache metrics (hit rate + per-pod concentration) from Prometheus as a
  **snapshot at benchmark completion**, stored immutably in the report.
- Reproduce the Higress off/on experiment end-to-end and produce a SavedCompare report.

## Non-goals

- No changes to other scenarios (inference, capacity, gateway, kv-cache-stress) beyond
  the shared aiperf adapter and report-annotation plumbing.
- No per-request/per-prefix exact stickiness attribution (the probe's sequential
  precision). We accept the coarser aggregate `by(pod)` concentration under concurrent
  load — it is metric-grounded and sufficient for the routing on/off conclusion.
- No explicit user-facing load-mode switch; flow model is implied by dataset.

## Decisions (locked during brainstorming)

| # | Decision | Choice |
|---|---|---|
| 1 | Scope of this round | **Both** multi-turn synthetic and Mooncake trace |
| 2 | Flow model exposure | **Implicit by dataset** (synthetic/sharegpt = closed-loop; mooncake = open-loop) |
| 3 | Missing Prometheus datasource | **Graceful degrade** — run aiperf + TTFT, omit panel + warn |
| 4 | Probe removal | **Clean break** — delete tool/report/image/script |
| 5 | Cache-metric capture | **Snapshot at completion** — watcher queries Prom at terminal phase, stores in report JSON |
| 6 | `prefix-cache-validation` scenario | **Keep thin shell** on aiperf (not full-merge into inference) |

## Design

### 1. aiperf adapter extension (`packages/tool-adapters/src/aiperf/`)

**schema.ts — new fields:**

- `dataset`: extend enum to `synthetic | sharegpt | mooncake-trace`.
- Multi-turn (closed-loop only): `conversationNum`, `conversationTurnMean`,
  `conversationTurnStddev?`, `conversationType?` (`pooled | sticky-user-sessions`),
  `conversationTurnDelayMeanMs?`.
- Mooncake (open-loop only): `islBlockSize?` (default from trace metadata = 512),
  `mooncakeTrace?` (`conversation | toolagent`) selecting which baked file.

**Flow model implied by dataset (decision 2):**

- `synthetic | sharegpt` → closed-loop: emit `--concurrency`; may emit conversation flags.
- `mooncake-trace` → open-loop: emit `--input-file <baked path> --custom-dataset-type
  mooncake_trace --isl-block-size <n> --fixed-schedule`; **ignore concurrency**.

**runtime.ts `buildCommand`:** branch on dataset to assemble argv. Report parsing
(TTFT / ITL / e2e / throughput / request counts) is unchanged — the same
`profile_export_aiperf.json` shape is produced in all modes.

**schema validation:** `superRefine` rejects (a) conversation flags with
`dataset=mooncake-trace`, (b) explicit concurrency semantics that conflict with
open-loop, guiding users away from unsupported aiperf combinations.

### 2. Runner image: bake Mooncake trace (`apps/benchmark-runner`)

- `md-runner-aiperf` Dockerfile: COPY two official traces from `kvcache-ai/Mooncake`
  FAST25-release into `/app/.cache/aiperf/datasets/` alongside ShareGPT:
  - `conversation_trace.jsonl` (~40% prefix reuse — chat shape)
  - `toolagent_trace.jsonl` (~59% prefix reuse — agent shape)
- `verify-airgap.sh`: add assertions that both traces are present (air-gapped runs).
- Rebuild via `tools/build-runner-images.sh`.

### 3. Thin-shell scenario (`packages/tool-adapters/src/scenarios.ts` + web)

- `prefix-cache-validation`: `tools: ["aiperf"]`, `reportComponent: "InferenceReport"`
  (reuse — no more `PrefixCacheProbeReport`). Default workload = multi-turn synthetic
  with sensible `conversationNum`/`conversationTurnMean` defaults.
- web: keep nav entry, route `/benchmarks/prefix-cache-validation`, list/create/detail
  pages — but point the params form at aiperf and the report at `InferenceReport` plus
  the prefix-cache panel (§4).
- Only difference vs plain `inference`: defaults to a multi-turn workload and attempts
  the Prometheus prefix-cache annotation.

### 4. Prometheus prefix-cache annotation (snapshot at completion — decision 5)

- **engine-metrics `vllm.ts`:** reuse existing aggregate `prefix_cache_hit_rate`; add a
  `by(pod)` expression for concentration, e.g.
  `topPodSharePct = max by(pod)(Δqueries) / sum(Δqueries)` — the aggregate stand-in for
  stickiness. (V0 `gpu_` prefix already handled by the existing manifest pattern.)
- **watcher/API terminal hook:** on terminal phase, if the connection has a bound
  `PrometheusDatasource`, query the run's time window once and compute
  `{ hitRatePct, perPod: [{ pod, queries, hits }], topPodSharePct }`. Write into the
  report JSON as an optional `prefixCacheAnnotation` block.
- **report schema (contracts):** add optional `prefixCacheAnnotation`.
- **web `PrefixCachePanel`:** render when the block is present (hit-rate headline +
  per-pod concentration table). When absent (no datasource / no vLLM metrics): omit the
  panel and show a "Prometheus not bound — no cache metrics" note (decision 3).

### 5. Template rewrite (`apps/api/prisma/seed.ts`)

Remove the 2 probe templates. Add (all `scenario: prefix-cache-validation`, `tool: aiperf`):

| Template | dataset | key config | source |
|---|---|---|---|
| 路由粘性 · 文章同款 (t1) | synthetic | conversationNum=60, turnMean=5, in200/out800, conc=20 | Higress t1 |
| 路由粘性 · 深会话 (t2) | synthetic | conversationNum=30, turnMean=10, in200/out800, conc=20 | Higress t2 |
| 路由粘性 · 浅会话 (t3) | synthetic | conversationNum=120, turnMean=2, in200/out800, conc=20 | Higress t3 |
| 缓存感知 · Mooncake 对话 | mooncake-trace | mooncakeTrace=conversation, islBlockSize=512 | Mooncake |
| 缓存感知 · Mooncake Agent | mooncake-trace | mooncakeTrace=toolagent, islBlockSize=512 | Mooncake |

Per project convention, built-in templates live in `seed.ts` (not migration INSERTs).

### 6. Clean-break removal (decision 4)

- **tool-adapters:** delete `src/prefix-cache-probe/` directory; remove entries from
  `registry.ts`, `category-defaults.ts`, `row-descriptors`, `schemas-entry.ts`, `index.ts`.
- **contracts:** remove tool `prefix-cache-probe` from `benchmark.ts`; **keep** the
  `prefix-cache-validation` scenario enum value.
- **api:** remove `RUNNER_IMAGE_PREFIX_CACHE_PROBE` (`env.schema.ts`,
  `k8s/runner-images.ts`); clean `benchmark.repository.ts` ref; update the
  `run-benchmark.tool.ts` MCP description.
- **web:** delete `forms/PrefixCacheProbeParamsForm.tsx`, `reports/PrefixCacheProbeReport.tsx`
  and their tests; remove the probe branches in `ToolParamsEditor.tsx`,
  `RequestSetupSection.tsx`, `BenchmarkDetailPage.tsx`.
- **runner:** delete `scripts/prefix_cache_probe.py` and the
  `md-runner-prefix-cache-probe` image build.
- Dev DB: no migration/back-compat for historical probe rows (clean break; dev only).

### 7. Testing

- Adapter unit tests: `buildCommand` for synthetic-multiturn (closed-loop), mooncake
  (open-loop, fixed-schedule), and sharegpt; assert flow-model branching and that
  conversation flags never appear under mooncake.
- Schema tests: extended `dataset` enum; conversation-param validation; mooncake/
  concurrency mutual exclusion.
- `verify-airgap.sh`: both Mooncake traces present.
- Annotation snapshot: unit test the Prom query builder + parse into
  `prefixCacheAnnotation`; degrade path when datasource absent.
- web: `PrefixCachePanel` renders with annotation and degrades without it.

### 8. Validation plan (reproduce the Higress experiment)

- **User (manual):** deploy 7-replica vLLM behind Higress; `kubectl patch wasmplugin`
  to toggle `ai-load-balancer` off (baseline) / on (prefix_cache). Endpoint URL is the
  Higress gateway in both variants.
- **Platform setup:** create a `PrometheusDatasource` (4pd Prometheus) and a
  `Connection` (gateway baseUrl, served model name, apiKey,
  `tokenizerHfId = Qwen/Qwen2.5-7B-Instruct`) bound to that datasource.
- **Runs:** prefix-cache-validation benchmark twice (off, on) with the t2 deep-conversation
  template (most sensitive) + t1; plus one Mooncake-conversation run as the mainstream
  cross-check.
- **Report:** SavedCompare — TTFT p50/p99 delta + hit rate + `by(pod)` concentration,
  off vs on.
- **Success criteria:** on-run shows lower TTFT p99 (deep conversation most), higher hit
  rate, higher top-pod concentration — aligned with the original (stickiness 25% → 100%,
  TTFT p99 −42% to −50%).

## Open items (execution-time inputs, not design blockers)

- **Job cluster wiring:** which cluster the platform API submits the benchmark K8s Job to
  (determines in-cluster gateway service URL vs NodePort). Provide when creating the
  connection.
- Exact served model name, gateway baseUrl, in-cluster Prometheus URL, API key — provided
  by the user once endpoints are up.

## Risks

- **Open-loop Mooncake vs clean off/on comparison:** `--fixed-schedule` replay makes the
  off/on comparison less controlled than closed-loop synthetic. Mitigation: the primary
  apples-to-apples reproduction uses closed-loop multi-turn synthetic (t1/t2); Mooncake is
  a supplementary mainstream cross-check.
- **Aggregate vs sequential attribution:** concurrent load yields aggregate per-pod
  concentration, not per-prefix stickiness. Accepted (non-goal); sufficient for the
  routing on/off conclusion.
- **Image size / airgap:** baking two Mooncake traces grows `md-runner-aiperf`. Keep to
  the two official FAST25 traces; document in the airgap verify.
