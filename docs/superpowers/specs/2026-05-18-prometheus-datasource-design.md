# PrometheusDatasource — 系统级指标源实体 + Connection 绑定 + Explainer 接入

**Date**: 2026-05-18
**Status**: design
**Tracks**: addresses #189 (P0 收尾 · "全局 PrometheusDatasource 实体 + default selector")
**Branch**: `feat/prometheus-datasource`

## 背景

#192 让 `Connection.kind` 支持 `model / gateway / prometheus / alertmanager`,可以创建多行 `kind=prometheus` connection;#191 alert loop 让 AlertExplainerService 在告警触发时拉 baseline + 最近 benchmark 喂 LLM。

但中间还缺一块绑定:**给定一个 model/gateway connection,该从哪台 Prometheus 拉指标?** 现在没有任何字段记录这个关系——只在 alert 入口靠 `model_name` label 反推 connection,反方向(connection → Prom)是空的;explainer 也根本没调过 Prom。

#189 P0 区块的最后一项就是补上这层:

> **全局 PrometheusDatasource 实体 + default selector(多 Prometheus 场景)**

## 出乎意料的现状(勘察结论)

1. **`Connection.prometheusUrl: String?` 是孤儿字段**(`apps/api/prisma/schema.prisma:94`,#60 时代占位,被 #192 架空)—— 从未在 UI 曝露,这次顺手清掉
2. **`AlertExplainerService` 当前根本不查 Prometheus**(`apps/api/src/modules/alerts/explainer.service.ts:140-152`)—— 只读 baseline + 最近 3 次 benchmark。"接入 Prom 查询"是这次新增的能力
3. **`kind=prometheus` 在代码里没有任何业务依赖** —— 只出现在 kind 下拉 / kind filter / `verify-kind` 探针 3 处;subscriber / alert / explainer / notification 全无 key off `kind=prometheus` 的逻辑

## 设计选型

### 实体形态:独立 `PrometheusDatasource` 表(系统级,无 userId)

不在 Connection 上扩(放弃自指 FK 方案),理由:

- Prometheus 在概念上是「指标源 / 数据源」(类比 Grafana 的 Datasource),不是「被监控对象 / LLM 栈成员」。把它和 model/gateway/alertmanager 平铺在 Connection 里语义混淆
- 系统级管理(只有 admin 能配),无需 user_id 维度——单用户产品下也保持系统级形态,便于将来加多用户角色
- 独立表可直接表达 `is_default` partial unique index;Connection 自指 FK 表达"哪行是默认"反而别扭

### 与 `kind=prometheus` Connection 的关系

`kind=prometheus` 从 `connectionKindSchema` enum 收窄掉;现存 Connection 行 migration 一次性搬进新表。因为没有任何业务代码 key off 这个 kind,迁移无破坏。

### Alertmanager 同构(本 PR 不做)

按同样逻辑,`kind=alertmanager` 也是「告警来源 / 路由处」,理应也搬出 Connection 进 `AlertmanagerDatasource` 独立表。但本 PR 不动,理由:

- 用户本轮只提了 Prometheus,scope 收紧
- #191 也没有任何业务逻辑 key off `kind=alertmanager`,延后无成本
- 按 `feedback_temp_followups`,合并时给 #189 评一条 follow-up:**"PrometheusDatasource 落地后,Alertmanager 同构改造单开 issue"**

### Explainer 取样策略:重跑告警自己的 expr

观测领域(Grafana Alert details / Robusta / Datadog Watchdog)的通行做法:**拿告警自己的 PromQL,在告警时间点前后跑一次 `query_range`,把时序结果摘要喂给 LLM。** 理由:

- 告警 expr 是「为什么这次会响」的客观证据,不用猜「该看哪些金标指标」
- 一次 HTTP 调用、无领域知识、无 PromQL 模板维护
- LLM 能引用真实数据点("p95 从 0.32 在 14:32 跳到 0.61"),比当前 baseline-only 强一档
- 失败优雅降级:Prom 超时/404 → 回到 baseline-only,告警照常解释

## §1 Schema(Prisma)

### 新表

```prisma
model PrometheusDatasource {
  id            String   @id @default(cuid())
  name          String   @unique                              // 全局唯一,下拉里展示
  baseUrl       String   @unique @map("base_url")             // 全局唯一,避免登记两次
  bearerCipher  String   @default("") @map("bearer_cipher")   // 空 = anonymous
  customHeaders String   @default("") @map("custom_headers")
  isDefault     Boolean  @default(false) @map("is_default")
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt     DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  consumers Connection[]

  @@map("prometheus_datasources")
}
```

Raw migration 加全局 partial unique index(只允许一行 `is_default = true`):

```sql
CREATE UNIQUE INDEX uniq_default_prom_ds
  ON prometheus_datasources((is_default))
  WHERE is_default = TRUE;
```

### Connection 表改动

```prisma
model Connection {
  // 新增
  prometheusDatasourceId String?               @map("prometheus_datasource_id")
  prometheusDatasource   PrometheusDatasource? @relation(fields: [prometheusDatasourceId], references: [id], onDelete: SetNull)

  // 删除:架空的 prometheusUrl
}
```

- `prometheusDatasourceId` 仅对 `kind ∈ {model, gateway}` 有意义;`kind === "alertmanager"` 必须 null(service 层校验)
- `onDelete: SetNull` —— 删 datasource 时不级联删 Connection,只让 source 失效,explainer 回退到默认 datasource
- 加索引 `(prometheus_datasource_id)` 给 explainer 反查用

### `connectionKindSchema` 收窄

`packages/contracts/src/connection.ts`:

```ts
export const connectionKindSchema = z.enum(["model", "gateway", "alertmanager"]);
```

`prometheus` 从 enum 删除。breaking change,但调用方就 web/MCP 两个,这次 PR 内一起改。

### Migration 步骤(一个 `prisma migrate dev --create-only`)

1. `CREATE TABLE prometheus_datasources` + partial unique index
2. **迁数据**(从 `Connection WHERE kind='prometheus'` 搬进新表):
   - 按 `base_url` 去重(同一 URL 多用户都登记过的情况);保留每个 base_url 最早一行的 id / name / customHeaders;bearerCipher 一律空
   - INSERT 进 `prometheus_datasources`(id 沿用,便于潜在引用迁移)
   - 全局最早一行(按 createdAt asc)标 `is_default = true`(全局唯一 default)
3. `ALTER TABLE connections ADD COLUMN prometheus_datasource_id text NULL`
4. **Backfill consumer 端**:对每个 `connection`(任意 user),凡 `prometheus_url IS NOT NULL` 且能在新表找到 `base_url = connection.prometheus_url` 的行,填进 `prometheus_datasource_id`
5. `DELETE FROM connections WHERE kind='prometheus'`
6. `ALTER TABLE connections DROP COLUMN prometheus_url`
7. `CREATE INDEX idx_conn_prom_ds ON connections(prometheus_datasource_id)`

按 `feedback_prisma_migrations`,migration 用 `pnpm -F @modeldoctor/api prisma migrate dev --create-only` 生成,然后手动改 SQL(数据迁移步骤)。**不放业务 INSERT,只放 schema 变更 + 由 schema 变更直接驱动的 backfill**(参考 CLAUDE.md "Migrations are schema-only" 段落的允许例外)。

## §2 API Contract

### 新模块 `prometheus-datasources`

| Method | Path | 授权 | 说明 |
|---|---|---|---|
| `GET`    | `/api/prometheus-datasources`            | 登录即可 | `→ { items: PrometheusDatasourcePublic[] }`,每行附 `consumersCount` |
| `GET`    | `/api/prometheus-datasources/:id`        | 登录即可 | `→ PrometheusDatasourcePublic` |
| `POST`   | `/api/prometheus-datasources`            | **admin** | `→ PrometheusDatasourceWithSecret`(bearer 明文一次性返) |
| `PATCH`  | `/api/prometheus-datasources/:id`        | **admin** | `→ WithSecret`(bearer 旋转时)或 `Public` |
| `DELETE` | `/api/prometheus-datasources/:id`        | **admin** | 204;consumers 走 `onDelete: SetNull`;响应 body 附 `consumersDetached: N`(给前端 toast) |
| `POST`   | `/api/prometheus-datasources/:id/set-default` | **admin** | 事务里 `UPDATE ... SET is_default=false WHERE id != :id` + `SET TRUE WHERE id = :id` → `Public` |
| `POST`   | `/api/prometheus-datasources/verify`     | **admin** | `→ { ok, version?, reason? }`,复用 `verifyPrometheus()`(#192) |

**Admin guard**: 沿用 `apps/api/src/modules/benchmark-template/benchmark-template.controller.ts` 的 `actorFrom(user)` 模式,在 service 层检查 `user.roles.includes("admin")`;不引新装饰器。

### 现有 `connections` 接口增量

`POST /api/connections` 与 `PATCH /api/connections/:id` 接受新字段 `prometheusDatasourceId: string | null`(zod `.nullish()`)。

**字段三态语义**:

| 客户端传 | server 行为 |
|---|---|
| `undefined`(不传)+ `kind ∈ {model, gateway}` | 自动填当前 default datasource;若无 default 存 `null` |
| `undefined` + `kind === "alertmanager"` | 必存 `null` |
| `null`(显式清空) | 存 `null`(用户主动 opt-out) |
| `"<id>"` | service 校验存在;`kind === "alertmanager"` 拒绝 422 |

`connectionPublicSchema` 增字段:
- `prometheusDatasourceId: string | null`
- `prometheusDatasource: { id, name, baseUrl } | null`

`prometheusUrl` 从 `connectionPublicSchema` 删除。

### Contract 文件

新增 `packages/contracts/src/prometheus-datasource.ts`:

- `prometheusDatasourcePublicSchema` —— `{ id, name, baseUrl, bearerPreview, customHeaders, isDefault, consumersCount, createdAt, updatedAt }`
- `prometheusDatasourceWithSecretSchema` —— extend public + `bearerToken: string`
- `createPrometheusDatasourceSchema` / `updatePrometheusDatasourceSchema`
- `verifyPrometheusDatasourceRequestSchema` / `verifyPrometheusDatasourceResponseSchema`

### 错误码新增

`{ statusCode, message, code? }` 新增 code:
- `prometheus_datasource_not_found`
- `prometheus_datasource_name_taken`
- `prometheus_datasource_baseurl_taken`
- `prometheus_datasource_invalid_kind`(在 Connection 上设非法 kind 组合时)

## §3 Web UI

### A. 新页面 `/settings/prometheus-datasources`(list + sheet CRUD)

按 `ConnectionsPage.tsx` 形态。

**列表布局**:
- `<PageHeader title subtitle breadcrumbs={[设置 / Prometheus 数据源]} rightSlot={<Button>+ 新增数据源</Button>} />`
- `<DataTable>` 列:`名称 | baseUrl | 默认 | 鉴权 | 关联 connection 数 | 操作`
  - **名称**:`<Link>` 走详情/编辑(打开 sheet)—— 沿用 `feedback_list_page_actions_pattern`
  - **默认列**:`<Badge>默认</Badge>` 或空 + inline "设为默认" 按钮
  - **关联数**:数字,hover tooltip 显示 model: X, gateway: Y
  - **操作列**:`详情` + `删除`(`AlertDialog` 确认,文案 "将解绑 N 个 connection")
- 空态:"尚未配置 Prometheus 数据源 — 添加第一个开始接入告警指标源"

**`DatasourceSheet`(创建/编辑,沿用 `ConnectionSheet` 形态)**:
- `<Sheet side="right" sm:max-w-[640px]>`
- body 字段顺序:
  1. 名称 + baseUrl(grid 2 列)
  2. Bearer(单列;编辑态显 `••••<preview>`,带"轮换"按钮才进入明文输入态)
  3. Custom Headers(textarea,单列)
  4. 设为默认(checkbox,帮助文字 "当前默认: X,勾选会覆盖")
- footer:左边 `测试连接` 按钮(打 verify endpoint,toast 出 ok/version/reason);右边 `FormActions` 取消/保存
- 校验全 zod via `createDatasourceSchema`,`<FormMessage>` i18n

**Admin guard(前端)**: `isAdmin = user.roles.includes("admin")`。非 admin:`+ 新增`/`编辑`/`删除`/`设为默认` 按钮全部不渲染;表格本身可读。防绕过靠后端。

### B. `SettingsPage` 加入口 row

不重构 `SettingsPage`(scope 外),只在现有页面加一个 `SettingSection`:

```tsx
<SettingSection title={t("prometheusDatasources.title")} description={t("prometheusDatasources.desc")}>
  <SettingRow>
    <Button variant="outline" asChild>
      <Link to="/settings/prometheus-datasources">{t("prometheusDatasources.manage")} →</Link>
    </Button>
  </SettingRow>
</SettingSection>
```

侧边栏不增条目。

### C. `ConnectionSheet`(connection 创建/编辑表单)

- 当 `kind ∈ {model, gateway}` 时,渲染新字段 **"指标源(Prometheus 数据源)"**:
  - `<Select>` 拉 `useDatasources()` query,选项 = 各 datasource +`不绑定`(value=`null`)
  - 默认 datasource 在选项里加 `(默认)` 后缀
  - 新建表单不显式塞 id,让 API 服务端自动填默认
  - 编辑表单回显 `connection.prometheusDatasourceId`(可能 null)
  - 帮助文字:"AI 解释告警时将从此数据源拉指标。默认是 Settings 里标记的默认数据源。"
- `kind === "alertmanager"` 不渲染该字段
- 删现有 `prometheusUrl` 字段相关代码(UI 本来也没曝露)

### D. `ConnectionsPage`(列表页)

- kind 过滤芯片去掉 `prometheus`(同步 enum 收窄)
- 新增列 **指标源**:显示 `connection.prometheusDatasource?.name ?? "—"`,可点击跳到对应 datasource 编辑

### E. queries.ts(react-query)

新文件 `apps/web/src/features/prometheus-datasources/queries.ts`:
- `useDatasources()` — list, key `["prometheus-datasources"]`
- `useDatasource(id)` — detail
- `useCreateDatasource()` / `useUpdateDatasource(id)` / `useDeleteDatasource(id)` / `useSetDefault(id)`
- `useVerifyDatasource()` — mutation,不缓存
- 所有 mutation `onSuccess` 里:`invalidate(["prometheus-datasources"])` + `invalidate(["connections"])`(default 变化会影响其他 connection 的解析回显)

### F. i18n

新增 namespace `prometheus-datasources.json`(zh-CN + en-US),覆盖:
- 页面 title / subtitle / breadcrumb
- 表单 label / description / 占位符 / 校验文案
- AlertDialog 删除确认文案("将解绑 N 个 connection")
- toast 文案(create/update/delete/setDefault/verify 的成功/失败)

## §4 MCP Tools

按 #132 MCP 横向标准。

### 必做 2 个

**`list_prometheus_datasources`**(读)
- 文件:`apps/api/src/modules/mcp/tools/list-prometheus-datasources.tool.ts`
- 等价于 `GET /api/prometheus-datasources`
- 输入:无
- 输出:`{ items: Array<{ id, name, baseUrl, bearerPreview, isDefault, consumersCount }> }`
- 描述里点明:"列出所有 Prometheus 指标源;`isDefault: true` 的那个是新 connection 默认绑定的;`set_connection_prometheus_source` 可改"

**`set_connection_prometheus_source`**(写)
- 文件:`apps/api/src/modules/mcp/tools/set-connection-prometheus-source.tool.ts`
- 等价于 `PATCH /api/connections/:id` 只改 `prometheusDatasourceId`
- 输入 zod:
  ```ts
  {
    connectionId: z.string().min(1),
    // null = explicit unbind; undefined = pick the current default
    datasourceId: z.string().nullable().optional()
  }
  ```
- 输出:更新后的 `ConnectionPublic`(含 `prometheusDatasource: { id, name, baseUrl } | null`)
- 服务端语义跟 REST 三态语义一致

### 不在本 PR 的(defer)

**`set_default_prometheus_datasource`** — admin-only 系统全局变更,LLM 通常不该代用户做。写进 #189 follow-up comment。

### 注册 / README / 联动改动

- `apps/api/src/modules/mcp/tools/_register.ts` 注册新 2 个 tool
- `apps/api/src/modules/mcp/README.md` 追加 2 段(tool name / 描述 / input/output schema / 一段使用示例)
- `apps/api/src/modules/mcp/tools/list-connections.tool.ts:17` 描述里 `prometheusUrl` → `prometheusDatasource`

## §5 AlertExplainer 接入

### 新文件 `apps/api/src/modules/alerts/prometheus-fetcher.service.ts`

纯粹的 Prom HTTP 客户端,可独立单测。

```ts
@Injectable()
export class PrometheusFetcherService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 解析 datasource → expr → query_range,失败一律返回 null
   * (调用方继续走 baseline-only)。
   */
  async fetchAlertContext(event: AlertEvent): Promise<PromContext | null>;
}
```

### Datasource 解析(三级回退)

1. `event.connection.prometheusDatasource`(若 connectionId 命中且 connection 绑了 source)
2. `PrometheusDatasource WHERE isDefault = TRUE`
3. 都没有 → `return null`,log.debug

### Expr 解析(两级回退)

1. `event.annotations.expr` —— #190 PromRule yaml 里可显式写
2. `event.rawPayload.generatorURL` parse `?g0.expr=` —— Alertmanager 默认带
3. 都没有 → `return null`

### Query + 摘要

- HTTP `GET {baseUrl}/api/v1/query_range?query=<expr>&start=...&end=...&step=15s`
- 时间窗:`[startsAt - 15min, startsAt + 5min]` —— 20 min,80 步,token 负担小
- Header:若 datasource 有 `bearerCipher`,解密后 `Authorization: Bearer ...`;`customHeaders` 解析并附加(沿用 `connection.service.ts` 的 header 解析工具)
- timeout 5s(AbortController),非 2xx → null;Prom error response → null
- **所有失败只 log.warn 不 throw**(explainer 必须能写 baseline-only 解释)
- 解析 `data.result: Array<{ metric, values: Array<[ts, val]> }>`
- 摘要规则(控总 token ≤ 1500):
  - 取前 5 条 series(label 字典序排,deterministic)
  - 每条 series:`{ labels, summary: { min, max, mean, last }, samples: [first, peak, last 3 points] }`
  - `peak` = `values` 里偏离 `mean` 最远的点(绝对值)

返回结构:

```ts
type PromContext = {
  datasource: { id: string; name: string };
  expr: string;
  window: { start: string; end: string; stepSeconds: number };
  series: Array<{
    labels: Record<string, string>;
    summary: { min: number; max: number; mean: number; last: number };
    samples: Array<{ at: string; value: number }>;
  }>;
};
```

### `AlertExplainerService` 改动

`buildContext` 调用 `promFetcher.fetchAlertContext(event)`,把结果挂在 `context.promSnapshot`(nullable);`buildPrompt` 新增一段 markdown(类比现有 baseline / recentBenchmarks):

```md
## 告警时段指标(数据源: <datasource name>)
- expr: `<expr>`
- 窗口: <start> → <end>, step=15s
- 命中 series 数: <n>

<每条 series>
labels: { model_name="...", instance="..." }
summary: min=0.32, max=0.61, mean=0.44, last=0.58
samples:
  - 14:25:00  0.32
  - 14:32:15  0.61  (peak)
  - 14:35:30  0.58
```

`SYS_PROMPT_ZH` 末尾追加一段:**"如果给了'告警时段指标'段,优先用其中的真实数据点支撑结论;未提供时只基于 baseline / benchmark 推断,不要编数字。"**

### 模块依赖

- `AlertsModule` providers 加 `PrometheusFetcherService`,inject 进 `AlertExplainerService`

### 单测 + e2e

- **`prometheus-fetcher.service.spec.ts`**:mock fetch,覆盖 datasource 三级回退 / expr 两级回退 / query_range 200 / 5xx / timeout / 摘要边界(0 series / >5 series / 单点 series)
- **`explainer.service.spec.ts`**(增量):`promSnapshot === null` 时 prompt 不含该段;非 null 时 prompt 含该段;Prom 失败不阻塞 explainer 写库
- **`alerts.e2e-spec.ts`**(增量):`POST /api/alerts/webhook` 触发后 mock 一个 fake Prom server,验证 fetcher 真打了 query_range,且 explainer 写出的 `narrative` 里至少含一个数字串(从 prom samples 透出)

## PR 形态

按 `feedback_single_pr_for_coupled_work`,**一个 PR、phase-per-commit**(branch `feat/prometheus-datasource`):

1. `feat(contracts): PrometheusDatasource zod schemas + Connection.kind 收窄`
2. `feat(api): PrometheusDatasource Prisma model + migration(含数据迁移)`
3. `feat(api): /api/prometheus-datasources CRUD + set-default + verify`
4. `feat(api): Connection.prometheusDatasourceId — 三态语义 + 校验`
5. `feat(api): AlertExplainer 接 PrometheusFetcherService(Prom query_range + 摘要)`
6. `feat(web): /settings/prometheus-datasources 列表页 + DatasourceSheet`
7. `feat(web): ConnectionSheet 加 "指标源" 字段 + ConnectionsPage 列`
8. `feat(mcp): list_prometheus_datasources + set_connection_prometheus_source`
9. `test(e2e): alerts.e2e-spec mock Prom server + datasource 选择路径`

PR 标题:`feat: PrometheusDatasource — admin-managed 指标源 + Connection 绑定 + AI explainer Prom 接入 (addresses #189)`

按 `feedback_umbrella_issue_trailers`,用 `addresses #189` 不用 `closes` —— #189 是 umbrella。

## Follow-ups(合并时 #189 评论)

- **Alertmanager 同构**:把 `kind=alertmanager` 也搬出 Connection 进 `AlertmanagerDatasource` 独立表(同样无业务依赖,延后无成本)
- **`set_default_prometheus_datasource` MCP tool**:如果将来 Claude Code agent 需要切默认 Prom 再补
- **CLAUDE.md doc 修订**:"Page vs Dialog" 段引用了 `ConnectionDialog`,实物是 `ConnectionSheet.tsx`,doc 滞后

## 不做(明确 V1 范围外)

- 多 default datasource 按 namespace / 标签匹配规则路由(YAGNI;真有多集群再说)
- Datasource 健康自动巡检(verify 只在 admin 手动操作时跑)
- 把 `kind=prometheus` 保留为兼容别名(无业务依赖,直接移除更干净)
- AlertmanagerDatasource 同构(见 Follow-ups)
