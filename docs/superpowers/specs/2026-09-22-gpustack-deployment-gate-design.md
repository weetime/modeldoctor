# GPUStack 部署门禁（自动发现 + 自动化测试）— 设计文档

- 日期：2026-09-22
- 范围：ModelDoctor 单向对接 GPUStack——自动发现 GPUStack 上部署的模型服务，用户逐个开启自动化测试后，每次部署变更自动跑「诊断 → 质量门禁 → 性能压测 → Baseline 对比」，并支持定时性能回归。GPUStack 零改动。
- 定位：**GPUStack 管部署，ModelDoctor 管部署后的验收（部署门禁）与持续性能测试**。本期不做调优建议，但本期落下的「部署快照 + 压测结果」是调优建议（子项目 D）的数据基础。

---

## 1. 问题与目标

GPUStack 自带 guidellm 压测，但没有：质量评测、部署变更自动回归、跨版本 Baseline 退化判定、告警通知。用户每次升级引擎版本 / 改启动参数 / 换镜像后，只能手动压一轮、肉眼比。

目标：

1. 在 ModelDoctor 添加一个 GPUStack 数据源（地址 + API Key）后，GPUStack 上的模型服务**自动出现**在 ModelDoctor，且自动生成可用的 Connection。
2. 用户对某个模型**手动开启**自动化测试后：该模型每次**部署变更**（指纹变化且就绪）自动跑一轮流水线，产出判定 `passed / failed / regressed / error`，异常时通知。
3. 可选**定时性能回归**（daily / weekly，仅压测 + Baseline 对比）。
4. 每轮结果挂在「部署版本」上，能看到「哪次变更 → 什么配置 diff → 质量/性能如何」。

## 2. 已定决策（brainstorm 结论）

| 决策点 | 结论 | 理由 |
|---|---|---|
| GPUStack 是否改动 | **不改**，ModelDoctor 单向对接 | 门禁 = 判定 + 通知，不拦截 GPUStack 上线 |
| 开启策略 | **逐个手动开启** | 压测占 GPU；embedding/rerank 等不应被误跑 |
| 测试内容 | 可选组合，默认三步全勾：诊断 → 质量门禁 → 压测；前一步失败即停 | 复用现有三套能力 |
| 定时回归 | 本期做简单版：daily/weekly，仅压测 + Baseline 对比 | 复用同一流水线，增量小；趋势图后置 |
| 同步机制 | **List + Watch**（k8s informer 模式） + 5 分钟全量兜底 | GPUStack watch 不发初始状态、断线不补发，必须 list 对账；watch 提供秒级感知 |
| 多副本 | 每个 API 副本各自 list/watch，DB 唯一约束去重 | 无需选主 |
| 源抽象 | `PlatformSource.kind`，GPUStack 为首个实现 | 后续 KServe/OME/llm-d 同接口接入，避免与 GPUStack 深度绑定 |

## 3. GPUStack 侧事实（源码核实，`~/workspace/gpustack/gpustack` @ 731b4fc9）

- **鉴权**：`Authorization: Bearer <api_key>`（或 `X-API-Key`）。API Key `scope` 需同时含 `management` 与 `inference`（默认 `*` 满足）。管理 API 结果受租户可见性过滤（`tenant_list_conditions`），**建议用管理员账号创建的 Key**，否则只能发现该用户自己的模型。
- **管理 API**（前缀 `/v2`）：
  - `GET /v2/models` 分页列表；`?watch=true` 返回 `text/event-stream`，事件 `{type, data, changed_fields, id}`，心跳为空行（`mixins/active_record.py:873`）。**订阅从连接时刻开始，不推送存量、无断点续传。**
  - `GET /v2/model-instances`（同样支持 `watch`）：实例 `state` ∈ `pending → analyzing → scheduled → initializing → downloading → starting → running`，以及 `error / unreachable`。
  - `GET /v2/model-routes`：路由列表，含 `name`、`effective_name`（非平台 Org 为 `<owner>/<name>`）、`created_model_id`、`targets`（目标数）。
- **推理 API**：`/v1`（OpenAI 兼容；`/v1-openai` 为旧别名）。ModelDoctor 侧 Connection 存主机根地址，`/v1` 由调用方拼接。**请求体里的 `model` 按 ModelRoute 名解析**（`routes/openai.py:210`），一个路由可带多个加权目标——所以「压测某个模型部署」必须找到**只指向该模型的路由**。
- **Model 关键字段**（`schemas/models.py`）：`id, name, categories, replicas, ready_replicas, cluster_id, backend, backend_version, backend_parameters, image_name, run_command, env, gpu_selector, gpu_type_selector, worker_selector, extended_kv_cache, placement_strategy, distributed_inference_across_workers, cpu_offloading` + 模型来源字段（huggingface/modelscope/local path）。

## 4. 数据模型（Prisma，新增 4 表 + Connection 1 字段）

所有权：`PlatformSource.userId` 是 owner；自动生成的 Connection、Benchmark、EvaluationRun、Baseline 均以该 userId 创建（沿用现有 user-scoped service）。

迁移用 `prisma migrate dev --create-only` 生成，不手写 SQL。

```prisma
model PlatformSource {
  id            String    @id @default(cuid())
  userId        String    @map("user_id")
  kind          String    // 'gpustack'
  name          String
  baseUrl       String    @map("base_url")
  apiKeyCipher  String    @map("api_key_cipher")   // AES-256-GCM v1，同 Connection
  clusterId     String?   @map("cluster_id")       // 可选：只发现该集群
  enabled       Boolean   @default(true)
  lastSyncAt    DateTime? @map("last_sync_at") @db.Timestamptz(3)
  lastSyncError String?   @map("last_sync_error") @db.Text
  createdAt / updatedAt
  models DiscoveredModel[]
  @@map("platform_sources")
}

model DiscoveredModel {
  id             String  @id @default(cuid())
  sourceId       String  @map("source_id")
  externalId     String  @map("external_id")      // GPUStack model.id
  name           String
  categories     String[]
  clusterId      String? @map("cluster_id")
  status         String  // 'new' | 'active' | 'unroutable' | 'removed'
  routeName      String? @map("route_name")       // 请求用的 model 名（effective_name ?? name）
  routeOverride  Boolean @default(false) @map("route_override") // 用户手动指定了路由
  connectionId   String? @unique @map("connection_id")
  currentRevisionId String? @map("current_revision_id")

  // 自动化配置
  automationEnabled Boolean  @default(false) @map("automation_enabled")
  steps             String[] @default(["diagnostics","quality_gate","benchmark"])
  evaluationId      String?  @map("evaluation_id")          // quality-gate Evaluation
  gateConfig        Json?    @map("gate_config")            // quality-gate 阈值；服务端无默认，开启时默认 {passRateMin:0.9}
  benchmarkTemplateId String? @map("benchmark_template_id")
  schedule          String   @default("off")                // 'off' | 'daily' | 'weekly'
  nextScheduledAt   DateTime? @map("next_scheduled_at") @db.Timestamptz(3)
  baselineId        String?  @map("baseline_id")
  regressionThresholds Json? @map("regression_thresholds")  // 覆盖默认阈值

  @@unique([sourceId, externalId])
  @@map("discovered_models")
}

model DeploymentRevision {
  id                String   @id @default(cuid())
  discoveredModelId String   @map("discovered_model_id")
  fingerprint       String                                 // sha256(规范化快照)
  snapshot          Json                                   // 见 §5.2
  firstSeenAt       DateTime @default(now()) @map("first_seen_at") @db.Timestamptz(3)
  readyAt           DateTime? @map("ready_at") @db.Timestamptz(3)
  @@unique([discoveredModelId, fingerprint])
  @@map("deployment_revisions")
}

model AutomationRun {
  id                String   @id @default(cuid())
  discoveredModelId String   @map("discovered_model_id")
  revisionId        String   @map("revision_id")
  trigger           String   // 'revision' | 'schedule' | 'manual' | 'enable'
  triggerKey        String   @map("trigger_key")   // 幂等键，见 §6.3
  status            String   // 'pending' | 'running' | 'completed' | 'cancelled'
  currentStep       String?  @map("current_step")
  verdict           String?  // 'passed' | 'failed' | 'regressed' | 'error' | 'superseded'
  diagnosticsRunId  String?  @map("diagnostics_run_id")
  evaluationRunId   String?  @map("evaluation_run_id")
  benchmarkId       String?  @map("benchmark_id")
  summary           Json?                           // 每步结果 + 退化对比明细
  lockedUntil       DateTime? @map("locked_until") @db.Timestamptz(3) // 多副本 tick 的乐观租约
  startedAt / finishedAt / createdAt
  @@unique([triggerKey])
  @@index([discoveredModelId, createdAt])
  @@map("automation_runs")
}
```

`Connection` 新增 `discoveredModelId String? @unique`（反向关联；UI 上标记「来自 GPUStack」，禁止用户改 baseUrl/model，其它字段可改）。

**复用**：`Connection`、`DiagnosticsRun`、quality-gate `Evaluation`/`EvaluationRun`、`Benchmark`/`BenchmarkTemplate`/`Baseline`、`NotificationChannel`/`NotificationSubscription`。`Benchmark` 表本期不加部署快照字段，经 `AutomationRun → DeploymentRevision.snapshot` 关联。

## 5. 同步（`apps/api/src/modules/platform-source/`）

### 5.1 组件

- `GpustackClient`：封装 `/v2/models`、`/v2/model-instances`、`/v2/model-routes` 的分页 list 与 models watch（SSE 解析 + 心跳超时检测）。所有请求走现有 `safeFetch`/SSRF guard。
- `SourceSyncService.reconcile(sourceId)`：**全量对账**，幂等，是唯一改写 `DiscoveredModel`/`DeploymentRevision` 的入口。
- `SourceWatcher`：每个 enabled 源一条 watch 连接；收到任意 models 事件 → debounce 2s → 调 `reconcile`（事件本身只作「该对账了」的信号，不做增量 apply，逻辑只有一份）。断线指数退避重连（1s → 60s 上限），重连成功后先 `reconcile`。
- `@Cron` 每 5 分钟对所有 enabled 源 `reconcile` 一次兜底；源新建/修改后立刻 `reconcile`。
- 同一副本内对同一源的 `reconcile` 串行（进程内互斥），跨副本靠 DB 唯一约束 + upsert 保证结果一致。

### 5.2 对账逻辑（每个 GPUStack model）

1. `clusterId` 过滤（若源配置了）。
2. upsert `DiscoveredModel`（按 `sourceId+externalId`）；新行 `status='new'`。
3. **解析路由**（`routeOverride=false` 时）：取 `created_model_id == model.id` 且 `targets == 1` 的 ModelRoute，`routeName = effective_name ?? name`。找不到 → `status='unroutable'`，不建 Connection、不允许开启自动化；UI 允许用户从路由列表手动指定（置 `routeOverride=true`）。
4. 有 `routeName` 且无 Connection → 创建 Connection：`baseUrl = <source.baseUrl>`（**主机根**，不带 `/v1`——本仓库约定 `Connection.baseUrl` 存根地址，调用方自行拼 `/v1`，见 `quality-gate/endpoint-caller.ts`、`discovery/probes/models.ts`；带 `/v1` 会让探针请求 `/v1/v1/...` 404）、`apiKey = source 的 key`、`model = routeName`、`category` 由 `categories` 映射（`llm→chat`、`embedding→embeddings`、`reranker→rerank`、`image→images`、`speech_to_text/text_to_speech→audio`，未知→`chat`）、`serverKind` 由 `backend` 映射（vllm/sglang/mindie/…，未知留空）、`tags=['gpustack', <cluster>]`。
5. **部署指纹**：对下列字段规范化（key 排序、`backend_parameters` 保序、`env` 按 key 排序、null 与缺失等价）后 sha256：`backend, backend_version, backend_parameters, image_name, run_command, env, gpu_selector, gpu_type_selector, worker_selector, extended_kv_cache, placement_strategy, distributed_inference_across_workers, cpu_offloading, 模型来源字段`。**不含** `replicas / ready_replicas / description / meta / name`。`snapshot` = 上述字段 + 当时 running 实例的 `gpu_type / gpu_indexes 数量 / worker_name / api_detected_backend_version`（仅展示，不入指纹）。
6. upsert `DeploymentRevision`（`discoveredModelId+fingerprint` 唯一）；更新 `currentRevisionId`。
7. `ready_replicas >= 1` 且当前 revision `readyAt` 为空 → 置 `readyAt = now()`（条件更新 `WHERE ready_at IS NULL`，返回是否由本次置位）。**由本次置位且 `automationEnabled`** → 入队 `trigger='revision'`。
8. 本轮 list 中缺席的 `DiscoveredModel` → `status='removed'`，Connection `enabled=false`，取消其进行中的 AutomationRun。重新出现则恢复 `active`。

源级错误（网络/401/5xx）：写 `lastSyncError`、不修改任何 `DiscoveredModel`（绝不因为一次失败把模型标 removed）。

## 6. 自动化流水线

### 6.1 触发

| trigger | 时机 | 步骤 |
|---|---|---|
| `enable` | 用户开启自动化时，对当前已就绪 revision 立即跑一次 | 配置的全部步骤 |
| `revision` | 新 revision 就绪（§5.2 第 7 步） | 配置的全部步骤 |
| `schedule` | `@Cron` 每分钟扫 `nextScheduledAt <= now()` | 仅 `benchmark` + 对比 |
| `manual` | 详情页「立即运行」 | 配置的全部步骤 |

### 6.2 执行（`AutomationRunnerService`）

步骤按序执行，全部**调用现有 service**，AutomationRun 只存关联 id 与编排状态：

1. `diagnostics`：`DiagnosticsService.run()`（同步返回）。探针按 GPUStack category 选：`llm→chat-text`、`embedding→embeddings-openai`、`reranker→rerank-cohere`、`image→image-gen`、`text_to_speech→tts`、`speech_to_text→asr`，未知→`chat-text`。失败 → `verdict='failed'`，停止。
2. `quality_gate`：`RunsService.create()` 以 Connection 为 endpointA、选定 `Evaluation` + `DiscoveredModel.gateConfig` 发起 `EvaluationRun`，轮询其终态。`gateResult=FAILED` → `failed` 停止；`WARNING` 视为通过（summary 标注）；run 本身 `FAILED/CANCELLED` → `error`。
3. `benchmark`：以选定 `BenchmarkTemplate` + Connection 创建 `Benchmark`，等待终态。执行失败 → `error`。
4. `compare`（随 benchmark 自动进行）：见 §6.4。退化 → `regressed`；否则 `passed`。

步骤等待采用「状态轮询 + 进程重启可恢复」：runner 周期性（10s）推进所有 `status='running'` 的 AutomationRun——读取当前步骤关联实体的状态，终态则进入下一步。API 重启不丢流水线。

未配置的步骤跳过；缺少必需配置（勾了 quality_gate 但没选 Evaluation）在开启时由 contract 校验拒绝。

### 6.3 并发与幂等

- `triggerKey`：`revision:<revisionId>`、`enable:<revisionId>`、`schedule:<modelId>:<slot 时间>`、`manual:<uuid>`，唯一约束保证多副本只插入一次。
- **同模型串行**：同一 `DiscoveredModel` 至多 1 个 running。新 `revision` 触发到来时，进行中的 run 置 `cancelled / superseded` 并取消其子任务（Benchmark 走现有取消接口），再执行新的。`schedule` 触发遇到 running 则跳过本轮。
- **同源串行**：每个 `PlatformSource` 同时至多 1 个 `running` 的 AutomationRun（压测占 GPU、互相干扰结果；诊断与质量门禁很短，整轮串行换来实现简单），其余 `pending` 排队，FIFO。
- **多副本 tick**：推进某个 run 前先 `updateMany({where:{id, OR:[{lockedUntil:null},{lockedUntil:{lt:now}}]}, data:{lockedUntil: now+60s}})`，count=1 才处理。

### 6.4 Baseline 对比（新增纯函数 `detectRegression(baseline, candidate, thresholds)`）

- 取 `DiscoveredModel.baselineId` 对应 Baseline 的 benchmark `summaryMetrics` 与本次对比。
- 默认阈值（可按模型覆盖）：输出吞吐下降 > 10%、TTFT p95 上升 > 15%、ITL p95 上升 > 15%。任一超标即 `regressed`；`summary` 记录每个指标的 baseline 值、当前值、变化率、是否超标。
- 模板不同（`templateId` 不一致）不比较，`summary` 注明「模板已变更，未对比」，判定 `passed`。
- **无 Baseline**：首次成功压测后自动创建 Baseline（名 `<模型名> @ <revision 短指纹>`）并写回 `baselineId`，判定 `passed`，`summary` 注明「已建立 Baseline」。用户可在详情页把任意一次压测设为新 Baseline。

### 6.5 通知

新增事件类型：`automation.failed`、`automation.regressed`、`automation.passed`，payload 含模型名、revision 配置 diff 摘要、判定、详情链接。走现有 `NotificationSubscription`（按 eventType + filter 订阅）；UI 默认建议订阅前两个。

## 7. API / Contracts（`packages/contracts`）

- `platform-sources`：CRUD、`POST /:id/test`（调 `/v2/models?perPage=1` 校验地址与权限）、`POST /:id/sync`（立即对账）。
- `discovered-models`：列表（按源/状态/是否开启过滤）、详情、`PATCH`（自动化配置、手动指定路由、Baseline）、`POST /:id/run`（manual）。
- `discovered-models/:id/revisions`：revision 时间线（含相邻 revision 的 snapshot diff）。
- `automation-runs`：列表、详情、取消。

## 8. 前端（`apps/web`）

- **设置 → GPUStack 数据源**：列表 + 新增/编辑抽屉（名称、地址、API Key、可选集群）+「测试连接」+ 同步状态（最近同步时间 / 错误）。
- **部署门禁**（新页面，列表页遵循现有约定：首列 `<Link>` 进详情，末列「操作」含 详情 / 立即运行）：列 = 模型名、来源/集群、状态（新发现角标、不可路由警示）、当前版本（backend + version）、最近判定徽章、自动化开关。
- **模型详情**：配置区（自动化配置弹窗：步骤勾选、Evaluation、压测模板、定时、阈值、Baseline）+ **revision 时间线**：每个 revision 展示与上一个的配置 diff（如 `vllm 0.10.1 → 0.11.0`、`--max-num-seqs 256 → 512`），挂其下所有 AutomationRun 的判定，展开可见每步结果并跳转现有 Diagnostics / Quality Gate / Benchmark 详情页。
- i18n：zh-CN / en-US 双语。

## 9. 错误处理汇总

| 情况 | 处理 |
|---|---|
| GPUStack 不可达 / 401 / 5xx | `lastSyncError` + UI 标红；watch 退避重连；不改动已发现模型 |
| watch 静默卡死 | 心跳超时（60s 无任何字节）视为断线重连；5 分钟兜底对账 |
| 模型无专属路由 | `unroutable`，引导手动指定路由 |
| 模型被删除 | `removed`，Connection 禁用，取消进行中的 run；历史保留 |
| 步骤子任务失败 / 超时 | 该步 `error`，记录原因；不影响其它模型 |
| 进行中被新部署取代 | `superseded`，取消子任务 |

## 10. 测试

- **单测**：指纹规范化（字段顺序、null/缺失、replicas 变化不改指纹）、category/serverKind 映射、路由解析、`detectRegression`（阈值边界、模板不一致、无 baseline）、流水线状态机（每步成功/失败/取消/superseded）、triggerKey 幂等。
- **集成测试**：fake GPUStack（固定 list 响应 + 可控 SSE 流）驱动：发现 → 建 Connection → 参数变更产生新 revision → 就绪触发 → 各步子服务 mock → 判定 → 通知入队；以及断线期间变更由重连对账补上。
- **手工 e2e**：对 4pd 集群 GPUStack 跑一遍——添加数据源、开启一个 chat 模型、在 GPUStack 改一个启动参数、确认新 revision + 自动 run + 通知。

## 11. 不在本期

性能趋势图；调优建议（子项目 D）；回写 GPUStack（模型状态/标签）；手动压测记录部署快照；model-instances watch（本期实例状态只经 `ready_replicas` 体现）；KServe / OME / llm-d 等其它数据源；多 GPUStack Org 视角切换。
