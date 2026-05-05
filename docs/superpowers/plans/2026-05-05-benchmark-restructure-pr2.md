# PR2: Benchmark Restructure — benchmark_templates CRUD + List/Edit UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the PR1 `BenchmarkTemplateRepository` skeleton into a full CRUD module with controller + service + permissions, then add three frontend pages (`/benchmark-templates`, `/benchmark-templates/new`, `/benchmark-templates/:id`) and a sidebar entry. Refactor `BenchmarkCreatePage` to share its tool/params editor with the new template forms.

**Architecture:** Permission gating lives in the service layer (`actor: { sub, isAdmin }` injected by the controller). `isOfficial` is create-only and immutable: the update DTO `omit`s `scenario / tool / isOfficial` at the schema layer, so PATCH cannot change them even if the body tries. List ordering is `isOfficial DESC, updatedAt DESC, id DESC` so admin-curated templates always lead. The frontend extracts a `<ToolParamsEditor>` component from `BenchmarkCreatePage` parameterized on `paramsFieldName: "params" | "config"` so both benchmark and template forms render the same UI.

**Tech Stack:** TypeScript 5.x; pnpm workspaces; NestJS 10 + Prisma 5 + PostgreSQL 16 (`apps/api`); React 18 + Vite + react-router-dom v6 + react-i18next + @tanstack/react-query@5 + biome (`apps/web`); vitest@2 (`apps/api`) and vitest@1 (`apps/web`); zod 3.

**Spec:** `docs/superpowers/specs/2026-05-05-benchmark-restructure-pr2-design.md`

**Branch:** `feat/benchmark-restructure-pr2` (this plan is on `docs/benchmark-restructure-pr2-plan`; the feature branch + worktree get created in Task 0)

**Worktree:** `/Users/fangyong/vllm/modeldoctor/feat-benchmark-restructure-pr2`

---

## File Structure

### New files

#### Backend (`apps/api/src/modules/benchmark-template/`)

- `benchmark-template.controller.ts` — 5 endpoints, JWT-guarded, maps `JwtPayload` → `actor: { sub, isAdmin }`.
- `benchmark-template.controller.spec.ts` — auth-table tests + `isOfficial` gating + `update` body sanitization.
- `benchmark-template.service.ts` — CRUD with permission checks (ownership + isOfficial-create + scenario/tool validation via `applyScenarioConstraints`).
- `benchmark-template.service.spec.ts` — mocked repo, every business rule.

#### Backend (`apps/api/test/e2e/`)

- `benchmark-template.e2e-spec.ts` — admin + normal user lifecycle with real Postgres testcontainer.

#### Frontend (`apps/web/src/features/benchmarks/forms/`)

- `ToolParamsEditor.tsx` — extracted tool picker + per-tool params form + reset-on-tool-change. Drives both `BenchmarkCreatePage` (`paramsFieldName="params"`) and template forms (`paramsFieldName="config"`).
- `__tests__/ToolParamsEditor.test.tsx` — single/multi-tool render, tool switch resets correct field.

#### Frontend (`apps/web/src/features/benchmark-templates/`)

- `api.ts` — fetch wrappers (list/get/create/update/delete).
- `queries.ts` — react-query hooks.
- `TemplateListPage.tsx` — `/benchmark-templates`, scenario tabs + filters + grid.
- `TemplateCreatePage.tsx` — `/benchmark-templates/new`.
- `TemplateEditPage.tsx` — `/benchmark-templates/:id`.
- `TemplateForm.tsx` — shared form body for create + edit.
- `TemplateCard.tsx` — list item with `⋯` menu.
- `DeleteTemplateDialog.tsx` — delete confirmation.
- `__tests__/TemplateListPage.test.tsx`
- `__tests__/TemplateCreatePage.test.tsx`
- `__tests__/TemplateEditPage.test.tsx`

#### Frontend (`apps/web/src/locales/{zh-CN,en-US}/`)

- `benchmark-templates.json` — full bilingual i18n catalog for templates feature.

### Modified files

- `apps/api/src/modules/benchmark-template/benchmark-template.repository.ts` — extend skeleton (`findByIdOrNull` only) to full CRUD + filtered list with cursor pagination.
- `apps/api/src/modules/benchmark-template/benchmark-template.repository.spec.ts` — extend existing single-test placeholder to cover all new methods.
- `apps/api/src/modules/benchmark-template/benchmark-template.module.ts` — register controller + service.
- `apps/web/src/features/benchmarks/forms/GuidellmParamsForm.tsx` — accept `fieldPrefix?: "params" | "config"` prop, default `"params"`.
- `apps/web/src/features/benchmarks/forms/VegetaParamsForm.tsx` — same.
- `apps/web/src/features/benchmarks/forms/GenaiPerfParamsForm.tsx` — same.
- `apps/web/src/features/benchmarks/BenchmarkCreatePage.tsx` — replace inline tool/params section with `<ToolParamsEditor scenario={scenario} />` (paramsFieldName defaults to `"params"`).
- `apps/web/src/router/index.tsx` — add 3 routes for `/benchmark-templates*`.
- `apps/web/src/components/sidebar/sidebar-config.tsx` — replace placeholder comment on L57 with the actual entry.
- `apps/web/src/locales/zh-CN/sidebar.json` + `en-US/sidebar.json` — add `items.benchmarkTemplates` key.

---

## Task 0: Bootstrap PR2 worktree + branch

**Files:** None modified yet — this task creates the workspace.

- [ ] **Step 1: Create the worktree on a new branch off main**

```bash
git worktree add /Users/fangyong/vllm/modeldoctor/feat-benchmark-restructure-pr2 -b feat/benchmark-restructure-pr2 main
```

Expected output: `Preparing worktree (new branch 'feat/benchmark-restructure-pr2')`.

- [ ] **Step 2: Run `pnpm -r build` once to populate `packages/*/dist`**

Per memory `project_worktree_build_first.md`: a fresh worktree's `packages/*/dist` is empty; `apps/api` typecheck fails until built once.

```bash
cd /Users/fangyong/vllm/modeldoctor/feat-benchmark-restructure-pr2
pnpm -r build
```

Expected: all packages build green; `packages/contracts/dist` and `packages/tool-adapters/dist` populated.

- [ ] **Step 3: Verify the baseline is green**

```bash
pnpm -F @modeldoctor/api type-check
pnpm -F @modeldoctor/web type-check
```

Expected: both pass without errors.

- [ ] **Step 4: Copy the plan + spec into the new worktree (they were committed on different branches)**

The plan and spec live on main (already merged). Since the new worktree is on `feat/benchmark-restructure-pr2` cut from main, both files are already present. Verify:

```bash
ls docs/superpowers/specs/2026-05-05-benchmark-restructure-pr2-design.md
ls docs/superpowers/plans/2026-05-05-benchmark-restructure-pr2.md
```

Both should exist. (If the plan file is missing because it's still being written on a docs branch, copy it in via `cp ../main/docs/superpowers/plans/2026-05-05-benchmark-restructure-pr2.md docs/superpowers/plans/`.)

- [ ] **Step 5: No commit yet** — Task 1 starts the commit chain.

---

## Task 1: Extract `<ToolParamsEditor>` from `BenchmarkCreatePage`

**Goal:** Pure refactor. Pull the tool picker + params form section out of `BenchmarkCreatePage` into a reusable component parameterized on `paramsFieldName`. No behavior change for existing flow; existing `BenchmarkCreatePage.test.tsx` must stay green as the regression net.

**Files:**
- Create: `apps/web/src/features/benchmarks/forms/ToolParamsEditor.tsx`
- Create: `apps/web/src/features/benchmarks/__tests__/ToolParamsEditor.test.tsx`
- Modify: `apps/web/src/features/benchmarks/forms/GuidellmParamsForm.tsx` (add `fieldPrefix` prop)
- Modify: `apps/web/src/features/benchmarks/forms/VegetaParamsForm.tsx` (same)
- Modify: `apps/web/src/features/benchmarks/forms/GenaiPerfParamsForm.tsx` (same)
- Modify: `apps/web/src/features/benchmarks/BenchmarkCreatePage.tsx` (consume new component)

- [ ] **Step 1: Add `fieldPrefix` prop to `GuidellmParamsForm`**

In `GuidellmParamsForm.tsx`, change the signature and replace every literal `"params."` with a template using `fieldPrefix`. Keep default behavior identical (`fieldPrefix = "params"`).

```tsx
// Before:
export function GuidellmParamsForm() {
  const { register, setValue, control } = useFormContext();
  const profile = useWatch({ control, name: "params.profile" });
  ...
}

// After:
interface GuidellmParamsFormProps {
  fieldPrefix?: "params" | "config";
}

export function GuidellmParamsForm({ fieldPrefix = "params" }: GuidellmParamsFormProps = {}) {
  const { register, setValue, control } = useFormContext();
  const profile = useWatch({ control, name: `${fieldPrefix}.profile` });
  const apiType = useWatch({ control, name: `${fieldPrefix}.apiType` });
  const datasetName = useWatch({ control, name: `${fieldPrefix}.datasetName` });
  const validateBackend = useWatch({ control, name: `${fieldPrefix}.validateBackend` });
  ...
  // Every register / setValue call: replace "params.X" → `${fieldPrefix}.X`
  // Example:
  //   setValue("params.profile", v, { shouldValidate: true })
  // becomes:
  //   setValue(`${fieldPrefix}.profile`, v, { shouldValidate: true })
}
```

- [ ] **Step 2: Same change for `VegetaParamsForm.tsx`**

```tsx
interface VegetaParamsFormProps {
  fieldPrefix?: "params" | "config";
}
export function VegetaParamsForm({ fieldPrefix = "params" }: VegetaParamsFormProps = {}) {
  // … swap every literal "params.X" for `${fieldPrefix}.X`
}
```

- [ ] **Step 3: Same change for `GenaiPerfParamsForm.tsx`**

```tsx
interface GenaiPerfParamsFormProps {
  fieldPrefix?: "params" | "config";
}
export function GenaiPerfParamsForm({ fieldPrefix = "params" }: GenaiPerfParamsFormProps = {}) {
  // … swap every literal "params.X" for `${fieldPrefix}.X`
}
```

- [ ] **Step 4: Run existing BenchmarkCreatePage tests to confirm refactor didn't break anything**

```bash
pnpm -F @modeldoctor/web test -- BenchmarkCreatePage
```

Expected: PASS (default `fieldPrefix = "params"` keeps behavior identical).

- [ ] **Step 5: Write the failing test for `ToolParamsEditor`**

Create `apps/web/src/features/benchmarks/__tests__/ToolParamsEditor.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { type ReactNode } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";
import { ToolParamsEditor } from "../forms/ToolParamsEditor";

function Wrapper({ scenario, paramsFieldName, defaultValues, children }: {
  scenario: "inference" | "capacity" | "gateway";
  paramsFieldName: "params" | "config";
  defaultValues: Record<string, unknown>;
  children: ReactNode;
}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const form = useForm({ defaultValues });
  return (
    <QueryClientProvider client={qc}>
      <FormProvider {...form}>{children}</FormProvider>
    </QueryClientProvider>
  );
}

describe("ToolParamsEditor", () => {
  it("renders a readonly tool badge when scenario has a single tool (capacity)", () => {
    render(
      <Wrapper
        scenario="capacity"
        paramsFieldName="params"
        defaultValues={{ tool: "guidellm", params: {} }}
      >
        <ToolParamsEditor scenario="capacity" />
      </Wrapper>,
    );
    // capacity has only guidellm — no Select dropdown should be present
    expect(screen.queryByRole("combobox", { name: /tool/i })).toBeNull();
    expect(screen.getByText(/guidellm/i)).toBeInTheDocument();
  });

  it("renders a tool dropdown when scenario has multiple tools (inference)", () => {
    render(
      <Wrapper
        scenario="inference"
        paramsFieldName="params"
        defaultValues={{ tool: "guidellm", params: {} }}
      >
        <ToolParamsEditor scenario="inference" />
      </Wrapper>,
    );
    expect(screen.getByRole("combobox", { name: /tool/i })).toBeInTheDocument();
  });

  it("uses paramsFieldName='config' for register paths when prop is supplied", () => {
    // Smoke: just renders without error using config prefix.
    render(
      <Wrapper
        scenario="inference"
        paramsFieldName="config"
        defaultValues={{ tool: "guidellm", config: {} }}
      >
        <ToolParamsEditor scenario="inference" paramsFieldName="config" />
      </Wrapper>,
    );
    expect(screen.getByRole("combobox", { name: /tool/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run the test to verify it fails (component doesn't exist yet)**

```bash
pnpm -F @modeldoctor/web test -- ToolParamsEditor
```

Expected: FAIL with `Cannot find module '../forms/ToolParamsEditor'`.

- [ ] **Step 7: Implement `ToolParamsEditor.tsx`**

Create `apps/web/src/features/benchmarks/forms/ToolParamsEditor.tsx`:

```tsx
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ScenarioId } from "@modeldoctor/contracts";
import {
  genaiPerfParamDefaults,
  guidellmParamDefaults,
  vegetaParamDefaults,
} from "@modeldoctor/tool-adapters/schemas";
import type { ToolName } from "@modeldoctor/tool-adapters/schemas";
import { useId } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { GenaiPerfParamsForm } from "./GenaiPerfParamsForm";
import { GuidellmParamsForm } from "./GuidellmParamsForm";
import { VegetaParamsForm } from "./VegetaParamsForm";
import { SCENARIOS } from "../scenarios";

const TOOL_DEFAULTS: Record<ToolName, unknown> = {
  guidellm: guidellmParamDefaults,
  vegeta: vegetaParamDefaults,
  "genai-perf": genaiPerfParamDefaults,
};

export interface ToolParamsEditorProps {
  scenario: ScenarioId;
  /** Form field name where the tool's params live. Defaults to "params" so
   * existing BenchmarkCreatePage callers don't need to change. Template
   * forms pass "config" because that's the BenchmarkTemplate column name. */
  paramsFieldName?: "params" | "config";
}

export function ToolParamsEditor({
  scenario,
  paramsFieldName = "params",
}: ToolParamsEditorProps) {
  const { t } = useTranslation("benchmarks");
  const { control, reset, getValues } = useFormContext();
  const tool = (useWatch({ control, name: "tool" }) ??
    SCENARIOS[scenario].tools[0]) as ToolName;
  const id = useId();
  const toolFieldId = `${id}-tool`;

  const availableTools = SCENARIOS[scenario].tools;

  function handleToolChange(next: ToolName) {
    reset({
      ...getValues(),
      tool: next,
      [paramsFieldName]: TOOL_DEFAULTS[next] as Record<string, unknown>,
    });
  }

  const ParamsForm =
    tool === "guidellm"
      ? GuidellmParamsForm
      : tool === "vegeta"
        ? VegetaParamsForm
        : GenaiPerfParamsForm;

  return (
    <>
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t("create.sections.tool")}
        </h2>
        <div className="max-w-xs">
          <Label htmlFor={toolFieldId}>{t("create.fields.tool")}</Label>
          {availableTools.length > 1 ? (
            <Select value={tool} onValueChange={(v) => handleToolChange(v as ToolName)}>
              <SelectTrigger id={toolFieldId} aria-label="Tool">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableTools.map((tn) => (
                  <SelectItem key={tn} value={tn}>
                    {t(`create.tools.${tn}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div
              id={toolFieldId}
              aria-label="Tool"
              className="flex h-10 items-center rounded-md border border-input bg-muted px-3 text-sm"
            >
              {t(`create.tools.${tool}`)}
            </div>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t("create.sections.parameters")}
        </h2>
        <ParamsForm fieldPrefix={paramsFieldName} />
      </section>
    </>
  );
}
```

- [ ] **Step 8: Verify the new tests pass**

```bash
pnpm -F @modeldoctor/web test -- ToolParamsEditor
```

Expected: PASS (3 tests).

- [ ] **Step 9: Replace inline section in `BenchmarkCreatePage.tsx`**

In `BenchmarkCreatePage.tsx`:
- Remove imports: `GenaiPerfParamsForm`, `GuidellmParamsForm`, `VegetaParamsForm`, `useWatch` for tool, the `TOOL_DEFAULTS` constant, the `handleToolChange` helper, `ParamsForm` derivation, the `availableTools / defaultTool` early derivations of tool list.
- Add import: `import { ToolParamsEditor } from "./forms/ToolParamsEditor";`
- Keep `defaultTool = SCENARIOS[scenario].tools[0]` (still needed for form defaults).
- Replace the two `<section>` blocks (`create.sections.tool` and `create.sections.parameters`, lines ~199-259 currently) with:

```tsx
<ToolParamsEditor scenario={scenario} />
```

The form provider, scenario URL plumbing, name/description/connection sections, and submit handler stay untouched.

- [ ] **Step 10: Run BenchmarkCreatePage tests + ToolParamsEditor tests**

```bash
pnpm -F @modeldoctor/web test -- BenchmarkCreatePage ToolParamsEditor
```

Expected: all PASS.

- [ ] **Step 11: Type-check the entire web app**

```bash
pnpm -F @modeldoctor/web type-check
```

Expected: no errors.

- [ ] **Step 12: Commit**

```bash
git add apps/web/src/features/benchmarks/forms/ToolParamsEditor.tsx \
        apps/web/src/features/benchmarks/__tests__/ToolParamsEditor.test.tsx \
        apps/web/src/features/benchmarks/forms/GuidellmParamsForm.tsx \
        apps/web/src/features/benchmarks/forms/VegetaParamsForm.tsx \
        apps/web/src/features/benchmarks/forms/GenaiPerfParamsForm.tsx \
        apps/web/src/features/benchmarks/BenchmarkCreatePage.tsx
git commit -m "$(cat <<'EOF'
refactor(web): extract ToolParamsEditor from BenchmarkCreatePage

Pulls the tool picker + per-tool params form out into a reusable
component parameterized on paramsFieldName ("params" | "config") so
PR2 template forms can share the same UI. Sub-form components gain
a fieldPrefix prop with default "params" to keep existing callers
zero-diff.

addresses #94
refs #96

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Repository CRUD

**Goal:** Extend the PR1 skeleton's `findByIdOrNull` to a full CRUD repository with filtered cursor-paginated `list`. All tests run against the real local Postgres (not mocked) so we catch index/constraint regressions.

**Files:**
- Modify: `apps/api/src/modules/benchmark-template/benchmark-template.repository.ts`
- Modify: `apps/api/src/modules/benchmark-template/benchmark-template.repository.spec.ts`

- [ ] **Step 1: Write failing test for `create`**

Replace the existing single-test placeholder content with:

```ts
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaService } from "../../database/prisma.service.js";
import { BenchmarkTemplateRepository } from "./benchmark-template.repository.js";

describe("BenchmarkTemplateRepository", () => {
  let repo: BenchmarkTemplateRepository;
  let prisma: PrismaService;
  let userId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        BenchmarkTemplateRepository,
        PrismaService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === "DATABASE_URL" ? process.env.DATABASE_URL : undefined,
          },
        },
      ],
    }).compile();
    repo = moduleRef.get(BenchmarkTemplateRepository);
    prisma = moduleRef.get(PrismaService);

    // Owner row used as createdBy for FK
    const u = await prisma.user.create({
      data: {
        email: `repo-spec-${Date.now()}@example.com`,
        passwordHash: "x",
        roles: ["user"],
      },
    });
    userId = u.id;
  });

  beforeEach(async () => {
    await prisma.benchmarkTemplate.deleteMany({ where: { createdBy: userId } });
  });

  afterAll(async () => {
    await prisma.benchmarkTemplate.deleteMany({ where: { createdBy: userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("findByIdOrNull returns null for missing id", async () => {
    const result = await repo.findByIdOrNull("00000000-0000-0000-0000-000000000000");
    expect(result).toBeNull();
  });

  it("create persists a row with sensible defaults", async () => {
    const created = await repo.create({
      name: "My GuideLLM Template",
      description: "constant rate baseline",
      scenario: "inference",
      tool: "guidellm",
      config: { rateType: "constant", rate: 5 },
      createdBy: userId,
      tags: ["baseline", "qa"],
    });
    expect(created.id).toBeDefined();
    expect(created.isOfficial).toBe(false);
    expect(created.tags).toEqual(["baseline", "qa"]);
    expect(created.config).toEqual({ rateType: "constant", rate: 5 });

    const found = await repo.findByIdOrNull(created.id);
    expect(found).not.toBeNull();
    expect(found?.name).toBe("My GuideLLM Template");
  });
});
```

- [ ] **Step 2: Run the test to verify create fails**

```bash
pnpm -F @modeldoctor/api test -- benchmark-template.repository
```

Expected: FAIL with `repo.create is not a function`.

- [ ] **Step 3: Implement `create` + `findById` typing**

Replace `benchmark-template.repository.ts` content with:

```ts
import { Injectable } from "@nestjs/common";
import { Prisma, type BenchmarkTemplate as PrismaBenchmarkTemplate } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service.js";

export type CreateBenchmarkTemplateInput = {
  name: string;
  description?: string | null;
  scenario: string;
  tool: string;
  config: Prisma.InputJsonValue;
  isOfficial?: boolean;
  createdBy: string;
  tags?: string[];
};

export type UpdateBenchmarkTemplateInput = Partial<{
  name: string;
  description: string | null;
  config: Prisma.InputJsonValue;
  tags: string[];
}>;

export type ListBenchmarkTemplatesInput = {
  scenario?: string;
  tool?: string;
  isOfficial?: boolean;
  search?: string;
  cursor?: string;
  limit?: number;
};

@Injectable()
export class BenchmarkTemplateRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByIdOrNull(id: string): Promise<PrismaBenchmarkTemplate | null> {
    return this.prisma.benchmarkTemplate.findUnique({ where: { id } });
  }

  async create(input: CreateBenchmarkTemplateInput): Promise<PrismaBenchmarkTemplate> {
    return this.prisma.benchmarkTemplate.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        scenario: input.scenario,
        tool: input.tool,
        config: input.config,
        isOfficial: input.isOfficial ?? false,
        tags: input.tags ?? [],
        creator: { connect: { id: input.createdBy } },
      },
    });
  }
}
```

- [ ] **Step 4: Verify create test passes**

```bash
pnpm -F @modeldoctor/api test -- benchmark-template.repository
```

Expected: PASS (3 tests so far).

- [ ] **Step 5: Write failing tests for `update` and `delete`**

Append to the spec file:

```ts
  it("update mutates name/description/config/tags but not scenario/tool/isOfficial", async () => {
    const created = await repo.create({
      name: "v1",
      scenario: "inference",
      tool: "guidellm",
      config: { rateType: "constant", rate: 5 },
      createdBy: userId,
    });
    const before = created.updatedAt;
    await new Promise((r) => setTimeout(r, 10)); // ensure updatedAt advances
    const updated = await repo.update(created.id, {
      name: "v2",
      tags: ["promoted"],
      config: { rateType: "constant", rate: 10 },
    });
    expect(updated.name).toBe("v2");
    expect(updated.tags).toEqual(["promoted"]);
    expect(updated.config).toEqual({ rateType: "constant", rate: 10 });
    // Repository's UpdateInput type omits scenario/tool/isOfficial — invariant
    // is enforced at the type layer; we just confirm they survived unchanged.
    expect(updated.scenario).toBe("inference");
    expect(updated.tool).toBe("guidellm");
    expect(updated.isOfficial).toBe(false);
    expect(updated.updatedAt.getTime()).toBeGreaterThan(before.getTime());
  });

  it("delete removes the row", async () => {
    const created = await repo.create({
      name: "doomed",
      scenario: "inference",
      tool: "guidellm",
      config: {},
      createdBy: userId,
    });
    await repo.delete(created.id);
    expect(await repo.findByIdOrNull(created.id)).toBeNull();
  });

  it("deleting a template referenced by a benchmark sets benchmark.templateId to null", async () => {
    const tpl = await repo.create({
      name: "t",
      scenario: "inference",
      tool: "guidellm",
      config: { rateType: "constant", rate: 5 },
      createdBy: userId,
    });
    const conn = await prisma.connection.create({
      data: {
        userId,
        name: "c",
        baseUrl: "http://upstream/",
        apiKeyCipher: Buffer.from("x"),
        model: "m",
        category: "text",
      },
    });
    const bm = await prisma.benchmark.create({
      data: {
        userId,
        connectionId: conn.id,
        scenario: "inference",
        tool: "guidellm",
        driverKind: "local",
        params: {},
        templateId: tpl.id,
      },
    });
    await repo.delete(tpl.id);
    const reloaded = await prisma.benchmark.findUnique({ where: { id: bm.id } });
    expect(reloaded?.templateId).toBeNull();

    // cleanup
    await prisma.benchmark.delete({ where: { id: bm.id } });
    await prisma.connection.delete({ where: { id: conn.id } });
  });
```

- [ ] **Step 6: Run to verify fail**

```bash
pnpm -F @modeldoctor/api test -- benchmark-template.repository
```

Expected: FAIL with `repo.update is not a function` / `repo.delete is not a function`.

- [ ] **Step 7: Implement `update` and `delete`**

Append to `benchmark-template.repository.ts` (inside the class):

```ts
  async update(
    id: string,
    input: UpdateBenchmarkTemplateInput,
  ): Promise<PrismaBenchmarkTemplate> {
    return this.prisma.benchmarkTemplate.update({
      where: { id },
      data: input as Prisma.BenchmarkTemplateUpdateInput,
    });
  }

  async delete(id: string): Promise<PrismaBenchmarkTemplate> {
    return this.prisma.benchmarkTemplate.delete({ where: { id } });
  }
```

- [ ] **Step 8: Verify update + delete tests pass**

```bash
pnpm -F @modeldoctor/api test -- benchmark-template.repository
```

Expected: PASS (6 tests).

- [ ] **Step 9: Write failing test for `list` — filters and pagination**

Append:

```ts
  it("list returns rows ordered by isOfficial DESC, updatedAt DESC, id DESC", async () => {
    const a = await repo.create({
      name: "A user",
      scenario: "inference",
      tool: "guidellm",
      config: {},
      createdBy: userId,
    });
    await new Promise((r) => setTimeout(r, 10));
    const b = await repo.create({
      name: "B user",
      scenario: "inference",
      tool: "guidellm",
      config: {},
      createdBy: userId,
    });
    await new Promise((r) => setTimeout(r, 10));
    const off = await prisma.benchmarkTemplate.create({
      data: {
        name: "Official",
        scenario: "inference",
        tool: "guidellm",
        config: {},
        isOfficial: true,
        creator: { connect: { id: userId } },
      },
    });

    const res = await repo.list({ scenario: "inference" });
    const ids = res.items.map((r) => r.id);
    // Official first; then user rows by updatedAt DESC (b is newer than a)
    expect(ids[0]).toBe(off.id);
    expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id));
  });

  it("list filters by scenario", async () => {
    await repo.create({
      name: "inf",
      scenario: "inference",
      tool: "guidellm",
      config: {},
      createdBy: userId,
    });
    await repo.create({
      name: "cap",
      scenario: "capacity",
      tool: "guidellm",
      config: {},
      createdBy: userId,
    });
    const inf = await repo.list({ scenario: "inference" });
    expect(inf.items.every((r) => r.scenario === "inference")).toBe(true);
    expect(inf.items.some((r) => r.name === "inf")).toBe(true);
    expect(inf.items.some((r) => r.name === "cap")).toBe(false);
  });

  it("list filters by isOfficial", async () => {
    await prisma.benchmarkTemplate.create({
      data: {
        name: "off",
        scenario: "inference",
        tool: "guidellm",
        config: {},
        isOfficial: true,
        creator: { connect: { id: userId } },
      },
    });
    await repo.create({
      name: "personal",
      scenario: "inference",
      tool: "guidellm",
      config: {},
      createdBy: userId,
    });
    const officials = await repo.list({ isOfficial: true });
    expect(officials.items.every((r) => r.isOfficial)).toBe(true);
  });

  it("list filters by search (case-insensitive on name + description)", async () => {
    await repo.create({
      name: "Latency baseline",
      description: null,
      scenario: "inference",
      tool: "guidellm",
      config: {},
      createdBy: userId,
    });
    await repo.create({
      name: "Throughput peak",
      description: "for capacity planning",
      scenario: "capacity",
      tool: "guidellm",
      config: {},
      createdBy: userId,
    });
    const lat = await repo.list({ search: "lateNCY" });
    expect(lat.items.some((r) => r.name === "Latency baseline")).toBe(true);
    expect(lat.items.some((r) => r.name === "Throughput peak")).toBe(false);
    const cap = await repo.list({ search: "capacity" });
    expect(cap.items.some((r) => r.name === "Throughput peak")).toBe(true);
  });

  it("list paginates via cursor", async () => {
    for (let i = 0; i < 5; i++) {
      await repo.create({
        name: `p${i}`,
        scenario: "inference",
        tool: "guidellm",
        config: {},
        createdBy: userId,
      });
      await new Promise((r) => setTimeout(r, 5));
    }
    const page1 = await repo.list({ scenario: "inference", limit: 2 });
    expect(page1.items.length).toBe(2);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await repo.list({
      scenario: "inference",
      limit: 2,
      cursor: page1.nextCursor!,
    });
    expect(page2.items.length).toBe(2);
    expect(page2.items.map((r) => r.id)).not.toEqual(page1.items.map((r) => r.id));
  });
```

- [ ] **Step 10: Run to verify fail**

```bash
pnpm -F @modeldoctor/api test -- benchmark-template.repository
```

Expected: FAIL — `repo.list is not a function`.

- [ ] **Step 11: Implement `list`**

Append to `benchmark-template.repository.ts`:

```ts
  async list(input: ListBenchmarkTemplatesInput): Promise<{
    items: PrismaBenchmarkTemplate[];
    nextCursor: string | null;
  }> {
    const limit = Math.min(input.limit ?? 50, 100);
    const where: Prisma.BenchmarkTemplateWhereInput = {};
    if (input.scenario) where.scenario = input.scenario;
    if (input.tool) where.tool = input.tool;
    if (input.isOfficial !== undefined) where.isOfficial = input.isOfficial;
    if (input.search) {
      where.OR = [
        { name: { contains: input.search, mode: "insensitive" } },
        { description: { contains: input.search, mode: "insensitive" } },
      ];
    }

    const items = await this.prisma.benchmarkTemplate.findMany({
      where,
      orderBy: [{ isOfficial: "desc" }, { updatedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(input.cursor && { cursor: { id: input.cursor }, skip: 1 }),
    });

    const hasMore = items.length > limit;
    const sliced = hasMore ? items.slice(0, limit) : items;
    return {
      items: sliced,
      nextCursor: hasMore ? sliced[sliced.length - 1].id : null,
    };
  }
```

- [ ] **Step 12: Verify all repository tests pass**

```bash
pnpm -F @modeldoctor/api test -- benchmark-template.repository
```

Expected: all PASS.

- [ ] **Step 13: Type-check**

```bash
pnpm -F @modeldoctor/api type-check
```

Expected: no errors.

- [ ] **Step 14: Commit**

```bash
git add apps/api/src/modules/benchmark-template/benchmark-template.repository.ts \
        apps/api/src/modules/benchmark-template/benchmark-template.repository.spec.ts
git commit -m "$(cat <<'EOF'
feat(api): benchmark-template repository CRUD

Extends the PR1 findByIdOrNull skeleton to full create/list/update/delete
with cursor pagination. List orders by isOfficial DESC, updatedAt DESC,
id DESC so admin-curated templates always lead. Real-Postgres tests
cover filter combinations + the FK SetNull on benchmark.templateId.

addresses #94
refs #96

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Service with permission gating + scenario validation

**Goal:** Wrap the repository in a service that owns business rules: `isOfficial` create gating (admin only), ownership checks (owner-or-admin) for update/delete, and the same double-parse validation pattern as `BenchmarkService.create`.

**Files:**
- Create: `apps/api/src/modules/benchmark-template/benchmark-template.service.ts`
- Create: `apps/api/src/modules/benchmark-template/benchmark-template.service.spec.ts`

- [ ] **Step 1: Write failing tests for the happy paths and the permission rules**

Create `apps/api/src/modules/benchmark-template/benchmark-template.service.spec.ts`:

```ts
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type { BenchmarkTemplate as PrismaBenchmarkTemplate } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BenchmarkTemplateRepository } from "./benchmark-template.repository.js";
import { BenchmarkTemplateService } from "./benchmark-template.service.js";

vi.mock("@modeldoctor/tool-adapters", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    applyScenarioConstraints: () => ({ parse: (x: unknown) => x }),
    byTool: (name: string) => ({
      name,
      // guidellm supports inference + capacity, vegeta only gateway,
      // genai-perf only inference — matches the real adapter declarations.
      scenarios:
        name === "guidellm"
          ? ["inference", "capacity"]
          : name === "vegeta"
            ? ["gateway"]
            : ["inference"],
      paramsSchema: { parse: (x: unknown) => x },
    }),
  };
});

function makeRow(over: Partial<PrismaBenchmarkTemplate> = {}): PrismaBenchmarkTemplate {
  return {
    id: "tpl-1",
    name: "t",
    description: null,
    scenario: "inference",
    tool: "guidellm",
    config: {},
    isOfficial: false,
    createdBy: "owner-1",
    tags: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as PrismaBenchmarkTemplate;
}

function makeRepo(): BenchmarkTemplateRepository {
  return {
    findByIdOrNull: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
  } as unknown as BenchmarkTemplateRepository;
}

describe("BenchmarkTemplateService", () => {
  let svc: BenchmarkTemplateService;
  let repo: BenchmarkTemplateRepository;

  beforeEach(() => {
    repo = makeRepo();
    svc = new BenchmarkTemplateService(repo);
  });

  describe("create", () => {
    it("creates a non-official template for any authenticated user", async () => {
      (repo.create as ReturnType<typeof vi.fn>).mockResolvedValue(makeRow());
      const out = await svc.create(
        { sub: "user-2", isAdmin: false },
        {
          name: "t",
          scenario: "inference",
          tool: "guidellm",
          config: {},
          isOfficial: false,
          tags: [],
        },
      );
      expect(out.id).toBe("tpl-1");
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ isOfficial: false, createdBy: "user-2" }),
      );
    });

    it("rejects isOfficial=true from non-admin with BENCHMARK_TEMPLATE_OFFICIAL_FORBIDDEN", async () => {
      await expect(
        svc.create(
          { sub: "user-2", isAdmin: false },
          {
            name: "t",
            scenario: "inference",
            tool: "guidellm",
            config: {},
            isOfficial: true,
            tags: [],
          },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it("permits isOfficial=true from admin", async () => {
      (repo.create as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRow({ isOfficial: true }),
      );
      const out = await svc.create(
        { sub: "admin-1", isAdmin: true },
        {
          name: "Official",
          scenario: "inference",
          tool: "guidellm",
          config: {},
          isOfficial: true,
          tags: [],
        },
      );
      expect(out.isOfficial).toBe(true);
    });

    it("rejects scenario × tool mismatch with BENCHMARK_TEMPLATE_SCENARIO_TOOL_MISMATCH", async () => {
      await expect(
        svc.create(
          { sub: "user-2", isAdmin: false },
          {
            name: "t",
            scenario: "gateway", // gateway only supports vegeta
            tool: "guidellm",
            config: {},
            isOfficial: false,
            tags: [],
          },
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("update", () => {
    it("allows the owner to patch name/config", async () => {
      (repo.findByIdOrNull as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRow({ createdBy: "owner-1" }),
      );
      (repo.update as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRow({ name: "renamed" }),
      );
      const out = await svc.update(
        { sub: "owner-1", isAdmin: false },
        "tpl-1",
        { name: "renamed" },
      );
      expect(out.name).toBe("renamed");
    });

    it("allows admin to patch any template", async () => {
      (repo.findByIdOrNull as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRow({ createdBy: "owner-1" }),
      );
      (repo.update as ReturnType<typeof vi.fn>).mockResolvedValue(makeRow());
      await svc.update({ sub: "admin-1", isAdmin: true }, "tpl-1", { name: "x" });
      expect(repo.update).toHaveBeenCalled();
    });

    it("rejects non-owner non-admin with ForbiddenException", async () => {
      (repo.findByIdOrNull as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRow({ createdBy: "owner-1" }),
      );
      await expect(
        svc.update({ sub: "intruder", isAdmin: false }, "tpl-1", { name: "x" }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("returns 404 when template missing", async () => {
      (repo.findByIdOrNull as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      await expect(
        svc.update({ sub: "owner-1", isAdmin: false }, "missing", { name: "x" }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("delete", () => {
    it("allows owner to delete", async () => {
      (repo.findByIdOrNull as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRow({ createdBy: "owner-1" }),
      );
      await svc.delete({ sub: "owner-1", isAdmin: false }, "tpl-1");
      expect(repo.delete).toHaveBeenCalledWith("tpl-1");
    });

    it("rejects non-owner non-admin", async () => {
      (repo.findByIdOrNull as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRow({ createdBy: "owner-1" }),
      );
      await expect(
        svc.delete({ sub: "intruder", isAdmin: false }, "tpl-1"),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
```

- [ ] **Step 2: Verify tests fail**

```bash
pnpm -F @modeldoctor/api test -- benchmark-template.service
```

Expected: FAIL with `Cannot find module './benchmark-template.service.js'`.

- [ ] **Step 3: Implement the service**

Create `apps/api/src/modules/benchmark-template/benchmark-template.service.ts`:

```ts
import {
  type BenchmarkTemplate,
  type CreateBenchmarkTemplateRequest,
  type ListBenchmarkTemplatesQuery,
  type ListBenchmarkTemplatesResponse,
} from "@modeldoctor/contracts";
import { type ToolName, applyScenarioConstraints, byTool } from "@modeldoctor/tool-adapters";
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { BenchmarkTemplate as PrismaBenchmarkTemplate, Prisma } from "@prisma/client";
import {
  BenchmarkTemplateRepository,
  type UpdateBenchmarkTemplateInput,
} from "./benchmark-template.repository.js";

/**
 * Caller identity used for authorization decisions. The controller flattens
 * `JwtPayload` into this shape so the service stays test-friendly without
 * a JwtPayload import in tests.
 */
export interface TemplateActor {
  sub: string;
  isAdmin: boolean;
}

@Injectable()
export class BenchmarkTemplateService {
  constructor(private readonly repo: BenchmarkTemplateRepository) {}

  async list(query: ListBenchmarkTemplatesQuery): Promise<ListBenchmarkTemplatesResponse> {
    const result = await this.repo.list(query);
    return {
      items: result.items.map(toContract),
      nextCursor: result.nextCursor,
    };
  }

  async findByIdOrFail(id: string): Promise<BenchmarkTemplate> {
    const row = await this.repo.findByIdOrNull(id);
    if (!row) throw new NotFoundException(`BenchmarkTemplate ${id} not found`);
    return toContract(row);
  }

  async create(
    actor: TemplateActor,
    req: CreateBenchmarkTemplateRequest,
  ): Promise<BenchmarkTemplate> {
    if (req.isOfficial && !actor.isAdmin) {
      throw new ForbiddenException({
        code: "BENCHMARK_TEMPLATE_OFFICIAL_FORBIDDEN",
        message: "only admin can create official templates",
      });
    }
    this.assertScenarioToolPair(req.scenario, req.tool);
    this.validateConfig(req.scenario, req.tool, req.config);

    const row = await this.repo.create({
      name: req.name,
      description: req.description ?? null,
      scenario: req.scenario,
      tool: req.tool,
      config: req.config as Prisma.InputJsonValue,
      isOfficial: req.isOfficial ?? false,
      createdBy: actor.sub,
      tags: req.tags ?? [],
    });
    return toContract(row);
  }

  async update(
    actor: TemplateActor,
    id: string,
    patch: UpdateBenchmarkTemplateInput,
  ): Promise<BenchmarkTemplate> {
    const row = await this.repo.findByIdOrNull(id);
    if (!row) throw new NotFoundException(`BenchmarkTemplate ${id} not found`);
    this.assertCanWrite(actor, row);

    if (patch.config !== undefined) {
      this.validateConfig(row.scenario, row.tool, patch.config);
    }
    const updated = await this.repo.update(id, patch);
    return toContract(updated);
  }

  async delete(actor: TemplateActor, id: string): Promise<void> {
    const row = await this.repo.findByIdOrNull(id);
    if (!row) throw new NotFoundException(`BenchmarkTemplate ${id} not found`);
    this.assertCanWrite(actor, row);
    await this.repo.delete(id);
  }

  private assertCanWrite(actor: TemplateActor, row: PrismaBenchmarkTemplate): void {
    if (actor.isAdmin) return;
    if (row.createdBy === actor.sub) return;
    throw new ForbiddenException({
      code: "BENCHMARK_TEMPLATE_FORBIDDEN",
      message: "only the template owner or an admin can modify this template",
    });
  }

  private assertScenarioToolPair(scenario: string, tool: string): void {
    const adapter = byTool(tool as ToolName);
    if (!(adapter.scenarios as readonly string[]).includes(scenario)) {
      throw new BadRequestException({
        code: "BENCHMARK_TEMPLATE_SCENARIO_TOOL_MISMATCH",
        message: `scenario '${scenario}' does not support tool '${tool}'`,
      });
    }
  }

  private validateConfig(scenario: string, tool: string, config: unknown): void {
    try {
      // Same double-parse pattern as BenchmarkService.create:
      // 1) scenario-narrowed schema (e.g. capacity forces rateType=sweep)
      // 2) adapter base schema (preserves cross-field superRefine rules
      //    that applyScenarioConstraints unwraps)
      applyScenarioConstraints(scenario as Parameters<typeof applyScenarioConstraints>[0], tool as ToolName).parse(config);
      byTool(tool as ToolName).paramsSchema.parse(config);
    } catch (e) {
      throw new BadRequestException({
        code: "BENCHMARK_TEMPLATE_CONFIG_INVALID",
        message: `config validation failed: ${(e as Error).message}`,
      });
    }
  }
}

function toContract(row: PrismaBenchmarkTemplate): BenchmarkTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    scenario: row.scenario as BenchmarkTemplate["scenario"],
    tool: row.tool as BenchmarkTemplate["tool"],
    config: row.config as Record<string, unknown>,
    isOfficial: row.isOfficial,
    createdBy: row.createdBy,
    tags: row.tags,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
```

- [ ] **Step 4: Verify tests pass**

```bash
pnpm -F @modeldoctor/api test -- benchmark-template.service
```

Expected: PASS.

- [ ] **Step 5: Type-check**

```bash
pnpm -F @modeldoctor/api type-check
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/benchmark-template/benchmark-template.service.ts \
        apps/api/src/modules/benchmark-template/benchmark-template.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(api): benchmark-template service with scenario/tool validation

Adds CRUD service with permission gating: isOfficial-on-create requires
admin; update/delete require owner or admin. Validates (scenario, tool)
pair via adapter.scenarios and config via the BenchmarkService.create
double-parse pattern (applyScenarioConstraints + adapter.paramsSchema)
so cross-field superRefine rules survive scenario narrowing.

addresses #94
refs #96

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Controller with permission gating

**Goal:** Thin REST surface that maps `JwtPayload` → `TemplateActor`, validates body via zod, sanitizes the PATCH body to drop `scenario / tool / isOfficial`, and delegates to service. Wire controller + service into the module.

**Files:**
- Create: `apps/api/src/modules/benchmark-template/benchmark-template.controller.ts`
- Create: `apps/api/src/modules/benchmark-template/benchmark-template.controller.spec.ts`
- Modify: `apps/api/src/modules/benchmark-template/benchmark-template.module.ts`

- [ ] **Step 1: Write failing controller spec covering the auth table**

Create `apps/api/src/modules/benchmark-template/benchmark-template.controller.spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { BenchmarkTemplateController } from "./benchmark-template.controller.js";
import { BenchmarkTemplateService } from "./benchmark-template.service.js";

const mockService = {
  list: vi.fn(),
  findByIdOrFail: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

describe("BenchmarkTemplateController", () => {
  let controller: BenchmarkTemplateController;

  beforeEach(async () => {
    vi.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [BenchmarkTemplateController],
      providers: [{ provide: BenchmarkTemplateService, useValue: mockService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(BenchmarkTemplateController);
  });

  it("list delegates to service.list with parsed query", async () => {
    mockService.list.mockResolvedValue({ items: [], nextCursor: null });
    const out = await controller.list(
      { scenario: "inference", limit: 50 } as never,
    );
    expect(out).toEqual({ items: [], nextCursor: null });
    expect(mockService.list).toHaveBeenCalledWith({ scenario: "inference", limit: 50 });
  });

  it("create maps JwtPayload → TemplateActor (non-admin)", async () => {
    mockService.create.mockResolvedValue({ id: "t1" });
    await controller.create(
      { sub: "user-1", email: "u@x", roles: ["user"] },
      {
        name: "t",
        scenario: "inference",
        tool: "guidellm",
        config: {},
        isOfficial: false,
        tags: [],
      },
    );
    expect(mockService.create).toHaveBeenCalledWith(
      { sub: "user-1", isAdmin: false },
      expect.objectContaining({ name: "t" }),
    );
  });

  it("create maps admin role correctly", async () => {
    mockService.create.mockResolvedValue({ id: "t1" });
    await controller.create(
      { sub: "admin-1", email: "a@x", roles: ["admin"] },
      {
        name: "t",
        scenario: "inference",
        tool: "guidellm",
        config: {},
        isOfficial: true,
        tags: [],
      },
    );
    expect(mockService.create).toHaveBeenCalledWith(
      { sub: "admin-1", isAdmin: true },
      expect.objectContaining({ isOfficial: true }),
    );
  });

  it("update strips isOfficial / scenario / tool from PATCH body before service call", async () => {
    mockService.update.mockResolvedValue({ id: "t1" });
    await controller.update(
      { sub: "owner-1", email: "o@x", roles: ["user"] },
      "t1",
      // The schema should already omit these — assert what reaches service
      { name: "renamed", description: "d" } as never,
    );
    const [, , patchArg] = mockService.update.mock.calls[0];
    expect(patchArg).not.toHaveProperty("scenario");
    expect(patchArg).not.toHaveProperty("tool");
    expect(patchArg).not.toHaveProperty("isOfficial");
    expect(patchArg).toEqual(expect.objectContaining({ name: "renamed" }));
  });

  it("delete returns void (204) and forwards actor", async () => {
    mockService.delete.mockResolvedValue(undefined);
    await controller.delete(
      { sub: "owner-1", email: "o@x", roles: ["user"] },
      "t1",
    );
    expect(mockService.delete).toHaveBeenCalledWith(
      { sub: "owner-1", isAdmin: false },
      "t1",
    );
  });
});
```

- [ ] **Step 2: Verify tests fail**

```bash
pnpm -F @modeldoctor/api test -- benchmark-template.controller
```

Expected: FAIL — `Cannot find module './benchmark-template.controller.js'`.

- [ ] **Step 3: Implement the controller**

Create `apps/api/src/modules/benchmark-template/benchmark-template.controller.ts`:

```ts
import {
  type BenchmarkTemplate,
  type CreateBenchmarkTemplateRequest,
  type ListBenchmarkTemplatesQuery,
  type ListBenchmarkTemplatesResponse,
  createBenchmarkTemplateRequestSchema,
  listBenchmarkTemplatesQuerySchema,
  updateBenchmarkTemplateRequestSchema,
} from "@modeldoctor/contracts";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import {
  BenchmarkTemplateService,
  type TemplateActor,
} from "./benchmark-template.service.js";

// PATCH body schema: drop isOfficial (immutable post-create) + scenario/tool
// (changing these would invalidate the stored config). Anything the client
// sends in these fields is stripped here, never reaches the service.
const patchSchema = updateBenchmarkTemplateRequestSchema.omit({
  isOfficial: true,
  scenario: true,
  tool: true,
});

function actorFrom(user: JwtPayload): TemplateActor {
  return { sub: user.sub, isAdmin: user.roles.includes("admin") };
}

@Controller("benchmark-templates")
@UseGuards(JwtAuthGuard)
export class BenchmarkTemplateController {
  constructor(private readonly service: BenchmarkTemplateService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(listBenchmarkTemplatesQuerySchema))
    query: ListBenchmarkTemplatesQuery,
  ): Promise<ListBenchmarkTemplatesResponse> {
    return this.service.list(query);
  }

  @Get(":id")
  detail(@Param("id") id: string): Promise<BenchmarkTemplate> {
    return this.service.findByIdOrFail(id);
  }

  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(createBenchmarkTemplateRequestSchema))
    body: CreateBenchmarkTemplateRequest,
  ): Promise<BenchmarkTemplate> {
    return this.service.create(actorFrom(user), body);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(patchSchema)) body: Record<string, unknown>,
  ): Promise<BenchmarkTemplate> {
    return this.service.update(actorFrom(user), id, body);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@CurrentUser() user: JwtPayload, @Param("id") id: string): Promise<void> {
    await this.service.delete(actorFrom(user), id);
  }
}
```

- [ ] **Step 4: Update module to register controller + service**

Replace `apps/api/src/modules/benchmark-template/benchmark-template.module.ts` content with:

```ts
import { Module } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service.js";
import { BenchmarkTemplateController } from "./benchmark-template.controller.js";
import { BenchmarkTemplateRepository } from "./benchmark-template.repository.js";
import { BenchmarkTemplateService } from "./benchmark-template.service.js";

@Module({
  controllers: [BenchmarkTemplateController],
  providers: [PrismaService, BenchmarkTemplateRepository, BenchmarkTemplateService],
  exports: [BenchmarkTemplateRepository, BenchmarkTemplateService],
})
export class BenchmarkTemplateModule {}
```

- [ ] **Step 5: Verify controller tests pass**

```bash
pnpm -F @modeldoctor/api test -- benchmark-template.controller
```

Expected: PASS.

- [ ] **Step 6: Run module + service + repository tests together to ensure DI graph still wires**

```bash
pnpm -F @modeldoctor/api test -- benchmark-template
```

Expected: all PASS (controller + service + repository).

- [ ] **Step 7: Type-check + lint**

```bash
pnpm -F @modeldoctor/api type-check
pnpm -F @modeldoctor/api lint
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/benchmark-template/benchmark-template.controller.ts \
        apps/api/src/modules/benchmark-template/benchmark-template.controller.spec.ts \
        apps/api/src/modules/benchmark-template/benchmark-template.module.ts
git commit -m "$(cat <<'EOF'
feat(api): benchmark-template controller with permission gating

Wires 5 endpoints (list/detail/create/update/delete) under
/api/benchmark-templates. Maps JwtPayload to TemplateActor and
delegates permission decisions to the service. PATCH body schema
omits isOfficial/scenario/tool so client-supplied values for those
fields are stripped before the service ever sees them — defense
in depth for the immutability invariant.

addresses #94
refs #96

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: e2e spec — admin + owner permissions

**Goal:** End-to-end coverage with two real registered users (first = admin via the auth-bootstrap rule, second = normal). Verifies the full HTTP surface, JWT round-trip, and the FK-SetNull relationship with benchmarks.

**Files:**
- Create: `apps/api/test/e2e/benchmark-template.e2e-spec.ts`

- [ ] **Step 1: Write the e2e spec**

Create `apps/api/test/e2e/benchmark-template.e2e-spec.ts`:

```ts
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../../src/database/prisma.service.js";
import { type E2EContext, bootE2E, registerUser } from "../helpers/app.js";

describe("BenchmarkTemplate (e2e)", () => {
  let ctx: E2EContext;
  let adminToken: string;
  let userToken: string;
  let adminId: string;
  let userId: string;

  beforeAll(async () => {
    ctx = await bootE2E();
    // Wipe so the first registration becomes the admin
    const prisma = ctx.app.get(PrismaService);
    await prisma.benchmarkTemplate.deleteMany();
    await prisma.benchmark.deleteMany();
    await prisma.connection.deleteMany();
    await prisma.user.deleteMany();

    const admin = await registerUser(ctx.app, "admin@example.com", "Password1!");
    adminToken = admin.token;
    adminId = admin.user.id;
    expect(admin.user.roles).toContain("admin");

    const user = await registerUser(ctx.app, "user@example.com", "Password1!");
    userToken = user.token;
    userId = user.user.id;
    expect(user.user.roles).not.toContain("admin");
  }, 120_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  it("admin can create an official template", async () => {
    const res = await request(ctx.app.getHttpServer())
      .post("/api/benchmark-templates")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Inference baseline",
        scenario: "inference",
        tool: "guidellm",
        config: { rateType: "constant", rate: 5 },
        isOfficial: true,
        tags: ["baseline"],
      });
    expect(res.status).toBe(201);
    expect(res.body.isOfficial).toBe(true);
    expect(res.body.createdBy).toBe(adminId);
  });

  it("non-admin gets 403 attempting isOfficial=true", async () => {
    const res = await request(ctx.app.getHttpServer())
      .post("/api/benchmark-templates")
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        name: "fake official",
        scenario: "inference",
        tool: "guidellm",
        config: { rateType: "constant", rate: 5 },
        isOfficial: true,
        tags: [],
      });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("BENCHMARK_TEMPLATE_OFFICIAL_FORBIDDEN");
  });

  it("non-admin can create a personal template", async () => {
    const res = await request(ctx.app.getHttpServer())
      .post("/api/benchmark-templates")
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        name: "My personal config",
        scenario: "inference",
        tool: "guidellm",
        config: { rateType: "constant", rate: 5 },
        isOfficial: false,
        tags: ["personal"],
      });
    expect(res.status).toBe(201);
    expect(res.body.isOfficial).toBe(false);
    expect(res.body.createdBy).toBe(userId);
  });

  it("any authenticated user can list — official first", async () => {
    const res = await request(ctx.app.getHttpServer())
      .get("/api/benchmark-templates?scenario=inference")
      .set("Authorization", `Bearer ${userToken}`);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(2);
    expect(res.body.items[0].isOfficial).toBe(true);
  });

  it("non-owner non-admin cannot edit a foreign template", async () => {
    // Find admin's official template
    const list = await request(ctx.app.getHttpServer())
      .get("/api/benchmark-templates?isOfficial=true")
      .set("Authorization", `Bearer ${userToken}`);
    const officialId = list.body.items[0].id;

    const res = await request(ctx.app.getHttpServer())
      .patch(`/api/benchmark-templates/${officialId}`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({ name: "hijacked" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("BENCHMARK_TEMPLATE_FORBIDDEN");
  });

  it("PATCH strips isOfficial/scenario/tool from body", async () => {
    const list = await request(ctx.app.getHttpServer())
      .get("/api/benchmark-templates?isOfficial=false")
      .set("Authorization", `Bearer ${userToken}`);
    const personalId = list.body.items.find(
      (t: { createdBy: string }) => t.createdBy === userId,
    ).id;

    const res = await request(ctx.app.getHttpServer())
      .patch(`/api/benchmark-templates/${personalId}`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        name: "renamed",
        // These three should be silently stripped by the schema
        isOfficial: true,
        scenario: "capacity",
        tool: "vegeta",
      });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("renamed");
    expect(res.body.isOfficial).toBe(false); // unchanged
    expect(res.body.scenario).toBe("inference"); // unchanged
    expect(res.body.tool).toBe("guidellm"); // unchanged
  });

  it("owner can delete their template", async () => {
    const created = await request(ctx.app.getHttpServer())
      .post("/api/benchmark-templates")
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        name: "doomed",
        scenario: "inference",
        tool: "guidellm",
        config: {},
        isOfficial: false,
        tags: [],
      });
    const res = await request(ctx.app.getHttpServer())
      .delete(`/api/benchmark-templates/${created.body.id}`)
      .set("Authorization", `Bearer ${userToken}`);
    expect(res.status).toBe(204);

    const after = await request(ctx.app.getHttpServer())
      .get(`/api/benchmark-templates/${created.body.id}`)
      .set("Authorization", `Bearer ${userToken}`);
    expect(after.status).toBe(404);
  });

  it("(scenario, tool) mismatch surfaces a 400 with explicit code", async () => {
    const res = await request(ctx.app.getHttpServer())
      .post("/api/benchmark-templates")
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        name: "bad pair",
        scenario: "gateway",
        tool: "guidellm", // gateway only supports vegeta
        config: {},
        isOfficial: false,
        tags: [],
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BENCHMARK_TEMPLATE_SCENARIO_TOOL_MISMATCH");
  });
});
```

- [ ] **Step 2: Run the e2e spec**

```bash
pnpm -F @modeldoctor/api test -- benchmark-template.e2e
```

Expected: PASS (all 8 it blocks).

- [ ] **Step 3: Run the full e2e suite to confirm we didn't break siblings**

```bash
pnpm -F @modeldoctor/api test:e2e 2>/dev/null || pnpm -F @modeldoctor/api test -- e2e
```

(Use whichever script the repo defines; check `apps/api/package.json` "scripts".)

Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/e2e/benchmark-template.e2e-spec.ts
git commit -m "$(cat <<'EOF'
test(api): benchmark-template e2e covering admin+owner permissions

Bootstraps two real users (first → admin, second → normal) and
walks the full HTTP surface: official-create gating, owner edit
allowed, foreign edit forbidden, PATCH body sanitization, and
the (scenario, tool) mismatch guard. Confirms response error
codes match the spec contract so client UIs can switch on them.

addresses #94
refs #96

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Frontend api + queries layer + i18n catalog

**Goal:** Set up the data plane for the templates feature: typed fetch wrappers, react-query hooks with cache invalidation, and the bilingual i18n catalog so subsequent UI tasks can use `t()` keys without ad-hoc placeholders.

**Files:**
- Create: `apps/web/src/features/benchmark-templates/api.ts`
- Create: `apps/web/src/features/benchmark-templates/queries.ts`
- Create: `apps/web/src/locales/zh-CN/benchmark-templates.json`
- Create: `apps/web/src/locales/en-US/benchmark-templates.json`
- Modify: `apps/web/src/lib/i18n.ts` (register the new namespace)

- [ ] **Step 1: Implement `api.ts`**

Create `apps/web/src/features/benchmark-templates/api.ts`:

```ts
import { apiFetch } from "@/lib/api";
import type {
  BenchmarkTemplate,
  CreateBenchmarkTemplateRequest,
  ListBenchmarkTemplatesQuery,
  ListBenchmarkTemplatesResponse,
  UpdateBenchmarkTemplateRequest,
} from "@modeldoctor/contracts";

export async function listTemplates(
  query: ListBenchmarkTemplatesQuery = { limit: 50 },
): Promise<ListBenchmarkTemplatesResponse> {
  const params = new URLSearchParams();
  if (query.scenario) params.set("scenario", query.scenario);
  if (query.tool) params.set("tool", query.tool);
  if (query.isOfficial !== undefined) params.set("isOfficial", String(query.isOfficial));
  if (query.search) params.set("search", query.search);
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.limit) params.set("limit", String(query.limit));
  const qs = params.toString();
  return apiFetch<ListBenchmarkTemplatesResponse>(
    `/benchmark-templates${qs ? `?${qs}` : ""}`,
  );
}

export async function getTemplate(id: string): Promise<BenchmarkTemplate> {
  return apiFetch<BenchmarkTemplate>(`/benchmark-templates/${id}`);
}

export async function createTemplate(
  body: CreateBenchmarkTemplateRequest,
): Promise<BenchmarkTemplate> {
  return apiFetch<BenchmarkTemplate>(`/benchmark-templates`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateTemplate(
  id: string,
  body: Partial<UpdateBenchmarkTemplateRequest>,
): Promise<BenchmarkTemplate> {
  return apiFetch<BenchmarkTemplate>(`/benchmark-templates/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteTemplate(id: string): Promise<void> {
  await apiFetch<void>(`/benchmark-templates/${id}`, { method: "DELETE" });
}
```

(If `@/lib/api` does not exist, search for the existing fetch wrapper used by `apps/web/src/features/benchmarks/api.ts` and import it the same way.)

- [ ] **Step 2: Implement `queries.ts`**

Create `apps/web/src/features/benchmark-templates/queries.ts`:

```ts
import type {
  BenchmarkTemplate,
  CreateBenchmarkTemplateRequest,
  ListBenchmarkTemplatesQuery,
  ListBenchmarkTemplatesResponse,
  UpdateBenchmarkTemplateRequest,
} from "@modeldoctor/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createTemplate,
  deleteTemplate,
  getTemplate,
  listTemplates,
  updateTemplate,
} from "./api";

const KEYS = {
  all: ["benchmark-templates"] as const,
  list: (query: ListBenchmarkTemplatesQuery) => [...KEYS.all, "list", query] as const,
  detail: (id: string) => [...KEYS.all, "detail", id] as const,
};

export function useTemplates(query: ListBenchmarkTemplatesQuery = { limit: 50 }) {
  return useQuery<ListBenchmarkTemplatesResponse>({
    queryKey: KEYS.list(query),
    queryFn: () => listTemplates(query),
  });
}

export function useTemplate(id: string | undefined) {
  return useQuery<BenchmarkTemplate>({
    queryKey: KEYS.detail(id ?? ""),
    queryFn: () => getTemplate(id!),
    enabled: Boolean(id),
  });
}

export function useCreateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateBenchmarkTemplateRequest) => createTemplate(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.all }),
  });
}

export function useUpdateTemplate(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<UpdateBenchmarkTemplateRequest>) => updateTemplate(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.detail(id) });
      qc.invalidateQueries({ queryKey: KEYS.all });
    },
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteTemplate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.all }),
  });
}
```

- [ ] **Step 3: Write the bilingual i18n catalog**

Create `apps/web/src/locales/zh-CN/benchmark-templates.json`:

```json
{
  "title": "测试模板",
  "subtitle": "管理跨连接复用的基准测试配置",
  "actions": {
    "new": "新建模板",
    "edit": "编辑",
    "delete": "删除",
    "save": "保存",
    "cancel": "取消",
    "back": "返回列表"
  },
  "list": {
    "tabs": {
      "inference": "推理性能基准",
      "capacity": "容量规划",
      "gateway": "网关压测"
    },
    "filters": {
      "search": "按名称或描述搜索…",
      "officialOnly": "仅官方"
    },
    "official": "官方",
    "createdAt": "创建于 {{when}}",
    "updatedAt": "更新于 {{when}}",
    "by": "by {{name}}",
    "empty": {
      "title": "还没有模板",
      "subtitle": "为该场景创建第一个模板"
    }
  },
  "create": {
    "title": "新建模板",
    "subtitle": "保存一份可复用的 benchmark 配置",
    "sections": {
      "basic": "基本信息",
      "scenario": "测试场景",
      "official": "可见性"
    },
    "fields": {
      "name": "名称",
      "namePlaceholder": "例:推理基线短文本",
      "description": "描述",
      "tags": "标签",
      "tagsPlaceholder": "回车添加",
      "scenario": "场景",
      "isOfficial": "标记为官方模板"
    },
    "officialHint": "仅管理员可见。官方模板创建后不可修改 isOfficial 字段。",
    "submitted": "模板「{{name}}」创建成功",
    "errors": {
      "submitFailed": "创建失败"
    }
  },
  "edit": {
    "title": "编辑模板",
    "subtitle": "name / description / config / tags 可修改;scenario / tool / 是否官方不可改",
    "readonlyBanner": "你不是此模板的所有者,无法编辑",
    "saved": "已保存",
    "deleteConfirm": {
      "title": "删除模板「{{name}}」?",
      "body": "此操作不可撤销。已经引用此模板的 benchmark 不会被影响,只是 templateId 会被置空。",
      "confirm": "确认删除",
      "cancel": "取消"
    },
    "deleted": "模板已删除",
    "errors": {
      "saveFailed": "保存失败",
      "deleteFailed": "删除失败"
    }
  }
}
```

Create `apps/web/src/locales/en-US/benchmark-templates.json`:

```json
{
  "title": "Test Templates",
  "subtitle": "Manage reusable benchmark configurations across connections",
  "actions": {
    "new": "New template",
    "edit": "Edit",
    "delete": "Delete",
    "save": "Save",
    "cancel": "Cancel",
    "back": "Back to list"
  },
  "list": {
    "tabs": {
      "inference": "Inference benchmark",
      "capacity": "Capacity planning",
      "gateway": "Gateway load test"
    },
    "filters": {
      "search": "Search name or description…",
      "officialOnly": "Official only"
    },
    "official": "Official",
    "createdAt": "Created {{when}}",
    "updatedAt": "Updated {{when}}",
    "by": "by {{name}}",
    "empty": {
      "title": "No templates yet",
      "subtitle": "Create the first template for this scenario"
    }
  },
  "create": {
    "title": "New template",
    "subtitle": "Save a reusable benchmark configuration",
    "sections": {
      "basic": "Basic info",
      "scenario": "Scenario",
      "official": "Visibility"
    },
    "fields": {
      "name": "Name",
      "namePlaceholder": "e.g. Inference baseline (short text)",
      "description": "Description",
      "tags": "Tags",
      "tagsPlaceholder": "Press Enter to add",
      "scenario": "Scenario",
      "isOfficial": "Mark as official template"
    },
    "officialHint": "Admin only. The isOfficial field is immutable after creation.",
    "submitted": "Template '{{name}}' created",
    "errors": {
      "submitFailed": "Failed to create template"
    }
  },
  "edit": {
    "title": "Edit template",
    "subtitle": "name / description / config / tags are editable; scenario / tool / official flag are not",
    "readonlyBanner": "You are not the owner of this template — read-only view",
    "saved": "Saved",
    "deleteConfirm": {
      "title": "Delete template '{{name}}'?",
      "body": "Irreversible. Benchmarks already referencing this template are unaffected; their templateId will be set to NULL.",
      "confirm": "Delete",
      "cancel": "Cancel"
    },
    "deleted": "Template deleted",
    "errors": {
      "saveFailed": "Failed to save",
      "deleteFailed": "Failed to delete"
    }
  }
}
```

- [ ] **Step 4: Register the namespace in i18n config**

Open `apps/web/src/lib/i18n.ts`, find the resources block (search for `import .* sidebar.json`), and add `benchmarkTemplates` to both locales. Pattern matches existing entries — example shape:

```ts
import zhBenchmarkTemplates from "@/locales/zh-CN/benchmark-templates.json";
import enBenchmarkTemplates from "@/locales/en-US/benchmark-templates.json";

// inside the resources object, alongside existing namespaces:
"zh-CN": {
  ...,
  "benchmark-templates": zhBenchmarkTemplates,
},
"en-US": {
  ...,
  "benchmark-templates": enBenchmarkTemplates,
},
```

Also append `"benchmark-templates"` to the `ns:` array if one exists.

- [ ] **Step 5: Type-check**

```bash
pnpm -F @modeldoctor/web type-check
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/benchmark-templates/api.ts \
        apps/web/src/features/benchmark-templates/queries.ts \
        apps/web/src/locales/zh-CN/benchmark-templates.json \
        apps/web/src/locales/en-US/benchmark-templates.json \
        apps/web/src/lib/i18n.ts
git commit -m "$(cat <<'EOF'
feat(web): benchmark-templates queries + api layer

Adds typed fetch wrappers, react-query hooks with cache invalidation
keyed on ['benchmark-templates'], and the full bilingual i18n catalog
so subsequent UI tasks can drop t() keys without placeholders.

addresses #94
refs #96

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: TemplateListPage with scenario tabs + filters

**Goal:** Render the templates grid with three scenario tabs, official-first ordering, search filter, official-only toggle, ⋯ menu per card with edit/delete, and an empty state.

**Files:**
- Create: `apps/web/src/features/benchmark-templates/TemplateListPage.tsx`
- Create: `apps/web/src/features/benchmark-templates/TemplateCard.tsx`
- Create: `apps/web/src/features/benchmark-templates/DeleteTemplateDialog.tsx`
- Create: `apps/web/src/features/benchmark-templates/__tests__/TemplateListPage.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/benchmark-templates/__tests__/TemplateListPage.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("../queries", () => ({
  useTemplates: vi.fn(),
  useDeleteTemplate: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/features/auth/queries", () => ({
  useCurrentUser: () => ({ data: { id: "user-1", roles: ["user"] } }),
}));

import { useTemplates } from "../queries";
import { TemplateListPage } from "../TemplateListPage";

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("TemplateListPage", () => {
  it("renders official badge for official templates and orders official first", async () => {
    (useTemplates as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        items: [
          {
            id: "off",
            name: "Official",
            isOfficial: true,
            scenario: "inference",
            tool: "guidellm",
            createdBy: "admin-1",
            tags: [],
            updatedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            description: null,
            config: {},
          },
          {
            id: "mine",
            name: "Mine",
            isOfficial: false,
            scenario: "inference",
            tool: "guidellm",
            createdBy: "user-1",
            tags: [],
            updatedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            description: null,
            config: {},
          },
        ],
        nextCursor: null,
      },
      isLoading: false,
    });
    render(
      <Wrapper>
        <TemplateListPage />
      </Wrapper>,
    );
    await waitFor(() => expect(screen.getByText("Official")).toBeInTheDocument());
    expect(screen.getByText("Mine")).toBeInTheDocument();
    // Order: Official appears before Mine in the DOM
    const html = document.body.innerHTML;
    expect(html.indexOf("Official")).toBeLessThan(html.indexOf("Mine"));
  });

  it("shows empty-state copy when items array is empty", () => {
    (useTemplates as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { items: [], nextCursor: null },
      isLoading: false,
    });
    render(
      <Wrapper>
        <TemplateListPage />
      </Wrapper>,
    );
    // Translation key fallback or text — test with the i18n key path
    expect(
      screen.getByText(/no templates yet|还没有模板/i),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Verify test fails**

```bash
pnpm -F @modeldoctor/web test -- TemplateListPage
```

Expected: FAIL — `Cannot find module '../TemplateListPage'`.

- [ ] **Step 3: Implement `TemplateCard.tsx`**

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
    <div className="group relative rounded-lg border border-border bg-card p-4 transition hover:border-primary/40">
      <Link to={`/benchmark-templates/${template.id}`} className="block space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {template.isOfficial && <ShieldCheck className="h-4 w-4 text-primary" aria-hidden />}
            <h3 className="truncate text-sm font-semibold">{template.name}</h3>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className="text-xs">
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
        <p className="line-clamp-2 text-xs text-muted-foreground">
          {template.description || ""}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("list.updatedAt", {
            when: new Date(template.updatedAt).toLocaleString(),
          })}
        </p>
      </Link>
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

- [ ] **Step 4: Implement `DeleteTemplateDialog.tsx`**

```tsx
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { BenchmarkTemplate } from "@modeldoctor/contracts";
import { useTranslation } from "react-i18next";

export interface DeleteTemplateDialogProps {
  template: BenchmarkTemplate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  pending: boolean;
}

export function DeleteTemplateDialog({
  template,
  open,
  onOpenChange,
  onConfirm,
  pending,
}: DeleteTemplateDialogProps) {
  const { t } = useTranslation("benchmark-templates");
  if (!template) return null;
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("edit.deleteConfirm.title", { name: template.name })}
          </AlertDialogTitle>
          <AlertDialogDescription>{t("edit.deleteConfirm.body")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("edit.deleteConfirm.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={onConfirm}
            className="bg-destructive hover:bg-destructive/90"
          >
            {t("edit.deleteConfirm.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 5: Implement `TemplateListPage.tsx`**

```tsx
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCurrentUser } from "@/features/auth/queries";
import type { BenchmarkTemplate, ScenarioId } from "@modeldoctor/contracts";
import { Plus } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { DeleteTemplateDialog } from "./DeleteTemplateDialog";
import { TemplateCard } from "./TemplateCard";
import { useDeleteTemplate, useTemplates } from "./queries";

const SCENARIO_TABS: { id: ScenarioId; labelKey: string }[] = [
  { id: "inference", labelKey: "list.tabs.inference" },
  { id: "capacity", labelKey: "list.tabs.capacity" },
  { id: "gateway", labelKey: "list.tabs.gateway" },
];

export function TemplateListPage() {
  const { t } = useTranslation("benchmark-templates");
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const idPrefix = useId();
  const searchId = `${idPrefix}-search`;
  const officialId = `${idPrefix}-official`;

  const scenario = (params.get("scenario") as ScenarioId) || "inference";
  const officialOnly = params.get("isOfficial") === "true";
  const search = params.get("search") ?? "";

  const { data, isLoading } = useTemplates({
    scenario,
    isOfficial: officialOnly || undefined,
    search: search || undefined,
    limit: 50,
  });
  const deleteMut = useDeleteTemplate();
  const me = useCurrentUser();
  const myId = me.data?.id;
  const isAdmin = (me.data?.roles ?? []).includes("admin");

  const [pendingDelete, setPendingDelete] = useState<BenchmarkTemplate | null>(null);

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
    setParams(next);
  }

  async function handleConfirmDelete() {
    if (!pendingDelete) return;
    try {
      await deleteMut.mutateAsync(pendingDelete.id);
      toast.success(t("edit.deleted"));
      setPendingDelete(null);
    } catch (e) {
      toast.error((e as Error).message ?? t("edit.errors.deleteFailed"));
    }
  }

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="mx-auto max-w-6xl space-y-4 px-8 py-6">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            id={searchId}
            value={search}
            onChange={(e) => setParam("search", e.target.value)}
            placeholder={t("list.filters.search")}
            className="max-w-xs"
          />
          <label
            htmlFor={officialId}
            className="flex items-center gap-2 text-sm text-muted-foreground"
          >
            <Switch
              id={officialId}
              checked={officialOnly}
              onCheckedChange={(v) => setParam("isOfficial", v ? "true" : null)}
            />
            {t("list.filters.officialOnly")}
          </label>
          <div className="ml-auto">
            <Button onClick={() => navigate(`/benchmark-templates/new?scenario=${scenario}`)}>
              <Plus className="mr-1 h-4 w-4" />
              {t("actions.new")}
            </Button>
          </div>
        </div>

        <Tabs value={scenario} onValueChange={(v) => setParam("scenario", v)}>
          <TabsList>
            {SCENARIO_TABS.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id}>
                {t(tab.labelKey)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {isLoading && <div className="text-sm text-muted-foreground">…</div>}

        {!isLoading && data && data.items.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-12 text-center">
            <p className="text-base font-medium">{t("list.empty.title")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t("list.empty.subtitle")}</p>
            <Button
              className="mt-4"
              onClick={() => navigate(`/benchmark-templates/new?scenario=${scenario}`)}
            >
              <Plus className="mr-1 h-4 w-4" />
              {t("actions.new")}
            </Button>
          </div>
        )}

        {!isLoading && data && data.items.length > 0 && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.items.map((tpl) => (
              <TemplateCard
                key={tpl.id}
                template={tpl}
                canEdit={isAdmin || tpl.createdBy === myId}
                onDeleteClick={() => setPendingDelete(tpl)}
              />
            ))}
          </div>
        )}
      </div>

      <DeleteTemplateDialog
        template={pendingDelete}
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        onConfirm={handleConfirmDelete}
        pending={deleteMut.isPending}
      />
    </>
  );
}
```

- [ ] **Step 6: Verify tests pass**

```bash
pnpm -F @modeldoctor/web test -- TemplateListPage
```

Expected: PASS.

- [ ] **Step 7: Type-check**

```bash
pnpm -F @modeldoctor/web type-check
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/benchmark-templates/TemplateListPage.tsx \
        apps/web/src/features/benchmark-templates/TemplateCard.tsx \
        apps/web/src/features/benchmark-templates/DeleteTemplateDialog.tsx \
        apps/web/src/features/benchmark-templates/__tests__/TemplateListPage.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): TemplateListPage with scenario tabs + filters

Renders the templates library: three scenario tabs persisted in URL,
search input + official-only toggle, ⋯ menu on each card for owner/admin
edit+delete, AlertDialog confirmation, and an empty state. Officials
lead the grid because the repository orders by isOfficial DESC.

addresses #94
refs #96

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: TemplateCreatePage + TemplateEditPage + shared `<TemplateForm>`

**Goal:** Two routed pages share a form body component. Create page lets the user pick scenario + tool + config + name/description/tags + (admin only) isOfficial. Edit page disables scenario/tool/isOfficial and shows the read-only banner for non-owners.

**Files:**
- Create: `apps/web/src/features/benchmark-templates/TemplateForm.tsx`
- Create: `apps/web/src/features/benchmark-templates/TemplateCreatePage.tsx`
- Create: `apps/web/src/features/benchmark-templates/TemplateEditPage.tsx`
- Create: `apps/web/src/features/benchmark-templates/__tests__/TemplateCreatePage.test.tsx`
- Create: `apps/web/src/features/benchmark-templates/__tests__/TemplateEditPage.test.tsx`

- [ ] **Step 1: Implement `TemplateForm.tsx`** (the shared body)

```tsx
import { Checkbox } from "@/components/ui/checkbox";
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
import { ToolParamsEditor } from "@/features/benchmarks/forms/ToolParamsEditor";
import { SCENARIOS } from "@/features/benchmarks/scenarios";
import type { ScenarioId } from "@modeldoctor/contracts";
import {
  genaiPerfParamDefaults,
  guidellmParamDefaults,
  vegetaParamDefaults,
} from "@modeldoctor/tool-adapters/schemas";
import type { ToolName } from "@modeldoctor/tool-adapters/schemas";
import { useId } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";

const TOOL_DEFAULTS: Record<ToolName, unknown> = {
  guidellm: guidellmParamDefaults,
  vegeta: vegetaParamDefaults,
  "genai-perf": genaiPerfParamDefaults,
};

export interface TemplateFormProps {
  /** "create" exposes scenario/tool selectors + admin-only isOfficial.
   *  "edit-owner" disables scenario/tool/isOfficial; rest editable.
   *  "edit-readonly" disables everything (used when viewer is not owner+not admin). */
  mode: "create" | "edit-owner" | "edit-readonly";
  /** True when the current user is admin. Only relevant in mode==="create". */
  isAdmin: boolean;
}

export function TemplateForm({ mode, isAdmin }: TemplateFormProps) {
  const { t } = useTranslation("benchmark-templates");
  const { register, control, reset, getValues } = useFormContext();
  const id = useId();
  const nameId = `${id}-name`;
  const descId = `${id}-desc`;
  const tagsId = `${id}-tags`;
  const scenarioId = `${id}-scenario`;
  const officialId = `${id}-official`;

  const scenario = (useWatch({ control, name: "scenario" }) ?? "inference") as ScenarioId;
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
      <section className="rounded-lg border border-border bg-card p-4 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t("create.sections.basic")}
        </h2>
        <div>
          <Label htmlFor={nameId}>{t("create.fields.name")}</Label>
          <Input
            id={nameId}
            {...register("name")}
            placeholder={t("create.fields.namePlaceholder")}
            disabled={disableAll}
          />
        </div>
        <div>
          <Label htmlFor={descId}>{t("create.fields.description")}</Label>
          <Textarea
            id={descId}
            rows={2}
            {...register("description", {
              setValueAs: (v) => (v === "" || v === undefined ? null : v),
            })}
            disabled={disableAll}
          />
        </div>
        <div>
          <Label htmlFor={tagsId}>{t("create.fields.tags")}</Label>
          {/* Simple comma-separated tag input — keeps form value as string[] */}
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
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t("create.sections.scenario")}
        </h2>
        <div className="max-w-xs">
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
      </section>

      <ToolParamsEditor scenario={scenario} paramsFieldName="config" />

      {mode === "create" && isAdmin && (
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t("create.sections.official")}
          </h2>
          <label htmlFor={officialId} className="flex items-center gap-2 text-sm">
            <Checkbox id={officialId} {...register("isOfficial")} />
            {t("create.fields.isOfficial")}
          </label>
          <p className="mt-1 text-xs text-muted-foreground">{t("create.officialHint")}</p>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Implement `TemplateCreatePage.tsx`**

```tsx
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/features/auth/queries";
import { SCENARIOS } from "@/features/benchmarks/scenarios";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  type CreateBenchmarkTemplateRequest,
  type ScenarioId,
  createBenchmarkTemplateRequestSchema,
  scenarioIdSchema,
} from "@modeldoctor/contracts";
import {
  guidellmParamDefaults,
  vegetaParamDefaults,
} from "@modeldoctor/tool-adapters/schemas";
import { FormProvider, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { TemplateForm } from "./TemplateForm";
import { useCreateTemplate } from "./queries";

export function TemplateCreatePage() {
  const { t } = useTranslation("benchmark-templates");
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const me = useCurrentUser();
  const isAdmin = (me.data?.roles ?? []).includes("admin");
  const createMut = useCreateTemplate();

  const scenarioParam = params.get("scenario");
  const scenarioParse = scenarioIdSchema.safeParse(scenarioParam);
  const scenario: ScenarioId = scenarioParse.success ? scenarioParse.data : "inference";
  const tool = SCENARIOS[scenario].tools[0];
  const defaultConfig =
    tool === "guidellm" ? guidellmParamDefaults : tool === "vegeta" ? vegetaParamDefaults : {};

  const form = useForm<CreateBenchmarkTemplateRequest>({
    resolver: zodResolver(createBenchmarkTemplateRequestSchema),
    mode: "onChange",
    defaultValues: {
      name: "",
      description: undefined,
      scenario,
      tool,
      config: defaultConfig as Record<string, unknown>,
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
        <FormProvider {...form}>
          <form onSubmit={onSubmit} className="space-y-6">
            <TemplateForm mode="create" isAdmin={isAdmin} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => navigate("/benchmark-templates")}>
                {t("actions.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={!form.formState.isValid || createMut.isPending}
              >
                {createMut.isPending ? "…" : t("actions.save")}
              </Button>
            </div>
          </form>
        </FormProvider>
      </div>
    </>
  );
}
```

- [ ] **Step 3: Implement `TemplateEditPage.tsx`**

```tsx
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/features/auth/queries";
import {
  type UpdateBenchmarkTemplateRequest,
  updateBenchmarkTemplateRequestSchema,
} from "@modeldoctor/contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { DeleteTemplateDialog } from "./DeleteTemplateDialog";
import { TemplateForm } from "./TemplateForm";
import { useDeleteTemplate, useTemplate, useUpdateTemplate } from "./queries";

export function TemplateEditPage() {
  const { t } = useTranslation("benchmark-templates");
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const tplQ = useTemplate(id);
  const me = useCurrentUser();
  const myId = me.data?.id;
  const isAdmin = (me.data?.roles ?? []).includes("admin");
  const updateMut = useUpdateTemplate(id ?? "");
  const deleteMut = useDeleteTemplate();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const tpl = tplQ.data;
  const canEdit = !!tpl && (isAdmin || tpl.createdBy === myId);
  const mode = !canEdit ? "edit-readonly" : "edit-owner";

  // Sanitized PATCH schema mirrors what the server accepts
  const patchSchema = updateBenchmarkTemplateRequestSchema.omit({
    isOfficial: true,
    scenario: true,
    tool: true,
  });

  const form = useForm<Partial<UpdateBenchmarkTemplateRequest>>({
    resolver: zodResolver(patchSchema),
    mode: "onChange",
    defaultValues: {},
  });

  // Reset form once template loads
  useEffect(() => {
    if (!tpl) return;
    form.reset({
      name: tpl.name,
      description: tpl.description ?? undefined,
      config: tpl.config,
      tags: tpl.tags,
    });
    // scenario/tool/isOfficial put on the form so the disabled selectors render correctly
    form.setValue("scenario" as never, tpl.scenario as never);
    form.setValue("tool" as never, tpl.tool as never);
    form.setValue("isOfficial" as never, tpl.isOfficial as never);
  }, [tpl, form]);

  if (tplQ.isLoading) {
    return (
      <>
        <PageHeader title={t("edit.title")} subtitle={t("edit.subtitle")} />
        <div className="mx-auto max-w-3xl px-8 py-6 text-sm text-muted-foreground">…</div>
      </>
    );
  }
  if (!tpl) {
    return (
      <>
        <PageHeader title={t("edit.title")} subtitle={t("edit.subtitle")} />
        <div className="mx-auto max-w-3xl px-8 py-6 text-sm text-destructive">404</div>
      </>
    );
  }

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await updateMut.mutateAsync(values);
      toast.success(t("edit.saved"));
    } catch (e) {
      toast.error((e as Error).message ?? t("edit.errors.saveFailed"));
    }
  });

  async function onDelete() {
    if (!id) return;
    try {
      await deleteMut.mutateAsync(id);
      toast.success(t("edit.deleted"));
      navigate("/benchmark-templates");
    } catch (e) {
      toast.error((e as Error).message ?? t("edit.errors.deleteFailed"));
    }
  }

  return (
    <>
      <PageHeader title={t("edit.title")} subtitle={t("edit.subtitle")} />
      <div className="mx-auto max-w-3xl space-y-4 px-8 py-6">
        {!canEdit && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
            {t("edit.readonlyBanner")}
          </div>
        )}
        <FormProvider {...form}>
          <form onSubmit={onSubmit} className="space-y-6">
            <TemplateForm mode={mode} isAdmin={isAdmin} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => navigate("/benchmark-templates")}>
                {t("actions.back")}
              </Button>
              {canEdit && (
                <>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => setConfirmingDelete(true)}
                  >
                    {t("actions.delete")}
                  </Button>
                  <Button type="submit" disabled={updateMut.isPending}>
                    {updateMut.isPending ? "…" : t("actions.save")}
                  </Button>
                </>
              )}
            </div>
          </form>
        </FormProvider>
      </div>
      <DeleteTemplateDialog
        template={tpl}
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        onConfirm={onDelete}
        pending={deleteMut.isPending}
      />
    </>
  );
}
```

- [ ] **Step 4: Write `TemplateCreatePage.test.tsx`**

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/auth/queries", () => ({
  useCurrentUser: vi.fn(() => ({ data: { id: "user-1", roles: ["user"] } })),
}));
vi.mock("../queries", () => ({
  useCreateTemplate: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { useCurrentUser } from "@/features/auth/queries";
import { TemplateCreatePage } from "../TemplateCreatePage";

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("TemplateCreatePage", () => {
  it("hides the isOfficial checkbox for non-admin users", () => {
    render(
      <Wrapper>
        <TemplateCreatePage />
      </Wrapper>,
    );
    expect(screen.queryByLabelText(/官方|official/i)).toBeNull();
  });

  it("shows the isOfficial checkbox for admin users", () => {
    (useCurrentUser as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { id: "admin-1", roles: ["admin"] },
    });
    render(
      <Wrapper>
        <TemplateCreatePage />
      </Wrapper>,
    );
    expect(
      screen.getByLabelText(/标记为官方模板|mark as official/i),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Write `TemplateEditPage.test.tsx`**

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { type ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/auth/queries", () => ({
  useCurrentUser: vi.fn(),
}));
vi.mock("../queries", () => ({
  useTemplate: vi.fn(),
  useUpdateTemplate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteTemplate: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { useCurrentUser } from "@/features/auth/queries";
import { useTemplate } from "../queries";
import { TemplateEditPage } from "../TemplateEditPage";

function Wrapper({ children, route = "/benchmark-templates/abc" }: { children: ReactNode; route?: string }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="/benchmark-templates/:id" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const tpl = {
  id: "abc",
  name: "Mine",
  description: null,
  scenario: "inference" as const,
  tool: "guidellm" as const,
  config: {},
  isOfficial: false,
  createdBy: "user-1",
  tags: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("TemplateEditPage", () => {
  it("hides delete and shows readonly banner when current user is not the owner", () => {
    (useTemplate as ReturnType<typeof vi.fn>).mockReturnValue({ data: tpl, isLoading: false });
    (useCurrentUser as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { id: "someone-else", roles: ["user"] },
    });
    render(
      <Wrapper>
        <TemplateEditPage />
      </Wrapper>,
    );
    expect(
      screen.getByText(/不是此模板的所有者|read-only view/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^删除$|^Delete$/)).toBeNull();
  });

  it("shows save and delete when the current user is the owner", () => {
    (useTemplate as ReturnType<typeof vi.fn>).mockReturnValue({ data: tpl, isLoading: false });
    (useCurrentUser as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { id: "user-1", roles: ["user"] },
    });
    render(
      <Wrapper>
        <TemplateEditPage />
      </Wrapper>,
    );
    expect(screen.getByText(/^保存$|^Save$/)).toBeInTheDocument();
    expect(screen.getByText(/^删除$|^Delete$/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run all template-page tests**

```bash
pnpm -F @modeldoctor/web test -- benchmark-templates
```

Expected: PASS (Create + Edit + List).

- [ ] **Step 7: Type-check**

```bash
pnpm -F @modeldoctor/web type-check
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/benchmark-templates/TemplateForm.tsx \
        apps/web/src/features/benchmark-templates/TemplateCreatePage.tsx \
        apps/web/src/features/benchmark-templates/TemplateEditPage.tsx \
        apps/web/src/features/benchmark-templates/__tests__/TemplateCreatePage.test.tsx \
        apps/web/src/features/benchmark-templates/__tests__/TemplateEditPage.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): TemplateCreatePage + TemplateEditPage

Adds create/edit pages sharing a TemplateForm body. Create exposes
scenario/tool selectors and the admin-only isOfficial checkbox. Edit
disables scenario/tool/isOfficial (server-immutable) and renders a
read-only banner with hidden save/delete buttons when the viewer is
neither owner nor admin.

addresses #94
refs #96

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Wire route + sidebar entry + manual smoke

**Goal:** Route the new pages, add the sidebar entry to the benchmarks group, finalize the sidebar i18n key, and smoke-test the full CRUD loop in a real browser.

**Files:**
- Modify: `apps/web/src/router/index.tsx`
- Modify: `apps/web/src/components/sidebar/sidebar-config.tsx`
- Modify: `apps/web/src/locales/zh-CN/sidebar.json`
- Modify: `apps/web/src/locales/en-US/sidebar.json`

- [ ] **Step 1: Add the routes**

In `apps/web/src/router/index.tsx`, add the imports near the top:

```tsx
import { TemplateCreatePage } from "@/features/benchmark-templates/TemplateCreatePage";
import { TemplateEditPage } from "@/features/benchmark-templates/TemplateEditPage";
import { TemplateListPage } from "@/features/benchmark-templates/TemplateListPage";
```

Then add three routes inside the `AppShell` children array, after `{ path: "benchmarks/:id", element: <BenchmarkDetailPage /> }`:

```tsx
{ path: "benchmark-templates", element: <TemplateListPage /> },
{ path: "benchmark-templates/new", element: <TemplateCreatePage /> },
{ path: "benchmark-templates/:id", element: <TemplateEditPage /> },
```

- [ ] **Step 2: Add the sidebar entry**

In `apps/web/src/components/sidebar/sidebar-config.tsx`:

1. Add `Layers` to the `lucide-react` import list (alphabetical position).
2. Replace the L57 placeholder line:

```tsx
// benchmark-templates entry omitted in PR1; lands in PR2.
```

with:

```tsx
{ to: "/benchmark-templates", icon: Layers, labelKey: "items.benchmarkTemplates" },
```

- [ ] **Step 3: Add the i18n key**

In `apps/web/src/locales/zh-CN/sidebar.json`, add to `items`:

```json
    "benchmarkTemplates": "测试模板",
```

In `apps/web/src/locales/en-US/sidebar.json`, add to `items`:

```json
    "benchmarkTemplates": "Test Templates",
```

(Place each next to the existing `benchmarkCompare` key.)

- [ ] **Step 4: Type-check + lint**

```bash
pnpm -F @modeldoctor/web type-check
pnpm -F @modeldoctor/web lint
```

Expected: no errors.

- [ ] **Step 5: Boot the dev stack and smoke-test**

```bash
pnpm dev
```

Wait for both API and Web to be ready (look for `Local:` URL on web). Open that URL in a browser. Log in with an admin account (the first registered user). Then:

1. Confirm the sidebar shows **测试模板 / Test Templates** as the last item under 基准测试.
2. Click it — list page loads with Inference tab selected and empty state visible.
3. Click **+ 新建模板**:
   - Fill name "Inference baseline (constant)"
   - Pick scenario inference (already selected)
   - tool stays guidellm
   - Tweak rate to 5
   - Check **标记为官方模板** (visible because admin)
   - Submit — toast appears, list page reloads with the new template at the top with the Official badge.
4. Open the new template — verify scenario/tool dropdowns disabled, isOfficial checkbox not editable, name/description/tags/config editable. Edit name, save — toast, list updates.
5. Log out, register a second user (non-admin):
   - Templates list shows the official template.
   - **+ 新建模板** with isOfficial unchecked — succeeds.
   - Try to PATCH the official template via curl with the user's bearer — gets 403.
   - Open the official template in browser — read-only banner visible, no save/delete button.
6. Delete the personal template via the ⋯ menu → confirm dialog → success.

If anything fails, fix in a follow-up commit BEFORE pushing.

- [ ] **Step 6: Stop dev server**

Kill the `pnpm dev` process (Ctrl-C in its terminal).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/router/index.tsx \
        apps/web/src/components/sidebar/sidebar-config.tsx \
        apps/web/src/locales/zh-CN/sidebar.json \
        apps/web/src/locales/en-US/sidebar.json
git commit -m "$(cat <<'EOF'
feat(web): wire benchmark-templates route + sidebar entry

Routes /benchmark-templates, /benchmark-templates/new, and
/benchmark-templates/:id; replaces the PR1 placeholder comment in
sidebar-config with the actual entry; adds items.benchmarkTemplates
to both bilingual sidebar catalogs. Manual smoke covered the full
admin/normal-user CRUD loop in a browser.

closes #96
addresses #94

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: Push branch + open PR**

```bash
git push -u origin feat/benchmark-restructure-pr2
```

Then:

```bash
gh pr create --title "feat(benchmark): PR2 — benchmark_templates CRUD + list/edit UI" --body "$(cat <<'EOF'
## Summary
- Backend: 5 endpoints (`/api/benchmark-templates*`) with permission gating (any login user reads; owner/admin writes; admin-only `isOfficial:true`).
- `isOfficial` is create-only and immutable: PATCH schema omits `isOfficial`, `scenario`, `tool`, so client cannot bypass.
- Frontend: list page (3 scenario tabs, official-first ordering, search, official-only filter, ⋯ menu), create page, edit page (read-only banner for non-owners).
- Refactor: extracted `<ToolParamsEditor>` from `BenchmarkCreatePage`; sub-form components gain `fieldPrefix` prop. Existing `BenchmarkCreatePage.test` stays green.
- 9 commits, phase-per-commit per [memory feedback_single_pr_for_coupled_work](.).

## Spec
- `docs/superpowers/specs/2026-05-05-benchmark-restructure-pr2-design.md`

## Test plan
- [ ] `pnpm -F @modeldoctor/api test` — all green
- [ ] `pnpm -F @modeldoctor/web test` — all green
- [ ] e2e `benchmark-template.e2e-spec.ts` covers admin/owner permissions + PATCH sanitization + (scenario, tool) mismatch
- [ ] Manual smoke: admin creates official → non-admin sees + cannot edit → non-admin creates personal → owner can delete

closes #96
addresses #94

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 9: PR follow-through (per memory `feedback_pr_followthrough.md`)**

```bash
gh pr view --json url,number,statusCheckRollup,mergeStateStatus
```

Then watch CI:

```bash
gh pr checks $(gh pr view --json number -q .number)
```

If CI is pending, wait for completion. If failures, surface to user (don't declare PR open without confirming signals).

After CI lands:

```bash
gh api repos/weetime/modeldoctor/pulls/$(gh pr view --json number -q .number)/comments
```

Surface any inline review comments to the user.

---

## Self-Review

(Performed inline before saving — see audit notes below.)

**1. Spec coverage check**
- Backend module structure (spec L48-58) → Tasks 2-4 ✓
- API surface table (spec L62-68) → Task 4 controller ✓
- Permission decision matrix (spec L72-83) → Tasks 3-5 (service + controller + e2e) ✓
- Validation order (spec L92-127) → Task 3 service ✓
- Repository interface (spec L131-156) → Task 2 ✓
- ToolParamsEditor extraction (spec L181-211) → Task 1 ✓
- 3 new pages + sidebar wiring (spec L213-251) → Tasks 7-9 ✓
- react-query hooks (spec L253-260) → Task 6 ✓
- i18n catalogs (spec L262-264) → Task 6 ✓
- Backend testing strategy (spec L313-329) → controller/service/repository specs ✓
- Frontend testing (spec L331-336) → ListPage/CreatePage/EditPage/ToolParamsEditor tests ✓
- e2e flow 1-9 (spec L338-348) → Task 5 ✓
- Phase splits 0-9 (spec L292-303) → Tasks 0-9 ✓

No spec gaps.

**2. Placeholder scan** — searched plan; no TODO/TBD/"add appropriate"/"similar to" patterns.

**3. Type consistency** — `TemplateActor`, `paramsFieldName`, `ToolParamsEditor` props, hook names (`useTemplates / useTemplate / useCreateTemplate / useUpdateTemplate / useDeleteTemplate`), and error codes (`BENCHMARK_TEMPLATE_OFFICIAL_FORBIDDEN / FORBIDDEN / SCENARIO_TOOL_MISMATCH / CONFIG_INVALID`) consistent across tasks.
