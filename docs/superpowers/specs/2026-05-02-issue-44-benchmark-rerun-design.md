# [F.C2] Benchmark 重跑：基于 Run / Baseline 触发新 Run — 设计

- **Issue**: weetime/modeldoctor#44
- **Phase**: F-benchmark-core
- **依赖**: #38（统一 Run 模型）、#43（Baseline）
- **解锁**: #45（Diff 引擎）
- **范围内 kind**: `benchmark` only（`e2e` 留给后续 ticket）
- **作者 / 日期**: 2026-05-02

---

## 1. 背景

回归对比工作流的第二步：基于一个历史 Run（通常是 baseline）用同样的 `tool / scenario / mode / params` 再跑一次，得到一个新的 Run，供 #45 diff 引擎做对比。

#43 已落地 baseline 模型与 `Run.parentRunId / Baseline.runId` 的 schema；本期把"再跑"动作的 API、service、前端入口接通。

## 2. 关键事实（影响设计的现状）

1. **`POST /runs` 不存在**。`RunController` 当前只有 `GET`。真正"创建并执行"的入口是 `POST /benchmarks`（`BenchmarkService.create` → `runs.create` → `start(driver)`），且只处理 `kind=benchmark`。`POST /runs` 是 #54 的目标。
2. **`templateId / templateVersion` 现在恒 NULL**（schema 注释 "until #43–#56 wire them up"），#43 的 `BaselineService.create` 也只是把源 Run 的 NULL 复制过去。所以 issue 里"用冻结的 templateVersion 跑"今天**根本无 template 可冻结**，只能直接复制源 Run 的 `tool / scenario / mode / params`。当 #56 落地 Template 后，由于 rerun 复制源 Run 的 `templateVersion` 字段，行为会自动正确。
3. **`driverKind` 当前是全局 env (`BENCHMARK_DRIVER`)**，`BenchmarkService` 在构造时一次性读出来盖在所有新 Run 上。**没有 per-run override 路径**。本期不开 driverKind override（见 §11 deferred）。
4. **Connection FK 是 `onDelete: SetNull`**。源 Run 的 connection 被删后，`connectionId` 变 NULL；rerun 必须由用户重选 connection（必传）。
5. **Active-name 唯一性**：`BenchmarkService.create` 强制同一用户下 `status ∈ {pending, submitted, running}` 的 benchmark 不重名（`BENCHMARK_NAME_IN_USE` 409）。rerun 必须遵守同一约束。

## 3. 范围

### 3.1 In-scope（本 PR）

- `POST /runs/:id/rerun` 路由（owner-scoped, JwtAuthGuard）
- `RerunRunRequest` 合约 schema（contracts package）
- `BenchmarkService.rerun` 服务方法（kind=benchmark 派发目标）
- `RunService.rerun` 派发器（kind 校验 → 派发到 BenchmarkService）
- 模块拆分：抽 `RunRepositoryModule` 解循环依赖（见 §6）
- 错误码（5 个新增）
- 前端：共享 `RerunDialog` 组件 + `useRerunRun` mutation
- 前端：在 `HistoryDetailPage` 与 `HistoryListPage` 加 Re-run 按钮
- 测试：service / controller / contract / dialog / hook

### 3.2 Out-of-scope（spec 里登记，留给后续 ticket）

| 项 | 留给 |
|---|---|
| per-Run `driverKind` override | #59（Driver 选择策略） |
| `e2e` kind 的 rerun（本期返 422） | 后续 ticket |
| `POST /runs`（generic create） | #54 |
| `PATCH /runs` 与 baseline params immutability guard | #54 follow-up |
| 独立 `BaselineListPage`（baseline 管理 UI） | #46 |
| Rerun 与 baseline 的 diff 入口 / 对比可视化 | #45 |

## 4. API 合约

### 4.1 路由

```
POST /runs/:id/rerun
  Auth: JwtAuthGuard, owner-scoped
  Body: RerunRunRequest
  200 → Run                       (新 Run，status='submitted'，driverHandle 已填)
  4xx → { code, message }
```

仅此一条路由。**不**新增 `POST /baselines/:id/rerun` 别名 —— baseline 本质只是 `Baseline.runId` 指针，前端 baseline 路径用 `baseline.runId` 直接调 `/runs/:runId/rerun`。

### 4.2 Request schema（新增到 `packages/contracts/src/run.ts`）

```ts
export const rerunRunRequestSchema = z.object({
  connectionId: z.string().min(1),
  name: z.string().min(1).max(128).optional(),
  description: z.string().max(2048).optional(),
});
export type RerunRunRequest = z.infer<typeof rerunRunRequestSchema>;
```

**字段语义：**

| 字段 | 必传 | 行为 |
|---|---|---|
| `connectionId` | ✅ | 用户必须显式选 connection（即使没换，也要确认）。前端 dialog 预填源 Run 的 connectionId（如果仍属当前用户）。 |
| `name` | ❌ | 不传时服务端按 `${source.name} (rerun N)` 派生（N = `count(Run WHERE userId=current AND parentRunId=source.id) + 1`）。 |
| `description` | ❌ | 不传时沿用源 Run 的 description。 |

**显式不允许 override**（即使前端误传也忽略）：`tool / scenario / mode / params / templateId / templateVersion / kind / driverKind`。这是可比性的硬约束 —— "想改就建新 Plan"。

### 4.3 Response

直接复用现有 `runSchema`（`Run` DTO），返回新建 Run 的完整对象，与 `useRunDetail` 同形态。

## 5. Service-Layer 设计

### 5.1 `RunService.rerun` —— 派发器

```ts
// apps/api/src/modules/run/run.service.ts
async rerun(
  sourceId: string,
  userId: string,
  body: RerunRunRequest,
): Promise<Run> {
  // 1. 加载并校验源（owner-scoped）
  const source = await this.repo.findById(sourceId);
  if (!source || source.userId !== userId) {
    throw new NotFoundException({
      code: ErrorCodes.RUN_NOT_FOUND,
      message: `Run ${sourceId} not found`,
    });
  }

  // 2. kind 校验（本期 benchmark only）
  if (source.kind !== "benchmark") {
    throw new UnprocessableEntityException({
      code: ErrorCodes.RUN_KIND_RERUN_UNSUPPORTED,
      message: `Rerun is not implemented for kind '${source.kind}' yet`,
    });
  }

  // 3. status 校验（必须 terminal）
  const TERMINAL = ["completed", "failed", "canceled"];
  if (!TERMINAL.includes(source.status)) {
    throw new ConflictException({
      code: ErrorCodes.RUN_NOT_TERMINAL,
      message: `Cannot rerun a Run in state '${source.status}'`,
    });
  }

  // 4. connection 解析（必传 + 属当前用户）
  let conn: DecryptedConnection;
  try {
    conn = await this.connections.getOwnedDecrypted(userId, body.connectionId);
  } catch {
    throw new UnprocessableEntityException({
      code: ErrorCodes.RUN_CONNECTION_NOT_USABLE,
      message: `Connection ${body.connectionId} is not usable`,
    });
  }

  // 5. 派发到 kind-specific 执行 service
  const newRun = await this.benchmarks.rerun(userId, conn, source, body);
  return runRowToContract(newRun);  // 返回 Run DTO 形态
}
```

> 注：`BenchmarkService.rerun` 返回 `RunWithRelations`（含 `connection / baselineFor` 关联），`RunService` 用现有 `runRowToContract` 转成 Run DTO，避免引入 legacy `BenchmarkRunDto` 形态到 rerun 路径。`BenchmarkService` 的依赖（`PrismaService / RunRepository / ConnectionService / BENCHMARK_DRIVER`）保持不变，`RunService` 通过 NestJS DI 注入 `BenchmarkService` 与 `ConnectionService`（在 RunModule import BenchmarkModule、ConnectionModule，见 §6）。

### 5.2 `BenchmarkService.rerun` —— benchmark kind 执行

```ts
// apps/api/src/modules/benchmark/benchmark.service.ts
async rerun(
  userId: string,
  conn: DecryptedConnection,
  source: PrismaRun,
  body: RerunRunRequest,
): Promise<RunWithRelations> {
  // 1. 派生 / 取用户传入的 name
  const name = body.name ?? this.deriveRerunName(source, await this.countReruns(userId, source.id));

  // 2. active-name 唯一性校验（与 create 共用）
  await this.assertNameAvailable(userId, name);

  // 3. 复制 source 字段 + override，写新 Run 行
  const created = await this.runs.create({
    userId,
    connectionId: conn.id,
    kind: source.kind,                 // 'benchmark'
    tool: source.tool,                 // 锁定
    scenario: source.scenario as Prisma.InputJsonValue,  // 锁定
    mode: source.mode,                 // 锁定
    driverKind: this.driverKind,       // 仍走全局 env，per-run override 推到 #59
    name,
    description: body.description ?? source.description,
    params: source.params as Prisma.InputJsonValue,      // 锁定（profile 在这里）
    templateId: source.templateId,     // 锁定（今天恒 NULL，#56 后才有值）
    templateVersion: source.templateVersion,
    parentRunId: source.id,            // 直接 source（非根）
    // baselineId 不继承 —— 由用户/前端在创建 diff 时显式选
  });

  // 4. 同步触发 driver（start() 内部更新 row 到 status='submitted' 并写 driverHandle）
  await this.start(created.id);

  // 5. 重新加载 RunWithRelations（含 connection / baselineFor 关联，给 RunService.rerun
  //    用 runRowToContract 转 Run DTO）。start() 返回的是 legacy BenchmarkRunDto，
  //    形态不同，所以这里重 fetch 一次。
  const row = await this.runs.findById(created.id);
  if (!row) {
    // 不可达：刚 create + start 完成的 row 不会消失
    throw new Error(`BenchmarkService.rerun: row ${created.id} vanished after start`);
  }
  return row;
}

private async countReruns(userId: string, sourceId: string): Promise<number> {
  return this.prisma.run.count({
    where: { userId, parentRunId: sourceId },
  });
}

private deriveRerunName(source: PrismaRun, existingCount: number): string {
  const base = source.name ?? source.id;
  return `${base} (rerun ${existingCount + 1})`;
}

// 提取已有的 active-name 校验逻辑（从 create() 抽出，二者共用）
private async assertNameAvailable(userId: string, name: string): Promise<void> {
  const dupes = await this.prisma.run.count({
    where: {
      userId,
      name,
      kind: "benchmark",
      status: { in: [...ACTIVE_STATES] },
    },
  });
  if (dupes > 0) {
    throw new ConflictException({
      code: ErrorCodes.BENCHMARK_NAME_IN_USE,
      message: `An active benchmark named '${name}' already exists`,
    });
  }
}
```

### 5.3 派生 name 的边界

- **撞名**：极端竞态下两次并发 rerun 算出同一个 N。第二次会抛 `BENCHMARK_NAME_IN_USE`，前端 toast 让用户重试或手动起名。**不**引入 advisory lock。
- **源 name 已经是 `"foo (rerun 3)"`**：派生结果 `"foo (rerun 3) (rerun 1)"`，丑但可读，按 YAGNI 接受；用户嫌丑就主动传 name。
- **源 name 是 NULL**：派生用 `source.id` 兜底（`"clxyz... (rerun 1)"`）。

## 6. 模块 Wiring（结构性 refactor）

### 6.1 现状循环依赖根因

`RunModule` 今天身兼两职：
- (a) **数据层**：`RunRepository`（Run 表的 kind-agnostic CRUD），被 `BenchmarkService` 等 kind-执行 service 消费
- (b) **API surface**：`RunController`（对外路由）

`RunController` 一旦需要派发到 kind-执行 service（rerun 是第一次，#54 的 `POST /runs` 也会撞），就形成 `RunModule → BenchmarkModule → RunModule` 循环。这不是产品设计缺陷 —— 产品分层（Run 是统一实体、kind 决定执行）是对的；NestJS 模块边界画错了。

### 6.2 Refactor：抽 `RunRepositoryModule`

```
RunRepositoryModule          (新)
  ├─ provides RunRepository
  └─ exports  RunRepository

BenchmarkModule              (改：替换 RunModule import)
  ├─ imports RunRepositoryModule, ConnectionModule
  ├─ provides BenchmarkController, BenchmarkService
  └─ exports  BenchmarkService           (新增 export，给 RunModule 派发用)

RunModule                    (改：API surface only)
  ├─ imports RunRepositoryModule, BenchmarkModule, ConnectionModule
  ├─ provides RunController, RunService
  └─ (RunService 派发到 BenchmarkService.rerun)
```

依赖单向 `RunModule → BenchmarkModule → RunRepositoryModule`，零循环。同样的 pattern 在 #54 的 `POST /runs` 和未来 e2e 接入 RunController 时直接复用。

### 6.3 影响面

- **新建文件**：`apps/api/src/modules/run/run-repository.module.ts`
- **改动**：`apps/api/src/modules/run/run.module.ts`、`apps/api/src/modules/benchmark/benchmark.module.ts`
- **不改**：`run.repository.ts` / `benchmark.service.ts`（接口不变）

## 7. 错误码（新增到 `packages/contracts/src/errors.ts`）

| 触发 | code | HTTP | 备注 |
|---|---|---|---|
| 源 Run 不存在 / 跨用户 | `RUN_NOT_FOUND` | 404 | 跨用户也返 404，不泄露存在性 |
| 源 kind 非 benchmark | `RUN_KIND_RERUN_UNSUPPORTED` | 422 | message 包含 source.kind |
| 源状态非 terminal | `RUN_NOT_TERMINAL` | 409 | message 包含 source.status |
| body.connectionId 不存在 / 不属当前用户 | `RUN_CONNECTION_NOT_USABLE` | 422 | 跨用户 connection 也归这个 |
| 派生 name 撞 active-name 唯一性 | `BENCHMARK_NAME_IN_USE`（复用） | 409 | 与 create 共用 |
| `driver.start` 抛错 | (现有路径) | 500 | row 标 failed + statusMessage 写入 |

错误码命名前缀沿用 `RUN_*`（与已有 `BENCHMARK_*` 区分 —— rerun 是 Run 层概念，name-uniqueness 才是 benchmark 层概念）。

## 8. 前端设计

### 8.1 文件清单

**新增：**
- `apps/web/src/features/baseline/api.ts` 增加 `rerunRun(sourceId: string, body: RerunRunRequest): Promise<Run>`
- `apps/web/src/features/baseline/queries.ts` 增加 `useRerunRun()` mutation
  - `onSuccess` invalidate: `historyKeys.list`、`historyKeys.detail(newRun.id)`、`baselineKeys.list`
- `apps/web/src/features/baseline/RerunDialog.tsx` 共享 dialog 组件

**改动：**
- `apps/web/src/features/history/HistoryDetailPage.tsx`：在 `rightSlot` 现有 baseline 按钮旁加 `Re-run`，仅当 `run.status ∈ {completed, failed, canceled}` 时显示；`onSuccess` 跳到 `/history/${newRun.id}`
- `apps/web/src/features/history/HistoryListPage.tsx`：每行 actions 列加 Re-run 按钮（同 status 校验），`onSuccess` toast + invalidate（不跳页）

> **Rationale for `RerunDialog` 放 `features/baseline/` 而非 `features/history/`**：rerun 是 baseline workflow 的核心动作（baseline 的存在意义就是被 rerun），跟 baseline mutations / queries 同位置语义最贴；history feature 只是消费方。

### 8.2 `RerunDialog` 组件

```ts
type Props = {
  sourceRunId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (newRun: Run) => void;
};
```

Dialog 内部：
- `useRunDetail(sourceRunId)` 拉源 Run（骨架屏 loading）
- `useConnections()` 拉用户 connections
- 顶部**只读上下文区**：`Re-running: ${source.name}` + 锁定字段 chip 行（`tool=guidellm`、`mode=throughput`、`scenario={...}`）让用户看清"这些不能改"
- **编辑区**：
  - `name` input — 占位符 `${source.name} (rerun N)`，留空走服务端派生
  - `connection` select — 预填源 connectionId（如果仍属当前用户）；否则不预选 + 提示 "Original connection no longer exists, please pick one"
  - `description` textarea — 默认源值
- 提交：调 `useRerunRun()` mutation，成功 `onSuccess(newRun)`，失败 toast 错误 message

### 8.3 i18n key（沿用现有 `history.*` 习惯）

```
history.detail.rerun.button
history.list.rerun.button
history.rerun.dialog.title
history.rerun.dialog.description
history.rerun.dialog.submit
history.rerun.dialog.cancel
history.rerun.locked.tool
history.rerun.locked.mode
history.rerun.locked.scenario
history.rerun.field.name
history.rerun.field.connection
history.rerun.field.description
history.rerun.error.connectionNotUsable
history.rerun.error.nameInUse
history.rerun.error.notTerminal
history.rerun.error.kindUnsupported
```

## 9. 测试

### 9.1 API 层（vitest@2，`apps/api`）

**`run.service.spec.ts`（rerun 派发，新增）：**
- 源不存在 → 404 `RUN_NOT_FOUND`
- 源属其他用户 → 404 `RUN_NOT_FOUND`（不泄露存在性）
- 源 kind=`e2e` → 422 `RUN_KIND_RERUN_UNSUPPORTED`
- 源 status ∈ {pending, submitted, running} → 409 `RUN_NOT_TERMINAL`（参数化覆盖三个）
- body.connectionId 不存在 → 422 `RUN_CONNECTION_NOT_USABLE`
- body.connectionId 属其他用户 → 422 `RUN_CONNECTION_NOT_USABLE`
- 全部 OK → 派发到 `BenchmarkService.rerun`（mock，断言传入 `userId / conn / source / body`）
- 返回 `BenchmarkService.rerun` 结果转成 Run DTO 形态

**`benchmark.service.spec.ts`（rerun 行为，增量）：**
- name 不传 → 按 `parentRunId count + 1` 派生
- name 不传 + 源 name=NULL → 用 source.id 兜底
- name 不传 + 已有两次 rerun → 派生 `(rerun 3)`
- name 显式传 → 直接用
- connection override 实际生效（与 source.connectionId 不同）
- tool / scenario / mode / params / templateId / templateVersion / kind 严格复制源（断言不可被 body 改）
- description 不传 → 沿用源；传 → override
- parentRunId = source.id（即使 source 自己有 parent）
- baselineId 不继承（即使 source.baselineId 非空）
- driverKind 沿用 service 实例的全局 env，不被 body 影响
- active-name 撞名 → `BENCHMARK_NAME_IN_USE`
- driver.start 抛错时 row 标 failed + 错误冒泡

**`run.controller.spec.ts`（端到端，增量）：**
- `POST /runs/:id/rerun` happy path
- 各 4xx 端到端
- 无 token → 401（JwtAuthGuard）

### 9.2 Contracts 层

**`run.spec.ts` 增量：**
- `rerunRunRequestSchema` 接受最小 body `{ connectionId }`
- 拒绝空 connectionId、name 超 128、description 超 2048

### 9.3 前端层（vitest@1，`apps/web`）

- `RerunDialog.test.tsx`：渲染锁定字段 chip、connection 预填正确、connection 不可用时不预选 + 提示、submit 调 mutation、错误 toast
- `useRerunRun` mutation 测试：`onSuccess` 触发正确 invalidate
- `HistoryDetailPage` Re-run 按钮：terminal 才显示、点击开 dialog、`onSuccess` 跳转
- `HistoryListPage` Re-run 按钮：terminal 才显示、`onSuccess` 不跳页 + toast

### 9.4 模块 wiring 测试

- `RunRepositoryModule` 导出 `RunRepository`，可被 `BenchmarkModule` 与 `RunModule` 同时 import 不报错
- 启动 NestJS app context 不出现循环依赖警告

## 10. Implementation Order（单 PR 内的 commit 序列）

1. `refactor(api): extract RunRepositoryModule to break Run/Benchmark cycle`
   — 解循环依赖，无功能变化，所有现有测试继续过
2. `feat(contracts): add RerunRunRequest schema and RUN_* error codes`
   — zod schema + 错误码常量，加 contract spec
3. `feat(api): RunController POST /runs/:id/rerun + service dispatch`
   — `RunService.rerun` + `BenchmarkService.rerun` + 共用 `assertNameAvailable` 抽出，加 service / controller spec
4. `feat(web): RerunDialog and useRerunRun mutation`
   — 共享 dialog + hook + api client，加 dialog / hook 测试
5. `feat(web): wire Re-run button into history detail and list pages`
   — 两个入口集成，加集成行为测试

每个 commit 都通过完整 `pnpm -r build && pnpm -r test && pnpm -r lint && pnpm -r type-check`。

## 11. Out-of-scope / Deferred Items

| 项 | 当前行为 | 留给 |
|---|---|---|
| per-Run `driverKind` override | 沿用全局 `BENCHMARK_DRIVER` env | #59 |
| `e2e` kind 的 rerun | 返 422 `RUN_KIND_RERUN_UNSUPPORTED` | 后续 ticket |
| `POST /runs`（generic create） | 不存在；rerun 不依赖 | #54 |
| `PATCH /runs` 与 baseline params immutability guard | rerun 不改源 Run，与此正交 | #54 follow-up |
| 独立 `BaselineListPage` | 暂用 HistoryListPage 的 `isBaseline` 过滤视图作为 Re-run 入口 | #46 |
| Rerun 与 baseline 的 diff 入口 / 对比可视化 | 仅创建新 Run，不做对比 | #45 |
| 撞 name 时服务端自动重试 | 直接抛 `BENCHMARK_NAME_IN_USE`，前端兜底 | YAGNI |

按 `feedback_temp_followups.md` 规则，这些 deferred 项会在对应 issue 上各发一条登记评论。

## 12. 关联 issue 评论计划

合 PR 后：
- **#44** 自身：贴 PR 链接 + "完成"勾选
- **#59**：评论 "rerun 路径已为 per-Run driverKind override 留好接口（`RerunRunRequest` 不含此字段；`BenchmarkService.rerun` 直接用 `this.driverKind`）；#59 落地后只需扩 schema + 改 `BenchmarkService.rerun` 一处即可启用"
- **#46**：评论 "Re-run 入口暂挂在 HistoryListPage 的 `isBaseline` 过滤视图；#46 起独立 BaselineListPage 时把按钮挪过去"
- **#54**：评论 "本期 rerun 走 `POST /runs/:id/rerun`，并已抽 `RunRepositoryModule` 解循环依赖；#54 实现 `POST /runs` (generic create) 时同模式（`RunController` 注入 `BenchmarkService` / `E2eTestService`）即可"
- **#45**：评论 "rerun 落地了，diff 引擎可以基于 `Run.parentRunId` 找候选对比对；建议 `GET /runs/:id/diff?against=<runId>` 默认 against = `source` 或 `baselineFor.runId`"
