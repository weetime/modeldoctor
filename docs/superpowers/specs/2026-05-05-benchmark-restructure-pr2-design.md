# Benchmark restructure PR2: benchmark_templates CRUD + 列表/编辑 UI

**Status:** approved spec, awaiting implementation plan
**Date:** 2026-05-05
**Scope:** PR2 of the benchmark module restructure (#94 / #96)
**Depends on:** PR1 (#100, #103) — schema + module skeleton + contract已在 main
**DB strategy:** 不需要 reset,PR1 已经把 `benchmark_templates` 表与 `Benchmark.templateId` FK 推到位

## Goal

补完模板这条产品线 P0 实现的"业务层"洞:

1. **后端**:从 PR1 的 `BenchmarkTemplateRepository.findByIdOrNull` skeleton 扩展为完整 CRUD,加 controller + service,挂 5 个 endpoint。
2. **权限**:任何登录用户可读所有模板;owner 或 admin 可改/删;只有 admin 能在创建时把 `isOfficial` 设为 true;`isOfficial` 创建后不可改。
3. **校验**:`(scenario, tool)` 必须是合法 pair(adapter 自身声明);`config` 必须通过 `applyScenarioConstraints(scenario, tool)` + adapter 原 schema 的双 parse(完全镜像 `BenchmarkService.create` 的模式)。
4. **前端**:列表页(三 scenario tab + 官方优先 + 搜索)/ 创建页 / 编辑页;sidebar 加菜单项「测试模板」补 PR1 预留位置。
5. **Form 复用**:把 `BenchmarkCreatePage` 里的 tool picker + params form 部分抽成共享组件 `<ToolParamsEditor>`,被 BenchmarkCreatePage 和模板表单同时消费。这一步既消除即将出现的代码重复,也为 PR3 三 tab 创建流(从模板/从历史预填)准备好统一的 form 入口。

## Non-goals

- **Save-as-template 按钮**(`benchmark detail → 保存为模板`)。属于 PR4 范围,本 PR 不做。
- **三 tab 创建流**(从模板 / 从历史 / 从空白 的 modal/drawer)。属于 PR3 范围,本 PR 不做。
- **官方模板手动 seed**。属于 PR4 后的运维任务,不在任何 PR 内。
- **Template `usageCount` / `lastUsedAt` 统计**。spec L30 已 defer 到 P1+。
- **Template 复制 / 复用为新模板**(duplicate action)。issue 没要求,defer。
- **多租户共享 / scope='team'**。spec L28 已 defer 到 P1+。
- **Template 版本演进 / migration**(adapter schema 变化时旧模板的处理)。spec L593 已 defer 到 P1+。

## Background — PR1 留下的现状

PR1 已经落地的部分:

| 层 | 现状 |
|---|---|
| Prisma schema | `BenchmarkTemplate` 表完整(id/name/description/scenario/tool/config/isOfficial/createdBy/tags/createdAt/updatedAt + 4 个 index);`Benchmark.templateId` FK `onDelete: SetNull` |
| Contract | `packages/contracts/src/benchmark-template.ts` 完整 — `benchmarkTemplateSchema` / `listBenchmarkTemplatesQuerySchema` / `createBenchmarkTemplateRequestSchema` / `updateBenchmarkTemplateRequestSchema`(后者是 `create.partial()`) |
| 后端 module | `apps/api/src/modules/benchmark-template/` 三文件:`module.ts`(只 export repo)、`repository.ts`(只 `findByIdOrNull`)、`repository.spec.ts`(只验 miss 返回 null) |
| 前端 sidebar | `sidebar-config.tsx:57` 注释:`// benchmark-templates entry omitted in PR1; lands in PR2.`,位置是 benchmarks 组最末 |
| 前端 router | `/benchmark-templates*` 三条路由都还没有 |
| 前端 i18n | `sidebar.json` 没有 `items.benchmarkTemplates` key;没有 `benchmark-templates.json` 文件 |

PR2 在这些就位的脚手架上扩展。

## Architecture

### 模块边界

`apps/api/src/modules/benchmark-template/`(沿用 PR1 的目录,扩展三个新文件 + 扩展两个老文件):

```
benchmark-template/
├── benchmark-template.module.ts           ← 改:注册 controller + service + PrismaService(已有)
├── benchmark-template.controller.ts       NEW
├── benchmark-template.controller.spec.ts  NEW
├── benchmark-template.service.ts          NEW
├── benchmark-template.service.spec.ts     NEW
├── benchmark-template.repository.ts       ← 扩展:findByIdOrNull → 全 CRUD
└── benchmark-template.repository.spec.ts  ← 扩展:加 list/create/update/delete 用例
```

模块仍然 export `BenchmarkTemplateRepository`(`BenchmarkService.create()` 已经依赖它做 `findByIdOrNull` 校验,L148-158)。

### API surface

| Method | Path | Auth | 备注 |
|---|---|---|---|
| `GET` | `/api/benchmark-templates` | JWT | query: `scenario? tool? isOfficial? search? cursor? limit?`(全部 schema 已在 PR1 contract);游标分页 |
| `GET` | `/api/benchmark-templates/:id` | JWT | 任何登录用户可读 |
| `POST` | `/api/benchmark-templates` | JWT | body 含 `isOfficial:true` 但 caller 非 admin → 403 `BENCHMARK_TEMPLATE_OFFICIAL_FORBIDDEN` |
| `PATCH` | `/api/benchmark-templates/:id` | JWT | owner 或 admin → 200,否则 403;**update body schema omit `isOfficial / scenario / tool`** |
| `DELETE` | `/api/benchmark-templates/:id` | JWT | 204;owner 或 admin |

### 权限模型(完整决定矩阵)

| 操作 | 普通用户(非 owner)| owner(普通用户)| admin |
|---|---|---|---|
| 读列表 | ✅ | ✅ | ✅ |
| 读 detail | ✅ | ✅ | ✅ |
| 创建(`isOfficial:false`)| ✅ | n/a | ✅ |
| 创建(`isOfficial:true`)| 403 | n/a | ✅ |
| update name/description/config/tags | 403 | ✅ | ✅ |
| update `isOfficial`、`scenario`、`tool` | n/a(schema 已 omit)| n/a(schema 已 omit)| n/a(schema 已 omit)|
| delete | 403 | ✅ | ✅ |

**关键不变量:`isOfficial` 在 row 创建后任何人都不能改**(包括 admin)。这通过两层防护实现:
1. 服务端 update DTO schema 用 `createBenchmarkTemplateRequestSchema.omit({ isOfficial: true, scenario: true, tool: true }).partial()`,这三字段在 PATCH body 里直接被 zod parse 抛弃。
2. Repository.update 的入参类型也不接受这三字段(类型层兜底)。

`scenario` / `tool` 也禁改的理由:改 scenario 会改 adapter 的可用 tools,改 tool 会让 config 立刻变成无效形状,等价于"换了个模板"。要换的话,删了重建。

`isOfficial` 创建后不可改的产品语义:模板一旦发布为官方,所有未来的 benchmark 都可能从它派生,后续修改属于"破坏依赖契约"。如果需要"撤下"一个 official 模板,正确路径是 admin 删除。

### Validation(create / update)

完全镜像 `BenchmarkService.create` (apps/api/src/modules/benchmark/benchmark.service.ts:96-127) 的双 parse 模式:

```ts
async create(actor: JwtPayload, req: CreateBenchmarkTemplateRequest) {
  // 1. isOfficial 权限闸
  if (req.isOfficial && !actor.roles.includes("admin")) {
    throw new ForbiddenException({
      code: "BENCHMARK_TEMPLATE_OFFICIAL_FORBIDDEN",
      message: "only admin can create official templates",
    });
  }

  // 2. scenario × tool 兼容性(失败抛 BENCHMARK_TEMPLATE_SCENARIO_TOOL_MISMATCH)
  const adapter = byTool(req.tool);
  if (!adapter.scenarios.includes(req.scenario)) {
    throw new BadRequestException({
      code: "BENCHMARK_TEMPLATE_SCENARIO_TOOL_MISMATCH",
      message: `scenario '${req.scenario}' does not support tool '${req.tool}'`,
    });
  }

  // 3. config 双重 parse
  //    - applyScenarioConstraints 给出 scenario 收窄过的 schema(如 capacity 强制 rateType=sweep)
  //    - 但它会 unwrap ZodEffects,因此 superRefine 失效;再用 adapter 原 schema 跑一次
  //    与 BenchmarkService 的 L116-127 完全一致
  try {
    applyScenarioConstraints(req.scenario, req.tool).parse(req.config);
    adapter.paramsSchema.parse(req.config);
  } catch (e) {
    throw new BadRequestException({
      code: "BENCHMARK_TEMPLATE_CONFIG_INVALID",
      message: `config validation failed: ${(e as Error).message}`,
    });
  }

  return this.repo.create({ ...req, createdBy: actor.sub });
}
```

`update` 路径:取出 row → owner/admin 守卫(`row.createdBy === actor.sub || actor.roles.includes("admin")`)→ 如果 patch 中包含 `config`,用**当前 row 的** `(scenario, tool)` 跑一次同样的双 parse(因为 PATCH 不准改 scenario/tool,所以一定用 row 当前的)。

### Repository 接口

```ts
class BenchmarkTemplateRepository {
  findByIdOrNull(id: string): Promise<BenchmarkTemplate | null>   // 已有,保留
  list(input: ListInput): Promise<{ items, nextCursor }>           // 镜像 BenchmarkRepository.list
  create(input: CreateInput): Promise<BenchmarkTemplate>
  update(id: string, input: UpdateInput): Promise<BenchmarkTemplate>
  delete(id: string): Promise<BenchmarkTemplate>
}

type ListInput = {
  scenario?: ScenarioId
  tool?: ToolName
  isOfficial?: boolean
  search?: string             // ILIKE on name + description
  cursor?: string
  limit?: number              // clamp 1..100, default 50
}
type CreateInput = {
  name: string
  description?: string | null
  scenario: ScenarioId
  tool: ToolName
  config: Prisma.InputJsonValue
  isOfficial?: boolean        // 默认 false;controller 已经做 admin 闸
  createdBy: string           // 由 service 从 actor.sub 注入
  tags?: string[]
}
type UpdateInput = Partial<{
  name: string
  description: string | null
  config: Prisma.InputJsonValue
  tags: string[]
}>
// UpdateInput 故意不含 scenario/tool/isOfficial/createdBy
```

排序:list 默认 `ORDER BY isOfficial DESC, updatedAt DESC, id DESC`(官方优先,然后最近改的优先,id tiebreak 配合 cursor 翻页)。

### Database schema(已在 PR1 落地,不动)

```sql
CREATE TABLE benchmark_templates (
  id          VARCHAR PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  description TEXT,
  scenario    VARCHAR(20) NOT NULL,
  tool        VARCHAR(20) NOT NULL,
  config      JSONB NOT NULL,
  is_official BOOLEAN NOT NULL DEFAULT false,
  created_by  VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  tags        TEXT[] NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
CREATE INDEX idx_templates_scenario ON benchmark_templates(scenario);
CREATE INDEX idx_templates_tool ON benchmark_templates(tool);
CREATE INDEX idx_templates_official ON benchmark_templates(is_official) WHERE is_official = true;
CREATE INDEX idx_templates_owner ON benchmark_templates(created_by);
```

PR2 不写新迁移,不动 schema。

## Code architecture

### Frontend 组件抽取(phase 1 的纯重构)

把 `apps/web/src/features/benchmarks/BenchmarkCreatePage.tsx` 里的 tool picker + params form 段(L155-L160 的 ParamsForm 分发 + L201-L259 的两个 section JSX + L143-L149 的 reset 逻辑)抽成新组件:

```
apps/web/src/features/benchmarks/forms/
├── ToolParamsEditor.tsx      NEW
├── GuidellmParamsForm.tsx    ← 改:加 fieldPrefix prop
├── VegetaParamsForm.tsx      ← 改:加 fieldPrefix prop
└── GenaiPerfParamsForm.tsx   ← 改:加 fieldPrefix prop
```

`<ToolParamsEditor>` 接口:

```tsx
interface ToolParamsEditorProps {
  scenario: ScenarioId
  /** 外层 form 中存放 params 对象的字段名。 */
  paramsFieldName?: "params" | "config"   // 默认 "params"
}
```

行为:
1. 通过 `useFormContext()` 读外层 form 的 `tool` 字段
2. 渲染 tool picker:`SCENARIOS[scenario].tools.length > 1` 时下拉,否则 readonly badge
3. tool 切换时 `form.reset({ ...current, tool: next, [paramsFieldName]: TOOL_DEFAULTS[next] })`
4. 按 tool 分发到 `<GuidellmParamsForm fieldPrefix={paramsFieldName}>`(及同类)

子 form 改造:

```tsx
// 旧:GuidellmParamsForm() { register("params.rateType") ... }
// 新:GuidellmParamsForm({ fieldPrefix = "params" }) { register(`${fieldPrefix}.rateType` as Path<…>) ... }
```

`BenchmarkCreatePage` 替换:L201-259 的两个 section 缩成 `<ToolParamsEditor scenario={scenario} paramsFieldName="params" />`(无显式 prop 时仍是 `params`,行为不变)。现有 `BenchmarkCreatePage.test.tsx` 不动,作为 regression 兜底。

### 前端新页面

```
apps/web/src/features/benchmark-templates/
├── api.ts                  NEW   — fetch wrappers
├── queries.ts              NEW   — useTemplates / useTemplate / useCreateTemplate / useUpdateTemplate / useDeleteTemplate
├── TemplateListPage.tsx    NEW   — /benchmark-templates
├── TemplateCreatePage.tsx  NEW   — /benchmark-templates/new
├── TemplateEditPage.tsx    NEW   — /benchmark-templates/:id
├── TemplateForm.tsx        NEW   — 共享给 Create/Edit
├── TemplateCard.tsx        NEW   — list 项,带 ⋯ 菜单
├── DeleteTemplateDialog.tsx NEW
└── __tests__/
    ├── TemplateListPage.test.tsx
    ├── TemplateCreatePage.test.tsx
    ├── TemplateEditPage.test.tsx
    └── ToolParamsEditor.test.tsx
```

`TemplateForm` 内部布局(被 Create 和 Edit 共用):

```
┌── 基本信息 ────────────────────────┐
│ name (required) / description / tags │
└──────────────────────────────────────┘
┌── 测试场景 ────────────────────────┐
│ scenario <Select>                    │  ← Edit 页 disabled
└──────────────────────────────────────┘
┌── 配置 ────────────────────────────┐
│ <ToolParamsEditor                    │
│   scenario={selectedScenario}        │  ← Edit 页 readonly tool picker
│   paramsFieldName="config" />        │
└──────────────────────────────────────┘
┌── (admin only) ───────────────────┐
│ [ ] 标记为官方模板                   │  ← Edit 页不渲染,Create 页 admin 才渲染
└──────────────────────────────────────┘
```

### 前端 sidebar / router / i18n

**`sidebar-config.tsx`:**
```tsx
// 第 57 行注释替换为:
{ to: "/benchmark-templates", icon: Layers, labelKey: "items.benchmarkTemplates" },
```

**`router/index.tsx` `apps/web/src/router/index.tsx`** —— 在 `benchmarks/:id` 之后插三条:
```tsx
{ path: "benchmark-templates", element: <TemplateListPage /> },
{ path: "benchmark-templates/new", element: <TemplateCreatePage /> },
{ path: "benchmark-templates/:id", element: <TemplateEditPage /> },
```

**i18n:**
- `apps/web/src/locales/zh-CN/sidebar.json` + `en-US/sidebar.json` 加 `items.benchmarkTemplates: "测试模板" / "Test Templates"`
- 新文件 `apps/web/src/locales/{zh-CN,en-US}/benchmark-templates.json` 含 list/create/edit 全部文案

## UX flows

### 列表页

```
Header:  测试模板  · subtitle
Toolbar: [搜索框..............] [☐ 仅官方]              [+ 新建模板]
Tabs:    [推理性能基准 (12)] [容量规划 (3)] [网关压测 (5)]
Grid:    ┌──────────────────────┐  ┌──────────────────────┐
         │ 🏛️ 推理基线短文本 [⋯] │  │ 🏛️ 推理基线长文本 [⋯] │
         │ guidellm · 官方       │  │ guidellm · 官方       │
         │ admin · 2d ago        │  │ admin · 2d ago        │
         └──────────────────────┘  └──────────────────────┘
         ┌──────────────────────┐  ┌──────────────────────┐
         │    我的实验配置 [⋯]   │  │    GPU 调优 v2  [⋯]   │
         │ guidellm              │  │ guidellm              │
         │ me · 1h ago           │  │ other · 5h ago        │
         └──────────────────────┘  └──────────────────────┘
```

- 默认 tab `inference`,URL `?scenario=` 持久化(浏览器返回保活)
- 排序:isOfficial DESC, updatedAt DESC, id DESC
- 卡片正文区(非 ⋯ 区域)点击 → `/benchmark-templates/:id`
- ⋯ 菜单:`[编辑]`(=同左,跳详情)/ `[删除]`(开 `<DeleteTemplateDialog>` 二次确认)
- ⋯ 菜单只在 owner/admin 显示;非授权用户的卡片只能查看
- 空状态:文案 + 主按钮 `[+ 新建模板]`

### 创建页

URL: `/benchmark-templates/new` 可带 `?scenario=` query 预选。

- form 初值:`{ name: "", description: "", scenario: query.scenario ?? "inference", tool: SCENARIOS[scenario].tools[0], config: TOOL_DEFAULTS[tool], tags: [], isOfficial: false }`
- scenario 切换 → reset tool 为新 scenario 的第一个 tool,reset config 为该 tool 的 defaults
- (admin) `[ ] 标记为官方模板` checkbox,默认未勾;非 admin 不渲染此字段
- 提交成功 → toast + `navigate('/benchmark-templates?scenario=' + created.scenario)`

### 编辑页

URL: `/benchmark-templates/:id`。任何登录用户可访问(只读),owner/admin 可保存。

- 加载 detail → `useCurrentUser()` + `template.createdBy` 比对得 `canEdit = owner || admin`
- `canEdit === false`:全 form 字段 disabled,顶部展示只读 banner「你不是此模板的所有者,无法编辑」,隐藏「保存」「删除」按钮,只留「返回列表」
- `canEdit === true`:`scenario` / `tool` / `isOfficial` 仍 disabled(后端禁改);`name / description / tags / config` 可编辑;底部「保存」「删除」按钮
- 保存调用 `PATCH /api/benchmark-templates/:id`,body 只含可改字段
- 删除调用 `DELETE /api/benchmark-templates/:id`,跳回列表

## Decisions(含 rejected alternatives)

| 决策 | 选择 | Rejected | 为什么 |
|---|---|---|---|
| `isOfficial` 创建后可否改 | 不可改(任何人,包括 admin)| 允许 admin toggle | 模板一旦发布为官方,后续被未来的 benchmark 派生 → 改字段等于破坏依赖契约;要"撤下"就 delete。少一组 toggle 闸 + 少一类 audit log 类型 |
| update 是否允许改 scenario / tool | 不允许 | 允许,然后重新 validate config | 改 scenario / tool 等价于"换了个模板",config 立刻变成无效形状;让用户感知"删了重建"比"我帮你智能转换"更准确。schema 层 omit,无需 controller 写守卫 |
| 普通用户能否创建非 official 模板 | 能 | 只有 admin 能创建 | 模板池 = 公共图书馆,人人可贡献。否则官方模板会成为唯一选择,失去实验/分享价值 |
| 列表 tab 设计 | 三 scenario tab,默认 inference | "全部" + 三 scenario tab | 模板天然 scenario-bound(容量规划模板拿到 inference 用不了),"全部"视图无业务价值;且跟 benchmark 列表导航一致 |
| 列表排序 | isOfficial DESC, updatedAt DESC | 纯 updatedAt DESC | 官方模板需要"推荐位"价值,被新建的个人模板挤下去会失去引导作用 |
| 列表项的删除入口 | 卡片 ⋯ 菜单 + confirm dialog | 只能进编辑页删 | 桌面端为主,1 click + confirm 是 connection 列表已建立的范式,操作员管理大量模板时省点击 |
| 非 owner 看编辑页 | 展示但全 disabled,加 banner | 直接 404 / 跳列表 | 用户从列表点进来主要为了"看长啥样",看不到反而怪;disabled 形态让"为什么不能改"自解释 |
| `<ToolParamsEditor>` 抽出粒度 | 包 tool picker + params form + reset 逻辑;scenario picker 留给页面 | (i) 单大组件含 scenario picker 也包进去(ii) 三独立细粒度组件 | (i) `showScenarioPicker` boolean prop 是"两个组件硬合一"信号;(ii) tool 切换时 reset params 的逻辑会在两边重复。中间方案让页面拥有 scenario(因为两个页面对 scenario 的来源差异最大),tool + params + reset 一定一致的部分被封装 |
| 子 ParamsForm 加 fieldPrefix prop | 是(`fieldPrefix?: "params" \| "config"` 默认 "params")| 让 `<ToolParamsEditor>` 自己 setValue / register | RHF 的 `register("params.X")` 路径硬编码很难绕开;给子 form 加一个 prop 是最少代码改动且类型安全的做法 |
| 模板是否存 `connectionId` | 否 | 存进 config 里 | spec L405 已定:模板 = 配置 snapshot,connection 在 launch 时由用户挑;模板能跨 connection 复用 |
| 列表分页 | cursor + limit(默认 50)| offset/limit | cursor 已是 BenchmarkRepository 的范式;模板量大时(几百+)cursor 在 Postgres 上更稳 |

## Implementation plan(单 PR + phase-per-commit)

按 memory `feedback_single_pr_for_coupled_work.md`,benchmark-template 是结构上紧耦合的全栈一笔,走单 PR、phase-per-commit。

**Branch:** `feat/benchmark-restructure-pr2`(从 main HEAD `83d9a49` 切)
**Worktree:** `/Users/fangyong/vllm/modeldoctor/feat-benchmark-restructure-pr2`

| # | Commit | 内容 |
|---|---|---|
| 0 | `chore: bootstrap PR2 worktree + branch` | `git worktree add` + `pnpm -r build` 一次(参 memory `project_worktree_build_first.md`,新 worktree dist 是空) |
| 1 | `refactor(web): extract ToolParamsEditor from BenchmarkCreatePage` | 抽组件 + 子 form 加 `fieldPrefix`;BenchmarkCreatePage 改用新组件;新增 `ToolParamsEditor.test`(scenario 单/多 tool 渲染、tool 切换 reset 对应字段);现有 `BenchmarkCreatePage.test` 全绿;不引入新功能 |
| 2 | `feat(api): benchmark-template repository CRUD` | `repository.ts` 扩展 `list/create/update/delete`;`repository.spec.ts` 加全套用例(真 Postgres) |
| 3 | `feat(api): benchmark-template service with scenario/tool validation` | `service.ts` + `service.spec.ts`;复用 `applyScenarioConstraints` 双 parse 模式 |
| 4 | `feat(api): benchmark-template controller with permission gating` | `controller.ts` + `controller.spec.ts`;`module.ts` 注册 controller 到 BenchmarkTemplateModule |
| 5 | `test(api): benchmark-template e2e (admin/owner permissions)` | `apps/api/e2e/benchmark-template.e2e-spec.ts`;参考现有 `benchmark.e2e-spec.ts` 的 admin+普通用户双账号模式 |
| 6 | `feat(web): benchmark-templates queries + api layer` | `api.ts` + `queries.ts`;新 i18n 文件 `benchmark-templates.json` 双语完整(list/create/edit/delete 全文案,phase 7-8 直接用)|
| 7 | `feat(web): TemplateListPage with scenario tabs + filters` | 列表页 + `TemplateCard` + `DeleteTemplateDialog`;`TemplateListPage.test` |
| 8 | `feat(web): TemplateCreatePage + TemplateEditPage` | 编辑页 + 创建页 + 共享 `TemplateForm`;两个 .test |
| 9 | `feat(web): wire benchmark-templates route + sidebar entry` | router 加 3 条;sidebar config L57 替换;`sidebar.json` 双语加 `items.benchmarkTemplates` key;手动浏览器自测一遍完整 CRUD 闭环 |

PR 创建后按 memory `feedback_pr_followthrough.md` 跑全套 follow-through:`gh pr view --json comments,reviews,statusCheckRollup`、`gh api repos/.../pulls/<N>/comments` 拉 inline 评论、`gh pr checks` / `gh run watch`。

PR 描述里用 `closes #96`(PR2 stub issue),**严禁** `closes #94`(umbrella,参 memory `feedback_umbrella_issue_trailers.md`)。可以用 `addresses #94` / `refs #94`。

## Testing strategy

### Backend(vitest@2)

- **`benchmark-template.controller.spec.ts`** — mock service,验权限闸:
  - list / detail 任何登录用户 200
  - create `isOfficial:true` + 非 admin → 403,+ admin → 200
  - update body 中 `isOfficial`/`scenario`/`tool` 字段被 schema 直接抛弃(测 service 收到的 DTO 不含这些)
  - update / delete:owner → 200/204,admin → 200/204,其他 → 403
- **`benchmark-template.service.spec.ts`** — mock repo,验业务规则:
  - create:scenario × tool 不匹配 → `BENCHMARK_TEMPLATE_SCENARIO_TOOL_MISMATCH`
  - create:config 不通过 adapter schema → `BENCHMARK_TEMPLATE_CONFIG_INVALID`
  - create:guidellm + capacity 配 `rateType: 'constant'` → 被 scenario 约束拦下(`applyScenarioConstraints`)
  - update:patch 中给了 config,旧 row 是 guidellm + inference,新 config 字段不全 → 报错
  - update:patch 中只给 name → 200,其他字段不动
  - delete:不存在 → 404
- **`benchmark-template.repository.spec.ts`**(扩展) — 真 Postgres:
  - create 后 findById 拿到完整 row
  - list 各 filter(scenario / tool / isOfficial / search)+ cursor 分页
  - update 改 name 后 updatedAt 自动 bump
  - delete 后 findById 返 null
  - 关联完整性:删除模板后,引用它的 benchmark.templateId SET NULL(用现有 schema 的 FK)

### Frontend(vitest@1)

- **`TemplateListPage.test.tsx`** — mock useTemplates,断言 tab 切换、官方排序、空状态、`⋯` 菜单可见性(owner/admin vs 非授权)
- **`TemplateCreatePage.test.tsx`** — 断言:scenario 切换重置 tool;非 admin 不渲染 isOfficial 字段;提交调用 useCreateTemplate
- **`TemplateEditPage.test.tsx`** — 断言:非 owner 表单 disabled、删除按钮隐藏、banner 出现
- **`ToolParamsEditor.test.tsx`** — 断言:scenario 单 tool 时 readonly badge,多 tool 时下拉切换会 reset 对应字段(`params` 或 `config`)

### e2e(`apps/api/e2e/benchmark-template.e2e-spec.ts`)

参考现有 `benchmark.e2e-spec.ts`。流程:
1. 注册两个用户(`disableFirstAdmin=false` 让首用户成 admin,第二个普通)
2. admin POST 一个 `isOfficial:true` 模板 → 200
3. 普通用户 GET list → 看到 admin 的 official 模板
4. 普通用户 POST 一个 `isOfficial:true` 模板 → 403
5. 普通用户 POST 一个 `isOfficial:false` 模板 → 200
6. admin / 普通用户分别 GET 普通用户的模板 → 都能看到
7. 普通用户 PATCH admin 的模板 → 403
8. 普通用户 DELETE 自己的模板 → 204
9. 普通用户拿 admin 模板的 id 创建 benchmark(`POST /api/benchmarks` body 带 templateId)→ 200,确认 BenchmarkService 的 templateId 校验路径还能用

## Risks

| 风险 | 兜底 |
|---|---|
| Phase 1 抽 `<ToolParamsEditor>` 时 fieldPrefix 改造让 BenchmarkCreatePage 退化 | 跑 `pnpm -F web test`(现有 BenchmarkCreatePage.test 兜底)+ 手动 `pnpm dev` 跑一次完整 inference benchmark 创建流程,确保现有路径无回归 |
| `applyScenarioConstraints` 在模板 config 上的双 parse 行为可能跟 benchmark 不一致 | 两边都只 parse `params/config`,connectionId 在 benchmark 创建路径才存在,模板路径完全不涉及 |
| 非 admin 在 TemplateEditPage 看到的"disabled form"跟编辑模式视觉混淆 | 顶部加显眼 banner「只读 —— 你不是此模板的所有者」+ 用 muted 配色对所有 input;隐藏「保存」「删除」按钮 |
| benchmark.templateId 引用了被删模板 | Prisma schema 已是 `onDelete: SetNull`(PR1 落地),无悬挂 FK 风险;repository.spec 加一条 e2e 用例兜底 |
| update DTO 漏 omit 让用户改了 isOfficial | schema omit 是第一道闸;repository UpdateInput 类型不含这三字段是第二道闸;controller spec 显式断言 service 拿到的 DTO 不含 |
| pnpm topology 在新 worktree 上 build 失败 | memory `project_worktree_build_first.md`:Phase 0 必须先跑 `pnpm -r build` 一次;CI 会在 PR 推上去后跑完整 build,有 issue 立即可见 |

## Tracking

- Spec: this document, `docs/superpowers/specs/2026-05-05-benchmark-restructure-pr2-design.md`
- 上游 spec: `docs/superpowers/specs/2026-05-04-benchmark-restructure-design.md`("PR2" 一节)
- Issue: #96(PR2 stub);依赖 #100 / #103(PR1)
- Umbrella: #94(本 PR **不** closes umbrella,只 `closes #96` + `addresses #94`)
- Implementation plan: 待用 superpowers:writing-plans 生成,文件 `docs/superpowers/plans/2026-05-05-benchmark-restructure-pr2.md`
