# Agent 能力测试（τ²-bench 集成）— 设计文档

- 日期：2026-07-05
- 分支：`feat/agent-eval-tau2`
- 范围：新增「Agent 能力测试」——用 [τ²-bench](https://github.com/sierra-research/tau2-bench) 对已注册 Connection 做多轮工具调用（tool-agent-user）评测，产出**故事化报告 + 可配门禁**。作为 benchmark 子系统的一个**新 `agent` 场景 + 新 `tau2` 工具**接入，复用现有 K8s Job → MinIO 执行链路与 `Benchmark` 数据模型。**不动** quality-gate（单轮 LLM-as-judge）子系统。

---

## 1. 问题与目标

现有两套评测子系统都测不了「Agent 能力」：

- **benchmark 子系统**（guidellm/aiperf…）：只测性能/负载（TTFT/TPOT/QPS），不看正确性、不做多轮。
- **quality-gate 子系统**：`endpoint-caller.ts` 硬编码单轮（`messages:[{user}]`，无 tool loop），测不了多轮工具调用的 agent 行为。

目标：让用户在 ModelDoctor 里针对某个 Connection（某引擎/某模型的 endpoint）一键发起 τ²-bench 评测，测它在**航空/零售/电信客服**场景下多轮对话 + 调用领域工具 + 守业务政策的能力,产出：

1. **完成率 / pass^k**（按 domain 分组的柱状图）——回答 leadership「哪个模型更靠谱、稳不稳」。
2. **对话回放**（成功高光 + 翻车案例,标注在哪一步出错）——技术术语零门槛的「故事」。
3. **失败归因**——把失败案例分类,配一句人话结论。
4. **可配门禁**——能进回归 / CI。

τ²-bench 天生记录完整对话轨迹（用户话术 + agent 工具调用 + 最终数据库状态），这些原始 trajectory 就是现成的「故事」素材,无需额外造数据。

---

## 2. 已定决策（brainstorm 结论）

| 决策点 | 结论 | 理由 |
|---|---|---|
| 定位 | **产品化功能** | 成为 ModelDoctor 的一等能力,不是一次性脚本 |
| 架构 | **方案 A：新 `agent` 场景 + 新 `tau2` 工具接入 benchmark-runner,复用 `Benchmark` 表 + MinIO trajectory** | benchmark-runner 的 `ToolAdapter` 接口本就是为「加新工具=加一个文件夹+一个 Dockerfile」设计;trajectory 本就落 MinIO,故事化报告按需拉,不进 Postgres;几乎零新表。符合 memory「复用现有基础设施、不重复造轮子」 |
| 被测对象（agent LLM） | 已注册的 **Connection**（`baseUrl` + `model` + 解密后 apiKey） | 与现有 benchmark 对齐 |
| 模拟用户（user-simulator LLM） | **复用默认 `LlmJudgeProvider`**（当前 deepseek 弱判官）。报告里显式标注「模拟用户模型」,并留 `userSimProviderId` 覆盖口子（V1 默认走 default provider,不在表单暴露） | 零新配置最省事;弱模型当模拟用户会增噪,靠标注 + 可覆盖兜底 |
| Domain | V1 = **airline(50) + retail(114) + telecom(114)**,banking_knowledge 往后（需 `--extra knowledge`,镜像变大,性质不同） | 三个纯 tool-use domain,无额外依赖 |
| 规模 | **三档预设**（见 §5.6）,每档=一个官方 `BenchmarkTemplate`,参数可复制改。默认 Standard | Smoke 验证链路/快门禁,Standard 测基本能力+稳定性,Full 对标 leaderboard |
| 判定 | **故事化报告 + 可配门禁**,门禁**默认关**,两种可选：per-domain 完成率下限 / baseline 回归 | Agent 完成率天然偏低且各 domain 差异大（airline 官方 pass^1 才 ~38%）,绝对阈值不能一刀切 |
| 双 endpoint 机制 | tau2 `--agent-llm-args` / `--user-llm-args` 传 JSON `{api_base, api_key}`,model 名用 `openai/<model>` 前缀（LiteLLM openai-compatible） | 已查证 tau2 CLI 明确支持给自建 OpenAI 兼容 endpoint 传 `api_base`/`api_key` |

---

## 3. 架构总览

```
[Web] BenchmarkCreatePage(scenario=agent)
        └─ POST /benchmarks  ────────────────► [API] benchmark.service
                                                   └─ tau2 adapter.buildCommand()
                                                        → argv + secretEnv(两个 endpoint 的 key)
                                                   └─ K8sBenchmarkRunner.start()
                                                        → K8s Job(镜像 md-runner-tau2) + per-run Secret
[K8s Job] runner/main.py(工具无关 wrapper)
        └─ 执行 `tau2 run --domain … --agent-llm openai/<m> --agent-llm-args '{api_base,api_key}' …`
        └─ 采集 data/simulations/*.json(trajectory) → S3/MinIO
             {runId}/files/simulations.json、{runId}/result.json、stdout/stderr.log
[API] pod-state watcher → Benchmark.status;完成后 report-loader 读 result.json
        └─ tau2 adapter.parseFinalReport() → summaryMetrics(完成率/pass^k/归因/gate)
[Web] BenchmarkDetailPage → AgentReport 组件
        └─ 完成率柱状图 + 对话回放(按需从 MinIO 拉 trajectory) + 失败归因
```

**关键不变量**:tau2 是又一个「工具」。执行编排（K8s Job manifest、per-run Secret、pod watch、SSE 日志、S3 读写）**完全复用**,不新增。新增只有：一个 adapter、一个 Dockerfile、一个场景登记、一个报告组件、三个官方模板。

---

## 4. 组件设计

### 4.1 tau2 tool adapter — `packages/tool-adapters/src/tau2/`

实现冻结的 `ToolAdapter` 接口（`packages/tool-adapters/src/core/interface.ts`）,并在 `core/registry.ts` 注册 `tau2`。同时 `ToolName` union（`core/interface.ts`）、seed schema-picker（`seed.ts`）、runner 镜像解析（`k8s/runner-images.ts` `imageForTool`）各加一处 `tau2` 分支。

**`params` zod schema**（`tau2ParamsSchema`,导出供 seed 校验）：

```ts
{
  domains: z.array(z.enum(["airline","retail","telecom"])).min(1),
  numTasksPerDomain: z.number().int().positive().nullable(), // null = 全量
  numTrials: z.number().int().min(1).max(8),
  userSimProviderId: z.string().optional(),  // 缺省=default LlmJudgeProvider
  gate: z.object({
    mode: z.enum(["off","perDomainFloor","baselineRegression"]).default("off"),
    perDomainFloor: z.record(z.string(), z.number()).optional(), // {airline:0.3,...} pass^1 下限
    baselineRegressionPp: z.number().optional(),                 // pass^1 跌超 N pp 判 FAILED
  }).default({ mode: "off" }),
}
```

**`buildCommand(plan)`** → `BuildCommandResult`:

- 每个 domain 一条 `tau2 run`（tau2 CLI 一次一个 `--domain`）。多 domain → 生成一个串行 shell（`tau2 run … && tau2 run …`）或多个 outputFiles 分目录。**V1 串行**（domain 数 ≤3,K8s Job 内串行最简单,避免并发打爆被测 endpoint）。
- agent endpoint 来自 `plan` 里的 Connection：`--agent-llm openai/<connection.model>`、`--agent-llm-args '{"api_base":"<baseUrl>/v1","api_key":"<AGENT_KEY>"}'`。
- user-sim endpoint 来自 default（或指定）`LlmJudgeProvider`：`--user-llm openai/<judge.model>`、`--user-llm-args '{"api_base":"<judge.baseUrl>/v1","api_key":"<USER_KEY>"}'`。
- **key 只走 `secretEnv`,绝不进 argv**（复用现有 per-run Secret 机制）。`--*-llm-args` 里的 `api_key` 用 `${AGENT_KEY}` / `${USER_KEY}` 占位,由容器内 shell 展开——或改用 tau2 支持的 env（若 tau2 读 `OPENAI_API_KEY` 则 agent/user 冲突,故**必须走 llm-args 显式传两把 key**,实现时确认 llm-args 的 api_key 优先级高于全局 env）。
- `outputFiles`:声明 tau2 结果目录（`data/simulations/`）作为 alias 采集到 MinIO。
- `getMaxDurationSeconds(params)`:按 `Σdomain(numTasks) × numTrials × 单 episode 上限秒` 估算,驱动 HMAC 回调 TTL 与 Job activeDeadline。Full 档需给足（小时级）。

**`parseProgress(line)`**:从 tau2 stdout 解析进度（如 `task 12/60`）→ `ProgressEvent`。具体正则实现时对真实 stdout 定。

**指标计算下沉到 Python（复用 tau2 自带 `compute_metrics`)**:tau2 已内置完整指标模块 `tau2.metrics.agent_metrics.compute_metrics(Results) → AgentMetrics`,含官方 `pass^k = C(success,k)/C(trials,k)` 公式、termination-reason 计数、DB-match、read/write action 正确率。**不在 TS 里重造 pass^k**。tau2 镜像内附一个我方小脚本 `md_tau2_summarize.py`:每个 domain 一次 `tau2 run` → 一个 `data/simulations/<runId>_<domain>/results.json`;脚本 `Results.load` 每个 domain → `compute_metrics` → 拼 per-domain + overall + 失败归因 + 高光/翻车 sim 定位 → 写单个 `summary.json`(我方形状,见 §4.3)。runner 把 `summary.json` + 各 `results.json`(供回放)都采到 MinIO。

**`parseFinalReport(stdout, files)`** → `ToolReport`（写入 `Benchmark.summaryMetrics`):TS 侧只做两件事——(1) 读 `summary.json` 直接映射为 `summaryMetrics`;(2) 依 `params.gate` + DB 里的 baseline 算门禁（见 §4.4)。原始 trajectory 不解析,留在 MinIO 供报告页按需拉。

> tau2 结果 schema 已从源码落实(`data_model/simulation.py`):`Results{info, tasks, simulations[]}`;`SimulationRun{task_id, trial, reward_info.reward(float,1.0=pass), termination_reason(enum), messages[], reward_info.{db_check.db_match, action_checks[].{action_match, tool_type}}}`。text run 默认 monolithic JSON。字段无需再猜;仍需 Smoke 小样本端到端验证一次(§7)。

### 4.2 runner 镜像 — `apps/benchmark-runner/images/tau2.Dockerfile`

- base:Python 3.12（tau2 要求 `>=3.12,<3.14`,注意现有 runner 是 3.11,tau2 镜像单独用 3.12）。
- 安装 tau2:`git clone` + `uv sync`（core,不带 voice/knowledge extra）。或若 tau2 发布了 PyPI 包则 `pip install`（实现时确认包名/发布状态,README 用 `uv sync` from source)。
- 复用 `runner/main.py` 的工具无关 wrapper:`MD_*` env → argv → tee stdout/stderr → 采集 `outputFiles` → 写 S3。tau2 对 runner 是纯黑盒子进程。
- 构建接入 `tools/build-runner-images.sh`;`k8s/runner-images.ts` `imageForTool("tau2")` → `md-runner-tau2`。

### 4.3 数据模型 — 复用 `Benchmark`,零新表

`Benchmark` 行:`scenario="agent"`, `tool="tau2"`, `params`=上面的 zod 对象, `templateId`=所选档位模板, 可选 `baselineId`。

`summaryMetrics`（Json,新的 agent 形状,前端 `AgentReport` 消费）:

```jsonc
{
  "kind": "agent-tau2",
  "userSimModel": "deepseek-v3",          // 报告标注用
  "numTrials": 3,
  "overall": { "pass1": 0.41, "passK": 0.33, "tasks": 60 },
  "perDomain": {
    "airline": { "pass1": 0.38, "passK": 0.30, "tasks": 20 },
    "retail":  { "pass1": 0.21, "passK": 0.18, "tasks": 20 },
    "telecom": { "pass1": 0.33, "passK": 0.27, "tasks": 20 }
  },
  "attribution": { "agent_crash": 0.10, "no_completion": 0.25, "wrong_action": 0.28,
                   "wrong_final_state": 0.22, "missing_info": 0.10, "other": 0.05 }, // 失败占比,见 §4.5
  "gate": { "mode": "off", "result": null },           // 或 PASSED/WARNING/FAILED
  "highlights": { "successRunId": "...", "failureRunId": "..." } // 报告默认挑的高光/翻车案例定位
}
```

**对话轨迹不进 Postgres**:原始 `data/simulations/*.json` 在 MinIO（`{runId}/files/…`）。`AgentReport` 展示对话回放时,前端经 `GET /benchmarks/:id/files/:alias`（现有 `benchmark-files.controller`）按需拉取,只解析要展示的那几个 task。

### 4.4 门禁 — 复用 `Benchmark.baselineId`,结果落 summaryMetrics

门禁在 `parseFinalReport` 阶段由 adapter 依据 `params.gate` 计算,写入 `summaryMetrics.gate`。**不引入 quality-gate 的 `EvaluationRun` 表**（那是单轮子系统）。三种 mode：

- `off`（默认):`result=null`,纯展示。
- `perDomainFloor`:任一 domain `pass^1 < floor[domain]` → `FAILED`;全过 → `PASSED`。
- `baselineRegression`:与 `baselineId` 指向的 benchmark 比 overall `pass^1`,跌超 `baselineRegressionPp` → `FAILED`,跌一半阈值内 → `WARNING`。

前端在报告头渲染 gate badge（复用现有 gate 配色语义 PASSED/WARNING/FAILED)。

### 4.5 失败归因 — 从 tau2 结构化信号确定性推导(无需 LLM)

τ² **不**保留原始 τ-bench 的 `auto_error_identification.py`,但它的 `reward_info` + `termination_reason` 提供了比那更结构化的信号,足以**确定性**分类失败,V1 **不需要 LLM judge**。`md_tau2_summarize.py` 对每个失败 sim(`reward < 1.0`)按优先级归桶:

| 桶 | 判定(优先级从上到下) | 语义 |
|---|---|---|
| `agent_crash` | `termination_reason ∈ {agent_error, too_many_errors, context_window_exceeded}` | agent 报错/连续工具错误崩掉 |
| `no_completion` | `termination_reason == max_steps`(或 timeout) | 多轮没跑完/兜圈子 |
| `wrong_action` | 任一 `action_checks[].action_match == False` | 用错工具 / 给错参数 |
| `wrong_final_state` | `db_check.db_match == False` | 最终数据库状态错(做了错的写操作) |
| `missing_info` | `communicate_checks` 有未满足项 | 没把必需信息告诉用户 |
| `other` | 兜底 | 其余 |

`tool_type`(read/write)可进一步区分只读误用 vs 写操作违规。归因是 `summary.json` 的一部分,前端直接画饼图。**自动分类基于确定性规则,非 LLM,故无「分类可能有误」免责需求**(仅 user-simulator 本身的噪声需标注,见 §5.4)。可选 `--auto-review`(tau2 内置 LLM review,产 severity/tag)作为 V1.1 富化,默认关。

### 4.6 Web 报告 — `AgentReport`

新场景报告组件 `apps/web/src/features/benchmarks/reports/AgentReport.tsx`,由 `BenchmarkDetailPage` 按 `scenario="agent"` 选中（现有 reportComponent 机制)。遵守 `docs/project-standards.md` 报告风格 + PageHeader/breadcrumb 约定。四块（对应 leadership 一页纸）:

1. **完成率柱状图**:按 domain 分组的 pass^1 / pass^k 双柱,顶部 overall 数字 + gate badge + 「模拟用户模型 = X」标注。用 `dataviz` skill 的图表系统。
2. **高光对话回放**:默认挑一个成功 task,聊天气泡渲染关键几轮（用户话术 / agent 工具调用 / 结果),绿色高亮守规矩的决策点。可切换任意 task。
3. **翻车对话回放**:默认挑一个失败 task,红/黄高亮翻车那一步（用错工具/给错参数/违反政策)。
4. **失败归因**:`attribution` 饼图 + 一句话人话结论。若含 LLM 语义归因,附「自动分类可能有误」免责。

对话回放数据经 files 端点按需拉 trajectory,前端渲染成聊天界面。故事化视觉可复用项目既有报告设计系统。

### 4.7 三档官方模板 — `apps/api/prisma/seed.ts`

追加到 `BENCHMARK_TEMPLATES`,每档一行,`scenario="agent"`, `tool="tau2"`,经 `tau2ParamsSchema` 校验（seed schema-picker 加 `tau2` 分支)：

| 模板 id | 档位 | domains | numTasksPerDomain | numTrials | episodes | gate 默认 |
|---|---|---|---|---|---|---|
| `tpl_official_agent_smoke` | Smoke 冒烟 | 全 3 | 5 | 1 | 15 | off |
| `tpl_official_agent_standard` | Standard 基本能力 | 全 3 | 20 | 3 | 180 | off |
| `tpl_official_agent_full` | Full 全量 | 全 3 | null(全量) | 4 | 1112 | off |

`--num-tasks` 取任务集前缀 → Smoke⊂Standard⊂Full,同 Connection 渐进加量、结果可叠加解读。Full 在创建表单显式提示成本（episodes 量级 + 预计时长量级)。

---

## 5. 硬约束与风险

1. **被测 endpoint 必须支持 OpenAI 工具调用（function calling)**。tau2 的 agent 靠 tool-call 执行领域工具,不支持则整场评测无意义。vLLM 侧需 `--enable-auto-tool-choice` + 对应 tool parser。**创建表单需前置校验/提示**,报告在 endpoint 不支持 tool-call 时给明确错误（而非一堆 0 分）。
2. **双 endpoint key 注入**:两把 key 都走 per-run Secret → `secretEnv`,在 `--*-llm-args` 里以占位引用。实现时确认 tau2 对 llm-args 里 `api_key` 的优先级 > 全局 `OPENAI_API_KEY`(否则 agent/user 撞 key)。
3. **成本/时长**:每 episode 是整段多轮对话（每轮 agent+user 各一次 LLM 调用),Standard 180 episodes ≈ 数千次调用,Full ≈ 上万次。`getMaxDurationSeconds` 要给足,Job activeDeadline 别误杀。
4. **user-sim 用弱判官增噪**:结果稳定性受模拟用户模型影响。报告显式标注模拟用户模型;pass^k（多 trial)本就是为对抗非确定性设计,缓解部分噪声。
5. **tau2 结果 schema**:已从源码(`data_model/simulation.py`、`metrics/agent_metrics.py`)逐字落实,指标复用 tau2 自带 `compute_metrics`。剩余唯一实测项:Smoke 小样本端到端验证 `--*-llm-args` 的 `api_base`/`api_key` 确实生效、`--save-to` 产物路径符合预期(§7),不阻塞设计。
6. **Python 版本**:tau2 需 3.12,现有 runner 镜像 3.11 → tau2 镜像单独基于 3.12,不动其他工具镜像。

---

## 6. 本期范围 / YAGNI

**做**:三 domain、三档模板、单 Connection 评测、故事化报告四块、可配门禁（default off)、双 endpoint 执行链路。

**不做（往后)**:

- banking_knowledge domain（需 extra,镜像变大)。
- **多模型横评**（N 个 Connection 并排):V1 是「单评测 + 故事化报告」;横评 = 跑多个单评测后走现有 `SavedCompare` 组合,作为后续 PR。
- voice / 语音 persona。
- V2 语义失败归因若 tau2 原生不支持,作为 V1.1 增量。
- 任务级 diff / per-sample 精细门禁（对齐 memory「Quality Gate = smoke-test 门禁」的克制)。

---

## 7. 测试

- **adapter 单测**（vitest,`packages/tool-adapters`):`buildCommand` 生成正确 argv（含 `openai/` 前缀、两套 llm-args、key 只在 secretEnv);`parseFinalReport` 用一份**真实抓取的** tau2 simulations JSON fixture 断言 pass^1/pass^k/归因/gate 计算。
- **seed 校验**:三档模板过 `tau2ParamsSchema`,`pnpm -F @modeldoctor/api db:seed` 幂等 upsert。
- **门禁**:三种 mode 的单测（floor 命中、baseline 回归、off)。
- **web 组件测**（vitest):`AgentReport` 用样例 summaryMetrics 渲染四块。
- **端到端（手动/小样本)**:Smoke 档打真实小样本（如仅 airline × 5 × 1)跑通 K8s Job → MinIO → 报告全链路,并借此**落实 trajectory 字段名**（§5.5)。

---

## 8. 落地顺序（供 writing-plans 细化）

1. **执行链路打通**(先拿到真实 trajectory,再谈解析):tau2 Dockerfile + adapter 骨架（buildCommand + outputFiles)+ registry/ToolName/imageForTool/scenario 登记 → Smoke 小样本跑通 → 抓 trajectory JSON 落实字段。
2. **指标解析 + 门禁**:parseFinalReport（pass^1/pass^k/粗归因)+ gate 三 mode + summaryMetrics 形状 + 单测。
3. **三档官方模板** seed + schema-picker 分支。
4. **AgentReport 报告组件**四块 + files 端点拉 trajectory 回放。
5. **创建表单**接 agent 场景(tool-call 前置提示、Full 成本提示、可选 user-sim 覆盖)。
6.（增量)V1.1 LLM 语义失败归因。
