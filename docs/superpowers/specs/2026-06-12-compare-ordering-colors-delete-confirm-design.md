# Compare 顺序 + 任务颜色一致 + 删除输入 DELETE 确认 — 设计

日期:2026-06-12 · 状态:已获用户批准(对话中逐项确认)

## 背景 / 问题

1. **对比顺序乱**:列表页勾选后 `?ids=` 按点选顺序(`Set` 插入序)拼接,compare 页所有
   表格/图表按此渲染,视觉上随机。
2. **颜色无身份**:4 张图为「X 轴 = 任务,系列 = 指标」,QPS 全蓝、Error 全红、
   TTFT/e2e 按 p50/p90/p99 着色——同一任务(如"路由粘性 t2 · L1-ON-clean · c20")
   在不同图中没有统一颜色。
3. **删除确认太轻**:全站 ~12 处删除仅一键 AlertDialog 确认(Playground 历史删除甚至无确认)。

## 决策(用户已选)

| 议题 | 决策 |
|---|---|
| 排序交互 | 拖拽排序(Test matrix 行手柄)+ 进入 compare 时默认按 name 自然排序 |
| 图表画法 | 接受转置:TTFT/e2e 改为「X 轴 = p50/p90/p99,系列 = 任务」;四图共用 runId→颜色映射 |
| 删除加锁 | 全站统一输入固定词 `DELETE`(大小写不敏感、trim)后才可确认 |

## 设计

### A. 顺序源 = URL `ids`

- `BenchmarkListShell` 点「对比」时,把勾选 ids 按 name `localeCompare("zh-Hans-CN",
  { numeric: true })` 排序后拼 URL。
- `BenchmarkComparePage` 维持「`ids` 顺序即渲染顺序」(useQueries 已按 ids 序返回)。
- `ReportSections` Test matrix 行加拖拽手柄(`@dnd-kit/core` + `@dnd-kit/sortable`,
  `verticalListSortingStrategy`);拖完调用 `onReorder(newIds)`(可选 prop,仅
  BenchmarkComparePage 传入)→ `setSearchParams` 写回 `ids`(保留 `baseline` 参数)。
- 保存对比:`SaveCompareDialog` 已按 `runs` 当前顺序提交 `benchmarkIds`,顺序自然持久化;
  已保存报告/导出按存储顺序渲染,不需改动。

### B. runId → 颜色映射

- 复用 `assignRunColors(orderedRunIds, palette)`(`components/charts/_shared.tsx`)。
- **App 内 compare 页**(`StageBarChartsSection`):`useChartTokens().palette`(随主题)。
- **AI 报告**(`FigureRenderer`):新增固定浅色 `REPORT_PALETTE`(报告纸面恒为浅色)。
- 图表改动(`StageBarChart`):
  - 新 prop `barColors?: readonly (string | undefined)[]`——单系列图(QPS/Error)
    per-datum 着色,索引对齐 `data`。
  - 新 prop `baselineSeriesKey?: string`——转置图中 baseline 是一个系列:非 baseline
    系列在同一 X 类目下对 baseline 系列值算 ↑/↓ 增量;baseline 系列标 `baseline`。
    与现有 `baselineIndex`(X 位置型 baseline)互斥,二者择一传入。
- `StageBarChartsSection` / `FigureRenderer` 的 TTFT、e2e 图转置:
  `data = [{stage:"p50", [runId]: v}, ...]`,`series = runs.map(r => ({key: r.id,
  label: r.stageLabel, color: colorMap[r.id], ...}))`;图例显示任务名(已有 scroll 图例)。
- 重排后颜色按新顺序重新分配(位置 1 = palette[0]):任意时刻四图一致,同 URL 颜色确定。

### C. ConfirmDeleteDialog

- 新组件 `apps/web/src/components/common/confirm-delete-dialog.tsx`,基于现有 AlertDialog:
  - props:`open/onOpenChange/title/description/onConfirm/pending?/confirmLabel?`。
  - 输入框 + 提示「输入 DELETE 以确认」;`value.trim().toUpperCase() === "DELETE"`
    才启用确认键(destructive 样式);打开/关闭时清空输入;`pending` 时禁用。
- i18n:`common:deleteConfirm.{hint,placeholder}`;标题/正文沿用各处现有 key,经 props 传入。
- 替换 12 处删除语义确认:Connections、Benchmarks 列表/详情、Templates(DeleteTemplateDialog)、
  SavedCompares 列表/详情、Evaluations、Runs、Datasources、通知渠道、Playground 历史
  (原先无确认,新增)、Settings 清空测试数据。
- **不动**:BenchmarkDetailPage「取消基线」确认、HistoryDrawer「恢复」确认(非删除语义)。

## 范围外

- 颜色跨重排持久(按 id 哈希固定色)——不做,按序分配已满足跨图一致。
- exportHtml 对 canvas 的序列化缺陷——既有限制,与本次无关。
