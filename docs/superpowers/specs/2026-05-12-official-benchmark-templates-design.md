# 官方基准测试模板 v1 — 调研 · 规格 · 实现

**Status:** Implemented · 2026-05-12 · PR #172
**Branch:** `docs/official-benchmark-templates`
**Driver:** `benchmark_templates` 表目前 0 行官方模板；用户进 inference 场景没有可选预置，每次都得从零填表。这份文档把"大模型真实生产负载长什么样 → 我们的 adapter 能/不能表达什么 → 该出哪些官方模板"打通，并在 **同一个 PR** 里把 10 个模板 + 5 个已有 evaluation_profiles 内置一起迁到 Prisma `seed.ts` 模式（industry-standard：schema 走 migration、数据走 seed）。本文档原本是 research-only，在审过模板规格后用户决定直接实施，于是合并入同一 PR。

---

## 1. Why

### 1.1 表面问题
- `SELECT count(*) FROM benchmark_templates WHERE is_official = true` → **0**
- `apps/web/src/locales/zh-CN/benchmark-templates.json` 已经把"官方"标签、tabs、空状态都做好了，但展示不出东西。
- 用户进 inference 场景目前要自己想：`profile` 选哪个？`datasetInputTokens` 给多少？`requestRate` 给几？没有锚点。

### 1.2 深层问题
现成的"输入 1024 / 输出 128"这种圆整数**不是任何生产分布**——它是 vLLM `RandomDataset` 里的代码常量（`datasets.py` line 522-524）。如果官方模板照搬这套数字，等于把工具默认值当成"真实场景"卖给用户，**反向加剧**他们对模型服务能力的误判。

正确做法：把每个模板的 `(input, output, rate)` 三元组都**锚定到一份具体的公开生产 trace 或行业 SLO**，并在描述里说清楚 "这个 shape 来自哪个真实数据"。

### 1.3 还要回答的二阶问题
- **多轮对话**用户最关心，但 GuideLLM 是无状态的，KV 复用收益我们测不到——这点要**写在模板描述里**，否则模板会误导。
- **prefix-cache 命中率**是 Mooncake 论文里 40% / 59% 的核心指标，我们的 `random | sharegpt` 数据集都没法压它（我们另有 `prefix-cache-probe` 工具，但走的是 `prefix-cache-validation` scenario，不在 inference 模板的覆盖范围里）。
- **SLO 拐点扫描**（MLPerf 风格）需要 `rateType=sweep`，而 inference scenario 显式禁用 sweep（sweep 锁给了 capacity scenario）。所以 v1 的 inference 模板都是**单点定负载**，不能自动找拐点。

---

## 2. Scope

**In (这个 PR 实施)：**
- 主流大模型测试工具的官方推荐参数综述（GuideLLM / GenAI-Perf / vLLM bench / LLMPerf / MLPerf Inference）
- 真实生产 trace 的实测 token 分布（Azure 2023/2024、Mooncake FAST'25、BurstGPT、DistServe 代理数据集）
- 我们当前 adapter knob set 与上面两者的差距分析（"我们能表达什么、不能表达什么"）
- **10 个 inference scenario 官方模板**：完整规格表 + 通过 `apps/api/prisma/seed.ts` 入库（每条 config 跑过 adapter zod schema + `applyScenarioConstraints("inference", tool)` 校验）
- **5 个已有 evaluation_profiles 内置也迁过来**：原来 INSERT 在 `20260507063541_..._llm_judge` migration 里，这次一起搬到 seed.ts、那条 migration 改成纯 schema
- 配套：`package.json#prisma.seed = "tsx prisma/seed.ts"`、`db:seed` script、CLAUDE.md 新章节 "Seeding built-in / official content"
- 测试 DB bootstrap：`vitest globalSetup` 在 `prisma migrate deploy` 之后追加 `prisma db seed`，让 `pnpm -r test` 看到内置数据；`db:setup:test` script 也对齐

**Out (本 PR 不做，挂 §8 v2 清单)：**
- 新增 scenario id（RAG/多轮等只作为 inference 下的预置，不改代码）
- 新增 adapter 或 adapter knob（gap 分析里会列，都进 v2 工作清单）
- capacity / gateway / prefix-cache-validation 三个 scenario 的官方模板（脑暴中明确仅覆盖 inference）
- `name_key` / `description_key` 列让 official 模板支持 en-US（v1 zh-CN-only）

---

## 3. 主流测试工具与官方参数综述

### 3.1 GuideLLM (RedHat / Neural Magic — 现已迁入 `vllm-project` org)

**重要纠偏**：GuideLLM `--profile` 参数命名的是**负载形态**（synchronous / concurrent / constant / poisson / throughput / sweep），不是 use case；use case 由 `--scenario` 表达。**上游目前只提供两个内置 scenario 文件**（验证自 `src/guidellm/benchmark/scenarios/`，2026-05 时点）：

| Scenario | profile | prompt_tokens (mean / stddev / min / max) | output_tokens | 来源 |
|---|---|---|---|---|
| `chat.json` | `sweep` | 512 / 128 / 1 / 1024 | 256 / 64 / 1 / 1024 | `vllm-project/guidellm:src/guidellm/benchmark/scenarios/chat.json` |
| `rag.json` | `sweep` | 4096 / 512 / 2048 / 6144 | 512 / 128 / 1 / 1024 | `vllm-project/guidellm:src/guidellm/benchmark/scenarios/rag.json` |

我们 adapter 在 `profile` 字段上额外定义的 `throughput / latency / long_context / generation_heavy / sharegpt / custom` **是我们的内部抽象**，不是 GuideLLM 上游概念。

**rate types 速查**（来自 GuideLLM README）：

- `synchronous` — 一次一个请求（延迟下界）
- `concurrent` — 维持 N 个并发（闭环负载）
- `throughput` — 服务能多快就多快（饱和测试）
- `constant` — 恒定 RPS
- `poisson` — 平均 RPS 下的泊松到达
- `sweep` — 自动从 synchronous 扫到 throughput，**找 SLO 拐点用**（我们 capacity scenario 才允许，inference 不允许）

### 3.2 GenAI-Perf (NVIDIA Triton / perf_analyzer)

来自 `triton-inference-server/perf_analyzer:genai-perf/README.md` 与 `genai-perf/docs/` 的默认与示例：

- `--synthetic-input-tokens-mean = 550`, stddev `0`
- `--output-tokens-mean = -1`（让服务端决定）
- `--endpoint-type` 默认 `kserve`，OpenAI 兼容场景必须显式设 `chat | completions | embeddings | rankings | multimodal`
- `--streaming = false` 默认（我们 adapter 反过来——默认 `true`，因为 TTFT/ITL 是核心指标）

每个 use case 的官方示例命令：

| 文档 | 推荐参数 |
|---|---|
| `docs/tutorial.md` (LLM/TRT-LLM) | `--synthetic-input-tokens-mean 200 --output-tokens-mean 100 --streaming --request-count 50 --warmup-request-count 10` |
| `docs/embeddings.md` | `--endpoint-type embeddings --batch-size-text 2`（不显式给 token mean） |
| `docs/rankings.md` | `--endpoint-type rankings --synthetic-input-tokens-mean 100 --batch-size-text 2` |
| `docs/multi_modal.md` | `--image-width-mean 50 --image-height-mean 50 --synthetic-input-tokens-mean 10 --output-tokens-mean 10`（示意，不代表生产） |
| `docs/multi_turn.md` | `--num-sessions 10 --session-concurrency 5 --session-turns-mean 2 --session-turn-delay-mean 1000 --num-prefix-prompts 3 --prefix-prompt-length 15` |

> `--num-prefix-prompts` + `--num-sessions` 是 GenAI-Perf 测 **prefix-cache 命中率**的核心 knob，**我们 adapter 没暴露**。

### 3.3 vLLM 内置 benchmarks

`vllm/benchmarks/datasets/datasets.py` 列了所有内置 dataset：

`RandomDataset`, `ShareGPTDataset`, `SonnetDataset`, `BurstGPTDataset`, `ConversationDataset`, `MTBenchDataset`, `MultiModalConversationDataset`, `VisionArenaDataset`, `InstructCoderDataset`, `BlazeditDataset`, `MLPerfDataset`, `PrefixRepetitionRandomDataset`, `MMStarDataset`, `SpecBench`, `SpeedBench`, …

关键默认（`vllm/benchmarks/datasets/datasets.py` line 520-524）：

```python
DEFAULT_INPUT_LEN = 1024
DEFAULT_OUTPUT_LEN = 128
```

**这是行业里"输入 1024 / 输出 128"魔数的真正来源**——一个代码常量，不是任何生产数据。

### 3.4 LLMPerf (Anyscale)

`ray-project/llmperf` 已于 2025-12 归档。默认 `input mean 550 / stddev 150, output mean 150 / stddev 10`——GenAI-Perf 和 vLLM 的 `550 / 150` 默认值溯源于此。

### 3.5 MLPerf Inference LLM (mlcommons)

这是行业事实标准的 **SLO 表**：

| 模型 | 数据集 | 样本数 | Server SLO (TTFT / TPOT) | Interactive SLO | 来源 |
|---|---|---|---|---|---|
| Llama2-70B | OpenOrca filtered (≤1024 tok) | 24,576 | 2000 ms / 200 ms | 450 ms / 40 ms | `mlcommons/inference:language/llama2-70b/README.md` |
| Llama3.1-405B | 长上下文验证集 | 8,313 | 6000 ms / 175 ms | 4500 ms / 80 ms | `mlcommons/inference:language/llama3.1-405b/README.md` |
| Mixtral-8x7B | OpenOrca + GSM8K + MBXP (5k 各 × 3) | 15,000 | 2000 ms / 200 ms | — | `mlcommons/inference:language/mixtral-8x7b/README.md` |

模板里的 "SLO 检查"标签直接对齐这里的 Interactive / Server 两档。

---

## 4. 真实生产 trace 实测分布

这一节是 v1 模板最重要的锚——所有非"上游 shape"模板都基于这里的实测百分位数。

### 4.1 Azure LLM Inference Trace (Splitwise ISCA'24 / DynamoLLM HPCA'25)

来自 `Azure/AzurePublicDataset`：

**Azure 2024 trace（DynamoLLM, 1 周，2024-05-10 ~ 19）**，由调研 agent 直接对开源 CSV 抽样 ~24h 计算：

| Trace (~24h sample) | n | Input p50 | p90 | p95 | p99 | Output p50 | p90 | p95 | p99 |
|---|---|---|---|---|---|---|---|---|---|
| `conv` | 2.52M | **967** | 3875 | 4850 | 6682 | **41** | 400 | 513 | 767 |
| `code` | 2.54M | **1976** | 6370 | 7674 | 7686 | **9** | 44 | 82 | 280 |

**结论**：
- 生产对话 p50 input ≈ 1000，p50 output ≈ 40——**输入是输出的 24 倍**，远比 vLLM 默认 1024/128 失衡
- Copilot 代码流量更夸张：p50 input ≈ 2000，p50 output = **9 tokens**（一行补全）；p99 output 也才 280
- 每实例 RPS ≈ 28–29，泊松到达 IAT 中位数 ~8.5 ms (conv) / 22 ms (code)

### 4.2 Mooncake (Kimi / Moonshot AI, FAST'25 Best Paper)

来自 `kvcache-ai/Mooncake:FAST25-release/traces/`，调研 agent 直接对开源 JSONL 计算：

| Mooncake trace (1h) | n | Input p50 | p90 | p95 | p99 | Output p50 | p90 | p95 | p99 | prefix-cache hit |
|---|---|---|---|---|---|---|---|---|---|---|
| `conversation` | 12,031 | **6,909** | 27,367 | 39,549 | 85,401 | **350** | 597 | 698 | 1,120 | **40%** |
| `tool & agent` | 23,608 | **6,346** | 16,804 | 26,114 | 61,671 | **30** ⚠️ | 507 | 600 | 898 | **59%** |
| `synthetic` | 3,993 | 11,587 | 38,615 | 48,835 | 66,456 | 69 | 389 | 519 | 768 | 66% |

**结论**：
- Kimi 长上下文模型，input p50 ~7k，p99 ~85k——比 Azure 大一个数量级
- Tool/Agent 输出**严重 bimodal**：p50 只有 30 tokens（短 JSON），但 p95 是 600（长形式回复），均值会撒谎
- prefix-cache 命中率：chat 40% / tool 59%——这是行业里"多轮压测"的唯一可信定量靶子，我们目前测不到

### 4.3 BurstGPT (KDD'25)

121 天 Microsoft Azure ChatGPT/GPT-4 trace，有 `Session ID` 可还原会话，`Log Type` 拆 Conversation vs API：

| BurstGPT_1 切片 | n | Req p50 | p99 | Resp p50 | p99 |
|---|---|---|---|---|---|
| ChatGPT API log | 1.09M | 221 | 3,403 | **26** | 1,628 |
| ChatGPT Conversation log | 97k | 533 | 2,481 | **229** | 952 |
| GPT-4 API log | 167k | 466 | 2,813 | **40** | 1,350 |
| GPT-4 Conversation log | 48k | 576 | 3,504 | **240** | 954 |

**结论**：API 流量（分类/embedding/短 completion）的中位输出只有 26–40 tokens，是 Conversation 流量（230–240）的 1/10。任何不区分这两种的"chat 模板"都不全。

### 4.4 DistServe (OSDI'24) 用的代理数据集（业内最常引）

| Application | Dataset | Avg Input | Avg Output | TTFT SLO | TPOT SLO |
|---|---|---|---|---|---|
| Chatbot | ShareGPT | 755 | 200 | 0.25–4.0 s | 0.1–0.2 s |
| Code Completion | HumanEval | 171 | 98 | 0.125 s | 0.2 s |
| Summarization | LongBench | **1,738** | 91 | 15 s | 0.15 s |

⚠️ HumanEval **不是** Copilot 生产代理（生产是 Azure code: 1976/9）；ShareGPT 是 Vicuna 时代采样，比商业 ChatGPT 短。但 LongBench 1738/91 仍是公开数据里最干净的"摘要"靶子。

### 4.5 vLLM 默认 1024 / 128 — 注意它是约定不是测量

任何标"vLLM 默认"或"标准 LLM benchmark"的模板都应显式标注：**这是 `RandomDataset` 类的代码常量，不是任何生产分布**。Azure 2024 conv 的 input p50 是 967（巧合接近 1024），但输出是 41 不是 128。

### 4.6 一个跨 trace 的硬规律

| Trace | output / input 中位比 |
|---|---|
| Azure conv 2024 | 0.042 |
| Azure code 2024 | 0.005 |
| Mooncake conv | 0.051 |
| Mooncake tool | 0.005 |
| BurstGPT ChatGPT API | 0.118 |

**生产流量里 output/input 中位比 ≤ 0.5；代码补全甚至 < 0.01。"输入 ≈ 输出"的对称模板是 synthetic benchmark 的工件，没有生产对应物**。v1 所有模板都遵守这条规律（推理/CoT 模板是唯一例外，那是 decode-bound 故意反过来）。

---

## 5. 我们 adapter 的 knob gap

把"想压什么"和"能压什么"对清楚——这一节决定了哪些模板要砍掉、哪些要带免责。

| 期望压的东西 | 我们目前能/不能 | 是哪个 adapter 缺什么 knob |
|---|---|---|
| 单点定负载 chat/RAG/长文档 | ✅ 都可以（poisson / constant / synchronous / throughput） | — |
| SLO 拐点扫描（MLPerf 风格） | ❌ inference scenario 禁用 sweep | 这是设计选择不是 bug——sweep 在 capacity scenario，本文档不覆盖 capacity |
| 真实多轮 KV-cache 复用 | ❌ stateless 重放，复用不了 | guidellm 缺 session 概念；GenAI-Perf 有 `--num-sessions / --num-prefix-prompts` 但我们 adapter 没暴露 |
| prefix-cache 命中率定量 | ⚠️ 只能用独立的 `prefix-cache-probe` 工具（`prefix-cache-validation` scenario） | inference 模板覆盖不到 |
| Bursty / 真实 trace 重放 | ❌ 只能 poisson 近似 | guidellm 缺 trace replay；vLLM `BurstGPTDataset` 我们没接 |
| Token 分布带 stddev / 长尾 | ❌ 我们 `datasetInputTokens` / `datasetOutputTokens` 是单值 | guidellm adapter 缺 stddev/min/max（上游 chat.json 是 `{mean, stddev, min, max}` 四元组） |
| 结构化输出 (JSON schema) | ❌ | guidellm 缺 `--response-format`；vLLM 有 `benchmark_serving_structured_output.py` |
| Speculative decoding | ❌ random 数据集 accept rate 没意义 | vLLM 有 `SpecBench / SpeedBench` 我们没接 |
| 多模态（图像/音频 token） | ❌ vegeta 只能塞死 body；genai-perf 有 `--image-*` knob 我们没暴露 | adapter schema 都缺 |
| Reranker `1 query × N passages` | ⚠️ genai-perf endpointType=rankings 可选，但 `--batch-size-text` 我们没暴露 | adapter schema 缺 |
| Multi-LoRA 切换压测 | ❌ | adapter 都没 `adapter` knob |
| Goodput @ SLO（MLPerf 真正打分指标） | ❌ 报告组件不算 goodput | report side 缺，不是 adapter 缺 |
| Token 输出率分布（per-request） | ❌ adapter 只给 aggregate p50/p95 等 | guidellm/genai-perf 都给的，但我们 report schema 没拆 |

> **影响 v1 模板的硬约束**：
> 1. 推理 scenario 不能 sweep → 所有模板都是单点
> 2. token 分布只能给 mean 一个数 → 生产 trace 模板的"长尾"压不出来（描述里要说清是 mean，不是分布）
> 3. 多轮 / prefix-cache 测不到 → 标"Long-context Chat (Mooncake)"模板要明确"stateless 近似"

---

## 6. 模板矩阵 (10 个，全部 inference scenario)

### 6.1 总览

| # | name (zh) | name (en) | tool | 锚 | 主测 KPI |
|---|---|---|---|---|---|
| 1 | 通用对话 · 标准 | Chat · Standard | guidellm | GuideLLM 上游 chat.json | TTFT/TPOT p95 |
| 2 | RAG · 检索增强 | RAG · Retrieval-Augmented | guidellm | GuideLLM 上游 rag.json | TTFT (prefill heavy) |
| 3 | vLLM 兼容基线 (约定值) | vLLM Default Baseline (convention) | guidellm | vLLM `DEFAULT_INPUT_LEN=1024 / DEFAULT_OUTPUT_LEN=128` | 跨工具横评 baseline |
| 4 | 生产对话流量 (Azure 2024) | Production Chat (Azure 2024) | guidellm | Azure conv p50 967 / 41 | 真实负载下 TTFT/TPOT |
| 5 | Copilot 代码补全 (Azure 2024) | Copilot-style Code Completion | guidellm | Azure code p50 1976 / 9 | TTFT p99（短输出，几乎纯 prefill） |
| 6 | 长文档摘要 | Long-doc Summarization | guidellm | DistServe LongBench 1738/91 推到长上下文 | TTFT + KV 内存上限 |
| 7 | 长上下文对话 (Mooncake) | Long-context Chat (Mooncake) | guidellm | Mooncake conv p50 6909/350 | 长上下文 TTFT + 内存（**stateless 近似**） |
| 8 | 推理 / CoT 输出密集 | Reasoning · Output-heavy | guidellm | GSM8K CoT + o1/R1 输出长度量级 | TPOT (decode-bound) |
| 9 | Agent / Tool 调用 (Mooncake) | Agent · Tool Use (Mooncake) | guidellm | Mooncake tool&agent p50 6346/30 | E2E latency（mean 损失 bimodal） |
| 10 | 嵌入服务高吞吐 | Embeddings · High-throughput | genai-perf | GenAI-Perf embeddings.md | RPS + p99 latency |

### 6.2 每模板规格

下方每条都列出可直接塞进 `benchmark_templates.config` 的 JSON payload。Schema 来自 `packages/tool-adapters/src/guidellm/schema.ts` / `genai-perf/schema.ts`。所有 config **经 schema mental check**：`random` dataset 要求 `datasetInputTokens` + `datasetOutputTokens` 都存在；inference scenario 限 `rateType ∈ {constant, poisson, throughput, synchronous}`。

---

#### #1 Chat · Standard / 通用对话 · 标准

- **scenario**: `inference`
- **tool**: `guidellm`
- **tags**: `["chat", "baseline", "guidellm-upstream"]`
- **i18n**
  - `name.zh-CN`: 通用对话 · 标准
  - `name.en-US`: Chat · Standard
  - `description.zh-CN`: 通用对话基线，输入/输出形状对齐 GuideLLM 上游 `chat.json`（input 512、output 256）。固定 10 RPS 泊松到达，1000 次请求，约 100 秒。先跑这个看你的服务在"日常聊天"形状下的 TTFT / TPOT 水位。
  - `description.en-US`: General chat baseline, matches GuideLLM upstream `chat.json` shape (input 512, output 256). Poisson arrivals at 10 RPS, 1000 requests, ~100 s. Run this first to see TTFT / TPOT under a "typical chat" payload.
- **config**:
  ```json
  {
    "profile": "throughput",
    "apiType": "chat",
    "datasetName": "random",
    "datasetInputTokens": 512,
    "datasetOutputTokens": 256,
    "rateType": "poisson",
    "requestRate": 10,
    "totalRequests": 1000,
    "maxDurationSeconds": 300,
    "maxConcurrency": 100,
    "validateBackend": false
  }
  ```

---

#### #2 RAG · Retrieval-Augmented / RAG · 检索增强

- **scenario**: `inference`
- **tool**: `guidellm`
- **tags**: `["rag", "long-input", "guidellm-upstream"]`
- **i18n**
  - `name.zh-CN`: RAG · 检索增强
  - `name.en-US`: RAG · Retrieval-Augmented
  - `description.zh-CN`: 检索增强（RAG）形状，对齐 GuideLLM 上游 `rag.json`（input 4096、output 512）。长输入 + 中等输出，TTFT/prefill 是瓶颈。5 RPS 泊松、500 次请求；先看 TTFT p95 能不能压在 SLO 内。
  - `description.en-US`: Retrieval-Augmented Generation shape, matches GuideLLM upstream `rag.json` (input 4096, output 512). Long input + medium output — TTFT and prefill dominate. 5 RPS Poisson, 500 requests; watch TTFT p95 against your SLO.
- **config**:
  ```json
  {
    "profile": "long_context",
    "apiType": "chat",
    "datasetName": "random",
    "datasetInputTokens": 4096,
    "datasetOutputTokens": 512,
    "rateType": "poisson",
    "requestRate": 5,
    "totalRequests": 500,
    "maxDurationSeconds": 600,
    "maxConcurrency": 64,
    "validateBackend": false
  }
  ```

---

#### #3 vLLM Default Baseline / vLLM 兼容基线 (约定值)

- **scenario**: `inference`
- **tool**: `guidellm`
- **tags**: `["baseline", "vllm-default", "synthetic"]`
- **i18n**
  - `name.zh-CN`: vLLM 兼容基线 (约定值)
  - `name.en-US`: vLLM Default Baseline (convention)
  - `description.zh-CN`: **跨工具横评用**，对齐 vLLM `RandomDataset` 默认（input 1024 / output 128）。注意这是 vLLM 代码里的常量，**不对应任何真实生产分布**——Azure 真实 conv 输出中位只有 41。用它来和其它团队的 vLLM bench 数据对账，不要用它做容量规划。
  - `description.en-US`: **For cross-tool comparison only.** Matches vLLM `RandomDataset` defaults (input 1024 / output 128). These are code constants — **they do not correspond to any production distribution** (real Azure conv median output is 41). Use it to align with other teams' vLLM bench numbers, not for capacity planning.
- **config**:
  ```json
  {
    "profile": "custom",
    "apiType": "chat",
    "datasetName": "random",
    "datasetInputTokens": 1024,
    "datasetOutputTokens": 128,
    "rateType": "throughput",
    "requestRate": 0,
    "totalRequests": 1000,
    "maxDurationSeconds": 600,
    "maxConcurrency": 64,
    "validateBackend": false
  }
  ```

---

#### #4 Production Chat (Azure 2024) / 生产对话流量 (Azure 2024)

- **scenario**: `inference`
- **tool**: `guidellm`
- **tags**: `["chat", "production-trace", "azure-2024"]`
- **i18n**
  - `name.zh-CN`: 生产对话流量 (Azure 2024)
  - `name.en-US`: Production Chat (Azure 2024)
  - `description.zh-CN`: 锚定 Azure LLM Inference Trace 2024 的 `conv` 服务（p50 input 967 / p50 output 41）。输入 ≈ 1000、输出 ≈ 100（按 p75 取，让模板比中位略保守）。30 RPS 泊松到达对齐 trace 测得的单实例量级。**已知简化**：我们只给 mean，真实 trace 是重尾分布。
  - `description.en-US`: Anchored to the Azure LLM Inference Trace 2024 `conv` service (p50 input 967 / p50 output 41). We use input ≈ 1000, output ≈ 100 (slightly above p50 to bias toward p75). 30 RPS Poisson matches the per-instance arrival rate observed in the trace. **Known simplification**: we only set the mean; the real trace is heavy-tailed.
- **config**:
  ```json
  {
    "profile": "custom",
    "apiType": "chat",
    "datasetName": "random",
    "datasetInputTokens": 1000,
    "datasetOutputTokens": 100,
    "rateType": "poisson",
    "requestRate": 30,
    "totalRequests": 3000,
    "maxDurationSeconds": 600,
    "maxConcurrency": 200,
    "validateBackend": false
  }
  ```

---

#### #5 Copilot-style Code Completion / Copilot 代码补全 (Azure 2024)

- **scenario**: `inference`
- **tool**: `guidellm`
- **tags**: `["code-completion", "production-trace", "azure-2024", "prefill-dominated"]`
- **i18n**
  - `name.zh-CN`: Copilot 代码补全 (Azure 2024)
  - `name.en-US`: Copilot-style Code Completion (Azure 2024)
  - `description.zh-CN`: 锚定 Azure 2024 `code` 服务（p50 input 1976 / **p50 output 9**）。这是 IDE 补全形态：长前缀 + 极短输出，**几乎是纯 prefill 战场**。30 RPS 泊松。重点看 TTFT p99——补全要在用户按下一个字符前回来。
  - `description.en-US`: Anchored to the Azure 2024 `code` service (p50 input 1976, **p50 output 9**). This is IDE-completion traffic: long prefix, very short output — **almost pure prefill workload**. 30 RPS Poisson. Watch TTFT p99 — completion must return before the user types the next keystroke.
- **config**:
  ```json
  {
    "profile": "custom",
    "apiType": "chat",
    "datasetName": "random",
    "datasetInputTokens": 2000,
    "datasetOutputTokens": 20,
    "rateType": "poisson",
    "requestRate": 30,
    "totalRequests": 3000,
    "maxDurationSeconds": 600,
    "maxConcurrency": 200,
    "validateBackend": false
  }
  ```

---

#### #6 Long-doc Summarization / 长文档摘要

- **scenario**: `inference`
- **tool**: `guidellm`
- **tags**: `["summarization", "long-context", "memory-bound"]`
- **i18n**
  - `name.zh-CN`: 长文档摘要
  - `name.en-US`: Long-doc Summarization
  - `description.zh-CN`: 长文档摘要场景：input 8000、output 500。同步顺序发送（synchronous，一次一个），200 次请求。**主要看 TTFT 和 KV 内存余量**——长上下文是 KV 杀手，跑不动会 OOM 而不是慢。参考 DistServe LongBench 切片（1738/91）推到长上下文档级。
  - `description.en-US`: Long-document summarization: input 8000, output 500. Synchronous (one at a time), 200 requests. **Watch TTFT and KV memory headroom** — long context is a KV killer; if the service fails it'll OOM, not just slow down. Anchored on DistServe LongBench slice (1738/91), pushed to long-doc length.
- **config**:
  ```json
  {
    "profile": "long_context",
    "apiType": "chat",
    "datasetName": "random",
    "datasetInputTokens": 8000,
    "datasetOutputTokens": 500,
    "rateType": "synchronous",
    "requestRate": 0,
    "totalRequests": 200,
    "maxDurationSeconds": 1800,
    "maxConcurrency": 1,
    "validateBackend": false
  }
  ```

---

#### #7 Long-context Chat (Mooncake) / 长上下文对话 (Mooncake)

- **scenario**: `inference`
- **tool**: `guidellm`
- **tags**: `["chat", "long-context", "production-trace", "mooncake"]`
- **i18n**
  - `name.zh-CN`: 长上下文对话 (Mooncake)
  - `name.en-US`: Long-context Chat (Mooncake)
  - `description.zh-CN`: 锚定 Mooncake FAST'25 conversation trace（p50 input 6909 / p50 output 350，40% prefix-cache 命中率），代表 Kimi 类长上下文 chat。input 6000 / output 350，5 RPS 泊松。**重要免责**：我们 adapter 无状态重放，**无法复用 KV-cache，测不出真实 Mooncake 40% 命中率带来的延迟降低**——所以这条模板压出的 TTFT 是悲观上界。
  - `description.en-US`: Anchored to the Mooncake FAST'25 conversation trace (p50 input 6909 / p50 output 350, 40% prefix-cache hit rate) — represents long-context chat (Kimi-style). Input 6000 / output 350, 5 RPS Poisson. **Important caveat**: our adapter does stateless replay; it **cannot reuse KV cache across requests, so it can't reproduce the latency drop from Mooncake's real 40% hit rate**. Expect the TTFT measured here to be a pessimistic upper bound.
- **config**:
  ```json
  {
    "profile": "long_context",
    "apiType": "chat",
    "datasetName": "random",
    "datasetInputTokens": 6000,
    "datasetOutputTokens": 350,
    "rateType": "poisson",
    "requestRate": 5,
    "totalRequests": 500,
    "maxDurationSeconds": 1200,
    "maxConcurrency": 32,
    "validateBackend": false
  }
  ```

---

#### #8 Reasoning · Output-heavy / 推理 · 输出密集

- **scenario**: `inference`
- **tool**: `guidellm`
- **tags**: `["reasoning", "cot", "decode-bound", "generation-heavy"]`
- **i18n**
  - `name.zh-CN`: 推理 · 输出密集
  - `name.en-US`: Reasoning · Output-heavy
  - `description.zh-CN`: 推理 / 长 CoT 形态：input 300 / output 1500（**全集唯一 output > input 的模板**）。覆盖 o1、DeepSeek R1 这类把"思考过程"也输出的模型。5 RPS 泊松。**主测 TPOT 和输出 tok/s（decode-bound）**——这一档下 GPU 算力的 decode 段比 prefill 重要得多。
  - `description.en-US`: Reasoning / long-CoT shape: input 300 / output 1500 (**the only template where output > input**). Covers o1 / DeepSeek R1 style models that emit their thinking trace. 5 RPS Poisson. **Watch TPOT and output tokens/sec (decode-bound)** — at this shape, decode dominates the kernel-time budget, not prefill.
- **config**:
  ```json
  {
    "profile": "generation_heavy",
    "apiType": "chat",
    "datasetName": "random",
    "datasetInputTokens": 300,
    "datasetOutputTokens": 1500,
    "rateType": "poisson",
    "requestRate": 5,
    "totalRequests": 500,
    "maxDurationSeconds": 900,
    "maxConcurrency": 32,
    "validateBackend": false
  }
  ```

---

#### #9 Agent · Tool Use (Mooncake) / Agent · Tool 调用 (Mooncake)

- **scenario**: `inference`
- **tool**: `guidellm`
- **tags**: `["agent", "tool-use", "production-trace", "mooncake", "long-input"]`
- **i18n**
  - `name.zh-CN`: Agent · Tool 调用 (Mooncake)
  - `name.en-US`: Agent · Tool Use (Mooncake)
  - `description.zh-CN`: 锚定 Mooncake tool&agent trace（p50 input 6346 / p50 output 30，但 p95 output 600——bimodal）。Agent 的典型形态：庞大 system prompt + 工具 schema 喂进去，输出一个短 JSON tool call。input 6000 / output 50（**用 mean 近似 bimodal，会损失长尾**）。10 RPS 泊松。
  - `description.en-US`: Anchored to the Mooncake tool&agent trace (p50 input 6346 / p50 output 30, but p95 output 600 — bimodal). Typical agent shape: large system prompt + tool schemas in, short JSON tool call out. Input 6000 / output 50 (**mean approximation loses the bimodal tail**). 10 RPS Poisson.
- **config**:
  ```json
  {
    "profile": "long_context",
    "apiType": "chat",
    "datasetName": "random",
    "datasetInputTokens": 6000,
    "datasetOutputTokens": 50,
    "rateType": "poisson",
    "requestRate": 10,
    "totalRequests": 1000,
    "maxDurationSeconds": 900,
    "maxConcurrency": 64,
    "validateBackend": false
  }
  ```

---

#### #10 Embeddings · High-throughput / 嵌入服务高吞吐

- **scenario**: `inference`
- **tool**: `genai-perf`
- **tags**: `["embeddings", "non-generative", "high-throughput"]`
- **i18n**
  - `name.zh-CN`: 嵌入服务高吞吐
  - `name.en-US`: Embeddings · High-throughput
  - `description.zh-CN`: 嵌入服务压测：endpoint=embeddings，input 平均 256 tokens（典型文档分块大小，e5/bge 类模型上限是 512），并发 64，2000 次请求。无生成，非流式。**主测 RPS 和 p99 latency**——嵌入服务通常 batched stateless，瓶颈在算力而不是 KV。
  - `description.en-US`: Embeddings serving benchmark: endpoint=embeddings, input mean 256 tokens (typical chunk size; e5/bge-class models cap at 512), concurrency 64, 2000 requests. No generation, non-streaming. **Watch RPS and p99 latency** — embedding services are usually batched stateless, bound by compute not KV.
- **config**:
  ```json
  {
    "endpointType": "embeddings",
    "numPrompts": 2000,
    "concurrency": 64,
    "inputTokensMean": 256,
    "inputTokensStddev": 0,
    "streaming": false
  }
  ```

---

## 7. 砍掉的候选模板（每条记账）

| 候选 | 砍掉理由 |
|---|---|
| HumanEval 代码生成 (171/98) | DistServe 用它做代码代理，但它是**质量评测集**，不是生产流量。生产 Copilot 真实分布在 #5 已覆盖。再出一条只会误导用户"这两个都是代码场景"。 |
| Reranker (genai-perf rankings) | 我们 adapter 没暴露 `--batch-size-text`，模板只能用 query token 量近似 1 query × N passages 的真实形状。**半成品 + 免责声明的价值小于挂 issue 等开 knob 后再出**。挂在 v2 gap 第 2 条。 |
| 多模态 VQA | 我们 vegeta `chat-vision` 只能塞死的 body JSON，genai-perf 多模态 knob 我们没暴露。同上——挂 v2。 |
| BurstGPT API log 短输出模板 | Azure code (#5) 已经覆盖"长输入 + 短输出"形态，再出一条 BurstGPT API log 风格（input 221 / output 26）和 #5 在压什么上重叠度太高。等真有人提"我想压 ChatGPT API 流量"再加。 |
| MT-Bench 多轮 | 真实多轮的关键是 KV reuse，我们 stateless 测不到——除非接入 guidellm session 概念或 genai-perf multi-turn。**绝不能出"多轮"标签但实际是 stateless** 的模板，会反向坑用户。挂 v2 gap 第 3 条。 |

---

## 8. v2 工作清单（不在本 PR，写在这里防失忆）

按价值排序：

1. **加 capacity scenario 官方模板**（3 条）：Chat sweep / MLPerf Interactive SLO 检查（450/40 ms）/ MLPerf Server SLO 检查（2000/200 ms）。SLO 拐点是模型服务能力评估的核心问题，inference 单点模板回答不了"它能扛多大"。
2. **genai-perf adapter 暴露 `--batch-size-text`** → 出 Reranker 模板。
3. **guidellm adapter 暴露 `--num-sessions / --session-turns-mean / --num-prefix-prompts`**（这些 flag 上游已有）→ 出真正的"多轮 + prefix-cache reuse"模板。这一步做完，Mooncake 40% / 59% 命中率才能真复现。
4. **guidellm `datasetInputTokens` 升级为 `{mean, stddev, min, max}` 四元组**（对齐上游 chat.json shape）→ 生产 trace 模板能真还原重尾分布而不是只给 mean。
5. **adapter 多模态 knob**（genai-perf `--image-width-mean / --image-height-mean / --audio-length-mean`、vegeta 模板化 body）→ 出多模态 VQA / TTS / ASR 模板。
6. **接入 vLLM `BurstGPTDataset`、`ConversationDataset`、`MTBenchDataset`**（真实 trace 重放，不再用 random 近似）。
7. **新增"Goodput @ SLO" report 输出**——MLPerf 真正打分用的就是这个，目前我们 sweep 跑完只有原始分布，没有"满足 SLO 的最大负载"的明确数字。

---

## 9. 落盘（本 PR 实施）

最终落地形态（和原方案的差异都在 review 期间和用户对齐过）：

1. **`apps/api/prisma/seed.ts`**（不是 `seed/official-templates.ts` 子目录——Prisma 默认 `package.json#prisma.seed` 期望单文件入口）。文件里同时定义 `EVALUATION_PROFILES`（5 条）+ `BENCHMARK_TEMPLATES`（10 条）。
2. **不用单独的 INSERT migration**——这是和原方案的核心差异。之前打算"empty migration + 手写 INSERT"，user 提出后改成业内标准 seed.ts 模式：schema 走 migration、数据走 seed，互不混合。
3. **Idempotent upsert 凭稳定标识符**：
   - `benchmark_templates`：`where: { id: 'tpl_official_<slug>' }`
   - `evaluation_profiles`：`where: { slug: '...' }`（slug 是该表的域稳定键，有 unique 索引）
4. **每条 row 入库前走 zod**：模板过 `guidellm|genai-perf paramsSchema` + `applyScenarioConstraints(scenario, tool)`；profile rules 过 `profileRulesSchema`。如果哪条 seed 数据违反 schema，seed 直接抛错——构建时发现，不让脏数据进库。
5. **触发时机**：
   - dev：`pnpm prisma migrate dev / reset` 后 Prisma 自动跑 seed（package.json hook）
   - test：`apps/api/test/setup/global-setup.mts` 在 `migrate deploy` 后显式跑 `prisma db seed`
   - prod：deploy pipeline 需要在 `prisma migrate deploy` 后显式跑 `pnpm prisma db seed`（Prisma 故意不让 deploy 自动 seed）
6. **i18n（v2 推迟）**：原计划同时入 `official.<slug>.{name,description}` i18n key。现状 v1 只存 zh-CN 到 DB 字段；en-US 用户暂时看到中文。要做完整 i18n 需要：(a) 给 `benchmark_templates` 加 `name_key` / `description_key` 列（对齐 `evaluation_profiles.name_key` 既有模式）、(b) FE 列表用 `t(nameKey, fallback=name)`、(c) locale 文件加 `official.*` 命名空间。挂 §8 第 1 条。
7. **测试**：
   - `apps/api/src/modules/insights/evaluation-profile.service.spec.ts` 原本断言"5 个内置存在"——globalSetup 加 `prisma db seed` 之后仍然过
   - `pnpm -F @modeldoctor/api test` 本地 74 文件 / 546 测试全过
   - 没加专门的 "official templates exist after seed" e2e 用例（globalSetup 已经保证了，再写一条就是自我引用）

**安全网**：upsert 用稳定 id/slug、`isBuiltin`/`isOfficial=true` 强制写死、`update` 块永不覆盖 `id`/`slug`。用户自建模板（`isOfficial=false`、`createdBy!=null`）和官方模板分隔得很清楚，seed 永不动 `isOfficial=false` 的行。

---

## 10. 参考文献

### 工具 / 框架
- GuideLLM (vllm-project): https://github.com/vllm-project/guidellm — 见 `src/guidellm/benchmark/scenarios/{chat,rag}.json`
- GenAI-Perf (NVIDIA Triton): https://github.com/triton-inference-server/perf_analyzer/tree/main/genai-perf
- vLLM benchmarks: https://github.com/vllm-project/vllm/blob/main/vllm/benchmarks/datasets/datasets.py
- LLMPerf (Anyscale, archived 2025-12): https://github.com/ray-project/llmperf
- MLPerf Inference rules: https://github.com/mlcommons/inference_policies

### 生产 trace
- Azure LLM Inference Trace 2023 / 2024: https://github.com/Azure/AzurePublicDataset/blob/master/AzureLLMInferenceDataset2024.md
- Splitwise (ISCA'24): https://arxiv.org/abs/2311.18677
- DynamoLLM (HPCA'25): https://arxiv.org/abs/2408.00741
- ModServe (SoCC'25): https://arxiv.org/abs/2502.00937
- Mooncake (FAST'25): https://github.com/kvcache-ai/Mooncake — `FAST25-release/traces/`
- BurstGPT (KDD'25): https://github.com/HPMLL/BurstGPT
- DistServe (OSDI'24): https://arxiv.org/abs/2401.09670
- LMSYS-Chat-1M: https://arxiv.org/abs/2309.11998
- Chatbot Arena Conversations: https://huggingface.co/datasets/lmsys/chatbot_arena_conversations

### MLPerf 模型基准
- Llama2-70B: https://github.com/mlcommons/inference/tree/master/language/llama2-70b
- Llama3.1-405B: https://github.com/mlcommons/inference/tree/master/language/llama3.1-405b
- Mixtral-8x7B: https://github.com/mlcommons/inference/tree/master/language/mixtral-8x7b
