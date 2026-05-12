# KV cache stress tool + deployment recipes (vllm-ascend × LMCache / YRCache) — 设计

**Status:** Draft · 2026-05-12 · 用户已批准全 3 个决策点(新 scenario、新 recipe status `community`、官方模板入库)
**Branch:** `feat-kv-cache-tool`(已 rebase 到 main @ 6d2fc38)
**Driver:** 2026-05-10 / 2026-05-11 在 [theriseunion/repots](https://github.com/theriseunion/repots) 仓里跑了三轮压测（LMCache 4 档 + YRCache 3 档 + 网关 1 档）对比 KV cache 卸载后端,所有动作都靠 `/tmp/bench_qwen3.py` + `kubectl patch` 串档手干。两份报告都成型了,但**每次想重跑或换工作负载,得人工再走一遍 5 个 stage**——没有产品化沉淀。本文档把这套工作流接进 modeldoctor 现有的 benchmark / tool-adapter / deployment-recipes 框架,以便未来:
- 新硬件或新引擎落地时**3 分钟在 UI 里跑出 LMCache CPU vs YRCache CPU 的对比**,不用碰 kubectl
- 把 yrcache 1.5.0 的 vLLM 0.18 兼容 patch + 无认证 Redis 这两个**已踩过的坑**固化进 deployment recipe,下一个工程师不重蹈

---

## 1. Why

### 1.1 表面问题

现在 modeldoctor 5 个 benchmark tool (`guidellm` / `genai-perf` / `vegeta` / `prefix-cache-probe` + 一个 placeholder)**没一个能压 prefix-cache 性能**:

- **`guidellm`** / `genai-perf`:无状态、单轮、不会把同一 prompt 重复送到目标。**prefix cache 命中率 ≈ 0**——上游官方 benchmark 也明说 RandomDataset 是合成数据,跟 prefix cache 收益无关([guidellm random dataset](https://github.com/vllm-project/guidellm))。
- **`prefix-cache-probe`**(已存在的同名工具)做的是**Higress AI Load Balancer sticky routing 验证**——读 Prom delta 判断哪个 pod 服务了请求,**不测延迟/吞吐**,不是性能 benchmark。
- **`vegeta`**:HTTP 层压测,跟 KV cache 没关系。

结果:用户想知道"我这台机器开 LMCache CPU 后 TTFT 能改善多少",**没有任何现成工具可以回答**。

### 1.2 深层问题

我们 2026-05-10 ~ 2026-05-11 在生产环境验证了:

| 配置 | QPS | TTFT p90 (ms) | Prefix Cache Savings | err 率 |
|---|---|---|---|---|
| 无 cache offload(A baseline) | 2.79 | 3663 | 76.4% | 0% |
| LMCache CPU 100 GB | **3.75** | **2315** | 85.1% | **0%** |
| LMCache CPU + Disk | 3.76 | 2729 | 84.0% | 0.09% |
| YRCache CPU 100 GB | 3.53 | 2291 | **89.4%** | 8.4% |
| YRCache CPU + Disk | 3.36 | **1821** | 89.2% | 13.1% |
| YRCache CPU + Disk + NFS shared | 3.39 | 2060 | 89.1% | 9.4% |

**结论是**:LMCache CPU 在本硬件上是综合最优,**但要做出这个结论必须横跑这 6 档,每档约 25 分钟**(pod 重建 5 min + 600 s bench + 间隙)。手干不可持续。

同时,这一轮还固化下来这些**部署知识**,目前散落在 `/tmp/yrcache-*.yaml` 和报告里:

- **YRCache 1.5.0 wheel 与 vLLM 0.18 不兼容**——`KVConnectorFactory.create_connector` 第 3 参数 vLLM 0.18 改成 `kv_cache_config`,yrcache 还是按 `local_rank` 解析,导致拼出 `npu:KVCacheConfig(...)` 崩溃。修复方法:用 ConfigMap + `subPath` 挂自定义 `yrcache_connector.py` 覆盖镜像内的 buggy 版本。
- **YRCache wheel 没有 Redis 认证字段**(`yrcache.yaml`、`SharedStorageCacheConfig` dataclass、`c_ops.so` 全部无 `redis_password`),无法接生产 Redis,必须起专用无认证 Redis。
- **LMCache 0.4.x 指标暴露**:必须设 `PROMETHEUS_MULTIPROC_DIR` + emptyDir 挂到该路径(LMCache 只在 env 未设时才 mkdir,我们预设了 env 反而要自己提供目录)。
- **YRCache 必调**:`log_level: 2`、`metric_level: 1`,否则 INFO 日志把 worker 打死,err 率额外 +4-5 pp。

这些都不写进 `deployment-recipes/data.ts`,下一个工程师必然重踩。

### 1.3 还要回答的二阶问题

- **谁来执行 KV cache 后端切换?**——我们这次手 `kubectl patch statefulset`,但 modeldoctor 已有 K8sJobDriver / SubprocessDriver。**短期答案**:tool 只负责跑流量;backend 切换让用户手动完成(或参考 recipe 自行 patch)。**长期 v2**:加 "Backend Provisioner" 模块,modeldoctor 自己负责 patch + rollout + readiness。本 PR 不做。
- **Prom delta 怎么读?**——已有 `prefix_cache_probe.py` 提供模板(`vllm:prefix_cache_queries_total` V0/V1 兼容查询)。我们复用同样的策略,只是多读几个 metric 名。

---

## 2. Scope

**In(本 PR / 本 worktree 实施)**:

- **新 scenario**:`kv-cache-stress`(`packages/tool-adapters/src/scenarios.ts` 加一行)
- **新 tool adapter**:`packages/tool-adapters/src/kv-cache-stress/` —— schema、runtime、tests、fixtures
- **新 runner image**:`apps/benchmark-runner/images/kv-cache-stress.Dockerfile` + `scripts/kv_cache_stress.py`
- **新 web 页面**:`apps/web/src/features/benchmarks/BenchmarkKvCacheStressPage.tsx`(表单 + 结果展示)
- **i18n**:`apps/web/src/locales/{zh-CN,en-US}/benchmarks.json` 加 kv-cache-stress 字段
- **2 个 deployment recipes**:`apps/web/src/features/deployment-recipes/data.ts` 新增 `vllm-ascend` 引擎条目(目前只有 `vllm` / `sglang` / `mindie` 等通用引擎),挂到 Qwen3-32B 模型下;同时给出 `lmcache-cpu` 和 `yrcache-shared` 两个 image 变体的 docker run 命令 + 关键参数 + 已知坑提示
- **新 RecipeStatus 值 `community`**:`types.ts` 加 `community` 状态,区分"官方上游发布"(native)、"上游部分支持"(partial)、"内部构建 / 第三方 hot-patch"(community)。本 PR 的两个 vllm-ascend recipe 用此状态
- **2 个官方 baseline benchmark templates 入库**(seed.ts):基于本仓 2026-05-10 / 2026-05-11 实测数据,沉淀成 `kv-cache-stress` scenario 的官方推荐参数。这条原本规划在 v2,本次按用户要求一步到位
- 配套:`runner-images.ts`、`category-defaults.ts`、`scenarios.spec.ts` 等"加 tool 时必须改的地方"
- 数据库 schema:**不动**(benchmark 模块的 generic `params`/`report` 字段是 JSON,新 tool 自动落库;templates 通过 `prisma db seed` 而非 schema migration 落库,follow #172 已确立的 seed 模式)
- 验收:`pnpm type-check / lint / test` 全过

**Out(本 PR 不做,挂 §11 v2 清单)**:

- 自动化 backend switching(模仿"换镜像 + patch StatefulSet"流程)——这是 v2 的 Backend Provisioner 模块
- 把 YRCache hot-patch 工件(`yrcache_connector_patched.py`、ConfigMap、PV)做成一键 `kubectl apply` 的 release artifact
- 跨 pod 共享场景(多副本共用 YRCache shared tier)的测试——本 PR 假定 1 pod
- Grafana 面板模板(`lmcache:*` / `yrcache_*` 现成大盘):另起 PR 走 `deploy/k8s` 路径

---

## 3. 现有 `prefix-cache-probe` vs 新 `kv-cache-stress` ——为何不复用

```
现有 prefix-cache-probe (scenarios.ts: 'prefix-cache-validation'):
  目的:验证 Higress ai-load-balancer 把同 prefix 请求是否粘到同一 pod
  做法:同 prefix N 轮请求 → 读 Prom delta 判断哪个 pod 服务
  指标:stickinessPct(stickiness 百分比)
  → 路由 / 网关层验证

新 kv-cache-stress (scenarios.ts: 'kv-cache-stress'):
  目的:压测后端 KV cache 性能(LMCache / YRCache / 等)
  做法:200 sessions × 4 turns 多轮对话,工作集 ~2× HBM 强制驱逐
  指标:QPS / TTFT p50/p90/p99 / e2e / Prefix Cache Savings / 后端 native counter delta
  → 计算 / 存储层 benchmark
```

**两者方法论完全不同**:`prefix-cache-probe` 关注"调度命中是不是稳定",`kv-cache-stress` 关注"命中之后的性能收益是多少"。强行合并会让 schema 既要 stickinessPct 又要 ttft p99,不健康。

---

## 4. 架构与文件清单

```
feat-kv-cache-tool/
├── apps/benchmark-runner/
│   ├── images/
│   │   └── kv-cache-stress.Dockerfile          [新增]
│   └── scripts/
│       └── kv_cache_stress.py                  [新增,基于 /tmp/bench_qwen3.py + Prom delta 集成]
├── apps/api/
│   ├── src/modules/benchmark/k8s/runner-images.ts  [改:加 kv-cache-stress image tag 映射]
│   └── prisma/seed.ts                          [改:widen Tool/scenario union;增加 2 个 kv-cache-stress 模板]
├── packages/tool-adapters/src/
│   ├── kv-cache-stress/
│   │   ├── index.ts                            [新增,adapter export]
│   │   ├── schema.ts                           [新增,Zod params + report]
│   │   ├── schema.spec.ts                      [新增]
│   │   ├── runtime.ts                          [新增,buildCommand / parseProgress / parseFinalReport]
│   │   ├── runtime.spec.ts                     [新增]
│   │   └── __fixtures__/                       [新增,sample stdout & report]
│   ├── scenarios.ts                            [改:SCENARIOS 增加 'kv-cache-stress']
│   ├── schemas-entry.ts                        [改:export 新 types]
│   ├── core/registry.ts                        [改:注册 adapter]
│   ├── category-defaults.ts                    [改:默认参数]
│   └── index.ts                                [改:export]
├── apps/web/src/
│   ├── features/benchmarks/
│   │   ├── BenchmarkKvCacheStressPage.tsx      [新增]
│   │   ├── scenarios.ts                        [改:icon 映射]
│   │   └── reports/
│   │       └── KvCacheStressReport.tsx         [新增,可视化展示]
│   └── locales/
│       ├── zh-CN/benchmarks.json               [改]
│       ├── en-US/benchmarks.json               [改]
│       ├── zh-CN/deployment-recipes.json       [改:增加 community 状态翻译]
│       └── en-US/deployment-recipes.json       [改]
└── apps/web/src/features/deployment-recipes/
    ├── data.ts                                 [改:加 'vllm-ascend' 引擎 + 2 个 Qwen3-32B recipe]
    └── types.ts                                [改:RecipeStatus union 加 'community']
```

**预估净增**:**~1100-1200 行**(Python ~250 + TypeScript adapter ~280 + Web page ~250 + i18n ~70 + recipes ~80 + Dockerfile/runner-images ~30 + scenarios/registry 改动 ~50 + **seed.ts 2 模板 + 类型加宽 ~80**)。

---

## 5. Runner script:`scripts/kv_cache_stress.py`

基于 `bench_qwen3.py`(已在 `theriseunion/repots:2026-05-10-qwen3-lmcache-ascend-benchmark/scripts/`)改造。**核心改动 4 点**:

1. **CLI 参数化**(不再走 env var)——modeldoctor 约定 argv,因为 K8s Job spec 难传 env
2. **集成 Prometheus delta**(前后快照),计算 Prefix Cache Savings——参考 `scripts/prefix_cache_probe.py:_build_prom_query` 处理 V0/V1 metric 名
3. **(可选)拉 LMCache `lmcache:*` 和 YRCache `yrcache_*` counter**——从同一个 vLLM `/metrics` 拉(因为 `PROMETHEUS_MULTIPROC_DIR` 让它们 multiproc 聚合到同端口)
4. **结构化输出**:final JSON 通过 stdout 末行 + `--report-file` 双写(modeldoctor `parseFinalReport` 约定)

CLI:

```bash
python /app/probe.py \
    --base-url <openai-compatible endpoint> \
    --api-key <bearer> \
    --model <served-model-name> \
    --num-sessions 200 \
    --turns 4 \
    --concurrency 25 \
    --max-tokens 50 \
    --duration 600 \
    --prom-url <prom NodePort URL>            # optional, 没设跳过 prom delta
    --report-file /run/report.json
```

输出 final JSON(摘录):

```json
{
  "qps": 3.75,
  "output_tps": 187.0,
  "requests_ok": 2312,
  "requests_err": 0,
  "err_rate_pct": 0.0,
  "ttft_ms_p50": 757,
  "ttft_ms_p90": 2315,
  "ttft_ms_p99": 7729,
  "e2e_ms_p50": 5254,
  "e2e_ms_p90": 10424,
  "e2e_ms_p99": 22265,
  "prom": {
    "hbm_hit_rate_pct": 76.9,
    "prefix_cache_savings_pct": 85.1,
    "prompt_tokens_total_delta": 14070000,
    "generation_tokens_total_delta": 115000
  },
  "backend": {
    "name_guess": "lmcache",        // 由 "看到 lmcache:* 还是 yrcache_* counter" 启发式推断
    "counters": { ... }              // 透传原始 counter 增量,UI 自己排版
  },
  "config": { ... }                  // echo 一下 CLI 入参,便于 audit
}
```

**已知不做(out of scope)**:
- 不读 `bench_qwen3.py` 里 sha256 deterministic 工作集——保留同样的算法(系统提示词 + 4 轮历史),但客户端 token 数允许配置
- 不算 lookup_hit_rate / retrieve_hit_rate(`yrcache_num_lookup_*`):太 yrcache-specific,放在 `backend.counters` 里透传,UI 端展示

---

## 6. Tool adapter:`packages/tool-adapters/src/kv-cache-stress/`

### 6.1 `schema.ts` — Zod

复用 `prefix-cache-probe/schema.ts` 的两段式结构:

```ts
export const kvCacheStressParamsSchema = z.object({
  numSessions:     z.number().int().min(1).max(2000).default(200),
  turns:           z.number().int().min(1).max(16).default(4),
  concurrency:     z.number().int().min(1).max(256).default(25),
  maxTokens:       z.number().int().min(1).max(2048).default(50),
  durationSec:     z.number().int().min(30).max(7200).default(600),
  systemPromptSeed:z.string().default("scn"),     // sha256 prefix seed
  promUrl:         z.string().url().optional(),    // 留空则跳过 prom delta
});

export const kvCacheStressReportSchema = z.object({
  qps:                      z.number(),
  outputTps:                z.number(),
  requestsOk:               z.number().int().nonnegative(),
  requestsErr:              z.number().int().nonnegative(),
  errRatePct:               z.number(),
  ttftMs:                   z.object({ p50: z.number(), p90: z.number(), p99: z.number() }),
  e2eMs:                    z.object({ p50: z.number(), p90: z.number(), p99: z.number() }),
  prom: z.object({
    hbmHitRatePct:          z.number().optional(),
    prefixCacheSavingsPct:  z.number().optional(),
    promptTokensTotalDelta: z.number().int().optional(),
    generationTokensTotalDelta: z.number().int().optional(),
  }).partial(),
  backend: z.object({
    nameGuess:              z.enum(["lmcache","yrcache","unknown"]),
    counters:               z.record(z.union([z.number(), z.string()])),
  }),
});
```

约束:`durationSec ≥ 30` 让用户必须自觉跑足够长(短了 Prom delta 没意义),`≤ 7200` 防意外 24h 大单。

### 6.2 `runtime.ts` — argv + 解析

```ts
export function buildCommand(p: KvCacheStressParams, runtime: RuntimeContext): string[] {
  return [
    "python", "/app/probe.py",
    "--base-url", runtime.apiUrl,
    "--api-key", runtime.apiKey,
    "--model",   runtime.model,
    "--num-sessions",   String(p.numSessions),
    "--turns",          String(p.turns),
    "--concurrency",    String(p.concurrency),
    "--max-tokens",     String(p.maxTokens),
    "--duration",       String(p.durationSec),
    "--system-prompt-seed", p.systemPromptSeed,
    ...(p.promUrl ? ["--prom-url", p.promUrl] : []),
    "--report-file", "/run/report.json",
  ];
}

export function getMaxDurationSeconds(p: KvCacheStressParams): number {
  // 600s bench + 60s warmup grace + 60s post-snapshot ≈ duration + 120
  return p.durationSec + 120;
}
```

`parseProgress` / `parseFinalReport` 模仿 `prefix-cache-probe/runtime.ts:parseProgress`:增量 stdout 解析 `+ 15s  ok=N  err=M` 行作 progress event。

### 6.3 `index.ts` — export

```ts
export const kvCacheStressAdapter: ToolAdapter = {
  name: "kv-cache-stress",
  scenarios: ["kv-cache-stress"] as const,
  paramsSchema:  kvCacheStressParamsSchema,
  reportSchema:  kvCacheStressReportSchema,
  paramDefaults: kvCacheStressParamDefaults,
  buildCommand,
  parseProgress,
  parseFinalReport,
  getMaxDurationSeconds,
};
```

注册:`core/registry.ts` 加 import + register。`scenarios.ts` 加:

```ts
"kv-cache-stress": {
  label: "KV cache 压测",
  description: "多轮对话压测,触发 prefix-cache 驱逐,对比不同 KV 卸载后端(LMCache / YRCache / etc.)",
  tools: ["kv-cache-stress"],
  paramsConstraints: {},
  reportComponent: "KvCacheStressReport",
},
```

并在 `ScenarioId` union、`scenarioIdSchema`、reportComponent union 三处对应增补。

---

## 7. Web UI

### 7.1 BenchmarkKvCacheStressPage.tsx

参考 `BenchmarkPrefixCachePage.tsx`,字段:

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| Name | text | 必填 | run name |
| Connection | dropdown | 用户已配的 connection | 取 model + apiUrl + apiKey |
| Num sessions | number | 200 | 工作集 size driver |
| Turns | number | 4 | 多轮深度 |
| Concurrency | number | 25 | async worker |
| Max tokens | number | 50 | per-request 限 |
| Duration (s) | number | 600 | bench 时长 |
| Prom URL | url(可选)| 空 | 不填跳过 Prom delta 计算 |

### 7.2 `reports/KvCacheStressReport.tsx`

展示 4 个分组:

1. **Top-line**(QPS / output_tps / err rate / requests_ok)—— 4 个 stat card
2. **Latency percentiles**(TTFT p50/p90/p99 + e2e p50/p90/p99)—— 2 行 grouped bar
3. **Prefix Cache Savings**(HBM hit % vs Savings % delta 显示在两个 progress bar 上)
4. **Backend counters**(`backend.counters` 表格,key/value,自适应展示 lmcache:* 或 yrcache_* 任一)

样式跟现有 `InferenceReport` / `PrefixCacheProbeReport` 对齐。

### 7.3 i18n

```json
// zh-CN/benchmarks.json 新增
{
  "kvCacheStress": {
    "title": "KV cache 压测",
    "description": "多轮对话压测,触发 prefix-cache 驱逐,对比不同 KV 卸载后端",
    "fields": {
      "numSessions": "Session 数",
      "turns": "对话轮数",
      "concurrency": "并发数",
      "maxTokens": "Max tokens",
      "durationSec": "时长(秒)",
      "promUrl": "Prometheus URL(可选)"
    },
    "report": {
      "topLine": "Top-line",
      "latency": "延迟分布",
      "savings": "Prefix Cache Savings",
      "backendCounters": "后端原生 counter"
    }
  }
}
```

en-US 平行。

---

## 8. Deployment recipes

### 8.1 新引擎:`vllm-ascend`

`data.ts` 现有 `ENGINES` 表里有 `vllm`、`sglang`、`mindie` 等,**没有 `vllm-ascend`**。LMCache / YRCache 都是基于 `vllm-ascend` 镜像,所以先加引擎条目:

```ts
{ id: "vllm-ascend", name: "vLLM-Ascend", vendor: "Huawei Ascend × vLLM" },
```

### 8.1.1 新 RecipeStatus:`community`

`types.ts` 现有的 `RecipeStatus` 枚举只有 `"native" | "partial"`(根据 data.ts 用法推断)。我们的两个镜像都是**内部构建 + hot-patch**,既不是上游官方(`native`),也不是上游部分支持(`partial`),而是"社区/内部维护"——加新值 `community`:

```ts
// types.ts
export type RecipeStatus = "native" | "partial" | "community";

// data.ts 加 helper
const community = (r: Omit<EngineRecipe, "status">): EngineRecipe => ({ status: "community", ...r });
```

i18n 同步:`deployment-recipes.json` 加 `status.community: "社区构建"` / `"Community build"`。

### 8.2 Recipe 1:`Qwen3-32B + vllm-ascend + LMCache CPU`

```ts
{
  id: "qwen3-32b",
  // ...其他字段 ...
  engines: {
    "vllm-ascend": community({
      minVersion: "0.18.0rc1",
      image: "swr.cn-north-4.myhuaweicloud.com/inference-engines/vllm-ascend:v0.18.0rc1-lmcache",
      tooltip: "vllm-ascend 0.18 + LMCache 0.4.2(CPU 100GB 卸载,生产推荐)",
      command: `kubectl apply -f - <<EOF
# StatefulSet 关键 args:
# - --kv-transfer-config '{"kv_connector":"LMCacheAscendConnectorV1Dynamic", ...}'
# - --disable-hybrid-kv-cache-manager
# env:
# - PROMETHEUS_MULTIPROC_DIR=/tmp/lmcache_prometheus        # 必须,否则 lmcache:* 看不见
# - LMCACHE_CHUNK_SIZE=256
# - LMCACHE_LOCAL_CPU=True
# - LMCACHE_MAX_LOCAL_CPU_SIZE=100                          # GB
# volumeMounts: prom-multiproc:/tmp/lmcache_prometheus (emptyDir 必须,LMCache 不自己 mkdir)
EOF`,
      params: [
        { key: "PROMETHEUS_MULTIPROC_DIR", value: "/tmp/lmcache_prometheus", desc: "必须,跨 TP worker 聚合 metrics" },
        { key: "LMCACHE_MAX_LOCAL_CPU_SIZE", value: "100 GB", desc: "建议 25-50% 主机内存,本机 1 TB → 100 GB 经验值" },
        { key: "--disable-hybrid-kv-cache-manager", value: "", desc: "HMA 与 KV connector 不兼容,必加" },
      ],
      resource: "Atlas 800I A2 8×910B4 / TP=4 / 32 GB HBM × 4",
      notes: [
        "实测 QPS 3.75 / TTFT p90 2.3 s / 0% err。生产推荐档。",
        "完整 yaml 见 theriseunion/repots:2026-05-10-qwen3-lmcache-ascend-benchmark/patches/03-c-on-cpu.yaml",
      ].join(" "),
      docUrl: "https://github.com/theriseunion/repots/tree/main/2026-05-10-qwen3-lmcache-ascend-benchmark",
    }),
    // ... 其他引擎(如果该 model 在别处也有)
  },
}
```

### 8.3 Recipe 2:`Qwen3-32B + vllm-ascend + YRCache CPU+DISK+Shared`

```ts
"vllm-ascend-yrcache": community({
  minVersion: "0.18.0rc1",
  image: "swr.cn-north-4.myhuaweicloud.com/inference-engines/vllm-ascend:v0.18.0rc1-yrcache-1.5.0",
  tooltip: "vllm-ascend 0.18 + YRCache 1.5.0 三层缓存(CPU + Local Disk + Redis 元数据 + NFS 数据)",
  command: `# YRCache 跑通需要 3 个前置:
# 1. 部署专用无认证 Redis(YRCache 没 redis_password 字段,生产 Redis 接不上):
#    Deployment yrcache-redis,image quanzhenglong.com/camp/redis:8.2.0,'--protected-mode no'
# 2. 准备 NFS PVC(/mnt/yrfs),或 hostPath 大盘
# 3. hot-patch yrcache 1.5.0 的 vLLM 0.18 兼容性 bug(KVConnectorFactory 第 3 参数已改名):
#    ConfigMap yrcache-connector-fix,subPath 挂修复后的 yrcache_connector.py 覆盖镜像内的版本
#    完整修复源:theriseunion/repots:2026-05-11-...../patches/yrcache_connector_patched.py
kubectl apply -f - <<EOF
# StatefulSet 关键 args:
# - --kv-transfer-config '{"kv_connector":"YRCacheConnector", ...}'
# - --disable-hybrid-kv-cache-manager
# env:
# - YRCACHE_CONFIG_FILE=/etc/yrcache.yaml
# volumeMounts:
# - yrcache-config:/etc/yrcache.yaml      (ConfigMap 含 yrcache.yaml,log_level=2 必加)
# - yrcache-disk:/apps/yrcache            (hostPath)
# - yrcache-shared:/mnt/yrfs              (NFS PVC,可选)
# - yrcache-connector-fix:...             (subPath,hot-patch)
EOF`,
  params: [
    { key: "log_level (yrcache.yaml)", value: "2 (warning)", desc: "**必调**:默认 3 INFO 把 worker 打死,err 率额外 +5 pp" },
    { key: "metric_level (yrcache.yaml)", value: "1 (batch only)", desc: "默认 3 太细" },
    { key: "shared_storage_cache_config.redis_host", value: "yrcache-redis.<ns>.svc", desc: "必须无认证 Redis,yrcache wheel 没 redis_password 字段" },
  ],
  resource: "Atlas 800I A2 8×910B4 / TP=4 + 100 GB host RAM + 300+ GB disk + (可选)500 GB NFS",
  notes: [
    "yrcache 1.5.0 wheel 与 vLLM 0.18 KVConnectorFactory 不兼容,部署前必须打 hot-patch。",
    "Y-FULL 实测 QPS 3.39 / TTFT p90 2.06 s / err 率 9.4%(比 LMCache 高,但跨 pod 共享 KV 是唯一场景)。",
    "完整方案见 theriseunion/repots:2026-05-11-qwen3-yrcache-ascend-benchmark/。",
  ].join(" "),
  docUrl: "https://github.com/theriseunion/repots/tree/main/2026-05-11-qwen3-yrcache-ascend-benchmark",
})
```

**注**:用新加的 `status: "community"` 状态——这两个 image 都不是上游(vLLM-Ascend 官方)发布的,是我们内部构建并附加 hot-patch。如果未来 YRCache 厂商修了 vLLM 0.18 兼容性,可以升到 `native`。

### 8.4 i18n 注意

`deployment-recipes/data.ts` 注释里写了"V1 zh-CN-only,字符串保留中文"。我们加的 `tooltip`、`notes` 用中文。新加的 `community` 状态在 `deployment-recipes.json` 里加翻译 key(zh-CN + en-US)。

---

## 9. 官方 baseline benchmark templates(seed.ts 入库)

### 9.1 现状

#172(`2026-05-12-official-benchmark-templates-design.md`)已经把 10 个 inference scenario 官方模板通过 `apps/api/prisma/seed.ts` 落库,采用 industry-standard 模式(schema migration + 数据 seed 分离)。`BenchmarkTemplateSeed` 接口当前**硬编码** `scenario: "inference"` 且 `tool: "guidellm" | "genai-perf"`,需要**加宽**才能容纳 `kv-cache-stress` 模板。

### 9.2 类型加宽

```ts
// apps/api/prisma/seed.ts
type Tool = "guidellm" | "genai-perf" | "kv-cache-stress";
interface BenchmarkTemplateSeed {
  id: string;
  name: string;
  description: string;
  scenario: "inference" | "kv-cache-stress";
  tool: Tool;
  config: unknown;
  tags: string[];
}
```

并把 `seedBenchmarkTemplates()` 内的 zod 校验路径扩展,根据 `template.scenario` 走对应的 `applyScenarioConstraints(scenario, tool)`。

### 9.3 两个 KV cache 官方模板

锚定 2026-05-10 / 2026-05-11 实测数据。每条模板**只包含 `kv-cache-stress` adapter 的 params**,不包含 backend 配置(backend 切换走 deployment-recipes,本模板假设 backend 已部署好)。

#### 9.3.1 LMCache CPU baseline

```ts
{
  id: "tpl_official_kv_cache_lmcache_cpu_baseline",
  name: "KV Cache · LMCache CPU baseline",
  description:
    "对齐 2026-05-10 实测:Qwen3-32B + LMCache CPU 100 GB,200 sessions × 4 轮多轮对话,工作集 ~400K token 强制驱逐 HBM。预期 QPS ~3.75 / TTFT p90 ~2.3 s / Prefix Cache Savings 85%。",
  scenario: "kv-cache-stress",
  tool: "kv-cache-stress",
  config: {
    numSessions: 200,
    turns: 4,
    concurrency: 25,
    maxTokens: 50,
    durationSec: 600,
    systemPromptSeed: "scn",
    // promUrl 留空,用户在 UI 填(可选)
  },
  tags: ["kv-cache", "lmcache", "baseline", "multi-turn", "qwen3-32b"],
},
```

#### 9.3.2 YRCache 三层缓存 baseline

```ts
{
  id: "tpl_official_kv_cache_yrcache_full_baseline",
  name: "KV Cache · YRCache 三层缓存 baseline",
  description:
    "对齐 2026-05-11 实测:Qwen3-32B + YRCache (CPU 100 GB + Local Disk + Redis 元数据 + NFS 数据),200 sessions × 4 轮。预期 QPS ~3.39 / TTFT p90 ~2.1 s / Prefix Cache Savings 89%。**err 率 9-13%**,接受这个 trade-off 才推荐使用,生产强烈建议先跑 LMCache baseline 模板对比。",
  scenario: "kv-cache-stress",
  tool: "kv-cache-stress",
  config: {
    numSessions: 200,
    turns: 4,
    concurrency: 25,
    maxTokens: 50,
    durationSec: 600,
    systemPromptSeed: "scn",
  },
  tags: ["kv-cache", "yrcache", "baseline", "multi-turn", "qwen3-32b", "shared-tier"],
},
```

> **两个模板的 `config` 完全一致**:这是有意为之——同一工作负载、不同后端的"控制变量"对比方法论。期望用户跑过两次后,在 Compare 视图里直接看两个 run 的 delta。

### 9.4 ID 命名规则

`tpl_official_kv_cache_<backend>_<variant>_baseline`,跟 #172 既定的 `tpl_official_<scenario>_<descriptor>` 模式一致。

### 9.5 seed 校验

`seedBenchmarkTemplates()` 现有逻辑会走 `applyScenarioConstraints(scenario, tool)`。我们的 `kv-cache-stress` scenario 在 `scenarios.ts` 已添加,`paramsConstraints` 为空(没有 sweep 等额外约束),所以 zod 校验天然通过。两个模板的 `config` 都必须通过 `kvCacheStressParamsSchema.parse()` —— 这条会在 seed.ts 单测里加 case 验证。

---

## 10. 测试与验收

| Phase | 命令 | 覆盖 |
|---|---|---|
| Tool-adapter unit | `pnpm -F @modeldoctor/tool-adapters test -- kv-cache-stress` | schema parse + buildCommand + parseProgress + parseFinalReport |
| Type check | `pnpm type-check` | 全 monorepo 类型一致 |
| Lint | `pnpm lint` | biome 通过 |
| Web component | `pnpm -F @modeldoctor/web test` | KvCacheStressReport rendering |
| Prisma seed | `pnpm -F @modeldoctor/api db:seed`(本地)| 2 个 KV cache 模板 zod 校验通过、upsert 成功 |
| 端到端(可选) | `pnpm test:e2e` | 创建 benchmark run → 收 callback → 报告渲染 |
| 手工验收 | `pnpm dev` + 真实压一次 | 在我们已有的 Qwen3-32B 环境上跑 60s 短试,验证 final report 字段 |

**deployment-recipes 验收**:Web `pnpm dev` 进 deployment-recipes 页,看 Qwen3-32B 行下 `vllm-ascend` 两个 recipe 卡片都显示出来,RecipeDrawer 里能正确渲染 command + params + notes,顶部状态徽章显示 `社区构建` / `Community build`(取决于语言)。

**官方模板验收**:Benchmark 创建页选 `kv-cache-stress` scenario,顶部"官方模板"下拉里应该看到 2 个 KV cache baseline 模板;选中后表单字段自动填充。

---

## 11. v2 / 后续清单

- [x] ~~**官方 baseline 模板入库**~~ 已在本 PR §9 完成(2 个 KV cache 官方模板入 seed.ts)
- [ ] **Backend Provisioner 模块**:modeldoctor 自己 patch StatefulSet 切换 backend → readiness → 跑 bench → 切回,链路全自动
- [ ] **跨 pod 共享场景**:多副本共连 YRCache shared tier 的 bench,验证跨 pod KV 命中率
- [ ] **Grafana dashboard 模板**:`lmcache:*` 和 `yrcache_*` 大盘,接入 `deploy/k8s` 现成 prometheus stack
- [ ] **`yrcache_connector_patched.py` 作为 release artifact**:打 yrcache 厂商兼容版,或上游 fix
- [ ] **stickiness × stress 联合验证**:启用现有 `prefix-cache-probe` + `kv-cache-stress` 串跑,验证 sticky 路由下 cache 命中率提升

---

## 12. 已知风险

| 风险 | 缓解 |
|---|---|
| 我们的 `bench_qwen3.py` 用户态行为(sha256 deterministic prompt)在公网会被某些上游限流/拒掉 | tool 文档明确"仅在内网 / 自管 LLM endpoint 使用",modeldoctor 已有 connection 模型只暴露给登录用户 |
| `parseProgress` 增量解析依赖 `+ Ns  ok=N  err=M` 输出格式,bench_qwen3.py 改输出格式会破 | 把 progress 行格式 pin 在 spec §5,改格式同步改 adapter 单测 |
| `community` recipe status 是新概念,UI 端要给配色 + i18n,否则徽章 fallback 难看 | 在 `RecipeDrawer.tsx` 加新 status 的视觉样式;i18n key 必须 V1 就有 |
| YRCache hot-patch 是 hack,后续 wheel 升级可能 stale | recipe notes 写明 hot-patch 来源(theriseunion/repots commit hash),升级时核对 |
| 官方 KV cache 模板的预期数字(QPS 3.75 / 3.39 等)只在 8×910B4 一种硬件上测过,UI 上展示给其它硬件用户会误导 | 模板 description 显式说明"对齐 Atlas 800I A2 / 8×910B4 实测数据";UI 端考虑未来加 `expected_hardware` 字段(v2) |
