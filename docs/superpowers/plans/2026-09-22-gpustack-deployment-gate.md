# GPUStack 部署门禁 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ModelDoctor 自动发现 GPUStack 上部署的模型服务；用户逐个开启后，每次部署变更（及可选定时）自动跑「诊断 → 质量门禁 → 压测 → Baseline 对比」，判定并通知。

**Architecture:** 新 NestJS 模块 `platform-source`：`GpustackClient`（list + watch）→ `SourceSyncService.reconcile`（唯一写入口，全量对账、指纹去重）→ `AutomationRunnerService`（DB 持久化的步骤状态机，10s tick 推进，复用 Diagnostics / QualityGate RunsService / BenchmarkService / BaselineService / NotifyService）。前端新增「部署门禁」分组：数据源页、模型列表页、模型详情页（revision 时间线）。

**Tech Stack:** NestJS 10 + Prisma + Postgres、`@nestjs/schedule`、zod（`@modeldoctor/contracts`）、Vitest 2（api 单测 + testcontainers 真库）、React + TanStack Query + shadcn/ui + react-i18next。

**Spec:** `docs/superpowers/specs/2026-09-22-gpustack-deployment-gate-design.md`

## Global Constraints

- GPUStack 零改动；只调用 `GET /v2/models`、`GET /v2/models?watch=true`、`GET /v2/model-routes`、`GET /v2/model-instances`；推理走 `<baseUrl>/v1`。鉴权 `Authorization: Bearer <apiKey>`。
- GPUStack 列表响应形如 `{ items: T[], pagination: { page, perPage, total, totalPage } }`，分页参数 `page` / `perPage`（camelCase）。
- GPUStack watch 流：`text/event-stream`，每个事件是一行紧凑 JSON 后跟 `\n\n`（**没有 `data:` 前缀**），心跳是单独的 `\n\n`。本实现只把收到的任何非空事件当作「需要对账」信号。
- 迁移只能用 `pnpm -F @modeldoctor/api exec prisma migrate dev --create-only --name <x>` 生成，不手写 SQL；**不要**运行 `prisma migrate reset`。
- API key 加密复用 `CONNECTION_API_KEY_ENCRYPTION_KEY` + `common/crypto/aes-gcm.ts`（`decodeKey` / `encrypt` / `decrypt`），不新增环境变量。
- 所有 SSRF：首个 URL 调 `assertSafeUrl`（`modules/connection/discovery/ssrf-guard.ts`）。
- 所有权：`PlatformSource.userId` 为 owner；自动建的 Connection / Benchmark / EvaluationRun / Baseline 都以该 userId 创建。
- 默认回归阈值：输出吞吐下降 > 10%、TTFT p95 上升 > 15%、ITL p95 上升 > 15%。指标读取一律用 `readMetricSafe("outputTokensPerSec" | "ttft.p95" | "itl.p95", summaryMetrics)`（`@modeldoctor/tool-adapters`）。
- Benchmark 状态拼写 `canceled`（一个 l）；终态 `completed | failed | canceled | interrupted`；AutomationRun 自己的状态用 `cancelled`（spec 定义）。
- 质量门禁 gateConfig 服务端无默认，开启自动化时若未给则写入 `{ passRateMin: 0.9 }`。
- 每个 PlatformSource 同时至多 1 个 `running` AutomationRun；同模型新 revision 到来时取消（`superseded`）其进行中的 run。
- Web：列表页遵循 `docs/project-standards.md` §5 与 `features/connections/ConnectionsPage.tsx`；详情页带 breadcrumbs；编辑用 `<Sheet>`；页面 body `px-8 py-6 space-y-6`；禁止原生 `<select>` / `confirm()`；i18n zh-CN 与 en-US 键完全对齐（`check:i18n`）。
- 提交：conventional commits，显式 `git add <files>`，commit body 以 `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` 结尾（按仓库 CLAUDE.md）。
- 新 worktree 首次需要：`cp ../main/apps/api/.env apps/api/.env && pnpm install && pnpm -r build && pnpm -F @modeldoctor/api db:generate`；api 单测需要 `modeldoctor_test` 库（`pnpm -F @modeldoctor/api db:setup:test`）。
- 不要常驻 `pnpm dev`；测试一律一次性模式（`vitest run`）。

## File Structure

```
packages/contracts/src/
  platform-source.ts                      # 全部 zod schema + 常量（Task 2）
  platform-source.spec.ts
  index.ts                                # + export
  notifications.ts                        # + 3 个事件类型（Task 9）

apps/api/prisma/schema.prisma             # 4 表 + Connection.discoveredModelId（Task 1）
apps/api/src/modules/platform-source/
  platform-source.module.ts
  gpustack/types.ts                       # GPUStack 响应类型
  gpustack/gpustack-client.ts(+.spec)     # list / ping / watch（Task 4）
  sync/fingerprint.ts(+.spec)             # 规范化、指纹、snapshot、diff（Task 3）
  sync/mapping.ts(+.spec)                 # category/serverKind/probe/route 映射（Task 3）
  sync/source-sync.service.ts(+.spec)     # reconcile（Task 6）
  sync/source-watcher.service.ts(+.spec)  # watch 生命周期（Task 7）
  sources/platform-sources.service.ts(+.spec)
  sources/platform-sources.controller.ts  # （Task 5）
  automation/regression.ts(+.spec)        # detectRegression / nextScheduleAt（Task 3）
  automation/automation-runner.service.ts(+.spec)  # 状态机（Task 8）
  automation/platform-source.cron.ts      # 3 个 @Cron（Task 8）
  models/discovered-models.service.ts(+.spec)
  models/discovered-models.controller.ts  # （Task 10）
apps/api/src/modules/notifications/...    # 事件类型（Task 9）
apps/api/test/e2e/deployment-gate.e2e-spec.ts   # 假 GPUStack 端到端（Task 11）

apps/web/src/features/deployment-gate/
  api.ts  queries.ts
  SourcesPage.tsx  SourceSheet.tsx                  # （Task 12）
  DeploymentGatePage.tsx  VerdictBadge.tsx          # （Task 13）
  ModelDetailPage.tsx  AutomationSheet.tsx  RevisionTimeline.tsx   # （Task 14）
apps/web/src/locales/{zh-CN,en-US}/deployment-gate.json
apps/web/src/router/index.tsx  components/sidebar/sidebar-config.tsx  lib/i18n.ts
```

---

### Task 1: Prisma 数据模型 + 迁移

**Files:**
- Modify: `apps/api/prisma/schema.prisma`（`User`、`Connection` 模型加反向关系；文件末尾新增 4 个 model）
- Create: `apps/api/prisma/migrations/<timestamp>_add_platform_sources/migration.sql`（由 prisma 生成）

**Interfaces:**
- Produces: Prisma models `PlatformSource`、`DiscoveredModel`、`DeploymentRevision`、`AutomationRun`；`Connection.discoveredModelId`。后续所有 task 使用 `prisma.platformSource` / `prisma.discoveredModel` / `prisma.deploymentRevision` / `prisma.automationRun`。

- [ ] **Step 1: 在 schema.prisma 末尾追加模型**

```prisma
model PlatformSource {
  id            String    @id @default(cuid())
  userId        String    @map("user_id")
  kind          String    @default("gpustack")
  name          String
  baseUrl       String    @map("base_url")
  apiKeyCipher  String    @map("api_key_cipher")
  clusterId     String?   @map("cluster_id")
  enabled       Boolean   @default(true)
  lastSyncAt    DateTime? @map("last_sync_at") @db.Timestamptz(3)
  lastSyncError String?   @map("last_sync_error") @db.Text
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt     DateTime  @updatedAt @map("updated_at") @db.Timestamptz(3)

  user   User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  models DiscoveredModel[]

  @@index([userId])
  @@map("platform_sources")
}

model DiscoveredModel {
  id                   String    @id @default(cuid())
  sourceId             String    @map("source_id")
  externalId           String    @map("external_id")
  name                 String
  categories           String[]  @default([])
  clusterId            String?   @map("cluster_id")
  status               String    @default("new")
  routeName            String?   @map("route_name")
  routeOverride        Boolean   @default(false) @map("route_override")
  connectionId         String?   @unique @map("connection_id")
  currentRevisionId    String?   @map("current_revision_id")
  automationEnabled    Boolean   @default(false) @map("automation_enabled")
  steps                String[]  @default(["diagnostics", "quality_gate", "benchmark"])
  evaluationId         String?   @map("evaluation_id")
  gateConfig           Json?     @map("gate_config")
  benchmarkTemplateId  String?   @map("benchmark_template_id")
  schedule             String    @default("off")
  nextScheduledAt      DateTime? @map("next_scheduled_at") @db.Timestamptz(3)
  baselineId           String?   @map("baseline_id")
  regressionThresholds Json?     @map("regression_thresholds")
  createdAt            DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt            DateTime  @updatedAt @map("updated_at") @db.Timestamptz(3)

  source     PlatformSource       @relation(fields: [sourceId], references: [id], onDelete: Cascade)
  connection Connection?          @relation(fields: [connectionId], references: [id], onDelete: SetNull)
  revisions  DeploymentRevision[]
  runs       AutomationRun[]

  @@unique([sourceId, externalId])
  @@index([automationEnabled, schedule, nextScheduledAt])
  @@map("discovered_models")
}

model DeploymentRevision {
  id                String    @id @default(cuid())
  discoveredModelId String    @map("discovered_model_id")
  fingerprint       String
  snapshot          Json
  firstSeenAt       DateTime  @default(now()) @map("first_seen_at") @db.Timestamptz(3)
  readyAt           DateTime? @map("ready_at") @db.Timestamptz(3)

  model DiscoveredModel @relation(fields: [discoveredModelId], references: [id], onDelete: Cascade)
  runs  AutomationRun[]

  @@unique([discoveredModelId, fingerprint])
  @@map("deployment_revisions")
}

model AutomationRun {
  id                String    @id @default(cuid())
  discoveredModelId String    @map("discovered_model_id")
  sourceId          String    @map("source_id")
  revisionId        String    @map("revision_id")
  trigger           String
  triggerKey        String    @unique @map("trigger_key")
  status            String    @default("pending")
  currentStep       String?   @map("current_step")
  verdict           String?
  diagnosticsRunId  String?   @map("diagnostics_run_id")
  evaluationRunId   String?   @map("evaluation_run_id")
  benchmarkId       String?   @map("benchmark_id")
  summary           Json?
  lockedUntil       DateTime? @map("locked_until") @db.Timestamptz(3)
  startedAt         DateTime? @map("started_at") @db.Timestamptz(3)
  finishedAt        DateTime? @map("finished_at") @db.Timestamptz(3)
  createdAt         DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)

  model    DiscoveredModel    @relation(fields: [discoveredModelId], references: [id], onDelete: Cascade)
  revision DeploymentRevision @relation(fields: [revisionId], references: [id], onDelete: Cascade)

  @@index([discoveredModelId, createdAt])
  @@index([sourceId, status, createdAt])
  @@map("automation_runs")
}
```

注：`AutomationRun.sourceId` 是冗余字段（spec 未列），用于按源串行调度时免 join；属于实现细节，在 PR 描述里说明。

- [ ] **Step 2: 加反向关系**

在 `model User { ... }` 中加一行 `platformSources PlatformSource[]`；在 `model Connection { ... }` 中加一行 `discoveredModel DiscoveredModel?`（关系外键在 `DiscoveredModel.connectionId` 一侧，spec 中的 `Connection.discoveredModelId` 以这个一对一反向关系实现，不另加列）。

- [ ] **Step 3: 生成迁移（不应用到共享库以外）**

Run: `pnpm -F @modeldoctor/api exec prisma migrate dev --create-only --name add_platform_sources`
Expected: 新目录 `apps/api/prisma/migrations/<ts>_add_platform_sources/`，SQL 只含 `CREATE TABLE` / `CREATE INDEX` / `ALTER TABLE ... ADD CONSTRAINT`。若提示 drift 需要 reset：**停下并报告用户**，不要 reset。

- [ ] **Step 4: 应用 + 生成 client**

Run: `pnpm -F @modeldoctor/api exec prisma migrate dev && pnpm -F @modeldoctor/api db:generate && pnpm -F @modeldoctor/api db:setup:test`
Expected: 迁移应用成功；`db:setup:test` 成功。

- [ ] **Step 5: typecheck**

Run: `pnpm -F @modeldoctor/api type-check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/*_add_platform_sources
git commit -m "feat(platform-source): prisma 数据模型 — 数据源/发现模型/部署版本/自动化运行"
```

---

### Task 2: Contracts — platform-source schemas

**Files:**
- Create: `packages/contracts/src/platform-source.ts`
- Create: `packages/contracts/src/platform-source.spec.ts`
- Modify: `packages/contracts/src/index.ts`（加 `export * from "./platform-source.js";`）

**Interfaces:**
- Consumes: `gateConfigSchema` from `./quality-gate/runs.js`
- Produces（后续 task 用到的精确名字）：`platformSourceKindSchema`、`createPlatformSourceSchema`/`CreatePlatformSource`、`updatePlatformSourceSchema`/`UpdatePlatformSource`、`platformSourceSchema`/`PlatformSource`、`testPlatformSourceResponseSchema`/`TestPlatformSourceResponse`、`discoveredModelStatusSchema`/`DiscoveredModelStatus`、`AUTOMATION_STEPS`、`automationStepSchema`/`AutomationStep`、`automationScheduleSchema`/`AutomationSchedule`、`regressionThresholdsSchema`/`RegressionThresholds`、`DEFAULT_REGRESSION_THRESHOLDS`、`DEFAULT_GATE_CONFIG`、`automationTriggerSchema`/`AutomationTrigger`、`automationRunStatusSchema`/`AutomationRunStatus`、`automationVerdictSchema`/`AutomationVerdict`、`automationSummarySchema`/`AutomationSummary`、`regressionMetricSchema`/`RegressionMetric`、`automationRunSchema`/`AutomationRunPublic`、`discoveredModelSchema`/`DiscoveredModelPublic`、`updateDiscoveredModelSchema`/`UpdateDiscoveredModel`、`snapshotDiffEntrySchema`/`SnapshotDiffEntry`、`deploymentRevisionSchema`/`DeploymentRevisionPublic`、`listDiscoveredModelsQuerySchema`/`ListDiscoveredModelsQuery`、`gpustackRouteOptionSchema`/`GpustackRouteOption`

- [ ] **Step 1: 写失败测试 `platform-source.spec.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  createPlatformSourceSchema,
  DEFAULT_REGRESSION_THRESHOLDS,
  updateDiscoveredModelSchema,
} from "./platform-source.js";

describe("platform-source contracts", () => {
  it("createPlatformSourceSchema defaults kind to gpustack and strips trailing slash", () => {
    const r = createPlatformSourceSchema.parse({
      name: "prod",
      baseUrl: "http://gpustack.local/",
      apiKey: "gpustack_xxx",
    });
    expect(r.kind).toBe("gpustack");
    expect(r.baseUrl).toBe("http://gpustack.local");
  });

  it("rejects empty steps", () => {
    expect(updateDiscoveredModelSchema.safeParse({ steps: [] }).success).toBe(false);
  });

  it("rejects unknown step", () => {
    expect(updateDiscoveredModelSchema.safeParse({ steps: ["foo"] }).success).toBe(false);
  });

  it("exports default thresholds from spec", () => {
    expect(DEFAULT_REGRESSION_THRESHOLDS).toEqual({
      outputTokensPerSecDropPct: 10,
      ttftP95RisePct: 15,
      itlP95RisePct: 15,
    });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm -F @modeldoctor/contracts test -- src/platform-source.spec.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `platform-source.ts`**

```ts
import { z } from "zod";
import { gateConfigSchema } from "./quality-gate/runs.js";

export const platformSourceKindSchema = z.enum(["gpustack"]);
export type PlatformSourceKind = z.infer<typeof platformSourceKindSchema>;

const baseUrlSchema = z
  .string()
  .url()
  .transform((u) => u.replace(/\/+$/, ""));

export const createPlatformSourceSchema = z.object({
  kind: platformSourceKindSchema.default("gpustack"),
  name: z.string().min(1).max(120),
  baseUrl: baseUrlSchema,
  apiKey: z.string().min(1),
  clusterId: z.string().min(1).nullable().optional(),
});
export type CreatePlatformSource = z.infer<typeof createPlatformSourceSchema>;

export const updatePlatformSourceSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  baseUrl: baseUrlSchema.optional(),
  apiKey: z.string().min(1).optional(),
  clusterId: z.string().min(1).nullable().optional(),
  enabled: z.boolean().optional(),
});
export type UpdatePlatformSource = z.infer<typeof updatePlatformSourceSchema>;

export const platformSourceSchema = z.object({
  id: z.string(),
  kind: platformSourceKindSchema,
  name: z.string(),
  baseUrl: z.string(),
  clusterId: z.string().nullable(),
  enabled: z.boolean(),
  lastSyncAt: z.string().nullable(),
  lastSyncError: z.string().nullable(),
  modelCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PlatformSource = z.infer<typeof platformSourceSchema>;

export const testPlatformSourceResponseSchema = z.object({
  ok: z.boolean(),
  modelCount: z.number().int().nullable(),
  error: z.string().nullable(),
});
export type TestPlatformSourceResponse = z.infer<typeof testPlatformSourceResponseSchema>;

export const discoveredModelStatusSchema = z.enum(["new", "active", "unroutable", "removed"]);
export type DiscoveredModelStatus = z.infer<typeof discoveredModelStatusSchema>;

export const AUTOMATION_STEPS = ["diagnostics", "quality_gate", "benchmark"] as const;
export const automationStepSchema = z.enum(AUTOMATION_STEPS);
export type AutomationStep = z.infer<typeof automationStepSchema>;

export const automationScheduleSchema = z.enum(["off", "daily", "weekly"]);
export type AutomationSchedule = z.infer<typeof automationScheduleSchema>;

export const regressionThresholdsSchema = z.object({
  outputTokensPerSecDropPct: z.number().min(0).max(100),
  ttftP95RisePct: z.number().min(0).max(1000),
  itlP95RisePct: z.number().min(0).max(1000),
});
export type RegressionThresholds = z.infer<typeof regressionThresholdsSchema>;

export const DEFAULT_REGRESSION_THRESHOLDS: RegressionThresholds = {
  outputTokensPerSecDropPct: 10,
  ttftP95RisePct: 15,
  itlP95RisePct: 15,
};

export const DEFAULT_GATE_CONFIG = { passRateMin: 0.9 } as const;

export const automationTriggerSchema = z.enum(["enable", "revision", "schedule", "manual"]);
export type AutomationTrigger = z.infer<typeof automationTriggerSchema>;

export const automationRunStatusSchema = z.enum(["pending", "running", "completed", "cancelled"]);
export type AutomationRunStatus = z.infer<typeof automationRunStatusSchema>;

export const automationVerdictSchema = z.enum([
  "passed",
  "failed",
  "regressed",
  "error",
  "superseded",
]);
export type AutomationVerdict = z.infer<typeof automationVerdictSchema>;

export const regressionMetricSchema = z.object({
  metric: z.enum(["outputTokensPerSec", "ttft.p95", "itl.p95"]),
  baseline: z.number().nullable(),
  current: z.number().nullable(),
  changePct: z.number().nullable(),
  thresholdPct: z.number(),
  exceeded: z.boolean(),
});
export type RegressionMetric = z.infer<typeof regressionMetricSchema>;

export const automationSummarySchema = z.object({
  steps: z.array(
    z.object({
      step: z.union([automationStepSchema, z.literal("compare")]),
      outcome: z.enum(["ok", "failed", "error", "skipped"]),
      message: z.string().optional(),
    }),
  ),
  regression: z
    .object({
      compared: z.boolean(),
      reason: z.string().optional(),
      baselineId: z.string().optional(),
      metrics: z.array(regressionMetricSchema),
    })
    .optional(),
  baselineEstablished: z.boolean().optional(),
  gateWarning: z.boolean().optional(),
});
export type AutomationSummary = z.infer<typeof automationSummarySchema>;

export const automationRunSchema = z.object({
  id: z.string(),
  discoveredModelId: z.string(),
  revisionId: z.string(),
  trigger: automationTriggerSchema,
  status: automationRunStatusSchema,
  currentStep: z.string().nullable(),
  verdict: automationVerdictSchema.nullable(),
  diagnosticsRunId: z.string().nullable(),
  evaluationRunId: z.string().nullable(),
  benchmarkId: z.string().nullable(),
  summary: automationSummarySchema.nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type AutomationRunPublic = z.infer<typeof automationRunSchema>;

export const discoveredModelSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  sourceName: z.string(),
  externalId: z.string(),
  name: z.string(),
  categories: z.array(z.string()),
  clusterId: z.string().nullable(),
  status: discoveredModelStatusSchema,
  routeName: z.string().nullable(),
  routeOverride: z.boolean(),
  connectionId: z.string().nullable(),
  currentRevision: z
    .object({
      id: z.string(),
      fingerprint: z.string(),
      backend: z.string().nullable(),
      backendVersion: z.string().nullable(),
      readyAt: z.string().nullable(),
    })
    .nullable(),
  automationEnabled: z.boolean(),
  steps: z.array(automationStepSchema),
  evaluationId: z.string().nullable(),
  gateConfig: gateConfigSchema.nullable(),
  benchmarkTemplateId: z.string().nullable(),
  schedule: automationScheduleSchema,
  nextScheduledAt: z.string().nullable(),
  baselineId: z.string().nullable(),
  regressionThresholds: regressionThresholdsSchema.nullable(),
  lastRun: automationRunSchema.nullable(),
});
export type DiscoveredModelPublic = z.infer<typeof discoveredModelSchema>;

export const updateDiscoveredModelSchema = z.object({
  automationEnabled: z.boolean().optional(),
  steps: z.array(automationStepSchema).min(1).optional(),
  evaluationId: z.string().min(1).nullable().optional(),
  gateConfig: gateConfigSchema.nullable().optional(),
  benchmarkTemplateId: z.string().min(1).nullable().optional(),
  schedule: automationScheduleSchema.optional(),
  baselineId: z.string().min(1).nullable().optional(),
  regressionThresholds: regressionThresholdsSchema.nullable().optional(),
  /** 手动指定 GPUStack 路由名（置 routeOverride=true）；null = 恢复自动解析 */
  routeName: z.string().min(1).nullable().optional(),
});
export type UpdateDiscoveredModel = z.infer<typeof updateDiscoveredModelSchema>;

export const listDiscoveredModelsQuerySchema = z.object({
  sourceId: z.string().optional(),
  status: discoveredModelStatusSchema.optional(),
  automationEnabled: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});
export type ListDiscoveredModelsQuery = z.infer<typeof listDiscoveredModelsQuerySchema>;

export const snapshotDiffEntrySchema = z.object({
  field: z.string(),
  before: z.unknown(),
  after: z.unknown(),
});
export type SnapshotDiffEntry = z.infer<typeof snapshotDiffEntrySchema>;

export const deploymentRevisionSchema = z.object({
  id: z.string(),
  fingerprint: z.string(),
  snapshot: z.record(z.unknown()),
  firstSeenAt: z.string(),
  readyAt: z.string().nullable(),
  diff: z.array(snapshotDiffEntrySchema),
  runs: z.array(automationRunSchema),
});
export type DeploymentRevisionPublic = z.infer<typeof deploymentRevisionSchema>;

export const gpustackRouteOptionSchema = z.object({
  name: z.string(),
  targets: z.number().int(),
  createdModelId: z.string().nullable(),
});
export type GpustackRouteOption = z.infer<typeof gpustackRouteOptionSchema>;
```

- [ ] **Step 4: 导出 + 运行测试**

在 `packages/contracts/src/index.ts` 追加 `export * from "./platform-source.js";`

Run: `pnpm -F @modeldoctor/contracts test -- src/platform-source.spec.ts && pnpm -F @modeldoctor/contracts build`
Expected: PASS；build 成功

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/platform-source.ts packages/contracts/src/platform-source.spec.ts packages/contracts/src/index.ts
git commit -m "feat(contracts): platform-source / 部署门禁 schemas"
```

---

### Task 3: 纯函数 — 指纹、映射、回归判定、定时

**Files:**
- Create: `apps/api/src/modules/platform-source/gpustack/types.ts`
- Create: `apps/api/src/modules/platform-source/sync/fingerprint.ts` + `fingerprint.spec.ts`
- Create: `apps/api/src/modules/platform-source/sync/mapping.ts` + `mapping.spec.ts`
- Create: `apps/api/src/modules/platform-source/automation/regression.ts` + `regression.spec.ts`

**Interfaces:**
- Produces:
  - `types.ts`: `GpustackModel`、`GpustackInstance`、`GpustackRoute`、`GpustackPage<T>`
  - `fingerprint.ts`: `FINGERPRINT_FIELDS: readonly string[]`、`canonicalize(v: unknown): unknown`、`deploymentFingerprint(m: GpustackModel): string`、`buildSnapshot(m: GpustackModel, instances: GpustackInstance[]): Record<string, unknown>`、`diffSnapshots(prev: Record<string, unknown> | null, next: Record<string, unknown>): SnapshotDiffEntry[]`
  - `mapping.ts`: `toModalityCategory(categories: string[]): ModalityCategory`、`toServerKind(backend: string | null | undefined): ServerKind`、`toProbes(categories: string[]): ProbeName[]`、`resolveDedicatedRoute(modelId: number, routes: GpustackRoute[]): string | null`、`tokenizerFromSource(m: GpustackModel): string | null`
  - `regression.ts`: `detectRegression(input: { baseline: unknown; candidate: unknown; thresholds: RegressionThresholds }): { regressed: boolean; metrics: RegressionMetric[] }`、`nextScheduleAt(schedule: AutomationSchedule, from: Date): Date | null`

- [ ] **Step 1: 写 `gpustack/types.ts`（无测试，纯类型）**

```ts
/** GPUStack `/v2` 响应的子集 —— 只声明本模块读取的字段（snake_case 原样）。 */
export interface GpustackPage<T> {
  items: T[];
  pagination: { page: number; perPage: number; total: number; totalPage: number };
}

export interface GpustackModel {
  id: number;
  name: string;
  categories?: string[] | null;
  cluster_id?: number | null;
  replicas?: number;
  ready_replicas?: number;
  backend?: string | null;
  backend_version?: string | null;
  backend_parameters?: string[] | null;
  image_name?: string | null;
  run_command?: string | null;
  env?: Record<string, string> | null;
  gpu_selector?: unknown;
  gpu_type_selector?: unknown;
  worker_selector?: Record<string, string> | null;
  extended_kv_cache?: unknown;
  placement_strategy?: string | null;
  distributed_inference_across_workers?: boolean | null;
  cpu_offloading?: boolean | null;
  source?: string | null;
  huggingface_repo_id?: string | null;
  huggingface_filename?: string | null;
  model_scope_model_id?: string | null;
  model_scope_file_path?: string | null;
  local_path?: string | null;
}

export interface GpustackInstance {
  id: number;
  model_id: number;
  state: string;
  worker_name?: string | null;
  gpu_type?: string | null;
  gpu_indexes?: number[] | null;
  api_detected_backend_version?: string | null;
}

export interface GpustackRoute {
  id: number;
  name: string;
  effective_name?: string | null;
  created_model_id?: number | null;
  targets: number;
}
```

- [ ] **Step 2: 写失败测试 `sync/fingerprint.spec.ts`**

```ts
import { describe, expect, it } from "vitest";
import type { GpustackModel } from "../gpustack/types.js";
import { buildSnapshot, canonicalize, deploymentFingerprint, diffSnapshots } from "./fingerprint.js";

const base: GpustackModel = {
  id: 1,
  name: "qwen",
  backend: "vLLM",
  backend_version: "0.10.1",
  backend_parameters: ["--max-num-seqs=256", "--enable-prefix-caching"],
  env: { B: "2", A: "1" },
  replicas: 1,
  ready_replicas: 1,
  source: "huggingface",
  huggingface_repo_id: "Qwen/Qwen3-8B",
};

describe("canonicalize", () => {
  it("sorts object keys recursively and drops null/undefined", () => {
    expect(canonicalize({ b: 1, a: { d: null, c: 2 }, e: undefined })).toEqual({ a: { c: 2 }, b: 1 });
  });
  it("keeps array order", () => {
    expect(canonicalize(["b", "a"])).toEqual(["b", "a"]);
  });
});

describe("deploymentFingerprint", () => {
  it("ignores replicas / ready_replicas / name", () => {
    const a = deploymentFingerprint(base);
    const b = deploymentFingerprint({ ...base, replicas: 4, ready_replicas: 0, name: "renamed" });
    expect(a).toBe(b);
  });
  it("is stable under env key order and null vs missing", () => {
    const a = deploymentFingerprint(base);
    const b = deploymentFingerprint({ ...base, env: { A: "1", B: "2" }, image_name: null });
    expect(a).toBe(b);
  });
  it("changes when backend_parameters change", () => {
    const a = deploymentFingerprint(base);
    const b = deploymentFingerprint({ ...base, backend_parameters: ["--max-num-seqs=512", "--enable-prefix-caching"] });
    expect(a).not.toBe(b);
  });
  it("changes when backend_version changes", () => {
    expect(deploymentFingerprint(base)).not.toBe(deploymentFingerprint({ ...base, backend_version: "0.11.0" }));
  });
  it("returns 64-char hex", () => {
    expect(deploymentFingerprint(base)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("buildSnapshot", () => {
  it("includes fingerprint fields plus running-instance display info", () => {
    const s = buildSnapshot(base, [
      { id: 9, model_id: 1, state: "running", worker_name: "w1", gpu_type: "A100", gpu_indexes: [0, 1], api_detected_backend_version: "0.10.1" },
      { id: 10, model_id: 1, state: "error", worker_name: "w2" },
    ]);
    expect(s.backend_version).toBe("0.10.1");
    expect(s.instances).toEqual([
      { worker: "w1", gpuType: "A100", gpuCount: 2, detectedBackendVersion: "0.10.1" },
    ]);
  });
});

describe("diffSnapshots", () => {
  it("returns all non-empty fields when prev is null", () => {
    const d = diffSnapshots(null, { backend: "vLLM" });
    expect(d).toEqual([{ field: "backend", before: null, after: "vLLM" }]);
  });
  it("returns only changed fields", () => {
    const d = diffSnapshots(
      { backend: "vLLM", backend_version: "0.10.1", instances: [] },
      { backend: "vLLM", backend_version: "0.11.0", instances: [] },
    );
    expect(d).toEqual([{ field: "backend_version", before: "0.10.1", after: "0.11.0" }]);
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm -F @modeldoctor/api test -- src/modules/platform-source/sync/fingerprint.spec.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 4: 实现 `sync/fingerprint.ts`**

```ts
import { createHash } from "node:crypto";
import type { SnapshotDiffEntry } from "@modeldoctor/contracts";
import type { GpustackInstance, GpustackModel } from "../gpustack/types.js";

/** 进入部署指纹的字段（spec §5.2 第 5 步）。replicas / name / meta 等刻意排除。 */
export const FINGERPRINT_FIELDS = [
  "backend",
  "backend_version",
  "backend_parameters",
  "image_name",
  "run_command",
  "env",
  "gpu_selector",
  "gpu_type_selector",
  "worker_selector",
  "extended_kv_cache",
  "placement_strategy",
  "distributed_inference_across_workers",
  "cpu_offloading",
  "source",
  "huggingface_repo_id",
  "huggingface_filename",
  "model_scope_model_id",
  "model_scope_file_path",
  "local_path",
] as const;

/** key 排序、丢弃 null/undefined（null 与缺失等价）、数组保序。 */
export function canonicalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const val = (v as Record<string, unknown>)[k];
      if (val === null || val === undefined) continue;
      out[k] = canonicalize(val);
    }
    return out;
  }
  return v;
}

function pickFingerprintFields(m: GpustackModel): Record<string, unknown> {
  const src = m as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const f of FINGERPRINT_FIELDS) out[f] = src[f];
  return out;
}

export function deploymentFingerprint(m: GpustackModel): string {
  const canonical = canonicalize(pickFingerprintFields(m));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function buildSnapshot(
  m: GpustackModel,
  instances: GpustackInstance[],
): Record<string, unknown> {
  const fields = canonicalize(pickFingerprintFields(m)) as Record<string, unknown>;
  const running = instances
    .filter((i) => i.model_id === m.id && i.state === "running")
    .map((i) => ({
      worker: i.worker_name ?? null,
      gpuType: i.gpu_type ?? null,
      gpuCount: i.gpu_indexes?.length ?? 0,
      detectedBackendVersion: i.api_detected_backend_version ?? null,
    }));
  return { ...fields, instances: running };
}

export function diffSnapshots(
  prev: Record<string, unknown> | null,
  next: Record<string, unknown>,
): SnapshotDiffEntry[] {
  const keys = new Set([...Object.keys(prev ?? {}), ...Object.keys(next)]);
  keys.delete("instances"); // 展示信息，不参与 diff
  const out: SnapshotDiffEntry[] = [];
  for (const field of [...keys].sort()) {
    const before = prev?.[field] ?? null;
    const after = next[field] ?? null;
    if (JSON.stringify(canonicalize(before)) !== JSON.stringify(canonicalize(after))) {
      out.push({ field, before, after });
    }
  }
  return out;
}
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm -F @modeldoctor/api test -- src/modules/platform-source/sync/fingerprint.spec.ts`
Expected: PASS

- [ ] **Step 6: 写失败测试 `sync/mapping.spec.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  resolveDedicatedRoute,
  tokenizerFromSource,
  toModalityCategory,
  toProbes,
  toServerKind,
} from "./mapping.js";

describe("toModalityCategory", () => {
  it.each([
    [["llm"], "chat"],
    [["embedding"], "embeddings"],
    [["reranker"], "rerank"],
    [["image"], "image"],
    [["speech_to_text"], "audio"],
    [["text_to_speech"], "audio"],
    [[], "chat"],
    [["unknown"], "chat"],
  ])("%j -> %s", (cats, expected) => {
    expect(toModalityCategory(cats)).toBe(expected);
  });
});

describe("toServerKind", () => {
  it("lowercases known engines", () => {
    expect(toServerKind("vLLM")).toBe("vllm");
    expect(toServerKind("SGLang")).toBe("sglang");
    expect(toServerKind("MindIE")).toBe("mindie");
  });
  it("falls back to generic", () => {
    expect(toServerKind("vox-box")).toBe("generic");
    expect(toServerKind(null)).toBe("generic");
  });
});

describe("toProbes", () => {
  it.each([
    [["llm"], ["chat-text"]],
    [["embedding"], ["embeddings-openai"]],
    [["reranker"], ["rerank-cohere"]],
    [["image"], ["image-gen"]],
    [["text_to_speech"], ["tts"]],
    [["speech_to_text"], ["asr"]],
    [[], ["chat-text"]],
  ])("%j -> %j", (cats, expected) => {
    expect(toProbes(cats)).toEqual(expected);
  });
});

describe("resolveDedicatedRoute", () => {
  const routes = [
    { id: 1, name: "shared", created_model_id: 7, targets: 2 },
    { id: 2, name: "qwen", effective_name: "org/qwen", created_model_id: 7, targets: 1 },
    { id: 3, name: "other", created_model_id: 8, targets: 1 },
  ];
  it("prefers effective_name of single-target route created for the model", () => {
    expect(resolveDedicatedRoute(7, routes)).toBe("org/qwen");
  });
  it("falls back to name when effective_name missing", () => {
    expect(resolveDedicatedRoute(8, routes)).toBe("other");
  });
  it("returns null when no dedicated route", () => {
    expect(resolveDedicatedRoute(9, routes)).toBeNull();
  });
});

describe("tokenizerFromSource", () => {
  it("uses huggingface repo id", () => {
    expect(tokenizerFromSource({ id: 1, name: "x", source: "huggingface", huggingface_repo_id: "Qwen/Qwen3-8B" })).toBe("Qwen/Qwen3-8B");
  });
  it("uses modelscope id", () => {
    expect(tokenizerFromSource({ id: 1, name: "x", source: "model_scope", model_scope_model_id: "Qwen/Qwen3-8B" })).toBe("Qwen/Qwen3-8B");
  });
  it("null for local path", () => {
    expect(tokenizerFromSource({ id: 1, name: "x", source: "local_path", local_path: "/m" })).toBeNull();
  });
});
```

- [ ] **Step 7: 运行确认失败**

Run: `pnpm -F @modeldoctor/api test -- src/modules/platform-source/sync/mapping.spec.ts`
Expected: FAIL

- [ ] **Step 8: 实现 `sync/mapping.ts`**

```ts
import {
  ENGINE_IDS,
  type ModalityCategory,
  type ProbeName,
  type ServerKind,
} from "@modeldoctor/contracts";
import type { GpustackModel, GpustackRoute } from "../gpustack/types.js";

const CATEGORY_MAP: Record<string, ModalityCategory> = {
  llm: "chat",
  embedding: "embeddings",
  reranker: "rerank",
  image: "image",
  speech_to_text: "audio",
  text_to_speech: "audio",
};

export function toModalityCategory(categories: string[]): ModalityCategory {
  for (const c of categories) {
    const hit = CATEGORY_MAP[c];
    if (hit) return hit;
  }
  return "chat";
}

export function toServerKind(backend: string | null | undefined): ServerKind {
  const k = (backend ?? "").toLowerCase();
  return (ENGINE_IDS as readonly string[]).includes(k) ? (k as ServerKind) : "generic";
}

const PROBE_MAP: Record<string, ProbeName> = {
  llm: "chat-text",
  embedding: "embeddings-openai",
  reranker: "rerank-cohere",
  image: "image-gen",
  text_to_speech: "tts",
  speech_to_text: "asr",
};

export function toProbes(categories: string[]): ProbeName[] {
  for (const c of categories) {
    const hit = PROBE_MAP[c];
    if (hit) return [hit];
  }
  return ["chat-text"];
}

/** 只指向该模型、且由该模型创建的单目标路由（spec §5.2 第 3 步）。 */
export function resolveDedicatedRoute(modelId: number, routes: GpustackRoute[]): string | null {
  const r = routes.find((x) => x.created_model_id === modelId && x.targets === 1);
  if (!r) return null;
  return r.effective_name || r.name;
}

export function tokenizerFromSource(m: GpustackModel): string | null {
  if (m.source === "huggingface") return m.huggingface_repo_id ?? null;
  if (m.source === "model_scope") return m.model_scope_model_id ?? null;
  return null;
}
```

检查：`ProbeName` 类型若在 contracts 中名称不同（`probeNameSchema` 的 infer 类型），用 `grep -n "probeNameSchema" packages/contracts/src/diagnostics.ts` 确认导出的 type 名；若只导出 schema，在 mapping.ts 中 `type ProbeName = z.infer<typeof probeNameSchema>`，并在本 task 结尾报告这一偏差。GPUStack `source` 取值用 `grep -n "class SourceEnum" -A8 ~/workspace/gpustack/gpustack/gpustack/schemas/models.py` 确认（期望 `huggingface` / `model_scope` / `local_path`），不一致时按实际值修正测试与实现。

- [ ] **Step 9: 运行确认通过**

Run: `pnpm -F @modeldoctor/api test -- src/modules/platform-source/sync/mapping.spec.ts`
Expected: PASS

- [ ] **Step 10: 写失败测试 `automation/regression.spec.ts`**

```ts
import { DEFAULT_REGRESSION_THRESHOLDS } from "@modeldoctor/contracts";
import { describe, expect, it } from "vitest";
import { detectRegression, nextScheduleAt } from "./regression.js";

function guidellm(tps: number, ttftP95: number, itlP95: number) {
  return {
    tool: "guidellm",
    data: {
      outputTokensPerSecond: { mean: tps },
      ttft: { mean: 0, p50: 0, p90: 0, p95: ttftP95, p99: 0 },
      itl: { mean: 0, p50: 0, p90: 0, p95: itlP95, p99: 0 },
    },
  };
}

describe("detectRegression", () => {
  const t = DEFAULT_REGRESSION_THRESHOLDS;

  it("passes when within thresholds", () => {
    const r = detectRegression({ baseline: guidellm(1000, 100, 20), candidate: guidellm(950, 110, 22), thresholds: t });
    expect(r.regressed).toBe(false);
    expect(r.metrics.find((m) => m.metric === "outputTokensPerSec")?.changePct).toBeCloseTo(-5);
  });

  it("flags throughput drop > 10%", () => {
    const r = detectRegression({ baseline: guidellm(1000, 100, 20), candidate: guidellm(880, 100, 20), thresholds: t });
    expect(r.regressed).toBe(true);
    expect(r.metrics.find((m) => m.metric === "outputTokensPerSec")?.exceeded).toBe(true);
  });

  it("flags ttft p95 rise > 15%", () => {
    const r = detectRegression({ baseline: guidellm(1000, 100, 20), candidate: guidellm(1000, 116, 20), thresholds: t });
    expect(r.regressed).toBe(true);
  });

  it("exactly at threshold is not exceeded", () => {
    const r = detectRegression({ baseline: guidellm(1000, 100, 20), candidate: guidellm(900, 115, 23), thresholds: t });
    expect(r.regressed).toBe(false);
  });

  it("missing metric is reported but never exceeded", () => {
    const r = detectRegression({ baseline: { tool: "guidellm", data: {} }, candidate: guidellm(1, 1, 1), thresholds: t });
    expect(r.regressed).toBe(false);
    expect(r.metrics.every((m) => m.changePct === null)).toBe(true);
  });
});

describe("nextScheduleAt", () => {
  const from = new Date("2026-09-22T00:00:00Z");
  it("off -> null", () => expect(nextScheduleAt("off", from)).toBeNull());
  it("daily -> +24h", () => expect(nextScheduleAt("daily", from)?.toISOString()).toBe("2026-09-23T00:00:00.000Z"));
  it("weekly -> +7d", () => expect(nextScheduleAt("weekly", from)?.toISOString()).toBe("2026-09-29T00:00:00.000Z"));
});
```

- [ ] **Step 11: 运行确认失败**

Run: `pnpm -F @modeldoctor/api test -- src/modules/platform-source/automation/regression.spec.ts`
Expected: FAIL

- [ ] **Step 12: 实现 `automation/regression.ts`**

```ts
import type {
  AutomationSchedule,
  RegressionMetric,
  RegressionThresholds,
} from "@modeldoctor/contracts";
import { readMetricSafe } from "@modeldoctor/tool-adapters";

type Summary = { tool?: unknown; data?: unknown } | null;

const RULES: Array<{
  metric: RegressionMetric["metric"];
  /** 变化方向：'drop' 表示下降为坏，'rise' 表示上升为坏 */
  bad: "drop" | "rise";
  threshold: (t: RegressionThresholds) => number;
}> = [
  { metric: "outputTokensPerSec", bad: "drop", threshold: (t) => t.outputTokensPerSecDropPct },
  { metric: "ttft.p95", bad: "rise", threshold: (t) => t.ttftP95RisePct },
  { metric: "itl.p95", bad: "rise", threshold: (t) => t.itlP95RisePct },
];

export function detectRegression(input: {
  baseline: unknown;
  candidate: unknown;
  thresholds: RegressionThresholds;
}): { regressed: boolean; metrics: RegressionMetric[] } {
  const metrics = RULES.map((r): RegressionMetric => {
    const baseline = readMetricSafe(r.metric, input.baseline as Summary);
    const current = readMetricSafe(r.metric, input.candidate as Summary);
    const thresholdPct = r.threshold(input.thresholds);
    if (baseline == null || current == null || baseline === 0) {
      return { metric: r.metric, baseline, current, changePct: null, thresholdPct, exceeded: false };
    }
    const changePct = ((current - baseline) / baseline) * 100;
    const exceeded = r.bad === "drop" ? -changePct > thresholdPct : changePct > thresholdPct;
    return { metric: r.metric, baseline, current, changePct, thresholdPct, exceeded };
  });
  return { regressed: metrics.some((m) => m.exceeded), metrics };
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function nextScheduleAt(schedule: AutomationSchedule, from: Date): Date | null {
  if (schedule === "daily") return new Date(from.getTime() + DAY_MS);
  if (schedule === "weekly") return new Date(from.getTime() + 7 * DAY_MS);
  return null;
}
```

注意浮点：`(900-1000)/1000*100 = -10` 精确；`(115-100)/100*100 = 15` 精确；测试的「恰好等于阈值」依赖这两个值，若出现 `15.000000000000002` 之类的误差，改成 `Math.round(changePct * 1e6) / 1e6` 后再比较，并同样用于返回值。

- [ ] **Step 13: 运行确认通过 + lint**

Run: `pnpm -F @modeldoctor/api test -- src/modules/platform-source && pnpm -F @modeldoctor/api exec biome check src/modules/platform-source`
Expected: PASS

- [ ] **Step 14: Commit**

```bash
git add apps/api/src/modules/platform-source
git commit -m "feat(platform-source): 指纹/映射/回归判定纯函数"
```

---

### Task 4: GpustackClient（list / ping / watch）

**Files:**
- Create: `apps/api/src/modules/platform-source/gpustack/gpustack-client.ts`
- Create: `apps/api/src/modules/platform-source/gpustack/gpustack-client.spec.ts`

**Interfaces:**
- Consumes: `GpustackModel`、`GpustackRoute`、`GpustackInstance`、`GpustackPage` from `./types.js`；`assertSafeUrl` from `../../connection/discovery/ssrf-guard.js`
- Produces:
  - `class GpustackError extends Error { status: number | null }`
  - `class GpustackClient { constructor(baseUrl: string, apiKey: string, fetchImpl?: typeof fetch); listModels(): Promise<GpustackModel[]>; listRoutes(): Promise<GpustackRoute[]>; listInstances(): Promise<GpustackInstance[]>; countModels(): Promise<number>; watchModels(opts: { signal: AbortSignal; onEvent: () => void; heartbeatTimeoutMs?: number }): Promise<void> }`
  - `@Injectable() class GpustackClientFactory { create(baseUrl: string, apiKey: string): Promise<GpustackClient> }`（内部先 `assertSafeUrl(baseUrl)`）

- [ ] **Step 1: 写失败测试**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GpustackClient, GpustackError } from "./gpustack-client.js";

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function streamRes(chunks: string[], { hang = false } = {}) {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      if (!hang) controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("GpustackClient", () => {
  const fetchMock = vi.fn();
  let client: GpustackClient;
  beforeEach(() => {
    fetchMock.mockReset();
    client = new GpustackClient("http://gs", "key", fetchMock as unknown as typeof fetch);
  });

  it("listModels walks all pages with bearer auth", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRes({ items: [{ id: 1, name: "a" }], pagination: { page: 1, perPage: 100, total: 2, totalPage: 2 } }))
      .mockResolvedValueOnce(jsonRes({ items: [{ id: 2, name: "b" }], pagination: { page: 2, perPage: 100, total: 2, totalPage: 2 } }));
    const models = await client.listModels();
    expect(models.map((m) => m.id)).toEqual([1, 2]);
    expect(fetchMock.mock.calls[0][0]).toBe("http://gs/v2/models?page=1&perPage=100");
    expect(fetchMock.mock.calls[1][0]).toBe("http://gs/v2/models?page=2&perPage=100");
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer key" });
  });

  it("throws GpustackError with status on 401", async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ detail: "unauthorized" }, 401));
    await expect(client.listRoutes()).rejects.toMatchObject({ name: "GpustackError", status: 401 });
  });

  it("countModels reads pagination.total", async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ items: [], pagination: { page: 1, perPage: 1, total: 7, totalPage: 7 } }));
    expect(await client.countModels()).toBe(7);
    expect(fetchMock.mock.calls[0][0]).toBe("http://gs/v2/models?page=1&perPage=1");
  });

  it("watchModels calls onEvent per JSON event, ignores heartbeats, resolves on stream end", async () => {
    fetchMock.mockResolvedValueOnce(
      streamRes(['\n\n', '{"type":"UPDATED","data":{"id":1}}\n\n{"type":"CREATED","data":', '{"id":2}}\n\n']),
    );
    const onEvent = vi.fn();
    await client.watchModels({ signal: new AbortController().signal, onEvent });
    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("http://gs/v2/models?watch=true");
  });

  it("watchModels rejects when no bytes within heartbeat timeout", async () => {
    fetchMock.mockResolvedValueOnce(streamRes([], { hang: true }));
    await expect(
      client.watchModels({ signal: new AbortController().signal, onEvent: vi.fn(), heartbeatTimeoutMs: 50 }),
    ).rejects.toBeInstanceOf(GpustackError);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm -F @modeldoctor/api test -- src/modules/platform-source/gpustack/gpustack-client.spec.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

```ts
import { Injectable } from "@nestjs/common";
import { assertSafeUrl } from "../../connection/discovery/ssrf-guard.js";
import type { GpustackInstance, GpustackModel, GpustackPage, GpustackRoute } from "./types.js";

const PAGE_SIZE = 100;
const LIST_TIMEOUT_MS = 15_000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 60_000;

export class GpustackError extends Error {
  override name = "GpustackError";
  constructor(
    message: string,
    public readonly status: number | null = null,
  ) {
    super(message);
  }
}

export class GpustackClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json" };
  }

  private async getPage<T>(path: string, page: number, perPage: number): Promise<GpustackPage<T>> {
    const url = `${this.baseUrl}${path}?page=${page}&perPage=${perPage}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, { headers: this.headers(), signal: AbortSignal.timeout(LIST_TIMEOUT_MS) });
    } catch (e) {
      throw new GpustackError(`GET ${path} failed: ${(e as Error).message}`);
    }
    if (!res.ok) throw new GpustackError(`GET ${path} -> HTTP ${res.status}`, res.status);
    return (await res.json()) as GpustackPage<T>;
  }

  private async listAll<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; ; page++) {
      const p = await this.getPage<T>(path, page, PAGE_SIZE);
      out.push(...p.items);
      if (page >= p.pagination.totalPage || p.items.length === 0) return out;
    }
  }

  listModels(): Promise<GpustackModel[]> {
    return this.listAll<GpustackModel>("/v2/models");
  }

  listRoutes(): Promise<GpustackRoute[]> {
    return this.listAll<GpustackRoute>("/v2/model-routes");
  }

  listInstances(): Promise<GpustackInstance[]> {
    return this.listAll<GpustackInstance>("/v2/model-instances");
  }

  async countModels(): Promise<number> {
    const p = await this.getPage<GpustackModel>("/v2/models", 1, 1);
    return p.pagination.total;
  }

  /**
   * 订阅 models 变更。每个非空事件调用一次 onEvent（事件内容不解析 —— 只作对账信号）。
   * 流正常结束 → resolve；网络错误 / HTTP 错误 / 心跳超时 → reject(GpustackError)；
   * 外部 signal abort → resolve。
   */
  async watchModels(opts: {
    signal: AbortSignal;
    onEvent: () => void;
    heartbeatTimeoutMs?: number;
  }): Promise<void> {
    const timeoutMs = opts.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
    const inner = new AbortController();
    const onOuterAbort = () => inner.abort();
    opts.signal.addEventListener("abort", onOuterAbort, { once: true });
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timedOut = true;
        inner.abort();
      }, timeoutMs);
    };

    try {
      arm();
      const res = await this.fetchImpl(`${this.baseUrl}/v2/models?watch=true`, {
        headers: { ...this.headers(), Accept: "text/event-stream" },
        signal: inner.signal,
      });
      if (!res.ok || !res.body) throw new GpustackError(`watch -> HTTP ${res.status}`, res.status);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        arm();
        buf += decoder.decode(value, { stream: true });
        let idx = buf.indexOf("\n\n");
        while (idx !== -1) {
          const evt = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 2);
          if (evt) opts.onEvent();
          idx = buf.indexOf("\n\n");
        }
      }
    } catch (e) {
      if (opts.signal.aborted) return;
      if (timedOut) throw new GpustackError(`watch heartbeat timeout after ${timeoutMs}ms`);
      if (e instanceof GpustackError) throw e;
      throw new GpustackError(`watch failed: ${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
      opts.signal.removeEventListener("abort", onOuterAbort);
    }
  }
}

@Injectable()
export class GpustackClientFactory {
  async create(baseUrl: string, apiKey: string): Promise<GpustackClient> {
    await assertSafeUrl(baseUrl);
    return new GpustackClient(baseUrl, apiKey);
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm -F @modeldoctor/api test -- src/modules/platform-source/gpustack/gpustack-client.spec.ts`
Expected: PASS（5 tests）

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/platform-source/gpustack
git commit -m "feat(platform-source): GPUStack client — 分页 list + watch 订阅"
```

---

### Task 5: PlatformSourcesService + Controller + Module 骨架

**Files:**
- Create: `apps/api/src/modules/platform-source/sources/platform-sources.service.ts` + `.spec.ts`
- Create: `apps/api/src/modules/platform-source/sources/platform-sources.controller.ts`
- Create: `apps/api/src/modules/platform-source/platform-source.module.ts`
- Modify: `apps/api/src/app.module.ts`（import + 加进 `imports` 数组，放在 `BaselineModule` 之后）

**Interfaces:**
- Consumes: `GpustackClientFactory`（Task 4）、contracts（Task 2）
- Produces:
  - `PlatformSourcesService.list(userId: string): Promise<PlatformSource[]>`
  - `.get(userId: string, id: string): Promise<PlatformSource>`（404 `NotFoundException`）
  - `.create(userId: string, input: CreatePlatformSource): Promise<PlatformSource>`
  - `.update(userId: string, id: string, input: UpdatePlatformSource): Promise<PlatformSource>`
  - `.delete(userId: string, id: string): Promise<void>`
  - `.test(input: { baseUrl: string; apiKey: string }): Promise<TestPlatformSourceResponse>`
  - `.getDecrypted(id: string): Promise<{ id: string; userId: string; baseUrl: string; apiKey: string; clusterId: string | null; enabled: boolean }>`（内部用，无 owner 校验）
  - `.listEnabledIds(): Promise<string[]>`
  - `.onChange(listener: (sourceId: string, kind: "upsert" | "delete") => void): void` —— 简单进程内回调，Task 7 的 watcher 和 Task 6 的立即对账挂在这里
  - REST：`GET/POST /api/platform-sources`、`GET/PATCH/DELETE /api/platform-sources/:id`、`POST /api/platform-sources/test`（body `{baseUrl, apiKey}`）、`POST /api/platform-sources/:id/test`（用已存 key）、`POST /api/platform-sources/:id/sync`（Task 6 接上）、`GET /api/platform-sources/:id/routes`（Task 10 接上）

- [ ] **Step 1: 写失败测试 `platform-sources.service.spec.ts`**（mock Prisma 模式，照 `baseline.service.spec.ts`）

```ts
import { ConfigService } from "@nestjs/config";
import { NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { decrypt, decodeKey } from "../../../common/crypto/aes-gcm.js";
import { PrismaService } from "../../../database/prisma.service.js";
import { GpustackClientFactory } from "../gpustack/gpustack-client.js";
import { PlatformSourcesService } from "./platform-sources.service.js";

const KEY_B64 = Buffer.alloc(32, 7).toString("base64");

function row(over: Record<string, unknown> = {}) {
  return {
    id: "s1", userId: "u1", kind: "gpustack", name: "prod", baseUrl: "http://gs",
    apiKeyCipher: "x", clusterId: null, enabled: true, lastSyncAt: null, lastSyncError: null,
    createdAt: new Date("2026-09-22T00:00:00Z"), updatedAt: new Date("2026-09-22T00:00:00Z"),
    _count: { models: 3 }, ...over,
  };
}

describe("PlatformSourcesService", () => {
  let prisma: {
    platformSource: Record<string, ReturnType<typeof vi.fn>>;
  };
  let factory: { create: ReturnType<typeof vi.fn> };
  let service: PlatformSourcesService;

  beforeEach(async () => {
    prisma = {
      platformSource: {
        create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(),
        update: vi.fn(), delete: vi.fn(),
      },
    };
    factory = { create: vi.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        PlatformSourcesService,
        { provide: PrismaService, useValue: prisma },
        { provide: GpustackClientFactory, useValue: factory },
        { provide: ConfigService, useValue: { get: () => KEY_B64 } },
      ],
    }).compile();
    service = moduleRef.get(PlatformSourcesService);
  });

  it("create encrypts api key and returns public shape without secret", async () => {
    prisma.platformSource.create.mockImplementation(async ({ data }) => row({ apiKeyCipher: data.apiKeyCipher }));
    const out = await service.create("u1", { kind: "gpustack", name: "prod", baseUrl: "http://gs", apiKey: "secret" });
    const data = prisma.platformSource.create.mock.calls[0][0].data;
    expect(decrypt(data.apiKeyCipher, decodeKey(KEY_B64))).toBe("secret");
    expect(out).toMatchObject({ id: "s1", modelCount: 3, lastSyncAt: null });
    expect(out).not.toHaveProperty("apiKeyCipher");
  });

  it("get throws 404 for other user's source", async () => {
    prisma.platformSource.findFirst.mockResolvedValue(null);
    await expect(service.get("u2", "s1")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("test returns ok + count", async () => {
    factory.create.mockResolvedValue({ countModels: vi.fn().mockResolvedValue(5) });
    expect(await service.test({ baseUrl: "http://gs", apiKey: "k" })).toEqual({ ok: true, modelCount: 5, error: null });
  });

  it("test returns error message instead of throwing", async () => {
    factory.create.mockResolvedValue({ countModels: vi.fn().mockRejectedValue(new Error("HTTP 401")) });
    expect(await service.test({ baseUrl: "http://gs", apiKey: "k" })).toEqual({ ok: false, modelCount: null, error: "HTTP 401" });
  });

  it("notifies change listeners on create", async () => {
    prisma.platformSource.create.mockResolvedValue(row());
    const l = vi.fn();
    service.onChange(l);
    await service.create("u1", { kind: "gpustack", name: "p", baseUrl: "http://gs", apiKey: "k" });
    expect(l).toHaveBeenCalledWith("s1", "upsert");
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm -F @modeldoctor/api test -- src/modules/platform-source/sources/platform-sources.service.spec.ts`
Expected: FAIL

- [ ] **Step 3: 实现 service**

```ts
import type {
  CreatePlatformSource,
  PlatformSource,
  TestPlatformSourceResponse,
  UpdatePlatformSource,
} from "@modeldoctor/contracts";
import { Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { PlatformSource as PlatformSourceRow } from "@prisma/client";
import { decodeKey, decrypt, encrypt } from "../../../common/crypto/aes-gcm.js";
import type { Env } from "../../../config/env.schema.js";
import { PrismaService } from "../../../database/prisma.service.js";
import { GpustackClientFactory } from "../gpustack/gpustack-client.js";

type ChangeListener = (sourceId: string, kind: "upsert" | "delete") => void;
type RowWithCount = PlatformSourceRow & { _count: { models: number } };

const WITH_COUNT = { _count: { select: { models: true } } } as const;

function toPublic(r: RowWithCount): PlatformSource {
  return {
    id: r.id,
    kind: "gpustack",
    name: r.name,
    baseUrl: r.baseUrl,
    clusterId: r.clusterId,
    enabled: r.enabled,
    lastSyncAt: r.lastSyncAt?.toISOString() ?? null,
    lastSyncError: r.lastSyncError,
    modelCount: r._count.models,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

@Injectable()
export class PlatformSourcesService {
  private readonly key: Buffer;
  private readonly listeners: ChangeListener[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: GpustackClientFactory,
    config: ConfigService<Env, true>,
  ) {
    const k = config.get("CONNECTION_API_KEY_ENCRYPTION_KEY", { infer: true });
    if (!k) throw new Error("CONNECTION_API_KEY_ENCRYPTION_KEY is required");
    this.key = decodeKey(k);
  }

  onChange(listener: ChangeListener): void {
    this.listeners.push(listener);
  }

  private emit(sourceId: string, kind: "upsert" | "delete"): void {
    for (const l of this.listeners) l(sourceId, kind);
  }

  async list(userId: string): Promise<PlatformSource[]> {
    const rows = await this.prisma.platformSource.findMany({
      where: { userId },
      include: WITH_COUNT,
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toPublic);
  }

  private async findOwned(userId: string, id: string): Promise<RowWithCount> {
    const r = await this.prisma.platformSource.findFirst({ where: { id, userId }, include: WITH_COUNT });
    if (!r) throw new NotFoundException(`Platform source ${id} not found`);
    return r;
  }

  async get(userId: string, id: string): Promise<PlatformSource> {
    return toPublic(await this.findOwned(userId, id));
  }

  async create(userId: string, input: CreatePlatformSource): Promise<PlatformSource> {
    const r = await this.prisma.platformSource.create({
      data: {
        userId,
        kind: input.kind,
        name: input.name,
        baseUrl: input.baseUrl,
        apiKeyCipher: encrypt(input.apiKey, this.key),
        clusterId: input.clusterId ?? null,
      },
      include: WITH_COUNT,
    });
    this.emit(r.id, "upsert");
    return toPublic(r);
  }

  async update(userId: string, id: string, input: UpdatePlatformSource): Promise<PlatformSource> {
    await this.findOwned(userId, id);
    const r = await this.prisma.platformSource.update({
      where: { id },
      data: {
        name: input.name,
        baseUrl: input.baseUrl,
        apiKeyCipher: input.apiKey ? encrypt(input.apiKey, this.key) : undefined,
        clusterId: input.clusterId === undefined ? undefined : input.clusterId,
        enabled: input.enabled,
      },
      include: WITH_COUNT,
    });
    this.emit(id, "upsert");
    return toPublic(r);
  }

  async delete(userId: string, id: string): Promise<void> {
    await this.findOwned(userId, id);
    await this.prisma.platformSource.delete({ where: { id } });
    this.emit(id, "delete");
  }

  async test(input: { baseUrl: string; apiKey: string }): Promise<TestPlatformSourceResponse> {
    try {
      const client = await this.clients.create(input.baseUrl.replace(/\/+$/, ""), input.apiKey);
      return { ok: true, modelCount: await client.countModels(), error: null };
    } catch (e) {
      return { ok: false, modelCount: null, error: (e as Error).message };
    }
  }

  async testSaved(userId: string, id: string): Promise<TestPlatformSourceResponse> {
    await this.findOwned(userId, id);
    const s = await this.getDecrypted(id);
    return this.test({ baseUrl: s.baseUrl, apiKey: s.apiKey });
  }

  async getDecrypted(id: string) {
    const r = await this.prisma.platformSource.findUnique({ where: { id } });
    if (!r) throw new NotFoundException(`Platform source ${id} not found`);
    return {
      id: r.id,
      userId: r.userId,
      baseUrl: r.baseUrl,
      apiKey: decrypt(r.apiKeyCipher, this.key),
      clusterId: r.clusterId,
      enabled: r.enabled,
    };
  }

  async listEnabledIds(): Promise<string[]> {
    const rows = await this.prisma.platformSource.findMany({ where: { enabled: true }, select: { id: true } });
    return rows.map((r) => r.id);
  }
}
```

注：`Env` 类型路径以 `connection.service.ts` 的 import 为准（`grep -n "Env" apps/api/src/modules/connection/connection.service.ts`）。测试里的 `findFirst` 调用若因 mock 返回 `row()` 缺 `_count` 而报错，补齐 mock。

- [ ] **Step 4: 实现 controller**

```ts
import {
  type CreatePlatformSource,
  createPlatformSourceSchema,
  type PlatformSource,
  type TestPlatformSourceResponse,
  type UpdatePlatformSource,
  updatePlatformSourceSchema,
} from "@modeldoctor/contracts";
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { CurrentUser } from "../../../common/decorators/current-user.decorator.js";
import { ZodValidationPipe } from "../../../common/pipes/zod-validation.pipe.js";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard.js";
import type { JwtPayload } from "../../auth/jwt.strategy.js";
import { PlatformSourcesService } from "./platform-sources.service.js";

const testBodySchema = z.object({ baseUrl: z.string().url(), apiKey: z.string().min(1) });

@ApiTags("platform-sources")
@ApiBearerAuth()
@Controller("platform-sources")
@UseGuards(JwtAuthGuard)
export class PlatformSourcesController {
  constructor(private readonly service: PlatformSourcesService) {}

  @Get()
  list(@CurrentUser() user: JwtPayload): Promise<PlatformSource[]> {
    return this.service.list(user.sub);
  }

  @Post("test")
  @HttpCode(200)
  test(@Body(new ZodValidationPipe(testBodySchema)) body: z.infer<typeof testBodySchema>): Promise<TestPlatformSourceResponse> {
    return this.service.test(body);
  }

  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(createPlatformSourceSchema)) body: CreatePlatformSource,
  ): Promise<PlatformSource> {
    return this.service.create(user.sub, body);
  }

  @Get(":id")
  get(@CurrentUser() user: JwtPayload, @Param("id") id: string): Promise<PlatformSource> {
    return this.service.get(user.sub, id);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updatePlatformSourceSchema)) body: UpdatePlatformSource,
  ): Promise<PlatformSource> {
    return this.service.update(user.sub, id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  delete(@CurrentUser() user: JwtPayload, @Param("id") id: string): Promise<void> {
    return this.service.delete(user.sub, id);
  }

  @Post(":id/test")
  @HttpCode(200)
  testSaved(@CurrentUser() user: JwtPayload, @Param("id") id: string): Promise<TestPlatformSourceResponse> {
    return this.service.testSaved(user.sub, id);
  }
}
```

注意路由顺序：`@Post("test")` 必须声明在 `@Post(":id/...")` 之前（上面已如此）。

- [ ] **Step 5: 模块骨架 + 注册**

```ts
// platform-source.module.ts
import { Module } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service.js";
import { GpustackClientFactory } from "./gpustack/gpustack-client.js";
import { PlatformSourcesController } from "./sources/platform-sources.controller.js";
import { PlatformSourcesService } from "./sources/platform-sources.service.js";

@Module({
  controllers: [PlatformSourcesController],
  providers: [PrismaService, GpustackClientFactory, PlatformSourcesService],
  exports: [PlatformSourcesService],
})
export class PlatformSourceModule {}
```

在 `apps/api/src/app.module.ts` 顶部加 `import { PlatformSourceModule } from "./modules/platform-source/platform-source.module.js";`，并在 `imports: [...]` 中 `BaselineModule` 之后加 `PlatformSourceModule,`。

- [ ] **Step 6: 运行测试 + typecheck**

Run: `pnpm -F @modeldoctor/api test -- src/modules/platform-source && pnpm -F @modeldoctor/api type-check`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/platform-source apps/api/src/app.module.ts
git commit -m "feat(platform-source): 数据源 CRUD + 测试连接 API"
```

---

### Task 6: SourceSyncService.reconcile（真库测试）

**Files:**
- Create: `apps/api/src/modules/platform-source/sync/source-sync.service.ts`
- Create: `apps/api/src/modules/platform-source/sync/__tests__/source-sync.service.spec.ts`
- Modify: `apps/api/src/modules/platform-source/platform-source.module.ts`（imports `ConnectionModule`；providers 加 `SourceSyncService`；exports 加 `SourceSyncService`）
- Modify: `apps/api/src/modules/platform-source/sources/platform-sources.controller.ts`（加 `POST :id/sync`）

**Interfaces:**
- Consumes: `PlatformSourcesService.getDecrypted`、`GpustackClientFactory.create`、`ConnectionService.create(userId, CreateConnection)` / `ConnectionService.update(userId, id, UpdateConnection)`、Task 3 纯函数
- Produces:
  - `SourceSyncService.reconcile(sourceId: string): Promise<ReconcileResult>`，`interface ReconcileResult { models: number; revisionsCreated: number; readyRevisions: Array<{ discoveredModelId: string; revisionId: string }>; removed: number }`
  - `SourceSyncService.setReadyListener(fn: (e: { discoveredModelId: string; revisionId: string }) => Promise<void>): void` —— Task 8 的 runner 注册，用于 `revision` 触发（避免 sync ↔ runner 循环依赖）
  - 并发：同一 sourceId 的并发 `reconcile` 调用合并为同一个 Promise

- [ ] **Step 1: 写失败测试（testcontainers 真库，照 `quality-gate/repositories/__tests__/runs.repository.spec.ts` 的 `startPostgres` 用法）**

```ts
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startPostgres, type TestDatabase } from "../../../../../test/helpers/postgres-container.js";
import type { PrismaService } from "../../../../database/prisma.service.js";
import type { GpustackModel, GpustackRoute } from "../../gpustack/types.js";
import { SourceSyncService } from "../source-sync.service.js";

let db: TestDatabase;
let prisma: PrismaClient;
let userId: string;
let sourceId: string;

let models: GpustackModel[];
let routes: GpustackRoute[];
const client = {
  listModels: vi.fn(async () => models),
  listRoutes: vi.fn(async () => routes),
  listInstances: vi.fn(async () => []),
};
const connections = {
  create: vi.fn(async (uid: string, input: { name: string; baseUrl: string; model: string }) => {
    const c = await prisma.connection.create({
      data: { userId: uid, name: input.name, baseUrl: input.baseUrl, apiKeyCipher: "", model: input.model, category: "chat" },
    });
    return { id: c.id };
  }),
  update: vi.fn(async (_uid: string, id: string, input: { enabled?: boolean; model?: string }) => {
    await prisma.connection.update({ where: { id }, data: input });
  }),
};
const sources = {
  getDecrypted: vi.fn(async () => ({ id: sourceId, userId, baseUrl: "http://gs", apiKey: "k", clusterId: null, enabled: true })),
};
const factory = { create: vi.fn(async () => client) };

function svc() {
  return new SourceSyncService(
    prisma as unknown as PrismaService,
    sources as never,
    factory as never,
    connections as never,
  );
}

const qwen = (over: Partial<GpustackModel> = {}): GpustackModel => ({
  id: 7, name: "qwen", categories: ["llm"], cluster_id: 1, replicas: 1, ready_replicas: 0,
  backend: "vLLM", backend_version: "0.10.1", backend_parameters: ["--max-num-seqs=256"],
  source: "huggingface", huggingface_repo_id: "Qwen/Qwen3-8B", ...over,
});

beforeAll(async () => {
  db = await startPostgres();
  prisma = new PrismaClient({ datasources: { db: { url: db.url } } });
  const u = await prisma.user.create({ data: { email: `sync-${Date.now()}@t`, passwordHash: "x", roles: [] } });
  userId = u.id;
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  await db.teardown();
});

beforeEach(async () => {
  await prisma.platformSource.deleteMany({});
  await prisma.connection.deleteMany({});
  const s = await prisma.platformSource.create({
    data: { userId, name: "gs", baseUrl: "http://gs", apiKeyCipher: "x" },
  });
  sourceId = s.id;
  models = [qwen()];
  routes = [{ id: 1, name: "qwen", created_model_id: 7, targets: 1 }];
  vi.clearAllMocks();
});

describe("SourceSyncService.reconcile", () => {
  it("discovers model, creates connection against /v1 and first revision", async () => {
    const r = await svc().reconcile(sourceId);
    expect(r).toMatchObject({ models: 1, revisionsCreated: 1, readyRevisions: [], removed: 0 });
    const dm = await prisma.discoveredModel.findFirstOrThrow({ where: { sourceId } });
    expect(dm).toMatchObject({ externalId: "7", name: "qwen", status: "new", routeName: "qwen" });
    expect(connections.create).toHaveBeenCalledWith(userId, expect.objectContaining({
      baseUrl: "http://gs/v1", model: "qwen", category: "chat", serverKind: "vllm", tokenizerHfId: "Qwen/Qwen3-8B", apiKey: "k",
    }));
    expect(dm.connectionId).not.toBeNull();
    expect(dm.currentRevisionId).not.toBeNull();
  });

  it("is idempotent: second run creates nothing new", async () => {
    await svc().reconcile(sourceId);
    const r2 = await svc().reconcile(sourceId);
    expect(r2.revisionsCreated).toBe(0);
    expect(connections.create).toHaveBeenCalledTimes(1);
    expect(await prisma.deploymentRevision.count()).toBe(1);
  });

  it("replica change does not create revision; parameter change does", async () => {
    await svc().reconcile(sourceId);
    models = [qwen({ replicas: 3 })];
    expect((await svc().reconcile(sourceId)).revisionsCreated).toBe(0);
    models = [qwen({ backend_parameters: ["--max-num-seqs=512"] })];
    expect((await svc().reconcile(sourceId)).revisionsCreated).toBe(1);
  });

  it("marks readyAt once and reports it exactly once, notifying listener", async () => {
    const s = svc();
    const listener = vi.fn(async () => {});
    s.setReadyListener(listener);
    await s.reconcile(sourceId);
    models = [qwen({ ready_replicas: 1 })];
    const r = await s.reconcile(sourceId);
    expect(r.readyRevisions).toHaveLength(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect((await s.reconcile(sourceId)).readyRevisions).toHaveLength(0);
  });

  it("no dedicated route -> unroutable, no connection", async () => {
    routes = [{ id: 1, name: "shared", created_model_id: 7, targets: 2 }];
    await svc().reconcile(sourceId);
    const dm = await prisma.discoveredModel.findFirstOrThrow({ where: { sourceId } });
    expect(dm.status).toBe("unroutable");
    expect(dm.connectionId).toBeNull();
    expect(connections.create).not.toHaveBeenCalled();
  });

  it("model missing from list -> removed + connection disabled; reappears -> restored", async () => {
    await svc().reconcile(sourceId);
    models = [];
    expect((await svc().reconcile(sourceId)).removed).toBe(1);
    const dm = await prisma.discoveredModel.findFirstOrThrow({ where: { sourceId } });
    expect(dm.status).toBe("removed");
    expect(connections.update).toHaveBeenCalledWith(userId, dm.connectionId, { enabled: false });
    models = [qwen()];
    await svc().reconcile(sourceId);
    const dm2 = await prisma.discoveredModel.findFirstOrThrow({ where: { sourceId } });
    expect(dm2.status).toBe("new");
    expect(connections.update).toHaveBeenLastCalledWith(userId, dm.connectionId, { enabled: true });
  });

  it("list failure records lastSyncError and leaves models untouched", async () => {
    await svc().reconcile(sourceId);
    client.listModels.mockRejectedValueOnce(new Error("HTTP 502"));
    await expect(svc().reconcile(sourceId)).rejects.toThrow("HTTP 502");
    const s = await prisma.platformSource.findUniqueOrThrow({ where: { id: sourceId } });
    expect(s.lastSyncError).toContain("HTTP 502");
    expect((await prisma.discoveredModel.findFirstOrThrow({ where: { sourceId } })).status).toBe("new");
  });

  it("clusterId filter skips other clusters", async () => {
    sources.getDecrypted.mockResolvedValueOnce({ id: sourceId, userId, baseUrl: "http://gs", apiKey: "k", clusterId: "2", enabled: true });
    const r = await svc().reconcile(sourceId);
    expect(r.models).toBe(0);
  });

  it("routeOverride keeps user route even when auto-resolve differs", async () => {
    await svc().reconcile(sourceId);
    await prisma.discoveredModel.updateMany({ where: { sourceId }, data: { routeOverride: true, routeName: "manual" } });
    await svc().reconcile(sourceId);
    expect((await prisma.discoveredModel.findFirstOrThrow({ where: { sourceId } })).routeName).toBe("manual");
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm -F @modeldoctor/api test -- src/modules/platform-source/sync/__tests__/source-sync.service.spec.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `source-sync.service.ts`**

```ts
import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../database/prisma.service.js";
import { ConnectionService } from "../../connection/connection.service.js";
import { GpustackClientFactory } from "../gpustack/gpustack-client.js";
import type { GpustackInstance, GpustackModel, GpustackRoute } from "../gpustack/types.js";
import { PlatformSourcesService } from "../sources/platform-sources.service.js";
import { buildSnapshot, deploymentFingerprint } from "./fingerprint.js";
import { resolveDedicatedRoute, tokenizerFromSource, toModalityCategory, toServerKind } from "./mapping.js";

export interface ReadyRevisionEvent {
  discoveredModelId: string;
  revisionId: string;
}

export interface ReconcileResult {
  models: number;
  revisionsCreated: number;
  readyRevisions: ReadyRevisionEvent[];
  removed: number;
}

type Decrypted = Awaited<ReturnType<PlatformSourcesService["getDecrypted"]>>;

@Injectable()
export class SourceSyncService {
  private readonly log = new Logger(SourceSyncService.name);
  private readonly inflight = new Map<string, Promise<ReconcileResult>>();
  private readyListener: ((e: ReadyRevisionEvent) => Promise<void>) | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sources: PlatformSourcesService,
    private readonly clients: GpustackClientFactory,
    private readonly connections: ConnectionService,
  ) {}

  setReadyListener(fn: (e: ReadyRevisionEvent) => Promise<void>): void {
    this.readyListener = fn;
  }

  /** 同一 sourceId 的并发调用合并。 */
  reconcile(sourceId: string): Promise<ReconcileResult> {
    const existing = this.inflight.get(sourceId);
    if (existing) return existing;
    const p = this.doReconcile(sourceId).finally(() => this.inflight.delete(sourceId));
    this.inflight.set(sourceId, p);
    return p;
  }

  private async doReconcile(sourceId: string): Promise<ReconcileResult> {
    const src = await this.sources.getDecrypted(sourceId);
    let models: GpustackModel[];
    let routes: GpustackRoute[];
    let instances: GpustackInstance[];
    try {
      const client = await this.clients.create(src.baseUrl, src.apiKey);
      [models, routes, instances] = await Promise.all([
        client.listModels(),
        client.listRoutes(),
        client.listInstances(),
      ]);
    } catch (e) {
      await this.prisma.platformSource.update({
        where: { id: sourceId },
        data: { lastSyncError: (e as Error).message },
      });
      throw e;
    }

    if (src.clusterId) models = models.filter((m) => String(m.cluster_id ?? "") === src.clusterId);

    const result: ReconcileResult = { models: models.length, revisionsCreated: 0, readyRevisions: [], removed: 0 };
    const seen: string[] = [];
    for (const m of models) {
      seen.push(String(m.id));
      await this.syncModel(src, m, routes, instances, result);
    }
    result.removed = await this.markRemoved(src, seen);

    await this.prisma.platformSource.update({
      where: { id: sourceId },
      data: { lastSyncAt: new Date(), lastSyncError: null },
    });

    for (const e of result.readyRevisions) {
      try {
        await this.readyListener?.(e);
      } catch (err) {
        this.log.error(`ready listener failed for revision ${e.revisionId}`, err as Error);
      }
    }
    return result;
  }

  private async syncModel(
    src: Decrypted,
    m: GpustackModel,
    routes: GpustackRoute[],
    instances: GpustackInstance[],
    result: ReconcileResult,
  ): Promise<void> {
    const externalId = String(m.id);
    const categories = m.categories ?? [];
    let dm = await this.prisma.discoveredModel.upsert({
      where: { sourceId_externalId: { sourceId: src.id, externalId } },
      create: {
        sourceId: src.id,
        externalId,
        name: m.name,
        categories,
        clusterId: m.cluster_id != null ? String(m.cluster_id) : null,
        status: "new",
      },
      update: {
        name: m.name,
        categories,
        clusterId: m.cluster_id != null ? String(m.cluster_id) : null,
      },
    });

    // 1) 路由
    const routeName = dm.routeOverride ? dm.routeName : resolveDedicatedRoute(m.id, routes);
    let status = dm.status;
    if (!routeName) status = "unroutable";
    else if (status === "unroutable" || status === "removed") status = dm.automationEnabled ? "active" : "new";

    // 2) Connection
    let connectionId = dm.connectionId;
    if (routeName && !connectionId) {
      const conn = await this.connections.create(src.userId, {
        name: `gpustack/${m.name}`,
        baseUrl: `${src.baseUrl}/v1`,
        apiKey: src.apiKey,
        model: routeName,
        customHeaders: "",
        queryParams: "",
        category: toModalityCategory(categories),
        tags: ["gpustack"],
        serverKind: toServerKind(m.backend),
        tokenizerHfId: tokenizerFromSource(m),
      });
      connectionId = conn.id;
    } else if (routeName && connectionId && (routeName !== dm.routeName || dm.status === "removed")) {
      await this.connections.update(src.userId, connectionId, {
        ...(routeName !== dm.routeName ? { model: routeName } : {}),
        ...(dm.status === "removed" ? { enabled: true } : {}),
      });
    }

    // 3) Revision
    const fingerprint = deploymentFingerprint(m);
    let revision = await this.prisma.deploymentRevision.findUnique({
      where: { discoveredModelId_fingerprint: { discoveredModelId: dm.id, fingerprint } },
    });
    if (!revision) {
      try {
        revision = await this.prisma.deploymentRevision.create({
          data: {
            discoveredModelId: dm.id,
            fingerprint,
            snapshot: buildSnapshot(m, instances) as Prisma.InputJsonValue,
          },
        });
        result.revisionsCreated++;
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
        revision = await this.prisma.deploymentRevision.findUniqueOrThrow({
          where: { discoveredModelId_fingerprint: { discoveredModelId: dm.id, fingerprint } },
        });
      }
    }

    // 4) Ready（条件更新保证多副本只有一个置位）
    if ((m.ready_replicas ?? 0) >= 1 && !revision.readyAt) {
      const { count } = await this.prisma.deploymentRevision.updateMany({
        where: { id: revision.id, readyAt: null },
        data: { readyAt: new Date(), snapshot: buildSnapshot(m, instances) as Prisma.InputJsonValue },
      });
      if (count === 1) result.readyRevisions.push({ discoveredModelId: dm.id, revisionId: revision.id });
    }

    dm = await this.prisma.discoveredModel.update({
      where: { id: dm.id },
      data: { routeName, status, connectionId, currentRevisionId: revision.id },
    });
  }

  private async markRemoved(src: Decrypted, seenExternalIds: string[]): Promise<number> {
    const gone = await this.prisma.discoveredModel.findMany({
      where: { sourceId: src.id, externalId: { notIn: seenExternalIds }, status: { not: "removed" } },
    });
    for (const dm of gone) {
      await this.prisma.discoveredModel.update({ where: { id: dm.id }, data: { status: "removed" } });
      if (dm.connectionId) await this.connections.update(src.userId, dm.connectionId, { enabled: false });
      await this.prisma.automationRun.updateMany({
        where: { discoveredModelId: dm.id, status: { in: ["pending", "running"] } },
        data: { status: "cancelled", verdict: "error", finishedAt: new Date(), summary: { steps: [], reason: "model removed from GPUStack" } },
      });
    }
    return gone.length;
  }
}
```

注意事项（实现时核对）：
- `ConnectionService.update(userId, id, UpdateConnection)` 的返回值被忽略即可。
- 重新出现的 removed 模型 → 状态恢复为 `automationEnabled ? "active" : "new"`（测试期望 `new`）。
- 被 removed 时进行中的 run 的子 Benchmark 取消由 Task 8 的 runner tick 处理（它发现 run 已 cancelled 就不再推进）；本 task 不直接调 BenchmarkService，避免依赖。在 PR 描述记录：被删模型的在跑 benchmark 会自然跑完或因端点消失而失败。

- [ ] **Step 4: 模块接线 + sync 接口**

`platform-source.module.ts`：`imports: [ConnectionModule]`（`import { ConnectionModule } from "../connection/connection.module.js";`），providers / exports 加 `SourceSyncService`。

controller 加：

```ts
  @Post(":id/sync")
  @HttpCode(200)
  async sync(@CurrentUser() user: JwtPayload, @Param("id") id: string) {
    await this.service.get(user.sub, id); // owner 校验
    return this.sync.reconcile(id);
  }
```

构造函数改为 `constructor(private readonly service: PlatformSourcesService, private readonly sync: SourceSyncService) {}`。

- [ ] **Step 5: 运行测试**

Run: `pnpm -F @modeldoctor/api test -- src/modules/platform-source && pnpm -F @modeldoctor/api type-check`
Expected: PASS（全部 9 个 reconcile 用例 + 之前的）

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/platform-source
git commit -m "feat(platform-source): reconcile 全量对账 — 发现模型/建 Connection/部署版本/就绪检测"
```

---

### Task 7: SourceWatcher（watch 生命周期）

**Files:**
- Create: `apps/api/src/modules/platform-source/sync/source-watcher.service.ts` + `source-watcher.service.spec.ts`
- Modify: `platform-source.module.ts`（providers 加 `SourceWatcherService`）

**Interfaces:**
- Consumes: `PlatformSourcesService.listEnabledIds/getDecrypted/onChange`、`GpustackClientFactory`、`SourceSyncService.reconcile`
- Produces: `SourceWatcherService implements OnApplicationBootstrap, OnModuleDestroy`，公开 `start(sourceId: string): void`、`stop(sourceId: string): void`、`isWatching(sourceId: string): boolean`；常量 `DEBOUNCE_MS = 2000`、`BACKOFF_MIN_MS = 1000`、`BACKOFF_MAX_MS = 60000`

- [ ] **Step 1: 写失败测试（fake timers）**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SourceWatcherService } from "./source-watcher.service.js";

function deferred() {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("SourceWatcherService", () => {
  let watchCalls: Array<{ onEvent: () => void; d: ReturnType<typeof deferred>; signal: AbortSignal }>;
  let sync: { reconcile: ReturnType<typeof vi.fn> };
  let svc: SourceWatcherService;

  beforeEach(() => {
    vi.useFakeTimers();
    watchCalls = [];
    const client = {
      watchModels: vi.fn(({ onEvent, signal }) => {
        const d = deferred();
        watchCalls.push({ onEvent, d, signal });
        signal.addEventListener("abort", () => d.resolve());
        return d.promise;
      }),
    };
    sync = { reconcile: vi.fn(async () => ({})) };
    const sources = {
      listEnabledIds: vi.fn(async () => ["s1"]),
      getDecrypted: vi.fn(async () => ({ id: "s1", baseUrl: "http://gs", apiKey: "k", enabled: true })),
      onChange: vi.fn(),
    };
    const factory = { create: vi.fn(async () => client) };
    svc = new SourceWatcherService(sources as never, factory as never, sync as never);
  });

  afterEach(async () => {
    await svc.onModuleDestroy();
    vi.useRealTimers();
  });

  it("reconciles on start, then debounces events into one reconcile", async () => {
    svc.start("s1");
    await vi.advanceTimersByTimeAsync(0);
    expect(sync.reconcile).toHaveBeenCalledTimes(1); // 初始对账
    watchCalls[0].onEvent();
    watchCalls[0].onEvent();
    watchCalls[0].onEvent();
    await vi.advanceTimersByTimeAsync(2000);
    expect(sync.reconcile).toHaveBeenCalledTimes(2);
  });

  it("reconnects with backoff after stream error and reconciles again", async () => {
    svc.start("s1");
    await vi.advanceTimersByTimeAsync(0);
    watchCalls[0].d.reject(new Error("boom"));
    await vi.advanceTimersByTimeAsync(999);
    expect(watchCalls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(watchCalls).toHaveLength(2);
    expect(sync.reconcile).toHaveBeenCalledTimes(2);
  });

  it("stop aborts the stream and prevents reconnect", async () => {
    svc.start("s1");
    await vi.advanceTimersByTimeAsync(0);
    svc.stop("s1");
    expect(watchCalls[0].signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(watchCalls).toHaveLength(1);
    expect(svc.isWatching("s1")).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm -F @modeldoctor/api test -- src/modules/platform-source/sync/source-watcher.service.spec.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

```ts
import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common";
import { GpustackClientFactory } from "../gpustack/gpustack-client.js";
import { PlatformSourcesService } from "../sources/platform-sources.service.js";
import { SourceSyncService } from "./source-sync.service.js";

export const DEBOUNCE_MS = 2000;
export const BACKOFF_MIN_MS = 1000;
export const BACKOFF_MAX_MS = 60_000;

interface WatchState {
  abort: AbortController;
  debounce?: NodeJS.Timeout;
  retry?: NodeJS.Timeout;
  backoffMs: number;
}

@Injectable()
export class SourceWatcherService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(SourceWatcherService.name);
  private readonly states = new Map<string, WatchState>();

  constructor(
    private readonly sources: PlatformSourcesService,
    private readonly clients: GpustackClientFactory,
    private readonly sync: SourceSyncService,
  ) {
    this.sources.onChange((id, kind) => {
      this.stop(id);
      if (kind === "upsert") this.start(id);
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    for (const id of await this.sources.listEnabledIds()) this.start(id);
  }

  async onModuleDestroy(): Promise<void> {
    for (const id of [...this.states.keys()]) this.stop(id);
  }

  isWatching(sourceId: string): boolean {
    return this.states.has(sourceId);
  }

  start(sourceId: string): void {
    if (this.states.has(sourceId)) return;
    const state: WatchState = { abort: new AbortController(), backoffMs: BACKOFF_MIN_MS };
    this.states.set(sourceId, state);
    void this.loop(sourceId, state);
  }

  stop(sourceId: string): void {
    const s = this.states.get(sourceId);
    if (!s) return;
    s.abort.abort();
    clearTimeout(s.debounce);
    clearTimeout(s.retry);
    this.states.delete(sourceId);
  }

  private reconcileSafe(sourceId: string): void {
    this.sync.reconcile(sourceId).catch((e) => this.log.warn(`reconcile ${sourceId} failed: ${(e as Error).message}`));
  }

  private async loop(sourceId: string, state: WatchState): Promise<void> {
    if (state.abort.signal.aborted) return;
    try {
      const src = await this.sources.getDecrypted(sourceId);
      if (!src.enabled) {
        this.stop(sourceId);
        return;
      }
      const client = await this.clients.create(src.baseUrl, src.apiKey);
      this.reconcileSafe(sourceId); // 连上（或重连）先全量对账，补上断线期间的变更
      await client.watchModels({
        signal: state.abort.signal,
        onEvent: () => {
          state.backoffMs = BACKOFF_MIN_MS;
          clearTimeout(state.debounce);
          state.debounce = setTimeout(() => this.reconcileSafe(sourceId), DEBOUNCE_MS);
        },
      });
    } catch (e) {
      this.log.warn(`watch ${sourceId} error: ${(e as Error).message}`);
    }
    if (state.abort.signal.aborted || this.states.get(sourceId) !== state) return;
    const delay = state.backoffMs;
    state.backoffMs = Math.min(state.backoffMs * 2, BACKOFF_MAX_MS);
    state.retry = setTimeout(() => void this.loop(sourceId, state), delay);
  }
}
```

注意：测试 1 期望 `start` 后立即（同一 tick 的微任务内）调用一次 reconcile —— `loop` 里 `getDecrypted` / `create` 都是已 resolve 的 mock，`advanceTimersByTimeAsync(0)` 会冲刷微任务。若断言失败，检查是否需要多一次 `await vi.advanceTimersByTimeAsync(0)`，调整测试而非实现。

- [ ] **Step 4: 接线** —— `platform-source.module.ts` providers 加 `SourceWatcherService`。

- [ ] **Step 5: 运行测试**

Run: `pnpm -F @modeldoctor/api test -- src/modules/platform-source && pnpm -F @modeldoctor/api type-check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/platform-source
git commit -m "feat(platform-source): watch 订阅 — 防抖对账 + 指数退避重连"
```

---

### Task 8: AutomationRunnerService + Cron

**Files:**
- Create: `apps/api/src/modules/platform-source/automation/automation-runner.service.ts`
- Create: `apps/api/src/modules/platform-source/automation/__tests__/automation-runner.service.spec.ts`
- Create: `apps/api/src/modules/platform-source/automation/platform-source.cron.ts`
- Modify: `platform-source.module.ts`（imports 加 `DiagnosticsModule`、`QualityGateModule`、`BenchmarkModule`、`BenchmarkTemplateModule`、`BaselineModule`、`NotificationsModule`；providers 加 `AutomationRunnerService`、`PlatformSourceCron`；exports 加 `AutomationRunnerService`）

**Interfaces:**
- Consumes:
  - `ConnectionService.getOwnedDecrypted(userId, id)` → `DecryptedConnection`
  - `DiagnosticsService.run(userId, conn, { connectionId, probes })` → `{ diagnosticsRunId, success, results }`
  - `RunsService.create(userId, { evaluationId, endpointAId, gateConfig })` → `EvaluationRun`（取 `.id`）；`RunsService.cancel(userId, id)`
  - `BenchmarkService.create(userId, { scenario, tool, connectionId, name, params, templateId })` → `Benchmark`（取 `.id`）；`BenchmarkService.cancel(id, userId)`
  - `BenchmarkTemplateRepository.findByIdOrNull(id)` → `{ scenario, tool, config, ... } | null`
  - `BaselineService.create(userId, { benchmarkId, name, tags: [] })` → `{ id }`
  - `NotifyService.emit({ eventType, userId, connectionId, payload })`（事件类型 Task 9 注册；本 task 先用字符串，Task 9 前 typecheck 会失败 → **本 task 与 Task 9 顺序：先做 Task 9 再做 Task 8**，见下方说明）
  - `SourceSyncService.setReadyListener`、Task 3 的 `toProbes` / `detectRegression` / `nextScheduleAt`
- Produces:
  - `AutomationRunnerService.enqueue(input: { discoveredModelId: string; revisionId: string; trigger: AutomationTrigger; triggerKey: string }): Promise<string | null>`（返回 run id，重复 triggerKey 返回 null）
  - `.cancel(runId: string, verdict: "superseded" | null): Promise<void>`
  - `.tick(): Promise<void>`（promote + advance，一次 pass）
  - `.scanSchedules(now?: Date): Promise<number>`
  - `PlatformSourceCron`：`@Cron(EVERY_10_SECONDS) tick`、`@Cron(EVERY_MINUTE) schedules`、`@Cron(EVERY_5_MINUTES) reconcileAll`

> **执行顺序说明：** Task 9（通知事件类型）是本 task 的前置。subagent 执行时请先完成 Task 9 再做 Task 8（Task 9 自身不依赖 Task 8）。

- [ ] **Step 1: 写失败测试（真库 + mock 下游服务）**

```ts
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startPostgres, type TestDatabase } from "../../../../../test/helpers/postgres-container.js";
import type { PrismaService } from "../../../../database/prisma.service.js";
import { AutomationRunnerService } from "../automation-runner.service.js";

let db: TestDatabase;
let prisma: PrismaClient;
let userId: string;
let sourceId: string;
let connId: string;
let modelId: string;
let revId: string;
let evaluationId: string;
let templateId: string;

const deps = {
  connections: { getOwnedDecrypted: vi.fn(async () => ({ id: "c" })) },
  diagnostics: { run: vi.fn(async () => ({ diagnosticsRunId: "d1", success: true, results: [] })) },
  runs: { create: vi.fn(), cancel: vi.fn(async () => {}) },
  benchmarks: { create: vi.fn(), cancel: vi.fn(async () => {}) },
  templates: { findByIdOrNull: vi.fn(async () => ({ id: templateId, scenario: "inference", tool: "guidellm", config: { a: 1 } })) },
  baselines: { create: vi.fn() },
  notify: { emit: vi.fn(async () => {}) },
  sync: { setReadyListener: vi.fn() },
};

function svc() {
  return new AutomationRunnerService(
    prisma as unknown as PrismaService,
    deps.connections as never, deps.diagnostics as never, deps.runs as never,
    deps.benchmarks as never, deps.templates as never, deps.baselines as never,
    deps.notify as never, deps.sync as never,
  );
}

const summary = (tps: number) => ({
  tool: "guidellm",
  data: { outputTokensPerSecond: { mean: tps }, ttft: { p95: 100 }, itl: { p95: 20 } },
});

async function tickUntilDone(s: AutomationRunnerService, runId: string, max = 10) {
  for (let i = 0; i < max; i++) {
    await prisma.automationRun.updateMany({ where: { id: runId }, data: { lockedUntil: null } });
    await s.tick();
    const r = await prisma.automationRun.findUniqueOrThrow({ where: { id: runId } });
    if (r.status === "completed" || r.status === "cancelled") return r;
  }
  throw new Error("run did not finish");
}

beforeAll(async () => {
  db = await startPostgres();
  prisma = new PrismaClient({ datasources: { db: { url: db.url } } });
  const u = await prisma.user.create({ data: { email: `auto-${Date.now()}@t`, passwordHash: "x", roles: [] } });
  userId = u.id;
  const ev = await prisma.evaluation.create({ data: { userId, name: "smoke", samples: [], totalSamples: 0 } });
  evaluationId = ev.id;
  const tpl = await prisma.benchmarkTemplate.findFirstOrThrow({ where: { isOfficial: true } });
  templateId = tpl.id;
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  await db.teardown();
});

beforeEach(async () => {
  vi.clearAllMocks();
  await prisma.platformSource.deleteMany({});
  const s = await prisma.platformSource.create({ data: { userId, name: "gs", baseUrl: "http://gs", apiKeyCipher: "x" } });
  sourceId = s.id;
  const c = await prisma.connection.create({ data: { userId, name: "c", baseUrl: "http://gs/v1", apiKeyCipher: "", model: "qwen", category: "chat" } });
  connId = c.id;
  const dm = await prisma.discoveredModel.create({
    data: {
      sourceId, externalId: "7", name: "qwen", categories: ["llm"], status: "active", routeName: "qwen",
      connectionId: connId, automationEnabled: true, evaluationId, gateConfig: { passRateMin: 0.9 }, benchmarkTemplateId: templateId,
    },
  });
  modelId = dm.id;
  const rev = await prisma.deploymentRevision.create({ data: { discoveredModelId: modelId, fingerprint: "f1", snapshot: {}, readyAt: new Date() } });
  revId = rev.id;
  await prisma.discoveredModel.update({ where: { id: modelId }, data: { currentRevisionId: revId } });
  deps.runs.create.mockImplementation(async () => {
    const r = await prisma.evaluationRun.create({
      data: {
        userId, evaluationId, evaluationVersion: 1, evaluationSnapshot: {}, endpointAId: connId,
        gateConfig: { passRateMin: 0.9 }, status: "COMPLETED", gateResult: "PASSED", totalSamples: 0,
      },
    });
    return r;
  });
  deps.benchmarks.create.mockImplementation(async () =>
    prisma.benchmark.create({
      data: { userId, connectionId: connId, name: `b-${Math.random()}`, scenario: "inference", tool: "guidellm", params: {}, status: "completed", summaryMetrics: summary(1000), templateId },
    }),
  );
  deps.baselines.create.mockImplementation(async (_u: string, input: { benchmarkId: string; name: string }) =>
    prisma.baseline.create({ data: { userId, benchmarkId: input.benchmarkId, name: input.name, templateId } }),
  );
});

describe("AutomationRunnerService", () => {
  it("enqueue is idempotent on triggerKey", async () => {
    const s = svc();
    const a = await s.enqueue({ discoveredModelId: modelId, revisionId: revId, trigger: "revision", triggerKey: `revision:${revId}` });
    const b = await s.enqueue({ discoveredModelId: modelId, revisionId: revId, trigger: "revision", triggerKey: `revision:${revId}` });
    expect(a).not.toBeNull();
    expect(b).toBeNull();
  });

  it("full pipeline passes and establishes baseline on first run", async () => {
    const s = svc();
    const id = (await s.enqueue({ discoveredModelId: modelId, revisionId: revId, trigger: "manual", triggerKey: "manual:1" }))!;
    const r = await tickUntilDone(s, id);
    expect(r.verdict).toBe("passed");
    expect(deps.diagnostics.run).toHaveBeenCalledWith(userId, expect.anything(), { connectionId: connId, probes: ["chat-text"] });
    expect(deps.runs.create).toHaveBeenCalledWith(userId, { evaluationId, endpointAId: connId, gateConfig: { passRateMin: 0.9 } });
    expect(deps.benchmarks.create).toHaveBeenCalledWith(userId, expect.objectContaining({ scenario: "inference", tool: "guidellm", connectionId: connId, params: { a: 1 }, templateId }));
    expect((r.summary as { baselineEstablished?: boolean }).baselineEstablished).toBe(true);
    expect((await prisma.discoveredModel.findUniqueOrThrow({ where: { id: modelId } })).baselineId).not.toBeNull();
    expect(deps.notify.emit).toHaveBeenCalledWith(expect.objectContaining({ eventType: "automation.passed", userId, connectionId: connId }));
  });

  it("diagnostics failure stops pipeline with failed verdict", async () => {
    deps.diagnostics.run.mockResolvedValueOnce({ diagnosticsRunId: "d2", success: false, results: [] });
    const s = svc();
    const id = (await s.enqueue({ discoveredModelId: modelId, revisionId: revId, trigger: "manual", triggerKey: "manual:2" }))!;
    const r = await tickUntilDone(s, id);
    expect(r.verdict).toBe("failed");
    expect(deps.runs.create).not.toHaveBeenCalled();
    expect(deps.notify.emit).toHaveBeenCalledWith(expect.objectContaining({ eventType: "automation.failed" }));
  });

  it("regression against baseline yields regressed", async () => {
    const s = svc();
    const first = (await s.enqueue({ discoveredModelId: modelId, revisionId: revId, trigger: "manual", triggerKey: "manual:3" }))!;
    await tickUntilDone(s, first);
    deps.benchmarks.create.mockImplementationOnce(async () =>
      prisma.benchmark.create({
        data: { userId, connectionId: connId, name: "slow", scenario: "inference", tool: "guidellm", params: {}, status: "completed", summaryMetrics: summary(800), templateId },
      }),
    );
    const second = (await s.enqueue({ discoveredModelId: modelId, revisionId: revId, trigger: "manual", triggerKey: "manual:4" }))!;
    const r = await tickUntilDone(s, second);
    expect(r.verdict).toBe("regressed");
  });

  it("schedule trigger only runs benchmark", async () => {
    const s = svc();
    const id = (await s.enqueue({ discoveredModelId: modelId, revisionId: revId, trigger: "schedule", triggerKey: "schedule:x" }))!;
    await tickUntilDone(s, id);
    expect(deps.diagnostics.run).not.toHaveBeenCalled();
    expect(deps.runs.create).not.toHaveBeenCalled();
    expect(deps.benchmarks.create).toHaveBeenCalledTimes(1);
  });

  it("new revision supersedes running run of same model", async () => {
    const s = svc();
    const old = (await s.enqueue({ discoveredModelId: modelId, revisionId: revId, trigger: "manual", triggerKey: "manual:5" }))!;
    await prisma.automationRun.update({ where: { id: old }, data: { status: "running", currentStep: "benchmark", benchmarkId: "bx" } });
    const rev2 = await prisma.deploymentRevision.create({ data: { discoveredModelId: modelId, fingerprint: "f2", snapshot: {}, readyAt: new Date() } });
    await s.enqueue({ discoveredModelId: modelId, revisionId: rev2.id, trigger: "revision", triggerKey: `revision:${rev2.id}` });
    const r = await prisma.automationRun.findUniqueOrThrow({ where: { id: old } });
    expect(r).toMatchObject({ status: "cancelled", verdict: "superseded" });
    expect(deps.benchmarks.cancel).toHaveBeenCalledWith("bx", userId);
  });

  it("only one running run per source", async () => {
    const s = svc();
    const dm2 = await prisma.discoveredModel.create({
      data: { sourceId, externalId: "8", name: "m2", status: "active", connectionId: null, automationEnabled: true, steps: ["benchmark"], benchmarkTemplateId: templateId },
    });
    const rev2 = await prisma.deploymentRevision.create({ data: { discoveredModelId: dm2.id, fingerprint: "g", snapshot: {} } });
    await s.enqueue({ discoveredModelId: modelId, revisionId: revId, trigger: "manual", triggerKey: "manual:6" });
    await s.enqueue({ discoveredModelId: dm2.id, revisionId: rev2.id, trigger: "manual", triggerKey: "manual:7" });
    deps.runs.create.mockImplementationOnce(async () =>
      prisma.evaluationRun.create({
        data: { userId, evaluationId, evaluationVersion: 1, evaluationSnapshot: {}, endpointAId: connId, gateConfig: {}, status: "RUNNING", totalSamples: 0 },
      }),
    );
    await s.tick();
    await s.tick();
    expect(await prisma.automationRun.count({ where: { sourceId, status: "running" } })).toBe(1);
  });

  it("scanSchedules enqueues due models and advances nextScheduledAt", async () => {
    const now = new Date("2026-09-22T00:00:00Z");
    await prisma.discoveredModel.update({ where: { id: modelId }, data: { schedule: "daily", nextScheduledAt: new Date("2026-09-21T23:59:00Z") } });
    const n = await svc().scanSchedules(now);
    expect(n).toBe(1);
    const dm = await prisma.discoveredModel.findUniqueOrThrow({ where: { id: modelId } });
    expect(dm.nextScheduledAt?.toISOString()).toBe("2026-09-23T00:00:00.000Z");
    expect(await prisma.automationRun.count({ where: { discoveredModelId: modelId, trigger: "schedule" } })).toBe(1);
  });
});
```

注：`prisma.benchmark.create` / `prisma.evaluation.create` 的必填字段以 schema.prisma 为准；若上面的 data 缺必填列，按 schema 补齐（只改测试夹具，不改生产代码），并在 task 结尾报告。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm -F @modeldoctor/api test -- src/modules/platform-source/automation/__tests__/automation-runner.service.spec.ts`
Expected: FAIL

- [ ] **Step 3: 实现 `automation-runner.service.ts`**

```ts
import {
  AUTOMATION_STEPS,
  type AutomationStep,
  type AutomationSummary,
  type AutomationTrigger,
  type AutomationVerdict,
  DEFAULT_GATE_CONFIG,
  DEFAULT_REGRESSION_THRESHOLDS,
  type GateConfig,
  type RegressionThresholds,
} from "@modeldoctor/contracts";
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { type AutomationRun, type DiscoveredModel, Prisma } from "@prisma/client";
import { PrismaService } from "../../../database/prisma.service.js";
import { BaselineService } from "../../baseline/baseline.service.js";
import { IN_PROGRESS_STATES } from "../../benchmark/constants.js";
import { BenchmarkService } from "../../benchmark/benchmark.service.js";
import { BenchmarkTemplateRepository } from "../../benchmark-template/benchmark-template.repository.js";
import { ConnectionService } from "../../connection/connection.service.js";
import { DiagnosticsService } from "../../diagnostics/diagnostics.service.js";
import { NotifyService } from "../../notifications/notify.service.js";
import { RunsService } from "../../quality-gate/services/runs.service.js";
import { SourceSyncService } from "../sync/source-sync.service.js";
import { toProbes } from "../sync/mapping.js";
import { detectRegression, nextScheduleAt } from "./regression.js";

const LEASE_MS = 60_000;
type Step = AutomationStep | "compare";
type RunCtx = AutomationRun & { model: DiscoveredModel & { source: { userId: string } } };

@Injectable()
export class AutomationRunnerService implements OnModuleInit {
  private readonly log = new Logger(AutomationRunnerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly connections: ConnectionService,
    private readonly diagnostics: DiagnosticsService,
    private readonly runs: RunsService,
    private readonly benchmarks: BenchmarkService,
    private readonly templates: BenchmarkTemplateRepository,
    private readonly baselines: BaselineService,
    private readonly notify: NotifyService,
    private readonly sync: SourceSyncService,
  ) {}

  onModuleInit(): void {
    this.sync.setReadyListener(async ({ discoveredModelId, revisionId }) => {
      const dm = await this.prisma.discoveredModel.findUnique({ where: { id: discoveredModelId } });
      if (!dm?.automationEnabled) return;
      await this.enqueue({ discoveredModelId, revisionId, trigger: "revision", triggerKey: `revision:${revisionId}` });
    });
  }

  // ---------- enqueue / cancel ----------

  async enqueue(input: {
    discoveredModelId: string;
    revisionId: string;
    trigger: AutomationTrigger;
    triggerKey: string;
  }): Promise<string | null> {
    const dm = await this.prisma.discoveredModel.findUniqueOrThrow({ where: { id: input.discoveredModelId } });
    if (input.trigger === "revision") {
      const active = await this.prisma.automationRun.findMany({
        where: { discoveredModelId: dm.id, status: { in: ["pending", "running"] } },
      });
      for (const r of active) await this.cancel(r.id, "superseded");
    }
    try {
      const run = await this.prisma.automationRun.create({
        data: {
          discoveredModelId: dm.id,
          sourceId: dm.sourceId,
          revisionId: input.revisionId,
          trigger: input.trigger,
          triggerKey: input.triggerKey,
          status: "pending",
        },
      });
      return run.id;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return null;
      throw e;
    }
  }

  async cancel(runId: string, verdict: "superseded" | null): Promise<void> {
    const run = await this.prisma.automationRun.findUnique({
      where: { id: runId },
      include: { model: { include: { source: { select: { userId: true } } } } },
    });
    if (!run || run.status === "completed" || run.status === "cancelled") return;
    const userId = run.model.source.userId;
    await this.prisma.automationRun.update({
      where: { id: runId },
      data: { status: "cancelled", verdict, finishedAt: new Date(), lockedUntil: null },
    });
    if (run.benchmarkId) await this.benchmarks.cancel(run.benchmarkId, userId).catch(() => undefined);
    if (run.evaluationRunId) await this.runs.cancel(userId, run.evaluationRunId).catch(() => undefined);
  }

  // ---------- tick ----------

  async tick(): Promise<void> {
    await this.promotePending();
    const running = await this.prisma.automationRun.findMany({ where: { status: "running" }, select: { id: true } });
    for (const { id } of running) {
      if (!(await this.acquireLease(id))) continue;
      try {
        await this.advance(id);
      } catch (e) {
        this.log.error(`advance ${id} failed`, e as Error);
        await this.finish(id, "error", { stepMessage: (e as Error).message });
      } finally {
        await this.prisma.automationRun.updateMany({ where: { id, status: "running" }, data: { lockedUntil: null } });
      }
    }
  }

  /** 每个源至多 1 个 running：行锁 platform_sources 后再检查并提升。 */
  private async promotePending(): Promise<void> {
    const sources = await this.prisma.automationRun.findMany({
      where: { status: "pending" },
      distinct: ["sourceId"],
      select: { sourceId: true },
    });
    for (const { sourceId } of sources) {
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM platform_sources WHERE id = ${sourceId} FOR UPDATE`;
        const running = await tx.automationRun.count({ where: { sourceId, status: "running" } });
        if (running > 0) return;
        const next = await tx.automationRun.findFirst({
          where: { sourceId, status: "pending" },
          orderBy: { createdAt: "asc" },
          include: { model: true },
        });
        if (!next) return;
        const steps = this.effectiveSteps(next.trigger as AutomationTrigger, next.model);
        await tx.automationRun.update({
          where: { id: next.id },
          data: { status: "running", currentStep: steps[0], startedAt: new Date(), summary: { steps: [] } },
        });
      });
    }
  }

  private async acquireLease(id: string): Promise<boolean> {
    const now = new Date();
    const { count } = await this.prisma.automationRun.updateMany({
      where: { id, status: "running", OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
      data: { lockedUntil: new Date(now.getTime() + LEASE_MS) },
    });
    return count === 1;
  }

  private effectiveSteps(trigger: AutomationTrigger, model: DiscoveredModel): Step[] {
    if (trigger === "schedule") return ["benchmark", "compare"];
    const chosen = AUTOMATION_STEPS.filter((s) => model.steps.includes(s));
    return chosen.includes("benchmark") ? [...chosen, "compare"] : chosen;
  }

  private async load(id: string): Promise<RunCtx> {
    return this.prisma.automationRun.findUniqueOrThrow({
      where: { id },
      include: { model: { include: { source: { select: { userId: true } } } } },
    });
  }

  private async advance(id: string): Promise<void> {
    const run = await this.load(id);
    const step = run.currentStep as Step | null;
    if (!step) return this.finish(id, "passed", {});
    const userId = run.model.source.userId;
    const connectionId = run.model.connectionId;
    if (!connectionId) return this.finish(id, "error", { step, stepMessage: "model has no connection" });

    switch (step) {
      case "diagnostics": {
        const conn = await this.connections.getOwnedDecrypted(userId, connectionId);
        const res = await this.diagnostics.run(userId, conn, { connectionId, probes: toProbes(run.model.categories) });
        await this.prisma.automationRun.update({ where: { id }, data: { diagnosticsRunId: res.diagnosticsRunId } });
        if (!res.success) return this.finish(id, "failed", { step, outcome: "failed", stepMessage: "diagnostics failed" });
        return this.nextStep(run, step, { step, outcome: "ok" });
      }
      case "quality_gate": {
        if (!run.evaluationRunId) {
          if (!run.model.evaluationId) return this.finish(id, "error", { step, stepMessage: "no evaluation configured" });
          const created = await this.runs.create(userId, {
            evaluationId: run.model.evaluationId,
            endpointAId: connectionId,
            gateConfig: (run.model.gateConfig as GateConfig | null) ?? { ...DEFAULT_GATE_CONFIG },
          });
          await this.prisma.automationRun.update({ where: { id }, data: { evaluationRunId: created.id } });
          return;
        }
        const er = await this.prisma.evaluationRun.findUniqueOrThrow({ where: { id: run.evaluationRunId } });
        if (er.status === "PENDING" || er.status === "RUNNING") return;
        if (er.status !== "COMPLETED") return this.finish(id, "error", { step, stepMessage: `evaluation run ${er.status}` });
        if (er.gateResult === "FAILED") return this.finish(id, "failed", { step, outcome: "failed", stepMessage: "quality gate failed" });
        return this.nextStep(run, step, { step, outcome: "ok", gateWarning: er.gateResult === "WARNING" });
      }
      case "benchmark": {
        if (!run.benchmarkId) {
          const tplId = run.model.benchmarkTemplateId;
          const tpl = tplId ? await this.templates.findByIdOrNull(tplId) : null;
          if (!tpl) return this.finish(id, "error", { step, stepMessage: "benchmark template not found" });
          const b = await this.benchmarks.create(userId, {
            scenario: tpl.scenario,
            tool: tpl.tool,
            connectionId,
            name: `auto-${run.model.name}-${run.id.slice(-8)}`.slice(0, 128),
            params: tpl.config as Record<string, unknown>,
            templateId: tpl.id,
          });
          await this.prisma.automationRun.update({ where: { id }, data: { benchmarkId: b.id } });
          return;
        }
        const b = await this.prisma.benchmark.findUniqueOrThrow({ where: { id: run.benchmarkId } });
        if ((IN_PROGRESS_STATES as readonly string[]).includes(b.status)) return;
        if (b.status !== "completed") return this.finish(id, "error", { step, stepMessage: `benchmark ${b.status}` });
        return this.nextStep(run, step, { step, outcome: "ok" });
      }
      case "compare":
        return this.compare(run, userId);
    }
  }

  private async nextStep(
    run: RunCtx,
    done: Step,
    entry: { step: Step; outcome: "ok"; gateWarning?: boolean },
  ): Promise<void> {
    const steps = this.effectiveSteps(run.trigger as AutomationTrigger, run.model);
    const next = steps[steps.indexOf(done) + 1] ?? null;
    const summary = this.appendStep(run.summary, entry);
    if (entry.gateWarning) summary.gateWarning = true;
    await this.prisma.automationRun.update({
      where: { id: run.id },
      data: { currentStep: next, summary: summary as Prisma.InputJsonValue },
    });
    if (!next) await this.finish(run.id, "passed", {});
  }

  private appendStep(
    raw: unknown,
    entry: { step: Step; outcome: "ok" | "failed" | "error" | "skipped"; stepMessage?: string },
  ): AutomationSummary {
    const s = (raw as AutomationSummary | null) ?? { steps: [] };
    return {
      ...s,
      steps: [...(s.steps ?? []), { step: entry.step, outcome: entry.outcome, ...(entry.stepMessage ? { message: entry.stepMessage } : {}) }],
    };
  }

  private async compare(run: RunCtx, userId: string): Promise<void> {
    const b = await this.prisma.benchmark.findUniqueOrThrow({ where: { id: run.benchmarkId! } });
    const baselineId = run.model.baselineId;
    let summary = this.appendStep(run.summary, { step: "compare", outcome: "ok" });

    if (!baselineId) {
      const bl = await this.baselines.create(userId, {
        benchmarkId: b.id,
        name: `${run.model.name} @ ${run.revisionId.slice(-8)}`,
        tags: ["gpustack"],
      });
      await this.prisma.discoveredModel.update({ where: { id: run.model.id }, data: { baselineId: bl.id } });
      summary = { ...summary, baselineEstablished: true, regression: { compared: false, reason: "baseline established", metrics: [] } };
      return this.finishWithSummary(run.id, "passed", summary);
    }

    const baseline = await this.prisma.baseline.findUnique({ where: { id: baselineId }, include: { benchmark: true } });
    if (!baseline) {
      summary = { ...summary, regression: { compared: false, reason: "baseline missing", metrics: [] } };
      return this.finishWithSummary(run.id, "passed", summary);
    }
    if (baseline.benchmark.templateId !== b.templateId) {
      summary = { ...summary, regression: { compared: false, reason: "template changed", baselineId, metrics: [] } };
      return this.finishWithSummary(run.id, "passed", summary);
    }
    const thresholds = (run.model.regressionThresholds as RegressionThresholds | null) ?? DEFAULT_REGRESSION_THRESHOLDS;
    const r = detectRegression({ baseline: baseline.benchmark.summaryMetrics, candidate: b.summaryMetrics, thresholds });
    summary = { ...summary, regression: { compared: true, baselineId, metrics: r.metrics } };
    return this.finishWithSummary(run.id, r.regressed ? "regressed" : "passed", summary);
  }

  private async finish(
    id: string,
    verdict: AutomationVerdict,
    info: { step?: Step; outcome?: "failed" | "error"; stepMessage?: string },
  ): Promise<void> {
    const run = await this.load(id);
    const summary = info.step
      ? this.appendStep(run.summary, { step: info.step, outcome: info.outcome ?? "error", stepMessage: info.stepMessage })
      : ((run.summary as AutomationSummary | null) ?? { steps: [] });
    return this.finishWithSummary(id, verdict, summary);
  }

  private async finishWithSummary(id: string, verdict: AutomationVerdict, summary: AutomationSummary): Promise<void> {
    const { count } = await this.prisma.automationRun.updateMany({
      where: { id, status: "running" },
      data: {
        status: "completed",
        verdict,
        currentStep: null,
        finishedAt: new Date(),
        lockedUntil: null,
        summary: summary as Prisma.InputJsonValue,
      },
    });
    if (count === 0) return; // 已被取消 / 已由其它副本完成
    const run = await this.load(id);
    const eventType =
      verdict === "passed" ? "automation.passed" : verdict === "regressed" ? "automation.regressed" : "automation.failed";
    await this.notify.emit({
      eventType,
      userId: run.model.source.userId,
      connectionId: run.model.connectionId ?? undefined,
      payload: {
        automationRunId: id,
        discoveredModelId: run.model.id,
        modelName: run.model.name,
        revisionId: run.revisionId,
        trigger: run.trigger,
        verdict,
        benchmarkId: run.benchmarkId,
        evaluationRunId: run.evaluationRunId,
        summary,
      },
    });
  }

  // ---------- schedules ----------

  async scanSchedules(now: Date = new Date()): Promise<number> {
    const due = await this.prisma.discoveredModel.findMany({
      where: {
        automationEnabled: true,
        schedule: { not: "off" },
        nextScheduledAt: { lte: now },
        status: { in: ["new", "active"] },
        currentRevisionId: { not: null },
      },
    });
    let enqueued = 0;
    for (const dm of due) {
      const slot = dm.nextScheduledAt!.toISOString();
      const busy = await this.prisma.automationRun.count({
        where: { discoveredModelId: dm.id, status: { in: ["pending", "running"] } },
      });
      if (!busy) {
        const id = await this.enqueue({
          discoveredModelId: dm.id,
          revisionId: dm.currentRevisionId!,
          trigger: "schedule",
          triggerKey: `schedule:${dm.id}:${slot}`,
        });
        if (id) enqueued++;
      }
      await this.prisma.discoveredModel.updateMany({
        where: { id: dm.id, nextScheduledAt: dm.nextScheduledAt },
        data: { nextScheduledAt: nextScheduleAt(dm.schedule as "daily" | "weekly", now) },
      });
    }
    return enqueued;
  }
}
```

实现核对点（与真实签名对齐，出现偏差时按实际签名改并报告）：
- `GateConfig` 类型名：`grep -n "export type GateConfig" packages/contracts/src/quality-gate/runs.ts`。
- `BenchmarkService.create` 的第二参数类型为 `CreateBenchmarkRequest`，`scenario` / `tool` 是 enum；`tpl.scenario` / `tpl.tool` 的类型若是 `string`，加 `as CreateBenchmarkRequest["scenario"]` 等断言。
- `DiagnosticsRunResponse` 字段名是 `diagnosticsRunId` 与 `success`（research 已确认）。
- `baselines.create` 的输入 `tags` 有 default，可传。

- [ ] **Step 4: Cron `platform-source.cron.ts`**

```ts
import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PlatformSourcesService } from "../sources/platform-sources.service.js";
import { SourceSyncService } from "../sync/source-sync.service.js";
import { AutomationRunnerService } from "./automation-runner.service.js";

@Injectable()
export class PlatformSourceCron {
  private readonly log = new Logger(PlatformSourceCron.name);

  constructor(
    private readonly runner: AutomationRunnerService,
    private readonly sources: PlatformSourcesService,
    private readonly sync: SourceSyncService,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async tick(): Promise<void> {
    try {
      await this.runner.tick();
    } catch (e) {
      this.log.error("automation tick failed", e as Error);
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async schedules(): Promise<void> {
    try {
      await this.runner.scanSchedules();
    } catch (e) {
      this.log.error("schedule scan failed", e as Error);
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async reconcileAll(): Promise<void> {
    for (const id of await this.sources.listEnabledIds()) {
      await this.sync.reconcile(id).catch((e) => this.log.warn(`reconcile ${id}: ${(e as Error).message}`));
    }
  }
}
```

- [ ] **Step 5: 模块接线**

`platform-source.module.ts` 的 `imports` 改为：`[ConnectionModule, DiagnosticsModule, QualityGateModule, BenchmarkModule, BenchmarkTemplateModule, BaselineModule, NotificationsModule]`（各自 `../<x>/<x>.module.js`，quality-gate 为 `../quality-gate/quality-gate.module.js`，benchmark-template 为 `../benchmark-template/benchmark-template.module.js`）；providers 加 `AutomationRunnerService`、`PlatformSourceCron`；exports 加 `AutomationRunnerService`。若出现循环 import（Nest 报 `Nest can't resolve dependencies` 且涉及 forwardRef），报告而不是随手加 `forwardRef`。

- [ ] **Step 6: 运行测试 + typecheck + 全量 api 单测**

Run: `pnpm -F @modeldoctor/api test -- src/modules/platform-source && pnpm -F @modeldoctor/api type-check && pnpm -F @modeldoctor/api test`
Expected: PASS（全量无回归）

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/platform-source
git commit -m "feat(platform-source): 自动化流水线状态机 — 诊断/质量门禁/压测/Baseline 对比 + 定时回归"
```

---

### Task 9: 通知事件类型（Task 8 前置）

**Files:**
- Modify: `apps/api/src/modules/notifications/subscriptions.service.ts:4`（`EventType` union）
- Modify: `apps/api/src/modules/notifications/notifications.dto.ts:4`（`eventTypeSchema`）
- Modify: `packages/contracts/src/notifications.ts:2`（`NotificationEventType`）
- Modify: `apps/api/src/modules/notifications/adapters/format.ts`（新事件的文本格式）
- Modify: `apps/api/src/modules/mcp/tools/subscribe.tool.ts:8,22`（事件枚举）
- Modify: `apps/web/src/features/notifications/schemas.ts:10`（事件 enum）
- Modify: `apps/web/src/locales/{zh-CN,en-US}/notifications.json`（事件标签，约 L35 / L66 两处结构）
- Test: `apps/api/src/modules/notifications/adapters/format.spec.ts`（若不存在则新建）

**Interfaces:**
- Produces: 事件类型 `"automation.passed" | "automation.failed" | "automation.regressed"`，payload 字段：`automationRunId, discoveredModelId, modelName, revisionId, trigger, verdict, benchmarkId, evaluationRunId, summary`

- [ ] **Step 1: 读现状**

Run: `sed -n 1,80p apps/api/src/modules/notifications/adapters/format.ts && ls apps/api/src/modules/notifications/adapters/ && grep -n "diagnostics.failed" -r apps/api/src apps/web/src packages/contracts/src`
Expected: 看到所有列举事件类型的位置（应与上面 Files 列表一致；多出来的位置一并修改并在 task 结尾报告）。

- [ ] **Step 2: 写失败测试（format）**

在 format 的 spec 文件中加：

```ts
it("formats automation.regressed with model name and verdict", () => {
  const text = formatEvent("automation.regressed", {
    modelName: "qwen", verdict: "regressed", trigger: "revision", automationRunId: "r1",
  });
  expect(text).toContain("qwen");
  expect(text).toContain("regressed");
});
```

`formatEvent` 以 format.ts 实际导出的函数名为准（Step 1 读到的）；若签名不同，按实际签名写这个断言。

- [ ] **Step 3: 运行确认失败**

Run: `pnpm -F @modeldoctor/api test -- src/modules/notifications/adapters`
Expected: FAIL（未知事件走 benchmark 格式，不含 verdict）

- [ ] **Step 4: 修改所有列举位置**

- `subscriptions.service.ts`：`export type EventType = "benchmark.completed" | "benchmark.failed" | "diagnostics.failed" | "alert.explained" | "automation.passed" | "automation.failed" | "automation.regressed";`
- `notifications.dto.ts`：`eventTypeSchema` 的 `z.enum([...])` 追加同样 3 个。
- `packages/contracts/src/notifications.ts`：`NotificationEventType` 追加 3 个。
- `mcp/tools/subscribe.tool.ts`：两处枚举追加 3 个。
- `apps/web/src/features/notifications/schemas.ts`：enum 追加 3 个。
- `format.ts`：为 `automation.*` 加分支，输出形如 `[部署门禁] ${modelName} — ${verdict}（触发：${trigger}）`；与现有格式函数风格保持一致（若现有格式是英文，则用英文 `"[Deployment gate] qwen — regressed (trigger: revision)"`）。
- locales：`zh-CN` → `"automation.passed": "部署门禁通过"`、`"automation.failed": "部署门禁未通过"`、`"automation.regressed": "部署门禁性能退化"`；`en-US` → `"Deployment gate passed"` / `"Deployment gate failed"` / `"Deployment gate regressed"`（放在与现有事件标签相同的对象里，两处结构都要加）。

- [ ] **Step 5: 运行测试 + lint + typecheck**

Run: `pnpm -F @modeldoctor/contracts build && pnpm -F @modeldoctor/api test -- src/modules/notifications && pnpm -F @modeldoctor/api type-check && pnpm -F @modeldoctor/web lint`
Expected: PASS（web lint 含 `check:i18n`）

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/notifications apps/api/src/modules/mcp/tools/subscribe.tool.ts packages/contracts/src/notifications.ts apps/web/src/features/notifications/schemas.ts apps/web/src/locales/zh-CN/notifications.json apps/web/src/locales/en-US/notifications.json
git commit -m "feat(notifications): 新增 automation.passed/failed/regressed 事件类型"
```

---

### Task 10: DiscoveredModels API

**Files:**
- Create: `apps/api/src/modules/platform-source/models/discovered-models.service.ts`
- Create: `apps/api/src/modules/platform-source/models/__tests__/discovered-models.service.spec.ts`
- Create: `apps/api/src/modules/platform-source/models/discovered-models.controller.ts`
- Modify: `platform-source.module.ts`（controllers 加 `DiscoveredModelsController`；providers 加 `DiscoveredModelsService`）
- Modify: `sources/platform-sources.controller.ts`（加 `GET :id/routes`）

**Interfaces:**
- Consumes: `AutomationRunnerService.enqueue/cancel`、`SourceSyncService.reconcile`、`ConnectionService.update`、`GpustackClientFactory`、`PlatformSourcesService.getDecrypted`、`diffSnapshots`、`nextScheduleAt`
- Produces:
  - `DiscoveredModelsService.list(userId, q: ListDiscoveredModelsQuery): Promise<DiscoveredModelPublic[]>`
  - `.get(userId, id): Promise<DiscoveredModelPublic>`
  - `.update(userId, id, patch: UpdateDiscoveredModel): Promise<DiscoveredModelPublic>`
  - `.runNow(userId, id): Promise<AutomationRunPublic>`
  - `.listRevisions(userId, id): Promise<DeploymentRevisionPublic[]>`
  - `.cancelRun(userId, runId): Promise<void>`
  - `.listRoutes(userId, sourceId): Promise<GpustackRouteOption[]>`
  - REST：`GET /api/discovered-models`、`GET/PATCH /api/discovered-models/:id`、`POST /api/discovered-models/:id/run`、`GET /api/discovered-models/:id/revisions`、`POST /api/automation-runs/:id/cancel`、`GET /api/platform-sources/:id/routes`

- [ ] **Step 1: 写失败测试（真库，runner/sync/connections mock）**

```ts
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startPostgres, type TestDatabase } from "../../../../../test/helpers/postgres-container.js";
import type { PrismaService } from "../../../../database/prisma.service.js";
import { DiscoveredModelsService } from "../discovered-models.service.js";

let db: TestDatabase;
let prisma: PrismaClient;
let userId: string;
let otherUserId: string;
let modelId: string;
let revId: string;

const runner = {
  enqueue: vi.fn(async () => "run1"),
  cancel: vi.fn(async () => {}),
};
const connections = { update: vi.fn(async () => {}) };
const sources = { getDecrypted: vi.fn() };
const factory = { create: vi.fn() };

function svc() {
  return new DiscoveredModelsService(prisma as unknown as PrismaService, runner as never, connections as never, sources as never, factory as never);
}

beforeAll(async () => {
  db = await startPostgres();
  prisma = new PrismaClient({ datasources: { db: { url: db.url } } });
  userId = (await prisma.user.create({ data: { email: `dm-${Date.now()}@t`, passwordHash: "x", roles: [] } })).id;
  otherUserId = (await prisma.user.create({ data: { email: `dm2-${Date.now()}@t`, passwordHash: "x", roles: [] } })).id;
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  await db.teardown();
});

beforeEach(async () => {
  vi.clearAllMocks();
  await prisma.platformSource.deleteMany({});
  const s = await prisma.platformSource.create({ data: { userId, name: "gs", baseUrl: "http://gs", apiKeyCipher: "x" } });
  const c = await prisma.connection.create({ data: { userId, name: "c", baseUrl: "http://gs/v1", apiKeyCipher: "", model: "qwen", category: "chat" } });
  const dm = await prisma.discoveredModel.create({
    data: { sourceId: s.id, externalId: "7", name: "qwen", categories: ["llm"], status: "new", routeName: "qwen", connectionId: c.id },
  });
  modelId = dm.id;
  const r1 = await prisma.deploymentRevision.create({
    data: { discoveredModelId: modelId, fingerprint: "a", snapshot: { backend_version: "0.10.1" }, firstSeenAt: new Date("2026-09-20T00:00:00Z"), readyAt: new Date("2026-09-20T00:01:00Z") },
  });
  const r2 = await prisma.deploymentRevision.create({
    data: { discoveredModelId: modelId, fingerprint: "b", snapshot: { backend_version: "0.11.0" }, firstSeenAt: new Date("2026-09-21T00:00:00Z"), readyAt: new Date("2026-09-21T00:01:00Z") },
  });
  revId = r2.id;
  await prisma.discoveredModel.update({ where: { id: modelId }, data: { currentRevisionId: r2.id } });
  void r1;
});

describe("DiscoveredModelsService", () => {
  it("list is owner-scoped", async () => {
    expect(await svc().list(userId, {})).toHaveLength(1);
    expect(await svc().list(otherUserId, {})).toHaveLength(0);
  });

  it("get 404 for other user", async () => {
    await expect(svc().get(otherUserId, modelId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("enabling requires evaluation when quality_gate step selected", async () => {
    await expect(svc().update(userId, modelId, { automationEnabled: true, benchmarkTemplateId: "t" })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("enabling requires template when benchmark step selected", async () => {
    await expect(svc().update(userId, modelId, { automationEnabled: true, steps: ["benchmark"] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("enabling unroutable model is rejected", async () => {
    await prisma.discoveredModel.update({ where: { id: modelId }, data: { status: "unroutable" } });
    await expect(svc().update(userId, modelId, { automationEnabled: true, steps: ["diagnostics"] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("enabling sets active, default gateConfig, schedule time and enqueues enable run", async () => {
    const now = Date.now();
    const out = await svc().update(userId, modelId, {
      automationEnabled: true, evaluationId: "e1", benchmarkTemplateId: "t1", schedule: "daily",
    });
    expect(out).toMatchObject({ automationEnabled: true, status: "active", gateConfig: { passRateMin: 0.9 }, schedule: "daily" });
    expect(new Date(out.nextScheduledAt!).getTime()).toBeGreaterThanOrEqual(now + 24 * 3600 * 1000 - 5000);
    expect(runner.enqueue).toHaveBeenCalledWith(expect.objectContaining({ discoveredModelId: modelId, revisionId: revId, trigger: "enable" }));
  });

  it("disabling cancels active runs", async () => {
    await prisma.discoveredModel.update({ where: { id: modelId }, data: { automationEnabled: true, steps: ["diagnostics"] } });
    const run = await prisma.automationRun.create({
      data: { discoveredModelId: modelId, sourceId: (await prisma.platformSource.findFirstOrThrow()).id, revisionId: revId, trigger: "manual", triggerKey: "k", status: "running" },
    });
    await svc().update(userId, modelId, { automationEnabled: false });
    expect(runner.cancel).toHaveBeenCalledWith(run.id, null);
  });

  it("routeName override updates connection model", async () => {
    const out = await svc().update(userId, modelId, { routeName: "manual-route" });
    expect(out).toMatchObject({ routeName: "manual-route", routeOverride: true });
    expect(connections.update).toHaveBeenCalledWith(userId, expect.any(String), { model: "manual-route" });
  });

  it("listRevisions returns newest first with diff vs previous", async () => {
    const revs = await svc().listRevisions(userId, modelId);
    expect(revs.map((r) => r.fingerprint)).toEqual(["b", "a"]);
    expect(revs[0].diff).toEqual([{ field: "backend_version", before: "0.10.1", after: "0.11.0" }]);
    expect(revs[1].diff).toEqual([{ field: "backend_version", before: null, after: "0.10.1" }]);
  });

  it("runNow requires automation config and current revision", async () => {
    await expect(svc().runNow(userId, modelId)).rejects.toBeInstanceOf(BadRequestException);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm -F @modeldoctor/api test -- src/modules/platform-source/models`
Expected: FAIL

- [ ] **Step 3: 实现 service**

```ts
import { randomUUID } from "node:crypto";
import {
  type AutomationRunPublic,
  type AutomationStep,
  type AutomationSummary,
  DEFAULT_GATE_CONFIG,
  type DeploymentRevisionPublic,
  type DiscoveredModelPublic,
  type GpustackRouteOption,
  type ListDiscoveredModelsQuery,
  type UpdateDiscoveredModel,
} from "@modeldoctor/contracts";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { type AutomationRun, type DeploymentRevision, type DiscoveredModel, Prisma } from "@prisma/client";
import { PrismaService } from "../../../database/prisma.service.js";
import { ConnectionService } from "../../connection/connection.service.js";
import { AutomationRunnerService } from "../automation/automation-runner.service.js";
import { nextScheduleAt } from "../automation/regression.js";
import { GpustackClientFactory } from "../gpustack/gpustack-client.js";
import { PlatformSourcesService } from "../sources/platform-sources.service.js";
import { diffSnapshots } from "../sync/fingerprint.js";

type ModelRow = DiscoveredModel & {
  source: { name: string; userId: string };
  runs: AutomationRun[];
};

export function toRunPublic(r: AutomationRun): AutomationRunPublic {
  return {
    id: r.id,
    discoveredModelId: r.discoveredModelId,
    revisionId: r.revisionId,
    trigger: r.trigger as AutomationRunPublic["trigger"],
    status: r.status as AutomationRunPublic["status"],
    currentStep: r.currentStep,
    verdict: (r.verdict as AutomationRunPublic["verdict"]) ?? null,
    diagnosticsRunId: r.diagnosticsRunId,
    evaluationRunId: r.evaluationRunId,
    benchmarkId: r.benchmarkId,
    summary: (r.summary as AutomationSummary | null) ?? null,
    startedAt: r.startedAt?.toISOString() ?? null,
    finishedAt: r.finishedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

@Injectable()
export class DiscoveredModelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: AutomationRunnerService,
    private readonly connections: ConnectionService,
    private readonly sources: PlatformSourcesService,
    private readonly clients: GpustackClientFactory,
  ) {}

  private readonly include = {
    source: { select: { name: true, userId: true } },
    runs: { orderBy: { createdAt: "desc" as const }, take: 1 },
  };

  private async toPublic(m: ModelRow): Promise<DiscoveredModelPublic> {
    const rev = m.currentRevisionId
      ? await this.prisma.deploymentRevision.findUnique({ where: { id: m.currentRevisionId } })
      : null;
    const snap = (rev?.snapshot ?? {}) as Record<string, unknown>;
    return {
      id: m.id,
      sourceId: m.sourceId,
      sourceName: m.source.name,
      externalId: m.externalId,
      name: m.name,
      categories: m.categories,
      clusterId: m.clusterId,
      status: m.status as DiscoveredModelPublic["status"],
      routeName: m.routeName,
      routeOverride: m.routeOverride,
      connectionId: m.connectionId,
      currentRevision: rev
        ? {
            id: rev.id,
            fingerprint: rev.fingerprint,
            backend: (snap.backend as string | undefined) ?? null,
            backendVersion: (snap.backend_version as string | undefined) ?? null,
            readyAt: rev.readyAt?.toISOString() ?? null,
          }
        : null,
      automationEnabled: m.automationEnabled,
      steps: m.steps as AutomationStep[],
      evaluationId: m.evaluationId,
      gateConfig: (m.gateConfig as DiscoveredModelPublic["gateConfig"]) ?? null,
      benchmarkTemplateId: m.benchmarkTemplateId,
      schedule: m.schedule as DiscoveredModelPublic["schedule"],
      nextScheduledAt: m.nextScheduledAt?.toISOString() ?? null,
      baselineId: m.baselineId,
      regressionThresholds: (m.regressionThresholds as DiscoveredModelPublic["regressionThresholds"]) ?? null,
      lastRun: m.runs[0] ? toRunPublic(m.runs[0]) : null,
    };
  }

  private async findOwned(userId: string, id: string): Promise<ModelRow> {
    const m = await this.prisma.discoveredModel.findFirst({ where: { id, source: { userId } }, include: this.include });
    if (!m) throw new NotFoundException(`Discovered model ${id} not found`);
    return m;
  }

  async list(userId: string, q: ListDiscoveredModelsQuery): Promise<DiscoveredModelPublic[]> {
    const rows = await this.prisma.discoveredModel.findMany({
      where: {
        source: { userId },
        ...(q.sourceId ? { sourceId: q.sourceId } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(q.automationEnabled !== undefined ? { automationEnabled: q.automationEnabled } : {}),
      },
      include: this.include,
      orderBy: [{ status: "asc" }, { name: "asc" }],
    });
    return Promise.all(rows.map((r) => this.toPublic(r)));
  }

  async get(userId: string, id: string): Promise<DiscoveredModelPublic> {
    return this.toPublic(await this.findOwned(userId, id));
  }

  async update(userId: string, id: string, patch: UpdateDiscoveredModel): Promise<DiscoveredModelPublic> {
    const cur = await this.findOwned(userId, id);
    const data: Prisma.DiscoveredModelUpdateInput = {};

    if (patch.routeName !== undefined) {
      if (patch.routeName === null) {
        data.routeOverride = false; // 下次 reconcile 自动解析
      } else {
        data.routeOverride = true;
        data.routeName = patch.routeName;
        if (cur.status === "unroutable") data.status = cur.automationEnabled ? "active" : "new";
        if (cur.connectionId) await this.connections.update(userId, cur.connectionId, { model: patch.routeName });
      }
    }
    if (patch.steps) data.steps = patch.steps;
    if (patch.evaluationId !== undefined) data.evaluationId = patch.evaluationId;
    if (patch.gateConfig !== undefined) data.gateConfig = patch.gateConfig ?? Prisma.DbNull;
    if (patch.benchmarkTemplateId !== undefined) data.benchmarkTemplateId = patch.benchmarkTemplateId;
    if (patch.baselineId !== undefined) data.baselineId = patch.baselineId;
    if (patch.regressionThresholds !== undefined) data.regressionThresholds = patch.regressionThresholds ?? Prisma.DbNull;
    if (patch.schedule !== undefined) {
      data.schedule = patch.schedule;
      data.nextScheduledAt = nextScheduleAt(patch.schedule, new Date());
    }

    const merged = {
      steps: patch.steps ?? (cur.steps as AutomationStep[]),
      evaluationId: patch.evaluationId !== undefined ? patch.evaluationId : cur.evaluationId,
      benchmarkTemplateId: patch.benchmarkTemplateId !== undefined ? patch.benchmarkTemplateId : cur.benchmarkTemplateId,
      gateConfig: patch.gateConfig !== undefined ? patch.gateConfig : cur.gateConfig,
      status: (data.status as string | undefined) ?? cur.status,
      routeName: (data.routeName as string | undefined) ?? cur.routeName,
      automationEnabled: patch.automationEnabled ?? cur.automationEnabled,
    };

    const enabling = patch.automationEnabled === true && !cur.automationEnabled;
    const disabling = patch.automationEnabled === false && cur.automationEnabled;

    if (merged.automationEnabled) {
      if (merged.status === "unroutable" || merged.status === "removed" || !cur.connectionId || !merged.routeName) {
        throw new BadRequestException("Model is not routable; pick a GPUStack route first");
      }
      if (merged.steps.includes("quality_gate") && !merged.evaluationId) {
        throw new BadRequestException("evaluationId is required when quality_gate step is enabled");
      }
      if (merged.steps.includes("benchmark") && !merged.benchmarkTemplateId) {
        throw new BadRequestException("benchmarkTemplateId is required when benchmark step is enabled");
      }
      if (merged.steps.includes("quality_gate") && !merged.gateConfig) data.gateConfig = { ...DEFAULT_GATE_CONFIG };
    }
    if (enabling) {
      data.automationEnabled = true;
      data.status = "active";
    }
    if (disabling) {
      data.automationEnabled = false;
      data.status = "new";
    }

    await this.prisma.discoveredModel.update({ where: { id }, data });

    if (disabling) {
      const active = await this.prisma.automationRun.findMany({
        where: { discoveredModelId: id, status: { in: ["pending", "running"] } },
      });
      for (const r of active) await this.runner.cancel(r.id, null);
    }
    if (enabling && cur.currentRevisionId) {
      const rev = await this.prisma.deploymentRevision.findUnique({ where: { id: cur.currentRevisionId } });
      if (rev?.readyAt) {
        await this.runner.enqueue({
          discoveredModelId: id,
          revisionId: rev.id,
          trigger: "enable",
          triggerKey: `enable:${rev.id}:${Date.now()}`,
        });
      }
    }
    return this.get(userId, id);
  }

  async runNow(userId: string, id: string): Promise<AutomationRunPublic> {
    const m = await this.findOwned(userId, id);
    if (!m.automationEnabled || !m.currentRevisionId) {
      throw new BadRequestException("Enable automation on a model with a deployed revision first");
    }
    const runId = await this.runner.enqueue({
      discoveredModelId: id,
      revisionId: m.currentRevisionId,
      trigger: "manual",
      triggerKey: `manual:${randomUUID()}`,
    });
    const run = await this.prisma.automationRun.findUniqueOrThrow({ where: { id: runId! } });
    return toRunPublic(run);
  }

  async listRevisions(userId: string, id: string): Promise<DeploymentRevisionPublic[]> {
    await this.findOwned(userId, id);
    const revs: Array<DeploymentRevision & { runs: AutomationRun[] }> = await this.prisma.deploymentRevision.findMany({
      where: { discoveredModelId: id },
      orderBy: { firstSeenAt: "asc" },
      include: { runs: { orderBy: { createdAt: "desc" } } },
    });
    const out = revs.map((r, i) => ({
      id: r.id,
      fingerprint: r.fingerprint,
      snapshot: r.snapshot as Record<string, unknown>,
      firstSeenAt: r.firstSeenAt.toISOString(),
      readyAt: r.readyAt?.toISOString() ?? null,
      diff: diffSnapshots(i > 0 ? (revs[i - 1].snapshot as Record<string, unknown>) : null, r.snapshot as Record<string, unknown>),
      runs: r.runs.map(toRunPublic),
    }));
    return out.reverse();
  }

  async cancelRun(userId: string, runId: string): Promise<void> {
    const run = await this.prisma.automationRun.findFirst({ where: { id: runId, model: { source: { userId } } } });
    if (!run) throw new NotFoundException(`Automation run ${runId} not found`);
    await this.runner.cancel(runId, null);
  }

  async listRoutes(userId: string, sourceId: string): Promise<GpustackRouteOption[]> {
    const owned = await this.prisma.platformSource.findFirst({ where: { id: sourceId, userId } });
    if (!owned) throw new NotFoundException(`Platform source ${sourceId} not found`);
    const s = await this.sources.getDecrypted(sourceId);
    const client = await this.clients.create(s.baseUrl, s.apiKey);
    const routes = await client.listRoutes();
    return routes.map((r) => ({
      name: r.effective_name || r.name,
      targets: r.targets,
      createdModelId: r.created_model_id != null ? String(r.created_model_id) : null,
    }));
  }
}
```

注：`listRevisions` 测试中 `revs[1].diff`（最早的 revision）期望 `[{field: "backend_version", before: null, after: "0.10.1"}]` —— `diffSnapshots(null, snap)` 行为与此一致。

- [ ] **Step 4: Controller**

```ts
import {
  type AutomationRunPublic,
  type DeploymentRevisionPublic,
  type DiscoveredModelPublic,
  type ListDiscoveredModelsQuery,
  listDiscoveredModelsQuerySchema,
  type UpdateDiscoveredModel,
  updateDiscoveredModelSchema,
} from "@modeldoctor/contracts";
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../../common/decorators/current-user.decorator.js";
import { ZodValidationPipe } from "../../../common/pipes/zod-validation.pipe.js";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard.js";
import type { JwtPayload } from "../../auth/jwt.strategy.js";
import { DiscoveredModelsService } from "./discovered-models.service.js";

@ApiTags("deployment-gate")
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard)
export class DiscoveredModelsController {
  constructor(private readonly service: DiscoveredModelsService) {}

  @Get("discovered-models")
  list(
    @CurrentUser() user: JwtPayload,
    @Query(new ZodValidationPipe(listDiscoveredModelsQuerySchema)) q: ListDiscoveredModelsQuery,
  ): Promise<DiscoveredModelPublic[]> {
    return this.service.list(user.sub, q);
  }

  @Get("discovered-models/:id")
  get(@CurrentUser() user: JwtPayload, @Param("id") id: string): Promise<DiscoveredModelPublic> {
    return this.service.get(user.sub, id);
  }

  @Patch("discovered-models/:id")
  update(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateDiscoveredModelSchema)) body: UpdateDiscoveredModel,
  ): Promise<DiscoveredModelPublic> {
    return this.service.update(user.sub, id, body);
  }

  @Post("discovered-models/:id/run")
  run(@CurrentUser() user: JwtPayload, @Param("id") id: string): Promise<AutomationRunPublic> {
    return this.service.runNow(user.sub, id);
  }

  @Get("discovered-models/:id/revisions")
  revisions(@CurrentUser() user: JwtPayload, @Param("id") id: string): Promise<DeploymentRevisionPublic[]> {
    return this.service.listRevisions(user.sub, id);
  }

  @Post("automation-runs/:id/cancel")
  @HttpCode(204)
  cancel(@CurrentUser() user: JwtPayload, @Param("id") id: string): Promise<void> {
    return this.service.cancelRun(user.sub, id);
  }
}
```

在 `PlatformSourcesController` 加（构造注入 `DiscoveredModelsService`）：

```ts
  @Get(":id/routes")
  routes(@CurrentUser() user: JwtPayload, @Param("id") id: string) {
    return this.models.listRoutes(user.sub, id);
  }
```

- [ ] **Step 5: 接线 + 测试**

`platform-source.module.ts`：controllers 加 `DiscoveredModelsController`，providers 加 `DiscoveredModelsService`。

Run: `pnpm -F @modeldoctor/api test -- src/modules/platform-source && pnpm -F @modeldoctor/api type-check && pnpm -F @modeldoctor/api lint`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/platform-source
git commit -m "feat(platform-source): 发现模型 API — 自动化配置/立即运行/revision 时间线"
```

---

### Task 11: HTTP e2e — 假 GPUStack 驱动完整链路

**Files:**
- Create: `apps/api/test/e2e/deployment-gate.e2e-spec.ts`

**Interfaces:**
- Consumes: `bootE2E()` / `registerUser(app, email)` from `apps/api/test/helpers/app.ts`；REST 端点（Task 5/6/10）
- Produces: e2e 覆盖：创建数据源 → sync → 发现模型 + Connection → 修改参数 → 新 revision → 开启自动化（仅 diagnostics 步骤，诊断打到假服务器的 `/v1/chat/completions`）→ tick → verdict

- [ ] **Step 1: 先读 helper 与一个现有 e2e 的写法**

Run: `sed -n 1,80p apps/api/test/helpers/app.ts && sed -n 1,60p apps/api/test/e2e/diagnostics.e2e-spec.ts`
Expected: 了解 `E2EContext` 字段（`app`、`prisma` 等）与 supertest 的 `request(app.getHttpServer())` 用法、token 获取方式。下方代码按这些实际字段名调整。

- [ ] **Step 2: 写 e2e**

```ts
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AutomationRunnerService } from "../../src/modules/platform-source/automation/automation-runner.service.js";
import { bootE2E, type E2EContext, registerUser } from "../helpers/app.js";

let ctx: E2EContext;
let token: string;
let fake: Server;
let fakeUrl: string;
let backendParams = ["--max-num-seqs=256"];

function page(items: unknown[]) {
  return JSON.stringify({ items, pagination: { page: 1, perPage: 100, total: items.length, totalPage: 1 } });
}

beforeAll(async () => {
  fake = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    res.setHeader("content-type", "application/json");
    if (url.pathname === "/v2/models" && url.searchParams.get("watch") === "true") {
      res.setHeader("content-type", "text/event-stream");
      res.write("\n\n"); // 保持连接，不推事件
      return;
    }
    if (url.pathname === "/v2/models") {
      return res.end(page([{
        id: 7, name: "qwen", categories: ["llm"], cluster_id: 1, replicas: 1, ready_replicas: 1,
        backend: "vLLM", backend_version: "0.10.1", backend_parameters: backendParams,
        source: "huggingface", huggingface_repo_id: "Qwen/Qwen3-8B",
      }]));
    }
    if (url.pathname === "/v2/model-routes") return res.end(page([{ id: 1, name: "qwen", created_model_id: 7, targets: 1 }]));
    if (url.pathname === "/v2/model-instances") return res.end(page([{ id: 9, model_id: 7, state: "running", worker_name: "w1", gpu_type: "A100", gpu_indexes: [0] }]));
    if (url.pathname === "/v1/chat/completions") {
      return res.end(JSON.stringify({ id: "x", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    }
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
  fakeUrl = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
  ctx = await bootE2E();
  token = (await registerUser(ctx.app, `gate-${Date.now()}@t.io`)).accessToken;
}, 180_000);

afterAll(async () => {
  await ctx?.app.close();
  fake?.closeAllConnections();
  fake?.close();
});

const auth = () => ({ Authorization: `Bearer ${token}` });

describe("deployment gate e2e", () => {
  let sourceId: string;
  let modelId: string;

  it("creates source and discovers the model with a /v1 connection", async () => {
    const test = await request(ctx.app.getHttpServer()).post("/api/platform-sources/test").set(auth()).send({ baseUrl: fakeUrl, apiKey: "k" });
    expect(test.body).toEqual({ ok: true, modelCount: 1, error: null });

    const created = await request(ctx.app.getHttpServer()).post("/api/platform-sources").set(auth()).send({ name: "fake", baseUrl: fakeUrl, apiKey: "k" }).expect(201);
    sourceId = created.body.id;
    const sync = await request(ctx.app.getHttpServer()).post(`/api/platform-sources/${sourceId}/sync`).set(auth()).expect(200);
    expect(sync.body.models).toBe(1);

    const list = await request(ctx.app.getHttpServer()).get("/api/discovered-models").set(auth()).expect(200);
    expect(list.body).toHaveLength(1);
    modelId = list.body[0].id;
    expect(list.body[0]).toMatchObject({ name: "qwen", status: "new", routeName: "qwen" });
    expect(list.body[0].currentRevision).toMatchObject({ backend: "vLLM", backendVersion: "0.10.1" });

    const conn = await request(ctx.app.getHttpServer()).get(`/api/connections/${list.body[0].connectionId}`).set(auth()).expect(200);
    expect(conn.body).toMatchObject({ baseUrl: `${fakeUrl}/v1`, model: "qwen" });
  });

  it("parameter change creates a new revision with diff", async () => {
    backendParams = ["--max-num-seqs=512"];
    await request(ctx.app.getHttpServer()).post(`/api/platform-sources/${sourceId}/sync`).set(auth()).expect(200);
    const revs = await request(ctx.app.getHttpServer()).get(`/api/discovered-models/${modelId}/revisions`).set(auth()).expect(200);
    expect(revs.body).toHaveLength(2);
    expect(revs.body[0].diff).toEqual([
      { field: "backend_parameters", before: ["--max-num-seqs=256"], after: ["--max-num-seqs=512"] },
    ]);
  });

  it("enabling diagnostics-only automation runs and passes", async () => {
    const upd = await request(ctx.app.getHttpServer()).patch(`/api/discovered-models/${modelId}`).set(auth())
      .send({ automationEnabled: true, steps: ["diagnostics"] }).expect(200);
    expect(upd.body.automationEnabled).toBe(true);

    const runner = ctx.app.get(AutomationRunnerService);
    for (let i = 0; i < 5; i++) await runner.tick();

    const got = await request(ctx.app.getHttpServer()).get(`/api/discovered-models/${modelId}`).set(auth()).expect(200);
    expect(got.body.lastRun).toMatchObject({ trigger: "enable", status: "completed", verdict: "passed" });
    expect(got.body.lastRun.diagnosticsRunId).toBeTruthy();
  });
});
```

注：`registerUser` 返回字段名（`accessToken`）以 Step 1 所读 helper 为准；`bootE2E` 使用的是 testcontainer，本地私网 IP `127.0.0.1` 在 `assertSafeUrl` 中被允许（它只拦云元数据地址）。若诊断 `chat-text` 探针请求的路径/字段与上面假响应不符导致失败，读 `apps/api/src/modules/diagnostics/probes/chat-text*.ts` 按其期望调整假服务器响应（只改测试）。

- [ ] **Step 3: 运行**

Run: `pnpm test:e2e:api -- test/e2e/deployment-gate.e2e-spec.ts`
Expected: PASS（3 tests）

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/e2e/deployment-gate.e2e-spec.ts
git commit -m "test(platform-source): 假 GPUStack 驱动的部署门禁 e2e"
```

---

### Task 12: Web — API 客户端、i18n 命名空间、数据源页

**Files:**
- Create: `apps/web/src/features/deployment-gate/api.ts`
- Create: `apps/web/src/features/deployment-gate/queries.ts`
- Create: `apps/web/src/features/deployment-gate/SourcesPage.tsx`
- Create: `apps/web/src/features/deployment-gate/SourceSheet.tsx`
- Create: `apps/web/src/features/deployment-gate/SourcesPage.test.tsx`
- Create: `apps/web/src/locales/zh-CN/deployment-gate.json`、`apps/web/src/locales/en-US/deployment-gate.json`
- Modify: `apps/web/src/lib/i18n.ts`（import + resources + ns 三处）
- Modify: `apps/web/src/router/index.tsx`（`deployment-gate/sources`）
- Modify: `apps/web/src/components/sidebar/sidebar-config.tsx` + `locales/{zh-CN,en-US}/sidebar.json`

**Interfaces:**
- Consumes: contracts 类型（Task 2）；REST（Task 5/6/10）
- Produces:
  - `dgApi`：`listSources()`、`createSource(body)`、`updateSource(id, body)`、`deleteSource(id)`、`testSource(body)`、`testSavedSource(id)`、`syncSource(id)`、`listRoutes(sourceId)`、`listModels(q?)`、`getModel(id)`、`updateModel(id, body)`、`runModel(id)`、`listRevisions(id)`、`cancelRun(id)`
  - hooks：`useSources()`、`useCreateSource()`、`useUpdateSource()`、`useDeleteSource()`、`useTestSource()`、`useSyncSource()`、`useRoutes(sourceId)`、`useDiscoveredModels(q?)`、`useDiscoveredModel(id)`、`useUpdateDiscoveredModel(id)`、`useRunDiscoveredModel(id)`、`useRevisions(id, { poll })`、`useCancelAutomationRun()`
  - sidebar group `id: "deployment-gate"`，items `/deployment-gate`（Task 13 页面）与 `/deployment-gate/sources`

- [ ] **Step 1: `api.ts`**

```ts
import type {
  AutomationRunPublic,
  CreatePlatformSource,
  DeploymentRevisionPublic,
  DiscoveredModelPublic,
  GpustackRouteOption,
  PlatformSource,
  TestPlatformSourceResponse,
  UpdateDiscoveredModel,
  UpdatePlatformSource,
} from "@modeldoctor/contracts";
import { api } from "@/lib/api-client";

export interface ModelListFilter {
  sourceId?: string;
  status?: string;
  automationEnabled?: boolean;
}

function qs(f: ModelListFilter = {}): string {
  const p = new URLSearchParams();
  if (f.sourceId) p.set("sourceId", f.sourceId);
  if (f.status) p.set("status", f.status);
  if (f.automationEnabled !== undefined) p.set("automationEnabled", String(f.automationEnabled));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const dgApi = {
  listSources: () => api.get<PlatformSource[]>("/api/platform-sources"),
  createSource: (body: CreatePlatformSource) => api.post<PlatformSource>("/api/platform-sources", body),
  updateSource: (id: string, body: UpdatePlatformSource) => api.patch<PlatformSource>(`/api/platform-sources/${id}`, body),
  deleteSource: (id: string) => api.del<void>(`/api/platform-sources/${id}`),
  testSource: (body: { baseUrl: string; apiKey: string }) =>
    api.post<TestPlatformSourceResponse>("/api/platform-sources/test", body),
  testSavedSource: (id: string) => api.post<TestPlatformSourceResponse>(`/api/platform-sources/${id}/test`, {}),
  syncSource: (id: string) => api.post<{ models: number }>(`/api/platform-sources/${id}/sync`, {}),
  listRoutes: (sourceId: string) => api.get<GpustackRouteOption[]>(`/api/platform-sources/${sourceId}/routes`),
  listModels: (f?: ModelListFilter) => api.get<DiscoveredModelPublic[]>(`/api/discovered-models${qs(f)}`),
  getModel: (id: string) => api.get<DiscoveredModelPublic>(`/api/discovered-models/${id}`),
  updateModel: (id: string, body: UpdateDiscoveredModel) =>
    api.patch<DiscoveredModelPublic>(`/api/discovered-models/${id}`, body),
  runModel: (id: string) => api.post<AutomationRunPublic>(`/api/discovered-models/${id}/run`, {}),
  listRevisions: (id: string) => api.get<DeploymentRevisionPublic[]>(`/api/discovered-models/${id}/revisions`),
  cancelRun: (id: string) => api.post<void>(`/api/automation-runs/${id}/cancel`, {}),
};
```

`api.patch` / `api.del` 的精确名称以 `apps/web/src/lib/api-client.ts:113` 附近导出为准。

- [ ] **Step 2: `queries.ts`**

```ts
import type { CreatePlatformSource, UpdateDiscoveredModel, UpdatePlatformSource } from "@modeldoctor/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { dgApi, type ModelListFilter } from "./api";

const KEY = {
  sources: ["deployment-gate", "sources"] as const,
  routes: (sourceId: string) => ["deployment-gate", "routes", sourceId] as const,
  models: (f?: ModelListFilter) => ["deployment-gate", "models", f ?? {}] as const,
  model: (id: string) => ["deployment-gate", "model", id] as const,
  revisions: (id: string) => ["deployment-gate", "revisions", id] as const,
};

function useInvalidateAll() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["deployment-gate"] });
}

export function useSources() {
  return useQuery({ queryKey: KEY.sources, queryFn: dgApi.listSources });
}

export function useCreateSource() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (b: CreatePlatformSource) => dgApi.createSource(b), onSuccess: invalidate });
}

export function useUpdateSource() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdatePlatformSource }) => dgApi.updateSource(id, body),
    onSuccess: invalidate,
  });
}

export function useDeleteSource() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (id: string) => dgApi.deleteSource(id), onSuccess: invalidate });
}

export function useTestSource() {
  return useMutation({ mutationFn: (b: { baseUrl: string; apiKey: string }) => dgApi.testSource(b) });
}

export function useSyncSource() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (id: string) => dgApi.syncSource(id), onSuccess: invalidate });
}

export function useRoutes(sourceId: string | undefined) {
  return useQuery({
    queryKey: sourceId ? KEY.routes(sourceId) : ["deployment-gate", "routes", "disabled"],
    queryFn: () => dgApi.listRoutes(sourceId!),
    enabled: !!sourceId,
  });
}

export function useDiscoveredModels(f?: ModelListFilter) {
  return useQuery({ queryKey: KEY.models(f), queryFn: () => dgApi.listModels(f), refetchInterval: 15_000 });
}

export function useDiscoveredModel(id: string | undefined) {
  return useQuery({
    queryKey: id ? KEY.model(id) : ["deployment-gate", "model", "disabled"],
    queryFn: () => dgApi.getModel(id!),
    enabled: !!id,
    refetchInterval: (q) => {
      const s = q.state.data?.lastRun?.status;
      return s === "pending" || s === "running" ? 5000 : false;
    },
  });
}

export function useUpdateDiscoveredModel(id: string) {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (b: UpdateDiscoveredModel) => dgApi.updateModel(id, b), onSuccess: invalidate });
}

export function useRunDiscoveredModel(id: string) {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: () => dgApi.runModel(id), onSuccess: invalidate });
}

export function useRevisions(id: string | undefined, opts?: { poll?: boolean }) {
  return useQuery({
    queryKey: id ? KEY.revisions(id) : ["deployment-gate", "revisions", "disabled"],
    queryFn: () => dgApi.listRevisions(id!),
    enabled: !!id,
    refetchInterval: opts?.poll ? 5000 : false,
  });
}

export function useCancelAutomationRun() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (id: string) => dgApi.cancelRun(id), onSuccess: invalidate });
}
```

- [ ] **Step 3: i18n 文件**

`apps/web/src/locales/zh-CN/deployment-gate.json`：

```json
{
  "sources": {
    "title": "GPUStack 数据源",
    "subtitle": "连接 GPUStack，自动发现其上部署的模型服务",
    "add": "添加数据源",
    "empty": { "title": "还没有数据源", "body": "添加一个 GPUStack 地址和 API Key，ModelDoctor 会自动发现其上的模型服务。" },
    "col": { "name": "名称", "baseUrl": "地址", "models": "模型数", "lastSync": "最近同步", "status": "状态" },
    "status": { "ok": "正常", "error": "同步失败", "disabled": "已停用", "never": "未同步" },
    "sync": "立即同步",
    "synced": "同步完成，发现 {{count}} 个模型",
    "deleteConfirm": "删除数据源会同时删除其下发现的模型记录与自动化历史（已生成的连接保留）。",
    "sheet": {
      "createTitle": "添加 GPUStack 数据源",
      "editTitle": "编辑数据源",
      "name": "名称",
      "baseUrl": "GPUStack 地址",
      "baseUrlHint": "例如 http://gpustack.example.com，不要带 /v1 或 /v2",
      "apiKey": "API Key",
      "apiKeyHint": "建议使用管理员创建的 Key，权限需包含 management 与 inference",
      "apiKeyKeep": "留空则保持不变",
      "clusterId": "集群 ID（可选）",
      "clusterIdHint": "只发现该集群的模型；留空发现全部",
      "enabled": "启用",
      "test": "测试连接",
      "testOk": "连接成功，共 {{count}} 个模型",
      "testFail": "连接失败：{{error}}"
    }
  },
  "models": {
    "title": "部署门禁",
    "subtitle": "GPUStack 部署变更后自动验收：诊断 → 质量门禁 → 压测 → Baseline 对比",
    "empty": { "title": "还没有发现模型", "body": "先添加一个 GPUStack 数据源。", "action": "添加数据源" },
    "col": { "name": "模型", "source": "来源", "status": "状态", "revision": "当前版本", "lastVerdict": "最近判定", "automation": "自动化" },
    "status": { "new": "新发现", "active": "已开启", "unroutable": "无专属路由", "removed": "已下线" },
    "runNow": "立即运行",
    "runQueued": "已加入队列",
    "noRun": "—",
    "enableNeedsConfig": "请先在详情页完成自动化配置"
  },
  "verdict": {
    "passed": "通过",
    "failed": "未通过",
    "regressed": "性能退化",
    "error": "执行出错",
    "superseded": "已被取代",
    "running": "运行中",
    "pending": "排队中"
  },
  "detail": {
    "config": "自动化配置",
    "editConfig": "编辑配置",
    "route": "GPUStack 路由",
    "routeAuto": "自动解析",
    "routeManual": "手动指定",
    "pickRoute": "选择路由",
    "connection": "连接",
    "baseline": "Baseline",
    "noBaseline": "首次压测成功后自动建立",
    "schedule": "定时回归",
    "nextRun": "下次运行",
    "timeline": "部署版本",
    "noRevisions": "尚无部署版本",
    "firstSeen": "首次发现",
    "ready": "就绪",
    "notReady": "未就绪",
    "initialRevision": "初始版本",
    "noRunsForRevision": "该版本没有自动化运行",
    "cancelRun": "取消",
    "steps": { "diagnostics": "诊断", "quality_gate": "质量门禁", "benchmark": "压测", "compare": "Baseline 对比" },
    "outcome": { "ok": "通过", "failed": "未通过", "error": "出错", "skipped": "跳过" },
    "trigger": { "enable": "开启时", "revision": "部署变更", "schedule": "定时", "manual": "手动" },
    "regression": {
      "title": "性能对比",
      "notCompared": "未对比：{{reason}}",
      "metric": { "outputTokensPerSec": "输出吞吐", "ttft.p95": "TTFT p95", "itl.p95": "ITL p95" },
      "baselineEstablished": "已建立 Baseline"
    },
    "gateWarning": "质量门禁为警告级别（视为通过）",
    "links": { "diagnostics": "诊断详情", "evaluation": "质量门禁报告", "benchmark": "压测详情" }
  },
  "automation": {
    "title": "自动化配置",
    "enabled": "开启自动化测试",
    "steps": "测试步骤",
    "evaluation": "质量门禁评测集",
    "passRateMin": "最低通过率",
    "template": "压测模板",
    "schedule": "定时回归",
    "scheduleOptions": { "off": "关闭", "daily": "每天", "weekly": "每周" },
    "thresholds": "退化阈值（%）",
    "tpsDrop": "输出吞吐下降超过",
    "ttftRise": "TTFT p95 上升超过",
    "itlRise": "ITL p95 上升超过",
    "saved": "已保存"
  }
}
```

`apps/web/src/locales/en-US/deployment-gate.json`：同样的键结构，英文值：

```json
{
  "sources": {
    "title": "GPUStack sources",
    "subtitle": "Connect GPUStack to discover the model services deployed on it",
    "add": "Add source",
    "empty": { "title": "No sources yet", "body": "Add a GPUStack URL and API key; ModelDoctor will discover its model services automatically." },
    "col": { "name": "Name", "baseUrl": "URL", "models": "Models", "lastSync": "Last sync", "status": "Status" },
    "status": { "ok": "Healthy", "error": "Sync failed", "disabled": "Disabled", "never": "Never synced" },
    "sync": "Sync now",
    "synced": "Synced, {{count}} models found",
    "deleteConfirm": "Deleting the source also deletes its discovered models and automation history (generated connections are kept).",
    "sheet": {
      "createTitle": "Add GPUStack source",
      "editTitle": "Edit source",
      "name": "Name",
      "baseUrl": "GPUStack URL",
      "baseUrlHint": "e.g. http://gpustack.example.com — without /v1 or /v2",
      "apiKey": "API key",
      "apiKeyHint": "Prefer a key created by an admin; scope must include management and inference",
      "apiKeyKeep": "Leave empty to keep the current key",
      "clusterId": "Cluster ID (optional)",
      "clusterIdHint": "Only discover models in this cluster; empty = all",
      "enabled": "Enabled",
      "test": "Test connection",
      "testOk": "Connected, {{count}} models",
      "testFail": "Connection failed: {{error}}"
    }
  },
  "models": {
    "title": "Deployment gate",
    "subtitle": "Automatic acceptance after GPUStack deployment changes: diagnostics → quality gate → benchmark → baseline compare",
    "empty": { "title": "No models discovered yet", "body": "Add a GPUStack source first.", "action": "Add source" },
    "col": { "name": "Model", "source": "Source", "status": "Status", "revision": "Current revision", "lastVerdict": "Last verdict", "automation": "Automation" },
    "status": { "new": "New", "active": "Enabled", "unroutable": "No dedicated route", "removed": "Removed" },
    "runNow": "Run now",
    "runQueued": "Queued",
    "noRun": "—",
    "enableNeedsConfig": "Finish the automation config on the detail page first"
  },
  "verdict": {
    "passed": "Passed",
    "failed": "Failed",
    "regressed": "Regressed",
    "error": "Error",
    "superseded": "Superseded",
    "running": "Running",
    "pending": "Queued"
  },
  "detail": {
    "config": "Automation config",
    "editConfig": "Edit config",
    "route": "GPUStack route",
    "routeAuto": "Auto-resolved",
    "routeManual": "Manual",
    "pickRoute": "Pick route",
    "connection": "Connection",
    "baseline": "Baseline",
    "noBaseline": "Created automatically after the first successful benchmark",
    "schedule": "Scheduled regression",
    "nextRun": "Next run",
    "timeline": "Deployment revisions",
    "noRevisions": "No revisions yet",
    "firstSeen": "First seen",
    "ready": "Ready",
    "notReady": "Not ready",
    "initialRevision": "Initial revision",
    "noRunsForRevision": "No automation runs for this revision",
    "cancelRun": "Cancel",
    "steps": { "diagnostics": "Diagnostics", "quality_gate": "Quality gate", "benchmark": "Benchmark", "compare": "Baseline compare" },
    "outcome": { "ok": "OK", "failed": "Failed", "error": "Error", "skipped": "Skipped" },
    "trigger": { "enable": "On enable", "revision": "Deployment change", "schedule": "Scheduled", "manual": "Manual" },
    "regression": {
      "title": "Performance comparison",
      "notCompared": "Not compared: {{reason}}",
      "metric": { "outputTokensPerSec": "Output throughput", "ttft.p95": "TTFT p95", "itl.p95": "ITL p95" },
      "baselineEstablished": "Baseline established"
    },
    "gateWarning": "Quality gate returned a warning (treated as pass)",
    "links": { "diagnostics": "Diagnostics", "evaluation": "Quality gate report", "benchmark": "Benchmark" }
  },
  "automation": {
    "title": "Automation config",
    "enabled": "Enable automated testing",
    "steps": "Steps",
    "evaluation": "Quality gate evaluation",
    "passRateMin": "Minimum pass rate",
    "template": "Benchmark template",
    "schedule": "Scheduled regression",
    "scheduleOptions": { "off": "Off", "daily": "Daily", "weekly": "Weekly" },
    "thresholds": "Regression thresholds (%)",
    "tpsDrop": "Output throughput drops by more than",
    "ttftRise": "TTFT p95 rises by more than",
    "itlRise": "ITL p95 rises by more than",
    "saved": "Saved"
  }
}
```

在 `apps/web/src/lib/i18n.ts` 三处注册：import `zhDeploymentGate` / `enDeploymentGate`，`resources` 的两个语言下加 `"deployment-gate": ...`，`ns` 数组加 `"deployment-gate"`（照该文件里 `quality-gate` 的写法）。

sidebar：在 `sidebar-config.tsx` 的 `sidebarGroups` 中 `quality-gate` 组之后加

```tsx
  {
    id: "deployment-gate",
    labelKey: "groups.deploymentGate",
    items: [
      { to: "/deployment-gate", icon: ShieldHalf, labelKey: "items.deploymentGateModels" },
      { to: "/deployment-gate/sources", icon: Server, labelKey: "items.deploymentGateSources" },
    ],
  },
```

（`ShieldHalf`、`Server` 从 `lucide-react` 导入；若已被其它项使用也无妨。）`sidebar.json`：zh-CN `groups.deploymentGate: "部署门禁"`、`items.deploymentGateModels: "模型验收"`、`items.deploymentGateSources: "GPUStack 数据源"`；en-US `"Deployment gate"` / `"Models"` / `"GPUStack sources"`。若 `sidebar-config.test.ts` 断言了分组数量或顺序，同步更新该测试。

- [ ] **Step 4: 写失败测试 `SourcesPage.test.tsx`**（照 `features/connections/ConnectionsPage.test.tsx` 的 render/mocking 方式：先读它 `sed -n 1,60p apps/web/src/features/connections/ConnectionsPage.test.tsx`）

```tsx
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SourcesPage } from "./SourcesPage";

vi.mock("./queries", () => ({
  useSources: () => ({
    isLoading: false,
    data: [
      { id: "s1", kind: "gpustack", name: "prod", baseUrl: "http://gs", clusterId: null, enabled: true, lastSyncAt: null, lastSyncError: "HTTP 401", modelCount: 3, createdAt: "", updatedAt: "" },
    ],
  }),
  useDeleteSource: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSyncSource: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateSource: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateSource: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useTestSource: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

describe("SourcesPage", () => {
  it("renders source row with model count and sync error status", () => {
    renderWithProviders(<SourcesPage />);
    expect(screen.getByText("prod")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText(/同步失败|Sync failed/)).toBeInTheDocument();
  });
});
```

`renderWithProviders` 用 ConnectionsPage.test.tsx 里实际使用的渲染 helper（路径和名字照抄；若它内联 `QueryClientProvider` + `MemoryRouter` + i18n，则照样内联）。

- [ ] **Step 5: 运行确认失败**

Run: `pnpm -F @modeldoctor/web test -- src/features/deployment-gate/SourcesPage.test.tsx`
Expected: FAIL

- [ ] **Step 6: 实现 `SourceSheet.tsx`**

```tsx
import { zodResolver } from "@hookform/resolvers/zod";
import type { PlatformSource } from "@modeldoctor/contracts";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z } from "zod";
import { FormActions } from "@/components/common/form-actions";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useCreateSource, useTestSource, useUpdateSource } from "./queries";

const schema = z.object({
  name: z.string().min(1).max(120),
  baseUrl: z.string().url(),
  apiKey: z.string(),
  clusterId: z.string(),
  enabled: z.boolean(),
});
type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existing: PlatformSource | null;
}

export function SourceSheet({ open, onOpenChange, existing }: Props) {
  const { t } = useTranslation("deployment-gate");
  const { t: tCommon } = useTranslation("common");
  const create = useCreateSource();
  const update = useUpdateSource();
  const test = useTestSource();
  const form = useForm<FormValues>({
    mode: "onTouched",
    resolver: zodResolver(
      existing ? schema : schema.extend({ apiKey: z.string().min(1) }),
    ),
    defaultValues: { name: "", baseUrl: "", apiKey: "", clusterId: "", enabled: true },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        name: existing?.name ?? "",
        baseUrl: existing?.baseUrl ?? "",
        apiKey: "",
        clusterId: existing?.clusterId ?? "",
        enabled: existing?.enabled ?? true,
      });
    }
  }, [open, existing, form]);

  async function onTest() {
    const { baseUrl, apiKey } = form.getValues();
    const r = await test.mutateAsync({ baseUrl, apiKey });
    if (r.ok) toast.success(t("sources.sheet.testOk", { count: r.modelCount ?? 0 }));
    else toast.error(t("sources.sheet.testFail", { error: r.error }));
  }

  async function onSubmit(v: FormValues) {
    const clusterId = v.clusterId.trim() || null;
    if (existing) {
      await update.mutateAsync({
        id: existing.id,
        body: { name: v.name, baseUrl: v.baseUrl, clusterId, enabled: v.enabled, ...(v.apiKey ? { apiKey: v.apiKey } : {}) },
      });
    } else {
      await create.mutateAsync({ kind: "gpustack", name: v.name, baseUrl: v.baseUrl, apiKey: v.apiKey, clusterId });
    }
    onOpenChange(false);
  }

  const pending = create.isPending || update.isPending;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[480px] sm:max-w-[480px]">
        <SheetHeader>
          <SheetTitle>{existing ? t("sources.sheet.editTitle") : t("sources.sheet.createTitle")}</SheetTitle>
        </SheetHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="mt-6 space-y-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem>
                <FormLabel required>{t("sources.sheet.name")}</FormLabel>
                <FormControl><Input {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="baseUrl" render={({ field }) => (
              <FormItem>
                <FormLabel required>{t("sources.sheet.baseUrl")}</FormLabel>
                <FormControl><Input placeholder="http://gpustack.example.com" {...field} /></FormControl>
                <FormDescription>{t("sources.sheet.baseUrlHint")}</FormDescription>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="apiKey" render={({ field }) => (
              <FormItem>
                <FormLabel required={!existing}>{t("sources.sheet.apiKey")}</FormLabel>
                <FormControl><Input type="password" autoComplete="off" placeholder={existing ? t("sources.sheet.apiKeyKeep") : ""} {...field} /></FormControl>
                <FormDescription>{t("sources.sheet.apiKeyHint")}</FormDescription>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="clusterId" render={({ field }) => (
              <FormItem>
                <FormLabel>{t("sources.sheet.clusterId")}</FormLabel>
                <FormControl><Input {...field} /></FormControl>
                <FormDescription>{t("sources.sheet.clusterIdHint")}</FormDescription>
              </FormItem>
            )} />
            {existing && (
              <FormField control={form.control} name="enabled" render={({ field }) => (
                <FormItem className="flex items-center justify-between">
                  <FormLabel>{t("sources.sheet.enabled")}</FormLabel>
                  <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                </FormItem>
              )} />
            )}
            <SheetFooter className="pt-4">
              <FormActions
                onCancel={() => onOpenChange(false)}
                cancelLabel={tCommon("actions.cancel")}
                submitLabel={tCommon("actions.save")}
                pending={pending}
                leading={
                  <Button type="button" variant="outline" onClick={onTest} disabled={test.isPending || (!existing && !form.watch("apiKey"))}>
                    {test.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {t("sources.sheet.test")}
                  </Button>
                }
              />
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
```

注：编辑模式下「测试连接」用表单里填的 key；key 留空时改调 `dgApi.testSavedSource(existing.id)`（`onTest` 中判断 `existing && !apiKey`）。`FormDescription` 若 `form.tsx` 未导出，改用 `<p className="text-xs text-muted-foreground">`。`tCommon("actions.cancel"/"actions.save")` 的键名以 `locales/zh-CN/common.json` 实际存在的为准。

- [ ] **Step 7: 实现 `SourcesPage.tsx`**

结构遵循 `docs/project-standards.md` §5 与 `ConnectionsPage.tsx`（先读两者）：

```tsx
import type { PlatformSource } from "@modeldoctor/contracts";
import { MoreHorizontal, Pencil, Plus, RefreshCw, Server, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ConfirmDeleteDialog } from "@/components/common/confirm-delete-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { RelativeTime } from "@/components/common/relative-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDeleteSource, useSources, useSyncSource } from "./queries";
import { SourceSheet } from "./SourceSheet";

function SourceStatus({ s }: { s: PlatformSource }) {
  const { t } = useTranslation("deployment-gate");
  if (!s.enabled) return <Badge variant="secondary">{t("sources.status.disabled")}</Badge>;
  if (s.lastSyncError) return <Badge variant="destructive" title={s.lastSyncError}>{t("sources.status.error")}</Badge>;
  if (!s.lastSyncAt) return <Badge variant="outline">{t("sources.status.never")}</Badge>;
  return <Badge variant="outline">{t("sources.status.ok")}</Badge>;
}

export function SourcesPage() {
  const { t } = useTranslation("deployment-gate");
  const { t: tCommon } = useTranslation("common");
  const { data, isLoading } = useSources();
  const del = useDeleteSource();
  const sync = useSyncSource();
  const [sheet, setSheet] = useState<{ open: boolean; existing: PlatformSource | null }>({ open: false, existing: null });
  const [pendingDelete, setPendingDelete] = useState<PlatformSource | null>(null);

  async function onSync(id: string) {
    try {
      const r = await sync.mutateAsync(id);
      toast.success(t("sources.synced", { count: r.models }));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const addButton = (
    <Button onClick={() => setSheet({ open: true, existing: null })}>
      <Plus className="mr-2 h-4 w-4" />
      {t("sources.add")}
    </Button>
  );

  return (
    <>
      <PageHeader title={t("sources.title")} subtitle={t("sources.subtitle")} rightSlot={addButton} />
      <div className="px-8 py-6 space-y-6">
        {isLoading ? (
          <div className="text-sm text-muted-foreground">{tCommon("table.loading")}</div>
        ) : !data?.length ? (
          <EmptyState icon={Server} title={t("sources.empty.title")} body={t("sources.empty.body")} actions={addButton} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("sources.col.name")}</TableHead>
                <TableHead>{t("sources.col.baseUrl")}</TableHead>
                <TableHead className="text-right">{t("sources.col.models")}</TableHead>
                <TableHead>{t("sources.col.lastSync")}</TableHead>
                <TableHead>{t("sources.col.status")}</TableHead>
                <TableHead className="w-40 text-center">{tCommon("table.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="font-mono text-xs">{s.baseUrl}</TableCell>
                  <TableCell className="text-right">{s.modelCount}</TableCell>
                  <TableCell>{s.lastSyncAt ? <RelativeTime date={s.lastSyncAt} /> : "—"}</TableCell>
                  <TableCell><SourceStatus s={s} /></TableCell>
                  <TableCell className="text-center">
                    <Button variant="ghost" size="icon" title={t("sources.sync")} onClick={() => onSync(s.id)} disabled={sync.isPending}>
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" title={tCommon("actions.edit")} onClick={() => setSheet({ open: true, existing: s })}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem className="text-destructive" onClick={() => setPendingDelete(s)}>
                          <Trash2 className="mr-2 h-4 w-4" />
                          {tCommon("actions.delete")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      <SourceSheet open={sheet.open} existing={sheet.existing} onOpenChange={(open) => setSheet((p) => ({ ...p, open }))} />
      <ConfirmDeleteDialog
        open={!!pendingDelete}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        description={t("sources.deleteConfirm")}
        onConfirm={async () => {
          if (pendingDelete) await del.mutateAsync(pendingDelete.id);
          setPendingDelete(null);
        }}
      />
    </>
  );
}
```

`ConfirmDeleteDialog` / `RelativeTime` 的 props 名以 `components/common/` 中实际定义为准（先 `sed -n 1,30p` 两个文件）；与 `EvaluationsListPage.tsx` 的用法保持一致。

- [ ] **Step 8: 路由**

`apps/web/src/router/index.tsx`：`import { SourcesPage } from "@/features/deployment-gate/SourcesPage";`，children 中加 `{ path: "deployment-gate/sources", element: <SourcesPage /> },`（放在 quality-gate 路由之后）。

- [ ] **Step 9: 测试 + lint + typecheck**

Run: `pnpm -F @modeldoctor/contracts build && pnpm -F @modeldoctor/web test -- src/features/deployment-gate src/components/sidebar && pnpm -F @modeldoctor/web lint && pnpm -F @modeldoctor/web type-check`
Expected: PASS（lint 含 check:i18n / check:components）

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/features/deployment-gate apps/web/src/locales/zh-CN/deployment-gate.json apps/web/src/locales/en-US/deployment-gate.json apps/web/src/lib/i18n.ts apps/web/src/router/index.tsx apps/web/src/components/sidebar apps/web/src/locales/zh-CN/sidebar.json apps/web/src/locales/en-US/sidebar.json
git commit -m "feat(web): 部署门禁 — GPUStack 数据源页"
```

---

### Task 13: Web — 部署门禁模型列表页

**Files:**
- Create: `apps/web/src/features/deployment-gate/VerdictBadge.tsx`
- Create: `apps/web/src/features/deployment-gate/DeploymentGatePage.tsx`
- Create: `apps/web/src/features/deployment-gate/DeploymentGatePage.test.tsx`
- Modify: `apps/web/src/router/index.tsx`（`deployment-gate`）

**Interfaces:**
- Consumes: `useDiscoveredModels`、`useSources`、`dgApi.updateModel` / `dgApi.runModel`
- Produces: `VerdictBadge({ run }: { run: AutomationRunPublic | null })`；`ModelStatusBadge({ status })`（同文件导出，Task 14 复用）

- [ ] **Step 1: 写失败测试**

```tsx
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DeploymentGatePage } from "./DeploymentGatePage";

const model = {
  id: "m1", sourceId: "s1", sourceName: "prod", externalId: "7", name: "qwen", categories: ["llm"], clusterId: "1",
  status: "unroutable", routeName: null, routeOverride: false, connectionId: null,
  currentRevision: { id: "r1", fingerprint: "abc", backend: "vLLM", backendVersion: "0.11.0", readyAt: "2026-09-22T00:00:00Z" },
  automationEnabled: false, steps: ["diagnostics"], evaluationId: null, gateConfig: null, benchmarkTemplateId: null,
  schedule: "off", nextScheduledAt: null, baselineId: null, regressionThresholds: null,
  lastRun: { id: "a1", discoveredModelId: "m1", revisionId: "r1", trigger: "revision", status: "completed", currentStep: null, verdict: "regressed", diagnosticsRunId: null, evaluationRunId: null, benchmarkId: null, summary: null, startedAt: null, finishedAt: null, createdAt: "" },
};

vi.mock("./queries", () => ({
  useDiscoveredModels: () => ({ isLoading: false, data: [model] }),
  useSources: () => ({ isLoading: false, data: [{ id: "s1" }] }),
}));

describe("DeploymentGatePage", () => {
  it("renders model link, backend version, status and verdict", () => {
    renderWithProviders(<DeploymentGatePage />);
    expect(screen.getByRole("link", { name: "qwen" })).toHaveAttribute("href", "/deployment-gate/models/m1");
    expect(screen.getByText("vLLM 0.11.0")).toBeInTheDocument();
    expect(screen.getByText(/无专属路由|No dedicated route/)).toBeInTheDocument();
    expect(screen.getByText(/性能退化|Regressed/)).toBeInTheDocument();
  });
});
```

（`renderWithProviders` 同 Task 12 Step 4。）

- [ ] **Step 2: 运行确认失败**

Run: `pnpm -F @modeldoctor/web test -- src/features/deployment-gate/DeploymentGatePage.test.tsx`
Expected: FAIL

- [ ] **Step 3: `VerdictBadge.tsx`**

```tsx
import type { AutomationRunPublic, DiscoveredModelStatus } from "@modeldoctor/contracts";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";

const VERDICT_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  passed: "default",
  failed: "destructive",
  regressed: "destructive",
  error: "destructive",
  superseded: "secondary",
};

export function VerdictBadge({ run }: { run: AutomationRunPublic | null }) {
  const { t } = useTranslation("deployment-gate");
  if (!run) return <span className="text-muted-foreground">{t("models.noRun")}</span>;
  if (run.status === "pending" || run.status === "running") {
    return <Badge variant="outline">{t(`verdict.${run.status}`)}</Badge>;
  }
  if (!run.verdict) return <span className="text-muted-foreground">{t("models.noRun")}</span>;
  return <Badge variant={VERDICT_VARIANT[run.verdict] ?? "outline"}>{t(`verdict.${run.verdict}`)}</Badge>;
}

export function ModelStatusBadge({ status }: { status: DiscoveredModelStatus }) {
  const { t } = useTranslation("deployment-gate");
  const variant = status === "unroutable" ? "destructive" : status === "removed" ? "secondary" : status === "new" ? "default" : "outline";
  return <Badge variant={variant}>{t(`models.status.${status}`)}</Badge>;
}
```

- [ ] **Step 4: `DeploymentGatePage.tsx`**

```tsx
import type { DiscoveredModelPublic } from "@modeldoctor/contracts";
import { ArrowRight, Play, ShieldHalf } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dgApi } from "./api";
import { useDiscoveredModels, useSources } from "./queries";
import { ModelStatusBadge, VerdictBadge } from "./VerdictBadge";
import { useQueryClient } from "@tanstack/react-query";

export function DeploymentGatePage() {
  const { t } = useTranslation("deployment-gate");
  const { t: tCommon } = useTranslation("common");
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading } = useDiscoveredModels();
  const sources = useSources();

  async function toggle(m: DiscoveredModelPublic, enabled: boolean) {
    try {
      await dgApi.updateModel(m.id, { automationEnabled: enabled });
      await qc.invalidateQueries({ queryKey: ["deployment-gate"] });
    } catch {
      toast.error(t("models.enableNeedsConfig"));
      nav(`/deployment-gate/models/${m.id}`);
    }
  }

  async function runNow(m: DiscoveredModelPublic) {
    await dgApi.runModel(m.id);
    toast.success(t("models.runQueued"));
    await qc.invalidateQueries({ queryKey: ["deployment-gate"] });
  }

  return (
    <>
      <PageHeader title={t("models.title")} subtitle={t("models.subtitle")} />
      <div className="px-8 py-6 space-y-6">
        {isLoading ? (
          <div className="text-sm text-muted-foreground">{tCommon("table.loading")}</div>
        ) : !data?.length ? (
          <EmptyState
            icon={ShieldHalf}
            title={t("models.empty.title")}
            body={t("models.empty.body")}
            actions={!sources.data?.length ? <Button asChild><Link to="/deployment-gate/sources">{t("models.empty.action")}</Link></Button> : undefined}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("models.col.name")}</TableHead>
                <TableHead>{t("models.col.source")}</TableHead>
                <TableHead>{t("models.col.status")}</TableHead>
                <TableHead>{t("models.col.revision")}</TableHead>
                <TableHead>{t("models.col.lastVerdict")}</TableHead>
                <TableHead>{t("models.col.automation")}</TableHead>
                <TableHead className="w-40 text-center">{tCommon("table.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">
                    <Link className="hover:text-primary hover:underline" to={`/deployment-gate/models/${m.id}`}>{m.name}</Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{m.sourceName}{m.clusterId ? ` · #${m.clusterId}` : ""}</TableCell>
                  <TableCell><ModelStatusBadge status={m.status} /></TableCell>
                  <TableCell className="font-mono text-xs">
                    {m.currentRevision ? `${m.currentRevision.backend ?? "?"} ${m.currentRevision.backendVersion ?? ""}`.trim() : "—"}
                  </TableCell>
                  <TableCell><VerdictBadge run={m.lastRun} /></TableCell>
                  <TableCell>
                    <Switch
                      checked={m.automationEnabled}
                      disabled={m.status === "unroutable" || m.status === "removed"}
                      onCheckedChange={(v) => toggle(m, v)}
                    />
                  </TableCell>
                  <TableCell className="text-center">
                    <Button variant="ghost" size="icon" title={tCommon("actions.detail")} asChild>
                      <Link to={`/deployment-gate/models/${m.id}`}><ArrowRight className="h-4 w-4" /></Link>
                    </Button>
                    <Button variant="ghost" size="icon" title={t("models.runNow")} disabled={!m.automationEnabled} onClick={() => runNow(m)}>
                      <Play className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </>
  );
}
```

（biome 会要求 import 排序：把 `@tanstack/react-query` 移到正确位置；`tCommon("actions.detail")` 键名以 common.json 为准。）

- [ ] **Step 5: 路由** —— `import { DeploymentGatePage } from "@/features/deployment-gate/DeploymentGatePage";`，加 `{ path: "deployment-gate", element: <DeploymentGatePage /> },`（放在 `deployment-gate/sources` 之前）。

- [ ] **Step 6: 测试 + lint + typecheck**

Run: `pnpm -F @modeldoctor/web test -- src/features/deployment-gate && pnpm -F @modeldoctor/web lint && pnpm -F @modeldoctor/web type-check`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/deployment-gate apps/web/src/router/index.tsx
git commit -m "feat(web): 部署门禁 — 模型列表页"
```

---

### Task 14: Web — 模型详情页（配置 + revision 时间线）

**Files:**
- Create: `apps/web/src/features/deployment-gate/AutomationSheet.tsx`
- Create: `apps/web/src/features/deployment-gate/RevisionTimeline.tsx`
- Create: `apps/web/src/features/deployment-gate/RevisionTimeline.test.tsx`
- Create: `apps/web/src/features/deployment-gate/ModelDetailPage.tsx`
- Modify: `apps/web/src/router/index.tsx`（`deployment-gate/models/:id`）

**Interfaces:**
- Consumes: `useDiscoveredModel`、`useUpdateDiscoveredModel`、`useRunDiscoveredModel`、`useRevisions`、`useRoutes`、`useCancelAutomationRun`；`useEvaluations()`（`features/quality-gate/queries`）；`useTemplates()`（`features/benchmark-templates/queries`）；`VerdictBadge` / `ModelStatusBadge`
- Produces: `RevisionTimeline({ revisions, onCancelRun })`、`AutomationSheet({ open, onOpenChange, model })`

- [ ] **Step 1: 写失败测试 `RevisionTimeline.test.tsx`**

```tsx
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RevisionTimeline } from "./RevisionTimeline";

const revisions = [
  {
    id: "r2", fingerprint: "bbbbbbbbbbbb", snapshot: {}, firstSeenAt: "2026-09-21T00:00:00Z", readyAt: "2026-09-21T00:01:00Z",
    diff: [{ field: "backend_version", before: "0.10.1", after: "0.11.0" }],
    runs: [{
      id: "a2", discoveredModelId: "m", revisionId: "r2", trigger: "revision", status: "completed", currentStep: null, verdict: "regressed",
      diagnosticsRunId: "d", evaluationRunId: "e", benchmarkId: "b", startedAt: null, finishedAt: null, createdAt: "2026-09-21T00:02:00Z",
      summary: {
        steps: [{ step: "diagnostics", outcome: "ok" }, { step: "quality_gate", outcome: "ok" }, { step: "benchmark", outcome: "ok" }, { step: "compare", outcome: "ok" }],
        regression: { compared: true, baselineId: "bl", metrics: [
          { metric: "outputTokensPerSec", baseline: 1000, current: 850, changePct: -15, thresholdPct: 10, exceeded: true },
        ] },
      },
    }],
  },
  { id: "r1", fingerprint: "aaaaaaaaaaaa", snapshot: {}, firstSeenAt: "2026-09-20T00:00:00Z", readyAt: null, diff: [], runs: [] },
];

describe("RevisionTimeline", () => {
  it("shows config diff, verdict, regression metric and links", () => {
    renderWithProviders(<RevisionTimeline revisions={revisions} onCancelRun={vi.fn()} />);
    expect(screen.getByText("backend_version")).toBeInTheDocument();
    expect(screen.getByText("0.10.1")).toBeInTheDocument();
    expect(screen.getByText("0.11.0")).toBeInTheDocument();
    expect(screen.getByText(/性能退化|Regressed/)).toBeInTheDocument();
    expect(screen.getByText("-15.0%")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /压测详情|Benchmark/ })).toHaveAttribute("href", "/benchmarks/b");
    expect(screen.getByRole("link", { name: /质量门禁报告|Quality gate report/ })).toHaveAttribute("href", "/quality-gate/runs/e");
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm -F @modeldoctor/web test -- src/features/deployment-gate/RevisionTimeline.test.tsx`
Expected: FAIL

- [ ] **Step 3: `RevisionTimeline.tsx`**

```tsx
import type { AutomationRunPublic, DeploymentRevisionPublic } from "@modeldoctor/contracts";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { RelativeTime } from "@/components/common/relative-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { VerdictBadge } from "./VerdictBadge";

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

function RunCard({ run, onCancel }: { run: AutomationRunPublic; onCancel: (id: string) => void }) {
  const { t } = useTranslation("deployment-gate");
  const active = run.status === "pending" || run.status === "running";
  return (
    <div className="rounded-md border border-border p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <VerdictBadge run={run} />
        <span className="text-muted-foreground">{t(`detail.trigger.${run.trigger}`)}</span>
        <span className="text-muted-foreground">·</span>
        <RelativeTime date={run.createdAt} />
        {active && run.currentStep && <span className="text-muted-foreground">· {t(`detail.steps.${run.currentStep}`)}</span>}
        {active && (
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => onCancel(run.id)}>{t("detail.cancelRun")}</Button>
        )}
      </div>
      {run.summary?.steps.length ? (
        <div className="flex flex-wrap gap-2 text-xs">
          {run.summary.steps.map((s) => (
            <Badge key={s.step} variant={s.outcome === "ok" ? "outline" : "destructive"} title={s.message}>
              {t(`detail.steps.${s.step}`)}: {t(`detail.outcome.${s.outcome}`)}
            </Badge>
          ))}
        </div>
      ) : null}
      {run.summary?.gateWarning && <p className="text-xs text-amber-600">{t("detail.gateWarning")}</p>}
      {run.summary?.baselineEstablished && <p className="text-xs text-muted-foreground">{t("detail.regression.baselineEstablished")}</p>}
      {run.summary?.regression && !run.summary.regression.compared && !run.summary.baselineEstablished && (
        <p className="text-xs text-muted-foreground">{t("detail.regression.notCompared", { reason: run.summary.regression.reason ?? "" })}</p>
      )}
      {run.summary?.regression?.compared && (
        <table className="text-xs">
          <tbody>
            {run.summary.regression.metrics.map((m) => (
              <tr key={m.metric} className={m.exceeded ? "text-destructive" : ""}>
                <td className="pr-4">{t(`detail.regression.metric.${m.metric}`)}</td>
                <td className="pr-4 font-mono">{fmt(m.baseline)} → {fmt(m.current)}</td>
                <td className="font-mono">{m.changePct === null ? "—" : `${m.changePct.toFixed(1)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="flex gap-3 text-xs">
        {run.diagnosticsRunId && <Link className="hover:underline" to={`/diagnostics?runId=${run.diagnosticsRunId}`}>{t("detail.links.diagnostics")}</Link>}
        {run.evaluationRunId && <Link className="hover:underline" to={`/quality-gate/runs/${run.evaluationRunId}`}>{t("detail.links.evaluation")}</Link>}
        {run.benchmarkId && <Link className="hover:underline" to={`/benchmarks/${run.benchmarkId}`}>{t("detail.links.benchmark")}</Link>}
      </div>
    </div>
  );
}

export function RevisionTimeline({
  revisions,
  onCancelRun,
}: {
  revisions: DeploymentRevisionPublic[];
  onCancelRun: (runId: string) => void;
}) {
  const { t } = useTranslation("deployment-gate");
  if (!revisions.length) return <p className="text-sm text-muted-foreground">{t("detail.noRevisions")}</p>;
  return (
    <ol className="space-y-6 border-l border-border pl-6">
      {revisions.map((rev, idx) => (
        <li key={rev.id} className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-mono">{rev.fingerprint.slice(0, 12)}</span>
            <Badge variant={rev.readyAt ? "outline" : "secondary"}>{rev.readyAt ? t("detail.ready") : t("detail.notReady")}</Badge>
            <span className="text-muted-foreground">{t("detail.firstSeen")} <RelativeTime date={rev.firstSeenAt} /></span>
          </div>
          {idx === revisions.length - 1 && rev.diff.length > 0 ? (
            <p className="text-xs text-muted-foreground">{t("detail.initialRevision")}</p>
          ) : rev.diff.length > 0 ? (
            <table className="text-xs">
              <tbody>
                {rev.diff.map((d) => (
                  <tr key={d.field}>
                    <td className="pr-4 font-mono text-muted-foreground">{d.field}</td>
                    <td className="pr-2 font-mono line-through opacity-60">{fmt(d.before)}</td>
                    <td className="font-mono">{fmt(d.after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {rev.runs.length ? (
            <div className="space-y-2">{rev.runs.map((r) => <RunCard key={r.id} run={r} onCancel={onCancelRun} />)}</div>
          ) : (
            <p className="text-xs text-muted-foreground">{t("detail.noRunsForRevision")}</p>
          )}
        </li>
      ))}
    </ol>
  );
}
```

诊断详情链接：先 `grep -n "diagnostics" apps/web/src/router/index.tsx` 确认诊断页是否支持按 runId 定位；若不支持，去掉 `diagnosticsRunId` 链接（保留 badge），并在 task 结尾报告。`RelativeTime` 的 prop 名以实际组件为准。

- [ ] **Step 4: `AutomationSheet.tsx`**

```tsx
import {
  AUTOMATION_STEPS,
  type AutomationSchedule,
  type AutomationStep,
  DEFAULT_REGRESSION_THRESHOLDS,
  type DiscoveredModelPublic,
} from "@modeldoctor/contracts";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { FormActions } from "@/components/common/form-actions";
import { FormSection } from "@/components/common/form-section";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useTemplates } from "@/features/benchmark-templates/queries";
import { useEvaluations } from "@/features/quality-gate/queries";
import { useUpdateDiscoveredModel } from "./queries";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  model: DiscoveredModelPublic;
}

export function AutomationSheet({ open, onOpenChange, model }: Props) {
  const { t } = useTranslation("deployment-gate");
  const { t: tCommon } = useTranslation("common");
  const update = useUpdateDiscoveredModel(model.id);
  const evaluations = useEvaluations();
  const templates = useTemplates();

  const [enabled, setEnabled] = useState(model.automationEnabled);
  const [steps, setSteps] = useState<AutomationStep[]>(model.steps);
  const [evaluationId, setEvaluationId] = useState(model.evaluationId ?? "");
  const [passRateMin, setPassRateMin] = useState(model.gateConfig?.passRateMin ?? 0.9);
  const [templateId, setTemplateId] = useState(model.benchmarkTemplateId ?? "");
  const [schedule, setSchedule] = useState<AutomationSchedule>(model.schedule);
  const [th, setTh] = useState(model.regressionThresholds ?? DEFAULT_REGRESSION_THRESHOLDS);

  useEffect(() => {
    if (!open) return;
    setEnabled(model.automationEnabled);
    setSteps(model.steps);
    setEvaluationId(model.evaluationId ?? "");
    setPassRateMin(model.gateConfig?.passRateMin ?? 0.9);
    setTemplateId(model.benchmarkTemplateId ?? "");
    setSchedule(model.schedule);
    setTh(model.regressionThresholds ?? DEFAULT_REGRESSION_THRESHOLDS);
  }, [open, model]);

  function toggleStep(s: AutomationStep, on: boolean) {
    setSteps((prev) => (on ? AUTOMATION_STEPS.filter((x) => x === s || prev.includes(x)) : prev.filter((x) => x !== s)));
  }

  async function save() {
    try {
      await update.mutateAsync({
        automationEnabled: enabled,
        steps,
        evaluationId: evaluationId || null,
        gateConfig: steps.includes("quality_gate") ? { passRateMin } : null,
        benchmarkTemplateId: templateId || null,
        schedule,
        regressionThresholds: th,
      });
      toast.success(t("automation.saved"));
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const templateList = Array.isArray(templates.data) ? templates.data : (templates.data?.items ?? []);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[520px] sm:max-w-[520px] overflow-y-auto">
        <SheetHeader><SheetTitle>{t("automation.title")}</SheetTitle></SheetHeader>
        <div className="mt-6 space-y-6">
          <div className="flex items-center justify-between">
            <Label>{t("automation.enabled")}</Label>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
          <FormSection title={t("automation.steps")}>
            {AUTOMATION_STEPS.map((s) => (
              <div key={s} className="flex items-center gap-2">
                <Checkbox id={`step-${s}`} checked={steps.includes(s)} onCheckedChange={(v) => toggleStep(s, v === true)} />
                <Label htmlFor={`step-${s}`}>{t(`detail.steps.${s}`)}</Label>
              </div>
            ))}
          </FormSection>
          {steps.includes("quality_gate") && (
            <FormSection title={t("automation.evaluation")}>
              <Select value={evaluationId} onValueChange={setEvaluationId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(evaluations.data ?? []).map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Label>{t("automation.passRateMin")}</Label>
              <Input type="number" min={0} max={1} step={0.05} value={passRateMin} onChange={(e) => setPassRateMin(Number(e.target.value))} />
            </FormSection>
          )}
          {steps.includes("benchmark") && (
            <FormSection title={t("automation.template")}>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {templateList.map((tpl) => <SelectItem key={tpl.id} value={tpl.id}>{tpl.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Label>{t("automation.schedule")}</Label>
              <Select value={schedule} onValueChange={(v) => setSchedule(v as AutomationSchedule)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(["off", "daily", "weekly"] as const).map((s) => <SelectItem key={s} value={s}>{t(`automation.scheduleOptions.${s}`)}</SelectItem>)}
                </SelectContent>
              </Select>
              <Label>{t("automation.thresholds")}</Label>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div><Label className="text-xs">{t("automation.tpsDrop")}</Label>
                  <Input type="number" min={0} value={th.outputTokensPerSecDropPct} onChange={(e) => setTh({ ...th, outputTokensPerSecDropPct: Number(e.target.value) })} /></div>
                <div><Label className="text-xs">{t("automation.ttftRise")}</Label>
                  <Input type="number" min={0} value={th.ttftP95RisePct} onChange={(e) => setTh({ ...th, ttftP95RisePct: Number(e.target.value) })} /></div>
                <div><Label className="text-xs">{t("automation.itlRise")}</Label>
                  <Input type="number" min={0} value={th.itlP95RisePct} onChange={(e) => setTh({ ...th, itlP95RisePct: Number(e.target.value) })} /></div>
              </div>
            </FormSection>
          )}
        </div>
        <SheetFooter className="pt-6">
          <FormActions
            onCancel={() => onOpenChange(false)}
            cancelLabel={tCommon("actions.cancel")}
            submitLabel={tCommon("actions.save")}
            pending={update.isPending}
            disabled={steps.length === 0}
          />
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
```

`FormActions` 的 submit 按钮若是 `type="submit"`（依赖外层 `<form>`），把整个 body 包进 `<form onSubmit={(e) => { e.preventDefault(); void save(); }}>`；先读 `components/common/form-actions.tsx` 确认。`useTemplates()` 返回形状（数组或分页 `{items}`）以实际为准——上面的 `templateList` 兼容两者，确认后删掉不需要的分支。

- [ ] **Step 5: `ModelDetailPage.tsx`**

```tsx
import { Play, Settings2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/page-header";
import { RelativeTime } from "@/components/common/relative-time";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AutomationSheet } from "./AutomationSheet";
import {
  useCancelAutomationRun,
  useDiscoveredModel,
  useRevisions,
  useRoutes,
  useRunDiscoveredModel,
  useUpdateDiscoveredModel,
} from "./queries";
import { RevisionTimeline } from "./RevisionTimeline";
import { ModelStatusBadge } from "./VerdictBadge";

export function ModelDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation("deployment-gate");
  const { t: tSidebar } = useTranslation("sidebar");
  const model = useDiscoveredModel(id);
  const active = model.data?.lastRun?.status === "pending" || model.data?.lastRun?.status === "running";
  const revisions = useRevisions(id, { poll: active });
  const routes = useRoutes(model.data?.status === "unroutable" ? model.data.sourceId : undefined);
  const update = useUpdateDiscoveredModel(id ?? "");
  const run = useRunDiscoveredModel(id ?? "");
  const cancel = useCancelAutomationRun();
  const [sheetOpen, setSheetOpen] = useState(false);

  const m = model.data;
  const breadcrumbs = [
    { label: tSidebar("groups.deploymentGate") },
    { label: tSidebar("items.deploymentGateModels"), to: "/deployment-gate" },
    { label: m?.name ?? "…" },
  ];

  return (
    <>
      <PageHeader
        title={m?.name ?? "…"}
        subtitle={m ? `${m.sourceName}${m.clusterId ? ` · #${m.clusterId}` : ""}` : undefined}
        breadcrumbs={breadcrumbs}
        rightSlot={
          m && (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setSheetOpen(true)} disabled={m.status === "unroutable" || m.status === "removed"}>
                <Settings2 className="mr-2 h-4 w-4" />{t("detail.editConfig")}
              </Button>
              <Button
                disabled={!m.automationEnabled || run.isPending}
                onClick={async () => { await run.mutateAsync(); toast.success(t("models.runQueued")); }}
              >
                <Play className="mr-2 h-4 w-4" />{t("models.runNow")}
              </Button>
            </div>
          )
        }
      />
      <div className="px-8 py-6 space-y-8">
        {m && (
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2 text-sm">
            <div><span className="text-muted-foreground">{t("models.col.status")}：</span><ModelStatusBadge status={m.status} /></div>
            <div>
              <span className="text-muted-foreground">{t("detail.route")}：</span>
              {m.status === "unroutable" ? (
                <Select onValueChange={(v) => update.mutate({ routeName: v })}>
                  <SelectTrigger className="inline-flex w-64"><SelectValue placeholder={t("detail.pickRoute")} /></SelectTrigger>
                  <SelectContent>
                    {(routes.data ?? []).map((r) => <SelectItem key={r.name} value={r.name}>{r.name} ({r.targets})</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <span className="font-mono">{m.routeName} <span className="text-muted-foreground">({m.routeOverride ? t("detail.routeManual") : t("detail.routeAuto")})</span></span>
              )}
            </div>
            <div>
              <span className="text-muted-foreground">{t("detail.connection")}：</span>
              {m.connectionId ? <Link className="hover:underline" to={`/connections?highlight=${m.connectionId}`}>{m.routeName}</Link> : "—"}
            </div>
            <div>
              <span className="text-muted-foreground">{t("detail.baseline")}：</span>
              {m.baselineId ?? <span className="text-muted-foreground">{t("detail.noBaseline")}</span>}
            </div>
            <div>
              <span className="text-muted-foreground">{t("detail.schedule")}：</span>
              {t(`automation.scheduleOptions.${m.schedule}`)}
              {m.nextScheduledAt && <> · {t("detail.nextRun")} <RelativeTime date={m.nextScheduledAt} /></>}
            </div>
          </section>
        )}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("detail.timeline")}</h2>
          <RevisionTimeline revisions={revisions.data ?? []} onCancelRun={(rid) => cancel.mutate(rid)} />
        </section>
      </div>
      {m && <AutomationSheet open={sheetOpen} onOpenChange={setSheetOpen} model={m} />}
    </>
  );
}
```

Connection 链接：先 `grep -n "connections" apps/web/src/router/index.tsx` 看是否有连接详情路由；有则链到详情，没有则链到 `/connections`（去掉 `?highlight=`）。中文全角冒号「：」会被 `check:i18n`（禁止硬编码中文）拦截——改为 `<span>{t("models.col.status")}</span>` + CSS 间距（`mr-2`），不要写字面量冒号。

- [ ] **Step 6: 路由** —— `import { ModelDetailPage } from "@/features/deployment-gate/ModelDetailPage";`，加 `{ path: "deployment-gate/models/:id", element: <ModelDetailPage /> },`。

- [ ] **Step 7: 测试 + lint + typecheck**

Run: `pnpm -F @modeldoctor/web test -- src/features/deployment-gate && pnpm -F @modeldoctor/web lint && pnpm -F @modeldoctor/web type-check`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/deployment-gate apps/web/src/router/index.tsx
git commit -m "feat(web): 部署门禁 — 模型详情页（自动化配置 + 部署版本时间线）"
```

---

### Task 15: 全量验证 + 浏览器手测

**Files:** 无新增（仅修复验证中发现的问题）

- [ ] **Step 1: 全量静态检查与测试**

Run: `pnpm -r build && pnpm lint && pnpm type-check && pnpm -F @modeldoctor/contracts test && pnpm -F @modeldoctor/api test && pnpm -F @modeldoctor/web test && pnpm test:e2e:api`
Expected: 全部 PASS。任何失败先修复再继续；若失败与本分支无关（main 上同样失败），记录并报告。

- [ ] **Step 2: 浏览器手测（本地）**

启动一次性 dev（结束后必须关闭）：`pnpm dev`（后台），登录（开发账号见 memory），然后：
1. 用一个本地假 GPUStack（可直接复用 Task 11 e2e 里的 `createServer` 片段写成 scratchpad 脚本 `node fake-gpustack.mjs`，监听固定端口）或真实 GPUStack，添加数据源 → 测试连接 → 同步。
2. 模型列表出现模型；详情页显示初始 revision。
3. 在假服务器上改 `backend_parameters` → 等 ≤ 5 分钟或点「立即同步」→ 时间线出现新 revision 与 diff。
4. 开启自动化（仅诊断）→ 列表判定变为「通过」。
5. 截图数据源页、列表页、详情页（`mcp__playwright__browser_take_screenshot`），检查暗色主题下可读。
6. 关闭 dev server（`pkill -f "vite|nest start|pnpm dev"` 仅限本会话启动的进程）。

- [ ] **Step 3: 修复与提交**（如有）

```bash
git add <修改的文件>
git commit -m "fix(deployment-gate): <具体问题>"
```

- [ ] **Step 4: 推送 + PR**

```bash
git push -u origin feat/gpustack-deployment-gate
gh pr create --title "feat: GPUStack 部署门禁 — 自动发现 + 自动化测试" --body "<按 spec 概述；列出 AutomationRun.sourceId 冗余字段、同源串行（而非 spec 早期的同源 1 个 benchmark）、被删模型在跑 benchmark 不主动取消 三点实现取舍；Test plan 勾选 Step 1/2 结果>"
```

然后按仓库 CLAUDE.md 的 PR follow-through 检查 CI、review 评论。

---

## Self-Review 记录

- **Spec 覆盖**：§4 数据模型 → T1；§5.1 client/watch/cron → T4/T7/T8；§5.2 对账 1–8 → T6（路由 T3/T6、Connection T6、指纹 T3、就绪 T6、removed T6）；§6.1 触发 → T8（revision/schedule）+ T10（enable/manual）；§6.2 执行 → T8；§6.3 幂等/串行/租约 → T1 唯一约束 + T8；§6.4 回归 → T3 + T8 compare；§6.5 通知 → T9 + T8；§7 API → T5/T6/T10；§8 前端 → T12–T14；§9 错误处理 → T6（lastSyncError、不误删）、T7（心跳/退避）、T8（superseded/error）；§10 测试 → 各 task + T11 + T15。
- **偏差（已在 plan 中标注，PR 描述需说明）**：`AutomationRun.sourceId` 冗余列；`Connection.discoveredModelId` 以一对一反向关系实现（外键在 DiscoveredModel 一侧）；被删模型的在跑子任务不主动取消。
- **类型一致性**：`enqueue` 返回 `string | null`（T8 定义，T10 使用）；`cancel(runId, verdict: "superseded" | null)`（T8 定义，T10 用 `null`）；`toRunPublic` 在 T10 定义并导出；`ReadyRevisionEvent` 在 T6 定义、T8 通过 `setReadyListener` 使用。
