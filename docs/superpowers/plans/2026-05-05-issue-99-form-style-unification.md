# Form Style Unification (#99) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate all 4 creation forms (BenchmarkCreatePage, TemplateCreatePage/EditPage/Form, ConnectionDialog, SetBaselineDialog) onto a unified shadcn `<Form>` + `<FormField>` + `<FormMessage>` stack with `mode: "onTouched"`, required asterisks via `<FormLabel required>`, and zod errorMap-based i18n validation messages.

**Architecture:** One `feat/issue-99-form-unification` branch, 7 phase-per-commit checkpoints (one PR). Phase 1 lays infrastructure (`<FormSection>`, `<FormActions>`, `<FormLabel required>`, `FormMessage` i18n fallback, zod errorMap, `common.validation` namespace, `zod-i18n.test.ts`). Phases 2–5 migrate each form. Phase 6 adds asterisks to existing `<Form>`-based auth pages. Phase 7 sweeps `features/*/schema.ts` to replace hardcoded English `.refine` messages with `validation.*` i18n keys.

**Tech Stack:** React 18 + react-hook-form + @hookform/resolvers/zod + zod 3 + i18next + shadcn/ui (Radix) + Tailwind + Vitest 1.

**Worktree:** `/Users/fangyong/vllm/modeldoctor/feat-issue-99-form-unification/` — already created on branch `feat/issue-99-form-unification` from `main`.

**Spec:** `docs/superpowers/specs/2026-05-05-issue-99-form-style-unification-design.md`

**Pre-flight:** `pnpm -r build` once before first run (per `project_worktree_build_first` memory — fresh worktree's `packages/*/dist` is empty).

---

## File Map

### New files

| Path | Responsibility |
|------|----------------|
| `apps/web/src/components/common/form-section.tsx` | Bordered card section wrapper with optional title/description |
| `apps/web/src/components/common/form-actions.tsx` | Right-aligned cancel + submit button group, page + dialog use |
| `apps/web/src/lib/__tests__/zod-i18n.test.ts` | Validates errorMap routes zod issues through i18n |

### Modified files

| Path | Change |
|------|--------|
| `apps/web/src/components/ui/form.tsx` | `FormLabel` accepts `required?: boolean`; `FormMessage` resolves `validation.*` keys via `i18n.t()` |
| `apps/web/src/lib/i18n.ts` | Register `z.setErrorMap` |
| `apps/web/src/locales/zh-CN/common.json` | Add `validation` namespace |
| `apps/web/src/locales/en-US/common.json` | Add `validation` namespace |
| `apps/web/src/features/benchmarks/BenchmarkCreatePage.tsx` | Migrate to `<Form>`, `mode: "onTouched"`, `<FormSection>`, `<FormActions>` |
| `apps/web/src/features/benchmark-templates/TemplateForm.tsx` | Migrate fields to `<FormField>` + `<FormMessage>` |
| `apps/web/src/features/benchmark-templates/TemplateCreatePage.tsx` | `mode: "onTouched"`, `<FormActions>`, `<Form>` provider |
| `apps/web/src/features/benchmark-templates/TemplateEditPage.tsx` | `mode: "onTouched"`, `<FormActions>`, `<Form>` provider |
| `apps/web/src/features/connections/ConnectionDialog.tsx` | Migrate to `<Form>` + `<FormField>`, single `<FormSection>` wrapper, `mode: "onTouched"` |
| `apps/web/src/features/connections/schema.ts` | Replace English `.refine` messages with `validation.*` keys |
| `apps/web/src/features/benchmarks/SetBaselineDialog.tsx` | Migrate from useState to useForm + `<FormField>` + `<FormMessage>`, add inline schema |
| `apps/web/src/features/auth/LoginPage.tsx` | Add `required` on email + password `<FormLabel>` |
| `apps/web/src/features/auth/RegisterPage.tsx` | Add `required` on email + password `<FormLabel>` |
| `apps/web/src/features/benchmarks/__tests__/BenchmarkCreatePage.test.tsx` | Add asterisk + on-blur tests |
| `apps/web/src/features/benchmark-templates/__tests__/TemplateCreatePage.test.tsx` | Add asterisk + on-blur tests |
| `apps/web/src/features/connections/ConnectionDialog.test.tsx` | Add asterisk + on-blur tests |
| `apps/web/src/features/benchmarks/__tests__/SetBaselineDialog.test.tsx` (new) | Required-field validation + submit-disable behaviour |

### Out of scope

- `@modeldoctor/contracts` shared schemas: untouched — server side has no errorMap, so custom `.refine` messages there stay English.
- Lists / detail pages.
- Schemas in features other than `connections` (none have hardcoded English `.refine` after grep).

---

## Pre-flight

- [ ] **Run once before any task in this plan:**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat-issue-99-form-unification
pnpm -r build
```

Expected: builds `@modeldoctor/contracts`, `@modeldoctor/tool-adapters`, etc. Without this, `apps/api` typecheck (and any cross-package import) fails.

- [ ] **Verify clean baseline:**

```bash
pnpm -F @modeldoctor/web test --run
pnpm -F @modeldoctor/web typecheck
pnpm -F @modeldoctor/web lint
```

Expected: all pass on `main`'s state.

---

## Phase 1: Infrastructure

### Task 1.1: Add `validation` namespace to common.json

**Files:** Modify `apps/web/src/locales/zh-CN/common.json`, `apps/web/src/locales/en-US/common.json`

- [ ] **Step 1: Add validation namespace to zh-CN**

In `apps/web/src/locales/zh-CN/common.json`, after the `errors` block, add a sibling top-level key. Final file shape:

```json
{
  "appName": "ModelDoctor",
  …existing keys…,
  "errors": {
    "unknown": "未知错误",
    "network": "网络错误",
    "required": "此项必填"
  },
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
}
```

- [ ] **Step 2: Mirror in en-US**

In `apps/web/src/locales/en-US/common.json`:

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

- [ ] **Step 3: Sanity-check JSON parses**

```bash
node -e "JSON.parse(require('fs').readFileSync('apps/web/src/locales/zh-CN/common.json','utf8'))"
node -e "JSON.parse(require('fs').readFileSync('apps/web/src/locales/en-US/common.json','utf8'))"
```

Expected: both exit 0 silently.

### Task 1.2: Register zod errorMap

**Files:** Modify `apps/web/src/lib/i18n.ts`

- [ ] **Step 1: Append errorMap registration**

Add at the bottom of `apps/web/src/lib/i18n.ts`, after the `init({…})` call:

```ts
import { z } from "zod";

z.setErrorMap((issue, ctx) => {
  // 1) Custom .refine message that is an i18n key (convention: starts with "validation.")
  if (typeof issue.message === "string" && issue.message.startsWith("validation.")) {
    const translated = i18n.t(issue.message, { ns: "common", defaultValue: "" });
    if (translated) return { message: translated };
  }

  // 2) Map zod built-in issue codes through common.validation.*
  switch (issue.code) {
    case "invalid_type": {
      if (issue.received === "undefined") {
        return { message: i18n.t("validation.required", { ns: "common" }) };
      }
      return { message: i18n.t("validation.invalidType", { ns: "common" }) };
    }
    case "too_small": {
      if (issue.type === "string") {
        if (issue.minimum === 1) {
          return { message: i18n.t("validation.required", { ns: "common" }) };
        }
        return {
          message: i18n.t("validation.tooShort", { ns: "common", min: issue.minimum }),
        };
      }
      return {
        message: i18n.t("validation.tooSmall", { ns: "common", min: issue.minimum }),
      };
    }
    case "too_big": {
      if (issue.type === "string") {
        return { message: i18n.t("validation.tooLong", { ns: "common", max: issue.maximum }) };
      }
      return { message: i18n.t("validation.tooBig", { ns: "common", max: issue.maximum }) };
    }
    case "invalid_string": {
      if (issue.validation === "email")
        return { message: i18n.t("validation.invalidEmail", { ns: "common" }) };
      if (issue.validation === "url")
        return { message: i18n.t("validation.invalidUrl", { ns: "common" }) };
      if (issue.validation === "regex")
        return { message: i18n.t("validation.invalidFormat", { ns: "common" }) };
      return { message: ctx.defaultError };
    }
    case "invalid_enum_value":
      return { message: i18n.t("validation.invalidEnum", { ns: "common" }) };
    default:
      return { message: ctx.defaultError };
  }
});
```

`zod` is already a transitive dep of `@modeldoctor/contracts`; verify it imports cleanly:

```bash
pnpm -F @modeldoctor/web exec tsc --noEmit src/lib/i18n.ts
```

Expected: no errors. If TS complains zod isn't directly listed, add it to `apps/web/package.json` `dependencies` (matching the version contracts uses) — but the existing `import { z } from "zod"` in `apps/web/src/features/connections/schema.ts` proves it resolves; this should be a no-op.

### Task 1.3: Write zod-i18n test

**Files:** Create `apps/web/src/lib/__tests__/zod-i18n.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import i18n from "@/lib/i18n";
import { describe, expect, it, beforeEach } from "vitest";
import { z } from "zod";

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN");
});

describe("zod errorMap → i18n", () => {
  it("translates required (string min 1) in zh-CN", () => {
    const result = z.string().min(1).safeParse("");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("此项为必填");
    }
  });

  it("translates required (undefined) in zh-CN", () => {
    const result = z.string().safeParse(undefined);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("此项为必填");
    }
  });

  it("translates email in zh-CN", () => {
    const result = z.string().email().safeParse("not-an-email");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("邮箱格式不正确");
    }
  });

  it("translates url in zh-CN", () => {
    const result = z.string().url().safeParse("nope");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("URL 格式不正确");
    }
  });

  it("interpolates min/max in tooShort/tooLong", () => {
    const short = z.string().min(3).safeParse("a");
    expect(short.success).toBe(false);
    if (!short.success) expect(short.error.issues[0].message).toBe("至少需要 3 个字符");

    const long = z.string().max(2).safeParse("abcd");
    expect(long.success).toBe(false);
    if (!long.success) expect(long.error.issues[0].message).toBe("最多 2 个字符");
  });

  it("switches to en-US after changeLanguage", async () => {
    await i18n.changeLanguage("en-US");
    const result = z.string().min(1).safeParse("");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("This field is required");
    }
  });

  it("custom .refine message that is a validation.* key gets translated", () => {
    const schema = z.string().refine(() => false, { message: "validation.invalidUrl" });
    const result = schema.safeParse("anything");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toBe("URL 格式不正确");
  });

  it("unknown validation.* key falls back to the raw key string", () => {
    const schema = z.string().refine(() => false, { message: "validation.notInCommonJson" });
    const result = schema.safeParse("anything");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toBe("validation.notInCommonJson");
  });
});
```

- [ ] **Step 2: Run and verify it passes**

```bash
pnpm -F @modeldoctor/web test --run src/lib/__tests__/zod-i18n.test.ts
```

Expected: 8 tests pass.

If any test fails, the errorMap mapping needs tightening — the most likely cause is `errors.required` ("此项必填") vs `validation.required` ("此项为必填") mismatch. The test asserts the **new** `validation.required` string.

### Task 1.4: Patch `FormLabel` to accept `required` prop

**Files:** Modify `apps/web/src/components/ui/form.tsx`

- [ ] **Step 1: Replace the `FormLabel` definition**

Find the existing `FormLabel` block (lines 82–97 of `form.tsx`) and replace with:

```tsx
const FormLabel = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & { required?: boolean }
>(({ className, children, required, ...props }, ref) => {
  const { error, formItemId } = useFormField();

  return (
    <Label
      ref={ref}
      className={cn(error && "text-destructive", className)}
      htmlFor={formItemId}
      {...props}
    >
      {children}
      {required ? (
        <span aria-hidden="true" className="ml-0.5 text-destructive">
          *
        </span>
      ) : null}
    </Label>
  );
});
FormLabel.displayName = "FormLabel";
```

### Task 1.5: Patch `FormMessage` to resolve `validation.*` keys

**Files:** Modify `apps/web/src/components/ui/form.tsx`

- [ ] **Step 1: Add i18n import at top of file**

After existing imports, add:

```ts
import i18n from "@/lib/i18n";
```

- [ ] **Step 2: Replace the `FormMessage` body**

Find the existing `FormMessage` block (lines 134–156 of `form.tsx`) and replace the `body` calculation:

```tsx
const FormMessage = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, children, ...props }, ref) => {
  const { error, formMessageId } = useFormField();
  const raw = error ? String(error?.message ?? "") : "";
  const body = error
    ? raw.startsWith("validation.")
      ? i18n.t(raw, { ns: "common", defaultValue: raw })
      : raw
    : children;

  if (!body) {
    return null;
  }

  return (
    <p
      ref={ref}
      id={formMessageId}
      className={cn("text-[0.8rem] font-medium text-destructive", className)}
      {...props}
    >
      {body}
    </p>
  );
});
FormMessage.displayName = "FormMessage";
```

(This is a fallback — most paths already get translated by the errorMap; FormMessage covers cases where a `.refine` was added without going through errorMap, e.g. raw `messages` set directly on rhf via `setError`.)

### Task 1.6: Create `<FormSection>`

**Files:** Create `apps/web/src/components/common/form-section.tsx`

- [ ] **Step 1: Write the file**

```tsx
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface FormSectionProps {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

/**
 * Standard creation-form section wrapper. Renders a bordered card with an
 * optional small-caps title + description, then form fields below. Used by
 * both page-style (multi-section) and dialog-style (typically single section)
 * creation forms.
 */
export function FormSection({ title, description, children, className }: FormSectionProps) {
  return (
    <section className={cn("rounded-lg border border-border bg-card p-4 space-y-3", className)}>
      {title ? (
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h2>
      ) : null}
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      {children}
    </section>
  );
}
```

### Task 1.7: Create `<FormActions>`

**Files:** Create `apps/web/src/components/common/form-actions.tsx`

- [ ] **Step 1: Write the file**

```tsx
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface FormActionsProps {
  onCancel?: () => void;
  cancelLabel?: string;
  submitLabel: string;
  /** Disabled state for the submit button (e.g. !formState.isValid) */
  disabled?: boolean;
  /** Pending state from a mutation; renders "…" inside the submit button */
  pending?: boolean;
  className?: string;
  /** Extra leading content (e.g. a destructive Delete button on edit pages) */
  leading?: React.ReactNode;
}

/**
 * Standard creation/edit form footer: right-aligned Cancel + Submit pair.
 * Used both inside `<form>` (page mode) and inside `<DialogFooter>` (dialog
 * mode). The dialog wrapper provides its own border + padding, so we don't
 * add any here.
 */
export function FormActions({
  onCancel,
  cancelLabel,
  submitLabel,
  disabled,
  pending,
  className,
  leading,
}: FormActionsProps) {
  return (
    <div className={cn("flex justify-end gap-2", className)}>
      {leading}
      {onCancel ? (
        <Button type="button" variant="outline" onClick={onCancel}>
          {cancelLabel ?? "Cancel"}
        </Button>
      ) : null}
      <Button type="submit" disabled={disabled || pending}>
        {pending ? "…" : submitLabel}
      </Button>
    </div>
  );
}
```

### Task 1.8: Verify infrastructure + commit

- [ ] **Step 1: Run typecheck + tests**

```bash
pnpm -F @modeldoctor/web typecheck
pnpm -F @modeldoctor/web test --run
pnpm -F @modeldoctor/web lint
```

Expected: all pass. If existing tests fail because `FormMessage` now imports `i18n.ts` whose errorMap registration runs at module load, that's expected and harmless (any test that was relying on raw zod issues will now see translated strings — fix by updating the assertion or, in rare cases, awaiting `i18n.changeLanguage`).

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/ui/form.tsx \
        apps/web/src/components/common/form-section.tsx \
        apps/web/src/components/common/form-actions.tsx \
        apps/web/src/lib/i18n.ts \
        apps/web/src/lib/__tests__/zod-i18n.test.ts \
        apps/web/src/locales/zh-CN/common.json \
        apps/web/src/locales/en-US/common.json
git commit -m "$(cat <<'EOF'
feat(web): form unification infra — FormSection, FormActions, FormLabel required, zod i18n errorMap (#99)

- New components/common/{form-section,form-actions}.tsx
- FormLabel accepts `required` prop (renders red asterisk)
- FormMessage falls back to i18n.t() for `validation.*` keys
- z.setErrorMap routes built-in zod issues through common.validation.* (zh-CN + en-US)
- New lib/__tests__/zod-i18n.test.ts (8 cases, both locales)

Refs #99

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2: Migrate `BenchmarkCreatePage`

Spec ref: § 统一表单架构 / 页面式 + § 风险 4 (controlled fields).

### Task 2.1: Update existing test to assert new layout

**Files:** Modify `apps/web/src/features/benchmarks/__tests__/BenchmarkCreatePage.test.tsx`

- [ ] **Step 1: Read current test**

```bash
cat apps/web/src/features/benchmarks/__tests__/BenchmarkCreatePage.test.tsx
```

- [ ] **Step 2: Append new test cases at the bottom of the existing `describe("BenchmarkCreatePage", …)` block**

```ts
  it("renders red asterisk on required Connection / Name labels", () => {
    render(<BenchmarkCreatePage />, { wrapper: Wrapper });
    // <FormLabel required> renders text + a span containing "*"
    const labels = screen.getAllByText("*", { selector: "span" });
    expect(labels.length).toBeGreaterThanOrEqual(2); // connection + name
  });

  it("shows required error under Name when blurred while empty", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(<BenchmarkCreatePage />, { wrapper: Wrapper });
    const nameInput = screen.getByLabelText(/Name/i);
    await user.click(nameInput);
    await user.tab();
    expect(await screen.findByText(/required/i)).toBeInTheDocument();
  });
```

- [ ] **Step 3: Run; expect 2 new failures**

```bash
pnpm -F @modeldoctor/web test --run src/features/benchmarks/__tests__/BenchmarkCreatePage.test.tsx
```

Expected: 2 new tests fail (asterisk not rendered, no FormMessage on blur). Pre-existing tests still pass.

### Task 2.2: Migrate `BenchmarkCreatePage` to `<Form>` + `<FormField>` + `mode: "onTouched"` + `<FormSection>` + `<FormActions>`

**Files:** Modify `apps/web/src/features/benchmarks/BenchmarkCreatePage.tsx`

- [ ] **Step 1: Replace the file body**

Replace `apps/web/src/features/benchmarks/BenchmarkCreatePage.tsx` entirely with:

```tsx
import { FormActions } from "@/components/common/form-actions";
import { FormSection } from "@/components/common/form-section";
import { PageHeader } from "@/components/common/page-header";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useConnections } from "@/features/connections/queries";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  type CreateBenchmarkRequest,
  type ScenarioId,
  createBenchmarkRequestSchema,
  scenarioIdSchema,
} from "@modeldoctor/contracts";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { TOOL_DEFAULTS, ToolParamsEditor } from "./forms/ToolParamsEditor";
import { useCreateBenchmark } from "./queries";
import { SCENARIOS } from "./scenarios";

function SavedConnectionPicker({
  value,
  onChange,
  id,
}: {
  value: string;
  onChange: (id: string) => void;
  id?: string;
}) {
  const { t } = useTranslation("connections");
  const { data: connections, isLoading } = useConnections();

  return (
    <Select value={value || "__none__"} onValueChange={(v) => onChange(v === "__none__" ? "" : v)}>
      <SelectTrigger id={id} aria-label="Connection">
        <SelectValue
          placeholder={
            isLoading
              ? "Loading…"
              : t("picker.placeholder", { defaultValue: "Select a connection" })
          }
        />
      </SelectTrigger>
      <SelectContent>
        {(connections ?? []).map((conn) => (
          <SelectItem key={conn.id} value={conn.id}>
            {conn.name} — {conn.baseUrl}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function BenchmarkCreatePage() {
  const { t } = useTranslation("benchmarks");
  const { t: tc } = useTranslation("common");
  const navigate = useNavigate();
  const createMut = useCreateBenchmark();

  const [params] = useSearchParams();
  const scenarioParam = params.get("scenario");
  const scenarioParse = scenarioIdSchema.safeParse(scenarioParam);
  const scenario: ScenarioId = scenarioParse.success ? scenarioParse.data : "inference";
  const defaultTool = SCENARIOS[scenario].tools[0];

  const form = useForm<CreateBenchmarkRequest>({
    resolver: zodResolver(createBenchmarkRequestSchema),
    mode: "onTouched",
    defaultValues: {
      tool: defaultTool,
      scenario,
      connectionId: "",
      name: "",
      description: undefined,
      params: TOOL_DEFAULTS[defaultTool] as Record<string, unknown>,
    },
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: form is stable, defaultTool is derived from scenario
  useEffect(() => {
    form.reset({
      tool: defaultTool,
      scenario,
      connectionId: "",
      name: "",
      description: undefined,
      params: TOOL_DEFAULTS[defaultTool] as Record<string, unknown>,
    });
  }, [scenario]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const body: CreateBenchmarkRequest = { ...values, scenario };
      const benchmark = await createMut.mutateAsync(body);
      toast.success(t("create.submitted", { name: benchmark.name }));
      navigate(`/benchmarks/${benchmark.id}`);
    } catch (e) {
      const err = e as { code?: string; message?: string; status?: number };
      toast.error(err.message ?? t("create.errors.submitFailed"));
    }
  });

  return (
    <>
      <PageHeader title={t("create.title")} subtitle={t("create.subtitle")} />
      <div className="mx-auto max-w-3xl space-y-6 px-8 py-6">
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-6">
            <FormSection title={t("create.sections.endpoint")}>
              <FormField
                control={form.control}
                name="connectionId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>
                      {t("create.fields.connection", { defaultValue: "Connection" })}
                    </FormLabel>
                    <FormControl>
                      <SavedConnectionPicker
                        value={field.value ?? ""}
                        onChange={(next) =>
                          form.setValue("connectionId", next, { shouldValidate: true })
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </FormSection>

            <ToolParamsEditor scenario={scenario} />

            <FormSection title={t("create.sections.metadata")}>
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t("create.fields.name")}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("create.fields.description")}</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={2}
                        {...field}
                        value={field.value ?? ""}
                        onChange={(e) =>
                          field.onChange(e.target.value === "" ? undefined : e.target.value)
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </FormSection>

            <FormActions
              onCancel={() => navigate("/benchmarks")}
              cancelLabel={tc("actions.cancel")}
              submitLabel={t("actions.submit")}
              disabled={!form.formState.isValid}
              pending={createMut.isPending}
            />
          </form>
        </Form>
      </div>
    </>
  );
}
```

Notes:
- `mode: "onTouched"` triggers schema validation per field after first blur, then onChange.
- Connection picker uses `setValue(..., { shouldValidate: true })` because Radix Select doesn't fire native blur (per spec § 风险 4).
- `description` setValueAs is replaced by an inline `onChange` that maps `""` → `undefined`, since `<FormField>` controls the field via `field.value`.

- [ ] **Step 2: Run all BenchmarkCreatePage tests**

```bash
pnpm -F @modeldoctor/web test --run src/features/benchmarks/__tests__/BenchmarkCreatePage.test.tsx
```

Expected: all pass (including the 2 new ones from Task 2.1).

If `i18n` is missing the key `create.fields.connection` in the benchmarks namespace, the existing `defaultValue: "Connection"` covers it.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/benchmarks/BenchmarkCreatePage.tsx \
        apps/web/src/features/benchmarks/__tests__/BenchmarkCreatePage.test.tsx
git commit -m "$(cat <<'EOF'
feat(web/benchmarks): migrate BenchmarkCreatePage to unified Form stack (#99)

- mode: "onTouched" + <FormField>/<FormMessage>
- Required asterisks via <FormLabel required>
- <FormSection> + <FormActions> for layout consistency

Refs #99

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3: Migrate `TemplateForm` + `TemplateCreatePage` + `TemplateEditPage`

### Task 3.1: Migrate `TemplateForm` fields to `<FormField>`

**Files:** Modify `apps/web/src/features/benchmark-templates/TemplateForm.tsx`

- [ ] **Step 1: Replace the file body**

Replace `apps/web/src/features/benchmark-templates/TemplateForm.tsx` entirely with:

```tsx
import { FormSection } from "@/components/common/form-section";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TOOL_DEFAULTS, ToolParamsEditor } from "@/features/benchmarks/forms/ToolParamsEditor";
import { SCENARIOS, type ScenarioId } from "@/features/benchmarks/scenarios";
import type { ToolName } from "@modeldoctor/tool-adapters/schemas";
import { useId } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";

export interface TemplateFormProps {
  mode: "create" | "edit-owner" | "edit-readonly";
  isAdmin: boolean;
  displayScenario?: ScenarioId;
  displayTool?: ToolName;
}

export function TemplateForm({ mode, isAdmin, displayScenario, displayTool }: TemplateFormProps) {
  const { t } = useTranslation("benchmark-templates");
  const { control, reset, getValues, register } = useFormContext();
  const id = useId();
  const tagsId = `${id}-tags`;
  const scenarioId = `${id}-scenario`;
  const officialId = `${id}-official`;

  const formScenario = (useWatch({ control, name: "scenario" }) ?? "inference") as
    | ScenarioId
    | undefined;
  const scenario =
    mode === "create" ? (formScenario ?? "inference") : (displayScenario ?? "inference");
  const disableScenarioTool = mode !== "create";
  const disableAll = mode === "edit-readonly";

  function handleScenarioChange(next: ScenarioId) {
    const nextTool = SCENARIOS[next].tools[0];
    reset({
      ...getValues(),
      scenario: next,
      tool: nextTool,
      config: TOOL_DEFAULTS[nextTool] as Record<string, unknown>,
    });
  }

  return (
    <div className="space-y-6">
      <FormSection title={t("create.sections.basic")}>
        <FormField
          control={control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel required>{t("create.fields.name")}</FormLabel>
              <FormControl>
                <Input
                  placeholder={t("create.fields.namePlaceholder")}
                  disabled={disableAll}
                  {...field}
                  value={field.value ?? ""}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("create.fields.description")}</FormLabel>
              <FormControl>
                <Textarea
                  rows={2}
                  disabled={disableAll}
                  {...field}
                  value={field.value ?? ""}
                  onChange={(e) =>
                    field.onChange(e.target.value === "" ? undefined : e.target.value)
                  }
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="space-y-2">
          <Label htmlFor={tagsId}>{t("create.fields.tags")}</Label>
          <Input
            id={tagsId}
            placeholder={t("create.fields.tagsPlaceholder")}
            disabled={disableAll}
            {...register("tags", {
              setValueAs: (v) =>
                typeof v === "string"
                  ? v
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean)
                  : (v ?? []),
            })}
          />
        </div>
      </FormSection>

      <FormSection title={t("create.sections.scenario")}>
        <div className="max-w-xs space-y-2">
          <Label htmlFor={scenarioId}>{t("create.fields.scenario")}</Label>
          {disableScenarioTool ? (
            <div className="flex h-10 items-center rounded-md border border-input bg-muted px-3 text-sm">
              {t(`list.tabs.${scenario}`)}
            </div>
          ) : (
            <Select value={scenario} onValueChange={(v) => handleScenarioChange(v as ScenarioId)}>
              <SelectTrigger id={scenarioId} aria-label="Scenario">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["inference", "capacity", "gateway"] as ScenarioId[]).map((sid) => (
                  <SelectItem key={sid} value={sid}>
                    {t(`list.tabs.${sid}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </FormSection>

      <ToolParamsEditor
        scenario={scenario}
        paramsFieldName="config"
        displayTool={mode !== "create" ? displayTool : undefined}
      />

      {mode === "create" && isAdmin && (
        <FormSection title={t("create.sections.official")}>
          <label htmlFor={officialId} className="flex items-center gap-2 text-sm">
            <input
              id={officialId}
              type="checkbox"
              className="h-4 w-4 rounded border border-primary"
              {...register("isOfficial")}
            />
            {t("create.fields.isOfficial")}
          </label>
          <p className="mt-1 text-xs text-muted-foreground">{t("create.officialHint")}</p>
        </FormSection>
      )}
    </div>
  );
}
```

**Note for the executor:** `<FormItem>`, `<FormLabel>`, `<FormControl>`, `<FormMessage>` MUST be used inside a `<FormField>` wrapper — they call `useFormField()` which throws without `FormFieldContext`. For non-validated auxiliary fields like `tags` (post-processed on submit), `scenario` (form state managed manually via `reset`), and `isOfficial` (boolean checkbox), keep bare `<Label>` + native input. Only validated user-facing fields go through `<FormField>`.

Note: `tags` and `isOfficial` keep `register` because they have non-trivial `setValueAs` / are checkboxes outside the controlled-input pattern. `name` and `description` get full `<FormField>` treatment because they're the validated user-facing fields.

### Task 3.2: Migrate `TemplateCreatePage` to `<Form>` + `mode: "onTouched"` + `<FormActions>`

**Files:** Modify `apps/web/src/features/benchmark-templates/TemplateCreatePage.tsx`

- [ ] **Step 1: Replace the file body**

```tsx
import { FormActions } from "@/components/common/form-actions";
import { PageHeader } from "@/components/common/page-header";
import { Form } from "@/components/ui/form";
import { TOOL_DEFAULTS } from "@/features/benchmarks/forms/ToolParamsEditor";
import { SCENARIOS } from "@/features/benchmarks/scenarios";
import { useAuthStore } from "@/stores/auth-store";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  type CreateBenchmarkTemplateRequest,
  type ScenarioId,
  createBenchmarkTemplateRequestSchema,
  scenarioIdSchema,
} from "@modeldoctor/contracts";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { TemplateForm } from "./TemplateForm";
import { useCreateTemplate } from "./queries";

export function TemplateCreatePage() {
  const { t } = useTranslation("benchmark-templates");
  const { t: tc } = useTranslation("common");
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const user = useAuthStore((s) => s.user);
  const isAdmin = (user?.roles ?? []).includes("admin");
  const createMut = useCreateTemplate();

  const scenarioParam = params.get("scenario");
  const scenarioParse = scenarioIdSchema.safeParse(scenarioParam);
  const scenario: ScenarioId = scenarioParse.success ? scenarioParse.data : "inference";
  const tool = SCENARIOS[scenario].tools[0];

  const form = useForm<CreateBenchmarkTemplateRequest>({
    resolver: zodResolver(createBenchmarkTemplateRequestSchema),
    mode: "onTouched",
    defaultValues: {
      name: "",
      description: undefined,
      scenario,
      tool,
      config: TOOL_DEFAULTS[tool] as Record<string, unknown>,
      isOfficial: false,
      tags: [],
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const created = await createMut.mutateAsync(values);
      toast.success(t("create.submitted", { name: created.name }));
      navigate(`/benchmark-templates?scenario=${created.scenario}`);
    } catch (e) {
      toast.error((e as Error).message ?? t("create.errors.submitFailed"));
    }
  });

  return (
    <>
      <PageHeader title={t("create.title")} subtitle={t("create.subtitle")} />
      <div className="mx-auto max-w-3xl px-8 py-6">
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-6">
            <TemplateForm mode="create" isAdmin={isAdmin} />
            <FormActions
              onCancel={() => navigate("/benchmark-templates")}
              cancelLabel={tc("actions.cancel")}
              submitLabel={t("actions.save")}
              disabled={!form.formState.isValid}
              pending={createMut.isPending}
            />
          </form>
        </Form>
      </div>
    </>
  );
}
```

### Task 3.3: Migrate `TemplateEditPage`

**Files:** Modify `apps/web/src/features/benchmark-templates/TemplateEditPage.tsx`

- [ ] **Step 1: Replace the body of the JSX return**

In `TemplateEditPage.tsx`:

1. Change `mode: "onChange"` → `mode: "onTouched"` (line ~36).
2. Replace `import { FormProvider, useForm } from "react-hook-form";` → `import { useForm } from "react-hook-form"; import { Form } from "@/components/ui/form";`.
3. Replace the `<FormProvider {...form}>…</FormProvider>` block with:

```tsx
<Form {...form}>
  <form onSubmit={onSubmit} className="space-y-6">
    <TemplateForm
      mode={mode}
      isAdmin={isAdmin}
      displayScenario={tpl.scenario}
      displayTool={tpl.tool}
    />
    <FormActions
      onCancel={() => navigate("/benchmark-templates")}
      cancelLabel={t("actions.back")}
      submitLabel={updateMut.isPending ? "…" : t("actions.save")}
      disabled={!canEdit}
      pending={updateMut.isPending}
      leading={
        canEdit ? (
          <Button
            type="button"
            variant="destructive"
            onClick={() => setConfirmingDelete(true)}
          >
            {t("actions.delete")}
          </Button>
        ) : undefined
      }
    />
  </form>
</Form>
```

4. Add the `<FormActions>` import: `import { FormActions } from "@/components/common/form-actions";`.

### Task 3.4: Update template tests for asterisk + on-blur

**Files:** Modify `apps/web/src/features/benchmark-templates/__tests__/TemplateCreatePage.test.tsx`

- [ ] **Step 1: Append two new test cases inside the existing `describe(…)` block**

```ts
  it("renders red asterisk on the required Name label", () => {
    render(<TemplateCreatePage />, { wrapper: Wrapper });
    const labels = screen.getAllByText("*", { selector: "span" });
    expect(labels.length).toBeGreaterThanOrEqual(1);
  });

  it("shows required error under Name when blurred while empty", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(<TemplateCreatePage />, { wrapper: Wrapper });
    const nameInput = screen.getByLabelText(/Name/i);
    await user.click(nameInput);
    await user.tab();
    expect(await screen.findByText(/required/i)).toBeInTheDocument();
  });
```

(If the existing test uses `Wrapper` differently, copy its existing wrapper helper — exact pattern matches Task 2.1.)

### Task 3.5: Verify + commit Phase 3

- [ ] **Step 1: Run tests**

```bash
pnpm -F @modeldoctor/web test --run \
  src/features/benchmark-templates/__tests__/TemplateCreatePage.test.tsx \
  src/features/benchmark-templates/__tests__/
```

Expected: all template tests pass.

- [ ] **Step 2: Typecheck + lint**

```bash
pnpm -F @modeldoctor/web typecheck
pnpm -F @modeldoctor/web lint
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/benchmark-templates/TemplateForm.tsx \
        apps/web/src/features/benchmark-templates/TemplateCreatePage.tsx \
        apps/web/src/features/benchmark-templates/TemplateEditPage.tsx \
        apps/web/src/features/benchmark-templates/__tests__/TemplateCreatePage.test.tsx
git commit -m "$(cat <<'EOF'
feat(web/templates): migrate TemplateForm + Create/EditPage to unified Form stack (#99)

- mode: "onTouched" everywhere; tags/isOfficial kept on register
- name/description fields use <FormField> + <FormMessage>
- <FormSection> wrapping; <FormActions> for footer (with delete button slotted via `leading`)

Refs #99

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4: Migrate `ConnectionDialog`

Spec ref: § 统一表单架构 / 弹窗式.

### Task 4.1: Rewrite `ConnectionDialog`

**Files:** Modify `apps/web/src/features/connections/ConnectionDialog.tsx`

This is the largest single file change. Keep existing logic (curl import, tag chips, edit-vs-create modes, apiKey reveal, honeypots) — only swap the per-field UI.

- [ ] **Step 1: Add `mode: "onTouched"`**

Locate the `useForm({…})` call (line ~125) and change to:

```ts
const form = useForm<ConnectionInput>({
  resolver: zodResolver(isEdit ? connectionInputEditSchema : connectionInputCreateSchema),
  mode: "onTouched",
  defaultValues: empty,
});
```

- [ ] **Step 2: Wrap with `<Form>` + replace fields**

At the imports, ensure the following are present:

```tsx
import { FormSection } from "@/components/common/form-section";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
```

Inside the existing `<form onSubmit={…}>` (line ~238), wrap with `<Form {...form}>`:

```tsx
<Form {...form}>
  <form onSubmit={onSubmit} autoComplete="off" className="flex min-h-0 flex-1 flex-col gap-4">
    {/* …honeypots… */}
    <div className="flex-1 space-y-4 overflow-y-auto pr-1">
      {/* curl <details> stays unchanged */}
      <FormSection>
        {/* All the per-field content moves inside */}
      </FormSection>
    </div>
    <DialogFooter className="border-t border-border pt-3">
      <FormActions
        onCancel={() => onOpenChange(false)}
        cancelLabel={tc("actions.cancel")}
        submitLabel={tc("actions.save")}
        pending={createMut.isPending || updateMut.isPending}
      />
    </DialogFooter>
  </form>
</Form>
```

- [ ] **Step 3: Replace each field**

For each of `name`, `apiBaseUrl`, `apiKey`, `model`, `customHeaders`, `queryParams`, `tokenizerHfId`, `category` — replace the existing `<Label>` + `<Input {...form.register("…")}>` + `{error?<p…>}` triplet with a `<FormField>` block.

Example for `name`:

```tsx
<FormField
  control={form.control}
  name="name"
  render={({ field }) => (
    <FormItem>
      <FormLabel required>{t("dialog.fields.name")}</FormLabel>
      <FormControl>
        <Input
          autoComplete="off"
          placeholder={t("dialog.fields.namePlaceholder")}
          {...field}
        />
      </FormControl>
      <FormMessage />
    </FormItem>
  )}
/>
```

Required asterisks (`<FormLabel required>`):
- `name`
- `apiBaseUrl`
- `apiKey` (only when `!apiKeyDisabled`, i.e. create mode or reset toggled — pass `required={!apiKeyDisabled}`)
- `model`
- `category`

Non-required (no `required` prop):
- `customHeaders`, `queryParams`, `tokenizerHfId`, `tags`

For `category` (uses `<Controller>` already), wrap inside `<FormField>`:

```tsx
<FormField
  control={form.control}
  name="category"
  render={({ field }) => (
    <FormItem>
      <FormLabel required>{t("dialog.fields.category")}</FormLabel>
      <FormControl>
        <Select value={field.value ?? ""} onValueChange={field.onChange}>
          <SelectTrigger aria-label={t("dialog.fields.category")}>
            <SelectValue placeholder={t("dialog.fields.categoryPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {t(`dialog.categoryOptions.${c}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormControl>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("dialog.fields.categoryHelp")}
      </p>
      <FormMessage />
    </FormItem>
  )}
/>
```

For `apiKey`, keep the show/hide toggle and the reset checkbox UI as-is, but field is now `<FormField>`:

```tsx
<FormField
  control={form.control}
  name="apiKey"
  render={({ field }) => (
    <FormItem>
      <div className="flex items-center justify-between">
        <FormLabel required={!apiKeyDisabled}>{t("dialog.fields.apiKey")}</FormLabel>
        {isEdit ? (
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={resetApiKey}
              onChange={(e) => {
                const next = e.target.checked;
                setResetApiKey(next);
                if (!next) form.setValue("apiKey", "");
              }}
            />
            {t("dialog.resetApiKey")}
          </label>
        ) : null}
      </div>
      <FormControl>
        <div className="relative">
          <Input
            autoComplete="new-password"
            type={revealKey ? "text" : "password"}
            placeholder={apiKeyPlaceholder}
            disabled={apiKeyDisabled}
            {...field}
          />
          {!apiKeyDisabled ? (
            <button
              type="button"
              onClick={() => setRevealKey((v) => !v)}
              className="absolute inset-y-0 right-2 flex items-center text-muted-foreground hover:text-foreground"
              aria-label={revealKey ? "hide" : "show"}
            >
              {revealKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          ) : null}
        </div>
      </FormControl>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("dialog.apiKeyEncryptedNotice")}
      </p>
      <FormMessage />
    </FormItem>
  )}
/>
```

`tags` is custom (chip input) — keep using `<Controller>` exactly as today, but wrap in a plain `<div>` with `<Label>` + helper text (no `<FormMessage>` since tags has no validation error path the user cares about).

Drop the manual `{form.formState.errors.X ? <p…> : null}` blocks — `<FormMessage>` replaces them.

Drop the `submitError` paragraph render at the bottom; keep the `submitError` state because some failures (duplicate name) come from the API. Render it once near the end of the section, **before** `</FormSection>`:

```tsx
{submitError ? (
  <p className="text-sm text-destructive">
    {submitError.toLowerCase().includes("exists")
      ? t("dialog.errors.duplicateName")
      : submitError}
  </p>
) : null}
```

### Task 4.2: Update `ConnectionDialog.test.tsx`

**Files:** Modify `apps/web/src/features/connections/ConnectionDialog.test.tsx`

- [ ] **Step 1: Append asterisk + on-blur cases**

```ts
  it("renders red asterisks on Name / API Base URL / API Key / Model / Category labels", () => {
    render(<ConnectionDialog open onOpenChange={() => {}} mode={{ kind: "create" }} />, {
      wrapper: Wrapper,
    });
    const stars = screen.getAllByText("*", { selector: "span" });
    expect(stars.length).toBeGreaterThanOrEqual(5);
  });

  it("shows required error under Name when blurred while empty", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(<ConnectionDialog open onOpenChange={() => {}} mode={{ kind: "create" }} />, {
      wrapper: Wrapper,
    });
    const nameInput = screen.getByLabelText(/^Name/i);
    await user.click(nameInput);
    await user.tab();
    expect(await screen.findByText(/required/i)).toBeInTheDocument();
  });
```

(Use the existing `Wrapper` in the file; if none, copy the QueryClient + MemoryRouter pattern from Task 2.1.)

### Task 4.3: Verify + commit Phase 4

- [ ] **Step 1: Run tests**

```bash
pnpm -F @modeldoctor/web test --run src/features/connections/
```

Expected: all pass.

- [ ] **Step 2: Typecheck + lint**

```bash
pnpm -F @modeldoctor/web typecheck
pnpm -F @modeldoctor/web lint
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/connections/ConnectionDialog.tsx \
        apps/web/src/features/connections/ConnectionDialog.test.tsx
git commit -m "$(cat <<'EOF'
feat(web/connections): migrate ConnectionDialog to unified Form stack (#99)

- mode: "onTouched"; <FormField>/<FormMessage> per field
- Required asterisks on name/apiBaseUrl/apiKey(create+reset)/model/category
- Wrapped fields in <FormSection>; <FormActions> in <DialogFooter>

Refs #99

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 5: Migrate `SetBaselineDialog`

Spec ref: § 风险 5.

This dialog currently uses local `useState` instead of react-hook-form. Migration requires defining an inline schema.

### Task 5.1: Rewrite `SetBaselineDialog`

**Files:** Modify `apps/web/src/features/benchmarks/SetBaselineDialog.tsx`

- [ ] **Step 1: Replace the file body**

```tsx
import { FormActions } from "@/components/common/form-actions";
import { FormSection } from "@/components/common/form-section";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCreateBaseline } from "@/features/baseline/queries";
import { ApiError } from "@/lib/api-client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z } from "zod";

const baselineFormSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2048).optional(),
  tagsInput: z.string().optional(),
});

type BaselineFormValues = z.infer<typeof baselineFormSchema>;

export interface SetBaselineDialogProps {
  benchmarkId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function SetBaselineDialog({
  benchmarkId,
  open,
  onOpenChange,
  onSuccess,
}: SetBaselineDialogProps) {
  const { t } = useTranslation("benchmarks");
  const { t: tc } = useTranslation("common");
  const create = useCreateBaseline();

  const form = useForm<BaselineFormValues>({
    resolver: zodResolver(baselineFormSchema),
    mode: "onTouched",
    defaultValues: { name: "", description: undefined, tagsInput: "" },
  });

  // Reset whenever the dialog re-opens.
  useEffect(() => {
    if (open) form.reset({ name: "", description: undefined, tagsInput: "" });
  }, [open, form]);

  const onSubmit = form.handleSubmit((values) => {
    const tags = (values.tagsInput ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    create.mutate(
      {
        benchmarkId,
        name: values.name,
        ...(values.description ? { description: values.description } : {}),
        tags,
      },
      {
        onSuccess: () => {
          onSuccess?.();
          onOpenChange(false);
        },
        onError: (err) => {
          if (err instanceof ApiError && err.status === 409) {
            toast.error(t("detail.baseline.errors.alreadyExists"));
          } else {
            toast.error(t("detail.baseline.errors.generic"));
          }
        },
      },
    );
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{t("detail.baseline.dialog.title")}</DialogTitle>
              <DialogDescription>{t("detail.baseline.dialog.body")}</DialogDescription>
            </DialogHeader>

            <FormSection>
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t("detail.baseline.dialog.nameLabel")}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t("detail.baseline.dialog.namePlaceholder")}
                        maxLength={200}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("detail.baseline.dialog.descriptionLabel")}</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={3}
                        {...field}
                        value={field.value ?? ""}
                        onChange={(e) =>
                          field.onChange(e.target.value === "" ? undefined : e.target.value)
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="tagsInput"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("detail.baseline.dialog.tagsLabel")}</FormLabel>
                    <FormControl>
                      <Input placeholder="qwen, throughput" {...field} value={field.value ?? ""} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </FormSection>

            <DialogFooter>
              <FormActions
                onCancel={() => onOpenChange(false)}
                cancelLabel={t("detail.baseline.dialog.cancel")}
                submitLabel={t("detail.baseline.dialog.submit")}
                disabled={!form.formState.isValid}
                pending={create.isPending}
              />
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
```

### Task 5.2: Add `SetBaselineDialog.test.tsx`

**Files:** Create `apps/web/src/features/benchmarks/__tests__/SetBaselineDialog.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { SetBaselineDialog } from "../SetBaselineDialog";

const mockCreate = vi.fn();
vi.mock("@/features/baseline/queries", () => ({
  useCreateBaseline: () => ({ mutate: mockCreate, isPending: false }),
}));

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("SetBaselineDialog", () => {
  it("renders required asterisk on Name", () => {
    render(
      <SetBaselineDialog benchmarkId="b1" open onOpenChange={() => {}} />,
      { wrapper: Wrapper },
    );
    const stars = screen.getAllByText("*", { selector: "span" });
    expect(stars.length).toBeGreaterThanOrEqual(1);
  });

  it("submit button is disabled until name has value", async () => {
    const user = userEvent.setup();
    render(
      <SetBaselineDialog benchmarkId="b1" open onOpenChange={() => {}} />,
      { wrapper: Wrapper },
    );
    const submit = screen.getByRole("button", { name: /set as baseline|submit|确定|保存/i });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText(/Name/i), "v1");
    expect(submit).not.toBeDisabled();
  });

  it("shows required error when name is blurred while empty", async () => {
    const user = userEvent.setup();
    render(
      <SetBaselineDialog benchmarkId="b1" open onOpenChange={() => {}} />,
      { wrapper: Wrapper },
    );
    const nameInput = screen.getByLabelText(/Name/i);
    await user.click(nameInput);
    await user.tab();
    expect(await screen.findByText(/required/i)).toBeInTheDocument();
  });
});
```

(The `name: /set as baseline|submit|确定|保存/i` regex tolerates either locale's submit label; lookup the actual i18n value if the regex doesn't match — `apps/web/src/locales/en-US/benchmarks.json` `detail.baseline.dialog.submit`.)

### Task 5.3: Verify + commit Phase 5

- [ ] **Step 1: Run tests + typecheck + lint**

```bash
pnpm -F @modeldoctor/web test --run src/features/benchmarks/__tests__/SetBaselineDialog.test.tsx
pnpm -F @modeldoctor/web typecheck
pnpm -F @modeldoctor/web lint
```

Expected: all pass.

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/features/benchmarks/SetBaselineDialog.tsx \
        apps/web/src/features/benchmarks/__tests__/SetBaselineDialog.test.tsx
git commit -m "$(cat <<'EOF'
feat(web/benchmarks): migrate SetBaselineDialog to unified Form stack (#99)

- Convert from useState to react-hook-form + zodResolver
- Inline baselineFormSchema (name required, description optional, tagsInput parsed on submit)
- mode: "onTouched"; <FormField>/<FormMessage> per field
- New tests: required asterisk, submit-disable until name, on-blur required error

Refs #99

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 6: Auth-page asterisks

### Task 6.1: Add `required` to LoginPage / RegisterPage email + password labels

**Files:** Modify `apps/web/src/features/auth/LoginPage.tsx`, `apps/web/src/features/auth/RegisterPage.tsx`

- [ ] **Step 1: LoginPage**

In `LoginPage.tsx`, find both `<FormLabel>Email</FormLabel>` and `<FormLabel>Password</FormLabel>` and change to `<FormLabel required>…</FormLabel>`.

- [ ] **Step 2: RegisterPage**

Same change in `RegisterPage.tsx` for both Email and Password labels.

- [ ] **Step 3: Verify + commit**

```bash
pnpm -F @modeldoctor/web test --run src/features/auth/
pnpm -F @modeldoctor/web typecheck
pnpm -F @modeldoctor/web lint
```

Expected: all pass.

```bash
git add apps/web/src/features/auth/LoginPage.tsx apps/web/src/features/auth/RegisterPage.tsx
git commit -m "$(cat <<'EOF'
chore(web/auth): mark email/password as required on login + register (#99)

Refs #99

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 7: Sweep hardcoded English in `connections/schema.ts`

Spec ref: § 改动 3.

### Task 7.1: Add new validation keys to common.json

**Files:** Modify `apps/web/src/locales/zh-CN/common.json`, `apps/web/src/locales/en-US/common.json`

- [ ] **Step 1: zh-CN — extend `validation`**

```json
"validation": {
  …existing…,
  "apiKeyControlChar": "API Key 不能包含控制字符",
  "apiKeyTrim": "API Key 不能含首尾空白"
}
```

- [ ] **Step 2: en-US — extend `validation`**

```json
"validation": {
  …existing…,
  "apiKeyControlChar": "API key must not contain control characters",
  "apiKeyTrim": "API key must not have leading or trailing whitespace"
}
```

### Task 7.2: Update `connections/schema.ts`

**Files:** Modify `apps/web/src/features/connections/schema.ts`

- [ ] **Step 1: Replace English `.refine` messages with `validation.*` keys, and update `.url("invalid URL")` and the literal `"required"` strings**

Replace the file body:

```ts
import { ModalityCategorySchema } from "@modeldoctor/contracts";
import { z } from "zod";

const baseShape = {
  name: z
    .string()
    .transform((v) => v.trim())
    .pipe(z.string().min(1)),
  apiBaseUrl: z.string().url(),
  model: z.string().min(1),
  customHeaders: z.string(),
  queryParams: z.string(),
  tokenizerHfId: z.string(),
  category: ModalityCategorySchema,
  tags: z
    .array(z.string().trim())
    .default([])
    .transform((arr) => {
      const seen = new Set<string>();
      const out: string[] = [];
      for (const t of arr) {
        if (!t || seen.has(t)) continue;
        seen.add(t);
        out.push(t);
      }
      return out;
    }),
};

export const connectionInputCreateSchema = z.object({
  ...baseShape,
  apiKey: z
    .string()
    .min(1)
    .refine((v) => !/\p{Cc}/u.test(v), { message: "validation.apiKeyControlChar" })
    .refine((v) => v === v.trim(), { message: "validation.apiKeyTrim" }),
});

export const connectionInputEditSchema = z.object({
  ...baseShape,
  apiKey: z
    .string()
    .refine((v) => v === "" || !/\p{Cc}/u.test(v), { message: "validation.apiKeyControlChar" })
    .refine((v) => v === "" || v === v.trim(), { message: "validation.apiKeyTrim" }),
});

export const connectionInputSchema = connectionInputCreateSchema;

export type ConnectionInput = z.infer<typeof connectionInputCreateSchema>;
```

(Removed all literal English message arguments — zod's `.min(1)` / `.url()` / `.string()` defaults are now routed through the global errorMap.)

### Task 7.3: Verify + commit Phase 7

- [ ] **Step 1: Run all web tests**

```bash
pnpm -F @modeldoctor/web test --run
pnpm -F @modeldoctor/web typecheck
pnpm -F @modeldoctor/web lint
```

Expected: all pass. Existing `ConnectionDialog.test.tsx` may have assertions on the old English error strings — if so, update them to either the new zh-CN strings (if test runs in zh-CN) or to the i18n key check.

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/features/connections/schema.ts \
        apps/web/src/locales/zh-CN/common.json \
        apps/web/src/locales/en-US/common.json
git commit -m "$(cat <<'EOF'
refactor(web/connections): route schema messages through validation.* i18n keys (#99)

- Drop hardcoded English in connectionInputCreate/EditSchema
- Add validation.apiKeyControlChar / validation.apiKeyTrim to common.json
- Default zod messages now routed through global errorMap

Refs #99

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final verification

### Task F.1: Whole-suite check

- [ ] **Step 1: Full test + typecheck + lint pass**

```bash
pnpm -F @modeldoctor/web test --run
pnpm -F @modeldoctor/web typecheck
pnpm -F @modeldoctor/web lint
```

Expected: all green.

- [ ] **Step 2: Manual visual check (optional but recommended)**

```bash
pnpm -F @modeldoctor/web dev
```

Visit each page in the browser, switch language toggle to zh-CN, confirm:
- 红色 `*` 在必填字段标签上
- 失焦后空必填项立即出现红色提示文字
- 切换到 en-US，重新失焦，提示变英文

Capture two screenshots (zh / en) for the PR description.

### Task F.2: Push + open PR

- [ ] **Step 1: Push branch**

```bash
git push -u origin feat/issue-99-form-unification
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "feat(web): unify creation form style + i18n validation messages (#99)" --body "$(cat <<'EOF'
## Summary

- Migrate all 4 creation forms (BenchmarkCreatePage, TemplateCreatePage/EditPage/Form, ConnectionDialog, SetBaselineDialog) onto the unified shadcn `<Form>` stack.
- Add `<FormSection>` and `<FormActions>` common components.
- `<FormLabel required>` renders red asterisks on required fields.
- All forms switch to `mode: "onTouched"` (validate per-field after first blur, then onChange).
- Global `z.setErrorMap` routes built-in zod issues through `common.validation.*` (zh-CN + en-US).
- `connections/schema.ts` `.refine` messages converted to `validation.*` i18n keys.
- LoginPage / RegisterPage email + password labels gain `required` asterisk.

Spec: `docs/superpowers/specs/2026-05-05-issue-99-form-style-unification-design.md`
Plan: `docs/superpowers/plans/2026-05-05-issue-99-form-style-unification.md`

Refs #99

## Test plan

- [ ] `pnpm -F @modeldoctor/web test --run` passes (incl. new `zod-i18n.test.ts` and 4 new asterisk/on-blur cases)
- [ ] `pnpm -F @modeldoctor/web typecheck` clean
- [ ] `pnpm -F @modeldoctor/web lint` clean
- [ ] Manual: zh-CN screenshot showing 必填 + 红色星号 + 字段下方校验提示
- [ ] Manual: en-US screenshot showing English error text under fields after blur

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Follow through (per CLAUDE.md PR follow-through rule)**

```bash
gh pr view <N> --json comments,reviews,statusCheckRollup,mergeStateStatus
gh pr checks <N>
```

Surface reviewer feedback / red checks back to the user.

- [ ] **Step 4: Comment on issue #99**

```bash
gh issue comment 99 --body "PR open: <url>. Single-PR migration of all 4 creation forms onto unified Form stack + i18n validation messages."
```

---

## Acceptance gate

Per spec § 验收标准, before merging:

- [ ] 4 forms use `<Form>` + `<FormField>` + `<FormMessage>`
- [ ] Required fields have `<FormLabel required>` rendering red `*`
- [ ] Empty required fields trigger red error text under input on first blur (zh-CN + en-US)
- [ ] Error message styling identical across pages (FormMessage default)
- [ ] BenchmarkCreatePage visually matches TemplateCreatePage (card sections + spacing)
- [ ] ConnectionDialog uses `<FormSection>` even though it's a single section
- [ ] `pnpm -F @modeldoctor/web {test,typecheck,lint}` all green
- [ ] zh + en screenshots attached to PR
