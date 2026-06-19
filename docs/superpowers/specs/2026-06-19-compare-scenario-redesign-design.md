# Compare 页场景化重构 — 设计

日期：2026-06-19
分支：`feat/compare-scenario-redesign`

## 背景与问题

Compare Benchmarks（live 页，`BenchmarkComparePage` → `ReportSections`）当前对所有
场景渲染同一套固定内容，存在 7 个问题（用户提出）：

1. 图表不随测试场景变化。lb-strategy 真正关心的 Hit Rate / Top Pod Share 只在
   保存后的 AI 报告（`FigureRenderer`）里出现，live 页未接入——尽管数据
   （`serverMetrics.prefixCache.{hitRatePct, topPodSharePct}`）与判定
   （`availableFigureRefIds`）都已存在。
2. Test matrix 的 `workload` / `duration` 两列恒为空。根因：`extractParamsSummary`
   只认字面量 key，aiperf 无 `workload`、无顶层数值 `duration`。
3. `stage` 列与 `name` 列恒等（都来自 `benchmark.name`），`stage` 为死列。名字过长
   且有公共前缀，在图例/轴重复，导致图例分页。
4. & 7. 数字格式混乱：延迟 1 位小数、error rate 显示原始 0–1 四位小数、图 tooltip
   无 formatter 吐出全精度（`9,109.121569219998`）。
5. 图太少。
6. 全用柱状图：分位序列用柱不如折线。

## 范围

**做：** live Compare 页（`ReportSections` 及其子组件、`StageBarChart`、
`row-descriptor` 格式化）。

**不做（明确排除）：**
- 保存后的 AI 报告路径（`FigureRenderer`、`apps/api .../saved-compares/metrics.ts`
  服务端 prompt 镜像）——它有独立的"报告纸"样式与自己的分位逻辑，本轮不动。
- per-pod 查询分布图（用户只点了 hit rate / top pod share，YAGNI）。
- engine-kv-cache 的 cold/warm 专属图（单独跟进）。
- 持久化改名 / 内联改名（短标签自动生成即可）。

## 设计

### A. 统一数字格式化（解决 4、7）

新建 `apps/web/src/features/benchmarks/compare/format.ts`：

- `formatLatencyMs(n: number | null): string` — `null→"—"`；`|n|≥100 → 0 位`，
  否则 `1 位`；追加 `" ms"`。例：`831 ms` / `1242 ms` / `13.2 ms`。
- `formatPercentFromFraction(n: number | null): string` — 入参 0–1，`×100`，1 位 + `%`。
  例：`0.2397 → 24.0%`，`0 → 0%`。（error rate）
- `formatPct(n: number | null): string` — 入参 0–100，1 位 + `%`。（hit rate / top pod share）
- `formatThroughput(n: number | null): string` — 1 位 + `" req/s"`。

`row-descriptor.ts`：`MetricRowSpec` 增加可选字段
`format?: "latencyMs" | "percent" | "throughput" | "pct"`。`SHARED_INFERENCE_ROWS`
中：所有 ms 行 → `format:"latencyMs"`（去掉 `unitSuffix:"ms"`，格式化函数自带单位）；
`errorRate` 行 → `format:"percent"`（删除 `digits:4`）；`throughput` 行 → `format:"throughput"`。

`MetricRow.tsx`：`fmtNum` 改为按 `descriptor.format` 分发到上述函数；无 `format` 时
回退旧的 `toFixed(digits)+suffix`（vegeta 等 raw 行）。

### B. Test matrix 列重构（解决 2、3）

- 删 `stage` 列。
- 删 `workload` / `duration` 列。
- 新增第一列**短标签**（chart 身份标签）：`shortRunLabels(names: string[])`，
  按 `" · "` 分词，剥掉所有 run 共享的公共前缀 token；若结果为空（全同）回退全名。
  放到 `format.ts` 旁的 `run-label.ts`，单测覆盖。
- 列改为场景驱动：基础 `[短标签, name, tool, scenario, concurrency]`；
  `scenario === "lb-strategy"` 追加 `Hit Rate` / `Top Pod Share`
  （读 `readPrefixCache(benchmark.serverMetrics)`，`formatPct`，无数据 `—`）。
- 短标签同时传给图表的 `series.label` / `barColors` 对应的 `stageLabel`。
  在 `BenchmarkComparePage` 构造 `reportRuns` 时，用 `shortRunLabels` 覆盖
  `stageLabel`（原 `b.name ?? Rn`）。

### C. 图表场景化 + 折线（解决 1、5、6）

`StageBarChartsSection` 改为场景驱动图集（live 专用，跟随 app 主题）：

基础图集（inference 形态场景）：

| 图 | 类型 | 单位 | 取数 |
|---|---|---|---|
| Throughput | 柱（每 run 一柱） | req/s | `requestsPerSec` |
| Error rate | 柱 | % | `errorRate × 100` |
| TTFT 分位 | 折线（x=p50/p95/p99，series=run） | ms | `ttft.p50/p95/p99` |
| ITL 分位 | 折线（p50/p95） | ms | `itl.p50/p95`（新增） |
| e2e 分位 | 折线（p50/p95/p99） | ms | `e2e.p50/p95/p99` |

lb-strategy 追加：

| 图 | 类型 | 取数 |
|---|---|---|
| Prefix-cache Hit Rate | 柱（%） | `prefixCache.hitRatePct` |
| Top Pod Share | 柱（%） | `prefixCache.topPodSharePct` |

- 分位对齐 Key metrics 表的 **p50/p95/p99**（现状图用 p90，修正）。live 页自取分位，
  不改共享的 `summarizeForPrompt`（避免污染 AI/服务端路径）。新增
  `readPercentiles(summaryMetrics, family, ps)` 助手于 `client-metrics.ts`，
  内部走 `readMetricSafe`。
- 仅当所有 run 都有 prefixCache 注解时显示 lb-strategy 两图（沿用
  `availableFigureRefIds` 同款"全有才显示"语义）。

### D. `StageBarChart` 组件改造（解决 6、4-tooltip）

- 增加 `variant?: "bar" | "line"`（默认 `"bar"`）。`"line"` 时 ECharts series
  `type:"line"`（显示 symbol，不 smooth）；现有 label/delta/baseline 逻辑复用。
- 增加 `valueFormatter?: (v:number)=>string`：用于 **tooltip**（修 bug，现状
  `tooltip:{trigger:"axis"}` 无 formatter）与柱顶/点标签，二者共用同一函数。
  调用方按图类型传入 `formatLatencyMs` / `formatPct` / `formatThroughput`。
  未传时回退现有 `fmtValue`。

### i18n

新增 key（`benchmarks.json` zh-CN + en-US）：
- `savedCompare.report.chartItlTitle`、`chartHitRateTitle`、`chartTopPodShareTitle`
- `compare.matrixCol.label`（短标签列头）、`compare.matrixCol.hitRate`、
  `compare.matrixCol.topPodShare`（其余列头 stage/name/tool/... 现为硬编码英文，
  本轮顺手抽到 `compare.matrixCol.*`）

## 测试

- 单测（vitest）：`format.test.ts`（边界：99/100、null、0、负数）、
  `run-label.test.ts`（公共前缀剥离、全同回退、单 run、无公共前缀）。
- 组件测：`StageBarChart` line variant 渲染 smoke；`StageBarChartsSection`
  lb-strategy 场景出 hit rate/top pod share 图、非 lb-strategy 不出。
- 既有 compare 相关测试需全绿。

## 风险

- `row-descriptor.ts` 在 `packages/tool-adapters`，被保存报告路径共享——改 `format`
  字段是**新增可选字段**，旧 `digits`/`unitSuffix` 回退保留，不破坏现有渲染。需
  `pnpm -r build` 后让 web 端 typecheck 看到新类型。
- 短标签覆盖 `stageLabel` 会同时改变 live 页图例文案（预期）；不影响保存报告
  （那条路径自建 `stageLabel`）。
