# genai-perf 流程补齐 + prefix-cache 验证 — Design

**Status:** Draft · 2026-05-08
**Branch:** `feat/genai-perf-flow-completion`
**Driver:** 把 genai-perf 工具从 "argv 写好但跑不通" 推到端到端可用；同时把 Higress `ai-load-balancer` 的 prefix-cache 验证作为独立 tool 接入 benchmark 流程

---

## 1. Why

`packages/tool-adapters/src/genai-perf/` + `apps/benchmark-runner/images/genai-perf.Dockerfile` 在前序 PR 已经搭好，但实际 UI 触发一次 benchmark 后立即失败，详情页只看到 `report parse: missing 'profile' output file`，看不到任何工具侧的真实 stderr / 退出码——典型的诊断信息盖叠 bug。

剥开看，问题分三层：

1. **callback 把真因盖掉**：runner 上报 `body.state="failed"` + 真实 stderr 时，api side 还是无脑跑 `parseFinalReport`，抛出来的解析报错把 "tool exited with code N" 替换掉。
2. **adapter 与 handoff §3 已验证调用有偏差**：少 `--service-kind openai`；tokenizer 在 connection / params 都没填时直接省略，触发 genai-perf 自己报错。
3. **prefix-cache 验证目前完全没接入**：handoff §6.3 描述的 stickiness 验证不是 genai-perf 自带能力，需要独立工具 + Prom 抓取，目前 0 实现。

本 PR 一次把这三层都补齐，以 modeldoctor 现有 K8s + adapter 协议为基础（不引入新执行路径）。

## 2. Scope

**In:**
- `apps/api/src/modules/benchmark/callbacks/benchmark-callback.controller.ts` — `body.state==="failed"` 不再触发 parseFinalReport
- `packages/tool-adapters/src/genai-perf/runtime.ts` + `runtime.spec.ts` — 加 `--service-kind openai`；tokenizer 解析顺序加 `connection.model` 兜底
- `apps/web/src/features/benchmarks/forms/GenaiPerfParamsForm.tsx` — 补全可选字段（input/output token 长度、tokenizer），渲染 tokenizer 运行时预览
- `apps/web/src/features/benchmarks/BenchmarkDetailPage.tsx` — 失败时折叠展示 `rawOutput.stderr` 尾部 200 行
- `packages/tool-adapters/src/prefix-cache-probe/` — 全新 adapter（schema / runtime / scenarios / index）
- `apps/benchmark-runner/images/prefix-cache-probe.Dockerfile` + `apps/benchmark-runner/scripts/prefix_cache_probe.py` — 全新镜像与脚本
- `apps/api/src/modules/benchmark/k8s/runner-images.ts` — 注册 prefix-cache-probe 镜像 tag
- `packages/tool-adapters/src/scenarios.ts` — 加 `prefix-cache-validation` 场景
- `apps/web/src/features/benchmarks/forms/PrefixCacheProbeParamsForm.tsx`、`reports/PrefixCacheProbeReport.tsx` — 全新表单 + 报表
- `apps/web/src/features/connections/ConnectionDialog.tsx` — 暴露 `prometheusUrl` 输入（schema/service 已支持）
- `e2e/genai-perf-create-flow.spec.ts` — Playwright happy path
- 新增/调整测试见 §7

**Out:**
- 不修改 K8sBenchmarkRunner / runner/main.py wrapper 协议
- 不动 genai-perf Authorization 路径（继续用 `--header`，已有测试覆盖）
- 不预下载 tokenizer 到镜像（用户决议：tokenizer 由 connection.model 推断，运行时拉取）
- 不做系统级全局 Prom URL 设置（per-connection 字段语义已足够；如未来确实需要，再加 SettingsPage fallback，不影响本 PR 决策）
- prefix-cache-probe 不上 Playwright e2e（依赖真集群 + Prom，本地 stub 无意义；走手测 + 截图 PR）

## 3. 当前架构事实（影响实现的硬约束）

| 事实 | 影响 |
|---|---|
| 只有 `K8sBenchmarkRunner` 一种执行后端（PR #101 移除了 subprocess） | 一切运行必须走 K8s Job；本地 macOS 无法直跑 `genai-perf`（`perf_analyzer` 仅 Linux）。本地 dev 用 k3d 解决 |
| `Connection.prometheusUrl` 已存在于 contracts / DB / api service | 0 schema 变更，只需前端 ConnectionDialog 暴露输入 + prefix-cache-probe 读取 |
| runner image：`tools/build-runner-images.sh` 用 `git log -1 -- apps/benchmark-runner/` 的短 sha 作为 content-addressed tag，build + `k3d image import` 一把梭；`runner-images.ts` 经 `RUNNER_IMAGE_{TOOL}` env 反查 image 名 | 新增 prefix-cache-probe 需同步改 build 脚本（加进循环 + 加进 import 列表）+ `runner-images.ts` 的 TOOL_TO_IMAGE_ENV map + `env.schema.ts` 加 `RUNNER_IMAGE_PREFIX_CACHE_PROBE` 必填项 |
| 测试集群 endpoint 在 `10.100.121.67:30888`，Prom 在 `10.100.121.67:30121`；本地 k3d 通过 NodePort 直连 | 端到端联调时 connection.baseUrl + prometheusUrl 都填 67 这一组；不需要 ExternalName/Ingress 兜底 |
| genai-perf `--profile-export-file foo.json` 实际写出 `foo_genai_perf.json` | 已在 outputFiles 声明里捕获（runtime.ts:157），不动 |
| Prometheus 默认 15s 抓取间隔 | probe 脚本两次 snapshot 之间 `sleep 18`（15+3 缓冲）；`promBackoffSec` 设为可调参数兜底 |

## 4. 设计

### 4.1 callback handler 修复

**位置**：`apps/api/src/modules/benchmark/callbacks/benchmark-callback.controller.ts:113-127`

```ts
let finalState: "completed" | "failed" = body.state;
let message = body.message;
let summary: unknown = null;

if (body.state === "completed") {
  // 工具自报成功才尝试解析；解析失败回退为 failed 并替换 message
  try {
    const fileBuffers = ...;
    summary = adapter.parseFinalReport(body.stdout, fileBuffers);
  } catch (e) {
    finalState = "failed";
    message = `report parse: ${(e as Error).message}`.slice(0, 2048);
    summary = null;
  }
}
// body.state==="failed"：保留 runner 自报的 message（"tool exited with code N"）
//                       + body.stdout/stderr 完整入库 rawOutput，让用户能自查
```

**为什么不直接尝试解析失败状态下的产物**：
- `parseFinalReport` 拿不到 profile 文件就抛出，不会输出更多线索
- 真实失败原因在 stderr（perf_analyzer 缺、tokenizer 拉不下来、网络不通），保留 `body.message` + 入库 stderr 是最小代价的诊断保留路径

### 4.2 genai-perf adapter 修正

**位置**：`packages/tool-adapters/src/genai-perf/runtime.ts`

**改动 1**：脚本头插 `--service-kind openai`
```diff
 genai-perf profile \
+    --service-kind openai \
     -m "$1" -u "$2" \
     --endpoint-type "$3" \
```

**改动 2**：tokenizer 解析改为三级 fallback，且总是发出 `--tokenizer`
```ts
// 优先级：params.tokenizer > connection.tokenizerHfId > connection.model
const resolvedTokenizer =
  params.tokenizer ?? connection.tokenizerHfId ?? connection.model;
optionalTokenFlags += ` \\\n    --tokenizer "$${nextPos}"`;
optionalArgv.push(resolvedTokenizer);
nextPos++;
```

**为什么 connection.model 兜底安全**：
- `Connection.model` 在 contracts 里 `z.string().min(1)`，必填
- vLLM / SGLang 等推理端的 model id 通常就是 HF 模型 id（如 `Qwen/Qwen2.5-0.5B-Instruct`），可以直接当 tokenizer 用
- 推断错的场景（model id 是别名）→ 用户在 connection 里填 `tokenizerHfId` 显式覆盖
- 完全不该是 HF id 的特殊场景 → benchmark params.tokenizer 临时覆盖

**测试更新**（`runtime.spec.ts`）：
- 新增 "always emits --service-kind openai"
- 修改 "omits --tokenizer when neither set" → "falls back to connection.model when neither params.tokenizer nor connection.tokenizerHfId set"

### 4.3 GenaiPerfParamsForm UI 完善

**位置**：`apps/web/src/features/benchmarks/forms/GenaiPerfParamsForm.tsx`

**字段补全**（按 CLAUDE.md form 规约用 `<FormField>` + `<FormSection>` 双列网格）：

```
[ FormSection: 基础 ]
  endpointType (select)        | concurrency (number)
  numPrompts (number)          | streaming (switch)

[ FormSection: 输入/输出长度（可选） ]
  inputTokensMean (number)     | inputTokensStddev (number)
  outputTokensMean (number)    | outputTokensStddev (number)

[ FormSection: Tokenizer ]
  tokenizer (text, optional)
  └─ 描述文本：未填将使用 {{resolvedTokenizer}}（运行时预览，从当前选中的 connection 推断）
```

**Tokenizer 预览渲染**：表单组件接收 `connection: ConnectionPublic | null` prop（已有），用 `tokenizer || connection?.tokenizerHfId || connection?.model` 算实际生效值，置灰展示在描述区。

### 4.4 BenchmarkDetailPage 失败信息展示

**位置**：`apps/web/src/features/benchmarks/BenchmarkDetailPage.tsx`

失败 alert 区下方增加可折叠 stderr tail：

```tsx
{benchmark.status === "failed" && benchmark.rawOutput?.stderr && (
  <details className="mt-3">
    <summary className="cursor-pointer text-sm text-muted-foreground">
      {t("detail.failure.toggleStderr")}
    </summary>
    <pre className="mt-2 max-h-80 overflow-auto rounded bg-muted p-3 text-xs">
      {tailLines(benchmark.rawOutput.stderr, 200)}
    </pre>
  </details>
)}
```

新增 i18n key：`benchmarks.detail.failure.toggleStderr`、`benchmarks.detail.failure.stderrEmpty`（两边都补）。

### 4.5 prefix-cache-probe tool adapter

#### schema（`packages/tool-adapters/src/prefix-cache-probe/schema.ts`）

```ts
export const prefixCacheProbeParamsSchema = z.object({
  promptSets: z.number().int().min(2).max(5).default(2),
  requestsPerSet: z.number().int().min(5).max(50).default(10),
  maxTokens: z.number().int().min(1).max(50).default(5),
  promBackoffSec: z.number().int().min(15).max(60).default(18),
});

const perPodCounts = z.object({
  pod: z.string(),
  queries: z.number().int().nonnegative(),
  hits: z.number().int().nonnegative(),
});

const promptSetSummary = z.object({
  label: z.string(),
  dominantPod: z.string(),
  dominantPct: z.number().min(0).max(100),
  totalRequests: z.number().int(),
});

export const prefixCacheProbeReportSchema = z.object({
  stickinessPct: z.number().min(0).max(100),
  deterministic: z.boolean(),
  perPod: z.array(perPodCounts),
  promptSets: z.array(promptSetSummary),
});
```

#### runtime（`runtime.ts`）

```ts
// argv: python /app/probe.py --url <baseUrl> --prom <prometheusUrl> \
//       --model <model> --rounds <promptSets> --requests <requestsPerSet> \
//       --max-tokens <n> --backoff <sec>
// API key via env OPENAI_API_KEY (same convention as genai-perf)
// outputFiles: { result: "result.json" }
```

`getMaxDurationSeconds`：
```ts
return params.promptSets * (params.requestsPerSet * 5 + params.promBackoffSec) + 60;
```

#### probe 脚本（`apps/benchmark-runner/scripts/prefix_cache_probe.py`）

实现 handoff §4.2 C 的逻辑骨架：
- 5 个固定长前缀 prompt（每个 ~500 token，固定种子保证可重现），按 `promptSets` 取前 N 个
- 每个 batch：snapshot → send N 个相同前缀的请求 → sleep `promBackoffSec` → snapshot → 计算 per-pod delta
- httpx `AsyncClient` per-request + `Connection: close`（handoff §5 第一坑：连接池复用 → 流量看起来全压一个 pod）
- 输出 `result.json` 时按 schema 字段名输出（snake_case → camelCase 由 adapter `parseFinalReport` 内部映射）

#### scenarios 配置

`packages/tool-adapters/src/scenarios.ts` 新增：
```ts
{
  id: "prefix-cache-validation",
  nameKey: "scenarios.prefixCacheValidation.name",
  descriptionKey: "scenarios.prefixCacheValidation.description",
  tools: ["prefix-cache-probe"],
}
```

### 4.6 K8s 镜像注册

三处协同改动，缺一不可：

1. **`apps/api/src/modules/benchmark/k8s/runner-images.ts`** — `TOOL_TO_IMAGE_ENV` map 加：
   ```ts
   "prefix-cache-probe": "RUNNER_IMAGE_PREFIX_CACHE_PROBE",
   ```

2. **`apps/api/src/config/env.schema.ts`** — 加 `RUNNER_IMAGE_PREFIX_CACHE_PROBE: z.string().min(1)` 必填项（`NODE_ENV=test` 时由测试 stub 注入）。

3. **`tools/build-runner-images.sh`** — `for tool in ...` 循环加 `prefix-cache-probe`；`k3d image import` 列表追加 `md-runner-prefix-cache-probe:${TAG}`；脚本末尾的 `echo "RUNNER_IMAGE_..."` 提示也补一行。

镜像命名沿用现有约定：`md-runner-prefix-cache-probe:<tag>`，tag 仍由脚本基于 `apps/benchmark-runner/` 子树 git log 算出，不需要单独管理。

### 4.7 ConnectionDialog 暴露 prometheusUrl

**位置**：`apps/web/src/features/connections/ConnectionDialog.tsx`

加一个 `<FormField name="prometheusUrl">` 输入，`type="url"`，可选，placeholder 给 `http://prom:9090` 示例。

### 4.8 PrefixCacheProbeParamsForm + Report

**Form**（`apps/web/src/features/benchmarks/forms/PrefixCacheProbeParamsForm.tsx`）：四个 number 字段 + 当 `connection.prometheusUrl == null` 时整个表单顶部红色 alert 提示 "该连接未配置 Prometheus URL，无法运行 prefix-cache 验证"。submit disabled。

**Report**（`apps/web/src/features/benchmarks/reports/PrefixCacheProbeReport.tsx`）：
- 顶部一行大数字：`stickinessPct` + `deterministic` 标记
- 中间表格：每个 promptSet → dominantPod / dominantPct / requestCount
- 底部表格：per-pod queries/hits

### 4.9 Playwright e2e

**位置**：`e2e/genai-perf-create-flow.spec.ts`

```
1. Login (复用现有 fixture)
2. Navigate to /benchmarks/new
3. 选 connection、scenario=inference、tool=genai-perf
4. 填 numPrompts=10, concurrency=2
5. Submit
6. 跳到 /benchmarks/<id>，断言 status ∈ {pending, running, completed, failed}
   （因为本地 e2e 没真起 K8s Job，只看前端导航 + 创建 record）
```

注：`apps/api/test/e2e/` 的 vitest e2e 已经覆盖 POST /benchmarks 的 happy path（用 mockRunner 替换 K8sBenchmarkRunner）。此处 Playwright 只验前端表单 → 提交 → 详情页跳转的浏览器侧链路。

### 4.10 端到端联调步骤（k3d 实跑）

PR 合入前必须手测一遍，截图入 PR description：

```
1. ./tools/build-runner-images.sh           # 构建 4 个 runner image + import 进 k3d
2. 把脚本末尾打印的 RUNNER_IMAGE_* 全部贴进 apps/api/.env
3. pnpm dev                                  # 起 web + api
4. 在 web 上新建一个 connection：
   - baseUrl: http://10.100.121.67:30888
   - apiKey: <真实 token>
   - model: gen-studio_Qwen2.5-0.5B-Instruct-hJfe
   - tokenizerHfId: Qwen/Qwen2.5-0.5B-Instruct
   - prometheusUrl: http://10.100.121.67:30121
5. 跑 inference / genai-perf benchmark：numPrompts=20, concurrency=4
   预期：BenchmarkDetailPage 显示 completed + 七项 summary metrics
6. 跑 prefix-cache-validation / prefix-cache-probe：默认参数
   预期：BenchmarkDetailPage 显示 completed + stickinessPct ≈ 100%（plugin 生效场景）
```

如步骤 5/6 失败，根据 BenchmarkDetailPage 上展示的 stderr tail 自查（这次 §4.4 改动的核心收益）。

## 5. 数据流

```
┌──────────────┐  POST /benchmarks            ┌──────────────┐
│ Web (UI form)│ ─────────────────────────►   │ Api (Nest)   │
│              │ {tool, params, connectionId} │              │
└──────────────┘                              └──────┬───────┘
                                                     │ adapter.buildCommand()
                                                     ▼
                                              ┌──────────────┐
                                              │ K8sBenchmark │
                                              │   Runner     │
                                              └──────┬───────┘
                                                     │ create Job + Secret
                                                     ▼
                          ┌──────────────────────────────────┐
                          │ K8s Job pod (k3d)                │
                          │  python -m runner                │
                          │  └─ subprocess: genai-perf | py  │
                          │     └─ HTTP → 67:30888 (vLLM)    │
                          │     └─ HTTP → 67:30121 (Prom)    │
                          │       (prefix-cache-probe only)  │
                          └──────────┬───────────────────────┘
                                     │ /log + /finish callbacks
                                     ▼
                              ┌──────────────┐
                              │ Api callback │
                              │  controller  │
                              └──────┬───────┘
                                     │ if state==completed: adapter.parseFinalReport
                                     │ if state==failed: keep raw stderr/exit code
                                     ▼
                                ┌─────────┐
                                │ Postgres│ (rawOutput, summaryMetrics, statusMessage)
                                └─────────┘
```

## 6. 错误处理

| 失败模式 | 体现 | 用户看到的 |
|---|---|---|
| genai-perf perf_analyzer 缺 / Linux glibc 不兼容 | runner exit code != 0；无 profile 文件 | failed + "tool exited with code N" + stderr tail（带具体错误） |
| Tokenizer HF 拉取失败（网络/不存在） | runner exit code != 0 | failed + stderr 显示 HF download error |
| baseUrl 不可达 | genai-perf timeout 或 connection refused | failed + stderr 显示 |
| profile 文件存在但 JSON schema 与 adapter 期望偏差 | parseFinalReport throws | failed + "report parse: <details>"（保留路径） |
| prefix-cache-probe Prom 抓不到（URL 错） | python script exit code != 0 | failed + stderr |
| prefix-cache-probe Prom 抓到了但 metric 不存在（vLLM 没开 prefix caching） | python script 输出 result.json 但所有 delta 为 0 | completed + stickinessPct=0 + Report 上提示 "no prefix cache queries observed" |

## 7. 测试

| 层 | 模块 | 测试 |
|---|---|---|
| 单测 | benchmark-callback.controller.spec | 加：`/finish state=failed 不调用 parseFinalReport，保留原 message` |
| 单测 | genai-perf runtime.spec | 加：`emits --service-kind openai`、`tokenizer falls back to connection.model` |
| 单测 | genai-perf runtime.spec | 改：`omits --tokenizer when none set` → 删除（因为现在总是有 fallback） |
| 单测 | prefix-cache-probe runtime.spec | 全新：argv 结构 / parseFinalReport fixture 解析 / max-duration |
| 单测 | prefix-cache-probe schema.spec | 全新：边界值校验 |
| 组件 | GenaiPerfParamsForm.test | 加：`tokenizer 预览随 connection 切换` |
| 组件 | PrefixCacheProbeParamsForm.test | 全新：`无 prometheusUrl 时 disable submit + 显示 alert` |
| 组件 | BenchmarkDetailPage.test | 加：`failed 时展示 stderr tail` |
| 组件 | ConnectionDialog.test | 加：`prometheusUrl 字段输入与提交` |
| e2e | genai-perf-create-flow.spec.ts | 全新：happy path |
| 手测 | k3d 真起 Job | 文档于 PR description；附 BenchmarkDetailPage 截图 |

## 8. PR 编排（单 PR · phase-per-commit）

按 CLAUDE.md「结构上耦合的工作合一个 PR」：

1. `fix(api): preserve original failure message in /finish callback`
2. `fix(tool-adapters/genai-perf): emit --service-kind openai + tokenizer fallback`
3. `feat(web/benchmarks): GenaiPerfParamsForm full params + stderr tail in detail`
4. `feat(tool-adapters): add prefix-cache-probe adapter + scenario`
5. `feat(benchmark-runner): prefix-cache-probe image + Python probe script + build script wiring`
6. `feat(api/benchmark): register prefix-cache-probe runner image (env + map)`
7. `feat(web): PrefixCacheProbeParamsForm + report + ConnectionDialog prometheusUrl input`
8. `test(e2e): genai-perf benchmark create happy path`

每 commit 自洽通过 `pnpm -r build && pnpm -r test`。最终 PR 在 `gh pr create` 后按 CLAUDE.md "PR follow-through" 走签收流程（`gh pr view --json` + `gh pr checks`）。

## 9. Open Questions

- prefix-cache-probe 的 5 个长 prompt：写死在 Python 脚本里就够了，还是抽到 K8s ConfigMap / inputFile？V1 写死，留扩展点（修改 prompt 需要重新 build image，可接受）
- prefix-cache-probe Report 是否要做趋势图（多次跑对比 stickiness 变化）：留 V2，本次只做单次详情页
- callback handler 改为 state==="completed" 才 parseFinalReport 之后，对于 vegeta（attack.bin 体积大可能导致解析慢）的影响：观察后再说，不在本 PR 范围内
