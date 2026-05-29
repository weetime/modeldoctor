# SavedCompare Report — Style Guide

ModelDoctor 的 SavedCompare AI Report 完全由大语言模型生成,目标是"看上去是分析师写的,不是 ChatGPT 写的"。本指南给出强制规则与正向规则,服务于 `apps/api/src/modules/saved-compares/narrative-lint.ts` 的 lint pass。规则来源: `~/vllm/repots/docs/REPORT_STYLE_GUIDE.md`,适配 ModelDoctor 数据模型。

## 1. 阻断式红线(server-side lint 不过)

LLM 输出后必须过这些检查,命中即自动重试一次,二次失败保留报告但标 `lintWarnings`。

| Code | 检测 | 反例 → 正例 |
|---|---|---|
| `decorative-emoji` | 装饰 emoji `🥇🥈🥉🔥🚀🎯💡🌟⭐❗‼️` | `🥇 首选` → `**首选**` |
| `tick-cross-in-table` | `✅` / `❌` 在 `<td>` / `\| ... \|` 表格里 | 改成"推荐"/"不建议" 文字 |
| `literal-tldr-marker` | 字面 `TL;DR(N 条)` / `TL;DR (N items)` | → `## 结论摘要` |
| `executive-summary-en-in-cn` | zh-CN 报告里出现 `Executive Summary` | → `结论摘要` |
| `bold-density` | 单段内 ≥3 处 `**...**` 或 `<strong>...</strong>` | 整段只留一个关键短语加粗 |
| `decimal-precision` | 数值带 ≥3 位小数(`+135.275%` / `12.4567 ms`) | `~+135%` 或 `+135% (N=8, σ=4.2%)` |
| `ai-filler-phrase` | `值得注意的是` / `综上所述` / `let's dive` / `it is worth noting` / `in conclusion` 在段首 | 删掉或换"另外" |
| `residual-markdown-bold` | HTML 表格 / 列表里残留未转换的 `**...**` | `<strong>...</strong>` |
| `banned-adverb` | `significantly` / `robust` / `seamlessly` / `leverage` / `unlock` / `empower` / `comprehensive` / `显著地` / `鲁棒` / `无缝` / `充分利用` / `释放` / `赋能` / `全面深入` | 用具体动作动词替换 |
| `three-word-parallelism` | `X, Y, and Z` 形式作为褒义形容(`fast, cheap, and reliable`) | 拆成两句具体陈述 |
| `llm-self-reference` | `Generated with Claude` / `🤖` / `as an AI` / `as a language model` | 删除 |
| `repo-path-in-prose` | 正文 prose 出现 `apps/api/...` / `packages/.../*.ts` / 仓库相对路径 | 用功能名称代替 |

## 2. 正向规则(prompt 强约束,lint 不阻断)

### 2.1 标题写结论,不写主题
- 弱: `## 4. 性能对比`
- 强: `## 4. par=32 高压档 vLLM 吞吐 4.52 req/s,领先 MindIE 27%`

每个章节 title 必须包含**至少一个数字**或定性结论词(领先 / 落后 / 持平 / 反超 / 拐点),不能是纯主题名。

### 2.2 第一段直接给数字
section body 的第一句必须含具体数字 + 结论方向,禁止前置"随着 / 在当下 / 我们经常听到"类铺垫。

### 2.3 段落长度故意不齐
真人写作 1 句 + 4-5 句 + 2 句交替。AI 默认是均匀 3-4 句。prompt 里明确要求长度交替。

### 2.4 数字带置信度
当一个数字是从 ≥3 个 run 算出来,附 `(N=k, σ=...%)` 或 `~` 近似号。单 run 的快照数字直写。

### 2.5 表格列 ≤6,图比表优先
- 表格 column 不超过 6
- 同一组对比优先出图(`figures[]` 引用现成 chart component)+ 3-5 数字小表,不出 12 行宽表

### 2.6 不要 LLM 痕迹
- 禁署名 "AI assisted" / "Generated with Claude"
- 禁 `🤖` / `as an AI`
- 禁内部路径 / 脚本名(报告对客户/合作方,不暴露代码组织)

## 3. 章节骨架(锁死,不可变)

LLM 输出 `sections[]` 必须严格 6 章节顺序:

```
01 结论摘要        ≤ 1 屏  3-5 条不等长结论,首段第一句给最关键数字
02 测试目的与范围   ≤ 半屏  本次对比要回答什么问题、对比了哪些 stage
03 测试方法         1-2 屏  workload / 硬件 / 工具 / 版本 / 关键参数对齐
04 关键结果         2-4 屏  每节一图 + 小表 + 1-2 段解释
05 异常与边界       ≤ 1 屏  数据可比性 / 已知缺陷 / SLO 限制
06 选型建议         ≤ 半屏  场景 → 配置 + 0-5 条 caveats
```

各章节 `id` 字段必须依次为 `summary` / `scope` / `method` / `results` / `caveats` / `advice`,顺序由 `compareNarrativeSchema` refinement 强制。

## 4. 数字必须来自输入

LLM 输出里任何 `N`、`N%`、`N ms`、`N req/s` 等数值,必须能在传给 LLM 的 input data(benchmark summaryMetrics / params)里找到来源。`narrative-lint.ts` 抽取所有数字 token,与 input 数据集做集合差,差集 → `lintWarnings`(不阻断,因为 LLM 可能算 Δ%、p95/p50 比这种衍生量)。

## 5. 图(figures[])

LLM 不出 SVG / PNG / 任何图形,只能引用以下预定义 `refId`:

| refId | 渲染组件 | 适用场景 |
|---|---|---|
| `stage-bars-throughput` | `StageBarChartsSection`(throughput) | 各 stage 吞吐对比 |
| `stage-bars-error-rate` | `StageBarChartsSection`(errorRate) | 各 stage 错误率对比 |
| `stage-bars-ttft-p95` | `StageBarChartsSection`(ttft.p95) | TTFT 长尾对比 |
| `stage-bars-e2e-p95` | `StageBarChartsSection`(e2e.p95) | E2E 长尾对比 |
| `compare-grid` | 现有 `CompareGrid` | 完整 4 指标对照表(已含 Δ pill) |

LLM 只写 `figures[].caption` —— 一句完整描述图里看到什么,带具体数字。
