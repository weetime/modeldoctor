# 场景感知的 AI 报告（Scenario-Aware AI Reports）— 设计文档

- 日期：2026-06-22
- 分支：`feat/scenario-aware-ai-reports`
- 范围：System B（SavedCompare「Generate AI report」深度报告）。**不动** System A（Insights 快速诊断）。

## 1. 问题

「Generate AI report」生成的深度报告**千篇一律**，无论跑的是 LB 策略验证、多引擎吞吐对比，还是 KV cache 冷热，骨架与图表都一样。

根因（已通过代码调查确认）三层：

1. **全场景共用一个 system prompt**（`apps/api/src/modules/saved-compares/prompts.ts`）。唯一一句场景相关的话是「prefix-cache 报告 headline 必须引用命中率变化」，其余完全通用。
2. **figure 是固定通用枚举**（`packages/contracts/src/saved-compares/compare-narrative.ts`）：7 种 `stage-bars-*` 柱状图，全场景共享。LB 报告和吞吐报告**用的是同一批柱子**——这是视觉雷同的真凶。
3. **输入数据被压平成同一形状**（`compare-synthesize.service.ts`）：只喂 per-stage 的 qps/err/ttft/e2e（+ lb 多两个字段）。没有 per-pod 分布、冷热分轮、并发曲线等场景专属数据。

对比参考项目 `/Users/fangyong/vllm/repots`：它的骨架**也是固定的**（7 段），但差异化全部落在「关键结果」段的**图 + 喂进去的指标**，由场景驱动（每场景手写 `make_charts.py`）。ModelDoctor 缺的正是「场景」这一层——而 System A 早已用 `EvaluationProfile` 实现了这层，System B 没有。

## 2. 已定决策

| 决策点 | 结论 | 理由 |
|---|---|---|
| 架构 | **A：场景 profile 化**（服务端单次 JSON 调用 + 数据驱动渲染的 figure 组件） | 产品是私有化自托管 OSS：服务端代码执行沙箱（C 路线）是安全/运维负担，与「易自托管」核心卖点冲突；报告是交付物，需确定性、一致性、品牌内交互式图表；场景是有限已知集，预建组件质量地板更高。Agent Skills（SKILL.md）是为「带文件系统+代码执行的 agent runtime」设计的，不适配服务端单次 schema 约束调用。C 路线不是错的，是早了——可作长尾逃生口后接。 |
| 选择机制 | **后端硬约束 same-scenario + same-tool；SavedCompare 持久化派生的 `scenario`/`tool`；报告 profile 纯按 `scenario` 选**；`inference` 用 benchmark 数量区分单/多引擎。**无需手动覆盖。** | 现状「同场景同工具」只是前端软约束（混选时隐藏保存按钮），后端零校验、可绕过。下沉为后端不变量 + 持久化，是 industry-standard fix，且让报告层一行读出场景。 |
| 报告骨架 | **保留固定 6 段**（summary/scope/method/results/caveats/advice） | 与 reports 项目同构（固定骨架不显雷同）；差异化靠 results 段的图 + 各段内容侧重 + prompt 故事线，而非重排骨架；不动 lint/渲染/TOC 管线，风险最低。 |
| 本期范围 | **Phase 1 + capacity sweep 曲线** | 见 §6。 |

## 3. 「skill 之神，不背 sandbox 之形」

用户最初提议「把场景做成 skills 让 AI 按 skills 生成报告」。我们采纳其**模式**（每场景 = 一个自包含、可插拔、版本化的指令+资源 bundle），但**不采用** Anthropic Agent Skills 的运行机制（SKILL.md 文件夹 + 渐进式披露 + agentic loop + 代码执行）——因为 System B 是服务端一次性 JSON API 调用，没有 agent 运行时。bundle 以服务端 TypeScript 模块形式落地（见 §4.2）。

## 4. 设计

### 4.1 选择层

**后端约束**（`apps/api/src/modules/saved-compares/saved-compares.service.ts` + contract）：

- 创建 SavedCompare 时，hydrate 所有 benchmark 后校验：全部 `scenario` 相同、全部 `tool` 相同，否则 400。
- 在 `SavedCompare` 上持久化派生字段 `scenario: ScenarioId` 与 `tool: BenchmarkTool`（Prisma migration 用 `prisma migrate dev --create-only` 生成；回填存量行用其成员 benchmark 的共同值）。
- 前端现有的「混选时隐藏保存按钮」软拦保留（更好的即时反馈），但不再是唯一防线。

**报告意图判定**（`scenario` → reportIntent）：

| `scenario` | reportIntent | 备注 |
|---|---|---|
| `lb-strategy` | LB 策略验证 | 命中率 + 流量分布 |
| `engine-kv-cache` | KV/前缀缓存冷热 | 靠 `(rerun)` 命名配对冷/热 |
| `capacity` | 容量规划 | sweep 曲线 |
| `gateway` | 网关/HTTP 层 | vegeta |
| `inference`（单 run） | 单引擎基线 | |
| `inference`（多 run） | 多引擎对比 | 用 compare 内 benchmark 数量区分 |

### 4.2 Report Scenario Profile 注册表

新目录 `apps/api/src/modules/saved-compares/report-scenarios/`，一场景一文件 + 一个 `index.ts` 注册表（对齐 System A 的 profile 模式）。

```ts
// report-scenarios/types.ts
export interface ReportScenarioProfile {
  scenario: ScenarioId;
  /** 区分 inference 单/多引擎等子意图 */
  resolveIntent?: (ctx: ScenarioContext) => string;
  /** 注入到通用 system prompt 之后的场景片段（故事线 / 主指标 / 各段侧重 / 有哪些图） */
  promptFragment: (ctx: ScenarioContext) => { zh: string; en: string };
  /** 该场景用哪些 figure、优先级、锚到哪个 section */
  figureManifest: (data: ScenarioData) => FigurePlan[];
  /** 从 benchmarks 装配场景专属数据（喂 prompt + 供 figure 渲染） */
  dataAssembly: (benchmarks: HydratedBenchmarkRef[]) => ScenarioData;
}
```

- `promptFragment`：**纯文本**，立刻让每种报告读起来就不同。收编现在 `prompts.ts` 里硬编码的 prefix-cache 特判 → 变成 lb-strategy 的 fragment。
- 通用基座（schema + 12 条 style rules）**不变**；最终 system prompt = 基座 + `promptFragment`。
- 注册表缺省项（mixed / 未知）回退到现有通用模板，保证不回归。

### 4.3 Figure 体系扩展

所有 figure 仍是 **React 组件 + refId，数据驱动渲染，服务端不出图**（保持确定性、可缓存、品牌内交互式）。新增 `FigureRefId` 到 `compare-narrative.ts` 枚举，对应组件加进 `FigureRenderer.tsx`。

**Phase 1 新增（现有数据即可画）：**

| refId | 场景 | 数据来源 | 说明 |
|---|---|---|---|
| `pod-traffic-distribution` | lb-strategy | `serverMetrics.prefixCache.perPod[].queries` | 每 pod 流量占比，看集中度 |
| `pod-hit-rate` | lb-strategy | `perPod[].hits / .queries` | 每 pod 命中率 |
| `latency-distribution` | inference / gateway | `rawOutput.files`（guidellm/vegeta，经 `benchmark-charts.service.ts` 解析） | CDF / 直方图 |
| `cold-warm-delta` | engine-kv-cache | `(rerun)` 配对的两行 summaryMetrics | 冷热 Δ% |

**Phase 1 + 本期追加（需补数据管线）：**

| refId | 场景 | 工作 |
|---|---|---|
| `throughput-vs-concurrency` | capacity | 解析 `rawOutput.files.report` 的 guidellm sweep → 新增 `summaryMetrics.capacityCurve[]`（`mapGuidellmRawToReport` 扩展）→ 前端折线图 |

**明确推迟到 Phase 2（不在本期）：**

- lb 的 `traffic-topology`（路由拓扑/sticky 验证）——需 request→pod 路由日志，现无。
- lb 的 `hit-rate-timeseries`——需定时快照，现只存单点。
- evalscope/aiperf 样本级直方图——需持久化原始样本。
- aiperf 的 KV cache 字段缺失。

> 按 [[feedback_temp_followups]]：以上每项在对应 GitHub issue 留 follow-up 评论。

### 4.4 Prompt 装配流

`compare-synthesize.service.ts`：

1. 读 `SavedCompare.scenario` → 取对应 `ReportScenarioProfile`（无则回退通用）。
2. `dataAssembly(benchmarks)` → `ScenarioData`。
3. system prompt = 基座 + `promptFragment(ctx)`。
4. user prompt 现有 per-stage 数据 + `ScenarioData` 衍生的场景专属段（如 per-pod 分布表、冷热配对、capacityCurve 摘要）。
5. `figureManifest(data)` 决定**实际可用的 figure refIds** 注入 prompt（替代现在的固定 `availableFigureRefIds()`）。
6. lint + 一次重试 **不变**。

## 5. 数据可用性总览（调查结论）

| 场景 | 现成可画 | 需补数据 |
|---|---|---|
| lb-strategy | per-pod 流量分布、per-pod 命中率、全局命中率 KPI、top-pod-share | 路由拓扑/粘性、命中率时序 |
| inference | 百分位柱、CDF/直方图(guidellm/vegeta)、吞吐 KPI | evalscope/aiperf 样本分布 |
| gateway | 吞吐/时延 KPI、CDF、状态码分布 | 无 |
| engine-kv-cache | 冷/热对比(evalscope+guidellm) | aiperf 缓存字段、样本直方图 |
| capacity | 仅最终百分位 | **吞吐 vs 并发曲线**（sweep 在 MinIO，本期解析入库） |

## 6. 范围

**本期（Phase 1 + capacity 曲线）：**

1. 选择层：后端约束 same-scenario+same-tool + `SavedCompare.scenario/tool` 持久化（含 migration + 存量回填）。
2. Report Scenario Profile 注册表骨架 + types。
3. **全 5 场景的 `promptFragment`**（zh/en）。
4. Phase 1 figure 组件 + refId：`pod-traffic-distribution`、`pod-hit-rate`、`latency-distribution`、`cold-warm-delta`。
5. lb-strategy / engine-kv-cache 的 `dataAssembly`。
6. **capacity sweep 解析**：`summaryMetrics.capacityCurve[]` + `throughput-vs-concurrency` figure。
7. `compare-synthesize.service.ts` 接入 profile（system prompt 注入 + figureManifest 驱动可用 figure）。
8. 测试：后端约束的 e2e、各 profile 的 figureManifest/promptFragment 单测、capacity 解析单测。

**非本期（Phase 2，单独立项 + issue follow-up）：** lb 路由拓扑、lb 命中率时序、evalscope/aiperf 样本直方图、aiperf KV 字段。

## 7. 不变量 / 不回归

- System A（Insights）完全不动。
- 通用 schema + 12 条 style rules + lint/retry 管线不动。
- 6 段骨架与编号不动。
- 未知/混合场景回退现有通用模板，老报告不回归。
- 所有新 figure 数据驱动、服务端不执行代码。

## 8. 风险

| 风险 | 缓解 |
|---|---|
| 存量 SavedCompare 回填 scenario/tool 时遇到历史混合数据 | 回填脚本对混合行标 `mixed`，报告回退通用模板，不报错 |
| capacity sweep JSON 结构跨 guidellm 版本变化 | 解析做防御性校验，缺字段则降级为「仅最终百分位」（现状），不 throw |
| 新 figure 在某 benchmark 缺对应数据 | `figureManifest` 按 `dataAssembly` 实际产出动态裁剪，缺数据则不列该 figure |
| Prisma migration | 用 `prisma migrate dev --create-only`，不手写 SQL（[[feedback_prisma_migrations]]）；built-in 数据走 seed.ts（[[feedback_prisma_seed_for_builtins]]） |

## 9. 关键文件（落点）

- `apps/api/src/modules/saved-compares/saved-compares.service.ts` — 后端约束
- `apps/api/prisma/schema.prisma` + migration — `SavedCompare.scenario/tool`、`summaryMetrics.capacityCurve`
- `apps/api/src/modules/saved-compares/report-scenarios/**` — 新注册表（一场景一文件）
- `apps/api/src/modules/saved-compares/prompts.ts` — 基座保留，特判收编
- `apps/api/src/modules/saved-compares/compare-synthesize.service.ts` — 接入 profile
- `packages/contracts/src/saved-compares/compare-narrative.ts` — 新 FigureRefId
- `packages/tool-adapters/src/guidellm/runtime.ts` — sweep 解析
- `apps/web/src/features/benchmarks/compare/FigureRenderer.tsx` + 新图组件
</content>
</invoke>
