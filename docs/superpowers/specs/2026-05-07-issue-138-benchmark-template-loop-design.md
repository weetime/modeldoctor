# Issue #138 — Benchmark 模板与主流程闭环

**Date:** 2026-05-07
**Issue:** [#138](https://github.com/weetime/modeldoctor/issues/138)
**Status:** Design approved, awaiting implementation plan

## Problem

`benchmark_templates` CRUD 后端 + 前端模板管理页(via #106 / #108)已落地,但模板与 benchmark 主流程未打通:

- 列表页 `BenchmarkListShell.tsx:154-171` 的"保存为模板"无 status 门控,无 dialog,直接拷贝 `${name} (template)` 出去
- 详情页 `BenchmarkDetailPage.tsx` header 没有任何"保存为模板"入口
- 新建页 `BenchmarkCreatePage.tsx` 只能从空白表单填,不支持从模板预填
- 模板列表页 `TemplateCard.tsx` 没有"使用此模板"CTA

后端契约已经支持闭环:`CreateBenchmarkRequest.templateId`(`packages/contracts/src/benchmark.ts:82`)是可选字段,`benchmark.service.ts:164` 在 create 时验证并落库。本 issue 只补前端入口。

## Goals

1. 详情页 / 列表页 `completed` benchmark 看到"保存为模板"
2. 列表页 dialog 能改 name / description / tags(逗号分隔),提交后 toast 成功
3. 新建页支持从模板预填(popover 选择 + URL `?templateId` 直接预填)
4. 模板列表页卡片有"使用此模板"按钮 → 跳到新建页自动预填
5. 提交时 `templateId` 落库,即便用户改了 params(provenance 始终保留)

## Non-Goals

- 三 tab Drawer 创建模态(原 #97)
- 从历史 benchmark 复用 (`parentBenchmarkId`)
- Admin seed 5 个官方模板(ops 步骤,不是工程任务)
- Vegeta legacy params 在预填时迁移(模板 create 时已走 ToolParamsForm,config 应已合规)

## Architecture

### 新增组件(均位于 `apps/web/src/features/benchmarks/`)

#### 1. `SaveAsTemplateDialog.tsx`

受控 Dialog,列表页 + 详情页共用。

**Props:**
```ts
interface SaveAsTemplateDialogProps {
  benchmark: Benchmark | null;       // null 关闭
  onOpenChange: (open: boolean) => void;
}
```

**字段:**
- `name`(默认 `${benchmark.name} (template)`,trimmed to ≤90 chars 后再加后缀,max 100 chars 总长)
- `description`(可选,Textarea 2 行)
- `tags`(可选,Input;提交时按 `,` split + trim + filter empty)

**提交:**
```ts
useCreateTemplate().mutateAsync({
  name,
  description,
  scenario: benchmark.scenario,
  tool: benchmark.tool,
  config: benchmark.params as Record<string, unknown>,
  tags,
  isOfficial: false,
})
```

**反馈:**
- 成功:`toast.success(t("rowActions.saveAsTemplate.success", { name }))`,关闭 dialog,留在原页
- 失败:dialog 内 inline `Alert`,不关闭

**不做 vegeta 参数迁移** —— 模板存原始 config,运行时(rerun / 新建)才迁移,与现有 `BenchmarkListShell.handleSaveAsTemplate` 行为一致。

#### 2. `PrefillFromTemplatePopover.tsx`

新建页专用,不复用。

**Props:**
```ts
interface PrefillFromTemplatePopoverProps {
  scenario: ScenarioId;
  onPick: (template: BenchmarkTemplate) => void;
}
```

**触发器:** `Button variant="outline" size="sm"`,内含 `Layers` icon + `从模板预填 ▾` label。

**Popover 内容(~360px 宽):**
- 顶部 `Input`:本地搜索(300ms debounce 不必,client-side filter 直接同步即可,因为最多 50 条)
- 列表:`useTemplates({ scenario, limit: 50 })`,每条用 `button` 渲染:
  - 左:`name`(truncate)+ 第二行 `tool` badge + tags badges + 官方 `ShieldCheck` icon
  - 整行 click → `onPick(template)` + 关闭 popover
- 空态(无模板 / 搜索无结果):提示文案 + "→ 去模板库管理" 链接到 `/benchmark-templates?scenario=${scenario}`
- 底部固定一行:"→ 去模板库管理"

**焦点管理:** 用 shadcn `Popover` 默认行为,无需手工处理。

### 改动

#### 3. `BenchmarkListShell.tsx`

- 删除 `handleSaveAsTemplate`(行 154-171)
- 新增 `const [saveTplBenchmark, setSaveTplBenchmark] = useState<Benchmark | null>(null)`
- DropdownMenuItem(行 393-400):
  - `disabled = benchmark.status !== "completed"`(`status === "completed"` 才可点击)
  - 包 `Tooltip` 解释 `t("rowActions.saveAsTemplate.disabledTooltip")`
  - `onClick: () => setSaveTplBenchmark(benchmark)`
- 在 `<AlertDialog>` 同级渲染 `<SaveAsTemplateDialog benchmark={saveTplBenchmark} onOpenChange={(o) => !o && setSaveTplBenchmark(null)} />`

#### 4. `BenchmarkDetailPage.tsx`

- 在 rerun 按钮(行 218-241)之后、delete 按钮(行 247)之前插入:
  ```tsx
  {isTerminal && benchmark.status === "completed" && (
    <Button variant="outline" size="sm" onClick={() => setSaveTplOpen(true)}>
      <Copy className="mr-1 h-4 w-4" />
      {t("detail.saveAsTemplate.button")}
    </Button>
  )}
  ```
- 新增 state `const [saveTplOpen, setSaveTplOpen] = useState(false)`
- 文件底部加 `<SaveAsTemplateDialog benchmark={saveTplOpen ? benchmark : null} onOpenChange={setSaveTplOpen} />`

#### 5. `BenchmarkCreatePage.tsx`

- `PageHeader` 加 `rightSlot={<PrefillFromTemplatePopover scenario={scenario} onPick={applyTemplate} />}`
- `defaultValues` 加 `templateId: undefined`(form schema 已包含此字段)
- 新增 `applyTemplate(template)`:
  ```ts
  function applyTemplate(template: BenchmarkTemplate) {
    if (template.scenario !== scenario) {
      toast.warning(t("create.prefillFromTemplate.scenarioMismatch", {
        scenario: template.scenario,
      }));
    }
    form.reset({
      tool: template.tool,
      scenario: template.scenario,                 // 模板 wins
      connectionId: form.getValues("connectionId"), // 保留当前
      name: template.name,
      description: template.description ?? undefined,
      params: template.config,
      templateId: template.id,
    });
    toast.info(t("create.prefillFromTemplate.applied", { name: template.name }));
  }
  ```
- 读 URL `?templateId`,用 `useTemplate(templateIdFromQuery)` 获取后通过 `useEffect + ref` 单次预填:
  ```ts
  const templateIdParam = params.get("templateId");
  const { data: prefillTemplate } = useTemplate(templateIdParam ?? undefined);
  const hasAppliedRef = useRef(false);
  useEffect(() => {
    if (prefillTemplate && !hasAppliedRef.current) {
      applyTemplate(prefillTemplate);
      hasAppliedRef.current = true;
    }
  }, [prefillTemplate]);
  ```
- 当 `form.watch("templateId")` truthy 时,在 `<Form>` 内、第一个 `<Card>` 之前(也即 `space-y-6` 容器的第一项)展示 banner:
  ```
  ┌ 已从模板「{{name}}」预填 ────────────────[ ✕ 清除关联 ]
  ```
  点 ✕ 调 `form.setValue("templateId", undefined)`,**不清** params(已可见的内容不要无声消失)
- Banner 文本需要 template name —— 此时 `useTemplate(form.watch("templateId"))` 已 ready,直接复用其 `data.name`(与 prefill effect 共用同一个 hook 调用,`react-query` 缓存命中)
- URL `?templateId` 不存在时的兜底:
  ```ts
  const tplQuery = useTemplate(templateIdParam ?? undefined);
  useEffect(() => {
    if (templateIdParam && tplQuery.isError) {
      toast.error(t("create.prefillFromTemplate.notFound"));
      const next = new URLSearchParams(params);
      next.delete("templateId");
      setParams(next, { replace: true });
    }
  }, [templateIdParam, tplQuery.isError]);
  ```

#### 6. `TemplateCard.tsx`

- 卡片底部新增主色按钮 `使用此模板`,跳到 `/benchmarks/new?scenario=${template.scenario}&templateId=${template.id}`
- 当前实现是整张卡片 `<Link>` 包裹(行 24-52),嵌套 `<a>` 不合法。重构为:
  - 外层改 `<div>`,移除 Link 包裹
  - 卡片**头部+元数据区**(name / badges / description / updatedAt)整体仍可点 → 包一个透明 `<Link>` 占满该区域(用 `absolute inset-0` 技巧或将整块作为可点击 div + `useNavigate`)
  - 卡片**底部**新增 `<div className="mt-3 flex justify-end">`,内含 `<Button asChild size="sm"><Link to={...}>使用此模板</Link></Button>`
  - `canEdit` 的 absolute-positioned dropdown menu 不动

## Data Flow

### 触发路径 A:Popover 预填

```
PrefillFromTemplatePopover.onPick(template)
  → BenchmarkCreatePage.applyTemplate(template)
      form.reset({ tool, scenario, connectionId(保留), name, description, params, templateId })
      toast.info "已从模板「X」预填"
```

### 触发路径 B:URL `?templateId=xxx`

```
BenchmarkCreatePage mount + URL 含 templateId
  → useTemplate(templateId) 加载
  → useEffect 单次触发(ref guard)applyTemplate(template)
  → 后续用户编辑不会被覆盖
```

### 提交

`form.handleSubmit` 已经把 `templateId` 一并提交;`benchmark.service.ts:164-194` 验证并落到 `Benchmark.templateId`。

### Banner 清除

```
banner [✕]
  → form.setValue("templateId", undefined)
  → banner 消失,params 保持
  → 提交时不带 templateId
```

## Edge Cases

1. **`?templateId=不存在`** — `useTemplate` 返回 404,`useEffect` 因 `template` falsy 不触发预填;额外 `useEffect` 监听 query error,toast 报错并 `params.delete("templateId")` 清掉 URL
2. **Scenario 不一致**(URL `?scenario=inference&templateId={gateway-tpl}`)— `applyTemplate` 模板 wins,`form.reset` 改 scenario,toast.warning 提示;**不做** 路由重定向(避免 effect 重跑)
3. **预填后用户切换 scenario** — 现有 `useEffect([scenario])`(行 82-91)会 `form.reset` 清掉所有字段,**包括 templateId**,这是预期行为(切场景 = 弃用模板)
4. **Vegeta 参数迁移** — 不在本 issue 范围;模板 config 应在 template create 时就合规
5. **`?templateId=xxx` + `?scenario=` 都没有** — 预填 effect 不跑,正常空表单流程
6. **`saveTplBenchmark` 切换为新 benchmark 时** — Dialog 用 `benchmark.id` 作 key,确保表单字段被重新初始化

## i18n

### `apps/web/src/locales/{zh-CN,en-US}/benchmarks.json`

```
rowActions.saveAsTemplate.disabledTooltip   "仅已完成的 benchmark 可保存为模板"
detail.saveAsTemplate.button                "保存为模板"

saveAsTemplateDialog.title                  "保存为模板"
saveAsTemplateDialog.description            "把当前参数固化为可复用的模板"
saveAsTemplateDialog.fields.name            "模板名称"
saveAsTemplateDialog.fields.description     "描述"
saveAsTemplateDialog.fields.tags            "标签"
saveAsTemplateDialog.fields.tagsPlaceholder "用逗号分隔多个标签"
saveAsTemplateDialog.actions.submit         "保存"
saveAsTemplateDialog.errors.generic         "保存失败,请稍后重试"

create.prefillFromTemplate.button           "从模板预填"
create.prefillFromTemplate.search           "搜索模板…"
create.prefillFromTemplate.empty            "还没有此场景的模板"
create.prefillFromTemplate.manage           "→ 去模板库管理"
create.prefillFromTemplate.applied          "已从模板「{{name}}」预填,可继续修改"
create.prefillFromTemplate.scenarioMismatch "模板属于 {{scenario}},已切换 scenario"
create.prefillFromTemplate.notFound         "模板不存在或已删除"
create.prefilledBanner.label                "已从模板「{{name}}」预填"
create.prefilledBanner.clear                "清除关联"
```

### `apps/web/src/locales/{zh-CN,en-US}/benchmark-templates.json`

```
list.cards.useThisTemplate                  "使用此模板"
```

## Tests

| 文件 | 关键 case |
|---|---|
| `SaveAsTemplateDialog.test.tsx`(新) | 默认 name 含 `(template)` 后缀;tags `"a, b, c"` → payload `["a","b","c"]`;空 description 不带 description;mutation 失败 inline error 不关闭;成功 toast |
| `PrefillFromTemplatePopover.test.tsx`(新) | `useTemplates` mock 3 个时全部显示;搜索 "vLLM" 仅显示匹配项;空态显示链接;点击 item 调 `onPick` 带完整 template |
| `BenchmarkListShell.test.tsx`(已存,加 case) | `status="failed"` 行的菜单项 `aria-disabled`;`status="completed"` 点击打开 dialog |
| `BenchmarkDetailPage.test.tsx`(已存,加 case) | `status="completed"` 看到"保存为模板"按钮;`status="failed"` / `status="running"` 看不到 |
| `BenchmarkCreatePage.test.tsx`(已存,加 case) | URL `?templateId=tpl-1` 进入,`useTemplate` resolve 后字段被填;hidden `templateId` 出现在提交 payload;banner ✕ 后 templateId 不在 payload 但 params 保留 |
| `TemplateCard.test.tsx`(若无则建) | "使用此模板" `href` 包含 `scenario=` 与 `templateId=` |

## Acceptance

- [ ] 详情页 / 列表页:`completed` benchmark 看到"保存为模板",非 `completed` disabled+tooltip
- [ ] Dialog 能改 name / description / tags,提交后 toast,在 `/benchmark-templates` 看到新模板
- [ ] 新建页"从模板预填" popover 仅显示当前 scenario 模板,选中后表单按模板预填,可继续改
- [ ] 模板列表页"使用此模板" → 跳到 `/benchmarks/new?scenario=...&templateId=...` 自动预填
- [ ] 提交后 `Benchmark.templateId` 正确落库;banner ✕ 后不落库
- [ ] `pnpm -r test` / `type-check` / `lint` 全绿

## Out of Scope (反留 issue)

实现完成后,在 #138 评论列出尚未做的相关项,以便下个迭代起 issue:

- TemplateCard CTA 仅限 `/benchmarks/new`,没考虑从详情页"以此模板再开一次新 benchmark"的反向入口
- 详情页未来可显示"派生自模板 X"信息(目前后端有 templateId 字段但 UI 不显示)
