# Evalscope + AIPerf Tool Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire deprecated `genai-perf` adapter (replace with NVIDIA AIPerf) and self-built `kv-cache-stress` adapter (replace with Modelscope evalscope perf); ship 8 new official templates aligned with the 2026-05-12 yrcache-vs-lmcache report methodology.

**Architecture:** Add two new tool adapters (`evalscope`, `aiperf`) following the existing per-tool adapter pattern (`schema.ts` / `runtime.ts` / `index.ts` + per-tool Dockerfile + `<Tool>ParamsForm.tsx` + `<Tool>InferenceMetrics.tsx`). Hard-delete `genai-perf` and `kv-cache-stress` adapters once new adapters are in place. Rewrite `KvCacheStressReport.tsx` to read the new evalscope shape with cold/warm pairing and prefix-cache panels. Single PR.

**Tech Stack:** TypeScript / Zod / pnpm workspaces · React + TanStack Query · NestJS + Prisma · Python (runner subprocess) · evalscope CLI · AIPerf CLI · Docker (per-tool runner images) · vLLM-flavored OpenAI HTTP

**Spec:** `docs/superpowers/specs/2026-05-13-evalscope-aiperf-tool-migration-design.md`

---

## Conventions

- All file paths relative to repo root `/Users/fangyong/vllm/modeldoctor/chore-polish-batch`.
- TDD: failing test → minimal impl → passing test → commit. Each task lists its `Test` file explicitly.
- One conventional commit per task (`feat:` / `refactor:` / `chore:`), body ends with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- Tool keys lowercase: `evalscope`, `aiperf`. TypeScript types in PascalCase: `EvalscopeParams`, `AiperfParams`.
- Don't run `prisma migrate reset` — `feedback_dev_db_disposable` says always ask first.
- New worktree already built once (`pnpm -r build`); api typechecking depends on `packages/*/dist`.

---

## Phase 1 · evalscope adapter

### Task 1 · evalscope schema

**Files:**
- Create: `packages/tool-adapters/src/evalscope/schema.ts`
- Create: `packages/tool-adapters/src/evalscope/schema.spec.ts`

- [ ] **Step 1 · Write failing test for schema**

```ts
// packages/tool-adapters/src/evalscope/schema.spec.ts
import { describe, expect, it } from "vitest";
import { evalscopeParamsSchema, evalscopeReportSchema } from "./schema.js";

describe("evalscopeParamsSchema", () => {
  it("accepts the 2026-05-12 Task 4 high-pressure config", () => {
    const parsed = evalscopeParamsSchema.parse({
      parallel: 16,
      number: 128,
      dataset: "longalpaca",
      minPromptLength: 11000,
      maxPromptLength: 13000,
      minTokens: 300,
      maxTokens: 400,
      apiPath: "/v1/chat/completions",
      stream: true,
      seed: 42,
    });
    expect(parsed.parallel).toBe(16);
    expect(parsed.dataset).toBe("longalpaca");
  });

  it("rejects minPromptLength > maxPromptLength", () => {
    expect(() =>
      evalscopeParamsSchema.parse({
        parallel: 8, number: 64, dataset: "longalpaca",
        minPromptLength: 9000, maxPromptLength: 8000,
        minTokens: 100, maxTokens: 200,
        apiPath: "/v1/chat/completions", stream: true,
      }),
    ).toThrow(/minPromptLength/);
  });

  it("rejects minTokens > maxTokens", () => {
    expect(() =>
      evalscopeParamsSchema.parse({
        parallel: 8, number: 64, dataset: "longalpaca",
        minPromptLength: 8000, maxPromptLength: 9000,
        minTokens: 400, maxTokens: 200,
        apiPath: "/v1/chat/completions", stream: true,
      }),
    ).toThrow(/minTokens/);
  });

  it("applies sensible defaults when only required overrides are provided", () => {
    const parsed = evalscopeParamsSchema.parse({});
    expect(parsed.dataset).toBe("longalpaca");
    expect(parsed.apiPath).toBe("/v1/chat/completions");
    expect(parsed.stream).toBe(true);
  });
});

describe("evalscopeReportSchema", () => {
  it("accepts a minimal report shape", () => {
    const r = evalscopeReportSchema.parse({
      throughput: { requestsPerSec: 8.1, outputTokensPerSec: 1200, totalTokensPerSec: 1500 },
      ttft: { mean: 800, p50: 700, p90: 1200, p95: 1500, p99: 2000 },
      e2eLatency: { mean: 4000, p50: 3500, p90: 5500, p95: 6500, p99: 8000 },
      itl: { mean: 30, p50: 28, p90: 40, p95: 45, p99: 60 },
      requests: { total: 128, success: 128, error: 0, errorRate: 0 },
    });
    expect(r.requests.success).toBe(128);
    expect(r.prefixCacheStats).toBeUndefined();
  });

  it("accepts optional prefixCacheStats", () => {
    const r = evalscopeReportSchema.parse({
      throughput: { requestsPerSec: 8.1, outputTokensPerSec: 1200, totalTokensPerSec: 1500 },
      ttft: { mean: 800, p50: 700, p90: 1200, p95: 1500, p99: 2000 },
      e2eLatency: { mean: 4000, p50: 3500, p90: 5500, p95: 6500, p99: 8000 },
      itl: { mean: 30, p50: 28, p90: 40, p95: 45, p99: 60 },
      requests: { total: 128, success: 128, error: 0, errorRate: 0 },
      prefixCacheStats: { hitRate: 0.85, savings: 0.6 },
    });
    expect(r.prefixCacheStats?.hitRate).toBe(0.85);
  });
});
```

- [ ] **Step 2 · Verify FAIL**

```bash
pnpm -F @modeldoctor/tool-adapters exec vitest run src/evalscope/schema.spec.ts
```

Expected: errors importing from `./schema.js` (file doesn't exist).

- [ ] **Step 3 · Write schema.ts**

```ts
// packages/tool-adapters/src/evalscope/schema.ts
import { z } from "zod";

// Anchored to the 2026-05-12 yrcache-vs-lmcache report methodology
// (6 task × 2 round cold/warm). Defaults match Task 1 (8K prompt · parallel 8).
//
// `seed` is the lever that makes cold/warm A/B reproducible: rerunning
// the SAME benchmark (with `--seed`) produces an identical prompt sequence
// from evalscope's dataset sampler, so R2 is genuinely measuring cache hits
// against the same workload R1 cold-loaded.
export const evalscopeParamsSchema = z
  .object({
    parallel: z.number().int().min(1).max(256).default(8),
    number: z.number().int().min(1).max(10000).default(64),
    dataset: z.enum(["longalpaca", "openqa", "random"]).default("longalpaca"),
    minPromptLength: z.number().int().min(1).max(32000).default(8000),
    maxPromptLength: z.number().int().min(1).max(32000).default(9000),
    minTokens: z.number().int().min(1).max(4096).default(160),
    maxTokens: z.number().int().min(1).max(4096).default(200),
    apiPath: z
      .enum(["/v1/chat/completions", "/v1/completions"])
      .default("/v1/chat/completions"),
    stream: z.boolean().default(true),
    seed: z.number().int().optional(),
  })
  .refine((p) => p.minPromptLength <= p.maxPromptLength, {
    message: "minPromptLength must be <= maxPromptLength",
    path: ["minPromptLength"],
  })
  .refine((p) => p.minTokens <= p.maxTokens, {
    message: "minTokens must be <= maxTokens",
    path: ["minTokens"],
  });

export type EvalscopeParams = z.infer<typeof evalscopeParamsSchema>;

export const evalscopeParamDefaults: Partial<EvalscopeParams> = {
  parallel: 8,
  number: 64,
  dataset: "longalpaca",
  minPromptLength: 8000,
  maxPromptLength: 9000,
  minTokens: 160,
  maxTokens: 200,
  apiPath: "/v1/chat/completions",
  stream: true,
};

const dist = z.object({
  mean: z.number(),
  p50: z.number(),
  p90: z.number(),
  p95: z.number(),
  p99: z.number(),
});

export const evalscopeReportSchema = z.object({
  throughput: z.object({
    requestsPerSec: z.number().nonnegative(),
    outputTokensPerSec: z.number().nonnegative(),
    totalTokensPerSec: z.number().nonnegative(),
  }),
  ttft: dist,
  e2eLatency: dist,
  itl: dist,
  requests: z.object({
    total: z.number().int().nonnegative(),
    success: z.number().int().nonnegative(),
    error: z.number().int().nonnegative(),
    errorRate: z.number().min(0).max(1),
  }),
  // evalscope-only: prefix-cache statistics surfaced when the backend
  // (vLLM, LMCache, YRCache) emits hit-rate counters.
  prefixCacheStats: z
    .object({
      hitRate: z.number().min(0).max(1),
      savings: z.number().min(0).max(1),
    })
    .optional(),
});

export type EvalscopeReport = z.infer<typeof evalscopeReportSchema>;
```

- [ ] **Step 4 · Verify PASS**

```bash
pnpm -F @modeldoctor/tool-adapters exec vitest run src/evalscope/schema.spec.ts
```

Expected: 5 tests pass.

- [ ] **Step 5 · Commit**

```bash
git add packages/tool-adapters/src/evalscope/schema.ts packages/tool-adapters/src/evalscope/schema.spec.ts
git commit -m "$(cat <<'EOF'
feat(tool-adapters): add evalscope params and report schema

Defaults match the 2026-05-12 yrcache report Task 1 (8K prompt × parallel 8).
The `seed` field enables reproducible cold/warm A/B: rerun with the same seed
produces the same prompt sequence from evalscope's dataset sampler.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2 · evalscope runtime + fixture

**Files:**
- Create: `packages/tool-adapters/src/evalscope/runtime.ts`
- Create: `packages/tool-adapters/src/evalscope/runtime.spec.ts`
- Create: `packages/tool-adapters/src/evalscope/__fixtures__/benchmark.json`

> **⚠ Verify CLI before implementing:** spec assumes specific evalscope CLI flags. Before writing impl, run `pip install evalscope` in a venv and `evalscope perf --help` to confirm flag names. If `--min-prompt-length` is actually `--min-input-length` etc., update both spec and this task. Same for the JSON output schema — capture an actual sample by running evalscope against any OpenAI endpoint and save as the fixture.

- [ ] **Step 1 · Capture a real evalscope output fixture**

```bash
# In a scratch venv
pip install evalscope modelscope
evalscope perf \
  --url https://api.openai.com \
  --api https://api.openai.com/v1/chat/completions \
  --model gpt-4o-mini \
  --parallel 2 --number 4 \
  --dataset openqa \
  --min-tokens 50 --max-tokens 100 \
  --output-dir /tmp/evalscope-out
# Copy the produced benchmark.json to packages/tool-adapters/src/evalscope/__fixtures__/benchmark.json
```

If sandbox prevents the call, fabricate a fixture matching evalscope 0.x docs (single JSON file with `throughput`, `latency`, `requests` keys). Pin the assumption in code comment.

- [ ] **Step 2 · Write failing runtime test**

```ts
// packages/tool-adapters/src/evalscope/runtime.spec.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BuildCommandPlan } from "../core/interface.js";
import { buildCommand, getMaxDurationSeconds, parseFinalReport, parseProgress } from "./runtime.js";
import type { EvalscopeParams } from "./schema.js";

const fixturePath = (n: string) => join(__dirname, "__fixtures__", n);

const baseParams: EvalscopeParams = {
  parallel: 16, number: 128, dataset: "longalpaca",
  minPromptLength: 11000, maxPromptLength: 13000,
  minTokens: 300, maxTokens: 400,
  apiPath: "/v1/chat/completions", stream: true, seed: 42,
};

const plan: BuildCommandPlan<EvalscopeParams> = {
  params: baseParams,
  connection: {
    id: "c1",
    name: "vLLM Qwen3-32B",
    baseUrl: "http://10.0.0.5:8000",
    model: "gen-studio_Qwen3-32B-rJIp",
    apiKey: "sk-test",
    tokenizerHfId: null,
    prometheusUrl: null,
  },
};

describe("evalscope.buildCommand", () => {
  it("emits the expected evalscope CLI argv for Task 4", () => {
    const result = buildCommand(plan);
    expect(result.argv).toEqual([
      "evalscope", "perf",
      "--url", "http://10.0.0.5:8000",
      "--api", "http://10.0.0.5:8000/v1/chat/completions",
      "--model", "gen-studio_Qwen3-32B-rJIp",
      "--parallel", "16",
      "--number", "128",
      "--dataset", "longalpaca",
      "--dataset-path", "/opt/evalscope-datasets/longalpaca",
      "--min-prompt-length", "11000",
      "--max-prompt-length", "13000",
      "--min-tokens", "300",
      "--max-tokens", "400",
      "--seed", "42",
      "--stream",
      "--output-dir", "out",
    ]);
    expect(result.secretEnv?.OPENAI_API_KEY).toBe("sk-test");
  });

  it("omits --dataset-path when dataset is not longalpaca", () => {
    const result = buildCommand({
      ...plan,
      params: { ...baseParams, dataset: "openqa" },
    });
    expect(result.argv).not.toContain("--dataset-path");
  });

  it("omits --seed when not provided", () => {
    const result = buildCommand({
      ...plan,
      params: { ...baseParams, seed: undefined },
    });
    expect(result.argv).not.toContain("--seed");
  });
});

describe("evalscope.parseFinalReport", () => {
  it("maps the fixture into a valid EvalscopeReport", () => {
    const buf = readFileSync(fixturePath("benchmark.json"));
    const report = parseFinalReport("", { report: buf });
    expect(report.tool).toBe("evalscope");
    expect(report.data.requests.total).toBeGreaterThan(0);
    expect(report.data.ttft.p99).toBeGreaterThan(0);
  });

  it("throws if the report file is missing", () => {
    expect(() => parseFinalReport("", {})).toThrow(/missing 'report'/);
  });
});

describe("evalscope.parseProgress", () => {
  it("returns null for unrecognized lines", () => {
    expect(parseProgress("noise")).toBeNull();
  });
});

describe("evalscope.getMaxDurationSeconds", () => {
  it("derives a buffered ceiling proportional to number/parallel", () => {
    const sec = getMaxDurationSeconds(baseParams);
    expect(sec).toBeGreaterThanOrEqual(120); // floor
    expect(sec).toBeLessThanOrEqual(3600);   // cap
  });
});
```

- [ ] **Step 3 · Verify FAIL**

```bash
pnpm -F @modeldoctor/tool-adapters exec vitest run src/evalscope/runtime.spec.ts
```

Expected: module not found.

- [ ] **Step 4 · Write runtime.ts**

```ts
// packages/tool-adapters/src/evalscope/runtime.ts
import type {
  BuildCommandPlan,
  BuildCommandResult,
  ProgressEvent,
  ToolReport,
} from "../core/interface.js";
import { type EvalscopeParams, evalscopeReportSchema } from "./schema.js";

// LongAlpaca-12k is baked into the evalscope runner image at build time
// (apps/benchmark-runner/images/evalscope.Dockerfile). Other datasets
// (openqa / random) are tiny or fully synthetic; we let evalscope handle
// them via its built-in dataset registry.
const BAKED_DATASET_PATHS: Record<string, string> = {
  longalpaca: "/opt/evalscope-datasets/longalpaca",
};

export function buildCommand(plan: BuildCommandPlan<EvalscopeParams>): BuildCommandResult {
  const { params, connection } = plan;
  const trimmedBase = connection.baseUrl.replace(/\/+$/, "");

  const argv: string[] = [
    "evalscope", "perf",
    "--url", trimmedBase,
    "--api", `${trimmedBase}${params.apiPath}`,
    "--model", connection.model,
    "--parallel", String(params.parallel),
    "--number", String(params.number),
    "--dataset", params.dataset,
  ];

  const datasetPath = BAKED_DATASET_PATHS[params.dataset];
  if (datasetPath) argv.push("--dataset-path", datasetPath);

  argv.push(
    "--min-prompt-length", String(params.minPromptLength),
    "--max-prompt-length", String(params.maxPromptLength),
    "--min-tokens", String(params.minTokens),
    "--max-tokens", String(params.maxTokens),
  );

  if (params.seed !== undefined) argv.push("--seed", String(params.seed));
  if (params.stream) argv.push("--stream");
  argv.push("--output-dir", "out");

  return {
    argv,
    env: {},
    secretEnv: { OPENAI_API_KEY: connection.apiKey },
    outputFiles: { report: "out/benchmark.json" },
  };
}

// evalscope emits TQDM-style progress on stderr; not stable enough to
// parse line-by-line. The benchmark.json final file is authoritative.
export function parseProgress(_line: string): ProgressEvent | null {
  return null;
}

interface EvalscopeRawReport {
  // Adapt these field names to match the real evalscope output once a
  // fixture is captured. Below shape mirrors the documented schema; the
  // mapper below should tolerate missing/optional fields gracefully.
  Throughput?: {
    "Average requests per second"?: number;
    "Average output tokens per second"?: number;
    "Average total tokens per second"?: number;
  };
  Latency?: {
    TimeToFirstToken?: Record<string, number>;
    InterTokenLatency?: Record<string, number>;
    EndToEndLatency?: Record<string, number>;
  };
  TotalRequests?: number;
  SucceedRequests?: number;
  FailedRequests?: number;
  PrefixCacheHitRate?: number;
  PrefixCacheSavings?: number;
}

function readDist(src: Record<string, number> | undefined) {
  return {
    mean: src?.mean ?? src?.avg ?? 0,
    p50: src?.p50 ?? src?.median ?? 0,
    p90: src?.p90 ?? 0,
    p95: src?.p95 ?? 0,
    p99: src?.p99 ?? 0,
  };
}

export function parseFinalReport(_stdout: string, files: Record<string, Buffer>): ToolReport {
  const buf = files.report;
  if (!buf) {
    throw new Error("evalscope.parseFinalReport: missing 'report' output file");
  }
  const raw = JSON.parse(buf.toString("utf8")) as EvalscopeRawReport;
  const total = raw.TotalRequests ?? 0;
  const success = raw.SucceedRequests ?? 0;
  const error = raw.FailedRequests ?? Math.max(0, total - success);
  const data = {
    throughput: {
      requestsPerSec: raw.Throughput?.["Average requests per second"] ?? 0,
      outputTokensPerSec: raw.Throughput?.["Average output tokens per second"] ?? 0,
      totalTokensPerSec: raw.Throughput?.["Average total tokens per second"] ?? 0,
    },
    ttft: readDist(raw.Latency?.TimeToFirstToken),
    e2eLatency: readDist(raw.Latency?.EndToEndLatency),
    itl: readDist(raw.Latency?.InterTokenLatency),
    requests: {
      total, success, error,
      errorRate: total === 0 ? 0 : error / total,
    },
    ...(raw.PrefixCacheHitRate !== undefined
      ? {
          prefixCacheStats: {
            hitRate: raw.PrefixCacheHitRate,
            savings: raw.PrefixCacheSavings ?? 0,
          },
        }
      : {}),
  };
  return { tool: "evalscope", data: evalscopeReportSchema.parse(data) };
}

export function getMaxDurationSeconds(params: EvalscopeParams): number {
  // Conservative wall-clock estimate. Worst case: long prompts + cold cache
  // ≈ 30s/request at parallel 1. The runner-supplied buffer (~120s) is
  // already standard. Tighten with measured data once collected.
  const reqs = params.number;
  const perReqWorst = 30; // sec
  const wallClock = Math.ceil((reqs * perReqWorst) / Math.max(1, params.parallel));
  return Math.max(120, Math.min(3600, wallClock + 120));
}
```

- [ ] **Step 5 · Verify PASS**

```bash
pnpm -F @modeldoctor/tool-adapters exec vitest run src/evalscope/runtime.spec.ts
```

Expected: 7 tests pass.

If `parseFinalReport` test fails because the fixture's keys differ from `EvalscopeRawReport` shape, update the `readDist` selectors and the field mapping until the test passes. **Do not loosen the test assertions** — change the impl.

- [ ] **Step 6 · Commit**

```bash
git add packages/tool-adapters/src/evalscope/runtime.ts packages/tool-adapters/src/evalscope/runtime.spec.ts packages/tool-adapters/src/evalscope/__fixtures__/
git commit -m "$(cat <<'EOF'
feat(tool-adapters): evalscope runtime (buildCommand + parseFinalReport)

Emits the evalscope CLI argv with optional --seed for reproducible
cold/warm A/B; reads benchmark.json into the schema's throughput / ttft
/ itl / e2eLatency / requests / optional prefixCacheStats shape. Fixture
captured by running evalscope perf against a real OpenAI-compatible
endpoint at parallel=2 / number=4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3 · evalscope adapter index + category defaults + register

**Files:**
- Create: `packages/tool-adapters/src/evalscope/index.ts`
- Modify: `packages/tool-adapters/src/index.ts`
- Modify: `packages/tool-adapters/src/schemas-entry.ts`
- Modify: `packages/tool-adapters/src/category-defaults.ts`
- Modify: `packages/tool-adapters/src/core/registry.ts` (if registry has an explicit registration list)
- Modify: `packages/contracts/src/benchmark.ts` (add `"evalscope"` to `benchmarkToolSchema`)

- [ ] **Step 1 · Write failing test for adapter registration**

Add to `packages/tool-adapters/src/schemas-entry.spec.ts` (existing test file):

```ts
import { evalscopeParamDefaults, evalscopeParamsSchema, EVALSCOPE_CATEGORY_DEFAULTS } from "./schemas-entry.js";

describe("evalscope schemas exported", () => {
  it("evalscopeParamsSchema is exported", () => {
    expect(evalscopeParamsSchema).toBeDefined();
  });
  it("evalscope category defaults are sane", () => {
    expect(EVALSCOPE_CATEGORY_DEFAULTS.chat).toEqual({ apiPath: "/v1/chat/completions" });
    expect(EVALSCOPE_CATEGORY_DEFAULTS.image).toEqual({ unsupported: true });
  });
});
```

- [ ] **Step 2 · Verify FAIL**

```bash
pnpm -F @modeldoctor/tool-adapters test
```

Expected: import errors.

- [ ] **Step 3 · Add `"evalscope"` to BenchmarkTool enum**

In `packages/contracts/src/benchmark.ts:15-22`:

```ts
export const benchmarkToolSchema = z.enum([
  "guidellm",
  "genai-perf",         // ← will be removed in Task 22
  "vegeta",
  "prefix-cache-probe",
  "kv-cache-stress",    // ← will be removed in Task 23
  "evalscope",
  "aiperf",
]);
```

(Add both `evalscope` and `aiperf` now; aiperf will get its files in Phase 2.)

- [ ] **Step 4 · Create evalscope adapter index**

```ts
// packages/tool-adapters/src/evalscope/index.ts
import type { ToolAdapter } from "../core/interface.js";
import { buildCommand, getMaxDurationSeconds, parseFinalReport, parseProgress } from "./runtime.js";
import { evalscopeParamDefaults, evalscopeParamsSchema, evalscopeReportSchema } from "./schema.js";

export const evalscopeAdapter: ToolAdapter = {
  name: "evalscope",
  scenarios: ["inference", "kv-cache-stress"] as const,
  paramsSchema: evalscopeParamsSchema,
  reportSchema: evalscopeReportSchema,
  paramDefaults: evalscopeParamDefaults,
  buildCommand,
  parseProgress,
  parseFinalReport,
  getMaxDurationSeconds,
};

export type { EvalscopeParams, EvalscopeReport } from "./schema.js";
```

- [ ] **Step 5 · Register adapter in `packages/tool-adapters/src/index.ts`**

Add line (preserving existing exports):

```ts
export { evalscopeAdapter } from "./evalscope/index.js";
```

If `core/registry.ts` has an explicit `ALL_ADAPTERS` array, add `evalscopeAdapter` to it. Grep first:

```bash
grep -RIn "allAdapters\|ALL_ADAPTERS" packages/tool-adapters/src/core/
```

- [ ] **Step 6 · Add `EVALSCOPE_CATEGORY_DEFAULTS`**

In `packages/tool-adapters/src/category-defaults.ts`, append:

```ts
import type { EvalscopeParams } from "./evalscope/schema.js";

export const EVALSCOPE_CATEGORY_DEFAULTS = {
  chat: { apiPath: "/v1/chat/completions" },
  audio: { unsupported: true },
  embeddings: { unsupported: true },
  rerank: { unsupported: true },
  image: { unsupported: true },
} as const satisfies Record<
  ModalityCategory,
  { apiPath: EvalscopeParams["apiPath"] } | { unsupported: true }
>;
```

- [ ] **Step 7 · Re-export from `schemas-entry.ts`**

Add block (matching existing style):

```ts
export {
  evalscopeParamsSchema,
  evalscopeReportSchema,
  evalscopeParamDefaults,
  type EvalscopeParams,
  type EvalscopeReport,
} from "./evalscope/schema.js";

export { EVALSCOPE_CATEGORY_DEFAULTS } from "./category-defaults.js";
```

- [ ] **Step 8 · Verify PASS**

```bash
pnpm -F @modeldoctor/tool-adapters test
pnpm -F @modeldoctor/contracts test
```

Expected: all tests pass.

- [ ] **Step 9 · Commit**

```bash
git add packages/tool-adapters/src/evalscope/ packages/tool-adapters/src/index.ts packages/tool-adapters/src/schemas-entry.ts packages/tool-adapters/src/category-defaults.ts packages/contracts/src/benchmark.ts
git commit -m "$(cat <<'EOF'
feat(tool-adapters): register evalscope adapter + category defaults

Adds the evalscope tool key to the BenchmarkTool enum (also pre-registers
"aiperf" so Phase 2 files don't need to touch contracts again). Category
defaults restrict evalscope to chat endpoints — same posture as guidellm.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2 · aiperf adapter

### Task 4 · aiperf schema

**Files:**
- Create: `packages/tool-adapters/src/aiperf/schema.ts`
- Create: `packages/tool-adapters/src/aiperf/schema.spec.ts`

> **⚠ Verify CLI before implementing:** in a scratch venv `pip install aiperf` and `aiperf profile --help` to confirm the actual parameter names. The schema below is the documented shape (v0.7); update if reality differs.

- [ ] **Step 1 · Write failing schema tests**

```ts
// packages/tool-adapters/src/aiperf/schema.spec.ts
import { describe, expect, it } from "vitest";
import { aiperfParamsSchema, aiperfReportSchema } from "./schema.js";

describe("aiperfParamsSchema", () => {
  it("accepts a baseline config", () => {
    const p = aiperfParamsSchema.parse({});
    expect(p.concurrency).toBe(8);
    expect(p.dataset).toBe("synthetic");
  });

  it("rejects inputTokensMean=0 (must be positive)", () => {
    expect(() => aiperfParamsSchema.parse({ inputTokensMean: 0 })).toThrow();
  });
});

describe("aiperfReportSchema", () => {
  it("accepts the same general-perf shape as evalscope", () => {
    const r = aiperfReportSchema.parse({
      throughput: { requestsPerSec: 5, outputTokensPerSec: 800, totalTokensPerSec: 1000 },
      ttft: { mean: 600, p50: 500, p90: 800, p95: 950, p99: 1200 },
      e2eLatency: { mean: 3000, p50: 2500, p90: 4500, p95: 5500, p99: 7000 },
      itl: { mean: 25, p50: 24, p90: 30, p95: 35, p99: 45 },
      requests: { total: 100, success: 100, error: 0, errorRate: 0 },
    });
    expect(r.requests.success).toBe(100);
  });
});
```

- [ ] **Step 2 · Verify FAIL**

```bash
pnpm -F @modeldoctor/tool-adapters exec vitest run src/aiperf/schema.spec.ts
```

Expected: module not found.

- [ ] **Step 3 · Write aiperf/schema.ts**

```ts
// packages/tool-adapters/src/aiperf/schema.ts
import { z } from "zod";

export const aiperfParamsSchema = z.object({
  concurrency: z.number().int().min(1).max(512).default(8),
  requestCount: z.number().int().min(1).max(10000).default(100),
  inputTokensMean: z.number().int().min(1).max(32000).default(1024),
  inputTokensStddev: z.number().int().min(0).max(8192).default(128),
  outputTokensMean: z.number().int().min(1).max(4096).default(256),
  outputTokensStddev: z.number().int().min(0).max(2048).default(64),
  apiPath: z
    .enum(["/v1/chat/completions", "/v1/completions"])
    .default("/v1/chat/completions"),
  streaming: z.boolean().default(true),
  dataset: z.enum(["sharegpt", "synthetic"]).default("synthetic"),
});

export type AiperfParams = z.infer<typeof aiperfParamsSchema>;

export const aiperfParamDefaults: Partial<AiperfParams> = {
  concurrency: 8,
  requestCount: 100,
  inputTokensMean: 1024,
  inputTokensStddev: 128,
  outputTokensMean: 256,
  outputTokensStddev: 64,
  apiPath: "/v1/chat/completions",
  streaming: true,
  dataset: "synthetic",
};

const dist = z.object({
  mean: z.number(),
  p50: z.number(),
  p90: z.number(),
  p95: z.number(),
  p99: z.number(),
});

// Same general-perf-three-piece shape as evalscope (without
// prefixCacheStats); both surfaces feed the same InferenceMetrics block.
export const aiperfReportSchema = z.object({
  throughput: z.object({
    requestsPerSec: z.number().nonnegative(),
    outputTokensPerSec: z.number().nonnegative(),
    totalTokensPerSec: z.number().nonnegative(),
  }),
  ttft: dist,
  e2eLatency: dist,
  itl: dist,
  requests: z.object({
    total: z.number().int().nonnegative(),
    success: z.number().int().nonnegative(),
    error: z.number().int().nonnegative(),
    errorRate: z.number().min(0).max(1),
  }),
});

export type AiperfReport = z.infer<typeof aiperfReportSchema>;
```

- [ ] **Step 4 · Verify PASS**

```bash
pnpm -F @modeldoctor/tool-adapters exec vitest run src/aiperf/schema.spec.ts
```

- [ ] **Step 5 · Commit**

```bash
git add packages/tool-adapters/src/aiperf/schema.ts packages/tool-adapters/src/aiperf/schema.spec.ts
git commit -m "feat(tool-adapters): add aiperf params and report schema

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5 · aiperf runtime + fixture

**Files:**
- Create: `packages/tool-adapters/src/aiperf/runtime.ts`
- Create: `packages/tool-adapters/src/aiperf/runtime.spec.ts`
- Create: `packages/tool-adapters/src/aiperf/__fixtures__/profile_export.json`

> **⚠ Verify CLI:** Capture a real `aiperf profile` output before writing impl. AIPerf 0.7+ outputs JSON+CSV; we read the JSON.

- [ ] **Step 1 · Capture a real aiperf output fixture**

```bash
pip install aiperf
aiperf profile \
  --url https://api.openai.com \
  --endpoint /v1/chat/completions \
  --model gpt-4o-mini \
  --concurrency 2 \
  --request-count 4 \
  --streaming \
  --artifact-dir /tmp/aiperf-out
# Find the JSON export — likely /tmp/aiperf-out/.../profile_export_*.json
# Save under packages/tool-adapters/src/aiperf/__fixtures__/profile_export.json
```

- [ ] **Step 2 · Write failing runtime test**

```ts
// packages/tool-adapters/src/aiperf/runtime.spec.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BuildCommandPlan } from "../core/interface.js";
import { buildCommand, getMaxDurationSeconds, parseFinalReport, parseProgress } from "./runtime.js";
import type { AiperfParams } from "./schema.js";

const fixturePath = (n: string) => join(__dirname, "__fixtures__", n);

const params: AiperfParams = {
  concurrency: 8, requestCount: 100,
  inputTokensMean: 1024, inputTokensStddev: 128,
  outputTokensMean: 256, outputTokensStddev: 64,
  apiPath: "/v1/chat/completions",
  streaming: true,
  dataset: "synthetic",
};
const plan: BuildCommandPlan<AiperfParams> = {
  params,
  connection: {
    id: "c1", name: "vLLM",
    baseUrl: "http://10.0.0.5:8000",
    model: "Qwen2.5-7B-Instruct",
    apiKey: "sk-test",
    tokenizerHfId: null,
    prometheusUrl: null,
  },
};

describe("aiperf.buildCommand", () => {
  it("emits the expected argv with streaming and synthetic dataset", () => {
    const r = buildCommand(plan);
    expect(r.argv[0]).toBe("aiperf");
    expect(r.argv).toContain("--streaming");
    expect(r.argv).toContain("--model");
    expect(r.argv).toContain("Qwen2.5-7B-Instruct");
    expect(r.argv).toContain("--concurrency");
    expect(r.argv).toContain("8");
    expect(r.secretEnv?.OPENAI_API_KEY).toBe("sk-test");
  });
});

describe("aiperf.parseFinalReport", () => {
  it("maps profile_export.json to a valid AiperfReport", () => {
    const buf = readFileSync(fixturePath("profile_export.json"));
    const report = parseFinalReport("", { report: buf });
    expect(report.tool).toBe("aiperf");
    expect(report.data.requests.total).toBeGreaterThan(0);
  });
});

describe("aiperf.parseProgress", () => {
  it("returns null for unknown lines", () => {
    expect(parseProgress("noise")).toBeNull();
  });
});

describe("aiperf.getMaxDurationSeconds", () => {
  it("bounds wall-clock estimate", () => {
    expect(getMaxDurationSeconds(params)).toBeGreaterThanOrEqual(120);
  });
});
```

- [ ] **Step 3 · Verify FAIL**

```bash
pnpm -F @modeldoctor/tool-adapters exec vitest run src/aiperf/runtime.spec.ts
```

- [ ] **Step 4 · Write aiperf/runtime.ts**

```ts
// packages/tool-adapters/src/aiperf/runtime.ts
import type {
  BuildCommandPlan,
  BuildCommandResult,
  ProgressEvent,
  ToolReport,
} from "../core/interface.js";
import { type AiperfParams, aiperfReportSchema } from "./schema.js";

export function buildCommand(plan: BuildCommandPlan<AiperfParams>): BuildCommandResult {
  const { params, connection } = plan;
  const trimmedBase = connection.baseUrl.replace(/\/+$/, "");

  const argv: string[] = [
    "aiperf", "profile",
    "--url", trimmedBase,
    "--endpoint", params.apiPath,
    "--model", connection.model,
    "--concurrency", String(params.concurrency),
    "--request-count", String(params.requestCount),
    "--synthetic-input-tokens-mean", String(params.inputTokensMean),
    "--synthetic-input-tokens-stddev", String(params.inputTokensStddev),
    "--output-tokens-mean", String(params.outputTokensMean),
    "--output-tokens-stddev", String(params.outputTokensStddev),
    "--artifact-dir", "out",
  ];

  if (params.streaming) argv.push("--streaming");
  if (params.dataset === "sharegpt") {
    argv.push("--input-dataset", "sharegpt");
  }

  return {
    argv,
    env: {},
    secretEnv: { OPENAI_API_KEY: connection.apiKey },
    // aiperf writes profile_export_<timestamp>.json under --artifact-dir.
    // The runner wrapper resolves this glob — see runner/main.py.
    outputFiles: { report: "out/profile_export.json" },
  };
}

export function parseProgress(_line: string): ProgressEvent | null {
  return null;
}

interface AiperfRawReport {
  // Field names per AIPerf 0.7 profile_export.json. Adjust to match the
  // real fixture if necessary.
  request_throughput?: number;
  output_token_throughput?: number;
  total_token_throughput?: number;
  time_to_first_token?: Record<string, number>;
  inter_token_latency?: Record<string, number>;
  request_latency?: Record<string, number>;
  request_count?: number;
  successful_request_count?: number;
}

function dist(src: Record<string, number> | undefined) {
  return {
    mean: src?.avg ?? src?.mean ?? 0,
    p50: src?.p50 ?? 0,
    p90: src?.p90 ?? 0,
    p95: src?.p95 ?? 0,
    p99: src?.p99 ?? 0,
  };
}

export function parseFinalReport(_stdout: string, files: Record<string, Buffer>): ToolReport {
  const buf = files.report;
  if (!buf) {
    throw new Error("aiperf.parseFinalReport: missing 'report' output file");
  }
  const raw = JSON.parse(buf.toString("utf8")) as AiperfRawReport;
  const total = raw.request_count ?? 0;
  const success = raw.successful_request_count ?? total;
  const error = Math.max(0, total - success);
  const data = {
    throughput: {
      requestsPerSec: raw.request_throughput ?? 0,
      outputTokensPerSec: raw.output_token_throughput ?? 0,
      totalTokensPerSec: raw.total_token_throughput ?? 0,
    },
    ttft: dist(raw.time_to_first_token),
    e2eLatency: dist(raw.request_latency),
    itl: dist(raw.inter_token_latency),
    requests: { total, success, error, errorRate: total === 0 ? 0 : error / total },
  };
  return { tool: "aiperf", data: aiperfReportSchema.parse(data) };
}

export function getMaxDurationSeconds(params: AiperfParams): number {
  const reqs = params.requestCount;
  const perReqWorst = 15;
  const wall = Math.ceil((reqs * perReqWorst) / Math.max(1, params.concurrency));
  return Math.max(120, Math.min(3600, wall + 120));
}
```

- [ ] **Step 5 · Verify PASS**

```bash
pnpm -F @modeldoctor/tool-adapters exec vitest run src/aiperf/runtime.spec.ts
```

- [ ] **Step 6 · Commit**

```bash
git add packages/tool-adapters/src/aiperf/runtime.ts packages/tool-adapters/src/aiperf/runtime.spec.ts packages/tool-adapters/src/aiperf/__fixtures__/
git commit -m "feat(tool-adapters): aiperf runtime (buildCommand + parseFinalReport)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6 · aiperf adapter index + category defaults + register

**Files:**
- Create: `packages/tool-adapters/src/aiperf/index.ts`
- Modify: `packages/tool-adapters/src/index.ts`
- Modify: `packages/tool-adapters/src/schemas-entry.ts`
- Modify: `packages/tool-adapters/src/category-defaults.ts`

- [ ] **Step 1 · Create adapter index**

```ts
// packages/tool-adapters/src/aiperf/index.ts
import type { ToolAdapter } from "../core/interface.js";
import { buildCommand, getMaxDurationSeconds, parseFinalReport, parseProgress } from "./runtime.js";
import { aiperfParamDefaults, aiperfParamsSchema, aiperfReportSchema } from "./schema.js";

export const aiperfAdapter: ToolAdapter = {
  name: "aiperf",
  scenarios: ["inference"] as const,
  paramsSchema: aiperfParamsSchema,
  reportSchema: aiperfReportSchema,
  paramDefaults: aiperfParamDefaults,
  buildCommand,
  parseProgress,
  parseFinalReport,
  getMaxDurationSeconds,
};

export type { AiperfParams, AiperfReport } from "./schema.js";
```

- [ ] **Step 2 · Register in index.ts**

```ts
export { aiperfAdapter } from "./aiperf/index.js";
```

- [ ] **Step 3 · AIPERF_CATEGORY_DEFAULTS**

In `category-defaults.ts`:

```ts
import type { AiperfParams } from "./aiperf/schema.js";

export const AIPERF_CATEGORY_DEFAULTS = {
  chat: { apiPath: "/v1/chat/completions" },
  audio: { unsupported: true },
  embeddings: { unsupported: true },
  rerank: { unsupported: true },
  image: { unsupported: true },
} as const satisfies Record<
  ModalityCategory,
  { apiPath: AiperfParams["apiPath"] } | { unsupported: true }
>;
```

- [ ] **Step 4 · Re-export from schemas-entry.ts**

```ts
export {
  aiperfParamsSchema,
  aiperfReportSchema,
  aiperfParamDefaults,
  type AiperfParams,
  type AiperfReport,
} from "./aiperf/schema.js";

export { AIPERF_CATEGORY_DEFAULTS } from "./category-defaults.js";
```

- [ ] **Step 5 · Verify**

```bash
pnpm -F @modeldoctor/tool-adapters test
```

- [ ] **Step 6 · Commit**

```bash
git add packages/tool-adapters/src/aiperf/index.ts packages/tool-adapters/src/index.ts packages/tool-adapters/src/schemas-entry.ts packages/tool-adapters/src/category-defaults.ts
git commit -m "feat(tool-adapters): register aiperf adapter

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 3 · Scenarios update + scenarios.spec

### Task 7 · Update scenarios.ts to expose new tools

**Files:**
- Modify: `packages/tool-adapters/src/scenarios.ts`

- [ ] **Step 1 · Update inference + kv-cache-stress tool lists**

```ts
// scenarios.ts
inference: {
  label: "推理性能基准",
  description: "TTFT / TPOT / 单次吞吐基线",
  tools: ["guidellm", "aiperf", "evalscope"],
  paramsConstraints: {
    guidellm: {
      rateType: z.enum(["constant", "poisson", "throughput", "synchronous"]),
    },
  },
  reportComponent: "InferenceReport",
},
// capacity: unchanged
// gateway: unchanged
// prefix-cache-validation: unchanged
"kv-cache-stress": {
  label: "KV cache 后端压测",
  description: "长 prompt 冷/暖双轮 evalscope perf,对比不同 KV 卸载后端 (vanilla / LMCache / YRCache) 的 TTFT / 吞吐 / prefix-cache 命中率",
  tools: ["evalscope"],
  paramsConstraints: {},
  reportComponent: "KvCacheStressReport",
},
```

- [ ] **Step 2 · Verify type-check**

```bash
pnpm -F @modeldoctor/tool-adapters exec tsc -p tsconfig.json --noEmit
```

- [ ] **Step 3 · Update scenarios.spec.ts**

```bash
grep -RIn "scenarios" packages/tool-adapters/src/*.spec.ts
```

Adjust any case asserting on the old tool lists.

- [ ] **Step 4 · Verify tests pass**

```bash
pnpm -F @modeldoctor/tool-adapters test
```

- [ ] **Step 5 · Commit**

```bash
git add packages/tool-adapters/src/scenarios.ts packages/tool-adapters/src/*.spec.ts
git commit -m "refactor(scenarios): inference adds aiperf + evalscope; KV Cache → evalscope

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 4 · Runner images

### Task 8 · evalscope.Dockerfile (bake LongAlpaca)

**Files:**
- Create: `apps/benchmark-runner/images/evalscope.Dockerfile`

- [ ] **Step 1 · Write Dockerfile**

```dockerfile
# syntax=docker/dockerfile:1.6

# Phase 1 of evalscope rollout. evalscope is the load generator, not the
# model server. Bake LongAlpaca-12k at build time so air-gapped clusters
# can run the official 6-task methodology without runtime network egress.
# Image ~1.7 GB (python:3.11-slim ~130 MB + evalscope+deps ~1.4 GB +
# LongAlpaca dataset ~200 MB).
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MODELSCOPE_CACHE=/opt/evalscope-datasets

ARG EVALSCOPE_VERSION=0.18.0

RUN pip install --no-cache-dir \
        "evalscope==${EVALSCOPE_VERSION}" \
        "modelscope" \
        'requests>=2.31,<3'

# Bake LongAlpaca-12k. modelscope download writes to a sharded local dir.
RUN modelscope download \
        AI-ModelScope/LongAlpaca-12k \
        --local_dir /opt/evalscope-datasets/longalpaca

WORKDIR /app
COPY runner runner

RUN useradd --create-home --shell /sbin/nologin runner \
    && chown -R runner:runner /app /opt/evalscope-datasets
USER runner

ENTRYPOINT ["python", "-m", "runner.main"]
```

- [ ] **Step 2 · Test build locally**

```bash
cd apps/benchmark-runner
docker build -f images/evalscope.Dockerfile -t modeldoctor-evalscope:dev .
```

Expected: ~5-8 minute build, final image ~1.7 GB.

- [ ] **Step 3 · Smoke test image**

```bash
docker run --rm modeldoctor-evalscope:dev --help
# (assuming runner/main.py respects --help; if not, just verify the
# image starts without ImportError)
```

- [ ] **Step 4 · Commit**

```bash
git add apps/benchmark-runner/images/evalscope.Dockerfile
git commit -m "build(runner): evalscope Dockerfile with baked LongAlpaca-12k

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 9 · aiperf.Dockerfile

**Files:**
- Create: `apps/benchmark-runner/images/aiperf.Dockerfile`

- [ ] **Step 1 · Write Dockerfile**

```dockerfile
# syntax=docker/dockerfile:1.6

# Replacement for the deprecated genai-perf image. AIPerf is the
# NVIDIA-recommended successor (ai-dynamo/aiperf). Same posture as
# genai-perf: python-slim base, the perf tool is a pure-Python load
# generator (no GPU / CUDA needed).
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

ARG AIPERF_VERSION=0.7.0

RUN pip install --no-cache-dir \
        "aiperf==${AIPERF_VERSION}" \
        'requests>=2.31,<3'

WORKDIR /app
COPY runner runner

RUN useradd --create-home --shell /sbin/nologin runner \
    && chown -R runner:runner /app
USER runner

ENTRYPOINT ["python", "-m", "runner.main"]
```

- [ ] **Step 2 · Build + smoke**

```bash
cd apps/benchmark-runner
docker build -f images/aiperf.Dockerfile -t modeldoctor-aiperf:dev .
docker run --rm modeldoctor-aiperf:dev --help
```

- [ ] **Step 3 · Commit**

```bash
git add apps/benchmark-runner/images/aiperf.Dockerfile
git commit -m "build(runner): aiperf Dockerfile (replaces deprecated genai-perf)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 10 · Update build script + api runner-images registry

**Files:**
- Modify: `tools/build-runner-images.sh`
- Modify: `apps/api/src/modules/benchmark/k8s/runner-images.ts`

- [ ] **Step 1 · Inspect build script**

```bash
grep -E "TOOLS=|guidellm|genai-perf|kv-cache-stress" tools/build-runner-images.sh
```

- [ ] **Step 2 · Update build script — add `evalscope` and `aiperf` to the tool list**

Patch the `TOOLS=` array (or per-tool build block) to add `evalscope aiperf`. Leave `genai-perf` and `kv-cache-stress` for now (Phase 7 deletes them).

- [ ] **Step 3 · Update `apps/api/src/modules/benchmark/k8s/runner-images.ts`**

Add `evalscope` and `aiperf` entries to whatever map / enum exists. Grep first:

```bash
grep -n "guidellm\|genai-perf\|RUNNER_IMAGE_MAP\|imageName" apps/api/src/modules/benchmark/k8s/runner-images.ts
```

- [ ] **Step 4 · Verify api type-check**

```bash
pnpm -F @modeldoctor/api type-check
```

- [ ] **Step 5 · Commit**

```bash
git add tools/build-runner-images.sh apps/api/src/modules/benchmark/k8s/runner-images.ts
git commit -m "build(runner): wire evalscope + aiperf into build script and api image registry

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 5 · Web forms

### Task 11 · EvalscopeParamsForm.tsx

**Files:**
- Create: `apps/web/src/features/benchmarks/forms/EvalscopeParamsForm.tsx`

> Reference the GuidellmParamsForm.tsx structure for shadcn Form / FormField / FormSection patterns.

- [ ] **Step 1 · Write form**

```tsx
// apps/web/src/features/benchmarks/forms/EvalscopeParamsForm.tsx
import { FormSection } from "@/components/common/form-section";
import {
  FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useFormContext } from "react-hook-form";
import { useTranslation } from "react-i18next";

export function EvalscopeParamsForm() {
  const { t } = useTranslation("benchmarks");
  const form = useFormContext();
  return (
    <FormSection title={t("forms.evalscope.section")}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <FormField name="params.dataset" control={form.control} render={({ field }) => (
          <FormItem>
            <FormLabel required>{t("forms.evalscope.dataset")}</FormLabel>
            <Select value={field.value} onValueChange={field.onChange}>
              <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
              <SelectContent>
                <SelectItem value="longalpaca">LongAlpaca-12k</SelectItem>
                <SelectItem value="openqa">OpenQA</SelectItem>
                <SelectItem value="random">Random (synthetic)</SelectItem>
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )} />
        <FormField name="params.parallel" control={form.control} render={({ field }) => (
          <FormItem>
            <FormLabel required>{t("forms.evalscope.parallel")}</FormLabel>
            <FormControl><Input type="number" {...field} onChange={(e) => field.onChange(Number(e.target.value))} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <FormField name="params.number" control={form.control} render={({ field }) => (
          <FormItem>
            <FormLabel required>{t("forms.evalscope.number")}</FormLabel>
            <FormControl><Input type="number" {...field} onChange={(e) => field.onChange(Number(e.target.value))} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FormField name="params.minPromptLength" control={form.control} render={({ field }) => (
          <FormItem>
            <FormLabel required>{t("forms.evalscope.minPromptLength")}</FormLabel>
            <FormControl><Input type="number" {...field} onChange={(e) => field.onChange(Number(e.target.value))} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <FormField name="params.maxPromptLength" control={form.control} render={({ field }) => (
          <FormItem>
            <FormLabel required>{t("forms.evalscope.maxPromptLength")}</FormLabel>
            <FormControl><Input type="number" {...field} onChange={(e) => field.onChange(Number(e.target.value))} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <FormField name="params.minTokens" control={form.control} render={({ field }) => (
          <FormItem>
            <FormLabel required>{t("forms.evalscope.minTokens")}</FormLabel>
            <FormControl><Input type="number" {...field} onChange={(e) => field.onChange(Number(e.target.value))} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <FormField name="params.maxTokens" control={form.control} render={({ field }) => (
          <FormItem>
            <FormLabel required>{t("forms.evalscope.maxTokens")}</FormLabel>
            <FormControl><Input type="number" {...field} onChange={(e) => field.onChange(Number(e.target.value))} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <FormField name="params.apiPath" control={form.control} render={({ field }) => (
          <FormItem>
            <FormLabel>{t("forms.evalscope.apiPath")}</FormLabel>
            <Select value={field.value} onValueChange={field.onChange}>
              <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
              <SelectContent>
                <SelectItem value="/v1/chat/completions">/v1/chat/completions</SelectItem>
                <SelectItem value="/v1/completions">/v1/completions</SelectItem>
              </SelectContent>
            </Select>
          </FormItem>
        )} />
        <FormField name="params.stream" control={form.control} render={({ field }) => (
          <FormItem className="flex flex-row items-center justify-between rounded-md border px-3 py-2">
            <FormLabel className="mb-0">{t("forms.evalscope.stream")}</FormLabel>
            <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
          </FormItem>
        )} />
        <FormField name="params.seed" control={form.control} render={({ field }) => (
          <FormItem>
            <FormLabel>{t("forms.evalscope.seed")}</FormLabel>
            <FormControl>
              <Input
                type="number"
                value={field.value ?? ""}
                onChange={(e) => field.onChange(e.target.value === "" ? undefined : Number(e.target.value))}
              />
            </FormControl>
            <FormDescription>{t("forms.evalscope.seedHint")}</FormDescription>
          </FormItem>
        )} />
      </div>
    </FormSection>
  );
}
```

- [ ] **Step 2 · Build (type-check covers this; no separate test yet — existing form pattern doesn't include unit tests for each new form)**

```bash
pnpm -F @modeldoctor/web type-check
```

- [ ] **Step 3 · Commit**

```bash
git add apps/web/src/features/benchmarks/forms/EvalscopeParamsForm.tsx
git commit -m "feat(web): EvalscopeParamsForm

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 12 · AiperfParamsForm.tsx

**Files:**
- Create: `apps/web/src/features/benchmarks/forms/AiperfParamsForm.tsx`

- [ ] **Step 1 · Write form**

```tsx
// apps/web/src/features/benchmarks/forms/AiperfParamsForm.tsx
import { FormSection } from "@/components/common/form-section";
import {
  FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useFormContext } from "react-hook-form";
import { useTranslation } from "react-i18next";

export function AiperfParamsForm() {
  const { t } = useTranslation("benchmarks");
  const form = useFormContext();
  const numeric = (field: { onChange: (v: number) => void }) =>
    (e: React.ChangeEvent<HTMLInputElement>) => field.onChange(Number(e.target.value));

  return (
    <FormSection title={t("forms.aiperf.section")}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <FormField name="params.concurrency" control={form.control} render={({ field }) => (
          <FormItem>
            <FormLabel required>{t("forms.aiperf.concurrency")}</FormLabel>
            <FormControl><Input type="number" {...field} onChange={numeric(field)} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <FormField name="params.requestCount" control={form.control} render={({ field }) => (
          <FormItem>
            <FormLabel required>{t("forms.aiperf.requestCount")}</FormLabel>
            <FormControl><Input type="number" {...field} onChange={numeric(field)} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <FormField name="params.dataset" control={form.control} render={({ field }) => (
          <FormItem>
            <FormLabel>{t("forms.aiperf.dataset")}</FormLabel>
            <Select value={field.value} onValueChange={field.onChange}>
              <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
              <SelectContent>
                <SelectItem value="synthetic">Synthetic</SelectItem>
                <SelectItem value="sharegpt">ShareGPT</SelectItem>
              </SelectContent>
            </Select>
          </FormItem>
        )} />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FormField name="params.inputTokensMean" control={form.control} render={({ field }) => (
          <FormItem>
            <FormLabel required>{t("forms.aiperf.inputTokensMean")}</FormLabel>
            <FormControl><Input type="number" {...field} onChange={numeric(field)} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <FormField name="params.inputTokensStddev" control={form.control} render={({ field }) => (
          <FormItem>
            <FormLabel>{t("forms.aiperf.inputTokensStddev")}</FormLabel>
            <FormControl><Input type="number" {...field} onChange={numeric(field)} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <FormField name="params.outputTokensMean" control={form.control} render={({ field }) => (
          <FormItem>
            <FormLabel required>{t("forms.aiperf.outputTokensMean")}</FormLabel>
            <FormControl><Input type="number" {...field} onChange={numeric(field)} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <FormField name="params.outputTokensStddev" control={form.control} render={({ field }) => (
          <FormItem>
            <FormLabel>{t("forms.aiperf.outputTokensStddev")}</FormLabel>
            <FormControl><Input type="number" {...field} onChange={numeric(field)} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FormField name="params.apiPath" control={form.control} render={({ field }) => (
          <FormItem>
            <FormLabel>{t("forms.aiperf.apiPath")}</FormLabel>
            <Select value={field.value} onValueChange={field.onChange}>
              <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
              <SelectContent>
                <SelectItem value="/v1/chat/completions">/v1/chat/completions</SelectItem>
                <SelectItem value="/v1/completions">/v1/completions</SelectItem>
              </SelectContent>
            </Select>
          </FormItem>
        )} />
        <FormField name="params.streaming" control={form.control} render={({ field }) => (
          <FormItem className="flex flex-row items-center justify-between rounded-md border px-3 py-2">
            <FormLabel className="mb-0">{t("forms.aiperf.streaming")}</FormLabel>
            <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
          </FormItem>
        )} />
      </div>
    </FormSection>
  );
}
```

- [ ] **Step 2 · type-check**

```bash
pnpm -F @modeldoctor/web type-check
```

- [ ] **Step 3 · Commit**

```bash
git add apps/web/src/features/benchmarks/forms/AiperfParamsForm.tsx
git commit -m "feat(web): AiperfParamsForm

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 13 · Update ToolParamsEditor router

**Files:**
- Modify: `apps/web/src/features/benchmarks/forms/ToolParamsEditor.tsx`

- [ ] **Step 1 · Add `evalscope` + `aiperf` cases in the switch (preserve genai-perf and kv-cache-stress cases for now; Phase 7 deletes them)**

```ts
import { EvalscopeParamsForm } from "./EvalscopeParamsForm";
import { AiperfParamsForm } from "./AiperfParamsForm";

// inside the switch on `tool`:
case "evalscope": return <EvalscopeParamsForm />;
case "aiperf":   return <AiperfParamsForm />;
```

- [ ] **Step 2 · Add to `TOOL_CATEGORY_DEFAULTS` lookup**

```ts
import {
  // existing imports +
  AIPERF_CATEGORY_DEFAULTS,
  EVALSCOPE_CATEGORY_DEFAULTS,
  aiperfParamDefaults,
  evalscopeParamDefaults,
} from "@modeldoctor/tool-adapters/schemas";

const TOOL_CATEGORY_DEFAULTS = {
  // existing entries +
  evalscope: EVALSCOPE_CATEGORY_DEFAULTS,
  aiperf: AIPERF_CATEGORY_DEFAULTS,
} as const;

const TOOL_PARAM_DEFAULTS = {
  // existing entries +
  evalscope: evalscopeParamDefaults,
  aiperf: aiperfParamDefaults,
} as const;
```

(Verify the exact constant names in the existing file before patching.)

- [ ] **Step 3 · type-check + tests**

```bash
pnpm -F @modeldoctor/web type-check
pnpm -F @modeldoctor/web test src/features/benchmarks/forms/
```

- [ ] **Step 4 · Commit**

---

## Phase 6 · Web reports

### Task 14 · EvalscopeInferenceMetrics.tsx + AiperfInferenceMetrics.tsx

**Files:**
- Create: `apps/web/src/features/benchmarks/reports/evalscope/InferenceMetrics.tsx`
- Create: `apps/web/src/features/benchmarks/reports/aiperf/InferenceMetrics.tsx`

> Reference `reports/guidellm/InferenceMetrics.tsx` for layout (latency dist cards + throughput cards + request totals). The evalscope and aiperf shapes share the same fields; the two components can be near-duplicates, with evalscope's optionally showing the prefix-cache panel.

- [ ] **Step 1 · Look at guidellm InferenceMetrics for reference**

```bash
cat apps/web/src/features/benchmarks/reports/guidellm/InferenceMetrics.tsx
```

- [ ] **Step 2 · Write EvalscopeInferenceMetrics.tsx** modeled on it, reading `benchmark.summaryMetrics` with type guard:

First, factor out two shared building blocks the existing guidellm metrics already imply but don't export. Add `apps/web/src/features/benchmarks/reports/shared/LatencyDistCard.tsx`:

```tsx
import { Badge } from "@/components/ui/badge";

interface Dist { mean: number; p50: number; p90: number; p95: number; p99: number }
export function LatencyDistCard({ title, dist, unit = "ms" }: { title: string; dist: Dist; unit?: string }) {
  return (
    <div className="rounded-md border p-4">
      <div className="mb-2 text-sm font-medium">{title}</div>
      <div className="grid grid-cols-5 gap-2 text-xs">
        {(["mean", "p50", "p90", "p95", "p99"] as const).map((k) => (
          <div key={k} className="flex flex-col gap-0.5">
            <Badge variant="outline" className="w-fit text-[10px]">{k}</Badge>
            <span className="tabular-nums">{dist[k].toFixed(1)} {unit}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

And `apps/web/src/features/benchmarks/reports/shared/ThroughputCard.tsx`:

```tsx
export function ThroughputCard({ label, value, unit }: { label: string; value: number; unit?: string }) {
  return (
    <div className="rounded-md border p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">
        {value.toFixed(1)} <span className="text-sm font-normal text-muted-foreground">{unit ?? ""}</span>
      </div>
    </div>
  );
}
```

Then `EvalscopeInferenceMetrics.tsx`:

```tsx
import type { Benchmark } from "@modeldoctor/contracts";
import { evalscopeReportSchema } from "@modeldoctor/tool-adapters/schemas";
import { useTranslation } from "react-i18next";
import { UnknownReport } from "../UnknownReport";
import { LatencyDistCard } from "../shared/LatencyDistCard";
import { ThroughputCard } from "../shared/ThroughputCard";

export function EvalscopeInferenceMetrics({ benchmark }: { benchmark: Benchmark }) {
  const { t } = useTranslation("benchmarks");
  const parsed = evalscopeReportSchema.safeParse(
    (benchmark.summaryMetrics as { data?: unknown })?.data,
  );
  if (!parsed.success) return <UnknownReport benchmark={benchmark} />;
  const r = parsed.data;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <ThroughputCard label={t("reports.evalscope.requestsPerSec")} value={r.throughput.requestsPerSec} unit="req/s" />
        <ThroughputCard label={t("reports.evalscope.outputTps")} value={r.throughput.outputTokensPerSec} unit="tok/s" />
        <ThroughputCard label={t("reports.evalscope.totalTps")} value={r.throughput.totalTokensPerSec} unit="tok/s" />
      </div>
      <LatencyDistCard title={t("reports.evalscope.ttft")} dist={r.ttft} />
      <LatencyDistCard title={t("reports.evalscope.e2e")} dist={r.e2eLatency} />
      <LatencyDistCard title={t("reports.evalscope.itl")} dist={r.itl} />
      <div className="rounded-md border p-4">
        <div className="text-sm font-medium">{t("reports.evalscope.requests")}</div>
        <div className="mt-2 grid grid-cols-4 gap-2 text-xs">
          <div>{t("reports.evalscope.total")}: <span className="tabular-nums">{r.requests.total}</span></div>
          <div>{t("reports.evalscope.success")}: <span className="tabular-nums">{r.requests.success}</span></div>
          <div>{t("reports.evalscope.error")}: <span className="tabular-nums">{r.requests.error}</span></div>
          <div>{t("reports.evalscope.errorRate")}: <span className="tabular-nums">{(r.requests.errorRate * 100).toFixed(2)}%</span></div>
        </div>
      </div>
      {r.prefixCacheStats && (
        <div className="rounded-md border p-4 bg-emerald-50/40 dark:bg-emerald-950/20">
          <div className="text-sm font-medium">{t("reports.evalscope.prefixCache")}</div>
          <div className="mt-1 flex gap-6 text-xs">
            <div>{t("reports.evalscope.hitRate")}: <span className="tabular-nums font-semibold">{(r.prefixCacheStats.hitRate * 100).toFixed(1)}%</span></div>
            <div>{t("reports.evalscope.savings")}: <span className="tabular-nums font-semibold">{(r.prefixCacheStats.savings * 100).toFixed(1)}%</span></div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3 · Write AiperfInferenceMetrics.tsx**

```tsx
// apps/web/src/features/benchmarks/reports/aiperf/InferenceMetrics.tsx
import type { Benchmark } from "@modeldoctor/contracts";
import { aiperfReportSchema } from "@modeldoctor/tool-adapters/schemas";
import { useTranslation } from "react-i18next";
import { UnknownReport } from "../UnknownReport";
import { LatencyDistCard } from "../shared/LatencyDistCard";
import { ThroughputCard } from "../shared/ThroughputCard";

export function AiperfInferenceMetrics({ benchmark }: { benchmark: Benchmark }) {
  const { t } = useTranslation("benchmarks");
  const parsed = aiperfReportSchema.safeParse(
    (benchmark.summaryMetrics as { data?: unknown })?.data,
  );
  if (!parsed.success) return <UnknownReport benchmark={benchmark} />;
  const r = parsed.data;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <ThroughputCard label={t("reports.aiperf.requestsPerSec")} value={r.throughput.requestsPerSec} unit="req/s" />
        <ThroughputCard label={t("reports.aiperf.outputTps")} value={r.throughput.outputTokensPerSec} unit="tok/s" />
        <ThroughputCard label={t("reports.aiperf.totalTps")} value={r.throughput.totalTokensPerSec} unit="tok/s" />
      </div>
      <LatencyDistCard title={t("reports.aiperf.ttft")} dist={r.ttft} />
      <LatencyDistCard title={t("reports.aiperf.e2e")} dist={r.e2eLatency} />
      <LatencyDistCard title={t("reports.aiperf.itl")} dist={r.itl} />
      <div className="rounded-md border p-4">
        <div className="text-sm font-medium">{t("reports.aiperf.requests")}</div>
        <div className="mt-2 grid grid-cols-4 gap-2 text-xs">
          <div>{t("reports.aiperf.total")}: <span className="tabular-nums">{r.requests.total}</span></div>
          <div>{t("reports.aiperf.success")}: <span className="tabular-nums">{r.requests.success}</span></div>
          <div>{t("reports.aiperf.error")}: <span className="tabular-nums">{r.requests.error}</span></div>
          <div>{t("reports.aiperf.errorRate")}: <span className="tabular-nums">{(r.requests.errorRate * 100).toFixed(2)}%</span></div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4 · Update `InferenceReport.tsx`**

```tsx
import { AiperfInferenceMetrics } from "./aiperf/InferenceMetrics";
import { EvalscopeInferenceMetrics } from "./evalscope/InferenceMetrics";

export function InferenceReport({ benchmark }: InferenceReportProps) {
  switch (benchmark.tool) {
    case "guidellm":   return <GuidellmInferenceMetrics benchmark={benchmark} />;
    case "genai-perf": return <GenaiPerfInferenceMetrics benchmark={benchmark} />;  // removed in Phase 7
    case "aiperf":     return <AiperfInferenceMetrics benchmark={benchmark} />;
    case "evalscope":  return <EvalscopeInferenceMetrics benchmark={benchmark} />;
    default:           return <UnknownReport benchmark={benchmark} />;
  }
}
```

- [ ] **Step 5 · type-check + commit**

---

### Task 15 · List-page metric readers

**Files:**
- Modify: `apps/web/src/features/benchmarks/compare/metrics.ts`

- [ ] **Step 1 · Find `readP95Latency` / `readErrorRate` / etc.**

```bash
grep -n "case .guidellm" apps/web/src/features/benchmarks/compare/metrics.ts
```

- [ ] **Step 2 · Add `case "evalscope"` and `case "aiperf"` branches**

For each reader (P95, error rate, output TPS, etc.), follow the existing case shape:

```ts
case "evalscope":
case "aiperf":
  return (data as { ttft?: { p95?: number } })?.ttft?.p95 ?? null;  // example for P95
```

(Look at how guidellm reader reaches into `data` and use the same pattern keyed to evalscope/aiperf schema.)

- [ ] **Step 3 · Update tests**

```bash
pnpm -F @modeldoctor/web test src/features/benchmarks/compare/
```

If existing tests reference `genai-perf` / `kv-cache-stress` cases, leave them for now — Phase 7 removes those branches.

- [ ] **Step 4 · Commit**

---

### Task 16 · KvCacheStressReport rewrite (cold/warm + prefix cache)

**Files:**
- Modify: `apps/web/src/features/benchmarks/reports/KvCacheStressReport.tsx`
- Create: `apps/web/src/features/benchmarks/reports/__tests__/KvCacheStressReport.test.tsx`

- [ ] **Step 1 · Write failing test for cold/warm pairing**

```tsx
// apps/web/src/features/benchmarks/reports/__tests__/KvCacheStressReport.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { KvCacheStressReport } from "../KvCacheStressReport";

function wrap(children: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}

const baseBenchmark = {
  id: "b1",
  name: "KV Cache · Task 1",
  tool: "evalscope",
  scenario: "kv-cache-stress",
  summaryMetrics: {
    tool: "evalscope",
    data: {
      throughput: { requestsPerSec: 8, outputTokensPerSec: 1200, totalTokensPerSec: 1500 },
      ttft: { mean: 800, p50: 700, p90: 1200, p95: 1500, p99: 2000 },
      e2eLatency: { mean: 4000, p50: 3500, p90: 5500, p95: 6500, p99: 8000 },
      itl: { mean: 30, p50: 28, p90: 40, p95: 45, p99: 60 },
      requests: { total: 64, success: 64, error: 0, errorRate: 0 },
      prefixCacheStats: { hitRate: 0.85, savings: 0.6 },
    },
  },
} as unknown as Parameters<typeof KvCacheStressReport>[0]["benchmark"];

describe("KvCacheStressReport", () => {
  it("renders prefix cache panel when stats present", () => {
    render(wrap(<KvCacheStressReport benchmark={baseBenchmark} />));
    expect(screen.getByText(/85/)).toBeInTheDocument();   // hit rate %
    expect(screen.getByText(/60/)).toBeInTheDocument();   // savings %
  });

  it("hides prefix cache panel when stats absent", () => {
    const bm = {
      ...baseBenchmark,
      summaryMetrics: {
        ...baseBenchmark.summaryMetrics,
        data: { ...baseBenchmark.summaryMetrics.data, prefixCacheStats: undefined },
      },
    };
    render(wrap(<KvCacheStressReport benchmark={bm} />));
    expect(screen.queryByText(/Prefix cache/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2 · Verify FAIL**

```bash
pnpm -F @modeldoctor/web test src/features/benchmarks/reports/__tests__/KvCacheStressReport.test.tsx
```

- [ ] **Step 3 · Rewrite KvCacheStressReport.tsx**

Replace the file body entirely. Outline:

```tsx
import type { Benchmark } from "@modeldoctor/contracts";
import { evalscopeReportSchema } from "@modeldoctor/tool-adapters/schemas";
import { useBenchmarkList } from "../queries";
import { UnknownReport } from "./UnknownReport";
import { LatencyDistCard, ThroughputCard, RequestsCard } from "./shared";  // refactor shared bits out of guidellm/InferenceMetrics

export function KvCacheStressReport({ benchmark }: { benchmark: Benchmark }) {
  const parsed = evalscopeReportSchema.safeParse(
    (benchmark.summaryMetrics as { data?: unknown })?.data,
  );
  if (!parsed.success) return <UnknownReport benchmark={benchmark} />;
  const r = parsed.data;
  const pair = useColdWarmPair(benchmark);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <ThroughputCard label="QPS" value={r.throughput.requestsPerSec} unit="req/s" />
        <ThroughputCard label="Output tokens/s" value={r.throughput.outputTokensPerSec} />
        <ThroughputCard label="Total tokens/s" value={r.throughput.totalTokensPerSec} />
      </div>

      <LatencyDistCard title="TTFT (ms)" dist={r.ttft} />
      <LatencyDistCard title="E2E (ms)" dist={r.e2eLatency} />
      <LatencyDistCard title="ITL (ms)" dist={r.itl} />

      <RequestsCard r={r.requests} />

      {r.prefixCacheStats && (
        <div className="rounded-md border p-4">
          <h3 className="font-semibold">Prefix cache</h3>
          <p>Hit rate: {(r.prefixCacheStats.hitRate * 100).toFixed(1)}%</p>
          <p>Savings: {(r.prefixCacheStats.savings * 100).toFixed(1)}%</p>
        </div>
      )}

      {pair && (
        <ColdWarmPanel cold={pair.cold} warm={pair.warm} />
      )}
    </div>
  );
}

// Helper: finds the rerun child of this benchmark by name pattern.
// "Foo" cold + "Foo (rerun)" warm. Returns null when no pair exists.
function useColdWarmPair(benchmark: Benchmark): { cold: Benchmark; warm: Benchmark } | null {
  const isWarm = /\s\(rerun\)$/.test(benchmark.name);
  const baseName = isWarm ? benchmark.name.replace(/\s\(rerun\)+$/, "") : benchmark.name;
  const { data } = useBenchmarkList({
    search: baseName,
    scenario: "kv-cache-stress",
    status: "completed",
    limit: 20,
  });
  const items = (data?.pages ?? []).flatMap((p) => p.items);
  const cold = items.find((b) => b.id !== benchmark.id ? b.name === baseName : b.name === baseName);
  const warm = items.find((b) => b.id !== benchmark.id ? b.name === `${baseName} (rerun)` : b.name === `${baseName} (rerun)`);
  // Always include the current benchmark on its own side of the pair.
  const resolvedCold = isWarm ? cold : benchmark;
  const resolvedWarm = isWarm ? benchmark : warm;
  if (!resolvedCold || !resolvedWarm) return null;
  return { cold: resolvedCold, warm: resolvedWarm };
}

// Side-by-side render: TTFT delta, throughput delta, ITL delta.
function ColdWarmPanel({ cold, warm }: { cold: Benchmark; warm: Benchmark }) {
  const c = evalscopeReportSchema.safeParse((cold.summaryMetrics as { data?: unknown })?.data);
  const w = evalscopeReportSchema.safeParse((warm.summaryMetrics as { data?: unknown })?.data);
  if (!c.success || !w.success) return null;
  const fmtDelta = (coldVal: number, warmVal: number) => {
    if (coldVal === 0) return "—";
    const delta = ((warmVal - coldVal) / coldVal) * 100;
    return `${delta > 0 ? "+" : ""}${delta.toFixed(1)}%`;
  };
  return (
    <div className="rounded-md border p-4">
      <h3 className="font-semibold mb-3">Cold vs Warm (R1 → R2)</h3>
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th className="text-left">Metric</th>
            <th className="text-right">Cold (R1)</th>
            <th className="text-right">Warm (R2)</th>
            <th className="text-right">Δ</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          <tr><td>TTFT P95 (ms)</td><td className="text-right">{c.data.ttft.p95.toFixed(1)}</td><td className="text-right">{w.data.ttft.p95.toFixed(1)}</td><td className="text-right">{fmtDelta(c.data.ttft.p95, w.data.ttft.p95)}</td></tr>
          <tr><td>QPS</td><td className="text-right">{c.data.throughput.requestsPerSec.toFixed(2)}</td><td className="text-right">{w.data.throughput.requestsPerSec.toFixed(2)}</td><td className="text-right">{fmtDelta(c.data.throughput.requestsPerSec, w.data.throughput.requestsPerSec)}</td></tr>
          <tr><td>Output tok/s</td><td className="text-right">{c.data.throughput.outputTokensPerSec.toFixed(0)}</td><td className="text-right">{w.data.throughput.outputTokensPerSec.toFixed(0)}</td><td className="text-right">{fmtDelta(c.data.throughput.outputTokensPerSec, w.data.throughput.outputTokensPerSec)}</td></tr>
          <tr><td>ITL P50 (ms)</td><td className="text-right">{c.data.itl.p50.toFixed(2)}</td><td className="text-right">{w.data.itl.p50.toFixed(2)}</td><td className="text-right">{fmtDelta(c.data.itl.p50, w.data.itl.p50)}</td></tr>
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4 · Verify PASS**

```bash
pnpm -F @modeldoctor/web test src/features/benchmarks/reports/__tests__/KvCacheStressReport.test.tsx
```

- [ ] **Step 5 · Commit**

---

## Phase 7 · Seed templates

### Task 17 · Add 8 new official templates

**Files:**
- Modify: `apps/api/prisma/seed.ts`

- [ ] **Step 1 · Read existing BENCHMARK_TEMPLATES structure**

```bash
grep -n "BENCHMARK_TEMPLATES\b" apps/api/prisma/seed.ts | head -5
```

- [ ] **Step 2 · Append 8 new templates (KV Cache 6 + Inference 2)** matching the table in spec §6.2 / §6.3. Use slugs `kvs-evalscope-task-1` … `kvs-evalscope-task-6`, `inf-evalscope-short`, `inf-evalscope-long`. Each has `tool: "evalscope"`, `scenario: <inference|kv-cache-stress>`, `isOfficial: true`, `params: { ... }`, `seed: 42` for KV Cache rows.

- [ ] **Step 3 · Delete old genai-perf + kv-cache-stress templates from the same array (they'll otherwise be left as orphan upserts forever).**

- [ ] **Step 4 · Run seed**

```bash
pnpm -F @modeldoctor/api db:seed
```

Inspect output for upsert errors.

- [ ] **Step 5 · DB spot-check**

```bash
psql postgresql://modeldoctor:modeldoctor@localhost:5432/modeldoctor \
  -c "SELECT slug, scenario, tool FROM benchmark_templates WHERE tool='evalscope' ORDER BY slug;"
```

Expected: 8 rows.

- [ ] **Step 6 · Commit**

---

## Phase 8 · i18n

### Task 18 · Add new i18n keys

**Files:**
- Modify: `apps/web/src/locales/en-US/benchmarks.json`
- Modify: `apps/web/src/locales/zh-CN/benchmarks.json`

- [ ] **Step 1 · Add `tools.evalscope` and `tools.aiperf` keys (display labels). Remove `tools.genai-perf` and `tools.kv-cache-stress` keys.**

- [ ] **Step 2 · Add `forms.evalscope.*` and `forms.aiperf.*` keys for each form field (label / hint).**

- [ ] **Step 3 · Verify parity**

```bash
pnpm -F @modeldoctor/web exec node scripts/check-i18n-parity.mjs
```

Must show OK.

- [ ] **Step 4 · Commit**

---

## Phase 9 · Hard delete deprecated tools

### Task 19 · Delete genai-perf adapter files

**Files:**
- Delete: `packages/tool-adapters/src/genai-perf/` (whole dir)
- Delete: `apps/benchmark-runner/images/genai-perf.Dockerfile`

- [ ] **Step 1 · Remove from `packages/tool-adapters/src/index.ts` exports**

Remove the `export { genaiPerfAdapter } from "./genai-perf/index.js";` line.

- [ ] **Step 2 · Remove from `packages/tool-adapters/src/schemas-entry.ts` exports**

Remove the `genaiPerf*` re-exports and `GENAI_PERF_CATEGORY_DEFAULTS` re-export.

- [ ] **Step 3 · Remove from `packages/tool-adapters/src/category-defaults.ts`**

Remove `GENAI_PERF_CATEGORY_DEFAULTS` definition + import of `GenaiPerfParams`.

- [ ] **Step 4 · Delete files**

```bash
rm -rf packages/tool-adapters/src/genai-perf/
rm apps/benchmark-runner/images/genai-perf.Dockerfile
```

- [ ] **Step 5 · Remove from `tools/build-runner-images.sh` and `apps/api/src/modules/benchmark/k8s/runner-images.ts`**

- [ ] **Step 6 · Remove from `apps/web/src/features/benchmarks/forms/ToolParamsEditor.tsx`** — delete the `case "genai-perf"` branch and the import + the entry in `TOOL_CATEGORY_DEFAULTS` / `TOOL_PARAM_DEFAULTS` maps.

- [ ] **Step 7 · Remove from `apps/web/src/features/benchmarks/reports/InferenceReport.tsx`** — delete the `case "genai-perf"` branch and the import.

- [ ] **Step 8 · Delete `apps/web/src/features/benchmarks/forms/GenaiPerfParamsForm.tsx` and its test**

- [ ] **Step 9 · Delete `apps/web/src/features/benchmarks/reports/genai-perf/` directory**

- [ ] **Step 10 · Remove `case "genai-perf"` from `compare/metrics.ts` readers**

- [ ] **Step 11 · Verify build clean**

```bash
pnpm -r build
pnpm -F @modeldoctor/tool-adapters test
pnpm -F @modeldoctor/web test
pnpm -F @modeldoctor/api type-check
```

- [ ] **Step 12 · Commit**

```bash
git commit -m "refactor: hard-delete genai-perf adapter (deprecated; replaced by aiperf)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 20 · Delete kv-cache-stress adapter files

> **Important:** do NOT delete `KvCacheStressReport.tsx` — it was rewritten in Task 16 to read the evalscope shape and remains the report component for the `kv-cache-stress` scenario.

**Files:**
- Delete: `packages/tool-adapters/src/kv-cache-stress/` (whole dir)
- Delete: `apps/benchmark-runner/images/kv-cache-stress.Dockerfile`
- Delete: `apps/web/src/features/benchmarks/forms/KvCacheStressParamsForm.tsx` (+ its test)

- [ ] **Step 1 · Remove `export { kvCacheStressAdapter } ...` line from `packages/tool-adapters/src/index.ts`**

- [ ] **Step 2 · Remove `kvCacheStress*` re-exports and `KV_CACHE_STRESS_CATEGORY_DEFAULTS` re-export from `packages/tool-adapters/src/schemas-entry.ts`**

- [ ] **Step 3 · Remove `KV_CACHE_STRESS_CATEGORY_DEFAULTS` definition + `KvCacheStressParams` import from `packages/tool-adapters/src/category-defaults.ts`**

- [ ] **Step 4 · Delete files**

```bash
rm -rf packages/tool-adapters/src/kv-cache-stress/
rm apps/benchmark-runner/images/kv-cache-stress.Dockerfile
rm apps/web/src/features/benchmarks/forms/KvCacheStressParamsForm.tsx
rm -f apps/web/src/features/benchmarks/forms/__tests__/KvCacheStressParamsForm.test.tsx
```

- [ ] **Step 5 · Remove kv-cache-stress from `tools/build-runner-images.sh` (TOOLS array)**

- [ ] **Step 6 · Remove kv-cache-stress from `apps/api/src/modules/benchmark/k8s/runner-images.ts`**

- [ ] **Step 7 · Remove `case "kv-cache-stress"` branch from `apps/web/src/features/benchmarks/forms/ToolParamsEditor.tsx`**, plus the entry in `TOOL_CATEGORY_DEFAULTS` / `TOOL_PARAM_DEFAULTS` maps and the imports for `KV_CACHE_STRESS_CATEGORY_DEFAULTS` and `kvCacheStressParamDefaults`.

- [ ] **Step 8 · Remove `case "kv-cache-stress"` from `apps/web/src/features/benchmarks/compare/metrics.ts` readers** (P95, error rate, output TPS, etc.).

- [ ] **Step 9 · Verify build clean**

```bash
pnpm -r build
pnpm -F @modeldoctor/tool-adapters test
pnpm -F @modeldoctor/web test
pnpm -F @modeldoctor/api type-check
```

- [ ] **Step 10 · Commit**

```bash
git commit -m "refactor: hard-delete kv-cache-stress adapter (replaced by evalscope)

KvCacheStressReport stays — it reads the evalscope summaryMetrics shape
as of <Task 16 commit hash>.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 21 · Remove deprecated values from BenchmarkTool enum

**Files:**
- Modify: `packages/contracts/src/benchmark.ts`

- [ ] **Step 1 · Drop `"genai-perf"` and `"kv-cache-stress"` from `benchmarkToolSchema`**

```ts
export const benchmarkToolSchema = z.enum([
  "guidellm",
  "vegeta",
  "prefix-cache-probe",
  "evalscope",
  "aiperf",
]);
```

- [ ] **Step 2 · Verify build clean**

```bash
pnpm -r build
pnpm -r test
```

If any callsite still references the removed enum values, the type-check will fail — fix them now (likely a stale test fixture).

- [ ] **Step 3 · Commit**

---

## Phase 10 · DB migration

### Task 22 · Prisma migration to drop deprecated tool rows

**Files:**
- Create: `apps/api/prisma/migrations/<timestamp>_drop_deprecated_tools/migration.sql`

- [ ] **Step 1 · Generate Prisma migration scaffold**

```bash
cd apps/api
pnpm exec prisma migrate dev --create-only --name drop_deprecated_tools
```

This creates a new migration directory under `prisma/migrations/`. Open the generated `migration.sql`.

- [ ] **Step 2 · Replace migration content with hard-delete SQL**

```sql
-- Drop saved_compares that reference benchmarks using deprecated tools.
DELETE FROM saved_compares
WHERE EXISTS (
  SELECT 1 FROM benchmarks b
  WHERE b.id = ANY(saved_compares.benchmark_ids)
    AND b.tool IN ('genai-perf', 'kv-cache-stress')
);

-- Drop benchmark rows using deprecated tools.
DELETE FROM benchmarks WHERE tool IN ('genai-perf', 'kv-cache-stress');

-- Drop template rows using deprecated tools.
DELETE FROM benchmark_templates WHERE tool IN ('genai-perf', 'kv-cache-stress');
```

- [ ] **Step 3 · Ask user before applying** (per `feedback_dev_db_disposable`)

> "This migration deletes rows from `benchmarks`, `saved_compares`, and `benchmark_templates`. Approve before I apply it to the local dev DB?"

After approval:

```bash
pnpm -F @modeldoctor/api exec prisma migrate dev
pnpm -F @modeldoctor/api db:seed
```

- [ ] **Step 4 · Verify rows gone**

```bash
psql postgresql://modeldoctor:modeldoctor@localhost:5432/modeldoctor \
  -c "SELECT tool, COUNT(*) FROM benchmarks GROUP BY tool;" \
  -c "SELECT tool, COUNT(*) FROM benchmark_templates GROUP BY tool;"
```

Expected: no `genai-perf` or `kv-cache-stress` rows; 8 new `evalscope` template rows present.

- [ ] **Step 5 · Commit**

```bash
git add apps/api/prisma/migrations/
git commit -m "feat(db): drop benchmarks/templates/saved_compares using deprecated tools

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 11 · Verification

### Task 23 · Final verification — typecheck, lint, test

- [ ] **Step 1 · Repo-wide build**

```bash
pnpm -r build
```

Expected: green.

- [ ] **Step 2 · Repo-wide tests**

```bash
pnpm -r test
```

Expected: all unit tests pass.

- [ ] **Step 3 · Web lint**

```bash
pnpm -F @modeldoctor/web lint
```

Expected: 0 errors. Pre-existing warnings (non-blocking) acceptable.

- [ ] **Step 4 · i18n parity**

```bash
pnpm -F @modeldoctor/web exec node scripts/check-i18n-parity.mjs
```

Expected: `OK — zh-CN and en-US key sets match.`

- [ ] **Step 5 · API e2e**

```bash
pnpm -F @modeldoctor/api exec vitest run -c vitest.e2e.config.mts
```

Expected: all e2e tests pass. (If any test asserts on `tool: "genai-perf"` etc., fix it now.)

- [ ] **Step 6 · No commit (verification only). If any step fails, push a fixup commit before moving on.**

---

### Task 24 · Manual smoke (dev cluster)

- [ ] **Step 1 · Build the two new runner images**

```bash
./tools/build-runner-images.sh
```

- [ ] **Step 2 · Start dev**

```bash
pnpm dev
```

- [ ] **Step 3 · Open browser, log in, navigate to `/benchmarks/kv-cache-stress/new`**

Expected: "Use a template" dropdown shows the 6 new KV Cache · Task N templates.

- [ ] **Step 4 · Pick "KV Cache · Task 1 · 8K prompt · parallel 8" → submit (use a real or mock vLLM endpoint)**

Expected: benchmark transitions pending → running → completed; detail page shows the new KvCacheStressReport layout with throughput/TTFT/ITL/E2E/requests cards plus optional Prefix cache panel.

- [ ] **Step 5 · Click "Rerun" on the completed row**

Expected: a new `(rerun)` benchmark starts. Once completed, open the detail page — the cold/warm panel should appear comparing TTFT/throughput against the original.

- [ ] **Step 6 · Repeat for Inference Performance → evalscope short prompts template → confirm InferenceReport renders the evalscope branch.**

- [ ] **Step 7 · Repeat for one aiperf benchmark to confirm AiperfInferenceMetrics renders.**

- [ ] **Step 8 · No commit — record any issues found and address them.**

---

### Task 25 · Open PR

- [ ] **Step 1 · Push branch**

```bash
git push -u origin chore/polish-batch
```

(Or the user may have created a different branch by this point; check `git branch --show-current`.)

- [ ] **Step 2 · Open PR with structured body**

```bash
gh pr create --title "feat: evalscope + AIPerf tool migration (drop deprecated genai-perf and kv-cache-stress)" --body "$(cat <<'EOF'
## Summary

- Replaces deprecated NVIDIA `genai-perf` with successor `aiperf`
- Replaces self-built `kv-cache-stress` driver with Modelscope `evalscope perf` + LongAlpaca-12k
- Adds 8 official templates aligned with the 2026-05-12 yrcache report methodology
- Rewrites `KvCacheStressReport` with cold/warm pairing + prefix cache panel

## Test plan

- [ ] `pnpm -r build` green
- [ ] `pnpm -r test` green
- [ ] `pnpm -F @modeldoctor/web lint` 0 errors
- [ ] i18n parity OK
- [ ] Manual smoke: KV Cache Task 1 + rerun → cold/warm panel shows
- [ ] Manual smoke: Inference evalscope short prompts → InferenceReport renders
- [ ] Manual smoke: Inference aiperf baseline → InferenceReport renders

Spec: `docs/superpowers/specs/2026-05-13-evalscope-aiperf-tool-migration-design.md`
Plan: `docs/superpowers/plans/2026-05-13-evalscope-aiperf-tool-migration.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3 · Verify CI signals**

```bash
gh pr checks --watch
```

Address any CI failures with follow-up commits before merging.

---

## Self-Review Checklist

After implementation, before opening PR, sweep the spec sections and confirm:

- [ ] §2 Tool matrix matches scenarios.ts (Task 7)
- [ ] §3 Hard-delete covered (Tasks 19, 20, 21)
- [ ] §4 evalscope adapter complete (Tasks 1-3) + image (Task 8)
- [ ] §5 aiperf adapter complete (Tasks 4-6) + image (Task 9)
- [ ] §6 8 new templates seeded (Task 17)
- [ ] §7 UI: Forms (Tasks 11-12) + Reports (Tasks 14, 16) + Editor (Task 13) + metric readers (Task 15) + i18n (Task 18)
- [ ] §8 Verification (Tasks 23-24)
- [ ] §9 PR opened (Task 25)
- [ ] §10 Open questions addressed (AIPerf CLI verified in Task 5 prep, cold/warm pairing simple-name-suffix algorithm in Task 16)
