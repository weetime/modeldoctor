# Issue #53 — Tool Adapter 框架设计

- **Issue**: [#53](https://github.com/weetime/modeldoctor/issues/53) — [F.1] Tool Adapter 框架：guidellm / genai-perf / vegeta 输出归一化
- **状态**: Spec / Brainstorm 完成
- **依赖**: #38 (Run 模型 `tool` 字段) ✅
- **解锁**: #41 (Charts) · #45 (Diff 引擎) · #54 (Test Plan UI) · #55 (模板库) · #57 (SSE 日志) · #59 (Driver 策略)
- **日期**: 2026-05-02
- **撰写**: brainstorm via Claude

---

## 0. 摘要

本设计在 ModelDoctor 内引入 `ToolAdapter` 抽象层，让后端的"运行 benchmark / load test 的能力"从 guidellm-only 演化成"可任意挂载工具"，并在新增 NVIDIA `genai-perf` 时**严格不修改 ToolAdapter 接口**作为可执行 acceptance gate。

**核心设计立场**: **per-tool typed schema 到底**（下文称 *D 立场*），**不引入 canonical / 跨工具归一化层**。理由：业内主流 benchmark 工作流（vLLM bench、guidellm、NVIDIA genai-perf、HF TGI bench、MLPerf Inference）都是"同工具、不同 model/参数"做对比；同名指标在不同工具下数学定义不等价，强行归一化是"假统一"。

跨工具粗粒度对比（leaderboard 等）若未来真有需求，作为后续 issue 单独处理；本 issue 不为它做架构妥协。

---

## 1. 目标与非目标

### 1.1 目标

1. 定义 `ToolAdapter` 接口 + `BuildCommandResult` / `ProgressEvent` / `ToolReport` 类型族
2. 落地三个 adapter：`guidellm` / `vegeta` / `genai-perf`
3. driver 与 runner image 改造为"通用执行器"，不再含工具语义代码
4. callback 协议从 `/state + /metrics` 重写为 `/state + /log + /finish`
5. DB Schema 收敛：`Run.canonicalReport` 列删除；`summaryMetrics` 改 discriminated union shape
6. 通过 acceptance gate：加 `genai-perf` adapter 时 ToolAdapter 接口字段 git diff 为空

### 1.2 非目标（不在本 issue 范围）

- ❌ 跨工具 metric diff（D 立场永久不做；如有需要走单独 issue）
- ❌ 前端 UI 改动（→ #54 Test Plan UI）
- ❌ Driver 实现策略选择（local vs k8s 自动决策 → #59）
- ❌ SSE 日志 endpoint（→ #57，本 issue 仅暴露 in-memory pubsub）
- ❌ 模板库（→ #55）
- ❌ 自定义脚本 adapter（后续 issue）
- ❌ 对象存储托管 raw output（>10 MB 产物 → follow-up）
- ❌ `Run.serverMetrics` 列填充（Prometheus 拉取 → #60）
- ❌ Baseline / diff 引擎实现（→ #45，本 issue 仅保证 typed reportSchema 可被 diff 引擎消费）

---

## 2. 关键设计决策（决策链）

| # | 决策点 | 结论 | 理由摘要 |
|---|---|---|---|
| Q1 | CanonicalReport 与现有 `BenchmarkMetricsSummary` 关系 | **替换 + 数据重置**，删除 `canonicalReport` 列 | dev DB disposable；不留兼容包袱 |
| Q2 | `parseFinalReport` 在哪端跑 | **API 端 TS 解析**，runner 仅透传 stdout/files | acceptance gate 自然成立；runner image 不再含工具语义 |
| Q3 | latency shape | per-tool 自定 | 见 Q4 |
| Q4 | report 类型表达 | **Discriminated union** `ToolReport = {tool, data}` | 前端 switch 渲染、TS 穷尽性检查、idiomatic |
| Q5 | adapter 物理位置 | `packages/tool-adapters/` 单包 + subpath exports (`./schemas`) | 概念单一；schema 前后端共享走 zod；前端 bundle 不污染 runtime |
| Q6 | `buildCommand` 输出形态 | `{ argv, env, secretEnv, inputFiles?, outputFiles }`；image 不进 adapter | secret 不进 argv；adapter 与执行模式（local / k8s）解耦 |
| Q7 | callback 协议 | `/state` (running 一次) + `/log` (流式) + `/finish` (终态原子) | 取消"先 metrics 后 state"中间不一致状态；progress 由 API 端从 stdout 解析 |
| Q8 | DB schema 改动 | 删 `canonicalReport`；`summaryMetrics` shape 收敛为 discriminated union body；`rawOutput` 改为 `{stdout, stderr, files}`；`scenario` 收窄为连接快照；Baseline 同工具约束在应用层 | 直接重置，无 migration backfill |
| Q9 | acceptance gate 验证 | fixture 单测 + 一次本地手工 smoke run | CI 跑 fixture 单测；smoke 文档化 |
| Q10 | #53 切多深 | 后端 hard-cut + 前端 facade（B 方案）| #53 不依赖 #54；后端无包袱；facade 临时存活到 #54 删除 |

---

## 3. 核心抽象（`packages/tool-adapters/`）

### 3.1 包结构

```
packages/tool-adapters/
├── package.json                  # exports: "." & "./schemas"
├── tsconfig.json
├── tsconfig.build.json
├── vitest.config.ts
├── biome.json (沿用 monorepo 共享)
└── src/
    ├── core/
    │   ├── interface.ts          # ToolAdapter / BuildCommandResult / ProgressEvent / ToolReport
    │   ├── registry.ts           # byTool() / allAdapters()
    │   └── progress-event.ts     # ProgressEvent zod schema (如需 runtime 校验)
    ├── guidellm/
    │   ├── schema.ts             # guidellmParamsSchema / guidellmReportSchema / types
    │   ├── runtime.ts            # buildCommand / parseProgress / parseFinalReport
    │   ├── runtime.spec.ts       # fixture-based 单测
    │   ├── __fixtures__/
    │   │   └── report.json       # 真实 guidellm 0.5.x 报告样本
    │   └── index.ts              # 组装 guidellmAdapter
    ├── genai-perf/               # 同结构
    │   └── __fixtures__/
    │       └── profile_export.json
    ├── vegeta/                   # 同结构
    │   └── __fixtures__/
    │       └── report.txt
    ├── schemas-entry.ts          # './schemas' 入口：仅 re-export 各 tool 的 schema.ts + types
    └── index.ts                  # '.' 入口：full export + 注册三个 adapter
```

`package.json` 关键配置：

```json
{
  "name": "@modeldoctor/tool-adapters",
  "version": "0.0.0",
  "private": true,
  "exports": {
    ".":         { "types": "./dist/index.d.ts",          "import": "./src/index.ts",          "default": "./dist/index.js" },
    "./schemas": { "types": "./dist/schemas-entry.d.ts",  "import": "./src/schemas-entry.ts",  "default": "./dist/schemas-entry.js" }
  },
  "dependencies": {
    "zod": "^3.23",
    "@modeldoctor/contracts": "workspace:*"
  }
}
```

### 3.2 核心类型（`src/core/interface.ts`）

```ts
import type { z } from "zod";

// ToolAdapter 注册的工具名 —— DB 上 `Run.tool` 列允许的值是超集（额外含 'e2e' / 'custom'，
// 那些不走 ToolAdapter 而是各自专用路径）；本接口的 ToolName 仅覆盖会经过 adapter 的子集。
export type ToolName = "guidellm" | "genai-perf" | "vegeta";

// 进度事件（统一形状，不分 tool）
export type ProgressEvent =
  | { kind: "progress"; pct: number; currentRequests?: number; message?: string }
  | { kind: "log"; level: "info" | "warn" | "error"; line: string };

// 报告（discriminated union，前端按 run.tool switch）
import type { GuidellmReport } from "../guidellm/schema.js";
import type { GenaiPerfReport } from "../genai-perf/schema.js";
import type { VegetaReport } from "../vegeta/schema.js";

export type ToolReport =
  | { tool: "guidellm";   data: GuidellmReport }
  | { tool: "genai-perf"; data: GenaiPerfReport }
  | { tool: "vegeta";     data: VegetaReport };

// buildCommand 输入
export interface BuildCommandPlan<TParams = unknown> {
  runId: string;
  params: TParams;
  connection: {
    baseUrl: string;
    apiKey: string;
    model: string;
    customHeaders: string;
    queryParams: string;
  };
  callback: { url: string; token: string };
}

// buildCommand 输出
export interface BuildCommandResult {
  argv: string[];                         // 完整命令行（含程序名）；shell pipeline 用 ['/bin/sh','-c',...]
  env: Record<string, string>;            // 公开 env
  secretEnv: Record<string, string>;      // 敏感 env，K8s 必入 Secret，本地合并到 spawn env
  inputFiles?: Record<string, string>;    // 相对 cwd 路径 → 内容；wrapper 在 spawn 前写入
  outputFiles: Record<string, string>;    // alias → 相对 cwd 路径；wrapper 在 exit 后收集
}

// adapter 接口
export interface ToolAdapter {
  readonly name: ToolName;
  readonly paramsSchema: z.ZodTypeAny;
  readonly reportSchema: z.ZodTypeAny;
  readonly paramDefaults: unknown;

  buildCommand(plan: BuildCommandPlan): BuildCommandResult;
  parseProgress(line: string): ProgressEvent | null;
  parseFinalReport(stdout: string, files: Record<string, Buffer>): ToolReport;
}
```

> **Acceptance gate 文件**: 上述 `interface.ts` 在 `genai-perf` adapter 落地的 PR (#53.4) 中 git diff 必须为**空**。

### 3.3 Registry（`src/core/registry.ts`）

```ts
import { guidellmAdapter } from "../guidellm/index.js";
import { genaiPerfAdapter } from "../genai-perf/index.js";
import { vegetaAdapter } from "../vegeta/index.js";
import type { ToolAdapter, ToolName } from "./interface.js";

const ADAPTERS: Readonly<Record<ToolName, ToolAdapter>> = {
  guidellm:    guidellmAdapter,
  "genai-perf": genaiPerfAdapter,
  vegeta:      vegetaAdapter,
};

export function byTool(tool: ToolName): ToolAdapter {
  const a = ADAPTERS[tool];
  if (!a) throw new Error(`No adapter registered for tool: ${tool}`);
  return a;
}

export function allAdapters(): readonly ToolAdapter[] {
  return Object.values(ADAPTERS);
}
```

---

## 4. 三个 Adapter 草案

> 各 adapter 的 zod schema 字段为草稿层，落地实现时根据真实工具产物可微调；接口形态不变。

### 4.1 guidellm

**`packages/tool-adapters/src/guidellm/schema.ts`**

```ts
import { z } from "zod";

export const guidellmParamsSchema = z.object({
  profile: z.enum(["throughput", "latency", "long_context", "generation_heavy", "sharegpt", "custom"]),
  apiType: z.enum(["chat", "completion"]),
  datasetName: z.enum(["random", "sharegpt"]),
  datasetInputTokens: z.number().int().positive().optional(),
  datasetOutputTokens: z.number().int().positive().optional(),
  datasetSeed: z.number().int().optional(),
  requestRate: z.number().int().min(0).default(0),
  totalRequests: z.number().int().min(1).max(100_000).default(1000),
  maxDurationSeconds: z.number().int().positive().default(1800),
  maxConcurrency: z.number().int().positive().default(100),
  processor: z.string().optional(),
  validateBackend: z.boolean().default(true),
}).superRefine((d, ctx) => {
  if (d.datasetName === "random" && (!d.datasetInputTokens || !d.datasetOutputTokens)) {
    ctx.addIssue({ code: "custom", message: "random dataset 需要 datasetInputTokens/datasetOutputTokens" });
  }
});
export type GuidellmParams = z.infer<typeof guidellmParamsSchema>;

const dist = z.object({
  mean: z.number(),
  p50: z.number(),
  p90: z.number(),
  p95: z.number(),
  p99: z.number(),
});

export const guidellmReportSchema = z.object({
  ttft: dist,
  itl: dist,
  e2eLatency: dist,
  requestsPerSecond: z.object({ mean: z.number() }),
  outputTokensPerSecond: z.object({ mean: z.number() }),
  inputTokensPerSecond: z.object({ mean: z.number() }),
  totalTokensPerSecond: z.object({ mean: z.number() }),
  concurrency: z.object({ mean: z.number(), max: z.number() }),
  requests: z.object({
    total: z.number().int(),
    success: z.number().int(),
    error: z.number().int(),
    incomplete: z.number().int(),
  }),
});
export type GuidellmReport = z.infer<typeof guidellmReportSchema>;
```

**`packages/tool-adapters/src/guidellm/runtime.ts`** — 关键点：

- `buildCommand`: TS 化移植自 `apps/benchmark-runner/runner/argv.py`。`secretEnv.OPENAI_API_KEY = connection.apiKey`（替代 backend-kwargs JSON 内联 key 的旧路径，更安全）；guidellm 通过 backend-kwargs 透传，但 key 从 env 读取
- `parseProgress`: 解析 guidellm 0.5.x `--disable-console` 模式下 stderr 偶发的 progress 行（基于 guidellm 源码格式）；非 progress 行返回 null
- `parseFinalReport(stdout, files)`: 读 `files['report'].toString('utf-8')` → JSON.parse → 字段映射函数（移植自 `apps/benchmark-runner/runner/metrics.py` 的 `map_guidellm_report_to_summary`）→ `guidellmReportSchema.parse()` → 包装为 `{ tool: 'guidellm', data }`
- `outputFiles: { 'report': 'report.json' }`

### 4.2 vegeta

**`packages/tool-adapters/src/vegeta/schema.ts`**

```ts
import { z } from "zod";

export const vegetaParamsSchema = z.object({
  apiType: z.enum(["chat", "embeddings", "rerank", "images", "chat-vision", "chat-audio"]),
  rate: z.number().int().min(1).max(10_000),
  duration: z.number().int().min(1).max(3_600),
});
export type VegetaParams = z.infer<typeof vegetaParamsSchema>;

const vegetaLatencyDist = z.object({
  // 全部转成 ms number；parser 把 "45.6ms" / "1.2s" / "300µs" 统一解为 ms
  min: z.number(),
  mean: z.number(),
  p50: z.number(),
  p90: z.number(),
  p95: z.number(),
  p99: z.number(),
  max: z.number(),
});

export const vegetaReportSchema = z.object({
  requests: z.object({ total: z.number().int(), rate: z.number(), throughput: z.number() }),
  duration: z.object({ totalSeconds: z.number(), attackSeconds: z.number(), waitSeconds: z.number() }),
  latencies: vegetaLatencyDist,
  bytesIn:  z.object({ total: z.number().int(), mean: z.number() }),
  bytesOut: z.object({ total: z.number().int(), mean: z.number() }),
  success: z.number(),                    // percent [0, 100]
  statusCodes: z.record(z.number().int()),
  errors: z.array(z.string()),
});
export type VegetaReport = z.infer<typeof vegetaReportSchema>;
```

> **D 立场体现**: vegeta 的 schema **没有** `ttft / itl / tokens` 字段。不是 null，是这个工具的 schema 本来就不包含 LLM 语义指标。

**`packages/tool-adapters/src/vegeta/runtime.ts`** — 关键点：

- `buildCommand`: argv = `['/bin/sh', '-c', 'cat targets.txt | vegeta attack -rate=${rate} -duration=${duration}s | tee attack.bin | vegeta report > report.txt']`
  - targets.txt 内容由 `inputFiles['targets.txt']` 写入 cwd；构造逻辑移植自现 `apps/api/src/modules/load-test/load-test.service.ts`（含 customHeaders / queryParams 拼接 + `Authorization: Bearer <apiKey>` 注入）
  - **secret 处理**: vegeta 的 apiKey 嵌在 targets.txt 文件文本里（这是 vegeta CLI 唯一支持的方式）。targets.txt 含敏感信息，**必须**通过 `inputFiles` 而非 `env`/`secretEnv` 传递，且 driver 在 K8s 模式下必须把 inputFiles 写到 per-run Secret + volumeMount（见 §6.3），不可走 ConfigMap 或 Job manifest 明文 env。`secretEnv` 在 vegeta adapter 中保持空对象
- `parseProgress`: vegeta CLI attack 阶段 stderr 静默，`parseProgress` 永远返回 null；不影响 acceptance gate（接口允许返回 null）
- `parseFinalReport(stdout, files)`: 读 `files['report'].toString('utf-8')` → 移植自 `apps/api/src/integrations/parsers/vegeta-report.ts` 但加上单位转换函数 `parseLatencyToMs("45.6ms" | "1.2s" | "300µs")` → `vegetaReportSchema.parse()` → `{ tool: 'vegeta', data }`
- `outputFiles: { 'report': 'report.txt', 'attack': 'attack.bin' }`

### 4.3 genai-perf（acceptance gate 关键）

**`packages/tool-adapters/src/genai-perf/schema.ts`**

```ts
import { z } from "zod";

export const genaiPerfParamsSchema = z.object({
  endpointType: z.enum(["chat", "completions", "embeddings", "rankings"]),
  numPrompts: z.number().int().positive().default(100),
  concurrency: z.number().int().positive().default(1),
  inputTokensMean: z.number().int().positive().optional(),
  inputTokensStddev: z.number().int().min(0).default(0),
  outputTokensMean: z.number().int().positive().optional(),
  outputTokensStddev: z.number().int().min(0).default(0),
  streaming: z.boolean().default(true),
});
export type GenaiPerfParams = z.infer<typeof genaiPerfParamsSchema>;

const genaiPerfDist = z.object({
  avg: z.number(),
  min: z.number(),
  max: z.number(),
  p50: z.number(),
  p90: z.number(),
  p95: z.number(),
  p99: z.number(),
  stddev: z.number(),
  unit: z.string(),                       // "ms" / "tokens/sec" 等，原样保留
});

export const genaiPerfReportSchema = z.object({
  requestThroughput: z.object({ avg: z.number(), unit: z.string() }),
  requestLatency: genaiPerfDist,
  timeToFirstToken: genaiPerfDist,
  interTokenLatency: genaiPerfDist,
  outputTokenThroughput: z.object({ avg: z.number(), unit: z.string() }),
  outputSequenceLength: z.object({ avg: z.number(), p50: z.number(), p99: z.number() }),
  inputSequenceLength:  z.object({ avg: z.number(), p50: z.number(), p99: z.number() }),
});
export type GenaiPerfReport = z.infer<typeof genaiPerfReportSchema>;
```

**`packages/tool-adapters/src/genai-perf/runtime.ts`** — 关键点：

- `buildCommand`: argv = `['genai-perf', 'profile', '-m', connection.model, '-u', connection.baseUrl, '--endpoint-type', endpointType, '--profile-export-file', 'profile_export.json', '--num-prompts', String(numPrompts), '--concurrency', String(concurrency), ...]`；`secretEnv.OPENAI_API_KEY = connection.apiKey`
- `parseProgress`: 解析 genai-perf 进度输出（如有），无则返回 null
- `parseFinalReport(stdout, files)`: 读 `files['profile'].toString('utf-8')` → JSON.parse → 字段重命名（snake_case → camelCase：`request_throughput → requestThroughput`、`time_to_first_token → timeToFirstToken` 等）→ `genaiPerfReportSchema.parse()` → `{ tool: 'genai-perf', data }`
- `outputFiles: { 'profile': 'profile_export.json' }`

> **Acceptance gate**: 此 adapter 落地时（PR #53.4）`packages/tool-adapters/src/core/interface.ts` 必须 untouched。

---

## 5. Run 模型 Json 列重新分工

### 5.1 列含义

| 列 | 类型 | 内容（D 后） | 谁写 |
|---|---|---|---|
| `tool` | String | `'guidellm' \| 'genai-perf' \| 'vegeta' \| 'e2e' \| 'custom'` | RunService 创建时（已存在） |
| `scenario` | Json | **连接快照**：`{ apiBaseUrl, model, customHeaders, queryParams }`，防 connection 后被改/删时历史 run 失语义 | RunService 创建时 snapshot |
| `params` | Json | **per-tool typed params**：`adapter.paramsSchema.parse(req.params)` 的结果 | RunService 创建时校验后写入 |
| `summaryMetrics` | Json | **discriminated union body**：`{ tool, data }`，由 `adapter.parseFinalReport()` 输出 | `/finish` callback 解析后写入 |
| `rawOutput` | Json | `{ stdout: string, stderr: string, files: Record<alias, base64String> }` | `/finish` callback 写入 |
| `canonicalReport` | ❌ 删除 | — | — |
| `serverMetrics` | Json | 不动（保留给 #60） | — |

### 5.2 Migration

```sql
-- apps/api/prisma/migrations/<ts>_issue_53_canonical_drop/migration.sql
ALTER TABLE "runs" DROP COLUMN "canonical_report";
```

dev DB disposable，落库直接 `prisma migrate reset --force`。

### 5.3 Baseline ↔ Run 同工具约束

应用层校验：`BaselineService.create()` / 任何 diff service `if (baseline.run.tool !== candidate.tool) throw 400`。**不**在 DB 层加 trigger / cross-table CHECK，错误信息可控。

`Baseline` 表本身不需要冗余 `tool` 列；通过 `Baseline.run.tool` 间接获取。如未来出现"按 tool 筛 baseline list"高频查询再 denormalize。

---

## 6. Driver 改造

### 6.1 接口（替换现 `BenchmarkExecutionDriver`）

**`apps/api/src/modules/run/drivers/execution-driver.interface.ts`** (新文件，替代现 `apps/api/src/modules/benchmark/drivers/execution-driver.interface.ts`)

```ts
import type { BuildCommandResult, ToolName } from "@modeldoctor/tool-adapters";

export interface RunExecutionContext {
  runId: string;
  tool: ToolName;
  buildResult: BuildCommandResult;
  callback: { url: string; token: string };
  image: string;                              // 由 driver factory 按 tool 决定（见 §6.4）
}

export type RunExecutionHandle = string;     // 'subprocess:<pid>' | '<namespace>/<jobName>'

export interface RunExecutionDriver {
  start(ctx: RunExecutionContext): Promise<{ handle: RunExecutionHandle }>;
  cancel(handle: RunExecutionHandle): Promise<void>;
  cleanup(handle: RunExecutionHandle): Promise<void>;
}
```

> 现 `BenchmarkExecutionContext` (含 guidellm-shape 字段如 `profile / datasetName / requestRate ...`) **整个删除**。

### 6.2 SubprocessDriver 改写要点

```ts
async start(ctx) {
  const cwd = `/tmp/run-${ctx.runId}`;
  await fs.mkdir(cwd, { recursive: true });

  // 写入 inputFiles
  for (const [relPath, content] of Object.entries(ctx.buildResult.inputFiles ?? {})) {
    await fs.writeFile(path.join(cwd, relPath), content);
  }

  const env = {
    ...process.env,
    ...ctx.buildResult.env,
    ...ctx.buildResult.secretEnv,             // 本地合并（非 K8s 不区分敏感）
    MD_CALLBACK_URL: ctx.callback.url,
    MD_CALLBACK_TOKEN: ctx.callback.token,
    MD_RUN_ID: ctx.runId,
    MD_OUTPUT_FILES: JSON.stringify(ctx.buildResult.outputFiles),
    MD_ARGV: JSON.stringify(ctx.buildResult.argv),
  };

  const child = spawn("benchmark-runner-wrapper", [], { env, cwd, stdio: ["ignore", "pipe", "pipe"], detached: false });
  // ... handle 管理、kill timer 等沿用现有逻辑
}
```

> `benchmark-runner-wrapper` 是 §7 重写后的通用 wrapper 二进制名。

### 6.3 K8sJobDriver 改写要点

- `secretEnv` → per-run Secret 的 `stringData`，Job container 使用 `envFrom: [{ secretRef: { name: ... } }]`
- `env` → Job container 的 `env: [{ name, value }]` 直接传值
- `inputFiles` → 写入同一 Secret 的 `stringData`（注意：Secret value 是字符串，单文件 ≤ 1 MiB）；container 用 `volumeMounts` 挂到 cwd 的相对路径
  - **注意**: vegeta 的 targets.txt 含 `Authorization: Bearer <apiKey>` 明文，**必须**走 Secret + volumeMount，不能用 ConfigMap
  - 大于 1 MiB 的 inputFiles 是 follow-up（极端少见）
- `MD_*` 控制变量 → env value 直接传
- container.image = `byTool(ctx.tool)` 查 `RUNNER_IMAGE_<TOOL>` 环境变量

### 6.4 Driver Factory 改造

新建 `apps/api/src/modules/run/drivers/run-driver.factory.ts`（替换现 `benchmark/drivers/driver.factory.ts`）：

```ts
function imageForTool(tool: ToolName, env: Env): string {
  switch (tool) {
    case "guidellm":   return env.RUNNER_IMAGE_GUIDELLM;
    case "genai-perf": return env.RUNNER_IMAGE_GENAI_PERF;
    case "vegeta":     return env.RUNNER_IMAGE_VEGETA;
    default: throw new Error(`No image configured for tool: ${tool}`);
  }
}
```

`Env` schema (`apps/api/src/config/env.schema.ts`) 增三个变量：`RUNNER_IMAGE_GUIDELLM` / `RUNNER_IMAGE_GENAI_PERF` / `RUNNER_IMAGE_VEGETA`。本地 subprocess 模式下这三个 env 仅占位，不实际使用。

---

## 7. Runner Image 重写（`apps/benchmark-runner/`）

### 7.1 删除

- `runner/argv.py`（guidellm 专属 argv 构造）
- `runner/env.py`（guidellm 专属 env parsing）
- `runner/metrics.py`（guidellm JSON → BenchmarkMetricsSummary mapping）
- 对应单测

### 7.2 重写 `runner/main.py`（通用 wrapper）

```python
"""Generic tool wrapper. Reads MD_* env, spawns argv, streams logs, posts /finish."""

import base64, json, os, subprocess, sys
from runner.callback import post_state_running, post_log_batch, post_finish

LOG_BATCH_MS = 250
STDERR_TAIL_BYTES = 8 * 1024
STDOUT_TAIL_BYTES = 64 * 1024  # full stdout 仍然进 /finish.stdout，这里只是 inline tail safety cap

def main():
    callback_url = os.environ["MD_CALLBACK_URL"]
    token = os.environ["MD_CALLBACK_TOKEN"]
    run_id = os.environ["MD_RUN_ID"]
    argv = json.loads(os.environ["MD_ARGV"])
    output_files = json.loads(os.environ["MD_OUTPUT_FILES"])

    cwd = os.getcwd()  # /tmp/run-<id>，driver 已 mkdir 并写 inputFiles

    post_state_running(callback_url, token, run_id)

    proc = subprocess.Popen(argv, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    stdout_full, stderr_full = tee_to_callback(proc, callback_url, token, run_id, batch_ms=LOG_BATCH_MS)
    proc.wait()

    files_b64 = {}
    for alias, rel_path in output_files.items():
        full = os.path.join(cwd, rel_path)
        if os.path.exists(full):
            with open(full, "rb") as f:
                files_b64[alias] = base64.b64encode(f.read()).decode("ascii")

    state = "completed" if proc.returncode == 0 else "failed"
    post_finish(
        callback_url=callback_url, token=token, run_id=run_id,
        state=state, exit_code=proc.returncode,
        stdout=stdout_full, stderr=stderr_full,
        files=files_b64,
        message=None if state == "completed" else f"exit code {proc.returncode}",
    )
    return 0  # 进程退出码：runner 本身成功（即使 inner tool failed），由 callback 表达终态

if __name__ == "__main__":
    sys.exit(main())
```

`tee_to_callback` 实现：两个 thread（stdout / stderr 各一），每读一行入 buffer，每 ~250 ms 把累积的行 batch POST `/log`，结束时 flush；同时累加到 stdout_full / stderr_full 全文 buffer 供 `/finish` 用。

### 7.3 Dockerfile 拆分

```
apps/benchmark-runner/
├── runner/                       # 通用 wrapper Python 代码（§7.2）
├── images/
│   ├── guidellm.Dockerfile       # FROM ghcr.io/guidellm/runner:0.5.x + COPY runner/ + ENTRYPOINT 同名
│   ├── genai-perf.Dockerfile     # FROM nvcr.io/nvidia/tritonserver-genai-perf:* + COPY runner/
│   └── vegeta.Dockerfile         # FROM peterevans/vegeta:latest + COPY runner/
├── tests/                        # 仅测 wrapper 通用性（mock argv / stdout / files）
└── pyproject.toml
```

CI 矩阵 build 三个 image，tag 按 PR / branch（沿用现有 CI 风格）；K8s deployment env 配 `RUNNER_IMAGE_<TOOL>`。

---

## 8. Callback 协议 v2

### 8.1 三个 endpoint

| Path | 时机 | Body Zod schema |
|---|---|---|
| `POST /api/internal/runs/:id/state` | runner 启动后**一次**，宣告 running | `{ state: 'running' }` |
| `POST /api/internal/runs/:id/log` | stdout/stderr 增量，~250 ms batch | `{ stream: 'stdout' \| 'stderr', lines: string[] }` |
| `POST /api/internal/runs/:id/finish` | tool 进程退出后**一次**，带终态 + 全部产物 | `{ state: 'completed' \| 'failed', exitCode: number, stdout: string, stderr: string, files: Record<alias, string /* base64 */>, message?: string }` |

### 8.2 API 端处理

```ts
@UseGuards(HmacCallbackGuard)
@Controller("api/internal/runs/:id")
export class RunCallbackController {
  constructor(private readonly runs: RunService, private readonly sse: SseHub) {}

  @Post("state")
  async handleState(@Param("id") id: string, @Body() body: StateCallback) {
    if (body.state === "running") {
      await this.runs.markRunning(id);
    }
  }

  @Post("log")
  async handleLog(@Param("id") id: string, @Body() body: LogCallback) {
    const run = await this.runs.findById(id);
    if (!run) return;                                 // 静默忽略；race against cleanup
    const adapter = byTool(run.tool as ToolName);
    for (const line of body.lines) {
      let evt: ProgressEvent | null;
      try {
        evt = adapter.parseProgress(line);
      } catch {
        evt = { kind: "log", level: "warn", line };  // parser 升级期容错
      }
      if (!evt) continue;
      this.sse.publish(id, evt);
      if (evt.kind === "progress") {
        await this.runs.updateProgress(id, evt.pct);
      }
    }
  }

  @Post("finish")
  async handleFinish(@Param("id") id: string, @Body() body: FinishCallback) {
    const run = await this.runs.findById(id);
    if (!run) return;
    const adapter = byTool(run.tool as ToolName);

    let report: ToolReport | null = null;
    let finalState = body.state;
    let message = body.message;

    try {
      const fileBuffers: Record<string, Buffer> = Object.fromEntries(
        Object.entries(body.files).map(([k, v]) => [k, Buffer.from(v, "base64")]),
      );
      report = adapter.parseFinalReport(body.stdout, fileBuffers);
    } catch (e) {
      finalState = "failed";
      message = `report parse: ${(e as Error).message}`.slice(0, 2048);
      report = null;
    }

    await this.runs.markFinished(id, {
      status: finalState,
      message,
      summaryMetrics: report,
      rawOutput: { stdout: body.stdout, stderr: body.stderr, files: body.files },
    });
  }
}
```

### 8.3 Body size 与 HMAC

- `/finish` body 上限提升至 **10 MB**（NestJS body-parser 单 endpoint override，路由级配置）。覆盖 guidellm 报告 ~500 KB + buffer
- `/log` body 上限 **256 KB**（每 batch 上限 ≈ 1000 行 × 256 字符，足够）
- 三个 endpoint 都套现 `HmacCallbackGuard`（`apps/api/src/modules/benchmark/callbacks/hmac-callback.guard.ts`），文件物理位置随 controller 迁到 `apps/api/src/modules/run/callbacks/`

### 8.4 SSE Hub（in-memory pubsub）

新建 `apps/api/src/modules/run/sse/sse-hub.service.ts`：

- `publish(runId, event: ProgressEvent)`: 派发到该 runId 的所有订阅者
- `subscribe(runId): Observable<ProgressEvent>`: #57 SSE endpoint 用

`SseHub` 仅在内存内（单 API 实例）；多实例 horizontal scale 是 #57/#59 关心的事，#53 不处理。

---

## 9. RunController + RunService（统一新 endpoint）

### 9.1 新 endpoint

`apps/api/src/modules/run/run.controller.ts` 已存在，扩展为：

| Method | Path | 用途 |
|---|---|---|
| `POST` | `/api/runs` | 创建并立即 start 任意工具的 run |
| `GET`  | `/api/runs` | 列表（继承现有 listRunsQuerySchema） |
| `GET`  | `/api/runs/:id` | 详情 |
| `POST` | `/api/runs/:id/cancel` | 取消 |
| `DELETE` | `/api/runs/:id` | 删除（terminal 后） |

`POST /api/runs` body schema (`packages/contracts/src/run.ts` 新增)：

```ts
export const createRunRequestSchema = z.object({
  tool: runToolSchema,
  kind: runKindSchema.default("benchmark"),
  connectionId: z.string().min(1),
  name: z.string().min(1).max(128),
  description: z.string().max(2048).optional(),
  params: z.record(z.unknown()),                  // adapter.paramsSchema 在 service 层校验
  templateId: z.string().optional(),
  templateVersion: z.string().optional(),
  parentRunId: z.string().optional(),
  baselineId: z.string().optional(),
});
```

### 9.2 RunService 关键流程

```ts
async create(userId: string, req: CreateRunRequest): Promise<Run> {
  const conn = await this.connections.getOwnedDecrypted(userId, req.connectionId);
  const adapter = byTool(req.tool);

  // 1. 校验 params
  const params = adapter.paramsSchema.parse(req.params);

  // 2. 创建 Run row（status=pending）
  const run = await this.runs.create({
    userId, connectionId: conn.id,
    kind: req.kind, tool: req.tool, mode: "fixed",   // mode 由 adapter 推断 / req 提供
    driverKind: this.driverKind,
    name: req.name, description: req.description,
    scenario: {
      apiBaseUrl: conn.baseUrl,
      model: conn.model,
      customHeaders: conn.customHeaders,
      queryParams: conn.queryParams,
    },
    params: params as Prisma.InputJsonValue,
    templateId: req.templateId, templateVersion: req.templateVersion,
    parentRunId: req.parentRunId, baselineId: req.baselineId,
  });

  return await this.start(run.id);
}

async start(runId: string): Promise<Run> {
  const row = await this.runs.findById(runId);
  // ... 取 connection, sign callback token
  const adapter = byTool(row.tool as ToolName);
  const buildResult = adapter.buildCommand({
    runId: row.id,
    params: row.params,
    connection: { /* ... */ },
    callback: { url: this.callbackUrl, token: callbackToken },
  });
  const handle = await this.driver.start({
    runId: row.id, tool: row.tool as ToolName,
    buildResult,
    callback: { url: this.callbackUrl, token: callbackToken },
    image: imageForTool(row.tool as ToolName, this.config),
  });
  return await this.runs.update(row.id, {
    status: "submitted", driverHandle: handle.handle, startedAt: new Date(),
  });
}
```

`callbackToken` 复用现 `signCallbackToken` (`apps/api/src/modules/benchmark/callbacks/hmac-token.ts`，物理迁到 `run/callbacks/`)。

---

## 10. 前后端兼容 Facade 策略

### 10.1 BenchmarkController 改 facade

`apps/api/src/modules/benchmark/benchmark.controller.ts` 路由不变（`/api/benchmarks/*`），controller 内部 translate 后调 `RunService`：

```ts
@Post()
async create(@Body() body: CreateBenchmarkRequest, @CurrentUser() user) {
  const guidellmParams: GuidellmParams = {
    profile: body.profile,
    apiType: body.apiType,
    datasetName: body.datasetName,
    datasetInputTokens: body.datasetInputTokens,
    datasetOutputTokens: body.datasetOutputTokens,
    datasetSeed: body.datasetSeed,
    requestRate: body.requestRate,
    totalRequests: body.totalRequests,
    // 其余字段由 guidellmParamsSchema 默认值填补
  };
  const run = await this.runs.create(user.sub, {
    tool: "guidellm", kind: "benchmark", connectionId: body.connectionId,
    name: body.name, description: body.description,
    params: guidellmParams,
  });
  return mapRunToBenchmarkRunDto(run);
}

@Get()
async list(@Query() q: ListBenchmarksQuery, @CurrentUser() user) {
  const r = await this.runs.list({ tool: "guidellm", ...q }, user);
  return { items: r.items.map(mapRunToBenchmarkRunSummary), nextCursor: r.nextCursor };
}

// 同样 facade 化：GET :id / cancel / delete
```

`mapRunToBenchmarkRunDto` 是反向 mapper：从新 `Run` 形态（含 `summaryMetrics: { tool: 'guidellm', data: GuidellmReport }`）map 回旧 `BenchmarkRunDto`（含 `metricsSummary: BenchmarkMetricsSummary` 旧 shape）。字段基本一对一对齐。

### 10.2 LoadTestController 改 facade

`apps/api/src/modules/load-test/load-test.controller.ts` 路由不变，内部 translate `LoadTestRequest` → `vegetaParams`，response 反向 map 成 `LoadTestResponse`。

注意 `LoadTestResponse` 含 `report: string`（vegeta 原始文本报告），从新 Run 的 `rawOutput.files['report']` 解 base64 取出。

### 10.3 Facade 生命周期

- **#53 内**: 上线 facade，前端零改动
- **#54 (Test Plan UI)** 内: 前端切到 `/api/runs`，**同 PR**:
  - 删除 `apps/api/src/modules/benchmark/benchmark.controller.ts` + `benchmark.service.ts`（facade 实现）
  - 删除 `apps/api/src/modules/load-test/`
  - 删除 `packages/contracts/src/benchmark.ts` (legacy DTO schemas)
  - 删除 `packages/contracts/src/load-test.ts`
  - 删除反向 mapper 函数
  - 前端 `BenchmarkPage` / `LoadTestPage` 改用 `/api/runs`

> #54 落地时同步 follow-up（见 §12）。

---

## 11. 测试策略

### 11.1 测试层

| 层 | 路径 | 重点 |
|---|---|---|
| Adapter 单测 | `packages/tool-adapters/src/<tool>/runtime.spec.ts` | fixture-based：`__fixtures__/` 内的真实工具产物 → `parseFinalReport()` 输出 matches `reportSchema` |
| Schema 单测 | `packages/tool-adapters/src/<tool>/schema.spec.ts` | paramsSchema 必填/默认值/refine；reportSchema discriminated union narrowing |
| Driver 单测 | `apps/api/src/modules/run/drivers/*.spec.ts` | secretEnv 不进 argv、K8s 必走 Secret、inputFiles 写入 cwd、callback env 注入 |
| Callback 单测 | `apps/api/src/modules/run/callbacks/*.spec.ts` | parser throw → state=failed、HMAC guard、body size limit、log → SSE pubsub |
| Runner image 测 | `apps/benchmark-runner/tests/` | wrapper 通用性：mock argv (`echo` / `cat`)，验证 batch /log POST、outputFiles 收集、/finish payload |
| 集成测 | `apps/api/test/run-e2e.spec.ts` | 创建 Run → mock driver fire `/state, /log, /finish` → DB 状态正确（不真跑工具） |
| 手工 smoke | 文档化 (§12) | 三个 adapter 真跑过一次 |

### 11.2 Fixture 来源

- **guidellm**: 现 `apps/benchmark-runner` 已能跑出真实 report.json，捞一份提交（128 个请求 / random dataset / 本地 vLLM 或 mock target）
- **vegeta**: 现 `apps/api/src/integrations/parsers/vegeta-report.spec.ts` 已有 fixture 字符串，迁移到 `__fixtures__/report.txt`
- **genai-perf**: 本地 `pip install genai-perf` 跑一次小 profile（10 prompts / 1 concurrency），捞 `profile_export.json` 提交

---

## 12. Acceptance Gate 验证步骤

`#53 ship 前必跑一次手工流程`，结果记录在 PR #53.4 描述里：

```
1. 切到 PR #53.4 分支（genai-perf 实现 PR）

2. 验证 fixture 已就位：
   ls packages/tool-adapters/src/genai-perf/__fixtures__/profile_export.json

3. 跑 adapter 包测试：
   pnpm -F @modeldoctor/tool-adapters test
   ─ 三个 tool 的 fixture 单测全过
   ─ schema 单测全过

4. ⭐ ACCEPTANCE GATE 关键命令：
   git diff main -- packages/tool-adapters/src/core/interface.ts
   ─ 输出必须为空（接口字段 0 改动）
   ─ 若有改动 → 设计回滚，重新 brainstorm

5. 本地 build genai-perf image：
   docker build -f apps/benchmark-runner/images/genai-perf.Dockerfile apps/benchmark-runner/

6. 跑 end-to-end：
   ─ docker compose up modeldoctor-api / 或本地启动 API (driver=subprocess)
   ─ 创建 connection 指向本地或可访问的 OpenAI-compatible endpoint
   ─ POST /api/runs { tool: 'genai-perf', connectionId, name, params: { endpointType: 'chat', numPrompts: 10, concurrency: 1 } }
   ─ 通过 logs 观察：
       /state running 收到
       /log 持续到达，stdout 行可见
       /finish 收到
   ─ GET /api/runs/<id> 验证：
       summaryMetrics.tool === 'genai-perf'
       summaryMetrics.data.requestLatency.p99 是合理 number
       rawOutput.files['profile'] base64 解码后是合法 JSON

7. 在 PR #53.4 描述粘贴 §12 步骤 + 截图（关键 endpoint response）。
```

---

## 13. PR 拆分

| # | 分支 / PR 名 | 内容 | 体量 |
|---|---|---|---|
| **53.1** | `feat/issue-53-tool-adapter-package-skeleton` | 新建 `packages/tool-adapters/`，core interface + registry，**3 adapter 的 schema-only**（runtime 全 throw）。CI build 通过 | 中 |
| **53.2** | `feat/issue-53-callback-v2-and-run-service` | Callback v2 三 endpoint + RunController + RunService unified；driver 接口改造（`BuildCommandResult` 输入）；DB migration 删 `canonicalReport`。**Facade 暂未挂；BenchmarkController/LoadTestController 仍走旧路径**（这一 PR 后端两套 controller 并行，但底层数据流不冲突，依赖各自的 driver/callback 实例） | 大 |
| **53.3** | `feat/issue-53-guidellm-vegeta-runtime-and-runner-image` | guidellm + vegeta runtime 实现；`apps/benchmark-runner/` Python wrapper 重写 + Dockerfile 拆分；旧 `argv.py / env.py / metrics.py` 删除；**Facade 上线**：BenchmarkController/LoadTestController 切到 RunService | 大 |
| **53.4** | `feat/issue-53-genai-perf-adapter` | genai-perf runtime + Dockerfile + fixture 单测 + smoke 报告。**这是 acceptance gate PR**：`git diff main -- packages/tool-adapters/src/core/interface.ts` 必须为空 | 中 |

---

## 14. Follow-up Comments

按 `feedback_temp_followups.md` 习惯，#53 落地过程中要在以下 issue 上 post comment：

| Issue | Comment 内容 |
|---|---|
| **#54 (Test Plan UI)** | "#53 落地后 BenchmarkController / LoadTestController 是 facade（`apps/api/src/modules/{benchmark,load-test}/`），#54 切前端到 `/api/runs` 时同 PR 删除 facade controller、`packages/contracts/src/{benchmark,load-test}.ts`、反向 mapper 函数。" |
| **#45 (Diff 引擎)** | "#53 后 `Run.summaryMetrics` shape = `{ tool, data }` discriminated union。Diff service 必须先 `assert(baseline.tool === run.tool)` narrow，然后按 tool 分支 typed diff。**不存在跨工具 diff**（D 立场）。" |
| **#41 (Charts, 已合)** | "#53 改了 `Run.summaryMetrics` shape：从 guidellm-shape 的 `BenchmarkMetricsSummary` 变为 discriminated union body `{ tool, data }`。#41 已实现的 charts 组件需要在 #54 切到 `/api/runs` 时同 PR 改造为按 `summaryMetrics.tool` switch 渲染。" |
| **#57 (SSE 日志)** | "#53 已在 API 端 in-memory pubsub 提供 `ProgressEvent` stream（`SseHub.subscribe(runId)`）。#57 实现 SSE endpoint 时直接订阅，不需要重新 parse stdout。" |
| **#59 (Driver 策略)** | "#53 后 driver 接口已统一为 `RunExecutionContext`（与 tool 无关），#59 自由选择 SubprocessDriver / K8sJobDriver 实现。Image 选择逻辑在 `imageForTool(tool, env)`。" |

---

## 15. Future Work（不在 #53 范围）

1. **Raw output 对象存储**: guidellm/genai-perf 极端 long-context test 可能产物 >10 MB。届时 `rawOutput.files` 改成 `Record<alias, { kind: 'inline', base64 } | { kind: 's3', url, etag }>`
2. **Custom adapter / plugin 机制**: 用户自带工具镜像 + 自带 schema。需要 plugin SDK + sandbox。单独 issue
3. **Adapter version 化**: guidellm 0.5 → 0.6 改 schema 时，可能需要 `guidellmAdapter.v1 / v2`。先不处理，等真出现版本 break 再说
4. **跨工具 leaderboard**: 若产品后续真有需求，从 D 立场退守，加 mini-canonical 层（仅 latency.p99 + throughputQps），UI 明确警示"跨工具仅供参考"
5. **Run cancel 期间 callback 处理**: 现在 cancel 后再到的 `/log` 仍会被 handle（无害）；如要严格 reject，加 RunService 状态机 guard

---

## 附录 A: 现状代码盘点（供 implementation plan 参考）

| 现状文件 | #53 后命运 |
|---|---|
| `apps/benchmark-runner/runner/argv.py` | 删除 |
| `apps/benchmark-runner/runner/env.py` | 删除 |
| `apps/benchmark-runner/runner/metrics.py` | 删除（逻辑 TS 化迁到 `packages/tool-adapters/src/guidellm/runtime.ts`） |
| `apps/benchmark-runner/runner/main.py` | 重写（通用 wrapper） |
| `apps/benchmark-runner/runner/callback.py` | 重写（`post_state_running / post_log_batch / post_finish`） |
| `apps/benchmark-runner/Dockerfile` | 拆成 `images/{guidellm,genai-perf,vegeta}.Dockerfile` |
| `apps/api/src/modules/benchmark/drivers/execution-driver.interface.ts` | 删除（→ `apps/api/src/modules/run/drivers/execution-driver.interface.ts`） |
| `apps/api/src/modules/benchmark/drivers/subprocess-driver.ts` | 迁移 + 改写为 `RunExecutionContext` |
| `apps/api/src/modules/benchmark/drivers/k8s-job-driver.ts` | 迁移 + 改写 |
| `apps/api/src/modules/benchmark/drivers/k8s-job-manifest.ts` | 迁移 + 改写（secretEnv / inputFiles 处理） |
| `apps/api/src/modules/benchmark/drivers/driver.factory.ts` | 迁移 + 改 `imageForTool` |
| `apps/api/src/modules/benchmark/callbacks/*` | 迁移到 `apps/api/src/modules/run/callbacks/`，重写 controller |
| `apps/api/src/modules/benchmark/benchmark.service.ts` | 改 facade 实现（→ 调 RunService），#54 删 |
| `apps/api/src/modules/benchmark/benchmark.controller.ts` | 改 facade（路由不变），#54 删 |
| `apps/api/src/modules/benchmark/benchmark.reconciler.ts` | 评估迁到 RunService 通用 reconciler 还是改 facade，本设计倾向迁通用 |
| `apps/api/src/modules/load-test/load-test.service.ts` | 改 facade 实现（调 RunService with tool='vegeta'），#54 删 |
| `apps/api/src/modules/load-test/load-test.controller.ts` | 改 facade（路由不变），#54 删 |
| `apps/api/src/integrations/parsers/vegeta-report.ts` | 移植到 `packages/tool-adapters/src/vegeta/runtime.ts` 的 parseFinalReport，加单位转 ms 函数 |
| `apps/api/src/integrations/builders/*` | vegeta targets 文件构造逻辑迁到 `packages/tool-adapters/src/vegeta/runtime.ts` 的 buildCommand |
| `apps/api/prisma/schema.prisma` | `Run.canonical_report` 列删除 |
| `packages/contracts/src/benchmark.ts` | facade 期保留；#54 删 |
| `packages/contracts/src/load-test.ts` | facade 期保留；#54 删 |
| `packages/contracts/src/run.ts` | 扩展 `createRunRequestSchema`；`runSchema` 已含 `summaryMetrics / rawOutput` 列 |

---

**Status**: Spec 完成，待 implementation plan（writing-plans skill）落地。
