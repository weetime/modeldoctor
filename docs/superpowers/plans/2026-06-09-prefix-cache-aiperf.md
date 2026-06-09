# Prefix-cache validation on standard aiperf + Prometheus annotation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the bespoke `prefix-cache-probe` tool and rebase the `prefix-cache-validation` scenario onto standard aiperf (multi-turn synthetic + Mooncake trace), surfacing cache hit-rate + per-pod concentration via a Prometheus snapshot taken at benchmark completion.

**Architecture:** Five sequenced phases, each ending build-green. (1) Extend the aiperf adapter additively. (2) Bake Mooncake traces into the aiperf runner image. (3) Add a Prometheus prefix-cache snapshot at terminal phase, stored in the existing `serverMetrics` JSON column. (4) Repoint the scenario + web at aiperf and rewrite seed templates. (5) Clean-break removal of the probe tool, compiler-guided by removing it from the `ToolName` union. The annotation reuses the existing `serverMetrics` column, so **no Prisma migration**.

**Tech Stack:** TypeScript monorepo (pnpm workspaces), Zod schemas, NestJS API, React + react-hook-form + react-i18next web, Python aiperf runner in K8s Jobs, Prometheus.

**Spec:** `docs/superpowers/specs/2026-06-09-prefix-cache-aiperf-design.md`

**Worktree note:** This runs in worktree `feature-prefix-cache-aiperf` (branch `feat/prefix-cache-aiperf`). A fresh worktree has empty `packages/*/dist`; **Task 0 builds once** so `apps/api` typecheck resolves workspace imports.

---

## Conventions for every task

- Run commands from the worktree root: `/Users/fangyong/vllm/modeldoctor/feature-prefix-cache-aiperf`.
- Package test runner is vitest; force one-shot (no watch): `pnpm --filter <pkg> test -- --run`.
- Tool-adapters must be rebuilt after schema/runtime edits before api/web typecheck sees them: `pnpm --filter @modeldoctor/tool-adapters build`.
- Commit after each task with the message shown. Do not push.

---

## Task 0: Build the fresh worktree once

**Files:** none (build only)

- [ ] **Step 1: Install + build all packages**

Run: `pnpm install && pnpm -r build`
Expected: all packages build; `packages/tool-adapters/dist`, `packages/contracts/dist` populated. No errors.

- [ ] **Step 2: Baseline test sanity (tool-adapters)**

Run: `pnpm --filter @modeldoctor/tool-adapters test -- --run`
Expected: PASS (green baseline before changes).

---

# Phase 1 — Extend the aiperf adapter (additive, build stays green)

## Task 1: Extend aiperf params schema (dataset enum + conversation + mooncake fields)

**Files:**
- Modify: `packages/tool-adapters/src/aiperf/schema.ts`
- Test: `packages/tool-adapters/src/aiperf/schema.spec.ts`

- [ ] **Step 1: Write failing tests for the new fields + cross-field rules**

Add to `schema.spec.ts`:

```typescript
import { aiperfParamsSchema } from "./schema.js";

describe("aiperf schema — prefix-cache extensions", () => {
  it("defaults dataset to synthetic and leaves conversation fields optional", () => {
    const r = aiperfParamsSchema.parse({});
    expect(r.dataset).toBe("synthetic");
    expect(r.conversationNum).toBeUndefined();
  });

  it("accepts multi-turn synthetic params", () => {
    const r = aiperfParamsSchema.parse({
      dataset: "synthetic",
      conversationNum: 30,
      conversationTurnMean: 10,
      conversationType: "sticky-user-sessions",
    });
    expect(r.conversationNum).toBe(30);
    expect(r.conversationTurnMean).toBe(10);
  });

  it("accepts mooncake-trace with a trace selection and block size", () => {
    const r = aiperfParamsSchema.parse({
      dataset: "mooncake-trace",
      mooncakeTrace: "conversation",
      islBlockSize: 512,
    });
    expect(r.dataset).toBe("mooncake-trace");
    expect(r.mooncakeTrace).toBe("conversation");
  });

  it("rejects conversation params on mooncake-trace (open-loop replay)", () => {
    expect(() =>
      aiperfParamsSchema.parse({
        dataset: "mooncake-trace",
        mooncakeTrace: "conversation",
        conversationNum: 30,
      }),
    ).toThrow();
  });

  it("rejects mooncake-trace without a trace selection", () => {
    expect(() => aiperfParamsSchema.parse({ dataset: "mooncake-trace" })).toThrow();
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm --filter @modeldoctor/tool-adapters test -- --run src/aiperf/schema.spec.ts`
Expected: FAIL (new fields/refinements not present).

- [ ] **Step 3: Extend the schema**

In `packages/tool-adapters/src/aiperf/schema.ts`, replace the `aiperfParamsSchema` definition (the `z.object({...})` currently ending before `aiperfParamDefaults`) with:

```typescript
export const aiperfParamsSchema = z
  .object({
    concurrency: z.number().int().min(1).max(512).default(8),
    requestCount: z.number().int().min(1).max(10000).default(100),
    inputTokensMean: z.number().int().min(1).max(32000).default(1024),
    inputTokensStddev: z.number().int().min(0).max(8192).default(128),
    outputTokensMean: z.number().int().min(1).max(4096).default(256),
    outputTokensStddev: z.number().int().min(0).max(2048).default(64),
    endpointType: z.enum(["chat", "completions"]).default("chat"),
    streaming: z.boolean().default(true),
    // synthetic = AIPerf internal generator (closed-loop, --concurrency).
    // sharegpt = baked ShareGPT corpus (closed-loop).
    // mooncake-trace = baked Mooncake trace replayed open-loop (--fixed-schedule).
    dataset: z.enum(["synthetic", "sharegpt", "mooncake-trace"]).default("synthetic"),
    seed: z.number().int().optional(),

    // Multi-turn (closed-loop only). Each conversation reuses its growing
    // prefix turn-by-turn; this is what exercises prefix-cache routing.
    conversationNum: z.number().int().min(1).max(10000).optional(),
    conversationTurnMean: z.number().int().min(1).max(100).optional(),
    conversationTurnStddev: z.number().int().min(0).max(50).optional(),
    conversationType: z.enum(["pooled", "sticky-user-sessions"]).optional(),
    conversationTurnDelayMeanMs: z.number().int().min(0).max(60000).optional(),

    // Mooncake (open-loop only).
    mooncakeTrace: z.enum(["conversation", "toolagent"]).optional(),
    islBlockSize: z.number().int().min(1).max(4096).optional(),
  })
  .superRefine((v, ctx) => {
    const isMooncake = v.dataset === "mooncake-trace";
    const hasConversation =
      v.conversationNum !== undefined ||
      v.conversationTurnMean !== undefined ||
      v.conversationTurnStddev !== undefined ||
      v.conversationType !== undefined ||
      v.conversationTurnDelayMeanMs !== undefined;

    if (isMooncake && hasConversation) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "conversation params are closed-loop only; mooncake-trace replays open-loop (--fixed-schedule)",
        path: ["conversationNum"],
      });
    }
    if (isMooncake && v.mooncakeTrace === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "dataset=mooncake-trace requires mooncakeTrace (conversation | toolagent)",
        path: ["mooncakeTrace"],
      });
    }
    if (!isMooncake && (v.mooncakeTrace !== undefined || v.islBlockSize !== undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "mooncakeTrace / islBlockSize are only valid when dataset=mooncake-trace",
        path: ["mooncakeTrace"],
      });
    }
  });
```

Leave `aiperfParamDefaults`, `aiperfReportSchema`, and the rest of the file unchanged.

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm --filter @modeldoctor/tool-adapters test -- --run src/aiperf/schema.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/tool-adapters/src/aiperf/schema.ts packages/tool-adapters/src/aiperf/schema.spec.ts
git commit -m "feat(aiperf): add multi-turn + mooncake-trace params to schema"
```

## Task 2: Emit the new aiperf flags in buildCommand (dataset-implied flow model)

**Files:**
- Modify: `packages/tool-adapters/src/aiperf/runtime.ts:12-73` (the `buildCommand` body)
- Test: `packages/tool-adapters/src/aiperf/runtime.spec.ts`

Mooncake traces are baked into the runner image (Task 5) at fixed paths:
`/app/.cache/aiperf/datasets/mooncake/conversation_trace.jsonl` and `.../toolagent_trace.jsonl`.

- [ ] **Step 1: Write failing tests for argv branching**

Add to `runtime.spec.ts` (mirror the existing buildCommand test setup — reuse its `baseConn`/plan fixture; if none exists, construct a plan with `connection: { baseUrl, apiKey, model, customHeaders:"", queryParams:"", tokenizerHfId:"Qwen/Q", prometheusDatasource:null }`):

```typescript
import { buildCommand } from "./runtime.js";

const conn = {
  baseUrl: "http://gw:30888",
  apiKey: "sk-x",
  model: "served-name",
  customHeaders: "",
  queryParams: "",
  tokenizerHfId: "Qwen/Qwen2.5-7B-Instruct",
  prometheusDatasource: null,
};

it("synthetic multi-turn → closed-loop concurrency + conversation flags", () => {
  const r = buildCommand({
    runId: "r1",
    params: {
      ...({} as any),
      concurrency: 20,
      requestCount: 300,
      inputTokensMean: 200,
      inputTokensStddev: 0,
      outputTokensMean: 800,
      outputTokensStddev: 0,
      endpointType: "chat",
      streaming: true,
      dataset: "synthetic",
      conversationNum: 30,
      conversationTurnMean: 10,
      conversationType: "sticky-user-sessions",
    },
    connection: conn,
  } as any);
  const flat = r.argv.join(" ");
  expect(flat).toContain("--concurrency 20");
  expect(flat).toContain("--conversation-num 30");
  expect(flat).toContain("--conversation-turn-mean 10");
  expect(flat).toContain("--conversation-type sticky-user-sessions");
  expect(flat).not.toContain("--fixed-schedule");
});

it("mooncake-trace → open-loop fixed-schedule, no concurrency", () => {
  const r = buildCommand({
    runId: "r2",
    params: {
      ...({} as any),
      concurrency: 20,
      requestCount: 300,
      inputTokensMean: 200,
      inputTokensStddev: 0,
      outputTokensMean: 800,
      outputTokensStddev: 0,
      endpointType: "chat",
      streaming: true,
      dataset: "mooncake-trace",
      mooncakeTrace: "conversation",
      islBlockSize: 512,
    },
    connection: conn,
  } as any);
  const flat = r.argv.join(" ");
  expect(flat).toContain("--input-file /app/.cache/aiperf/datasets/mooncake/conversation_trace.jsonl");
  expect(flat).toContain("--custom-dataset-type mooncake_trace");
  expect(flat).toContain("--isl-block-size 512");
  expect(flat).toContain("--fixed-schedule");
  expect(flat).not.toContain("--concurrency");
  expect(flat).not.toContain("--synthetic-input-tokens-mean");
});
```

- [ ] **Step 2: Run tests, verify fail**

Run: `pnpm --filter @modeldoctor/tool-adapters test -- --run src/aiperf/runtime.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Rewrite buildCommand**

Replace the body of `buildCommand` in `runtime.ts` (keep the function signature and the `OUTPUTS_DIR`/`SUMMARY_FILE` constants, and the `return {...}` shape) with:

```typescript
export function buildCommand(plan: BuildCommandPlan<AiperfParams>): BuildCommandResult {
  const { params, connection } = plan;
  const trimmedBase = connection.baseUrl.replace(/\/+$/, "");

  const argv: string[] = [
    "aiperf",
    "profile",
    "--model",
    connection.model,
    "--url",
    trimmedBase,
    "--endpoint-type",
    params.endpointType,
  ];

  if (connection.tokenizerHfId) argv.push("--tokenizer", connection.tokenizerHfId);
  if (params.streaming) argv.push("--streaming");

  if (params.dataset === "mooncake-trace") {
    // Open-loop trace replay. Concurrency is ignored; aiperf paces by the
    // trace's own timestamps via --fixed-schedule.
    const file = `/app/.cache/aiperf/datasets/mooncake/${params.mooncakeTrace}_trace.jsonl`;
    argv.push(
      "--input-file",
      file,
      "--custom-dataset-type",
      "mooncake_trace",
      "--fixed-schedule",
    );
    if (params.islBlockSize !== undefined) {
      argv.push("--isl-block-size", String(params.islBlockSize));
    }
  } else {
    // Closed-loop synthetic / sharegpt.
    argv.push(
      "--concurrency",
      String(params.concurrency),
      "--request-count",
      String(params.requestCount),
      "--synthetic-input-tokens-mean",
      String(params.inputTokensMean),
      "--synthetic-input-tokens-stddev",
      String(params.inputTokensStddev),
      "--output-tokens-mean",
      String(params.outputTokensMean),
      "--output-tokens-stddev",
      String(params.outputTokensStddev),
    );
    if (params.dataset === "sharegpt") argv.push("--public-dataset", "sharegpt");

    if (params.conversationNum !== undefined) {
      argv.push("--conversation-num", String(params.conversationNum));
    }
    if (params.conversationTurnMean !== undefined) {
      argv.push("--conversation-turn-mean", String(params.conversationTurnMean));
    }
    if (params.conversationTurnStddev !== undefined) {
      argv.push("--conversation-turn-stddev", String(params.conversationTurnStddev));
    }
    if (params.conversationType !== undefined) {
      argv.push("--conversation-type", params.conversationType);
    }
    if (params.conversationTurnDelayMeanMs !== undefined) {
      argv.push("--conversation-turn-delay-mean", String(params.conversationTurnDelayMeanMs));
    }
  }

  if (params.seed !== undefined) argv.push("--random-seed", String(params.seed));
  argv.push("--artifact-dir", OUTPUTS_DIR);

  return {
    argv,
    env: {},
    secretEnv: { OPENAI_API_KEY: connection.apiKey },
    outputFiles: { report: `${OUTPUTS_DIR}/${SUMMARY_FILE}` },
  };
}
```

- [ ] **Step 4: Run tests (file + full adapter suite)**

Run: `pnpm --filter @modeldoctor/tool-adapters test -- --run`
Expected: PASS (existing buildCommand tests still pass; new ones pass).

- [ ] **Step 5: Rebuild adapter + commit**

```bash
pnpm --filter @modeldoctor/tool-adapters build
git add packages/tool-adapters/src/aiperf/runtime.ts packages/tool-adapters/src/aiperf/runtime.spec.ts
git commit -m "feat(aiperf): branch argv by dataset (closed-loop synthetic vs open-loop mooncake)"
```

## Task 3: Register aiperf for the prefix-cache-validation scenario

**Files:**
- Modify: `packages/tool-adapters/src/aiperf/index.ts:10` (the `scenarios` field)

- [ ] **Step 1: Add the scenario to the adapter**

In `aiperf/index.ts`, change:

```typescript
  scenarios: ["inference"] as const,
```
to:
```typescript
  scenarios: ["inference", "prefix-cache-validation"] as const,
```

- [ ] **Step 2: Build + commit**

Run: `pnpm --filter @modeldoctor/tool-adapters build`
Expected: builds clean.

```bash
git add packages/tool-adapters/src/aiperf/index.ts
git commit -m "feat(aiperf): register aiperf for prefix-cache-validation scenario"
```

---

# Phase 2 — Bake Mooncake traces into the aiperf runner image

## Task 4: Vendor the two official Mooncake traces into the build context

**Files:**
- Create: `apps/benchmark-runner/images/.mooncake/conversation_trace.jsonl`
- Create: `apps/benchmark-runner/images/.mooncake/toolagent_trace.jsonl`
- Modify: `apps/benchmark-runner/.gitignore` or `.dockerignore` if it excludes `.mooncake` (mirror how `.sharegpt` is handled)

- [ ] **Step 1: Check how `.sharegpt` is vendored**

Run: `ls -la apps/benchmark-runner/images/.sharegpt/ && git check-ignore apps/benchmark-runner/images/.sharegpt/ShareGPT_V3_unfiltered_cleaned_split.json; echo "exit=$?"`
Expected: shows whether the dataset file is gitignored (large file kept out of git, downloaded at build time) or committed. Mirror that policy for `.mooncake`.

- [ ] **Step 2: Download the two traces into the build context**

Run:
```bash
mkdir -p apps/benchmark-runner/images/.mooncake
curl -fsSL -o apps/benchmark-runner/images/.mooncake/conversation_trace.jsonl \
  https://raw.githubusercontent.com/kvcache-ai/Mooncake/main/FAST25-release/traces/conversation_trace.jsonl
curl -fsSL -o apps/benchmark-runner/images/.mooncake/toolagent_trace.jsonl \
  https://raw.githubusercontent.com/kvcache-ai/Mooncake/main/FAST25-release/traces/toolagent_trace.jsonl
wc -l apps/benchmark-runner/images/.mooncake/*.jsonl
```
Expected: both files non-empty, valid JSONL. (If the path 404s, browse `https://github.com/kvcache-ai/Mooncake/tree/main/FAST25-release/traces` for the current filenames and adjust.)

- [ ] **Step 3: Match `.sharegpt` ignore policy**

If `.sharegpt` is gitignored, add `images/.mooncake/` to the same ignore file so the large traces are not committed (they are vendored at build time). If `.sharegpt` is committed, commit the traces too.

- [ ] **Step 4: Commit (ignore rule and/or vendored files per policy)**

```bash
git add apps/benchmark-runner/.gitignore apps/benchmark-runner/.dockerignore 2>/dev/null; \
git add apps/benchmark-runner/images/.mooncake 2>/dev/null; \
git commit -m "build(runner): vendor Mooncake conversation+toolagent traces for aiperf image"
```

## Task 5: Bake the traces into the aiperf base image + airgap verify

**Files:**
- Modify: `apps/benchmark-runner/images/aiperf.base.Dockerfile` (after the ShareGPT COPY)
- Modify: `apps/benchmark-runner/scripts/verify-airgap.sh` (add assertions)

- [ ] **Step 1: COPY traces in the base Dockerfile**

In `aiperf.base.Dockerfile`, after the existing ShareGPT COPY block, add:

```dockerfile
RUN mkdir -p /app/.cache/aiperf/datasets/mooncake
COPY images/.mooncake/conversation_trace.jsonl \
     /app/.cache/aiperf/datasets/mooncake/conversation_trace.jsonl
COPY images/.mooncake/toolagent_trace.jsonl \
     /app/.cache/aiperf/datasets/mooncake/toolagent_trace.jsonl
```

- [ ] **Step 2: Extend airgap verification**

In `verify-airgap.sh`, after the ShareGPT assertion block (the `test -s /app/.cache/aiperf/datasets/ShareGPT...` line), add:

```bash
docker run --rm --network none --entrypoint /bin/sh "$AIPERF_IMAGE" \
  -c 'test -s /app/.cache/aiperf/datasets/mooncake/conversation_trace.jsonl' \
  >/dev/null && pass "mooncake conversation trace baked" || fail "mooncake conversation trace missing"

docker run --rm --network none --entrypoint /bin/sh "$AIPERF_IMAGE" \
  -c 'test -s /app/.cache/aiperf/datasets/mooncake/toolagent_trace.jsonl' \
  >/dev/null && pass "mooncake toolagent trace baked" || fail "mooncake toolagent trace missing"
```

- [ ] **Step 3: Rebuild the aiperf image and verify airgap**

Run:
```bash
bash tools/build-runner-images.sh aiperf 2>&1 | tail -5 || bash tools/build-runner-images.sh 2>&1 | tail -5
IMAGE_AIPERF=$(docker images --format '{{.Repository}}:{{.Tag}}' | grep md-runner-aiperf | head -1) \
  bash apps/benchmark-runner/scripts/verify-airgap.sh
```
Expected: airgap check prints ✓ for ShareGPT + both mooncake traces.

- [ ] **Step 4: Commit**

```bash
git add apps/benchmark-runner/images/aiperf.base.Dockerfile apps/benchmark-runner/scripts/verify-airgap.sh
git commit -m "build(runner): bake Mooncake traces into aiperf image + airgap assertions"
```

---

# Phase 3 — Prometheus prefix-cache snapshot at completion

## Task 6: Define the prefixCacheAnnotation contract shape

**Files:**
- Modify: `packages/contracts/src/benchmark.ts` (add an exported schema near `reportResultSchema` ~line 210)
- Test: `packages/contracts/src/benchmark.spec.ts` (create if absent)

The annotation is stored under `serverMetrics.prefixCache` (existing nullable JSON column — no Prisma change).

- [ ] **Step 1: Write a failing test for the schema**

Add to `packages/contracts/src/benchmark.spec.ts`:

```typescript
import { prefixCacheAnnotationSchema } from "./benchmark.js";

it("parses a prefix-cache annotation", () => {
  const a = prefixCacheAnnotationSchema.parse({
    hitRatePct: 96.6,
    topPodSharePct: 100,
    perPod: [{ pod: "infer-abc-0", queries: 300, hits: 290 }],
    metricTag: "v1",
  });
  expect(a.hitRatePct).toBeCloseTo(96.6);
  expect(a.perPod).toHaveLength(1);
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @modeldoctor/contracts test -- --run src/benchmark.spec.ts`
Expected: FAIL (export missing).

- [ ] **Step 3: Add the schema**

In `packages/contracts/src/benchmark.ts`, add (after `reportResultSchema`):

```typescript
export const prefixCacheAnnotationSchema = z.object({
  hitRatePct: z.number().min(0).max(100),
  topPodSharePct: z.number().min(0).max(100),
  perPod: z.array(
    z.object({
      pod: z.string(),
      queries: z.number().nonnegative(),
      hits: z.number().nonnegative(),
    }),
  ),
  metricTag: z.enum(["v1", "v0"]),
});
export type PrefixCacheAnnotation = z.infer<typeof prefixCacheAnnotationSchema>;
```

- [ ] **Step 4: Run, verify pass; build**

Run: `pnpm --filter @modeldoctor/contracts test -- --run src/benchmark.spec.ts && pnpm --filter @modeldoctor/contracts build`
Expected: PASS + clean build.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/benchmark.ts packages/contracts/src/benchmark.spec.ts
git commit -m "feat(contracts): add prefixCacheAnnotation schema (stored under serverMetrics)"
```

## Task 7: Add a Prometheus prefix-cache snapshot service in the API

**Files:**
- Create: `apps/api/src/modules/benchmark/prefix-cache/prefix-cache-snapshot.service.ts`
- Create: `apps/api/src/modules/benchmark/prefix-cache/prefix-cache-snapshot.service.spec.ts`

This service: given a datasource + model + time window, runs an instant PromQL query of `increase(...[windowSec s])` grouped `by (pod)`, with V1→V0 fallback, and computes the annotation. It does NOT touch the DB (caller persists).

- [ ] **Step 1: Write failing unit tests (pure computation from a fake fetcher)**

Create the spec:

```typescript
import { describe, expect, it, vi } from "vitest";
import { PrefixCacheSnapshotService } from "./prefix-cache-snapshot.service.js";

function fakeFetcher(seriesByQuery: Record<string, { labels: Record<string, string>; value: number }[]>) {
  return {
    runQuery: vi.fn(async (_ds: unknown, query: string) => ({
      series: seriesByQuery[query] ?? [],
    })),
  } as any;
}

const ds = { id: "d1", baseUrl: "http://prom" } as any;

describe("PrefixCacheSnapshotService", () => {
  it("computes hit rate + top-pod share from v1 series", async () => {
    const model = "served";
    const qQ = `sum by (pod) (increase(vllm:prefix_cache_queries_total{model_name="${model}"}[600s]))`;
    const qH = `sum by (pod) (increase(vllm:prefix_cache_hits_total{model_name="${model}"}[600s]))`;
    const svc = new PrefixCacheSnapshotService(
      fakeFetcher({
        [qQ]: [
          { labels: { pod: "p0" }, value: 300 },
          { labels: { pod: "p1" }, value: 0 },
        ],
        [qH]: [{ labels: { pod: "p0" }, value: 290 }],
      }),
    );
    const a = await svc.snapshot({ ds, model, windowSec: 600, at: new Date(0) });
    expect(a?.metricTag).toBe("v1");
    expect(a?.hitRatePct).toBeCloseTo((290 / 300) * 100, 1);
    expect(a?.topPodSharePct).toBeCloseTo(100, 1); // p0 has all queries
    expect(a?.perPod.find((p) => p.pod === "p0")?.hits).toBe(290);
  });

  it("falls back to v0 gpu_ metric when v1 is empty", async () => {
    const model = "m";
    const qV0 = `sum by (pod) (increase(vllm:gpu_prefix_cache_queries_total{model_name="${model}"}[600s]))`;
    const hV0 = `sum by (pod) (increase(vllm:gpu_prefix_cache_hits_total{model_name="${model}"}[600s]))`;
    const svc = new PrefixCacheSnapshotService(
      fakeFetcher({ [qV0]: [{ labels: { pod: "x" }, value: 10 }], [hV0]: [{ labels: { pod: "x" }, value: 4 }] }),
    );
    const a = await svc.snapshot({ ds, model, windowSec: 600, at: new Date(0) });
    expect(a?.metricTag).toBe("v0");
    expect(a?.hitRatePct).toBeCloseTo(40, 1);
  });

  it("returns null when no series at all (degrade)", async () => {
    const svc = new PrefixCacheSnapshotService(fakeFetcher({}));
    const a = await svc.snapshot({ ds, model: "m", windowSec: 600, at: new Date(0) });
    expect(a).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @modeldoctor/api test -- --run src/modules/benchmark/prefix-cache/prefix-cache-snapshot.service.spec.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement the service**

Create `prefix-cache-snapshot.service.ts`:

```typescript
import { Injectable } from "@nestjs/common";
import type { PrefixCacheAnnotation } from "@modeldoctor/contracts";
import { PrometheusFetcherService } from "../../alerts/prometheus-fetcher.service.js";

interface PromSeries {
  labels: Record<string, string>;
  value: number;
}
interface MinimalFetcher {
  runQuery(
    ds: unknown,
    query: string,
    opts: { kind: "instant"; time?: Date },
  ): Promise<{ series: PromSeries[] }>;
}

export interface SnapshotInput {
  ds: unknown; // PrometheusDatasource
  model: string;
  windowSec: number;
  at: Date; // evaluation time (benchmark completedAt)
}

@Injectable()
export class PrefixCacheSnapshotService {
  // PrometheusFetcherService satisfies MinimalFetcher; typed loosely so the
  // service is unit-testable with a fake.
  constructor(private readonly fetcher: MinimalFetcher) {}

  static inject = [PrometheusFetcherService];

  private q(metric: string, model: string, windowSec: number): string {
    return `sum by (pod) (increase(vllm:${metric}{model_name="${model}"}[${windowSec}s]))`;
  }

  private async byPod(ds: unknown, query: string, at: Date): Promise<Map<string, number>> {
    const res = await this.fetcher.runQuery(ds, query, { kind: "instant", time: at });
    const m = new Map<string, number>();
    for (const s of res.series) {
      const pod = s.labels.pod ?? "";
      if (pod) m.set(pod, (m.get(pod) ?? 0) + s.value);
    }
    return m;
  }

  async snapshot({ ds, model, windowSec, at }: SnapshotInput): Promise<PrefixCacheAnnotation | null> {
    for (const tag of ["v1", "v0"] as const) {
      const qMetric = tag === "v1" ? "prefix_cache_queries_total" : "gpu_prefix_cache_queries_total";
      const hMetric = tag === "v1" ? "prefix_cache_hits_total" : "gpu_prefix_cache_hits_total";
      const queries = await this.byPod(ds, this.q(qMetric, model, windowSec), at);
      if (queries.size === 0) continue;
      const hits = await this.byPod(ds, this.q(hMetric, model, windowSec), at);

      const perPod = [...queries.entries()].map(([pod, q]) => ({
        pod,
        queries: q,
        hits: hits.get(pod) ?? 0,
      }));
      const totalQ = perPod.reduce((a, p) => a + p.queries, 0);
      const totalH = perPod.reduce((a, p) => a + p.hits, 0);
      const topQ = perPod.reduce((mx, p) => Math.max(mx, p.queries), 0);

      return {
        metricTag: tag,
        hitRatePct: totalQ > 0 ? (totalH / totalQ) * 100 : 0,
        topPodSharePct: totalQ > 0 ? (topQ / totalQ) * 100 : 0,
        perPod,
      };
    }
    return null;
  }
}
```

> Note: confirm `PrometheusFetcherService.runQuery` returns `{ series: [{ labels, ... value }] }` with a numeric value per series for instant queries (the research found `PromQueryResult` has a series array with labels + samples). If the value lives under `samples[0].value` or `[ts, "value"]`, adapt `byPod` to read it and add a focused test. Keep the `MinimalFetcher` shape matching the real return.

- [ ] **Step 4: Run, verify pass**

Run: `pnpm --filter @modeldoctor/api test -- --run src/modules/benchmark/prefix-cache/prefix-cache-snapshot.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/benchmark/prefix-cache/
git commit -m "feat(api): prefix-cache Prometheus snapshot service (by-pod hit rate + concentration)"
```

## Task 8: Call the snapshot at terminal phase and store under serverMetrics

**Files:**
- Modify: `apps/api/src/modules/benchmark/storage/report-loader.ts` (after the `updateGuarded(... status:"completed" ...)` success, ~lines 45-57)
- Modify: the benchmark module providers to register `PrefixCacheSnapshotService` (the NestJS module file that declares `ReportLoader` — find via `grep -rl "ReportLoader" apps/api/src/modules/benchmark/**/*.module.ts`)
- Test: extend `report-loader`'s existing spec if present; otherwise an integration-light test is optional given Task 7 covers the computation.

- [ ] **Step 1: Register the provider**

In the benchmark module that provides `ReportLoader`, add `PrefixCacheSnapshotService` to `providers` and ensure `PrometheusFetcherService` is importable (it lives in the alerts module — import that module or add the service to providers if already globally available). Inject `PrefixCacheSnapshotService` into `ReportLoader`'s constructor.

- [ ] **Step 2: Invoke after completion**

In `report-loader.ts`, immediately after the benchmark is updated to `completed` with `summaryMetrics`/`rawOutput` (where `updated === true`), add a best-effort, non-fatal snapshot. Only run for the prefix-cache scenario and when a datasource is bound:

```typescript
// Best-effort prefix-cache annotation. Never fails the completion path.
try {
  const bench = await this.benchmarks.findByIdRaw(runId); // loads scenario, model, startedAt, completedAt, connectionId
  if (bench?.scenario === "prefix-cache-validation" && bench.connectionId) {
    const ds = await this.promFetcher.resolveDatasourceByRef({ connectionId: bench.connectionId });
    const start = bench.startedAt ? new Date(bench.startedAt) : null;
    const end = bench.completedAt ? new Date(bench.completedAt) : new Date();
    if (ds && start) {
      const windowSec = Math.max(60, Math.ceil((end.getTime() - start.getTime()) / 1000));
      const ann = await this.prefixCacheSnapshot.snapshot({
        ds,
        model: bench.model ?? bench.connection?.model ?? "",
        windowSec,
        at: end,
      });
      if (ann) {
        await this.benchmarks.mergeServerMetrics(runId, { prefixCache: ann });
      }
    }
  }
} catch (err) {
  this.log?.warn?.(`prefix-cache snapshot skipped for ${runId}: ${String(err)}`);
}
```

> Use the repository's existing read of the just-updated row if `findByIdRaw` isn't the exact name — match the repo's actual finder that returns `scenario`, `model`, `startedAt`, `completedAt`, `connectionId`, and `connection.model`. Add a small `mergeServerMetrics(id, patch)` repo method that does `UPDATE ... server_metrics = COALESCE(server_metrics,'{}'::jsonb) || :patch` (or read-modify-write the JSON column) if no equivalent exists.

- [ ] **Step 3: Typecheck the API**

Run: `pnpm --filter @modeldoctor/api typecheck` (or `pnpm --filter @modeldoctor/api build`)
Expected: clean.

- [ ] **Step 4: Run api tests**

Run: `pnpm --filter @modeldoctor/api test -- --run src/modules/benchmark`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/benchmark
git commit -m "feat(api): snapshot prefix-cache metrics on completion into serverMetrics.prefixCache"
```

## Task 9: (Spec item) Add a per-pod concentration metric to the vLLM engine manifest

**Files:**
- Modify: `packages/contracts/src/engine-metrics/manifests/vllm.ts` (add an `EngineMetricSpec` near `prefix_cache_hit_rate` ~line 174)

This powers the live engine-metrics dashboard (separate from the snapshot). Mirror the existing `prefix_cache_hit_rate` entry.

- [ ] **Step 1: Add the metric entry**

Insert after the `prefix_cache_hit_rate` entry:

```typescript
{
  key: "prefix_cache_top_pod_share",
  unit: "%",
  promql: [
    {
      tag: "v1",
      expr: `100 * max(sum by (pod) (rate(vllm:prefix_cache_queries_total{model_name="${M}"}[5m]))) / clamp_min(sum(rate(vllm:prefix_cache_queries_total{model_name="${M}"}[5m])), 1)`,
    },
    {
      tag: "v0",
      expr: `100 * max(sum by (pod) (rate(vllm:gpu_prefix_cache_queries_total{model_name="${M}"}[5m]))) / clamp_min(sum(rate(vllm:gpu_prefix_cache_queries_total{model_name="${M}"}[5m])), 1)`,
    },
  ],
},
```

- [ ] **Step 2: Build contracts; run manifest tests if any**

Run: `pnpm --filter @modeldoctor/contracts build && pnpm --filter @modeldoctor/contracts test -- --run`
Expected: clean + PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/contracts/src/engine-metrics/manifests/vllm.ts
git commit -m "feat(contracts): add prefix_cache_top_pod_share to vLLM engine manifest"
```

---

# Phase 4 — Repoint scenario + web at aiperf, rewrite templates

## Task 10: Point the scenario config at aiperf + InferenceReport

**Files:**
- Modify: `packages/tool-adapters/src/scenarios.ts:63-70`

- [ ] **Step 1: Update the scenario config**

Replace the `"prefix-cache-validation"` block with:

```typescript
  "prefix-cache-validation": {
    label: "Prefix-cache 路由验证",
    description:
      "标准 aiperf 多轮 / Mooncake trace 驱动前缀复用负载,关/开 ai-load-balancer 对比 TTFT;命中率与逐-pod 集中度来自 Prometheus 快照",
    tools: ["aiperf"],
    paramsConstraints: {},
    reportComponent: "InferenceReport",
  },
```

- [ ] **Step 2: Build + adapter tests (scenario tests may assert tool wiring)**

Run: `pnpm --filter @modeldoctor/tool-adapters test -- --run && pnpm --filter @modeldoctor/tool-adapters build`
Expected: PASS. If `scenarios.spec.ts` asserted `tools: ["prefix-cache-probe"]`, update that assertion to `["aiperf"]`.

- [ ] **Step 3: Commit**

```bash
git add packages/tool-adapters/src/scenarios.ts packages/tool-adapters/src/scenarios.spec.ts 2>/dev/null
git commit -m "refactor(scenarios): rebase prefix-cache-validation on aiperf + InferenceReport"
```

## Task 11: Add a PrefixCachePanel and render it on prefix-cache reports

**Files:**
- Create: `apps/web/src/features/benchmarks/reports/PrefixCachePanel.tsx`
- Create: `apps/web/src/features/benchmarks/reports/__tests__/PrefixCachePanel.test.tsx`
- Modify: `apps/web/src/features/benchmarks/BenchmarkDetailPage.tsx:172` (the `case "prefix-cache-validation"`)

- [ ] **Step 1: Write failing panel tests**

```tsx
import { render, screen } from "@testing-library/react";
import { PrefixCachePanel } from "../PrefixCachePanel";

it("renders hit rate + top-pod share when annotation present", () => {
  render(
    <PrefixCachePanel
      serverMetrics={{ prefixCache: { hitRatePct: 96.6, topPodSharePct: 100, perPod: [{ pod: "p0", queries: 300, hits: 290 }], metricTag: "v1" } }}
    />,
  );
  expect(screen.getByText(/96.6/)).toBeInTheDocument();
  expect(screen.getByText(/p0/)).toBeInTheDocument();
});

it("renders a degrade note when annotation absent", () => {
  render(<PrefixCachePanel serverMetrics={null} />);
  expect(screen.getByText(/Prometheus/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @modeldoctor/web test -- --run src/features/benchmarks/reports/__tests__/PrefixCachePanel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the panel**

```tsx
import { prefixCacheAnnotationSchema } from "@modeldoctor/contracts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function PrefixCachePanel({ serverMetrics }: { serverMetrics: unknown }) {
  const sm = serverMetrics as { prefixCache?: unknown } | null;
  const parsed = prefixCacheAnnotationSchema.safeParse(sm?.prefixCache);
  if (!parsed.success) {
    return (
      <p className="rounded border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
        未绑定 Prometheus 或无 vLLM prefix-cache 指标,本次无命中率 / 集中度数据。
      </p>
    );
  }
  const d = parsed.data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Prefix-cache 命中率</CardTitle></CardHeader>
          <CardContent className="text-3xl font-semibold">{d.hitRatePct.toFixed(1)}%</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>主导 pod 集中度</CardTitle></CardHeader>
          <CardContent className="text-3xl font-semibold">{d.topPodSharePct.toFixed(1)}%</CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>逐-pod 请求分布</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow><TableHead>Pod</TableHead><TableHead className="text-right">Queries</TableHead><TableHead className="text-right">Hits</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {d.perPod.map((p) => (
                <TableRow key={p.pod}>
                  <TableCell>{p.pod}</TableCell>
                  <TableCell className="text-right">{p.queries}</TableCell>
                  <TableCell className="text-right">{p.hits}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Wire it into the detail page**

In `BenchmarkDetailPage.tsx`, replace the `case "prefix-cache-validation": { ... }` block with:

```tsx
  case "prefix-cache-validation":
    return (
      <div className="space-y-6">
        <InferenceReport benchmark={benchmark} />
        <PrefixCachePanel serverMetrics={benchmark.serverMetrics} />
      </div>
    );
```

Add the import `import { PrefixCachePanel } from "./reports/PrefixCachePanel";` and remove the now-unused `PrefixCacheProbeReport` + `prefixCacheProbeReportSchema` imports (Task 14 deletes those files; removing the imports here keeps this commit compiling only if those symbols are still present — so in THIS task only remove the `case` body usage; delete the imports in Task 14). To keep this commit green, leave the imports for now (unused-import lint is a warning, not error) OR move the import deletion to Task 14. Prefer: leave imports, delete in Task 14.

- [ ] **Step 5: Run web tests**

Run: `pnpm --filter @modeldoctor/web test -- --run src/features/benchmarks/reports/__tests__/PrefixCachePanel.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/benchmarks/reports/PrefixCachePanel.tsx apps/web/src/features/benchmarks/reports/__tests__/PrefixCachePanel.test.tsx apps/web/src/features/benchmarks/BenchmarkDetailPage.tsx
git commit -m "feat(web): render prefix-cache panel (Prometheus annotation) on prefix-cache reports"
```

## Task 12: Extend the aiperf params form with multi-turn + mooncake fields

**Files:**
- Modify: `apps/web/src/features/benchmarks/forms/AiperfParamsForm.tsx`
- Modify: i18n message catalogs for `forms.aiperf.*` (find via `grep -rl "forms.aiperf" apps/web/src` — add keys for the new fields in zh + en)

- [ ] **Step 1: Add the dataset option + conditional fields**

In `AiperfParamsForm.tsx`: add `"mooncake-trace"` to the `DATASETS` list. Watch the `dataset` field value (react-hook-form `useWatch`). When `dataset !== "mooncake-trace"`, render number inputs for `conversationNum`, `conversationTurnMean`, and a select for `conversationType` (`pooled | sticky-user-sessions`), mirroring the existing `grid md:grid-cols-2/3` + `FormField` pattern. When `dataset === "mooncake-trace"`, render a select for `mooncakeTrace` (`conversation | toolagent`) and a number input for `islBlockSize`. Use the same `numberField(field)` helper and `FormMessage` already in the file.

- [ ] **Step 2: Add i18n keys**

Add `forms.aiperf.conversationNum`, `.conversationTurnMean`, `.conversationType`, `.mooncakeTrace`, `.islBlockSize`, `.dataset.mooncake-trace` to the zh and en `benchmarks` namespaces (mirror existing aiperf keys).

- [ ] **Step 3: Typecheck + web tests**

Run: `pnpm --filter @modeldoctor/web typecheck && pnpm --filter @modeldoctor/web test -- --run src/features/benchmarks/forms`
Expected: clean + PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/benchmarks/forms/AiperfParamsForm.tsx apps/web/src/locales 2>/dev/null apps/web/src/**/*i18n* 2>/dev/null
git commit -m "feat(web): aiperf form — multi-turn + mooncake-trace fields"
```

## Task 13: Rewrite the two probe templates as five aiperf prefix-cache templates

**Files:**
- Modify: `apps/api/prisma/seed.ts:761-792` (replace the two `tpl_pc_*` probe templates)

- [ ] **Step 1: Replace the templates**

Replace the two `tool: "prefix-cache-probe"` template objects with (mirror the `tpl_inf_aiperf_baseline` shape at seed.ts:633-653):

```typescript
  {
    id: "tpl_pc_t1_article",
    name: "路由粘性 · 文章同款 (t1)",
    description:
      "Higress 文章同款多轮:60 会话 × 5 轮,in 200 / out 800,concurrency 20。关/开 ai-load-balancer 对比 TTFT。",
    scenario: "prefix-cache-validation",
    tool: "aiperf",
    config: {
      concurrency: 20,
      requestCount: 300,
      inputTokensMean: 200,
      inputTokensStddev: 0,
      outputTokensMean: 800,
      outputTokensStddev: 0,
      endpointType: "chat",
      streaming: true,
      dataset: "synthetic",
      conversationNum: 60,
      conversationTurnMean: 5,
      conversationType: "sticky-user-sessions",
      seed: 42,
    },
    tags: ["prefix-cache", "aiperf", "multi-turn", "article"],
    categories: ["chat"],
  },
  {
    id: "tpl_pc_t2_deep",
    name: "路由粘性 · 深会话 (t2)",
    description: "深会话:30 会话 × 10 轮,前缀累积最多,prefix-cache 收益最敏感。",
    scenario: "prefix-cache-validation",
    tool: "aiperf",
    config: {
      concurrency: 20,
      requestCount: 300,
      inputTokensMean: 200,
      inputTokensStddev: 0,
      outputTokensMean: 800,
      outputTokensStddev: 0,
      endpointType: "chat",
      streaming: true,
      dataset: "synthetic",
      conversationNum: 30,
      conversationTurnMean: 10,
      conversationType: "sticky-user-sessions",
      seed: 42,
    },
    tags: ["prefix-cache", "aiperf", "multi-turn", "deep"],
    categories: ["chat"],
  },
  {
    id: "tpl_pc_t3_shallow",
    name: "路由粘性 · 浅会话 (t3)",
    description: "浅会话:120 会话 × 2 轮,对照锚点,prefix-cache 收益最小。",
    scenario: "prefix-cache-validation",
    tool: "aiperf",
    config: {
      concurrency: 20,
      requestCount: 240,
      inputTokensMean: 200,
      inputTokensStddev: 0,
      outputTokensMean: 800,
      outputTokensStddev: 0,
      endpointType: "chat",
      streaming: true,
      dataset: "synthetic",
      conversationNum: 120,
      conversationTurnMean: 2,
      conversationType: "sticky-user-sessions",
      seed: 42,
    },
    tags: ["prefix-cache", "aiperf", "multi-turn", "shallow"],
    categories: ["chat"],
  },
  {
    id: "tpl_pc_mooncake_conv",
    name: "缓存感知 · Mooncake 对话",
    description: "Mooncake conversation trace(~40% 前缀复用)开环回放,业界标准缓存感知负载。",
    scenario: "prefix-cache-validation",
    tool: "aiperf",
    config: {
      endpointType: "chat",
      streaming: true,
      dataset: "mooncake-trace",
      mooncakeTrace: "conversation",
      islBlockSize: 512,
      seed: 42,
      // closed-loop fields are present as schema defaults but ignored in open-loop
      concurrency: 8,
      requestCount: 100,
      inputTokensMean: 1024,
      inputTokensStddev: 128,
      outputTokensMean: 256,
      outputTokensStddev: 64,
    },
    tags: ["prefix-cache", "aiperf", "mooncake"],
    categories: ["chat"],
  },
  {
    id: "tpl_pc_mooncake_agent",
    name: "缓存感知 · Mooncake Agent",
    description: "Mooncake toolagent trace(~59% 前缀复用)开环回放,长 system prompt + 工具形态。",
    scenario: "prefix-cache-validation",
    tool: "aiperf",
    config: {
      endpointType: "chat",
      streaming: true,
      dataset: "mooncake-trace",
      mooncakeTrace: "toolagent",
      islBlockSize: 512,
      seed: 42,
      concurrency: 8,
      requestCount: 100,
      inputTokensMean: 1024,
      inputTokensStddev: 128,
      outputTokensMean: 256,
      outputTokensStddev: 64,
    },
    tags: ["prefix-cache", "aiperf", "mooncake"],
    categories: ["chat"],
  },
```

> The seed upsert validates each `config` through `aiperfParamsSchema` then `applyScenarioConstraints`. Because the mooncake configs include closed-loop fields, the `superRefine` from Task 1 forbids conversation fields but ALLOWS the closed-loop token fields (they are not conversation fields) — confirm this passes; if `applyScenarioConstraints` rejects extra fields, trim the mooncake configs to only the mooncake-relevant keys.

- [ ] **Step 2: Run the seed against the dev DB**

> Dev DB is shared and resets are NOT pre-authorized. Seed upsert is idempotent (no reset). Run:

Run: `pnpm --filter @modeldoctor/api exec prisma db seed` (or the project's seed script — check `apps/api/package.json` `prisma.seed`)
Expected: upserts succeed; the two old `tpl_pc_quick_sanity` / `tpl_pc_deeper_coverage` rows remain orphaned until cleaned (acceptable; or add a delete for those two ids in the seed cleanup step if the seed has one).

- [ ] **Step 3: Commit**

```bash
git add apps/api/prisma/seed.ts
git commit -m "feat(seed): replace probe templates with aiperf multi-turn + mooncake prefix-cache templates"
```

---

# Phase 5 — Clean-break removal of prefix-cache-probe (compiler-guided)

## Task 14: Remove the prefix-cache-probe tool everywhere

Removing `"prefix-cache-probe"` from the `ToolName` union turns every `Record<ToolName, …>` and exhaustive `switch` into a compile error, enumerating each site. Work the errors to zero.

**Files (delete):**
- `packages/tool-adapters/src/prefix-cache-probe/` (entire directory)
- `apps/web/src/features/benchmarks/forms/PrefixCacheProbeParamsForm.tsx` + `__tests__/PrefixCacheProbeParamsForm.test.tsx`
- `apps/web/src/features/benchmarks/reports/PrefixCacheProbeReport.tsx` + `__tests__/PrefixCacheProbeReport.test.tsx`
- `apps/benchmark-runner/scripts/prefix_cache_probe.py`
- `apps/benchmark-runner/images/prefix-cache-probe.Dockerfile` (if present)

**Files (modify — remove the probe entry/branch):**
- `packages/tool-adapters/src/core/interface.ts:12` (ToolName), `:25` (import), `:32` (ToolReport union member)
- `packages/tool-adapters/src/core/registry.ts:4,12`
- `packages/tool-adapters/src/category-defaults.ts:43-49` (delete `PREFIX_CACHE_PROBE_CATEGORY_DEFAULTS`)
- `packages/tool-adapters/src/schemas-entry.ts:21,56-63`
- `packages/tool-adapters/src/index.ts:13-16,45-50`
- `packages/tool-adapters/src/core/row-descriptors.fe.ts:4,16`
- `packages/tool-adapters/src/core/read-metric-safe.fe.ts:9,17`
- `packages/contracts/src/benchmark.ts:15-21` (remove `"prefix-cache-probe"` from `benchmarkToolSchema`)
- `apps/api/src/config/env.schema.ts:80` + `apps/api/src/config/env.spec.ts:15,55`
- `apps/api/src/modules/benchmark/k8s/runner-images.ts:8`
- `apps/api/src/modules/benchmark/benchmark.repository.ts:18`
- `apps/api/src/modules/mcp/tools/run-benchmark.tool.ts:30` (drop `prefix-cache-probe` from the description string)
- `apps/web/src/features/benchmarks/forms/ToolParamsEditor.tsx` (pickParamsForm, TOOL_DEFAULTS, TOOL_CATEGORY_DEFAULTS)
- `apps/web/src/features/benchmarks/RequestSetupSection.tsx` (the two `case "prefix-cache-probe":` branches)
- `apps/web/src/features/benchmarks/BenchmarkDetailPage.tsx` (delete the now-unused `PrefixCacheProbeReport` + `prefixCacheProbeReportSchema` imports left from Task 11)
- Insights test fixtures referencing the probe metric key (`apps/web/src/features/insights/__tests__/*` — these map scenario → score; `prefix-cache-validation: null` entries stay since the scenario remains)

- [ ] **Step 1: Delete the directories/files**

```bash
git rm -r packages/tool-adapters/src/prefix-cache-probe
git rm apps/web/src/features/benchmarks/forms/PrefixCacheProbeParamsForm.tsx apps/web/src/features/benchmarks/forms/__tests__/PrefixCacheProbeParamsForm.test.tsx
git rm apps/web/src/features/benchmarks/reports/PrefixCacheProbeReport.tsx apps/web/src/features/benchmarks/reports/__tests__/PrefixCacheProbeReport.test.tsx
git rm apps/benchmark-runner/scripts/prefix_cache_probe.py
git rm apps/benchmark-runner/images/prefix-cache-probe.Dockerfile 2>/dev/null || true
```

- [ ] **Step 2: Remove the union member + all enumerated references**

Edit each "modify" file above to delete the `prefix-cache-probe` entry/branch/import. For `benchmarkToolSchema` remove the `"prefix-cache-probe",` line. For `ToolReport` delete the `| { tool: "prefix-cache-probe"; data: PrefixCacheProbeReport }` member and its `PrefixCacheProbeReport` import. For each `Record<ToolName, …>` literal, delete the `"prefix-cache-probe": …` property. For each exhaustive `switch`, delete the `case "prefix-cache-probe":` arm.

- [ ] **Step 3: Build tool-adapters + contracts, then typecheck api + web — iterate to zero errors**

Run:
```bash
pnpm --filter @modeldoctor/tool-adapters build && \
pnpm --filter @modeldoctor/contracts build && \
pnpm --filter @modeldoctor/api typecheck && \
pnpm --filter @modeldoctor/web typecheck
```
Expected: each error names a remaining reference; fix until all four are clean. (The compiler is the checklist.)

- [ ] **Step 4: Remove the runner image env from .env files**

Edit `apps/api/.env` and `apps/api/.env.example`: delete the `RUNNER_IMAGE_PREFIX_CACHE_PROBE=...` line.

- [ ] **Step 5: Run the full test suites for touched packages**

Run:
```bash
pnpm --filter @modeldoctor/tool-adapters test -- --run && \
pnpm --filter @modeldoctor/contracts test -- --run && \
pnpm --filter @modeldoctor/api test -- --run && \
pnpm --filter @modeldoctor/web test -- --run
```
Expected: PASS. Fix any test that still imports a deleted symbol.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove prefix-cache-probe tool (rebased on standard aiperf)"
```

---

# Phase 6 — Full verification

## Task 15: Repo-wide build, typecheck, test, lint

**Files:** none (verification)

- [ ] **Step 1: Full build + typecheck**

Run: `pnpm -r build && pnpm -r typecheck`
Expected: clean across all packages.

- [ ] **Step 2: Full test suite**

Run: `pnpm -r test -- --run`
Expected: PASS.

- [ ] **Step 3: Lint/format**

Run: `pnpm biome check .` (or the repo's lint script from `package.json`)
Expected: clean (fix with `pnpm biome check --write .` if needed, then re-run).

- [ ] **Step 4: Grep for stragglers**

Run: `grep -rniE "prefix-cache-probe|prefixCacheProbe|PrefixCacheProbe|RUNNER_IMAGE_PREFIX_CACHE_PROBE" apps packages --include='*.ts' --include='*.tsx' | grep -v node_modules | grep -v /dist/`
Expected: no matches (empty output).

- [ ] **Step 5: Commit any lint fixups**

```bash
git add -A && git commit -m "chore: lint/format after prefix-cache aiperf rebase" || echo "nothing to commit"
```

---

# Phase 7 — Validation run (manual, post-merge; not code)

This reproduces the Higress experiment on the platform. It is operational, not code — execute after the branch is built and the runner image is published to the cluster registry.

- [ ] **Step 1 (user):** Deploy 7-replica vLLM (Qwen2.5-7B-Instruct, `--enable-prefix-caching`) behind Higress; backend Service must be Headless (`clusterIP: None`).
- [ ] **Step 2 (platform):** Create a `PrometheusDatasource` (4pd Prometheus). Create a `Connection`: baseUrl = Higress gateway, model = served name, apiKey, `tokenizerHfId = Qwen/Qwen2.5-7B-Instruct`, bound to that datasource.
- [ ] **Step 3 (user):** `kubectl patch wasmplugin ai-load-balancer-1.0.0 ... configDisable=true` (baseline). Run the **t2 深会话** template benchmark.
- [ ] **Step 4 (user):** `... configDisable=false` (prefix_cache). Run the **t2** template benchmark again. Repeat t1 + one Mooncake-conversation run if time permits.
- [ ] **Step 5 (platform):** Build a SavedCompare from the two t2 runs (baseline vs prefix_cache). Confirm: on-run TTFT p99 lower, `serverMetrics.prefixCache.hitRatePct` higher, `topPodSharePct` higher.
- [ ] **Step 6:** Success = directionally matches the original (stickiness 25%→100% ⇒ topPodShare up; TTFT p99 −42% to −50%). Record the report link.

> **Execution-time inputs still needed from the user:** which K8s cluster the platform API submits the benchmark Job to (in-cluster gateway service URL vs NodePort), the served model name, gateway baseUrl, in-cluster Prometheus URL, and API key.

---

## Self-review notes (run before handing to executor)

- **Spec coverage:** §1 aiperf ext → Tasks 1-3; §2 image bake → Tasks 4-5; §3 thin scenario → Task 10; §4 Prom annotation → Tasks 6-9, 11; §5 templates → Task 13; §6 removal → Task 14; §7 testing → embedded per task + Task 15; §8 validation → Phase 7. All covered.
- **No Prisma migration:** annotation stored in existing `serverMetrics` JSON column.
- **Build-green ordering:** scenario repoint (Task 10) precedes union removal (Task 14); aiperf gains the scenario (Task 3) before the scenario points at it (Task 10).
- **Open risk to verify during impl:** the exact `PrometheusFetcherService.runQuery` instant-result shape (Task 7 Step 3 note) and whether `applyScenarioConstraints` tolerates closed-loop keys in mooncake configs (Task 13 Step 1 note). Both have inline fallback instructions.
