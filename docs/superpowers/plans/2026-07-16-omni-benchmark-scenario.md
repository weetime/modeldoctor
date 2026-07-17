# Omni Benchmark Scenario Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 `omni` benchmark 场景 + `vllm-omni-bench` 工具:一个 run 内对全模态端点做 `双臂(text+audio / text) × 并发档` 扫描,产出 AUDIO_TTFP / AUDIO_RTF 曲线、实时天花板、语音税,并接入 Templates / Insights / Connections(omni category)。

**Architecture:** 新 tool adapter(TS,包官方 `vllm-omni bench serve --omni`)→ K8s Job 跑新 runner 镜像(`FROM vllm-omni:v0.24.0` + 通用 wrapper)→ wrapper 把 `python -m runner.tools.omni_driver` 当普通工具启动 → driver 循环调 bench、逐点解析 stdout、聚合写 `out/omni_result.json` → adapter `parseFinalReport` 校验入库 → OmniReport 画曲线,Insights `checks/omni.ts` 打分。

**Tech Stack:** TypeScript (zod, vitest) / Python 3.11 (pytest) / React + echarts-for-react / Prisma seed / Docker。

**Spec:** `docs/superpowers/specs/2026-07-16-omni-benchmark-scenario-design.md`(阈值、数据形状、决策理由都在里面,本计划的代码是它的落地)。

## Global Constraints

- pnpm 10 / Node ≥20;TS 测试:`pnpm -F <pkg> test`(vitest);Python 测试:`cd apps/benchmark-runner && python -m pytest tests/ -v`
- 新 ToolName 字面量:`"vllm-omni-bench"`;新 ScenarioId:`"omni"`;新 ModalityCategory:`"omni"`
- 双臂必须同 `max_tokens`(= `outputTokens`)、`--ignore-eos`、`num-prompts = max(4, 2×c)` —— 方法学纪律,driver 写死
- `modalities` 语义:audio 臂 `["text","audio"]`,text 臂 `["text"]`(端点把 `["audio"]` 解释为 text+audio,不要用)
- text 臂的 `--percentile-metrics` 不含 audio_*(响应无音频,请求 audio 分位会崩)
- 秘密只走 secretEnv(`OPENAI_API_KEY`),禁止进 argv
- 中间提交允许仅本包测试绿;repo 级 `pnpm build` 在 Task 12 收口
- 提交信息用 conventional commits(feat/test/docs/chore)

**任务依赖:** 1 → 2 → 3 → 4 → 5 → {6, 7, 8, 9} → 10 → 11 → 12(6/7/8/9 相互独立,可并行)

---

### Task 1: contracts 三个枚举扩容 + 全仓 Record 穷尽门修复

**Files:**
- Modify: `packages/contracts/src/modality.ts`
- Modify: `packages/contracts/src/benchmark.ts`(scenarioIdSchema、benchmarkToolSchema)
- Modify: `packages/tool-adapters/src/category-defaults.ts`(4 个既有 Record 补 omni 键)
- Modify: `apps/web/src/features/benchmarks/forms/ToolParamsEditor.tsx`(TAU3_CATEGORY_DEFAULTS 补 omni 键)
- Modify: typecheck 报出的其余 `Record<ModalityCategory, …>` / `satisfies` 站点(已知候选:`apps/web/src/features/playground/CategoryEndpointSelector.tsx`、`apps/web/src/features/connections/schema.ts`、`apps/web/src/features/connections/ConnectionSheet.tsx`、`apps/api/src/modules/connection/discovery/inference/category.ts`、`apps/api/src/modules/connection/discovery/inference/tags.ts`、`apps/web/src/features/diagnostics/types.ts`)
- Test: `packages/contracts/src/modality.test.ts`

**Interfaces:**
- Produces: `ModalityCategorySchema` 含 `"omni"`;`scenarioIdSchema` 含 `"omni"`;`benchmarkToolSchema` 含 `"vllm-omni-bench"`。后续所有任务依赖这三个字面量。

- [ ] **Step 1: 写失败测试**

在 `packages/contracts/src/modality.test.ts` 追加:

```ts
it("includes omni as the 6th category", () => {
  expect(ModalityCategorySchema.options).toContain("omni");
});
```

在 `packages/contracts/src/`(如已有 benchmark 相关 test 文件则追加,否则新建 `benchmark-enums.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { benchmarkToolSchema, scenarioIdSchema } from "./benchmark.js";

describe("omni enum widening", () => {
  it("scenarioIdSchema includes omni", () => {
    expect(scenarioIdSchema.options).toContain("omni");
  });
  it("benchmarkToolSchema includes vllm-omni-bench", () => {
    expect(benchmarkToolSchema.options).toContain("vllm-omni-bench");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F @modeldoctor/contracts test`
Expected: 新增断言 FAIL(enum 里没有 omni)

- [ ] **Step 3: 扩容三个枚举**

`packages/contracts/src/modality.ts`(注释里的 "5" 同步改 "6"):

```ts
export const ModalityCategorySchema = z.enum([
  "chat",
  "omni",
  "audio",
  "embeddings",
  "rerank",
  "image",
]);
```

`packages/contracts/src/benchmark.ts`:

```ts
export const scenarioIdSchema = z.enum([
  "inference",
  "capacity",
  "gateway",
  "lb-strategy",
  "engine-kv-cache",
  "agent",
  "omni",
]);

export const benchmarkToolSchema = z.enum([
  "guidellm",
  "vegeta",
  "evalscope",
  "aiperf",
  "tau3",
  "vllm-omni-bench",
]);
```

- [ ] **Step 4: 修 category-defaults 的 4 个 Record**

`packages/tool-adapters/src/category-defaults.ts` — 每个 Record 加一行(omni 端点兼容 chat completions,纯文本压测合法):

```ts
// VEGETA_CATEGORY_DEFAULTS 内:
  omni: { apiType: "chat" },
// GUIDELLM_CATEGORY_DEFAULTS 内:
  omni: { apiType: "chat" },
// EVALSCOPE_CATEGORY_DEFAULTS 内:
  omni: { apiPath: "/v1/chat/completions" },
// AIPERF_CATEGORY_DEFAULTS 内:
  omni: { endpointType: "chat" },
```

`apps/web/src/features/benchmarks/forms/ToolParamsEditor.tsx` 的 `TAU3_CATEGORY_DEFAULTS` 加:

```ts
  omni: { unsupported: true },
```

- [ ] **Step 5: typecheck 扫掉剩余站点**

Run: `pnpm -r --if-present exec tsc --noEmit 2>&1 | head -50`(或各包 `pnpm -F <pkg> build`)
对每个报错站点按同类语义补 `omni` 分支:选项列表类(下拉/图标/标签)加一项 omni;判定类(能否 chat、探测)omni 视同 chat 处理。已知候选文件见上方 Files 列表;以编译器输出为准清零。

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm -F @modeldoctor/contracts test && pnpm -F @modeldoctor/tool-adapters test`
Expected: PASS(category-defaults.spec 的 satisfies 由编译期保证)

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(contracts): add omni modality category, omni scenario, vllm-omni-bench tool enums"
```

---

### Task 2: vllm-omni-bench 参数与报告 schema

**Files:**
- Create: `packages/tool-adapters/src/vllm-omni-bench/schema.ts`
- Test: `packages/tool-adapters/src/vllm-omni-bench/schema.spec.ts`

**Interfaces:**
- Produces: `vllmOmniBenchParamsSchema` / `VllmOmniBenchParams` / `vllmOmniBenchParamDefaults` / `vllmOmniBenchReportSchema` / `VllmOmniBenchReport`。Report 形状 = spec §5(curve + derived + warnings),Task 4/6/9/11 都消费它。

- [ ] **Step 1: 写失败测试**

`packages/tool-adapters/src/vllm-omni-bench/schema.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  vllmOmniBenchParamDefaults,
  vllmOmniBenchParamsSchema,
  vllmOmniBenchReportSchema,
} from "./schema.js";

describe("vllmOmniBenchParamsSchema", () => {
  it("defaults match the article methodology (levels 1/8/16/32, 500in/300out, voiceTax on)", () => {
    const p = vllmOmniBenchParamsSchema.parse({});
    expect(p.concurrencyLevels).toEqual([1, 8, 16, 32]);
    expect(p.inputTokens).toBe(500);
    expect(p.outputTokens).toBe(300);
    expect(p.voiceTax).toBe(true);
    expect(p.numWarmups).toBe(1);
    expect(p.perPointTimeoutSeconds).toBe(900);
  });
  it("rejects empty / oversized / duplicate concurrency levels", () => {
    expect(() => vllmOmniBenchParamsSchema.parse({ concurrencyLevels: [] })).toThrow();
    expect(() =>
      vllmOmniBenchParamsSchema.parse({ concurrencyLevels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }),
    ).toThrow();
    expect(() => vllmOmniBenchParamsSchema.parse({ concurrencyLevels: [8, 8] })).toThrow();
  });
  it("paramDefaults parse clean through the schema", () => {
    expect(() => vllmOmniBenchParamsSchema.parse(vllmOmniBenchParamDefaults)).not.toThrow();
  });
});

describe("vllmOmniBenchReportSchema", () => {
  it("accepts a two-arm curve with a failed point and null audio stats on the text arm", () => {
    const report = {
      curve: [
        {
          arm: "audio", concurrency: 1, status: "ok",
          reqPerSec: 0.5, outTokPerSec: 120,
          ttftMs: { mean: 66, p50: 60, p99: 120 },
          e2elMs: { mean: 8000, p50: 7900, p99: 9000 },
          audioTtfpMs: { mean: 511, p50: 490, p99: 900 },
          audioRtf: { mean: 0.19, p50: 0.18, p99: 0.3 },
        },
        {
          arm: "text", concurrency: 1, status: "ok",
          reqPerSec: 0.7, outTokPerSec: 140,
          ttftMs: { mean: 60, p50: 55, p99: 100 },
          e2elMs: { mean: 5000, p50: 4900, p99: 6000 },
          audioTtfpMs: null, audioRtf: null,
        },
        {
          arm: "audio", concurrency: 64, status: "failed",
          reqPerSec: null, outTokPerSec: null,
          ttftMs: null, e2elMs: null, audioTtfpMs: null, audioRtf: null,
        },
      ],
      derived: {
        realtimeCeiling: 1, peakConcurrency: 1,
        voiceTaxMsByLevel: { "1": 3000 }, voiceTaxMs: 3000,
      },
      warnings: ["arm=audio c=64: bench exited 1, point skipped"],
    };
    expect(() => vllmOmniBenchReportSchema.parse(report)).not.toThrow();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F @modeldoctor/tool-adapters test -- vllm-omni-bench`
Expected: FAIL — Cannot find module './schema.js'

- [ ] **Step 3: 实现 schema.ts**

```ts
import { z } from "zod";

// vLLM-Omni 官方 bench (`vllm-omni bench serve --omni`) 是目前唯一产出
// AUDIO_TTFP / AUDIO_RTF 百分位的开源压测客户端。本 adapter 不直接拼 bench
// argv —— buildCommand 启动 runner 内的 omni_driver(python),由它循环
// 双臂 × 并发档 逐点调 bench 并聚合(spec §3/§4.2)。
export const vllmOmniBenchParamsSchema = z
  .object({
    // 并发档列表;一个 run 内逐档扫描。上限 10 档防止 run 时长失控。
    concurrencyLevels: z
      .array(z.number().int().min(1).max(512))
      .min(1)
      .max(10)
      .default([1, 8, 16, 32]),
    inputTokens: z.number().int().min(1).max(32000).default(500),
    // 双臂共用(= max_tokens);RTF 与音频时长强相关,双臂必须同长。
    outputTokens: z.number().int().min(1).max(4096).default(300),
    // true = 追加 text-only 对照臂,同档同参,产出语音税(ΔE2EL)。
    voiceTax: z.boolean().default(true),
    numWarmups: z.number().int().min(0).max(10).default(1),
    // 单点 bench 子进程超时;超时记 failed 点,继续后续点。
    perPointTimeoutSeconds: z.number().int().min(60).max(3600).default(900),
  })
  .superRefine((v, ctx) => {
    if (new Set(v.concurrencyLevels).size !== v.concurrencyLevels.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["concurrencyLevels"],
        message: "concurrencyLevels must not contain duplicates",
      });
    }
  });

export type VllmOmniBenchParams = z.infer<typeof vllmOmniBenchParamsSchema>;

export const vllmOmniBenchParamDefaults: Partial<VllmOmniBenchParams> = {
  concurrencyLevels: [1, 8, 16, 32],
  inputTokens: 500,
  outputTokens: 300,
  voiceTax: true,
  numWarmups: 1,
  perPointTimeoutSeconds: 900,
};

// bench 汇总只出 Mean/Median/P99(--percentile-metrics 默认分位),
// 故 stat 三件套,不套用 inference 的 5 桶 dist。
const stat = z.object({ mean: z.number(), p50: z.number(), p99: z.number() });

const curvePointSchema = z.object({
  arm: z.enum(["audio", "text"]),
  concurrency: z.number().int().positive(),
  status: z.enum(["ok", "failed"]),
  reqPerSec: z.number().nonnegative().nullable(),
  outTokPerSec: z.number().nonnegative().nullable(),
  ttftMs: stat.nullable(),
  e2elMs: stat.nullable(),
  // text 臂 / failed 点为 null。
  audioTtfpMs: stat.nullable(),
  audioRtf: stat.nullable(),
});

export const vllmOmniBenchReportSchema = z.object({
  curve: z.array(curvePointSchema).min(1),
  derived: z.object({
    // audio 臂 RTF(mean)<1 的最大档;全部 ≥1 则 0。
    realtimeCeiling: z.number().int().nonnegative(),
    peakConcurrency: z.number().int().nonnegative(),
    voiceTaxMsByLevel: z.record(z.number()),
    voiceTaxMs: z.number().nullable(),
  }),
  warnings: z.array(z.string()),
});

export type VllmOmniBenchReport = z.infer<typeof vllmOmniBenchReportSchema>;
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm -F @modeldoctor/tool-adapters test -- vllm-omni-bench`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/tool-adapters/src/vllm-omni-bench/
git commit -m "feat(tool-adapters): vllm-omni-bench params + report schema"
```

---

### Task 3: MetricKind 扩容 + 5 个既有 adapter 的 null 分支

**Files:**
- Modify: `packages/tool-adapters/src/core/metric-extractor.ts`
- Modify: `packages/tool-adapters/src/{guidellm,vegeta,evalscope,aiperf,tau3}/read-metric.ts`(tau3 若无独立文件则在其 readMetric 实现处)
- Test: 既有各 adapter 的 read-metric spec(编译期 never 门自动觉察)

**Interfaces:**
- Produces: `MetricKind` 新增 8 个 omni 值:`"realtimeCeiling" | "audioTtfpC1.mean" | "audioTtfpPeak.p50" | "audioTtfpPeak.p99" | "audioRtfPeak.mean" | "audioRtfPeak.p50" | "audioRtfPeak.p99" | "voiceTax.ms"`。Task 4(omni readMetric)、Task 9(check descriptors)消费。

- [ ] **Step 1: 扩容 MetricKind**

`packages/tool-adapters/src/core/metric-extractor.ts` 的联合类型追加:

```ts
  // ── Omni (vllm-omni-bench) — 语音输出实时性指标。非 omni 工具一律返回 null。
  | "realtimeCeiling"      // RTF(mean)<1 的最大并发档
  | "audioTtfpC1.mean"     // 最低并发档的首包均值 (ms)
  | "audioTtfpPeak.p50"
  | "audioTtfpPeak.p99"
  | "audioRtfPeak.mean"
  | "audioRtfPeak.p50"
  | "audioRtfPeak.p99"
  | "voiceTax.ms";         // 最高共档 ΔE2EL(mean), text+audio − text
```

- [ ] **Step 2: 编译确认 5 处 never 门报错**

Run: `pnpm -F @modeldoctor/tool-adapters build`
Expected: 每个既有 read-metric 的 `default: const _exhaustive: never = kind` 处 TS2322 报错(共 5 个文件;这正是穷尽门在工作)

- [ ] **Step 3: 每个既有 adapter 补一组 null case**

在 5 个 read-metric switch 的 `default` 前统一插入:

```ts
    // Omni-only kinds — 本工具不产出。
    case "realtimeCeiling":
    case "audioTtfpC1.mean":
    case "audioTtfpPeak.p50":
    case "audioTtfpPeak.p99":
    case "audioRtfPeak.mean":
    case "audioRtfPeak.p50":
    case "audioRtfPeak.p99":
    case "voiceTax.ms":
      return null;
```

(tau3 的 readMetric 若是"全量 return null"的实现则无需改动 —— 以编译器为准。)

- [ ] **Step 4: 编译 + 全包测试通过**

Run: `pnpm -F @modeldoctor/tool-adapters build && pnpm -F @modeldoctor/tool-adapters test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/tool-adapters/src/
git commit -m "feat(tool-adapters): omni metric kinds in MetricKind union"
```

---

### Task 4: omni adapter 运行时(buildCommand / parse / readMetric / rows / index)

**Files:**
- Modify: `packages/tool-adapters/src/core/interface.ts`(ToolName、ToolReport 联合)
- Create: `packages/tool-adapters/src/vllm-omni-bench/runtime.ts`
- Create: `packages/tool-adapters/src/vllm-omni-bench/read-metric.ts`
- Create: `packages/tool-adapters/src/vllm-omni-bench/row-descriptors.ts`
- Create: `packages/tool-adapters/src/vllm-omni-bench/index.ts`
- Test: `packages/tool-adapters/src/vllm-omni-bench/runtime.spec.ts`、`read-metric.spec.ts`

**Interfaces:**
- Consumes: Task 2 的 schema、Task 3 的 MetricKind。
- Produces: `vllmOmniBenchAdapter: ToolAdapter`;driver env 契约(Task 6 的 Python 侧必须逐字对齐):`MD_OMNI_PARAMS`(params JSON)、`MD_OMNI_BASE_URL`、`MD_OMNI_MODEL`、`MD_OMNI_TOKENIZER_HF_ID`(可缺)、secretEnv `OPENAI_API_KEY`;outputFiles `{ report: "out/omni_result.json" }`;argv `["python", "-m", "runner.tools.omni_driver"]`。

- [ ] **Step 1: interface.ts 扩容(先做,否则 adapter 类型不成立)**

```ts
export type ToolName = "guidellm" | "vegeta" | "evalscope" | "aiperf" | "tau3" | "vllm-omni-bench";
```

ToolReport 联合追加(import 跟随既有 type-only 风格):

```ts
import type { VllmOmniBenchReport } from "../vllm-omni-bench/schema.js";
// …
  | { tool: "vllm-omni-bench"; data: VllmOmniBenchReport };
```

注意:此步后 `core/registry.ts`、`core/row-descriptors.fe.ts` 的 `Record<ToolName, …>` 会报缺键 —— Task 5 补齐;本任务内先让本文件与新 adapter 文件编译成立即可(spec 测试用 `pnpm … test -- vllm-omni-bench` 过滤运行)。

- [ ] **Step 2: 写失败测试(runtime)**

`packages/tool-adapters/src/vllm-omni-bench/runtime.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { BuildCommandPlan } from "../core/interface.js";
import { buildCommand, getMaxDurationSeconds, parseFinalReport, parseProgress } from "./runtime.js";
import { vllmOmniBenchParamsSchema } from "./schema.js";

const plan = (over: Partial<BuildCommandPlan["connection"]> = {}): BuildCommandPlan => ({
  runId: "bm-1",
  params: vllmOmniBenchParamsSchema.parse({}),
  connection: {
    baseUrl: "http://10.100.121.67:30888/",
    apiKey: "sk-secret",
    model: "gen-studio_Qwen2.5-Omni-7B-OFEd",
    customHeaders: "",
    queryParams: "",
    tokenizerHfId: "Qwen/Qwen2.5-Omni-7B",
    prometheusDatasource: null,
    ...over,
  },
});

describe("buildCommand", () => {
  it("launches the omni driver with the env contract; secret only in secretEnv", () => {
    const r = buildCommand(plan());
    expect(r.argv).toEqual(["python", "-m", "runner.tools.omni_driver"]);
    expect(r.env.MD_OMNI_BASE_URL).toBe("http://10.100.121.67:30888"); // 尾斜杠剥掉
    expect(r.env.MD_OMNI_MODEL).toBe("gen-studio_Qwen2.5-Omni-7B-OFEd");
    expect(r.env.MD_OMNI_TOKENIZER_HF_ID).toBe("Qwen/Qwen2.5-Omni-7B");
    expect(JSON.parse(r.env.MD_OMNI_PARAMS).concurrencyLevels).toEqual([1, 8, 16, 32]);
    expect(r.secretEnv).toEqual({ OPENAI_API_KEY: "sk-secret" });
    expect(JSON.stringify(r.argv)).not.toContain("sk-secret");
    expect(r.outputFiles).toEqual({ report: "out/omni_result.json" });
  });
  it("rejects customHeaders/queryParams (v1 cannot forward them to vllm bench)", () => {
    expect(() => buildCommand(plan({ customHeaders: '{"X-A":"1"}' }))).toThrow(/customHeaders/);
    expect(() => buildCommand(plan({ queryParams: "a=b" }))).toThrow(/queryParams/);
  });
  it("omits MD_OMNI_TOKENIZER_HF_ID when connection has none (driver fails fast with guidance)", () => {
    const r = buildCommand(plan({ tokenizerHfId: null }));
    expect(r.env.MD_OMNI_TOKENIZER_HF_ID).toBeUndefined();
  });
});

describe("parseFinalReport", () => {
  it("parses the driver result file into the report union", () => {
    const data = {
      curve: [{
        arm: "audio", concurrency: 1, status: "ok", reqPerSec: 0.5, outTokPerSec: 100,
        ttftMs: { mean: 66, p50: 60, p99: 120 },
        e2elMs: { mean: 8000, p50: 7900, p99: 9000 },
        audioTtfpMs: { mean: 511, p50: 490, p99: 900 },
        audioRtf: { mean: 0.19, p50: 0.18, p99: 0.3 },
      }],
      derived: { realtimeCeiling: 1, peakConcurrency: 1, voiceTaxMsByLevel: {}, voiceTaxMs: null },
      warnings: [],
    };
    const out = parseFinalReport("", { report: Buffer.from(JSON.stringify(data)) });
    expect(out.tool).toBe("vllm-omni-bench");
  });
  it("throws when the report file is missing", () => {
    expect(() => parseFinalReport("", {})).toThrow(/missing 'report'/);
  });
});

describe("getMaxDurationSeconds", () => {
  it("scales with arms × levels × per-point timeout", () => {
    const p = vllmOmniBenchParamsSchema.parse({}); // 4 档 × 2 臂 × 900s + 300
    expect(getMaxDurationSeconds(p)).toBe(4 * 2 * 900 + 300);
  });
  it("halves without the voice-tax arm", () => {
    const p = vllmOmniBenchParamsSchema.parse({ voiceTax: false });
    expect(getMaxDurationSeconds(p)).toBe(4 * 900 + 300);
  });
});

describe("parseProgress", () => {
  it("reads the driver's point-progress lines", () => {
    const ev = parseProgress("[omni-driver] point arm=audio c=8 done (3/8)");
    expect(ev).toEqual({ kind: "progress", pct: 37.5, message: "point arm=audio c=8 done (3/8)" });
  });
  it("ignores other lines", () => {
    expect(parseProgress("Mean AUDIO_RTF: 0.19")).toBeNull();
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm -F @modeldoctor/tool-adapters test -- vllm-omni-bench`
Expected: FAIL — Cannot find module './runtime.js'

- [ ] **Step 4: 实现 runtime.ts**

```ts
import type {
  BuildCommandPlan,
  BuildCommandResult,
  ProgressEvent,
  ToolReport,
} from "../core/interface.js";
import { type VllmOmniBenchParams, vllmOmniBenchReportSchema } from "./schema.js";

const OUTPUTS_DIR = "out";
const RESULT_FILE = "omni_result.json";

// argv 是 runner 内驱动脚本,不是 bench 本体 —— bench 的循环调用、stdout
// 解析、聚合都在 runner.tools.omni_driver(Python)里,契约见其 docstring。
export function buildCommand(plan: BuildCommandPlan<VllmOmniBenchParams>): BuildCommandResult {
  const { params, connection } = plan;
  // vllm bench 的 openai 后端只从 OPENAI_API_KEY env 取 Bearer,没有自定义
  // header / query 通道;静默丢弃会导致对着鉴权网关 100% 401,故 fail fast。
  if (connection.customHeaders?.trim()) {
    throw new Error("vllm-omni-bench does not support connection customHeaders (v1)");
  }
  if (connection.queryParams?.trim()) {
    throw new Error("vllm-omni-bench does not support connection queryParams (v1)");
  }
  const env: Record<string, string> = {
    MD_OMNI_PARAMS: JSON.stringify(params),
    MD_OMNI_BASE_URL: connection.baseUrl.replace(/\/+$/, ""),
    MD_OMNI_MODEL: connection.model,
  };
  if (connection.tokenizerHfId) env.MD_OMNI_TOKENIZER_HF_ID = connection.tokenizerHfId;
  return {
    argv: ["python", "-m", "runner.tools.omni_driver"],
    env,
    secretEnv: { OPENAI_API_KEY: connection.apiKey },
    outputFiles: { report: `${OUTPUTS_DIR}/${RESULT_FILE}` },
  };
}

// driver 每完成一个点打一行:`[omni-driver] point arm=audio c=8 done (3/8)`。
const PROGRESS_RE = /^\[omni-driver\] (point .* \((\d+)\/(\d+)\))$/;

export function parseProgress(line: string): ProgressEvent | null {
  const m = PROGRESS_RE.exec(line.trim());
  if (!m) return null;
  const done = Number(m[2]);
  const total = Number(m[3]);
  if (!Number.isFinite(done) || !Number.isFinite(total) || total === 0) return null;
  return { kind: "progress", pct: (done / total) * 100, message: m[1] };
}

export function parseFinalReport(_stdout: string, files: Record<string, Buffer>): ToolReport {
  const buf = files.report;
  if (!buf) throw new Error("vllm-omni-bench.parseFinalReport: missing 'report' output file");
  const data = vllmOmniBenchReportSchema.parse(JSON.parse(buf.toString("utf8")));
  return { tool: "vllm-omni-bench", data };
}

export function getMaxDurationSeconds(params: VllmOmniBenchParams): number {
  const arms = params.voiceTax ? 2 : 1;
  const points = params.concurrencyLevels.length * arms;
  // 每点上界 = perPointTimeoutSeconds(driver 层强制);+300s 启动/上传缓冲。
  return Math.max(300, Math.min(14400, points * params.perPointTimeoutSeconds + 300));
}
```

- [ ] **Step 5: 写失败测试(read-metric)**

`packages/tool-adapters/src/vllm-omni-bench/read-metric.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { vllmOmniBenchReadMetric } from "./read-metric.js";

const data = {
  curve: [
    { arm: "audio", concurrency: 1, status: "ok", reqPerSec: 0.5, outTokPerSec: 100,
      ttftMs: { mean: 66, p50: 60, p99: 120 }, e2elMs: { mean: 8000, p50: 7900, p99: 9000 },
      audioTtfpMs: { mean: 511, p50: 490, p99: 900 }, audioRtf: { mean: 0.19, p50: 0.18, p99: 0.3 } },
    { arm: "audio", concurrency: 32, status: "ok", reqPerSec: 0.61, outTokPerSec: 140,
      ttftMs: { mean: 106, p50: 98, p99: 357 }, e2elMs: { mean: 9800, p50: 9500, p99: 12000 },
      audioTtfpMs: { mean: 2870, p50: 2500, p99: 3804 }, audioRtf: { mean: 0.54, p50: 0.5, p99: 0.9 } },
    { arm: "audio", concurrency: 64, status: "failed", reqPerSec: null, outTokPerSec: null,
      ttftMs: null, e2elMs: null, audioTtfpMs: null, audioRtf: null },
    { arm: "text", concurrency: 32, status: "ok", reqPerSec: 0.9, outTokPerSec: 200,
      ttftMs: { mean: 80, p50: 70, p99: 200 }, e2elMs: { mean: 5000, p50: 4800, p99: 7000 },
      audioTtfpMs: null, audioRtf: null },
  ],
  derived: { realtimeCeiling: 32, peakConcurrency: 32,
    voiceTaxMsByLevel: { "32": 4800 }, voiceTaxMs: 4800 },
  warnings: [],
} as unknown as Record<string, unknown>;

describe("vllmOmniBenchReadMetric", () => {
  it("omni kinds", () => {
    expect(vllmOmniBenchReadMetric("realtimeCeiling", data)).toBe(32);
    expect(vllmOmniBenchReadMetric("audioTtfpC1.mean", data)).toBe(511);
    expect(vllmOmniBenchReadMetric("audioTtfpPeak.p99", data)).toBe(3804);
    expect(vllmOmniBenchReadMetric("audioRtfPeak.mean", data)).toBe(0.54);
    expect(vllmOmniBenchReadMetric("voiceTax.ms", data)).toBe(4800);
  });
  it("standard kinds resolve at the peak audio point", () => {
    expect(vllmOmniBenchReadMetric("ttft.p50", data)).toBe(98);
    expect(vllmOmniBenchReadMetric("ttft.p99", data)).toBe(357);
    expect(vllmOmniBenchReadMetric("e2e.p99", data)).toBe(12000);
    expect(vllmOmniBenchReadMetric("requestsPerSec", data)).toBe(0.61);
    expect(vllmOmniBenchReadMetric("outputTokensPerSec", data)).toBe(140);
  });
  it("errorRate = failed points / total points", () => {
    expect(vllmOmniBenchReadMetric("errorRate", data)).toBe(0.25);
  });
  it("bench 只出 p50/p99 → p90/p95 为 null;无对应点也为 null", () => {
    expect(vllmOmniBenchReadMetric("ttft.p95", data)).toBeNull();
    expect(vllmOmniBenchReadMetric("itl.p50", data)).toBeNull();
  });
});
```

- [ ] **Step 6: 实现 read-metric.ts**

```ts
import type { MetricKind } from "../core/metric-extractor.js";
import type { VllmOmniBenchReport } from "./schema.js";

const fin = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

type Curve = VllmOmniBenchReport["curve"];
type Point = Curve[number];

function shape(data: Record<string, unknown>): VllmOmniBenchReport | null {
  const curve = data.curve as Curve | undefined;
  const derived = data.derived as VllmOmniBenchReport["derived"] | undefined;
  if (!Array.isArray(curve) || !derived) return null;
  return data as unknown as VllmOmniBenchReport;
}

function audioOk(r: VllmOmniBenchReport): Point[] {
  return r.curve.filter((p) => p.arm === "audio" && p.status === "ok");
}

// C1 = 最低并发的 audio 点;peak = derived.peakConcurrency 对应的 audio 点。
function c1Point(r: VllmOmniBenchReport): Point | undefined {
  return audioOk(r).sort((a, b) => a.concurrency - b.concurrency)[0];
}
function peakPoint(r: VllmOmniBenchReport): Point | undefined {
  return audioOk(r).find((p) => p.concurrency === r.derived.peakConcurrency);
}

export function vllmOmniBenchReadMetric(
  kind: MetricKind,
  data: Record<string, unknown>,
): number | null {
  const r = shape(data);
  if (!r) return null;
  const peak = peakPoint(r);
  switch (kind) {
    case "realtimeCeiling":
      return fin(r.derived.realtimeCeiling);
    case "audioTtfpC1.mean":
      return fin(c1Point(r)?.audioTtfpMs?.mean);
    case "audioTtfpPeak.p50":
      return fin(peak?.audioTtfpMs?.p50);
    case "audioTtfpPeak.p99":
      return fin(peak?.audioTtfpMs?.p99);
    case "audioRtfPeak.mean":
      return fin(peak?.audioRtf?.mean);
    case "audioRtfPeak.p50":
      return fin(peak?.audioRtf?.p50);
    case "audioRtfPeak.p99":
      return fin(peak?.audioRtf?.p99);
    case "voiceTax.ms":
      return fin(r.derived.voiceTaxMs);
    case "ttft.p50":
      return fin(peak?.ttftMs?.p50);
    case "ttft.p99":
      return fin(peak?.ttftMs?.p99);
    case "e2e.p50":
      return fin(peak?.e2elMs?.p50);
    case "e2e.p99":
      return fin(peak?.e2elMs?.p99);
    case "requestsPerSec":
      return fin(peak?.reqPerSec);
    case "outputTokensPerSec":
      return fin(peak?.outTokPerSec);
    case "errorRate": {
      const failed = r.curve.filter((p) => p.status === "failed").length;
      return r.curve.length === 0 ? null : failed / r.curve.length;
    }
    case "tailRatio": {
      const p50 = fin(peak?.e2elMs?.p50);
      const p99 = fin(peak?.e2elMs?.p99);
      return p50 === null || p99 === null || p50 === 0 ? null : p99 / p50;
    }
    // bench 汇总没有这些分位/指标。
    case "ttft.p90":
    case "ttft.p95":
    case "itl.p50":
    case "itl.p95":
    case "e2e.p90":
    case "e2e.p95":
      return null;
    default: {
      const _exhaustive: never = kind;
      void _exhaustive;
      return null;
    }
  }
}
```

- [ ] **Step 7: row-descriptors.ts + index.ts**

`row-descriptors.ts`(labelKey 前缀对齐 `core/row-descriptor.ts` 里 `SHARED_INFERENCE_ROWS` 的既有约定 —— 实现时打开确认一次,以下按 `compare.rows.*` 假设,若实际是别的前缀跟随之):

```ts
import type { MetricRowSpec } from "../core/row-descriptor.js";

// omni 不是 inference 形状 —— 不复用 SHARED_INFERENCE_ROWS;
// compare 网格只列语音实时性的 4 个头牌 + 错误率。
export const vllmOmniBenchRowDescriptors: readonly MetricRowSpec[] = [
  { source: "metric", labelKey: "compare.rows.realtimeCeiling", metric: "realtimeCeiling", verdictKind: "throughput", digits: 0 },
  { source: "metric", labelKey: "compare.rows.audioTtfpC1Mean", metric: "audioTtfpC1.mean", verdictKind: "latency", format: "latencyMs" },
  { source: "metric", labelKey: "compare.rows.audioRtfPeakMean", metric: "audioRtfPeak.mean", verdictKind: "latency", digits: 2 },
  { source: "metric", labelKey: "compare.rows.voiceTaxMs", metric: "voiceTax.ms", verdictKind: "latency", format: "latencyMs" },
  { source: "metric", labelKey: "compare.rows.errorRate", metric: "errorRate", verdictKind: "errorRate", format: "percent" },
];
```

`index.ts`(照抄 aiperf/index.ts 结构):

```ts
import type { ToolAdapter } from "../core/interface.js";
import { vllmOmniBenchReadMetric } from "./read-metric.js";
import { buildCommand, getMaxDurationSeconds, parseFinalReport, parseProgress } from "./runtime.js";
import {
  vllmOmniBenchParamDefaults,
  vllmOmniBenchParamsSchema,
  vllmOmniBenchReportSchema,
} from "./schema.js";

export { vllmOmniBenchReadMetric } from "./read-metric.js";
export { vllmOmniBenchRowDescriptors } from "./row-descriptors.js";

export const vllmOmniBenchAdapter: ToolAdapter = {
  name: "vllm-omni-bench",
  scenarios: ["omni"] as const,
  paramsSchema: vllmOmniBenchParamsSchema,
  reportSchema: vllmOmniBenchReportSchema,
  paramDefaults: vllmOmniBenchParamDefaults,
  buildCommand,
  parseProgress,
  parseFinalReport,
  getMaxDurationSeconds,
  readMetric: vllmOmniBenchReadMetric,
};

export type { VllmOmniBenchParams, VllmOmniBenchReport } from "./schema.js";
```

(此时 `scenarios: ["omni"]` 还未注册到 SCENARIOS —— Task 5 完成前 `assertScenariosInvariant` 会失败,属预期。)

- [ ] **Step 8: 跑本目录测试通过**

Run: `pnpm -F @modeldoctor/tool-adapters test -- vllm-omni-bench`
Expected: PASS(runtime.spec + read-metric.spec + schema.spec)

- [ ] **Step 9: Commit**

```bash
git add packages/tool-adapters/src/
git commit -m "feat(tool-adapters): vllm-omni-bench adapter runtime, read-metric, rows"
```

---

### Task 5: 注册收口 —— registry / SCENARIOS / category-defaults / schemas-entry

**Files:**
- Modify: `packages/tool-adapters/src/core/registry.ts`
- Modify: `packages/tool-adapters/src/core/row-descriptors.fe.ts`
- Modify: `packages/tool-adapters/src/scenarios.ts`
- Modify: `packages/tool-adapters/src/category-defaults.ts`
- Modify: `packages/tool-adapters/src/schemas-entry.ts` + `src/index.ts`(导出新 adapter 的 schema/defaults/rows/类型,跟随既有工具的导出清单)
- Test: 既有 `scenarios.spec.ts` / `category-defaults.spec.ts` / `schemas-entry.spec.ts`(如有断言工具清单的用例则更新)

**Interfaces:**
- Consumes: Task 4 的 `vllmOmniBenchAdapter`、`vllmOmniBenchRowDescriptors`。
- Produces: `SCENARIOS.omni`(label "Omni 实时性"、reportComponent `"OmniReport"`)、`VLLM_OMNI_BENCH_CATEGORY_DEFAULTS`。Task 8/10/11 消费。

- [ ] **Step 1: registry + row-descriptors.fe 补键**

`core/registry.ts`:

```ts
import { vllmOmniBenchAdapter } from "../vllm-omni-bench/index.js";
// ADAPTERS 内:
  "vllm-omni-bench": vllmOmniBenchAdapter,
```

`core/row-descriptors.fe.ts`:

```ts
import { vllmOmniBenchRowDescriptors } from "../vllm-omni-bench/row-descriptors.js";
// rowDescriptorsByTool 内:
  "vllm-omni-bench": vllmOmniBenchRowDescriptors,
```

- [ ] **Step 2: SCENARIOS 注册 omni**

`scenarios.ts` — `ScenarioId` 联合、`scenarioIdSchema`、`ScenarioConfig.reportComponent` 联合各加一项,`SCENARIOS` 加:

```ts
  omni: {
    label: "Omni 实时性",
    description:
      "全模态模型语音输出实时性压测:vllm-omni bench 双臂 × 并发档扫描,出 AUDIO_TTFP / " +
      "AUDIO_RTF 曲线、实时天花板(RTF<1 最大并发)与语音税(text vs text+audio ΔE2EL)。",
    tools: ["vllm-omni-bench"],
    paramsConstraints: {},
    reportComponent: "OmniReport",
  },
```

reportComponent 联合追加 `| "OmniReport"`。

- [ ] **Step 3: 新工具的 category defaults**

`category-defaults.ts` 追加:

```ts
import type { VllmOmniBenchParams } from "./vllm-omni-bench/schema.js";

/**
 * vllm-omni-bench 只对 omni 端点有意义(要解析响应音频);其余 category
 * 一律 unsupported。omni 无 connection-shaped 参数字段 → 空对象。
 */
export const VLLM_OMNI_BENCH_CATEGORY_DEFAULTS = {
  chat: { unsupported: true },
  omni: {},
  audio: { unsupported: true },
  embeddings: { unsupported: true },
  rerank: { unsupported: true },
  image: { unsupported: true },
} as const satisfies Record<ModalityCategory, Record<string, never> | { unsupported: true }>;
```

(`VllmOmniBenchParams` import 若未被使用则去掉 —— 空对象形状用不到它。)

- [ ] **Step 4: 全包测试(scenarios invariant 现在应通过)**

Run: `pnpm -F @modeldoctor/tool-adapters build && pnpm -F @modeldoctor/tool-adapters test`
Expected: PASS —— `assertScenariosInvariant` 双向校验 omni↔vllm-omni-bench 成立

- [ ] **Step 5: Commit**

```bash
git add packages/tool-adapters/src/
git commit -m "feat(tool-adapters): register omni scenario + vllm-omni-bench in registry/rows/categories"
```

---

### Task 6: Python omni_driver(runner 内 sweep 驱动)

**Files:**
- Create: `apps/benchmark-runner/runner/tools/__init__.py`(空文件)
- Create: `apps/benchmark-runner/runner/tools/omni_driver.py`
- Create: `apps/benchmark-runner/tests/test_omni_driver.py`
- Create: `apps/benchmark-runner/tests/fixtures/omni_bench_stdout.txt`

**Interfaces:**
- Consumes: Task 4 的 env 契约(`MD_OMNI_PARAMS/…`,必须逐字对齐)。
- Produces: `out/omni_result.json`,形状 = Task 2 的 `vllmOmniBenchReportSchema`(字段名逐字对齐,driver 是生产者)。进度行格式 `[omni-driver] point arm=<arm> c=<c> done (<i>/<n>)` 与 Task 4 的 `parseProgress` 正则对齐。

- [ ] **Step 1: 建 stdout fixture**

`tests/fixtures/omni_bench_stdout.txt`(vllm bench serve 汇总格式,数值取自 repots 实验 omnibench_sweep c=1 一档;若手头有真实完整 stdout,用真实的替换):

```text
============ Serving Benchmark Result ============
Successful requests:                     4
Benchmark duration (s):                  35.20
Total input tokens:                      2000
Total generated tokens:                  1200
Request throughput (req/s):              0.11
Output token throughput (tok/s):         34.09
Total Token throughput (tok/s):          90.91
---------------Time to First Token----------------
Mean TTFT (ms):                          66.30
Median TTFT (ms):                        61.00
P99 TTFT (ms):                           120.50
----------------End-to-end Latency----------------
Mean E2EL (ms):                          8501.20
Median E2EL (ms):                        8400.00
P99 E2EL (ms):                           9100.00
--------------------AUDIO_TTFP--------------------
Mean AUDIO_TTFP (ms):                    511.00
Median AUDIO_TTFP (ms):                  490.00
P99 AUDIO_TTFP (ms):                     900.00
--------------------AUDIO_RTF---------------------
Mean AUDIO_RTF:                          0.19
Median AUDIO_RTF:                        0.18
P99 AUDIO_RTF:                           0.30
==================================================
```

- [ ] **Step 2: 写失败测试**

`tests/test_omni_driver.py`:

```python
import json
from pathlib import Path

import pytest

from runner.tools import omni_driver

FIXTURE = (Path(__file__).parent / "fixtures" / "omni_bench_stdout.txt").read_text()


# ── stdout 解析 ────────────────────────────────────────────────────────
def test_parse_point_audio_arm():
    p = omni_driver.parse_point(FIXTURE, arm="audio")
    assert p["reqPerSec"] == 0.11
    assert p["outTokPerSec"] == 34.09
    assert p["ttftMs"] == {"mean": 66.3, "p50": 61.0, "p99": 120.5}
    assert p["e2elMs"] == {"mean": 8501.2, "p50": 8400.0, "p99": 9100.0}
    assert p["audioTtfpMs"] == {"mean": 511.0, "p50": 490.0, "p99": 900.0}
    assert p["audioRtf"] == {"mean": 0.19, "p50": 0.18, "p99": 0.3}


def test_parse_point_text_arm_has_null_audio():
    text_out = "\n".join(
        line for line in FIXTURE.splitlines() if "AUDIO" not in line
    )
    p = omni_driver.parse_point(text_out, arm="text")
    assert p["audioTtfpMs"] is None and p["audioRtf"] is None
    assert p["reqPerSec"] == 0.11


def test_parse_point_missing_required_metric_returns_none():
    assert omni_driver.parse_point("garbage output", arm="audio") is None
    # audio 臂缺 AUDIO_RTF(端点没回音频)→ 判失败点
    no_rtf = "\n".join(line for line in FIXTURE.splitlines() if "AUDIO_RTF" not in line)
    assert omni_driver.parse_point(no_rtf, arm="audio") is None


# ── bench argv ────────────────────────────────────────────────────────
def test_bench_argv_audio_arm_locks_methodology():
    argv = omni_driver.bench_argv(
        base_url="http://h:30888", model="m", tokenizer="/tokenizers/Qwen/Qwen2.5-Omni-7B",
        arm="audio", concurrency=8,
        params={"inputTokens": 500, "outputTokens": 300, "numWarmups": 1},
    )
    joined = " ".join(argv)
    assert argv[:4] == ["vllm-omni", "bench", "serve", "--omni"]
    assert "--num-prompts 16" in joined          # max(4, 2×8)
    assert "--max-concurrency 8" in joined
    assert "--ignore-eos" in joined
    assert '"modalities": ["text", "audio"]' in joined
    assert "audio_ttfp" in joined                 # percentile-metrics 带 audio
    assert "--api-key" not in joined              # 秘密只走 env


def test_bench_argv_text_arm_no_audio_metrics():
    argv = omni_driver.bench_argv(
        base_url="http://h:30888", model="m", tokenizer="/t",
        arm="text", concurrency=1,
        params={"inputTokens": 500, "outputTokens": 300, "numWarmups": 1},
    )
    joined = " ".join(argv)
    assert '"modalities": ["text"]' in joined
    assert "audio_ttfp" not in joined
    assert "--num-prompts 4" in joined            # max(4, 2×1)


# ── 派生指标 ──────────────────────────────────────────────────────────
def _pt(arm, c, status="ok", rtf_mean=0.5, e2el_mean=9000.0):
    return {
        "arm": arm, "concurrency": c, "status": status,
        "reqPerSec": 0.5 if status == "ok" else None,
        "outTokPerSec": 100.0 if status == "ok" else None,
        "ttftMs": {"mean": 66.0, "p50": 60.0, "p99": 120.0} if status == "ok" else None,
        "e2elMs": {"mean": e2el_mean, "p50": e2el_mean, "p99": e2el_mean * 1.2} if status == "ok" else None,
        "audioTtfpMs": ({"mean": 511.0, "p50": 490.0, "p99": 900.0} if arm == "audio" else None) if status == "ok" else None,
        "audioRtf": ({"mean": rtf_mean, "p50": rtf_mean, "p99": rtf_mean * 1.5} if arm == "audio" else None) if status == "ok" else None,
    }


def test_compute_derived_ceiling_and_voice_tax():
    points = [
        _pt("audio", 1, rtf_mean=0.19, e2el_mean=8000),
        _pt("audio", 32, rtf_mean=0.54, e2el_mean=9800),
        _pt("audio", 64, rtf_mean=1.24, e2el_mean=15000),
        _pt("text", 1, e2el_mean=5000),
        _pt("text", 32, e2el_mean=5000),
    ]
    d = omni_driver.compute_derived(points)
    assert d["realtimeCeiling"] == 32           # 64 档 RTF≥1 不算
    assert d["peakConcurrency"] == 32
    assert d["voiceTaxMsByLevel"] == {"1": 3000.0, "32": 4800.0}
    assert d["voiceTaxMs"] == 4800.0            # 最高共档


def test_compute_derived_all_over_realtime_gives_zero_ceiling():
    d = omni_driver.compute_derived([_pt("audio", 8, rtf_mean=1.3)])
    assert d["realtimeCeiling"] == 0
    assert d["voiceTaxMs"] is None


# ── 主循环容错(subprocess 注入)────────────────────────────────────
def _env(monkeypatch, tmp_path, voice_tax=True, levels=(1, 8)):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("MD_OMNI_PARAMS", json.dumps({
        "concurrencyLevels": list(levels), "inputTokens": 500, "outputTokens": 300,
        "voiceTax": voice_tax, "numWarmups": 1, "perPointTimeoutSeconds": 60,
    }))
    monkeypatch.setenv("MD_OMNI_BASE_URL", "http://h:30888")
    monkeypatch.setenv("MD_OMNI_MODEL", "m")
    monkeypatch.setenv("MD_OMNI_TOKENIZER_HF_ID", "Qwen/Qwen2.5-Omni-7B")


def test_main_continues_after_single_point_failure(monkeypatch, tmp_path):
    _env(monkeypatch, tmp_path, voice_tax=False, levels=(1, 8))
    monkeypatch.setattr(omni_driver, "resolve_tokenizer", lambda hf_id: "/t")
    calls = []

    def fake_run_bench(argv, timeout):
        calls.append(argv)
        if "--max-concurrency 8" in " ".join(argv):
            return (1, "boom")                   # c=8 失败
        return (0, FIXTURE)

    monkeypatch.setattr(omni_driver, "run_bench", fake_run_bench)
    rc = omni_driver.main()
    assert rc == 0                               # 有 ok 点 → 整体成功
    result = json.loads((tmp_path / "out" / "omni_result.json").read_text())
    assert len(result["curve"]) == 2
    statuses = {p["concurrency"]: p["status"] for p in result["curve"]}
    assert statuses == {1: "ok", 8: "failed"}
    assert any("c=8" in w for w in result["warnings"])


def test_main_all_points_failed_exits_nonzero(monkeypatch, tmp_path):
    _env(monkeypatch, tmp_path, voice_tax=False, levels=(1,))
    monkeypatch.setattr(omni_driver, "resolve_tokenizer", lambda hf_id: "/t")
    monkeypatch.setattr(omni_driver, "run_bench", lambda argv, timeout: (1, "boom"))
    rc = omni_driver.main()
    assert rc == 1
    # result.json 仍要写出(带全 failed 曲线),供事后排障
    assert (tmp_path / "out" / "omni_result.json").exists()


def test_main_runs_both_arms_when_voice_tax(monkeypatch, tmp_path):
    _env(monkeypatch, tmp_path, voice_tax=True, levels=(1,))
    monkeypatch.setattr(omni_driver, "resolve_tokenizer", lambda hf_id: "/t")
    seen_modalities = []

    def fake_run_bench(argv, timeout):
        seen_modalities.append(next(a for a in argv if "modalities" in a))
        return (0, FIXTURE)

    monkeypatch.setattr(omni_driver, "run_bench", fake_run_bench)
    assert omni_driver.main() == 0
    assert len(seen_modalities) == 2             # audio 臂 + text 臂


# ── tokenizer 解析 ────────────────────────────────────────────────────
def test_resolve_tokenizer_prefers_baked_dir(monkeypatch, tmp_path):
    baked = tmp_path / "tokenizers" / "Qwen" / "Qwen2.5-Omni-7B"
    baked.mkdir(parents=True)
    monkeypatch.setattr(omni_driver, "TOKENIZERS_ROOT", tmp_path / "tokenizers")
    assert omni_driver.resolve_tokenizer("Qwen/Qwen2.5-Omni-7B") == str(baked)


def test_resolve_tokenizer_falls_back_to_hf_endpoint(monkeypatch, tmp_path):
    monkeypatch.setattr(omni_driver, "TOKENIZERS_ROOT", tmp_path / "nope")
    monkeypatch.setenv("HF_ENDPOINT", "https://hf-mirror.internal")
    assert omni_driver.resolve_tokenizer("Qwen/X") == "Qwen/X"


def test_resolve_tokenizer_fails_fast_with_guidance(monkeypatch, tmp_path):
    monkeypatch.setattr(omni_driver, "TOKENIZERS_ROOT", tmp_path / "nope")
    monkeypatch.delenv("HF_ENDPOINT", raising=False)
    with pytest.raises(SystemExit, match="tokenizer"):
        omni_driver.resolve_tokenizer("Qwen/X")
    with pytest.raises(SystemExit, match="tokenizerHfId"):
        omni_driver.resolve_tokenizer(None)
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd apps/benchmark-runner && python -m pytest tests/test_omni_driver.py -v`
Expected: FAIL — No module named 'runner.tools'

- [ ] **Step 4: 实现 omni_driver.py**

```python
"""Omni sweep driver: 循环 `vllm-omni bench serve --omni` 扫 双臂 × 并发档,
逐点解析 stdout 汇总,聚合写 out/omni_result.json(形状 = vllmOmniBenchReportSchema)。

由通用 wrapper 以工具 argv 启动: python -m runner.tools.omni_driver
契约(packages/tool-adapters/src/vllm-omni-bench/runtime.ts 写入):
  MD_OMNI_PARAMS            params JSON(concurrencyLevels/inputTokens/outputTokens/
                            voiceTax/numWarmups/perPointTimeoutSeconds)
  MD_OMNI_BASE_URL          上游 base URL(无尾斜杠)
  MD_OMNI_MODEL             served model 名
  MD_OMNI_TOKENIZER_HF_ID   可选 HF tokenizer repo id
  OPENAI_API_KEY            (secretEnv) vllm bench openai 后端自取作 Bearer
方法学纪律(写死): 双臂同 max_tokens、--ignore-eos、num-prompts = max(4, 2×c)。
"""

from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import sys
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="[omni-driver] %(message)s")
log = logging.getLogger("omni-driver")

OUT_DIR = Path("out")
RESULT_FILE = OUT_DIR / "omni_result.json"
TOKENIZERS_ROOT = Path("/tokenizers")

# 数值行:标签允许 (ms) 等单位尾缀,冒号后取第一个浮点。
def _rx(label: str) -> re.Pattern[str]:
    return re.compile(rf"^{re.escape(label)}[^:]*:\s*([\d.]+)\s*$", re.MULTILINE)


_PATTERNS = {
    "reqPerSec": _rx("Request throughput (req/s)"),
    "outTokPerSec": _rx("Output token throughput (tok/s)"),
    "ttft_mean": _rx("Mean TTFT"),
    "ttft_p50": _rx("Median TTFT"),
    "ttft_p99": _rx("P99 TTFT"),
    "e2el_mean": _rx("Mean E2EL"),
    "e2el_p50": _rx("Median E2EL"),
    "e2el_p99": _rx("P99 E2EL"),
    "audio_ttfp_mean": _rx("Mean AUDIO_TTFP"),
    "audio_ttfp_p50": _rx("Median AUDIO_TTFP"),
    "audio_ttfp_p99": _rx("P99 AUDIO_TTFP"),
    "audio_rtf_mean": _rx("Mean AUDIO_RTF"),
    "audio_rtf_p50": _rx("Median AUDIO_RTF"),
    "audio_rtf_p99": _rx("P99 AUDIO_RTF"),
}


def _grab(stdout: str, key: str) -> float | None:
    m = _PATTERNS[key].search(stdout)
    return float(m.group(1)) if m else None


def _stat(stdout: str, prefix: str) -> dict[str, float] | None:
    mean = _grab(stdout, f"{prefix}_mean")
    p50 = _grab(stdout, f"{prefix}_p50")
    p99 = _grab(stdout, f"{prefix}_p99")
    if mean is None or p50 is None or p99 is None:
        return None
    return {"mean": mean, "p50": p50, "p99": p99}


def parse_point(stdout: str, arm: str) -> dict | None:
    """一档 bench stdout → curve point 数值部分;缺必要指标返回 None(判失败点)。

    必要指标: reqPerSec + ttft + e2el;audio 臂还必须有 audio_ttfp + audio_rtf
    (端点没回音频时 bench 的 AUDIO_* 段缺失 → 判失败,warning 提示查 modalities)。
    """
    req = _grab(stdout, "reqPerSec")
    ttft = _stat(stdout, "ttft")
    e2el = _stat(stdout, "e2el")
    if req is None or ttft is None or e2el is None:
        return None
    audio_ttfp = _stat(stdout, "audio_ttfp")
    audio_rtf = _stat(stdout, "audio_rtf")
    if arm == "audio" and (audio_ttfp is None or audio_rtf is None):
        return None
    return {
        "reqPerSec": req,
        "outTokPerSec": _grab(stdout, "outTokPerSec") or 0.0,
        "ttftMs": ttft,
        "e2elMs": e2el,
        "audioTtfpMs": audio_ttfp if arm == "audio" else None,
        "audioRtf": audio_rtf if arm == "audio" else None,
    }


def bench_argv(
    *, base_url: str, model: str, tokenizer: str, arm: str, concurrency: int, params: dict
) -> list[str]:
    modalities = ["text", "audio"] if arm == "audio" else ["text"]
    pct = "ttft,e2el,audio_ttfp,audio_rtf" if arm == "audio" else "ttft,e2el"
    return [
        "vllm-omni", "bench", "serve", "--omni",
        "--backend", "openai-chat-omni",
        "--base-url", base_url,
        "--endpoint", "/v1/chat/completions",
        "--model", model,
        "--tokenizer", tokenizer,
        "--dataset-name", "random",
        "--random-input-len", str(params["inputTokens"]),
        "--random-output-len", str(params["outputTokens"]),
        "--num-prompts", str(max(4, 2 * concurrency)),
        "--max-concurrency", str(concurrency),
        "--num-warmups", str(params["numWarmups"]),
        "--ignore-eos",
        "--extra-body", json.dumps({"modalities": modalities}),
        "--percentile-metrics", pct,
    ]


def run_bench(argv: list[str], timeout: int) -> tuple[int, str]:
    """跑一档 bench;返回 (returncode, stdout+stderr 合流文本)。

    测试通过 monkeypatch 替换本函数注入假输出。stdout 事后整体打印(tee 到
    pod log),不做流式 —— bench 的 Rich 进度条本就不适合逐行转发。
    """
    try:
        proc = subprocess.run(  # noqa: S603 - argv 内部构造
            argv, capture_output=True, text=True, timeout=timeout
        )
    except subprocess.TimeoutExpired:
        return (124, f"bench timed out after {timeout}s")
    return (proc.returncode, (proc.stdout or "") + "\n" + (proc.stderr or ""))


def resolve_tokenizer(hf_id: str | None) -> str:
    if not hf_id:
        raise SystemExit(
            "tokenizer required: set tokenizerHfId on the Connection "
            "(baked under /tokenizers/<org>/<name>) or provide HF_ENDPOINT"
        )
    baked = TOKENIZERS_ROOT / hf_id
    if baked.is_dir():
        return str(baked)
    if os.environ.get("HF_ENDPOINT"):
        return hf_id  # bench 自行从内网镜像源拉
    raise SystemExit(
        f"tokenizer '{hf_id}' not baked into the image ({TOKENIZERS_ROOT}) and "
        "HF_ENDPOINT is unset — bake it or point HF_ENDPOINT at an internal mirror"
    )


def compute_derived(points: list[dict]) -> dict:
    audio_ok = [p for p in points if p["arm"] == "audio" and p["status"] == "ok"]
    realtime = [p["concurrency"] for p in audio_ok if p["audioRtf"] and p["audioRtf"]["mean"] < 1.0]
    ceiling = max(realtime) if realtime else 0
    text_by_c = {
        p["concurrency"]: p for p in points if p["arm"] == "text" and p["status"] == "ok"
    }
    tax: dict[str, float] = {}
    for p in audio_ok:
        t = text_by_c.get(p["concurrency"])
        if t and p["e2elMs"] and t["e2elMs"]:
            tax[str(p["concurrency"])] = round(p["e2elMs"]["mean"] - t["e2elMs"]["mean"], 1)
    shared = [int(k) for k in tax]
    return {
        "realtimeCeiling": ceiling,
        "peakConcurrency": ceiling,
        "voiceTaxMsByLevel": tax,
        "voiceTaxMs": tax[str(max(shared))] if shared else None,
    }


def main() -> int:
    params = json.loads(os.environ["MD_OMNI_PARAMS"])
    base_url = os.environ["MD_OMNI_BASE_URL"]
    model = os.environ["MD_OMNI_MODEL"]
    tokenizer = resolve_tokenizer(os.environ.get("MD_OMNI_TOKENIZER_HF_ID"))

    arms = ["audio"] + (["text"] if params.get("voiceTax") else [])
    plan = [(arm, c) for arm in arms for c in params["concurrencyLevels"]]
    timeout = int(params["perPointTimeoutSeconds"])

    points: list[dict] = []
    warnings: list[str] = []
    for i, (arm, c) in enumerate(plan, start=1):
        argv = bench_argv(
            base_url=base_url, model=model, tokenizer=tokenizer,
            arm=arm, concurrency=c, params=params,
        )
        log.info("bench start arm=%s c=%d (%d/%d)", arm, c, i, len(plan))
        rc, output = run_bench(argv, timeout)
        print(output, flush=True)  # tee 到 pod log,事后可查每档原始汇总
        parsed = parse_point(output, arm) if rc == 0 else None
        if parsed is None:
            reason = f"bench exited {rc}" if rc != 0 else "summary metrics missing from output"
            if rc == 0 and arm == "audio":
                reason += " (no AUDIO_* section — endpoint may not return audio; check modalities)"
            warnings.append(f"arm={arm} c={c}: {reason}, point skipped")
            points.append({
                "arm": arm, "concurrency": c, "status": "failed",
                "reqPerSec": None, "outTokPerSec": None,
                "ttftMs": None, "e2elMs": None, "audioTtfpMs": None, "audioRtf": None,
            })
        else:
            points.append({"arm": arm, "concurrency": c, "status": "ok", **parsed})
        # 进度行 —— adapter parseProgress 的契约格式,勿改。
        log.info("point arm=%s c=%d done (%d/%d)", arm, c, i, len(plan))

    result = {"curve": points, "derived": compute_derived(points), "warnings": warnings}
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    RESULT_FILE.write_text(json.dumps(result, indent=2))

    ok = sum(1 for p in points if p["status"] == "ok")
    log.info("done: %d/%d points ok, %d warnings", ok, len(points), len(warnings))
    return 0 if ok > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
```

注意:进度行经 `logging`(format=`[omni-driver] %(message)s`)输出到 stderr —— 与 Task 4 `parseProgress` 匹配的是整行 `[omni-driver] point …`,API 侧对 stdout/stderr 都过 parseProgress(StreamPump 两路都 tee);若实现时发现只解析 stdout,则把进度行改成 `print(f"[omni-driver] point …", flush=True)`,测试同步断言。

- [ ] **Step 5: 跑测试确认通过**

Run: `cd apps/benchmark-runner && python -m pytest tests/test_omni_driver.py -v`
Expected: 全部 PASS

- [ ] **Step 6: ruff + 既有测试回归**

Run: `cd apps/benchmark-runner && ruff check runner/ tests/ && python -m pytest tests/ -q`
Expected: PASS(通用 wrapper 零改动,回归绿)

- [ ] **Step 7: Commit**

```bash
git add apps/benchmark-runner/
git commit -m "feat(benchmark-runner): omni_driver sweep loop (arms × concurrency, per-point fault tolerance)"
```

---

### Task 7: Runner 镜像 + 镜像注册(runner-images.ts / env.schema)

**Files:**
- Create: `apps/benchmark-runner/images/vllm-omni-bench.base.Dockerfile`
- Create: `apps/benchmark-runner/images/vllm-omni-bench.Dockerfile`
- Modify: `tools/build-base-images.sh`、`tools/build-runner-images.sh`(把 vllm-omni-bench 纳入工具清单,跟随 aiperf 的段落结构)
- Modify: `apps/api/src/modules/benchmark/k8s/runner-images.ts`
- Modify: `apps/api/src/config/env.schema.ts`
- Modify: `apps/api/.env.example`(若存在,补 `RUNNER_IMAGE_VLLM_OMNI_BENCH=`)

**Interfaces:**
- Consumes: Task 5 的 ToolName 注册(`Record<ToolName, keyof Env>` 穷尽门此刻在 runner-images.ts 报缺键 —— 本任务修复)。
- Produces: env var `RUNNER_IMAGE_VLLM_OMNI_BENCH`。

- [ ] **Step 1: base Dockerfile**

`apps/benchmark-runner/images/vllm-omni-bench.base.Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1.6
# Base image for the vllm-omni-bench runner.
# vLLM-Omni 服务镜像自带 `vllm-omni bench` CLI(约 8 GiB —— bench 代码 import
# vllm 内部模块,瘦身需手工摘抄、跨版本脆弱,v1 直接复用,spec §2)。
# 生产集群应改从内网 SWR 引用同一 tag,避免跨网拉 8 GiB。
#
#   ./tools/build-base-images.sh vllm-omni-bench
#
# 预置 tokenizer:build-base-images.sh 在宿主机预下载(pattern 同 aiperf 的
# ShareGPT 预下载)到 .tokenizers/<org>/<name>/,COPY 进 /tokenizers。
# driver 的解析顺序:/tokenizers/<hfId> → HF_ENDPOINT → fail fast。
ARG VLLM_OMNI_VERSION=v0.24.0
FROM swr.cn-north-4.myhuaweicloud.com/inference-engines/vllm-omni:${VLLM_OMNI_VERSION}

# 已知 omni 模型的 tokenizer 文件(每个几十 MB,非权重):
#   Qwen/Qwen2.5-Omni-7B  Qwen/Qwen3-Omni-30B-A3B-Instruct
COPY .tokenizers/ /tokenizers/
```

- [ ] **Step 2: runner Dockerfile**

`apps/benchmark-runner/images/vllm-omni-bench.Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1.6
# vllm-omni-bench runner — thin wrapper on the vllm-omni base image.
# Rebuild whenever runner/ changes; base 见 vllm-omni-bench.base.Dockerfile。
FROM ghcr.io/weetime/md-base-vllm-omni-bench:0.24.0

WORKDIR /app

RUN pip install --no-cache-dir --disable-pip-version-check 'requests>=2.31,<3' 'boto3>=1.34,<2'

COPY runner runner

ENTRYPOINT ["python", "-m", "runner"]
```

(基础镜像以 root 跑 —— bench 是纯客户端,与其他 runner 镜像的 useradd 收敛留作后续;若 base 镜像自带非 root 用户则跟随之。)

- [ ] **Step 3: 纳入两个 build 脚本**

`tools/build-base-images.sh`:照抄 aiperf 段落新增 `vllm-omni-bench` 分支 —— 版本变量 `VLLM_OMNI_VERSION=v0.24.0`,tag `ghcr.io/weetime/md-base-vllm-omni-bench:0.24.0`;构建前用 `huggingface-cli download Qwen/Qwen2.5-Omni-7B --include "tokenizer*" "*.json" --exclude "*.safetensors*" --local-dir apps/benchmark-runner/images/.tokenizers/Qwen/Qwen2.5-Omni-7B`(以及 Qwen3-Omni-30B-A3B-Instruct 同式)预下载 tokenizer(pattern 同 ShareGPT 宿主机预下载注释)。
`tools/build-runner-images.sh`:工具清单加 `vllm-omni-bench`(它按 images/*.Dockerfile 命名约定发现工具的话则无需改动 —— 打开脚本确认)。

- [ ] **Step 4: runner-images.ts + env.schema.ts**

`k8s/runner-images.ts`:

```ts
  "vllm-omni-bench": "RUNNER_IMAGE_VLLM_OMNI_BENCH",
```

`config/env.schema.ts`(RUNNER_IMAGE_TAU3 行后):

```ts
  RUNNER_IMAGE_VLLM_OMNI_BENCH: z.string().min(1),
```

`.env.example` 补一行(值示例 `ghcr.io/weetime/md-runner-vllm-omni-bench:dev`)。

- [ ] **Step 5: api 测试确认 env 穷尽**

Run: `pnpm -F @modeldoctor/api test -- runner-images 2>/dev/null || pnpm -F @modeldoctor/api build`
Expected: 编译通过;若 api 测试套件对 env mock 有 seed 清单,补 `RUNNER_IMAGE_VLLM_OMNI_BENCH`(报错会点名)

- [ ] **Step 6: Commit**

```bash
git add apps/benchmark-runner/images/ tools/ apps/api/
git commit -m "feat(runner): vllm-omni-bench runner image (vllm-omni v0.24.0 base + baked tokenizers)"
```

---

### Task 8: API 收口(编译级)

**Files:**
- Modify: typecheck 报出的 api 侧 `Record<ScenarioId, …>` / `Record<ToolName, …>` / switch 站点(候选:`apps/api/src/modules/insights/matrix.service.ts`、benchmark.service 的 scenario 相关分支)
- Test: `pnpm -F @modeldoctor/api test`

**Interfaces:**
- Consumes: Task 1/5/7 的枚举与注册。
- Produces: api 包编译+测试绿;`POST /api/benchmarks {scenario:"omni", tool:"vllm-omni-bench"}` 经 `applyScenarioConstraints` + `adapter.paramsSchema` 全链路校验可用(既有 generic 代码,无新逻辑)。

- [ ] **Step 1: typecheck 清零**

Run: `pnpm -F @modeldoctor/api build`
逐个补 omni 分支:matrix 聚合(scenario 列表来自 contracts enum 的话自动生效)、任何 switch(scenario) 的 UI 无关分支给 omni 走 generic 路径。

- [ ] **Step 2: api 测试回归**

Run: `pnpm -F @modeldoctor/api test`
Expected: PASS(benchmark.service.spec 若快照了工具/场景清单,更新快照)

- [ ] **Step 3: Commit**

```bash
git add apps/api/
git commit -m "feat(api): omni scenario compile-through (matrix/service enum widening)"
```

---

### Task 9: Insights 评分规则 + 官方模板 + profile 阈值

**Files:**
- Create: `packages/insights-scoring/src/checks/omni.ts`
- Modify: `packages/insights-scoring/src/descriptors.ts`(ALL_CHECKS 拼接)
- Modify: `apps/api/prisma/seed.ts`(2 个官方模板 + default profile 的 omni 阈值)
- Test: `packages/insights-scoring/src/checks/omni.spec.ts`

**Interfaces:**
- Consumes: Task 3 的 MetricKind、Task 1 的 scenario/tool 枚举。
- Produces: check ids `omni.realtime_ceiling` / `omni.audio_ttfp.c1.mean.ms` / `omni.audio_ttfp.peak.p99.ms` / `omni.audio_rtf.peak.mean` / `omni.voice_tax.ms` / `omni.error_rate`;模板 ids `tpl_official_omni_realtime_standard` / `tpl_official_omni_realtime_quick`。

- [ ] **Step 1: 写失败测试**

`packages/insights-scoring/src/checks/omni.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ALL_CHECKS, getCheck } from "../descriptors.js";
import { omniChecks } from "./omni.js";

describe("omni checks", () => {
  it("registers 6 omni checks in ALL_CHECKS", () => {
    const ids = ALL_CHECKS.filter((c) => c.scenario === "omni").map((c) => c.id);
    expect(ids).toEqual([
      "omni.realtime_ceiling",
      "omni.audio_ttfp.c1.mean.ms",
      "omni.audio_ttfp.peak.p99.ms",
      "omni.audio_rtf.peak.mean",
      "omni.voice_tax.ms",
      "omni.error_rate",
    ]);
  });
  it("realtime ceiling is higher_is_better on the throughput axis", () => {
    const c = getCheck("omni.realtime_ceiling");
    expect(c?.direction).toBe("higher_is_better");
    expect(c?.axis).toBe("throughput");
    expect(c?.metricKind).toBe("realtimeCeiling");
  });
  it("all omni checks filter to the vllm-omni-bench tool", () => {
    for (const c of omniChecks) expect(c.toolFilter).toEqual(["vllm-omni-bench"]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F @modeldoctor/insights-scoring test -- omni`
Expected: FAIL — Cannot find module './omni.js'

- [ ] **Step 3: 实现 checks/omni.ts + 注册**

```ts
import type { CheckDescriptor } from "../descriptors.js";

// 阈值语义见 spec §4.7:TTFP p50 <1s 优 / <3s 可;RTF mean <0.7 富余 /
// <1 达标 / ≥1 超载。warn/crit 数值落在 seed.ts 的 default profile 里。
export const omniChecks: CheckDescriptor[] = [
  {
    id: "omni.realtime_ceiling",
    scenario: "omni",
    toolFilter: ["vllm-omni-bench"],
    axis: "throughput",
    defaultWeight: 1.0,
    direction: "higher_is_better",
    metricKind: "realtimeCeiling",
  },
  {
    id: "omni.audio_ttfp.c1.mean.ms",
    scenario: "omni",
    toolFilter: ["vllm-omni-bench"],
    axis: "responsiveness",
    defaultWeight: 1.0,
    direction: "lower_is_better",
    metricKind: "audioTtfpC1.mean",
  },
  {
    id: "omni.audio_ttfp.peak.p99.ms",
    scenario: "omni",
    toolFilter: ["vllm-omni-bench"],
    axis: "tail",
    defaultWeight: 0.5,
    direction: "lower_is_better",
    metricKind: "audioTtfpPeak.p99",
  },
  {
    id: "omni.audio_rtf.peak.mean",
    scenario: "omni",
    toolFilter: ["vllm-omni-bench"],
    axis: "smoothness",
    defaultWeight: 1.0,
    direction: "lower_is_better",
    metricKind: "audioRtfPeak.mean",
  },
  {
    id: "omni.voice_tax.ms",
    scenario: "omni",
    toolFilter: ["vllm-omni-bench"],
    axis: "efficiency",
    defaultWeight: 0.5,
    direction: "lower_is_better",
    metricKind: "voiceTax.ms",
  },
  {
    id: "omni.error_rate",
    scenario: "omni",
    toolFilter: ["vllm-omni-bench"],
    axis: "stability",
    defaultWeight: 1.0,
    direction: "lower_is_better",
    metricKind: "errorRate",
  },
];
```

`descriptors.ts`:

```ts
import { omniChecks } from "./checks/omni.js";
// ALL_CHECKS 拼接追加:
  ...omniChecks,
```

- [ ] **Step 4: seed.ts —— 模板 + profile 阈值**

官方模板数组追加(位置放 agent 模板段之后,注释风格跟随):

```ts
  // -------------------------------------------------------------------------
  // Omni 实时性(vllm-omni-bench):双臂 × 并发档扫描,出 AUDIO_TTFP/RTF 曲线、
  // 实时天花板、语音税。方法学 = 2026-07 Qwen3-Omni 实验(spec 2026-07-16)。
  // -------------------------------------------------------------------------
  {
    id: "tpl_official_omni_realtime_standard",
    name: "Omni 实时性 · 标准扫描",
    description:
      "500in/300out,并发 1/8/16/32 双臂(text+audio vs text)扫描;产出实时天花板 + 语音税。全程约 30-60 分钟。",
    scenario: "omni",
    tool: "vllm-omni-bench",
    config: {
      concurrencyLevels: [1, 8, 16, 32],
      inputTokens: 500,
      outputTokens: 300,
      voiceTax: true,
      numWarmups: 1,
      perPointTimeoutSeconds: 900,
    },
    tags: ["omni", "realtime", "voice"],
    categories: ["omni"],
  },
  {
    id: "tpl_official_omni_realtime_quick",
    name: "Omni 实时性 · 快检",
    description: "并发 1/8 单臂(text+audio),验证链路 + 基线 TTFP/RTF,约 10 分钟。",
    scenario: "omni",
    tool: "vllm-omni-bench",
    config: {
      concurrencyLevels: [1, 8],
      inputTokens: 500,
      outputTokens: 300,
      voiceTax: false,
      numWarmups: 1,
      perPointTimeoutSeconds: 900,
    },
    tags: ["omni", "smoke"],
    categories: ["omni"],
  },
```

default profile(`clxprofdefault0000000000`)的 `rules.checks` 追加(阈值 = spec §4.7;`omni.realtime_ceiling` 的 warn/crit 语义跟随既有 higher_is_better 检查 —— 照 `COMMON_THROUGHPUT_AND_CAPACITY_CHECKS` 里 throughput 规则的写法核对一次再落值):

```ts
        "omni.audio_ttfp.c1.mean.ms": { warn: 1000, crit: 3000, weight: 1.0 },
        "omni.audio_ttfp.peak.p99.ms": { warn: 3000, crit: 8000, weight: 0.5 },
        "omni.audio_rtf.peak.mean": { warn: 0.7, crit: 1.0, weight: 1.0 },
        "omni.voice_tax.ms": { warn: 4000, crit: 10000, weight: 0.5 },
        "omni.error_rate": { warn: 0.01, crit: 0.05, weight: 1.0 },
        "omni.realtime_ceiling": { warn: 16, crit: 4, weight: 1.0 },
```

- [ ] **Step 5: 测试 + seed 干跑**

Run: `pnpm -F @modeldoctor/insights-scoring test && pnpm -F @modeldoctor/api exec prisma db seed 2>&1 | tail -5`
Expected: 测试 PASS;seed 幂等完成(本地 DB 可用时;否则跳过干跑,由 CI 覆盖)

- [ ] **Step 6: Commit**

```bash
git add packages/insights-scoring/ apps/api/prisma/seed.ts
git commit -m "feat(insights): omni scoring checks + official omni templates + profile thresholds"
```

---

### Task 10: Web 接线 —— 场景页 / 表单 / 侧边栏 / i18n

**Files:**
- Create: `apps/web/src/features/benchmarks/BenchmarkOmniPage.tsx`
- Create: `apps/web/src/features/benchmarks/forms/VllmOmniBenchParamsForm.tsx`
- Modify: `apps/web/src/features/benchmarks/forms/ToolParamsEditor.tsx`(TOOL_CATEGORY_DEFAULTS、TOOL_DEFAULTS、pickParamsForm 三处)
- Modify: `apps/web/src/features/benchmarks/scenarios.ts`(SCENARIO_ICONS)
- Modify: `apps/web/src/router/index.tsx`、`apps/web/src/components/sidebar/sidebar-config.tsx`
- Modify: `apps/web/src/locales/{zh-CN,en-US}/sidebar.json`、`apps/web/src/locales/{zh-CN,en-US}/benchmarks.json`

**Interfaces:**
- Consumes: Task 5 的 `SCENARIOS.omni`、`VLLM_OMNI_BENCH_CATEGORY_DEFAULTS`、`vllmOmniBenchParamDefaults`(经 `@modeldoctor/tool-adapters/schemas`)。
- Produces: 路由 `/benchmarks/omni`;表单字段名与 `vllmOmniBenchParamsSchema` 逐字对齐。

- [ ] **Step 1: 场景页 + 路由 + 侧边栏 + 图标**

`BenchmarkOmniPage.tsx`:

```tsx
import { BenchmarkListShell } from "./BenchmarkListShell";

export function BenchmarkOmniPage() {
  return <BenchmarkListShell scenario="omni" />;
}
```

`router/index.tsx`(agent 行后):

```tsx
import { BenchmarkOmniPage } from "@/features/benchmarks/BenchmarkOmniPage";
// routes:
          { path: "benchmarks/omni", element: <BenchmarkOmniPage /> },
```

`sidebar-config.tsx`(agent 条目后;`AudioWaveform` 来自 lucide-react):

```tsx
      { to: "/benchmarks/omni", icon: AudioWaveform, labelKey: "items.benchmarkOmni" },
```

`features/benchmarks/scenarios.ts`:

```ts
import { AudioWaveform } from "lucide-react";
// SCENARIO_ICONS:
  omni: AudioWaveform,
```

`locales/zh-CN/sidebar.json`:`"benchmarkOmni": "Omni 实时性"`;`en-US`:`"benchmarkOmni": "Omni Realtime"`。

- [ ] **Step 2: 参数表单**

`forms/VllmOmniBenchParamsForm.tsx`(react-hook-form 风格跟随 AiperfParamsForm;并发档用逗号分隔文本 → 数组):

```tsx
import { useFormContext, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { FormSection } from "@/components/common/form-section";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/** 逗号分隔并发档 ↔ number[]。非法片段丢弃,由 zod 兜底校验。 */
function parseLevels(text: string): number[] {
  return text
    .split(",")
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

export function VllmOmniBenchParamsForm() {
  const { t } = useTranslation("benchmarks");
  const { register, setValue, control } = useFormContext();
  const levels: number[] = useWatch({ control, name: "params.concurrencyLevels" }) ?? [];
  const voiceTax: boolean = useWatch({ control, name: "params.voiceTax" }) ?? true;

  return (
    <FormSection title={t("form.omni.title")}>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="omni-levels">{t("form.omni.concurrencyLevels")}</Label>
          <Input
            id="omni-levels"
            defaultValue={levels.join(",")}
            onChange={(e) =>
              setValue("params.concurrencyLevels", parseLevels(e.target.value), {
                shouldValidate: true,
              })
            }
            placeholder="1,8,16,32"
          />
          <p className="text-xs text-muted-foreground">{t("form.omni.concurrencyLevelsHint")}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="omni-input">{t("form.omni.inputTokens")}</Label>
          <Input id="omni-input" type="number" {...register("params.inputTokens", { valueAsNumber: true })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="omni-output">{t("form.omni.outputTokens")}</Label>
          <Input id="omni-output" type="number" {...register("params.outputTokens", { valueAsNumber: true })} />
          <p className="text-xs text-muted-foreground">{t("form.omni.outputTokensHint")}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="omni-timeout">{t("form.omni.perPointTimeout")}</Label>
          <Input id="omni-timeout" type="number" {...register("params.perPointTimeoutSeconds", { valueAsNumber: true })} />
        </div>
        <div className="flex items-center gap-2 md:col-span-2">
          <Switch
            id="omni-voicetax"
            checked={voiceTax}
            onCheckedChange={(v) => setValue("params.voiceTax", v)}
          />
          <Label htmlFor="omni-voicetax">{t("form.omni.voiceTax")}</Label>
          <p className="text-xs text-muted-foreground">{t("form.omni.voiceTaxHint")}</p>
        </div>
      </div>
    </FormSection>
  );
}
```

(UI 组件路径以仓内既有表单 import 为准 —— 若无 `Switch` 则用既有 checkbox 组件替换,交互不变。)

`locales/zh-CN/benchmarks.json` 补 `form.omni.*`:

```json
"omni": {
  "title": "Omni 实时性参数",
  "concurrencyLevels": "并发档(逗号分隔)",
  "concurrencyLevelsHint": "一个 run 内逐档扫描,最多 10 档",
  "inputTokens": "输入长度 (tokens)",
  "outputTokens": "输出长度 (tokens)",
  "outputTokensHint": "双臂共用;RTF 与音频时长强相关,勿在对比臂间改动",
  "perPointTimeout": "单档超时 (秒)",
  "voiceTax": "语音税对照臂",
  "voiceTaxHint": "追加 text-only 同参臂,产出 text+audio 与 text 的 ΔE2EL"
}
```

(en-US 对应英文;`tools` 段补 `"vllm-omni-bench": "vLLM-Omni Bench:官方全模态压测(AUDIO_TTFP/RTF)"` 双语。)

- [ ] **Step 3: ToolParamsEditor 三处接线**

```tsx
import { VLLM_OMNI_BENCH_CATEGORY_DEFAULTS, vllmOmniBenchParamDefaults } from "@modeldoctor/tool-adapters/schemas";
import { VllmOmniBenchParamsForm } from "./VllmOmniBenchParamsForm";
// TOOL_CATEGORY_DEFAULTS:
  "vllm-omni-bench": VLLM_OMNI_BENCH_CATEGORY_DEFAULTS,
// TOOL_DEFAULTS:
  "vllm-omni-bench": vllmOmniBenchParamDefaults,
// pickParamsForm switch:
    case "vllm-omni-bench":
      return VllmOmniBenchParamsForm;
```

- [ ] **Step 4: web 编译 + 手测**

Run: `pnpm -F @modeldoctor/web build`
Expected: 编译过。`pnpm dev` 打开 `/benchmarks/omni` → 新建 → 选 omni connection → vllm-omni-bench 表单渲染,模板 popover 能按 omni category 过滤出两个官方模板(Task 9 seed 后)。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/
git commit -m "feat(web): omni scenario tab + vllm-omni-bench params form"
```

---

### Task 11: OmniReport 报告组件

**Files:**
- Create: `apps/web/src/features/benchmarks/reports/OmniReport.tsx`
- Modify: `apps/web/src/features/benchmarks/BenchmarkDetailPage.tsx`(dispatch)
- Modify: `apps/web/src/locales/{zh-CN,en-US}/benchmarks.json`(`report.omni.*` + compare.rows 4 键)

**Interfaces:**
- Consumes: `benchmark.summaryMetrics` = `{tool:"vllm-omni-bench", data: VllmOmniBenchReport}`;`vllmOmniBenchReportSchema`(从 `@modeldoctor/tool-adapters/schemas`)。
- Produces: `OmniReport({ benchmark })` —— detail 页按 `SCENARIOS.omni.reportComponent` 分发。

- [ ] **Step 1: 实现 OmniReport(echarts,风格对齐 AgentReport 的 Card/StatTile)**

```tsx
import type { Benchmark } from "@modeldoctor/contracts";
import {
  type VllmOmniBenchReport,
  vllmOmniBenchReportSchema,
} from "@modeldoctor/tool-adapters/schemas";
import ReactECharts from "echarts-for-react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UnknownReport } from "./UnknownReport";

export interface OmniReportProps {
  benchmark: Benchmark;
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold">{value}</div>
        {sub ? <div className="text-xs text-muted-foreground">{sub}</div> : null}
      </CardContent>
    </Card>
  );
}

function curveSeries(report: VllmOmniBenchReport, pick: (p: VllmOmniBenchReport["curve"][number]) => number | null) {
  const pts = report.curve
    .filter((p) => p.arm === "audio" && p.status === "ok")
    .sort((a, b) => a.concurrency - b.concurrency);
  return pts.map((p) => [p.concurrency, pick(p)]);
}

export function OmniReport({ benchmark }: OmniReportProps) {
  const { t } = useTranslation("benchmarks");
  const parsed = vllmOmniBenchReportSchema.safeParse(
    (benchmark.summaryMetrics as { data?: unknown } | null)?.data,
  );
  if (!parsed.success) return <UnknownReport benchmark={benchmark} />;
  const r = parsed.data;
  const peak = r.curve.find(
    (p) => p.arm === "audio" && p.status === "ok" && p.concurrency === r.derived.peakConcurrency,
  );
  const c1 = r.curve
    .filter((p) => p.arm === "audio" && p.status === "ok")
    .sort((a, b) => a.concurrency - b.concurrency)[0];

  const rtfOption = {
    grid: { top: 24, right: 16, bottom: 32, left: 48 },
    xAxis: { type: "value", name: t("report.omni.concurrency"), minInterval: 1 },
    yAxis: { type: "value", name: "RTF" },
    tooltip: { trigger: "axis" },
    series: [
      {
        name: "AUDIO_RTF (mean)",
        type: "line",
        data: curveSeries(r, (p) => p.audioRtf?.mean ?? null),
        markLine: {
          silent: true,
          lineStyle: { type: "dashed", color: "#ef4444" },
          data: [{ yAxis: 1, label: { formatter: t("report.omni.realtimeLine") } }],
        },
      },
    ],
  };

  const ttfpOption = {
    grid: { top: 24, right: 16, bottom: 32, left: 56 },
    xAxis: { type: "value", name: t("report.omni.concurrency"), minInterval: 1 },
    yAxis: { type: "value", name: "TTFP (ms)" },
    tooltip: { trigger: "axis" },
    series: [
      { name: "mean", type: "line", data: curveSeries(r, (p) => p.audioTtfpMs?.mean ?? null) },
      { name: "p99", type: "line", data: curveSeries(r, (p) => p.audioTtfpMs?.p99 ?? null) },
    ],
  };

  const taxLevels = Object.keys(r.derived.voiceTaxMsByLevel).sort((a, b) => Number(a) - Number(b));
  const taxOption = {
    grid: { top: 24, right: 16, bottom: 32, left: 56 },
    xAxis: { type: "category", data: taxLevels, name: t("report.omni.concurrency") },
    yAxis: { type: "value", name: "Δ E2EL (ms)" },
    tooltip: { trigger: "axis" },
    series: [
      { name: t("report.omni.voiceTax"), type: "bar", data: taxLevels.map((k) => r.derived.voiceTaxMsByLevel[k]) },
    ],
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <StatTile
          label={t("report.omni.realtimeCeiling")}
          value={r.derived.realtimeCeiling > 0 ? `c=${r.derived.realtimeCeiling}` : "—"}
          sub={t("report.omni.realtimeCeilingSub")}
        />
        <StatTile
          label={t("report.omni.ttfpC1")}
          value={c1?.audioTtfpMs ? `${Math.round(c1.audioTtfpMs.mean)} ms` : "—"}
        />
        <StatTile
          label={t("report.omni.rtfPeak")}
          value={peak?.audioRtf ? peak.audioRtf.mean.toFixed(2) : "—"}
        />
        <StatTile
          label={t("report.omni.voiceTax")}
          value={r.derived.voiceTaxMs !== null ? `${Math.round(r.derived.voiceTaxMs)} ms` : "—"}
        />
      </div>
      <Card>
        <CardHeader><CardTitle>{t("report.omni.rtfChart")}</CardTitle></CardHeader>
        <CardContent><ReactECharts option={rtfOption} style={{ height: 280 }} /></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t("report.omni.ttfpChart")}</CardTitle></CardHeader>
        <CardContent><ReactECharts option={ttfpOption} style={{ height: 280 }} /></CardContent>
      </Card>
      {taxLevels.length > 0 ? (
        <Card>
          <CardHeader><CardTitle>{t("report.omni.taxChart")}</CardTitle></CardHeader>
          <CardContent><ReactECharts option={taxOption} style={{ height: 240 }} /></CardContent>
        </Card>
      ) : null}
      {r.warnings.length > 0 ? (
        <Card>
          <CardHeader><CardTitle>{t("report.omni.warnings")}</CardTitle></CardHeader>
          <CardContent>
            <ul className="list-disc pl-5 text-sm text-muted-foreground">
              {r.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
```

(`summaryMetrics` 的实际包裹形状以 AgentReport 对 `benchmark.summaryMetrics` 的取法为准 —— 打开对齐一次,`{tool,data}` 包裹还是裸 data。)

- [ ] **Step 2: detail 页 dispatch**

`BenchmarkDetailPage.tsx`(AgentReport 分支旁):

```tsx
import { OmniReport } from "./reports/OmniReport";
// reportComponent switch/分支:
    case "OmniReport":
      return <OmniReport benchmark={benchmark} />;
```

- [ ] **Step 3: i18n 键**

`locales/zh-CN/benchmarks.json` 补:

```json
"report": {
  "omni": {
    "concurrency": "并发",
    "realtimeLine": "实时线 RTF=1",
    "realtimeCeiling": "实时天花板",
    "realtimeCeilingSub": "RTF(mean)<1 的最大并发档",
    "ttfpC1": "TTFP @ 最低档 (mean)",
    "rtfPeak": "RTF @ 天花板档 (mean)",
    "voiceTax": "语音税",
    "rtfChart": "AUDIO_RTF - 并发曲线",
    "ttfpChart": "AUDIO_TTFP - 并发曲线",
    "taxChart": "语音税(按档 ΔE2EL)",
    "warnings": "警告"
  }
},
"compare": {
  "rows": {
    "realtimeCeiling": "实时天花板 (并发)",
    "audioTtfpC1Mean": "TTFP@c1 (mean)",
    "audioRtfPeakMean": "RTF@峰值 (mean)",
    "voiceTaxMs": "语音税 (ms)"
  }
}
```

(与既有键合并而非覆盖;en-US 对应英文;compare.rows 若既有前缀不同,跟随 Task 4 Step 7 的确认结果。)

- [ ] **Step 4: web 编译**

Run: `pnpm -F @modeldoctor/web build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/
git commit -m "feat(web): OmniReport (RTF/TTFP curves, realtime ceiling, voice tax)"
```

---

### Task 12: 全仓收口 + 端到端冒烟

**Files:**
- 无新文件;全仓验证 + 真实端点冒烟

- [ ] **Step 1: 全仓构建 + 测试 + lint**

Run: `pnpm build && pnpm -r --if-present test && pnpm -r --if-present lint`
Expected: 全绿(contracts / tool-adapters / insights-scoring / api / web + pytest 已在 Task 6 绿)

- [ ] **Step 2: driver 离线冒烟(不进 K8s,本机直跑,验证 env 契约闭环)**

```bash
cd apps/benchmark-runner
MD_OMNI_PARAMS='{"concurrencyLevels":[1],"inputTokens":64,"outputTokens":32,"voiceTax":false,"numWarmups":0,"perPointTimeoutSeconds":300}' \
MD_OMNI_BASE_URL='http://10.100.121.67:30888' \
MD_OMNI_MODEL='gen-studio_Qwen2.5-Omni-7B-OFEd' \
MD_OMNI_TOKENIZER_HF_ID='Qwen/Qwen2.5-Omni-7B' \
OPENAI_API_KEY='<connection 的 key>' \
HF_ENDPOINT='https://hf-mirror.com' \
python -m runner.tools.omni_driver; cat out/omni_result.json
```

Expected: `curve[0].status == "ok"`,`audioRtf.mean` 为合理值(该 7B 端点约 0.1-0.6)。本机没有 vllm-omni CLI 时,此步改在 runner 镜像容器内执行(`docker run --rm -e … md-runner-vllm-omni-bench`)。**待验证项 #1(spec §8)在此关账:** 若发现 bench 支持 `--save-result`,提 follow-up 换 JSON 解析,不阻塞本计划。

- [ ] **Step 3: 全链路 UI 冒烟**

`pnpm dev` → Connections 新建 omni category 连接(baseUrl `http://10.100.121.67:30888`,model `gen-studio_Qwen2.5-Omni-7B-OFEd`,tokenizerHfId `Qwen/Qwen2.5-Omni-7B`)→ `/benchmarks/omni` 新建 → 模板选「Omni 实时性 · 快检」→ 跑完看 OmniReport 曲线 → `/benchmarks/reports` 矩阵出现 omni 列。
Expected: 全链路可用;Insights 详情页对该 run 出 omni findings。

- [ ] **Step 4: Commit(如有冒烟期间的小修)+ 收尾**

```bash
git add -A && git commit -m "chore: omni scenario e2e smoke fixes"
```

---

## Self-Review 记录

- **Spec 覆盖**:§4.1→Task 2/4;§4.2→Task 6;§4.3→Task 7;§4.4→Task 5;§4.5→Task 1/5;§4.6→Task 9;§4.7→Task 9;§4.8→Task 10/11;§5→Task 2/6(形状字段逐字对齐);§6 容错表→Task 4(customHeaders 拒绝)/Task 6(单点容错、tokenizer fail-fast、无音频判失败);§7 测试→各任务 TDD 步骤;§8 待验证 #1→Task 12 Step 2 关账,#3→Task 4 的 fail-fast 兜底。Discover 自动识别 omni(§8 #4)与 v2 路线(§9)明确不在本计划。
- **类型一致性**:MetricKind 8 个新值在 Task 3(定义)/Task 4(consume)/Task 9(checks)三处逐字一致;driver 输出字段(camelCase)与 zod schema 逐字一致;env 契约 5 个变量在 Task 4/6 两侧一致;进度行格式两侧一致。
- **已知松动点(实现时按仓内实况对齐,均已在任务内标注)**:compare.rows labelKey 前缀、`summaryMetrics` 包裹形状、Switch 组件路径、进度行走 stdout 还是 stderr、`omni.realtime_ceiling` higher_is_better 的 warn/crit 语义。
