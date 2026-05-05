# Issue #99 — 创建表单风格统一 (Form Style Unification)

**Date:** 2026-05-05
**Issue:** [#99 UI优化风格统一](https://github.com/weetime/modeldoctor/issues/99)
**Scope:** spec + 4 个创建表单一次性迁移到统一规范（单 PR）

> **长期约定已固化到 [`CLAUDE.md`](../../../CLAUDE.md) 的 "Page layout convention" 章节**（"Page body layout" + "Creation/edit form pages" + "Page vs Dialog" 三个小节）。本 spec 描述的是 #99 这一轮迁移决策，**未来新页面以 CLAUDE.md 为准**。

## Background

Issue #99 反馈：仓库当前存在两种"创建"形态（页面式 + 弹窗式），且每个表单的字段布局、必填提示、校验交互不统一。要求：

1. 分析现状，**固化"页面 vs 弹窗"判定规则**作为长期规范。
2. 优化 `BenchmarkCreatePage`，对齐 `TemplateCreatePage` 的样式。
3. 表单校验：
   - 必填字段加红色星号
   - 字段失焦时按 schema 校验，错误提示渲染在字段下方

附加一条来自 brainstorming 的扩展要求：**校验提示文案需支持 i18n**（zh-CN + en-US），与现有 i18n 体系保持一致。

## Goals

- 把"创建表单"作为一个有界子系统抽离出统一规范，写入 spec。
- 把 4 个现存创建表单一次性迁移到该规范，单 PR 完成（structurally-coupled，不拆 PR）。
- 给 zod 校验文案接入 i18n，作为长期规范的一部分。

## Non-Goals

- 列表页 / 详情页 / 全站布局的样式统一（issue #99 提及，但本 spec 不包含；后续独立 issue/PR）。
- 把任何现有页面式 ↔ 弹窗式之间互转（4 个表单的归类保持不变）。
- 替换 UI 组件库（仓库已是 shadcn/ui + Radix UI + Tailwind 体系，继续沿用）。
- 校验文案中文化以外的多语言（仅 zh-CN + en-US）。
- 重写已经在用 `<Form>` 的 `LoginPage` / `RegisterPage`（仅顺手补必填星号）。

## Page vs Dialog 判定规则（写入规范）

| 维度 | 页面式 | 弹窗式 |
|------|--------|--------|
| 字段数 | > 5 | ≤ 5 |
| 分组分区 | 有（多个 `<FormSection>`） | 无（单块平铺） |
| 子表单 | 含动态子表单（如 `ToolParamsEditor`） | 无 |
| 提交后落点 | 跳转到详情页 / 列表页 | 留在原上下文页面 |
| URL 入口 | 需要可分享 / 可深链 | 不需要 |

**判定逻辑**：满足任一条优先选页面式，否则选弹窗式。"字段数"列为参考线，不是硬性 — 最终决定看是否需要分区/子表单/深链。

**4 个现存表单按规则归类**（与现状一致，不调整）：

- **页面式**：
  - `BenchmarkCreatePage`（含 ToolParamsEditor 子表单 + 多 section + ?scenario= 深链 + 提交后跳详情页）
  - `TemplateCreatePage` / `TemplateEditPage` / `TemplateForm`（含 ToolParamsEditor + 多 section + ?scenario= 深链）
- **弹窗式**：
  - `ConnectionDialog`（字段虽多但同类、单 section、提交后留在 ConnectionsPage）
  - `SetBaselineDialog`（字段极少）

## 统一表单架构

外层结构（页面式与弹窗式共用，外壳不同、内核相同）：

### 页面式

```tsx
<PageHeader title={t("create.title")} subtitle={t("create.subtitle")} />
<div className="mx-auto max-w-3xl px-8 py-6">
  <Form {...form}>
    <form onSubmit={onSubmit} className="space-y-6">
      <FormSection title={t("create.sections.basic")}>
        <FormField …>…</FormField>
        …
      </FormSection>
      <FormSection title={…}>…</FormSection>
      <FormActions
        onCancel={() => navigate(...)}
        cancelLabel={t("actions.cancel")}
        submitLabel={t("actions.save")}
        disabled={!form.formState.isValid}
        pending={mut.isPending}
      />
    </form>
  </Form>
</div>
```

### 弹窗式

```tsx
<Dialog open={open} onOpenChange={onOpenChange}>
  <DialogContent>
    <DialogHeader><DialogTitle>{…}</DialogTitle></DialogHeader>
    <Form {...form}>
      <form onSubmit={onSubmit}>
        <FormSection>            {/* 弹窗常单 section，可省 title */}
          <FormField …>…</FormField>
        </FormSection>
        <DialogFooter>
          <FormActions
            onCancel={() => onOpenChange(false)}
            submitLabel={tc("actions.save")}
            pending={mut.isPending}
          />
        </DialogFooter>
      </form>
    </Form>
  </DialogContent>
</Dialog>
```

### 新增 / 修改的组件

**新增 `apps/web/src/components/common/form-section.tsx`**：

设计规范（**flat 平铺**，issue #99）：表单分组用"小标题 + 间距"区分，**不嵌套卡片边框/背景**。字段直接坐落在页面背景上；弹窗内同理（弹窗外壳已提供边框）。

```tsx
interface FormSectionProps {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}
// 渲染 <section className="space-y-3 pb-4 last:pb-0">
//   <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
//   {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
//   {children}
// </section>
```

**新增 `apps/web/src/components/common/form-actions.tsx`**：

```tsx
interface FormActionsProps {
  onCancel?: () => void;
  cancelLabel?: string;
  submitLabel: string;
  disabled?: boolean;
  pending?: boolean;
  align?: "right" | "between";   // 默认 "right"
}
// 渲染 <div className="flex justify-end gap-2">
//   <Button type="button" variant="outline" onClick={onCancel}>{cancelLabel}</Button>
//   <Button type="submit" disabled={disabled || pending}>{pending ? "…" : submitLabel}</Button>
// </div>
```

**修改 `apps/web/src/components/ui/form.tsx` 的 `FormLabel`**：增加 `required?: boolean` prop，true 时在文本后追加 `<span aria-hidden className="ml-0.5 text-destructive">*</span>`。

**修改 `apps/web/src/components/ui/form.tsx` 的 `FormMessage`**：兜底处理"自定义 .refine message 是 i18n key 但未走 errorMap"的场景：

```ts
const body = error
  ? (() => {
      const msg = String(error?.message ?? "");
      return msg.startsWith("validation.")
        ? i18n.t(msg, { ns: "common", defaultValue: msg })
        : msg;
    })()
  : children;
```

### 字段统一写法

```tsx
<FormField
  control={form.control}
  name="name"
  render={({ field }) => (
    <FormItem>
      <FormLabel required>{t("create.fields.name")}</FormLabel>
      <FormControl>
        <Input placeholder={t("create.fields.namePlaceholder")} {...field} />
      </FormControl>
      <FormMessage />
    </FormItem>
  )}
/>
```

### `useForm` 默认配置

所有 4 个表单统一：

```ts
const form = useForm<T>({
  resolver: zodResolver(schema),
  mode: "onTouched",     // 首次失焦后开始校验，之后切 onChange
  defaultValues: { … },
});
```

## i18n 校验文案

### 改动 1：`apps/web/src/lib/i18n.ts` 注册全局 errorMap

```ts
import { z } from "zod";

z.setErrorMap((issue, ctx) => {
  // 1) 自定义 message 是 i18n key（约定：以 "validation." 开头）→ t() 解析
  if (issue.message?.startsWith("validation.")) {
    const translated = i18n.t(issue.message, { ns: "common", defaultValue: "" });
    if (translated) return { message: translated };
  }

  // 2) zod 内置 issue code → common.validation.<code> 映射
  switch (issue.code) {
    case "invalid_type":
      if (issue.received === "undefined")
        return { message: i18n.t("validation.required", { ns: "common" }) };
      return { message: i18n.t("validation.invalidType", { ns: "common" }) };
    case "too_small":
      if (issue.type === "string")
        return { message: i18n.t("validation.tooShort", { ns: "common", min: issue.minimum }) };
      return { message: i18n.t("validation.tooSmall", { ns: "common", min: issue.minimum }) };
    case "too_big":
      if (issue.type === "string")
        return { message: i18n.t("validation.tooLong", { ns: "common", max: issue.maximum }) };
      return { message: i18n.t("validation.tooBig", { ns: "common", max: issue.maximum }) };
    case "invalid_string":
      if (issue.validation === "email")
        return { message: i18n.t("validation.invalidEmail", { ns: "common" }) };
      if (issue.validation === "url")
        return { message: i18n.t("validation.invalidUrl", { ns: "common" }) };
      if (issue.validation === "regex")
        return { message: i18n.t("validation.invalidFormat", { ns: "common" }) };
      return { message: ctx.defaultError };
    case "invalid_enum_value":
      return { message: i18n.t("validation.invalidEnum", { ns: "common" }) };
    case "custom":
      return { message: ctx.defaultError };
    default:
      return { message: ctx.defaultError };
  }
});
```

`z.setErrorMap` 是全局的，`@modeldoctor/contracts` 共享包的 schema 用同一个 zod 实例，自动受益（**仅 web 端注册** — API 端不注册，server 拿默认英文文案，互不干扰）。

### 改动 2：`common.json` 增 `validation` 节点

**`apps/web/src/locales/zh-CN/common.json`**：

```json
"validation": {
  "required": "此项为必填",
  "invalidType": "类型不正确",
  "tooShort": "至少需要 {{min}} 个字符",
  "tooLong": "最多 {{max}} 个字符",
  "tooSmall": "不能小于 {{min}}",
  "tooBig": "不能大于 {{max}}",
  "invalidEmail": "邮箱格式不正确",
  "invalidUrl": "URL 格式不正确",
  "invalidFormat": "格式不正确",
  "invalidEnum": "请选择有效的选项"
}
```

**`apps/web/src/locales/en-US/common.json`**：

```json
"validation": {
  "required": "This field is required",
  "invalidType": "Invalid type",
  "tooShort": "Must be at least {{min}} characters",
  "tooLong": "Must be at most {{max}} characters",
  "tooSmall": "Must be at least {{min}}",
  "tooBig": "Must be at most {{max}}",
  "invalidEmail": "Invalid email format",
  "invalidUrl": "Invalid URL format",
  "invalidFormat": "Invalid format",
  "invalidEnum": "Please select a valid option"
}
```

### 改动 3：feature schemas 里硬编码英文 message → i18n key

扫描 `apps/web/src/features/*/schema.ts` 与 inline schema，把硬编码英文报错替换为 `validation.<key>` 形式，并在 `common.json` 补对应中英文。例：

```ts
// before
.refine((v) => /^https?:\/\//.test(v), { message: "URL must start with http(s)" })

// after
.refine((v) => /^https?:\/\//.test(v), { message: "validation.urlProtocol" })
```

**`@modeldoctor/contracts` 共享包的 schema 不在本次改动范围**：
- 共享 schema 同时被 web（前端校验）+ API（server 校验）使用。
- 把 `.refine(message: "validation.foo")` 写到 contracts 后，server 端没有 errorMap，错误响应 body 里就会出现 `validation.foo` 这种 key 字符串，污染对外 API。
- 对策：仅依赖 errorMap 翻译 zod 的**内置 issue code**（required / tooShort / invalidEmail / invalidUrl 等）来覆盖共享 schema 的常见错误，自定义 `.refine` message 文本保持现状。绝大多数表单字段是 `z.string().min(1).max(N)` / `z.string().email()` 这类，内置 issue 已经够用。
- 如果未来某条共享 schema 的 `.refine` 报错文案被产品要求中文化，再独立讨论 server 端 i18n。

### 改动 4：locale 切换时的错误文本陈旧

接受 1 帧延迟：用户切换语言后，现存的 `form.formState.errors` 文案陈旧；下次 trigger（输入 / 失焦 / 提交）即刷新。**不在本次改动里加全局 trigger 监听** — 行业普遍接受。

## 测试策略

1. **Vitest 组件测试**（apps/web）— 每个表单一个测试文件，覆盖：
   - 必填字段失焦但留空 → `<FormMessage>` 出现 `validation.required` 文案
   - 输入非法值（email/url）→ FormMessage 出现对应文案；改正后消失
   - 提交按钮在 `formState.isValid === false` 时禁用，valid 时可点
   - 已有的 `BenchmarkCreatePage.test.tsx` / `TemplateCreatePage.test.tsx` / `ConnectionDialog.test.tsx` 现状测试保持绿（迁移过程中只补不删）

2. **新增 i18n 测试** — `apps/web/src/lib/__tests__/zod-i18n.test.ts`：
   - `z.string().min(1).safeParse("")` 在 zh-CN 下返回"此项为必填"
   - 切换到 en-US 后 `safeParse` 返回"This field is required"
   - 自定义 `.refine(..., { message: "validation.someKey" })` 走映射
   - 未知 key（如 `validation.notInCommonJson`）回退到原 key 字符串

3. **不写 e2e**（playwright），本次改动是表单内核，e2e 收益低于成本。

## 验收标准

- [ ] 4 个表单都用 `<Form>` + `<FormField>` + `<FormMessage>`
- [ ] 必填字段在 `<FormLabel required>` 上有红色 `*`
- [ ] 失焦后空必填项立即出现红色提示文字（zh-CN/en-US 两种语言均验证）
- [ ] 字段下方的报错文案位置/字号/颜色全部一致（来自 FormMessage 默认样式）
- [ ] `BenchmarkCreatePage` 视觉对齐 `TemplateCreatePage`（卡片分区 + 间距）
- [ ] `ConnectionDialog` 内部使用 `<FormSection>`（即便只有一块，也用统一组件）
- [ ] `pnpm -F @modeldoctor/web typecheck` + `pnpm -F @modeldoctor/web test` + `pnpm -F @modeldoctor/web lint` 全绿
- [ ] zh / en 两个语言下截图各一张，附在 PR 描述里

## 风险与缓解

1. **`zodResolver` 与 errorMap 衔接**：`@hookform/resolvers/zod` 解析 zod 错误会读取 `error.message`（已经是 errorMap 输出的本地化字符串）。
   - **缓解**：plan 第一步加"接通验证"步骤，实测一下；如有偏差就给 resolver 单独传 errorMap。

2. **现存 schema 自定义 message 是英文字符串**（如 `connectionInputCreateSchema` 里的 `"URL must be valid"`）：errorMap 不识别，会原样穿透。
   - **缓解**：迁移过程中扫 `apps/web/src/features/*/schema.ts`，把英文字符串改成 `validation.xxx` key + 在 common.json 补文案。

3. **`@modeldoctor/contracts` 共享包的 schema**：API 端也用，server 没有 i18n。
   - **缓解**：`z.setErrorMap` 仅在 web 端注册，server 端 zod 默认英文。两边互不干扰，是 zod errorMap 的标准用法。

4. **`mode: "onTouched"` 在 controlled 字段（如 Radix Select）的 onBlur 不一定触发**。
   - **缓解**：对 Select / Switch / Checkbox，配合 `shouldValidate: true` 在 `onValueChange` 里手动 `setValue`，让其按 onChange 校验。已有 `handleConnectionChange` 是这个模式。

5. **`SetBaselineDialog` 还未深读**。
   - **缓解**：plan 第一步先读它，若有特殊性在 plan 里加 commit；此 spec 暂定按"少字段单 section 弹窗"的标准模板迁移。

## Implementation 拆分（单 PR，phase-per-commit）

- **commit 1**：基础设施
  - `<FormSection>` / `<FormActions>` / `<FormLabel required>` / errorMap / common.json validation 节点
  - 新增 `lib/__tests__/zod-i18n.test.ts`
- **commit 2**：迁移 BenchmarkCreatePage（含测试）
- **commit 3**：迁移 TemplateCreatePage + TemplateEditPage + TemplateForm（含测试）
- **commit 4**：迁移 ConnectionDialog（含测试）
- **commit 5**：迁移 SetBaselineDialog（含测试）
- **commit 6**：补 LoginPage / RegisterPage 的 `required` 星号
- **commit 7**：扫描并迁移 `features/*/schema.ts` 里硬编码英文报错为 i18n key

PR 标题：`feat(web): unify creation form style + i18n validation messages (#99)`
