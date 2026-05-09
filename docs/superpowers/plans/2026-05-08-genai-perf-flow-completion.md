# genai-perf Flow Completion + prefix-cache-probe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push genai-perf to working end-to-end on k3d, surface the real failure stderr instead of a parser-induced misdirect, and add a brand-new `prefix-cache-probe` tool that validates Higress `ai-load-balancer` stickiness against vLLM via Prometheus deltas.

**Architecture:** Three independent fixes (callback handler, genai-perf adapter, web UI) feeding into a brand-new tool adapter that follows the existing adapter contract (schema → runtime.buildCommand → runtime.parseFinalReport). The new tool gets its own Python container running a probe script that POSTs to vLLM and queries Prometheus, reporting per-pod stickiness. K8s Jobs are the only execution path.

**Tech Stack:** Vitest 2 + biome (TS), pytest-style asserts in `runner.spec.ts` patterns, NestJS controller, React + react-hook-form + shadcn/ui, Python 3.11 + httpx for the new probe, K8s Job + per-tool runner image driven by `RUNNER_IMAGE_*` env.

**Spec reference:** `docs/superpowers/specs/2026-05-08-genai-perf-flow-completion-design.md`

**Worktree:** `/Users/fangyong/vllm/modeldoctor/feat-genai-perf-flow` (branch `feat/genai-perf-flow-completion`)

**Pre-flight (run once before Task 1):**
```bash
cd /Users/fangyong/vllm/modeldoctor/feat-genai-perf-flow
pnpm install                # populate node_modules in this worktree
pnpm -r build               # populate packages/*/dist so apps/api typecheck works
```

---

## Task 1: Callback handler — preserve real failure message

**Why:** When runner reports `body.state==="failed"` with the real "tool exited with code N" message, the controller still calls `parseFinalReport` and clobbers the message with "missing 'profile' output file". Users see a misdirect instead of the real cause.

**Files:**
- Modify: `apps/api/src/modules/benchmark/callbacks/benchmark-callback.controller.ts:113-127`
- Test:   `apps/api/src/modules/benchmark/callbacks/benchmark-callback.controller.spec.ts`

- [ ] **Step 1.1: Write the failing test**

Open `apps/api/src/modules/benchmark/callbacks/benchmark-callback.controller.spec.ts` and add this test inside the existing `describe("/finish ...")` block (next to `"/finish forces failed when adapter.parseFinalReport throws"`):

```ts
it("/finish state=failed preserves runner message and does NOT call parseFinalReport", async () => {
  const parseFinalReport = vi.fn(() => {
    throw new Error("should not be called when state=failed");
  });
  const adapter: ToolAdapter = {
    name: "guidellm",
    scenarios: ["inference"],
    paramsSchema: z.any(),
    reportSchema: z.any(),
    paramDefaults: {},
    buildCommand: () => ({ argv: [], env: {}, secretEnv: {}, outputFiles: {} }),
    parseProgress: () => null,
    parseFinalReport,
    getMaxDurationSeconds: () => 60,
  };
  vi.spyOn(registry, "byTool").mockReturnValue(adapter);

  await controller.handleFinish("benchmark-1", {
    state: "failed",
    exitCode: 137,
    message: "tool exited with code 137",
    stdout: "",
    stderr: "OSError: perf_analyzer not found",
    files: {},
  } as never);

  expect(parseFinalReport).not.toHaveBeenCalled();
  expect(repo.lastUpdate).toMatchObject({
    status: "failed",
    statusMessage: "tool exited with code 137",
    summaryMetrics: null,
  });
});
```

(Adjust import names to match the existing spec — the existing tests already mock `byTool` and have a `repo` test double; reuse them. If the helper names differ, mirror what `"/finish forces failed when adapter.parseFinalReport throws"` already does.)

- [ ] **Step 1.2: Run the test and confirm it fails**

```bash
pnpm -F api test -- benchmark-callback.controller.spec
```

Expected: the new test fails because `parseFinalReport` is called regardless of `body.state`.

- [ ] **Step 1.3: Implement — gate parseFinalReport on state=completed**

Edit `apps/api/src/modules/benchmark/callbacks/benchmark-callback.controller.ts`. Replace lines 113-127:

```ts
const adapter = byTool(row.tool as ToolName);
let finalState: "completed" | "failed" = body.state;
let message = body.message;
let summary: unknown = null;

if (body.state === "completed") {
  try {
    const fileBuffers: Record<string, Buffer> = Object.fromEntries(
      Object.entries(body.files).map(([k, v]) => [k, Buffer.from(v, "base64")]),
    );
    summary = adapter.parseFinalReport(body.stdout, fileBuffers);
  } catch (e) {
    finalState = "failed";
    message = `report parse: ${(e as Error).message}`.slice(0, 2048);
    summary = null;
  }
}
// state==="failed": preserve runner-supplied message + body.stderr/stdout into rawOutput below.
```

The existing `await this.benchmarks.update(id, { ... rawOutput: { stdout, stderr, files } })` block on lines 129-139 already persists `body.stderr`, so failure-path users will see it via the BenchmarkDetailPage stderr tail (Task 4).

- [ ] **Step 1.4: Run the test and confirm it passes**

```bash
pnpm -F api test -- benchmark-callback.controller.spec
```

Expected: ALL tests in the spec pass, including the new one and the existing "/finish forces failed when adapter.parseFinalReport throws" (regression).

- [ ] **Step 1.5: Run full api test suite and typecheck**

```bash
pnpm -F api test
pnpm -F api typecheck
```

Expected: all green.

- [ ] **Step 1.6: Commit**

```bash
git add apps/api/src/modules/benchmark/callbacks/benchmark-callback.controller.ts \
        apps/api/src/modules/benchmark/callbacks/benchmark-callback.controller.spec.ts
git commit -m "$(cat <<'EOF'
fix(api): preserve original failure message in /finish callback

When the runner reports body.state="failed" with a real tool exit code +
stderr, the previous code unconditionally called parseFinalReport, whose
"missing 'profile' output file" exception clobbered the actual cause. Gate
parseFinalReport behind state==="completed" so the diagnostic chain stays
intact: tool exit code → runner message → DB statusMessage → UI.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: genai-perf adapter — `--service-kind openai` + tokenizer fallback to `connection.model`

**Why:** Per handoff §3 the verified invocation requires `--service-kind openai` (otherwise genai-perf treats `chat` as text completions). Tokenizer is mandatory in 0.0.16; the current `params.tokenizer ?? connection.tokenizerHfId` fallback can resolve to undefined and the adapter omits the flag entirely → 5-second tool failure. `connection.model` is the right fallback because for vLLM/SGLang deployments the model id is usually a valid HF tokenizer id.

**Files:**
- Modify: `packages/tool-adapters/src/genai-perf/runtime.ts:87-92`, `121-131`
- Test:   `packages/tool-adapters/src/genai-perf/runtime.spec.ts:30-254`

- [ ] **Step 2.1: Write the failing tests**

In `packages/tool-adapters/src/genai-perf/runtime.spec.ts`, inside `describe("genai-perf.buildCommand", ...)`, add:

```ts
it("emits --service-kind openai (regression: chat endpoints need this)", () => {
  const r = buildCommand({
    runId: "r1",
    params: baseParams,
    connection: baseConn,
    callback: { url: "http://api/", token: "tk" },
  });
  expect(r.argv[2]).toContain("--service-kind openai");
});

it("falls back to connection.model when no params.tokenizer or connection.tokenizerHfId", () => {
  const r = buildCommand({
    runId: "r1",
    params: { ...baseParams, tokenizer: undefined },
    connection: { ...baseConn, tokenizerHfId: null }, // model = "Qwen2.5-0.5B-Instruct"
    callback: { url: "http://api/", token: "tk" },
  });
  expect(r.argv[2]).toMatch(/--tokenizer\s+"\$\d+"/);
  expect(r.argv).toContain("Qwen2.5-0.5B-Instruct"); // baseConn.model
});
```

Then **delete** the existing `it("omits --tokenizer when neither is set", ...)` block (lines 237-253) — that contract is being replaced by the fallback chain.

- [ ] **Step 2.2: Run the tests and confirm they fail**

```bash
pnpm -F @modeldoctor/tool-adapters test -- genai-perf
```

Expected: the two new tests fail (`--service-kind openai` not in script; `Qwen2.5-0.5B-Instruct` not in argv).

- [ ] **Step 2.3: Implement — add `--service-kind openai` and extend the tokenizer fallback**

In `packages/tool-adapters/src/genai-perf/runtime.ts`:

Replace the tokenizer block (lines 86-92) with:

```ts
// Tokenizer: per-run override > connection-level override > connection.model.
// connection.model is the final fallback because vLLM/SGLang deployments
// typically set model to an HF tokenizer id (e.g. "Qwen/Qwen2.5-0.5B-Instruct").
// genai-perf 0.0.16 hard-requires --tokenizer, so we always emit the flag.
const resolvedTokenizer =
  params.tokenizer ?? connection.tokenizerHfId ?? connection.model;
optionalTokenFlags += ` \\\n    --tokenizer "$${nextPos}"`;
optionalArgv.push(resolvedTokenizer);
nextPos++;
```

Replace the `script` template literal (line 121) by inserting `--service-kind openai \\` immediately after `genai-perf profile \\`:

```ts
const script = `set -e
STREAMING=""
if [ "$6" = "true" ]; then STREAMING="--streaming"; fi
genai-perf profile \\
    --service-kind openai \\
    -m "$1" -u "$2" \\
    --endpoint-type "$3" \\
    --num-prompts "$4" --concurrency "$5" \\
    --header "Authorization: Bearer $OPENAI_API_KEY" \\
    $STREAMING${optionalTokenFlags} \\
    --profile-export-file profile_export.json
find artifacts -name profile_export_genai_perf.json -exec cp {} ./profile_export_genai_perf.json \\; && [ -f ./profile_export_genai_perf.json ]`;
```

- [ ] **Step 2.4: Run the tests and confirm they pass**

```bash
pnpm -F @modeldoctor/tool-adapters test -- genai-perf
```

Expected: all genai-perf tests pass, including the two new ones and the existing fallback / streaming / fixture tests.

- [ ] **Step 2.5: Run the full tool-adapters test suite + typecheck**

```bash
pnpm -F @modeldoctor/tool-adapters test
pnpm -F @modeldoctor/tool-adapters typecheck
```

Expected: all green. (Watch for the `falls back to connection.tokenizerHfId` test — it should still pass since the `?? connection.model` change only adds a tail fallback.)

- [ ] **Step 2.6: Commit**

```bash
git add packages/tool-adapters/src/genai-perf/runtime.ts \
        packages/tool-adapters/src/genai-perf/runtime.spec.ts
git commit -m "$(cat <<'EOF'
fix(tool-adapters/genai-perf): emit --service-kind openai + tokenizer fallback

Two corrections to align with the handoff §3 verified invocation:
1. Add --service-kind openai (chat endpoints get treated as text completions
   without it).
2. Extend tokenizer resolution to fall back to connection.model when neither
   params.tokenizer nor connection.tokenizerHfId is set. genai-perf 0.0.16
   hard-requires --tokenizer, and connection.model is typically a valid HF
   tokenizer id for vLLM/SGLang deployments.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Web — GenaiPerfParamsForm tokenizer runtime preview

**Why:** Users today have to mentally trace `params.tokenizer ?? connection.tokenizerHfId ?? connection.model` to know what tokenizer will actually be used. Show it inline so they don't have to.

**Files:**
- Modify: `apps/web/src/features/benchmarks/forms/GenaiPerfParamsForm.tsx:236-246`
- Test:   `apps/web/src/features/benchmarks/forms/__tests__/GenaiPerfParamsForm.test.tsx` (create if missing)
- Modify: `apps/web/src/locales/zh-CN/benchmarks.json` (add `forms.genaiPerf.tokenizerPreview`)
- Modify: `apps/web/src/locales/en-US/benchmarks.json` (parallel key)

- [ ] **Step 3.1: Write the failing test**

If `apps/web/src/features/benchmarks/forms/__tests__/` doesn't exist, create it. Add `GenaiPerfParamsForm.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FormProvider, useForm } from "react-hook-form";
import { GenaiPerfParamsForm } from "../GenaiPerfParamsForm";

vi.mock("@/features/connections/queries", () => ({
  useConnections: () => ({
    data: [
      {
        id: "c1",
        model: "Qwen/Qwen2.5-0.5B-Instruct",
        tokenizerHfId: null,
        category: "text",
      },
    ],
  }),
}));

function Harness({ tokenizer }: { tokenizer?: string }) {
  const form = useForm({
    defaultValues: { connectionId: "c1", params: { tokenizer } },
  });
  return (
    <FormProvider {...form}>
      <GenaiPerfParamsForm />
    </FormProvider>
  );
}

describe("GenaiPerfParamsForm tokenizer preview", () => {
  it("shows fallback tokenizer = connection.model when no override", () => {
    render(<Harness />);
    // Open the Advanced details element
    screen.getByText(/Advanced/i).click();
    expect(screen.getByText(/Qwen\/Qwen2\.5-0\.5B-Instruct/)).toBeInTheDocument();
  });

  it("shows the override when params.tokenizer is set", () => {
    render(<Harness tokenizer="custom/Tokenizer" />);
    screen.getByText(/Advanced/i).click();
    expect(screen.getByText(/custom\/Tokenizer/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3.2: Run the test and confirm it fails**

```bash
pnpm -F web test -- GenaiPerfParamsForm
```

Expected: FAIL — the form doesn't render the resolved tokenizer text yet.

- [ ] **Step 3.3: Implement — add resolved tokenizer preview**

In `apps/web/src/features/benchmarks/forms/GenaiPerfParamsForm.tsx`, add a `useWatch` for `params.tokenizer` near the existing `streaming` watch (around line 38), then update the `<details className="...Advanced...">` block (around lines 221-247). Replace the tokenizer field section (lines 236-246) with:

```tsx
<div className="space-y-2">
  <Label htmlFor={ids.tokenizer}>Tokenizer (HuggingFace id, optional)</Label>
  <Input
    id={ids.tokenizer}
    {...register(`${fieldPrefix}.tokenizer`, {
      setValueAs: (v) => (v === "" || v === undefined ? undefined : v),
    })}
    placeholder="Overrides connection-level default; leave empty to use it."
  />
  <p className="text-xs text-muted-foreground">
    {(() => {
      const override = (useWatch({ control, name: `${fieldPrefix}.tokenizer` }) as string | undefined) || undefined;
      const resolved = override ?? connection?.tokenizerHfId ?? connection?.model;
      if (!resolved) return null;
      return override
        ? `Will use: ${resolved}`
        : `No override set — will use: ${resolved}`;
    })()}
  </p>
</div>
```

(Move the `useWatch` for tokenizer up beside the `streaming` watch to avoid the inline IIFE if cleaner — either pattern is fine. Keep the i18n keys lazy: this PR keeps these strings in English only since the surrounding form labels are also English; do NOT introduce mid-form Chinese text.)

- [ ] **Step 3.4: Run the test and confirm it passes**

```bash
pnpm -F web test -- GenaiPerfParamsForm
```

Expected: both tests pass.

- [ ] **Step 3.5: Run full web test suite + typecheck**

```bash
pnpm -F web test
pnpm -F web typecheck
```

Expected: all green.

- [ ] **Step 3.6: Commit**

```bash
git add apps/web/src/features/benchmarks/forms/GenaiPerfParamsForm.tsx \
        apps/web/src/features/benchmarks/forms/__tests__/GenaiPerfParamsForm.test.tsx
git commit -m "$(cat <<'EOF'
feat(web/benchmarks): show resolved tokenizer in GenaiPerfParamsForm

Adds an inline preview line under the Advanced > Tokenizer input that
shows which tokenizer will actually be sent to genai-perf, following the
same fallback chain as the adapter (params.tokenizer >
connection.tokenizerHfId > connection.model).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Web — BenchmarkDetailPage stderr tail on failure

**Why:** Once Task 1 ships, `rawOutput.stderr` carries the real failure cause. Surface it as a collapsible block on the detail page so users can self-diagnose.

**Files:**
- Modify: `apps/web/src/features/benchmarks/BenchmarkDetailPage.tsx` (failure alert region)
- Test:   `apps/web/src/features/benchmarks/__tests__/BenchmarkDetailPage.test.tsx` (extend existing)
- Modify: `apps/web/src/locales/{zh-CN,en-US}/benchmarks.json` (add `detail.failure.toggleStderr`, `detail.failure.stderrEmpty`)

- [ ] **Step 4.1: Add i18n keys**

`apps/web/src/locales/zh-CN/benchmarks.json` — add under `detail`:

```json
"failure": {
  "toggleStderr": "查看错误输出（stderr 末尾 200 行）",
  "stderrEmpty": "没有捕获到 stderr 输出"
}
```

`apps/web/src/locales/en-US/benchmarks.json` — parallel:

```json
"failure": {
  "toggleStderr": "Show error output (last 200 lines of stderr)",
  "stderrEmpty": "No stderr captured"
}
```

(If either file already has a `detail.failure` block, merge in. Verify with `pnpm -F web check:i18n-parity` after step 4.6.)

- [ ] **Step 4.2: Write the failing test**

In `apps/web/src/features/benchmarks/__tests__/BenchmarkDetailPage.test.tsx`, add:

```tsx
it("renders stderr tail when status=failed and rawOutput.stderr is non-empty", async () => {
  const benchmark = makeBenchmark({
    status: "failed",
    statusMessage: "tool exited with code 137",
    rawOutput: { stdout: "", stderr: "OSError: perf_analyzer not found", files: {} },
  });
  renderDetailPage(benchmark);
  const toggle = screen.getByText(/Show error output|查看错误输出/i);
  expect(toggle).toBeInTheDocument();
  toggle.click();
  expect(await screen.findByText(/perf_analyzer not found/)).toBeInTheDocument();
});

it("renders empty-state copy when status=failed but stderr is empty", () => {
  const benchmark = makeBenchmark({
    status: "failed",
    statusMessage: "tool exited with code 137",
    rawOutput: { stdout: "", stderr: "", files: {} },
  });
  renderDetailPage(benchmark);
  const toggle = screen.getByText(/Show error output|查看错误输出/i);
  toggle.click();
  expect(screen.getByText(/No stderr captured|没有捕获到 stderr 输出/i)).toBeInTheDocument();
});
```

(Reuse whatever `makeBenchmark` / `renderDetailPage` helpers already exist in this test file. If they don't exist, mirror the patterns used by surrounding tests in the same file.)

- [ ] **Step 4.3: Run the tests and confirm they fail**

```bash
pnpm -F web test -- BenchmarkDetailPage
```

Expected: both new tests fail (toggle not found).

- [ ] **Step 4.4: Implement — add stderr tail to failure region**

In `apps/web/src/features/benchmarks/BenchmarkDetailPage.tsx`, find the failure `<Alert variant="destructive">` block (search for `statusMessage` and `failed`). Immediately after the Alert, before the `<BenchmarkChartsSection .../>` or other report components, insert:

```tsx
{benchmark.status === "failed" && (
  <details className="mt-3 rounded-md border border-border bg-muted/20 px-3 py-2 text-sm">
    <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">
      {t("benchmarks:detail.failure.toggleStderr")}
    </summary>
    {(() => {
      const stderr = (benchmark.rawOutput as { stderr?: string } | null)?.stderr ?? "";
      if (!stderr.trim()) {
        return (
          <p className="mt-2 text-xs text-muted-foreground">
            {t("benchmarks:detail.failure.stderrEmpty")}
          </p>
        );
      }
      const lines = stderr.split("\n");
      const tail = lines.slice(-200).join("\n");
      return (
        <pre className="mt-2 max-h-80 overflow-auto rounded bg-background p-3 text-xs">
          {tail}
        </pre>
      );
    })()}
  </details>
)}
```

- [ ] **Step 4.5: Run the tests and confirm they pass**

```bash
pnpm -F web test -- BenchmarkDetailPage
pnpm -F web check:i18n-parity
```

Expected: both new tests pass; i18n parity check is green.

- [ ] **Step 4.6: Commit**

```bash
git add apps/web/src/features/benchmarks/BenchmarkDetailPage.tsx \
        apps/web/src/features/benchmarks/__tests__/BenchmarkDetailPage.test.tsx \
        apps/web/src/locales/zh-CN/benchmarks.json \
        apps/web/src/locales/en-US/benchmarks.json
git commit -m "$(cat <<'EOF'
feat(web/benchmarks): show stderr tail on failed benchmark detail page

After the callback handler stopped clobbering real failure messages,
rawOutput.stderr carries the actual diagnostic. Add a collapsible details
block under the failure alert that shows the last 200 lines of stderr
(or an empty-state message when stderr is empty), so users can self-
diagnose perf_analyzer / tokenizer / network issues without digging into
DB or kubectl logs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Extend ToolName + ScenarioId unions for prefix-cache-probe

**Why:** Both contracts (`packages/contracts/src/benchmark.ts`) and tool-adapters (`packages/tool-adapters/src/{core/interface,scenarios}.ts`) keep duplicate enums. They MUST stay in sync; the `assertScenariosInvariant()` startup check fails the api otherwise.

**Files:**
- Modify: `packages/contracts/src/benchmark.ts:6,9`
- Modify: `packages/tool-adapters/src/core/interface.ts:7,22-25`
- Modify: `packages/tool-adapters/src/scenarios.ts:6-7,17`

This task is a pure type-extension prerequisite for Tasks 6-10. It will introduce **temporarily-broken** references because the new union members have no adapter / no SCENARIOS entry yet — those land in Task 8. Therefore Task 5 ends with a partial commit and tests deferred to Task 8.

- [ ] **Step 5.1: Edit `packages/contracts/src/benchmark.ts`**

Replace lines 6-10:

```ts
export const scenarioIdSchema = z.enum([
  "inference",
  "capacity",
  "gateway",
  "prefix-cache-validation",
]);
export type ScenarioId = z.infer<typeof scenarioIdSchema>;

export const benchmarkToolSchema = z.enum([
  "guidellm",
  "genai-perf",
  "vegeta",
  "prefix-cache-probe",
]);
export type BenchmarkTool = z.infer<typeof benchmarkToolSchema>;
```

- [ ] **Step 5.2: Edit `packages/tool-adapters/src/core/interface.ts`**

Replace line 7:

```ts
export type ToolName =
  | "guidellm"
  | "genai-perf"
  | "vegeta"
  | "prefix-cache-probe";
```

Update the `ToolReport` union (lines 14-25) to add the prefix-cache-probe variant. Add an import next to the others:

```ts
import type { PrefixCacheProbeReport } from "../prefix-cache-probe/schema.js";
```

Extend `ToolReport`:

```ts
export type ToolReport =
  | { tool: "guidellm"; data: GuidellmReport }
  | { tool: "genai-perf"; data: GenaiPerfReport }
  | { tool: "vegeta"; data: VegetaReport }
  | { tool: "prefix-cache-probe"; data: PrefixCacheProbeReport };
```

(The import target doesn't exist yet; that's expected. Task 6 creates it.)

- [ ] **Step 5.3: Edit `packages/tool-adapters/src/scenarios.ts`**

Replace lines 6-7:

```ts
export type ScenarioId = "inference" | "capacity" | "gateway" | "prefix-cache-validation";

export const scenarioIdSchema = z.enum([
  "inference",
  "capacity",
  "gateway",
  "prefix-cache-validation",
]);
```

Add a new entry to the `SCENARIOS` map (after the `gateway` block):

```ts
"prefix-cache-validation": {
  label: "Prefix-cache 路由验证",
  description: "验证 Higress ai-load-balancer prefix-cache 策略下相同前缀请求是否粘到同一 vLLM 副本",
  tools: ["prefix-cache-probe"],
  paramsConstraints: {},
  reportComponent: "PrefixCacheProbeReport" as ScenarioConfig["reportComponent"],
},
```

(`reportComponent` is a `"InferenceReport" | "CapacityReport" | "GatewayReport"` union; widen it in the same edit. Update line 14:

```ts
readonly reportComponent:
  | "InferenceReport"
  | "CapacityReport"
  | "GatewayReport"
  | "PrefixCacheProbeReport";
```

The cast in the new SCENARIOS entry can then be removed.)

- [ ] **Step 5.4: Don't run tests yet — types are intentionally incomplete**

Skip building/testing here. The build will fail because `PrefixCacheProbeReport` doesn't exist yet. Move directly to Task 6.

- [ ] **Step 5.5: Stage but DO NOT commit yet**

```bash
git add packages/contracts/src/benchmark.ts \
        packages/tool-adapters/src/core/interface.ts \
        packages/tool-adapters/src/scenarios.ts
```

(Tasks 6-8 will share a commit with these changes — they're all needed together for the registry to compile.)

---

## Task 6: prefix-cache-probe adapter — schema

**Files:**
- Create: `packages/tool-adapters/src/prefix-cache-probe/schema.ts`
- Create: `packages/tool-adapters/src/prefix-cache-probe/schema.spec.ts`

- [ ] **Step 6.1: Write the failing schema spec**

Create `packages/tool-adapters/src/prefix-cache-probe/schema.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  prefixCacheProbeParamsSchema,
  prefixCacheProbeReportSchema,
  prefixCacheProbeParamDefaults,
} from "./schema.js";

describe("prefixCacheProbeParamsSchema", () => {
  it("applies defaults", () => {
    const r = prefixCacheProbeParamsSchema.parse({});
    expect(r.promptSets).toBe(2);
    expect(r.requestsPerSet).toBe(10);
    expect(r.maxTokens).toBe(5);
    expect(r.promBackoffSec).toBe(18);
  });

  it("rejects promptSets < 2 (need at least two distinct prompts to detect routing)", () => {
    expect(() => prefixCacheProbeParamsSchema.parse({ promptSets: 1 })).toThrow();
  });

  it("rejects promptSets > 5 (probe script ships 5 fixed prompts)", () => {
    expect(() => prefixCacheProbeParamsSchema.parse({ promptSets: 6 })).toThrow();
  });

  it("rejects promBackoffSec < 15 (Prom default scrape interval)", () => {
    expect(() => prefixCacheProbeParamsSchema.parse({ promBackoffSec: 14 })).toThrow();
  });

  it("matches paramDefaults", () => {
    const parsed = prefixCacheProbeParamsSchema.parse({});
    expect(parsed).toMatchObject(prefixCacheProbeParamDefaults);
  });
});

describe("prefixCacheProbeReportSchema", () => {
  it("accepts a well-formed report", () => {
    const r = prefixCacheProbeReportSchema.parse({
      stickinessPct: 100,
      deterministic: true,
      perPod: [{ pod: "vllm-0", queries: 50, hits: 40 }],
      promptSets: [
        { label: "set-0", dominantPod: "vllm-0", dominantPct: 100, totalRequests: 10 },
      ],
    });
    expect(r.stickinessPct).toBe(100);
  });

  it("rejects stickinessPct out of [0, 100]", () => {
    expect(() =>
      prefixCacheProbeReportSchema.parse({
        stickinessPct: 101,
        deterministic: true,
        perPod: [],
        promptSets: [],
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 6.2: Confirm it fails**

```bash
pnpm -F @modeldoctor/tool-adapters test -- prefix-cache-probe
```

Expected: import fails because `schema.ts` doesn't exist.

- [ ] **Step 6.3: Implement schema**

Create `packages/tool-adapters/src/prefix-cache-probe/schema.ts`:

```ts
import { z } from "zod";

// ── Params ────────────────────────────────────────────────────────────
// promptSets capped at 5 because the bundled probe script ships 5 fixed
// long-prefix prompts (see apps/benchmark-runner/scripts/prefix_cache_probe.py).
// promBackoffSec must be >= 15 because Prometheus default scrape interval
// is 15s; querying earlier returns a stale snapshot with 0 deltas.
export const prefixCacheProbeParamsSchema = z.object({
  promptSets: z.number().int().min(2).max(5).default(2),
  requestsPerSet: z.number().int().min(5).max(50).default(10),
  maxTokens: z.number().int().min(1).max(50).default(5),
  promBackoffSec: z.number().int().min(15).max(60).default(18),
});
export type PrefixCacheProbeParams = z.infer<typeof prefixCacheProbeParamsSchema>;

export const prefixCacheProbeParamDefaults: Partial<PrefixCacheProbeParams> = {
  promptSets: 2,
  requestsPerSet: 10,
  maxTokens: 5,
  promBackoffSec: 18,
};

// ── Report ────────────────────────────────────────────────────────────
const perPodCounts = z.object({
  pod: z.string(),
  queries: z.number().int().nonnegative(),
  hits: z.number().int().nonnegative(),
});

const promptSetSummary = z.object({
  label: z.string(),
  dominantPod: z.string(),
  dominantPct: z.number().min(0).max(100),
  totalRequests: z.number().int().nonnegative(),
});

export const prefixCacheProbeReportSchema = z.object({
  stickinessPct: z.number().min(0).max(100),
  deterministic: z.boolean(),
  perPod: z.array(perPodCounts),
  promptSets: z.array(promptSetSummary),
});
export type PrefixCacheProbeReport = z.infer<typeof prefixCacheProbeReportSchema>;
```

- [ ] **Step 6.4: Confirm tests pass**

```bash
pnpm -F @modeldoctor/tool-adapters test -- prefix-cache-probe
```

Expected: all schema tests pass.

- [ ] **Step 6.5: Stage but don't commit yet**

```bash
git add packages/tool-adapters/src/prefix-cache-probe/schema.ts \
        packages/tool-adapters/src/prefix-cache-probe/schema.spec.ts
```

---

## Task 7: prefix-cache-probe adapter — runtime + fixture

**Files:**
- Create: `packages/tool-adapters/src/prefix-cache-probe/runtime.ts`
- Create: `packages/tool-adapters/src/prefix-cache-probe/runtime.spec.ts`
- Create: `packages/tool-adapters/src/prefix-cache-probe/__fixtures__/result.json`

- [ ] **Step 7.1: Create the fixture**

`packages/tool-adapters/src/prefix-cache-probe/__fixtures__/result.json`:

```json
{
  "stickinessPct": 95.0,
  "deterministic": true,
  "perPod": [
    { "pod": "vllm-0", "queries": 100, "hits": 92 },
    { "pod": "vllm-1", "queries": 100, "hits": 88 }
  ],
  "promptSets": [
    { "label": "set-0", "dominantPod": "vllm-0", "dominantPct": 100.0, "totalRequests": 10 },
    { "label": "set-1", "dominantPod": "vllm-1", "dominantPct": 90.0, "totalRequests": 10 }
  ]
}
```

- [ ] **Step 7.2: Write the failing runtime spec**

`packages/tool-adapters/src/prefix-cache-probe/runtime.spec.ts`:

```ts
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildCommand, getMaxDurationSeconds, parseFinalReport, parseProgress } from "./runtime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureBuf = fs.readFileSync(path.join(__dirname, "__fixtures__/result.json"));

const baseConn = {
  baseUrl: "http://10.100.121.67:30888",
  apiKey: "sk-test",
  model: "Qwen/Qwen2.5-0.5B-Instruct",
  customHeaders: "",
  queryParams: "",
  tokenizerHfId: null,
  prometheusUrl: "http://10.100.121.67:30121",
};

const baseParams = {
  promptSets: 2,
  requestsPerSet: 10,
  maxTokens: 5,
  promBackoffSec: 18,
};

describe("prefix-cache-probe.buildCommand", () => {
  it("argv is python /app/probe.py with required flags", () => {
    const r = buildCommand({
      runId: "r1",
      params: baseParams,
      connection: baseConn as never,
      callback: { url: "http://api/", token: "tk" },
    });
    expect(r.argv[0]).toBe("python");
    expect(r.argv[1]).toBe("/app/probe.py");
    const flat = r.argv.join(" ");
    expect(flat).toContain("--url http://10.100.121.67:30888");
    expect(flat).toContain("--prom http://10.100.121.67:30121");
    expect(flat).toContain("--model Qwen/Qwen2.5-0.5B-Instruct");
    expect(flat).toContain("--rounds 2");
    expect(flat).toContain("--requests 10");
    expect(flat).toContain("--max-tokens 5");
    expect(flat).toContain("--backoff 18");
  });

  it("apiKey ships via secretEnv.OPENAI_API_KEY (never argv)", () => {
    const r = buildCommand({
      runId: "r1",
      params: baseParams,
      connection: baseConn as never,
      callback: { url: "http://api/", token: "tk" },
    });
    expect(r.argv.join(" ")).not.toContain("sk-test");
    expect(r.secretEnv.OPENAI_API_KEY).toBe("sk-test");
  });

  it("throws when connection.prometheusUrl is null/undefined", () => {
    const conn = { ...baseConn, prometheusUrl: null };
    expect(() =>
      buildCommand({
        runId: "r1",
        params: baseParams,
        connection: conn as never,
        callback: { url: "http://api/", token: "tk" },
      }),
    ).toThrow(/prometheusUrl/);
  });

  it("outputFiles.result is result.json", () => {
    const r = buildCommand({
      runId: "r1",
      params: baseParams,
      connection: baseConn as never,
      callback: { url: "http://api/", token: "tk" },
    });
    expect(r.outputFiles.result).toBe("result.json");
  });
});

describe("prefix-cache-probe.parseProgress", () => {
  it("returns null for any input", () => {
    expect(parseProgress("anything")).toBeNull();
  });
});

describe("prefix-cache-probe.parseFinalReport", () => {
  it("parses fixture into typed report", () => {
    const r = parseFinalReport("", { result: fixtureBuf });
    expect(r.tool).toBe("prefix-cache-probe");
    if (r.tool !== "prefix-cache-probe") throw new Error("type narrowing");
    expect(r.data.stickinessPct).toBe(95.0);
    expect(r.data.perPod).toHaveLength(2);
  });

  it("throws when files.result is missing", () => {
    expect(() => parseFinalReport("", {})).toThrow();
  });
});

describe("prefix-cache-probe.getMaxDurationSeconds", () => {
  it("scales with promptSets * (requestsPerSet * 5 + promBackoffSec) + 60", () => {
    const secs = getMaxDurationSeconds({ ...baseParams, promptSets: 3 });
    // 3 * (10 * 5 + 18) + 60 = 3 * 68 + 60 = 264
    expect(secs).toBe(264);
  });
});
```

- [ ] **Step 7.3: Confirm fail**

```bash
pnpm -F @modeldoctor/tool-adapters test -- prefix-cache-probe
```

Expected: import fails (runtime.ts missing).

- [ ] **Step 7.4: Implement runtime**

The adapter's `BuildCommandPlan.connection` type currently has no `prometheusUrl` field (it's part of the runtime DB row but not the adapter contract). Extend it. In `packages/tool-adapters/src/core/interface.ts`, add to the `BuildCommandPlan.connection` shape (around line 35-44):

```ts
connection: {
  baseUrl: string;
  apiKey: string;
  model: string;
  customHeaders: string;
  queryParams: string;
  tokenizerHfId: string | null;
  /**
   * Prometheus base URL associated with the inference deployment, when
   * known. Required by tools that read per-pod metrics (prefix-cache-probe);
   * other adapters (guidellm/genai-perf/vegeta) ignore it. Null when the
   * user hasn't configured one on the connection.
   */
  prometheusUrl: string | null;
};
```

Then verify the api side already passes this through. Check `apps/api/src/modules/benchmark/benchmark.service.ts` for where it builds the `BuildCommandPlan.connection` object — if `prometheusUrl` isn't in that map, add it (mirror `tokenizerHfId`).

```bash
grep -n "tokenizerHfId" apps/api/src/modules/benchmark/benchmark.service.ts
```

Use the line numbers found to add `prometheusUrl: connection.prometheusUrl,` in the same object literal.

Now create `packages/tool-adapters/src/prefix-cache-probe/runtime.ts`:

```ts
import type {
  BuildCommandPlan,
  BuildCommandResult,
  ProgressEvent,
  ToolReport,
} from "../core/interface.js";
import {
  type PrefixCacheProbeParams,
  prefixCacheProbeReportSchema,
} from "./schema.js";

export function buildCommand(
  plan: BuildCommandPlan<PrefixCacheProbeParams>,
): BuildCommandResult {
  const { params, connection } = plan;
  if (!connection.prometheusUrl) {
    throw new Error(
      "prefix-cache-probe requires connection.prometheusUrl to be configured",
    );
  }

  // Argv passes user-supplied strings (baseUrl, prometheusUrl, model) as
  // separate argv entries — Python argparse doesn't shell-expand them, so
  // there's no injection surface (unlike the genai-perf shell wrapper).
  const argv = [
    "python",
    "/app/probe.py",
    "--url",
    connection.baseUrl,
    "--prom",
    connection.prometheusUrl,
    "--model",
    connection.model,
    "--rounds",
    String(params.promptSets),
    "--requests",
    String(params.requestsPerSet),
    "--max-tokens",
    String(params.maxTokens),
    "--backoff",
    String(params.promBackoffSec),
    "--out",
    "result.json",
  ];

  return {
    argv,
    env: {},
    secretEnv: {
      OPENAI_API_KEY: connection.apiKey,
    },
    outputFiles: {
      result: "result.json",
    },
  };
}

export function parseProgress(_line: string): ProgressEvent | null {
  // probe.py logs are unstructured; no progress events for now.
  return null;
}

export function parseFinalReport(
  _stdout: string,
  files: Record<string, Buffer>,
): ToolReport {
  const buf = files.result;
  if (!buf) {
    throw new Error("prefix-cache-probe.parseFinalReport: missing 'result' output file");
  }
  const data = prefixCacheProbeReportSchema.parse(JSON.parse(buf.toString("utf8")));
  return { tool: "prefix-cache-probe", data };
}

export function getMaxDurationSeconds(params: PrefixCacheProbeParams): number {
  // Each round = (requests × ~5s/request) + Prom backoff.
  // +60s buffer for Prometheus query latency and result.json write.
  return params.promptSets * (params.requestsPerSet * 5 + params.promBackoffSec) + 60;
}
```

- [ ] **Step 7.5: Confirm tests pass**

```bash
pnpm -F @modeldoctor/tool-adapters test -- prefix-cache-probe
```

Expected: all 11 prefix-cache-probe tests pass.

- [ ] **Step 7.6: Stage but don't commit yet**

```bash
git add packages/tool-adapters/src/prefix-cache-probe/runtime.ts \
        packages/tool-adapters/src/prefix-cache-probe/runtime.spec.ts \
        packages/tool-adapters/src/prefix-cache-probe/__fixtures__/result.json \
        packages/tool-adapters/src/core/interface.ts \
        apps/api/src/modules/benchmark/benchmark.service.ts
```

---

## Task 8: prefix-cache-probe — index, registry, scenarios commit

**Files:**
- Create: `packages/tool-adapters/src/prefix-cache-probe/index.ts`
- Modify: `packages/tool-adapters/src/index.ts`
- Modify: `packages/tool-adapters/src/core/registry.ts`

This task closes the loop opened by Task 5 (the broken type union). After this commit, `pnpm -r build && pnpm -r test` must be green.

- [ ] **Step 8.1: Create index.ts**

`packages/tool-adapters/src/prefix-cache-probe/index.ts`:

```ts
import type { ToolAdapter } from "../core/interface.js";
import {
  buildCommand,
  getMaxDurationSeconds,
  parseFinalReport,
  parseProgress,
} from "./runtime.js";
import {
  prefixCacheProbeParamDefaults,
  prefixCacheProbeParamsSchema,
  prefixCacheProbeReportSchema,
} from "./schema.js";

export const prefixCacheProbeAdapter: ToolAdapter = {
  name: "prefix-cache-probe",
  scenarios: ["prefix-cache-validation"] as const,
  paramsSchema: prefixCacheProbeParamsSchema,
  reportSchema: prefixCacheProbeReportSchema,
  paramDefaults: prefixCacheProbeParamDefaults,
  buildCommand,
  parseProgress,
  parseFinalReport,
  getMaxDurationSeconds,
};

export type {
  PrefixCacheProbeParams,
  PrefixCacheProbeReport,
} from "./schema.js";
```

- [ ] **Step 8.2: Update root index.ts**

In `packages/tool-adapters/src/index.ts`, add a re-export:

```ts
export { prefixCacheProbeAdapter } from "./prefix-cache-probe/index.js";
```

- [ ] **Step 8.3: Update registry**

In `packages/tool-adapters/src/core/registry.ts`, add the import + map entry:

```ts
import { prefixCacheProbeAdapter } from "../prefix-cache-probe/index.js";
// ...
const ADAPTERS: Readonly<Record<ToolName, ToolAdapter>> = {
  guidellm: guidellmAdapter,
  "genai-perf": genaiPerfAdapter,
  vegeta: vegetaAdapter,
  "prefix-cache-probe": prefixCacheProbeAdapter,
};
```

- [ ] **Step 8.4: Run scenarios invariant test**

```bash
pnpm -F @modeldoctor/tool-adapters test -- scenarios
```

Expected: `assertScenariosInvariant()` and the two-way invariant tests pass — both `prefix-cache-validation` scenario and `prefix-cache-probe` adapter list each other.

- [ ] **Step 8.5: Build the workspace**

```bash
pnpm -r build
```

Expected: all packages build green; in particular `@modeldoctor/tool-adapters/dist/` now exports `prefixCacheProbeAdapter`.

- [ ] **Step 8.6: Run all tests one more time**

```bash
pnpm -F @modeldoctor/contracts test
pnpm -F @modeldoctor/tool-adapters test
```

Expected: all green.

- [ ] **Step 8.7: Commit (consolidates Tasks 5, 6, 7, 8)**

```bash
git add packages/tool-adapters/src/prefix-cache-probe/index.ts \
        packages/tool-adapters/src/index.ts \
        packages/tool-adapters/src/core/registry.ts
# Tasks 5/6/7 already staged
git commit -m "$(cat <<'EOF'
feat(tool-adapters): add prefix-cache-probe adapter + scenario

Brand new tool that validates Higress ai-load-balancer prefix-cache
stickiness by sending fixed-prefix prompts to vLLM and reading per-pod
delta from Prometheus. Adapter follows the standard contract (schema +
runtime + index) and registers itself under the new
"prefix-cache-validation" scenario.

Type unions extended in lockstep across packages/contracts and
packages/tool-adapters (ToolName, ScenarioId, BenchmarkTool,
ToolReport). BuildCommandPlan.connection gains prometheusUrl which the
api benchmark.service threads through; other adapters ignore it.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: prefix-cache-probe Python script

**Files:**
- Create: `apps/benchmark-runner/scripts/prefix_cache_probe.py`
- Create: `apps/benchmark-runner/tests/test_prefix_cache_probe.py` (light smoke; no live HTTP)

The script implements the verified algorithm from handoff §4.2 C: 5 long-prefix prompts, batched per round, Prometheus snapshot delta to compute per-pod stickiness. Each request uses its own httpx client with `Connection: close` to avoid the connection-pool reuse pitfall (handoff §5).

- [ ] **Step 9.1: Create the script**

`apps/benchmark-runner/scripts/prefix_cache_probe.py`:

```python
"""Prefix-cache stickiness probe.

Sends N rounds of M same-prefix requests to a chat-completion endpoint
and reads vLLM gpu_prefix_cache_queries_total deltas from Prometheus to
determine which pod served each round. Outputs a per-round summary plus
aggregate stickinessPct.

Critical methodology (see docs/superpowers/specs/...handoff §5):
- Each HTTP request uses its OWN httpx.AsyncClient + Connection: close.
  Reusing a single client pins the kernel TCP socket → Envoy LB sees one
  upstream regardless of plugin behavior. Independent clients let
  ai-load-balancer make a per-request decision.
- After each round, sleep promBackoffSec (>= 15s = Prom default scrape
  interval) before the second snapshot, otherwise delta is zero.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from typing import Any

import httpx

# Five fixed long prompts. Each is ~500 tokens so vLLM's prefix-cache block
# slicing kicks in. Indexed by --rounds [0..N-1]; --rounds capped at 5 by
# packages/tool-adapters/src/prefix-cache-probe/schema.ts.
PROMPTS: list[str] = [
    "I am building a distributed key-value store using Raft consensus. " * 30,
    "Our team is migrating a monolithic Java application to microservices. " * 30,
    "Distributed Postgres replication with logical decoding for cross-region. " * 30,
    "Modern frontend React server components and streaming SSR architectures. " * 30,
    "Kubernetes operator pattern for stateful workloads with custom CRDs. " * 30,
]


async def send_one(
    url: str,
    api_key: str,
    model: str,
    prompt: str,
    discriminator: str,
    max_tokens: int,
) -> bool:
    """One request with its own httpx client (forces TCP reconnect)."""
    body = {
        "model": model,
        "messages": [
            {"role": "user", "content": prompt},
            {"role": "user", "content": discriminator},
        ],
        "max_tokens": max_tokens,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Connection": "close",
    }
    try:
        async with httpx.AsyncClient(http2=False, timeout=120) as client:
            r = await client.post(url, json=body, headers=headers)
            return r.status_code == 200
    except Exception as e:
        print(f"[probe] request failed: {e}", file=sys.stderr)
        return False


async def snapshot_prom(prom: str, metric: str) -> dict[str, int]:
    """Returns {pod -> int(value)}. 'pod' label comes from kube-state-metrics
    relabel; if absent we fall back to 'instance'."""
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(f"{prom}/api/v1/query", params={"query": metric})
        r.raise_for_status()
        result = r.json()["data"]["result"]
    out: dict[str, int] = {}
    for item in result:
        m = item["metric"]
        key = m.get("pod") or m.get("instance") or "?"
        out[key] = int(float(item["value"][1]))
    return out


def diff_snapshots(before: dict[str, int], after: dict[str, int]) -> dict[str, int]:
    pods = set(before) | set(after)
    return {p: after.get(p, 0) - before.get(p, 0) for p in pods}


async def run_round(
    label: str,
    url: str,
    api_key: str,
    model: str,
    prompt: str,
    requests: int,
    max_tokens: int,
    prom: str,
    backoff: int,
) -> dict[str, Any]:
    """Sends `requests` same-prefix requests, returns per-pod delta."""
    queries_metric = "vllm:gpu_prefix_cache_queries_total"
    hits_metric = "vllm:gpu_prefix_cache_hits_total"

    before_q = await snapshot_prom(prom, queries_metric)
    before_h = await snapshot_prom(prom, hits_metric)

    tasks = [
        send_one(url, api_key, model, prompt, f"{label}-q{i}", max_tokens)
        for i in range(requests)
    ]
    results = await asyncio.gather(*tasks)
    succeeded = sum(1 for ok in results if ok)

    print(f"[probe] {label}: {succeeded}/{requests} succeeded; sleeping {backoff}s for Prom scrape")
    await asyncio.sleep(backoff)

    after_q = await snapshot_prom(prom, queries_metric)
    after_h = await snapshot_prom(prom, hits_metric)

    delta_q = diff_snapshots(before_q, after_q)
    delta_h = diff_snapshots(before_h, after_h)

    total = sum(delta_q.values())
    if total == 0:
        # No delta visible — Prom scrape hasn't caught up, or vLLM doesn't
        # expose this metric (prefix caching disabled?). Mark dominantPct=0
        # so the front-end can flag it.
        dominant_pod = "unknown"
        dominant_pct = 0.0
    else:
        dominant_pod = max(delta_q, key=delta_q.get)  # type: ignore[arg-type]
        dominant_pct = 100.0 * delta_q[dominant_pod] / total

    return {
        "label": label,
        "dominantPod": dominant_pod,
        "dominantPct": round(dominant_pct, 2),
        "totalRequests": total,
        "deltaQueries": delta_q,
        "deltaHits": delta_h,
    }


async def main_async(args: argparse.Namespace) -> int:
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        print("[probe] OPENAI_API_KEY not set in env", file=sys.stderr)
        return 2

    chat_url = args.url.rstrip("/") + "/v1/chat/completions"

    if args.rounds > len(PROMPTS):
        print(f"[probe] --rounds {args.rounds} exceeds bundled prompt count {len(PROMPTS)}", file=sys.stderr)
        return 2

    rounds: list[dict[str, Any]] = []
    for i in range(args.rounds):
        rounds.append(
            await run_round(
                label=f"set-{i}",
                url=chat_url,
                api_key=api_key,
                model=args.model,
                prompt=PROMPTS[i],
                requests=args.requests,
                max_tokens=args.max_tokens,
                prom=args.prom.rstrip("/"),
                backoff=args.backoff,
            )
        )

    # Aggregate per-pod across all rounds
    per_pod: dict[str, dict[str, int]] = {}
    for r in rounds:
        for pod, dq in r["deltaQueries"].items():
            per_pod.setdefault(pod, {"queries": 0, "hits": 0})
            per_pod[pod]["queries"] += dq
        for pod, dh in r["deltaHits"].items():
            per_pod.setdefault(pod, {"queries": 0, "hits": 0})
            per_pod[pod]["hits"] += dh

    # stickinessPct = unweighted mean of dominantPct across rounds
    if rounds:
        stickiness = sum(r["dominantPct"] for r in rounds) / len(rounds)
    else:
        stickiness = 0.0

    # deterministic = each round had >= 90% on a single pod
    deterministic = all(r["dominantPct"] >= 90.0 for r in rounds)

    out = {
        "stickinessPct": round(stickiness, 2),
        "deterministic": deterministic,
        "perPod": [
            {"pod": p, "queries": v["queries"], "hits": v["hits"]}
            for p, v in sorted(per_pod.items())
        ],
        "promptSets": [
            {
                "label": r["label"],
                "dominantPod": r["dominantPod"],
                "dominantPct": r["dominantPct"],
                "totalRequests": r["totalRequests"],
            }
            for r in rounds
        ],
    }

    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=2)
    print(f"[probe] wrote {args.out}: stickinessPct={out['stickinessPct']}%")
    return 0


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--url", required=True, help="OpenAI-compatible base URL (no /v1/...)")
    p.add_argument("--prom", required=True, help="Prometheus base URL")
    p.add_argument("--model", required=True)
    p.add_argument("--rounds", type=int, required=True)
    p.add_argument("--requests", type=int, required=True)
    p.add_argument("--max-tokens", type=int, required=True)
    p.add_argument("--backoff", type=int, required=True)
    p.add_argument("--out", default="result.json")
    args = p.parse_args()
    return asyncio.run(main_async(args))


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 9.2: Light smoke test**

```bash
cd apps/benchmark-runner
python scripts/prefix_cache_probe.py --help
```

Expected: argparse prints help; no syntax errors.

- [ ] **Step 9.3: Stage**

```bash
git add apps/benchmark-runner/scripts/prefix_cache_probe.py
```

(The Python file isn't covered by Vitest; the network behavior gets verified by manual k3d run in Task 14.)

---

## Task 10: prefix-cache-probe Dockerfile + build wiring + env

**Files:**
- Create: `apps/benchmark-runner/images/prefix-cache-probe.Dockerfile`
- Modify: `tools/build-runner-images.sh`
- Modify: `apps/api/src/config/env.schema.ts:64-66, 124-138`
- Modify: `apps/api/src/modules/benchmark/k8s/runner-images.ts:5-9`

- [ ] **Step 10.1: Write Dockerfile**

`apps/benchmark-runner/images/prefix-cache-probe.Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1.6

# prefix-cache-probe runner image. Validates Higress ai-load-balancer
# stickiness via Prometheus deltas; see
# packages/tool-adapters/src/prefix-cache-probe/runtime.ts and
# apps/benchmark-runner/scripts/prefix_cache_probe.py.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# httpx for the probe; requests pinned to match runner wrapper's pyproject.
RUN pip install --no-cache-dir \
        'httpx>=0.27,<1' \
        'requests>=2.31,<3'

WORKDIR /app

COPY runner runner
COPY scripts/prefix_cache_probe.py /app/probe.py

# Non-root user (matches sibling Dockerfiles).
RUN useradd --create-home --shell /sbin/nologin runner \
    && chown -R runner:runner /app
USER runner

# Generic wrapper; argv produced by
# packages/tool-adapters/src/prefix-cache-probe/runtime.ts is
# python /app/probe.py ...
ENTRYPOINT ["python", "-m", "runner"]
```

- [ ] **Step 10.2: Update build script**

In `tools/build-runner-images.sh`, edit the `for tool in ...` loop (line 43) and the import + echo blocks:

```bash
for tool in guidellm vegeta genai-perf prefix-cache-probe; do
  ...
done

# k3d image import block (lines 53-58):
if [[ "$IMPORT" == "true" ]]; then
  echo "==> k3d image import (cluster: $K3D_CLUSTER)"
  k3d image import \
    "md-runner-guidellm:${TAG}" \
    "md-runner-vegeta:${TAG}" \
    "md-runner-genai-perf:${TAG}" \
    "md-runner-prefix-cache-probe:${TAG}" \
    -c "$K3D_CLUSTER"
fi

# Echo block (lines 62-65):
echo "RUNNER_IMAGE_GUIDELLM=md-runner-guidellm:${TAG}"
echo "RUNNER_IMAGE_VEGETA=md-runner-vegeta:${TAG}"
echo "RUNNER_IMAGE_GENAI_PERF=md-runner-genai-perf:${TAG}"
echo "RUNNER_IMAGE_PREFIX_CACHE_PROBE=md-runner-prefix-cache-probe:${TAG}"
```

- [ ] **Step 10.3: Update env.schema.ts**

In `apps/api/src/config/env.schema.ts:64-66`, add:

```ts
RUNNER_IMAGE_GUIDELLM: z.string().min(1).optional(),
RUNNER_IMAGE_GENAI_PERF: z.string().min(1).optional(),
RUNNER_IMAGE_VEGETA: z.string().min(1).optional(),
RUNNER_IMAGE_PREFIX_CACHE_PROBE: z.string().min(1).optional(),
```

In the `superRefine` block (lines 124-138), extend the `perToolImages` array:

```ts
const perToolImages = [
  "RUNNER_IMAGE_GUIDELLM",
  "RUNNER_IMAGE_VEGETA",
  "RUNNER_IMAGE_GENAI_PERF",
  "RUNNER_IMAGE_PREFIX_CACHE_PROBE",
] as const;
```

- [ ] **Step 10.4: Update runner-images.ts**

In `apps/api/src/modules/benchmark/k8s/runner-images.ts:5-9`:

```ts
const TOOL_TO_IMAGE_ENV: Record<ToolName, keyof Env> = {
  guidellm: "RUNNER_IMAGE_GUIDELLM",
  "genai-perf": "RUNNER_IMAGE_GENAI_PERF",
  vegeta: "RUNNER_IMAGE_VEGETA",
  "prefix-cache-probe": "RUNNER_IMAGE_PREFIX_CACHE_PROBE",
};
```

- [ ] **Step 10.5: Verify api typecheck + tests**

```bash
pnpm -F api typecheck
pnpm -F api test
```

Expected: green. The `Record<ToolName, keyof Env>` type now demands all four keys; the env.schema.ts addition satisfies it.

- [ ] **Step 10.6: Commit**

```bash
git add apps/benchmark-runner/images/prefix-cache-probe.Dockerfile \
        tools/build-runner-images.sh \
        apps/api/src/config/env.schema.ts \
        apps/api/src/modules/benchmark/k8s/runner-images.ts
git commit -m "$(cat <<'EOF'
feat(benchmark-runner): prefix-cache-probe image + build/env/runner-images wiring

Adds the fourth runner image alongside guidellm/vegeta/genai-perf:
- Dockerfile: python:3.11-slim + httpx + the probe script
- build-runner-images.sh: extend the tools loop, k3d import list, and
  the trailing RUNNER_IMAGE_* echo block
- env.schema.ts: add RUNNER_IMAGE_PREFIX_CACHE_PROBE (required outside
  NODE_ENV=test)
- runner-images.ts: register prefix-cache-probe in the TOOL_TO_IMAGE_ENV
  map so K8sBenchmarkRunner can resolve its image.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Web — ConnectionDialog prometheusUrl input

**Why:** Schema/service/DB already accept `prometheusUrl`; only the dialog form lacked an input. Without a way to set it, `prefix-cache-probe` can't run.

**Files:**
- Modify: `apps/web/src/features/connections/ConnectionDialog.tsx`
- Modify: `apps/web/src/features/connections/ConnectionDialog.test.tsx`
- Modify: `apps/web/src/locales/{zh-CN,en-US}/connections.json`

- [ ] **Step 11.1: Add i18n keys**

`zh-CN/connections.json` (under existing `dialog` key):

```json
"prometheusUrl": "Prometheus 地址",
"prometheusUrlHelp": "可选；prefix-cache-probe 会从这里读取 vLLM Pod 命中率"
```

`en-US/connections.json`:

```json
"prometheusUrl": "Prometheus URL",
"prometheusUrlHelp": "Optional; prefix-cache-probe reads vLLM pod hit rates from here"
```

- [ ] **Step 11.2: Write the failing test**

In `ConnectionDialog.test.tsx`, add:

```tsx
it("submits prometheusUrl when entered", async () => {
  const onSubmit = vi.fn();
  renderDialog({ onSubmit });
  await user.type(screen.getByLabelText(/Prometheus|prometheus/i), "http://prom:9090");
  // ... fill required fields
  await user.click(screen.getByRole("button", { name: /Save|保存/i }));
  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({ prometheusUrl: "http://prom:9090" }),
  );
});
```

(Adapt to the existing test harness — the file already mocks the queries and submit handler.)

- [ ] **Step 11.3: Confirm fail**

```bash
pnpm -F web test -- ConnectionDialog
```

Expected: label not found.

- [ ] **Step 11.4: Implement input**

In `apps/web/src/features/connections/ConnectionDialog.tsx`, find the existing `tokenizerHfId` field block (search for `tokenizerHfId`). Add a sibling `<FormField>` for `prometheusUrl`:

```tsx
<FormField
  control={form.control}
  name="prometheusUrl"
  render={({ field }) => (
    <FormItem>
      <FormLabel>{t("connections:dialog.prometheusUrl")}</FormLabel>
      <FormControl>
        <Input
          type="url"
          placeholder="http://10.100.121.67:30121"
          {...field}
          value={field.value ?? ""}
          onChange={(e) => field.onChange(e.target.value === "" ? null : e.target.value)}
        />
      </FormControl>
      <FormDescription>{t("connections:dialog.prometheusUrlHelp")}</FormDescription>
      <FormMessage />
    </FormItem>
  )}
/>
```

(Submit handling should already pass the field through — `createConnectionSchema` already has `prometheusUrl: z.string().url().nullable().optional()`.)

- [ ] **Step 11.5: Confirm pass + i18n parity**

```bash
pnpm -F web test -- ConnectionDialog
pnpm -F web check:i18n-parity
```

Expected: green.

- [ ] **Step 11.6: Commit**

```bash
git add apps/web/src/features/connections/ConnectionDialog.tsx \
        apps/web/src/features/connections/ConnectionDialog.test.tsx \
        apps/web/src/locales/zh-CN/connections.json \
        apps/web/src/locales/en-US/connections.json
git commit -m "$(cat <<'EOF'
feat(web/connections): expose prometheusUrl in ConnectionDialog

The contract / service / DB layers have always accepted prometheusUrl;
only the form was missing the input. Adds a labeled URL field next to
the tokenizerHfId, with help text explaining it's used by
prefix-cache-probe to read vLLM Pod hit rates.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Web — PrefixCacheProbeParamsForm

**Files:**
- Create: `apps/web/src/features/benchmarks/forms/PrefixCacheProbeParamsForm.tsx`
- Create: `apps/web/src/features/benchmarks/forms/__tests__/PrefixCacheProbeParamsForm.test.tsx`
- Modify: `apps/web/src/features/benchmarks/forms/ToolParamsEditor.tsx` (route prefix-cache-probe → new form)
- Modify: `apps/web/src/locales/{zh-CN,en-US}/benchmarks.json`

- [ ] **Step 12.1: Add i18n keys**

`zh-CN/benchmarks.json` add:

```json
"forms": {
  ...,
  "prefixCacheProbe": {
    "promptSets": "前缀组数",
    "promptSetsHelp": "用几个不同的长前缀（每个 ~500 token）做路由检测",
    "requestsPerSet": "每组请求数",
    "maxTokens": "每个请求最大输出 tokens",
    "promBackoffSec": "Prometheus 抓取等待秒数",
    "promBackoffSecHelp": "Prom 默认 15s 抓一次；最少留 18s 缓冲",
    "missingPromUrl": "该连接未配置 Prometheus URL，无法运行 prefix-cache 验证。请在连接编辑里补上。"
  }
}
```

Parallel for en-US:

```json
"prefixCacheProbe": {
  "promptSets": "Prompt sets",
  "promptSetsHelp": "How many distinct long prefixes (~500 tokens each) to probe routing with",
  "requestsPerSet": "Requests per set",
  "maxTokens": "Max output tokens per request",
  "promBackoffSec": "Prom scrape wait (s)",
  "promBackoffSecHelp": "Prometheus default scrape is 15s; keep at least 18s of buffer",
  "missingPromUrl": "This connection has no Prometheus URL — cannot run prefix-cache validation. Edit the connection to add one."
}
```

- [ ] **Step 12.2: Write the failing test**

`apps/web/src/features/benchmarks/forms/__tests__/PrefixCacheProbeParamsForm.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FormProvider, useForm } from "react-hook-form";
import { PrefixCacheProbeParamsForm } from "../PrefixCacheProbeParamsForm";

const mockUseConnections = vi.fn();
vi.mock("@/features/connections/queries", () => ({
  useConnections: () => mockUseConnections(),
}));

function Harness({ connectionId, prometheusUrl }: { connectionId: string; prometheusUrl: string | null }) {
  mockUseConnections.mockReturnValue({
    data: [{ id: connectionId, prometheusUrl }],
  });
  const form = useForm({ defaultValues: { connectionId, params: {} } });
  return (
    <FormProvider {...form}>
      <PrefixCacheProbeParamsForm />
    </FormProvider>
  );
}

describe("PrefixCacheProbeParamsForm", () => {
  it("renders four numeric fields when prometheusUrl is set", () => {
    render(<Harness connectionId="c1" prometheusUrl="http://prom:9090" />);
    expect(screen.getByText(/Prompt sets|前缀组数/)).toBeInTheDocument();
    expect(screen.getByText(/Requests per set|每组请求数/)).toBeInTheDocument();
    expect(screen.getByText(/Max output tokens|最大输出/)).toBeInTheDocument();
    expect(screen.getByText(/Prom scrape wait|抓取等待/)).toBeInTheDocument();
  });

  it("shows blocking alert when connection.prometheusUrl is null", () => {
    render(<Harness connectionId="c1" prometheusUrl={null} />);
    expect(screen.getByText(/cannot run prefix-cache validation|无法运行 prefix-cache/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 12.3: Confirm fail**

```bash
pnpm -F web test -- PrefixCacheProbeParamsForm
```

Expected: import fails (module missing).

- [ ] **Step 12.4: Implement form**

`apps/web/src/features/benchmarks/forms/PrefixCacheProbeParamsForm.tsx`:

```tsx
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useConnections } from "@/features/connections/queries";
import { AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useFormContext, useWatch } from "react-hook-form";

interface Props {
  fieldPrefix?: "params" | "config";
}

export function PrefixCacheProbeParamsForm({ fieldPrefix = "params" }: Props = {}) {
  const { control } = useFormContext();
  const { t } = useTranslation();
  const connectionId = useWatch({ control, name: "connectionId" }) as string | undefined;
  const connections = useConnections();
  const connection = connectionId ? connections.data?.find((c) => c.id === connectionId) : undefined;

  if (connection && !connection.prometheusUrl) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>{t("benchmarks:forms.prefixCacheProbe.missingPromUrl")}</AlertTitle>
      </Alert>
    );
  }

  const numberField = (name: string, labelKey: string, helpKey?: string) => (
    <FormField
      control={control}
      name={`${fieldPrefix}.${name}`}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{t(labelKey)}</FormLabel>
          <FormControl>
            <Input
              type="number"
              {...field}
              value={field.value ?? ""}
              onChange={(e) =>
                field.onChange(e.target.value === "" ? undefined : Number(e.target.value))
              }
            />
          </FormControl>
          {helpKey && <FormDescription>{t(helpKey)}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {numberField(
          "promptSets",
          "benchmarks:forms.prefixCacheProbe.promptSets",
          "benchmarks:forms.prefixCacheProbe.promptSetsHelp",
        )}
        {numberField("requestsPerSet", "benchmarks:forms.prefixCacheProbe.requestsPerSet")}
        {numberField("maxTokens", "benchmarks:forms.prefixCacheProbe.maxTokens")}
        {numberField(
          "promBackoffSec",
          "benchmarks:forms.prefixCacheProbe.promBackoffSec",
          "benchmarks:forms.prefixCacheProbe.promBackoffSecHelp",
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 12.5: Wire into ToolParamsEditor**

In `apps/web/src/features/benchmarks/forms/ToolParamsEditor.tsx`, find the switch/router on `tool` (it dispatches to GenaiPerfParamsForm / GuidellmParamsForm / VegetaParamsForm) and add a case for `prefix-cache-probe`:

```tsx
import { PrefixCacheProbeParamsForm } from "./PrefixCacheProbeParamsForm";

// in the switch:
case "prefix-cache-probe":
  return <PrefixCacheProbeParamsForm fieldPrefix={fieldPrefix} />;
```

- [ ] **Step 12.6: Confirm pass**

```bash
pnpm -F web test -- PrefixCacheProbeParamsForm
pnpm -F web check:i18n-parity
```

Expected: green.

- [ ] **Step 12.7: Commit**

```bash
git add apps/web/src/features/benchmarks/forms/PrefixCacheProbeParamsForm.tsx \
        apps/web/src/features/benchmarks/forms/__tests__/PrefixCacheProbeParamsForm.test.tsx \
        apps/web/src/features/benchmarks/forms/ToolParamsEditor.tsx \
        apps/web/src/locales/zh-CN/benchmarks.json \
        apps/web/src/locales/en-US/benchmarks.json
git commit -m "$(cat <<'EOF'
feat(web/benchmarks): PrefixCacheProbeParamsForm

Four numeric fields (promptSets, requestsPerSet, maxTokens,
promBackoffSec) plus a blocking alert when the selected connection has
no prometheusUrl. Routed via ToolParamsEditor when tool ===
"prefix-cache-probe".

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Web — PrefixCacheProbeReport + scenario routing

**Files:**
- Create: `apps/web/src/features/benchmarks/reports/PrefixCacheProbeReport.tsx`
- Create: `apps/web/src/features/benchmarks/reports/__tests__/PrefixCacheProbeReport.test.tsx`
- Modify: `apps/web/src/features/benchmarks/BenchmarkDetailPage.tsx` (route to report)
- Modify: `apps/web/src/locales/{zh-CN,en-US}/benchmarks.json`

- [ ] **Step 13.1: Add i18n keys**

zh-CN benchmarks.json:

```json
"reports": {
  ...,
  "prefixCacheProbe": {
    "stickiness": "粘附率",
    "deterministic": "确定性",
    "deterministicYes": "是",
    "deterministicNo": "否",
    "perPodTitle": "每副本计数",
    "perPodCols": { "pod": "Pod", "queries": "查询数", "hits": "命中数", "hitRate": "命中率" },
    "promptSetsTitle": "每组路由结果",
    "promptSetsCols": { "label": "组", "dominantPod": "主 Pod", "dominantPct": "主 Pod 占比", "totalRequests": "总请求数" },
    "noQueries": "未观察到 prefix cache 查询；vLLM 可能未开启 prefix caching"
  }
}
```

en-US parallel.

- [ ] **Step 13.2: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PrefixCacheProbeReport } from "../PrefixCacheProbeReport";

const sample = {
  stickinessPct: 95.0,
  deterministic: true,
  perPod: [
    { pod: "vllm-0", queries: 100, hits: 92 },
    { pod: "vllm-1", queries: 100, hits: 88 },
  ],
  promptSets: [
    { label: "set-0", dominantPod: "vllm-0", dominantPct: 100.0, totalRequests: 10 },
    { label: "set-1", dominantPod: "vllm-1", dominantPct: 90.0, totalRequests: 10 },
  ],
};

describe("PrefixCacheProbeReport", () => {
  it("renders stickinessPct and deterministic flag", () => {
    render(<PrefixCacheProbeReport data={sample} />);
    expect(screen.getByText(/95(\.0)?%/)).toBeInTheDocument();
  });

  it("lists per-pod queries and hits", () => {
    render(<PrefixCacheProbeReport data={sample} />);
    expect(screen.getByText("vllm-0")).toBeInTheDocument();
    expect(screen.getByText("vllm-1")).toBeInTheDocument();
  });

  it("renders empty-state copy when no queries observed", () => {
    const empty = { ...sample, stickinessPct: 0, perPod: [], promptSets: [{ ...sample.promptSets[0], totalRequests: 0, dominantPod: "unknown", dominantPct: 0 }] };
    render(<PrefixCacheProbeReport data={empty} />);
    expect(screen.getByText(/prefix caching|未观察到/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 13.3: Confirm fail**

```bash
pnpm -F web test -- PrefixCacheProbeReport
```

- [ ] **Step 13.4: Implement report**

`apps/web/src/features/benchmarks/reports/PrefixCacheProbeReport.tsx`:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PrefixCacheProbeReport as Data } from "@modeldoctor/tool-adapters/schemas";
import { useTranslation } from "react-i18next";

interface Props {
  data: Data;
}

export function PrefixCacheProbeReport({ data }: Props) {
  const { t } = useTranslation();
  const noQueries = data.perPod.every((p) => p.queries === 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("benchmarks:reports.prefixCacheProbe.stickiness")}</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">
            {data.stickinessPct.toFixed(1)}%
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("benchmarks:reports.prefixCacheProbe.deterministic")}</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">
            {data.deterministic
              ? t("benchmarks:reports.prefixCacheProbe.deterministicYes")
              : t("benchmarks:reports.prefixCacheProbe.deterministicNo")}
          </CardContent>
        </Card>
      </div>

      {noQueries && (
        <p className="rounded border border-yellow-700/40 bg-yellow-700/10 p-3 text-sm text-yellow-300">
          {t("benchmarks:reports.prefixCacheProbe.noQueries")}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("benchmarks:reports.prefixCacheProbe.promptSetsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("benchmarks:reports.prefixCacheProbe.promptSetsCols.label")}</TableHead>
                <TableHead>{t("benchmarks:reports.prefixCacheProbe.promptSetsCols.dominantPod")}</TableHead>
                <TableHead className="text-right">{t("benchmarks:reports.prefixCacheProbe.promptSetsCols.dominantPct")}</TableHead>
                <TableHead className="text-right">{t("benchmarks:reports.prefixCacheProbe.promptSetsCols.totalRequests")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.promptSets.map((s) => (
                <TableRow key={s.label}>
                  <TableCell>{s.label}</TableCell>
                  <TableCell className="font-mono text-sm">{s.dominantPod}</TableCell>
                  <TableCell className="text-right">{s.dominantPct.toFixed(1)}%</TableCell>
                  <TableCell className="text-right">{s.totalRequests}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("benchmarks:reports.prefixCacheProbe.perPodTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("benchmarks:reports.prefixCacheProbe.perPodCols.pod")}</TableHead>
                <TableHead className="text-right">{t("benchmarks:reports.prefixCacheProbe.perPodCols.queries")}</TableHead>
                <TableHead className="text-right">{t("benchmarks:reports.prefixCacheProbe.perPodCols.hits")}</TableHead>
                <TableHead className="text-right">{t("benchmarks:reports.prefixCacheProbe.perPodCols.hitRate")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.perPod.map((p) => (
                <TableRow key={p.pod}>
                  <TableCell className="font-mono text-sm">{p.pod}</TableCell>
                  <TableCell className="text-right">{p.queries}</TableCell>
                  <TableCell className="text-right">{p.hits}</TableCell>
                  <TableCell className="text-right">
                    {p.queries > 0 ? `${((100 * p.hits) / p.queries).toFixed(1)}%` : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 13.5: Route from BenchmarkDetailPage**

In `apps/web/src/features/benchmarks/BenchmarkDetailPage.tsx`, find the switch/dispatch on `scenario` or `reportComponent` (around the existing `<InferenceReport>` / `<CapacityReport>` / `<GatewayReport>` rendering). Add the case:

```tsx
import { PrefixCacheProbeReport } from "./reports/PrefixCacheProbeReport";

// in the conditional:
{benchmark.scenario === "prefix-cache-validation" && benchmark.summaryMetrics && (
  <PrefixCacheProbeReport
    data={(benchmark.summaryMetrics as { data: PrefixCacheProbeReport }).data ?? (benchmark.summaryMetrics as PrefixCacheProbeReport)}
  />
)}
```

(The `summaryMetrics` JSON from /finish includes both the wrapping `{ tool, data }` and just `data` depending on flow; cover both.)

- [ ] **Step 13.6: Confirm pass + parity**

```bash
pnpm -F web test -- PrefixCacheProbeReport
pnpm -F web test
pnpm -F web check:i18n-parity
```

- [ ] **Step 13.7: Commit**

```bash
git add apps/web/src/features/benchmarks/reports/PrefixCacheProbeReport.tsx \
        apps/web/src/features/benchmarks/reports/__tests__/PrefixCacheProbeReport.test.tsx \
        apps/web/src/features/benchmarks/BenchmarkDetailPage.tsx \
        apps/web/src/locales/zh-CN/benchmarks.json \
        apps/web/src/locales/en-US/benchmarks.json
git commit -m "$(cat <<'EOF'
feat(web/benchmarks): PrefixCacheProbeReport + DetailPage routing

Two summary cards (stickinessPct + deterministic), a per-prompt-set
routing table, and a per-pod queries/hits table. Empty-state callout
when no Prom queries were observed (likely means vLLM prefix-caching
disabled). Wired from BenchmarkDetailPage when scenario ===
"prefix-cache-validation".

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Playwright e2e — genai-perf benchmark create happy path

**Files:**
- Create: `e2e/genai-perf-create-flow.spec.ts`

- [ ] **Step 14.1: Verify e2e fixtures and conventions**

```bash
ls e2e/
cat e2e/playwright.config.ts | head -40
```

Look at the existing benchmark-related e2e (e.g. `benchmark-list.spec.ts` if present) to understand fixtures, login flow, and selectors.

- [ ] **Step 14.2: Write the spec**

`e2e/genai-perf-create-flow.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("create genai-perf benchmark — happy path", async ({ page, request }) => {
  // Use the existing seed user / login fixture if available; otherwise
  // call the same helper used by other e2e specs.
  await page.goto("/");
  // ... login if your harness needs explicit auth

  // Pre-seed a connection via the api so we don't depend on dialog flows.
  // Replace token + URL with your harness's helper.
  const seedConnection = await request.post("/api/connections", {
    data: {
      name: "e2e-genai-perf",
      baseUrl: "http://stub.invalid",
      apiKey: "sk-e2e",
      model: "Qwen/Qwen2.5-0.5B-Instruct",
      category: "text",
      tags: [],
    },
  });
  expect(seedConnection.ok()).toBeTruthy();

  await page.goto("/benchmarks/new");
  await page.getByLabel(/connection|连接/i).click();
  await page.getByText("e2e-genai-perf").click();

  await page.getByLabel(/scenario|场景/i).click();
  await page.getByText(/inference|推理性能/i).click();

  await page.getByLabel(/tool|工具/i).click();
  await page.getByText("genai-perf").click();

  await page.getByLabel(/num prompts|prompt 数/i).fill("10");
  await page.getByLabel(/concurrency|并发/i).fill("2");

  await page.getByRole("button", { name: /create|创建/i }).click();

  // Detail page reachable; status is one of valid lifecycle values
  await expect(page).toHaveURL(/\/benchmarks\/[a-z0-9-]+/);
  const statusText = await page.locator('[data-testid="benchmark-status"], :has-text("status")').first().textContent();
  expect(statusText).toMatch(/pending|submitted|running|completed|failed/i);
});
```

(Selectors are illustrative — adapt to whatever testid/aria conventions the existing e2e suite uses.)

- [ ] **Step 14.3: Run e2e (browser)**

```bash
pnpm -F web build  # required because playwright.config.ts uses prod web build
pnpm test:e2e:browser -- genai-perf-create-flow
```

Expected: pass. If selectors don't match, adapt to existing conventions; do NOT add `data-testid` attrs unless other e2e specs already use that pattern.

- [ ] **Step 14.4: Commit**

```bash
git add e2e/genai-perf-create-flow.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): genai-perf benchmark create happy path

Playwright spec that seeds a connection via the api, opens
/benchmarks/new, fills the form, submits, and asserts the detail page
loads with a valid lifecycle status. Doesn't require a live K8s cluster
— happy path is just the front-end submission flow.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Manual k3d end-to-end smoke (documented, not auto-test)

**This is a checklist, not a code change. Execute it AFTER all other commits are in place.** It verifies the end-to-end flow against the real 67 cluster endpoint and documents the result in the PR description with screenshots.

- [ ] **Step 15.1: Build images + import to k3d**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat-genai-perf-flow
./tools/build-runner-images.sh
```

Expected: 4 images built; output ends with the four `RUNNER_IMAGE_*` lines.

- [ ] **Step 15.2: Update local apps/api/.env**

Copy the four `RUNNER_IMAGE_*` lines from step 15.1 into `apps/api/.env` (replace existing values).

- [ ] **Step 15.3: Start dev**

```bash
pnpm dev
```

Watch for "Nest application successfully started" + Vite dev server URL. Wait for both.

- [ ] **Step 15.4: Create the test connection**

In the web UI, create a connection:

```
name:           e2e-67-vllm
baseUrl:        http://10.100.121.67:30888
apiKey:         <real token>
model:          gen-studio_Qwen2.5-0.5B-Instruct-hJfe
tokenizerHfId:  Qwen/Qwen2.5-0.5B-Instruct
prometheusUrl:  http://10.100.121.67:30121
category:       text
```

- [ ] **Step 15.5: Run inference / genai-perf benchmark**

Create benchmark:

```
scenario:    Inference
tool:        genai-perf
numPrompts:  20
concurrency: 4
streaming:   true
```

Submit. On detail page, expected:
- status flips through `pending` → `running` → `completed`
- summary shows the 7 inference metrics (TTFT, ITL, request latency, throughput, etc.)
- if it fails: BenchmarkDetailPage now shows the stderr tail (Task 4 payoff) — capture it as evidence

Take a screenshot.

- [ ] **Step 15.6: Run prefix-cache-validation / prefix-cache-probe**

Create benchmark:

```
scenario:        Prefix-cache 路由验证
tool:            prefix-cache-probe
promptSets:      2
requestsPerSet:  10
maxTokens:       5
promBackoffSec:  18
```

Expected (against the 67 cluster with plugin enabled):
- status → `completed`
- stickinessPct ≈ 95-100%
- deterministic = true
- per-pod table shows non-zero queries on both vLLM Pods, with one dominating per prompt set

Take a screenshot.

- [ ] **Step 15.7: Push branch + open PR**

```bash
git push -u origin feat/genai-perf-flow-completion
gh pr create --title "genai-perf flow completion + prefix-cache-probe" --body "$(cat <<'EOF'
## Summary

- fix(api): preserve real failure message in /finish callback (no longer clobbered by parser)
- fix(tool-adapters/genai-perf): emit --service-kind openai + tokenizer fallback to connection.model
- feat(web/benchmarks): GenaiPerfParamsForm tokenizer preview + BenchmarkDetailPage stderr tail
- feat(tool-adapters): add prefix-cache-probe adapter + prefix-cache-validation scenario
- feat(benchmark-runner): prefix-cache-probe image + Python probe script
- feat(web): PrefixCacheProbeParamsForm + PrefixCacheProbeReport + ConnectionDialog prometheusUrl input
- test(e2e): genai-perf benchmark create happy path

Spec: docs/superpowers/specs/2026-05-08-genai-perf-flow-completion-design.md

## Test plan

- [x] All vitest specs pass (api, tool-adapters, web)
- [x] pnpm -r build green
- [x] pnpm -F web check:i18n-parity green
- [x] Playwright happy-path e2e (genai-perf benchmark create)
- [x] Manual k3d → 67 cluster: genai-perf inference completed (screenshot below)
- [x] Manual k3d → 67 cluster: prefix-cache-probe completed with stickinessPct ≥ 95% (screenshot below)

<!-- attach screenshots from Step 15.5 + 15.6 -->

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

After `gh pr create`, follow the CLAUDE.md "PR follow-through" checklist:
- `gh pr view <N> --json comments,reviews,statusCheckRollup,mergeStateStatus`
- `gh pr checks <N>`

---

## Plan-level self-review notes

- **Spec coverage**: every section of the spec maps to a task
  - §4.1 callback fix → Task 1
  - §4.2 genai-perf adapter → Task 2
  - §4.3 GenaiPerfParamsForm → Task 3
  - §4.4 BenchmarkDetailPage stderr → Task 4
  - §4.5 prefix-cache-probe adapter (schema/runtime/scenarios) → Tasks 5-8
  - §4.6 image registration (env / runner-images / build script) → Task 10
  - §4.7 ConnectionDialog prometheusUrl → Task 11
  - §4.8 PrefixCacheProbeParamsForm + Report → Tasks 12, 13
  - §4.9 Playwright e2e → Task 14
  - §4.10 manual k3d e2e → Task 15
- **Type consistency**: `PrefixCacheProbeReport` is the schema type name throughout; `prefix-cache-probe` is the adapter `name` everywhere; `prefix-cache-validation` is the scenario id everywhere; the four env vars all use `RUNNER_IMAGE_PREFIX_CACHE_PROBE`.
- **Placeholder scan**: no TBDs; every "step" includes the exact code or command. The few "adapt to existing test harness" hints (Tasks 4, 11, 14) are unavoidable because they depend on patterns that already exist in the worktree and an executing agent will read those files before adapting.
