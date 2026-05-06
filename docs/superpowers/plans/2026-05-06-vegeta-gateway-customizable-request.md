# Vegeta gateway customizable request — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let vegeta gateway benchmarks customize request `path` and `body` per run (Advanced disclosure, defaults derived from `apiType` + `connection.model`), surface a "Request details" panel on the benchmark detail page (URL / headers / body / params / copy-cURL with plaintext Bearer), and unify connection.category → apiType defaulting across vegeta / guidellm / genai-perf forms so all three tools stop silently issuing chat requests against embedding endpoints.

**Architecture:** New per-tool category-default maps in `packages/tool-adapters/src/category-defaults.ts` provide a single source of truth for "given this connection.category, what apiType/endpointType does this tool want?". Vegeta's `vegetaParamsSchema` gains required `path` and `body` fields; the runtime uses them verbatim. A new `GET /api/connections/:id/reveal-key` endpoint exposes the plaintext apiKey to owners only, used by the new `RequestDetailsSection` on the detail page. Backwards compat for legacy benchmarks (no path/body in params) is provided by a `migrateVegetaParams` helper that fills defaults from apiType + connection model on rerun and detail-page render.

**Tech Stack:** TypeScript, Zod, NestJS, Prisma, React + react-hook-form, Vitest 2, Testing Library, Playwright. Spec: `docs/superpowers/specs/2026-05-06-vegeta-gateway-customizable-request-design.md`. Branch: `feat/vegeta-gateway-custom-request` (feature worktree at `/Users/fangyong/vllm/modeldoctor/feat-vegeta-gateway-custom/`). Tier 3 follow-up tracked as [#136](https://github.com/weetime/modeldoctor/issues/136).

---

## File Structure

**Tool adapters** (`packages/tool-adapters/src/`):
- **NEW** `category-defaults.ts` — three `Record<ModalityCategory, …>` maps (vegeta / genai-perf / guidellm)
- **NEW** `category-defaults.spec.ts`
- **MODIFY** `vegeta/schema.ts` — add `path` + `body` fields to `vegetaParamsSchema`
- **MODIFY** `vegeta/schema.spec.ts`
- **MODIFY** `vegeta/runtime.ts` — `buildCommand` uses `params.path` / `params.body`; export `API_TYPE_TO_PATH` / `API_TYPE_TO_BODY` for FE consumers
- **MODIFY** `vegeta/runtime.spec.ts`
- **NEW** `vegeta/migrate-params.ts` — `migrateVegetaParams(params, model)` fills missing path/body
- **NEW** `vegeta/migrate-params.spec.ts`
- **MODIFY** `schemas-entry.ts` — re-export new symbols for FE consumption
- **MODIFY** `index.ts` — re-export for API consumption

**Contracts** (`packages/contracts/src/`):
- **MODIFY** `connection.ts` — add `connectionRevealKeyResponseSchema` + type

**API** (`apps/api/src/modules/connection/`):
- **MODIFY** `connection.service.ts` — add `revealApiKey(userId, id)` method
- **MODIFY** `connection.controller.ts` — add `GET /:id/reveal-key`
- **MODIFY** `connection.controller.spec.ts` — owner / 403 / 404 cases

**Web** (`apps/web/src/`):
- **MODIFY** `features/connections/queries.ts` — `useRevealApiKey(id)` hook
- **MODIFY** `features/benchmarks/forms/VegetaParamsForm.tsx` — Advanced disclosure with path/body, watch connectionId + apiType
- **MODIFY** `features/benchmarks/__tests__/forms/VegetaParamsForm.test.tsx`
- **MODIFY** `features/benchmarks/forms/GuidellmParamsForm.tsx` — watch connectionId, set apiType, warn unsupported
- **NEW** `features/benchmarks/__tests__/forms/GuidellmParamsForm.test.tsx`
- **MODIFY** `features/benchmarks/forms/GenaiPerfParamsForm.tsx` — watch connectionId, set endpointType, warn unsupported
- **NEW** `features/benchmarks/__tests__/forms/GenaiPerfParamsForm.test.tsx`
- **NEW** `features/benchmarks/RequestDetailsSection.tsx`
- **NEW** `features/benchmarks/__tests__/RequestDetailsSection.test.tsx`
- **MODIFY** `features/benchmarks/BenchmarkDetailPage.tsx` — render `RequestDetailsSection`; rerun migrates params
- **MODIFY** `features/benchmarks/__tests__/BenchmarkDetailPage.test.tsx`
- **MODIFY** `locales/zh-CN/benchmarks.json` — new strings
- **MODIFY** `locales/en-US/benchmarks.json` — new strings

**E2E** (`e2e/`):
- **NEW** `vegeta-gateway-custom-request.spec.ts`

---

## Pre-flight

- [ ] **Step 0.1: Confirm worktree and branch**

The plan executes on the feature branch from a dedicated worktree.

Run: `git rev-parse --abbrev-ref HEAD && pwd`
Expected:
```
feat/vegeta-gateway-custom-request
/Users/fangyong/vllm/modeldoctor/feat-vegeta-gateway-custom
```

- [ ] **Step 0.2: Build all packages so workspace types are resolved**

Per project memory: a fresh worktree needs `pnpm -r build` once before `apps/api` typecheck succeeds.

Run: `pnpm install --frozen-lockfile && pnpm -r build`
Expected: all packages build clean.

---

## Phase A — Tool-adapters foundation

### Task 1: Category-defaults map

**Files:**
- Create: `packages/tool-adapters/src/category-defaults.ts`
- Create: `packages/tool-adapters/src/category-defaults.spec.ts`

- [ ] **Step 1.1: Write the failing spec**

Create `packages/tool-adapters/src/category-defaults.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  GENAI_PERF_CATEGORY_DEFAULTS,
  GUIDELLM_CATEGORY_DEFAULTS,
  VEGETA_CATEGORY_DEFAULTS,
} from "./category-defaults.js";

describe("VEGETA_CATEGORY_DEFAULTS", () => {
  it("maps every ModalityCategory to a supported apiType", () => {
    expect(VEGETA_CATEGORY_DEFAULTS.chat).toEqual({ apiType: "chat" });
    expect(VEGETA_CATEGORY_DEFAULTS.audio).toEqual({ apiType: "chat-audio" });
    expect(VEGETA_CATEGORY_DEFAULTS.embeddings).toEqual({ apiType: "embeddings" });
    expect(VEGETA_CATEGORY_DEFAULTS.rerank).toEqual({ apiType: "rerank" });
    expect(VEGETA_CATEGORY_DEFAULTS.image).toEqual({ apiType: "images" });
  });
});

describe("GENAI_PERF_CATEGORY_DEFAULTS", () => {
  it("maps chat / embeddings / rerank to endpointType, audio + image unsupported", () => {
    expect(GENAI_PERF_CATEGORY_DEFAULTS.chat).toEqual({ endpointType: "chat" });
    expect(GENAI_PERF_CATEGORY_DEFAULTS.embeddings).toEqual({ endpointType: "embeddings" });
    expect(GENAI_PERF_CATEGORY_DEFAULTS.rerank).toEqual({ endpointType: "rankings" });
    expect(GENAI_PERF_CATEGORY_DEFAULTS.audio).toEqual({ unsupported: true });
    expect(GENAI_PERF_CATEGORY_DEFAULTS.image).toEqual({ unsupported: true });
  });
});

describe("GUIDELLM_CATEGORY_DEFAULTS", () => {
  it("maps chat to apiType=chat, all other categories unsupported", () => {
    expect(GUIDELLM_CATEGORY_DEFAULTS.chat).toEqual({ apiType: "chat" });
    for (const c of ["audio", "embeddings", "rerank", "image"] as const) {
      expect(GUIDELLM_CATEGORY_DEFAULTS[c]).toEqual({ unsupported: true });
    }
  });
});
```

- [ ] **Step 1.2: Run spec to confirm it fails**

Run: `pnpm -F @modeldoctor/tool-adapters vitest run src/category-defaults.spec.ts`
Expected: FAIL — `Cannot find module './category-defaults.js'`.

- [ ] **Step 1.3: Implement `category-defaults.ts`**

Create `packages/tool-adapters/src/category-defaults.ts`:

```ts
import type { ModalityCategory } from "@modeldoctor/contracts";
import type { GenaiPerfParams } from "./genai-perf/schema.js";
import type { GuidellmParams } from "./guidellm/schema.js";
import type { VegetaParams } from "./vegeta/schema.js";

/**
 * Per-tool default for "given a connection of this ModalityCategory, what
 * apiType/endpointType is the closest match?". Forms `useWatch` the
 * connectionId and apply this mapping to keep the user out of the
 * "default chat against an embedding endpoint → 100% errors" trap.
 *
 * `{ unsupported: true }` is the explicit signal for "this tool does not
 * speak this modality" — the form renders an inline warning instead of
 * silently picking a wrong fallback.
 */
export const VEGETA_CATEGORY_DEFAULTS: Record<
  ModalityCategory,
  { apiType: VegetaParams["apiType"] }
> = {
  chat: { apiType: "chat" },
  audio: { apiType: "chat-audio" },
  embeddings: { apiType: "embeddings" },
  rerank: { apiType: "rerank" },
  image: { apiType: "images" },
};

export const GENAI_PERF_CATEGORY_DEFAULTS: Record<
  ModalityCategory,
  { endpointType: GenaiPerfParams["endpointType"] } | { unsupported: true }
> = {
  chat: { endpointType: "chat" },
  audio: { unsupported: true },
  embeddings: { endpointType: "embeddings" },
  rerank: { endpointType: "rankings" },
  image: { unsupported: true },
};

export const GUIDELLM_CATEGORY_DEFAULTS: Record<
  ModalityCategory,
  { apiType: GuidellmParams["apiType"] } | { unsupported: true }
> = {
  chat: { apiType: "chat" },
  audio: { unsupported: true },
  embeddings: { unsupported: true },
  rerank: { unsupported: true },
  image: { unsupported: true },
};
```

- [ ] **Step 1.4: Run spec to confirm it passes**

Run: `pnpm -F @modeldoctor/tool-adapters vitest run src/category-defaults.spec.ts`
Expected: PASS — 3 tests.

- [ ] **Step 1.5: Commit**

```bash
git add packages/tool-adapters/src/category-defaults.ts packages/tool-adapters/src/category-defaults.spec.ts
git commit -m "$(cat <<'EOF'
feat(tool-adapters): per-tool connection.category → apiType defaults map

Single source of truth for FE forms to derive apiType/endpointType from
the picked connection's category. Tools that do not speak a given
modality return { unsupported: true } so the UI can render an explicit
warning instead of silently picking a wrong fallback.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Vegeta schema — `path` and `body` fields

**Files:**
- Modify: `packages/tool-adapters/src/vegeta/schema.ts`
- Modify: `packages/tool-adapters/src/vegeta/schema.spec.ts`

- [ ] **Step 2.1: Add failing test cases for path + body**

Append to `packages/tool-adapters/src/vegeta/schema.spec.ts` (inside `describe("vegetaParamsSchema", …)`):

```ts
  it("requires path", () => {
    const r = vegetaParamsSchema.safeParse({
      apiType: "chat",
      rate: 10,
      duration: 30,
      body: '{"model":"m","messages":[]}',
    });
    expect(r.success).toBe(false);
  });

  it("rejects path without leading slash", () => {
    const r = vegetaParamsSchema.safeParse({
      apiType: "chat",
      rate: 10,
      duration: 30,
      path: "v1/chat/completions",
      body: '{"model":"m","messages":[]}',
    });
    expect(r.success).toBe(false);
  });

  it("accepts custom path", () => {
    const r = vegetaParamsSchema.safeParse({
      apiType: "chat",
      rate: 10,
      duration: 30,
      path: "/v2/foo",
      body: '{"model":"m","messages":[]}',
    });
    expect(r.success).toBe(true);
  });

  it("requires body", () => {
    const r = vegetaParamsSchema.safeParse({
      apiType: "chat",
      rate: 10,
      duration: 30,
      path: "/v1/chat/completions",
    });
    expect(r.success).toBe(false);
  });

  it("rejects invalid JSON body", () => {
    const r = vegetaParamsSchema.safeParse({
      apiType: "chat",
      rate: 10,
      duration: 30,
      path: "/v1/chat/completions",
      body: "{not json",
    });
    expect(r.success).toBe(false);
  });

  it("accepts valid JSON body", () => {
    const r = vegetaParamsSchema.safeParse({
      apiType: "chat",
      rate: 10,
      duration: 30,
      path: "/v1/chat/completions",
      body: '{"model":"m","messages":[{"role":"user","content":"hi"}]}',
    });
    expect(r.success).toBe(true);
  });
```

Also update the existing 3 tests at top to include `path: "/v1/chat/completions"` and `body: '{"model":"m","messages":[{"role":"user","content":"hi"}]}'` so they continue to pass — they currently parse without the new fields, and we want them to:

The existing tests are:
- "rejects rate=0" — must keep failing for rate, so add path + body to make it otherwise valid.
- "rejects duration > 3600" — same.
- "accepts a typical config" — same; this becomes the canary test for path/body presence.
- "paramDefaults parses cleanly" — `vegetaParamDefaults` is `Partial<VegetaParams>`; still fine.

Update like:

```ts
  it("rejects rate=0", () => {
    const r = vegetaParamsSchema.safeParse({
      apiType: "chat",
      rate: 0,
      duration: 30,
      path: "/v1/chat/completions",
      body: '{"model":"m","messages":[]}',
    });
    expect(r.success).toBe(false);
  });

  it("rejects duration > 3600", () => {
    const r = vegetaParamsSchema.safeParse({
      apiType: "chat",
      rate: 10,
      duration: 3601,
      path: "/v1/chat/completions",
      body: '{"model":"m","messages":[]}',
    });
    expect(r.success).toBe(false);
  });

  it("accepts a typical config", () => {
    const r = vegetaParamsSchema.safeParse({
      apiType: "chat",
      rate: 10,
      duration: 60,
      path: "/v1/chat/completions",
      body: '{"model":"m","messages":[]}',
    });
    expect(r.success).toBe(true);
  });
```

The `paramDefaults` test stays unchanged — `vegetaParamDefaults` remains `Partial<VegetaParams>` (FE fills in path + body from connection model).

- [ ] **Step 2.2: Run spec to confirm failures**

Run: `pnpm -F @modeldoctor/tool-adapters vitest run src/vegeta/schema.spec.ts`
Expected: FAIL — the new path/body cases fail because schema does not have those fields.

- [ ] **Step 2.3: Extend `vegetaParamsSchema`**

Edit `packages/tool-adapters/src/vegeta/schema.ts`:

```ts
import { z } from "zod";

export const vegetaParamsSchema = z.object({
  apiType: z.enum(["chat", "embeddings", "rerank", "images", "chat-vision", "chat-audio"]),
  rate: z.number().int().min(1).max(10_000),
  duration: z.number().int().min(1).max(3_600),
  path: z
    .string()
    .min(1)
    .regex(/^\//, "must start with /"),
  body: z
    .string()
    .min(1)
    .refine((s) => {
      try {
        JSON.parse(s);
        return true;
      } catch {
        return false;
      }
    }, "must be valid JSON"),
});
export type VegetaParams = z.infer<typeof vegetaParamsSchema>;
```

(Lines 10-42 below `vegetaReportSchema` are unchanged.)

The `vegetaParamDefaults` block stays as-is — `path` and `body` cannot be statically defaulted (depend on `connection.model`), so the form will populate them from `API_TYPE_TO_PATH` / `API_TYPE_TO_BODY` when the connection is picked.

- [ ] **Step 2.4: Run spec to confirm it passes**

Run: `pnpm -F @modeldoctor/tool-adapters vitest run src/vegeta/schema.spec.ts`
Expected: PASS — all original + new cases.

- [ ] **Step 2.5: Commit**

```bash
git add packages/tool-adapters/src/vegeta/schema.ts packages/tool-adapters/src/vegeta/schema.spec.ts
git commit -m "$(cat <<'EOF'
feat(tool-adapters): add required path + body to vegetaParamsSchema

vegeta gateway runs need path / body customization to:
- target gateways that expose /embeddings instead of /v1/embeddings
- exercise non-default request shapes per scenario

path validates `/^\\//`; body validates as parseable JSON. FE form
populates both from connection-derived defaults at picker time.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Vegeta runtime — use `params.path` / `params.body`

**Files:**
- Modify: `packages/tool-adapters/src/vegeta/runtime.ts`
- Modify: `packages/tool-adapters/src/vegeta/runtime.spec.ts`

- [ ] **Step 3.1: Update existing runtime spec inputs to include path + body**

The current spec passes `params: { apiType: "chat", rate: 10, duration: 30 }` to `buildCommand`. Since these calls now need to satisfy the extended schema (the adapter's `paramsSchema` is checked downstream, not in `buildCommand` directly, but consistency matters), update each call site by globally replacing the params object literal with one that includes `path` and `body`.

Run: `grep -n 'params: { apiType:' packages/tool-adapters/src/vegeta/runtime.spec.ts`
Note all the line numbers — there are several, search-and-replace each. The replacement form:

```ts
params: {
  apiType: "chat",
  rate: 10,
  duration: 30,
  path: "/v1/chat/completions",
  body: '{"model":"qwen","messages":[{"role":"user","content":"hello"}]}',
},
```

Adjust per-test for non-chat cases (an existing test using "embeddings" should use `path: "/v1/embeddings"` and `body: '{"model":"…","input":"hello"}'`).

- [ ] **Step 3.2: Add new runtime spec cases for params.path / params.body authority**

Append to `describe("vegeta.buildCommand", …)` in `runtime.spec.ts`:

```ts
  it("uses params.path verbatim (overrides apiType-derived default)", () => {
    const r = buildCommand({
      runId: "r1",
      params: {
        apiType: "embeddings",
        rate: 10,
        duration: 30,
        path: "/embeddings",
        body: '{"model":"bge-m3","input":"hi"}',
      },
      connection: baseConn,
      callback: { url: "http://api/", token: "tk" },
    });
    expect(r.inputFiles?.["targets.txt"]).toContain("POST http://localhost:8000/embeddings");
    expect(r.inputFiles?.["targets.txt"]).not.toContain("/v1/embeddings");
  });

  it("uses params.body verbatim (no model substitution from connection)", () => {
    const r = buildCommand({
      runId: "r1",
      params: {
        apiType: "embeddings",
        rate: 10,
        duration: 30,
        path: "/v1/embeddings",
        body: '{"model":"OVERRIDE","input":"custom"}',
      },
      connection: baseConn,
      callback: { url: "http://api/", token: "tk" },
    });
    expect(r.inputFiles?.["request.json"]).toBe('{"model":"OVERRIDE","input":"custom"}');
    // connection.model "Qwen2.5-0.5B-Instruct" should NOT have been re-injected.
    expect(r.inputFiles?.["request.json"]).not.toContain("Qwen2.5");
  });
```

- [ ] **Step 3.3: Run spec to confirm new cases fail**

Run: `pnpm -F @modeldoctor/tool-adapters vitest run src/vegeta/runtime.spec.ts`
Expected: FAIL — `buildCommand` still computes path from `API_TYPE_TO_PATH` and body from `API_TYPE_TO_BODY[apiType](connection.model)`; the override tests assert on `params.path` / `params.body` which the runtime does not yet honor.

- [ ] **Step 3.4: Update `buildCommand` to use params**

Edit `packages/tool-adapters/src/vegeta/runtime.ts`. Replace lines 28-32:

```ts
export function buildCommand(plan: BuildCommandPlan<VegetaParams>): BuildCommandResult {
  const { params, connection } = plan;
  const path = API_TYPE_TO_PATH[params.apiType];
  let url = connection.baseUrl + path;
```

with:

```ts
export function buildCommand(plan: BuildCommandPlan<VegetaParams>): BuildCommandResult {
  const { params, connection } = plan;
  let url = connection.baseUrl + params.path;
```

And replace line 54:

```ts
  const body = API_TYPE_TO_BODY[params.apiType](connection.model);
```

with:

```ts
  const body = params.body;
```

Then **export** `API_TYPE_TO_PATH` and `API_TYPE_TO_BODY` so the FE form can compute defaults. Change lines 9 and 18 from `const` to `export const`:

```ts
export const API_TYPE_TO_PATH: Record<VegetaParams["apiType"], string> = { … };
export const API_TYPE_TO_BODY: Record<VegetaParams["apiType"], (model: string) => string> = { … };
```

- [ ] **Step 3.5: Run spec to confirm it passes**

Run: `pnpm -F @modeldoctor/tool-adapters vitest run src/vegeta/runtime.spec.ts`
Expected: PASS — all cases including the two new override tests.

- [ ] **Step 3.6: Commit**

```bash
git add packages/tool-adapters/src/vegeta/runtime.ts packages/tool-adapters/src/vegeta/runtime.spec.ts
git commit -m "$(cat <<'EOF'
feat(tool-adapters): vegeta runtime uses params.path / params.body verbatim

buildCommand no longer derives path/body from apiType — those are now
schema-required fields on VegetaParams. Removes the hardcoded mapping
from the runtime so users can target arbitrary gateway paths.

API_TYPE_TO_PATH / API_TYPE_TO_BODY are now exported so FE forms can
compute apiType-derived defaults at form-init time.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `migrateVegetaParams` helper

**Files:**
- Create: `packages/tool-adapters/src/vegeta/migrate-params.ts`
- Create: `packages/tool-adapters/src/vegeta/migrate-params.spec.ts`

- [ ] **Step 4.1: Write the failing spec**

Create `packages/tool-adapters/src/vegeta/migrate-params.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { migrateVegetaParams } from "./migrate-params.js";

describe("migrateVegetaParams", () => {
  it("fills missing path + body from apiType + model (legacy benchmark)", () => {
    const out = migrateVegetaParams(
      { apiType: "embeddings", rate: 10, duration: 30 },
      "bge-m3",
    );
    expect(out.apiType).toBe("embeddings");
    expect(out.path).toBe("/v1/embeddings");
    expect(JSON.parse(out.body)).toEqual({ model: "bge-m3", input: "hello" });
  });

  it("preserves path + body when already present", () => {
    const out = migrateVegetaParams(
      {
        apiType: "embeddings",
        rate: 10,
        duration: 30,
        path: "/embeddings",
        body: '{"model":"x","input":"y"}',
      },
      "bge-m3",
    );
    expect(out.path).toBe("/embeddings");
    expect(out.body).toBe('{"model":"x","input":"y"}');
  });

  it("uses '<unknown>' as model fallback when none supplied", () => {
    const out = migrateVegetaParams({ apiType: "chat", rate: 1, duration: 5 }, null);
    expect(JSON.parse(out.body).model).toBe("<unknown>");
  });
});
```

- [ ] **Step 4.2: Run spec to confirm failure**

Run: `pnpm -F @modeldoctor/tool-adapters vitest run src/vegeta/migrate-params.spec.ts`
Expected: FAIL — module missing.

- [ ] **Step 4.3: Implement `migrate-params.ts`**

Create `packages/tool-adapters/src/vegeta/migrate-params.ts`:

```ts
import { API_TYPE_TO_BODY, API_TYPE_TO_PATH } from "./runtime.js";
import type { VegetaParams } from "./schema.js";

type LegacyVegetaParams = Pick<VegetaParams, "apiType" | "rate" | "duration"> & {
  path?: string;
  body?: string;
};

/**
 * Backwards-compat helper for benchmarks created before vegetaParamsSchema
 * required `path` + `body`. Fills the two new fields from the apiType-keyed
 * defaults so legacy rows survive both the detail-page render and the
 * "rerun" mutation (whose POST goes through the now-stricter schema).
 */
export function migrateVegetaParams(
  params: LegacyVegetaParams,
  connectionModel: string | null | undefined,
): VegetaParams {
  const model = connectionModel ?? "<unknown>";
  return {
    apiType: params.apiType,
    rate: params.rate,
    duration: params.duration,
    path: params.path ?? API_TYPE_TO_PATH[params.apiType],
    body: params.body ?? API_TYPE_TO_BODY[params.apiType](model),
  };
}
```

- [ ] **Step 4.4: Run spec to confirm it passes**

Run: `pnpm -F @modeldoctor/tool-adapters vitest run src/vegeta/migrate-params.spec.ts`
Expected: PASS — 3 tests.

- [ ] **Step 4.5: Commit**

```bash
git add packages/tool-adapters/src/vegeta/migrate-params.ts packages/tool-adapters/src/vegeta/migrate-params.spec.ts
git commit -m "$(cat <<'EOF'
feat(tool-adapters): migrateVegetaParams helper for legacy benchmark rows

Fills missing path + body from apiType-derived defaults so benchmarks
created before the schema change survive detail-page render and rerun
without requiring a DB migration of every prior row's params blob.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Tool-adapters re-exports

**Files:**
- Modify: `packages/tool-adapters/src/schemas-entry.ts`
- Modify: `packages/tool-adapters/src/index.ts`

- [ ] **Step 5.1: Inspect current schemas-entry.ts**

Run: `cat packages/tool-adapters/src/schemas-entry.ts`

Expected to contain re-exports of each tool's params schema + types. Locate the vegeta block.

- [ ] **Step 5.2: Add new exports to `schemas-entry.ts`**

Append the following near the existing vegeta exports (mirroring the existing style):

```ts
export {
  API_TYPE_TO_BODY as VEGETA_API_TYPE_TO_BODY,
  API_TYPE_TO_PATH as VEGETA_API_TYPE_TO_PATH,
} from "./vegeta/runtime.js";
export { migrateVegetaParams } from "./vegeta/migrate-params.js";
export {
  GENAI_PERF_CATEGORY_DEFAULTS,
  GUIDELLM_CATEGORY_DEFAULTS,
  VEGETA_CATEGORY_DEFAULTS,
} from "./category-defaults.js";
```

(Renamed to `VEGETA_API_TYPE_TO_*` so the FE has a unambiguous name; tool-internal uses keep the short names.)

- [ ] **Step 5.3: Re-export from `index.ts`**

`packages/tool-adapters/src/index.ts` already re-exports `./schemas-entry.js` via `export * from "./schemas-entry.js"` — no change needed. Verify:

Run: `grep "schemas-entry" packages/tool-adapters/src/index.ts`
Expected: `export * from "./schemas-entry.js";`

- [ ] **Step 5.4: Build the package and run all specs**

Run: `pnpm -F @modeldoctor/tool-adapters build && pnpm -F @modeldoctor/tool-adapters vitest run`
Expected: build succeeds; **all** tool-adapters tests pass (no regression in genai-perf / guidellm).

- [ ] **Step 5.5: Commit**

```bash
git add packages/tool-adapters/src/schemas-entry.ts
git commit -m "$(cat <<'EOF'
chore(tool-adapters): re-export vegeta defaults + migrateVegetaParams + category-defaults

FE consumers (web forms + RequestDetailsSection) need these symbols via
the public schemas-entry surface; renamed to VEGETA_API_TYPE_TO_* on
export to avoid name collisions.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase B — Backend reveal-key endpoint

### Task 6: Contracts — `connectionRevealKeyResponseSchema`

**Files:**
- Modify: `packages/contracts/src/connection.ts`

- [ ] **Step 6.1: Add the schema**

Append to `packages/contracts/src/connection.ts` after `listConnectionsResponseSchema`:

```ts
/** Owner-only response from GET /api/connections/:id/reveal-key. */
export const connectionRevealKeyResponseSchema = z.object({
  apiKey: z.string().min(1),
});
export type ConnectionRevealKeyResponse = z.infer<typeof connectionRevealKeyResponseSchema>;
```

- [ ] **Step 6.2: Build contracts**

Run: `pnpm -F @modeldoctor/contracts build`
Expected: success.

- [ ] **Step 6.3: Commit**

```bash
git add packages/contracts/src/connection.ts
git commit -m "$(cat <<'EOF'
feat(contracts): connectionRevealKeyResponseSchema for owner-only apiKey reveal

Backs the new GET /api/connections/:id/reveal-key endpoint used by the
benchmark detail page's Request details panel to render the plaintext
Authorization Bearer header.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: API — reveal-key endpoint

**Files:**
- Modify: `apps/api/src/modules/connection/connection.service.ts`
- Modify: `apps/api/src/modules/connection/connection.controller.ts`
- Modify: `apps/api/src/modules/connection/connection.controller.spec.ts`

- [ ] **Step 7.1: Add controller spec cases (failing)**

Edit `apps/api/src/modules/connection/connection.controller.spec.ts`:
- Extend `makeMockService()` to include `revealApiKey: vi.fn()`.
- Add a new top-level `describe("ConnectionController.revealKey", …)` block:

```ts
describe("ConnectionController.revealKey", () => {
  let controller: ConnectionController;
  let svc: ReturnType<typeof makeMockService>;

  beforeEach(async () => {
    svc = makeMockService();
    const moduleRef = await Test.createTestingModule({
      controllers: [ConnectionController],
      providers: [{ provide: ConnectionService, useValue: svc }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(ConnectionController);
  });

  it("returns plaintext apiKey for the owner", async () => {
    svc.revealApiKey.mockResolvedValue({ apiKey: "sk-secret-12345" });
    await expect(controller.revealKey(USER, "c_1")).resolves.toEqual({
      apiKey: "sk-secret-12345",
    });
    expect(svc.revealApiKey).toHaveBeenCalledWith(USER.sub, "c_1");
  });

  it("propagates ForbiddenException for non-owners", async () => {
    svc.revealApiKey.mockRejectedValue(new ForbiddenException());
    await expect(controller.revealKey(USER, "c_other")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("propagates NotFoundException for unknown ids", async () => {
    svc.revealApiKey.mockRejectedValue(new NotFoundException());
    await expect(controller.revealKey(USER, "c_404")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
```

- [ ] **Step 7.2: Run spec to confirm failure**

Run: `pnpm -F @modeldoctor/api vitest run src/modules/connection/connection.controller.spec.ts`
Expected: FAIL — `controller.revealKey` is not defined; `svc.revealApiKey` not on the mock surface.

- [ ] **Step 7.3: Implement service method**

Edit `apps/api/src/modules/connection/connection.service.ts`. Add inside the `ConnectionService` class, near `getOwnedDecrypted`:

```ts
  /**
   * Owner-only — exposes the decrypted apiKey for UI affordances that need
   * the plaintext (currently: benchmark detail page Request details panel).
   * Throws Forbidden / NotFound through `findOwnedRow` for unauthorized or
   * missing ids.
   */
  async revealApiKey(userId: string, id: string): Promise<{ apiKey: string }> {
    const row = await this.findOwnedRow(userId, id);
    return { apiKey: decrypt(row.apiKeyCipher, this.key) };
  }
```

- [ ] **Step 7.4: Implement controller route**

Edit `apps/api/src/modules/connection/connection.controller.ts`. Add after the `detail` method:

```ts
  @Get(":id/reveal-key")
  revealKey(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
  ): Promise<ConnectionRevealKeyResponse> {
    return this.service.revealApiKey(user.sub, id);
  }
```

Also add `ConnectionRevealKeyResponse` to the existing `import type { … } from "@modeldoctor/contracts"` block.

- [ ] **Step 7.5: Run controller spec to confirm pass**

Run: `pnpm -F @modeldoctor/api vitest run src/modules/connection/connection.controller.spec.ts`
Expected: PASS — original + 3 new cases.

- [ ] **Step 7.6: Run all API specs to confirm no regression**

Run: `pnpm -F @modeldoctor/api vitest run`
Expected: all green.

- [ ] **Step 7.7: Commit**

```bash
git add apps/api/src/modules/connection/connection.service.ts apps/api/src/modules/connection/connection.controller.ts apps/api/src/modules/connection/connection.controller.spec.ts
git commit -m "$(cat <<'EOF'
feat(api): GET /api/connections/:id/reveal-key for owner-only apiKey reveal

Powers the benchmark detail page's Request details panel which renders
the plaintext Authorization Bearer header. Owner-checked via the same
findOwnedRow path as detail/update/delete; non-owners receive 403,
unknown ids return 404, unauthenticated requests are blocked by the
existing JwtAuthGuard.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase C — FE forms

### Task 8: `useRevealApiKey` query hook

**Files:**
- Modify: `apps/web/src/features/connections/queries.ts`

- [ ] **Step 8.1: Add the hook**

Append to `apps/web/src/features/connections/queries.ts`:

```ts
import type { ConnectionRevealKeyResponse } from "@modeldoctor/contracts";

export function useRevealApiKey(id: string | null | undefined) {
  return useQuery({
    queryKey: [...detailKey(id ?? ""), "reveal-key"] as const,
    enabled: !!id,
    queryFn: () =>
      api.get<ConnectionRevealKeyResponse>(`/api/connections/${id}/reveal-key`),
    // apiKey doesn't change unless the user rotates it — cache aggressively.
    staleTime: 5 * 60 * 1000,
  });
}
```

Add `ConnectionRevealKeyResponse` to the existing top-of-file `import type { … }` block.

- [ ] **Step 8.2: Type-check the workspace**

Run: `pnpm -F @modeldoctor/web typecheck`
Expected: success.

- [ ] **Step 8.3: Commit**

```bash
git add apps/web/src/features/connections/queries.ts
git commit -m "$(cat <<'EOF'
feat(web): useRevealApiKey hook against /api/connections/:id/reveal-key

Lazy fetch; cached 5 minutes since apiKey only changes on rotation.
Consumed by the upcoming RequestDetailsSection on the benchmark detail
page.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: VegetaParamsForm — Advanced disclosure + connection / apiType watching

**Files:**
- Modify: `apps/web/src/features/benchmarks/forms/VegetaParamsForm.tsx`
- Modify: `apps/web/src/features/benchmarks/__tests__/forms/VegetaParamsForm.test.tsx`

- [ ] **Step 9.1: Add failing test cases**

Replace the existing `apps/web/src/features/benchmarks/__tests__/forms/VegetaParamsForm.test.tsx` body with:

```tsx
import { zodResolver } from "@hookform/resolvers/zod";
import type { ConnectionPublic, ListConnectionsResponse } from "@modeldoctor/contracts";
import { vegetaParamsSchema } from "@modeldoctor/tool-adapters/schemas";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { VegetaParamsForm } from "../../forms/VegetaParamsForm";

vi.mock("@/lib/api-client", () => ({
  api: {
    get: vi.fn(),
  },
}));

import { api } from "@/lib/api-client";

const wrapperSchema = z.object({
  connectionId: z.string(),
  params: vegetaParamsSchema,
});

const baseConnection: ConnectionPublic = {
  id: "c_emb",
  userId: "u_1",
  name: "bge-by-mis-tei",
  baseUrl: "http://example/v1",
  apiKeyPreview: "sk-...bc8d",
  model: "bge-m3-uZbs",
  customHeaders: "",
  queryParams: "",
  category: "embeddings",
  tags: [],
  prometheusUrl: null,
  serverKind: null,
  tokenizerHfId: null,
  createdAt: "2026-05-06T00:00:00.000Z",
  updatedAt: "2026-05-06T00:00:00.000Z",
};

function makeWrapper(initialConnectionId = "") {
  // Fresh QueryClient per render so cache pollution doesn't leak across tests.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    const form = useForm({
      resolver: zodResolver(wrapperSchema),
      defaultValues: {
        connectionId: initialConnectionId,
        params: {
          apiType: "chat",
          rate: 10,
          duration: 30,
          path: "/v1/chat/completions",
          body: '{"model":"x","messages":[{"role":"user","content":"hello"}]}',
        },
      },
    });
    return (
      <QueryClientProvider client={qc}>
        <FormProvider {...form}>{children}</FormProvider>
      </QueryClientProvider>
    );
  };
}

describe("VegetaParamsForm", () => {
  it("renders apiType, rate, duration fields", () => {
    vi.mocked(api.get).mockResolvedValue({
      items: [baseConnection],
    } satisfies ListConnectionsResponse);
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <VegetaParamsForm />
      </Wrapper>,
    );
    expect(screen.getByLabelText(/api type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^rate/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/duration/i)).toBeInTheDocument();
  });

  it("hides path + body fields by default (Advanced collapsed)", () => {
    vi.mocked(api.get).mockResolvedValue({
      items: [baseConnection],
    } satisfies ListConnectionsResponse);
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <VegetaParamsForm />
      </Wrapper>,
    );
    // Native <details> is closed by default; the inputs exist in the DOM but
    // are not visible. We test by absence of an *open* details element.
    const advanced = screen.getByText(/advanced/i).closest("details");
    expect(advanced).not.toBeNull();
    expect((advanced as HTMLDetailsElement).open).toBe(false);
  });

  it("exposes path + body inputs once Advanced is opened", () => {
    vi.mocked(api.get).mockResolvedValue({
      items: [baseConnection],
    } satisfies ListConnectionsResponse);
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <VegetaParamsForm />
      </Wrapper>,
    );
    fireEvent.click(screen.getByText(/advanced/i));
    expect(screen.getByLabelText(/^path/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^body/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 9.2: Run test to confirm failure**

Run: `pnpm -F @modeldoctor/web vitest run src/features/benchmarks/__tests__/forms/VegetaParamsForm.test.tsx`
Expected: FAIL — `Advanced` text not found, path/body inputs not rendered.

- [ ] **Step 9.3: Implement Advanced disclosure + connection/apiType watching**

Replace `apps/web/src/features/benchmarks/forms/VegetaParamsForm.tsx` with:

```tsx
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
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
import {
  VEGETA_API_TYPE_TO_BODY,
  VEGETA_API_TYPE_TO_PATH,
  VEGETA_CATEGORY_DEFAULTS,
} from "@modeldoctor/tool-adapters/schemas";
import type { VegetaParams } from "@modeldoctor/tool-adapters/schemas";
import { useEffect, useRef } from "react";
import { useFormContext, useWatch } from "react-hook-form";

const API_TYPES: VegetaParams["apiType"][] = [
  "chat",
  "embeddings",
  "rerank",
  "images",
  "chat-vision",
  "chat-audio",
];

interface VegetaParamsFormProps {
  fieldPrefix?: "params" | "config";
}

export function VegetaParamsForm({ fieldPrefix = "params" }: VegetaParamsFormProps = {}) {
  const { control, setValue } = useFormContext();
  const connectionId = useWatch({ control, name: "connectionId" }) as string | undefined;
  const apiType = useWatch({ control, name: `${fieldPrefix}.apiType` }) as
    | VegetaParams["apiType"]
    | undefined;

  const connections = useConnections();
  const connection = connectionId
    ? connections.data?.find((c) => c.id === connectionId)
    : undefined;

  // Refs track the apiType last applied as a default so a *user-driven*
  // apiType change still resets path/body (rule: "apiType is the template").
  const lastConnectionId = useRef<string | undefined>(undefined);
  const lastApiType = useRef<VegetaParams["apiType"] | undefined>(undefined);

  // When the connection changes: derive apiType from category, then path +
  // body from the new apiType + connection.model.
  useEffect(() => {
    if (!connection) return;
    if (lastConnectionId.current === connection.id) return;
    lastConnectionId.current = connection.id;
    const def = VEGETA_CATEGORY_DEFAULTS[connection.category];
    const nextApiType = def.apiType;
    setValue(`${fieldPrefix}.apiType`, nextApiType, { shouldDirty: false });
    setValue(`${fieldPrefix}.path`, VEGETA_API_TYPE_TO_PATH[nextApiType], {
      shouldDirty: false,
    });
    setValue(`${fieldPrefix}.body`, VEGETA_API_TYPE_TO_BODY[nextApiType](connection.model), {
      shouldDirty: false,
    });
    lastApiType.current = nextApiType;
  }, [connection, fieldPrefix, setValue]);

  // When apiType changes via a user pick: reset path + body to the new
  // template against the current connection.model (or "<unknown>" fallback).
  useEffect(() => {
    if (!apiType) return;
    if (lastApiType.current === apiType) return;
    lastApiType.current = apiType;
    const model = connection?.model ?? "<unknown>";
    setValue(`${fieldPrefix}.path`, VEGETA_API_TYPE_TO_PATH[apiType], { shouldDirty: false });
    setValue(`${fieldPrefix}.body`, VEGETA_API_TYPE_TO_BODY[apiType](model), {
      shouldDirty: false,
    });
  }, [apiType, connection?.model, fieldPrefix, setValue]);

  return (
    <div className="space-y-4">
      <FormField
        control={control}
        name={`${fieldPrefix}.apiType`}
        render={({ field }) => (
          <FormItem>
            <FormLabel>API type</FormLabel>
            <Select onValueChange={field.onChange} value={field.value ?? ""}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Select API type" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {API_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FormField
          control={control}
          name={`${fieldPrefix}.rate`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Rate (req/s)</FormLabel>
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
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name={`${fieldPrefix}.duration`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Duration (s)</FormLabel>
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
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <details className="rounded-md border border-border bg-muted/20 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
          Advanced
        </summary>
        <div className="mt-3 space-y-4">
          <FormField
            control={control}
            name={`${fieldPrefix}.path`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Path</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="/v1/embeddings" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name={`${fieldPrefix}.body`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Body</FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    rows={6}
                    className="font-mono text-xs"
                    placeholder='{"model":"…","input":"hello"}'
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </details>
    </div>
  );
}
```

- [ ] **Step 9.4: Run the test to confirm pass**

Run: `pnpm -F @modeldoctor/web vitest run src/features/benchmarks/__tests__/forms/VegetaParamsForm.test.tsx`
Expected: PASS.

- [ ] **Step 9.5: Commit**

```bash
git add apps/web/src/features/benchmarks/forms/VegetaParamsForm.tsx apps/web/src/features/benchmarks/__tests__/forms/VegetaParamsForm.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): VegetaParamsForm Advanced disclosure (path + body) + auto-defaults

When the picked connection changes, derive apiType from its category and
recompute path + body from apiType template + connection.model. When the
user changes apiType manually, the same reset rule applies (apiType is
the template selector). Path + body live behind a native <details>
"Advanced" disclosure to keep the simple flow clean.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: GuidellmParamsForm — connection.category warning

**Files:**
- Modify: `apps/web/src/features/benchmarks/forms/GuidellmParamsForm.tsx`
- Create: `apps/web/src/features/benchmarks/__tests__/forms/GuidellmParamsForm.test.tsx`

- [ ] **Step 10.1: Read the existing form so the patch lands cleanly**

Run: `cat apps/web/src/features/benchmarks/forms/GuidellmParamsForm.tsx | head -40`

Note where its top-level `function GuidellmParamsForm` opens, where `useFormContext()` is called, and the existing import block.

- [ ] **Step 10.2: Write the failing test**

Create `apps/web/src/features/benchmarks/__tests__/forms/GuidellmParamsForm.test.tsx`:

```tsx
import { zodResolver } from "@hookform/resolvers/zod";
import type { ConnectionPublic, ListConnectionsResponse } from "@modeldoctor/contracts";
import { guidellmParamsSchema } from "@modeldoctor/tool-adapters/schemas";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { GuidellmParamsForm } from "../../forms/GuidellmParamsForm";

vi.mock("@/lib/api-client", () => ({
  api: { get: vi.fn() },
}));

import { api } from "@/lib/api-client";

const wrapperSchema = z.object({
  connectionId: z.string(),
  params: guidellmParamsSchema,
});

function fixture(category: ConnectionPublic["category"]): ConnectionPublic {
  return {
    id: `c_${category}`,
    userId: "u_1",
    name: `n-${category}`,
    baseUrl: "http://example/",
    apiKeyPreview: "sk-...x",
    model: "m",
    customHeaders: "",
    queryParams: "",
    category,
    tags: [],
    prometheusUrl: null,
    serverKind: null,
    tokenizerHfId: null,
    createdAt: "2026-05-06T00:00:00.000Z",
    updatedAt: "2026-05-06T00:00:00.000Z",
  };
}

function makeWrapper(connectionId: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    const form = useForm({
      resolver: zodResolver(wrapperSchema),
      defaultValues: {
        connectionId,
        params: {
          profile: "throughput",
          apiType: "chat",
          datasetName: "random",
          datasetInputTokens: 256,
          datasetOutputTokens: 128,
          rateType: "constant",
          requestRate: 0,
          totalRequests: 1000,
          maxDurationSeconds: 1800,
          maxConcurrency: 100,
          validateBackend: false,
        },
      },
    });
    return (
      <QueryClientProvider client={qc}>
        <FormProvider {...form}>{children}</FormProvider>
      </QueryClientProvider>
    );
  };
}

describe("GuidellmParamsForm category warning", () => {
  it("shows no warning when connection category is chat", async () => {
    vi.mocked(api.get).mockResolvedValue({
      items: [fixture("chat")],
    } satisfies ListConnectionsResponse);
    const Wrapper = makeWrapper("c_chat");
    render(
      <Wrapper>
        <GuidellmParamsForm />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.queryByText(/不支持/i)).not.toBeInTheDocument(),
    );
  });

  it("shows a warning when connection category is embeddings", async () => {
    vi.mocked(api.get).mockResolvedValue({
      items: [fixture("embeddings")],
    } satisfies ListConnectionsResponse);
    const Wrapper = makeWrapper("c_embeddings");
    render(
      <Wrapper>
        <GuidellmParamsForm />
      </Wrapper>,
    );
    await waitFor(() => expect(screen.getByText(/不支持/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 10.3: Run test to confirm failure**

Run: `pnpm -F @modeldoctor/web vitest run src/features/benchmarks/__tests__/forms/GuidellmParamsForm.test.tsx`
Expected: FAIL — warning element does not exist.

- [ ] **Step 10.4: Add connection-watch to GuidellmParamsForm**

Edit `apps/web/src/features/benchmarks/forms/GuidellmParamsForm.tsx`. Inside the function body, add the imports and after `useFormContext()`:

```ts
import { useConnections } from "@/features/connections/queries";
import { GUIDELLM_CATEGORY_DEFAULTS } from "@modeldoctor/tool-adapters/schemas";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
// (also add `useWatch` to the existing react-hook-form import)
```

In the component body (paste near other hooks):

```ts
  const { t } = useTranslation("benchmarks");
  const connectionId = useWatch({ control, name: "connectionId" }) as string | undefined;
  const connections = useConnections();
  const connection = connectionId
    ? connections.data?.find((c) => c.id === connectionId)
    : undefined;

  const lastConnectionId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!connection) return;
    if (lastConnectionId.current === connection.id) return;
    lastConnectionId.current = connection.id;
    const def = GUIDELLM_CATEGORY_DEFAULTS[connection.category];
    if ("apiType" in def) {
      setValue(`${fieldPrefix}.apiType`, def.apiType, { shouldDirty: false });
    }
  }, [connection, fieldPrefix, setValue]);

  const unsupported =
    connection && "unsupported" in GUIDELLM_CATEGORY_DEFAULTS[connection.category];
```

(`setValue` is already exposed by `useFormContext` if currently destructured; if not, destructure it.)

Render the warning right above the existing `apiType` field (or near the top of the params block):

```tsx
      {unsupported && connection && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {t("forms.unsupportedCategory.guidellm", { category: connection.category })}
        </p>
      )}
```

- [ ] **Step 10.5: Add i18n strings (will be revisited in Task 12 for full polish)**

Add to `apps/web/src/locales/zh-CN/benchmarks.json` under a new top-level `forms` block:

```json
  "forms": {
    "unsupportedCategory": {
      "guidellm": "guidellm 不支持 {{category}} 类型连接，请改用 vegeta 或 genai-perf",
      "genaiPerf": "genai-perf 不支持 {{category}} 类型连接，请改用 vegeta"
    }
  },
```

And to `apps/web/src/locales/en-US/benchmarks.json`:

```json
  "forms": {
    "unsupportedCategory": {
      "guidellm": "guidellm does not support '{{category}}' connections — try vegeta or genai-perf instead",
      "genaiPerf": "genai-perf does not support '{{category}}' connections — try vegeta instead"
    }
  },
```

- [ ] **Step 10.6: Run test to confirm pass**

Run: `pnpm -F @modeldoctor/web vitest run src/features/benchmarks/__tests__/forms/GuidellmParamsForm.test.tsx`
Expected: PASS.

- [ ] **Step 10.7: Commit**

```bash
git add apps/web/src/features/benchmarks/forms/GuidellmParamsForm.tsx apps/web/src/features/benchmarks/__tests__/forms/GuidellmParamsForm.test.tsx apps/web/src/locales/zh-CN/benchmarks.json apps/web/src/locales/en-US/benchmarks.json
git commit -m "$(cat <<'EOF'
feat(web): GuidellmParamsForm warns on unsupported connection categories

Watching connectionId, we set apiType=chat for chat connections (the
only supported category) and render an inline warning otherwise so
users picking an embedding connection don't silently produce 100%
errors. Same trap that motivated the vegeta path/body work; cheap fix.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: GenaiPerfParamsForm — connection.category warning + endpointType reset

**Files:**
- Modify: `apps/web/src/features/benchmarks/forms/GenaiPerfParamsForm.tsx`
- Create: `apps/web/src/features/benchmarks/__tests__/forms/GenaiPerfParamsForm.test.tsx`

- [ ] **Step 11.1: Write the failing test**

Create `apps/web/src/features/benchmarks/__tests__/forms/GenaiPerfParamsForm.test.tsx`. Mirror the Guidellm test but use `genaiPerfParamsSchema` defaults and assert:

```tsx
import { zodResolver } from "@hookform/resolvers/zod";
import type { ConnectionPublic, ListConnectionsResponse } from "@modeldoctor/contracts";
import { genaiPerfParamsSchema } from "@modeldoctor/tool-adapters/schemas";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { GenaiPerfParamsForm } from "../../forms/GenaiPerfParamsForm";

vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
import { api } from "@/lib/api-client";

const wrapperSchema = z.object({
  connectionId: z.string(),
  params: genaiPerfParamsSchema,
});

function fixture(category: ConnectionPublic["category"]): ConnectionPublic {
  return {
    id: `c_${category}`,
    userId: "u_1",
    name: `n-${category}`,
    baseUrl: "http://example/",
    apiKeyPreview: "sk-...x",
    model: "m",
    customHeaders: "",
    queryParams: "",
    category,
    tags: [],
    prometheusUrl: null,
    serverKind: null,
    tokenizerHfId: null,
    createdAt: "2026-05-06T00:00:00.000Z",
    updatedAt: "2026-05-06T00:00:00.000Z",
  };
}

function makeWrapper(connectionId: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    const form = useForm({
      resolver: zodResolver(wrapperSchema),
      defaultValues: {
        connectionId,
        params: {
          endpointType: "chat",
          numPrompts: 100,
          concurrency: 1,
          streaming: true,
          inputTokensStddev: 0,
          outputTokensStddev: 0,
        },
      },
    });
    return (
      <QueryClientProvider client={qc}>
        <FormProvider {...form}>{children}</FormProvider>
      </QueryClientProvider>
    );
  };
}

describe("GenaiPerfParamsForm category warning + reset", () => {
  it("sets endpointType=embeddings when an embeddings connection is picked", async () => {
    vi.mocked(api.get).mockResolvedValue({
      items: [fixture("embeddings")],
    } satisfies ListConnectionsResponse);
    const Wrapper = makeWrapper("c_embeddings");
    render(
      <Wrapper>
        <GenaiPerfParamsForm />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByLabelText(/endpoint type/i)).toHaveValue("embeddings");
    });
  });

  it("warns when picking an audio connection (genai-perf does not support audio)", async () => {
    vi.mocked(api.get).mockResolvedValue({
      items: [fixture("audio")],
    } satisfies ListConnectionsResponse);
    const Wrapper = makeWrapper("c_audio");
    render(
      <Wrapper>
        <GenaiPerfParamsForm />
      </Wrapper>,
    );
    await waitFor(() => expect(screen.getByText(/不支持/i)).toBeInTheDocument());
  });
});
```

(If GenaiPerfParamsForm renders endpointType via a `<Select>` rather than a native `<select>`, the `toHaveValue("embeddings")` assertion changes to checking displayed text — adapt to the actual rendering.)

- [ ] **Step 11.2: Run test to confirm failure**

Run: `pnpm -F @modeldoctor/web vitest run src/features/benchmarks/__tests__/forms/GenaiPerfParamsForm.test.tsx`
Expected: FAIL.

- [ ] **Step 11.3: Wire connection-watch into GenaiPerfParamsForm**

Edit `apps/web/src/features/benchmarks/forms/GenaiPerfParamsForm.tsx`. Add imports:

```ts
import { useConnections } from "@/features/connections/queries";
import { GENAI_PERF_CATEGORY_DEFAULTS } from "@modeldoctor/tool-adapters/schemas";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useWatch } from "react-hook-form"; // add to existing import
```

Add inside the component body:

```ts
  const { t } = useTranslation("benchmarks");
  const connectionId = useWatch({ control, name: "connectionId" }) as string | undefined;
  const connections = useConnections();
  const connection = connectionId
    ? connections.data?.find((c) => c.id === connectionId)
    : undefined;

  const lastConnectionId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!connection) return;
    if (lastConnectionId.current === connection.id) return;
    lastConnectionId.current = connection.id;
    const def = GENAI_PERF_CATEGORY_DEFAULTS[connection.category];
    if ("endpointType" in def) {
      setValue(`${fieldPrefix}.endpointType`, def.endpointType, { shouldDirty: false });
    }
  }, [connection, fieldPrefix, setValue]);

  const unsupported =
    connection && "unsupported" in GENAI_PERF_CATEGORY_DEFAULTS[connection.category];
```

Render the warning above the endpointType field:

```tsx
      {unsupported && connection && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {t("forms.unsupportedCategory.genaiPerf", { category: connection.category })}
        </p>
      )}
```

- [ ] **Step 11.4: Run test to confirm pass**

Run: `pnpm -F @modeldoctor/web vitest run src/features/benchmarks/__tests__/forms/GenaiPerfParamsForm.test.tsx`
Expected: PASS.

- [ ] **Step 11.5: Commit**

```bash
git add apps/web/src/features/benchmarks/forms/GenaiPerfParamsForm.tsx apps/web/src/features/benchmarks/__tests__/forms/GenaiPerfParamsForm.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): GenaiPerfParamsForm derives endpointType from connection.category

Picking a chat / embeddings / rerank connection auto-sets the
corresponding endpointType. Audio + image connections render a warning
since genai-perf does not speak those modalities.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase D — FE detail page

### Task 12: i18n strings for Request details panel

**Files:**
- Modify: `apps/web/src/locales/zh-CN/benchmarks.json`
- Modify: `apps/web/src/locales/en-US/benchmarks.json`

- [ ] **Step 12.1: Add the keys**

Inside the existing `detail` block in `apps/web/src/locales/zh-CN/benchmarks.json`, add a `requestDetails` sub-block:

```json
    "requestDetails": {
      "title": "请求详情",
      "method": "方法",
      "url": "URL",
      "headers": "请求头",
      "body": "请求体",
      "params": "运行参数",
      "paramKeys": {
        "apiType": "API 类型",
        "rate": "速率（req/s）",
        "duration": "时长（s）",
        "path": "Path"
      },
      "copyCurl": "复制为 cURL",
      "copySuccess": "已复制到剪贴板",
      "hint": "连接信息（baseUrl / apiKey / Headers / queryParams）来自当前连接配置；如该连接被修改，本次压测实际发送的可能不同",
      "connectionMissing": "连接已删除，无法解析 URL / 凭证",
      "loading": "加载中…"
    },
```

And in `apps/web/src/locales/en-US/benchmarks.json`:

```json
    "requestDetails": {
      "title": "Request details",
      "method": "Method",
      "url": "URL",
      "headers": "Headers",
      "body": "Body",
      "params": "Run params",
      "paramKeys": {
        "apiType": "API type",
        "rate": "Rate (req/s)",
        "duration": "Duration (s)",
        "path": "Path"
      },
      "copyCurl": "Copy as cURL",
      "copySuccess": "Copied to clipboard",
      "hint": "Connection settings (baseUrl / apiKey / headers / queryParams) reflect the live connection; if it has been edited since this benchmark ran, what was actually sent may differ",
      "connectionMissing": "Connection deleted — URL and credentials cannot be resolved",
      "loading": "Loading…"
    },
```

- [ ] **Step 12.2: Verify JSON parses**

Run: `node -e "require('./apps/web/src/locales/zh-CN/benchmarks.json'); require('./apps/web/src/locales/en-US/benchmarks.json'); console.log('ok')"`
Expected: `ok`.

- [ ] **Step 12.3: Commit**

```bash
git add apps/web/src/locales/zh-CN/benchmarks.json apps/web/src/locales/en-US/benchmarks.json
git commit -m "$(cat <<'EOF'
feat(web): i18n strings for benchmark detail page Request details panel

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: `RequestDetailsSection` component

**Files:**
- Create: `apps/web/src/features/benchmarks/RequestDetailsSection.tsx`
- Create: `apps/web/src/features/benchmarks/__tests__/RequestDetailsSection.test.tsx`

- [ ] **Step 13.1: Write the failing test**

Create `apps/web/src/features/benchmarks/__tests__/RequestDetailsSection.test.tsx`:

```tsx
import type { Benchmark, ConnectionPublic } from "@modeldoctor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import { RequestDetailsSection } from "../RequestDetailsSection";

vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
import { api } from "@/lib/api-client";

const CONNECTION: ConnectionPublic = {
  id: "c_emb",
  userId: "u_1",
  name: "bge-by-mis-tei",
  baseUrl: "http://gw/",
  apiKeyPreview: "sk-...bc8d",
  model: "bge-m3-uZbs",
  customHeaders: "X-Trace: 1",
  queryParams: "",
  category: "embeddings",
  tags: [],
  prometheusUrl: null,
  serverKind: null,
  tokenizerHfId: null,
  createdAt: "2026-05-06T00:00:00.000Z",
  updatedAt: "2026-05-06T00:00:00.000Z",
};

function makeBenchmark(): Benchmark {
  return {
    id: "b_1",
    userId: "u_1",
    connectionId: "c_emb",
    connection: { id: "c_emb", name: "bge-by-mis-tei" },
    scenario: "gateway",
    tool: "vegeta",
    toolVersion: "12.11.0",
    name: "weetime-02",
    description: null,
    status: "completed",
    statusMessage: null,
    progress: 1,
    driverHandle: null,
    params: {
      apiType: "embeddings",
      rate: 100,
      duration: 30,
      path: "/v1/embeddings",
      body: '{"model":"bge-m3-uZbs","input":"hello"}',
    },
    rawOutput: null,
    summaryMetrics: { latencies: { p95: 147 } },
    serverMetrics: null,
    templateId: null,
    parentBenchmarkId: null,
    baselineId: null,
    logs: null,
    createdAt: "2026-05-06T00:00:00.000Z",
    startedAt: "2026-05-06T00:00:00.000Z",
    completedAt: "2026-05-06T00:00:30.000Z",
    baselineFor: null,
  };
}

function withProviders(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={qc}>{node}</QueryClientProvider>
    </I18nextProvider>
  );
}

describe("RequestDetailsSection", () => {
  it("renders URL with path appended, plaintext Bearer header, and pretty body", async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === "/api/connections/c_emb")
        return Promise.resolve(CONNECTION) as unknown as never;
      if (url === "/api/connections/c_emb/reveal-key")
        return Promise.resolve({ apiKey: "sk-secret" }) as unknown as never;
      throw new Error(`unexpected url ${url}`);
    });

    render(withProviders(<RequestDetailsSection benchmark={makeBenchmark()} />));

    await waitFor(() => {
      expect(screen.getByText("http://gw//v1/embeddings")).toBeInTheDocument();
    });
    expect(screen.getByText(/Authorization: Bearer sk-secret/)).toBeInTheDocument();
    expect(screen.getByText(/X-Trace: 1/)).toBeInTheDocument();
    // body pretty-print contains both keys on their own lines
    expect(screen.getByText(/"model": "bge-m3-uZbs"/)).toBeInTheDocument();
    expect(screen.getByText(/"input": "hello"/)).toBeInTheDocument();
  });

  it("copies a cURL command via clipboard when the button is clicked", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === "/api/connections/c_emb")
        return Promise.resolve(CONNECTION) as unknown as never;
      if (url === "/api/connections/c_emb/reveal-key")
        return Promise.resolve({ apiKey: "sk-secret" }) as unknown as never;
      throw new Error("unexpected");
    });

    render(withProviders(<RequestDetailsSection benchmark={makeBenchmark()} />));

    await waitFor(() => screen.getByRole("button", { name: /cURL/i }));
    await userEvent.click(screen.getByRole("button", { name: /cURL/i }));

    expect(writeText).toHaveBeenCalledTimes(1);
    const arg = writeText.mock.calls[0][0] as string;
    expect(arg).toContain("curl -X POST 'http://gw//v1/embeddings'");
    expect(arg).toContain("-H 'Authorization: Bearer sk-secret'");
    expect(arg).toContain("-d '{\"model\":\"bge-m3-uZbs\",\"input\":\"hello\"}'");
  });
});
```

- [ ] **Step 13.2: Run test to confirm failure**

Run: `pnpm -F @modeldoctor/web vitest run src/features/benchmarks/__tests__/RequestDetailsSection.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 13.3: Implement `RequestDetailsSection.tsx`**

Create `apps/web/src/features/benchmarks/RequestDetailsSection.tsx`:

```tsx
import { Button } from "@/components/ui/button";
import { useConnection, useRevealApiKey } from "@/features/connections/queries";
import type { Benchmark } from "@modeldoctor/contracts";
import { migrateVegetaParams, type VegetaParams } from "@modeldoctor/tool-adapters/schemas";
import { Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

interface Props {
  benchmark: Benchmark;
}

function buildUrl(baseUrl: string, path: string, queryParams: string): string {
  let url = baseUrl + path;
  const lines = queryParams
    .split("\n")
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && p.includes("="));
  if (lines.length > 0) {
    url += (url.includes("?") ? "&" : "?") + lines.join("&");
  }
  return url;
}

function prettyBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

function buildCurl(
  url: string,
  headers: string[],
  body: string,
): string {
  const headerArgs = headers.map((h) => ` -H '${h}'`).join("");
  return `curl -X POST '${url}'${headerArgs} -d '${body}'`;
}

export function RequestDetailsSection({ benchmark }: Props) {
  const { t } = useTranslation("benchmarks");
  const { data: connection, isLoading: connLoading } = useConnection(benchmark.connectionId);
  const { data: revealed, isLoading: keyLoading } = useRevealApiKey(benchmark.connectionId);

  if (!benchmark.connectionId) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("detail.requestDetails.connectionMissing")}
      </p>
    );
  }
  if (connLoading || keyLoading) {
    return <p className="text-sm text-muted-foreground">{t("detail.requestDetails.loading")}</p>;
  }
  if (!connection || !revealed) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("detail.requestDetails.connectionMissing")}
      </p>
    );
  }

  // Migrate legacy params (pre-path/body) on the fly.
  const migrated = migrateVegetaParams(
    benchmark.params as Partial<VegetaParams> & {
      apiType: VegetaParams["apiType"];
      rate: number;
      duration: number;
    },
    connection.model,
  );

  const url = buildUrl(connection.baseUrl, migrated.path, connection.queryParams);
  const headers = [
    "Content-Type: application/json",
    `Authorization: Bearer ${revealed.apiKey}`,
    ...connection.customHeaders
      .split("\n")
      .map((h) => h.trim())
      .filter((h) => h.length > 0 && h.includes(":")),
  ];
  const body = prettyBody(migrated.body);

  async function copyCurl() {
    const curl = buildCurl(url, headers, migrated.body);
    await navigator.clipboard.writeText(curl);
    toast.success(t("detail.requestDetails.copySuccess"));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t("detail.requestDetails.title")}</h3>
        <Button variant="outline" size="sm" onClick={copyCurl}>
          <Copy className="mr-1 h-4 w-4" />
          {t("detail.requestDetails.copyCurl")}
        </Button>
      </div>

      <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-[120px_1fr]">
        <dt className="text-muted-foreground">{t("detail.requestDetails.method")}</dt>
        <dd className="font-mono">POST</dd>

        <dt className="text-muted-foreground">{t("detail.requestDetails.url")}</dt>
        <dd className="break-all font-mono text-xs">{url}</dd>

        <dt className="text-muted-foreground">{t("detail.requestDetails.headers")}</dt>
        <dd>
          <pre className="whitespace-pre-wrap break-all rounded-md border border-border bg-muted/30 p-2 font-mono text-xs">
            {headers.join("\n")}
          </pre>
        </dd>

        <dt className="text-muted-foreground">{t("detail.requestDetails.body")}</dt>
        <dd>
          <pre className="overflow-auto rounded-md border border-border bg-muted/30 p-2 font-mono text-xs">
            {body}
          </pre>
        </dd>

        <dt className="text-muted-foreground">{t("detail.requestDetails.params")}</dt>
        <dd className="font-mono text-xs">
          <ul className="space-y-0.5">
            <li>{t("detail.requestDetails.paramKeys.apiType")}: {migrated.apiType}</li>
            <li>{t("detail.requestDetails.paramKeys.rate")}: {migrated.rate}</li>
            <li>{t("detail.requestDetails.paramKeys.duration")}: {migrated.duration}</li>
            <li>{t("detail.requestDetails.paramKeys.path")}: {migrated.path}</li>
          </ul>
        </dd>
      </dl>

      <p className="text-xs text-muted-foreground">{t("detail.requestDetails.hint")}</p>
    </div>
  );
}
```

- [ ] **Step 13.4: Run test to confirm pass**

Run: `pnpm -F @modeldoctor/web vitest run src/features/benchmarks/__tests__/RequestDetailsSection.test.tsx`
Expected: PASS.

- [ ] **Step 13.5: Commit**

```bash
git add apps/web/src/features/benchmarks/RequestDetailsSection.tsx apps/web/src/features/benchmarks/__tests__/RequestDetailsSection.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): RequestDetailsSection component for benchmark detail page

Renders method / URL / headers (plaintext Authorization Bearer) / body /
run params + copy-as-cURL button. Reads benchmark.params for path+body
(falls back to migrateVegetaParams for legacy rows) and the live
connection for baseUrl / customHeaders / queryParams. Plaintext apiKey
comes from useRevealApiKey hook.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Integrate `RequestDetailsSection` into `BenchmarkDetailPage`

**Files:**
- Modify: `apps/web/src/features/benchmarks/BenchmarkDetailPage.tsx`

- [ ] **Step 14.1: Insert the section**

Edit `BenchmarkDetailPage.tsx`. Add the import:

```tsx
import { RequestDetailsSection } from "./RequestDetailsSection";
```

Inside the `isTerminal ? <>…</> : <RunningSection …/>` block, insert a new `<section>` between `BenchmarkDetailMetadata` (the existing first section) and the `Alert` for failed status — actually, since metadata sits at the top and metrics later, place RequestDetailsSection just before the `<section>` that renders `<ReportSection benchmark={benchmark} />`. Filter to gateway+vegeta:

```tsx
            {benchmark.scenario === "gateway" && benchmark.tool === "vegeta" && (
              <section>
                <RequestDetailsSection benchmark={benchmark} />
              </section>
            )}
            <section>
              <h3 className="mb-3 text-sm font-semibold">{t("detail.metrics.title")}</h3>
              <ReportSection benchmark={benchmark} />
            </section>
```

- [ ] **Step 14.2: Update existing detail-page test (if it asserts on rendered structure)**

Run: `grep -n "RequestDetails\|metrics.title" apps/web/src/features/benchmarks/__tests__/BenchmarkDetailPage.test.tsx`
If existing assertions need adjustment for non-vegeta cases, leave them unchanged (the section is conditional).

- [ ] **Step 14.3: Run web specs to confirm no regression**

Run: `pnpm -F @modeldoctor/web vitest run`
Expected: all green.

- [ ] **Step 14.4: Commit**

```bash
git add apps/web/src/features/benchmarks/BenchmarkDetailPage.tsx
git commit -m "$(cat <<'EOF'
feat(web): render RequestDetailsSection on gateway-vegeta benchmark detail

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase E — Rerun migration

### Task 15: Rerun handler migrates legacy vegeta params

**Files:**
- Modify: `apps/web/src/features/benchmarks/BenchmarkDetailPage.tsx`

- [ ] **Step 15.1: Wrap params through `migrateVegetaParams` before submit**

In `handleRerun`, find:

```ts
      const next = await createBenchmark.mutateAsync({
        tool: benchmark.tool,
        scenario: benchmark.scenario,
        connectionId: benchmark.connectionId,
        name: newName,
        description: benchmark.description ?? undefined,
        params: benchmark.params,
      });
```

Replace `params: benchmark.params,` with:

```ts
        params:
          benchmark.tool === "vegeta"
            ? (migrateVegetaParams(
                benchmark.params as Parameters<typeof migrateVegetaParams>[0],
                benchmark.connection?.name ?? null, // best-effort; actual model is not exposed via Benchmark
              ) as unknown as Record<string, unknown>)
            : benchmark.params,
```

(Migration uses `connection.name` as a stand-in for `connection.model` only as a model fallback — the legacy benchmark may not have stored the model anywhere accessible, so we accept that the body's `model` field will say the connection name when filling the gap. New benchmarks always carry their own body.)

Add the import at the top:

```tsx
import { migrateVegetaParams } from "@modeldoctor/tool-adapters/schemas";
```

- [ ] **Step 15.2: Run web specs**

Run: `pnpm -F @modeldoctor/web vitest run`
Expected: all green.

- [ ] **Step 15.3: Commit**

```bash
git add apps/web/src/features/benchmarks/BenchmarkDetailPage.tsx
git commit -m "$(cat <<'EOF'
fix(web): rerun migrates legacy vegeta benchmark params (path / body)

Pre-path/body benchmarks would otherwise fail server-side schema
validation on rerun. migrateVegetaParams fills missing fields from
apiType-derived defaults so rerun works for historical rows.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase F — E2E

### Task 16: Playwright smoke test

**Files:**
- Create: `e2e/vegeta-gateway-custom-request.spec.ts`

- [ ] **Step 16.1: Write the spec**

Create `e2e/vegeta-gateway-custom-request.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { signIn } from "./helpers/auth";
import { createTestConnection } from "./helpers/connections";

test.describe("vegeta gateway customizable request", () => {
  test("Advanced defaults match the picked connection's category and detail page surfaces request details", async ({
    page,
    request,
  }) => {
    await signIn(page);
    const connection = await createTestConnection(request, {
      name: "e2e-emb",
      baseUrl: "http://example.invalid/v1",
      apiKey: "sk-e2e",
      model: "bge-m3-test",
      category: "embeddings",
    });

    await page.goto("/benchmarks/new?scenario=gateway");
    await page.getByRole("combobox", { name: /connection/i }).click();
    await page.getByRole("option", { name: "e2e-emb" }).click();

    // Advanced is collapsed; expand it.
    await page.getByText(/^Advanced$/).click();

    await expect(page.getByLabel(/^path/i)).toHaveValue("/v1/embeddings");
    const body = await page.getByLabel(/^body/i).inputValue();
    expect(JSON.parse(body)).toEqual({ model: "bge-m3-test", input: "hello" });

    await page.getByLabel(/name/i).fill("e2e-vegeta-emb");
    await page.getByRole("button", { name: /submit/i }).click();

    // Detail page opens; wait for terminal status (run will likely fail
    // because example.invalid is unreachable, but the "Request details"
    // section is rendered as soon as the row is terminal).
    await expect(page.getByText(/request details|请求详情/i)).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("http://example.invalid/v1/v1/embeddings")).toBeVisible();
    await expect(page.getByText(/Authorization: Bearer sk-e2e/)).toBeVisible();
  });
});
```

`helpers/auth` and `helpers/connections` already exist for other e2e specs; if not, mirror an existing spec's setup. Run a quick check:

Run: `ls e2e/helpers/ 2>&1 | head`
If helpers are absent, inline the auth + connection-create flow.

- [ ] **Step 16.2: Run e2e**

Run: `pnpm test:e2e:browser e2e/vegeta-gateway-custom-request.spec.ts`
Expected: PASS.

- [ ] **Step 16.3: Commit**

```bash
git add e2e/vegeta-gateway-custom-request.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): smoke for vegeta gateway path/body Advanced + Request details

Picks an embeddings connection, asserts Advanced defaults derived from
category, submits, and verifies Request details panel surfaces URL,
plaintext Bearer header on the detail page.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final verification

- [ ] **Step F.1: Workspace-wide checks**

Run, in order:
- `pnpm -r build`
- `pnpm -r typecheck`
- `pnpm -r lint`
- `pnpm -r vitest run`

Expected: all green. If anything fails, fix the underlying issue (do NOT skip hooks or disable rules).

- [ ] **Step F.2: Open the PR**

Run:
```bash
git push -u origin feat/vegeta-gateway-custom-request
gh pr create --title "feat(benchmarks): vegeta gateway customizable path/body + cross-tool category defaults" --body "$(cat <<'EOF'
## Summary
- Vegeta gateway: path + body editable per benchmark (Advanced disclosure), with apiType-derived defaults seeded from the picked connection's `category` and `model`. Resolves the "default chat against an embedding endpoint → 100% errors" trap.
- New "Request details" panel on gateway-vegeta benchmark detail pages — URL / plaintext-Bearer headers / pretty-printed body / run params / copy-as-cURL.
- All three tools (vegeta / guidellm / genai-perf) now derive their `apiType` / `endpointType` from `connection.category`. Forms warn when the picked tool does not speak the connection's modality.
- New owner-only `GET /api/connections/:id/reveal-key` endpoint backs the plaintext header rendering.
- Backwards-compat helper `migrateVegetaParams` fills missing path/body for legacy benchmark rows on detail-page render and rerun.
- Tier 3 follow-up (chat-vision / chat-audio default body shapes) tracked as #136.

Design: `docs/superpowers/specs/2026-05-06-vegeta-gateway-customizable-request-design.md`
Plan: `docs/superpowers/plans/2026-05-06-vegeta-gateway-customizable-request.md`

## Test plan
- [x] `pnpm -r vitest run` passes
- [x] `pnpm test:e2e:browser e2e/vegeta-gateway-custom-request.spec.ts` passes
- [ ] Manual: pick the existing `bge-by-mis-tei` embedding connection on `/benchmarks/new?scenario=gateway`, observe Advanced auto-fills `/v1/embeddings` + `{model:..., input:"hello"}`, submit, verify Request details panel matches the cURL the user reported worked.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Then per project memory follow-through: `gh pr view --json comments,reviews,statusCheckRollup,mergeStateStatus`, `gh pr checks <N>`, watch CI, fix red signals.

---

## Self-review notes (executed during plan authoring)

- **Spec coverage:** Every spec section has at least one task. Schema → Task 2; runtime → Task 3; migrate-params → Task 4; category-defaults → Task 1; reveal-key API → Tasks 6–7; FE forms → Tasks 9–11; detail page → Tasks 12–14; rerun migration → Task 15; e2e → Task 16. The "no template substitution at runtime" non-goal is honored (runtime uses `params.body` verbatim; substitution happens FE-side).
- **Type consistency:** `migrateVegetaParams` signature is consistent across Tasks 4, 13, 15. `VEGETA_API_TYPE_TO_PATH` / `VEGETA_API_TYPE_TO_BODY` exported names match between Task 5 (export) and Task 9 / Task 13 (consumers).
- **Placeholder scan:** No TBDs / "implement later" / abstract "handle errors" steps. Code blocks present at every implementation step.
- **Test correctness:** Each test asserts behavior the implementation will produce; no test asserts on internal state. Mocks are scoped per-render with fresh QueryClient.
