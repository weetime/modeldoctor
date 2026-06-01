# MCP Actuation：让 MCP 从「列清单」到「动手」

**Status:** draft · 2026-06-01
**Scope:** `apps/api/src/modules/mcp`（新增工具 + ConfirmTokenService）、复用 `benchmark` / `quality-gate` / `engine-metrics` / `insights` / `alerts(PrometheusFetcher)` 既有 service；`packages/contracts` 新增工具 IO schema
**Tracks:** 暂无 issue（可开 `feat/mcp-actuation` 单 PR，或先开一个 tracking issue）
**Out of scope:**
- 不动 quality-gate 的 Path A（smoke-test 门禁）定位——不借机加 reasoning-eval 套件
- 不加可写的 PromQL / 告警规则下发（`query_prometheus` 只读）
- 不做跨 connection / 跨 cluster 对比（`compare_benchmarks` 限同库 benchmark）
- 不做多租户 / 多 MCP_USER_ID 的执行配额体系（单用户 V1）

## 背景与动机

产品 thesis：**Claude Code / Cursor 通过 MCP 操作私有化推理集群**。roadmap 标题是「Pre-prod 选配 + Day-2 自动运维」，其中：

- **Day-2 自动运维**已有闭环：Prometheus → Alertmanager → webhook → AI 解释 → 通知。
- **Pre-prod 选配**（选哪个引擎 / 什么配置 / 几张 GPU）**有原料没决策**。roadmap 故意把这个决策推给 Claude Code（砍掉 in-app Experiment/DecisionMatrix V2）。

但现有 16 个 MCP 工具几乎全是 read/list：agent **不能跑 benchmark、不能跑 quality-gate、不能查 PromQL、不能对比两次 benchmark 的结果**。结果是：选配的法定归宿是 Claude Code，而 MCP 接口干不了选配。本设计补齐这条链。

现有 MCP 已有"写工具"先例（`run_diagnostics` 真打端点、`create_channel` / `set_default_prometheus_datasource` 写库），故真正的新风险只在两类：
- **贵执行**：`run_benchmark` 会拉 K8s Job 烧 GPU。
- **裸查询**：`query_prometheus` 暴露任意 PromQL。

## 设计目标

1. 给 agent 一组**调查动词**（裸 PromQL + benchmark 对比），让"为什么我的端点变慢了"这类调查能在 Claude Code 内闭环完成。
2. 给 agent 一组**执行动词**（跑 benchmark / quality-gate），并用 **dry-run + 二次确认** 防止误烧 GPU。
3. 全程**复用既有 service**，MCP 工具保持薄 delegate，REST 与 MCP 不分叉。
4. 用一个**显式开关 + 无状态确认 token** 控制执行类工具的可用性与安全性。

## 工具总览：7 个工具，3 类

| 类别 | 工具 | 风险 | 复用 |
|---|---|---|---|
| 裸调查（读） | `query_prometheus` | 读；限结果体积 | `PrometheusFetcherService` query_range +（新增）instant query wrapper |
| | `get_engine_metric_catalog` | 读；消除 agent 盲查 | `EngineMetricsService` 的 per-serverKind manifest |
| 对比（读） | `compare_benchmarks` | 读 | `insights/ComparisonService` 的 delta 计算 |
| 轮询（读） | `get_benchmark` / `get_quality_gate_run` | 读；执行类异步必须能 poll | 现有 detail service |
| 执行（写，dry-run+confirm） | `run_benchmark` | 拉 K8s Job 烧 GPU | `BenchmarkService.create`（同 `POST /api/benchmarks`） |
| | `run_quality_gate` | 跑评测 + judge | `RunsService`（同 `POST /api/quality-gate/runs`，带 #261 genConfig） |

## 详细设计

### A. `query_prometheus`（裸 PromQL 透传，只读）

- **输入**：`connectionId`（解析其绑定的 PrometheusDatasource）**或** `datasourceId`；`query: string`（PromQL）；可选 `range: { from, to, step }`（走 query_range，缺省走 instant query）。
- **复用 + 缺口**：`PrometheusFetcherService` 已有 query_range（alerts 模块在用）；**instant query 需补一个薄 wrapper**（实现时核实是否已存在）。datasource 的 bearer token 全程服务端持有，不返回 agent。
- **护栏（只读但仍限）**：
  - **结果截断**：series 数 + 每 series 数据点上限（沿用 `list_alerts` 的"精简行防 context 膨胀"纪律）；超限返回 `truncated: true` + 提示收窄 query。
  - query_range 的 `step` / 时间跨度设上下限，避免单 query 拖垮 Prometheus。
  - 请求超时。PromQL 本身只读，无写风险。
- **输出**：结构化 series（metric labels + 值数组）+ `truncated` 标记。

### B. `get_engine_metric_catalog`（消除 agent 盲查）

- **输入**：`connectionId`。
- **输出**：该连接 serverKind（vLLM / SGLang / ...）对应的 `EngineMetricsService` manifest —— 已知指标名 + PromQL 模板 + 单位 + 阈值。
- **作用**：agent 先调 catalog 知道"这个引擎该查什么"，再用 `query_prometheus` 自由发挥。既给自由度，又不让 agent 凭空猜指标名——这是 `query_prometheus` 真正可用的前提。
- **取舍**：做成独立工具而非塞进 `query_prometheus` 的 description，因为 description 静态、塞不进 per-connection 的 serverKind 差异；catalog 能动态按连接返回。

### C. `compare_benchmarks`（选配对比，结构化非叙述）

- **输入**：`benchmarkIds: string[]`（2–5）；可选 `baselineId`。
- **输出**：跨 benchmark 的**对齐指标表** + 逐指标 delta + 每指标谁更优（P50/P95/P99、吞吐 tok/s、错误率、GPU 显存等）。**只给数字，不写叙述**——叙述是 Claude Code 自己的活（决策在 agent 侧）。
- **复用**：`insights/ComparisonService` 已有 benchmark-to-benchmark delta 逻辑；复用其计算，返回结构化数值而非 zh-CN 叙述。
- 纯读，无护栏（限同库 benchmark）。

### D. `get_benchmark` / `get_quality_gate_run`（轮询）

- benchmark 和 quality-gate run 都是异步——agent 跑完拿不到结果就等于没跑。
- 现有 `list_benchmarks(connectionId)` 给的是 summary 列表；这两个 `get_*` 给单个 run 的 status + summary/result，供 poll 到终态。
- 很薄（detail service 已存在），是执行闭环的必需件。

### E. 执行类共享机制：`ConfirmTokenService`（dry-run + 二次确认）

把"二次确认"抽成**独立、可单测的小单元**，两个执行工具共用：

1. **第一次调用（无 `confirmToken`）** → 工具返回**执行计划**：解析后的完整参数、目标连接、tool/scenario、**一句显式风险**（"将在连接 X 上创建 K8s Job，消耗 GPU"）+ 一个 `confirmToken`。
2. **第二次调用（带匹配的 `confirmToken`）** → 真正执行。

- **Token 设计**：`HMAC(服务端密钥, 规范化JSON(请求) + 时间戳)`，服务端重算校验。**无状态、不落库**；内嵌时间戳，超 N 分钟拒绝（防陈旧重放）。请求参数一改 token 即失效 → agent 不能"先 dry-run 小参数、再偷换大参数执行"。
  - 密钥：复用现有 server secret（如 `MCP_BEARER_TOKEN` 派生）或新增 `MCP_CONFIRM_SECRET`；实现时定，倾向派生避免新增 env。
  - 过期窗口：默认 10 分钟（常量，实现时定）。
- **总开关**：新增 `MCP_ALLOW_EXECUTE` env，控制 `run_benchmark` / `run_quality_gate` 是否注册。**默认开**（单用户本地=产品 thesis），留开关让只读部署一键关掉执行类工具。
- **取舍**：无状态 HMAC token vs. 落库 pending-action 表——选 HMAC：零 schema 变更、零清理逻辑、天然防篡改；代价是 token 不可主动撤销，但时间戳过期足够。

### F. `run_benchmark` / `run_quality_gate`（执行，dry-run+confirm）

- **`run_benchmark`**：输入 `connectionId` + (`templateId` 或 `scenario+tool+params`，复用现有 benchmark create 契约) + `name?` + `confirmToken?`。dry-run 返回解析后的 params 计划；confirm 后走 `BenchmarkService.create` 拉 Job，返回 `benchmarkId`，agent 用 `get_benchmark` 轮询到终态。
- **`run_quality_gate`**：输入 `evaluationId` + `endpointConnectionId`(A) + `baselineConnectionId?`(B) + `genConfig?`（覆盖，复用 #261）+ `gateConfig?`（passRateMin）+ `confirmToken?`。dry-run 返回计划；confirm 后走 `RunsService`，返回 `runId`，用 `get_quality_gate_run` 轮询拿门禁结果。
- 两者**完全复用现有 service**——和 REST 走同一条业务逻辑，不分叉。

## 单元边界（可独立理解 / 测试）

| 单元 | 职责 | 依赖 | 可独立测 |
|---|---|---|---|
| `ConfirmTokenService` | 签发 / 校验 dry-run confirm token | server secret | ✅ 纯函数式，签发→校验→篡改→过期 |
| `query_prometheus.tool` | PromQL 透传 + 截断 | PrometheusFetcherService | ✅ Prom stub |
| `compare_benchmarks.tool` | 多 benchmark delta | ComparisonService | ✅ 注入假 benchmark |
| `run_benchmark.tool` / `run_quality_gate.tool` | dry-run/confirm 包装 + delegate | ConfirmTokenService + 既有 create service | ✅ K8s/Runs stub |

## 测试

- **单测**：`ConfirmTokenService`（签发/校验/篡改/过期）、每工具 input schema、`query_prometheus` 截断逻辑、`compare_benchmarks` delta 计算。
- **e2e**：扩 `mcp.e2e-spec` —— `run_benchmark` 无 token→计划、带 token→创建（K8s 走现有 stub）；`run_benchmark` 篡改 token→拒绝；`query_prometheus`（Prom stub）；`MCP_ALLOW_EXECUTE=false` 时执行类工具不出现在 tools 列表。复用现有 MCP e2e harness + K8s stub + Prom stub。

## MCP 横向标准（roadmap P1）合规

每个新工具：
- [ ] input/output schema 与对应 REST 契约对齐（共用 `packages/contracts`）
- [ ] MCP README 列出工具签名 + 使用示例
- [ ] 至少在 e2e 覆盖 happy path

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| agent 无人介入误烧 GPU | dry-run + HMAC confirm token + `MCP_ALLOW_EXECUTE` 开关 |
| agent 盲查 PromQL 乱抓指标 | `get_engine_metric_catalog` 先给 per-engine 已知指标 |
| query 结果撑爆 agent context | series/点数截断 + `truncated` 标记（沿用 list_alerts 纪律） |
| dry-run 小参数偷换大参数执行 | confirm token 绑定规范化请求体，参数变即失效 |
| 执行类工具默认开放在他人 OSS 部署上 | `MCP_ALLOW_EXECUTE` 可关；README 显著说明 |

## 决策记录（已与用户确认）

- **范围**：v1 做全套（调查 + 执行）。
- **执行护栏**：dry-run + 二次确认（非"直接执行信任 agent"，非"白名单+速率上限"）。
- **轮询工具**：保留 `get_benchmark` / `get_quality_gate_run`（执行闭环必需）。
- **catalog**：独立工具。
- **confirm token**：无状态 HMAC。
