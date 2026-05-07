# Issue #138 Benchmark Template Loop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the loop between `benchmark_templates` and the benchmark main flow — list/detail pages can save current params as a template, create page can prefill from a template (popover or `?templateId` URL), template list page has a "use this template" CTA.

**Architecture:** One shared `SaveAsTemplateDialog` (used by list + detail), one create-page-only `PrefillFromTemplatePopover`, plus targeted edits in 4 existing files. Backend already supports `Benchmark.templateId` provenance — frontend only.

**Tech Stack:** React 18 · react-hook-form 7 + zod · shadcn (Radix) · @tanstack/react-query 5 · react-i18next 14 · Vitest 2 · Tailwind. New top-level dep: `@radix-ui/react-popover` (~5KB gzipped).

**Spec:** `docs/superpowers/specs/2026-05-07-issue-138-benchmark-template-loop-design.md`

**Working tree:** `/Users/fangyong/vllm/modeldoctor/feat-benchmark-template-loop` on branch `feat/benchmark-template-loop` (already created).

**One-time setup before Task 1:**

```bash
pnpm -r build
```

This is required after `git worktree add` in this repo — apps/api typecheck depends on `packages/contracts/dist`. Skip if you've run it in this worktree already.

---

## File Map

| Path | Purpose | Action |
|---|---|---|
| `apps/web/package.json` | Add `@radix-ui/react-popover` dep | Modify |
| `apps/web/src/components/ui/popover.tsx` | shadcn Popover primitive | Create |
| `apps/web/src/locales/zh-CN/benchmarks.json` | New i18n keys (zh) | Modify |
| `apps/web/src/locales/en-US/benchmarks.json` | New i18n keys (en) | Modify |
| `apps/web/src/locales/zh-CN/benchmark-templates.json` | "Use this template" CTA (zh) | Modify |
| `apps/web/src/locales/en-US/benchmark-templates.json` | "Use this template" CTA (en) | Modify |
| `apps/web/src/features/benchmarks/SaveAsTemplateDialog.tsx` | Shared save-as-template dialog | Create |
| `apps/web/src/features/benchmarks/__tests__/SaveAsTemplateDialog.test.tsx` | Dialog unit tests | Create |
| `apps/web/src/features/benchmarks/BenchmarkListShell.tsx` | Replace direct-copy with dialog + status gate | Modify |
| `apps/web/src/features/benchmarks/__tests__/BenchmarkListShell.test.tsx` | Add status gating test | Modify |
| `apps/web/src/features/benchmarks/BenchmarkDetailPage.tsx` | Add "save as template" header button | Modify |
| `apps/web/src/features/benchmarks/__tests__/BenchmarkDetailPage.test.tsx` | Status gating tests | Modify |
| `apps/web/src/features/benchmarks/PrefillFromTemplatePopover.tsx` | Popover with scenario-filtered template list | Create |
| `apps/web/src/features/benchmarks/__tests__/PrefillFromTemplatePopover.test.tsx` | Popover unit tests | Create |
| `apps/web/src/features/benchmarks/BenchmarkCreatePage.tsx` | Add popover + URL `?templateId` + banner | Modify |
| `apps/web/src/features/benchmarks/__tests__/BenchmarkCreatePage.test.tsx` | Prefill behavior tests | Modify |
| `apps/web/src/features/benchmark-templates/TemplateCard.tsx` | Restructure for "use this template" CTA | Modify |
| `apps/web/src/features/benchmark-templates/__tests__/TemplateCard.test.tsx` | CTA href test | Create |

---

## Task 1: Add Popover primitive

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/src/components/ui/popover.tsx`

- [ ] **Step 1: Install dep**

```bash
pnpm -F @modeldoctor/web add @radix-ui/react-popover@^1
```

Expected: `package.json` gains `"@radix-ui/react-popover": "^1.x.x"` in `dependencies`. Lockfile updated.

- [ ] **Step 2: Create primitive**

Write `apps/web/src/components/ui/popover.tsx`:

```tsx
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as React from "react";

import { cn } from "@/lib/utils";

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverAnchor = PopoverPrimitive.Anchor;

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverAnchor, PopoverContent };
```

- [ ] **Step 3: Verify build/types pass**

```bash
pnpm -F @modeldoctor/web type-check
```

Expected: PASS (no new errors). Pre-existing errors are not introduced by this change.

- [ ] **Step 4: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/components/ui/popover.tsx
git commit -m "$(cat <<'EOF'
build(web): add @radix-ui/react-popover + shadcn Popover primitive

Needed for the prefill-from-template popover on BenchmarkCreatePage.
Mirrors the shape of the existing dialog/dropdown-menu primitives.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: i18n keys

**Files:**
- Modify: `apps/web/src/locales/zh-CN/benchmarks.json`
- Modify: `apps/web/src/locales/en-US/benchmarks.json`
- Modify: `apps/web/src/locales/zh-CN/benchmark-templates.json`
- Modify: `apps/web/src/locales/en-US/benchmark-templates.json`

- [ ] **Step 1: Update zh-CN/benchmarks.json**

Inside `rowActions.saveAsTemplate`, add `disabledTooltip`. After `rowActions.saveAsTemplate.errors.generic`:

Find the existing block (around line 86-92):
```json
    "saveAsTemplate": {
      "label": "保存为模板",
      "success": "已保存为模板「{{name}}」",
      "errors": {
        "generic": "保存为模板失败"
      }
    }
```

Replace with:
```json
    "saveAsTemplate": {
      "label": "保存为模板",
      "success": "已保存为模板「{{name}}」",
      "disabledTooltip": "仅已完成的 benchmark 可保存为模板",
      "errors": {
        "generic": "保存为模板失败"
      }
    }
```

In `detail` block, after the `rerun` sub-object (around line 179-188), add `saveAsTemplate` and `prefilledBanner`:

```json
    "saveAsTemplate": {
      "button": "保存为模板"
    },
```

After the existing `create` block opening (find `"create": {`), add three new keys at the same level as `title`/`titleByScenario`/etc — leave existing keys untouched, append new ones near the end of the `create` object. Add nested `prefillFromTemplate` and `prefilledBanner`:

```json
    "prefillFromTemplate": {
      "button": "从模板预填",
      "search": "搜索模板…",
      "empty": "还没有此场景的模板",
      "manage": "→ 去模板库管理",
      "applied": "已从模板「{{name}}」预填,可继续修改",
      "scenarioMismatch": "模板属于 {{scenario}},已切换 scenario",
      "notFound": "模板不存在或已删除"
    },
    "prefilledBanner": {
      "label": "已从模板「{{name}}」预填",
      "clear": "清除关联"
    }
```

After modification, validate JSON parses:
```bash
node -e "JSON.parse(require('fs').readFileSync('apps/web/src/locales/zh-CN/benchmarks.json','utf8'))"
```
Expected: no output (valid JSON).

- [ ] **Step 2: Update en-US/benchmarks.json mirroring same structure**

Apply the same key additions with English values:

In `rowActions.saveAsTemplate` add:
```json
"disabledTooltip": "Only completed benchmarks can be saved as a template"
```

In `detail` add:
```json
"saveAsTemplate": { "button": "Save as template" },
```

In `create` add:
```json
"prefillFromTemplate": {
  "button": "Prefill from template",
  "search": "Search templates…",
  "empty": "No templates for this scenario yet",
  "manage": "→ Manage templates",
  "applied": "Prefilled from template \"{{name}}\". You can still edit.",
  "scenarioMismatch": "Template belongs to {{scenario}}; scenario switched",
  "notFound": "Template not found or deleted"
},
"prefilledBanner": {
  "label": "Prefilled from template \"{{name}}\"",
  "clear": "Clear link"
}
```

Validate:
```bash
node -e "JSON.parse(require('fs').readFileSync('apps/web/src/locales/en-US/benchmarks.json','utf8'))"
```

- [ ] **Step 3: Update zh-CN/benchmark-templates.json**

Find the `list` object (around line 17-31). Inside `list`, **after** the existing `empty` block (around line 27-35), add a new `cards` block at the same level:

```json
    "cards": {
      "useThisTemplate": "使用此模板"
    }
```

So the `list` object now has both `empty` and `cards` as children.

Validate JSON.

- [ ] **Step 4: Update en-US/benchmark-templates.json**

Same shape, English values:

```json
    "cards": {
      "useThisTemplate": "Use this template"
    }
```

Validate JSON.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/locales
git commit -m "$(cat <<'EOF'
feat(web/i18n): add benchmark template loop strings

Adds disabled-tooltip + dialog title for "save as template", popover
labels + applied/mismatch/not-found toasts + prefilled banner copy
for the create page, and the "use this template" CTA on cards.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: SaveAsTemplateDialog component (TDD)

**Files:**
- Create: `apps/web/src/features/benchmarks/SaveAsTemplateDialog.tsx`
- Create: `apps/web/src/features/benchmarks/__tests__/SaveAsTemplateDialog.test.tsx`

- [ ] **Step 1: Write failing test**

Write `apps/web/src/features/benchmarks/__tests__/SaveAsTemplateDialog.test.tsx`:

```tsx
import "@/lib/i18n";
import type { Benchmark, BenchmarkTemplate } from "@modeldoctor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SaveAsTemplateDialog } from "../SaveAsTemplateDialog";

vi.mock("@/lib/api-client", () => {
  class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  }
  return { ApiError, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() } };
});
import { api } from "@/lib/api-client";

function makeBenchmark(overrides: Partial<Benchmark> = {}): Benchmark {
  return {
    id: "b1",
    userId: "u1",
    connectionId: "c1",
    connection: null,
    scenario: "inference",
    tool: "guidellm",
    toolVersion: null,
    name: "my run",
    description: "desc text",
    status: "completed",
    statusMessage: null,
    progress: null,
    driverHandle: null,
    params: { foo: "bar" },
    rawOutput: null,
    summaryMetrics: null,
    serverMetrics: null,
    templateId: null,
    parentBenchmarkId: null,
    baselineId: null,
    baselineFor: null,
    logs: null,
    createdAt: "2026-04-30T12:00:00.000Z",
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      {children}
      <Toaster />
    </QueryClientProvider>
  );
}

describe("SaveAsTemplateDialog", () => {
  beforeEach(() => {
    vi.mocked(api.post).mockReset();
  });

  it("prefills name with `${benchmark.name} (template)` suffix", () => {
    render(
      <SaveAsTemplateDialog benchmark={makeBenchmark({ name: "vLLM run" })} onOpenChange={() => {}} />,
      { wrapper: Wrapper },
    );
    const nameInput = screen.getByLabelText(/template name|模板名称/i) as HTMLInputElement;
    expect(nameInput.value).toBe("vLLM run (template)");
  });

  it("submits with split tags and forwards scenario+tool+params from benchmark", async () => {
    const created: BenchmarkTemplate = {
      id: "tpl-1",
      name: "vLLM run (template)",
      description: "desc text",
      scenario: "inference",
      tool: "guidellm",
      config: { foo: "bar" },
      isOfficial: false,
      createdBy: "u1",
      tags: ["a", "b", "c"],
      createdAt: "2026-05-07T00:00:00.000Z",
      updatedAt: "2026-05-07T00:00:00.000Z",
    };
    vi.mocked(api.post).mockResolvedValue(created);
    const onOpenChange = vi.fn();

    render(
      <SaveAsTemplateDialog
        benchmark={makeBenchmark({ name: "vLLM run", params: { foo: "bar" } })}
        onOpenChange={onOpenChange}
      />,
      { wrapper: Wrapper },
    );

    await userEvent.type(screen.getByLabelText(/tags|标签/i), "a, b, c");
    await userEvent.click(screen.getByRole("button", { name: /save|保存/i }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        "/api/benchmark-templates",
        expect.objectContaining({
          name: "vLLM run (template)",
          description: "desc text",
          scenario: "inference",
          tool: "guidellm",
          config: { foo: "bar" },
          tags: ["a", "b", "c"],
          isOfficial: false,
        }),
      );
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("strips empty description from payload", async () => {
    vi.mocked(api.post).mockResolvedValue({} as BenchmarkTemplate);
    render(
      <SaveAsTemplateDialog
        benchmark={makeBenchmark({ description: null })}
        onOpenChange={() => {}}
      />,
      { wrapper: Wrapper },
    );
    await userEvent.click(screen.getByRole("button", { name: /save|保存/i }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const body = vi.mocked(api.post).mock.calls[0][1] as Record<string, unknown>;
    expect(body).not.toHaveProperty("description");
  });

  it("shows inline error and keeps dialog open on mutation failure", async () => {
    vi.mocked(api.post).mockRejectedValue(new Error("boom"));
    const onOpenChange = vi.fn();
    render(
      <SaveAsTemplateDialog benchmark={makeBenchmark()} onOpenChange={onOpenChange} />,
      { wrapper: Wrapper },
    );
    await userEvent.click(screen.getByRole("button", { name: /save|保存/i }));
    expect(await screen.findByText(/save as template|保存为模板失败/i)).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("renders nothing when benchmark is null", () => {
    const { container } = render(
      <SaveAsTemplateDialog benchmark={null} onOpenChange={() => {}} />,
      { wrapper: Wrapper },
    );
    expect(container.querySelector("[role=dialog]")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
pnpm -F @modeldoctor/web test -- SaveAsTemplateDialog
```

Expected: FAIL with "Cannot find module '../SaveAsTemplateDialog'" or similar.

- [ ] **Step 3: Implement component**

Write `apps/web/src/features/benchmarks/SaveAsTemplateDialog.tsx`:

```tsx
import { FormActions } from "@/components/common/form-actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { useCreateTemplate } from "@/features/benchmark-templates/queries";
import type { Benchmark } from "@modeldoctor/contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z } from "zod";

const formSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(2048).optional(),
  tagsInput: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export interface SaveAsTemplateDialogProps {
  /** When null the dialog is closed; pass the benchmark to open. */
  benchmark: Benchmark | null;
  onOpenChange: (open: boolean) => void;
}

function defaultName(benchmarkName: string): string {
  // Schema caps name at 100. " (template)" is 11 chars; reserve 89 for the source name.
  const trimmed = benchmarkName.length > 89 ? benchmarkName.slice(0, 89) : benchmarkName;
  return `${trimmed} (template)`;
}

export function SaveAsTemplateDialog({ benchmark, onOpenChange }: SaveAsTemplateDialogProps) {
  const { t } = useTranslation("benchmarks");
  const create = useCreateTemplate();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    mode: "onTouched",
    defaultValues: { name: "", description: undefined, tagsInput: "" },
  });

  // Re-seed defaults whenever the dialog re-opens with a (possibly different) benchmark.
  // biome-ignore lint/correctness/useExhaustiveDependencies: form ref is stable
  useEffect(() => {
    if (benchmark) {
      form.reset({
        name: defaultName(benchmark.name),
        description: benchmark.description ?? undefined,
        tagsInput: "",
      });
      setSubmitError(null);
    }
  }, [benchmark?.id]);

  const onSubmit = form.handleSubmit(async (values) => {
    if (!benchmark) return;
    const tags = (values.tagsInput ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    setSubmitError(null);
    try {
      const next = await create.mutateAsync({
        name: values.name,
        ...(values.description ? { description: values.description } : {}),
        scenario: benchmark.scenario,
        tool: benchmark.tool,
        config: benchmark.params as Record<string, unknown>,
        tags,
        isOfficial: false,
      });
      toast.success(t("rowActions.saveAsTemplate.success", { name: next.name }));
      onOpenChange(false);
    } catch (e) {
      setSubmitError((e as Error).message || t("rowActions.saveAsTemplate.errors.generic"));
    }
  });

  return (
    <Dialog open={benchmark !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{t("detail.saveAsTemplate.button")}</DialogTitle>
              <DialogDescription>
                {t("rowActions.saveAsTemplate.label")}
              </DialogDescription>
            </DialogHeader>

            {submitError && (
              <Alert variant="destructive">
                <AlertDescription>{submitError}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-3">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>
                      {t("benchmark-templates:create.fields.name", { defaultValue: "Template name" })}
                    </FormLabel>
                    <FormControl>
                      <Input maxLength={100} {...field} />
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
                    <FormLabel>
                      {t("benchmark-templates:create.fields.description", { defaultValue: "Description" })}
                    </FormLabel>
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
              <FormField
                control={form.control}
                name="tagsInput"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("benchmark-templates:create.fields.tags", { defaultValue: "Tags" })}
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t("detail.baseline.dialog.tagsLabel", { defaultValue: "" })}
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

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

- [ ] **Step 4: Run test, verify it passes**

```bash
pnpm -F @modeldoctor/web test -- SaveAsTemplateDialog
```

Expected: all 5 tests PASS.

If `screen.getByLabelText(/template name|模板名称/i)` fails because the i18n label resolves differently, check that `apps/web/src/lib/i18n.ts` registers both `benchmarks` and `benchmark-templates` namespaces (it does — see existing imports).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/benchmarks/SaveAsTemplateDialog.tsx \
        apps/web/src/features/benchmarks/__tests__/SaveAsTemplateDialog.test.tsx
git commit -m "$(cat <<'EOF'
feat(web/benchmarks): add shared SaveAsTemplateDialog

Used by BenchmarkListShell + BenchmarkDetailPage to save the current
benchmark's params as a reusable template. Name/description/tags are
editable; scenario/tool/config come straight from the source benchmark.
Inline error on mutation failure keeps the dialog open.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Wire SaveAsTemplateDialog into BenchmarkListShell

**Files:**
- Modify: `apps/web/src/features/benchmarks/BenchmarkListShell.tsx`
- Modify: `apps/web/src/features/benchmarks/__tests__/BenchmarkListShell.test.tsx`

- [ ] **Step 1: Add failing test**

Append to `apps/web/src/features/benchmarks/__tests__/BenchmarkListShell.test.tsx` (inside the existing `describe("BenchmarkListShell", ...)` block):

```tsx
  it("save-as-template menu item is disabled for non-completed rows", async () => {
    vi.mocked(api.get).mockResolvedValue({
      items: [makeBenchmark("r1", "guidellm", "running", null)],
      nextCursor: null,
    } satisfies ListBenchmarksResponse);
    render(<BenchmarkListShell scenario="inference" />, { wrapper: Wrapper });
    await screen.findByText("r1");
    await userEvent.click(screen.getByRole("button", { name: /more|更多/i }));
    const menuItem = await screen.findByRole("menuitem", { name: /save as template|保存为模板/i });
    expect(menuItem).toHaveAttribute("aria-disabled", "true");
  });

  it("save-as-template menu item opens dialog for completed rows", async () => {
    vi.mocked(api.get).mockResolvedValue({
      items: [makeBenchmark("r1", "guidellm", "completed", guidellmMetrics)],
      nextCursor: null,
    } satisfies ListBenchmarksResponse);
    render(<BenchmarkListShell scenario="inference" />, { wrapper: Wrapper });
    await screen.findByText("r1");
    await userEvent.click(screen.getByRole("button", { name: /more|更多/i }));
    const menuItem = await screen.findByRole("menuitem", { name: /save as template|保存为模板/i });
    await userEvent.click(menuItem);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run, verify failure**

```bash
pnpm -F @modeldoctor/web test -- BenchmarkListShell
```

Expected: 2 new tests fail (the menu item is currently always enabled and there's no dialog).

- [ ] **Step 3: Edit BenchmarkListShell.tsx**

Apply 3 edits.

**Edit 1**: Replace the `handleSaveAsTemplate` function (currently lines 154-171). Find:

```tsx
  async function handleSaveAsTemplate(b: Benchmark) {
    const trimmed = b.name.length > 90 ? b.name.slice(0, 90) : b.name;
    const newName = `${trimmed} (template)`;
    try {
      const next = await createTemplate.mutateAsync({
        name: newName,
        description: b.description ?? undefined,
        scenario: b.scenario,
        tool: b.tool,
        config: b.params as Record<string, unknown>,
        tags: [],
        isOfficial: false,
      });
      toast.success(t("rowActions.saveAsTemplate.success", { name: next.name }));
    } catch (e) {
      toast.error((e as Error).message || t("rowActions.saveAsTemplate.errors.generic"));
    }
  }
```

Delete this block. Also delete the now-unused `createTemplate` declaration at line 122 and the unused `useCreateTemplate` import at line 32.

**Edit 2**: Add a new state, near `pendingDeleteId`:

Find:
```tsx
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
```

Insert after it:
```tsx
  const [saveTplBenchmark, setSaveTplBenchmark] = useState<Benchmark | null>(null);
```

**Edit 3**: Replace the DropdownMenuItem for save-as-template (currently lines 393-400):

Find:
```tsx
                            <DropdownMenuItem
                              onClick={() => handleSaveAsTemplate(benchmark)}
                              disabled={createTemplate.isPending}
                              className="gap-2"
                            >
                              <CopyIcon className="h-4 w-4" />
                              {t("rowActions.saveAsTemplate.label")}
                            </DropdownMenuItem>
```

Replace with:
```tsx
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span>
                                  <DropdownMenuItem
                                    onClick={(e) => {
                                      if (benchmark.status !== "completed") {
                                        e.preventDefault();
                                        return;
                                      }
                                      setSaveTplBenchmark(benchmark);
                                    }}
                                    disabled={benchmark.status !== "completed"}
                                    className="gap-2"
                                  >
                                    <CopyIcon className="h-4 w-4" />
                                    {t("rowActions.saveAsTemplate.label")}
                                  </DropdownMenuItem>
                                </span>
                              </TooltipTrigger>
                              {benchmark.status !== "completed" && (
                                <TooltipContent>
                                  {t("rowActions.saveAsTemplate.disabledTooltip")}
                                </TooltipContent>
                              )}
                            </Tooltip>
```

**Edit 4**: Add the dialog at the bottom, just before the closing `</>`. Find:

```tsx
      </AlertDialog>
    </>
  );
}
```

Insert before `</>`:
```tsx
      <SaveAsTemplateDialog
        benchmark={saveTplBenchmark}
        onOpenChange={(o) => !o && setSaveTplBenchmark(null)}
      />
```

**Edit 5**: Add import at top:
```tsx
import { SaveAsTemplateDialog } from "./SaveAsTemplateDialog";
```

- [ ] **Step 4: Run tests, verify pass**

```bash
pnpm -F @modeldoctor/web test -- BenchmarkListShell
```

Expected: ALL pass (existing + 2 new).

- [ ] **Step 5: Type-check**

```bash
pnpm -F @modeldoctor/web type-check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/benchmarks/BenchmarkListShell.tsx \
        apps/web/src/features/benchmarks/__tests__/BenchmarkListShell.test.tsx
git commit -m "$(cat <<'EOF'
feat(web/benchmarks): list page save-as-template dialog + status gate

Replaces the silent ${name} (template) copy with the shared
SaveAsTemplateDialog and disables the menu item (with tooltip) for
non-completed rows.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Add save-as-template button to BenchmarkDetailPage

**Files:**
- Modify: `apps/web/src/features/benchmarks/BenchmarkDetailPage.tsx`
- Modify: `apps/web/src/features/benchmarks/__tests__/BenchmarkDetailPage.test.tsx`

- [ ] **Step 1: Add failing test**

Append three cases inside the existing `describe("BenchmarkDetailPage", ...)` block (uses the file-local `makeBenchmark` and `Wrapper` helpers already defined at the top of the file):

```tsx
  it("renders Save-as-Template button when status is completed", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(makeBenchmark({ status: "completed" }));
    render(<BenchmarkDetailPage />, { wrapper: Wrapper });
    expect(
      await screen.findByRole("button", { name: /save as template|保存为模板/i }),
    ).toBeInTheDocument();
  });

  it("hides Save-as-Template button when status is failed", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(
      makeBenchmark({ status: "failed", statusMessage: "boom" }),
    );
    render(<BenchmarkDetailPage />, { wrapper: Wrapper });
    // Wait for the page to settle on a non-button anchor we know exists for failed:
    await screen.findByText(/boom/);
    expect(
      screen.queryByRole("button", { name: /save as template|保存为模板/i }),
    ).not.toBeInTheDocument();
  });

  it("hides Save-as-Template button when status is running", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(
      makeBenchmark({ status: "running", summaryMetrics: null }),
    );
    render(<BenchmarkDetailPage />, { wrapper: Wrapper });
    // Wait for the running placeholder so we know the page is past initial loading:
    await screen.findByText(/Running|运行中/);
    expect(
      screen.queryByRole("button", { name: /save as template|保存为模板/i }),
    ).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run, verify failure**

```bash
pnpm -F @modeldoctor/web test -- BenchmarkDetailPage
```

Expected: 2 new tests fail (no such button exists).

- [ ] **Step 3: Edit BenchmarkDetailPage.tsx**

**Edit 1**: Add imports near the existing icon imports (line ~22):
```tsx
import { ArrowLeft, Copy, Loader2, RefreshCw, SearchX } from "lucide-react";
```
(Add `Copy` to the existing import list — preserve alphabetical order.)

Add after the `SetBaselineDialog` import:
```tsx
import { SaveAsTemplateDialog } from "./SaveAsTemplateDialog";
```

**Edit 2**: Add new state alongside the others (near line 113):
```tsx
  const [saveTplOpen, setSaveTplOpen] = useState(false);
```

**Edit 3**: Insert the new button in the header `rightSlot`. Find the rerun block (lines 218-241, the conditional `{isTerminal && (canRerun ? ... : ...)}`). Immediately AFTER that block and BEFORE the cancel block (`{!isTerminal && ...`), insert:

```tsx
            {isTerminal && benchmark.status === "completed" && (
              <Button variant="outline" size="sm" onClick={() => setSaveTplOpen(true)}>
                <Copy className="mr-1 h-4 w-4" />
                {t("detail.saveAsTemplate.button")}
              </Button>
            )}
```

**Edit 4**: At the end of the JSX (after the last `<AlertDialog>` for cancel, just before the closing `</>`), insert:

```tsx
      <SaveAsTemplateDialog
        benchmark={saveTplOpen ? benchmark : null}
        onOpenChange={setSaveTplOpen}
      />
```

- [ ] **Step 4: Run tests**

```bash
pnpm -F @modeldoctor/web test -- BenchmarkDetailPage
```

Expected: all PASS (incl. 2 new).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/benchmarks/BenchmarkDetailPage.tsx \
        apps/web/src/features/benchmarks/__tests__/BenchmarkDetailPage.test.tsx
git commit -m "$(cat <<'EOF'
feat(web/benchmarks): detail page save-as-template button

Header button shown only when status === "completed". Reuses the
shared SaveAsTemplateDialog from the list page.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: PrefillFromTemplatePopover component (TDD)

**Files:**
- Create: `apps/web/src/features/benchmarks/PrefillFromTemplatePopover.tsx`
- Create: `apps/web/src/features/benchmarks/__tests__/PrefillFromTemplatePopover.test.tsx`

- [ ] **Step 1: Write failing test**

Write `apps/web/src/features/benchmarks/__tests__/PrefillFromTemplatePopover.test.tsx`:

```tsx
import "@/lib/i18n";
import type { BenchmarkTemplate, ListBenchmarkTemplatesResponse } from "@modeldoctor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrefillFromTemplatePopover } from "../PrefillFromTemplatePopover";

vi.mock("@/lib/api-client", () => {
  class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  }
  return { ApiError, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() } };
});
import { api } from "@/lib/api-client";

function tpl(overrides: Partial<BenchmarkTemplate> = {}): BenchmarkTemplate {
  return {
    id: "tpl-1",
    name: "vLLM single concurrency",
    description: "official low-load",
    scenario: "inference",
    tool: "guidellm",
    config: {},
    isOfficial: true,
    createdBy: null,
    tags: ["official"],
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:00.000Z",
    ...overrides,
  };
}

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("PrefillFromTemplatePopover", () => {
  beforeEach(() => vi.mocked(api.get).mockReset());

  it("opens, lists templates filtered by current scenario", async () => {
    vi.mocked(api.get).mockResolvedValue({
      items: [tpl({ id: "t1", name: "vLLM single" }), tpl({ id: "t2", name: "Internal gateway", tool: "vegeta" })],
      nextCursor: null,
    } satisfies ListBenchmarkTemplatesResponse);

    render(<PrefillFromTemplatePopover scenario="inference" onPick={() => {}} />, { wrapper: Wrapper });
    await userEvent.click(screen.getByRole("button", { name: /prefill from template|从模板预填/i }));
    expect(await screen.findByText("vLLM single")).toBeInTheDocument();
    expect(screen.getByText("Internal gateway")).toBeInTheDocument();
    // Verify the api was called with scenario filter:
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(expect.stringContaining("scenario=inference")),
    );
  });

  it("filters items locally by search input", async () => {
    vi.mocked(api.get).mockResolvedValue({
      items: [tpl({ id: "t1", name: "vLLM single" }), tpl({ id: "t2", name: "Internal gateway" })],
      nextCursor: null,
    } satisfies ListBenchmarkTemplatesResponse);

    render(<PrefillFromTemplatePopover scenario="inference" onPick={() => {}} />, { wrapper: Wrapper });
    await userEvent.click(screen.getByRole("button", { name: /prefill from template|从模板预填/i }));
    await screen.findByText("vLLM single");
    await userEvent.type(screen.getByRole("textbox", { name: /search templates|搜索模板/i }), "vLLM");
    expect(screen.getByText("vLLM single")).toBeInTheDocument();
    expect(screen.queryByText("Internal gateway")).not.toBeInTheDocument();
  });

  it("shows empty state with manage link when no templates exist", async () => {
    vi.mocked(api.get).mockResolvedValue({
      items: [],
      nextCursor: null,
    } satisfies ListBenchmarkTemplatesResponse);

    render(<PrefillFromTemplatePopover scenario="inference" onPick={() => {}} />, { wrapper: Wrapper });
    await userEvent.click(screen.getByRole("button", { name: /prefill from template|从模板预填/i }));
    expect(await screen.findByText(/no templates|还没有此场景/i)).toBeInTheDocument();
    const manage = screen.getByRole("link", { name: /manage templates|去模板库管理/i });
    expect(manage).toHaveAttribute("href", "/benchmark-templates?scenario=inference");
  });

  it("calls onPick with the full template object on click", async () => {
    const t1 = tpl({ id: "t1", name: "vLLM single" });
    vi.mocked(api.get).mockResolvedValue({
      items: [t1],
      nextCursor: null,
    } satisfies ListBenchmarkTemplatesResponse);

    const onPick = vi.fn();
    render(<PrefillFromTemplatePopover scenario="inference" onPick={onPick} />, { wrapper: Wrapper });
    await userEvent.click(screen.getByRole("button", { name: /prefill from template|从模板预填/i }));
    await userEvent.click(await screen.findByRole("button", { name: /vLLM single/ }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "t1", name: "vLLM single" }));
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
pnpm -F @modeldoctor/web test -- PrefillFromTemplatePopover
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement component**

Write `apps/web/src/features/benchmarks/PrefillFromTemplatePopover.tsx`:

```tsx
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTemplates } from "@/features/benchmark-templates/queries";
import type { BenchmarkTemplate, ScenarioId } from "@modeldoctor/contracts";
import { Layers, ShieldCheck } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

interface PrefillFromTemplatePopoverProps {
  scenario: ScenarioId;
  onPick: (template: BenchmarkTemplate) => void;
}

export function PrefillFromTemplatePopover({ scenario, onPick }: PrefillFromTemplatePopoverProps) {
  const { t } = useTranslation("benchmarks");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchId = useId();

  const { data } = useTemplates({ scenario, limit: 50 });
  const items = data?.pages.flatMap((p) => p.items) ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (it) =>
        it.name.toLowerCase().includes(q) ||
        (it.description ?? "").toLowerCase().includes(q) ||
        it.tags.some((tag) => tag.toLowerCase().includes(q)),
    );
  }, [items, search]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Layers className="mr-1 h-4 w-4" />
          {t("create.prefillFromTemplate.button")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="end">
        <div className="border-b p-2">
          <Input
            id={searchId}
            aria-label={t("create.prefillFromTemplate.search")}
            placeholder={t("create.prefillFromTemplate.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8"
          />
        </div>
        <div className="max-h-72 overflow-auto">
          {filtered.length === 0 ? (
            <div className="p-3 text-sm text-muted-foreground">
              {t("create.prefillFromTemplate.empty")}
            </div>
          ) : (
            <ul className="divide-y">
              {filtered.map((it) => (
                <li key={it.id}>
                  <button
                    type="button"
                    className="flex w-full flex-col gap-1 px-3 py-2 text-left hover:bg-accent"
                    onClick={() => {
                      onPick(it);
                      setOpen(false);
                    }}
                  >
                    <span className="flex items-center gap-1 text-sm font-medium">
                      {it.isOfficial && <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden />}
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
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border-t p-2">
          <Link
            to={`/benchmark-templates?scenario=${scenario}`}
            className="block px-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setOpen(false)}
          >
            {t("create.prefillFromTemplate.manage")}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
pnpm -F @modeldoctor/web test -- PrefillFromTemplatePopover
```

Expected: ALL pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/benchmarks/PrefillFromTemplatePopover.tsx \
        apps/web/src/features/benchmarks/__tests__/PrefillFromTemplatePopover.test.tsx
git commit -m "$(cat <<'EOF'
feat(web/benchmarks): add PrefillFromTemplatePopover

Compact popover that lists templates filtered by the current scenario,
supports local search, and emits a picked template via onPick. Empty
state and footer link both route to /benchmark-templates.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Wire prefill into BenchmarkCreatePage

**Files:**
- Modify: `apps/web/src/features/benchmarks/BenchmarkCreatePage.tsx`
- Modify: `apps/web/src/features/benchmarks/__tests__/BenchmarkCreatePage.test.tsx`

- [ ] **Step 1: Add failing test**

The existing test file uses `vi.mock("../queries", ...)` for `useCreateBenchmark`. We add a parallel mock for `@/features/benchmark-templates/queries`. Insert at the top of the file, alongside the existing mocks:

```tsx
const mockUseTemplate = vi.fn();
vi.mock("@/features/benchmark-templates/queries", () => ({
  useTemplate: (...args: unknown[]) => mockUseTemplate(...args),
  useTemplates: () => ({ data: { pages: [{ items: [], nextCursor: null }] }, isLoading: false }),
  useCreateTemplate: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));
```

Then add a `beforeEach` (also at the top of `describe`):
```tsx
beforeEach(() => {
  mockUseTemplate.mockReturnValue({ data: undefined, isError: false });
});
```

Then append three test cases to the existing `describe("BenchmarkCreatePage", ...)`:

```tsx
  it("prefills form when ?templateId= present in URL", async () => {
    mockUseTemplate.mockReturnValue({
      data: {
        id: "tpl-1",
        name: "preset",
        description: null,
        scenario: "inference",
        tool: "guidellm",
        config: { profile: "throughput" },
        isOfficial: false,
        createdBy: null,
        tags: [],
        createdAt: "2026-05-07T00:00:00.000Z",
        updatedAt: "2026-05-07T00:00:00.000Z",
      },
      isError: false,
    });
    renderAt("/benchmarks/new?scenario=inference&templateId=tpl-1");
    // Wait for prefill effect to fire:
    await waitFor(() => {
      const nameInput = screen.getByLabelText(/Name|名称/i) as HTMLInputElement;
      expect(nameInput.value).toBe("preset");
    });
  });

  it("shows prefilled banner with clear-link button when templateId is set", async () => {
    mockUseTemplate.mockReturnValue({
      data: {
        id: "tpl-1",
        name: "preset",
        description: null,
        scenario: "inference",
        tool: "guidellm",
        config: { profile: "throughput" },
        isOfficial: false,
        createdBy: null,
        tags: [],
        createdAt: "2026-05-07T00:00:00.000Z",
        updatedAt: "2026-05-07T00:00:00.000Z",
      },
      isError: false,
    });
    renderAt("/benchmarks/new?scenario=inference&templateId=tpl-1");
    expect(await screen.findByText(/prefilled from template|已从模板/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /clear link|清除关联/i })).toBeInTheDocument();
  });

  it("clear-link button strips templateId but keeps params", async () => {
    mockUseTemplate.mockReturnValue({
      data: {
        id: "tpl-1",
        name: "preset",
        description: null,
        scenario: "inference",
        tool: "guidellm",
        config: { profile: "throughput" },
        isOfficial: false,
        createdBy: null,
        tags: [],
        createdAt: "2026-05-07T00:00:00.000Z",
        updatedAt: "2026-05-07T00:00:00.000Z",
      },
      isError: false,
    });
    renderAt("/benchmarks/new?scenario=inference&templateId=tpl-1");
    await screen.findByText(/prefilled from template|已从模板/i);
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(screen.getByRole("button", { name: /clear link|清除关联/i }));
    // Banner gone…
    expect(screen.queryByText(/prefilled from template|已从模板/i)).not.toBeInTheDocument();
    // …but Name field still has "preset"
    const nameInput = screen.getByLabelText(/Name|名称/i) as HTMLInputElement;
    expect(nameInput.value).toBe("preset");
  });
```

Make sure `waitFor` is in the testing-library imports at the top:
```tsx
import { act, render, screen, waitFor, within } from "@testing-library/react";
```

- [ ] **Step 2: Run, verify failure**

```bash
pnpm -F @modeldoctor/web test -- BenchmarkCreatePage
```

Expected: 2 new tests fail.

- [ ] **Step 3: Edit BenchmarkCreatePage.tsx**

**Edit 1**: Imports — add to existing imports:

```tsx
import { Button } from "@/components/ui/button";
import { useTemplate } from "@/features/benchmark-templates/queries";
import { X } from "lucide-react";
import { useEffect, useRef } from "react";  // adjust if useEffect already imported
import { toast } from "sonner";  // already imported
import { PrefillFromTemplatePopover } from "./PrefillFromTemplatePopover";
import type { BenchmarkTemplate } from "@modeldoctor/contracts";
```

(Merge with existing imports; don't duplicate.)

**Edit 2**: Inside `BenchmarkCreatePage`, after the existing `defaultTool` derivation (before `useForm`), read the templateId param:

```tsx
  const templateIdParam = params.get("templateId");
```

**Edit 3**: Update `defaultValues` in `useForm` — add `templateId: undefined`:

```tsx
    defaultValues: {
      tool: defaultTool,
      scenario,
      connectionId: "",
      name: "",
      description: undefined,
      params: TOOL_DEFAULTS[defaultTool] as Record<string, unknown>,
      templateId: undefined,
    },
```

Same in the `useEffect([scenario])` reset block — add `templateId: undefined` so changing scenario clears prefill.

**Edit 4**: Add the templateId hook + `applyTemplate` + URL-prefill effect, after the `useEffect([scenario])`:

```tsx
  const tplQuery = useTemplate(templateIdParam ?? undefined);

  function applyTemplate(template: BenchmarkTemplate) {
    if (template.scenario !== scenario) {
      toast.warning(
        t("create.prefillFromTemplate.scenarioMismatch", { scenario: template.scenario }),
      );
    }
    form.reset({
      tool: template.tool,
      scenario: template.scenario,
      connectionId: form.getValues("connectionId") ?? "",
      name: template.name,
      description: template.description ?? undefined,
      params: template.config,
      templateId: template.id,
    });
    toast.info(t("create.prefillFromTemplate.applied", { name: template.name }));
  }

  // One-shot prefill from URL ?templateId=
  const hasAppliedRef = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: applyTemplate is stable enough; we only want to run when template loads
  useEffect(() => {
    if (tplQuery.data && !hasAppliedRef.current) {
      applyTemplate(tplQuery.data);
      hasAppliedRef.current = true;
    }
  }, [tplQuery.data]);

  // 404 / fetch error: toast + drop the bad URL param
  useEffect(() => {
    if (templateIdParam && tplQuery.isError) {
      toast.error(t("create.prefillFromTemplate.notFound"));
      const next = new URLSearchParams(params);
      next.delete("templateId");
      // setSearchParams isn't currently destructured — destructure both:
      setSearchParams(next, { replace: true });
    }
  }, [templateIdParam, tplQuery.isError]);
```

To make `setSearchParams` available, change:
```tsx
  const [params] = useSearchParams();
```
to:
```tsx
  const [params, setSearchParams] = useSearchParams();
```

**Edit 5**: Replace the `PageHeader` line. Find:
```tsx
      <PageHeader title={t(`create.titleByScenario.${scenario}`)} subtitle={t("create.subtitle")} />
```
Replace with:
```tsx
      <PageHeader
        title={t(`create.titleByScenario.${scenario}`)}
        subtitle={t("create.subtitle")}
        rightSlot={<PrefillFromTemplatePopover scenario={scenario} onPick={applyTemplate} />}
      />
```

**Edit 6**: Insert the prefilled banner inside the form, immediately AFTER `<form onSubmit={onSubmit} className="space-y-6">` and BEFORE the existing first `<div className="grid grid-cols-1 gap-6 md:grid-cols-2">`:

```tsx
            {form.watch("templateId") && tplQuery.data && (
              <div className="flex items-center justify-between rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
                <span>
                  {t("create.prefilledBanner.label", { name: tplQuery.data.name })}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => form.setValue("templateId", undefined, { shouldDirty: true })}
                  className="gap-1"
                >
                  <X className="h-3.5 w-3.5" />
                  {t("create.prefilledBanner.clear")}
                </Button>
              </div>
            )}
```

Note: when the user clicks the popover (path A), `tplQuery.data` won't be set because no `?templateId` is in the URL. To make the banner appear in path A too, re-derive `tplQuery.data` from a separate hook keyed off `form.watch("templateId")`. Easiest: use one shared call:

```tsx
  const watchedTemplateId = form.watch("templateId");
  const bannerTpl = useTemplate(watchedTemplateId ?? undefined);
```

Then change the banner condition:
```tsx
            {watchedTemplateId && bannerTpl.data && (
              <div ...>
                <span>{t("create.prefilledBanner.label", { name: bannerTpl.data.name })}</span>
                ...
              </div>
            )}
```

And keep `tplQuery` (URL-driven) only for the URL-prefill effect / error effect — `bannerTpl` is the rendering hook. React-query will dedupe the two calls when the IDs match (same query key).

- [ ] **Step 4: Run tests**

```bash
pnpm -F @modeldoctor/web test -- BenchmarkCreatePage
```

Expected: ALL pass.

- [ ] **Step 5: Type-check**

```bash
pnpm -F @modeldoctor/web type-check
```

Expected: PASS. If `templateId: undefined` flags a "Type 'undefined' is not assignable" error, double-check `CreateBenchmarkRequest.templateId` is optional (it is — `packages/contracts/src/benchmark.ts:82`).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/benchmarks/BenchmarkCreatePage.tsx \
        apps/web/src/features/benchmarks/__tests__/BenchmarkCreatePage.test.tsx
git commit -m "$(cat <<'EOF'
feat(web/benchmarks): create page prefill from template

Adds PrefillFromTemplatePopover to the page header, supports URL
?templateId for one-shot prefill, and renders a "prefilled from
template X [✕ clear]" banner so users can drop the link without
losing the params they're staring at. templateId is sent on submit so
the resulting benchmark records its provenance.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: TemplateCard "use this template" CTA

**Files:**
- Modify: `apps/web/src/features/benchmark-templates/TemplateCard.tsx`
- Create: `apps/web/src/features/benchmark-templates/__tests__/TemplateCard.test.tsx`

- [ ] **Step 1: Write failing test**

Write `apps/web/src/features/benchmark-templates/__tests__/TemplateCard.test.tsx`:

```tsx
import "@/lib/i18n";
import type { BenchmarkTemplate } from "@modeldoctor/contracts";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { TemplateCard } from "../TemplateCard";

function tpl(overrides: Partial<BenchmarkTemplate> = {}): BenchmarkTemplate {
  return {
    id: "tpl-42",
    name: "vLLM single concurrency",
    description: "low load",
    scenario: "inference",
    tool: "guidellm",
    config: {},
    isOfficial: false,
    createdBy: "u1",
    tags: [],
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:00.000Z",
    ...overrides,
  };
}

describe("TemplateCard", () => {
  it("renders 'use this template' CTA pointing to /benchmarks/new with scenario+templateId", () => {
    render(
      <MemoryRouter>
        <TemplateCard template={tpl({ scenario: "gateway", id: "tpl-42" })} canEdit={false} onDeleteClick={() => {}} />
      </MemoryRouter>,
    );
    const cta = screen.getByRole("link", { name: /use this template|使用此模板/i });
    expect(cta).toHaveAttribute("href", "/benchmarks/new?scenario=gateway&templateId=tpl-42");
  });

  it("still renders detail link on the card name area", () => {
    render(
      <MemoryRouter>
        <TemplateCard template={tpl()} canEdit={false} onDeleteClick={() => {}} />
      </MemoryRouter>,
    );
    const detailLink = screen.getByRole("link", { name: /vLLM single concurrency/i });
    expect(detailLink).toHaveAttribute("href", "/benchmark-templates/tpl-42");
  });
});
```

- [ ] **Step 2: Run, verify failure**

```bash
pnpm -F @modeldoctor/web test -- TemplateCard
```

Expected: FAIL — currently no CTA, and name is wrapped in a Link covering the whole card (the test will pass for the second case, fail on the first).

- [ ] **Step 3: Edit TemplateCard.tsx**

Replace the entire file with:

```tsx
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { BenchmarkTemplate } from "@modeldoctor/contracts";
import { MoreHorizontal, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

export interface TemplateCardProps {
  template: BenchmarkTemplate;
  canEdit: boolean;
  onDeleteClick: () => void;
}

export function TemplateCard({ template, canEdit, onDeleteClick }: TemplateCardProps) {
  const { t } = useTranslation("benchmark-templates");
  return (
    <div className="group relative flex flex-col gap-3 rounded-lg border border-border bg-card p-4 transition hover:border-primary/40">
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {template.isOfficial && <ShieldCheck className="h-4 w-4 text-primary" aria-hidden />}
            <Link
              to={`/benchmark-templates/${template.id}`}
              className="truncate text-sm font-semibold hover:text-primary hover:underline"
            >
              {template.name}
            </Link>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="text-xs">
            {template.tool}
          </Badge>
          {template.isOfficial && (
            <Badge variant="default" className="text-xs">
              {t("list.official")}
            </Badge>
          )}
          {template.tags.map((tag) => (
            <Badge key={tag} variant="outline" className="text-xs">
              {tag}
            </Badge>
          ))}
        </div>
        <p className="line-clamp-2 text-xs text-muted-foreground">{template.description || ""}</p>
        <p className="text-xs text-muted-foreground">
          {t("list.updatedAt", {
            when: new Date(template.updatedAt).toLocaleString(),
          })}
        </p>
      </div>

      <div className="flex justify-end">
        <Button asChild size="sm">
          <Link to={`/benchmarks/new?scenario=${template.scenario}&templateId=${template.id}`}>
            {t("list.cards.useThisTemplate")}
          </Link>
        </Button>
      </div>

      {canEdit && (
        <div className="absolute right-2 top-2 opacity-0 transition group-hover:opacity-100">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link to={`/benchmark-templates/${template.id}`}>{t("actions.edit")}</Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive"
                onClick={(e) => {
                  e.preventDefault();
                  onDeleteClick();
                }}
              >
                {t("actions.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}
```

Key change vs current: the outer `<Link>` wrapping the whole card is gone — only the **name** is a link to detail, and the **CTA button** is a separate link to new-benchmark. This avoids nested `<a>` tags and aligns with the design's "list page action conventions" memory (first column = detail link).

- [ ] **Step 4: Run tests**

```bash
pnpm -F @modeldoctor/web test -- TemplateCard
```

Expected: ALL pass.

- [ ] **Step 5: Sanity-check TemplateListPage tests still pass**

```bash
pnpm -F @modeldoctor/web test -- TemplateListPage
```

Expected: PASS — TemplateListPage renders cards but doesn't assert on the wrapping link; layout-only changes shouldn't break it.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/benchmark-templates/TemplateCard.tsx \
        apps/web/src/features/benchmark-templates/__tests__/TemplateCard.test.tsx
git commit -m "$(cat <<'EOF'
feat(web/templates): "use this template" CTA on TemplateCard

Restructures the card so the name links to the detail view and a
separate "Use this template" button links to /benchmarks/new with the
template prefilled via ?templateId. The whole-card Link wrapper is
removed (it nested anchors and would have nested again with the CTA).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Final verification

- [ ] **Step 1: Workspace-wide tests**

```bash
pnpm -F @modeldoctor/web test
```

Expected: ALL pass. If a TemplateListPage / BenchmarkComparePage test broke from card-link restructure, fix the assertion (do not weaken the new test).

- [ ] **Step 2: Type-check the whole web package**

```bash
pnpm -F @modeldoctor/web type-check
```

Expected: PASS.

- [ ] **Step 3: Lint**

```bash
pnpm -F @modeldoctor/web lint
```

Expected: PASS. If biome flags `useExhaustiveDependencies` on the prefill effect, the inline `// biome-ignore` comment in the implementation handles that.

- [ ] **Step 4: Workspace build**

```bash
pnpm -F @modeldoctor/web build
```

Expected: PASS.

- [ ] **Step 5: Manual smoke (if dev server reachable)**

```bash
pnpm dev
```

Then in a browser (default `http://localhost:5173`):

1. `/benchmarks/inference` — open the more-menu on a `running` row → "保存为模板" should be greyed; tooltip explains why
2. Same row when status is `completed` → menu item active → click opens dialog → submit creates a template (verify in `/benchmark-templates`)
3. `/benchmarks/{completed-id}` (detail) — header shows "保存为模板" button → opens same dialog
4. `/benchmarks/{failed-id}` — no "保存为模板" button in header
5. `/benchmark-templates` — each card has "使用此模板" → click → routes to `/benchmarks/new?scenario=...&templateId=...` → form is prefilled, banner shows "已从模板「X」预填", you can edit name, click ✕ clears banner
6. On `/benchmarks/new?scenario=inference`, click "从模板预填" → popover lists templates → search filters → click an item → form prefills + toast

If you cannot run the dev server in this session, say so explicitly in the handoff message rather than claiming success.

- [ ] **Step 6: Final commit if any fixes were needed in step 1-5**

(Otherwise this step is a no-op.)

---

## Acceptance Checklist (from spec)

- [ ] 详情页 / 列表页:`completed` benchmark 看到"保存为模板",非 `completed` disabled+tooltip
- [ ] Dialog 能改 name / description / tags,提交后 toast,在 `/benchmark-templates` 看到新模板
- [ ] 新建页"从模板预填" popover 仅显示当前 scenario 模板,选中后表单按模板预填,可继续改
- [ ] 模板列表页"使用此模板" → 跳到 `/benchmarks/new?scenario=...&templateId=...` 自动预填
- [ ] 提交后 `Benchmark.templateId` 正确落库;banner ✕ 后不落库
- [ ] `pnpm -F @modeldoctor/web test` / `type-check` / `lint` 全绿

---

## Out-of-Scope Follow-Ups

After implementation, post a single comment on issue #138 listing the deferred items so future work has context:

- Detail page does not yet display "派生自模板 X" provenance even though `Benchmark.templateId` is now consistently set.
- No reverse "以此模板再开一次新 benchmark" entry from the detail page (only TemplateCard CTA).
- No backfill of `templateId` on existing benchmarks created before this change — provenance is forward-only.
