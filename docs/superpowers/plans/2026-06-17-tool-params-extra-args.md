# Tool Params Extra-Args Escape Hatch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single raw extra-CLI-args textarea to the aiperf / evalscope / guidellm param forms so long-tail flags (e.g. Qwen3 thinking-off via `--extra-inputs`) need no per-flag code change, and ship the 5 prefix-cache aiperf templates with thinking disabled.

**Architecture:** A shared `core/extra-args.ts` parses a raw CLI string into argv tokens (quote-aware, no shell exec) and appends them to a tool's argv, rejecting any flag the tool already manages (per-tool locked-flag denylist). Each tool's `paramsSchema` gains an optional `extraArgs` string; each `buildCommand` calls `appendExtraArgs` at the end. A shared `<ExtraArgsField>` React component renders the textarea in the 3 param forms. vegeta is out of scope (shell-pipeline command, no clean argv append).

**Tech Stack:** TypeScript, zod, Vitest 2, React + react-hook-form + react-i18next, pnpm monorepo (`@modeldoctor/tool-adapters`, `apps/web`, `apps/api` Prisma seed).

---

## File Structure

**Backend — `packages/tool-adapters/src/`**
- Create `core/extra-args.ts` — `ExtraArgsError`, `parseExtraArgs`, `appendExtraArgs` (one responsibility: turn a raw string into validated appended argv).
- Create `core/__tests__/extra-args.spec.ts` — unit tests for the above.
- Modify `aiperf/schema.ts` — add `extraArgs` field.
- Modify `aiperf/runtime.ts` — `AIPERF_LOCKED_FLAGS` + `appendExtraArgs` at end of `buildCommand`.
- Modify `aiperf/runtime.spec.ts` — append + reject-locked tests.
- Modify `evalscope/schema.ts`, `evalscope/runtime.ts`, `evalscope/runtime.spec.ts` — same shape.
- Modify `guidellm/schema.ts`, `guidellm/runtime.ts`, `guidellm/runtime.spec.ts` — same shape.

**Frontend — `apps/web/src/`**
- Create `features/benchmarks/forms/_shared/ExtraArgsField.tsx` — shared textarea bound to `${fieldPrefix}.extraArgs`.
- Create `features/benchmarks/forms/__tests__/ExtraArgsField.test.tsx`.
- Modify `features/benchmarks/forms/{AiperfParamsForm,EvalscopeParamsForm,GuidellmParamsForm}.tsx` — render `<ExtraArgsField>`.
- Modify `locales/zh-CN/benchmarks.json` + `locales/en-US/benchmarks.json` — new keys.

**Seed — `apps/api/`**
- Modify `apps/api/prisma/seed.ts` — `extraArgs` on the 5 prefix-cache aiperf templates.

**Reproducibility note:** `extraArgs` is part of the tool params JSON, so it is persisted with the benchmark + template automatically (no DB migration — params/config are JSON columns) and appears in the run-detail params display for free. Surfacing it in the AI compare method-section narrative is a deliberate follow-up, NOT this PR.

---

## Task 1: Shared `extra-args` core module

**Files:**
- Create: `packages/tool-adapters/src/core/extra-args.ts`
- Test: `packages/tool-adapters/src/core/__tests__/extra-args.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/tool-adapters/src/core/__tests__/extra-args.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { appendExtraArgs, ExtraArgsError, parseExtraArgs } from "../extra-args.js";

describe("parseExtraArgs", () => {
  it("returns [] for empty / undefined / whitespace", () => {
    expect(parseExtraArgs(undefined)).toEqual([]);
    expect(parseExtraArgs("")).toEqual([]);
    expect(parseExtraArgs("   \n\t ")).toEqual([]);
  });

  it("splits on whitespace and newlines", () => {
    expect(parseExtraArgs("--a 1\n--b 2")).toEqual(["--a", "1", "--b", "2"]);
  });

  it("keeps a single-quoted JSON value as one token, joined to its prefix", () => {
    // The thinking-off flag: the quoted JSON must survive as ONE value token.
    expect(
      parseExtraArgs(`--extra-inputs chat_template_kwargs:'{"enable_thinking":false}'`),
    ).toEqual(["--extra-inputs", `chat_template_kwargs:{"enable_thinking":false}`]);
  });

  it("supports double quotes with escaped quotes", () => {
    expect(parseExtraArgs(`--x "a \\"b\\" c"`)).toEqual(["--x", `a "b" c`]);
  });

  it("throws ExtraArgsError on an unterminated quote", () => {
    expect(() => parseExtraArgs(`--x 'oops`)).toThrow(ExtraArgsError);
  });
});

describe("appendExtraArgs", () => {
  const locked = new Set(["--model", "--url", "--api-key"]);

  it("appends parsed tokens after the base argv", () => {
    expect(appendExtraArgs(["aiperf", "profile"], "--warmup-request-count 50", locked)).toEqual([
      "aiperf",
      "profile",
      "--warmup-request-count",
      "50",
    ]);
  });

  it("is a no-op for undefined / empty extraArgs", () => {
    expect(appendExtraArgs(["x"], undefined, locked)).toEqual(["x"]);
    expect(appendExtraArgs(["x"], "  ", locked)).toEqual(["x"]);
  });

  it("rejects a locked flag (bare and =form)", () => {
    expect(() => appendExtraArgs(["x"], "--model evil", locked)).toThrow(ExtraArgsError);
    expect(() => appendExtraArgs(["x"], "--url=http://evil", locked)).toThrow(/--url/);
  });

  it("allows unknown flags (the whole point)", () => {
    expect(appendExtraArgs(["x"], "--brand-new-flag yes", locked)).toEqual([
      "x",
      "--brand-new-flag",
      "yes",
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -F @modeldoctor/tool-adapters test -- extra-args`
Expected: FAIL — cannot find module `../extra-args.js`.

- [ ] **Step 3: Implement the module**

Create `packages/tool-adapters/src/core/extra-args.ts`:

```ts
/**
 * Power-user "escape hatch" for benchmark tools: parse a raw CLI string the
 * user pasted into the param form, and append it to a tool's argv — rejecting
 * any flag the tool already manages so there is exactly one source of truth
 * per managed flag. Pure string parsing; NEVER executes a shell.
 */

export class ExtraArgsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtraArgsError";
  }
}

/**
 * Split a raw CLI string into argv tokens, honoring single and double quotes.
 * Quotes group/strip; adjacent quoted+unquoted runs join into one token (same
 * as a POSIX shell would), so `key:'{"a":1}'` becomes the single token
 * `key:{"a":1}`. No variable/command/glob expansion — just quoting + splitting.
 */
export function parseExtraArgs(raw: string | undefined): string[] {
  if (!raw) return [];
  const tokens: string[] = [];
  let cur = "";
  let hasToken = false; // tracks an in-progress token across quote boundaries
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inSingle) {
      if (c === "'") inSingle = false;
      else cur += c;
      continue;
    }
    if (inDouble) {
      if (c === '"') inDouble = false;
      else if (c === "\\" && (raw[i + 1] === '"' || raw[i + 1] === "\\")) cur += raw[++i];
      else cur += c;
      continue;
    }
    if (c === "'") {
      inSingle = true;
      hasToken = true;
      continue;
    }
    if (c === '"') {
      inDouble = true;
      hasToken = true;
      continue;
    }
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      if (hasToken) {
        tokens.push(cur);
        cur = "";
        hasToken = false;
      }
      continue;
    }
    cur += c;
    hasToken = true;
  }
  if (inSingle || inDouble) {
    throw new ExtraArgsError("unterminated quote in extra args");
  }
  if (hasToken) tokens.push(cur);
  return tokens;
}

/** The flag name of a token (`--foo` from `--foo` or `--foo=bar`), or null if
 * the token is not a flag (a value / positional). */
function flagName(token: string): string | null {
  if (!token.startsWith("-")) return null;
  const eq = token.indexOf("=");
  return eq === -1 ? token : token.slice(0, eq);
}

/**
 * Parse `raw` and append it to `argv`, throwing ExtraArgsError if any pasted
 * flag is in `locked` (the flags the caller's buildCommand already manages).
 */
export function appendExtraArgs(
  argv: string[],
  raw: string | undefined,
  locked: ReadonlySet<string>,
): string[] {
  const parsed = parseExtraArgs(raw);
  const collisions = [
    ...new Set(
      parsed
        .map(flagName)
        .filter((f): f is string => f !== null && locked.has(f)),
    ),
  ];
  if (collisions.length > 0) {
    throw new ExtraArgsError(
      `extra args may not override managed flags: ${collisions.join(", ")}`,
    );
  }
  return [...argv, ...parsed];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -F @modeldoctor/tool-adapters test -- extra-args`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add packages/tool-adapters/src/core/extra-args.ts packages/tool-adapters/src/core/__tests__/extra-args.spec.ts
git commit -m "$(printf 'feat(tool-adapters): raw extra-CLI-args parser + locked-flag guard\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 2: aiperf — schema field + buildCommand append

**Files:**
- Modify: `packages/tool-adapters/src/aiperf/schema.ts`
- Modify: `packages/tool-adapters/src/aiperf/runtime.ts`
- Test: `packages/tool-adapters/src/aiperf/runtime.spec.ts`

- [ ] **Step 1: Write the failing tests** (append to `aiperf/runtime.spec.ts`)

```ts
import { ExtraArgsError } from "../core/extra-args.js";

describe("aiperf extraArgs", () => {
  // buildAiperf(params) is the existing test helper in this file that calls
  // buildCommand with a minimal connection. If it does not exist, build the
  // plan object inline as the other tests in this file already do.
  it("appends extra args after managed flags", () => {
    const { argv } = buildAiperf({
      extraArgs: `--extra-inputs chat_template_kwargs:'{"enable_thinking":false}'`,
    });
    const i = argv.indexOf("--extra-inputs");
    expect(i).toBeGreaterThan(0);
    expect(argv[i + 1]).toBe(`chat_template_kwargs:{"enable_thinking":false}`);
  });

  it("rejects overriding a managed flag", () => {
    expect(() => buildAiperf({ extraArgs: "--model evil" })).toThrow(ExtraArgsError);
  });

  it("is a no-op when extraArgs is absent", () => {
    const { argv } = buildAiperf({});
    expect(argv).not.toContain("--extra-inputs");
  });
});
```

> If `buildAiperf` does not already exist in the spec file, define it near the
> top of the file mirroring the existing tests:
> ```ts
> import { buildCommand } from "./runtime.js";
> import { aiperfParamsSchema } from "./schema.js";
> const CONN = { baseUrl: "http://x", apiKey: "k", model: "m", customHeaders: "", queryParams: "", tokenizerHfId: null, prometheusDatasource: null };
> function buildAiperf(partial: Record<string, unknown>) {
>   const params = aiperfParamsSchema.parse({ dataset: "synthetic", ...partial });
>   return buildCommand({ runId: "r", params, connection: CONN });
> }
> ```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -F @modeldoctor/tool-adapters test -- aiperf/runtime`
Expected: FAIL — `extraArgs` stripped by schema (so `--extra-inputs` never appears) / ExtraArgsError import resolves but no throw.

- [ ] **Step 3a: Add the schema field**

In `packages/tool-adapters/src/aiperf/schema.ts`, inside the `.object({ ... })` (before the closing `})` that precedes `.superRefine`), add:

```ts
    // Power-user escape hatch: raw extra CLI flags appended verbatim. Cannot
    // override managed flags (validated in buildCommand). See core/extra-args.
    extraArgs: z.string().max(4000).optional(),
```

- [ ] **Step 3b: Append in buildCommand**

In `packages/tool-adapters/src/aiperf/runtime.ts`:

Add the import at the top (next to other imports):
```ts
import { appendExtraArgs } from "../core/extra-args.js";
```

Define the locked set above `buildCommand` (every flag this file emits):
```ts
const AIPERF_LOCKED_FLAGS: ReadonlySet<string> = new Set([
  "--model", "--url", "--endpoint-type", "--tokenizer", "--api-key",
  "--workers-max", "--streaming", "--input-file", "--custom-dataset-type",
  "--fixed-schedule", "--fixed-schedule-end-offset", "--concurrency",
  "--request-count", "--synthetic-input-tokens-mean", "--synthetic-input-tokens-stddev",
  "--output-tokens-mean", "--output-tokens-stddev", "--public-dataset",
  "--conversation-num", "--conversation-turn-mean", "--conversation-turn-stddev",
  "--connection-reuse-strategy", "--conversation-turn-delay-mean", "--random-seed",
  "--artifact-dir",
]);
```

Change the end of `buildCommand` from building `argv` directly into the return to
applying the escape hatch. Replace the final `argv.push("--artifact-dir", OUTPUTS_DIR);`
+ `return { argv, ... }` with:

```ts
  argv.push("--artifact-dir", OUTPUTS_DIR);

  const finalArgv = appendExtraArgs(argv, params.extraArgs, AIPERF_LOCKED_FLAGS);

  return {
    argv: finalArgv,
    env: {},
    secretEnv: { OPENAI_API_KEY: connection.apiKey },
    outputFiles: { report: `${OUTPUTS_DIR}/${SUMMARY_FILE}` },
  };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -F @modeldoctor/tool-adapters test -- aiperf/runtime`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/tool-adapters/src/aiperf/schema.ts packages/tool-adapters/src/aiperf/runtime.ts packages/tool-adapters/src/aiperf/runtime.spec.ts
git commit -m "$(printf 'feat(tool-adapters): aiperf extraArgs escape hatch\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 3: evalscope — schema field + buildCommand append

**Files:**
- Modify: `packages/tool-adapters/src/evalscope/schema.ts`
- Modify: `packages/tool-adapters/src/evalscope/runtime.ts`
- Test: `packages/tool-adapters/src/evalscope/runtime.spec.ts`

- [ ] **Step 1: Write the failing tests** (append to `evalscope/runtime.spec.ts`, mirroring Task 2 with an evalscope build helper that parses via `evalscopeParamsSchema`)

```ts
import { ExtraArgsError } from "../core/extra-args.js";

describe("evalscope extraArgs", () => {
  it("appends extra args", () => {
    const { argv } = buildEvalscope({ extraArgs: "--debug --tokenizer-path /x" });
    expect(argv).toContain("--debug");
    const i = argv.indexOf("--tokenizer-path");
    expect(argv[i + 1]).toBe("/x");
  });
  it("rejects overriding a managed flag", () => {
    expect(() => buildEvalscope({ extraArgs: "--model evil" })).toThrow(ExtraArgsError);
  });
  it("no-op when absent", () => {
    expect(buildEvalscope({}).argv).not.toContain("--debug");
  });
});
```

> Define `buildEvalscope` like Task 2's helper but with `evalscopeParamsSchema`
> and that tool's required minimal params (e.g. defaults already cover them).

- [ ] **Step 2: Run to verify fail**

Run: `pnpm -F @modeldoctor/tool-adapters test -- evalscope/runtime`
Expected: FAIL.

- [ ] **Step 3a: Add schema field** — in `evalscope/schema.ts`, inside `.object({ ... })` (before the `.refine(...)` chain) add the same:
```ts
    extraArgs: z.string().max(4000).optional(),
```

- [ ] **Step 3b: Append in buildCommand** — in `evalscope/runtime.ts` add
`import { appendExtraArgs } from "../core/extra-args.js";`, define:
```ts
const EVALSCOPE_LOCKED_FLAGS: ReadonlySet<string> = new Set([
  "--model", "--api", "--url", "--api-key", "--dataset", "--dataset-path",
  "--name", "--number", "--parallel", "--seed", "--stream", "--no-stream",
  "--no-timestamp", "--outputs-dir", "--min-tokens", "--max-tokens",
  "--min-prompt-length", "--max-prompt-length",
]);
```
and wrap the final argv: `const finalArgv = appendExtraArgs(argv, params.extraArgs, EVALSCOPE_LOCKED_FLAGS);` then return `argv: finalArgv` in the existing `BuildCommandResult`.

> Re-derive the locked set from this file's actual `argv.push` / `args.push`
> calls at implementation time; the list above is from the current code.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm -F @modeldoctor/tool-adapters test -- evalscope/runtime`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add packages/tool-adapters/src/evalscope/schema.ts packages/tool-adapters/src/evalscope/runtime.ts packages/tool-adapters/src/evalscope/runtime.spec.ts
git commit -m "$(printf 'feat(tool-adapters): evalscope extraArgs escape hatch\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 4: guidellm — schema field + buildCommand append

**Files:**
- Modify: `packages/tool-adapters/src/guidellm/schema.ts`
- Modify: `packages/tool-adapters/src/guidellm/runtime.ts`
- Test: `packages/tool-adapters/src/guidellm/runtime.spec.ts`

- [ ] **Step 1: Write the failing tests** (append to `guidellm/runtime.spec.ts`)

```ts
import { ExtraArgsError } from "../core/extra-args.js";

describe("guidellm extraArgs", () => {
  it("appends extra args", () => {
    const { argv } = buildGuidellm({ extraArgs: "--warmup-percent 0.1" });
    const i = argv.indexOf("--warmup-percent");
    expect(i).toBeGreaterThan(0);
    expect(argv[i + 1]).toBe("0.1");
  });
  it("rejects overriding a managed flag", () => {
    expect(() => buildGuidellm({ extraArgs: "--target http://evil" })).toThrow(ExtraArgsError);
  });
  it("no-op when absent", () => {
    expect(buildGuidellm({}).argv).not.toContain("--warmup-percent");
  });
});
```

> `buildGuidellm` mirrors Task 2 with `guidellmParamsSchema`. Note guidellm uses
> `--flag=value` form; the test for `--warmup-percent 0.1` (space form) still
> works because extra args are appended verbatim as the user typed them.

- [ ] **Step 2: Run to verify fail**

Run: `pnpm -F @modeldoctor/tool-adapters test -- guidellm/runtime`
Expected: FAIL.

- [ ] **Step 3a: Add schema field** — in `guidellm/schema.ts`, inside `.object({ ... })` (before `.superRefine`) add:
```ts
    extraArgs: z.string().max(4000).optional(),
```

- [ ] **Step 3b: Append in buildCommand** — in `guidellm/runtime.ts` add
`import { appendExtraArgs } from "../core/extra-args.js";`, define:
```ts
const GUIDELLM_LOCKED_FLAGS: ReadonlySet<string> = new Set([
  "--backend", "--target", "--model", "--max-requests", "--max-seconds",
  "--output-path", "--disable-console", "--backend-kwargs", "--rate-type",
  "--rate", "--data", "--random-seed", "--processor",
]);
```
and wrap: `const finalArgv = appendExtraArgs(argv, params.extraArgs, GUIDELLM_LOCKED_FLAGS);` returning `argv: finalArgv`.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm -F @modeldoctor/tool-adapters test -- guidellm/runtime`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add packages/tool-adapters/src/guidellm/schema.ts packages/tool-adapters/src/guidellm/runtime.ts packages/tool-adapters/src/guidellm/runtime.spec.ts
git commit -m "$(printf 'feat(tool-adapters): guidellm extraArgs escape hatch\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 5: Shared `<ExtraArgsField>` UI component

**Files:**
- Create: `apps/web/src/features/benchmarks/forms/_shared/ExtraArgsField.tsx`
- Test: `apps/web/src/features/benchmarks/forms/__tests__/ExtraArgsField.test.tsx`

- [ ] **Step 1: Confirm the Textarea component path**

Run: `ls apps/web/src/components/ui/textarea.tsx`
Expected: file exists (shadcn Textarea). If absent, the component below uses a
native `<textarea>` with the shared input classes — note which you used.

- [ ] **Step 2: Write the failing test**

Create `apps/web/src/features/benchmarks/forms/__tests__/ExtraArgsField.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";
import { ExtraArgsField } from "../_shared/ExtraArgsField";

function Wrap({ initial }: { initial?: string }) {
  const form = useForm({ defaultValues: { params: { extraArgs: initial } } });
  return (
    <FormProvider {...form}>
      <ExtraArgsField fieldPrefix="params" />
    </FormProvider>
  );
}

describe("ExtraArgsField", () => {
  it("renders a textarea bound to <prefix>.extraArgs", () => {
    render(<Wrap initial="--extra-inputs foo:bar" />);
    expect(screen.getByRole("textbox")).toHaveValue("--extra-inputs foo:bar");
  });
});
```

- [ ] **Step 3: Run to verify fail**

Run: `pnpm -F @modeldoctor/web test -- ExtraArgsField`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the component**

Create `apps/web/src/features/benchmarks/forms/_shared/ExtraArgsField.tsx`:

```tsx
import { useId } from "react";
import { useFormContext } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Power-user escape hatch shared by the argv-based tool param forms
 * (aiperf / evalscope / guidellm). Binds a raw-CLI textarea to
 * `${fieldPrefix}.extraArgs`. Server is authoritative on locked-flag
 * rejection; this is a plain passthrough input with helper text.
 */
export function ExtraArgsField({ fieldPrefix }: { fieldPrefix: string }) {
  const { t } = useTranslation("benchmarks");
  const { register } = useFormContext();
  const id = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{t("create.extraArgs.label")}</Label>
      <Textarea
        id={id}
        rows={2}
        spellCheck={false}
        className="font-mono text-xs"
        placeholder={t("create.extraArgs.placeholder")}
        {...register(`${fieldPrefix}.extraArgs`)}
      />
      <p className="text-[11px] text-muted-foreground">{t("create.extraArgs.help")}</p>
    </div>
  );
}
```

> If `@/components/ui/textarea` does not exist, replace `<Textarea .../>` with a
> native `<textarea id={id} rows={2} spellCheck={false} className="flex w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs" placeholder={...} {...register(...)} />`.

- [ ] **Step 5: Run to verify pass**

Run: `pnpm -F @modeldoctor/web test -- ExtraArgsField`
Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add apps/web/src/features/benchmarks/forms/_shared/ExtraArgsField.tsx apps/web/src/features/benchmarks/forms/__tests__/ExtraArgsField.test.tsx
git commit -m "$(printf 'feat(web): shared ExtraArgsField for tool param forms\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 6: Wire `<ExtraArgsField>` into the 3 param forms

**Files:**
- Modify: `apps/web/src/features/benchmarks/forms/AiperfParamsForm.tsx`
- Modify: `apps/web/src/features/benchmarks/forms/EvalscopeParamsForm.tsx`
- Modify: `apps/web/src/features/benchmarks/forms/GuidellmParamsForm.tsx`

- [ ] **Step 1: Inspect one form to learn the prop + layout**

Run: `sed -n '1,40p' apps/web/src/features/benchmarks/forms/AiperfParamsForm.tsx`
Confirm the component signature is `function AiperfParamsForm({ fieldPrefix }: { fieldPrefix: string })` (the dispatcher passes `fieldPrefix`). Note the outermost wrapper element/class.

- [ ] **Step 2: Add the field to each form**

In each of the 3 form files, add the import:
```tsx
import { ExtraArgsField } from "./_shared/ExtraArgsField";
```
and render `<ExtraArgsField fieldPrefix={fieldPrefix} />` as the LAST child of the form's root container (after all existing fields), so it reads as an "advanced" tail.

- [ ] **Step 3: Verify typecheck + existing form tests still pass**

Run: `pnpm -F @modeldoctor/web test -- AiperfParamsForm` and `pnpm -F @modeldoctor/tool-adapters typecheck` is not needed here; run `pnpm -F @modeldoctor/web exec tsc --noEmit` (or the repo's web typecheck script).
Expected: PASS / no type errors.

- [ ] **Step 4: Commit**
```bash
git add apps/web/src/features/benchmarks/forms/AiperfParamsForm.tsx apps/web/src/features/benchmarks/forms/EvalscopeParamsForm.tsx apps/web/src/features/benchmarks/forms/GuidellmParamsForm.tsx
git commit -m "$(printf 'feat(web): render ExtraArgsField in aiperf/evalscope/guidellm forms\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 7: i18n keys (zh-CN + en-US)

**Files:**
- Modify: `apps/web/src/locales/zh-CN/benchmarks.json`
- Modify: `apps/web/src/locales/en-US/benchmarks.json`

- [ ] **Step 1: Locate the `create` object**

Run: `grep -n '"create"' apps/web/src/locales/zh-CN/benchmarks.json | head -1`
Add a sibling `extraArgs` object under `create` in BOTH files.

- [ ] **Step 2: Add zh-CN keys** under `create` in `zh-CN/benchmarks.json`:
```json
"extraArgs": {
  "label": "高级参数 (raw CLI)",
  "placeholder": "--extra-inputs chat_template_kwargs:'{\"enable_thinking\":false}'",
  "help": "追加原始 CLI 参数,空格或换行分隔。不可覆盖受管参数(model / url / api-key / 输出路径 等),否则运行会报错。高级用法,不保证跨 run 可比。"
}
```

- [ ] **Step 3: Add en-US keys** under `create` in `en-US/benchmarks.json`:
```json
"extraArgs": {
  "label": "Advanced (raw CLI)",
  "placeholder": "--extra-inputs chat_template_kwargs:'{\"enable_thinking\":false}'",
  "help": "Extra raw CLI args, space/newline separated. Cannot override managed flags (model / url / api-key / output paths) — the run errors if you try. Power-user; not guaranteed comparable across runs."
}
```

- [ ] **Step 4: Verify JSON parses + no missing-key lint**

Run: `node -e "JSON.parse(require('fs').readFileSync('apps/web/src/locales/zh-CN/benchmarks.json','utf8'));JSON.parse(require('fs').readFileSync('apps/web/src/locales/en-US/benchmarks.json','utf8'));console.log('ok')"`
Expected: `ok`.

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/locales/zh-CN/benchmarks.json apps/web/src/locales/en-US/benchmarks.json
git commit -m "$(printf 'feat(web): i18n for extra-args field (zh-CN + en-US)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 8: Seed — thinking-off on the 5 prefix-cache aiperf templates

**Files:**
- Modify: `apps/api/prisma/seed.ts`

- [ ] **Step 1: Locate the 5 template rows**

Run: `grep -n 'id: "tpl_pc_t1_article"\|id: "tpl_pc_t2_deep"\|id: "tpl_pc_t3_shallow"\|id: "tpl_pc_mooncake_conv"\|id: "tpl_pc_mooncake_agent"' apps/api/prisma/seed.ts`

- [ ] **Step 2: Add `extraArgs` to each template's aiperf params object**

For each of the 5 rows, inside its `params: { ... }` (the aiperf params object — same place `mooncakeTrace` / `traceReplayWindowSec` live), add:
```ts
        extraArgs: "--extra-inputs chat_template_kwargs:'{\"enable_thinking\":false}'",
```

> The exact key for the params object may be `params` or `config` — match the
> sibling keys already present in those rows (`mooncakeTrace`, `seed`, etc.).

- [ ] **Step 3: Run the seed to verify schema validation + upsert**

Run: `pnpm -F @modeldoctor/api db:seed`
Expected: completes without a zod error (the new `extraArgs` is now part of
`aiperfParamsSchema`, so the rows validate and UPSERT).

- [ ] **Step 4: Verify the value landed**

Run: `PGPASSWORD=modeldoctor psql -h localhost -U modeldoctor -d modeldoctor -t -A -c "select id, config->>'extraArgs' from benchmark_templates where id like 'tpl_pc_%' order by id;"`
Expected: all 5 prefix-cache rows show the `--extra-inputs chat_template_kwargs:...` string. (Adjust `config` → `params` if that is the column name.)

- [ ] **Step 5: Commit**
```bash
git add apps/api/prisma/seed.ts
git commit -m "$(printf 'feat(api): disable thinking on prefix-cache aiperf templates via extraArgs\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 9: Full verification + push

- [ ] **Step 1: Build the workspace** (new worktree needs dist for cross-package typecheck)

Run: `pnpm -r build`
Expected: all packages build (esp. `@modeldoctor/tool-adapters` dist so api/web typecheck sees the new schema field).

- [ ] **Step 2: Typecheck + lint + tests across touched packages**

Run:
```bash
pnpm -F @modeldoctor/tool-adapters test
pnpm -F @modeldoctor/web test -- ExtraArgsField AiperfParamsForm
pnpm lint
```
Expected: all green. Fix any biome / no-hardcoded-zh findings (use the JSON i18n keys — no literal CJK in TS/TSX).

- [ ] **Step 3: Push the branch**

```bash
git push -u origin feat/tool-params-extra-args
```

- [ ] **Step 4: Open the PR** (do NOT merge — user confirms merge)

```bash
gh pr create --base main --title "feat: raw extra-CLI-args escape hatch for tool params + thinking-off templates" --body "$(cat <<'BODY'
## What

Adds a single raw extra-CLI-args textarea ("Advanced (raw CLI)") to the
aiperf / evalscope / guidellm benchmark param forms. Pasted flags are appended
verbatim to the tool argv; a per-tool locked-flag denylist rejects any attempt to
override managed flags (model / url / api-key / output paths). vegeta is out of
scope (shell-pipeline command — no clean argv append).

Ships the 5 official prefix-cache aiperf templates with thinking disabled via
`extraArgs: --extra-inputs chat_template_kwargs:'{"enable_thinking":false}'`
(no-op for non-thinking models; required to keep Qwen3 prefill/prefix-cache
measurements clean).

Spec: `docs/superpowers/specs/2026-06-17-tool-params-extra-args-design.md`

## Test
- `core/extra-args.spec.ts` (quote-aware parse, locked-flag reject, unknown allow)
- per-tool runtime specs (append + reject + no-op)
- `ExtraArgsField.test.tsx`
- seed re-validates + UPSERTs the 5 templates

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

- [ ] **Step 5: Verify PR signals** (per CLAUDE.md PR follow-through)

Run: `gh pr checks` and `gh pr view --json statusCheckRollup,mergeStateStatus`
Surface CI results to the user; do not declare done until checks resolve.

---

## Self-Review

- **Spec coverage:** shared core (Task 1) ✓; 3 tools schema+runtime+tests (Tasks 2-4) ✓; vegeta excluded ✓; UI textarea + wiring (Tasks 5-6) ✓; i18n (Task 7) ✓; 5 seed templates thinking-off (Task 8) ✓; persistence is automatic via params JSON (noted) ✓; report-surfacing explicitly deferred (spec "Reporting" → run-detail auto + AI method-section is follow-up).
- **Type consistency:** `parseExtraArgs` / `appendExtraArgs` / `ExtraArgsError` names identical across Tasks 1-4; `extraArgs: z.string().max(4000).optional()` identical in all 3 schemas; `fieldPrefix` prop matches the dispatcher contract in Task 6.
- **Placeholders:** none — every code step has full code; locked-flag sets are concrete (re-derive note included as a safety check, not a TODO).
