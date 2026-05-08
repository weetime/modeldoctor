# i18n & Component-Reuse Standards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add §11 i18n + §12 component-reuse rules to `docs/project-standards.md`, refactor existing dropdown violations onto shadcn primitives, migrate render-layer Chinese to locales, fix dark-mode `--border` visibility, and install 5 CI guards to prevent regressions — all in a single PR with phase-per-commit.

**Architecture:** Single PR on branch `feat/i18n-and-component-standards` (worktree at `/Users/fangyong/vllm/modeldoctor/i18n-and-component-standards`, base `origin/main` cb7423b). Six commits matching spec §5: (1) standards doc, (2) Combobox primitive, (3) dropdown refactors + test updates, (4) i18n labels + comment translations + carve-out, (5) dark token bump, (6) CI guards + lint wiring.

**Tech Stack:** React 18 / TypeScript / Vite / shadcn-ui (Radix + cmdk) / i18next / Vitest 2 / Biome 1.9 / pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-05-08-i18n-and-component-standards-design.md`

**Conventions for every commit:**
- Conventional commit prefix per spec §5
- Body ends with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
- Explicit `git add <files>` (never `git add -A`)
- Per-task end-of-task: run `pnpm -F @modeldoctor/web type-check` to keep TS green; do not push between commits

---

## Task 0: Verify worktree is built

**Files:**
- Read-only

- [ ] **Step 1: Verify branch + working tree clean**

```bash
cd /Users/fangyong/vllm/modeldoctor/i18n-and-component-standards
git status -sb
```

Expected: `## feat/i18n-and-component-standards...origin/main [ahead 2]` (the 2 commits are the spec docs already landed). No uncommitted changes.

- [ ] **Step 2: Build all packages once (worktree-first-build per CLAUDE.md)**

```bash
pnpm -r build
```

Expected: all 4 packages build clean (`@modeldoctor/contracts`, `@modeldoctor/tool-adapters`, `@modeldoctor/web`, `@modeldoctor/api`). Without this, `apps/api` typecheck fails because `packages/contracts/dist` is empty.

- [ ] **Step 3: Baseline test run**

```bash
pnpm -F @modeldoctor/web test 2>&1 | tail -20
```

Expected: existing tests pass (PrefillFromTemplatePopover 4 tests, others all green). Records the baseline so regressions in later tasks are clear.

---

## Task 1: Add §11 i18n + §12 component-reuse rules to `docs/project-standards.md`

**Files:**
- Modify: `docs/project-standards.md` (append two sections at end)

- [ ] **Step 1: Read current end of file to know append point**

```bash
wc -l docs/project-standards.md
tail -30 docs/project-standards.md
```

Expected: ~308 lines, file ends after current last section.

- [ ] **Step 2: Append §11 + §12**

Append the following at end of `docs/project-standards.md`:

````markdown

---

## 11. 国际化(i18n)规范

> 每次新增 UI 必读。CI 守卫见 §11.7,违反硬挂。

### 11.1 用户可见文案必走 `t()` (RULE-i18n-1)

凡是渲染到 DOM 的人类语言不得硬编码:label / placeholder / button text / error / empty state / tooltip / aria-label / toast 文本。

**白名单**(可硬编码):
- 品牌名:`ModelDoctor`
- 运行时数据:API/DB 返回值(`connection.name`、`run.tool`)
- 技术标识符:`vLLM`、`HTTP/1.1`、CLI 参数名(`--tensor-parallel-size`)
- 单位与符号:`ms` / `MB` / `%` / `→ POST <url>`

**V1 zh-CN-only 数据文件 carve-out**:文件头加 `// i18n: zh-CN-only V1, see #<issue>` 即可豁免;当前仅 `apps/web/src/features/deployment-recipes/data.ts` 享此豁免。

### 11.2 命名空间与 key 命名 (RULE-i18n-2)

- 一个 feature 一个 namespace,与 `apps/web/src/features/<name>/` 同名。跨 feature 复用文案进 `common`。
- key 用 dot-path 语义化分组:`<area>.<element>.<state>`。例 `create.prefillFromTemplate.empty`。
- 通用动词集中 `common.actions.*`,状态 `common.status.*`,校验 `common.validation.*`。新增重复语义复用现有 key。

### 11.3 zh-CN 与 en-US 必须 1:1 同步 (RULE-i18n-3)

任意一边新增 key,另一边必须同提交补齐。差异由 CI 守卫 `check-i18n-parity` 强制。

### 11.4 表单校验消息 (RULE-i18n-4)

- zod 默认错走 `lib/i18n.ts` 全局 `z.setErrorMap`(已涵盖 required / tooShort / invalidEmail 等)。
- `.refine(message: ...)` 显式 message 必须用 `validation.<key>` 形式,不写人话;`<FormMessage>` 渲染时翻译。
- 自定义 validation key 进 `common.validation.*`。

### 11.5 插值与复数 (RULE-i18n-5)

- 动态值用 `{{name}}` 占位,禁止字符串拼接。
- 复数走 i18next 的 `_one` / `_other` 后缀。

### 11.6 source-of-truth 入口 (RULE-i18n-extra)

- 业务代码只 `import "@/lib/i18n"`(单 side-effect)或 `import { useTranslation } from "react-i18next"`,**禁止**直接 `import xxx from "@/locales/..."`。

### 11.7 CI 守卫(硬性)

下列脚本由 `pnpm -F @modeldoctor/web check:i18n` 串联,挂入根 `pnpm lint`:

- `apps/web/scripts/check-i18n-parity.mjs` — zh-CN 与 en-US 各 namespace key 集合必须 1:1。
- `apps/web/scripts/check-no-hardcoded-zh.mjs` — 扫 `apps/web/src/**/*.{ts,tsx}` 中 CJK Unified Ideographs(`[一-鿿]`)。排除:`apps/web/src/locales/**`、`__tests__/**`、`*.test.tsx`、`features/deployment-recipes/data.ts`(carve-out)。**注释也会被扫**——若需要中文注释,翻成英文。

---

## 12. 组件复用规范

> 共享 UI 元素必须落在已有 shadcn primitive 上,不重新发明。CI 守卫见 §12.7。

### 12.1 下拉选择器 (RULE-comp-1)

| 场景 | 必用 | 禁止 |
|---|---|---|
| ≤7 项固定枚举 | shadcn `<Select>` | 原生 `<select>` / `<DropdownMenu>` |
| 可搜索 / >7 项 / 异步数据 | shadcn `<Combobox>` (`apps/web/src/components/ui/combobox.tsx`) | 手写 `<Popover>` + `<Input>` + `<ul>` |
| 触发命令(菜单项) | shadcn `<DropdownMenu>` | `<Select>` |

`<Combobox>` props 见 `components/ui/combobox.tsx` JSDoc。基于 `<Popover>` + cmdk `<Command>`,自动 a11y `listbox` + 键盘导航 + Esc。

### 12.2 确认弹窗 (RULE-comp-2)

- 删除 / 不可逆操作必用 `<AlertDialog>`,**不是** `<Dialog>`;触发态 `variant="destructive"`。
- 禁止 `window.confirm()` / `window.alert()`(CI 守卫)。

### 12.3 Toast (RULE-comp-3)

全局唯一 toast:sonner(`<Toaster>` 在 `App.tsx`)。`import { toast } from "sonner"`。禁止自研 toast / showAlert / notify。

### 12.4 图标 (RULE-comp-4)

只用 `lucide-react`。同一语义跨页面用同一图标(搜索全用 `Search`,不混 `Magnifier`)。

### 12.5 表单 (RULE-comp-5)

交叉引用 §6。`<FormField>` → `<FormItem>` → `<FormLabel required?>` + `<FormControl>` + `<FormMessage>` 链路完整,缺一不可。

### 12.6 共享业务组件强制复用 (RULE-comp-6)

- 选连接:`<ConnectionPicker>`(交叉引用 `CLAUDE.md` "Shared field components")。
- 选 benchmark template:`<PrefillFromTemplatePopover>`(基于 `<Combobox>`)。

### 12.7 CI 守卫(硬性)

下列脚本由 `pnpm -F @modeldoctor/web check:components` 串联,挂入根 `pnpm lint`:

- `apps/web/scripts/check-no-native-select.mjs` — 扫 `apps/web/src/**/*.tsx` 中 `<select\b` 与 `<textarea\b`,排除 `components/ui/`(shadcn 包装层)。
- `apps/web/scripts/check-no-confirm.mjs` — 扫 `\bwindow\.(confirm|alert)\(`。
- `apps/web/scripts/check-no-handcrafted-popover-list.mjs` — 扫 `features/**/*.tsx` 中 `<Popover` + `<Input` + `<ul` 三元共现的文件,**warn-only**(stderr,exit 0);后续视 false-positive 转硬。
````

- [ ] **Step 3: Verify markdown lints / renders**

```bash
pnpm -F @modeldoctor/web lint 2>&1 | tail -10
```

Expected: no errors (biome lints `src` only, doesn't touch docs but command should still pass).

- [ ] **Step 4: Commit**

```bash
git add docs/project-standards.md
git commit -m "$(cat <<'EOF'
docs(standards): add §11 i18n + §12 component-reuse rules

§11 codifies the existing i18next setup as hard rules: t() everywhere,
namespace per feature, zh-CN/en-US 1:1 parity, single source-of-truth
import, plus a CJK guard with a deployment-recipes/data.ts carve-out.

§12 codifies component reuse: shadcn Select for fixed enums, new
shadcn Combobox for searchable dropdowns, AlertDialog for destructive
confirms, sonner-only for toasts, lucide-only for icons. CI guards
referenced by §11.7 / §12.7 land in commit 6.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: 1 file changed, ~120 insertions.

---

## Task 2: Add `components/ui/combobox.tsx` shadcn primitive

**Files:**
- Create: `apps/web/src/components/ui/combobox.tsx`

This is shadcn's official Combobox pattern: `<Popover>` + cmdk `<Command>`, generic over `T`. Both `<Command>` and `<Popover>` already exist in `components/ui/`.

- [ ] **Step 1: Write the new file**

```tsx
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ChevronsUpDown } from "lucide-react";
import { type ReactNode, useState } from "react";

export interface ComboboxProps<T> {
  items: T[];
  value: T | null;
  onChange: (v: T | null) => void;
  /** Stable key for React + cmdk filter; must be unique per item. */
  getKey: (item: T) => string;
  /** Plain-text label used for cmdk default filter + trigger fallback. */
  getLabel: (item: T) => string;
  /** Optional rich row renderer; receives the item. Falls back to getLabel. */
  renderItem?: (item: T) => ReactNode;
  /** Optional trigger content when nothing is selected. */
  triggerLabel?: ReactNode;
  /** Fully-custom trigger; overrides default Button. Must accept onClick + ref. */
  trigger?: ReactNode;
  searchPlaceholder?: string;
  emptyText?: string;
  /** Footer slot rendered below the list (e.g. "Manage templates" link). */
  footer?: ReactNode;
  align?: "start" | "center" | "end";
  contentClassName?: string;
  /** Forwarded to the default Button trigger. */
  triggerClassName?: string;
}

export function Combobox<T>({
  items,
  value,
  onChange,
  getKey,
  getLabel,
  renderItem,
  triggerLabel,
  trigger,
  searchPlaceholder,
  emptyText,
  footer,
  align = "start",
  contentClassName,
  triggerClassName,
}: ComboboxProps<T>) {
  const [open, setOpen] = useState(false);

  const defaultTrigger = (
    <Button
      type="button"
      variant="outline"
      role="combobox"
      aria-expanded={open}
      className={cn("justify-between", triggerClassName)}
    >
      <span className="truncate">
        {value !== null ? getLabel(value) : (triggerLabel ?? "")}
      </span>
      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
    </Button>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger ?? defaultTrigger}</PopoverTrigger>
      <PopoverContent
        align={align}
        className={cn("w-[320px] p-0", contentClassName)}
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {items.map((item) => {
              const key = getKey(item);
              return (
                <CommandItem
                  key={key}
                  value={getLabel(item)}
                  onSelect={() => {
                    onChange(item);
                    setOpen(false);
                  }}
                >
                  {renderItem ? renderItem(item) : getLabel(item)}
                </CommandItem>
              );
            })}
          </CommandList>
          {footer ? <div className="border-t p-2">{footer}</div> : null}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm -F @modeldoctor/web type-check
```

Expected: PASS. The component is generic but uses no advanced inference — should compile without warnings.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/combobox.tsx
git commit -m "$(cat <<'EOF'
feat(web): add shadcn Combobox primitive

Generic searchable dropdown built on existing Popover + cmdk Command.
Used by the next commit's PrefillFromTemplate refactor and codified
as the canonical "searchable dropdown" in project-standards §12.1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Refactor `PrefillFromTemplatePopover` to use Combobox

**Files:**
- Modify: `apps/web/src/features/benchmarks/PrefillFromTemplatePopover.tsx` (full rewrite, ~80 lines)

- [ ] **Step 1: Replace file contents**

Overwrite `apps/web/src/features/benchmarks/PrefillFromTemplatePopover.tsx`:

```tsx
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { useTemplates } from "@/features/benchmark-templates/queries";
import type { BenchmarkTemplate, ScenarioId } from "@modeldoctor/contracts";
import { Layers, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

interface PrefillFromTemplatePopoverProps {
  scenario: ScenarioId;
  onPick: (template: BenchmarkTemplate) => void;
}

export function PrefillFromTemplatePopover({ scenario, onPick }: PrefillFromTemplatePopoverProps) {
  const { t } = useTranslation("benchmarks");
  const { data } = useTemplates({ scenario, limit: 50 });
  const items = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Combobox<BenchmarkTemplate>
      items={items}
      value={null}
      onChange={(tpl) => {
        if (tpl) onPick(tpl);
      }}
      getKey={(it) => it.id}
      getLabel={(it) => it.name}
      renderItem={(it) => (
        <div className="flex w-full flex-col gap-1">
          <span className="flex items-center gap-1 text-sm font-medium">
            {it.isOfficial && (
              <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden />
            )}
            <span className="truncate">{it.name}</span>
          </span>
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="text-xs">
              {it.tool}
            </Badge>
            {it.tags.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="outline" className="text-xs">
                {tag}
              </Badge>
            ))}
          </span>
        </div>
      )}
      searchPlaceholder={t("create.prefillFromTemplate.search")}
      emptyText={t("create.prefillFromTemplate.empty")}
      align="end"
      contentClassName="w-96"
      trigger={
        <Button type="button" variant="outline" size="sm">
          <Layers className="mr-1 h-4 w-4" />
          {t("create.prefillFromTemplate.button")}
        </Button>
      }
      footer={
        <Link
          to={`/benchmark-templates?scenario=${scenario}`}
          className="block px-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {t("create.prefillFromTemplate.manage")}
        </Link>
      }
    />
  );
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm -F @modeldoctor/web type-check
```

Expected: PASS.

- [ ] **Step 3: Run unit test (will fail — assertions need cmdk roles)**

```bash
pnpm -F @modeldoctor/web test src/features/benchmarks/__tests__/PrefillFromTemplatePopover 2>&1 | tail -30
```

Expected: FAIL on `getByRole("textbox", ...)` (cmdk uses `combobox` for the search input wrapper) and `findByRole("button", { name: /vLLM single/ })` (cmdk items are `option`, not `button`). This proves the rewrite changed behavior; assertions are updated in Task 4.

DO NOT commit yet — Task 4 packages this together.

---

## Task 4: Update PrefillFromTemplatePopover test assertions for cmdk roles

**Files:**
- Modify: `apps/web/src/features/benchmarks/__tests__/PrefillFromTemplatePopover.test.tsx`

cmdk DOM roles after Combobox refactor:
- Trigger button stays a `<button>` (provided via `trigger` prop)
- Search input is a `<input>` rendered by cmdk's `CommandInput`, queryable via `getByPlaceholderText` (cmdk does not auto-set aria-label)
- List items become `<div role="option">` (`CommandItem` from cmdk)

- [ ] **Step 1: Update assertions**

In `apps/web/src/features/benchmarks/__tests__/PrefillFromTemplatePopover.test.tsx`:

Replace the body of test "filters items locally by search input":

```tsx
  it("filters items locally by search input", async () => {
    vi.mocked(api.get).mockResolvedValue({
      items: [tpl({ id: "t1", name: "vLLM single" }), tpl({ id: "t2", name: "Internal gateway" })],
      nextCursor: null,
    } satisfies ListBenchmarkTemplatesResponse);

    render(<PrefillFromTemplatePopover scenario="inference" onPick={() => {}} />, {
      wrapper: Wrapper,
    });
    await userEvent.click(
      screen.getByRole("button", { name: /prefill from template|从模板预填/i }),
    );
    await screen.findByText("vLLM single");
    const search = screen.getByPlaceholderText(/search templates|搜索模板/i);
    await userEvent.type(search, "vLLM");
    expect(screen.getByText("vLLM single")).toBeInTheDocument();
    expect(screen.queryByText("Internal gateway")).not.toBeInTheDocument();
  });
```

Replace the body of test "calls onPick with the full template object on click":

```tsx
  it("calls onPick with the full template object on click", async () => {
    const t1 = tpl({ id: "t1", name: "vLLM single" });
    vi.mocked(api.get).mockResolvedValue({
      items: [t1],
      nextCursor: null,
    } satisfies ListBenchmarkTemplatesResponse);

    const onPick = vi.fn();
    render(<PrefillFromTemplatePopover scenario="inference" onPick={onPick} />, {
      wrapper: Wrapper,
    });
    await userEvent.click(
      screen.getByRole("button", { name: /prefill from template|从模板预填/i }),
    );
    await userEvent.click(await screen.findByRole("option", { name: /vLLM single/ }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "t1", name: "vLLM single" }));
  });
```

The other two tests ("opens, lists templates" and "shows empty state with manage link") already use `findByText` / `getByRole("link", ...)` which work unchanged.

- [ ] **Step 2: Run tests**

```bash
pnpm -F @modeldoctor/web test src/features/benchmarks/__tests__/PrefillFromTemplatePopover 2>&1 | tail -15
```

Expected: 4 tests PASS.

- [ ] **Step 3: Hold commit — bundled with Task 5/6**

---

## Task 5: Migrate `CompareToolbar` from native `<select>` to shadcn `<Select>`

**Files:**
- Modify: `apps/web/src/features/benchmarks/compare/CompareToolbar.tsx` (full rewrite, ~30 lines)

- [ ] **Step 1: Read the existing test for this component**

```bash
grep -n 'baseline\|Baseline\|<select' apps/web/src/features/benchmarks/compare/__tests__/BenchmarkComparePage.test.tsx | head -20
```

Note any role/label assertions to mirror in the rewrite.

- [ ] **Step 2: Replace file contents**

Overwrite `apps/web/src/features/benchmarks/compare/CompareToolbar.tsx`:

```tsx
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "react-i18next";

export interface CompareToolbarRun {
  id: string;
  name: string | null;
  tool: string;
}

export interface CompareToolbarProps {
  runs: CompareToolbarRun[];
  baselineId: string | null;
  onBaselineChange: (id: string | null) => void;
}

const NONE = "__none__";

export function CompareToolbar({ runs, baselineId, onBaselineChange }: CompareToolbarProps) {
  const { t } = useTranslation("benchmarks");
  return (
    <div className="flex items-center gap-3 text-sm">
      <label className="flex items-center gap-2">
        <span className="text-muted-foreground">{t("compare.baselineLabel")}</span>
        <Select
          value={baselineId ?? NONE}
          onValueChange={(v) => onBaselineChange(v === NONE ? null : v)}
        >
          <SelectTrigger className="h-8 min-w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t("compare.baselineNone")}</SelectItem>
            {runs.map((run) => (
              <SelectItem key={run.id} value={run.id}>
                {run.name ?? run.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
    </div>
  );
}
```

Note: shadcn `<Select>` cannot accept empty-string `value`, hence the `__none__` sentinel — same pattern `ConnectionPicker` already uses (`__manual__` / `__new__`).

- [ ] **Step 3: Type-check**

```bash
pnpm -F @modeldoctor/web type-check
```

Expected: PASS.

- [ ] **Step 4: Hold commit — bundled with Task 6**

---

## Task 6: Update CompareToolbar test (if any) for shadcn Select roles

**Files:**
- Modify: `apps/web/src/features/benchmarks/compare/__tests__/BenchmarkComparePage.test.tsx` (only if assertions touch the toolbar)

shadcn `<Select>` renders a `<button role="combobox">` trigger and Radix portals options as `<div role="option">`.

- [ ] **Step 1: Run tests to see what fails**

```bash
pnpm -F @modeldoctor/web test src/features/benchmarks/compare/__tests__/BenchmarkComparePage 2>&1 | tail -30
```

If all PASS: skip to Step 3.

If any FAIL with selector errors on the baseline select:

- [ ] **Step 2: Update the failing assertions**

For any selector previously matching the native `<select>`:
- Replace `screen.getByRole("combobox")` (this was the native select) with `screen.getByRole("combobox", { name: /baseline/i })` (Radix trigger role is also `combobox`; same role name)
- Replace `userEvent.selectOptions(select, runId)` with:
  ```tsx
  await userEvent.click(screen.getByRole("combobox", { name: /baseline/i }));
  await userEvent.click(await screen.findByRole("option", { name: /<run name>/i }));
  ```
- Replace any direct `select.value` assertion with checking the displayed text inside the trigger.

If radix's portal complicates testing, the test may need `screen.findByRole("listbox")` after click — shadcn ports inside a `<Portal>` so use `await waitFor` for visibility.

- [ ] **Step 3: Re-run tests**

```bash
pnpm -F @modeldoctor/web test src/features/benchmarks/compare/__tests__/BenchmarkComparePage 2>&1 | tail -20
```

Expected: PASS.

- [ ] **Step 4: Commit (bundles Tasks 3-6)**

```bash
git add \
  apps/web/src/features/benchmarks/PrefillFromTemplatePopover.tsx \
  apps/web/src/features/benchmarks/__tests__/PrefillFromTemplatePopover.test.tsx \
  apps/web/src/features/benchmarks/compare/CompareToolbar.tsx \
  apps/web/src/features/benchmarks/compare/__tests__/BenchmarkComparePage.test.tsx
git commit -m "$(cat <<'EOF'
refactor(web): unify dropdowns to shadcn (Combobox + Select)

PrefillFromTemplatePopover was a hand-rolled Popover + Input + ul/li,
incompatible with the shadcn Select used elsewhere; rebuild it on the
new Combobox primitive (cmdk under the hood). CompareToolbar's native
<select> is replaced with shadcn Select using a __none__ sentinel for
the empty baseline (same pattern as ConnectionPicker's __manual__).

Tests updated for cmdk's role="option" semantics and Radix Select's
portal-rendered listbox.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

If Task 6 Step 2 found no test changes needed, omit the BenchmarkComparePage.test.tsx file from `git add`.

---

## Task 7: i18n insights severity & range labels

**Files:**
- Modify: `apps/web/src/features/insights/FindingsCard.tsx`
- Modify: `apps/web/src/features/insights/AiDiagnosisCard.tsx`
- Modify: `apps/web/src/features/insights/InsightsDetailPage.tsx:217`
- Modify: `apps/web/src/locales/zh-CN/insights.json`
- Modify: `apps/web/src/locales/en-US/insights.json`

- [ ] **Step 1: Add zh-CN keys to `apps/web/src/locales/zh-CN/insights.json`**

Locate the `"detail":` block and add three new sub-objects (`findings.severity`, `ai.severity`, `range`). The existing `detail.findings.title` etc. stay; only inject these three new sub-trees:

```json
  "detail": {
    /* …existing keys… */
    "findings": {
      /* …existing keys (title, noFindings, expandAll)… */
      "severity": {
        "crit": "高危",
        "warn": "中等",
        "good": "良好",
        "no_data": "无数据"
      }
    },
    "ai": {
      /* …existing keys (title, generate, …)… */
      "severity": {
        "critical": "高危",
        "warning": "警告",
        "info": "提示"
      }
    },
    "range": {
      "7d": "近 7 天",
      "30d": "近 30 天",
      "90d": "近 90 天"
    }
  }
```

(Edit in place — don't blow away existing keys. Read the file first; merge into the existing `detail` object.)

- [ ] **Step 2: Add en-US keys to `apps/web/src/locales/en-US/insights.json`** (mirror, English values)

```json
      "severity": {
        "crit": "Critical",
        "warn": "Warning",
        "good": "Good",
        "no_data": "No data"
      }
```

```json
      "severity": {
        "critical": "Critical",
        "warning": "Warning",
        "info": "Info"
      }
```

```json
    "range": {
      "7d": "Last 7 days",
      "30d": "Last 30 days",
      "90d": "Last 90 days"
    }
```

- [ ] **Step 3: Update `FindingsCard.tsx`**

In `apps/web/src/features/insights/FindingsCard.tsx`:

Replace the `SEV_BADGE` definition (lines 15-28) — drop the `label` field:

```tsx
const SEV_BADGE = {
  crit: { emoji: "🔴", cls: "border-l-rose-500 bg-rose-50/50 dark:bg-rose-950/20" },
  warn: { emoji: "🟡", cls: "border-l-amber-500 bg-amber-50/50 dark:bg-amber-950/20" },
  good: { emoji: "🟢", cls: "border-l-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20" },
  no_data: { emoji: "·", cls: "border-l-muted bg-muted/30" },
} as const;
```

The current FindingsCard JSX renders `<span>{sev.emoji}</span>` then `[scenario]` etc. — it does **not** currently render `sev.label` anywhere. Removing the label field is therefore a no-op for current rendering, but eliminates dead Chinese strings to satisfy the CJK guard.

- [ ] **Step 4: Update `AiDiagnosisCard.tsx`**

In `apps/web/src/features/insights/AiDiagnosisCard.tsx`:

Replace `SEV_BADGE` (lines 19-23):

```tsx
const SEV_BADGE = {
  critical: { emoji: "🔴", cls: "border-rose-500" },
  warning: { emoji: "🟡", cls: "border-amber-500" },
  info: { emoji: "🔵", cls: "border-blue-500" },
} as const;
```

Same logic — `label` was unused at render time; removing it removes dead Chinese.

(If grep reveals `sev.label` is referenced anywhere, replace those references with `t(\`detail.ai.severity.${f.severity}\`)`.)

- [ ] **Step 5: Update `InsightsDetailPage.tsx:217`**

Locate the `RANGES.map` block. Replace:

```tsx
                  <SelectItem key={r} value={r}>
                    {r === "7d" ? "近 7 天" : r === "30d" ? "近 30 天" : "近 90 天"}
                  </SelectItem>
```

with:

```tsx
                  <SelectItem key={r} value={r}>
                    {t(`detail.range.${r}`)}
                  </SelectItem>
```

`t` is already in scope (line of `useTranslation("insights")` near top of file).

Also fix the comment at `apps/web/src/features/insights/InsightsDetailPage.tsx:318`:

```tsx
        {/* AI 智能诊断 — full-width at the bottom */}
```
→
```tsx
        {/* AI diagnosis — full-width at the bottom */}
```

- [ ] **Step 6: Type-check + test insights**

```bash
pnpm -F @modeldoctor/web type-check && \
  pnpm -F @modeldoctor/web test src/features/insights 2>&1 | tail -20
```

Expected: type-check PASS; insights tests PASS (existing assertions probably don't depend on the removed labels).

- [ ] **Step 7: Hold commit — bundled with Tasks 8/9**

---

## Task 8: Translate inline comments to English

**Files:**
- Modify: `apps/web/src/components/connection/ConnectionPicker.tsx` (lines 34, 35, 52-54, 101, 161)
- Modify: `apps/web/src/components/connection/EndpointPicker.tsx` (lines 51-52)
- Modify: `apps/web/src/features/benchmarks/BenchmarkDetailPage.tsx:363`
- Modify: `apps/web/src/features/benchmarks/BenchmarkCreatePage.tsx:193`

These are all in JSDoc / inline comments — they don't change runtime behavior but trip the CJK guard.

- [ ] **Step 1: ConnectionPicker.tsx**

In `apps/web/src/components/connection/ConnectionPicker.tsx`:

Line 34-35:
```tsx
   * can fall back to manual endpoint editing (used by 端点检测). Default false:
   * the consumer requires a saved connection (used by 新建基准测试). */
```
→
```tsx
   * can fall back to manual endpoint editing (used by endpoint diagnostics).
   * Default false: the consumer requires a saved connection (used by new
   * benchmark creation flow). */
```

Lines 52-54:
```tsx
 * Shared connection picker chrome — saved-connection dropdown + "+ 新建连接"
 * + "粘贴 cURL" button. Used by `EndpointPicker` (端点检测) and creation
 * flows that need a saved connection (e.g. 新建基准测试).
```
→
```tsx
 * Shared connection picker chrome — saved-connection dropdown + "New
 * connection" + "Paste cURL" button. Used by `EndpointPicker` (endpoint
 * diagnostics) and creation flows that need a saved connection (e.g.
 * new benchmark creation).
```

Line 101:
```tsx
      // Consumer-driven flow (端点检测): hand back the parsed curl, drop any
```
→
```tsx
      // Consumer-driven flow (endpoint diagnostics): hand back the parsed curl,
```

Line 161:
```tsx
         * onCurlParsed flow (端点检测). The default path opens
```
→
```tsx
         * onCurlParsed flow (endpoint diagnostics). The default path opens
```

- [ ] **Step 2: EndpointPicker.tsx**

Lines 51-52:
```tsx
 * The top-row picker chrome (saved-connection dropdown + Manual + + 新建连接
 * + 粘贴 cURL) is shared with `<ConnectionPicker>` so creation pages get the
```
→
```tsx
 * The top-row picker chrome (saved-connection dropdown + Manual + "New
 * connection" + "Paste cURL") is shared with `<ConnectionPicker>` so
 * creation pages get the
```

- [ ] **Step 3: BenchmarkDetailPage.tsx:363**

```tsx
                    // Mirror "返回列表" — keep the user in the same scenario
```
→
```tsx
                    // Mirror "back to list" — keep the user in the same scenario
```

- [ ] **Step 4: BenchmarkCreatePage.tsx:193**

```tsx
            {/* Top row: 基本信息 (left) + 目标 (right) — both info-light, paired
```
→
```tsx
            {/* Top row: basic info (left) + target (right) — both info-light, paired
```

- [ ] **Step 5: Verify no CJK left in those files**

```bash
grep -n '[一-鿿]' \
  apps/web/src/components/connection/ConnectionPicker.tsx \
  apps/web/src/components/connection/EndpointPicker.tsx \
  apps/web/src/features/benchmarks/BenchmarkDetailPage.tsx \
  apps/web/src/features/benchmarks/BenchmarkCreatePage.tsx
```

Expected: no output.

- [ ] **Step 6: Type-check (sanity, since these are comments)**

```bash
pnpm -F @modeldoctor/web type-check
```

Expected: PASS.

- [ ] **Step 7: Hold commit — bundled with Task 9**

---

## Task 9: Add `deployment-recipes/data.ts` carve-out comment

**Files:**
- Modify: `apps/web/src/features/deployment-recipes/data.ts` (top of file)

- [ ] **Step 1: Insert header comment**

At the very top of `apps/web/src/features/deployment-recipes/data.ts` (line 1, before any existing import), add:

```ts
// i18n: zh-CN-only V1, see #<deployment-recipes-i18n-issue>
// This data table mixes display-bound Chinese descriptions with deployment
// metadata. Migrating to t() is tracked separately; CI guard
// `check-no-hardcoded-zh.mjs` whitelists this file by path.
```

(Implementer: file a GitHub issue first, then substitute the issue number for `#<deployment-recipes-i18n-issue>`. If that's premature, leave the placeholder and note it in the PR description.)

- [ ] **Step 2: Verify file still parses**

```bash
pnpm -F @modeldoctor/web type-check
```

Expected: PASS.

- [ ] **Step 3: Commit (bundles Tasks 7-9)**

```bash
git add \
  apps/web/src/features/insights/FindingsCard.tsx \
  apps/web/src/features/insights/AiDiagnosisCard.tsx \
  apps/web/src/features/insights/InsightsDetailPage.tsx \
  apps/web/src/locales/zh-CN/insights.json \
  apps/web/src/locales/en-US/insights.json \
  apps/web/src/components/connection/ConnectionPicker.tsx \
  apps/web/src/components/connection/EndpointPicker.tsx \
  apps/web/src/features/benchmarks/BenchmarkDetailPage.tsx \
  apps/web/src/features/benchmarks/BenchmarkCreatePage.tsx \
  apps/web/src/features/deployment-recipes/data.ts
git commit -m "$(cat <<'EOF'
fix(web/i18n): translate hardcoded zh labels and comments

Render-layer hardcoded Chinese only existed in 3 insights files
(severity labels in FindingsCard / AiDiagnosisCard, range labels in
InsightsDetailPage); migrate those to insights namespace keys with
zh-CN/en-US parity. Other files' Chinese was confined to JSDoc/inline
comments — translate to English so the upcoming CJK guard does not
fire false positives. deployment-recipes/data.ts gets a carve-out
header per project-standards §11.1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Dark-mode `--border` / `--input` visibility fix

**Files:**
- Modify: `apps/web/src/styles/globals.css` (`.dark` block, lines 62-63)

- [ ] **Step 1: Adjust the two tokens**

In `apps/web/src/styles/globals.css`, change the `.dark` block:

```css
    --border: 220 8% 14%;
    --input: 220 8% 14%;
```

to

```css
    --border: 220 8% 24%;
    --input: 220 8% 24%;
```

Light theme tokens stay untouched.

- [ ] **Step 2: Build + start dev server for visual verification**

```bash
pnpm -F @modeldoctor/web build 2>&1 | tail -10
```

Expected: build PASS, no Tailwind errors.

Then in another shell:

```bash
pnpm dev
```

In a browser, navigate to `http://localhost:5173/playground/image?mode=generate`. Switch to dark theme via the theme toggle. Compare:
- Prompt textarea bottom input: border now visible against the dark background
- Empty image card outline: border now visible
- Light theme should look identical to before

If 24% looks too aggressive (e.g., PageHeader's bottom border becomes "harsh"), bump down to 22% or 20%; the floor that solves the visibility issue is around 20% — anything ≤16% is the original problem.

Take screenshots (light + dark, /image page + an arbitrary card-heavy page like /benchmarks) for the PR description.

- [ ] **Step 3: Stop dev server**

Ctrl-C the `pnpm dev` shell.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/styles/globals.css
git commit -m "$(cat <<'EOF'
fix(web/theme): improve dark-mode border visibility

Dark --border / --input were 220 8% 14% — barely distinguishable from
the 220 11% 4% background, leaving textareas and empty-state cards
without a perceptible outline. Raised lightness to 24% (verified on
the image-generate empty-state and across card-heavy pages); light
theme tokens unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: CI guard — `check-i18n-parity.mjs`

**Files:**
- Create: `apps/web/scripts/check-i18n-parity.mjs`

- [ ] **Step 1: Write the script**

Create `apps/web/scripts/check-i18n-parity.mjs`:

```js
#!/usr/bin/env node
// Compares zh-CN and en-US namespace JSONs for key-set equality. Recursive.
// Exits 1 on any difference, printing the missing dot-paths per side.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const localesRoot = resolve(here, "..", "src", "locales");
const ZH = join(localesRoot, "zh-CN");
const EN = join(localesRoot, "en-US");

function flatten(obj, prefix = "", out = new Set()) {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      flatten(v, path, out);
    } else {
      out.add(path);
    }
  }
  return out;
}

const zhFiles = new Set(readdirSync(ZH).filter((f) => f.endsWith(".json")));
const enFiles = new Set(readdirSync(EN).filter((f) => f.endsWith(".json")));

let failed = false;

const onlyInZh = [...zhFiles].filter((f) => !enFiles.has(f));
const onlyInEn = [...enFiles].filter((f) => !zhFiles.has(f));
if (onlyInZh.length || onlyInEn.length) {
  console.error("[i18n-parity] namespace files diverge");
  if (onlyInZh.length) console.error("  zh-CN only:", onlyInZh.join(", "));
  if (onlyInEn.length) console.error("  en-US only:", onlyInEn.join(", "));
  failed = true;
}

for (const ns of zhFiles) {
  if (!enFiles.has(ns)) continue;
  const zh = flatten(JSON.parse(readFileSync(join(ZH, ns), "utf8")));
  const en = flatten(JSON.parse(readFileSync(join(EN, ns), "utf8")));
  const missingInEn = [...zh].filter((k) => !en.has(k));
  const missingInZh = [...en].filter((k) => !zh.has(k));
  if (missingInEn.length || missingInZh.length) {
    failed = true;
    console.error(`[i18n-parity] ${ns}`);
    for (const k of missingInEn) console.error(`  missing in en-US: ${k}`);
    for (const k of missingInZh) console.error(`  missing in zh-CN: ${k}`);
  }
}

if (failed) {
  console.error("\n[i18n-parity] FAIL — add the missing keys to both locales.");
  process.exit(1);
}
console.log("[i18n-parity] OK — zh-CN and en-US key sets match.");
```

- [ ] **Step 2: Make executable + sanity-run**

```bash
chmod +x apps/web/scripts/check-i18n-parity.mjs
node apps/web/scripts/check-i18n-parity.mjs
```

Expected: `[i18n-parity] OK — zh-CN and en-US key sets match.` (because Task 7 already added the new insights keys to both sides).

If FAIL: investigate Task 7 — both files must contain the same set of keys.

- [ ] **Step 3: Hold commit — bundled with Tasks 12-16**

---

## Task 12: CI guard — `check-no-hardcoded-zh.mjs`

**Files:**
- Create: `apps/web/scripts/check-no-hardcoded-zh.mjs`

- [ ] **Step 1: Write the script**

Create `apps/web/scripts/check-no-hardcoded-zh.mjs`:

```js
#!/usr/bin/env node
// Forbids Chinese characters (CJK Unified Ideographs U+4E00..U+9FFF) anywhere
// in apps/web/src, except for: locales/, tests/__tests__, *.test.tsx, the
// deployment-recipes/data.ts carve-out, and node_modules.
// This is a path-only guard — comments are NOT exempt. If you need a Chinese
// comment, translate it to English.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, "..", "src");
const REL = (p) => relative(resolve(here, ".."), p).replaceAll("\\", "/");
const CJK = /[一-鿿]/;

const EXCLUDE_DIRS = new Set(["node_modules", "locales", "__tests__"]);
const EXCLUDE_FILES = new Set([
  // Carve-outs (file paths relative to apps/web/)
  "src/features/deployment-recipes/data.ts",
]);
const EXCLUDE_SUFFIXES = [".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx"];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (EXCLUDE_DIRS.has(name)) continue;
      yield* walk(p);
    } else if (st.isFile() && (p.endsWith(".ts") || p.endsWith(".tsx"))) {
      yield p;
    }
  }
}

let failed = false;
const hits = [];

for (const file of walk(SRC)) {
  const rel = REL(file);
  if (EXCLUDE_FILES.has(rel)) continue;
  if (EXCLUDE_SUFFIXES.some((s) => file.endsWith(s))) continue;

  const text = readFileSync(file, "utf8");
  if (!CJK.test(text)) continue;

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (CJK.test(lines[i])) {
      hits.push(`${rel}:${i + 1}: ${lines[i].trim()}`);
      failed = true;
    }
  }
}

if (failed) {
  console.error("[no-hardcoded-zh] FAIL — CJK characters in source:");
  for (const h of hits.slice(0, 50)) console.error("  " + h);
  if (hits.length > 50) console.error(`  …and ${hits.length - 50} more.`);
  console.error("\nFix: route user-facing strings through t(); translate comments to English.");
  process.exit(1);
}
console.log("[no-hardcoded-zh] OK — no CJK characters in source (excluding carve-outs).");
```

- [ ] **Step 2: Make executable + sanity-run**

```bash
chmod +x apps/web/scripts/check-no-hardcoded-zh.mjs
node apps/web/scripts/check-no-hardcoded-zh.mjs
```

Expected: `[no-hardcoded-zh] OK …` because Task 7 + Task 8 + Task 9 already eliminated/whitelisted every match.

If FAIL with hits: re-check Tasks 7/8/9 — every listed file should be either fixed or in `EXCLUDE_FILES`.

- [ ] **Step 3: Hold commit**

---

## Task 13: CI guard — `check-no-native-select.mjs`

**Files:**
- Create: `apps/web/scripts/check-no-native-select.mjs`

- [ ] **Step 1: Write the script**

Create `apps/web/scripts/check-no-native-select.mjs`:

```js
#!/usr/bin/env node
// Forbids native <select> and <textarea> in TSX, except the shadcn UI
// wrappers in components/ui/ which legitimately wrap them.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, "..", "src");
const REL = (p) => relative(resolve(here, ".."), p).replaceAll("\\", "/");
const PAT = /<(select|textarea)\b/;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules") continue;
      yield* walk(p);
    } else if (st.isFile() && p.endsWith(".tsx")) {
      yield p;
    }
  }
}

let failed = false;
const hits = [];

for (const file of walk(SRC)) {
  const rel = REL(file);
  if (rel.startsWith("src/components/ui/")) continue; // shadcn wrappers OK

  const text = readFileSync(file, "utf8");
  if (!PAT.test(text)) continue;

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (PAT.test(lines[i])) {
      hits.push(`${rel}:${i + 1}: ${lines[i].trim()}`);
      failed = true;
    }
  }
}

if (failed) {
  console.error("[no-native-select] FAIL — use shadcn <Select> / <Textarea> instead:");
  for (const h of hits) console.error("  " + h);
  process.exit(1);
}
console.log("[no-native-select] OK — no native <select>/<textarea> outside components/ui/.");
```

- [ ] **Step 2: Sanity-run**

```bash
chmod +x apps/web/scripts/check-no-native-select.mjs
node apps/web/scripts/check-no-native-select.mjs
```

Expected: `[no-native-select] OK …` because Task 5 already migrated CompareToolbar.

- [ ] **Step 3: Hold commit**

---

## Task 14: CI guard — `check-no-confirm.mjs`

**Files:**
- Create: `apps/web/scripts/check-no-confirm.mjs`

- [ ] **Step 1: Write the script**

Create `apps/web/scripts/check-no-confirm.mjs`:

```js
#!/usr/bin/env node
// Forbids window.confirm / window.alert — use AlertDialog instead.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, "..", "src");
const REL = (p) => relative(resolve(here, ".."), p).replaceAll("\\", "/");
const PAT = /\bwindow\.(confirm|alert)\(/;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules") continue;
      yield* walk(p);
    } else if (st.isFile() && (p.endsWith(".ts") || p.endsWith(".tsx"))) {
      yield p;
    }
  }
}

let failed = false;
const hits = [];

for (const file of walk(SRC)) {
  const text = readFileSync(file, "utf8");
  if (!PAT.test(text)) continue;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (PAT.test(lines[i])) {
      hits.push(`${REL(file)}:${i + 1}: ${lines[i].trim()}`);
      failed = true;
    }
  }
}

if (failed) {
  console.error("[no-confirm] FAIL — use AlertDialog instead of window.confirm/alert:");
  for (const h of hits) console.error("  " + h);
  process.exit(1);
}
console.log("[no-confirm] OK — no window.confirm/alert in source.");
```

- [ ] **Step 2: Sanity-run**

```bash
chmod +x apps/web/scripts/check-no-confirm.mjs
node apps/web/scripts/check-no-confirm.mjs
```

Expected: `[no-confirm] OK …`.

- [ ] **Step 3: Hold commit**

---

## Task 15: CI guard — `check-no-handcrafted-popover-list.mjs` (warn-only)

**Files:**
- Create: `apps/web/scripts/check-no-handcrafted-popover-list.mjs`

This one is informational — exits 0 even when it finds matches, so a noisy false-positive list won't break PRs. Promote to fail later if signal is good.

- [ ] **Step 1: Write the script**

Create `apps/web/scripts/check-no-handcrafted-popover-list.mjs`:

```js
#!/usr/bin/env node
// Warn-only: detects co-occurrence of <Popover, <Input, and <ul in features/.
// Signals a likely hand-rolled searchable dropdown that should use <Combobox>.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const FEATURES = resolve(here, "..", "src", "features");
const REL = (p) => relative(resolve(here, ".."), p).replaceAll("\\", "/");

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "__tests__") continue;
      yield* walk(p);
    } else if (st.isFile() && p.endsWith(".tsx")) {
      yield p;
    }
  }
}

const hits = [];
for (const file of walk(FEATURES)) {
  const text = readFileSync(file, "utf8");
  if (text.includes("<Popover") && text.includes("<Input") && text.includes("<ul")) {
    hits.push(REL(file));
  }
}

if (hits.length) {
  console.warn("[no-handcrafted-popover-list] suspected hand-rolled searchable dropdowns:");
  for (const h of hits) console.warn("  " + h);
  console.warn("Consider replacing with <Combobox> from components/ui/combobox.tsx.");
}
// Always exit 0 — warning only.
```

- [ ] **Step 2: Sanity-run**

```bash
chmod +x apps/web/scripts/check-no-handcrafted-popover-list.mjs
node apps/web/scripts/check-no-handcrafted-popover-list.mjs
```

Expected: no warnings (Task 3 removed the only match — `PrefillFromTemplatePopover`). If the script prints any file, double-check that file is intentional or refactor it.

- [ ] **Step 3: Hold commit**

---

## Task 16: Wire scripts into pnpm scripts and root `pnpm lint`

**Files:**
- Modify: `apps/web/package.json` (`scripts` block)
- Modify: `package.json` (root `lint` script)

- [ ] **Step 1: Update `apps/web/package.json` scripts**

In the `scripts` block, add:

```json
    "check:i18n": "node scripts/check-i18n-parity.mjs && node scripts/check-no-hardcoded-zh.mjs",
    "check:components": "node scripts/check-no-native-select.mjs && node scripts/check-no-confirm.mjs && node scripts/check-no-handcrafted-popover-list.mjs",
    "lint": "biome check src && pnpm check:i18n && pnpm check:components",
```

(Replace the existing `"lint": "biome check src"` with the new chained version.)

- [ ] **Step 2: Verify `apps/web` lint chain**

```bash
pnpm -F @modeldoctor/web lint
```

Expected: biome OK + check:i18n OK + check:components OK (warn-only popover script may print warnings without failing).

- [ ] **Step 3: Verify root pnpm lint picks it up**

The root `package.json`'s lint script is already `pnpm -r --if-present lint`, which will fan out to `@modeldoctor/web` and run the chained command. No root-level change needed.

```bash
pnpm lint
```

Expected: PASS.

- [ ] **Step 4: Commit (bundles Tasks 11-16)**

```bash
git add \
  apps/web/scripts/check-i18n-parity.mjs \
  apps/web/scripts/check-no-hardcoded-zh.mjs \
  apps/web/scripts/check-no-native-select.mjs \
  apps/web/scripts/check-no-confirm.mjs \
  apps/web/scripts/check-no-handcrafted-popover-list.mjs \
  apps/web/package.json
git commit -m "$(cat <<'EOF'
build(web): add CI guards for i18n & component reuse

Five mjs guards under apps/web/scripts/ enforce project-standards
§11.7 + §12.7: zh/en key parity, no hardcoded CJK in source, no
native <select>/<textarea>, no window.confirm/alert, and a warn-only
detector for hand-rolled searchable popovers. Wired into
apps/web's lint script so root `pnpm lint` runs them on every PR.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: Final verification + push

**Files:**
- None (verification only)

- [ ] **Step 1: Full type-check across workspace**

```bash
pnpm -r --if-present type-check
```

Expected: PASS for contracts, tool-adapters, web, api.

- [ ] **Step 2: Full unit-test run**

```bash
pnpm -r --if-present test
```

Expected: all PASS. Pay attention to PrefillFromTemplatePopover (4 tests), CompareToolbar/BenchmarkComparePage (variable count), insights tests.

- [ ] **Step 3: Full lint chain**

```bash
pnpm lint
```

Expected: biome PASS, check:i18n PASS, check:components PASS.

- [ ] **Step 4: Browser smoke test**

```bash
pnpm dev
```

Manual checklist (open in browser):
- `/benchmarks/new?scenario=inference` → click "Prefill from template" → list opens, search filters, click an option → form prefilled, popover closes
- `/benchmarks/compare?ids=…` → baseline dropdown lists runs + "None" option → switching baseline updates the table
- `/insights/<connection>` → switch range to "近 7 天 / Last 7 days" → page re-fetches; sev labels in findings list use t()'d text in current locale; switch zh ↔ en, no残留
- Switch to dark theme on `/playground/image?mode=generate` → textarea & empty card edges are visible
- Switch back to light → no visual regression

Take 2 screenshots (image-generate light + dark) for the PR description.

- [ ] **Step 5: Stop dev server, commit log review**

```bash
# Stop the dev server (Ctrl-C the pnpm dev shell)
git log --oneline origin/main..HEAD
```

Expected: 8 commits — 2 spec docs (already on branch) + 6 implementation commits matching spec §5.

- [ ] **Step 6: Push branch + open PR**

```bash
git push -u origin feat/i18n-and-component-standards
gh pr create --title "feat(web): i18n + component-reuse standards (audit + guards + dark border fix)" --body "$(cat <<'EOF'
## Summary

Single-PR rollout of the i18n + component-reuse standards work. See `docs/superpowers/specs/2026-05-08-i18n-and-component-standards-design.md` for the full spec; per-commit slicing is the spec's §5 table.

## Changes

- **`docs/project-standards.md` §11 / §12** — codified i18n rules (t() everywhere, ns per feature, zh/en parity, CJK guard) and component-reuse rules (Combobox / Select / AlertDialog / sonner / lucide, no hand-rolled popover-lists)
- **`components/ui/combobox.tsx`** — new shadcn Combobox primitive (Popover + cmdk)
- **Dropdown unification** — `PrefillFromTemplatePopover` rewritten on Combobox; `CompareToolbar` migrated to shadcn Select; tests updated for cmdk / Radix portal roles
- **i18n migration** — insights severity labels (FindingsCard, AiDiagnosisCard) and range labels (InsightsDetailPage) moved to locales; zh-CN/en-US 1:1; comments translated to English in 4 unrelated files; `deployment-recipes/data.ts` carve-out documented
- **Dark border fix** — `.dark --border` / `--input` raised from `220 8% 14%` to `220 8% 24%` for visible textarea/card outlines
- **CI guards** — 5 mjs scripts under `apps/web/scripts/`: i18n parity, no hardcoded CJK, no native select/textarea, no `window.confirm/alert`, warn-only hand-rolled popover-list detector. Wired into `pnpm lint`.

## Screenshots

- (attach light + dark of `/playground/image?mode=generate`)

## Test plan

- [x] `pnpm -r --if-present type-check`
- [x] `pnpm -r --if-present test`
- [x] `pnpm lint` (incl. new check:i18n + check:components)
- [x] Manual: PrefillFromTemplate / CompareToolbar / InsightsDetailPage zh↔en / dark mode visibility

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 7: Verify CI signals**

```bash
gh pr view --json number,url
PR=$(gh pr view --json number -q .number)
gh pr checks $PR
```

If pending, watch:
```bash
gh run list --branch feat/i18n-and-component-standards --limit 5
gh run watch <run-id> --exit-status
```

Surface any failures back to the user. Do not declare done before checks are green.

---

## Self-Review Notes (for the implementer)

- Tasks 3-6 are bundled into a single commit even though they're 4 task headers in this plan — that's intentional per spec §5.
- Tasks 7-9 likewise share one commit; Tasks 11-16 share one commit. Task headers help organize work, commits group atomic changes.
- If Task 6 finds zero test changes needed, omit `BenchmarkComparePage.test.tsx` from the commit's `git add`.
- The carve-out comment in Task 9 has a placeholder `#<deployment-recipes-i18n-issue>`. If file an issue ahead of time, substitute the number; otherwise commit with the placeholder and call it out in the PR description.
- The dark `--border` value (24%) is a starting point — visual verification in Task 10 may justify 22% or 26%. Adjust before commit; do not push 14%.
