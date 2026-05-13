# Evalscope + AIPerf 工具迁移设计

**日期**: 2026-05-13
**作者**: weetime + Claude (brainstormed)
**状态**: 设计 → 待 spec review → writing-plans

## 1. 背景与目标

ModelDoctor 当前 LLM perf 这一层有三个 driver：`guidellm`、`genai-perf`、自研 `kv-cache-stress`。其中两个有严重问题：

- **`genai-perf` 已被 NVIDIA 官方 deprecated**，建议迁移到 [AIPerf](https://github.com/ai-dynamo/aiperf)。继续维护 = 技术债。
- **自研 `kv-cache-stress`** 的工作负载（多轮 dialog 高并发合成 prompt）不符合团队实际选型工作流——团队近期 yrcache vs lmcache 对比报告用的是 `evalscope perf` + LongAlpaca-12k，自研 driver 没参与。

业内 LLM perf 工具没有公认标准，事实上分裂为 NVIDIA 系（AIPerf）、vLLM 生态（guidellm）、ModelScope/Ascend 系（evalscope）三条线。本次迁移采用 **Option B：三 driver 并存**，让用户能在 inference 场景里横向选 driver、做 cross-validation。

### 目标

1. 删除 `genai-perf` 和 `kv-cache-stress` 两个 driver
2. 新增 `aiperf`（替换 genai-perf）和 `evalscope`（替换 kv-cache-stress 工作负载、并作为 inference 场景第三选项）
3. 默认模板适配 evalscope：KV Cache 场景 6 个 task 模板（按 2026-05-12 报告方法学），Inference 场景 2 个 evalscope 模板
4. KV Cache 报告页升级：cold/warm 对比面板 + prefix cache 命中面板

### 非目标

- 不在 Capacity Planning 场景加 evalscope（evalscope 没有 SLO sweep，V1 不做）
- 不做 cold/warm 的"一次 benchmark 内部双轮"语义（保持 1 task = 1 benchmark 与现有模型一致）
- 不做 task matrix 一键全套（用户用模板 + Compare 页拼接）
- 不写 DB rename migration（开发阶段，硬删）

## 2. 最终 Tool 矩阵

| Scenario | Tools |
|---|---|
| Inference Performance | guidellm · aiperf · **evalscope** |
| Capacity Planning | guidellm（V1 不加 evalscope） |
| Gateway Load Test | vegeta |
| Prefix-cache Validation | prefix-cache-probe |
| KV Cache Stress | **evalscope**（唯一） |

`BenchmarkTool` 枚举最终态：`["guidellm", "aiperf", "evalscope", "vegeta", "prefix-cache-probe"]`。

## 3. 硬删除策略

开发阶段，不留兼容口。

**代码**：
- 删 `packages/tool-adapters/src/genai-perf/` 整个目录
- 删 `packages/tool-adapters/src/kv-cache-stress/` 整个目录
- 删 `apps/benchmark-runner/images/{genai-perf,kv-cache-stress}.Dockerfile`
- 删 `tools/build-runner-images.sh` 中关联的 build target
- 删 `apps/api/src/modules/benchmark/k8s/runner-images.ts` 中两个 image key
- 删 `apps/web/src/features/benchmarks/forms/` 下相关 ParamsEditor（如有）

**Schema/contracts**：
- `BenchmarkTool` 枚举去 `"genai-perf"` `"kv-cache-stress"`，加 `"aiperf"` `"evalscope"`
- `scenarios.ts` 更新 `inference.tools` / `kv-cache-stress.tools`

**数据库**：
- 一个 Prisma migration，按顺序：
  1. `DELETE FROM saved_compares WHERE benchmark_ids 内含废弃 tool 的 benchmark id`
  2. `DELETE FROM benchmarks WHERE tool IN ('genai-perf', 'kv-cache-stress')`
  3. `DELETE FROM benchmark_templates WHERE tool IN ('genai-perf', 'kv-cache-stress')`

**测试 / fixture**：
- 删 `packages/tool-adapters/src/{genai-perf,kv-cache-stress}/__fixtures__/`
- 删相关 .spec.ts

**i18n**：
- 删 `tools.genai-perf` / `tools.kv-cache-stress` 键值
- 加 `tools.aiperf` / `tools.evalscope`

## 4. 新 Adapter：`evalscope`

### 4.1 Params Schema

```ts
// packages/tool-adapters/src/evalscope/schema.ts
export const evalscopeParamsSchema = z.object({
  parallel: z.number().int().min(1).max(256).default(8),
  number: z.number().int().min(1).max(10000).default(64),
  dataset: z.enum(["longalpaca", "openqa", "random"]).default("longalpaca"),
  minPromptLength: z.number().int().min(1).max(32000).default(8000),
  maxPromptLength: z.number().int().min(1).max(32000).default(9000),
  minTokens: z.number().int().min(1).max(4096).default(160),
  maxTokens: z.number().int().min(1).max(4096).default(200),
  apiPath: z.enum(["/v1/chat/completions", "/v1/completions"]).default("/v1/chat/completions"),
  stream: z.boolean().default(true),
  seed: z.number().int().optional(),
}).refine(p => p.minPromptLength <= p.maxPromptLength, {
  message: "minPromptLength must be <= maxPromptLength",
}).refine(p => p.minTokens <= p.maxTokens, {
  message: "minTokens must be <= maxTokens",
});
```

### 4.2 Report Schema

```ts
export const evalscopeReportSchema = z.object({
  throughput: z.object({
    requestsPerSec: z.number().nonnegative(),
    outputTokensPerSec: z.number().nonnegative(),
    totalTokensPerSec: z.number().nonnegative(),
  }),
  ttft: latencyDistSchema,      // mean / p50 / p90 / p95 / p99 (ms)
  e2eLatency: latencyDistSchema,
  itl: latencyDistSchema,        // inter-token latency
  requests: z.object({
    total: z.number().int().nonnegative(),
    success: z.number().int().nonnegative(),
    error: z.number().int().nonnegative(),
    errorRate: z.number().min(0).max(1),
  }),
  // evalscope 独有
  prefixCacheStats: z.object({
    hitRate: z.number().min(0).max(1),
    savings: z.number().min(0).max(1),
  }).optional(),
});
```

### 4.3 buildCommand

```ts
argv = ["evalscope", "perf",
  "--url", connection.baseUrl,
  "--api", connection.baseUrl + apiPath,
  "--model", connection.model,
  "--parallel", String(parallel),
  "--number", String(number),
  "--dataset", dataset,
  ...(dataset === "longalpaca" ? ["--dataset-path", "/opt/evalscope-datasets/longalpaca"] : []),
  "--min-prompt-length", String(minPromptLength),
  "--max-prompt-length", String(maxPromptLength),
  "--min-tokens", String(minTokens),
  "--max-tokens", String(maxTokens),
  ...(seed != null ? ["--seed", String(seed)] : []),
  ...(stream ? ["--stream"] : []),
  "--output-dir", "out",
];
```

`parseFinalReport` 读 evalscope 输出的 `out/<timestamp>/benchmark.json` 并映射到 `evalscopeReportSchema`。

### 4.4 镜像

`apps/benchmark-runner/images/evalscope.Dockerfile`：
- `FROM python:3.11-slim`
- `pip install evalscope==<pin>` + `pip install modelscope` (for dataset CLI)
- Build 阶段执行 `modelscope download AI-ModelScope/LongAlpaca-12k --local_dir /opt/evalscope-datasets/longalpaca`
- 拷 runner wrapper
- 运行用户 `runner`
- 最终大小约 1.7 GB

**只 bake `longalpaca`**（默认 + 最常用 + 体积可控）。`openqa` / `random` 选项交给 evalscope 内置 generator——`random` 完全合成不需要 dataset 文件；`openqa` 是 evalscope 自带小数据集（< 5 MB），runtime 下载可接受。`buildCommand` 在传 `--dataset longalpaca` 时附 `--dataset-path /opt/evalscope-datasets/longalpaca`，其它 dataset 不传 path 让 evalscope 走默认路径。

## 5. 新 Adapter：`aiperf`

### 5.1 Params Schema

```ts
export const aiperfParamsSchema = z.object({
  concurrency: z.number().int().min(1).max(512).default(8),
  requestCount: z.number().int().min(1).max(10000).default(100),
  inputTokensMean: z.number().int().min(1).max(32000).default(1024),
  inputTokensStddev: z.number().int().min(0).max(8192).default(128),
  outputTokensMean: z.number().int().min(1).max(4096).default(256),
  outputTokensStddev: z.number().int().min(0).max(2048).default(64),
  apiPath: z.enum(["/v1/chat/completions", "/v1/completions"]).default("/v1/chat/completions"),
  streaming: z.boolean().default(true),
  dataset: z.enum(["sharegpt", "synthetic"]).default("synthetic"),
});
```

> **AIPerf CLI 调研待补**：实现期间用 `pip install aiperf` + `aiperf --help` 确认实际选项；如与上述假设差异 > 1 个字段，回到 spec 更新。

### 5.2 Report Schema

复用 `evalscopeReportSchema` 的"通用 perf 三件套"形状（throughput / ttft / e2e / itl / requests），不包含 `prefixCacheStats`。

### 5.3 镜像

`apps/benchmark-runner/images/aiperf.Dockerfile`：`FROM python:3.11-slim` + `pip install aiperf==<pin>` + runner wrapper。约 1 GB。

## 6. 默认模板（seed.ts）

### 6.1 删除

- 所有 `tool IN ('genai-perf', 'kv-cache-stress')` 的官方模板

### 6.2 新增 KV Cache（scenario = `kv-cache-stress`，tool = `evalscope`）

| 模板 id | 模板名 | min-max prompt | parallel | number | min-max tokens |
|---|---|---|---|---|---|
| `kvs-evalscope-task-1` | KV Cache · Task 1 · 8K prompt · parallel 8 | 8000-9000 | 8 | 64 | 160-200 |
| `kvs-evalscope-task-2` | KV Cache · Task 2 · 8K prompt · parallel 16 | 8000-9000 | 16 | 128 | 160-200 |
| `kvs-evalscope-task-3` | KV Cache · Task 3 · 11K prompt · parallel 8 | 11000-13000 | 8 | 64 | 300-400 |
| `kvs-evalscope-task-4` | KV Cache · Task 4 · 11K prompt · parallel 16 | 11000-13000 | 16 | 128 | 300-400 |
| `kvs-evalscope-task-5` | KV Cache · Task 5 · 14K prompt · parallel 8 | 14000-16000 | 8 | 64 | 100-200 |
| `kvs-evalscope-task-6` | KV Cache · Task 6 · 14K prompt · parallel 16 | 14000-16000 | 16 | 128 | 100-200 |

通用：dataset=longalpaca, seed=42, stream=true, apiPath=/v1/chat/completions, `isOfficial: true`。

### 6.3 新增 Inference（scenario = `inference`，tool = `evalscope`）

- `inf-evalscope-short`: 短 prompts · openqa · parallel 8 · number 100
- `inf-evalscope-long`:  长 prompts · longalpaca 8K · parallel 8 · number 64

guidellm 现有官方模板**保持不动**。

## 7. UI / Report 集成

### 7.1 Form

新增：
- `apps/web/src/features/benchmarks/forms/EvalScopeParamsEditor.tsx`
- `apps/web/src/features/benchmarks/forms/AIPerfParamsEditor.tsx`

`ToolParamsEditor` router 加两个 case，删 genai-perf / kv-cache-stress 两个 case。

### 7.2 Report

**InferenceReport.tsx**：discriminated union 加 `aiperf` `evalscope` 分支；删 `genai-perf` 分支。三个 tool 共享同一个布局（throughput / latency / requests），渲染数据从 `summaryMetrics.data` 读。

**KvCacheStressReport.tsx**：保留并重写——
- 数据源从 self-built shape 改为 `evalscopeReportSchema`
- 新增 cold/warm 对比面板：自动检测当前 benchmark 是否有同名 `(rerun)` 子 benchmark；有则并排画 TTFT / throughput / ITL delta
- 新增 prefix cache 命中面板：直接读 `prefixCacheStats.hitRate / savings`

### 7.3 List 页读取函数

`readP95Latency` / `readErrorRate` / `readOutputTps` 等 discriminated-union 读取函数补 `aiperf` / `evalscope` case，删 `genai-perf` / `kv-cache-stress` case。

### 7.4 i18n

`apps/web/src/locales/{en-US,zh-CN}/benchmarks.json`：
- 加 `tools.evalscope` `tools.aiperf` 翻译
- 删 `tools.genai-perf` `tools.kv-cache-stress`
- 加新 ParamsEditor 字段 label
- 加新模板说明文案

## 8. 验证策略

1. `pnpm -r type-check` / `lint` / `test` 全过
2. `packages/tool-adapters` 新增 fixture-based 单元测试：
   - evalscope `buildCommand` 输出 argv 快照
   - evalscope `parseFinalReport` 解析样例 JSON
   - aiperf 同上
3. Manual smoke（用 dev 集群 + 一个 vLLM 测试 endpoint）：
   - 用 `KV Cache · Task 4` 模板跑 1 次 → 看 KvCacheStressReport 渲染 → 点 rerun → 验证 cold/warm 面板出现
   - 在 Inference Performance 创建一个 evalscope benchmark → 看 InferenceReport 渲染
4. Playwright e2e：加 1 个 case（创建 evalscope benchmark 至少能进 detail 页 + 看到状态变化）
5. Prisma migration：在 dev DB 上跑一次 `prisma migrate dev`，确认 `benchmarks` 表里没有 genai-perf / kv-cache-stress 行；`pnpm db:seed` 后看到 8 个新模板

## 9. 体积估算

- 新代码：~2500 行（adapter × 2 + Editor × 2 + Report 改写 + 模板 + 镜像 + 测试）
- 删代码：~800 行（genai-perf + kv-cache-stress + 相关测试）
- 净增 ~1700 行
- 跨 8 个目录（contracts / tool-adapters / api / web/benchmarks / web/forms / web/reports / benchmark-runner/images / locales）
- 一个 Prisma migration

## 10. Open Questions

- AIPerf 实际 CLI 选项与本 spec 假设的 schema 偏差程度——实现前要用真 CLI `--help` 验一遍；偏差大就回到 spec 改 §5.1。
- KvCacheStressReport 的 cold/warm 配对算法是否够鲁棒——目前按"同 name 加 `(rerun)`"配对；如果用户改 name，配对失败。可接受，UI 提示"未找到配对"即可。
