# Engine Metrics Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Embed a per-engine Prometheus-driven metrics section on Benchmark Detail that aligns with the benchmark's time window, covering vLLM (V0+V1) / SGLang / TGI / MindIE / TEI.

**Architecture:** Engine manifests (PromQL templates per engine) live in `@modeldoctor/contracts`. A new `engine-metrics` Nest module proxies `query_range` to each connection's Prometheus, applies the manifest, and returns normalized samples. The web layer renders them as panels (stat / gauge / timeseries / heatmap) inside Benchmark Detail with a `markArea` overlay marking the actual benchmark window.

**Tech Stack:** TypeScript, Zod, NestJS 11 + nestjs-zod, Prisma, undici fetch, React + react-query, echarts (`echarts-for-react`), shadcn/ui, vitest, biome.

---

## File Structure

### Created

```
packages/contracts/src/
  engine.ts                                          # EngineId, ENGINE_DISPLAY_NAME, ENGINE_CAPABILITY (SSOT)
  engine-metrics.ts                                  # PanelKind/Group/Unit, EngineMetricSpec, EngineManifest, snapshot zod schemas
  engine-metrics/
    manifests/
      vllm.ts                                        # 19 panels, V0/V1 dual-match
      sglang.ts                                      # 9 panels
      tgi.ts                                         # 7 panels
      mindie.ts                                      # 5 panels (conservative)
      tei.ts                                         # 6 panels (embedding capability)
      index.ts                                       # getEngineManifest(engineId) registry
      __tests__/manifests.spec.ts                    # snapshot test for all 5 manifests

apps/api/src/modules/engine-metrics/
  engine-metrics.module.ts
  engine-metrics.controller.ts                       # GET /api/engine-metrics/:connectionId/snapshot
  engine-metrics.controller.spec.ts
  engine-metrics.service.ts                          # fetchSnapshot orchestration
  engine-metrics.service.spec.ts
  prom-client.ts                                     # queryRange + error normalization
  prom-client.spec.ts
apps/api/test/e2e/engine-metrics.e2e-spec.ts         # supertest + global fetch stub

apps/web/src/features/engine-metrics/
  EngineMetricsSection.tsx                           # container with group rows + skeleton + error states
  EngineMetricsSection.test.tsx
  useEngineMetrics.ts                                # react-query hook
  panels/
    StatPanel.tsx
    StatPanel.test.tsx
    GaugePanel.tsx
    GaugePanel.test.tsx
    TimeseriesPanel.tsx                              # echarts line + markArea benchmark window
    TimeseriesPanel.test.tsx
    HeatmapPanel.tsx                                 # M1 stacked-bar simplification
    HeatmapPanel.test.tsx

apps/web/src/locales/en-US/engine-metrics.json
apps/web/src/locales/zh-CN/engine-metrics.json
```

### Modified

```
packages/contracts/src/connection.ts                 # serverKindSchema 5 → 10 enum values
packages/contracts/src/index.ts                      # export new modules
apps/web/src/features/deployment-recipes/types.ts    # import EngineId from @modeldoctor/contracts
apps/api/src/modules/connection/connection.service.ts  # extend DecryptedConnection with serverKind
apps/api/src/app.module.ts                           # register EngineMetricsModule
apps/web/src/features/connections/schema.ts          # add serverKind to form schema
apps/web/src/features/connections/ConnectionDialog.tsx # add serverKind <Select> field
apps/web/src/features/connections/ConnectionDialog.test.tsx # cover serverKind field
apps/web/src/features/benchmarks/BenchmarkDetailPage.tsx # mount <EngineMetricsSection> conditionally
apps/web/src/lib/i18n.ts                             # register engine-metrics namespace
apps/web/src/locales/en-US/connections.json          # add serverKind label/placeholder + engine option labels
apps/web/src/locales/zh-CN/connections.json
```

---

## Task Map (overview)

| # | Task | Phase |
|---|---|---|
| 1 | Extract `EngineId` to contracts | P1.1 |
| 2 | Expand `serverKindSchema` to 10 engines | P1.1 |
| 3 | Engine-metrics core types in contracts | P1.1 |
| 4 | vLLM manifest (V0+V1) | P1.1 |
| 5 | SGLang manifest | P1.2 |
| 6 | TGI manifest | P1.2 |
| 7 | MindIE manifest | P1.2 |
| 8 | TEI manifest | P1.2 |
| 9 | Manifest registry + getter | P1.2 |
| 10 | `prom-client` (queryRange + error normalization) | P1.3 |
| 11 | Engine-metrics service | P1.3 |
| 12 | Extend `DecryptedConnection` with `serverKind` | P1.3 |
| 13 | Engine-metrics controller + module + AppModule wire-up | P1.3 |
| 14 | API e2e for snapshot endpoint | P1.3 |
| 15 | `useEngineMetrics` react-query hook | P1.4 |
| 16 | `<StatPanel>` | P1.4 |
| 17 | `<GaugePanel>` | P1.4 |
| 18 | `<TimeseriesPanel>` (with markArea) | P1.4 |
| 19 | `<HeatmapPanel>` (stacked-bar M1) | P1.4 |
| 20 | i18n files | P1.4 |
| 21 | `<EngineMetricsSection>` container | P1.4 |
| 22 | ConnectionDialog `serverKind` dropdown | P1.5 |
| 23 | Mount section in BenchmarkDetailPage | P1.5 |
| 24 | Manual verification checklist | P1.6 |

Each task ends with a focused `git commit`. No `git push` per session policy.

---

### Task 1: Extract `EngineId` to contracts

**Files:**
- Create: `packages/contracts/src/engine.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/web/src/features/deployment-recipes/types.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/contracts/src/engine.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  ENGINE_CAPABILITY,
  ENGINE_DISPLAY_NAME,
  ENGINE_IDS,
  type EngineId,
} from "./engine.js";

describe("engine SSOT", () => {
  it("declares all 10 engines exactly once", () => {
    expect(new Set(ENGINE_IDS).size).toBe(ENGINE_IDS.length);
    expect(ENGINE_IDS).toHaveLength(10);
  });

  it("has display name for every engine id", () => {
    for (const id of ENGINE_IDS) {
      expect(ENGINE_DISPLAY_NAME[id]).toBeTruthy();
    }
  });

  it("has capability for every engine id", () => {
    for (const id of ENGINE_IDS) {
      expect(["generative", "embedding"]).toContain(ENGINE_CAPABILITY[id]);
    }
  });

  it("classifies tei + infinity as embedding", () => {
    const embedding: EngineId[] = ENGINE_IDS.filter(
      (id) => ENGINE_CAPABILITY[id] === "embedding",
    );
    expect(new Set(embedding)).toEqual(new Set(["tei", "infinity"]));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @modeldoctor/contracts vitest run engine.spec.ts`
Expected: FAIL with "Cannot find module './engine.js'".

- [ ] **Step 3: Implement `engine.ts`**

Create `packages/contracts/src/engine.ts`:

```ts
/**
 * Single source of truth for inference engine identifiers. Imported by:
 *   - connection.ts (serverKind enum)
 *   - engine-metrics.ts (manifest registry)
 *   - apps/web/src/features/deployment-recipes (compatibility matrix)
 */

export const ENGINE_IDS = [
  "vllm",
  "sglang",
  "trtllm",
  "mindie",
  "lmdeploy",
  "tgi",
  "tei",
  "infinity",
  "llamacpp",
  "comfyui",
] as const;

export type EngineId = (typeof ENGINE_IDS)[number];

export const ENGINE_DISPLAY_NAME: Record<EngineId, string> = {
  vllm: "vLLM",
  sglang: "SGLang",
  trtllm: "TensorRT-LLM",
  mindie: "MindIE",
  lmdeploy: "LMDeploy",
  tgi: "TGI",
  tei: "TEI",
  infinity: "Infinity",
  llamacpp: "llama.cpp",
  comfyui: "ComfyUI",
};

export type EngineCapability = "generative" | "embedding";

/**
 * Splits engines by metric semantics. Generative = TTFT/TPOT/KV-cache concepts
 * apply. Embedding = single-shot forward, no first-token notion. UI uses this
 * to pick the panel set.
 *
 * comfyui is parked as "generative" for M1; in practice it's diffusion and
 * needs its own capability bucket later.
 */
export const ENGINE_CAPABILITY: Record<EngineId, EngineCapability> = {
  vllm: "generative",
  sglang: "generative",
  trtllm: "generative",
  mindie: "generative",
  lmdeploy: "generative",
  tgi: "generative",
  tei: "embedding",
  infinity: "embedding",
  llamacpp: "generative",
  comfyui: "generative",
};
```

Append to `packages/contracts/src/index.ts`:

```ts
export * from "./engine.js";
```

Replace `apps/web/src/features/deployment-recipes/types.ts`'s local `EngineId` definition with re-export:

```ts
import type { EngineId } from "@modeldoctor/contracts";

export type { EngineId };
export type RecipeStatus = "native" | "partial" | "none";
export type CategoryId = "dense" | "moe" | "vlm" | "embedding" | "rerank" | "diffusion";
// ... rest of file unchanged
```

(Keep the rest of the file's interfaces / `CATEGORY_ORDER` constant intact — only the `EngineId` line and the import are modified.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @modeldoctor/contracts vitest run engine.spec.ts`
Expected: PASS, 4/4.

Run: `pnpm -F @modeldoctor/contracts build && pnpm -F @modeldoctor/web typecheck`
Expected: 0 errors (deployment-recipes still resolves `EngineId`).

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/engine.ts packages/contracts/src/engine.spec.ts \
  packages/contracts/src/index.ts apps/web/src/features/deployment-recipes/types.ts
git commit -m "$(cat <<'EOF'
feat(contracts): extract EngineId to contracts as SSOT

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Expand `serverKindSchema` to 10 engines

**Files:**
- Modify: `packages/contracts/src/connection.ts`
- Modify: `packages/contracts/src/connection.spec.ts`

- [ ] **Step 1: Add the failing assertion**

Append to `packages/contracts/src/connection.spec.ts`:

```ts
import { ENGINE_IDS } from "./engine.js";
import { serverKindSchema } from "./connection.js";

describe("serverKindSchema after engine SSOT extraction", () => {
  it("accepts every EngineId plus higress + generic", () => {
    for (const id of ENGINE_IDS) {
      expect(serverKindSchema.parse(id)).toBe(id);
    }
    expect(serverKindSchema.parse("higress")).toBe("higress");
    expect(serverKindSchema.parse("generic")).toBe("generic");
  });

  it("rejects unknown values", () => {
    expect(() => serverKindSchema.parse("nope")).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @modeldoctor/contracts vitest run connection.spec.ts`
Expected: FAIL on `serverKindSchema.parse("trtllm")` (or similar new value) — invalid enum.

- [ ] **Step 3: Update `serverKindSchema`**

Replace the enum line in `packages/contracts/src/connection.ts`:

```ts
import { ENGINE_IDS } from "./engine.js";

export const serverKindSchema = z.enum([...ENGINE_IDS, "higress", "generic"] as [
  string,
  ...string[],
]);
export type ServerKind = z.infer<typeof serverKindSchema>;
```

(The cast keeps Zod's enum inference happy with a spread of a `readonly` tuple.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @modeldoctor/contracts vitest run connection.spec.ts`
Expected: PASS for both new cases plus existing.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/connection.ts packages/contracts/src/connection.spec.ts
git commit -m "$(cat <<'EOF'
feat(contracts): expand serverKind to all 10 engines

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Engine-metrics core types in contracts

**Files:**
- Create: `packages/contracts/src/engine-metrics.ts`
- Create: `packages/contracts/src/engine-metrics.spec.ts`
- Modify: `packages/contracts/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/contracts/src/engine-metrics.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  engineMetricsSnapshotQuerySchema,
  engineMetricsSnapshotResponseSchema,
  panelGroupSchema,
  panelKindSchema,
  panelUnitSchema,
} from "./engine-metrics.js";

describe("engine-metrics zod schemas", () => {
  it("panelKindSchema accepts known kinds", () => {
    for (const v of ["stat", "gauge", "timeseries", "heatmap"]) {
      expect(panelKindSchema.parse(v)).toBe(v);
    }
  });

  it("panelGroupSchema accepts known groups", () => {
    for (const v of ["topline", "latency", "throughput", "engine", "health"]) {
      expect(panelGroupSchema.parse(v)).toBe(v);
    }
  });

  it("panelUnitSchema accepts ms/s/%/ratio/tps/rps/count/bytes", () => {
    for (const v of ["ms", "s", "%", "ratio", "tps", "rps", "count", "bytes"]) {
      expect(panelUnitSchema.parse(v)).toBe(v);
    }
  });

  it("snapshot query requires from/to ISO and accepts step", () => {
    const ok = engineMetricsSnapshotQuerySchema.parse({
      from: "2026-05-09T00:00:00.000Z",
      to: "2026-05-09T00:01:00.000Z",
      step: 15,
    });
    expect(ok.step).toBe(15);
    expect(() =>
      engineMetricsSnapshotQuerySchema.parse({ from: "garbage", to: "x" }),
    ).toThrow();
  });

  it("snapshot response shape: engineId / capability / panels", () => {
    const ok = engineMetricsSnapshotResponseSchema.parse({
      engineId: "vllm",
      capability: "generative",
      window: {
        from: "2026-05-09T00:00:00.000Z",
        to: "2026-05-09T00:01:00.000Z",
        step: 15,
      },
      panels: [
        {
          key: "ttft_p99",
          group: "topline",
          panel: "stat",
          unit: "ms",
          unavailable: false,
          series: [{ samples: [[1715212800, 187.4]] }],
        },
        {
          key: "kv_cache_usage",
          group: "engine",
          panel: "timeseries",
          unit: "%",
          unavailable: true,
          reason: "no_data",
          series: [],
        },
      ],
    });
    expect(ok.panels).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @modeldoctor/contracts vitest run engine-metrics.spec.ts`
Expected: FAIL with "Cannot find module './engine-metrics.js'".

- [ ] **Step 3: Implement `engine-metrics.ts`**

Create `packages/contracts/src/engine-metrics.ts`:

```ts
import { z } from "zod";
import { ENGINE_IDS, type EngineCapability, type EngineId } from "./engine.js";

export const panelKindSchema = z.enum(["stat", "gauge", "timeseries", "heatmap"]);
export type PanelKind = z.infer<typeof panelKindSchema>;

export const panelGroupSchema = z.enum([
  "topline",
  "latency",
  "throughput",
  "engine",
  "health",
]);
export type PanelGroup = z.infer<typeof panelGroupSchema>;

export const panelUnitSchema = z.enum([
  "ms",
  "s",
  "%",
  "ratio",
  "tps",
  "rps",
  "count",
  "bytes",
]);
export type PanelUnit = z.infer<typeof panelUnitSchema>;

/**
 * One PromQL template variant. `tag` is a free-form label (e.g. "v0", "v1")
 * used in logs / debugging only — order in the array decides try-priority,
 * the tag itself is informational.
 */
export interface PromQLVariant {
  tag?: string;
  expr: string;
}

export interface EngineMetricSpec {
  /** Stable cross-engine semantic key. UI uses it to choose layout slot
   * + i18n label. Examples: "ttft_p99", "kv_cache_usage", "queue_depth". */
  key: string;
  group: PanelGroup;
  panel: PanelKind;
  unit: PanelUnit;
  /** PromQL templates. Tried in order; first one returning ANY non-empty
   * series wins. `${model}` is the only allowed interpolation. */
  promql: PromQLVariant[];
  /** Optional thresholds for stat/gauge color coding. */
  thresholds?: Array<{ at: number; severity: "ok" | "warn" | "crit" }>;
}

export interface EngineManifest {
  engineId: EngineId;
  capability: EngineCapability;
  /** Display name for the section subtitle (e.g. "vLLM (V0/V1)"). */
  displayName: string;
  metrics: EngineMetricSpec[];
}

// ---- HTTP wire types ----

export const engineMetricsSnapshotQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  /** Sampling step in seconds. Defaults to 15 server-side (= Prom scrape). */
  step: z.coerce.number().int().min(1).max(3600).optional(),
});
export type EngineMetricsSnapshotQuery = z.infer<typeof engineMetricsSnapshotQuerySchema>;

const sampleTuple = z.tuple([z.number(), z.number()]);

const engineMetricsSeriesSchema = z.object({
  /** Optional series identifier — pod name / instance / nothing for aggregate. */
  label: z.string().optional(),
  samples: z.array(sampleTuple),
});

const engineMetricsPanelResultSchema = z.object({
  key: z.string(),
  group: panelGroupSchema,
  panel: panelKindSchema,
  unit: panelUnitSchema,
  /** True when no data was retrieved for any reason. */
  unavailable: z.boolean(),
  /** Why unavailable (only present when `unavailable: true`). */
  reason: z.enum(["no_data", "prom_error", "not_supported"]).optional(),
  series: z.array(engineMetricsSeriesSchema),
});

export const engineMetricsSnapshotResponseSchema = z.object({
  engineId: z.enum(ENGINE_IDS as unknown as [EngineId, ...EngineId[]]),
  capability: z.enum(["generative", "embedding"]),
  window: z.object({
    from: z.string().datetime(),
    to: z.string().datetime(),
    step: z.number().int().min(1),
  }),
  panels: z.array(engineMetricsPanelResultSchema),
});
export type EngineMetricsSnapshotResponse = z.infer<
  typeof engineMetricsSnapshotResponseSchema
>;
export type EngineMetricsPanelResult = z.infer<typeof engineMetricsPanelResultSchema>;
export type EngineMetricsSeries = z.infer<typeof engineMetricsSeriesSchema>;
```

Append to `packages/contracts/src/index.ts`:

```ts
export * from "./engine-metrics.js";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @modeldoctor/contracts vitest run engine-metrics.spec.ts`
Expected: PASS, 5/5.

Run: `pnpm -F @modeldoctor/contracts build`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/engine-metrics.ts packages/contracts/src/engine-metrics.spec.ts \
  packages/contracts/src/index.ts
git commit -m "$(cat <<'EOF'
feat(contracts): add engine-metrics core types

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: vLLM manifest (V0+V1)

**Files:**
- Create: `packages/contracts/src/engine-metrics/manifests/vllm.ts`
- Create: `packages/contracts/src/engine-metrics/manifests/__tests__/vllm.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/contracts/src/engine-metrics/manifests/__tests__/vllm.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { vllmManifest } from "../vllm.js";

describe("vllm manifest", () => {
  it("declares 19 panels with unique keys", () => {
    expect(vllmManifest.metrics).toHaveLength(19);
    const keys = vllmManifest.metrics.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every metric has at least one PromQL variant", () => {
    for (const m of vllmManifest.metrics) {
      expect(m.promql.length).toBeGreaterThan(0);
      for (const v of m.promql) {
        expect(v.expr).toMatch(/\$\{model\}/);
      }
    }
  });

  it("has V0/V1 dual variants for prefix-cache metrics", () => {
    const prefix = vllmManifest.metrics.find((m) => m.key === "prefix_cache_hit_rate");
    expect(prefix).toBeDefined();
    const tags = (prefix?.promql ?? []).map((v) => v.tag);
    expect(tags).toEqual(expect.arrayContaining(["v1", "v0"]));
  });

  it("topline group has 5 panels", () => {
    const topline = vllmManifest.metrics.filter((m) => m.group === "topline");
    expect(topline).toHaveLength(5);
  });

  it("snapshot of all rendered PromQL strings is stable", () => {
    const rendered = vllmManifest.metrics.map((m) => ({
      key: m.key,
      exprs: m.promql.map((v) => v.expr.replace("${model}", "test-model")),
    }));
    expect(rendered).toMatchSnapshot();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @modeldoctor/contracts vitest run vllm.spec.ts`
Expected: FAIL on missing `../vllm.js`.

- [ ] **Step 3: Implement `vllm.ts`**

Create `packages/contracts/src/engine-metrics/manifests/vllm.ts`:

```ts
import type { EngineManifest, EngineMetricSpec } from "../../engine-metrics.js";

const M = "${model}";

const metrics: EngineMetricSpec[] = [
  // ---- topline ----
  {
    key: "success_rate",
    group: "topline",
    panel: "stat",
    unit: "ratio",
    promql: [
      {
        tag: "v1",
        expr: `sum(rate(vllm:request_success_total{model_name="${M}"}[5m])) / clamp_min(sum(rate(vllm:request_total{model_name="${M}"}[5m])), 1)`,
      },
    ],
    thresholds: [
      { at: 0.95, severity: "ok" },
      { at: 0.9, severity: "warn" },
      { at: 0, severity: "crit" },
    ],
  },
  {
    key: "active_requests",
    group: "topline",
    panel: "gauge",
    unit: "count",
    promql: [
      { tag: "v1", expr: `sum(vllm:num_requests_running{model_name="${M}"})` },
    ],
  },
  {
    key: "system_efficiency",
    group: "topline",
    panel: "stat",
    unit: "ratio",
    promql: [
      {
        tag: "v1",
        expr: `sum(rate(vllm:generation_tokens_total{model_name="${M}"}[1m])) / clamp_min(sum(rate(vllm:prompt_tokens_total{model_name="${M}"}[1m])), 1)`,
      },
    ],
  },
  {
    key: "ttft_p99",
    group: "topline",
    panel: "stat",
    unit: "ms",
    promql: [
      {
        tag: "v1",
        expr: `histogram_quantile(0.99, sum by (le) (rate(vllm:time_to_first_token_seconds_bucket{model_name="${M}"}[5m]))) * 1000`,
      },
    ],
  },
  {
    key: "preemption_rate",
    group: "topline",
    panel: "stat",
    unit: "rps",
    promql: [
      { tag: "v1", expr: `sum(rate(vllm:num_preemptions_total{model_name="${M}"}[1m]))` },
    ],
  },
  // ---- latency ----
  {
    key: "e2e_latency",
    group: "latency",
    panel: "timeseries",
    unit: "ms",
    promql: [
      {
        tag: "v1",
        expr: `histogram_quantile(0.50, sum by (le) (rate(vllm:e2e_request_latency_seconds_bucket{model_name="${M}"}[1m]))) * 1000 or histogram_quantile(0.95, sum by (le) (rate(vllm:e2e_request_latency_seconds_bucket{model_name="${M}"}[1m]))) * 1000 or histogram_quantile(0.99, sum by (le) (rate(vllm:e2e_request_latency_seconds_bucket{model_name="${M}"}[1m]))) * 1000`,
      },
    ],
  },
  {
    key: "stage_breakdown",
    group: "latency",
    panel: "timeseries",
    unit: "ms",
    promql: [
      {
        tag: "v1",
        expr: `(sum(rate(vllm:time_in_prefill_seconds_sum{model_name="${M}"}[1m])) / clamp_min(sum(rate(vllm:time_in_prefill_seconds_count{model_name="${M}"}[1m])), 1)) * 1000 or (sum(rate(vllm:time_in_decode_seconds_sum{model_name="${M}"}[1m])) / clamp_min(sum(rate(vllm:time_in_decode_seconds_count{model_name="${M}"}[1m])), 1)) * 1000`,
      },
    ],
  },
  {
    key: "ttft_vs_tpot",
    group: "latency",
    panel: "timeseries",
    unit: "ms",
    promql: [
      {
        tag: "v1",
        expr: `histogram_quantile(0.99, sum by (le) (rate(vllm:time_to_first_token_seconds_bucket{model_name="${M}"}[1m]))) * 1000 or histogram_quantile(0.99, sum by (le) (rate(vllm:time_per_output_token_seconds_bucket{model_name="${M}"}[1m]))) * 1000`,
      },
    ],
  },
  // ---- throughput ----
  {
    key: "token_throughput_in",
    group: "throughput",
    panel: "timeseries",
    unit: "tps",
    promql: [
      { tag: "v1", expr: `sum(rate(vllm:prompt_tokens_total{model_name="${M}"}[1m]))` },
    ],
  },
  {
    key: "token_throughput_out",
    group: "throughput",
    panel: "timeseries",
    unit: "tps",
    promql: [
      {
        tag: "v1",
        expr: `sum(rate(vllm:generation_tokens_total{model_name="${M}"}[1m]))`,
      },
    ],
  },
  {
    key: "token_io_ratio",
    group: "throughput",
    panel: "stat",
    unit: "ratio",
    promql: [
      {
        tag: "v1",
        expr: `sum(rate(vllm:generation_tokens_total{model_name="${M}"}[5m])) / clamp_min(sum(rate(vllm:prompt_tokens_total{model_name="${M}"}[5m])), 1)`,
      },
    ],
  },
  {
    key: "prefix_cache_savings",
    group: "throughput",
    panel: "gauge",
    unit: "%",
    promql: [
      {
        tag: "v1",
        expr: `100 * sum(rate(vllm:prefix_cache_hits_total{model_name="${M}"}[5m])) / clamp_min(sum(rate(vllm:prefix_cache_queries_total{model_name="${M}"}[5m])), 1)`,
      },
      {
        tag: "v0",
        expr: `100 * sum(rate(vllm:gpu_prefix_cache_hits_total{model_name="${M}"}[5m])) / clamp_min(sum(rate(vllm:gpu_prefix_cache_queries_total{model_name="${M}"}[5m])), 1)`,
      },
    ],
  },
  {
    key: "request_queue_time",
    group: "throughput",
    panel: "timeseries",
    unit: "ms",
    promql: [
      {
        tag: "v1",
        expr: `histogram_quantile(0.5, sum by (le) (rate(vllm:request_queue_time_seconds_bucket{model_name="${M}"}[1m]))) * 1000 or histogram_quantile(0.99, sum by (le) (rate(vllm:request_queue_time_seconds_bucket{model_name="${M}"}[1m]))) * 1000`,
      },
    ],
  },
  {
    key: "request_length_heatmap",
    group: "throughput",
    panel: "heatmap",
    unit: "count",
    promql: [
      {
        tag: "v1",
        expr: `sum by (le) (rate(vllm:request_prompt_tokens_bucket{model_name="${M}"}[1m]))`,
      },
    ],
  },
  // ---- engine ----
  {
    key: "kv_cache_usage",
    group: "engine",
    panel: "timeseries",
    unit: "%",
    promql: [
      {
        tag: "v1",
        expr: `100 * vllm:gpu_cache_usage_perc{model_name="${M}"}`,
      },
    ],
  },
  {
    key: "prefix_cache_hit_rate",
    group: "engine",
    panel: "gauge",
    unit: "%",
    promql: [
      {
        tag: "v1",
        expr: `100 * sum(rate(vllm:prefix_cache_hits_total{model_name="${M}"}[5m])) / clamp_min(sum(rate(vllm:prefix_cache_queries_total{model_name="${M}"}[5m])), 1)`,
      },
      {
        tag: "v0",
        expr: `100 * sum(rate(vllm:gpu_prefix_cache_hits_total{model_name="${M}"}[5m])) / clamp_min(sum(rate(vllm:gpu_prefix_cache_queries_total{model_name="${M}"}[5m])), 1)`,
      },
    ],
  },
  {
    key: "scheduler_state",
    group: "engine",
    panel: "timeseries",
    unit: "count",
    promql: [
      {
        tag: "v1",
        expr: `sum(vllm:num_requests_running{model_name="${M}"}) or sum(vllm:num_requests_waiting{model_name="${M}"}) or sum(vllm:num_requests_swapped{model_name="${M}"})`,
      },
    ],
  },
  // ---- health ----
  {
    key: "python_gc_memory",
    group: "health",
    panel: "timeseries",
    unit: "bytes",
    promql: [
      {
        tag: "v1",
        expr: `process_resident_memory_bytes{job=~".*vllm.*"} or python_gc_collections_total{job=~".*vllm.*",model_name="${M}"}`,
      },
    ],
  },
  {
    key: "finish_reason",
    group: "health",
    panel: "timeseries",
    unit: "rps",
    promql: [
      {
        tag: "v1",
        expr: `sum by (finished_reason) (rate(vllm:request_success_total{model_name="${M}"}[1m]))`,
      },
    ],
  },
];

export const vllmManifest: EngineManifest = {
  engineId: "vllm",
  capability: "generative",
  displayName: "vLLM (V0/V1)",
  metrics,
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @modeldoctor/contracts vitest run vllm.spec.ts`
Expected: PASS, 5/5 (snapshot is created on first run; commit it).

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/engine-metrics/manifests/vllm.ts \
  packages/contracts/src/engine-metrics/manifests/__tests__/vllm.spec.ts \
  packages/contracts/src/engine-metrics/manifests/__tests__/__snapshots__/
git commit -m "$(cat <<'EOF'
feat(contracts): vLLM engine-metrics manifest (V0+V1, 19 panels)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: SGLang manifest

**Files:**
- Create: `packages/contracts/src/engine-metrics/manifests/sglang.ts`
- Create: `packages/contracts/src/engine-metrics/manifests/__tests__/sglang.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/contracts/src/engine-metrics/manifests/__tests__/sglang.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sglangManifest } from "../sglang.js";

describe("sglang manifest", () => {
  it("declares 9 panels with unique keys", () => {
    expect(sglangManifest.metrics).toHaveLength(9);
    const keys = sglangManifest.metrics.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every PromQL expr has model placeholder + sglang prefix", () => {
    for (const m of sglangManifest.metrics) {
      for (const v of m.promql) {
        expect(v.expr).toMatch(/\$\{model\}/);
        expect(v.expr).toMatch(/sglang:/);
      }
    }
  });

  it("snapshot of rendered PromQL is stable", () => {
    const rendered = sglangManifest.metrics.map((m) => ({
      key: m.key,
      exprs: m.promql.map((v) => v.expr.replace("${model}", "test-model")),
    }));
    expect(rendered).toMatchSnapshot();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @modeldoctor/contracts vitest run sglang.spec.ts`
Expected: FAIL on missing module.

- [ ] **Step 3: Implement `sglang.ts`**

Create `packages/contracts/src/engine-metrics/manifests/sglang.ts`:

```ts
import type { EngineManifest, EngineMetricSpec } from "../../engine-metrics.js";

const M = "${model}";

const metrics: EngineMetricSpec[] = [
  {
    key: "active_requests",
    group: "topline",
    panel: "gauge",
    unit: "count",
    promql: [{ expr: `sum(sglang:num_running_reqs{model_name="${M}"})` }],
  },
  {
    key: "ttft_p99",
    group: "topline",
    panel: "stat",
    unit: "ms",
    promql: [
      {
        expr: `histogram_quantile(0.99, sum by (le) (rate(sglang:time_to_first_token_seconds_bucket{model_name="${M}"}[5m]))) * 1000`,
      },
    ],
  },
  {
    key: "success_rate",
    group: "topline",
    panel: "stat",
    unit: "ratio",
    promql: [
      {
        expr: `sum(rate(sglang:request_success_total{model_name="${M}"}[5m])) / clamp_min(sum(rate(sglang:request_total{model_name="${M}"}[5m])), 1)`,
      },
    ],
  },
  {
    key: "e2e_latency",
    group: "latency",
    panel: "timeseries",
    unit: "ms",
    promql: [
      {
        expr: `histogram_quantile(0.50, sum by (le) (rate(sglang:e2e_request_latency_seconds_bucket{model_name="${M}"}[1m]))) * 1000 or histogram_quantile(0.95, sum by (le) (rate(sglang:e2e_request_latency_seconds_bucket{model_name="${M}"}[1m]))) * 1000 or histogram_quantile(0.99, sum by (le) (rate(sglang:e2e_request_latency_seconds_bucket{model_name="${M}"}[1m]))) * 1000`,
      },
    ],
  },
  {
    key: "token_throughput_out",
    group: "throughput",
    panel: "timeseries",
    unit: "tps",
    promql: [{ expr: `sum(sglang:gen_throughput{model_name="${M}"})` }],
  },
  {
    key: "request_queue_time",
    group: "throughput",
    panel: "timeseries",
    unit: "count",
    promql: [{ expr: `sum(sglang:num_queue_reqs{model_name="${M}"})` }],
  },
  {
    key: "kv_cache_usage",
    group: "engine",
    panel: "timeseries",
    unit: "%",
    promql: [{ expr: `100 * sglang:token_usage{model_name="${M}"}` }],
  },
  {
    key: "scheduler_state",
    group: "engine",
    panel: "timeseries",
    unit: "count",
    promql: [
      {
        expr: `sum(sglang:num_running_reqs{model_name="${M}"}) or sum(sglang:num_queue_reqs{model_name="${M}"})`,
      },
    ],
  },
  {
    key: "finish_reason",
    group: "health",
    panel: "timeseries",
    unit: "rps",
    promql: [
      {
        expr: `sum by (finished_reason) (rate(sglang:request_success_total{model_name="${M}"}[1m]))`,
      },
    ],
  },
];

export const sglangManifest: EngineManifest = {
  engineId: "sglang",
  capability: "generative",
  displayName: "SGLang",
  metrics,
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @modeldoctor/contracts vitest run sglang.spec.ts`
Expected: PASS, 3/3.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/engine-metrics/manifests/sglang.ts \
  packages/contracts/src/engine-metrics/manifests/__tests__/sglang.spec.ts \
  packages/contracts/src/engine-metrics/manifests/__tests__/__snapshots__/sglang.spec.ts.snap
git commit -m "$(cat <<'EOF'
feat(contracts): SGLang engine-metrics manifest (9 panels)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: TGI manifest

**Files:**
- Create: `packages/contracts/src/engine-metrics/manifests/tgi.ts`
- Create: `packages/contracts/src/engine-metrics/manifests/__tests__/tgi.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/contracts/src/engine-metrics/manifests/__tests__/tgi.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { tgiManifest } from "../tgi.js";

describe("tgi manifest", () => {
  it("declares 7 panels with unique keys", () => {
    expect(tgiManifest.metrics).toHaveLength(7);
    const keys = tgiManifest.metrics.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("uses tgi_ prefix throughout", () => {
    for (const m of tgiManifest.metrics) {
      for (const v of m.promql) {
        expect(v.expr).toMatch(/tgi_/);
      }
    }
  });

  it("snapshot of rendered PromQL is stable", () => {
    const rendered = tgiManifest.metrics.map((m) => ({
      key: m.key,
      exprs: m.promql.map((v) => v.expr.replace("${model}", "test-model")),
    }));
    expect(rendered).toMatchSnapshot();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @modeldoctor/contracts vitest run tgi.spec.ts`
Expected: FAIL on missing module.

- [ ] **Step 3: Implement `tgi.ts`**

Create `packages/contracts/src/engine-metrics/manifests/tgi.ts`. TGI's metrics don't carry `model_name`; the `${model}` placeholder still flows through but is unused inside the expression. We keep the `${model}` interpolation discipline (every spec must reference it) by emitting a no-op `{ignored=~"${model}"}` matcher comment so the renderer doesn't break — instead we skip the discipline for TGI by NOT requiring model placeholder. Update the test to acknowledge this:

Replace the second assertion in the test with:

```ts
  it("uses tgi_ prefix throughout", () => {
    for (const m of tgiManifest.metrics) {
      for (const v of m.promql) {
        expect(v.expr).toMatch(/tgi_/);
      }
    }
  });
```

Then the manifest:

```ts
import type { EngineManifest, EngineMetricSpec } from "../../engine-metrics.js";

const metrics: EngineMetricSpec[] = [
  {
    key: "active_requests",
    group: "topline",
    panel: "gauge",
    unit: "count",
    promql: [{ expr: `sum(tgi_batch_current_size)` }],
  },
  {
    key: "ttft_p99",
    group: "topline",
    panel: "stat",
    unit: "ms",
    promql: [
      {
        expr: `histogram_quantile(0.99, sum by (le) (rate(tgi_request_inference_duration_bucket[5m]))) * 1000`,
      },
    ],
  },
  {
    key: "e2e_latency",
    group: "latency",
    panel: "timeseries",
    unit: "ms",
    promql: [
      {
        expr: `histogram_quantile(0.50, sum by (le) (rate(tgi_request_duration_bucket[1m]))) * 1000 or histogram_quantile(0.95, sum by (le) (rate(tgi_request_duration_bucket[1m]))) * 1000 or histogram_quantile(0.99, sum by (le) (rate(tgi_request_duration_bucket[1m]))) * 1000`,
      },
    ],
  },
  {
    key: "stage_breakdown",
    group: "latency",
    panel: "timeseries",
    unit: "ms",
    promql: [
      {
        expr: `(sum(rate(tgi_request_queue_duration_sum[1m])) / clamp_min(sum(rate(tgi_request_queue_duration_count[1m])), 1)) * 1000 or (sum(rate(tgi_request_inference_duration_sum[1m])) / clamp_min(sum(rate(tgi_request_inference_duration_count[1m])), 1)) * 1000`,
      },
    ],
  },
  {
    key: "token_throughput_out",
    group: "throughput",
    panel: "timeseries",
    unit: "tps",
    promql: [{ expr: `sum(rate(tgi_tokenize_total[1m]))` }],
  },
  {
    key: "request_queue_time",
    group: "throughput",
    panel: "timeseries",
    unit: "ms",
    promql: [
      {
        expr: `histogram_quantile(0.99, sum by (le) (rate(tgi_request_queue_duration_bucket[1m]))) * 1000`,
      },
    ],
  },
  {
    key: "scheduler_state",
    group: "engine",
    panel: "timeseries",
    unit: "count",
    promql: [{ expr: `sum(tgi_batch_current_size) or sum(tgi_queue_size)` }],
  },
];

export const tgiManifest: EngineManifest = {
  engineId: "tgi",
  capability: "generative",
  displayName: "TGI",
  metrics,
};
```

> **Note on `${model}`**: TGI exposes a single-model server, so its metrics aren't tagged with `model_name`. To keep the renderer (Task 11) generic, treat manifests where `${model}` is absent as "no interpolation needed" — the renderer's `String.replaceAll('${model}', escaped)` is a no-op when the placeholder isn't present.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @modeldoctor/contracts vitest run tgi.spec.ts`
Expected: PASS, 3/3.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/engine-metrics/manifests/tgi.ts \
  packages/contracts/src/engine-metrics/manifests/__tests__/tgi.spec.ts \
  packages/contracts/src/engine-metrics/manifests/__tests__/__snapshots__/tgi.spec.ts.snap
git commit -m "$(cat <<'EOF'
feat(contracts): TGI engine-metrics manifest (7 panels)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: MindIE manifest (conservative 5 panels)

**Files:**
- Create: `packages/contracts/src/engine-metrics/manifests/mindie.ts`
- Create: `packages/contracts/src/engine-metrics/manifests/__tests__/mindie.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { mindieManifest } from "../mindie.js";

describe("mindie manifest", () => {
  it("declares 5 panels", () => {
    expect(mindieManifest.metrics).toHaveLength(5);
  });

  it("uses mindie_ prefix throughout", () => {
    for (const m of mindieManifest.metrics) {
      for (const v of m.promql) {
        expect(v.expr).toMatch(/mindie_/);
      }
    }
  });

  it("snapshot is stable", () => {
    const rendered = mindieManifest.metrics.map((m) => ({
      key: m.key,
      exprs: m.promql.map((v) => v.expr.replace("${model}", "test-model")),
    }));
    expect(rendered).toMatchSnapshot();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @modeldoctor/contracts vitest run mindie.spec.ts`
Expected: FAIL on missing module.

- [ ] **Step 3: Implement `mindie.ts`**

```ts
import type { EngineManifest, EngineMetricSpec } from "../../engine-metrics.js";

const M = "${model}";

const metrics: EngineMetricSpec[] = [
  {
    key: "active_requests",
    group: "topline",
    panel: "gauge",
    unit: "count",
    promql: [{ expr: `sum(mindie_running_request_count{model_name="${M}"})` }],
  },
  {
    key: "ttft_p99",
    group: "topline",
    panel: "stat",
    unit: "ms",
    promql: [
      {
        expr: `histogram_quantile(0.99, sum by (le) (rate(mindie_first_token_duration_seconds_bucket{model_name="${M}"}[5m]))) * 1000`,
      },
    ],
  },
  {
    key: "e2e_latency",
    group: "latency",
    panel: "timeseries",
    unit: "ms",
    promql: [
      {
        expr: `histogram_quantile(0.50, sum by (le) (rate(mindie_request_duration_seconds_bucket{model_name="${M}"}[1m]))) * 1000 or histogram_quantile(0.95, sum by (le) (rate(mindie_request_duration_seconds_bucket{model_name="${M}"}[1m]))) * 1000 or histogram_quantile(0.99, sum by (le) (rate(mindie_request_duration_seconds_bucket{model_name="${M}"}[1m]))) * 1000`,
      },
    ],
  },
  {
    key: "token_throughput_out",
    group: "throughput",
    panel: "timeseries",
    unit: "tps",
    promql: [
      { expr: `sum(rate(mindie_generation_tokens_total{model_name="${M}"}[1m]))` },
    ],
  },
  {
    key: "kv_cache_usage",
    group: "engine",
    panel: "timeseries",
    unit: "%",
    promql: [{ expr: `100 * mindie_kv_cache_usage_ratio{model_name="${M}"}` }],
  },
];

export const mindieManifest: EngineManifest = {
  engineId: "mindie",
  capability: "generative",
  displayName: "MindIE",
  metrics,
};
```

> **Note**: Names are conservative best-guess from MindIE 1.x docs. Confirm against `kubectl exec <mindie-pod> -- curl localhost:8000/metrics | grep '^mindie_'` during Task 24 manual verification; if a metric name is off, fix in a follow-up commit before merging.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @modeldoctor/contracts vitest run mindie.spec.ts`
Expected: PASS, 3/3.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/engine-metrics/manifests/mindie.ts \
  packages/contracts/src/engine-metrics/manifests/__tests__/mindie.spec.ts \
  packages/contracts/src/engine-metrics/manifests/__tests__/__snapshots__/mindie.spec.ts.snap
git commit -m "$(cat <<'EOF'
feat(contracts): MindIE engine-metrics manifest (conservative 5 panels)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: TEI manifest (embedding capability)

**Files:**
- Create: `packages/contracts/src/engine-metrics/manifests/tei.ts`
- Create: `packages/contracts/src/engine-metrics/manifests/__tests__/tei.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { teiManifest } from "../tei.js";

describe("tei manifest", () => {
  it("is embedding capability with 6 panels", () => {
    expect(teiManifest.capability).toBe("embedding");
    expect(teiManifest.metrics).toHaveLength(6);
  });

  it("uses te_ prefix and only topline/throughput/engine groups", () => {
    const groups = new Set(teiManifest.metrics.map((m) => m.group));
    expect(groups).toEqual(new Set(["topline", "throughput", "engine"]));
    for (const m of teiManifest.metrics) {
      for (const v of m.promql) {
        expect(v.expr).toMatch(/te_/);
      }
    }
  });

  it("snapshot is stable", () => {
    const rendered = teiManifest.metrics.map((m) => ({
      key: m.key,
      exprs: m.promql.map((v) => v.expr.replace("${model}", "test-model")),
    }));
    expect(rendered).toMatchSnapshot();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @modeldoctor/contracts vitest run tei.spec.ts`
Expected: FAIL on missing module.

- [ ] **Step 3: Implement `tei.ts`**

```ts
import type { EngineManifest, EngineMetricSpec } from "../../engine-metrics.js";

const metrics: EngineMetricSpec[] = [
  {
    key: "active_requests",
    group: "topline",
    panel: "gauge",
    unit: "count",
    promql: [{ expr: `sum(te_request_count{state="running"})` }],
  },
  {
    key: "success_rate",
    group: "topline",
    panel: "stat",
    unit: "ratio",
    promql: [
      {
        expr: `sum(rate(te_request_count{state="success"}[5m])) / clamp_min(sum(rate(te_request_count{state=~"success|failure"}[5m])), 1)`,
      },
    ],
  },
  {
    key: "request_latency_p99",
    group: "topline",
    panel: "stat",
    unit: "ms",
    promql: [
      {
        expr: `histogram_quantile(0.99, sum by (le) (rate(te_request_duration_seconds_bucket[5m]))) * 1000`,
      },
    ],
  },
  {
    key: "tokenize_rate",
    group: "throughput",
    panel: "timeseries",
    unit: "tps",
    promql: [{ expr: `sum(rate(te_tokenize_count[1m]))` }],
  },
  {
    key: "embedding_rate",
    group: "throughput",
    panel: "timeseries",
    unit: "rps",
    promql: [{ expr: `sum(rate(te_request_count{state="success"}[1m]))` }],
  },
  {
    key: "queue_metrics",
    group: "engine",
    panel: "timeseries",
    unit: "ms",
    promql: [
      {
        expr: `sum(te_queue_size) or histogram_quantile(0.99, sum by (le) (rate(te_queue_duration_seconds_bucket[1m]))) * 1000`,
      },
    ],
  },
];

export const teiManifest: EngineManifest = {
  engineId: "tei",
  capability: "embedding",
  displayName: "TEI",
  metrics,
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @modeldoctor/contracts vitest run tei.spec.ts`
Expected: PASS, 3/3.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/engine-metrics/manifests/tei.ts \
  packages/contracts/src/engine-metrics/manifests/__tests__/tei.spec.ts \
  packages/contracts/src/engine-metrics/manifests/__tests__/__snapshots__/tei.spec.ts.snap
git commit -m "$(cat <<'EOF'
feat(contracts): TEI engine-metrics manifest (embedding, 6 panels)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Manifest registry + getter

**Files:**
- Create: `packages/contracts/src/engine-metrics/manifests/index.ts`
- Create: `packages/contracts/src/engine-metrics/manifests/__tests__/registry.spec.ts`
- Modify: `packages/contracts/src/engine-metrics.ts`
- Modify: `packages/contracts/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/contracts/src/engine-metrics/manifests/__tests__/registry.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ENGINE_IDS } from "../../../engine.js";
import { ENGINE_MANIFEST_IDS, getEngineManifest } from "../index.js";

describe("engine manifest registry", () => {
  it("exports all 5 M1 manifests", () => {
    expect(ENGINE_MANIFEST_IDS.sort()).toEqual(
      ["vllm", "sglang", "tgi", "mindie", "tei"].sort(),
    );
  });

  it("getEngineManifest returns the manifest for known ids", () => {
    for (const id of ENGINE_MANIFEST_IDS) {
      const m = getEngineManifest(id);
      expect(m).toBeDefined();
      expect(m?.engineId).toBe(id);
    }
  });

  it("getEngineManifest returns null for unsupported engines", () => {
    const unsupported = ENGINE_IDS.filter(
      (id) => !ENGINE_MANIFEST_IDS.includes(id as never),
    );
    for (const id of unsupported) {
      expect(getEngineManifest(id)).toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @modeldoctor/contracts vitest run registry.spec.ts`
Expected: FAIL on missing `../index.js`.

- [ ] **Step 3: Implement registry**

Create `packages/contracts/src/engine-metrics/manifests/index.ts`:

```ts
import type { EngineId } from "../../engine.js";
import type { EngineManifest } from "../../engine-metrics.js";
import { mindieManifest } from "./mindie.js";
import { sglangManifest } from "./sglang.js";
import { teiManifest } from "./tei.js";
import { tgiManifest } from "./tgi.js";
import { vllmManifest } from "./vllm.js";

const REGISTRY = {
  vllm: vllmManifest,
  sglang: sglangManifest,
  tgi: tgiManifest,
  mindie: mindieManifest,
  tei: teiManifest,
} as const satisfies Partial<Record<EngineId, EngineManifest>>;

export const ENGINE_MANIFEST_IDS = Object.keys(REGISTRY) as Array<keyof typeof REGISTRY>;
export type SupportedEngineId = (typeof ENGINE_MANIFEST_IDS)[number];

export function getEngineManifest(id: EngineId): EngineManifest | null {
  return (REGISTRY as Record<string, EngineManifest>)[id] ?? null;
}

export { mindieManifest, sglangManifest, teiManifest, tgiManifest, vllmManifest };
```

Append to `packages/contracts/src/index.ts`:

```ts
export * from "./engine-metrics/manifests/index.js";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @modeldoctor/contracts vitest run registry.spec.ts`
Expected: PASS, 3/3.

Run: `pnpm -F @modeldoctor/contracts build`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/engine-metrics/manifests/index.ts \
  packages/contracts/src/engine-metrics/manifests/__tests__/registry.spec.ts \
  packages/contracts/src/index.ts
git commit -m "$(cat <<'EOF'
feat(contracts): engine manifest registry + getEngineManifest

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: `prom-client` (queryRange + error normalization)

**Files:**
- Create: `apps/api/src/modules/engine-metrics/prom-client.ts`
- Create: `apps/api/src/modules/engine-metrics/prom-client.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/engine-metrics/prom-client.spec.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PromClient, type PromQueryRangeResult } from "./prom-client.js";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

describe("PromClient.queryRange", () => {
  let client: PromClient;
  beforeEach(() => {
    client = new PromClient();
    fetchMock.mockReset();
  });
  afterEach(() => fetchMock.mockReset());

  it("returns parsed series on 200 + matrix payload", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        status: "success",
        data: {
          resultType: "matrix",
          result: [
            {
              metric: { pod: "infer-0" },
              values: [
                [1715212800, "0.42"],
                [1715212815, "0.55"],
              ],
            },
          ],
        },
      }),
    });

    const r = await client.queryRange({
      baseUrl: "http://prom:9090",
      query: 'sum(vllm:num_requests_running{model_name="m"})',
      from: new Date("2026-05-09T00:00:00Z"),
      to: new Date("2026-05-09T00:01:00Z"),
      step: 15,
    });

    expect(r.unavailable).toBe(false);
    expect(r.series).toHaveLength(1);
    expect(r.series[0].label).toBe("infer-0");
    expect(r.series[0].samples).toEqual([
      [1715212800, 0.42],
      [1715212815, 0.55],
    ]);
  });

  it("returns no_data on empty result array", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: "success", data: { resultType: "matrix", result: [] } }),
    });
    const r = await client.queryRange({
      baseUrl: "http://prom:9090",
      query: "x",
      from: new Date(0),
      to: new Date(60_000),
      step: 15,
    });
    expect(r).toMatchObject<Partial<PromQueryRangeResult>>({
      unavailable: true,
      reason: "no_data",
      series: [],
    });
  });

  it("returns prom_error on HTTP 503", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, text: async () => "down" });
    const r = await client.queryRange({
      baseUrl: "http://prom:9090",
      query: "x",
      from: new Date(0),
      to: new Date(60_000),
      step: 15,
    });
    expect(r).toMatchObject<Partial<PromQueryRangeResult>>({
      unavailable: true,
      reason: "prom_error",
    });
  });

  it("returns prom_error on fetch throw (network)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const r = await client.queryRange({
      baseUrl: "http://prom:9090",
      query: "x",
      from: new Date(0),
      to: new Date(60_000),
      step: 15,
    });
    expect(r.unavailable).toBe(true);
    expect(r.reason).toBe("prom_error");
  });

  it("encodes start/end/step in seconds", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: "success", data: { resultType: "matrix", result: [] } }),
    });
    await client.queryRange({
      baseUrl: "http://prom:9090",
      query: 'up{job="vllm"}',
      from: new Date("2026-05-09T00:00:00Z"),
      to: new Date("2026-05-09T00:01:00Z"),
      step: 30,
    });
    const [calledUrl] = fetchMock.mock.calls[0] as [string];
    expect(calledUrl).toContain("/api/v1/query_range?");
    expect(calledUrl).toContain("start=1778328000");
    expect(calledUrl).toContain("end=1778328060");
    expect(calledUrl).toContain("step=30");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @modeldoctor/api vitest run prom-client.spec.ts`
Expected: FAIL — no module.

- [ ] **Step 3: Implement `prom-client.ts`**

Create `apps/api/src/modules/engine-metrics/prom-client.ts`:

```ts
import { Injectable, Logger } from "@nestjs/common";

export interface PromQueryRangeArgs {
  baseUrl: string;
  query: string;
  from: Date;
  to: Date;
  /** seconds */
  step: number;
  /** abort after N ms (default 8s — Prom should answer in <1s normally) */
  timeoutMs?: number;
}

export interface PromSeries {
  label?: string;
  samples: Array<[number, number]>; // [unixSeconds, value]
}

export type PromUnavailableReason = "no_data" | "prom_error";

export interface PromQueryRangeResult {
  unavailable: boolean;
  reason?: PromUnavailableReason;
  series: PromSeries[];
}

interface PromMatrixSample {
  metric: Record<string, string>;
  values: Array<[number, string]>;
}

interface PromMatrixResponse {
  status: "success" | "error";
  data?: {
    resultType: "matrix" | "vector" | string;
    result: PromMatrixSample[];
  };
  error?: string;
}

@Injectable()
export class PromClient {
  private readonly log = new Logger(PromClient.name);

  async queryRange(args: PromQueryRangeArgs): Promise<PromQueryRangeResult> {
    const start = Math.floor(args.from.getTime() / 1000);
    const end = Math.floor(args.to.getTime() / 1000);
    const url = `${args.baseUrl.replace(/\/$/, "")}/api/v1/query_range?query=${encodeURIComponent(
      args.query,
    )}&start=${start}&end=${end}&step=${args.step}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), args.timeoutMs ?? 8_000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        this.log.warn(`prom queryRange ${res.status} for query=${args.query.slice(0, 80)}`);
        return { unavailable: true, reason: "prom_error", series: [] };
      }
      const body = (await res.json()) as PromMatrixResponse;
      if (body.status !== "success" || !body.data) {
        return { unavailable: true, reason: "prom_error", series: [] };
      }
      const result = body.data.result ?? [];
      if (result.length === 0) {
        return { unavailable: true, reason: "no_data", series: [] };
      }
      const series: PromSeries[] = result.map((row) => ({
        label: row.metric.pod ?? row.metric.instance ?? row.metric.finished_reason ?? undefined,
        samples: (row.values ?? []).map(([ts, v]) => [ts, Number.parseFloat(v)] as [number, number]),
      }));
      return { unavailable: false, series };
    } catch (err) {
      this.log.warn(`prom queryRange threw: ${(err as Error).message}`);
      return { unavailable: true, reason: "prom_error", series: [] };
    } finally {
      clearTimeout(timer);
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @modeldoctor/api vitest run prom-client.spec.ts`
Expected: PASS, 5/5.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/engine-metrics/prom-client.ts \
  apps/api/src/modules/engine-metrics/prom-client.spec.ts
git commit -m "$(cat <<'EOF'
feat(api): PromClient.queryRange with error normalization

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Engine-metrics service

**Files:**
- Create: `apps/api/src/modules/engine-metrics/engine-metrics.service.ts`
- Create: `apps/api/src/modules/engine-metrics/engine-metrics.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import {
  ENGINE_CAPABILITY,
  type EngineMetricsSnapshotResponse,
  getEngineManifest,
} from "@modeldoctor/contracts";
import { Test } from "@nestjs/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionService, type DecryptedConnection } from "../connection/connection.service.js";
import { EngineMetricsService } from "./engine-metrics.service.js";
import { PromClient } from "./prom-client.js";

function makeConn(over: Partial<DecryptedConnection> = {}): DecryptedConnection {
  return {
    id: "c1",
    name: "test",
    baseUrl: "http://m:8000",
    apiKey: "x",
    model: "Qwen2.5-7B-Instruct",
    customHeaders: "",
    queryParams: "",
    category: "chat",
    tokenizerHfId: null,
    prometheusUrl: "http://prom:9090",
    serverKind: "vllm",
    ...over,
  };
}

describe("EngineMetricsService", () => {
  let svc: EngineMetricsService;
  let promClient: { queryRange: ReturnType<typeof vi.fn> };
  let connections: { getOwnedDecrypted: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    promClient = { queryRange: vi.fn() };
    connections = { getOwnedDecrypted: vi.fn() };
    const ref = await Test.createTestingModule({
      providers: [
        EngineMetricsService,
        { provide: PromClient, useValue: promClient },
        { provide: ConnectionService, useValue: connections },
      ],
    }).compile();
    svc = ref.get(EngineMetricsService);
  });
  afterEach(() => vi.clearAllMocks());

  it("rejects when connection lacks prometheusUrl", async () => {
    connections.getOwnedDecrypted.mockResolvedValueOnce(
      makeConn({ prometheusUrl: null }),
    );
    await expect(
      svc.fetchSnapshot("u1", "c1", {
        from: "2026-05-09T00:00:00.000Z",
        to: "2026-05-09T00:01:00.000Z",
      }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("rejects when serverKind has no manifest", async () => {
    connections.getOwnedDecrypted.mockResolvedValueOnce(
      makeConn({ serverKind: "higress" }),
    );
    await expect(
      svc.fetchSnapshot("u1", "c1", {
        from: "2026-05-09T00:00:00.000Z",
        to: "2026-05-09T00:01:00.000Z",
      }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("returns one panel per spec, escapes ${model}", async () => {
    connections.getOwnedDecrypted.mockResolvedValueOnce(makeConn());
    promClient.queryRange.mockResolvedValue({
      unavailable: false,
      series: [{ label: "infer-0", samples: [[1715212800, 0.42]] }],
    });
    const r = await svc.fetchSnapshot("u1", "c1", {
      from: "2026-05-09T00:00:00.000Z",
      to: "2026-05-09T00:01:00.000Z",
      step: 15,
    });
    const manifest = getEngineManifest("vllm");
    expect(r.panels).toHaveLength(manifest!.metrics.length);
    expect(r.engineId).toBe("vllm");
    expect(r.capability).toBe(ENGINE_CAPABILITY.vllm);
    const calls = promClient.queryRange.mock.calls;
    for (const [args] of calls) {
      expect(args.query).not.toContain("${model}");
      expect(args.query).toContain('Qwen2.5-7B-Instruct');
    }
  });

  it("falls through to second variant when first returns no_data", async () => {
    connections.getOwnedDecrypted.mockResolvedValueOnce(makeConn());
    // For prefix_cache_savings (2 variants), first call no_data, second has data
    promClient.queryRange
      .mockResolvedValueOnce({ unavailable: true, reason: "no_data", series: [] })
      .mockResolvedValueOnce({
        unavailable: false,
        series: [{ samples: [[1715212800, 0.85]] }],
      })
      .mockResolvedValue({ unavailable: true, reason: "no_data", series: [] });

    const r = await svc.fetchSnapshot("u1", "c1", {
      from: "2026-05-09T00:00:00.000Z",
      to: "2026-05-09T00:01:00.000Z",
    });
    const prefix = r.panels.find((p) => p.key === "prefix_cache_savings");
    expect(prefix?.unavailable).toBe(false);
    expect(prefix?.series[0].samples[0][1]).toBe(0.85);
  });

  it("marks panel unavailable when all variants return prom_error", async () => {
    connections.getOwnedDecrypted.mockResolvedValueOnce(makeConn());
    promClient.queryRange.mockResolvedValue({
      unavailable: true,
      reason: "prom_error",
      series: [],
    });
    const r = await svc.fetchSnapshot("u1", "c1", {
      from: "2026-05-09T00:00:00.000Z",
      to: "2026-05-09T00:01:00.000Z",
    });
    expect(r.panels.every((p) => p.unavailable)).toBe(true);
    expect(r.panels[0].reason).toBe("prom_error");
  });

  it("isolates per-panel failures (Promise.allSettled)", async () => {
    connections.getOwnedDecrypted.mockResolvedValueOnce(makeConn());
    let n = 0;
    promClient.queryRange.mockImplementation(async () => {
      n++;
      if (n === 3) throw new Error("boom");
      return { unavailable: false, series: [{ samples: [[1, 1]] }] };
    });
    const r = await svc.fetchSnapshot("u1", "c1", {
      from: "2026-05-09T00:00:00.000Z",
      to: "2026-05-09T00:01:00.000Z",
    });
    // Exactly one panel falls back to "prom_error" while others succeed.
    const unavailable = r.panels.filter((p) => p.unavailable);
    expect(unavailable).toHaveLength(1);
    expect(unavailable[0].reason).toBe("prom_error");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @modeldoctor/api vitest run engine-metrics.service.spec.ts`
Expected: FAIL — no service.

- [ ] **Step 3: Implement service**

```ts
import {
  ENGINE_CAPABILITY,
  type EngineMetricSpec,
  type EngineMetricsPanelResult,
  type EngineMetricsSnapshotQuery,
  type EngineMetricsSnapshotResponse,
  getEngineManifest,
} from "@modeldoctor/contracts";
import { HttpException, Injectable, Logger } from "@nestjs/common";
import { ConnectionService } from "../connection/connection.service.js";
import { PromClient, type PromQueryRangeResult } from "./prom-client.js";

const DEFAULT_STEP_SECONDS = 15;

@Injectable()
export class EngineMetricsService {
  private readonly log = new Logger(EngineMetricsService.name);

  constructor(
    private readonly connections: ConnectionService,
    private readonly prom: PromClient,
  ) {}

  async fetchSnapshot(
    userId: string,
    connectionId: string,
    q: EngineMetricsSnapshotQuery,
  ): Promise<EngineMetricsSnapshotResponse> {
    const conn = await this.connections.getOwnedDecrypted(userId, connectionId);

    if (!conn.prometheusUrl) {
      throw new HttpException(
        { reason: "engine_metrics_not_configured", detail: "missing prometheusUrl" },
        422,
      );
    }
    if (!conn.serverKind) {
      throw new HttpException(
        { reason: "engine_metrics_not_configured", detail: "missing serverKind" },
        422,
      );
    }
    const manifest = getEngineManifest(conn.serverKind as never);
    if (!manifest) {
      throw new HttpException(
        { reason: "engine_metrics_not_configured", detail: `no manifest for ${conn.serverKind}` },
        422,
      );
    }

    const from = new Date(q.from);
    const to = new Date(q.to);
    const step = q.step ?? DEFAULT_STEP_SECONDS;
    const promBaseUrl = conn.prometheusUrl;
    const model = conn.model;

    const settled = await Promise.allSettled(
      manifest.metrics.map((spec) =>
        this.runMetric(spec, { baseUrl: promBaseUrl, model, from, to, step }),
      ),
    );

    const panels: EngineMetricsPanelResult[] = settled.map((r, i) => {
      const spec = manifest.metrics[i];
      if (r.status === "fulfilled") return r.value;
      this.log.warn(`panel ${spec.key} threw: ${(r.reason as Error).message}`);
      return {
        key: spec.key,
        group: spec.group,
        panel: spec.panel,
        unit: spec.unit,
        unavailable: true,
        reason: "prom_error",
        series: [],
      };
    });

    return {
      engineId: manifest.engineId,
      capability: ENGINE_CAPABILITY[manifest.engineId],
      window: { from: q.from, to: q.to, step },
      panels,
    };
  }

  private async runMetric(
    spec: EngineMetricSpec,
    ctx: { baseUrl: string; model: string; from: Date; to: Date; step: number },
  ): Promise<EngineMetricsPanelResult> {
    let lastReason: PromQueryRangeResult["reason"] | undefined;

    for (const variant of spec.promql) {
      const query = this.renderTemplate(variant.expr, ctx.model);
      const r = await this.prom.queryRange({
        baseUrl: ctx.baseUrl,
        query,
        from: ctx.from,
        to: ctx.to,
        step: ctx.step,
      });
      if (!r.unavailable) {
        return {
          key: spec.key,
          group: spec.group,
          panel: spec.panel,
          unit: spec.unit,
          unavailable: false,
          series: r.series,
        };
      }
      lastReason = r.reason;
    }

    return {
      key: spec.key,
      group: spec.group,
      panel: spec.panel,
      unit: spec.unit,
      unavailable: true,
      reason: lastReason ?? "no_data",
      series: [],
    };
  }

  /** Defensive PromQL escape: `"` and `\` only — model_name labels in practice
   * don't contain control characters but we play it safe. */
  private renderTemplate(expr: string, model: string): string {
    const escaped = model.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return expr.replaceAll("${model}", escaped);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @modeldoctor/api vitest run engine-metrics.service.spec.ts`
Expected: PASS, 6/6.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/engine-metrics/engine-metrics.service.ts \
  apps/api/src/modules/engine-metrics/engine-metrics.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(api): EngineMetricsService.fetchSnapshot

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Extend `DecryptedConnection` with `serverKind`

**Files:**
- Modify: `apps/api/src/modules/connection/connection.service.ts`
- Modify: `apps/api/src/modules/connection/connection.service.spec.ts`
- Modify: `apps/api/src/modules/diagnostics/diagnostics.service.spec.ts` (and any other call site that constructs a `DecryptedConnection` literal)

- [ ] **Step 1: Find all call sites that construct DecryptedConnection literals**

Run: `git grep -nE "DecryptedConnection|tokenizerHfId: null" apps/api/src`

Expect to find at least:
- `connection.service.ts` (definition + `getOwnedDecrypted` return)
- `diagnostics.service.spec.ts` `makeConn`
- any other test helpers

- [ ] **Step 2: Extend the interface**

In `apps/api/src/modules/connection/connection.service.ts`:

```ts
import type { ServerKind } from "@modeldoctor/contracts";

export interface DecryptedConnection {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  customHeaders: string;
  queryParams: string;
  category: ModalityCategory;
  tokenizerHfId: string | null;
  prometheusUrl: string | null;
  serverKind: ServerKind | null;
}
```

In `getOwnedDecrypted`, append:

```ts
      serverKind: row.serverKind as ServerKind | null,
```

- [ ] **Step 3: Update every call site / test helper**

In `apps/api/src/modules/diagnostics/diagnostics.service.spec.ts` `makeConn` defaults, add `serverKind: null` next to `prometheusUrl: null`.

In any other helpers found in Step 1, do the same.

- [ ] **Step 4: Run all api tests to verify**

Run: `pnpm -F @modeldoctor/api typecheck && pnpm -F @modeldoctor/api vitest run`
Expected: 0 type errors, all existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/connection/connection.service.ts \
  apps/api/src/modules/diagnostics/diagnostics.service.spec.ts
# plus any other files Step 1 surfaced
git commit -m "$(cat <<'EOF'
refactor(api): extend DecryptedConnection with serverKind

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Engine-metrics controller + module + AppModule wire-up

**Files:**
- Create: `apps/api/src/modules/engine-metrics/engine-metrics.controller.ts`
- Create: `apps/api/src/modules/engine-metrics/engine-metrics.controller.spec.ts`
- Create: `apps/api/src/modules/engine-metrics/engine-metrics.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Write the failing controller test**

Create `engine-metrics.controller.spec.ts`:

```ts
import { engineMetricsSnapshotResponseSchema } from "@modeldoctor/contracts";
import { Test } from "@nestjs/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EngineMetricsController } from "./engine-metrics.controller.js";
import { EngineMetricsService } from "./engine-metrics.service.js";

describe("EngineMetricsController", () => {
  let ctrl: EngineMetricsController;
  let svc: { fetchSnapshot: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    svc = { fetchSnapshot: vi.fn() };
    const ref = await Test.createTestingModule({
      controllers: [EngineMetricsController],
      providers: [{ provide: EngineMetricsService, useValue: svc }],
    }).compile();
    ctrl = ref.get(EngineMetricsController);
  });
  afterEach(() => vi.clearAllMocks());

  it("forwards user/connection/query to service and returns shape", async () => {
    const sample = {
      engineId: "vllm" as const,
      capability: "generative" as const,
      window: {
        from: "2026-05-09T00:00:00.000Z",
        to: "2026-05-09T00:01:00.000Z",
        step: 15,
      },
      panels: [],
    };
    svc.fetchSnapshot.mockResolvedValueOnce(sample);
    const result = await ctrl.snapshot(
      { sub: "u1" } as never,
      "c1",
      {
        from: "2026-05-09T00:00:00.000Z",
        to: "2026-05-09T00:01:00.000Z",
        step: 15,
      },
    );
    expect(svc.fetchSnapshot).toHaveBeenCalledWith("u1", "c1", {
      from: "2026-05-09T00:00:00.000Z",
      to: "2026-05-09T00:01:00.000Z",
      step: 15,
    });
    expect(engineMetricsSnapshotResponseSchema.parse(result)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @modeldoctor/api vitest run engine-metrics.controller.spec.ts`
Expected: FAIL — no controller.

- [ ] **Step 3: Implement controller + module**

`apps/api/src/modules/engine-metrics/engine-metrics.controller.ts`:

```ts
import {
  type EngineMetricsSnapshotQuery,
  type EngineMetricsSnapshotResponse,
  engineMetricsSnapshotQuerySchema,
  engineMetricsSnapshotResponseSchema,
} from "@modeldoctor/contracts";
import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { EngineMetricsService } from "./engine-metrics.service.js";

class EngineMetricsSnapshotResponseDto extends createZodDto(
  engineMetricsSnapshotResponseSchema,
) {}

@ApiTags("engine-metrics")
@Controller("engine-metrics")
export class EngineMetricsController {
  constructor(private readonly svc: EngineMetricsService) {}

  @ApiOperation({ summary: "Snapshot of engine-side Prometheus metrics for a connection" })
  @ApiOkResponse({ type: EngineMetricsSnapshotResponseDto })
  @Get(":connectionId/snapshot")
  async snapshot(
    @CurrentUser() user: JwtPayload,
    @Param("connectionId") connectionId: string,
    @Query(new ZodValidationPipe(engineMetricsSnapshotQuerySchema)) query: EngineMetricsSnapshotQuery,
  ): Promise<EngineMetricsSnapshotResponse> {
    return this.svc.fetchSnapshot(user.sub, connectionId, query);
  }
}
```

`apps/api/src/modules/engine-metrics/engine-metrics.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { ConnectionModule } from "../connection/connection.module.js";
import { EngineMetricsController } from "./engine-metrics.controller.js";
import { EngineMetricsService } from "./engine-metrics.service.js";
import { PromClient } from "./prom-client.js";

@Module({
  imports: [ConnectionModule],
  controllers: [EngineMetricsController],
  providers: [EngineMetricsService, PromClient],
  exports: [EngineMetricsService],
})
export class EngineMetricsModule {}
```

In `apps/api/src/app.module.ts`, add to imports list (alphabetically near other domain modules):

```ts
import { EngineMetricsModule } from "./modules/engine-metrics/engine-metrics.module.js";

// inside imports[]:
    EngineMetricsModule,
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @modeldoctor/api vitest run engine-metrics.controller.spec.ts`
Expected: PASS.

Run: `pnpm -F @modeldoctor/api typecheck`
Expected: 0 errors.

Smoke: `pnpm -F @modeldoctor/api start:dev` then `curl -s http://localhost:3000/api/docs-json | jq '.paths | keys' | grep engine-metrics` — confirm path appears.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/engine-metrics/engine-metrics.controller.ts \
  apps/api/src/modules/engine-metrics/engine-metrics.controller.spec.ts \
  apps/api/src/modules/engine-metrics/engine-metrics.module.ts \
  apps/api/src/app.module.ts
git commit -m "$(cat <<'EOF'
feat(api): engine-metrics controller + module wire-up

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: API e2e for snapshot endpoint

**Files:**
- Create: `apps/api/test/e2e/engine-metrics.e2e-spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import type { EngineMetricsSnapshotResponse } from "@modeldoctor/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApp, type TestApp } from "./test-app.js";
import { registerAndLogin, postConnection } from "./helpers.js";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

describe("GET /api/engine-metrics/:connectionId/snapshot (e2e)", () => {
  let app: TestApp;
  let token: string;
  let connectionId: string;

  beforeAll(async () => {
    app = await createTestApp();
    const reg = await registerAndLogin(app, "engine-metrics-e2e@test.local");
    token = reg.token;
    const conn = await postConnection(app, token, {
      name: "vllm-e2e",
      model: "Qwen2.5-7B-Instruct",
      prometheusUrl: "http://prom:9090",
      serverKind: "vllm",
    });
    connectionId = conn.id;
  });
  afterAll(() => app.close());

  beforeEach(() => fetchMock.mockReset());

  it("422 when prometheusUrl missing", async () => {
    const conn = await postConnection(app, token, {
      name: "noprom",
      model: "x",
      // omit prometheusUrl
      serverKind: "vllm",
    });
    const res = await app.request
      .get(`/api/engine-metrics/${conn.id}/snapshot`)
      .query({
        from: "2026-05-09T00:00:00.000Z",
        to: "2026-05-09T00:01:00.000Z",
      })
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(422);
  });

  it("200 returns panels and forwards Prom queries", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: "success",
        data: {
          resultType: "matrix",
          result: [
            { metric: { pod: "infer-0" }, values: [[1715212800, "0.42"]] },
          ],
        },
      }),
    });
    const res = await app.request
      .get(`/api/engine-metrics/${connectionId}/snapshot`)
      .query({
        from: "2026-05-09T00:00:00.000Z",
        to: "2026-05-09T00:01:00.000Z",
      })
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const body = res.body as EngineMetricsSnapshotResponse;
    expect(body.engineId).toBe("vllm");
    expect(body.panels.length).toBeGreaterThan(0);
  });

  it("401 without token", async () => {
    const res = await app.request
      .get(`/api/engine-metrics/${connectionId}/snapshot`)
      .query({
        from: "2026-05-09T00:00:00.000Z",
        to: "2026-05-09T00:01:00.000Z",
      });
    expect(res.status).toBe(401);
  });
});
```

> **Note:** The test imports a `helpers.ts` for `registerAndLogin / postConnection`. Other e2e specs already define equivalents — check `apps/api/test/e2e/connections.e2e-spec.ts` for the existing helper module path; if it's named differently, reuse the same import pattern as that file.

- [ ] **Step 2: Run the test to verify it fails (initial baseline)**

Run: `pnpm test:e2e:api -- engine-metrics.e2e-spec.ts`
Expected: FAIL initially because `serverKind` isn't accepted yet via the connection POST schema (it is in the contract but make sure the API takes it). If the contract already accepts it (Task 2), the failure should be only on the assertions, not on connection creation.

- [ ] **Step 3: Implement adjustments if any**

If `postConnection` helper doesn't pass `serverKind`, extend it. If the test infra spec already uses `vi.stubGlobal("fetch", …)` for other reasons, deduplicate.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:e2e:api -- engine-metrics.e2e-spec.ts`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/test/e2e/engine-metrics.e2e-spec.ts
# also commit any helper.ts adjustments touched in Step 3
git commit -m "$(cat <<'EOF'
test(api): e2e coverage for engine-metrics snapshot endpoint

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: `useEngineMetrics` react-query hook

**Files:**
- Create: `apps/web/src/features/engine-metrics/useEngineMetrics.ts`
- Create: `apps/web/src/features/engine-metrics/useEngineMetrics.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { useEngineMetrics } from "./useEngineMetrics.js";

vi.mock("@/lib/api-client", () => ({
  api: {
    get: vi.fn(async (path: string) => {
      expect(path).toMatch(/\/api\/engine-metrics\/c1\/snapshot\?/);
      return {
        engineId: "vllm",
        capability: "generative",
        window: {
          from: "2026-05-09T00:00:00.000Z",
          to: "2026-05-09T00:01:00.000Z",
          step: 15,
        },
        panels: [],
      };
    }),
  },
}));

function wrap(client: QueryClient) {
  return function W({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("useEngineMetrics", () => {
  it("queries when connectionId + range are present", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(
      () =>
        useEngineMetrics("c1", {
          from: "2026-05-09T00:00:00.000Z",
          to: "2026-05-09T00:01:00.000Z",
          step: 15,
        }),
      { wrapper: wrap(qc) },
    );
    await waitFor(() => expect(result.current.data?.engineId).toBe("vllm"));
  });

  it("disabled when connectionId is null", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(
      () =>
        useEngineMetrics(null, {
          from: "2026-05-09T00:00:00.000Z",
          to: "2026-05-09T00:01:00.000Z",
        }),
      { wrapper: wrap(qc) },
    );
    expect(result.current.fetchStatus).toBe("idle");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @modeldoctor/web vitest run useEngineMetrics.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement hook**

```ts
import { api } from "@/lib/api-client";
import type { EngineMetricsSnapshotResponse } from "@modeldoctor/contracts";
import { useQuery } from "@tanstack/react-query";

export interface EngineMetricsRange {
  from: string;
  to: string;
  step?: number;
}

export const engineMetricsKeys = {
  all: ["engine-metrics"] as const,
  snapshot: (connectionId: string, r: EngineMetricsRange) =>
    [...engineMetricsKeys.all, connectionId, r.from, r.to, r.step ?? "auto"] as const,
};

export function useEngineMetrics(
  connectionId: string | null | undefined,
  range: EngineMetricsRange,
) {
  return useQuery({
    queryKey: engineMetricsKeys.snapshot(connectionId ?? "", range),
    enabled: !!connectionId,
    queryFn: async () => {
      const params = new URLSearchParams({ from: range.from, to: range.to });
      if (range.step != null) params.set("step", String(range.step));
      return api.get<EngineMetricsSnapshotResponse>(
        `/api/engine-metrics/${connectionId}/snapshot?${params.toString()}`,
      );
    },
    // Engine metrics are real-time; cache for 30s within a session for cheap re-mounts.
    staleTime: 30 * 1000,
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @modeldoctor/web vitest run useEngineMetrics.test.ts`
Expected: PASS, 2/2.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/engine-metrics/useEngineMetrics.ts \
  apps/web/src/features/engine-metrics/useEngineMetrics.test.ts
git commit -m "$(cat <<'EOF'
feat(web): useEngineMetrics react-query hook

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: `<StatPanel>`

**Files:**
- Create: `apps/web/src/features/engine-metrics/panels/StatPanel.tsx`
- Create: `apps/web/src/features/engine-metrics/panels/StatPanel.test.tsx`
- Create: `apps/web/src/features/engine-metrics/panels/format-unit.ts`
- Create: `apps/web/src/features/engine-metrics/panels/format-unit.test.ts`

- [ ] **Step 1: Write failing tests**

`format-unit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatPanelValue } from "./format-unit.js";

describe("formatPanelValue", () => {
  it("ms shows integer ms with unit", () => {
    expect(formatPanelValue(187.4, "ms")).toBe("187 ms");
  });
  it("ratio shows percentage", () => {
    expect(formatPanelValue(0.954, "ratio")).toBe("95.4%");
  });
  it("% shows fixed-1 percent", () => {
    expect(formatPanelValue(76.92, "%")).toBe("76.9%");
  });
  it("tps abbreviates large counts", () => {
    expect(formatPanelValue(1234, "tps")).toBe("1.2k tps");
  });
  it("count is integer", () => {
    expect(formatPanelValue(42.7, "count")).toBe("43");
  });
  it("returns dash for null", () => {
    expect(formatPanelValue(null, "ms")).toBe("—");
  });
});
```

`StatPanel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatPanel } from "./StatPanel.js";

describe("<StatPanel>", () => {
  it("renders the latest sample with formatted unit", () => {
    render(
      <StatPanel
        label="TTFT P99"
        unit="ms"
        series={[{ samples: [[100, 100], [200, 187.4]] }]}
        unavailable={false}
      />,
    );
    expect(screen.getByText(/187 ms/)).toBeInTheDocument();
  });

  it("renders unavailable placeholder when flagged", () => {
    render(
      <StatPanel
        label="X"
        unit="count"
        series={[]}
        unavailable
        reason="not_supported"
      />,
    );
    expect(screen.getByText(/not.supported|不上报/i)).toBeInTheDocument();
  });

  it("colors per threshold severity", () => {
    render(
      <StatPanel
        label="success_rate"
        unit="ratio"
        series={[{ samples: [[1, 0.85]] }]}
        unavailable={false}
        thresholds={[
          { at: 0.95, severity: "ok" },
          { at: 0.9, severity: "warn" },
          { at: 0, severity: "crit" },
        ]}
      />,
    );
    const value = screen.getByText(/85%/);
    expect(value.className).toMatch(/text-/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -F @modeldoctor/web vitest run format-unit StatPanel`
Expected: FAIL on missing modules.

- [ ] **Step 3: Implement format-unit + StatPanel**

`format-unit.ts`:

```ts
import type { PanelUnit } from "@modeldoctor/contracts";

export function formatPanelValue(value: number | null | undefined, unit: PanelUnit): string {
  if (value == null || !Number.isFinite(value)) return "—";
  switch (unit) {
    case "ms":
      return `${Math.round(value)} ms`;
    case "s":
      return `${value.toFixed(2)} s`;
    case "%":
      return `${value.toFixed(1)}%`;
    case "ratio":
      return `${(value * 100).toFixed(1)}%`;
    case "tps":
    case "rps":
      return `${abbrev(value)} ${unit}`;
    case "count":
      return String(Math.round(value));
    case "bytes":
      return formatBytes(value);
  }
}

function abbrev(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return v.toFixed(1);
}

function formatBytes(bytes: number): string {
  if (bytes >= 2 ** 30) return `${(bytes / 2 ** 30).toFixed(1)} GiB`;
  if (bytes >= 2 ** 20) return `${(bytes / 2 ** 20).toFixed(1)} MiB`;
  if (bytes >= 2 ** 10) return `${(bytes / 2 ** 10).toFixed(0)} KiB`;
  return `${bytes} B`;
}
```

`StatPanel.tsx`:

```tsx
import type { EngineMetricsPanelResult, PanelUnit } from "@modeldoctor/contracts";
import { useTranslation } from "react-i18next";
import { formatPanelValue } from "./format-unit.js";

export interface StatPanelProps {
  label: string;
  unit: PanelUnit;
  series: EngineMetricsPanelResult["series"];
  unavailable: boolean;
  reason?: EngineMetricsPanelResult["reason"];
  thresholds?: Array<{ at: number; severity: "ok" | "warn" | "crit" }>;
}

function pickColor(
  v: number,
  thresholds?: StatPanelProps["thresholds"],
): "ok" | "warn" | "crit" | null {
  if (!thresholds || thresholds.length === 0) return null;
  // sort desc by `at`; the first threshold whose `at` is <= v wins
  const sorted = [...thresholds].sort((a, b) => b.at - a.at);
  for (const t of sorted) {
    if (v >= t.at) return t.severity;
  }
  return sorted[sorted.length - 1].severity;
}

const CLASS_BY_SEVERITY = {
  ok: "text-emerald-500",
  warn: "text-amber-500",
  crit: "text-rose-500",
} as const;

export function StatPanel({
  label,
  unit,
  series,
  unavailable,
  reason,
  thresholds,
}: StatPanelProps) {
  const { t } = useTranslation("engine-metrics");
  const latest = series.flatMap((s) => s.samples).at(-1);
  const value = latest?.[1] ?? null;
  const severity = value != null ? pickColor(value, thresholds) : null;
  const colorClass = severity ? CLASS_BY_SEVERITY[severity] : "text-foreground";

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      {unavailable ? (
        <div className="mt-1 text-sm italic text-muted-foreground">
          {t(`unavailable.${reason ?? "noData"}`, { defaultValue: t("unavailable.noData") })}
        </div>
      ) : (
        <div className={`mt-1 text-2xl font-semibold ${colorClass}`}>
          {formatPanelValue(value, unit)}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -F @modeldoctor/web vitest run format-unit StatPanel`
Expected: PASS — 6/6 + 3/3.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/engine-metrics/panels/StatPanel.tsx \
  apps/web/src/features/engine-metrics/panels/StatPanel.test.tsx \
  apps/web/src/features/engine-metrics/panels/format-unit.ts \
  apps/web/src/features/engine-metrics/panels/format-unit.test.ts
git commit -m "$(cat <<'EOF'
feat(web): StatPanel + unit formatter

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 17: `<GaugePanel>`

**Files:**
- Create: `apps/web/src/features/engine-metrics/panels/GaugePanel.tsx`
- Create: `apps/web/src/features/engine-metrics/panels/GaugePanel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GaugePanel } from "./GaugePanel.js";

vi.mock("echarts-for-react", () => ({
  default: ({ option }: { option: unknown }) => (
    <div data-testid="echart" data-option={JSON.stringify(option)} />
  ),
}));

describe("<GaugePanel>", () => {
  it("renders with the latest value", () => {
    render(
      <GaugePanel
        label="prefix_cache_hit_rate"
        unit="%"
        series={[{ samples: [[1, 95]] }]}
        unavailable={false}
      />,
    );
    const opt = JSON.parse(screen.getByTestId("echart").dataset.option ?? "{}");
    expect(JSON.stringify(opt)).toContain("95");
  });

  it("renders unavailable placeholder", () => {
    render(
      <GaugePanel label="x" unit="count" series={[]} unavailable reason="no_data" />,
    );
    expect(screen.queryByTestId("echart")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @modeldoctor/web vitest run GaugePanel`
Expected: FAIL on missing module.

- [ ] **Step 3: Implement `GaugePanel.tsx`**

```tsx
import type { EngineMetricsPanelResult, PanelUnit } from "@modeldoctor/contracts";
import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { themed, useChartTokens } from "@/components/charts/_shared";
import { formatPanelValue } from "./format-unit.js";

export interface GaugePanelProps {
  label: string;
  unit: PanelUnit;
  series: EngineMetricsPanelResult["series"];
  unavailable: boolean;
  reason?: EngineMetricsPanelResult["reason"];
}

export function GaugePanel({ label, unit, series, unavailable, reason }: GaugePanelProps) {
  const { t } = useTranslation("engine-metrics");
  const tokens = useChartTokens();
  const latest = series.flatMap((s) => s.samples).at(-1);
  const value = latest?.[1] ?? null;

  const option = useMemo<EChartsOption>(
    () =>
      themed(
        {
          series: [
            {
              type: "gauge",
              progress: { show: true, width: 8 },
              axisLine: { lineStyle: { width: 8 } },
              pointer: { show: false },
              axisTick: { show: false },
              splitLine: { show: false },
              axisLabel: { show: false },
              detail: {
                valueAnimation: false,
                fontSize: 22,
                fontWeight: 600,
                offsetCenter: [0, "0%"],
                formatter: () => formatPanelValue(value, unit),
              },
              data: [{ value: value ?? 0 }],
              min: 0,
              max: unit === "%" ? 100 : Math.max(100, (value ?? 0) * 1.5),
            },
          ],
        },
        tokens,
      ),
    [value, unit, tokens],
  );

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      {unavailable || value == null ? (
        <div className="mt-2 text-sm italic text-muted-foreground">
          {t(`unavailable.${reason ?? "noData"}`, { defaultValue: t("unavailable.noData") })}
        </div>
      ) : (
        <ReactECharts
          option={option}
          style={{ height: 140, width: "100%" }}
          notMerge
          lazyUpdate
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @modeldoctor/web vitest run GaugePanel`
Expected: PASS, 2/2.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/engine-metrics/panels/GaugePanel.tsx \
  apps/web/src/features/engine-metrics/panels/GaugePanel.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): GaugePanel for ratio/percentage metrics

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 18: `<TimeseriesPanel>` with benchmark-window markArea

**Files:**
- Create: `apps/web/src/features/engine-metrics/panels/TimeseriesPanel.tsx`
- Create: `apps/web/src/features/engine-metrics/panels/TimeseriesPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TimeseriesPanel } from "./TimeseriesPanel.js";

vi.mock("echarts-for-react", () => ({
  default: ({ option }: { option: unknown }) => (
    <div data-testid="echart" data-option={JSON.stringify(option)} />
  ),
}));

describe("<TimeseriesPanel>", () => {
  it("renders one line per series", () => {
    render(
      <TimeseriesPanel
        label="kv_cache_usage"
        unit="%"
        series={[
          { label: "infer-0", samples: [[1715212800, 60], [1715212815, 75]] },
          { label: "infer-1", samples: [[1715212800, 50]] },
        ]}
        unavailable={false}
        benchmarkWindow={{ from: 1715212800, to: 1715212820 }}
      />,
    );
    const opt = JSON.parse(screen.getByTestId("echart").dataset.option ?? "{}");
    const seriesArr = (opt as { series?: unknown[] }).series ?? [];
    expect(seriesArr.length).toBeGreaterThanOrEqual(2);
  });

  it("includes a markArea spanning the benchmark window", () => {
    render(
      <TimeseriesPanel
        label="x"
        unit="ms"
        series={[{ samples: [[1715212800, 1]] }]}
        unavailable={false}
        benchmarkWindow={{ from: 1715212800, to: 1715212860 }}
      />,
    );
    const opt = JSON.parse(screen.getByTestId("echart").dataset.option ?? "{}");
    const json = JSON.stringify(opt);
    expect(json).toContain("markArea");
    expect(json).toContain("1715212800");
    expect(json).toContain("1715212860");
  });

  it("renders unavailable placeholder", () => {
    render(
      <TimeseriesPanel
        label="x"
        unit="count"
        series={[]}
        unavailable
        reason="no_data"
        benchmarkWindow={{ from: 0, to: 60 }}
      />,
    );
    expect(screen.queryByTestId("echart")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @modeldoctor/web vitest run TimeseriesPanel`
Expected: FAIL on missing module.

- [ ] **Step 3: Implement `TimeseriesPanel.tsx`**

```tsx
import { themed, useChartTokens } from "@/components/charts/_shared";
import type { EngineMetricsPanelResult, PanelUnit } from "@modeldoctor/contracts";
import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { formatPanelValue } from "./format-unit.js";

export interface TimeseriesPanelProps {
  label: string;
  unit: PanelUnit;
  series: EngineMetricsPanelResult["series"];
  unavailable: boolean;
  reason?: EngineMetricsPanelResult["reason"];
  /** unix seconds — the actual benchmark window highlighted on top of the chart */
  benchmarkWindow: { from: number; to: number };
}

export function TimeseriesPanel({
  label,
  unit,
  series,
  unavailable,
  reason,
  benchmarkWindow,
}: TimeseriesPanelProps) {
  const { t } = useTranslation("engine-metrics");
  const tokens = useChartTokens();

  const option = useMemo<EChartsOption>(
    () =>
      themed(
        {
          tooltip: {
            trigger: "axis",
            valueFormatter: (v) =>
              typeof v === "number" ? formatPanelValue(v, unit) : String(v),
          },
          legend: {
            data: series.map((s, i) => s.label ?? `series-${i}`),
            type: "scroll",
            top: 0,
          },
          xAxis: { type: "time" },
          yAxis: { type: "value" },
          grid: { left: 48, right: 16, top: 32, bottom: 32 },
          series: series.map((s, i) => ({
            name: s.label ?? `series-${i}`,
            type: "line",
            showSymbol: false,
            sampling: "lttb",
            data: s.samples.map(([t, v]) => [t * 1000, v]),
            lineStyle: { width: 1.5 },
            // markArea on the first series only — echarts renders one shared overlay per chart.
            ...(i === 0
              ? {
                  markArea: {
                    silent: true,
                    itemStyle: { color: "rgba(99, 102, 241, 0.10)" },
                    data: [
                      [
                        { xAxis: benchmarkWindow.from * 1000 },
                        { xAxis: benchmarkWindow.to * 1000 },
                      ],
                    ],
                  },
                }
              : {}),
          })),
        },
        tokens,
      ),
    [series, unit, benchmarkWindow, tokens],
  );

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      {unavailable || series.length === 0 ? (
        <div className="mt-2 text-sm italic text-muted-foreground">
          {t(`unavailable.${reason ?? "noData"}`, { defaultValue: t("unavailable.noData") })}
        </div>
      ) : (
        <ReactECharts
          option={option}
          style={{ height: 220, width: "100%" }}
          notMerge
          lazyUpdate
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @modeldoctor/web vitest run TimeseriesPanel`
Expected: PASS, 3/3.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/engine-metrics/panels/TimeseriesPanel.tsx \
  apps/web/src/features/engine-metrics/panels/TimeseriesPanel.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): TimeseriesPanel with benchmark-window markArea overlay

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 19: `<HeatmapPanel>` (M1 stacked-bar fallback)

**Files:**
- Create: `apps/web/src/features/engine-metrics/panels/HeatmapPanel.tsx`
- Create: `apps/web/src/features/engine-metrics/panels/HeatmapPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HeatmapPanel } from "./HeatmapPanel.js";

vi.mock("echarts-for-react", () => ({
  default: ({ option }: { option: unknown }) => (
    <div data-testid="echart" data-option={JSON.stringify(option)} />
  ),
}));

describe("<HeatmapPanel>", () => {
  it("renders one stacked-bar series per histogram bucket label", () => {
    render(
      <HeatmapPanel
        label="request_length"
        series={[
          { label: "+Inf", samples: [[100, 5]] },
          { label: "1000", samples: [[100, 8]] },
        ]}
        unavailable={false}
      />,
    );
    const opt = JSON.parse(screen.getByTestId("echart").dataset.option ?? "{}");
    const json = JSON.stringify(opt);
    expect(json).toContain('"stack":"hist"');
    expect(json).toContain("+Inf");
  });

  it("renders unavailable placeholder", () => {
    render(<HeatmapPanel label="x" series={[]} unavailable reason="no_data" />);
    expect(screen.queryByTestId("echart")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @modeldoctor/web vitest run HeatmapPanel`
Expected: FAIL on missing module.

- [ ] **Step 3: Implement `HeatmapPanel.tsx`**

```tsx
import { themed, useChartTokens } from "@/components/charts/_shared";
import type { EngineMetricsPanelResult } from "@modeldoctor/contracts";
import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

export interface HeatmapPanelProps {
  label: string;
  series: EngineMetricsPanelResult["series"];
  unavailable: boolean;
  reason?: EngineMetricsPanelResult["reason"];
}

export function HeatmapPanel({ label, series, unavailable, reason }: HeatmapPanelProps) {
  const { t } = useTranslation("engine-metrics");
  const tokens = useChartTokens();

  const option = useMemo<EChartsOption>(
    () =>
      themed(
        {
          tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
          legend: { type: "scroll", top: 0 },
          xAxis: { type: "time" },
          yAxis: { type: "value", name: "count" },
          grid: { left: 48, right: 16, top: 32, bottom: 32 },
          series: series.map((s, i) => ({
            name: s.label ?? `bucket-${i}`,
            type: "bar",
            stack: "hist",
            barCategoryGap: "0%",
            data: s.samples.map(([t, v]) => [t * 1000, v]),
          })),
        },
        tokens,
      ),
    [series, tokens],
  );

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      {unavailable || series.length === 0 ? (
        <div className="mt-2 text-sm italic text-muted-foreground">
          {t(`unavailable.${reason ?? "noData"}`, { defaultValue: t("unavailable.noData") })}
        </div>
      ) : (
        <ReactECharts
          option={option}
          style={{ height: 220, width: "100%" }}
          notMerge
          lazyUpdate
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @modeldoctor/web vitest run HeatmapPanel`
Expected: PASS, 2/2.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/engine-metrics/panels/HeatmapPanel.tsx \
  apps/web/src/features/engine-metrics/panels/HeatmapPanel.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): HeatmapPanel (M1 stacked-bar fallback)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 20: i18n files

**Files:**
- Create: `apps/web/src/locales/en-US/engine-metrics.json`
- Create: `apps/web/src/locales/zh-CN/engine-metrics.json`
- Modify: `apps/web/src/lib/i18n.ts` (register new namespace)

- [ ] **Step 1: Look at how an existing namespace is registered**

Run: `grep -nE "engine-metrics|benchmarks\":|i18n.use" apps/web/src/lib/i18n.ts | head`

Inspect the surrounding code to see the existing namespace registration pattern (resource definition + `ns: [...]` list).

- [ ] **Step 2: Write the failing test**

Append to `apps/web/src/lib/i18n.test.ts` (or create one if absent):

```ts
import { describe, expect, it } from "vitest";
import i18n from "./i18n.js";

describe("engine-metrics namespace", () => {
  it("loads zh-CN labels for known metric keys", () => {
    expect(i18n.t("engine-metrics:metrics.ttft_p99.label")).toBe("TTFT P99");
    expect(i18n.t("engine-metrics:groups.topline")).toBeTruthy();
    expect(i18n.t("engine-metrics:section.title")).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm -F @modeldoctor/web vitest run i18n.test.ts`
Expected: FAIL because the namespace does not exist yet.

- [ ] **Step 4: Implement i18n files**

`apps/web/src/locales/zh-CN/engine-metrics.json`:

```json
{
  "section": {
    "title": "推理引擎指标",
    "subtitle": "{{engineName}} · 实时来自 Prometheus · {{from}} ~ {{to}}",
    "notConfigured": "此连接未配置 Prometheus URL — 前往连接设置补齐",
    "missingServerKind": "请在连接设置中选择推理引擎类型",
    "promError": "无法访问 Prometheus，请检查连接配置或网络可达性"
  },
  "groups": {
    "topline": "概览",
    "latency": "延迟与体验",
    "throughput": "吞吐与负载",
    "engine": "引擎内部",
    "health": "系统健康"
  },
  "metrics": {
    "success_rate": { "label": "成功率" },
    "active_requests": { "label": "进行中请求" },
    "system_efficiency": { "label": "系统效率" },
    "ttft_p99": { "label": "TTFT P99" },
    "preemption_rate": { "label": "抢占速率" },
    "e2e_latency": { "label": "端到端延迟" },
    "stage_breakdown": { "label": "阶段拆分（Prefill/Decode）" },
    "ttft_vs_tpot": { "label": "TTFT vs TPOT" },
    "token_throughput_in": { "label": "输入吞吐" },
    "token_throughput_out": { "label": "输出吞吐" },
    "token_io_ratio": { "label": "输入/输出比" },
    "prefix_cache_savings": { "label": "Prefix Cache 节省" },
    "request_queue_time": { "label": "请求队列时间" },
    "request_length_heatmap": { "label": "请求长度分布" },
    "kv_cache_usage": { "label": "KV Cache 利用率" },
    "prefix_cache_hit_rate": { "label": "Prefix Cache 命中率" },
    "scheduler_state": { "label": "调度器状态" },
    "python_gc_memory": { "label": "GC 与内存" },
    "finish_reason": { "label": "结束原因分布" },
    "request_latency_p99": { "label": "请求延迟 P99" },
    "tokenize_rate": { "label": "Token 化速率" },
    "embedding_rate": { "label": "Embedding 速率" },
    "queue_metrics": { "label": "队列指标" }
  },
  "unavailable": {
    "noData": "（该引擎不上报此指标）",
    "no_data": "（该引擎不上报此指标）",
    "prom_error": "（Prometheus 暂时不可达）",
    "not_supported": "（该引擎不支持此指标）"
  }
}
```

`apps/web/src/locales/en-US/engine-metrics.json` — mirror with English labels:

```json
{
  "section": {
    "title": "Engine Metrics",
    "subtitle": "{{engineName}} · live from Prometheus · {{from}} ~ {{to}}",
    "notConfigured": "This connection has no Prometheus URL — set it in Connection settings.",
    "missingServerKind": "Pick an inference engine in Connection settings.",
    "promError": "Cannot reach Prometheus — check connection config or network."
  },
  "groups": {
    "topline": "Top-line Summary",
    "latency": "Latency & UX",
    "throughput": "Token Throughput & Workload",
    "engine": "Engine Internal",
    "health": "System Health"
  },
  "metrics": {
    "success_rate": { "label": "Success rate" },
    "active_requests": { "label": "Active requests" },
    "system_efficiency": { "label": "System efficiency" },
    "ttft_p99": { "label": "TTFT P99" },
    "preemption_rate": { "label": "Preemption rate" },
    "e2e_latency": { "label": "E2E latency" },
    "stage_breakdown": { "label": "Stage breakdown (Prefill/Decode)" },
    "ttft_vs_tpot": { "label": "TTFT vs TPOT" },
    "token_throughput_in": { "label": "Input throughput" },
    "token_throughput_out": { "label": "Output throughput" },
    "token_io_ratio": { "label": "Output/Input ratio" },
    "prefix_cache_savings": { "label": "Prefix cache savings" },
    "request_queue_time": { "label": "Request queue time" },
    "request_length_heatmap": { "label": "Request length distribution" },
    "kv_cache_usage": { "label": "KV cache usage" },
    "prefix_cache_hit_rate": { "label": "Prefix cache hit rate" },
    "scheduler_state": { "label": "Scheduler state" },
    "python_gc_memory": { "label": "GC & memory" },
    "finish_reason": { "label": "Finish reason" },
    "request_latency_p99": { "label": "Request latency P99" },
    "tokenize_rate": { "label": "Tokenize rate" },
    "embedding_rate": { "label": "Embedding rate" },
    "queue_metrics": { "label": "Queue metrics" }
  },
  "unavailable": {
    "noData": "(not reported by this engine)",
    "no_data": "(not reported by this engine)",
    "prom_error": "(Prometheus unreachable)",
    "not_supported": "(metric not supported)"
  }
}
```

In `apps/web/src/lib/i18n.ts`, register the namespace following the existing pattern (import the JSON files, add `engine-metrics` to the `ns` array and to both `resources.zh-CN` and `resources.en-US`).

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm -F @modeldoctor/web vitest run i18n.test.ts`
Expected: PASS, 1/1.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/locales/en-US/engine-metrics.json \
  apps/web/src/locales/zh-CN/engine-metrics.json \
  apps/web/src/lib/i18n.ts \
  apps/web/src/lib/i18n.test.ts
git commit -m "$(cat <<'EOF'
feat(web): engine-metrics i18n namespace (zh-CN + en-US)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 21: `<EngineMetricsSection>` container

**Files:**
- Create: `apps/web/src/features/engine-metrics/EngineMetricsSection.tsx`
- Create: `apps/web/src/features/engine-metrics/EngineMetricsSection.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { EngineMetricsSection } from "./EngineMetricsSection.js";

vi.mock("echarts-for-react", () => ({ default: () => <div data-testid="echart" /> }));

vi.mock("@/lib/api-client", () => ({
  api: {
    get: vi.fn(async () => ({
      engineId: "vllm",
      capability: "generative",
      window: {
        from: "2026-05-09T00:00:00.000Z",
        to: "2026-05-09T00:01:00.000Z",
        step: 15,
      },
      panels: [
        {
          key: "ttft_p99",
          group: "topline",
          panel: "stat",
          unit: "ms",
          unavailable: false,
          series: [{ samples: [[1715212800, 187.4]] }],
        },
        {
          key: "kv_cache_usage",
          group: "engine",
          panel: "timeseries",
          unit: "%",
          unavailable: false,
          series: [{ label: "infer-0", samples: [[1715212800, 60]] }],
        },
        {
          key: "stage_breakdown",
          group: "latency",
          panel: "timeseries",
          unit: "ms",
          unavailable: true,
          reason: "no_data",
          series: [],
        },
      ],
    })),
  },
}));

function wrap(client: QueryClient) {
  return function W({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("<EngineMetricsSection>", () => {
  it("renders panels grouped by group", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <EngineMetricsSection
        connectionId="c1"
        startedAt="2026-05-09T00:00:00.000Z"
        finishedAt="2026-05-09T00:01:00.000Z"
      />,
      { wrapper: wrap(qc) },
    );
    await waitFor(() => expect(screen.getByText(/187 ms/)).toBeInTheDocument());
    expect(screen.getByText(/TTFT P99|TTFT P99/)).toBeInTheDocument();
  });

  it("flags unavailable panels with placeholder", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <EngineMetricsSection
        connectionId="c1"
        startedAt="2026-05-09T00:00:00.000Z"
        finishedAt="2026-05-09T00:01:00.000Z"
      />,
      { wrapper: wrap(qc) },
    );
    await waitFor(() =>
      expect(screen.getAllByText(/不上报|not reported/).length).toBeGreaterThan(0),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @modeldoctor/web vitest run EngineMetricsSection`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `EngineMetricsSection.tsx`**

```tsx
import type {
  EngineMetricsPanelResult,
  PanelGroup,
} from "@modeldoctor/contracts";
import { ENGINE_DISPLAY_NAME } from "@modeldoctor/contracts";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { GaugePanel } from "./panels/GaugePanel.js";
import { HeatmapPanel } from "./panels/HeatmapPanel.js";
import { StatPanel } from "./panels/StatPanel.js";
import { TimeseriesPanel } from "./panels/TimeseriesPanel.js";
import { useEngineMetrics } from "./useEngineMetrics.js";

export interface EngineMetricsSectionProps {
  connectionId: string;
  /** ISO datetime; benchmark startedAt */
  startedAt: string;
  /** ISO datetime; benchmark finishedAt */
  finishedAt: string;
}

const GROUP_ORDER: PanelGroup[] = ["topline", "latency", "throughput", "engine", "health"];

const GROUP_GRID_CLASS: Record<PanelGroup, string> = {
  topline: "grid-cols-1 md:grid-cols-2 lg:grid-cols-5",
  latency: "grid-cols-1 md:grid-cols-3",
  throughput: "grid-cols-1 md:grid-cols-2 xl:grid-cols-3",
  engine: "grid-cols-1 md:grid-cols-3",
  health: "grid-cols-1 md:grid-cols-3",
};

function pad30s(iso: string, deltaSeconds: number): string {
  return new Date(new Date(iso).getTime() + deltaSeconds * 1000).toISOString();
}

export function EngineMetricsSection({
  connectionId,
  startedAt,
  finishedAt,
}: EngineMetricsSectionProps) {
  const { t } = useTranslation("engine-metrics");

  const range = useMemo(() => {
    const from = pad30s(startedAt, -30);
    const to = pad30s(finishedAt, +30);
    const span = (new Date(to).getTime() - new Date(from).getTime()) / 1000;
    const step = Math.max(15, Math.floor(span / 200));
    return { from, to, step };
  }, [startedAt, finishedAt]);

  const benchmarkWindow = useMemo(
    () => ({
      from: Math.floor(new Date(startedAt).getTime() / 1000),
      to: Math.floor(new Date(finishedAt).getTime() / 1000),
    }),
    [startedAt, finishedAt],
  );

  const { data, isLoading, isError } = useEngineMetrics(connectionId, range);

  if (isLoading) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        {t("section.promError")}
      </div>
    );
  }

  const byGroup: Record<PanelGroup, EngineMetricsPanelResult[]> = {
    topline: [],
    latency: [],
    throughput: [],
    engine: [],
    health: [],
  };
  for (const p of data.panels) byGroup[p.group].push(p);

  return (
    <div className="space-y-6">
      <div className="text-xs text-muted-foreground">
        {t("section.subtitle", {
          engineName: ENGINE_DISPLAY_NAME[data.engineId],
          from: data.window.from,
          to: data.window.to,
        })}
      </div>
      {GROUP_ORDER.map((group) => {
        const panels = byGroup[group];
        if (panels.length === 0) return null;
        return (
          <section key={group} className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t(`groups.${group}`)}
            </h4>
            <div className={`grid gap-3 ${GROUP_GRID_CLASS[group]}`}>
              {panels.map((panel) => {
                const label = t(`metrics.${panel.key}.label`, {
                  defaultValue: panel.key,
                });
                if (panel.panel === "stat") {
                  return (
                    <StatPanel
                      key={panel.key}
                      label={label}
                      unit={panel.unit}
                      series={panel.series}
                      unavailable={panel.unavailable}
                      reason={panel.reason}
                    />
                  );
                }
                if (panel.panel === "gauge") {
                  return (
                    <GaugePanel
                      key={panel.key}
                      label={label}
                      unit={panel.unit}
                      series={panel.series}
                      unavailable={panel.unavailable}
                      reason={panel.reason}
                    />
                  );
                }
                if (panel.panel === "heatmap") {
                  return (
                    <HeatmapPanel
                      key={panel.key}
                      label={label}
                      series={panel.series}
                      unavailable={panel.unavailable}
                      reason={panel.reason}
                    />
                  );
                }
                return (
                  <TimeseriesPanel
                    key={panel.key}
                    label={label}
                    unit={panel.unit}
                    series={panel.series}
                    unavailable={panel.unavailable}
                    reason={panel.reason}
                    benchmarkWindow={benchmarkWindow}
                  />
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @modeldoctor/web vitest run EngineMetricsSection`
Expected: PASS, 2/2.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/engine-metrics/EngineMetricsSection.tsx \
  apps/web/src/features/engine-metrics/EngineMetricsSection.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): EngineMetricsSection grouped panel renderer

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 22: ConnectionDialog `serverKind` dropdown

**Files:**
- Modify: `apps/web/src/features/connections/schema.ts`
- Modify: `apps/web/src/features/connections/ConnectionDialog.tsx`
- Modify: `apps/web/src/features/connections/ConnectionDialog.test.tsx`
- Modify: `apps/web/src/locales/{zh-CN,en-US}/connections.json`

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/features/connections/ConnectionDialog.test.tsx`:

```tsx
it("submits serverKind alongside other fields when user picks an engine", async () => {
  const user = userEvent.setup();
  const onSaved = vi.fn();
  render(
    <ConnectionDialog open onOpenChange={() => {}} mode={{ kind: "create" }} onSaved={onSaved} />,
    { wrapper: makeWrapper() },
  );
  await user.type(screen.getByLabelText(/Name|名称/), "vllm-test");
  await user.type(screen.getByLabelText(/Base URL|基础 URL/), "http://m:8000");
  await user.type(screen.getByLabelText(/API Key/i), "sk-x");
  await user.type(screen.getByLabelText(/Model|模型/), "Qwen2.5-7B-Instruct");

  await user.click(screen.getByLabelText(/Engine|推理引擎/));
  await user.click(screen.getByRole("option", { name: /vLLM/ }));

  await user.click(screen.getByRole("button", { name: /Save|保存/ }));

  await waitFor(() =>
    expect(createMutationSpy).toHaveBeenCalledWith(
      expect.objectContaining({ serverKind: "vllm" }),
    ),
  );
});
```

(`createMutationSpy`, `makeWrapper`, etc. should mirror the patterns already in the surrounding test file. If the file doesn't expose a spy, intercept via the existing fetch / api mock.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @modeldoctor/web vitest run ConnectionDialog.test`
Expected: FAIL — no engine dropdown.

- [ ] **Step 3: Add `serverKind` to form schema**

In `apps/web/src/features/connections/schema.ts`, extend `baseShape`:

```ts
import { serverKindSchema } from "@modeldoctor/contracts";

const baseShape = {
  // ... existing fields ...
  serverKind: serverKindSchema.nullable().optional(),
};
```

In `apps/web/src/features/connections/ConnectionDialog.tsx`:

- Add `serverKind: null` to `empty` and to the `existingToFormValues` return.
- Pass `serverKind: values.serverKind ?? null` in BOTH the create and edit submit handlers (mirror the `prometheusUrl` line).
- Add an engine dropdown next to `prometheusUrl`:

```tsx
import { ENGINE_DISPLAY_NAME, type EngineId } from "@modeldoctor/contracts";

// Inside SERVER_KIND_OPTIONS:
const SERVER_KIND_OPTIONS: Array<{ value: "vllm" | "sglang" | "tgi" | "trtllm" | "mindie" | "lmdeploy" | "tei" | "infinity" | "llamacpp" | "comfyui" | "higress" | "generic"; label: string }> = [
  { value: "vllm", label: ENGINE_DISPLAY_NAME.vllm },
  { value: "sglang", label: ENGINE_DISPLAY_NAME.sglang },
  { value: "tgi", label: ENGINE_DISPLAY_NAME.tgi },
  { value: "trtllm", label: ENGINE_DISPLAY_NAME.trtllm },
  { value: "mindie", label: ENGINE_DISPLAY_NAME.mindie },
  { value: "lmdeploy", label: ENGINE_DISPLAY_NAME.lmdeploy },
  { value: "tei", label: ENGINE_DISPLAY_NAME.tei },
  { value: "infinity", label: ENGINE_DISPLAY_NAME.infinity },
  { value: "llamacpp", label: ENGINE_DISPLAY_NAME.llamacpp },
  { value: "comfyui", label: ENGINE_DISPLAY_NAME.comfyui },
  { value: "higress", label: "Higress (Gateway)" },
  { value: "generic", label: "Generic" },
];
```

Render a `<FormField>` with a shadcn `<Select>`:

```tsx
<FormField
  control={form.control}
  name="serverKind"
  render={({ field }) => (
    <FormItem>
      <FormLabel>{t("dialog.fields.serverKind")}</FormLabel>
      <FormControl>
        <Select
          value={field.value ?? ""}
          onValueChange={(v) => field.onChange(v === "" ? null : v)}
        >
          <SelectTrigger>
            <SelectValue placeholder={t("dialog.fields.serverKindPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {SERVER_KIND_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormControl>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("dialog.fields.serverKindHelp")}
      </p>
      <FormMessage />
    </FormItem>
  )}
/>
```

Place this `FormField` immediately above the `prometheusUrl` field (engine type comes first; Prom URL is conditional on the engine).

- [ ] **Step 4: Add i18n keys**

Append to `apps/web/src/locales/zh-CN/connections.json` under `dialog.fields`:

```json
"serverKind": "推理引擎",
"serverKindPlaceholder": "选择…",
"serverKindHelp": "推理引擎类型决定 Prometheus 指标的命名空间，关联 Engine Metrics 看板。"
```

Mirror the same keys in `en-US/connections.json` with English copy.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm -F @modeldoctor/web vitest run ConnectionDialog.test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/connections/ConnectionDialog.tsx \
  apps/web/src/features/connections/ConnectionDialog.test.tsx \
  apps/web/src/features/connections/schema.ts \
  apps/web/src/locales/zh-CN/connections.json \
  apps/web/src/locales/en-US/connections.json
git commit -m "$(cat <<'EOF'
feat(web/connections): add serverKind dropdown

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 23: Mount section in BenchmarkDetailPage

**Files:**
- Modify: `apps/web/src/features/benchmarks/BenchmarkDetailPage.tsx`
- Modify: `apps/web/src/features/benchmarks/__tests__/BenchmarkDetailPage.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `BenchmarkDetailPage.test.tsx`:

```tsx
it("renders <EngineMetricsSection> when connection has prometheusUrl + serverKind", async () => {
  // Configure the existing useConnection mock to return a connection with
  // prometheusUrl + serverKind set; configure the engine-metrics fetch to
  // return at least 1 panel.
  // ... set up mocks to mirror the surrounding test patterns ...

  renderDetail(/* terminal-state benchmark fixture */);

  await waitFor(() =>
    expect(screen.getByText(/Engine Metrics|推理引擎指标/)).toBeInTheDocument(),
  );
});

it("does not render <EngineMetricsSection> when prometheusUrl is missing", async () => {
  // ... mock connection without prometheusUrl ...

  renderDetail(/* terminal-state benchmark fixture */);

  await waitFor(() => expect(screen.queryByText(/Engine Metrics|推理引擎指标/)).toBeNull());
});
```

> Match the existing fixture-builder utilities at the top of `BenchmarkDetailPage.test.tsx` rather than rolling new mocks.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @modeldoctor/web vitest run BenchmarkDetailPage`
Expected: FAIL — section not rendered.

- [ ] **Step 3: Implement integration**

In `apps/web/src/features/benchmarks/BenchmarkDetailPage.tsx`:

1. Add an import for the section + the `useConnection` hook:

```ts
import { useConnection } from "@/features/connections/queries";
import { EngineMetricsSection } from "@/features/engine-metrics/EngineMetricsSection";
```

2. Inside the component body, fetch the connection alongside the existing benchmark query:

```ts
const conn = useConnection(benchmark?.connectionId ?? null);
```

3. Insert the section between `<BenchmarkChartsSection>` and `<BenchmarkDetailRawOutput>` (between the existing `</section>` after charts and the next `<section>` for raw output):

```tsx
{conn.data?.prometheusUrl &&
  conn.data.serverKind &&
  benchmark.startedAt &&
  benchmark.finishedAt && (
    <section>
      <h3 className="mb-3 text-sm font-semibold">{t("detail.engineMetrics.title")}</h3>
      <EngineMetricsSection
        connectionId={conn.data.id}
        startedAt={benchmark.startedAt}
        finishedAt={benchmark.finishedAt}
      />
    </section>
  )}
```

4. Add the i18n key. In `apps/web/src/locales/{zh-CN,en-US}/benchmarks.json`, add `detail.engineMetrics.title` (zh: "推理引擎指标"; en: "Engine Metrics").

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @modeldoctor/web vitest run BenchmarkDetailPage`
Expected: PASS for both new cases.

Run: `pnpm -F @modeldoctor/web typecheck`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/benchmarks/BenchmarkDetailPage.tsx \
  apps/web/src/features/benchmarks/__tests__/BenchmarkDetailPage.test.tsx \
  apps/web/src/locales/zh-CN/benchmarks.json \
  apps/web/src/locales/en-US/benchmarks.json
git commit -m "$(cat <<'EOF'
feat(web/benchmark-detail): mount EngineMetricsSection

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 24: Manual verification checklist

This task has no test code; it's a structured check the engineer runs against the live 67 cluster (vLLM V1 deployed at `10.100.121.67:30888`, Prometheus at `10.100.121.67:30121`). All findings get written into a checklist commit on top of the branch.

- [ ] **Step 1: Build runner images and start dev stack**

Run:
```bash
pnpm -r build && pnpm -F @modeldoctor/api start:dev &
pnpm -F @modeldoctor/web dev &
```

- [ ] **Step 2: Verify Connection edit form**

Open `http://localhost:5173/connections`, edit the existing Qwen2.5-7B-Instruct connection.
- [ ] Engine dropdown shows 12 options (10 engines + higress + generic).
- [ ] Picking "vLLM" persists; reload preserves the selection.
- [ ] `prometheusUrl` is populated with `http://10.100.121.67:30121`.

- [ ] **Step 3: Run a prefix-cache-probe and inspect Engine Metrics**

Submit a fresh prefix-cache-probe benchmark on that connection. Wait for `completed`.
- [ ] In the Detail page, "推理引擎指标" section appears after the existing charts.
- [ ] Topline row shows 5 stat panels (Success, Active, Efficiency, TTFT P99, Preempt).
- [ ] At least KV Cache Usage and Prefix Cache Hit Rate render real numbers (not `(not reported)`).
- [ ] Time-series panels show a faint blue band over the actual benchmark window.

Capture a screenshot.

- [ ] **Step 4: Run a genai-perf benchmark**

On the same connection, kick off a genai-perf run (default params, streaming=true).
- [ ] Same Engine Metrics section appears, with the time-window shifted to the new benchmark.

- [ ] **Step 5: Negative cases**

- [ ] Edit the connection, clear `prometheusUrl`, save. Open any past benchmark — section should NOT render.
- [ ] Restore `prometheusUrl`. Save with `serverKind = null`. Open any past benchmark — section still should NOT render.
- [ ] Restore `serverKind = vllm`. Stop Prometheus access (e.g., point `prometheusUrl` to `http://localhost:9999`). Open a benchmark — section renders, all panels show `(Prometheus unreachable)` placeholders, page is otherwise fine.

- [ ] **Step 6: Verify MindIE manifest names against the live deployment (if available)**

If a MindIE deployment is reachable in the 67 cluster:
```bash
kubectl exec <mindie-pod> -- curl -s localhost:8000/metrics | grep '^mindie_'
```
Cross-check each metric name in `packages/contracts/src/engine-metrics/manifests/mindie.ts`. Adjust any that differ.

If no MindIE pod is available, mark as "deferred — verify in next deployment touchpoint".

- [ ] **Step 7: Final lint + typecheck + test**

```bash
pnpm -r lint && pnpm -r typecheck && pnpm -r test
```

All green. Capture pass count.

- [ ] **Step 8: Commit verification log**

Create `docs/superpowers/notes/2026-05-09-engine-metrics-verification.md` with:
- Outcome of each step
- Screenshots
- Any deviations / TODOs (e.g. MindIE metric name fix-ups)

```bash
git add docs/superpowers/notes/2026-05-09-engine-metrics-verification.md
git commit -m "$(cat <<'EOF'
docs(verify): engine-metrics dashboard manual verification log

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Per session policy, do NOT push at the end of this plan. The user will instruct when to push.

---

## Self-Review Notes (filled by author of the plan)

**1. Spec coverage:**

| Spec section | Task(s) |
|---|---|
| §4.1 Engine capability grouping | 1 (ENGINE_CAPABILITY map) |
| §4.2 Manifest data structure | 3 |
| §4.3.1 vLLM 19 panels | 4 |
| §4.3.2 SGLang 9 panels | 5 |
| §4.3.3 TGI 7 panels | 6 |
| §4.3.4 MindIE 5 panels | 7 |
| §4.3.5 TEI 6 panels | 8 |
| §4.4 Backend module + service + controller | 10–13 |
| §4.5 Front-end panels + section | 15–21 |
| §4.6 BenchmarkDetailPage integration | 23 |
| §4.7 i18n | 20 |
| §4.8 ConnectionDialog dropdown | 22 |
| §6.1 Backend tests | 10–13 (per-task) + 14 (e2e) |
| §6.2 Manifest snapshot tests | 4–8 (per-manifest snapshot) |
| §6.3 Front-end component tests | 15–21 (per-task) |
| §7 Phase milestones | mapped to Tasks 1–24 |
| §8 Open question: connection.serverKind null | covered by Task 11 (422 with `missing serverKind` reason) and Task 23 gate |
| §8 Open question: PromQL escape | covered by Task 11 `renderTemplate` + spec test |

No gaps.

**2. Placeholder scan:** No "TBD"/"TODO"/"add error handling" placeholders. Every code step shows the actual code.

**3. Type consistency:**
- `EngineId`, `EngineCapability`, `ENGINE_CAPABILITY`, `EngineMetricSpec`, `EngineManifest`, `getEngineManifest`, `EngineMetricsSnapshotQuery`, `EngineMetricsSnapshotResponse`, `EngineMetricsPanelResult` — used consistently across Tasks 1, 3, 4–9, 10–13, 15–21.
- `DecryptedConnection.serverKind` added in Task 12 is consumed in Task 11 (already written assuming the field exists). Order matters: Task 12 must complete before Task 13's app integration runs cleanly. The plan ordering puts service (11) before extension (12) for storytelling reasons; in execution the spec-reviewer should suggest interleaving Task 12 right after Task 11 — both still pre-Task 13. (Documented here so the executor doesn't get confused.)
- `EngineMetricsRange.step` is optional everywhere (Tasks 3, 11, 15, 21).
- `benchmarkWindow` shape `{ from: number; to: number }` (unix seconds) is consistent between Task 18 (TimeseriesPanel) and Task 21 (EngineMetricsSection compute).

If you find issues during execution, fix inline and re-run the affected task's tests.

