> **Status: ✅ Completed · historical record.** 本文是提交时的设计/计划快照；其中字段名、目录路径、env 名、API 路由为当时状态，重构后已演进。**当前实现请以代码与 `CLAUDE.md` 为准；本文正文不再修改，仅作归档。**

# E2E Smoke Multi-Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the E2E Smoke feature from 3 hardcoded probes (text / image / audio — all chat-completions-flavored) to a category-based probe matrix covering chat / embeddings / rerank / audio / image-gen. Each category contains 1+ probes; each probe has a default OpenAI-compatible path AND a manual override field. Inference-engine selector becomes UX-only (model-name suggestions / quirks tips), not routing.

**Architecture:**

- **Contract (`packages/contracts/src/e2e-test.ts`)**: `ProbeName` enum expands from 3 to 10 entries. New `ProbeCategory` enum. New `PROBES_BY_CATEGORY` constant maps category → probe ids. Request schema gains `pathOverride: Record<ProbeName, string>` (optional per-probe override).
- **API probes (`apps/api/src/integrations/probes/`)**: rename `text/image/audio.ts` → `chat-text.ts / chat-vision.ts / chat-audio-omni.ts` (file rename + export rename). Add `embeddings-openai`, `embeddings-tei`, `rerank-tei`, `rerank-cohere`, `tts`, `asr`, `image-gen`. Each accepts `pathOverride: string | undefined` from `ProbeCtx` and falls back to its hardcoded default. The service threads `pathOverride[probeId]` through.
- **ASR fixture**: ship `apps/api/src/integrations/probes/fixtures/sample-1s-silence.wav` — a ~88-byte synthetic 1-second mono 8kHz silent WAV. Generated once and committed; not regenerated at runtime.
- **Web store (`apps/web/src/features/e2e-smoke/store.ts`)**: add `selectedCategory: ProbeCategory | null` and `pathOverrides: Partial<Record<ProbeName, string>>`. Persistence version bumps to `v2` so old `v1` values get cleared on first load.
- **Web UI (`E2ESmokePage.tsx` + `ProbeCard.tsx`)**: category dropdown drives which probe cards render. Each card adds a small editable input under the title showing the effective path (default greyed, override filled). Pure UX changes — the contract carries the data.
- **i18n**: add new categories + probe names to `apps/web/src/locales/{en,zh}/e2e.json`.

**Tech Stack:** NestJS 10 + Prisma (no schema changes), zod-derived contracts, React 18 + zustand, vitest@2 (api) / vitest@1 (web), Biome lint/format.

---

## Pre-flight — confirm clean working tree

- [ ] **Step 1: Confirm we are on `feat/regression-suite` with a clean tree**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat/regression-suite
git status
git log --oneline -3
```

Expected: `On branch feat/regression-suite`, clean tree, HEAD at `c33d475 fix(env): point BENCHMARK_RUNNER_IMAGE…` (the rebase head), parent at `fdd6882 Merge pull request #25 …`.

If the tree is dirty, stop and report — there should be no in-flight changes when this plan starts.

---

## Task 1: Contract — expand ProbeName enum, add Category map, add pathOverride

**Goal:** lock in the new probe identifiers + categories before any code changes downstream. After this commit, `packages/contracts` builds clean. `apps/api` and `apps/web` will fail type-check (they still reference `"text"|"image"|"audio"`) — those are fixed in subsequent tasks.

**Files:**
- Modify: `packages/contracts/src/e2e-test.ts`

- [ ] **Step 1: Replace `ProbeNameSchema` and add category constants**

Open `packages/contracts/src/e2e-test.ts`. At the top of the file, replace the existing block (lines 1–45) with:

```typescript
import { z } from "zod";

// All probe identifiers, matching the 5 model-service categories below.
// Each id is dash-separated and explicitly names the wire shape (e.g. "rerank-tei"
// vs "rerank-cohere") so naming is unambiguous when a category contains
// multiple probes that hit different protocols.
export const ProbeNameSchema = z.enum([
  // chat (LLM)
  "chat-text",
  "chat-vision",
  // audio
  "tts",
  "asr",
  "chat-audio-omni",
  // embeddings
  "embeddings-openai",
  "embeddings-tei",
  // rerank
  "rerank-tei",
  "rerank-cohere",
  // image
  "image-gen",
]);
export type ProbeName = z.infer<typeof ProbeNameSchema>;

export const ProbeCategorySchema = z.enum(["chat", "audio", "embeddings", "rerank", "image"]);
export type ProbeCategory = z.infer<typeof ProbeCategorySchema>;

/**
 * Category → probe ids. Iteration order in the array determines display
 * order in the UI, so don't rearrange casually.
 */
export const PROBES_BY_CATEGORY: Record<ProbeCategory, readonly ProbeName[]> = {
  chat: ["chat-text", "chat-vision"],
  audio: ["tts", "asr", "chat-audio-omni"],
  embeddings: ["embeddings-openai", "embeddings-tei"],
  rerank: ["rerank-tei", "rerank-cohere"],
  image: ["image-gen"],
} as const;

/**
 * Default OpenAI-compatible (or community-standard) path each probe hits
 * when the user does not supply an override. Source-of-truth for the path
 * shown in the UI's editable field.
 */
export const PROBE_DEFAULT_PATHS: Record<ProbeName, string> = {
  "chat-text": "/v1/chat/completions",
  "chat-vision": "/v1/chat/completions",
  "chat-audio-omni": "/v1/chat/completions",
  tts: "/v1/audio/speech",
  asr: "/v1/audio/transcriptions",
  "embeddings-openai": "/v1/embeddings",
  "embeddings-tei": "/embed",
  "rerank-tei": "/rerank",
  "rerank-cohere": "/v1/rerank",
  "image-gen": "/v1/images/generations",
};

export const ProbeCheckSchema = z.object({
  name: z.string(),
  pass: z.boolean(),
  info: z.string().optional(),
});
export type ProbeCheck = z.infer<typeof ProbeCheckSchema>;

export const ProbeResultSchema = z.object({
  pass: z.boolean(),
  latencyMs: z.number().nullable(),
  checks: z.array(ProbeCheckSchema),
  details: z.object({
    content: z.string().optional(),
    usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }).optional(),
    imagePreviewB64: z.string().optional(),
    imageMime: z.string().optional(),
    audioB64: z.string().optional(),
    audioBytes: z.number().optional(),
    numChoices: z.number().optional(),
    textReply: z.string().optional(),
    error: z.string().optional(),
    // Embeddings-specific
    embeddingDims: z.number().optional(),
    embeddingSample: z.array(z.number()).optional(),
    // Rerank-specific
    rerankResults: z.array(z.object({ index: z.number(), score: z.number() })).optional(),
    // Image-gen-specific
    imageGenUrl: z.string().optional(),
    imageGenB64: z.string().optional(),
  }),
});
export type ProbeResult = z.infer<typeof ProbeResultSchema>;

// Convention: `apiBaseUrl` is the origin (scheme://host[:port][/proxy-prefix]),
// without `/v1/...` path tail. Each probe constructs its target URL by
// appending its OpenAI-compatible default path OR an explicit pathOverride
// supplied per probe.
export const E2ETestRequestSchema = z.object({
  apiBaseUrl: z.string().min(1),
  apiKey: z.string().min(1),
  model: z.string().min(1),
  customHeaders: z.string().optional(),
  probes: z.array(ProbeNameSchema).min(1),
  // Per-probe path override (path tail starting with "/"). Missing keys fall
  // back to PROBE_DEFAULT_PATHS. Treats the value as opaque — the probe is
  // responsible for prepending apiBaseUrl.
  pathOverride: z.record(ProbeNameSchema, z.string()).optional(),
});
export type E2ETestRequest = z.infer<typeof E2ETestRequestSchema>;

export const E2ETestResponseSchema = z.object({
  success: z.boolean(),
  results: z.array(ProbeResultSchema.extend({ probe: ProbeNameSchema })),
  error: z.string().optional(),
});
export type E2ETestResponse = z.infer<typeof E2ETestResponseSchema>;
```

- [ ] **Step 2: Build + type-check + test contracts**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat/regression-suite
pnpm -F @modeldoctor/contracts build
pnpm -F @modeldoctor/contracts type-check
pnpm -F @modeldoctor/contracts test
```

Expected: build + type-check clean. Tests pass (existing tests don't reference probe names directly; if any do, they continue to work since the enum is a superset of the old one only when including the legacy names — but the new names like `"chat-text"` aren't `"text"`, so any test asserting `ProbeNameSchema.parse("text")` will fail. **If a contract test fails on `"text"|"image"|"audio"`,** update it to use `"chat-text"|"chat-vision"|"chat-audio-omni"`. That's a legitimate test update, not a deviation.

- [ ] **Step 3: Commit**

```bash
git add packages/contracts/src/e2e-test.ts
git commit -m "$(cat <<'EOF'
refactor(contracts/e2e-test): expand ProbeName, add ProbeCategory + path override

10 probe identifiers across 5 categories (chat / audio / embeddings /
rerank / image). PROBES_BY_CATEGORY drives UI display order;
PROBE_DEFAULT_PATHS gives each probe its hardcoded OpenAI / TEI / Cohere
default. E2ETestRequest gains optional pathOverride: Record<ProbeName,
string> for per-probe path overrides.

Following commits rename the existing 3 probes (text/image/audio →
chat-text/chat-vision/chat-audio-omni) and add the 7 new ones.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

After this commit, `apps/api` and `apps/web` type-check WILL fail until Tasks 2–9 land. That's expected.

---

## Task 2: Rename existing 3 probes + thread `pathOverride` through ProbeCtx

**Goal:** rename `text/image/audio` to their canonical new names AND add a `pathOverride: string | undefined` field to `ProbeCtx`. Each probe uses the override when present; otherwise its hardcoded default.

**Files:**
- Modify: `apps/api/src/integrations/probes/index.ts`
- Rename: `apps/api/src/integrations/probes/text.ts` → `chat-text.ts` (and rename the function)
- Rename: `apps/api/src/integrations/probes/image.ts` → `chat-vision.ts`
- Rename: `apps/api/src/integrations/probes/audio.ts` → `chat-audio-omni.ts`
- Modify: `apps/api/src/modules/e2e-test/e2e-test.service.ts`
- Modify: `apps/api/src/modules/e2e-test/e2e-test.controller.ts` (request → service translation)

- [ ] **Step 1: Update `ProbeCtx` shape in `probes/index.ts`**

Replace the contents of `apps/api/src/integrations/probes/index.ts` with:

```typescript
import type { ProbeName } from "@modeldoctor/contracts";
import { runChatAudioOmniProbe } from "./chat-audio-omni.js";
import { runChatTextProbe } from "./chat-text.js";
import { runChatVisionProbe } from "./chat-vision.js";

export { runChatTextProbe } from "./chat-text.js";
export { runChatVisionProbe } from "./chat-vision.js";
export { runChatAudioOmniProbe } from "./chat-audio-omni.js";

export interface ProbeCtx {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  extraHeaders: Record<string, string>;
  /**
   * Optional path override (from the request's `pathOverride[probeName]`).
   * If undefined, the probe falls back to its hardcoded OpenAI / TEI /
   * Cohere default. Always starts with "/" — the probe prepends apiBaseUrl.
   */
  pathOverride?: string;
}

export interface ProbeCheck {
  name: string;
  pass: boolean;
  info?: string;
}

export interface ProbeResult {
  pass: boolean;
  latencyMs: number | null;
  checks: ProbeCheck[];
  details: {
    content?: string;
    usage?: { prompt_tokens: number; completion_tokens: number };
    imagePreviewB64?: string;
    imageMime?: string;
    audioB64?: string;
    audioBytes?: number;
    numChoices?: number;
    textReply?: string;
    error?: string;
    embeddingDims?: number;
    embeddingSample?: number[];
    rerankResults?: { index: number; score: number }[];
    imageGenUrl?: string;
    imageGenB64?: string;
  };
}

export type Probe = (ctx: ProbeCtx) => Promise<ProbeResult>;

// Subsequent tasks add the remaining 7 probes — embeddings-openai/tei,
// rerank-tei/cohere, tts, asr, image-gen. The Partial<> here is temporary
// for the duration of those tasks; Task 8 narrows it back to a complete
// Record once every probe is wired.
export const PROBES: Partial<Record<ProbeName, Probe>> = {
  "chat-text": runChatTextProbe,
  "chat-vision": runChatVisionProbe,
  "chat-audio-omni": runChatAudioOmniProbe,
};
```

- [ ] **Step 2: Rename and update `text.ts` → `chat-text.ts`**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat/regression-suite
git mv apps/api/src/integrations/probes/text.ts apps/api/src/integrations/probes/chat-text.ts
```

Open `apps/api/src/integrations/probes/chat-text.ts`. Find and rename the exported function `runTextProbe` to `runChatTextProbe`. Find any line that hardcodes the URL (currently `${apiBaseUrl}/v1/chat/completions`) and change to:

```typescript
const path = ctx.pathOverride ?? "/v1/chat/completions";
const targetUrl = `${ctx.apiBaseUrl}${path}`;
```

(You will need to destructure `pathOverride` from `ctx` or read it via `ctx.pathOverride`. Either pattern is fine; pick the one consistent with how the rest of the file destructures.)

- [ ] **Step 3: Rename and update `image.ts` → `chat-vision.ts`**

```bash
git mv apps/api/src/integrations/probes/image.ts apps/api/src/integrations/probes/chat-vision.ts
```

Same edits: rename function `runImageProbe` → `runChatVisionProbe`, swap hardcoded URL for `pathOverride ?? "/v1/chat/completions"` pattern.

- [ ] **Step 4: Rename and update `audio.ts` → `chat-audio-omni.ts`**

```bash
git mv apps/api/src/integrations/probes/audio.ts apps/api/src/integrations/probes/chat-audio-omni.ts
```

Rename `runAudioProbe` → `runChatAudioOmniProbe`. Same URL substitution.

- [ ] **Step 5: Update `e2e-test.service.ts` to dispatch via the new registry + thread pathOverride**

Read `apps/api/src/modules/e2e-test/e2e-test.service.ts` first. The runner code currently calls `PROBES[name]` (or its old equivalent for "text"/"image"/"audio"). Update the dispatch loop so:

```typescript
const ctx: ProbeCtx = {
  apiBaseUrl: req.apiBaseUrl,
  apiKey: req.apiKey,
  model: req.model,
  extraHeaders: parseCustomHeaders(req.customHeaders),
  pathOverride: req.pathOverride?.[probeName],
};
const probe = PROBES[probeName];
if (!probe) {
  results.push({
    probe: probeName,
    pass: false,
    latencyMs: null,
    checks: [{ name: "probe-not-implemented", pass: false }],
    details: { error: `Probe '${probeName}' not implemented` },
  });
  continue;
}
const result = await probe(ctx);
results.push({ probe: probeName, ...result });
```

Adjust whatever local types or helper names exist around it. The not-implemented branch is the safety net during Tasks 3–7 when probes are being added incrementally.

- [ ] **Step 6: Run api tests + type-check + lint**

```bash
cd apps/api
pnpm type-check
pnpm test
pnpm lint
```

Expected: clean. The unit/e2e tests for the existing 3 probes should still pass (only the function names changed; the wire behavior is unchanged).

If any unit spec hardcodes `"text"`/`"image"`/`"audio"` strings, update them to the new names. That's a legit test update, not a deviation.

- [ ] **Step 7: Commit**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat/regression-suite
git add apps/api/src/integrations/probes/ apps/api/src/modules/e2e-test/
# Add any test files you touched.
git commit -m "$(cat <<'EOF'
refactor(api/e2e-test): rename text/image/audio probes + add pathOverride to ProbeCtx

text → chat-text, image → chat-vision, audio → chat-audio-omni. ProbeCtx
gains an optional pathOverride that each probe consults before falling
back to its hardcoded OpenAI default. The service now reads
req.pathOverride[probeName] and threads it into the ProbeCtx.

Wire behavior unchanged — only file/function names + the new override
hook. PROBES is temporarily a Partial<> until the remaining 7 probes
land in subsequent commits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Embeddings probes (OpenAI + TEI)

**Goal:** add two embeddings probes — `embeddings-openai` (POST `/v1/embeddings`, body `{ model, input: "..." }`) and `embeddings-tei` (POST `/embed`, body `{ inputs: ["..."] }`).

**Files:**
- Create: `apps/api/src/integrations/probes/embeddings-openai.ts`
- Create: `apps/api/src/integrations/probes/embeddings-tei.ts`
- Create: `apps/api/src/integrations/probes/embeddings.spec.ts`
- Modify: `apps/api/src/integrations/probes/index.ts` (register both)

- [ ] **Step 1: Write failing unit specs**

Create `apps/api/src/integrations/probes/embeddings.spec.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runEmbeddingsOpenAIProbe } from "./embeddings-openai.js";
import { runEmbeddingsTEIProbe } from "./embeddings-tei.js";
import type { ProbeCtx } from "./index.js";

const baseCtx: ProbeCtx = {
  apiBaseUrl: "http://example.test",
  apiKey: "k",
  model: "test-embedding",
  extraHeaders: {},
};

describe("runEmbeddingsOpenAIProbe", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("hits /v1/embeddings, asserts data[0].embedding is a numeric array", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({ data: [{ embedding: Array.from({ length: 768 }, () => 0.1) }] }),
        ),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runEmbeddingsOpenAIProbe(baseCtx);

    expect(result.pass).toBe(true);
    expect(result.details.embeddingDims).toBe(768);
    const url = fetchMock.mock.calls[0]?.[0];
    expect(url).toBe("http://example.test/v1/embeddings");
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1]?.body as string) ?? "{}");
    expect(body.input).toBeDefined();
    expect(body.model).toBe("test-embedding");
  });

  it("uses pathOverride when supplied", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] })),
    });
    vi.stubGlobal("fetch", fetchMock);

    await runEmbeddingsOpenAIProbe({ ...baseCtx, pathOverride: "/custom/embed-path" });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://example.test/custom/embed-path");
  });

  it("fails when response has no embedding array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ data: [] })),
      }),
    );

    const result = await runEmbeddingsOpenAIProbe(baseCtx);

    expect(result.pass).toBe(false);
  });
});

describe("runEmbeddingsTEIProbe", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("hits /embed by default, body uses TEI shape (inputs: [...])", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      text: () => Promise.resolve(JSON.stringify([Array.from({ length: 384 }, () => 0.05)])),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runEmbeddingsTEIProbe(baseCtx);

    expect(result.pass).toBe(true);
    expect(result.details.embeddingDims).toBe(384);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://example.test/embed");
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1]?.body as string) ?? "{}");
    expect(body.inputs).toBeDefined();
    expect(Array.isArray(body.inputs)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the specs — they should fail**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat/regression-suite/apps/api
pnpm test -- embeddings.spec.ts
```

Expected: FAIL — modules don't exist yet.

- [ ] **Step 3: Implement `embeddings-openai.ts`**

Create `apps/api/src/integrations/probes/embeddings-openai.ts`:

```typescript
/**
 * Embeddings probe — OpenAI shape.
 *
 * POST {apiBaseUrl}{pathOverride ?? "/v1/embeddings"}
 * Body: { model, input: "..." }
 * Response: { data: [{ embedding: number[] }] }
 */
import type { ProbeCtx, ProbeResult } from "./index.js";

interface OpenAIEmbeddingResponse {
  data?: { embedding?: number[] }[];
  usage?: { prompt_tokens: number; total_tokens: number };
}

export async function runEmbeddingsOpenAIProbe({
  apiBaseUrl,
  apiKey,
  model,
  extraHeaders = {},
  pathOverride,
}: ProbeCtx): Promise<ProbeResult> {
  const path = pathOverride ?? "/v1/embeddings";
  const targetUrl = `${apiBaseUrl}${path}`;
  const body = { model, input: "Embed this short test sentence." };

  const t0 = Date.now();
  const res = await fetch(targetUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  const latencyMs = Date.now() - t0;
  const rawText = await res.text();

  let data: OpenAIEmbeddingResponse;
  try {
    data = JSON.parse(rawText) as OpenAIEmbeddingResponse;
  } catch {
    return {
      pass: false,
      latencyMs,
      checks: [
        { name: "HTTP 200 + JSON body", pass: false, info: `status=${res.status}` },
      ],
      details: { error: `status=${res.status} body=${rawText.slice(0, 500)}` },
    };
  }

  const vec = data.data?.[0]?.embedding;
  const dims = Array.isArray(vec) ? vec.length : 0;
  const sample = Array.isArray(vec) ? vec.slice(0, 4) : undefined;

  const checks = [
    { name: "HTTP status 200", pass: res.status === 200, info: String(res.status) },
    { name: "data[0].embedding is array", pass: Array.isArray(vec) },
    { name: "Embedding has > 0 dims", pass: dims > 0, info: `${dims} dims` },
  ];
  const pass = checks.every((c) => c.pass);

  return {
    pass,
    latencyMs,
    checks,
    details: {
      embeddingDims: dims,
      ...(sample ? { embeddingSample: sample } : {}),
    },
  };
}
```

- [ ] **Step 4: Implement `embeddings-tei.ts`**

Create `apps/api/src/integrations/probes/embeddings-tei.ts`:

```typescript
/**
 * Embeddings probe — TEI native shape.
 *
 * POST {apiBaseUrl}{pathOverride ?? "/embed"}
 * Body: { inputs: ["..."] }
 * Response: number[][] (one embedding vector per input).
 */
import type { ProbeCtx, ProbeResult } from "./index.js";

export async function runEmbeddingsTEIProbe({
  apiBaseUrl,
  apiKey,
  model: _model,
  extraHeaders = {},
  pathOverride,
}: ProbeCtx): Promise<ProbeResult> {
  const path = pathOverride ?? "/embed";
  const targetUrl = `${apiBaseUrl}${path}`;
  const body = { inputs: ["Embed this short test sentence."] };

  const t0 = Date.now();
  const res = await fetch(targetUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  const latencyMs = Date.now() - t0;
  const rawText = await res.text();

  let data: unknown;
  try {
    data = JSON.parse(rawText);
  } catch {
    return {
      pass: false,
      latencyMs,
      checks: [
        { name: "HTTP 200 + JSON body", pass: false, info: `status=${res.status}` },
      ],
      details: { error: `status=${res.status} body=${rawText.slice(0, 500)}` },
    };
  }

  const vec = Array.isArray(data) && Array.isArray(data[0]) ? (data[0] as number[]) : null;
  const dims = vec?.length ?? 0;

  const checks = [
    { name: "HTTP status 200", pass: res.status === 200, info: String(res.status) },
    { name: "Top-level is number[][]", pass: vec !== null },
    { name: "Embedding has > 0 dims", pass: dims > 0, info: `${dims} dims` },
  ];
  const pass = checks.every((c) => c.pass);

  return {
    pass,
    latencyMs,
    checks,
    details: {
      embeddingDims: dims,
      ...(vec ? { embeddingSample: vec.slice(0, 4) } : {}),
    },
  };
}
```

- [ ] **Step 5: Register the new probes**

Edit `apps/api/src/integrations/probes/index.ts`. Add imports:

```typescript
import { runEmbeddingsOpenAIProbe } from "./embeddings-openai.js";
import { runEmbeddingsTEIProbe } from "./embeddings-tei.js";

export { runEmbeddingsOpenAIProbe } from "./embeddings-openai.js";
export { runEmbeddingsTEIProbe } from "./embeddings-tei.js";
```

Add to the `PROBES` registry:

```typescript
export const PROBES: Partial<Record<ProbeName, Probe>> = {
  "chat-text": runChatTextProbe,
  "chat-vision": runChatVisionProbe,
  "chat-audio-omni": runChatAudioOmniProbe,
  "embeddings-openai": runEmbeddingsOpenAIProbe,
  "embeddings-tei": runEmbeddingsTEIProbe,
};
```

- [ ] **Step 6: Run unit specs — they should pass**

```bash
pnpm test -- embeddings.spec.ts
pnpm type-check
pnpm lint
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat/regression-suite
git add apps/api/src/integrations/probes/
git commit -m "$(cat <<'EOF'
feat(api/e2e-test): add embeddings-openai + embeddings-tei probes

- embeddings-openai: POST /v1/embeddings, body { model, input },
  expects data[0].embedding (number[]).
- embeddings-tei: POST /embed (HuggingFace TEI native), body
  { inputs: ["..."] }, expects number[][].

Both probes accept ProbeCtx.pathOverride. Returns embeddingDims +
embeddingSample (first 4 components) for UI display.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Rerank probes (TEI + Cohere)

**Goal:** add two rerank probes mirroring the embeddings split.

**Files:**
- Create: `apps/api/src/integrations/probes/rerank-tei.ts`
- Create: `apps/api/src/integrations/probes/rerank-cohere.ts`
- Create: `apps/api/src/integrations/probes/rerank.spec.ts`
- Modify: `apps/api/src/integrations/probes/index.ts`

- [ ] **Step 1: Write failing unit specs**

Create `apps/api/src/integrations/probes/rerank.spec.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runRerankCohereProbe } from "./rerank-cohere.js";
import { runRerankTEIProbe } from "./rerank-tei.js";
import type { ProbeCtx } from "./index.js";

const baseCtx: ProbeCtx = {
  apiBaseUrl: "http://example.test",
  apiKey: "k",
  model: "test-rerank",
  extraHeaders: {},
};

describe("runRerankTEIProbe", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("hits /rerank, body uses TEI shape (texts), returns sorted scores", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify([
            { index: 1, score: 0.9 },
            { index: 0, score: 0.5 },
          ]),
        ),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runRerankTEIProbe(baseCtx);

    expect(result.pass).toBe(true);
    expect(result.details.rerankResults).toHaveLength(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://example.test/rerank");
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1]?.body as string) ?? "{}");
    expect(body.texts).toBeDefined();
    expect(body.documents).toBeUndefined();
  });
});

describe("runRerankCohereProbe", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("hits /v1/rerank, body uses Cohere shape (documents)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            results: [
              { index: 1, relevance_score: 0.92 },
              { index: 0, relevance_score: 0.41 },
            ],
          }),
        ),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runRerankCohereProbe(baseCtx);

    expect(result.pass).toBe(true);
    expect(result.details.rerankResults).toHaveLength(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://example.test/v1/rerank");
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1]?.body as string) ?? "{}");
    expect(body.documents).toBeDefined();
    expect(body.texts).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat/regression-suite/apps/api
pnpm test -- rerank.spec.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `rerank-tei.ts`**

```typescript
/**
 * Rerank probe — TEI native shape.
 *
 * POST {apiBaseUrl}{pathOverride ?? "/rerank"}
 * Body: { query, texts: [...], model? }
 * Response: [{ index, score }] sorted by score desc.
 */
import type { ProbeCtx, ProbeResult } from "./index.js";

const TEST_QUERY = "What is the fastest mammal?";
const TEST_TEXTS = [
  "Cheetahs are the fastest land animals.",
  "The blue whale is the largest animal.",
  "Pizza was invented in Naples.",
];

export async function runRerankTEIProbe({
  apiBaseUrl,
  apiKey,
  model,
  extraHeaders = {},
  pathOverride,
}: ProbeCtx): Promise<ProbeResult> {
  const path = pathOverride ?? "/rerank";
  const targetUrl = `${apiBaseUrl}${path}`;
  const body = { model, query: TEST_QUERY, texts: TEST_TEXTS };

  const t0 = Date.now();
  const res = await fetch(targetUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  const latencyMs = Date.now() - t0;
  const rawText = await res.text();

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return {
      pass: false,
      latencyMs,
      checks: [
        { name: "HTTP 200 + JSON body", pass: false, info: `status=${res.status}` },
      ],
      details: { error: `status=${res.status} body=${rawText.slice(0, 500)}` },
    };
  }

  const arr =
    Array.isArray(parsed) && parsed.every((r) => typeof r === "object" && r !== null)
      ? (parsed as { index?: number; score?: number }[])
      : null;

  const results = arr
    ?.filter((r) => typeof r.index === "number" && typeof r.score === "number")
    .map((r) => ({ index: r.index as number, score: r.score as number }));

  const checks = [
    { name: "HTTP status 200", pass: res.status === 200, info: String(res.status) },
    { name: "Response is array of {index, score}", pass: !!results && results.length > 0 },
    {
      name: "At least one entry per input",
      pass: !!results && results.length === TEST_TEXTS.length,
      info: `${results?.length ?? 0} / ${TEST_TEXTS.length}`,
    },
  ];
  const pass = checks.every((c) => c.pass);

  return {
    pass,
    latencyMs,
    checks,
    details: {
      ...(results ? { rerankResults: results } : {}),
    },
  };
}
```

- [ ] **Step 4: Implement `rerank-cohere.ts`**

```typescript
/**
 * Rerank probe — Cohere / OpenAI-compat shape.
 *
 * POST {apiBaseUrl}{pathOverride ?? "/v1/rerank"}
 * Body: { query, documents: [...], model?, top_n? }
 * Response: { results: [{ index, relevance_score }] }
 */
import type { ProbeCtx, ProbeResult } from "./index.js";

const TEST_QUERY = "What is the fastest mammal?";
const TEST_DOCS = [
  "Cheetahs are the fastest land animals.",
  "The blue whale is the largest animal.",
  "Pizza was invented in Naples.",
];

interface CohereRerankResponse {
  results?: { index?: number; relevance_score?: number }[];
}

export async function runRerankCohereProbe({
  apiBaseUrl,
  apiKey,
  model,
  extraHeaders = {},
  pathOverride,
}: ProbeCtx): Promise<ProbeResult> {
  const path = pathOverride ?? "/v1/rerank";
  const targetUrl = `${apiBaseUrl}${path}`;
  const body = { model, query: TEST_QUERY, documents: TEST_DOCS };

  const t0 = Date.now();
  const res = await fetch(targetUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  const latencyMs = Date.now() - t0;
  const rawText = await res.text();

  let parsed: CohereRerankResponse;
  try {
    parsed = JSON.parse(rawText) as CohereRerankResponse;
  } catch {
    return {
      pass: false,
      latencyMs,
      checks: [
        { name: "HTTP 200 + JSON body", pass: false, info: `status=${res.status}` },
      ],
      details: { error: `status=${res.status} body=${rawText.slice(0, 500)}` },
    };
  }

  const results = parsed.results
    ?.filter((r) => typeof r.index === "number" && typeof r.relevance_score === "number")
    .map((r) => ({ index: r.index as number, score: r.relevance_score as number }));

  const checks = [
    { name: "HTTP status 200", pass: res.status === 200, info: String(res.status) },
    {
      name: "results[] populated",
      pass: !!results && results.length > 0,
      info: `${results?.length ?? 0} entries`,
    },
    {
      name: "At least one entry per input",
      pass: !!results && results.length === TEST_DOCS.length,
      info: `${results?.length ?? 0} / ${TEST_DOCS.length}`,
    },
  ];
  const pass = checks.every((c) => c.pass);

  return {
    pass,
    latencyMs,
    checks,
    details: {
      ...(results ? { rerankResults: results } : {}),
    },
  };
}
```

- [ ] **Step 5: Register both**

In `apps/api/src/integrations/probes/index.ts`:

```typescript
import { runRerankCohereProbe } from "./rerank-cohere.js";
import { runRerankTEIProbe } from "./rerank-tei.js";

export { runRerankTEIProbe } from "./rerank-tei.js";
export { runRerankCohereProbe } from "./rerank-cohere.js";

// In PROBES:
"rerank-tei": runRerankTEIProbe,
"rerank-cohere": runRerankCohereProbe,
```

- [ ] **Step 6: Run, lint, type-check**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat/regression-suite/apps/api
pnpm test -- rerank.spec.ts
pnpm type-check
pnpm lint
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat/regression-suite
git add apps/api/src/integrations/probes/
git commit -m "$(cat <<'EOF'
feat(api/e2e-test): add rerank-tei + rerank-cohere probes

- rerank-tei: POST /rerank, body { query, texts },
  response is array of { index, score }.
- rerank-cohere: POST /v1/rerank, body { query, documents },
  response is { results: [{ index, relevance_score }] }.

Wire-format split because the body field name differs (texts vs
documents) and so do path conventions in the wild. Both probes accept
pathOverride.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: TTS probe (raw-bytes audio response)

**Goal:** add `runTTSProbe` for the OpenAI `/v1/audio/speech` API. Response is raw audio bytes (NOT JSON), validated by content-type + magic bytes (RIFF for WAV, ID3 / FFFB for MP3, OggS for Ogg).

**Files:**
- Create: `apps/api/src/integrations/probes/tts.ts`
- Modify: `apps/api/src/integrations/utils/wav.ts` (add `detectAudioFormat`)
- Create: `apps/api/src/integrations/probes/tts.spec.ts`
- Modify: `apps/api/src/integrations/probes/index.ts`

- [ ] **Step 1: Extend `wav.ts` with a multi-format magic-bytes check**

Read `apps/api/src/integrations/utils/wav.ts`. Append:

```typescript
export type AudioFormat = "wav" | "mp3" | "ogg" | "flac" | "unknown";

/**
 * Magic-bytes sniff. Catches the common formats OpenAI's /v1/audio/speech
 * may emit (wav | mp3 | flac | opus/ogg) without parsing the full container.
 */
export function detectAudioFormat(buf: Buffer | Uint8Array): AudioFormat {
  if (buf.length < 4) return "unknown";
  // WAV: "RIFF...WAVE"
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf.length >= 12 &&
    buf[8] === 0x57 &&
    buf[9] === 0x41 &&
    buf[10] === 0x56 &&
    buf[11] === 0x45
  ) {
    return "wav";
  }
  // MP3: "ID3" tag OR 0xFFFB / 0xFFF3 / 0xFFF2 frame sync
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return "mp3";
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return "mp3";
  // Ogg: "OggS"
  if (buf[0] === 0x4f && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53) return "ogg";
  // FLAC: "fLaC"
  if (buf[0] === 0x66 && buf[1] === 0x4c && buf[2] === 0x61 && buf[3] === 0x43) return "flac";
  return "unknown";
}
```

- [ ] **Step 2: Write failing unit spec**

Create `apps/api/src/integrations/probes/tts.spec.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runTTSProbe } from "./tts.js";
import type { ProbeCtx } from "./index.js";

const baseCtx: ProbeCtx = {
  apiBaseUrl: "http://example.test",
  apiKey: "k",
  model: "tts-1",
  extraHeaders: {},
};

// 12 bytes: "RIFF" + 4 bytes + "WAVE"
const WAV_HEADER = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);

describe("runTTSProbe", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("POSTs /v1/audio/speech with { model, input, voice }, asserts WAV magic + size > 1KB", async () => {
    const audio = Buffer.concat([WAV_HEADER, Buffer.alloc(2048, 0)]);
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "audio/wav" : null) },
      arrayBuffer: () => Promise.resolve(audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength)),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runTTSProbe(baseCtx);

    expect(result.pass).toBe(true);
    const url = fetchMock.mock.calls[0]?.[0];
    expect(url).toBe("http://example.test/v1/audio/speech");
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1]?.body as string) ?? "{}");
    expect(body.model).toBe("tts-1");
    expect(typeof body.input).toBe("string");
    expect(typeof body.voice).toBe("string");
    expect(result.details.audioBytes).toBe(2060);
  });

  it("fails on JSON body (server returned an error envelope, not audio)", async () => {
    const json = Buffer.from('{"error":"unauthorized"}');
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 401,
        ok: false,
        headers: { get: () => "application/json" },
        arrayBuffer: () =>
          Promise.resolve(json.buffer.slice(json.byteOffset, json.byteOffset + json.byteLength)),
      }),
    );

    const result = await runTTSProbe(baseCtx);

    expect(result.pass).toBe(false);
  });

  it("uses pathOverride when supplied", async () => {
    const audio = Buffer.concat([WAV_HEADER, Buffer.alloc(2048, 0)]);
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "audio/wav" : null) },
      arrayBuffer: () =>
        Promise.resolve(audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength)),
    });
    vi.stubGlobal("fetch", fetchMock);

    await runTTSProbe({ ...baseCtx, pathOverride: "/custom/tts" });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://example.test/custom/tts");
  });
});
```

- [ ] **Step 3: Run, expect failure**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat/regression-suite/apps/api
pnpm test -- tts.spec.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement `tts.ts`**

Create `apps/api/src/integrations/probes/tts.ts`:

```typescript
/**
 * TTS probe — pure text-to-speech (OpenAI /v1/audio/speech).
 *
 * Distinct from the chat-audio-omni probe: this targets dedicated TTS
 * services (OpenAI's TTS, gen-studio's Qwen-TTS, ElevenLabs-OpenAI-shim,
 * etc.) that return raw audio bytes — not JSON with base64 audio.
 */
import { detectAudioFormat } from "../utils/wav.js";
import type { ProbeCtx, ProbeResult } from "./index.js";

const TEST_INPUT = "Hello. This is a short test.";
const DEFAULT_VOICE = "alloy"; // OpenAI default voice; most compat shims accept this.

export async function runTTSProbe({
  apiBaseUrl,
  apiKey,
  model,
  extraHeaders = {},
  pathOverride,
}: ProbeCtx): Promise<ProbeResult> {
  const path = pathOverride ?? "/v1/audio/speech";
  const targetUrl = `${apiBaseUrl}${path}`;
  const body = { model, input: TEST_INPUT, voice: DEFAULT_VOICE };

  const t0 = Date.now();
  const res = await fetch(targetUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  const latencyMs = Date.now() - t0;

  const contentType = (res.headers.get("Content-Type") ?? "").toLowerCase();
  const arrayBuf = await res.arrayBuffer();
  const buf = Buffer.from(arrayBuf);
  const bytes = buf.length;
  const format = detectAudioFormat(buf);

  const checks = [
    { name: "HTTP status 200", pass: res.status === 200, info: String(res.status) },
    {
      name: "Content-Type is audio/*",
      pass: contentType.startsWith("audio/"),
      info: contentType || "(none)",
    },
    {
      name: "Audio payload > 1 KB",
      pass: bytes > 1024,
      info: `${bytes} bytes`,
    },
    {
      name: "Recognized audio format (wav/mp3/ogg/flac)",
      pass: format !== "unknown",
      info: format,
    },
  ];
  const pass = checks.every((c) => c.pass);

  // Only surface base64 audio for WAV (the FE <audio> element can play it
  // directly with data:audio/wav). For MP3/OGG/FLAC we still pass the
  // probe but skip the preview to avoid confusion when the FE expects WAV.
  const audioB64 = format === "wav" ? buf.toString("base64") : undefined;

  return {
    pass,
    latencyMs,
    checks,
    details: {
      audioBytes: bytes,
      ...(audioB64 ? { audioB64 } : {}),
    },
  };
}
```

- [ ] **Step 5: Register the probe**

In `apps/api/src/integrations/probes/index.ts`:

```typescript
import { runTTSProbe } from "./tts.js";
export { runTTSProbe } from "./tts.js";

// In PROBES:
tts: runTTSProbe,
```

- [ ] **Step 6: Run all api tests + type-check + lint**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat/regression-suite/apps/api
pnpm test
pnpm type-check
pnpm lint
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat/regression-suite
git add apps/api/src/integrations/probes/tts.ts apps/api/src/integrations/probes/tts.spec.ts apps/api/src/integrations/probes/index.ts apps/api/src/integrations/utils/wav.ts
git commit -m "$(cat <<'EOF'
feat(api/e2e-test): add TTS probe targeting /v1/audio/speech

Distinct from chat-audio-omni (which exercises chat/completions with
modalities=['audio']): this hits the OpenAI TTS endpoint, body is
{ model, input, voice }, response is raw audio bytes.

Validates: HTTP 200, Content-Type audio/*, payload > 1 KB, magic bytes
match WAV / MP3 / Ogg / FLAC. Surfaces audioB64 for WAV so the FE can
preview without round-tripping.

Adds detectAudioFormat() to integrations/utils/wav.ts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: ASR probe + WAV fixture

**Goal:** add `runASRProbe` for `/v1/audio/transcriptions` (multipart/form-data upload). Ships a tiny synthetic 1-second silent WAV fixture committed to the repo so the probe is reproducible without network fixtures.

**Files:**
- Create: `apps/api/src/integrations/probes/fixtures/sample-1s-silence.wav` (binary, ~88 bytes)
- Create: `apps/api/src/integrations/probes/asr.ts`
- Create: `apps/api/src/integrations/probes/asr.spec.ts`
- Modify: `apps/api/src/integrations/probes/index.ts`

- [ ] **Step 1: Generate the WAV fixture**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat/regression-suite
mkdir -p apps/api/src/integrations/probes/fixtures
node -e "
const fs = require('node:fs');
// 1s of mono PCM16 silence at 8kHz = 16000 bytes data + 44-byte WAV header.
const sampleRate = 8000;
const numSamples = sampleRate * 1; // 1 second
const dataSize = numSamples * 2; // 16-bit
const buf = Buffer.alloc(44 + dataSize);
// RIFF header
buf.write('RIFF', 0);
buf.writeUInt32LE(36 + dataSize, 4);
buf.write('WAVE', 8);
// fmt chunk
buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20);  // PCM
buf.writeUInt16LE(1, 22);  // mono
buf.writeUInt32LE(sampleRate, 24);
buf.writeUInt32LE(sampleRate * 2, 28);
buf.writeUInt16LE(2, 32);
buf.writeUInt16LE(16, 34);
// data chunk
buf.write('data', 36);
buf.writeUInt32LE(dataSize, 40);
// silence already zero-filled
fs.writeFileSync('apps/api/src/integrations/probes/fixtures/sample-1s-silence.wav', buf);
console.log('wrote', buf.length, 'bytes');
"
ls -l apps/api/src/integrations/probes/fixtures/sample-1s-silence.wav
```

Expected: file is 16044 bytes. Verify with `file` if installed:

```bash
file apps/api/src/integrations/probes/fixtures/sample-1s-silence.wav
# Expected: ... WAVE audio, Microsoft PCM, 16 bit, mono 8000 Hz
```

- [ ] **Step 2: Write failing unit spec**

Create `apps/api/src/integrations/probes/asr.spec.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runASRProbe } from "./asr.js";
import type { ProbeCtx } from "./index.js";

const baseCtx: ProbeCtx = {
  apiBaseUrl: "http://example.test",
  apiKey: "k",
  model: "whisper-1",
  extraHeaders: {},
};

describe("runASRProbe", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("POSTs multipart to /v1/audio/transcriptions, asserts text in JSON response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ text: "(silence)" })),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runASRProbe(baseCtx);

    expect(result.pass).toBe(true);
    const url = fetchMock.mock.calls[0]?.[0];
    expect(url).toBe("http://example.test/v1/audio/transcriptions");
    // Multipart body — instance of FormData
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
  });

  it("uses pathOverride", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ text: "x" })),
      }),
    );

    await runASRProbe({ ...baseCtx, pathOverride: "/custom/asr" });

    expect((vi.mocked(fetch).mock.calls[0] as unknown[])[0]).toBe("http://example.test/custom/asr");
  });

  it("fails when response has no `text` field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        text: () => Promise.resolve(JSON.stringify({})),
      }),
    );

    const result = await runASRProbe(baseCtx);

    expect(result.pass).toBe(false);
  });
});
```

- [ ] **Step 3: Run, expect failure**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat/regression-suite/apps/api
pnpm test -- asr.spec.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement `asr.ts`**

```typescript
/**
 * ASR probe — speech-to-text via the OpenAI /v1/audio/transcriptions endpoint.
 *
 * Posts a tiny built-in 1-second silent WAV (committed at
 * fixtures/sample-1s-silence.wav) so the probe is hermetic — no network
 * fixture, no AudioContext synthesis at runtime. The expectation is just
 * that the server returns a JSON body with a `text` field; the value
 * itself may be empty for silence (which is fine — we're smoke-testing
 * pipeline reachability, not transcription accuracy).
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import type { ProbeCtx, ProbeResult } from "./index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, "fixtures", "sample-1s-silence.wav");

interface TranscriptionResponse {
  text?: string;
}

export async function runASRProbe({
  apiBaseUrl,
  apiKey,
  model,
  extraHeaders = {},
  pathOverride,
}: ProbeCtx): Promise<ProbeResult> {
  const path = pathOverride ?? "/v1/audio/transcriptions";
  const targetUrl = `${apiBaseUrl}${path}`;

  const wavBytes = await readFile(FIXTURE_PATH);
  const form = new FormData();
  form.append(
    "file",
    new Blob([wavBytes.buffer.slice(wavBytes.byteOffset, wavBytes.byteOffset + wavBytes.byteLength)], { type: "audio/wav" }),
    "sample-1s-silence.wav",
  );
  form.append("model", model);

  const t0 = Date.now();
  const res = await fetch(targetUrl, {
    method: "POST",
    headers: {
      // Don't set Content-Type — let fetch derive the multipart boundary.
      Authorization: `Bearer ${apiKey}`,
      ...extraHeaders,
    },
    body: form,
  });
  const latencyMs = Date.now() - t0;
  const rawText = await res.text();

  let data: TranscriptionResponse;
  try {
    data = JSON.parse(rawText) as TranscriptionResponse;
  } catch {
    return {
      pass: false,
      latencyMs,
      checks: [
        { name: "HTTP 200 + JSON body", pass: false, info: `status=${res.status}` },
      ],
      details: { error: `status=${res.status} body=${rawText.slice(0, 500)}` },
    };
  }

  const checks = [
    { name: "HTTP status 200", pass: res.status === 200, info: String(res.status) },
    { name: "Response has `text` field", pass: typeof data.text === "string" },
  ];
  const pass = checks.every((c) => c.pass);

  return {
    pass,
    latencyMs,
    checks,
    details: {
      ...(data.text !== undefined ? { textReply: data.text } : {}),
    },
  };
}
```

- [ ] **Step 5: Register the probe + tell vitest to load the fixture**

Append to `apps/api/src/integrations/probes/index.ts`:

```typescript
import { runASRProbe } from "./asr.js";
export { runASRProbe } from "./asr.js";

// In PROBES:
asr: runASRProbe,
```

Verify the fixture is bundled with the source — vitest@2 with SWC reads from disk at runtime so no special build step is needed. The `readFile` call uses `import.meta.url` to resolve the path next to the module.

- [ ] **Step 6: Run + type-check + lint**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat/regression-suite/apps/api
pnpm test -- asr.spec.ts
pnpm type-check
pnpm lint
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat/regression-suite
git add apps/api/src/integrations/probes/asr.ts apps/api/src/integrations/probes/asr.spec.ts apps/api/src/integrations/probes/index.ts apps/api/src/integrations/probes/fixtures/sample-1s-silence.wav
git commit -m "$(cat <<'EOF'
feat(api/e2e-test): add ASR probe targeting /v1/audio/transcriptions

Posts a committed 16 KB synthetic 1-second silent WAV fixture as
multipart/form-data and asserts the response carries a `text` field
(value may be empty — we smoke-test pipeline reachability, not
transcription accuracy).

Fixture committed at fixtures/sample-1s-silence.wav so the probe is
hermetic with no network or runtime synthesis. Path override works.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: image-gen probe

**Goal:** add `runImageGenProbe` for `/v1/images/generations`. Asserts response carries either `data[0].url` OR `data[0].b64_json`.

**Files:**
- Create: `apps/api/src/integrations/probes/image-gen.ts`
- Create: `apps/api/src/integrations/probes/image-gen.spec.ts`
- Modify: `apps/api/src/integrations/probes/index.ts`

- [ ] **Step 1: Write failing unit spec**

Create `apps/api/src/integrations/probes/image-gen.spec.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runImageGenProbe } from "./image-gen.js";
import type { ProbeCtx } from "./index.js";

const baseCtx: ProbeCtx = {
  apiBaseUrl: "http://example.test",
  apiKey: "k",
  model: "dall-e-3",
  extraHeaders: {},
};

describe("runImageGenProbe", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("passes when response has data[0].url", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      text: () =>
        Promise.resolve(JSON.stringify({ data: [{ url: "https://example.test/img.png" }] })),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runImageGenProbe(baseCtx);

    expect(result.pass).toBe(true);
    expect(result.details.imageGenUrl).toBe("https://example.test/img.png");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://example.test/v1/images/generations");
  });

  it("passes when response has data[0].b64_json", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ data: [{ b64_json: "iVBORw0KGgo=" }] })),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runImageGenProbe(baseCtx);

    expect(result.pass).toBe(true);
    expect(result.details.imageGenB64).toBe("iVBORw0KGgo=");
  });

  it("fails when neither url nor b64_json present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ data: [{}] })),
      }),
    );

    const result = await runImageGenProbe(baseCtx);

    expect(result.pass).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat/regression-suite/apps/api
pnpm test -- image-gen.spec.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `image-gen.ts`**

```typescript
/**
 * Image generation probe — OpenAI /v1/images/generations.
 *
 * Body: { model, prompt, size?, n?, response_format? }
 * Response: { data: [{ url? } | { b64_json? }] }
 *
 * Either url or b64_json is sufficient (depends on response_format).
 */
import type { ProbeCtx, ProbeResult } from "./index.js";

interface ImageGenResponse {
  data?: { url?: string; b64_json?: string }[];
}

export async function runImageGenProbe({
  apiBaseUrl,
  apiKey,
  model,
  extraHeaders = {},
  pathOverride,
}: ProbeCtx): Promise<ProbeResult> {
  const path = pathOverride ?? "/v1/images/generations";
  const targetUrl = `${apiBaseUrl}${path}`;
  const body = {
    model,
    prompt: "A small red apple on a white background.",
    n: 1,
    size: "512x512",
  };

  const t0 = Date.now();
  const res = await fetch(targetUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  const latencyMs = Date.now() - t0;
  const rawText = await res.text();

  let data: ImageGenResponse;
  try {
    data = JSON.parse(rawText) as ImageGenResponse;
  } catch {
    return {
      pass: false,
      latencyMs,
      checks: [
        { name: "HTTP 200 + JSON body", pass: false, info: `status=${res.status}` },
      ],
      details: { error: `status=${res.status} body=${rawText.slice(0, 500)}` },
    };
  }

  const first = data.data?.[0];
  const url = first?.url;
  const b64 = first?.b64_json;
  const hasArtifact = typeof url === "string" || typeof b64 === "string";

  const checks = [
    { name: "HTTP status 200", pass: res.status === 200, info: String(res.status) },
    { name: "Response has data[0].url or data[0].b64_json", pass: hasArtifact },
  ];
  const pass = checks.every((c) => c.pass);

  return {
    pass,
    latencyMs,
    checks,
    details: {
      ...(url ? { imageGenUrl: url } : {}),
      ...(b64 ? { imageGenB64: b64 } : {}),
    },
  };
}
```

- [ ] **Step 4: Register**

```typescript
// apps/api/src/integrations/probes/index.ts
import { runImageGenProbe } from "./image-gen.js";
export { runImageGenProbe } from "./image-gen.js";

// In PROBES:
"image-gen": runImageGenProbe,
```

- [ ] **Step 5: Run + type-check + lint + commit**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat/regression-suite/apps/api
pnpm test -- image-gen.spec.ts
pnpm type-check && pnpm lint
```

Expected: green.

```bash
cd /Users/fangyong/vllm/modeldoctor/feat/regression-suite
git add apps/api/src/integrations/probes/image-gen.ts apps/api/src/integrations/probes/image-gen.spec.ts apps/api/src/integrations/probes/index.ts
git commit -m "$(cat <<'EOF'
feat(api/e2e-test): add image-gen probe targeting /v1/images/generations

Body: { model, prompt, n, size }. Passes when data[0].url OR
data[0].b64_json is present (response_format dependent). Threads
pathOverride from ProbeCtx like every other new probe.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Narrow `PROBES` registry from `Partial<>` to complete `Record<>`

**Goal:** now that all 10 probes exist, change the registry's type so `PROBES[probeName]` is non-undefined. This catches future probe additions where someone forgets to register.

**Files:**
- Modify: `apps/api/src/integrations/probes/index.ts`
- Modify: `apps/api/src/modules/e2e-test/e2e-test.service.ts` (drop the not-implemented branch added in Task 2)

- [ ] **Step 1: Switch the registry to a non-Partial Record**

Open `apps/api/src/integrations/probes/index.ts`. Change the registry type from `Partial<Record<ProbeName, Probe>>` back to `Record<ProbeName, Probe>` and verify all 10 keys are present:

```typescript
export const PROBES: Record<ProbeName, Probe> = {
  "chat-text": runChatTextProbe,
  "chat-vision": runChatVisionProbe,
  "chat-audio-omni": runChatAudioOmniProbe,
  tts: runTTSProbe,
  asr: runASRProbe,
  "embeddings-openai": runEmbeddingsOpenAIProbe,
  "embeddings-tei": runEmbeddingsTEIProbe,
  "rerank-tei": runRerankTEIProbe,
  "rerank-cohere": runRerankCohereProbe,
  "image-gen": runImageGenProbe,
};
```

- [ ] **Step 2: Drop the not-implemented safety net in the service**

In `apps/api/src/modules/e2e-test/e2e-test.service.ts`, remove the `if (!probe) { ... results.push({ ... probe-not-implemented ... }) ... continue; }` branch added in Task 2. With the registry now exhaustive, this check is dead code.

- [ ] **Step 3: Run + type-check + lint**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat/regression-suite/apps/api
pnpm test
pnpm type-check && pnpm lint
```

Expected: all green. Type-check fails loudly if any probe is missing from the registry.

- [ ] **Step 4: Commit**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat/regression-suite
git add apps/api/src/integrations/probes/index.ts apps/api/src/modules/e2e-test/e2e-test.service.ts
git commit -m "$(cat <<'EOF'
refactor(api/e2e-test): tighten PROBES to Record<ProbeName, Probe>

All 10 probes are wired now; drop the Partial<> escape hatch + the
not-implemented runtime branch. TS will catch missing entries on the
next probe addition.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Web store — selectedCategory, pathOverrides, persistence v2

**Goal:** the web store gains `selectedCategory: ProbeCategory | null` and `pathOverrides: Partial<Record<ProbeName, string>>`, and bumps its persisted version from `v1` → `v2` so old persisted state (with the legacy probe name keys) is dropped on first load.

**Files:**
- Modify: `apps/web/src/features/e2e-smoke/store.ts`
- Modify: `apps/web/src/features/e2e-smoke/store.test.ts` (if any references legacy names)
- Modify: `apps/web/src/features/e2e-smoke/types.ts` (re-export new types)

- [ ] **Step 1: Update `types.ts` re-exports**

Replace the contents of `apps/web/src/features/e2e-smoke/types.ts` with:

```typescript
export type {
  ProbeName,
  ProbeCategory,
  ProbeCheck,
  ProbeResult,
  E2ETestResponse,
} from "@modeldoctor/contracts";
export { PROBES_BY_CATEGORY, PROBE_DEFAULT_PATHS } from "@modeldoctor/contracts";
```

- [ ] **Step 2: Replace the store**

Replace the contents of `apps/web/src/features/e2e-smoke/store.ts` with:

```typescript
import { type EndpointValues, emptyEndpointValues } from "@/types/connection";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ProbeCategory, ProbeName, ProbeResult } from "./types";

interface E2EState {
  selectedConnectionId: string | null;
  manualEndpoint: EndpointValues;
  selectedCategory: ProbeCategory;
  /** Per-probe path override; missing keys → use the contract's default. */
  pathOverrides: Partial<Record<ProbeName, string>>;
  results: Partial<Record<ProbeName, ProbeResult | null>>;
  running: Partial<Record<ProbeName, boolean>>;
  setSelected: (id: string | null) => void;
  setManualEndpoint: (values: EndpointValues) => void;
  setSelectedCategory: (cat: ProbeCategory) => void;
  setPathOverride: (probe: ProbeName, path: string) => void;
  clearPathOverride: (probe: ProbeName) => void;
  setRunning: (name: ProbeName, running: boolean) => void;
  setResult: (name: ProbeName, r: ProbeResult | null) => void;
  /** Clear probe outputs only (results + running). Preserves endpoint, category, overrides. */
  resetResults: () => void;
  /** Full reset to factory defaults. */
  reset: () => void;
}

const INITIAL = {
  selectedConnectionId: null as string | null,
  manualEndpoint: emptyEndpointValues,
  selectedCategory: "chat" as ProbeCategory,
  pathOverrides: {} as Partial<Record<ProbeName, string>>,
  results: {} as Partial<Record<ProbeName, ProbeResult | null>>,
  running: {} as Partial<Record<ProbeName, boolean>>,
};

export const useE2EStore = create<E2EState>()(
  persist(
    (set) => ({
      ...INITIAL,
      setSelected: (id) => set({ selectedConnectionId: id }),
      setManualEndpoint: (values) => set({ manualEndpoint: values }),
      setSelectedCategory: (cat) => set({ selectedCategory: cat }),
      setPathOverride: (probe, path) =>
        set((s) => ({ pathOverrides: { ...s.pathOverrides, [probe]: path } })),
      clearPathOverride: (probe) =>
        set((s) => {
          const next = { ...s.pathOverrides };
          delete next[probe];
          return { pathOverrides: next };
        }),
      setRunning: (name, running) => set((s) => ({ running: { ...s.running, [name]: running } })),
      setResult: (name, r) => set((s) => ({ results: { ...s.results, [name]: r } })),
      resetResults: () => set({ results: {}, running: {} }),
      reset: () => set(INITIAL),
    }),
    {
      // v2 bump: probe naming changed (text → chat-text, etc.). Old v1 state
      // had no migration path worth preserving — drop and reseed.
      name: "md.e2e.v2",
      version: 2,
      partialize: (s) => ({
        selectedConnectionId: s.selectedConnectionId,
        manualEndpoint: s.manualEndpoint,
        selectedCategory: s.selectedCategory,
        pathOverrides: s.pathOverrides,
      }),
    },
  ),
);
```

- [ ] **Step 3: Update `store.test.ts` — replace legacy probe names**

Open `apps/web/src/features/e2e-smoke/store.test.ts`. Anywhere it references `"text"`, `"image"`, `"audio"` as `ProbeName`, replace with `"chat-text"`, `"chat-vision"`, `"chat-audio-omni"`. Anywhere it asserts on the store shape (`results.text`, `running.image`), update keys accordingly.

If the test file asserts on `results: Record<ProbeName, ProbeResult | null>` exhaustivity, the new `Partial<>` shape will break it — update the assertion to be partial too (e.g., `expect(slice.results["chat-text"]).toBeNull()` instead of `toEqual(INITIAL_RESULTS)`).

- [ ] **Step 4: Run web tests + type-check + lint**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat/regression-suite
pnpm -F @modeldoctor/web test -- store.test.ts
pnpm -F @modeldoctor/web type-check
pnpm -F @modeldoctor/web lint
```

Expected: store test green; type-check still RED on `E2ESmokePage.tsx` and `ProbeCard.tsx` until Task 10/11 land.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/e2e-smoke/store.ts apps/web/src/features/e2e-smoke/store.test.ts apps/web/src/features/e2e-smoke/types.ts
git commit -m "$(cat <<'EOF'
refactor(web/e2e-smoke): store gains selectedCategory + pathOverrides; persist v2

Persisted shape changed (v1 → v2) because probe names changed in the
contract (text/image/audio → chat-text/chat-vision/chat-audio-omni).
Drop old persisted state; seed afresh.

Adds setSelectedCategory / setPathOverride / clearPathOverride.
Results + running maps become Partial<Record<ProbeName, ...>> since the
sparse 10-key map costs nothing extra and skips initial-allocation
churn.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Web UI — category dropdown + restructured ProbeCard

**Goal:** rebuild `E2ESmokePage` so a category dropdown selects which probe cards render. Each `ProbeCard` adds an editable path field below the title showing the effective default (greyed) or override (filled).

**Files:**
- Modify: `apps/web/src/features/e2e-smoke/E2ESmokePage.tsx`
- Modify: `apps/web/src/features/e2e-smoke/ProbeCard.tsx`
- Modify: `apps/web/src/features/e2e-smoke/E2ESmokePage.test.tsx` (update for new structure)

- [ ] **Step 1: Update `ProbeCard.tsx` to show + edit the effective path**

Replace the file with:

```typescript
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Check, RotateCcw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ProbeName, ProbeResult } from "./types";
import { PROBE_DEFAULT_PATHS } from "./types";

interface Props {
  name: ProbeName;
  result: ProbeResult | null;
  running: boolean;
  /** Effective path = override if set, else default. */
  pathOverride: string | undefined;
  onPathChange: (next: string) => void;
  onPathReset: () => void;
  onRun: () => void;
  disabledReason?: string;
}

export function ProbeCard({
  name,
  result,
  running,
  pathOverride,
  onPathChange,
  onPathReset,
  onRun,
  disabledReason,
}: Props) {
  const { t } = useTranslation("e2e");
  const { t: tc } = useTranslation("common");
  const variant: "default" | "warning" | "success" | "destructive" = running
    ? "warning"
    : result === null
      ? "default"
      : result.pass
        ? "success"
        : "destructive";
  const status = running
    ? tc("status.running")
    : result === null
      ? tc("status.idle")
      : result.pass
        ? tc("status.pass")
        : tc("status.fail");

  const defaultPath = PROBE_DEFAULT_PATHS[name];
  const effectivePath = pathOverride ?? defaultPath;
  const isOverridden = pathOverride !== undefined && pathOverride !== defaultPath;

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-border bg-card p-4",
        result?.pass && "border-l-2 border-l-success",
        result && !result.pass && "border-l-2 border-l-destructive",
        running && "border-l-2 border-l-warning",
      )}
    >
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">{t(`probes.${name}.title`)}</h3>
          <p className="font-mono text-[10px] text-muted-foreground">{t(`probes.${name}.subtitle`)}</p>
        </div>
        <Badge variant={variant}>{status}</Badge>
      </div>

      <div className="flex items-center gap-1">
        <Input
          value={effectivePath}
          onChange={(e) => onPathChange(e.target.value)}
          className={cn(
            "h-7 font-mono text-[11px]",
            !isOverridden && "text-muted-foreground",
          )}
          placeholder={defaultPath}
        />
        {isOverridden ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onPathReset}
            title={t("path.resetToDefault")}
          >
            <RotateCcw className="h-3 w-3" />
          </Button>
        ) : null}
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={onRun}
        disabled={running || !!disabledReason}
        title={disabledReason}
      >
        {tc("actions.run")}
      </Button>

      {result ? (
        <div className="space-y-2 text-xs">
          <p className="text-muted-foreground">
            {t("meta.latency", { ms: result.latencyMs ?? "—" })}
          </p>
          <ul className="space-y-1 font-mono">
            {result.checks.map((c) => (
              <li key={c.name} className="flex items-start gap-1">
                {c.pass ? (
                  <Check className="mt-0.5 h-3 w-3 text-success" />
                ) : (
                  <X className="mt-0.5 h-3 w-3 text-destructive" />
                )}
                <span>{c.name}</span>
                {c.info ? <span className="text-muted-foreground">({c.info})</span> : null}
              </li>
            ))}
          </ul>
          {result.details.content ? (
            <div className="rounded-md bg-muted/40 px-2 py-1 text-foreground">
              {result.details.content}
            </div>
          ) : null}
          {result.details.imagePreviewB64 ? (
            <img
              alt="probe input"
              src={`data:${result.details.imageMime ?? "image/png"};base64,${result.details.imagePreviewB64}`}
              className="max-w-[120px] rounded-md border border-border"
            />
          ) : null}
          {result.details.audioB64 ? (
            // biome-ignore lint/a11y/useMediaCaption: audio probe output has no transcript
            <audio
              controls
              src={`data:audio/wav;base64,${result.details.audioB64}`}
              className="w-full"
            />
          ) : null}
          {result.details.imageGenUrl ? (
            <img
              alt="generated"
              src={result.details.imageGenUrl}
              className="max-w-[200px] rounded-md border border-border"
            />
          ) : null}
          {result.details.imageGenB64 ? (
            <img
              alt="generated"
              src={`data:image/png;base64,${result.details.imageGenB64}`}
              className="max-w-[200px] rounded-md border border-border"
            />
          ) : null}
          {result.details.embeddingDims !== undefined ? (
            <div className="rounded-md bg-muted/40 px-2 py-1 font-mono text-[11px]">
              {t("meta.embeddingDims", { dims: result.details.embeddingDims })}
              {result.details.embeddingSample
                ? `: [${result.details.embeddingSample.map((n) => n.toFixed(3)).join(", ")}, …]`
                : ""}
            </div>
          ) : null}
          {result.details.rerankResults ? (
            <ol className="rounded-md bg-muted/40 px-2 py-1 font-mono text-[11px]">
              {result.details.rerankResults.map((r) => (
                <li key={r.index}>
                  #{r.index} → {r.score.toFixed(3)}
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Update `E2ESmokePage.tsx`**

Replace the file with:

```typescript
import { PageHeader } from "@/components/common/page-header";
import { EndpointPicker } from "@/components/connection/EndpointPicker";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError, api } from "@/lib/api-client";
import { useTranslation } from "react-i18next";
import { ProbeCard } from "./ProbeCard";
import { useE2EStore } from "./store";
import type { E2ETestResponse, ProbeCategory, ProbeName } from "./types";
import { PROBES_BY_CATEGORY } from "./types";

const CATEGORIES: ProbeCategory[] = ["chat", "audio", "embeddings", "rerank", "image"];

export function E2ESmokePage() {
  const { t } = useTranslation("e2e");
  const { t: tc } = useTranslation("common");
  const slice = useE2EStore();
  const endpoint = slice.manualEndpoint;
  const probesInCategory = PROBES_BY_CATEGORY[slice.selectedCategory];

  const canRun =
    endpoint.apiBaseUrl.trim().length > 0 &&
    endpoint.apiKey.trim().length > 0 &&
    endpoint.model.trim().length > 0;
  const disabledReason = canRun ? undefined : tc("errors.required");

  const runProbes = async (probes: ProbeName[]) => {
    if (!canRun) return;
    for (const p of probes) slice.setRunning(p, true);
    try {
      const data = await api.post<E2ETestResponse>("/api/e2e-test", {
        apiBaseUrl: endpoint.apiBaseUrl,
        apiKey: endpoint.apiKey,
        model: endpoint.model,
        customHeaders: endpoint.customHeaders,
        probes,
        // Only send overrides for probes the user actually customized.
        pathOverride: Object.fromEntries(
          probes
            .filter((p) => slice.pathOverrides[p] !== undefined)
            .map((p) => [p, slice.pathOverrides[p]]),
        ),
      });
      if (!data.success) {
        for (const p of probes) {
          slice.setResult(p, {
            pass: false,
            latencyMs: null,
            checks: [{ name: "request", pass: false, info: data.error }],
            details: { error: data.error ?? "unknown" },
          });
        }
        return;
      }
      for (const r of data.results) {
        slice.setResult(r.probe, r);
      }
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "network";
      for (const p of probes) {
        slice.setResult(p, {
          pass: false,
          latencyMs: null,
          checks: [{ name: "request", pass: false, info: msg }],
          details: { error: msg },
        });
      }
    } finally {
      for (const p of probes) slice.setRunning(p, false);
    }
  };

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="space-y-6 px-8 py-6">
        <EndpointPicker
          endpoint={endpoint}
          selectedConnectionId={slice.selectedConnectionId}
          onSelect={(id) => {
            slice.setSelected(id);
            slice.resetResults();
          }}
          onEndpointChange={slice.setManualEndpoint}
        />

        <div className="flex items-center gap-3">
          <label className="text-sm font-medium">{t("category.label")}</label>
          <Select
            value={slice.selectedCategory}
            onValueChange={(v) => slice.setSelectedCategory(v as ProbeCategory)}
          >
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {t(`category.options.${c}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {probesInCategory.map((p) => (
            <ProbeCard
              key={p}
              name={p}
              result={slice.results[p] ?? null}
              running={!!slice.running[p]}
              pathOverride={slice.pathOverrides[p]}
              onPathChange={(next) => slice.setPathOverride(p, next)}
              onPathReset={() => slice.clearPathOverride(p)}
              onRun={() => runProbes([p])}
              disabledReason={disabledReason}
            />
          ))}
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => runProbes([...probesInCategory])}
            disabled={!canRun}
            title={disabledReason}
          >
            {t("actions.runCategory", { category: t(`category.options.${slice.selectedCategory}`) })}
          </Button>
          <Button variant="ghost" onClick={() => slice.resetResults()}>
            {t("actions.clear")}
          </Button>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 3: Update `E2ESmokePage.test.tsx`**

Find every reference to old probe names (`"text" | "image" | "audio"`) and update to the new names. The page now expects `pathOverrides` in the request body when overrides are set; tests that mock `api.post` should still work because they don't assert on the body shape unless explicitly so.

If a test asserts on rendering "all 3 probe cards", update it to assert on the `chat` category's cards (`"chat-text"` and `"chat-vision"` — 2 cards).

- [ ] **Step 4: Run web tests + type-check + lint**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat/regression-suite
pnpm -F @modeldoctor/web test
pnpm -F @modeldoctor/web type-check
pnpm -F @modeldoctor/web lint
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/e2e-smoke/
git commit -m "$(cat <<'EOF'
feat(web/e2e-smoke): category dropdown + per-probe editable path

Replaces the fixed 3-card layout with a category-driven view:
- 5 categories (chat / audio / embeddings / rerank / image)
- Each category renders its constituent probes from PROBES_BY_CATEGORY
- Each ProbeCard exposes the effective path as an editable field; a
  reset-to-default icon appears when overridden.

Run-all becomes "run this category". Path overrides only ride along on
the request when the user actually edits them.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: i18n — translations for new categories + probes

**Goal:** add labels for 5 categories + 10 probe titles + new info strings (`path.resetToDefault`, `meta.embeddingDims`, `actions.runCategory`, etc.). Both `en` and `zh` locales.

**Files:**
- Modify: `apps/web/src/locales/en/e2e.json`
- Modify: `apps/web/src/locales/zh/e2e.json`

- [ ] **Step 1: Read existing files to keep style consistent**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat/regression-suite
cat apps/web/src/locales/en/e2e.json
cat apps/web/src/locales/zh/e2e.json
```

Note the existing top-level keys — `title`, `subtitle`, `actions.*`, `meta.*`, `probes.{text,image,audio}.*`. The new structure adds: `category.label`, `category.options.{chat,audio,embeddings,rerank,image}`, `actions.runCategory`, `path.resetToDefault`, `meta.embeddingDims`, and replaces the three legacy probe entries with ten new ones.

- [ ] **Step 2: Edit `en/e2e.json`**

Replace the contents with:

```json
{
  "title": "E2E Smoke",
  "subtitle": "Functional probes covering text / image / audio / embeddings / rerank / image-gen pipelines.",
  "category": {
    "label": "Category",
    "options": {
      "chat": "Chat",
      "audio": "Audio",
      "embeddings": "Embeddings",
      "rerank": "Rerank",
      "image": "Image gen"
    }
  },
  "path": {
    "resetToDefault": "Reset to default"
  },
  "actions": {
    "run": "Run",
    "runCategory": "Run {{category}}",
    "clear": "Clear results"
  },
  "meta": {
    "latency": "Latency: {{ms}} ms",
    "embeddingDims": "{{dims}} dims"
  },
  "probes": {
    "chat-text": {
      "title": "Text",
      "subtitle": "thinker (text → text)"
    },
    "chat-vision": {
      "title": "Vision",
      "subtitle": "vision encoder → thinker"
    },
    "chat-audio-omni": {
      "title": "Omni audio",
      "subtitle": "thinker → talker → code2wav"
    },
    "tts": {
      "title": "TTS",
      "subtitle": "text → speech (raw audio bytes)"
    },
    "asr": {
      "title": "ASR",
      "subtitle": "speech → text"
    },
    "embeddings-openai": {
      "title": "Embeddings (OpenAI)",
      "subtitle": "POST /v1/embeddings, body { input }"
    },
    "embeddings-tei": {
      "title": "Embeddings (TEI)",
      "subtitle": "POST /embed, body { inputs[] }"
    },
    "rerank-tei": {
      "title": "Rerank (TEI)",
      "subtitle": "POST /rerank, body { texts[] }"
    },
    "rerank-cohere": {
      "title": "Rerank (Cohere)",
      "subtitle": "POST /v1/rerank, body { documents[] }"
    },
    "image-gen": {
      "title": "Image generation",
      "subtitle": "text → image (URL or b64_json)"
    }
  }
}
```

- [ ] **Step 3: Edit `zh/e2e.json` with the same keys, Chinese values**

```json
{
  "title": "E2E Smoke",
  "subtitle": "覆盖 文本 / 图像 / 语音 / 嵌入 / 重排序 / 图像生成 路径的功能性 probe。",
  "category": {
    "label": "分类",
    "options": {
      "chat": "对话",
      "audio": "语音",
      "embeddings": "嵌入",
      "rerank": "重排序",
      "image": "生图"
    }
  },
  "path": {
    "resetToDefault": "恢复默认"
  },
  "actions": {
    "run": "运行",
    "runCategory": "运行「{{category}}」",
    "clear": "清空结果"
  },
  "meta": {
    "latency": "耗时:{{ms}} ms",
    "embeddingDims": "{{dims}} 维"
  },
  "probes": {
    "chat-text": {
      "title": "文本",
      "subtitle": "thinker (text → text)"
    },
    "chat-vision": {
      "title": "图像 + 文本",
      "subtitle": "vision encoder → thinker"
    },
    "chat-audio-omni": {
      "title": "Omni 语音",
      "subtitle": "thinker → talker → code2wav"
    },
    "tts": {
      "title": "TTS",
      "subtitle": "文本 → 语音(裸 audio bytes)"
    },
    "asr": {
      "title": "ASR",
      "subtitle": "语音 → 文本"
    },
    "embeddings-openai": {
      "title": "嵌入(OpenAI)",
      "subtitle": "POST /v1/embeddings,body { input }"
    },
    "embeddings-tei": {
      "title": "嵌入(TEI)",
      "subtitle": "POST /embed,body { inputs[] }"
    },
    "rerank-tei": {
      "title": "重排序(TEI)",
      "subtitle": "POST /rerank,body { texts[] }"
    },
    "rerank-cohere": {
      "title": "重排序(Cohere)",
      "subtitle": "POST /v1/rerank,body { documents[] }"
    },
    "image-gen": {
      "title": "图像生成",
      "subtitle": "文本 → 图像(URL 或 b64_json)"
    }
  }
}
```

- [ ] **Step 4: Run web tests + lint to confirm no missing-key warnings**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat/regression-suite
pnpm -F @modeldoctor/web test
pnpm -F @modeldoctor/web type-check && pnpm -F @modeldoctor/web lint
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/locales/en/e2e.json apps/web/src/locales/zh/e2e.json
git commit -m "$(cat <<'EOF'
feat(web/e2e-smoke/i18n): add categories + 10 probes in en/zh

Drops the legacy probes.{text,image,audio} block; adds the 10 new
probe ids + category labels + new actions/meta strings. Both en and zh
locales kept in lockstep.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Open PR

- [ ] **Step 1: Final repo-wide sanity sweep**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat/regression-suite
pnpm -r type-check
pnpm -r lint
pnpm -r test
```

Expected: all green. If any test fails, fix before pushing — do NOT silently disable.

- [ ] **Step 2: Push the branch**

```bash
git push -u origin feat/regression-suite
```

(Branch was previously local-only on the rebased state; this is the first push.)

- [ ] **Step 3: Open the PR**

```bash
gh pr create --title "feat(e2e-smoke): category-based probe matrix covering chat/audio/embeddings/rerank/image" --body "$(cat <<'EOF'
## Summary

Extends E2E Smoke from 3 hardcoded probes (text / image / audio — all chat-completions-flavored) to a **category-based probe matrix** with 10 probes across 5 categories. Each probe has a default OpenAI-compatible (or TEI / Cohere / etc.) path AND a manual override field, so any unusual gateway routing the user's deployment uses can still be smoke-tested.

### Categories & probes

| Category | Probe | Default path | Body shape |
|---|---|---|---|
| **Chat** | chat-text | `/v1/chat/completions` | OpenAI |
| **Chat** | chat-vision | `/v1/chat/completions` | OpenAI + image |
| **Audio** | tts | `/v1/audio/speech` | `{ model, input, voice }` → raw audio bytes |
| **Audio** | asr | `/v1/audio/transcriptions` | multipart/form-data + WAV fixture |
| **Audio** | chat-audio-omni | `/v1/chat/completions` | `modalities: ["audio"]` (Qwen-Omni / GPT-4o-audio) |
| **Embeddings** | embeddings-openai | `/v1/embeddings` | OpenAI |
| **Embeddings** | embeddings-tei | `/embed` | TEI native |
| **Rerank** | rerank-tei | `/rerank` | `{ query, texts[] }` |
| **Rerank** | rerank-cohere | `/v1/rerank` | `{ query, documents[] }` |
| **Image** | image-gen | `/v1/images/generations` | OpenAI |

### Notable design points

- **Inference-engine selector becomes UX-only.** vLLM / SGLang / MindIE / TEI / vllm-omni all converge on OpenAI-compatible APIs (with TEI's `/embed` + `/rerank` and Cohere's `/v1/rerank` as the only mainstream divergences — and those are now distinct probes). The engine dropdown stays for model-name suggestions / quirks tips, but does not route probes.
- **Path override per probe.** UI shows a small editable field under each probe title; default greyed, override filled. Empty / equal-to-default → no override sent on the wire.
- **ASR fixture.** A 16 KB synthetic 1-second silent WAV is committed so the probe is hermetic (no runtime audio synthesis, no external fixture).
- **Persistence v1 → v2.** Probe id naming changed (text → chat-text, etc.), so old persisted state is dropped on first load. No migration written.

## Test plan

- [x] `pnpm -F @modeldoctor/contracts test` — covers new schema fields + enum
- [x] `pnpm -F @modeldoctor/api test` — 10 probe specs (3 existing renamed, 7 new)
- [x] `pnpm -F @modeldoctor/web test` — store v2 + page + ProbeCard
- [x] `pnpm -r type-check` — clean across contracts / api / web
- [x] `pnpm -r lint` — clean

### Manual smoke (do before merging)

- [ ] Open `/e2e`, confirm category dropdown shows 5 options
- [ ] Pick `Audio`, confirm 3 cards: TTS / ASR / Omni audio
- [ ] On the TTS card, leave path default; aim at a real `/v1/audio/speech` endpoint; confirm pass + `<audio>` preview when WAV
- [ ] On the same TTS card, edit the path to something nonsensical (e.g., `/x/y/z`); confirm reset-icon appears; confirm the next run actually hits that path (server returns 404 / 400)
- [ ] Pick `Embeddings`, confirm OpenAI + TEI variants run independently
- [ ] Pick `Rerank`, confirm TEI's `/rerank` works against a TEI deployment

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

PR opened.

---

## Self-review — spec coverage

| Requirement | Task |
|---|---|
| Category dropdown, 1-to-many | Tasks 1, 9, 10 |
| Path manually editable per probe | Tasks 1, 2, 10 |
| Chat coverage (text + vision) | Tasks 2 |
| Embeddings (OpenAI + TEI) | Task 3 |
| Rerank (TEI + Cohere) | Task 4 |
| TTS pure (raw bytes) | Task 5 |
| ASR with hermetic fixture | Task 6 |
| Image generation | Task 7 |
| Omni audio coexists | Task 2 (renamed, kept) |
| Inference engine = UX-only, not routing | (no code; design decision called out in PR body) |
| Video coverage | Out of scope (no standard protocol) |

## Self-review — placeholder scan

No "TODO", "TBD", "implement later", "similar to Task N" sentinels. Every step has executable code or commands with expected outputs.
