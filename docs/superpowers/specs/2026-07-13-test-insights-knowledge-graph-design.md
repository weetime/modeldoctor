# Test Insights 重构 — 覆盖矩阵 + 象限散点 +(Map 图谱)设计文档

- 日期:2026-07-13
- 分支:`feat/test-insights-matrix`(建议)
- 关联:替代 `2026-05-06-endpoint-reports-design.md`、`2026-05-07-test-insights-redesign-design.md`;详情页沿用 `2026-05-07-test-insights-detail-design.md` 不变
- 现状入口:`apps/web/src/features/benchmarks/EndpointReportsPage.tsx`(卡片网格,退休)

## 1. 目标与定位

把 **Test Insights** 从"一个 Connection 一张卡片"的平铺网格,重构成一个**有决策价值**的分析面:

1. **覆盖/健康矩阵**(落地)——行=endpoint,列=当前聚合维度成员;一眼看出**谁在哪些维度跑过、健康度如何、哪里是覆盖缺口**。
2. **象限/前沿散点**(点列头下钻)——"某个场景/维度下,选哪个 endpoint 最优":X=评分、Y=速度/成本、Pareto 前沿 + 推荐区间分带。
3. **详情**(点格子/行/散点下钻)——`/insights/:connectionId`,**现有洞察详情页完全不变**。
4. **Map 视图**(可选 toggle)——力导向二部图,探索/传播用,不承载核心决策。

### 为什么翻转成"矩阵/散点为主、图谱降级"(而非力导向图谱为主)

调研三条硬证据(2026-07-13):

- **选型的业内标准是散点,不是图谱**:Artificial Analysis / WhatLLM / BenchLM 等主流 LLM 选型平台,一律用"质量 vs 速度/价格散点 + Pareto 前沿 + 象限"回答"选谁"。Artificial Analysis 的 Intelligence Index 甚至直接含 τ³-Banking(=我们 agent 场景同类)。→ 验证散点层,且应做成**二维象限**。
- **节点>20 时矩阵在几乎所有任务上打败节点-链接图**,力导向图只在"找路径"占优(Ghoniem/Fekete, IEEE InfoVis 2004/2005)。我们 ~15 endpoint × 6 scenario ≈ 21 节点且高连通 → 力导向必糊;且任务是"分组/比较/找缺口"非"找路径" → 矩阵才对。
- **Grafana/Datadog 的 service map 只用于真实调用拓扑(A 调 B,来自 trace),且永远配 RED 指标表**。我们的边是"跑过测试"=成员关系,不是调用依赖 → 力导向承载不了它暗示的语义重量。

结论:矩阵 = 二部图的邻接矩阵,信息不丢、不糊、可比、可下钻;力导向图谱保留为可选 Map 视图,兼顾美学/传播。

## 2. 现状(重构起点)

- 列表页:`apps/web/src/features/benchmarks/EndpointReportsPage.tsx`,数据来自 `GET /api/benchmarks/reports/by-connection?range=`(`benchmark.controller.ts:74`、`benchmark.service.ts:426 getByConnectionReports`)。每项:`connection{id,name,model,baseUrl,category}` + `totalRuns` + `statusCounts` + `successRate` + `p95Latency{first,last}` + `latestRun`。契约:`packages/contracts/src/benchmark.ts:171-219`。
- 详情页:`apps/web/src/features/insights/InsightsDetailPage.tsx`,`/insights/:connectionId`。**评分逻辑埋在这里(前端、逐 connection)**:`buildFindings`(profile.rules)、composite 分 + 分场景子分(当前仅 `inference/capacity/gateway`)、6 轴雷达、`ScenarioPanel`、`AiDiagnosisCard`。
- 评分规则源:`EvaluationProfile.rules`(`schema.prisma:326`),API `GET /api/insights/profiles`。
- 数据模型(权威枚举在契约,prisma 注释过期):
  - `scenario` ∈ `[inference, capacity, gateway, lb-strategy, engine-kv-cache, agent]`(`benchmark.ts:7`)
  - `tool` ∈ `[guidellm, vegeta, evalscope, aiperf, tau3]`(`benchmark.ts:17`)——压测/评测工具,**非**引擎
  - `Connection.serverKind` = 引擎(sglang/vllm/mindie…);`Connection.category` ∈ `[chat,audio,embeddings,rerank,image]`
  - `BenchmarkTemplate`:`name/scenario/tool/categories`;`Benchmark.templateId` FK

## 3. 架构

### 3.1 抽出共享评分模块(核心)

现在评分只在前端、逐 connection。要给全部 endpoint × 维度成员批量算分,**把评分逻辑抽成共享模块**,API 与 web 共用:

- 新增 `packages/insights-scoring/`(或落在现有 `packages/contracts` 的姊妹包,按 monorepo 惯例;若放 contracts 会引入运行逻辑,倾向独立包)。导出纯函数:
  - `scoreScenario(runs, profileRules, scenario) -> { score: 0-100|null, band: 'recommended'|'usable'|'not-recommended'|null, nativeMetric: {label, value, unit} | null }`
  - `bandFromScore(score, thresholds)`、阈值来自 `profile.rules`。
- 从 `InsightsDetailPage`(及其依赖 `buildFindings`/composite 逻辑)抽出对应实现,详情页改为 import 该包 —— **详情页 UI/行为不变,只换实现来源**,消灭前后端评分双份。
- native 指标按场景取:inference/capacity → p95 ms(或 tok/s);agent → pass^1 %(tau3,来自 `summaryMetrics`);未定义场景 → null。

### 3.2 新 API:matrix

`GET /api/insights/matrix?aggregate=scenario|tool|engine&range=7d|30d|90d&profile=<slug>`
(controller/service 落 `apps/api/src/modules/insights/`,scoped to `user.sub`)

响应契约(`packages/contracts/src/insights.ts` 新增):
```ts
{
  aggregate: 'scenario'|'tool'|'engine',
  range, generatedAt,
  dimensions: { key: string, label: string, count: number }[],   // 列
  endpoints: { id, name, model, baseUrl, category, serverKind }[], // 行
  cells: {
    endpointId, dimKey,
    runs: number,
    score: number|null,        // 0-100,null=未评分(灰格)
    band: 'recommended'|'usable'|'not-recommended'|null,
    nativeMetric: { label, value, unit }|null,
  }[]
}
```
服务端:按 range 拉 benchmark(复用 `getByConnectionReports` 的取数骨架),按 `aggregate` 维度 groupBy(scenario / tool / serverKind),对每个 (endpoint × dimKey) 分组调用共享 `scoreScenario`。

### 3.3 前端页面

- 新页 `apps/web/src/features/insights/InsightsMatrixPage.tsx`。路由:`benchmarks/reports` 重定向到新入口,`EndpointReportsPage` **删除退休**;侧栏 "Test Insights" 指向新页。
- 顶栏:聚合 Tab(`场景`默认 / `工具` / `引擎`;`模板`=follow-up)+ 搜索(name/model)+ category + range + **profile(驱动评分,不再空转)**。全部走 URL search-params(沿用现有模式)。
- **矩阵**:行=endpoint(首列 `<Link>` 到 `/insights/:id`,遵循列表页行动惯例),列=`dimensions`。格子=`score` 着色(红→黄→绿,`null`=灰"未评分")+ 角标 `runs`;空(无 cell)=覆盖缺口留白。悬停出 native 指标 + band。点列头 → 散点面板。
- **象限散点**(点列头,右侧滑出面板 / 同页切换):该 dimKey 下每个 endpoint 一个点,**X=score**(三色推荐带:recommended/usable/not-recommended,阈值来自 profile)、**Y=native 速度/成本指标**(如 p95 ms;缺失则退化为 1D 抖动带)。画 Pareto 前沿高亮"最优选"。悬停小卡→点击进 `/insights/:id`。用现有图表栈手绘 SVG。
- **Map toggle**:力导向二部图,`react-force-graph-2d`(OSS,canvas 可定制,符合"优先用库不自造"偏好)。中心=维度节点,外围=endpoint 节点(色=score、径=runs),边=cell(宽∝runs)。复刻 graph-tour 的图例/信息卡交互。点 endpoint→详情页。

## 4. 范围与分期

**v1(本 spec)**:
- 共享评分模块抽取 + 详情页切换到它(行为不变)
- matrix API(`aggregate=scenario|tool|engine`)+ 契约
- InsightsMatrixPage:矩阵 + 象限散点 + Map 视图;`EndpointReportsPage` 退休
- 评分覆盖现有 `inference/capacity/gateway`;`agent/lb-strategy/engine-kv-cache` 格子显示 **native 指标 + 灰"未评分"**(不阻塞)

**紧邻 follow-up(不阻塞 v1,按惯例在对应 issue 留 inline 注释)**:
- `agent` 场景评分规则扩展(pass^k → 0-100 + 推荐带)——这样 agent 列/散点才有分带
- `aggregate=template` 维度
- `lb-strategy` / `engine-kv-cache` 评分规则

## 5. 边界与非目标

- 详情页 `/insights/:connectionId` **不改**(评分实现换成共享包,UI 不动)。
- 不做实时;沿用 range 窗口(7/30/90d)+ profile 驱动。
- 只覆盖 range 内有 run 的 endpoint。
- Map 视图明确是"探索/传播"辅助,不做主分析路径;节点多时以矩阵为准。

## 6. 测试

- 共享评分模块:纯函数单测(各场景 runs → score/band/nativeMetric;profile 阈值边界;null 分支)。
- matrix service:给定 benchmark fixture,验证 groupBy 各 aggregate 的 cells 数量/score/覆盖缺口。
- 契约:zod schema 往返。
- 前端:矩阵渲染(缺口留白、灰格)、列头点击→散点、行/格→详情路由;Pareto 前沿计算单测。
- 回归:详情页切换共享评分包后,score/雷达/findings 与旧实现一致(快照对照)。

## 7. 代码落点小结

- `packages/insights-scoring/`(新)—— 共享评分纯函数
- `packages/contracts/src/insights.ts` —— matrix 响应 schema
- `apps/api/src/modules/insights/` —— matrix controller/service
- `apps/web/src/features/insights/InsightsMatrixPage.tsx`(新)+ queries + 矩阵/散点/Map 组件;`InsightsDetailPage` 改 import 共享包
- `apps/web/src/features/benchmarks/EndpointReportsPage.tsx` —— 删除;路由/侧栏改指新页
- i18n:`locales/*/insights.json` 增矩阵/散点/Map 文案;`sidebar.json` "Test Insights" 指向不变
