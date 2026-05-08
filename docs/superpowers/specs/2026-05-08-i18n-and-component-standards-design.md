# i18n & 组件复用规范化 — Design

**Status:** Approved · 2026-05-08
**Branch:** `feat/i18n-and-component-standards`
**Driver:** 全站 i18n 完整性 + 下拉等高频组件回归 shadcn 单一来源 + 深色主题边框可见性修复

---

## 1. Why

`apps/web/` 已经接入 i18next 与 shadcn/ui，但实际落地存在三类问题：

1. **i18n 不完整**：少数 feature 仍有运行时硬编码中文（insights severity / range、benchmarks 详情&创建页若干 stragglers、EndpointPicker 2 行）。`deployment-recipes/data.ts` 是 V1 仅 zh-CN 数据，属于已知 carve-out。
2. **下拉风格分裂**：同样是"下拉选择"，`ConnectionPicker` 用 shadcn `<Select>`，`PrefillFromTemplatePopover` 手写 `<Popover> + <Input> + <ul>`，视觉/交互/无障碍不统一。`CompareToolbar` 还在用原生 `<select>`。
3. **深色主题边框肉眼难辨**：`--border: 220 8% 14%` 在深色背景下对比度过低（textarea / card 边框几乎不可见）。

这三类都没有结构性根因，是规范缺位 + 历史代码堆积。本 PR 一次性补齐：写规范、迁移现存违规处、加 CI 守卫防回退、修暗色 token。

## 2. Scope

**In:**
- `docs/project-standards.md` 新增 §11 i18n 规范、§12 组件复用规范
- 新增 `apps/web/src/components/ui/combobox.tsx`（shadcn Combobox primitive）
- 重写 `PrefillFromTemplatePopover` 为基于 `<Combobox>` 的实现
- `CompareToolbar` 原生 `<select>` 切到 shadcn `<Select>`
- 现存运行时硬编码中文迁入 locales（insights / benchmarks / EndpointPicker）
- `deployment-recipes/data.ts` 加 carve-out 头注释
- 5 个 CI 守卫脚本 + 接入 `pnpm lint`
- `apps/web/src/styles/*.css` 调整 dark `--border` 亮度

**Out:**
- `ConnectionPicker` 不切 Combobox（< 7 saved connections 的 `<Select>` 体验仍可接受；未来由独立 issue 跟进）
- `deployment-recipes/data.ts` 不做 i18n 化（V1 carve-out）
- 不引入新依赖（cmdk 已在 `<Command>` 中传递依赖；shadcn primitives 已就位）

## 3. 规范文档：`docs/project-standards.md` 新增章节

### §11 国际化（i18n）规范

**RULE-i18n-1 · 用户可见文案必须走 `t()`**
凡是渲染到 DOM 的人类语言（label、placeholder、button text、error、empty state、tooltip、aria-label、toast）不得硬编码中英文。
白名单：品牌名（"ModelDoctor"）、运行时数据（`connection.name` 等）、技术标识符（`vLLM`、参数名 `--tensor-parallel-size`）、单位符号（`ms` / `MB` / `%`）。
V1 仅 zh-CN 数据文件需文件头标注 `// i18n: zh-CN-only V1, see <issue>` 注释。

**RULE-i18n-2 · 命名空间与 key 命名**
- 一个 feature 一个 namespace（与 `apps/web/src/features/<name>/` 同名），跨 feature 复用文案进 `common`。
- key 用 dot-path 语义化分组：`<area>.<element>.<state>`，例 `create.prefillFromTemplate.empty`。
- 操作动词集中 `common.actions.*`，状态 `common.status.*`，校验 `common.validation.*`。新增重复语义不得另起 key — 复用现有的。

**RULE-i18n-3 · zh-CN 与 en-US 必须 1:1 同步**
- 任意一边新增 key，另一边必须同提交补齐；缺失即 PR 不予合入（CI 守卫 `check:i18n-parity`）。

**RULE-i18n-4 · 表单校验消息**
- zod default error 走 `lib/i18n.ts` 全局 `z.setErrorMap`（已涵盖 required / tooShort / invalidEmail 等）。
- `.refine(message: ...)` 显式 message 必须用 `validation.<key>` 形式，不写人话；由 `<FormMessage>` 渲染时翻译。
- 自定义 validation key 进 `common.validation.*`。

**RULE-i18n-5 · 插值与复数**
- 动态值用 `{{name}}` 占位，禁止字符串拼接。
- 复数走 i18next 的 `_one` / `_other` 后缀。

**RULE-i18n-6 · CI 守卫（硬性）**
- `apps/web/scripts/check-i18n-parity.mjs`：比 zh-CN 与 en-US namespace key 集合是否 1:1。
- `apps/web/scripts/check-no-hardcoded-zh.mjs`：grep `[一-鿿]` over `src/**/*.{ts,tsx}`，排除 `locales/**` / `test/**` / `__tests__/**` / `features/deployment-recipes/data.ts` / 行内注释。
- 二者并入 `pnpm -F @modeldoctor/web check:i18n`，挂入根 `pnpm lint`。

### §12 组件复用规范

**RULE-comp-1 · 下拉选择器**
| 场景 | 必用 | 禁止 |
|---|---|---|
| ≤ 7 项固定枚举 | shadcn `<Select>` | 原生 `<select>` / `<DropdownMenu>` |
| 可搜索 / >7 项 / 异步数据 | shadcn `<Combobox>`（新增） | 手写 `<Popover>` + `<Input>` + `<ul>` |
| 触发命令（菜单项） | shadcn `<DropdownMenu>` | `<Select>` |

新增 `components/ui/combobox.tsx` props 契约：
```ts
export interface ComboboxProps<T> {
  items: T[];
  value: T | null;
  onChange: (v: T | null) => void;
  getKey: (item: T) => string;
  getLabel: (item: T) => string;
  renderItem?: (item: T) => ReactNode;     // 自定义行内容，需自带 key 文本以利 cmdk 搜索
  searchPlaceholder?: string;
  emptyText?: string;
  triggerLabel?: ReactNode;                 // trigger 显示，未选中时
  trigger?: ReactNode;                      // 完全自定义 trigger（覆盖 triggerLabel）
  footer?: ReactNode;                       // popover 底部 slot（如 "Manage templates" 链接）
  align?: "start" | "center" | "end";
  contentClassName?: string;
}
```
内部基于 `<Popover>` + cmdk `<Command>`，自动支持键盘导航 / Esc / a11y `listbox`。

**RULE-comp-2 · 确认弹窗**
- 删除/不可逆操作必用 `<AlertDialog>`，不是 `<Dialog>`；触发态 `variant="destructive"`。
- 禁止 `window.confirm()` / `window.alert()`（CI 守卫）。

**RULE-comp-3 · Toast**
- 全局唯一 toast：sonner（`<Toaster>` 在 `App.tsx`）。`import { toast } from "sonner"`。
- 禁止自研 toast / showAlert / notify。

**RULE-comp-4 · 图标**
- 只用 `lucide-react`。同一语义跨页面用同一图标。

**RULE-comp-5 · 表单**
交叉引用 §6（已有）。`<FormField> → <FormItem> → <FormLabel required?> + <FormControl> + <FormMessage>` 链路完整不得缺。

**RULE-comp-6 · 共享业务组件强制复用**
- 选连接：`<ConnectionPicker>`（已写在 `CLAUDE.md`，此处交叉引用）。
- 选 benchmark template：重写后的 `<PrefillFromTemplate>`（基于 `<Combobox>`）。

**RULE-comp-7 · CI 守卫（硬性）**
- `apps/web/scripts/check-no-native-select.mjs`：grep `<select\b` / `<textarea\b` over `src/**/*.tsx`，排除 `components/ui/`（shadcn 包装层本身需要原生标签）。
- `apps/web/scripts/check-no-confirm.mjs`：grep `\bwindow\.(confirm|alert)\(`。
- `apps/web/scripts/check-no-handcrafted-popover-list.mjs`：扫 `features/**/*.tsx` 中 `<Popover` + `<Input` + `<ul` 三元共现的文件，warn（非 fail）；后续可视 false-positive 转硬性。
- 三者并入 `pnpm -F @modeldoctor/web check:components`，挂入根 `pnpm lint`。

## 4. 审计修复清单

### i18n 修复

经 grep 复核：渲染层（JSX 里 outputting 的人类语言）真正硬编码中文的只有 insights feature 的 3 个文件。其余文件命中均在 JSDoc / 行内注释里，不影响 UI；CI 守卫扫 CJK 同样会卡这些注释，故一并翻译为英文。

**A. 渲染层 i18n 化（必改）**

| 文件 | 改动 | 新 key |
|---|---|---|
| `features/insights/FindingsCard.tsx:15-28` | `SEV_BADGE` 中 `label` 字段 4 个中文常量删除；JSX `f.title`/`f.checkId` 处显示 label 时改 `t(\`detail.findings.severity.${f.severity}\`)` | `insights.detail.findings.severity.{crit,warn,good,no_data}` |
| `features/insights/AiDiagnosisCard.tsx:19-23` | `SEV_BADGE` 中 `label` 字段 3 个中文常量删除；JSX 显示时改 `t(\`detail.ai.severity.${f.severity}\`)` | `insights.detail.ai.severity.{critical,warning,info}` |
| `features/insights/InsightsDetailPage.tsx:217` | `r === "7d" ? "近 7 天" : ...` 三元改 `t(\`detail.range.${r}\`)` | `insights.detail.range.{7d,30d,90d}` |

**B. 注释翻译（为通过 CI CJK 扫描）**

| 文件 | 行 | 改动 |
|---|---|---|
| `components/connection/ConnectionPicker.tsx` | 34, 35, 52-54, 101, 161 | 注释中"端点检测 / 新建基准测试 / 默认流"等翻成英文（"endpoint diagnostics / new benchmark / default flow"） |
| `components/connection/EndpointPicker.tsx` | 51-52 | 注释"新建连接 / 粘贴 cURL"翻成英文（"new connection / paste cURL"） |
| `features/benchmarks/BenchmarkDetailPage.tsx` | 363 | 注释 `// Mirror "返回列表"` → `// Mirror "back to list"` |
| `features/benchmarks/BenchmarkCreatePage.tsx` | 193 | 注释 `{/* Top row: 基本信息 (left) + 目标 (right) */}` → 英文 |

**C. Carve-out**

| 文件 | 改动 |
|---|---|
| `features/deployment-recipes/data.ts` | 加文件头 `// i18n: zh-CN-only V1, see #<issue>`（实施时建 GitHub issue 跟踪后续 i18n 化并填编号；CI 脚本路径白名单排除此文件） |

### 组件复用

| 文件 | 改动 |
|---|---|
| `components/ui/combobox.tsx`（新增） | 见 §3 RULE-comp-1 props 契约 |
| `features/benchmarks/PrefillFromTemplatePopover.tsx` | 重写为基于 `<Combobox>` + `renderItem`（保留 `ShieldCheck` + `Badge` + footer 链接） |
| `features/benchmarks/__tests__/PrefillFromTemplatePopover.test.tsx` | 断言更新（cmdk 用 `role="listbox"` + `role="option"`，与原 `<ul>` 不同） |
| `features/benchmarks/compare/CompareToolbar.tsx` | 原生 `<select>` → shadcn `<Select>`；items = runs + 一个 baseline-none 项 |
| `features/benchmarks/compare/__tests__/BenchmarkComparePage.test.tsx` | 断言更新 |

### 深色主题边框

- `apps/web/src/styles/*.css` dark block：
  - `--border: 220 8% 14%` → `220 8% 24%`（实施时浏览器并排对比 light + dark 取最佳值，落到 PR 截图）
  - 检查 `--input` token 是否使用同值；若是同步调亮
- 不动 light token、不动其它颜色 token。

## 5. 提交切片（单 PR）

| # | commit | 内容 | ~ files |
|---|---|---|---|
| 1 | `docs(standards): add i18n + component-reuse rules` | `docs/project-standards.md` §11 + §12 | 1 |
| 2 | `feat(web): add shadcn Combobox primitive` | `components/ui/combobox.tsx` | 1 |
| 3 | `refactor(web): unify dropdowns to shadcn (Combobox + Select)` | `PrefillFromTemplatePopover` 重写 + `CompareToolbar` Select 切换 + 配套测试 | ~4 |
| 4 | `fix(web/i18n): translate hardcoded zh labels` | insights / benchmarks / EndpointPicker + `deployment-recipes/data.ts` carve-out 注释 + zh-CN/en-US JSON 同步 | ~10 |
| 5 | `fix(web/theme): improve dark-mode border visibility` | `styles/*.css` dark `--border` 与潜在 `--input` 调亮 | 1 |
| 6 | `build(web): add CI guards for i18n & component reuse` | 5 个 mjs 脚本 + `apps/web/package.json` script + 根 `package.json` lint 接入 | ~7 |

## 6. 验收

- [ ] `pnpm -r build` 通过
- [ ] `pnpm -r --if-present test` 全绿
- [ ] `pnpm -r --if-present type-check` 通过
- [ ] `pnpm -F @modeldoctor/web check:i18n && pnpm -F @modeldoctor/web check:components` 通过
- [ ] `pnpm lint`（包含上述 check）通过
- [ ] **浏览器手测**（dev server）：
  - PrefillFromTemplate：打开 / 输入搜索 / 上下键 / Enter / Esc / footer 跳转 → 全部正常
  - BenchmarkCompare baseline 下拉切换 → 正常
  - insights 详情页 zh-CN ↔ en-US 切换 → 无残留
  - **深色主题下 textarea / card 边框肉眼可辨**（new）
  - 浅色主题边框无回归
- [ ] PR 描述：5 个守卫脚本 + 4 个修复点 + 1 个 Combobox primitive + 1 个 token 修复

## 7. 风险与回滚

- **a11y 行为变更**：cmdk 用 `role="listbox" / option`，与原 `<ul>` 不同；E2E / unit test 需配套更新，未覆盖的键盘场景需手测。
- **dark token 影响面**：`--border` 调亮后整站所有 border 都会变化，可能让 PageHeader / Card / Sidebar 看起来"过曝"；调值需视觉验证。回滚单元独立（commit 5 单独可 revert）。
- **CI 守卫上线影响**：已存在的 `deployment-recipes/data.ts` 必须先加 carve-out 注释（commit 4）才不卡 commit 6。提交顺序按上表 1→6 必须严格执行。
- **shadcn `<Select>` 项内复杂内容**：现在 `ConnectionPicker` 已在 `<SelectItem>` 里塞了多行（name + model + baseUrl），证明 shadcn Select 能容纳；`CompareToolbar` 切换无风险。

## 8. 不做（明确 carve-out）

- 不改 `deployment-recipes/data.ts` 的 zh-CN-only 数据 — V1 已知。
- 不切 `ConnectionPicker` 到 Combobox — 体验仍可接受。
- 不引入新依赖。
- 不动 light theme。
- 不动 `apps/api/` / `apps/benchmark-runner/`。

---

**下一步**：本 spec 经 user review 后调用 `writing-plans` 生成实施计划。
