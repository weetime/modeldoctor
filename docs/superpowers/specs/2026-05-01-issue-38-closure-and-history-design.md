> **Status: ✅ Completed · historical record.** 本文是提交时的设计/计划快照；其中字段名、目录路径、env 名、API 路由为当时状态，重构后已演进。**当前实现请以代码与 `CLAUDE.md` 为准；本文正文不再修改，仅作归档。**

# Issue #38 收尾 + #39 /history 列表与详情页 — 设计文档

**Date**: 2026-05-01
**Branch**: `feat/history-page`
**Closes**: #38, #39
**Related**: #46 (报告页, 后续依赖), #54 (POST /runs, 接走 #38 推迟项), #60 (Prometheus, 消费 Connection 新字段)

---

## 1. 背景与目标

PR #61（`feat/run-model`，已合并）把 issue #38 的"统一 Run 模型"主体落地了：`Run` 表（`kind` + `tool / scenario / mode / driverKind` 四元组）、`Connection` shell 表、`Baseline` shell 表、`/benchmarks` `/load-test` `/e2e-test` 三个 service 内部全切到 `RunRepository`、对外 HTTP 契约不变。

但 issue #38 仍 OPEN，因为验收清单还差两项：

1. `Connection` 加 `prometheusUrl?` / `serverKind?` 字段（为 #60 Prometheus 集成预留）
2. `POST /runs`（按 `tool` 路由到 adapter + driver）

issue #39（/history）要求把当前的 ComingSoon 占位路由点亮成跨工具的 Run 历史视图。

本 sprint 把这两件事合并：

- **完成 #38 的 Connection 字段补全**（schema + contract，前端不暴露）
- **把 `POST /runs` 移交 #54**（理由：要等 #53 Tool Adapter，提前实现是过渡代码；issue #38 描述同步调整）
- **实现 #39 的列表页 + kind-aware 薄壳详情页**（消费现有 `GET /runs` + `GET /runs/:id`）

收尾后两个 issue 同时 close。

## 2. 非目标

- POST /runs 的实现（→ #54）
- Connection UI 暴露 `prometheusUrl` / `serverKind`（→ #60 时随 Prometheus 集成做）
- baseline 筛选（→ #43，本次 listRunsQuerySchema 不加该字段）
- /history 详情页的 cancel / delete 按钮（仍走 `/benchmarks/:id`）
- /regression 路由实现（→ #46，本次只放 disabled 占位按钮）
- 报告页可视化（latency CDF、TTFT 直方图等图表）→ #41 + #46
- sidebar 重排或重命名（→ #51）
- 测试覆盖率扩展（→ #50）

## 3. 改动范围

无新模块、无新 endpoint。三处微改：

| 层 | 文件 | 改动 |
|----|------|------|
| Prisma | `apps/api/prisma/schema.prisma` | `Connection` 加 2 字段 + 新迁移 |
| Contract | `packages/contracts/src/connection.ts` | Connection Zod schema 加 2 字段 |
| Contract | `packages/contracts/src/run.ts` | `listRunsQuerySchema` 加 `createdAfter` / `createdBefore` |
| API | `apps/api/src/modules/connection/connection.service.ts` | `create` / `update` / DTO 透传新字段 |
| API | `apps/api/src/modules/run/run.repository.ts` | `ListRunsInput` + `where.createdAt` |
| Web | `apps/web/src/features/history/` | 新 feature 文件夹（List + Detail + queries + i18n） |
| Web | `apps/web/src/router/index.tsx` | `/history` 和 `/history/:runId` 切到真组件 |

## 4. Schema 变更

### 4.1 Connection 加字段

```prisma
model Connection {
  // ...existing fields...
  prometheusUrl String? @map("prometheus_url")
  serverKind    String? @map("server_kind")  // 'vllm' | 'sglang' | 'tgi' | 'higress' | 'generic'
  // ...rest...
}
```

- 都 nullable —— 不破坏 #65 落地的现有 connections 行
- `serverKind` 用 string + Zod 端 enum 卡死 5 个值（issue #38 / #60 明列）
- 一次 prisma migration：`<timestamp>_connection_prometheus_fields`
- 没有 unique 约束、不加索引（这两字段不参与查询，只是 #60 来读）

### 4.2 Connection Zod schema 扩展

`packages/contracts/src/connection.ts`：

```ts
export const serverKindSchema = z.enum(['vllm', 'sglang', 'tgi', 'higress', 'generic']);
export type ServerKind = z.infer<typeof serverKindSchema>;

// 在 connectionSchema 里加：
prometheusUrl: z.string().url().nullable(),
serverKind:    serverKindSchema.nullable(),
```

`createConnectionRequestSchema` / `updateConnectionRequestSchema` 也加这两字段（optional，nullable）。

`ConnectionService.create` / `update` 透传；`toConnectionDto` 暴露。

### 4.3 listRunsQuerySchema 扩展

`packages/contracts/src/run.ts`：

```ts
createdAfter:  z.string().datetime().optional(),
createdBefore: z.string().datetime().optional(),
```

`RunRepository.list` 中增加：

```ts
if (input.createdAfter || input.createdBefore) {
  where.createdAt = {
    ...(input.createdAfter && { gte: new Date(input.createdAfter) }),
    ...(input.createdBefore && { lte: new Date(input.createdBefore) }),
  };
}
```

## 5. UI：`/history`

### 5.1 路由

```ts
// router/index.tsx
{ path: 'history',           element: <HistoryListPage /> },
{ path: 'history/:runId',    element: <HistoryDetailPage /> },
```

替换原有 `<ComingSoonRoute icon={HistoryIcon} itemKey="history" />`。sidebar i18n key (`items.history`) 不动。

### 5.2 文件结构

```
apps/web/src/features/history/
├── api.ts                         // GET /runs, GET /runs/:id 包装
├── queries.ts                     // useRunsList(query), useRunDetail(id)
├── HistoryListPage.tsx
├── HistoryDetailPage.tsx
├── HistoryFilters.tsx             // kind/tool/status/connection chip + 时间范围 + search
├── HistoryRowActions.tsx          // 行内 link 到详情
├── HistoryDetailMetadata.tsx      // 详情页元数据 block
├── HistoryDetailMetrics.tsx       // 详情页 summaryMetrics kv 表
├── HistoryDetailRawOutput.tsx     // 详情页 rawOutput 折叠 JSON
└── __tests__/
    ├── HistoryListPage.test.tsx
    └── HistoryDetailPage.test.tsx

apps/web/src/locales/{zh-CN,en-US}/history.json
```

### 5.3 列表页 `HistoryListPage`

**布局（自上而下）**

1. `<PageHeader title={t('history.title')} subtitle={t('history.subtitle')} />`
2. `<HistoryFilters />`：水平排列
   - `kind` 多选 chip（`benchmark` / `e2e`）
   - `tool` 多选 chip（`guidellm` / `genai-perf` / `vegeta` / `e2e` / `custom`）
   - `status` 多选 chip（6 状态）
   - `connection` select（懒加载 connections list）
   - 时间范围：两个 datetime input（`createdAfter` / `createdBefore`）
   - search 输入框（debounce 300ms）
   - 右侧"对比"按钮：选 ≥ 2 行点亮但 disabled，tooltip i18n key `history.compareDisabledTooltip` = "#46 报告页上线后启用"
3. shadcn `<Table>`
   - 列：复选框 / `createdAt` / kind badge / tool badge / connection 名 / status badge / `summaryMetrics.latency.p95` / `summaryMetrics.errorRate` / 跳转链接
   - 行点击 = `<Link to={/history/${run.id}}>`
   - p95 / errorRate 用宽容读取（`(summaryMetrics as any)?.latency?.p95 ?? null`），缺失显示 "—"
4. 底部分页：cursor 模式，"加载更多"按钮（与 BenchmarkListPage 一致）

**状态管理**

- 筛选状态走 URL query（`useSearchParams`），刷新可恢复
- 多选 row 状态走组件本地 state（不入 URL）
- `useRunsList(query)` = `useQuery(['runs', query], () => api.get('/runs', query))`，stale 30s

### 5.4 详情页 `HistoryDetailPage`

**布局（自上而下）**

1. `<PageHeader title={run.name ?? run.id} subtitle={t('history.detail.subtitle', { kind, tool, when })} />`
   - 顶部"返回 history"按钮
2. `<HistoryDetailMetadata run={run} />`
   - 双列 kv：kind / tool / mode / driverKind / status badge / connection 名（纯文本——`/connections/:id` 路由当前不存在，等 connections 详情页落地再加链接）/ createdAt / startedAt / completedAt / duration（calculated, formatDistanceStrict）
3. `<HistoryDetailMetrics summaryMetrics={run.summaryMetrics} />`
   - 顶层字段平铺成 kv 表；`summaryMetrics === null` 时显示 EmptyState "no metrics"
4. `<HistoryDetailRawOutput rawOutput={run.rawOutput} />`
   - shadcn `<Collapsible>` 默认折叠
   - `<pre>` 展示 `JSON.stringify(rawOutput, null, 2)`
   - `null` 时整块隐藏
5. logs 区块：如果 `run.logs`，再来一个 `<Collapsible>` + `<pre>`

**不带 mutation**

- 没有 cancel / delete 按钮
- benchmark 用户继续在 `/benchmarks/:id` 操作

**状态管理**

- `useRunDetail(id)` = `useQuery(['runs', id], () => api.get(\`/runs/\${id}\`))`
- 404 时显示 EmptyState（参考 BenchmarkDetailPage）

### 5.5 i18n

新文件 `apps/web/src/locales/{zh-CN,en-US}/history.json`，内容覆盖：

- `history.title` / `history.subtitle`
- `history.filters.*`（kind / tool / status / connection / createdAfter / createdBefore / search 各自标签）
- `history.columns.*`
- `history.compareButton` / `history.compareDisabledTooltip`
- `history.detail.subtitle`
- `history.detail.metadata.*`
- `history.detail.metrics.empty`
- `history.detail.rawOutput.toggle`
- `history.detail.logs.toggle`
- `history.empty`（列表无结果）
- `history.error`（请求失败）

`apps/web/src/i18n.ts` 注册新 namespace。

## 6. Issue #38 描述更新

PR 落地后，把 issue #38 的"目标（架构关键石）"段重写：

```markdown
## 目标（架构关键石）

设计并落地**统一 Run 模型**作为 benchmark 的核心实体。

- [x] Prisma schema：Run 表（kind + tool / scenario / mode / driverKind 四元组，含 summaryMetrics、serverMetrics 等）— PR #61
- [x] Connection 加字段：`prometheusUrl?`、`serverKind?` — 本 sprint
- [x] **五层概念**明确分工（Connection / Template / Plan / Run / Baseline）— 文档化于 #52 路线图
- [x] 现有 `/load-test` / `/benchmarks` / `/e2e` 后端写到统一表 — PR #61

## 推迟事项

- `POST /runs`（按 tool 路由到 adapter + driver）→ 移到 **#54** 与 Tool Adapter（**#53**）一起做。提前实现是过渡代码，#53 落地后必然返工。

## 实施轨迹

- PR #61 — Run 模型主体
- PR `feat/history-page` — Connection 字段补全 + #39 /history（本 sprint）
- #54 — POST /runs（依赖 #53）
```

PR 描述里写 `Closes #38, Closes #39`。

## 7. 测试与验证

### 7.1 自动化

- `pnpm -F @modeldoctor/api test --no-file-parallelism` — schema 改动触发 prisma generate；ConnectionService spec 加新字段透传 case；RunRepository spec 加时间范围 case
- `pnpm -F @modeldoctor/api test:e2e` — 跑 connections lifecycle，确认无回归
- `pnpm -F @modeldoctor/web test` — 新增 HistoryListPage / HistoryDetailPage 测试
- `pnpm -r type-check` — 应过

### 7.2 手测路径

1. 启 dev：`docker compose up -d postgres`，`pnpm -F @modeldoctor/api dev`，`pnpm -F @modeldoctor/web dev`
2. 通过现有 /benchmarks /load-test /e2e-test 创建几条 Run（覆盖三种 kind）
3. 访问 `/history`：验证三类 Run 都列出来，按时间倒序
4. 测试每个筛选维度：kind / tool / status / connection / 时间范围 / search
5. 多选 ≥ 2 行：对比按钮点亮但 disabled，tooltip 显示
6. 单击行：跳详情页
7. 详情页：metadata block 字段齐全；summaryMetrics 表渲染；rawOutput 折叠
8. 直接访问不存在的 `/history/:runId`：显示 EmptyState
9. 跨用户隔离：账号 A 的 /history 不应看到账号 B 的 Run（已由 `RunService.list` 强制 userId scope 保证；手测确认）

### 7.3 Per-worktree DB

按 PR #61 的约定，本 worktree 用独立 DB 名（如 `modeldoctor_history`）以免迁移污染 main worktree。在 `.env` 里改 `DATABASE_URL`，跑 `pnpm -F @modeldoctor/api prisma:migrate:dev` 时自动落新迁移。

## 8. 风险与已知折中

1. **死字段问题**：Connection.prometheusUrl / serverKind 在 #60 之前没人写也没人读。可接受 —— issue #38 明确要求"预留"，避免 #60 时再做迁移污染数据。
2. **summaryMetrics 形状不一致**：vegeta 的 `latencies.p95` vs guidellm 的 `metricsSummary.tokens.ttftMs.p95` vs e2e 没有 latency 字段。列表页 p95 列对 vegeta / guidellm 才有意义，e2e 行该列显示 "—"。详情页用通用 kv 表（顶层字段），不做形状归一化（那是 #53 canonical schema 的事）。
3. **多选对比按钮 dead path**：disabled 状态下用户可能困惑。tooltip 文案要显式说"#46 上线后启用"，而不是"敬请期待"。
4. **/history 详情 vs /benchmarks/:id 重复**：benchmark kind 的用户在两条路径上都能看 Run，渲染不一致（详情页薄、benchmarks 详情厚）。可接受 —— 详情页定位是"跨 kind 统一壳"，benchmarks 详情是 benchmark 特化；#46 报告页上线后两者会更收敛。
5. **i18n 重复 key**：history namespace 大量字段名（kind / tool / status / connection 等）和 benchmark / load-test / e2e namespace 可能重复。目前各 namespace 独立，不抽公共 namespace（避免本 sprint 触碰其他 feature 的翻译）。

## 9. 收尾动作

PR 描述要点：

- `Closes #38`, `Closes #39`
- 列出本次落地的 acceptance items（对照 issue 复选框）
- 列出推迟项（POST /runs → #54）
- 单测 / e2e / type-check 全过的截图或日志
- 部署/迁移说明：本 PR 包含一次 prisma migration（Connection 加 2 列），生产部署需 `prisma migrate deploy`

合并后立即：

1. 编辑 issue #38 描述（按 §6 文案）
2. close issue #38 + issue #39
3. 在 #54 / #60 各留一条评论指向本 PR 的 schema/contract 引子
