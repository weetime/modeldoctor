# Benchmark Compare 收敛重构设计

- 日期:2026-06-03
- 状态:已批准方向,待 spec review
- 分支:`feat/compare-consolidation`
- 相关:`2026-05-12-saved-compares-ai-report-design.md`(本功能首版)、`2026-05-07-multi-palette-theme-design.md`(多调色板主题)

## 背景与问题

当前同一个"对比"对象散落在 4 条路由 / 3 个视图上:

| 路由 | 组件 | 职责 |
|---|---|---|
| `/benchmarks/compare?ids=` | `BenchmarkComparePage` | 临时对比:矩阵表 + 指标网格 + 柱状图,无 AI |
| `/benchmarks/compare/saved` | `SavedComparesListPage` | 已保存对比列表 |
| `/benchmarks/compare/saved/:id` | `SavedCompareDetailPage` | **又一遍原始数据** + "生成报告"按钮 |
| `/reports/:id` | `ReportPage` | 全屏 AI 叙述报告 + 打印 |

问题:

1. **冗余视图** —— 原始数据(`ReportSections`)在临时对比页和已保存详情页渲染了两遍。
2. **多余的中间层** —— `SavedCompareDetailPage` 既不是探索工作台也不是成品报告,只是个"看一眼数据 + 点按钮去生成"的中转站。
3. **流程过长** —— 从"想对比"到"拿到报告"要 5 跳:临时对比 → 弹窗保存 → 落详情页 → 点生成 → 跳报告页。

## 目标

收敛为 **2 个内容页 + 1 个列表索引**,删除中间层,AI 解读 inline 化:

- **对比页**(唯一工作台,临时态与已保存态共用一个组件):原始数据永远在 + AI 解读作为可选层叠在上面。
- **报告页**(`/reports/:id`):全屏、浅色、可打印的成品呈现态,对外/分享用。
- **列表**(`/benchmarks/compare/saved`):保留为索引,翻历史保存的对比。

设计依据:对标 W&B(Workspace 随手比 run → 一键沉淀为 Report)、Grafana(Dashboard → Snapshot)。两层结构是行业标准,要砍的是多余的第三层。

## 非目标(YAGNI)

- 不改 `SavedCompare` 后端模型 / `synthesize` 接口 / contracts。
- 不做数据迁移 —— 当前为开发阶段,无历史 reports、未对外分享,现有 `saved_compares` 数据可直接清空。
- 不新增打印/PDF 能力(`ReportPage` 现有 Primer print CSS 保留即可,不扩展)。
- 不做深色版报告主题(见下)。

## 设计

### 页面 1 ·对比页 `/benchmarks/compare`

升级现有 `BenchmarkComparePage`,**吸收 `SavedCompareDetailPage` 的全部职责**。同一组件支持两种来源:

- **临时态**:`/benchmarks/compare?ids=run1,run2`,从 `benchmarkApi.get` 逐个水合(现状)。
- **已保存态**:`/benchmarks/compare/saved/:id`,走 `useSavedCompare(id)` 水合(原详情页逻辑)。

URL 方案:**保留 `/benchmarks/compare/saved/:id`** 表示已保存态(语义清楚、列表链接不用改、可分享)。

自上而下布局:

1. **工具栏** —— 基线选择(`CompareToolbar`);右侧主操作:
   - 临时态:主按钮「生成 AI 解读」(= 保存 + synthesize,见下),次要项「仅保存」。
   - 已保存态:管理操作(重命名 / 改分类 / 导出 / 删除);AI 区有「重新生成」「打开打印态」。
2. **AI 解读层(可选,叠在数据上面)** —— 未生成时为生成入口;已生成时 `narrative` 的摘要卡 + 6 段 inline 渲染在此(浅色"纸",见主题决策),带「重新生成」「打开打印态(`/reports/:id`)」。
3. **原始数据(永远在、免费、即时)** —— `ReportSections`(测试矩阵 + 指标网格 + 柱状图)原样复用。

### 关键衔接:临时态「生成 AI 解读」

后端 `synthesize` 挂在已保存对比上,**生成 AI 必须先有保存记录**。所以临时态点「生成 AI 解读」时:

```
弹 SaveCompareDialog 收元数据(name / stageLabels / context / classification / clientName)
  → POST /api/saved-compares
  → POST /api/saved-compares/:id/synthesize
  → 切到已保存态 URL,narrative inline 长在当前页(下面就是原始数据)
```

兑现"选多个 benchmark 直接出 AI 报告"的诉求,但落点是带原始数据的同一页,而非新目的地。

### 页面 2 ·报告页 `/reports/:id`

`ReportPage` 基本不动:全屏、无 AppShell、浅色、可打印的成品呈现态。唯一入口 = 对比页 AI 层的「打开/打印」。

### 列表 `/benchmarks/compare/saved`

`SavedComparesListPage` 保留为索引。点行 → 进对比页已保存态。

### 主题决策:Narrative 锁定浅色(paper-on-canvas)

- **应用外壳 + 原始数据(表格/图表)跟随多调色板主题**(深色照常)。
- **AI narrative 永远渲染成浅色"纸"**,无论 inline 在对比页还是全屏在 `/reports/:id`。深色画布 + 白色纸张是成熟模式(PDF 阅读器 / 打印预览)。
- 全站只有**一个 narrative 渲染器、只有浅色一种**,不做深色叙述皮。

依据:可打印 / 对外交付的报告业内一律浅色(W&B Reports、Grafana snapshot、Datadog notebook、Stripe 发票);打印本就强制白底,做深色屏显版印出来还是白的,纯属重复 + 困惑。

实现要点:`SavedCompareReport`(及其 figure 渲染)在被对比页 inline 引用时,用一个固定浅色 token 作用域包裹("paper" wrapper),不继承当前调色板的深色变量;`/reports/:id` 已在 AppShell 外、已是浅色,无需改。

## 删除 / 改动清单

- **删** `SavedCompareDetailPage.tsx`,职责并入 `BenchmarkComparePage`。
- 路由 `/benchmarks/compare/saved/:id` 指向升级后的对比页;移除对 `SavedCompareDetailPage` 的引用。
- 原始数据视图不再渲染两遍(`ReportSections` 仅在对比页一处)。
- 临时态「仅保存」成功后**留在对比页**(切到已保存态 URL),不再强制跳转到独立详情页。
- `SavedCompareReport` 增加浅色"纸" wrapper,供对比页 inline 复用。

## 数据

开发阶段,无历史 reports、未对外分享。现有 `saved_compares` 行可直接清空(用户已确认)。**预期无 Prisma schema 变更**,因此无需 migration、无需 DB reset。

## 实施(单 PR,phase-per-commit)

1. **对比页吸收已保存态** —— `BenchmarkComparePage` 增加 `saved/:id` 分支(`useSavedCompare` 水合),搬入 AI 解读面板 + 管理操作。
2. **narrative inline + 浅色 paper wrapper** —— `SavedCompareReport` 浅色作用域;对比页 AI 层渲染摘要 + 6 段 + 「打开打印态」。
3. **临时态「生成 AI 解读」衔接** —— 主按钮串起 save + synthesize,落回已保存态。
4. **删中间层 + 路由清理** —— 删 `SavedCompareDetailPage`,改路由,清列表页 / `ReportPage` 入口链接。

## 测试

- 更新 `e2e/saved-compares.spec.ts`:覆盖 临时对比 →「生成 AI 解读」→ inline narrative →「打开打印态」→ 列表 → 回到已保存态 的新链路;移除对独立详情页的断言。
- 验证深色主题下:对比页外壳/表格为深色,inline narrative 为浅色"纸"。

## 待确认 / 风险

- 已解决:URL 保留 `/saved/:id`;报告未对外分享,打印态不扩展;narrative 锁浅色;现有数据可清空。
- 风险:`SavedCompareReport` 的样式此前可能依赖 `ReportPage` 的全屏/浅色上下文;inline 复用时需确认 figure / Primer 样式在受限容器内不串色、不溢出。
