# 推理引擎指标看板 — Design

**Status:** Draft · 2026-05-09
**Branch:** `feat/engine-metrics-dashboard`
**Driver:** 在 Benchmark Detail 页面挂一层"推理引擎自身的指标看板"，把引擎本体（vLLM / SGLang / TGI / MindIE / TEI）暴露的 Prometheus 指标按引擎家族适配后，跟当前压测时间窗口对齐渲染，让用户在压测排障时能同时看到"工具产物"和"引擎健康度"两个视角。

---

## 1. Why

当前 Benchmark Detail 上能看到的全部都是**压测工具自己的产物**（guidellm 的 `report.json`、genai-perf 的 `profile_export.json`、vegeta 的 `latencies.ndjson`、prefix-cache-probe 的 stickiness 摘要）。用户排障时常见的几类问题，工具侧产物完全无法回答：

- 「TTFT P99 突然飙到 800ms 是为什么」 → 引擎那一刻 KV cache 是不是打满了？scheduler 是不是在 preempt？
- 「prefix-cache-probe 为什么 stickiness 只有 76.9%」 → 引擎自己的 prefix cache hit rate 真实值是多少？三个 Pod 的 cache 用量趋势是否一致？
- 「这次压测 throughput 只有上次的一半」 → 引擎是不是有 OOM / Python GC stall / preemption 风暴？

这些信号引擎本身**已经通过 Prometheus 暴露了**（vLLM 的 `vllm:gpu_cache_usage_perc`、SGLang 的 `sglang:num_running_reqs`、TGI 的 `tgi_queue_size`、TEI 的 `te_queue_size`、MindIE 的 `mindie:*` ……）—— ModelDoctor 只缺一层"按引擎家族查询 + 按 benchmark 时间窗对齐 + 按统一 UI 展示"的胶水层。

prefix-cache-probe 已经验证了「后端 → Prom 查询」这条路径是通的（PR #149）。本 PR 把这条路径泛化为可被任意 benchmark 复用的能力。

## 2. Scope

**In:**
- `packages/contracts/src/engine.ts` — 抽出 `EngineId` 类型，作为 connection / deployment-recipes / engine-metrics 三处的 SSOT
- `packages/contracts/src/connection.ts` — `serverKindSchema` 从 5 → 10 引擎，跟 `EngineId` 对齐
- `packages/contracts/src/engine-metrics.ts` — 新建。定义 `EngineCapability`（`generative | embedding`）、`EngineMetricSpec`、`EngineMetricsSnapshotResponse`
- `packages/contracts/src/engine-metrics/manifests/` — 5 引擎 manifest（vllm / sglang / tgi / mindie / tei），每个一个 `.ts`
- `apps/api/src/modules/engine-metrics/` — 新建模块（`engine-metrics.module.ts` / `engine-metrics.service.ts` / `engine-metrics.controller.ts` / spec 文件）
  - `GET /api/engine-metrics/:connectionId/snapshot?from=&to=&step=` —— 后端代理 PromQL，按 manifest 批量查询
- `apps/web/src/features/engine-metrics/` — 新建。`EngineMetricsSection.tsx`（容器）/ `panels/{StatPanel,TimeseriesPanel,GaugePanel,HeatmapPanel}.tsx` / `useEngineMetrics.ts`（react-query hook）
- `apps/web/src/features/benchmarks/BenchmarkDetailPage.tsx` — 在 ReportSection 之后、RawOutput 之前插入 `<EngineMetricsSection>` 区块（条件：`connection.prometheusUrl != null && connection.serverKind != null && isTerminal`）
- `apps/web/src/features/connections/ConnectionDialog.tsx` — `serverKind` 下拉补齐 5 个新引擎选项
- `apps/web/src/locales/{zh-CN,en-US}/engine-metrics.json` — 新建文案
- 测试：每个 manifest 一份 PromQL 快照测试；service 一份 spec；section 一份 component test

**Out（M1 不做，留 Phase 2+）:**
- 顶级 Sidebar Engine Dashboard（独立页 + 实时模式）
- benchmark 完成时把指标 snapshot 落到 DB（永久回放）
- TRT-LLM / LMDeploy / Infinity / llama.cpp / ComfyUI 5 个引擎的 manifest
- Diffusion 模型独立 panel set（Group C）
- 阈值告警 / panel 之间的关联标注（"此处 KV cache 已 95%，与 TTFT 飙升时间点对齐"）
- 多 benchmark / 多 connection 对比视图
- Grafana 深链跳转（用户已选 Plan A 纯内置，不混合）

## 3. 当前架构事实（影响实现的硬约束）

| 事实 | 影响 |
|---|---|
| `Connection.prometheusUrl` 已存在；`Connection.serverKind` 已存在但只覆盖 5 引擎 | 0 schema 变更（`server_kind` 是 `String?`，扩值不变 DB），只动 zod enum + 前端下拉 + manifest |
| prefix-cache-probe runner 已经在 K8s Job 里查 Prom（PromQL `or` 子句兼容 V0/V1，`model_name=` 过滤） | 验证过的兼容套路直接搬到 manifest |
| `Connection.model` 是单一字段（不是 list），就是 `model_name` Prom label 的值 | manifest 里的 PromQL 模板用 `{model_name="${connection.model}"}` 注入即可 |
| Benchmark 有 `startedAt` / `finishedAt` 时间戳 | 直接作为 `[from, to]` 锚点；UI 默认窗口 `[startedAt - 30s, finishedAt + 30s]` 让用户能看到压测前/后的引擎基线 |
| Prometheus 默认保留 15 天（`scrape_interval=15s`） | 实时查 Prom，超出保留期则查询返回空，UI 显示 "Prometheus 数据已过期" 占位（不报错）|
| 引擎清单的 SSOT 当前在 `apps/web/src/features/deployment-recipes/types.ts` 的 `EngineId` 类型 | 提到 contracts 包统一管理；deployment-recipes 改 import |
| `nestjs-zod` 5 + Zod controller validation 是当前模式（参考 `prefix-cache-probe.controller`、`benchmark.controller`） | engine-metrics controller 跟样板走 |
| api 内已有 `httpx`-equivalent：`undici` 通过 `globalThis.fetch` | 后端查 Prom 直接用 `fetch`，不引入新依赖 |
| Prometheus `/api/v1/query_range` 接口接受 `start`/`end`/`step` query string | 后端只代理这一个 endpoint；不需要 PushGateway / remote_read |

## 4. 设计

### 4.1 引擎能力分组

把 10 个引擎按**指标语义**分两组：

```typescript
// packages/contracts/src/engine-metrics.ts
export type EngineCapability = "generative" | "embedding";

export const ENGINE_CAPABILITY: Record<EngineId, EngineCapability> = {
  vllm: "generative",
  sglang: "generative",
  tgi: "generative",
  mindie: "generative",
  trtllm: "generative",  // M2
  lmdeploy: "generative",  // M2
  llamacpp: "generative",  // M2
  tei: "embedding",
  infinity: "embedding",  // M2
  comfyui: "generative",  // M2 — 实际上是 diffusion，需要 Group C，先放 generative 占位
};
```

理由：TTFT / TPOT / KV cache / Prefix cache 这些概念**只在自回归生成式引擎**有意义。embedding 引擎（TEI / Infinity）一次性 forward 出一个向量，没有 first/inter token 的概念，强行把生成式 panel 套上去会全空。

### 4.2 Manifest 数据结构

```typescript
// packages/contracts/src/engine-metrics.ts
export const PANEL_KIND = z.enum(["stat", "gauge", "timeseries", "heatmap"]);
export type PanelKind = z.infer<typeof PANEL_KIND>;

export const PANEL_UNIT = z.enum(["ms", "s", "%", "ratio", "tps", "rps", "count", "bytes"]);
export type PanelUnit = z.infer<typeof PANEL_UNIT>;

export const PANEL_GROUP = z.enum([
  "topline",      // 5 个核心 stat
  "latency",      // E2E / Stage / TTFT vs TPOT
  "throughput",   // Token 吞吐 / Queue / Heatmap
  "engine",       // KV / prefix / scheduler
  "health",       // GC / finish_reason / success
]);
export type PanelGroup = z.infer<typeof PANEL_GROUP>;

export interface EngineMetricSpec {
  /** Stable key — same across all engines for the same semantic metric.
   * UI uses this to decide layout slot; i18n key derives from it.
   * Example: "ttft_p99", "kv_cache_usage", "prefix_hit_rate", "queue_depth". */
  key: string;
  group: PanelGroup;
  panel: PanelKind;
  unit: PanelUnit;
  /** PromQL templates. Tried in order; first non-empty result wins.
   * `${model}` is the only allowed interpolation variable. */
  promql: Array<{ tag?: string; expr: string }>;
  /** Optional thresholds for stat/gauge color coding. */
  thresholds?: Array<{ at: number; severity: "ok" | "warn" | "crit" }>;
}

export interface EngineManifest {
  engineId: EngineId;
  capability: EngineCapability;
  /** Display name shown in the section header (e.g. "vLLM (V0/V1)"). */
  displayName: string;
  metrics: EngineMetricSpec[];
}
```

### 4.3 5 个 M1 manifest

#### 4.3.1 vLLM (V0 + V1 双兼容) — 19 panel

> V0 `vllm:gpu_*` 与 V1 `vllm:*`（无前缀）通过 `or` 子句双匹配。所有 PromQL 都带 `{model_name="${model}"}` 过滤。

| group | key | panel | PromQL（V1 优先） |
|---|---|---|---|
| topline | success_rate | stat | `sum(rate(vllm:request_success_total{model_name="${model}"}[5m])) / sum(rate(vllm:request_total{model_name="${model}"}[5m]))` |
| topline | active_requests | gauge | `sum(vllm:num_requests_running{model_name="${model}"})` |
| topline | system_efficiency | stat | `sum(rate(vllm:generation_tokens_total{model_name="${model}"}[1m])) / sum(rate(vllm:prompt_tokens_total{model_name="${model}"}[1m]))` |
| topline | ttft_p99 | stat | `histogram_quantile(0.99, sum by (le)(rate(vllm:time_to_first_token_seconds_bucket{model_name="${model}"}[5m]))) * 1000` |
| topline | preemption_rate | stat | `sum(rate(vllm:num_preemptions_total{model_name="${model}"}[1m]))` |
| latency | e2e_latency | timeseries | `histogram_quantile(0.50/0.95/0.99, ...)` 三条线，单位 ms |
| latency | stage_breakdown | timeseries | `vllm:time_in_prefill_seconds_*` + `vllm:time_in_decode_seconds_*`，stacked area |
| latency | ttft_vs_tpot | timeseries | TTFT P99 + TPOT P99 双线 |
| throughput | token_throughput_in | timeseries | `sum(rate(vllm:prompt_tokens_total{model_name="${model}"}[1m]))` |
| throughput | token_throughput_out | timeseries | `sum(rate(vllm:generation_tokens_total{model_name="${model}"}[1m]))` |
| throughput | token_io_ratio | stat | `out / in` 比值 |
| throughput | prefix_cache_savings | gauge | V1: `sum(rate(vllm:prefix_cache_hits_total{...}[5m])) / sum(rate(vllm:prefix_cache_queries_total{...}[5m]))`；V0: `vllm:gpu_prefix_cache_*` |
| throughput | request_queue_time | timeseries | `histogram_quantile(0.5/0.99, vllm:request_queue_time_seconds_bucket{...})` |
| throughput | request_length_heatmap | heatmap | `vllm:request_prompt_tokens_bucket{model_name="${model}"}` 直方桶 |
| engine | kv_cache_usage | timeseries | `vllm:gpu_cache_usage_perc{model_name="${model}"}` per-pod |
| engine | prefix_cache_hit_rate | gauge | 同 prefix_cache_savings |
| engine | scheduler_state | timeseries | `vllm:num_requests_running` + `vllm:num_requests_waiting` + `vllm:num_requests_swapped` |
| health | python_gc_memory | timeseries | `python_gc_collections_total` + `process_resident_memory_bytes`（双 Y 轴） |
| health | finish_reason | timeseries | `sum by (finished_reason)(rate(vllm:request_success_total{model_name="${model}"}[1m]))` stacked |

> 完整 PromQL 表达式落到 `manifests/vllm.ts`，spec 不复制全文。

#### 4.3.2 SGLang — 9 panel

SGLang 的指标命名空间是 `sglang:*`，覆盖度比 vLLM 少：

| group | key | 用得上的 SGLang 指标 |
|---|---|---|
| topline | active_requests | `sglang:num_running_reqs` |
| topline | ttft_p99 | `histogram_quantile(0.99, sglang:time_to_first_token_seconds_bucket)` |
| topline | success_rate | `sglang:request_success_total / sglang:request_total` |
| latency | e2e_latency | `sglang:e2e_request_latency_seconds_bucket` (P50/P95/P99) |
| throughput | token_throughput_out | `sglang:gen_throughput` |
| throughput | request_queue_time | `sglang:queue_req` (gauge — 队列里的请求数 × 平均等待) |
| engine | kv_cache_usage | `sglang:token_usage`（SGLang 报 token 占用比例，对应 KV cache 利用率） |
| engine | scheduler_state | `sglang:num_running_reqs` + `sglang:num_queue_reqs` |
| health | finish_reason | `sglang:request_success_total` by reason |

不上报的指标（preemption_rate / stage_breakdown / prefix_cache_*）panel 显示 "SGLang 不暴露此指标"。

#### 4.3.3 TGI — 7 panel

TGI 暴露的 Prometheus 指标都是 `tgi_*` 前缀：

| group | key | TGI 指标 |
|---|---|---|
| topline | active_requests | `tgi_batch_current_size` |
| topline | ttft_p99 | `histogram_quantile(0.99, tgi_request_inference_duration_bucket)` |
| latency | e2e_latency | `tgi_request_duration_bucket`（P50/P95/P99） |
| latency | stage_breakdown | `tgi_request_queue_duration_*` + `tgi_request_inference_duration_*` |
| throughput | token_throughput_out | `rate(tgi_tokenize_total[1m])` |
| throughput | request_queue_time | `tgi_queue_size` 趋势 + `tgi_request_queue_duration_*` |
| engine | scheduler_state | `tgi_batch_current_size` + `tgi_queue_size` 双线 |

#### 4.3.4 MindIE — 5 panel（保守）

MindIE 的 Prometheus 指标暴露是 `mindie_*` 前缀，但社区文档稀缺。M1 只落最稳的：

| group | key | MindIE 指标（待与用户的 67 集群核实） |
|---|---|---|
| topline | active_requests | `mindie_running_request_count` |
| topline | ttft_p99 | `histogram_quantile(0.99, mindie_first_token_duration_seconds_bucket)` |
| latency | e2e_latency | `mindie_request_duration_seconds_bucket` |
| throughput | token_throughput_out | `rate(mindie_generation_tokens_total[1m])` |
| engine | kv_cache_usage | `mindie_kv_cache_usage_ratio`（如不存在则降级为占位） |

> **风险标注**：MindIE 的指标名需要在实施时通过 `kubectl exec -- curl localhost:8000/metrics | grep ^mindie` 实地核对一遍，可能需要按用户 67 集群的实际版本调整。spec 接受"M1 上线后 MindIE panel 数量可能 ±2"。

#### 4.3.5 TEI（embedding） — 6 panel

TEI 的指标都是 `te_*` 前缀，没有生成式概念：

| group | key | TEI 指标 |
|---|---|---|
| topline | active_requests | `te_request_count{state="running"}` |
| topline | success_rate | `te_request_count{state="success"} / te_request_count{state=~"success\|failure"}` |
| topline | request_latency_p99 | `histogram_quantile(0.99, te_request_duration_seconds_bucket)` × 1000 ms |
| throughput | tokenize_rate | `rate(te_tokenize_count[1m])` (input tokens/s) |
| throughput | embedding_rate | `rate(te_request_count{state="success"}[1m])` (embeddings/s) |
| engine | queue_metrics | `te_queue_size` + `histogram_quantile(0.99, te_queue_duration_seconds_bucket)` 双线 |

UI 上 TEI 只显示 `topline / throughput / engine` 三组，**不显示 latency / health 组**（latency 已经合并到 topline.request_latency_p99；health 在 embedding 场景没什么观察价值）。

### 4.4 后端 module

```
apps/api/src/modules/engine-metrics/
  engine-metrics.module.ts
  engine-metrics.service.ts        # 核心：fetchSnapshot(connectionId, from, to, step)
  engine-metrics.service.spec.ts
  engine-metrics.controller.ts     # GET /api/engine-metrics/:connectionId/snapshot
  engine-metrics.controller.spec.ts
  prom-client.ts                   # 薄封装：fetch + range query parsing + 错误归一化
  prom-client.spec.ts
```

**service.fetchSnapshot 流程：**

1. `connectionRepo.findOne(connectionId)` — 拉 connection；空 Prom URL 或空 serverKind → throw 422 + `{ reason: "engine_metrics_not_configured" }`
2. 按 `serverKind` 取 manifest（`@modeldoctor/contracts/engine-metrics/manifests/<engineId>`）
3. 对 manifest.metrics 里每个 spec：
   - 用 `connection.model` 替换 PromQL 模板里的 `${model}`
   - 调 `promClient.queryRange(promUrl, expr, from, to, step)`
   - 失败/空 → 返回 `{ key, samples: [], unavailable: true, reason: "no_data" | "prom_error" }`
   - 成功 → `{ key, samples: [[ts, value], ...], series: [{ pod?, instance? }, ...] }`
4. 并发：`Promise.allSettled`，单个 panel 错误不拖累其它
5. 返回 `EngineMetricsSnapshotResponse`

**controller：**

```typescript
@Get(":connectionId/snapshot")
@ApiOkResponse({ description: "Engine metrics for the given window" })
async snapshot(
  @Param("connectionId") connectionId: string,
  @Query() query: EngineMetricsSnapshotQuery,  // zod-validated
): Promise<EngineMetricsSnapshotResponse> {
  return this.svc.fetchSnapshot(connectionId, query);
}
```

`EngineMetricsSnapshotQuery`：

```typescript
{
  from: string;  // ISO datetime
  to: string;    // ISO datetime
  step?: number; // seconds, default 15 (= Prom scrape interval)
}
```

**鉴权**：复用现有 JWT guard。`engine-metrics` 走 `connectionId` 路径，`connection.userId` 必须 == `req.user.id`，否则 403。复用 `connectionRepo.findOneByIdAndUser`。

**速率限制**：复用全局 throttler（100 req/min）。M1 不做 panel 级 cache（实时查 Prom 本来就快，单次 19 个 panel ≈ 200ms）。

### 4.5 前端组件

```
apps/web/src/features/engine-metrics/
  EngineMetricsSection.tsx          # 容器：标题 + group 排版 + skeleton + 错误态
  useEngineMetrics.ts               # react-query hook
  panels/
    StatPanel.tsx                   # 单值 + 阈值色
    GaugePanel.tsx                  # 圆环
    TimeseriesPanel.tsx             # recharts <LineChart> + benchmark 时间窗阴影
    HeatmapPanel.tsx                # recharts <ScatterChart> 模拟（M1 用 stacked bar 简化）
  EngineMetricsSection.test.tsx
```

**`<EngineMetricsSection benchmarkId={…} />` 行为：**

1. 通过 `useBenchmark(benchmarkId)` 拿到 `connectionId / startedAt / finishedAt / scenario`
2. 算时间窗：`from = startedAt - 30s`、`to = finishedAt + 30s`、`step = max(15, (to - from) / 200)` (确保 ≤ 200 个采样点)
3. `useEngineMetrics(connectionId, { from, to, step })` 调 API
4. 按 manifest.metrics 的 group 分组，按 group 顺序渲染：
   - `topline` 一排 5 个 stat（grid-cols-5）
   - `latency` 一排 3 个 timeseries（grid-cols-3）
   - `throughput` 一排 5 个 mixed
   - `engine` 一排 3 个 mixed
   - `health` 一排 3 个 mixed
5. **Timeseries panel 必须用阴影区标出 `[startedAt, finishedAt]`**（recharts `<ReferenceArea>`），让"压测时段"和"引擎指标"的对应关系一眼能看出来
6. 单个 panel `unavailable: true` → 显示 "（该引擎不上报此指标）" 灰色占位
7. 整体 401/403/404 → 显示"未配置 Prometheus URL"提示，附"前往 Connection 配置"链接
8. 空态（connection 无 `prometheusUrl` 或 `serverKind`）→ 干脆不渲染整个 section（在 BenchmarkDetailPage 上层 gate）

**recharts 用现有依赖**（项目里已经在用 recharts 画 BenchmarkChartsSection），不引入新库。

### 4.6 BenchmarkDetailPage 集成

`apps/web/src/features/benchmarks/BenchmarkDetailPage.tsx`，在现有 `<BenchmarkChartsSection>`（line 332-337）之后、`<BenchmarkDetailRawOutput>` 之前插入：

```tsx
{benchmark.connection?.prometheusUrl && benchmark.connection?.serverKind && (
  <section>
    <h3 className="mb-3 text-sm font-semibold">{t("detail.engineMetrics.title")}</h3>
    <EngineMetricsSection benchmarkId={benchmark.id} />
  </section>
)}
```

> **数据流前置**：`benchmark.connection` 当前只透出 connectionId 字符串，不带 prometheusUrl / serverKind。要么在 BenchmarkDetailPage 加一次 `useConnection(benchmark.connectionId)` 查询拿这两个字段，要么改 `Benchmark` API 顺便 join 这两个字段。**采用前者**：BenchmarkDetailPage 已经在用 react-query，多一次 `connections/:id` GET 不是问题，且复用 cache。

### 4.7 i18n & 文案

`apps/web/src/locales/{zh-CN,en-US}/engine-metrics.json`：

```json
{
  "section": {
    "title": "推理引擎指标",
    "subtitle": "实时来自 {{engineName}} (Prometheus) — 时间窗 {{from}} ~ {{to}}",
    "notConfigured": "此连接未配置 Prometheus URL — 前往连接设置补齐",
    "promError": "无法访问 Prometheus（{{reason}}），请检查连接配置或网络可达性"
  },
  "groups": {
    "topline": "Top-line Summary",
    "latency": "Latency & UX",
    "throughput": "Token Throughput & Workload",
    "engine": "Engine Internal & Cache",
    "health": "System Health"
  },
  "metrics": {
    "success_rate": { "label": "成功率", "tooltip": "..." },
    "active_requests": { "label": "进行中请求", "tooltip": "..." },
    "ttft_p99": { "label": "TTFT P99", "tooltip": "首 token 延迟 P99" },
    /* ... 完整 metric key 列表见 §4.3 */
  },
  "unavailable": {
    "noData": "该引擎不上报此指标",
    "promExpired": "Prometheus 数据已过期（保留期外）"
  }
}
```

英文版镜像，同 key 结构。

### 4.8 Connection 表单

`apps/web/src/features/connections/ConnectionDialog.tsx` 的 `serverKind` 下拉：

```diff
 const SERVER_KIND_OPTIONS = [
   { value: "vllm", label: "vLLM" },
   { value: "sglang", label: "SGLang" },
   { value: "tgi", label: "TGI" },
+  { value: "trtllm", label: "TensorRT-LLM" },
+  { value: "mindie", label: "MindIE" },
+  { value: "lmdeploy", label: "LMDeploy" },
+  { value: "tei", label: "TEI (Embeddings)" },
+  { value: "infinity", label: "Infinity (Embeddings)" },
+  { value: "llamacpp", label: "llama.cpp" },
   { value: "higress", label: "Higress (Gateway)" },
   { value: "generic", label: "Generic" },
 ] as const;
```

`higress / generic` 不属于"推理引擎"语义，这两个 case 下 EngineMetricsSection 直接不渲染。

## 5. 数据流（端到端）

```
BenchmarkDetailPage
   │
   ├─ useBenchmark(id)    ──→  GET /api/benchmarks/:id            ─→ { connectionId, startedAt, finishedAt }
   ├─ useConnection(connId) ─→  GET /api/connections/:connId      ─→ { prometheusUrl, serverKind, model }
   │
   └─ if (promUrl && serverKind && isTerminal):
        <EngineMetricsSection benchmarkId={id} />
                │
                └─ useEngineMetrics(connId, { from, to, step })
                            │
                            └─ GET /api/engine-metrics/:connId/snapshot?from=...&to=...&step=15
                                       │
                                       └─ engine-metrics.service.fetchSnapshot()
                                              │ ① loadConnection(connId, userId)         (RBAC)
                                              │ ② resolveManifest(serverKind)
                                              │ ③ for spec of manifest.metrics:
                                              │      promClient.queryRange(promUrl, render(spec.expr, model), from, to, step)
                                              │ ④ Promise.allSettled → normalize → respond
                                              ↓
                                Prometheus  /api/v1/query_range
```

## 6. 测试

### 6.1 Backend

- `engine-metrics.service.spec.ts`
  - 5 引擎各 3 个 case：(a) 成功 (b) connection 缺 prom URL → 422 (c) connection 不属于 user → 404
  - PromQL 模板渲染：`${model}` 替换正确（含特殊字符 escape）
  - 单 panel Prom 失败不影响其它 panel
  - V0 / V1 双匹配的 `or` 语法在 vllm manifest 里被实际生成
- `prom-client.spec.ts`
  - HTTP 503 / 超时 / JSON 解析失败三类错误归一化为 `{ unavailable: true, reason: "prom_error" }`
- `engine-metrics.controller.spec.ts`
  - JWT guard 生效；query 参数 zod 校验失败 400
- e2e `apps/api/test/e2e/engine-metrics.e2e-spec.ts`
  - 用 nock 拦 Prom，验证 controller 端到端

### 6.2 Manifest 快照测试

`packages/contracts/src/engine-metrics/manifests/__tests__/manifests.spec.ts`：

- 每个 manifest 渲染一次（`model = "test-model"`），把所有 PromQL 字符串 snapshot 下来
- 失效保护：手动改了 PromQL → snapshot 必须更新，避免无脑 commit

### 6.3 Frontend

- `EngineMetricsSection.test.tsx`
  - mock 5 引擎的 snapshot 响应，验证按 group 排版
  - panel `unavailable: true` 显示占位
  - 401/403 → 不渲染（gate 在父）
  - timeseries panel 渲染 `<ReferenceArea>`（用 spy）
- `panels/StatPanel.test.tsx` / `TimeseriesPanel.test.tsx` / `GaugePanel.test.tsx`
  - 阈值色码、空数据、单位格式化（ms / % / tps）

### 6.4 Playwright

不上 Playwright e2e（依赖真集群 Prom，本地 stub 价值低）。手测验收：

- 在 Qwen2.5-7B 连接（67 集群，已配 prometheusUrl）上跑一次 prefix-cache-probe，进 Detail，肉眼检查"推理引擎指标"区块所有 panel 都有数据
- 同一连接跑一次 genai-perf，进 Detail，确认同一区块复用、时间窗自动跟着新 benchmark 走
- 临时把 connection.prometheusUrl 清空，确认区块不渲染（不是空白错误，而是整个 section 消失）

## 7. 实施阶段

| Phase | 范围 | 目标 |
|---|---|---|
| **P1.1** | contracts: `EngineId` 抽出 / `serverKind` 扩 / engine-metrics types & vllm manifest | 类型基础就绪 |
| **P1.2** | sglang / tgi / mindie / tei manifest | 5 引擎 manifest 全齐 |
| **P1.3** | api `engine-metrics` module + controller + spec + prom-client | 后端就绪 |
| **P1.4** | web `EngineMetricsSection` + 4 panel 组件 + i18n | 前端就绪 |
| **P1.5** | BenchmarkDetailPage 集成 + ConnectionDialog 下拉补齐 | 端到端打通 |
| **P1.6** | 手测：vLLM (V1, 67 集群) / 不配 Prom URL / Prom 暂时不可达三种场景 | 验收 |

每个 Phase 一个 commit，按"先 commit 不要 push"指令累积在本地分支。

## 8. 风险与开放问题

| 风险 | 缓解 |
|---|---|
| MindIE 指标名稳定性 — 社区文档稀缺，可能因版本不同有差异 | M1 manifest 注明 "保守 5 panel"；67 集群核实后再扩 |
| TEI 指标在不同 TEI 版本（0.7.x / 1.x）也有命名差异 | 同 vLLM V0/V1 套路，PromQL 用 `or` 子句兜两个版本 |
| Prom URL 跨集群可达性问题（API 容器在 k3d，Prom 在 67） | 已验证：prefix-cache-probe runner 可达。API 直连理论上一样可达，否则报 prom_error 占位（不阻塞页面） |
| 19 panel × 5 引擎的 PromQL 维护成本 | manifest 单独成文件，每个引擎独立维护；新增引擎复制模板填空即可 |
| recharts heatmap 没有原生支持 | M1 用 stacked bar 简化（每个 prompt token 桶一根 bar，按时间堆叠）；后续切真 heatmap 库再改 |

**开放问题（实施时定）：**

1. `connection.serverKind` 当前 nullable，实施时遇到 `null` 但 prometheusUrl 不空的 connection 怎么处理？
   - 倾向：UI 显示"请补齐引擎类型"提示，不试图猜测
2. PromQL 模板里的 `${model}` 如果包含 `"` 或 `\`，需要 escape 吗？
   - vLLM 实际看到的 model_name 都是简单标识符（`Qwen2.5-7B-Instruct` 这类），但 service 层应该做一次 PromQL 字符串安全 escape，防御性编程

---

## 9. Self-Review Notes

- 用户决策："Plan A 纯内置 / 5 引擎 (vLLM+SGLang+TGI+MindIE+TEI) / 仅 Benchmark Detail tab / 不做 snapshot 全实时" — 全部对齐
- 引擎清单 SSOT 抽到 contracts 是 prerequisite，否则 connection.serverKind 和 deployment-recipes 的 EngineId 会一直 drift
- TEI 单独 Group B 是关键判断（embedding 没有生成式概念），spec 里在 §4.1 明确分组、§4.3.5 设计独立 panel set
- 19 panel × 5 引擎不是"全画"——SGLang/TGI/MindIE 暴露的指标少于 vLLM，对应 panel 显示"不上报此指标"占位，不强行造数据
- M1 不做 snapshot 是用户决策；spec §3 写明"超出 Prom 保留期 → 占位提示"对齐用户期望
- 时间窗 `±30s` 是为了让用户看到压测前/后的引擎基线，timeseries 用 `<ReferenceArea>` 标出实际压测时段，是 §4.5 的核心 UX 决策
