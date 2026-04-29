# Playground Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Playground Phase 2: SSE-streaming Chat (with stale-closure-free `onSend` and an abort/Stop button), a generic `HistoryStore`, a `ViewCodeDialog`, a shared `openai-client` integration module, and three new modality pages (Image / Embeddings / Rerank — each with params, history, view-code, and a backend service).

**Architecture:**
- Backend extracts URL/header/query/body construction into a single `apps/api/src/integrations/openai-client/` module that both the existing E2E probes and the new Playground services consume. The existing chat service is refactored onto it without behavior change; new embeddings / rerank / images services and an SSE branch on the chat controller are built on top.
- Frontend gains a `playgroundFetchStream()` SSE helper, a generic `createHistoryStore<S>()` factory used by all modality pages, a shared `ViewCodeDialog` driven by per-modality pure `genSnippets(state)` functions, and three new feature folders (`image/`, `embeddings/`, `rerank/`) each shaped exactly like `chat/`.
- ChatPage `onSend` is rewritten to read from `useChatStore.getState()` (never from a render-time slice closure) and to manage an `AbortController` lifecycle. SSE chunks append to the assistant message via a single `appendAssistantToken()` action.

**Tech Stack:** NestJS 10, Vitest 2 (api) / Vitest 1 (web), Zod 3, React 18.3, Zustand 4.5, react-i18next, Radix UI (Dialog / Tabs), Tailwind, sonner.

**Branch strategy (per user direction):** stay on the long-lived `feat/regression-suite` branch. Sync with `origin/main` first (Task 0), then proceed task-by-task with conventional commits. Do not cut a sub-branch.

**Out-of-scope reminders (to avoid scope creep):**
- Multimodal chat attachments (image / audio upload to `/playground/chat`) — the spec § 10 originally listed them under Phase 2, but the user's restated Phase 2 scope drops them. **Confirm with the user before merging if they need to be re-added before this phase ships.** No tasks below build attachment UI or extend the chat content-parts wire.
- ChatComparePage (2/3/4 panel) — Phase 3.
- AudioPage (TTS / STT) — Phase 3.

---

## File Structure

### Backend — new files
- `apps/api/src/integrations/openai-client/index.ts` — barrel re-export
- `apps/api/src/integrations/openai-client/url.ts` — `parseHeaderLines`, `parseQueryLines`, `buildHeaders`, `buildUrl`
- `apps/api/src/integrations/openai-client/sse.ts` — `pipeUpstreamSseToResponse(upstream, res, signal)`
- `apps/api/src/integrations/openai-client/wires/chat.ts` — `buildPlaygroundChatBody`, `parsePlaygroundChatResponse`
- `apps/api/src/integrations/openai-client/wires/embeddings.ts` — `buildEmbeddingsBody`, `parseEmbeddingsResponse` (OpenAI shape)
- `apps/api/src/integrations/openai-client/wires/rerank.ts` — `buildRerankBody`, `parseRerankResponse` (handles cohere `results[]` and tei top-level array)
- `apps/api/src/integrations/openai-client/wires/images.ts` — `buildImagesBody`, `parseImagesResponse`
- `apps/api/src/integrations/openai-client/openai-client.spec.ts` — unit tests
- `apps/api/src/modules/playground/embeddings.controller.ts` + `embeddings.service.ts` + `embeddings.service.spec.ts`
- `apps/api/src/modules/playground/rerank.controller.ts` + `rerank.service.ts` + `rerank.service.spec.ts`
- `apps/api/src/modules/playground/images.controller.ts` + `images.service.ts` + `images.service.spec.ts`

### Backend — modified files
- `apps/api/src/modules/playground/chat.controller.ts` — branch on `params.stream === true`, switch to `@Res()` for SSE pass-through
- `apps/api/src/modules/playground/chat.service.ts` — refactor onto `openai-client`; add `runStream()` method
- `apps/api/src/modules/playground/chat.service.spec.ts` — add SSE pass-through test
- `apps/api/src/modules/playground/playground.module.ts` — register the 3 new controllers + services
- `apps/api/src/integrations/probes/chat-text.ts` / `embeddings-openai.ts` / `embeddings-tei.ts` / `rerank-cohere.ts` / `rerank-tei.ts` / `image-gen.ts` — swap inline header/URL construction for `openai-client/url` helpers (probe-specific test bodies stay inline)

### Contracts — modified files
- `packages/contracts/src/playground.ts` — add `PlaygroundEmbeddingsRequest/Response`, `PlaygroundRerankRequest/Response`, `PlaygroundImagesRequest/Response` schemas
- `packages/contracts/src/playground.test.ts` — add coverage for new schemas

### Frontend — new files
- `apps/web/src/lib/playground-stream.ts` — `playgroundFetchStream({ path, body, signal, onSseEvent })`
- `apps/web/src/lib/playground-stream.test.ts`
- `apps/web/src/features/playground/history/createHistoryStore.ts` — generic factory
- `apps/web/src/features/playground/history/createHistoryStore.test.ts`
- `apps/web/src/features/playground/history/HistoryDrawer.tsx` — generic dropdown UI (current entry + list + new + restore confirm)
- `apps/web/src/features/playground/history/HistoryDrawer.test.tsx`
- `apps/web/src/features/playground/code-snippets/chat.ts`
- `apps/web/src/features/playground/code-snippets/embeddings.ts`
- `apps/web/src/features/playground/code-snippets/rerank.ts`
- `apps/web/src/features/playground/code-snippets/images.ts`
- `apps/web/src/features/playground/code-snippets/code-snippets.test.ts`
- `apps/web/src/features/playground/ViewCodeDialog.tsx`
- `apps/web/src/features/playground/ViewCodeDialog.test.tsx`
- `apps/web/src/features/playground/embeddings/pca.ts`
- `apps/web/src/features/playground/embeddings/pca.test.ts`
- `apps/web/src/features/playground/embeddings/PcaScatter.tsx`
- `apps/web/src/features/playground/embeddings/EmbeddingsPage.tsx`
- `apps/web/src/features/playground/embeddings/EmbeddingsParams.tsx`
- `apps/web/src/features/playground/embeddings/store.ts`
- `apps/web/src/features/playground/embeddings/store.test.ts`
- `apps/web/src/features/playground/embeddings/EmbeddingsPage.test.tsx`
- `apps/web/src/features/playground/image/ImagePage.tsx`
- `apps/web/src/features/playground/image/ImageParams.tsx`
- `apps/web/src/features/playground/image/store.ts`
- `apps/web/src/features/playground/image/store.test.ts`
- `apps/web/src/features/playground/image/ImagePage.test.tsx`
- `apps/web/src/features/playground/rerank/RerankPage.tsx`
- `apps/web/src/features/playground/rerank/RerankParams.tsx`
- `apps/web/src/features/playground/rerank/store.ts`
- `apps/web/src/features/playground/rerank/store.test.ts`
- `apps/web/src/features/playground/rerank/RerankPage.test.tsx`

### Frontend — modified files
- `apps/web/src/features/playground/PlaygroundShell.tsx` — wire `viewCodeSnippets` prop to `[</> 查看代码]` button + `ViewCodeDialog`; add `historySlot?: ReactNode` for the per-page `HistoryDrawer`
- `apps/web/src/features/playground/chat/store.ts` — add streaming/abort/append-token state and actions
- `apps/web/src/features/playground/chat/store.test.ts` — coverage for new actions
- `apps/web/src/features/playground/chat/ChatPage.tsx` — rewrite `onSend` (de-stale-closure + AbortController + SSE/non-SSE branch); wire ViewCode + History
- `apps/web/src/features/playground/chat/ChatPage.test.tsx` — add Stop / SSE / multi-turn-while-streaming / history-restore cases
- `apps/web/src/features/playground/chat/MessageComposer.tsx` — render Stop button while `streaming === true`; expose `onStop` prop
- `apps/web/src/router/index.tsx` — replace the three `ComingSoonRoute` placeholders with real pages
- `apps/web/src/locales/en-US/playground.json` + `apps/web/src/locales/zh-CN/playground.json` — add `image.*`, `embeddings.*`, `rerank.*`, `viewCode.*`, `history.*`, `chat.composer.stop` keys

---

## Task index

- Task 0 — Sync `feat/regression-suite` with `origin/main` and confirm clean baseline
- Task 1 — Extract `openai-client/url.ts` (header / query / URL helpers)
- Task 2 — Extract per-wire builders + parsers under `openai-client/wires/`
- Task 3 — Refactor existing `playground/chat.service.ts` onto `openai-client` (no behavior change)
- Task 4 — Refactor 6 E2E probes onto `openai-client/url.ts`
- Task 5 — Add `openai-client/sse.ts` SSE pass-through helper
- Task 6 — Add SSE branch to `chat.controller.ts` + `runStream()` on `chat.service.ts`
- Task 7 — Add embeddings / rerank / images Contracts schemas
- Task 8 — Build embeddings backend (controller + service + spec)
- Task 9 — Build rerank backend (controller + service + spec)
- Task 10 — Build images backend (controller + service + spec)
- Task 11 — Frontend SSE helper `lib/playground-stream.ts`
- Task 12 — `ChatStore` overhaul: streaming state + abort + `appendAssistantToken`
- Task 13 — Rewrite `ChatPage.onSend` (de-stale-closure + Stop button + SSE / non-SSE branch)
- Task 14 — `createHistoryStore<S>()` factory + tests
- Task 15 — `HistoryDrawer` generic UI component
- Task 16 — `code-snippets/{chat,embeddings,rerank,images}.ts` + snapshot tests
- Task 17 — `ViewCodeDialog` component + test
- Task 18 — Wire `PlaygroundShell` to expose ViewCode button + History slot
- Task 19 — Wire ChatPage to its History store + ViewCode dialog
- Task 20 — `embeddings/pca.ts` pure function + test
- Task 21 — `EmbeddingsPage` (store, params, PCA scatter, JSON tab, history, view-code)
- Task 22 — `ImagePage` (store, params, history, view-code)
- Task 23 — `RerankPage` (store, params, history, view-code)
- Task 24 — Router: replace ComingSoon for `/playground/{image,embeddings,rerank}`
- Task 25 — i18n: add new keys to `playground.json` (en-US + zh-CN)
- Task 26 — Final verification (lint, type-check, unit tests, manual dev-server smoke), push

---

## Task 0: Sync `feat/regression-suite` with `origin/main`

**Files:** none (git only)

- [ ] **Step 1: Confirm clean tree**

```bash
git status
```

Expected: `nothing to commit, working tree clean` and branch `feat/regression-suite`.

- [ ] **Step 2: Fetch + fast-forward merge `origin/main`**

```bash
git fetch origin main
git merge --ff-only origin/main
```

Expected: `Updating ...` then `Fast-forward`. If git refuses (`Not possible to fast-forward, aborting.`), STOP and report — the branch has diverged in a way the plan didn't expect.

- [ ] **Step 3: Push the merged baseline**

```bash
git push origin feat/regression-suite
```

Expected: push succeeds, no force needed.

---

## Task 1: Extract `openai-client/url.ts`

**Files:**
- Create: `apps/api/src/integrations/openai-client/url.ts`
- Create: `apps/api/src/integrations/openai-client/index.ts`
- Create: `apps/api/src/integrations/openai-client/openai-client.spec.ts`

**Why this task exists:** The same 4 helpers (`parseHeaderLines`, `parseQueryLines`, `buildHeaders`, `buildUrl`) live inline in `playground/chat.service.ts` and are repeated implicitly across all 10 E2E probes. Extracting them is the only structural prerequisite for the 3 new playground services + the SSE branch.

- [ ] **Step 1: Write failing spec**

Create `apps/api/src/integrations/openai-client/openai-client.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildHeaders, buildUrl, parseHeaderLines, parseQueryLines } from "./url.js";

describe("parseHeaderLines", () => {
  it("returns empty record for undefined / blank", () => {
    expect(parseHeaderLines(undefined)).toEqual({});
    expect(parseHeaderLines("")).toEqual({});
    expect(parseHeaderLines("   \n  ")).toEqual({});
  });

  it("parses 'K: v' lines, trims, ignores malformed", () => {
    expect(parseHeaderLines("X-Foo: bar\n  X-Baz : qux \nignored\nX-Empty:")).toEqual({
      "X-Foo": "bar",
      "X-Baz": "qux",
      "X-Empty": "",
    });
  });
});

describe("parseQueryLines", () => {
  it("parses 'k=v' lines", () => {
    expect(parseQueryLines("api-version=2024-02-01\nfoo=bar\n=skipme")).toEqual({
      "api-version": "2024-02-01",
      foo: "bar",
    });
  });
});

describe("buildHeaders", () => {
  it("merges Authorization + Content-Type with custom headers", () => {
    const h = buildHeaders("sk-1", "X-Foo: bar");
    expect(h.Authorization).toBe("Bearer sk-1");
    expect(h["Content-Type"]).toBe("application/json");
    expect(h["X-Foo"]).toBe("bar");
  });

  it("lets caller override Content-Type via customHeaders", () => {
    const h = buildHeaders("k", "Content-Type: multipart/form-data");
    expect(h["Content-Type"]).toBe("multipart/form-data");
  });
});

describe("buildUrl", () => {
  it("joins base + default path, collapses trailing slash", () => {
    expect(buildUrl({ apiBaseUrl: "http://x.test/", defaultPath: "/v1/chat/completions" })).toBe(
      "http://x.test/v1/chat/completions",
    );
  });

  it("uses pathOverride when given", () => {
    expect(
      buildUrl({
        apiBaseUrl: "http://x",
        defaultPath: "/v1/chat/completions",
        pathOverride: "/custom",
      }),
    ).toBe("http://x/custom");
  });

  it("normalises pathOverride lacking a leading slash", () => {
    expect(
      buildUrl({ apiBaseUrl: "http://x", defaultPath: "/d", pathOverride: "custom" }),
    ).toBe("http://x/custom");
  });

  it("appends queryParams as URLSearchParams", () => {
    const url = buildUrl({
      apiBaseUrl: "http://x",
      defaultPath: "/v1/embeddings",
      queryParams: "api-version=2024-02-01\nfoo=bar",
    });
    expect(url).toMatch(/^http:\/\/x\/v1\/embeddings\?/);
    expect(url).toContain("api-version=2024-02-01");
    expect(url).toContain("foo=bar");
  });

  it("uses & if pathOverride already contains ?", () => {
    const url = buildUrl({
      apiBaseUrl: "http://x",
      defaultPath: "/d",
      pathOverride: "/p?a=1",
      queryParams: "b=2",
    });
    expect(url).toBe("http://x/p?a=1&b=2");
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm -F @modeldoctor/api test src/integrations/openai-client`
Expected: FAIL with "Cannot find module './url.js'".

- [ ] **Step 3: Implement `url.ts`**

Create `apps/api/src/integrations/openai-client/url.ts`:

```ts
export function parseHeaderLines(s: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!s || !s.trim()) return out;
  for (const rawLine of s.split("\n").map((l) => l.trim())) {
    if (!rawLine || !rawLine.includes(":")) continue;
    const idx = rawLine.indexOf(":");
    out[rawLine.slice(0, idx).trim()] = rawLine.slice(idx + 1).trim();
  }
  return out;
}

export function parseQueryLines(s: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!s || !s.trim()) return out;
  for (const rawLine of s.split("\n").map((l) => l.trim())) {
    if (!rawLine || !rawLine.includes("=")) continue;
    const idx = rawLine.indexOf("=");
    const k = rawLine.slice(0, idx).trim();
    if (!k) continue;
    out[k] = rawLine.slice(idx + 1).trim();
  }
  return out;
}

export function buildHeaders(
  apiKey: string,
  customHeaders: string | undefined,
): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    ...parseHeaderLines(customHeaders),
  };
}

export interface BuildUrlInput {
  apiBaseUrl: string;
  defaultPath: string;
  pathOverride?: string;
  queryParams?: string;
}

export function buildUrl({
  apiBaseUrl,
  defaultPath,
  pathOverride,
  queryParams,
}: BuildUrlInput): string {
  const base = apiBaseUrl.replace(/\/+$/, "");
  const rawPath = pathOverride ?? defaultPath;
  const path = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  let url = base + path;
  const qp = parseQueryLines(queryParams);
  const qpKeys = Object.keys(qp);
  if (qpKeys.length > 0) {
    const search = new URLSearchParams();
    for (const k of qpKeys) search.set(k, qp[k]);
    url += (url.includes("?") ? "&" : "?") + search.toString();
  }
  return url;
}
```

- [ ] **Step 4: Create the barrel**

Create `apps/api/src/integrations/openai-client/index.ts`:

```ts
export * from "./url.js";
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `pnpm -F @modeldoctor/api test src/integrations/openai-client`
Expected: PASS, all `url.ts` cases green.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/integrations/openai-client/
git commit -m "$(cat <<'EOF'
refactor(api/openai-client): extract URL/header/query helpers

Pulls parseHeaderLines / parseQueryLines / buildHeaders / buildUrl into
a new shared module that both the existing chat service and the upcoming
embeddings/rerank/images services will consume. No call-site migrations
yet — those land in subsequent tasks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Extract per-wire builders + parsers

**Files:**
- Create: `apps/api/src/integrations/openai-client/wires/chat.ts`
- Create: `apps/api/src/integrations/openai-client/wires/embeddings.ts`
- Create: `apps/api/src/integrations/openai-client/wires/rerank.ts`
- Create: `apps/api/src/integrations/openai-client/wires/images.ts`
- Modify: `apps/api/src/integrations/openai-client/index.ts` (add re-exports)
- Extend: `apps/api/src/integrations/openai-client/openai-client.spec.ts`

These are pure functions (no fetch, no NestJS). Each wire exposes a `buildXxxBody(req)` and `parseXxxResponse(json)` pair. The existing `apps/api/src/integrations/builders/` continues to exist for the legacy benchmark code path — DO NOT delete it; leave migration of the benchmark module out of Phase 2.

- [ ] **Step 1: Write failing spec for `wires/chat.ts`**

Append to `apps/api/src/integrations/openai-client/openai-client.spec.ts`:

```ts
import {
  buildPlaygroundChatBody,
  parsePlaygroundChatResponse,
} from "./wires/chat.js";
import {
  buildEmbeddingsBody,
  parseEmbeddingsResponse,
} from "./wires/embeddings.js";
import {
  buildRerankBody,
  parseRerankResponse,
} from "./wires/rerank.js";
import {
  buildImagesBody,
  parseImagesResponse,
} from "./wires/images.js";

describe("wires/chat", () => {
  const messages = [{ role: "user" as const, content: "hi" }];

  it("buildPlaygroundChatBody returns OpenAI shape with snake_case mapping", () => {
    const body = buildPlaygroundChatBody({
      model: "m",
      messages,
      params: {
        temperature: 0.5,
        maxTokens: 100,
        topP: 0.9,
        frequencyPenalty: 0.1,
        presencePenalty: 0.2,
        seed: 7,
        stop: ["</s>"],
        stream: true,
      },
    });
    expect(body).toEqual({
      model: "m",
      messages,
      temperature: 0.5,
      max_tokens: 100,
      top_p: 0.9,
      frequency_penalty: 0.1,
      presence_penalty: 0.2,
      seed: 7,
      stop: ["</s>"],
      stream: true,
    });
  });

  it("buildPlaygroundChatBody omits undefined params", () => {
    const body = buildPlaygroundChatBody({ model: "m", messages, params: {} });
    expect(body).toEqual({ model: "m", messages });
  });

  it("parsePlaygroundChatResponse returns content + usage", () => {
    expect(
      parsePlaygroundChatResponse({
        choices: [{ message: { content: "hello" } }],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      }),
    ).toEqual({
      content: "hello",
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    });
  });

  it("parsePlaygroundChatResponse defaults content to empty string", () => {
    expect(parsePlaygroundChatResponse({})).toEqual({ content: "", usage: undefined });
  });
});

describe("wires/embeddings", () => {
  it("buildEmbeddingsBody supports single + array input", () => {
    expect(buildEmbeddingsBody({ model: "m", input: "one" })).toEqual({
      model: "m",
      input: "one",
    });
    expect(buildEmbeddingsBody({ model: "m", input: ["a", "b"] })).toEqual({
      model: "m",
      input: ["a", "b"],
    });
  });

  it("buildEmbeddingsBody adds optional encoding_format and dimensions", () => {
    expect(
      buildEmbeddingsBody({
        model: "m",
        input: "x",
        encodingFormat: "base64",
        dimensions: 256,
      }),
    ).toEqual({ model: "m", input: "x", encoding_format: "base64", dimensions: 256 });
  });

  it("parseEmbeddingsResponse returns array of vectors + usage", () => {
    expect(
      parseEmbeddingsResponse({
        data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }],
        usage: { prompt_tokens: 5, total_tokens: 5 },
      }),
    ).toEqual({
      embeddings: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
      usage: { prompt_tokens: 5, total_tokens: 5 },
    });
  });
});

describe("wires/rerank", () => {
  it("buildRerankBody emits cohere shape by default (documents + top_n)", () => {
    expect(
      buildRerankBody({
        model: "m",
        query: "q",
        documents: ["a", "b"],
        topN: 3,
        returnDocuments: true,
        wire: "cohere",
      }),
    ).toEqual({ model: "m", query: "q", documents: ["a", "b"], top_n: 3, return_documents: true });
  });

  it("buildRerankBody emits tei shape when wire=tei (texts, no top_n)", () => {
    expect(
      buildRerankBody({ model: "m", query: "q", documents: ["a", "b"], wire: "tei" }),
    ).toEqual({ model: "m", query: "q", texts: ["a", "b"] });
  });

  it("parseRerankResponse handles cohere {results: [{index, relevance_score}]}", () => {
    expect(
      parseRerankResponse({
        results: [
          { index: 1, relevance_score: 0.9 },
          { index: 0, relevance_score: 0.4 },
        ],
      }),
    ).toEqual([
      { index: 1, score: 0.9 },
      { index: 0, score: 0.4 },
    ]);
  });

  it("parseRerankResponse handles tei top-level [{index, score}]", () => {
    expect(
      parseRerankResponse([
        { index: 0, score: 0.8 },
        { index: 1, score: 0.2 },
      ]),
    ).toEqual([
      { index: 0, score: 0.8 },
      { index: 1, score: 0.2 },
    ]);
  });
});

describe("wires/images", () => {
  it("buildImagesBody includes optional size / n / response_format / seed", () => {
    expect(
      buildImagesBody({
        model: "m",
        prompt: "p",
        size: "512x512",
        n: 2,
        responseFormat: "b64_json",
        seed: 42,
      }),
    ).toEqual({
      model: "m",
      prompt: "p",
      size: "512x512",
      n: 2,
      response_format: "b64_json",
      seed: 42,
    });
  });

  it("parseImagesResponse returns artifacts array preserving url and b64_json", () => {
    expect(
      parseImagesResponse({
        data: [{ url: "http://i/0" }, { b64_json: "AAA" }],
      }),
    ).toEqual([
      { url: "http://i/0", b64Json: undefined },
      { url: undefined, b64Json: "AAA" },
    ]);
  });
});
```

- [ ] **Step 2: Run the suite — confirm it fails**

Run: `pnpm -F @modeldoctor/api test src/integrations/openai-client`
Expected: FAIL — wire modules don't exist yet.

- [ ] **Step 3: Implement `wires/chat.ts`**

Create `apps/api/src/integrations/openai-client/wires/chat.ts`:

```ts
import type { ChatMessage, ChatParams } from "@modeldoctor/contracts";

export interface BuildPlaygroundChatBodyInput {
  model: string;
  messages: ChatMessage[];
  params: ChatParams;
}

export function buildPlaygroundChatBody({
  model,
  messages,
  params,
}: BuildPlaygroundChatBodyInput): Record<string, unknown> {
  const body: Record<string, unknown> = { model, messages };
  if (params.temperature !== undefined) body.temperature = params.temperature;
  if (params.maxTokens !== undefined) body.max_tokens = params.maxTokens;
  if (params.topP !== undefined) body.top_p = params.topP;
  if (params.frequencyPenalty !== undefined) body.frequency_penalty = params.frequencyPenalty;
  if (params.presencePenalty !== undefined) body.presence_penalty = params.presencePenalty;
  if (params.seed !== undefined) body.seed = params.seed;
  if (params.stop !== undefined) body.stop = params.stop;
  if (params.stream !== undefined) body.stream = params.stream;
  return body;
}

export interface ParsedPlaygroundChatResponse {
  content: string;
  usage:
    | { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
    | undefined;
}

export function parsePlaygroundChatResponse(
  json: unknown,
): ParsedPlaygroundChatResponse {
  const j = (json ?? {}) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  return {
    content: j.choices?.[0]?.message?.content ?? "",
    usage: j.usage,
  };
}
```

- [ ] **Step 4: Implement `wires/embeddings.ts`**

Create `apps/api/src/integrations/openai-client/wires/embeddings.ts`:

```ts
export interface BuildEmbeddingsBodyInput {
  model: string;
  input: string | string[];
  encodingFormat?: "float" | "base64";
  dimensions?: number;
}

export function buildEmbeddingsBody({
  model,
  input,
  encodingFormat,
  dimensions,
}: BuildEmbeddingsBodyInput): Record<string, unknown> {
  const body: Record<string, unknown> = { model, input };
  if (encodingFormat !== undefined) body.encoding_format = encodingFormat;
  if (dimensions !== undefined) body.dimensions = dimensions;
  return body;
}

export interface ParsedEmbeddingsResponse {
  embeddings: number[][];
  usage: { prompt_tokens?: number; total_tokens?: number } | undefined;
}

export function parseEmbeddingsResponse(json: unknown): ParsedEmbeddingsResponse {
  const j = (json ?? {}) as {
    data?: { embedding?: unknown }[];
    usage?: { prompt_tokens?: number; total_tokens?: number };
  };
  const embeddings = (j.data ?? [])
    .map((d) => (Array.isArray(d.embedding) ? (d.embedding as number[]) : null))
    .filter((v): v is number[] => v !== null);
  return { embeddings, usage: j.usage };
}
```

- [ ] **Step 5: Implement `wires/rerank.ts`**

Create `apps/api/src/integrations/openai-client/wires/rerank.ts`:

```ts
export interface BuildRerankBodyInput {
  model: string;
  query: string;
  documents: string[];
  topN?: number;
  returnDocuments?: boolean;
  wire: "cohere" | "tei";
}

export function buildRerankBody(input: BuildRerankBodyInput): Record<string, unknown> {
  if (input.wire === "tei") {
    return { model: input.model, query: input.query, texts: input.documents };
  }
  const body: Record<string, unknown> = {
    model: input.model,
    query: input.query,
    documents: input.documents,
  };
  if (input.topN !== undefined) body.top_n = input.topN;
  if (input.returnDocuments !== undefined) body.return_documents = input.returnDocuments;
  return body;
}

export interface RerankHit {
  index: number;
  score: number;
}

export function parseRerankResponse(json: unknown): RerankHit[] {
  if (Array.isArray(json)) {
    return json
      .filter(
        (r): r is { index: number; score: number } =>
          !!r && typeof (r as { index?: unknown }).index === "number" &&
          typeof (r as { score?: unknown }).score === "number",
      )
      .map((r) => ({ index: r.index, score: r.score }));
  }
  const j = (json ?? {}) as {
    results?: { index?: unknown; relevance_score?: unknown }[];
  };
  return (j.results ?? [])
    .filter(
      (r): r is { index: number; relevance_score: number } =>
        typeof r.index === "number" && typeof r.relevance_score === "number",
    )
    .map((r) => ({ index: r.index, score: r.relevance_score }));
}
```

- [ ] **Step 6: Implement `wires/images.ts`**

Create `apps/api/src/integrations/openai-client/wires/images.ts`:

```ts
export interface BuildImagesBodyInput {
  model: string;
  prompt: string;
  size?: string;
  n?: number;
  responseFormat?: "url" | "b64_json";
  seed?: number;
}

export function buildImagesBody(input: BuildImagesBodyInput): Record<string, unknown> {
  const body: Record<string, unknown> = { model: input.model, prompt: input.prompt };
  if (input.size !== undefined) body.size = input.size;
  if (input.n !== undefined) body.n = input.n;
  if (input.responseFormat !== undefined) body.response_format = input.responseFormat;
  if (input.seed !== undefined) body.seed = input.seed;
  return body;
}

export interface ImageArtifact {
  url: string | undefined;
  b64Json: string | undefined;
}

export function parseImagesResponse(json: unknown): ImageArtifact[] {
  const j = (json ?? {}) as { data?: { url?: string; b64_json?: string }[] };
  return (j.data ?? []).map((d) => ({ url: d.url, b64Json: d.b64_json }));
}
```

- [ ] **Step 7: Update barrel**

Replace `apps/api/src/integrations/openai-client/index.ts` body:

```ts
export * from "./url.js";
export * from "./wires/chat.js";
export * from "./wires/embeddings.js";
export * from "./wires/rerank.js";
export * from "./wires/images.js";
```

- [ ] **Step 8: Run all openai-client tests**

Run: `pnpm -F @modeldoctor/api test src/integrations/openai-client`
Expected: PASS, all wires green.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/integrations/openai-client/
git commit -m "$(cat <<'EOF'
feat(api/openai-client): add per-wire body builders + response parsers

Adds chat / embeddings / rerank / images wire helpers under
integrations/openai-client/wires/. Pure functions, no fetch — both the
existing chat service and the new playground services in subsequent tasks
consume them. Rerank handles cohere (results[]) and tei (top-level array)
shapes via a wire discriminator.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Refactor existing `playground/chat.service.ts` onto `openai-client`

**Files:**
- Modify: `apps/api/src/modules/playground/chat.service.ts`
- The existing `apps/api/src/modules/playground/chat.service.spec.ts` stays unchanged — it's the regression net for this refactor.

- [ ] **Step 1: Run the existing spec to baseline pass**

Run: `pnpm -F @modeldoctor/api test src/modules/playground/chat.service`
Expected: PASS — all 7 cases green (this is the safety net).

- [ ] **Step 2: Replace `chat.service.ts` body**

Rewrite `apps/api/src/modules/playground/chat.service.ts`:

```ts
import type { PlaygroundChatRequest, PlaygroundChatResponse } from "@modeldoctor/contracts";
import { Injectable } from "@nestjs/common";
import {
  buildHeaders,
  buildPlaygroundChatBody,
  buildUrl,
  parsePlaygroundChatResponse,
} from "../../integrations/openai-client/index.js";

const DEFAULT_PATH = "/v1/chat/completions";
const MAX_ERROR_BODY_BYTES = 1024;

@Injectable()
export class ChatService {
  async run(req: PlaygroundChatRequest): Promise<PlaygroundChatResponse> {
    const url = buildUrl({
      apiBaseUrl: req.apiBaseUrl,
      defaultPath: DEFAULT_PATH,
      pathOverride: req.pathOverride,
      queryParams: req.queryParams,
    });
    const headers = buildHeaders(req.apiKey, req.customHeaders);
    // Phase 1 contract: stream is ignored for this non-streaming path.
    const params = { ...req.params, stream: undefined };
    const body = buildPlaygroundChatBody({
      model: req.model,
      messages: req.messages,
      params,
    });
    const start = Date.now();
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const latencyMs = Date.now() - start;
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return {
          success: false,
          error: `upstream ${res.status}: ${text || res.statusText}`.slice(0, MAX_ERROR_BODY_BYTES),
          latencyMs,
        };
      }
      const json = await res.json();
      const parsed = parsePlaygroundChatResponse(json);
      return {
        success: true,
        content: parsed.content,
        latencyMs,
        usage: parsed.usage,
      };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
        latencyMs: Date.now() - start,
      };
    }
  }
}
```

- [ ] **Step 3: Run the regression spec — confirm still passing**

Run: `pnpm -F @modeldoctor/api test src/modules/playground/chat.service`
Expected: PASS — same 7 cases, no behavior change.

- [ ] **Step 4: Type-check the api workspace**

Run: `pnpm -F @modeldoctor/api type-check`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/playground/chat.service.ts
git commit -m "$(cat <<'EOF'
refactor(api/playground): chat.service uses openai-client helpers

No behavior change — the existing chat.service.spec stays untouched and
green. URL/header/body construction now delegates to the shared module
introduced in tasks 1+2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Migrate 6 E2E probes onto `openai-client/url.ts`

**Files (all modify):**
- `apps/api/src/integrations/probes/chat-text.ts`
- `apps/api/src/integrations/probes/embeddings-openai.ts`
- `apps/api/src/integrations/probes/embeddings-tei.ts`
- `apps/api/src/integrations/probes/rerank-cohere.ts`
- `apps/api/src/integrations/probes/rerank-tei.ts`
- `apps/api/src/integrations/probes/image-gen.ts`

**Why:** These probes still construct headers and URLs inline — the same logic that was just centralised. We migrate them now (rather than later) so there is exactly one URL/header construction code path in the api workspace. Probe-specific test bodies (the deterministic "Reply with exactly: OK-TEXT-123" prompts, etc.) stay inline; only the URL + header construction moves.

- [ ] **Step 1: Baseline-run the e2e probes' specs**

Run: `pnpm -F @modeldoctor/api test src/integrations/probes`
Expected: PASS (these tests existed pre-Phase-2). If any were not present, treat that as a pre-existing gap and do not block on it.

- [ ] **Step 2: Edit `chat-text.ts` — swap inline header/URL for helpers**

In `apps/api/src/integrations/probes/chat-text.ts`, replace the body of `runChatTextProbe` between the `body = buildChatBody(...)` call and the `res = await fetch(...)` call so the URL/header construction comes from `openai-client`:

```ts
import { buildChatBody } from "../builders/chat.js";
import { buildHeaders, buildUrl } from "../openai-client/index.js";
import type { ProbeCtx, ProbeResult } from "./index.js";

// ... interface unchanged ...

export async function runChatTextProbe({
  apiBaseUrl,
  apiKey,
  model,
  extraHeaders = {},
  pathOverride,
}: ProbeCtx): Promise<ProbeResult> {
  const body = buildChatBody({
    model,
    prompt: "Reply with exactly: OK-TEXT-123",
    maxTokens: 32,
    temperature: 0,
    stream: false,
  });
  const targetUrl = buildUrl({
    apiBaseUrl,
    defaultPath: "/v1/chat/completions",
    pathOverride,
  });
  const headers = {
    ...buildHeaders(apiKey, undefined),
    ...extraHeaders,
  };
  const t0 = Date.now();
  const res = await fetch(targetUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  // ... rest unchanged ...
```

(Remove the inline `Content-Type` / `Authorization` literal headers from this probe; the rest of the function is untouched.)

- [ ] **Step 3: Apply the same refactor to the other 5 probes**

Repeat for `embeddings-openai.ts`, `embeddings-tei.ts`, `rerank-cohere.ts`, `rerank-tei.ts`, `image-gen.ts`. Each replaces:

```ts
const targetUrl = `${apiBaseUrl}${path}`;
const res = await fetch(targetUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    ...extraHeaders,
  },
  ...
});
```

with:

```ts
const targetUrl = buildUrl({ apiBaseUrl, defaultPath: <existing default>, pathOverride });
const headers = { ...buildHeaders(apiKey, undefined), ...extraHeaders };
const res = await fetch(targetUrl, { method: "POST", headers, ... });
```

Default paths to preserve, per file:
- `embeddings-openai.ts`: `/v1/embeddings`
- `embeddings-tei.ts`: `/embed`
- `rerank-cohere.ts`: `/v1/rerank`
- `rerank-tei.ts`: `/rerank`
- `image-gen.ts`: `/v1/images/generations`

Do **not** touch `chat-vision.ts`, `chat-audio-omni.ts`, `tts.ts`, `asr.ts` — they use multipart bodies and audio/vision-specific construction; out of scope for Phase 2 (the user's scope drops audio/multimodal; revisit in Phase 3).

- [ ] **Step 4: Run probe specs — confirm all green**

Run: `pnpm -F @modeldoctor/api test src/integrations/probes`
Expected: PASS — same probe-spec count as Step 1.

- [ ] **Step 5: Type-check + lint**

Run: `pnpm -F @modeldoctor/api type-check && pnpm -F @modeldoctor/api lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/integrations/probes/
git commit -m "$(cat <<'EOF'
refactor(api/probes): use shared openai-client URL/header helpers

Migrates chat-text, embeddings-openai, embeddings-tei, rerank-cohere,
rerank-tei, image-gen onto openai-client/url.ts. Probe-specific test
bodies stay inline. Vision / audio-omni / tts / asr remain on their
multipart paths — Phase 3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Add `openai-client/sse.ts` SSE pass-through helper

**Files:**
- Create: `apps/api/src/integrations/openai-client/sse.ts`
- Modify: `apps/api/src/integrations/openai-client/index.ts` (add export)
- Modify: `apps/api/src/integrations/openai-client/openai-client.spec.ts` (add SSE test)

**Why:** The SSE branch on the chat controller (Task 6) and any future streaming endpoint needs one shared pump that copies upstream SSE bytes to the response and aborts upstream on client disconnect.

- [ ] **Step 1: Append failing test to the spec**

Append to `apps/api/src/integrations/openai-client/openai-client.spec.ts`:

```ts
import { Readable } from "node:stream";
import { pipeUpstreamSseToResponse } from "./sse.js";

describe("pipeUpstreamSseToResponse", () => {
  it("copies upstream chunks to res.write and ends res", async () => {
    // Build a minimal Web ReadableStream from text chunks
    const encoder = new TextEncoder();
    const upstream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(encoder.encode("data: hello\n\n"));
        c.enqueue(encoder.encode("data: world\n\n"));
        c.close();
      },
    });
    const written: string[] = [];
    let ended = false;
    const res = {
      write: (chunk: Uint8Array) => {
        written.push(new TextDecoder().decode(chunk));
        return true;
      },
      end: () => {
        ended = true;
      },
      on: () => {},
    } as unknown as import("express").Response;
    const ac = new AbortController();
    await pipeUpstreamSseToResponse(upstream, res, ac);
    expect(written.join("")).toBe("data: hello\n\ndata: world\n\n");
    expect(ended).toBe(true);
  });

  it("aborts upstream when res emits 'close' before drain", async () => {
    let aborted = false;
    const upstream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode("data: 1\n\n"));
        // do not close — wait for cancel
      },
      cancel() {
        aborted = true;
      },
    });
    const handlers: Record<string, () => void> = {};
    const res = {
      write: () => true,
      end: () => {},
      on: (ev: string, cb: () => void) => {
        handlers[ev] = cb;
      },
    } as unknown as import("express").Response;
    const ac = new AbortController();
    const p = pipeUpstreamSseToResponse(upstream, res, ac);
    handlers.close?.();
    await p;
    expect(aborted).toBe(true);
    expect(ac.signal.aborted).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `pnpm -F @modeldoctor/api test src/integrations/openai-client/openai-client.spec.ts -t pipeUpstreamSseToResponse`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `sse.ts`**

Create `apps/api/src/integrations/openai-client/sse.ts`:

```ts
import type { Response } from "express";

/**
 * Pump a Web ReadableStream of SSE bytes to an Express Response, aborting
 * the upstream when the client disconnects (res 'close' event).
 *
 * Caller is responsible for setting Content-Type / Cache-Control headers
 * BEFORE invoking this — we only do byte-level copy + lifecycle.
 */
export async function pipeUpstreamSseToResponse(
  upstream: ReadableStream<Uint8Array>,
  res: Response,
  abort: AbortController,
): Promise<void> {
  const reader = upstream.getReader();
  const onClose = () => {
    if (!abort.signal.aborted) abort.abort();
    reader.cancel().catch(() => {});
  };
  res.on("close", onClose);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) res.write(value);
    }
  } finally {
    res.end();
  }
}
```

- [ ] **Step 4: Update barrel**

Edit `apps/api/src/integrations/openai-client/index.ts`, append:

```ts
export * from "./sse.js";
```

- [ ] **Step 5: Run the new tests — confirm pass**

Run: `pnpm -F @modeldoctor/api test src/integrations/openai-client`
Expected: PASS, all `sse` cases green.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/integrations/openai-client/sse.ts apps/api/src/integrations/openai-client/index.ts apps/api/src/integrations/openai-client/openai-client.spec.ts
git commit -m "$(cat <<'EOF'
feat(api/openai-client): add SSE pass-through helper

pipeUpstreamSseToResponse copies a Web ReadableStream byte-by-byte to an
Express Response and aborts upstream on client disconnect. Used by the
playground chat SSE branch in the next task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Add SSE branch to `chat.controller.ts` + `runStream()` on `chat.service.ts`

**Files:**
- Modify: `apps/api/src/modules/playground/chat.service.ts`
- Modify: `apps/api/src/modules/playground/chat.controller.ts`
- Modify: `apps/api/src/modules/playground/chat.service.spec.ts`

The contract (`PlaygroundChatRequestSchema`) already accepts `params.stream`; we just stop ignoring it.

- [ ] **Step 1: Append failing SSE test to `chat.service.spec.ts`**

Append:

```ts
describe("ChatService.runStream", () => {
  let svc: ChatService;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    svc = new ChatService();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the upstream Response with stream body and stream:true in body", async () => {
    const upstream = new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode("data: hi\n\n"));
          c.close();
        },
      }),
      { status: 200, headers: { "content-type": "text/event-stream" } },
    );
    fetchMock.mockResolvedValue(upstream);

    const result = await svc.runStream({
      apiBaseUrl: "http://x",
      apiKey: "k",
      model: "m",
      messages: [{ role: "user", content: "h" }],
      params: { stream: true },
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.upstream).toBe(upstream);
    }
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.stream).toBe(true);
  });

  it("returns kind=error with status when upstream non-2xx", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 502 }));
    const result = await svc.runStream({
      apiBaseUrl: "http://x",
      apiKey: "k",
      model: "m",
      messages: [{ role: "user", content: "h" }],
      params: { stream: true },
    });
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.status).toBe(502);
      expect(result.error).toMatch(/nope/);
    }
  });
});
```

- [ ] **Step 2: Run the spec — confirm runStream test fails**

Run: `pnpm -F @modeldoctor/api test src/modules/playground/chat.service`
Expected: FAIL — `svc.runStream is not a function`.

- [ ] **Step 3: Add `runStream()` to `chat.service.ts`**

Append to the `ChatService` class:

```ts
  async runStream(req: PlaygroundChatRequest): Promise<
    | { kind: "ok"; upstream: Response }
    | { kind: "error"; status: number; error: string }
  > {
    const url = buildUrl({
      apiBaseUrl: req.apiBaseUrl,
      defaultPath: DEFAULT_PATH,
      pathOverride: req.pathOverride,
      queryParams: req.queryParams,
    });
    const headers = buildHeaders(req.apiKey, req.customHeaders);
    const body = buildPlaygroundChatBody({
      model: req.model,
      messages: req.messages,
      params: { ...req.params, stream: true },
    });
    const upstream = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      return {
        kind: "error",
        status: upstream.status,
        error: `upstream ${upstream.status}: ${text || upstream.statusText}`.slice(0, MAX_ERROR_BODY_BYTES),
      };
    }
    return { kind: "ok", upstream };
  }
```

- [ ] **Step 4: Run the spec — confirm pass**

Run: `pnpm -F @modeldoctor/api test src/modules/playground/chat.service`
Expected: PASS.

- [ ] **Step 5: Update `chat.controller.ts` to branch on stream**

Replace `apps/api/src/modules/playground/chat.controller.ts`:

```ts
import {
  type PlaygroundChatRequest,
  PlaygroundChatRequestSchema,
  type PlaygroundChatResponse,
  PlaygroundChatResponseSchema,
} from "@modeldoctor/contracts";
import { Body, Controller, HttpCode, HttpStatus, Post, Res, UsePipes } from "@nestjs/common";
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { createZodDto } from "nestjs-zod";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { pipeUpstreamSseToResponse } from "../../integrations/openai-client/index.js";
import { ChatService } from "./chat.service.js";

class PlaygroundChatRequestDto extends createZodDto(PlaygroundChatRequestSchema) {}
class PlaygroundChatResponseDto extends createZodDto(PlaygroundChatResponseSchema) {}

@ApiTags("playground")
@Controller("playground")
export class ChatController {
  constructor(private readonly svc: ChatService) {}

  @ApiOperation({
    summary:
      "Send a chat completion via the Playground (non-streaming JSON OR SSE pass-through if params.stream === true)",
  })
  @ApiBody({ type: PlaygroundChatRequestDto })
  @ApiOkResponse({ type: PlaygroundChatResponseDto })
  @Post("chat")
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(PlaygroundChatRequestSchema))
  async chat(
    @Body() body: PlaygroundChatRequest,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void | PlaygroundChatResponse> {
    if (body.params?.stream) {
      const result = await this.svc.runStream(body);
      if (result.kind === "error") {
        res.status(result.status).json({ success: false, error: result.error, latencyMs: 0 });
        return;
      }
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();
      const ac = new AbortController();
      const upstreamBody = result.upstream.body;
      if (!upstreamBody) {
        res.end();
        return;
      }
      await pipeUpstreamSseToResponse(upstreamBody, res, ac);
      return;
    }
    const out = await this.svc.run(body);
    res.json(out);
  }
}
```

- [ ] **Step 6: Re-run chat suite**

Run: `pnpm -F @modeldoctor/api test src/modules/playground`
Expected: PASS (existing 7 + 2 new runStream cases).

- [ ] **Step 7: Smoke the full api test suite**

Run: `pnpm -F @modeldoctor/api test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/playground/chat.service.ts apps/api/src/modules/playground/chat.service.spec.ts apps/api/src/modules/playground/chat.controller.ts
git commit -m "$(cat <<'EOF'
feat(api/playground/chat): SSE streaming branch on POST /api/playground/chat

When params.stream === true, the controller switches to @Res() pass-through
and streams upstream SSE bytes verbatim via pipeUpstreamSseToResponse;
client disconnect aborts upstream. Non-streaming behaviour is unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Add embeddings / rerank / images Contracts schemas

**Files:**
- Modify: `packages/contracts/src/playground.ts`
- Modify: `packages/contracts/src/playground.test.ts`

- [ ] **Step 1: Append failing schema tests**

Append to `packages/contracts/src/playground.test.ts`:

```ts
import {
  PlaygroundEmbeddingsRequestSchema,
  PlaygroundEmbeddingsResponseSchema,
  PlaygroundImagesRequestSchema,
  PlaygroundImagesResponseSchema,
  PlaygroundRerankRequestSchema,
  PlaygroundRerankResponseSchema,
} from "./playground.js";

describe("PlaygroundEmbeddingsRequestSchema", () => {
  const base = { apiBaseUrl: "http://x", apiKey: "k", model: "m", input: "one" };
  it("accepts string input", () => {
    expect(() => PlaygroundEmbeddingsRequestSchema.parse(base)).not.toThrow();
  });
  it("accepts string[] input", () => {
    expect(() =>
      PlaygroundEmbeddingsRequestSchema.parse({ ...base, input: ["a", "b"] }),
    ).not.toThrow();
  });
  it("rejects empty string[] input", () => {
    expect(() =>
      PlaygroundEmbeddingsRequestSchema.parse({ ...base, input: [] }),
    ).toThrow();
  });
  it("validates encodingFormat enum", () => {
    expect(() =>
      PlaygroundEmbeddingsRequestSchema.parse({ ...base, encodingFormat: "bogus" }),
    ).toThrow();
  });
});

describe("PlaygroundEmbeddingsResponseSchema", () => {
  it("accepts the OK shape", () => {
    expect(() =>
      PlaygroundEmbeddingsResponseSchema.parse({
        success: true,
        embeddings: [
          [0.1, 0.2],
          [0.3, 0.4],
        ],
        latencyMs: 12,
      }),
    ).not.toThrow();
  });
});

describe("PlaygroundRerankRequestSchema", () => {
  const base = {
    apiBaseUrl: "http://x",
    apiKey: "k",
    model: "m",
    query: "q",
    documents: ["a", "b"],
  };
  it("defaults wire to 'cohere'", () => {
    const out = PlaygroundRerankRequestSchema.parse(base);
    expect(out.wire).toBe("cohere");
  });
  it("rejects empty documents", () => {
    expect(() =>
      PlaygroundRerankRequestSchema.parse({ ...base, documents: [] }),
    ).toThrow();
  });
});

describe("PlaygroundRerankResponseSchema", () => {
  it("accepts results with index + score", () => {
    expect(() =>
      PlaygroundRerankResponseSchema.parse({
        success: true,
        results: [{ index: 0, score: 0.9 }],
        latencyMs: 5,
      }),
    ).not.toThrow();
  });
});

describe("PlaygroundImagesRequestSchema", () => {
  const base = { apiBaseUrl: "http://x", apiKey: "k", model: "m", prompt: "p" };
  it("accepts minimal request", () => {
    expect(() => PlaygroundImagesRequestSchema.parse(base)).not.toThrow();
  });
  it("validates n is positive int", () => {
    expect(() => PlaygroundImagesRequestSchema.parse({ ...base, n: 0 })).toThrow();
  });
  it("validates responseFormat enum", () => {
    expect(() =>
      PlaygroundImagesRequestSchema.parse({ ...base, responseFormat: "bogus" }),
    ).toThrow();
  });
});

describe("PlaygroundImagesResponseSchema", () => {
  it("accepts artifacts with url-only or b64-only entries", () => {
    expect(() =>
      PlaygroundImagesResponseSchema.parse({
        success: true,
        artifacts: [{ url: "http://a" }, { b64Json: "AAA" }],
        latencyMs: 50,
      }),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the contracts spec — confirm fail**

Run: `pnpm -F @modeldoctor/contracts test`
Expected: FAIL — `Cannot read properties of undefined (reading 'parse')`.

- [ ] **Step 3: Add the schemas to `packages/contracts/src/playground.ts`**

Append to `packages/contracts/src/playground.ts`:

```ts
// ─── Embeddings ───────────────────────────────────────────────────────────

export const PlaygroundEmbeddingsRequestSchema = z.object({
  apiBaseUrl: z.string().min(1),
  apiKey: z.string().min(1),
  model: z.string().min(1),
  customHeaders: z.string().optional(),
  queryParams: z.string().optional(),
  pathOverride: z.string().optional(),
  input: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  encodingFormat: z.enum(["float", "base64"]).optional(),
  dimensions: z.number().int().positive().optional(),
});
export type PlaygroundEmbeddingsRequest = z.infer<typeof PlaygroundEmbeddingsRequestSchema>;

export const PlaygroundEmbeddingsResponseSchema = z.object({
  success: z.boolean(),
  embeddings: z.array(z.array(z.number())).optional(),
  error: z.string().optional(),
  latencyMs: z.number(),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      total_tokens: z.number().optional(),
    })
    .optional(),
});
export type PlaygroundEmbeddingsResponse = z.infer<typeof PlaygroundEmbeddingsResponseSchema>;

// ─── Rerank ──────────────────────────────────────────────────────────────

export const PlaygroundRerankRequestSchema = z.object({
  apiBaseUrl: z.string().min(1),
  apiKey: z.string().min(1),
  model: z.string().min(1),
  customHeaders: z.string().optional(),
  queryParams: z.string().optional(),
  pathOverride: z.string().optional(),
  query: z.string().min(1),
  documents: z.array(z.string().min(1)).min(1),
  topN: z.number().int().positive().optional(),
  returnDocuments: z.boolean().optional(),
  wire: z.enum(["cohere", "tei"]).default("cohere"),
});
export type PlaygroundRerankRequest = z.infer<typeof PlaygroundRerankRequestSchema>;

export const PlaygroundRerankResponseSchema = z.object({
  success: z.boolean(),
  results: z
    .array(z.object({ index: z.number().int(), score: z.number() }))
    .optional(),
  error: z.string().optional(),
  latencyMs: z.number(),
});
export type PlaygroundRerankResponse = z.infer<typeof PlaygroundRerankResponseSchema>;

// ─── Images ──────────────────────────────────────────────────────────────

export const PlaygroundImagesRequestSchema = z.object({
  apiBaseUrl: z.string().min(1),
  apiKey: z.string().min(1),
  model: z.string().min(1),
  customHeaders: z.string().optional(),
  queryParams: z.string().optional(),
  pathOverride: z.string().optional(),
  prompt: z.string().min(1),
  size: z.string().optional(),
  n: z.number().int().positive().optional(),
  responseFormat: z.enum(["url", "b64_json"]).optional(),
  seed: z.number().int().optional(),
});
export type PlaygroundImagesRequest = z.infer<typeof PlaygroundImagesRequestSchema>;

export const PlaygroundImagesResponseSchema = z.object({
  success: z.boolean(),
  artifacts: z
    .array(
      z.object({
        url: z.string().optional(),
        b64Json: z.string().optional(),
      }),
    )
    .optional(),
  error: z.string().optional(),
  latencyMs: z.number(),
});
export type PlaygroundImagesResponse = z.infer<typeof PlaygroundImagesResponseSchema>;
```

- [ ] **Step 4: Re-run contracts tests**

Run: `pnpm -F @modeldoctor/contracts test`
Expected: PASS — all old + new cases green.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/playground.ts packages/contracts/src/playground.test.ts
git commit -m "$(cat <<'EOF'
feat(contracts/playground): add embeddings/rerank/images request+response schemas

Adds PlaygroundEmbeddings/Rerank/ImagesRequest+Response schemas. Rerank
defaults wire to 'cohere'; embeddings supports string or string[] input.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Build embeddings backend (controller + service + spec)

**Files:**
- Create: `apps/api/src/modules/playground/embeddings.service.ts`
- Create: `apps/api/src/modules/playground/embeddings.service.spec.ts`
- Create: `apps/api/src/modules/playground/embeddings.controller.ts`
- Modify: `apps/api/src/modules/playground/playground.module.ts`

- [ ] **Step 1: Write failing service spec**

Create `apps/api/src/modules/playground/embeddings.service.spec.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmbeddingsService } from "./embeddings.service.js";

describe("EmbeddingsService.run", () => {
  let svc: EmbeddingsService;
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    svc = new EmbeddingsService();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to {apiBaseUrl}/v1/embeddings with model+input", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }], usage: { prompt_tokens: 1 } }),
        { status: 200 },
      ),
    );
    const out = await svc.run({
      apiBaseUrl: "http://x.test",
      apiKey: "k",
      model: "m",
      input: "hello",
    });
    expect(out.success).toBe(true);
    expect(out.embeddings).toEqual([[0.1, 0.2, 0.3]]);
    expect(out.usage?.prompt_tokens).toBe(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://x.test/v1/embeddings");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ model: "m", input: "hello" });
  });

  it("forwards encodingFormat + dimensions when set", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: [{ embedding: [] }] }), { status: 200 }),
    );
    await svc.run({
      apiBaseUrl: "http://x",
      apiKey: "k",
      model: "m",
      input: ["a", "b"],
      encodingFormat: "base64",
      dimensions: 256,
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({
      model: "m",
      input: ["a", "b"],
      encoding_format: "base64",
      dimensions: 256,
    });
  });

  it("honours pathOverride for TEI-style endpoints", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    await svc.run({
      apiBaseUrl: "http://x",
      apiKey: "k",
      model: "m",
      input: "h",
      pathOverride: "/embed",
    });
    expect(fetchMock.mock.calls[0][0]).toBe("http://x/embed");
  });

  it("returns success=false on non-2xx", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 503 }));
    const out = await svc.run({
      apiBaseUrl: "http://x",
      apiKey: "k",
      model: "m",
      input: "h",
    });
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/503/);
  });

  it("returns success=false on network error", async () => {
    fetchMock.mockRejectedValue(new Error("kaboom"));
    const out = await svc.run({
      apiBaseUrl: "http://x",
      apiKey: "k",
      model: "m",
      input: "h",
    });
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/kaboom/);
  });
});
```

- [ ] **Step 2: Run — confirm it fails**

Run: `pnpm -F @modeldoctor/api test src/modules/playground/embeddings.service`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `embeddings.service.ts`**

Create `apps/api/src/modules/playground/embeddings.service.ts`:

```ts
import type {
  PlaygroundEmbeddingsRequest,
  PlaygroundEmbeddingsResponse,
} from "@modeldoctor/contracts";
import { Injectable } from "@nestjs/common";
import {
  buildPlaygroundEmbeddingsBody,
  buildHeaders,
  buildUrl,
  parseEmbeddingsResponse,
} from "../../integrations/openai-client/index.js";

const DEFAULT_PATH = "/v1/embeddings";
const MAX_ERROR_BODY_BYTES = 1024;

@Injectable()
export class EmbeddingsService {
  async run(req: PlaygroundEmbeddingsRequest): Promise<PlaygroundEmbeddingsResponse> {
    const url = buildUrl({
      apiBaseUrl: req.apiBaseUrl,
      defaultPath: DEFAULT_PATH,
      pathOverride: req.pathOverride,
      queryParams: req.queryParams,
    });
    const headers = buildHeaders(req.apiKey, req.customHeaders);
    const body = buildPlaygroundEmbeddingsBody({
      model: req.model,
      input: req.input,
      encodingFormat: req.encodingFormat,
      dimensions: req.dimensions,
    });
    const start = Date.now();
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const latencyMs = Date.now() - start;
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return {
          success: false,
          error: `upstream ${res.status}: ${text || res.statusText}`.slice(0, MAX_ERROR_BODY_BYTES),
          latencyMs,
        };
      }
      const json = await res.json();
      const parsed = parseEmbeddingsResponse(json);
      return {
        success: true,
        embeddings: parsed.embeddings,
        usage: parsed.usage,
        latencyMs,
      };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
        latencyMs: Date.now() - start,
      };
    }
  }
}
```

- [ ] **Step 4: Implement `embeddings.controller.ts`**

Create `apps/api/src/modules/playground/embeddings.controller.ts`:

```ts
import {
  type PlaygroundEmbeddingsRequest,
  PlaygroundEmbeddingsRequestSchema,
  type PlaygroundEmbeddingsResponse,
  PlaygroundEmbeddingsResponseSchema,
} from "@modeldoctor/contracts";
import { Body, Controller, HttpCode, HttpStatus, Post, UsePipes } from "@nestjs/common";
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { EmbeddingsService } from "./embeddings.service.js";

class PlaygroundEmbeddingsRequestDto extends createZodDto(PlaygroundEmbeddingsRequestSchema) {}
class PlaygroundEmbeddingsResponseDto extends createZodDto(PlaygroundEmbeddingsResponseSchema) {}

@ApiTags("playground")
@Controller("playground")
export class EmbeddingsController {
  constructor(private readonly svc: EmbeddingsService) {}

  @ApiOperation({ summary: "Generate embeddings via the Playground" })
  @ApiBody({ type: PlaygroundEmbeddingsRequestDto })
  @ApiOkResponse({ type: PlaygroundEmbeddingsResponseDto })
  @Post("embeddings")
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(PlaygroundEmbeddingsRequestSchema))
  embeddings(@Body() body: PlaygroundEmbeddingsRequest): Promise<PlaygroundEmbeddingsResponse> {
    return this.svc.run(body);
  }
}
```

- [ ] **Step 5: Wire into `playground.module.ts`**

Edit `apps/api/src/modules/playground/playground.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { ChatController } from "./chat.controller.js";
import { ChatService } from "./chat.service.js";
import { EmbeddingsController } from "./embeddings.controller.js";
import { EmbeddingsService } from "./embeddings.service.js";

@Module({
  controllers: [ChatController, EmbeddingsController],
  providers: [ChatService, EmbeddingsService],
})
export class PlaygroundModule {}
```

- [ ] **Step 6: Run — confirm pass**

Run: `pnpm -F @modeldoctor/api test src/modules/playground/embeddings.service`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/playground/embeddings.controller.ts apps/api/src/modules/playground/embeddings.service.ts apps/api/src/modules/playground/embeddings.service.spec.ts apps/api/src/modules/playground/playground.module.ts
git commit -m "$(cat <<'EOF'
feat(api/playground): POST /api/playground/embeddings

Backed by openai-client/wires/embeddings. Supports OpenAI-shape upstreams
(/v1/embeddings) and TEI-shape (/embed) via pathOverride.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Build rerank backend (controller + service + spec)

**Files:**
- Create: `apps/api/src/modules/playground/rerank.service.ts`
- Create: `apps/api/src/modules/playground/rerank.service.spec.ts`
- Create: `apps/api/src/modules/playground/rerank.controller.ts`
- Modify: `apps/api/src/modules/playground/playground.module.ts`

- [ ] **Step 1: Write failing service spec**

Create `apps/api/src/modules/playground/rerank.service.spec.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RerankService } from "./rerank.service.js";

describe("RerankService.run", () => {
  let svc: RerankService;
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    svc = new RerankService();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("cohere wire posts to /v1/rerank with documents+top_n", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ results: [{ index: 1, relevance_score: 0.9 }, { index: 0, relevance_score: 0.4 }] }),
        { status: 200 },
      ),
    );
    const out = await svc.run({
      apiBaseUrl: "http://x",
      apiKey: "k",
      model: "m",
      query: "q",
      documents: ["a", "b"],
      topN: 2,
      wire: "cohere",
    });
    expect(out.success).toBe(true);
    expect(out.results).toEqual([
      { index: 1, score: 0.9 },
      { index: 0, score: 0.4 },
    ]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://x/v1/rerank");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ model: "m", query: "q", documents: ["a", "b"], top_n: 2 });
  });

  it("tei wire posts to /rerank with texts and parses top-level array", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify([
          { index: 0, score: 0.8 },
          { index: 1, score: 0.2 },
        ]),
        { status: 200 },
      ),
    );
    const out = await svc.run({
      apiBaseUrl: "http://x",
      apiKey: "k",
      model: "m",
      query: "q",
      documents: ["a", "b"],
      wire: "tei",
    });
    expect(out.success).toBe(true);
    expect(out.results).toEqual([
      { index: 0, score: 0.8 },
      { index: 1, score: 0.2 },
    ]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://x/rerank");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      model: "m",
      query: "q",
      texts: ["a", "b"],
    });
  });

  it("returns success=false on non-2xx", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));
    const out = await svc.run({
      apiBaseUrl: "http://x",
      apiKey: "k",
      model: "m",
      query: "q",
      documents: ["a"],
      wire: "cohere",
    });
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/500/);
  });
});
```

- [ ] **Step 2: Run — confirm fail**

Run: `pnpm -F @modeldoctor/api test src/modules/playground/rerank.service`
Expected: FAIL.

- [ ] **Step 3: Implement `rerank.service.ts`**

```ts
import type {
  PlaygroundRerankRequest,
  PlaygroundRerankResponse,
} from "@modeldoctor/contracts";
import { Injectable } from "@nestjs/common";
import {
  buildHeaders,
  buildPlaygroundRerankBody,
  buildUrl,
  parseRerankResponse,
} from "../../integrations/openai-client/index.js";

const DEFAULT_PATH_COHERE = "/v1/rerank";
const DEFAULT_PATH_TEI = "/rerank";
const MAX_ERROR_BODY_BYTES = 1024;

@Injectable()
export class RerankService {
  async run(req: PlaygroundRerankRequest): Promise<PlaygroundRerankResponse> {
    const defaultPath = req.wire === "tei" ? DEFAULT_PATH_TEI : DEFAULT_PATH_COHERE;
    const url = buildUrl({
      apiBaseUrl: req.apiBaseUrl,
      defaultPath,
      pathOverride: req.pathOverride,
      queryParams: req.queryParams,
    });
    const headers = buildHeaders(req.apiKey, req.customHeaders);
    const body = buildPlaygroundRerankBody({
      model: req.model,
      query: req.query,
      documents: req.documents,
      topN: req.topN,
      returnDocuments: req.returnDocuments,
      wire: req.wire,
    });
    const start = Date.now();
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const latencyMs = Date.now() - start;
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return {
          success: false,
          error: `upstream ${res.status}: ${text || res.statusText}`.slice(0, MAX_ERROR_BODY_BYTES),
          latencyMs,
        };
      }
      const json = await res.json();
      const results = parseRerankResponse(json);
      return { success: true, results, latencyMs };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
        latencyMs: Date.now() - start,
      };
    }
  }
}
```

- [ ] **Step 4: Implement `rerank.controller.ts`**

```ts
import {
  type PlaygroundRerankRequest,
  PlaygroundRerankRequestSchema,
  type PlaygroundRerankResponse,
  PlaygroundRerankResponseSchema,
} from "@modeldoctor/contracts";
import { Body, Controller, HttpCode, HttpStatus, Post, UsePipes } from "@nestjs/common";
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { RerankService } from "./rerank.service.js";

class PlaygroundRerankRequestDto extends createZodDto(PlaygroundRerankRequestSchema) {}
class PlaygroundRerankResponseDto extends createZodDto(PlaygroundRerankResponseSchema) {}

@ApiTags("playground")
@Controller("playground")
export class RerankController {
  constructor(private readonly svc: RerankService) {}

  @ApiOperation({ summary: "Rerank documents via the Playground (cohere or tei wire)" })
  @ApiBody({ type: PlaygroundRerankRequestDto })
  @ApiOkResponse({ type: PlaygroundRerankResponseDto })
  @Post("rerank")
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(PlaygroundRerankRequestSchema))
  rerank(@Body() body: PlaygroundRerankRequest): Promise<PlaygroundRerankResponse> {
    return this.svc.run(body);
  }
}
```

- [ ] **Step 5: Add to `playground.module.ts` controllers + providers arrays**

Edit `apps/api/src/modules/playground/playground.module.ts` — add `RerankController` to controllers and `RerankService` to providers (keep alphabetical / existing order).

- [ ] **Step 6: Run + commit**

Run: `pnpm -F @modeldoctor/api test src/modules/playground/rerank.service`
Expected: PASS.

```bash
git add apps/api/src/modules/playground/rerank.controller.ts apps/api/src/modules/playground/rerank.service.ts apps/api/src/modules/playground/rerank.service.spec.ts apps/api/src/modules/playground/playground.module.ts
git commit -m "$(cat <<'EOF'
feat(api/playground): POST /api/playground/rerank (cohere + tei wires)

Backed by openai-client/wires/rerank. Default paths: /v1/rerank for
cohere, /rerank for tei. Both shapes parse to a unified [{index, score}].

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Build images backend (controller + service + spec)

**Files:**
- Create: `apps/api/src/modules/playground/images.service.ts`
- Create: `apps/api/src/modules/playground/images.service.spec.ts`
- Create: `apps/api/src/modules/playground/images.controller.ts`
- Modify: `apps/api/src/modules/playground/playground.module.ts`

- [ ] **Step 1: Write failing spec**

Create `apps/api/src/modules/playground/images.service.spec.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImagesService } from "./images.service.js";

describe("ImagesService.run", () => {
  let svc: ImagesService;
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    svc = new ImagesService();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to {apiBaseUrl}/v1/images/generations with prompt+size+n", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ url: "http://image/0" }] }),
        { status: 200 },
      ),
    );
    const out = await svc.run({
      apiBaseUrl: "http://x",
      apiKey: "k",
      model: "m",
      prompt: "a red apple",
      size: "512x512",
      n: 1,
    });
    expect(out.success).toBe(true);
    expect(out.artifacts).toEqual([{ url: "http://image/0", b64Json: undefined }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://x/v1/images/generations");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ model: "m", prompt: "a red apple", size: "512x512", n: 1 });
  });

  it("forwards responseFormat + seed when set", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: "AAA" }] }), { status: 200 }),
    );
    await svc.run({
      apiBaseUrl: "http://x",
      apiKey: "k",
      model: "m",
      prompt: "p",
      responseFormat: "b64_json",
      seed: 42,
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({ response_format: "b64_json", seed: 42 });
  });

  it("returns success=false on non-2xx", async () => {
    fetchMock.mockResolvedValue(new Response("denied", { status: 403 }));
    const out = await svc.run({
      apiBaseUrl: "http://x",
      apiKey: "k",
      model: "m",
      prompt: "p",
    });
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/403/);
  });
});
```

- [ ] **Step 2: Confirm fail, implement service**

Run + create `apps/api/src/modules/playground/images.service.ts`:

```ts
import type {
  PlaygroundImagesRequest,
  PlaygroundImagesResponse,
} from "@modeldoctor/contracts";
import { Injectable } from "@nestjs/common";
import {
  buildHeaders,
  buildPlaygroundImagesBody,
  buildUrl,
  parseImagesResponse,
} from "../../integrations/openai-client/index.js";

const DEFAULT_PATH = "/v1/images/generations";
const MAX_ERROR_BODY_BYTES = 1024;

@Injectable()
export class ImagesService {
  async run(req: PlaygroundImagesRequest): Promise<PlaygroundImagesResponse> {
    const url = buildUrl({
      apiBaseUrl: req.apiBaseUrl,
      defaultPath: DEFAULT_PATH,
      pathOverride: req.pathOverride,
      queryParams: req.queryParams,
    });
    const headers = buildHeaders(req.apiKey, req.customHeaders);
    const body = buildPlaygroundImagesBody({
      model: req.model,
      prompt: req.prompt,
      size: req.size,
      n: req.n,
      responseFormat: req.responseFormat,
      seed: req.seed,
    });
    const start = Date.now();
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const latencyMs = Date.now() - start;
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return {
          success: false,
          error: `upstream ${res.status}: ${text || res.statusText}`.slice(0, MAX_ERROR_BODY_BYTES),
          latencyMs,
        };
      }
      const json = await res.json();
      const artifacts = parseImagesResponse(json);
      return { success: true, artifacts, latencyMs };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
        latencyMs: Date.now() - start,
      };
    }
  }
}
```

- [ ] **Step 3: Implement `images.controller.ts`**

```ts
import {
  type PlaygroundImagesRequest,
  PlaygroundImagesRequestSchema,
  type PlaygroundImagesResponse,
  PlaygroundImagesResponseSchema,
} from "@modeldoctor/contracts";
import { Body, Controller, HttpCode, HttpStatus, Post, UsePipes } from "@nestjs/common";
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { ImagesService } from "./images.service.js";

class PlaygroundImagesRequestDto extends createZodDto(PlaygroundImagesRequestSchema) {}
class PlaygroundImagesResponseDto extends createZodDto(PlaygroundImagesResponseSchema) {}

@ApiTags("playground")
@Controller("playground")
export class ImagesController {
  constructor(private readonly svc: ImagesService) {}

  @ApiOperation({ summary: "Generate images via the Playground" })
  @ApiBody({ type: PlaygroundImagesRequestDto })
  @ApiOkResponse({ type: PlaygroundImagesResponseDto })
  @Post("images")
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(PlaygroundImagesRequestSchema))
  images(@Body() body: PlaygroundImagesRequest): Promise<PlaygroundImagesResponse> {
    return this.svc.run(body);
  }
}
```

- [ ] **Step 4: Wire into `playground.module.ts`**

Append `ImagesController` and `ImagesService`. Final file:

```ts
import { Module } from "@nestjs/common";
import { ChatController } from "./chat.controller.js";
import { ChatService } from "./chat.service.js";
import { EmbeddingsController } from "./embeddings.controller.js";
import { EmbeddingsService } from "./embeddings.service.js";
import { ImagesController } from "./images.controller.js";
import { ImagesService } from "./images.service.js";
import { RerankController } from "./rerank.controller.js";
import { RerankService } from "./rerank.service.js";

@Module({
  controllers: [ChatController, EmbeddingsController, RerankController, ImagesController],
  providers: [ChatService, EmbeddingsService, RerankService, ImagesService],
})
export class PlaygroundModule {}
```

- [ ] **Step 5: Run full api suite + commit**

Run: `pnpm -F @modeldoctor/api test`
Expected: PASS — all green including new images cases.

```bash
git add apps/api/src/modules/playground/images.controller.ts apps/api/src/modules/playground/images.service.ts apps/api/src/modules/playground/images.service.spec.ts apps/api/src/modules/playground/playground.module.ts
git commit -m "$(cat <<'EOF'
feat(api/playground): POST /api/playground/images

Backed by openai-client/wires/images. Default path /v1/images/generations.
Returns artifacts as [{url?, b64Json?}].

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Frontend SSE helper `lib/playground-stream.ts`

**Files:**
- Create: `apps/web/src/lib/playground-stream.ts`
- Create: `apps/web/src/lib/playground-stream.test.ts`

**Why:** `EventSource` does not support POST / Authorization headers, so we use `fetch` + `reader.read()` and parse SSE event boundaries manually. Wraps token-aware retry by reusing `useAuthStore` access token (mirrors `lib/api-client.ts`).

- [ ] **Step 1: Write failing test**

Create `apps/web/src/lib/playground-stream.test.ts`:

```ts
import { useAuthStore } from "@/stores/auth-store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { playgroundFetchStream } from "./playground-stream";

function makeSseResponse(events: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const e of events) c.enqueue(encoder.encode(e));
      c.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("playgroundFetchStream", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    useAuthStore.setState({ accessToken: "tok" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    useAuthStore.setState({ accessToken: null });
  });

  it("posts JSON body with bearer token, then yields SSE 'data:' frames", async () => {
    fetchMock.mockResolvedValue(
      makeSseResponse([
        'data: {"choices":[{"delta":{"content":"he"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"llo"}}]}\n\n',
        "data: [DONE]\n\n",
      ]),
    );
    const events: string[] = [];
    const ac = new AbortController();
    await playgroundFetchStream({
      path: "/api/playground/chat",
      body: { hello: "world" },
      signal: ac.signal,
      onSseEvent: (data) => events.push(data),
    });
    expect(events).toEqual([
      '{"choices":[{"delta":{"content":"he"}}]}',
      '{"choices":[{"delta":{"content":"llo"}}]}',
      "[DONE]",
    ]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/playground/chat");
    expect((init as RequestInit).method).toBe("POST");
    const headers = (init as RequestInit).headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer tok");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect((init as RequestInit).body).toBe(JSON.stringify({ hello: "world" }));
  });

  it("throws on non-2xx with the upstream body in the message", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));
    await expect(
      playgroundFetchStream({
        path: "/x",
        body: {},
        signal: new AbortController().signal,
        onSseEvent: () => {},
      }),
    ).rejects.toThrow(/500.*nope/);
  });

  it("reassembles events split across chunks", async () => {
    fetchMock.mockResolvedValue(
      makeSseResponse(["data: hel", "lo\n", "\ndata: world\n\n"]),
    );
    const events: string[] = [];
    await playgroundFetchStream({
      path: "/x",
      body: {},
      signal: new AbortController().signal,
      onSseEvent: (d) => events.push(d),
    });
    expect(events).toEqual(["hello", "world"]);
  });

  it("respects AbortSignal: throws AbortError after caller aborts", async () => {
    let cancelled = false;
    fetchMock.mockImplementation((_url, init: RequestInit) => {
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode("data: 1\n\n"));
        },
        cancel() {
          cancelled = true;
        },
      });
      const sig = init.signal as AbortSignal;
      sig.addEventListener("abort", () => {});
      return Promise.resolve(new Response(stream, { status: 200 }));
    });

    const ac = new AbortController();
    const p = playgroundFetchStream({
      path: "/x",
      body: {},
      signal: ac.signal,
      onSseEvent: () => {
        ac.abort();
      },
    });
    await expect(p).rejects.toThrow(/abort/i);
    expect(cancelled).toBe(true);
  });
});
```

- [ ] **Step 2: Confirm fail**

Run: `pnpm -F @modeldoctor/web test src/lib/playground-stream`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `playground-stream.ts`**

Create `apps/web/src/lib/playground-stream.ts`:

```ts
import { useAuthStore } from "@/stores/auth-store";

export interface PlaygroundFetchStreamInput {
  path: string;
  body: unknown;
  signal: AbortSignal;
  onSseEvent: (data: string) => void;
}

/**
 * POSTs body to path and parses the SSE response, invoking onSseEvent for
 * each `data: <payload>` line. Caller passes an AbortSignal to stop the
 * stream; we cancel the underlying reader on abort.
 *
 * Used for /api/playground/chat with stream:true. EventSource is not used
 * because it does not support POST or Authorization headers.
 */
export async function playgroundFetchStream({
  path,
  body,
  signal,
  onSseEvent,
}: PlaygroundFetchStreamInput): Promise<void> {
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  const tok = useAuthStore.getState().accessToken;
  if (tok) headers.set("Authorization", `Bearer ${tok}`);
  const res = await fetch(path, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    credentials: "include",
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }
  if (!res.body) {
    throw new Error("Stream response had no body");
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const onAbort = () => {
    reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // Split by SSE event boundary: \n\n
      let idx = buf.indexOf("\n\n");
      while (idx !== -1) {
        const event = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of event.split("\n")) {
          if (line.startsWith("data:")) onSseEvent(line.slice(5).trimStart());
        }
        idx = buf.indexOf("\n\n");
      }
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
}
```

- [ ] **Step 4: Run + iterate**

Run: `pnpm -F @modeldoctor/web test src/lib/playground-stream`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/playground-stream.ts apps/web/src/lib/playground-stream.test.ts
git commit -m "$(cat <<'EOF'
feat(web/lib): playgroundFetchStream — POST + SSE reader

Wraps fetch+reader for /api/playground/chat streaming. Parses SSE 'data:'
frames across chunk boundaries, supports AbortSignal cancellation,
and pulls the bearer token from useAuthStore.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: `ChatStore` overhaul: streaming + abort + appendAssistantToken

**Files:**
- Modify: `apps/web/src/features/playground/chat/store.ts`
- Modify: `apps/web/src/features/playground/chat/store.test.ts`

The store gains: `streaming` flag, `abortController?: AbortController`, `appendAssistantToken(s: string)` (appends to last assistant message or starts a new one), and `setStreaming(b)` / `setAbortController(ac | null)` actions. The existing `sending` flag is repurposed as "any in-flight request, streaming or not"; `streaming` is true only for SSE in-flight.

- [ ] **Step 1: Append failing tests**

Append to `apps/web/src/features/playground/chat/store.test.ts`:

```ts
describe("ChatStore — streaming additions", () => {
  beforeEach(() => useChatStore.getState().reset());

  it("appendAssistantToken creates a new assistant message if last is not assistant", () => {
    useChatStore.getState().appendMessage({ role: "user", content: "hi" });
    useChatStore.getState().appendAssistantToken("hel");
    expect(useChatStore.getState().messages.at(-1)).toEqual({
      role: "assistant",
      content: "hel",
    });
  });

  it("appendAssistantToken extends the last assistant message", () => {
    useChatStore.getState().appendAssistantToken("hel");
    useChatStore.getState().appendAssistantToken("lo");
    expect(useChatStore.getState().messages).toEqual([
      { role: "assistant", content: "hello" },
    ]);
  });

  it("setStreaming + setAbortController track stream lifecycle", () => {
    const ac = new AbortController();
    useChatStore.getState().setStreaming(true);
    useChatStore.getState().setAbortController(ac);
    expect(useChatStore.getState().streaming).toBe(true);
    expect(useChatStore.getState().abortController).toBe(ac);
    useChatStore.getState().setStreaming(false);
    useChatStore.getState().setAbortController(null);
    expect(useChatStore.getState().abortController).toBeNull();
  });

  it("reset clears streaming + abortController", () => {
    useChatStore.getState().setStreaming(true);
    useChatStore.getState().setAbortController(new AbortController());
    useChatStore.getState().reset();
    expect(useChatStore.getState().streaming).toBe(false);
    expect(useChatStore.getState().abortController).toBeNull();
  });
});
```

- [ ] **Step 2: Confirm fail**

Run: `pnpm -F @modeldoctor/web test src/features/playground/chat/store`
Expected: FAIL — actions don't exist.

- [ ] **Step 3: Replace `store.ts`**

Replace `apps/web/src/features/playground/chat/store.ts`:

```ts
import type { ChatMessage, ChatParams } from "@modeldoctor/contracts";
import { create } from "zustand";

export const DEFAULT_CHAT_PARAMS: ChatParams = {
  temperature: 1,
  maxTokens: 1024,
  topP: 1,
  frequencyPenalty: 0,
  presencePenalty: 0,
  stream: true,
};

export interface ChatStoreState {
  selectedConnectionId: string | null;
  systemMessage: string;
  messages: ChatMessage[];
  params: ChatParams;
  sending: boolean;
  streaming: boolean;
  abortController: AbortController | null;
  error: string | null;
  setSelected: (id: string | null) => void;
  setSystemMessage: (s: string) => void;
  appendMessage: (m: ChatMessage) => void;
  appendAssistantToken: (s: string) => void;
  clearMessages: () => void;
  patchParams: (p: Partial<ChatParams>) => void;
  setSending: (b: boolean) => void;
  setStreaming: (b: boolean) => void;
  setAbortController: (ac: AbortController | null) => void;
  setError: (s: string | null) => void;
  reset: () => void;
}

const initial = {
  selectedConnectionId: null,
  systemMessage: "",
  messages: [] as ChatMessage[],
  params: { ...DEFAULT_CHAT_PARAMS },
  sending: false,
  streaming: false,
  abortController: null as AbortController | null,
  error: null as string | null,
};

export const useChatStore = create<ChatStoreState>((set) => ({
  ...initial,
  setSelected: (id) => set({ selectedConnectionId: id }),
  setSystemMessage: (s) => set({ systemMessage: s }),
  appendMessage: (m) => set((s) => ({ messages: [...s.messages, m] })),
  appendAssistantToken: (token) =>
    set((s) => {
      const last = s.messages.at(-1);
      if (last && last.role === "assistant" && typeof last.content === "string") {
        const updated: ChatMessage = { ...last, content: last.content + token };
        return { messages: [...s.messages.slice(0, -1), updated] };
      }
      return {
        messages: [...s.messages, { role: "assistant", content: token }],
      };
    }),
  clearMessages: () => set({ messages: [] }),
  patchParams: (p) => set((s) => ({ params: { ...s.params, ...p } })),
  setSending: (b) => set({ sending: b }),
  setStreaming: (b) => set({ streaming: b }),
  setAbortController: (ac) => set({ abortController: ac }),
  setError: (e) => set({ error: e }),
  reset: () => set({ ...initial }),
}));
```

- [ ] **Step 4: Run — confirm pass**

Run: `pnpm -F @modeldoctor/web test src/features/playground/chat/store`
Expected: PASS — old + new cases green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/playground/chat/store.ts apps/web/src/features/playground/chat/store.test.ts
git commit -m "$(cat <<'EOF'
feat(web/playground/chat/store): streaming + abort + appendAssistantToken

Adds streaming/abortController state plus appendAssistantToken which
extends the last assistant message in-place (or starts a new one). Also
flips DEFAULT_CHAT_PARAMS.stream to true.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Rewrite `ChatPage.onSend` (de-stale-closure + Stop button + SSE branch)

**Files:**
- Modify: `apps/web/src/features/playground/chat/ChatPage.tsx`
- Modify: `apps/web/src/features/playground/chat/MessageComposer.tsx`
- Modify: `apps/web/src/features/playground/chat/ChatPage.test.tsx`

**The stale-closure bug:** today `ChatPage` reads `slice = useChatStore()`, then inside `onSend` reads `slice.messages` to assemble the request body. `slice.messages` is the array as of the render that produced the click handler — for non-streaming this happens to work because each user click triggers a re-render before the next click, but for SSE streaming many state updates happen between renders, and any handler that captured an old `slice` will see a stale messages list (e.g. the user's previous-turn assistant content is missing). Fix: always read via `useChatStore.getState()` inside the callback.

**Stop button:** while `streaming` is true, render a Stop button that calls `state.abortController?.abort()`. The existing Send button hides.

- [ ] **Step 1: Append failing test cases for Stop and SSE**

Append to `apps/web/src/features/playground/chat/ChatPage.test.tsx`:

```ts
describe("ChatPage streaming", () => {
  beforeEach(() => {
    localStorage.clear();
    useConnectionsStore.setState({ connections: [] });
    useChatStore.getState().reset();
    vi.mocked(api.post).mockReset();
  });

  it("streams SSE tokens into the assistant message and the Stop button aborts", async () => {
    seedChatConn();
    // Mock playgroundFetchStream by hijacking fetch
    const encoder = new TextEncoder();
    let abortedByCaller = false;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        const stream = new ReadableStream<Uint8Array>({
          async start(c) {
            c.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"hel"}}]}\n\n'));
            // Wait for caller abort
            await new Promise<void>((resolve) => {
              (init.signal as AbortSignal).addEventListener(
                "abort",
                () => {
                  abortedByCaller = true;
                  resolve();
                },
                { once: true },
              );
            });
          },
          cancel() {},
        });
        return Promise.resolve(new Response(stream, { status: 200 }));
      }),
    );

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ChatPage />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: /chat-1/i }));
    await user.type(screen.getByPlaceholderText(/type your message|输入消息/i), "hi");
    await user.click(screen.getByRole("button", { name: /^send$|^发送$/i }));

    await waitFor(() => expect(screen.getByText(/^hel$/)).toBeInTheDocument());

    // Stop button visible while streaming
    const stopBtn = await screen.findByRole("button", { name: /^stop$|^停止$/i });
    await user.click(stopBtn);
    await waitFor(() => expect(abortedByCaller).toBe(true));
    vi.unstubAllGlobals();
  });

  it("multi-turn after abort: turn 2 includes turn-1 user + partial assistant + turn-2 user", async () => {
    seedChatConn();
    const calls: Array<{ messages: Array<{ role: string; content: string }> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string) as {
          messages: Array<{ role: string; content: string }>;
        };
        calls.push(body);
        const enc = new TextEncoder();
        const sig = init.signal as AbortSignal;
        const stream = new ReadableStream<Uint8Array>({
          async start(c) {
            c.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"R' + calls.length + '"}}]}\n\n'));
            await new Promise<void>((resolve) =>
              sig.addEventListener("abort", () => resolve(), { once: true }),
            );
          },
        });
        return Promise.resolve(new Response(stream, { status: 200 }));
      }),
    );

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ChatPage />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: /chat-1/i }));

    // Turn 1
    const input = screen.getByPlaceholderText(/type your message|输入消息/i);
    await user.type(input, "hi 1");
    await user.click(screen.getByRole("button", { name: /^send$|^发送$/i }));
    await waitFor(() => expect(screen.getByText(/^R1$/)).toBeInTheDocument());
    await user.click(await screen.findByRole("button", { name: /^stop$|^停止$/i }));

    // Turn 2 — should send [user-hi-1, assistant-R1, user-hi-2]
    await waitFor(() => expect(screen.getByRole("button", { name: /^send$|^发送$/i })).toBeEnabled());
    await user.type(input, "hi 2");
    await user.click(screen.getByRole("button", { name: /^send$|^发送$/i }));

    await waitFor(() => expect(calls.length).toBe(2));
    expect(calls[1].messages).toEqual([
      { role: "user", content: "hi 1" },
      { role: "assistant", content: "R1" },
      { role: "user", content: "hi 2" },
    ]);
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run — confirm fails (no Stop button, no streaming wiring)**

Run: `pnpm -F @modeldoctor/web test src/features/playground/chat/ChatPage`
Expected: FAIL on the new cases.

- [ ] **Step 3: Update `MessageComposer.tsx`**

Edit signature + body so the Send button swaps to a Stop button while streaming:

```tsx
interface MessageComposerProps {
  systemMessage: string;
  onSystemMessageChange: (s: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  sending: boolean;
  streaming: boolean;
  disabled: boolean;
  disabledReason?: string;
}

export function MessageComposer({
  systemMessage,
  onSystemMessageChange,
  onSend,
  onStop,
  sending,
  streaming,
  disabled,
  disabledReason,
}: MessageComposerProps) {
  const { t } = useTranslation("playground");
  const [draft, setDraft] = useState("");

  const submit = () => {
    if (disabled || sending) return;
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft("");
  };

  return (
    <div className="border-t border-border bg-card px-6 py-3">
      <details className="mb-2">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
          {t("chat.system.label")}
        </summary>
        <Textarea
          rows={2}
          value={systemMessage}
          onChange={(e) => onSystemMessageChange(e.target.value)}
          placeholder={t("chat.system.placeholder")}
          className="mt-2 font-mono text-xs"
        />
      </details>
      <div className="flex gap-2">
        <Textarea
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !streaming) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={t("chat.composer.placeholder")}
          className="text-sm"
          disabled={disabled || sending}
        />
        {streaming ? (
          <Button variant="destructive" onClick={onStop}>
            {t("chat.composer.stop")}
          </Button>
        ) : (
          <Button
            onClick={submit}
            disabled={disabled || sending || !draft.trim()}
            title={disabled ? disabledReason : undefined}
          >
            {sending ? t("chat.composer.sending") : t("chat.composer.send")}
          </Button>
        )}
      </div>
      {disabled && disabledReason ? (
        <output className="mt-1 block text-[11px] text-muted-foreground">{disabledReason}</output>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Rewrite `ChatPage.onSend`**

Replace `apps/web/src/features/playground/chat/ChatPage.tsx`:

```tsx
import { PageHeader } from "@/components/common/page-header";
import { ApiError, api } from "@/lib/api-client";
import { playgroundFetchStream } from "@/lib/playground-stream";
import { useConnectionsStore } from "@/stores/connections-store";
import type {
  ChatMessage,
  PlaygroundChatRequest,
  PlaygroundChatResponse,
} from "@modeldoctor/contracts";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CategoryEndpointSelector } from "../CategoryEndpointSelector";
import { PlaygroundShell } from "../PlaygroundShell";
import { ChatParams } from "./ChatParams";
import { MessageComposer } from "./MessageComposer";
import { MessageList } from "./MessageList";
import { useChatStore } from "./store";

export function ChatPage() {
  const { t } = useTranslation("playground");
  const slice = useChatStore();
  const conn = useConnectionsStore((s) =>
    slice.selectedConnectionId ? s.get(slice.selectedConnectionId) : null,
  );

  const canSend = !!conn;
  const disabledReason = canSend ? undefined : t("chat.composer.needConnection");

  const onSend = async (text: string) => {
    // Read everything fresh from the store to avoid stale-closure bugs.
    const fresh = useChatStore.getState();
    const connNow = fresh.selectedConnectionId
      ? useConnectionsStore.getState().get(fresh.selectedConnectionId)
      : null;
    if (!connNow) return;

    fresh.appendMessage({ role: "user", content: text });
    fresh.setSending(true);
    fresh.setError(null);

    // After the appendMessage above, the freshest messages list is:
    const stateAfterAppend = useChatStore.getState();
    const messages: ChatMessage[] = [
      ...(stateAfterAppend.systemMessage.trim()
        ? [{ role: "system" as const, content: stateAfterAppend.systemMessage.trim() }]
        : []),
      ...stateAfterAppend.messages,
    ];

    const body: PlaygroundChatRequest = {
      apiBaseUrl: connNow.apiBaseUrl,
      apiKey: connNow.apiKey,
      model: connNow.model,
      customHeaders: connNow.customHeaders || undefined,
      queryParams: connNow.queryParams || undefined,
      messages,
      params: stateAfterAppend.params,
    };

    if (stateAfterAppend.params.stream) {
      const ac = new AbortController();
      fresh.setStreaming(true);
      fresh.setAbortController(ac);
      try {
        await playgroundFetchStream({
          path: "/api/playground/chat",
          body,
          signal: ac.signal,
          onSseEvent: (data) => {
            if (data === "[DONE]") return;
            try {
              const evt = JSON.parse(data) as {
                choices?: Array<{ delta?: { content?: string } }>;
              };
              const tok = evt.choices?.[0]?.delta?.content;
              if (tok) useChatStore.getState().appendAssistantToken(tok);
            } catch {
              // Ignore non-JSON SSE comments.
            }
          },
        });
      } catch (e) {
        // AbortError is expected when user clicks Stop; do not toast.
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          const msg = e instanceof Error ? e.message : "stream failed";
          useChatStore.getState().setError(msg);
          toast.error(t("chat.errors.send", { message: msg }));
        }
      } finally {
        const s = useChatStore.getState();
        s.setStreaming(false);
        s.setAbortController(null);
        s.setSending(false);
      }
      return;
    }

    // Non-streaming path
    try {
      const res = await api.post<PlaygroundChatResponse>("/api/playground/chat", body);
      if (res.success) {
        useChatStore.getState().appendMessage({
          role: "assistant",
          content: res.content ?? "",
        });
      } else {
        const msg = res.error ?? "unknown";
        useChatStore.getState().setError(msg);
        toast.error(t("chat.errors.send", { message: msg }));
      }
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "network";
      useChatStore.getState().setError(msg);
      toast.error(t("chat.errors.send", { message: msg }));
    } finally {
      useChatStore.getState().setSending(false);
    }
  };

  const onStop = () => {
    useChatStore.getState().abortController?.abort();
  };

  return (
    <PlaygroundShell
      category="chat"
      paramsSlot={
        <div className="space-y-4">
          <CategoryEndpointSelector
            category="chat"
            selectedConnectionId={slice.selectedConnectionId}
            onSelect={slice.setSelected}
          />
          <ChatParams value={slice.params} onChange={slice.patchParams} />
        </div>
      }
    >
      <PageHeader title={t("chat.title")} subtitle={t("chat.subtitle")} />
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto">
          <MessageList messages={slice.messages} />
          {slice.error ? (
            <div className="mx-6 mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {slice.error}
            </div>
          ) : null}
        </div>
        <MessageComposer
          systemMessage={slice.systemMessage}
          onSystemMessageChange={slice.setSystemMessage}
          onSend={onSend}
          onStop={onStop}
          sending={slice.sending}
          streaming={slice.streaming}
          disabled={!canSend}
          disabledReason={disabledReason}
        />
      </div>
    </PlaygroundShell>
  );
}
```

- [ ] **Step 5: Add i18n key for Stop**

Edit `apps/web/src/locales/en-US/playground.json` — add `chat.composer.stop: "Stop"`.
Edit `apps/web/src/locales/zh-CN/playground.json` — add `chat.composer.stop: "停止"`.

(The full i18n consolidation is in Task 25; this minimum lets the new tests resolve the translated label.)

- [ ] **Step 6: Run — confirm pass**

Run: `pnpm -F @modeldoctor/web test src/features/playground/chat`
Expected: PASS — old multi-turn + new SSE/Stop/multi-turn-after-abort cases green.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/playground/chat/ChatPage.tsx apps/web/src/features/playground/chat/MessageComposer.tsx apps/web/src/features/playground/chat/ChatPage.test.tsx apps/web/src/locales/en-US/playground.json apps/web/src/locales/zh-CN/playground.json
git commit -m "$(cat <<'EOF'
feat(web/playground/chat): SSE streaming + Stop button + de-stale onSend

Rewrites ChatPage.onSend to read state via useChatStore.getState() inside
the callback (eliminates the slice-closure that went stale across SSE
chunk arrivals). Adds an SSE branch via playgroundFetchStream and a Stop
button that aborts the in-flight controller.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: `createHistoryStore<S>()` factory + tests

**Files:**
- Create: `apps/web/src/features/playground/history/createHistoryStore.ts`
- Create: `apps/web/src/features/playground/history/createHistoryStore.test.ts`

The factory returns a zustand persist store keyed by `localStorage` name. Per spec § 5.7: list[0] is always "current", debounced auto-save merges into list[0]; explicit "new session" prepends a fresh blank; restoring an older entry copies its snapshot into list[0]; LRU at 20.

- [ ] **Step 1: Write failing test**

Create `apps/web/src/features/playground/history/createHistoryStore.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHistoryStore } from "./createHistoryStore";

interface DummySnap {
  text: string;
}

describe("createHistoryStore", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("seeds with one current empty entry on first read", () => {
    const useStore = createHistoryStore<DummySnap>({
      name: "md-test-history",
      blank: () => ({ text: "" }),
      preview: (s) => s.text,
    });
    const list = useStore.getState().list;
    expect(list).toHaveLength(1);
    expect(list[0].snapshot).toEqual({ text: "" });
    expect(useStore.getState().currentId).toBe(list[0].id);
  });

  it("save() updates the current (top) entry's snapshot+preview", () => {
    const useStore = createHistoryStore<DummySnap>({
      name: "md-test-history-2",
      blank: () => ({ text: "" }),
      preview: (s) => s.text.slice(0, 10),
    });
    const id = useStore.getState().currentId;
    useStore.getState().save({ text: "hello world" });
    const top = useStore.getState().list[0];
    expect(top.id).toBe(id); // same id, mutated in place
    expect(top.snapshot.text).toBe("hello world");
    expect(top.preview).toBe("hello worl");
  });

  it("newSession() prepends a fresh blank and switches currentId", () => {
    const useStore = createHistoryStore<DummySnap>({
      name: "md-test-history-3",
      blank: () => ({ text: "" }),
      preview: (s) => s.text,
    });
    useStore.getState().save({ text: "old" });
    const oldId = useStore.getState().currentId;
    useStore.getState().newSession();
    const list = useStore.getState().list;
    expect(list).toHaveLength(2);
    expect(list[0].snapshot.text).toBe("");
    expect(list[1].id).toBe(oldId);
    expect(useStore.getState().currentId).toBe(list[0].id);
  });

  it("restore(id) copies that entry's snapshot into the current top entry", () => {
    const useStore = createHistoryStore<DummySnap>({
      name: "md-test-history-4",
      blank: () => ({ text: "" }),
      preview: (s) => s.text,
    });
    useStore.getState().save({ text: "first" });
    useStore.getState().newSession();
    useStore.getState().save({ text: "second" });
    const oldId = useStore.getState().list[1].id;
    useStore.getState().restore(oldId);
    expect(useStore.getState().list[0].snapshot.text).toBe("first");
    // Original "first" entry remains in list (not deleted)
    expect(useStore.getState().list.some((e) => e.id === oldId)).toBe(true);
  });

  it("LRU caps the list at 20 entries", () => {
    const useStore = createHistoryStore<DummySnap>({
      name: "md-test-history-5",
      blank: () => ({ text: "" }),
      preview: (s) => s.text,
    });
    for (let i = 0; i < 25; i++) {
      useStore.getState().save({ text: `s${i}` });
      useStore.getState().newSession();
    }
    expect(useStore.getState().list).toHaveLength(20);
  });

  it("scheduleAutoSave debounces rapid save calls", async () => {
    vi.useFakeTimers();
    try {
      const useStore = createHistoryStore<DummySnap>({
        name: "md-test-history-6",
        blank: () => ({ text: "" }),
        preview: (s) => s.text,
      });
      useStore.getState().scheduleAutoSave({ text: "a" });
      useStore.getState().scheduleAutoSave({ text: "ab" });
      useStore.getState().scheduleAutoSave({ text: "abc" });
      vi.advanceTimersByTime(1499);
      expect(useStore.getState().list[0].snapshot.text).toBe("");
      vi.advanceTimersByTime(1);
      expect(useStore.getState().list[0].snapshot.text).toBe("abc");
    } finally {
      vi.useRealTimers();
    }
  });
});
```

- [ ] **Step 2: Confirm fail**

Run: `pnpm -F @modeldoctor/web test src/features/playground/history/createHistoryStore`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `createHistoryStore.ts`**

Create `apps/web/src/features/playground/history/createHistoryStore.ts`:

```ts
import { create, type StoreApi, type UseBoundStore } from "zustand";
import { persist } from "zustand/middleware";

export interface HistoryEntry<S> {
  id: string;
  createdAt: string;
  preview: string;
  snapshot: S;
}

export interface HistoryStoreState<S> {
  list: HistoryEntry<S>[];
  currentId: string;
  save: (snapshot: S) => void;
  scheduleAutoSave: (snapshot: S) => void;
  newSession: () => void;
  restore: (id: string) => void;
  reset: () => void;
}

export interface CreateHistoryStoreInput<S> {
  /** localStorage key — must be unique per modality. */
  name: string;
  /** Returns a fresh blank snapshot for new sessions. */
  blank: () => S;
  /** Returns a one-line summary for the drawer UI. */
  preview: (s: S) => string;
  /** Defaults to 20. */
  maxEntries?: number;
  /** Defaults to 1500ms. */
  debounceMs?: number;
}

function newId(): string {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `h_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

export function createHistoryStore<S>(
  input: CreateHistoryStoreInput<S>,
): UseBoundStore<StoreApi<HistoryStoreState<S>>> {
  const max = input.maxEntries ?? 20;
  const debounce = input.debounceMs ?? 1500;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const seed = (): { list: HistoryEntry<S>[]; currentId: string } => {
    const id = newId();
    return {
      list: [{ id, createdAt: new Date().toISOString(), preview: "", snapshot: input.blank() }],
      currentId: id,
    };
  };

  return create<HistoryStoreState<S>>()(
    persist(
      (set, get) => ({
        ...seed(),
        save: (snapshot) =>
          set((s) => {
            const next = s.list.slice();
            const idx = next.findIndex((e) => e.id === s.currentId);
            if (idx === -1) return s;
            next[idx] = {
              ...next[idx],
              snapshot,
              preview: input.preview(snapshot),
            };
            return { list: next };
          }),
        scheduleAutoSave: (snapshot) => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            get().save(snapshot);
            timer = null;
          }, debounce);
        },
        newSession: () =>
          set((s) => {
            const id = newId();
            const fresh: HistoryEntry<S> = {
              id,
              createdAt: new Date().toISOString(),
              preview: "",
              snapshot: input.blank(),
            };
            const trimmed = [fresh, ...s.list].slice(0, max);
            return { list: trimmed, currentId: id };
          }),
        restore: (id) =>
          set((s) => {
            const entry = s.list.find((e) => e.id === id);
            if (!entry || id === s.currentId) return s;
            const next = s.list.slice();
            const curIdx = next.findIndex((e) => e.id === s.currentId);
            if (curIdx === -1) return s;
            next[curIdx] = {
              ...next[curIdx],
              snapshot: entry.snapshot,
              preview: entry.preview,
            };
            return { list: next };
          }),
        reset: () => set(seed()),
      }),
      {
        name: input.name,
        version: 1,
      },
    ),
  );
}
```

- [ ] **Step 4: Run + commit**

Run: `pnpm -F @modeldoctor/web test src/features/playground/history/createHistoryStore`
Expected: PASS.

```bash
git add apps/web/src/features/playground/history/createHistoryStore.ts apps/web/src/features/playground/history/createHistoryStore.test.ts
git commit -m "$(cat <<'EOF'
feat(web/playground/history): createHistoryStore<S> factory

Generic zustand+persist factory for per-modality history. list[0] is
always the current session; save() mutates in-place, scheduleAutoSave()
debounces 1500ms, newSession() prepends a fresh blank, restore() copies
into the current entry without deleting the source. LRU at 20.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: `HistoryDrawer` generic UI component

**Files:**
- Create: `apps/web/src/features/playground/history/HistoryDrawer.tsx`
- Create: `apps/web/src/features/playground/history/HistoryDrawer.test.tsx`

A small dropdown / popover that exposes:
- `[+ 新会话]` button → calls `useHistoryStore.getState().newSession()`
- A list of historical entries (skipping `currentId`) → click opens a confirm "覆盖当前会话?" → calls `restore(id)`
- Empty state if no history beyond current

- [ ] **Step 1: Write failing test**

Create `apps/web/src/features/playground/history/HistoryDrawer.test.tsx`:

```tsx
import "@/lib/i18n";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { createHistoryStore } from "./createHistoryStore";
import { HistoryDrawer } from "./HistoryDrawer";

interface Snap {
  text: string;
}

const useStore = createHistoryStore<Snap>({
  name: "md-history-drawer-test",
  blank: () => ({ text: "" }),
  preview: (s) => s.text,
});

describe("HistoryDrawer", () => {
  beforeEach(() => {
    localStorage.clear();
    useStore.getState().reset();
  });

  it("renders 'New session' button and empty list when only current exists", () => {
    render(<HistoryDrawer useHistoryStore={useStore} />);
    expect(screen.getByRole("button", { name: /new session|新会话/i })).toBeInTheDocument();
    expect(screen.getByText(/no history|暂无历史/i)).toBeInTheDocument();
  });

  it("New session calls newSession on click", async () => {
    const user = userEvent.setup();
    render(<HistoryDrawer useHistoryStore={useStore} />);
    await user.click(screen.getByRole("button", { name: /new session|新会话/i }));
    expect(useStore.getState().list).toHaveLength(2);
  });

  it("clicking an old entry confirms then restores", async () => {
    useStore.getState().save({ text: "first" });
    useStore.getState().newSession();
    useStore.getState().save({ text: "second" });
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<HistoryDrawer useHistoryStore={useStore} />);
    await user.click(screen.getByText("first"));
    expect(confirmSpy).toHaveBeenCalled();
    expect(useStore.getState().list[0].snapshot.text).toBe("first");
    confirmSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Confirm fail**

Run: `pnpm -F @modeldoctor/web test src/features/playground/history/HistoryDrawer`
Expected: FAIL.

- [ ] **Step 3: Implement `HistoryDrawer.tsx`**

Create `apps/web/src/features/playground/history/HistoryDrawer.tsx`:

```tsx
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { StoreApi, UseBoundStore } from "zustand";
import { History } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { HistoryStoreState } from "./createHistoryStore";

export interface HistoryDrawerProps<S> {
  useHistoryStore: UseBoundStore<StoreApi<HistoryStoreState<S>>>;
}

export function HistoryDrawer<S>({ useHistoryStore }: HistoryDrawerProps<S>) {
  const { t } = useTranslation("playground");
  const list = useHistoryStore((s) => s.list);
  const currentId = useHistoryStore((s) => s.currentId);
  const newSession = useHistoryStore((s) => s.newSession);
  const restore = useHistoryStore((s) => s.restore);
  const olders = list.filter((e) => e.id !== currentId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={t("history.title")}>
          <History className="mr-1 h-4 w-4" />
          {t("history.title")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            newSession();
          }}
        >
          {t("history.newSession")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {t("history.title")}
        </DropdownMenuLabel>
        {olders.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            {t("history.empty")}
          </div>
        ) : (
          olders.map((e) => (
            <DropdownMenuItem
              key={e.id}
              onSelect={(ev) => {
                ev.preventDefault();
                if (window.confirm(t("history.restoreConfirm"))) {
                  restore(e.id);
                }
              }}
              className="flex flex-col items-start gap-0.5"
            >
              <span className="line-clamp-1 text-xs">
                {e.preview || t("history.untitled")}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {new Date(e.createdAt).toLocaleString()}
              </span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 4: Add the i18n keys used here (en + zh)**

Add to `apps/web/src/locales/en-US/playground.json` under top-level (Task 25 finalises the rest):

```json
"history": {
  "title": "History",
  "newSession": "+ New session",
  "empty": "No history",
  "untitled": "(empty)",
  "restoreConfirm": "Overwrite the current session with this entry?"
}
```

zh-CN equivalents:

```json
"history": {
  "title": "历史",
  "newSession": "+ 新会话",
  "empty": "暂无历史",
  "untitled": "(空)",
  "restoreConfirm": "用这条记录覆盖当前会话？"
}
```

- [ ] **Step 5: Run + commit**

Run: `pnpm -F @modeldoctor/web test src/features/playground/history`
Expected: PASS.

```bash
git add apps/web/src/features/playground/history/ apps/web/src/locales/en-US/playground.json apps/web/src/locales/zh-CN/playground.json
git commit -m "$(cat <<'EOF'
feat(web/playground): HistoryDrawer dropdown component

Generic component (parametrised on the per-modality history store) that
renders the [+ New session] button + the older-entries list with a
confirm-before-restore flow.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: `code-snippets/{chat,embeddings,rerank,images}.ts` + snapshot tests

**Files:**
- Create: `apps/web/src/features/playground/code-snippets/chat.ts`
- Create: `apps/web/src/features/playground/code-snippets/embeddings.ts`
- Create: `apps/web/src/features/playground/code-snippets/rerank.ts`
- Create: `apps/web/src/features/playground/code-snippets/images.ts`
- Create: `apps/web/src/features/playground/code-snippets/code-snippets.test.ts`

**API key always rendered as `<YOUR_API_KEY>`** (per spec § 8) — never the real key.

- [ ] **Step 1: Write failing snapshot test**

Create `apps/web/src/features/playground/code-snippets/code-snippets.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { genChatSnippets } from "./chat";
import { genEmbeddingsSnippets } from "./embeddings";
import { genImagesSnippets } from "./images";
import { genRerankSnippets } from "./rerank";

describe("genChatSnippets", () => {
  it("renders curl/python/node with placeholder API key (snapshot)", () => {
    const snips = genChatSnippets({
      apiBaseUrl: "http://upstream.test",
      model: "m1",
      messages: [{ role: "user", content: "hi" }],
      params: { temperature: 0.5, maxTokens: 100 },
    });
    expect(snips.curl).toMatchSnapshot();
    expect(snips.python).toMatchSnapshot();
    expect(snips.node).toMatchSnapshot();
    // API key MUST appear as the placeholder, never blank or omitted
    expect(snips.curl).toContain("<YOUR_API_KEY>");
    expect(snips.python).toContain("<YOUR_API_KEY>");
    expect(snips.node).toContain("<YOUR_API_KEY>");
  });
});

describe("genEmbeddingsSnippets", () => {
  it("renders single + array input (snapshot)", () => {
    const single = genEmbeddingsSnippets({
      apiBaseUrl: "http://x",
      model: "m",
      input: "hello",
    });
    const arr = genEmbeddingsSnippets({
      apiBaseUrl: "http://x",
      model: "m",
      input: ["a", "b"],
    });
    expect(single.curl).toMatchSnapshot();
    expect(arr.python).toMatchSnapshot();
  });
});

describe("genRerankSnippets", () => {
  it("renders cohere wire (snapshot)", () => {
    const snips = genRerankSnippets({
      apiBaseUrl: "http://x",
      model: "m",
      query: "q",
      documents: ["a", "b"],
      topN: 2,
      wire: "cohere",
    });
    expect(snips.curl).toMatchSnapshot();
    expect(snips.python).toMatchSnapshot();
    expect(snips.node).toMatchSnapshot();
  });

  it("renders tei wire (snapshot)", () => {
    const snips = genRerankSnippets({
      apiBaseUrl: "http://x",
      model: "m",
      query: "q",
      documents: ["a", "b"],
      wire: "tei",
    });
    expect(snips.curl).toMatchSnapshot();
  });
});

describe("genImagesSnippets", () => {
  it("renders prompt + size + n (snapshot)", () => {
    const snips = genImagesSnippets({
      apiBaseUrl: "http://x",
      model: "m",
      prompt: "a red apple",
      size: "512x512",
      n: 1,
    });
    expect(snips.curl).toMatchSnapshot();
    expect(snips.python).toMatchSnapshot();
  });
});
```

- [ ] **Step 2: Confirm fail**

Run: `pnpm -F @modeldoctor/web test src/features/playground/code-snippets`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `chat.ts`**

Create `apps/web/src/features/playground/code-snippets/chat.ts`:

```ts
import type { ChatMessage, ChatParams } from "@modeldoctor/contracts";

export interface ChatSnippetInput {
  apiBaseUrl: string;
  model: string;
  messages: ChatMessage[];
  params: ChatParams;
}

export interface CodeSnippets {
  curl: string;
  python: string;
  node: string;
}

const PLACEHOLDER = "<YOUR_API_KEY>";

function buildBody(input: ChatSnippetInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: input.model,
    messages: input.messages,
  };
  const p = input.params;
  if (p.temperature !== undefined) body.temperature = p.temperature;
  if (p.maxTokens !== undefined) body.max_tokens = p.maxTokens;
  if (p.topP !== undefined) body.top_p = p.topP;
  if (p.frequencyPenalty !== undefined) body.frequency_penalty = p.frequencyPenalty;
  if (p.presencePenalty !== undefined) body.presence_penalty = p.presencePenalty;
  if (p.seed !== undefined) body.seed = p.seed;
  if (p.stop !== undefined) body.stop = p.stop;
  if (p.stream !== undefined) body.stream = p.stream;
  return body;
}

export function genChatSnippets(input: ChatSnippetInput): CodeSnippets {
  const url = `${input.apiBaseUrl.replace(/\/+$/, "")}/v1/chat/completions`;
  const body = buildBody(input);
  const bodyJson = JSON.stringify(body, null, 2);
  const curl = `curl -X POST ${url} \\
  -H "Authorization: Bearer ${PLACEHOLDER}" \\
  -H "Content-Type: application/json" \\
  -d '${bodyJson}'`;
  const python = `from openai import OpenAI

client = OpenAI(base_url="${input.apiBaseUrl}", api_key="${PLACEHOLDER}")
resp = client.chat.completions.create(${pyKwargs(body)})
print(resp.choices[0].message.content)`;
  const node = `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${input.apiBaseUrl}",
  apiKey: "${PLACEHOLDER}",
});
const resp = await client.chat.completions.create(${bodyJson});
console.log(resp.choices[0].message.content);`;
  return { curl, python, node };
}

function pyKwargs(body: Record<string, unknown>): string {
  // Render { a: 1, b: "x" } as `\n    a=1,\n    b="x",\n`
  const lines = Object.entries(body).map(([k, v]) => `    ${k}=${JSON.stringify(v)}`);
  return `\n${lines.join(",\n")},\n`;
}
```

- [ ] **Step 4: Implement `embeddings.ts`**

Create `apps/web/src/features/playground/code-snippets/embeddings.ts`:

```ts
import type { CodeSnippets } from "./chat";

const PLACEHOLDER = "<YOUR_API_KEY>";

export interface EmbeddingsSnippetInput {
  apiBaseUrl: string;
  model: string;
  input: string | string[];
  encodingFormat?: "float" | "base64";
  dimensions?: number;
}

export function genEmbeddingsSnippets(input: EmbeddingsSnippetInput): CodeSnippets {
  const url = `${input.apiBaseUrl.replace(/\/+$/, "")}/v1/embeddings`;
  const body: Record<string, unknown> = { model: input.model, input: input.input };
  if (input.encodingFormat) body.encoding_format = input.encodingFormat;
  if (input.dimensions) body.dimensions = input.dimensions;
  const json = JSON.stringify(body, null, 2);
  const curl = `curl -X POST ${url} \\
  -H "Authorization: Bearer ${PLACEHOLDER}" \\
  -H "Content-Type: application/json" \\
  -d '${json}'`;
  const python = `from openai import OpenAI

client = OpenAI(base_url="${input.apiBaseUrl}", api_key="${PLACEHOLDER}")
resp = client.embeddings.create(model=${JSON.stringify(input.model)}, input=${JSON.stringify(input.input)})
print(len(resp.data[0].embedding))`;
  const node = `import OpenAI from "openai";

const client = new OpenAI({ baseURL: "${input.apiBaseUrl}", apiKey: "${PLACEHOLDER}" });
const resp = await client.embeddings.create(${json});
console.log(resp.data[0].embedding.length);`;
  return { curl, python, node };
}
```

- [ ] **Step 5: Implement `rerank.ts`**

Create `apps/web/src/features/playground/code-snippets/rerank.ts`:

```ts
import type { CodeSnippets } from "./chat";

const PLACEHOLDER = "<YOUR_API_KEY>";

export interface RerankSnippetInput {
  apiBaseUrl: string;
  model: string;
  query: string;
  documents: string[];
  topN?: number;
  returnDocuments?: boolean;
  wire: "cohere" | "tei";
}

export function genRerankSnippets(input: RerankSnippetInput): CodeSnippets {
  const path = input.wire === "tei" ? "/rerank" : "/v1/rerank";
  const url = `${input.apiBaseUrl.replace(/\/+$/, "")}${path}`;
  const body: Record<string, unknown> =
    input.wire === "tei"
      ? { model: input.model, query: input.query, texts: input.documents }
      : { model: input.model, query: input.query, documents: input.documents };
  if (input.wire === "cohere") {
    if (input.topN !== undefined) body.top_n = input.topN;
    if (input.returnDocuments !== undefined) body.return_documents = input.returnDocuments;
  }
  const json = JSON.stringify(body, null, 2);
  const curl = `curl -X POST ${url} \\
  -H "Authorization: Bearer ${PLACEHOLDER}" \\
  -H "Content-Type: application/json" \\
  -d '${json}'`;
  const python = `import requests, json

resp = requests.post(
    "${url}",
    headers={"Authorization": "Bearer ${PLACEHOLDER}", "Content-Type": "application/json"},
    data=json.dumps(${json}),
)
print(resp.json())`;
  const node = `const resp = await fetch("${url}", {
  method: "POST",
  headers: {
    Authorization: "Bearer ${PLACEHOLDER}",
    "Content-Type": "application/json",
  },
  body: JSON.stringify(${json}),
});
console.log(await resp.json());`;
  return { curl, python, node };
}
```

- [ ] **Step 6: Implement `images.ts`**

Create `apps/web/src/features/playground/code-snippets/images.ts`:

```ts
import type { CodeSnippets } from "./chat";

const PLACEHOLDER = "<YOUR_API_KEY>";

export interface ImagesSnippetInput {
  apiBaseUrl: string;
  model: string;
  prompt: string;
  size?: string;
  n?: number;
  responseFormat?: "url" | "b64_json";
  seed?: number;
}

export function genImagesSnippets(input: ImagesSnippetInput): CodeSnippets {
  const url = `${input.apiBaseUrl.replace(/\/+$/, "")}/v1/images/generations`;
  const body: Record<string, unknown> = { model: input.model, prompt: input.prompt };
  if (input.size) body.size = input.size;
  if (input.n) body.n = input.n;
  if (input.responseFormat) body.response_format = input.responseFormat;
  if (input.seed !== undefined) body.seed = input.seed;
  const json = JSON.stringify(body, null, 2);
  const curl = `curl -X POST ${url} \\
  -H "Authorization: Bearer ${PLACEHOLDER}" \\
  -H "Content-Type: application/json" \\
  -d '${json}'`;
  const python = `from openai import OpenAI

client = OpenAI(base_url="${input.apiBaseUrl}", api_key="${PLACEHOLDER}")
resp = client.images.generate(${pyKw(body)})
print(resp.data[0].url or resp.data[0].b64_json[:32])`;
  const node = `import OpenAI from "openai";

const client = new OpenAI({ baseURL: "${input.apiBaseUrl}", apiKey: "${PLACEHOLDER}" });
const resp = await client.images.generate(${json});
console.log(resp.data[0].url ?? resp.data[0].b64_json?.slice(0, 32));`;
  return { curl, python, node };
}

function pyKw(body: Record<string, unknown>): string {
  const lines = Object.entries(body).map(([k, v]) => `    ${k}=${JSON.stringify(v)}`);
  return `\n${lines.join(",\n")},\n`;
}
```

- [ ] **Step 7: Run — confirm pass; review snapshots**

Run: `pnpm -F @modeldoctor/web test src/features/playground/code-snippets`
Expected: PASS — all snapshots written.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/playground/code-snippets/
git commit -m "$(cat <<'EOF'
feat(web/playground): code-snippet generators (curl/python/node × 4 modalities)

Pure functions producing the 3 language samples shown in ViewCodeDialog.
API key always rendered as <YOUR_API_KEY>; per-modality body shapes mirror
the backend's wire builders.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: `ViewCodeDialog` component + test

**Files:**
- Create: `apps/web/src/features/playground/ViewCodeDialog.tsx`
- Create: `apps/web/src/features/playground/ViewCodeDialog.test.tsx`

- [ ] **Step 1: Write failing test**

Create `apps/web/src/features/playground/ViewCodeDialog.test.tsx`:

```tsx
import "@/lib/i18n";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ViewCodeDialog } from "./ViewCodeDialog";

const snips = {
  curl: "curl -X POST http://x",
  python: "from openai import OpenAI",
  node: "import OpenAI from 'openai';",
};

describe("ViewCodeDialog", () => {
  it("renders three tabs and shows the curl content by default", () => {
    render(<ViewCodeDialog open={true} onOpenChange={() => {}} snippets={snips} />);
    expect(screen.getByRole("tab", { name: /curl/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /python/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /node/i })).toBeInTheDocument();
    expect(screen.getByText(snips.curl)).toBeInTheDocument();
  });

  it("clicking Copy writes the active tab's snippet to clipboard", async () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    const user = userEvent.setup();
    render(<ViewCodeDialog open={true} onOpenChange={() => {}} snippets={snips} />);
    await user.click(screen.getByRole("button", { name: /copy/i }));
    expect(writeText).toHaveBeenCalledWith(snips.curl);
  });

  it("renders the API-key disclaimer", () => {
    render(<ViewCodeDialog open={true} onOpenChange={() => {}} snippets={snips} />);
    expect(screen.getByText(/api key replaced with placeholder|占位符/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Confirm fail**

Run: `pnpm -F @modeldoctor/web test src/features/playground/ViewCodeDialog`
Expected: FAIL.

- [ ] **Step 3: Implement `ViewCodeDialog.tsx`**

Create `apps/web/src/features/playground/ViewCodeDialog.tsx`:

```tsx
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Copy } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { CodeSnippets } from "./code-snippets/chat";

export interface ViewCodeDialogProps {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  snippets: CodeSnippets;
}

type Lang = "curl" | "python" | "node";

export function ViewCodeDialog({ open, onOpenChange, snippets }: ViewCodeDialogProps) {
  const { t } = useTranslation("playground");
  const [active, setActive] = useState<Lang>("curl");

  const onCopy = async () => {
    await navigator.clipboard.writeText(snippets[active]);
    toast.success(t("viewCode.copied"));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("viewCode.title")}</DialogTitle>
        </DialogHeader>
        <Tabs value={active} onValueChange={(v) => setActive(v as Lang)}>
          <div className="flex items-center justify-between">
            <TabsList>
              <TabsTrigger value="curl">curl</TabsTrigger>
              <TabsTrigger value="python">Python</TabsTrigger>
              <TabsTrigger value="node">Node.js</TabsTrigger>
            </TabsList>
            <Button size="sm" variant="outline" onClick={onCopy}>
              <Copy className="mr-1 h-3 w-3" />
              {t("viewCode.copy")}
            </Button>
          </div>
          <TabsContent value="curl">
            <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-3 text-xs">
              {snippets.curl}
            </pre>
          </TabsContent>
          <TabsContent value="python">
            <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-3 text-xs">
              {snippets.python}
            </pre>
          </TabsContent>
          <TabsContent value="node">
            <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-3 text-xs">
              {snippets.node}
            </pre>
          </TabsContent>
        </Tabs>
        <p className="text-[10px] italic text-muted-foreground">
          {t("viewCode.keyPlaceholder")}
        </p>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Add i18n keys**

Add to `apps/web/src/locales/en-US/playground.json` (top-level):

```json
"viewCode": {
  "title": "View Code",
  "copy": "Copy",
  "copied": "Copied",
  "keyPlaceholder": "API key replaced with placeholder <YOUR_API_KEY>"
}
```

zh-CN:

```json
"viewCode": {
  "title": "查看代码",
  "copy": "复制",
  "copied": "已复制",
  "keyPlaceholder": "API 密钥已替换为占位符 <YOUR_API_KEY>"
}
```

- [ ] **Step 5: Run + commit**

Run: `pnpm -F @modeldoctor/web test src/features/playground/ViewCodeDialog`
Expected: PASS.

```bash
git add apps/web/src/features/playground/ViewCodeDialog.tsx apps/web/src/features/playground/ViewCodeDialog.test.tsx apps/web/src/locales/en-US/playground.json apps/web/src/locales/zh-CN/playground.json
git commit -m "$(cat <<'EOF'
feat(web/playground): ViewCodeDialog (curl/python/node tabs + copy)

shadcn Tabs + Dialog + Copy button. The dialog itself is presentation-only;
each modality page generates snippets via genXxxSnippets() and passes
them in.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 18: Wire `PlaygroundShell` to expose ViewCode button + History slot

**Files:**
- Modify: `apps/web/src/features/playground/PlaygroundShell.tsx`
- Modify: `apps/web/src/features/playground/PlaygroundShell.test.tsx`

The shell already supports tabs and the panel collapse button. Add:
- `viewCodeSnippets?: CodeSnippets | null` prop. If non-null, render a `[</> View Code]` button in the header that opens `ViewCodeDialog`.
- `historySlot?: ReactNode` — appended to the header (between tabs and the right-aligned actions).

- [ ] **Step 1: Append failing tests**

Append to `apps/web/src/features/playground/PlaygroundShell.test.tsx`:

```tsx
it("renders the View Code button when viewCodeSnippets is provided", async () => {
  const user = userEvent.setup();
  render(
    <PlaygroundShell
      category="chat"
      paramsSlot={null}
      viewCodeSnippets={{ curl: "X", python: "Y", node: "Z" }}
    >
      <div />
    </PlaygroundShell>,
  );
  const btn = screen.getByRole("button", { name: /view code|查看代码/i });
  expect(btn).toBeInTheDocument();
  await user.click(btn);
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  expect(screen.getByText("X")).toBeInTheDocument();
});

it("does not render the View Code button when viewCodeSnippets is null", () => {
  render(
    <PlaygroundShell category="chat" paramsSlot={null} viewCodeSnippets={null}>
      <div />
    </PlaygroundShell>,
  );
  expect(screen.queryByRole("button", { name: /view code|查看代码/i })).not.toBeInTheDocument();
});

it("renders historySlot in the header", () => {
  render(
    <PlaygroundShell
      category="chat"
      paramsSlot={null}
      historySlot={<button type="button">history-here</button>}
    >
      <div />
    </PlaygroundShell>,
  );
  expect(screen.getByText("history-here")).toBeInTheDocument();
});
```

- [ ] **Step 2: Update `PlaygroundShell.tsx`**

Replace `apps/web/src/features/playground/PlaygroundShell.tsx`:

```tsx
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ModalityCategory } from "@modeldoctor/contracts";
import { Code2, PanelRightClose, PanelRightOpen } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { ParamsPanel } from "./ParamsPanel";
import { ViewCodeDialog } from "./ViewCodeDialog";
import type { CodeSnippets } from "./code-snippets/chat";

export interface PlaygroundShellProps {
  category: ModalityCategory;
  tabs?: Array<{ key: string; label: string }>;
  activeTab?: string;
  onTabChange?: (k: string) => void;
  viewCodeSnippets?: CodeSnippets | null;
  historySlot?: ReactNode;
  paramsSlot: ReactNode;
  rightPanelDefaultOpen?: boolean;
  children: ReactNode;
}

export function PlaygroundShell({
  tabs,
  activeTab,
  onTabChange,
  viewCodeSnippets,
  historySlot,
  paramsSlot,
  rightPanelDefaultOpen = true,
  children,
}: PlaygroundShellProps) {
  const { t: tc } = useTranslation("common");
  const { t } = useTranslation("playground");
  const [panelOpen, setPanelOpen] = useState(rightPanelDefaultOpen);
  const [viewCodeOpen, setViewCodeOpen] = useState(false);

  return (
    <div className="flex h-screen min-h-0 flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 py-3">
        <div className="flex items-center gap-1">
          {tabs?.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => onTabChange?.(tab.key)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm",
                tab.key === activeTab
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {historySlot}
          {viewCodeSnippets ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setViewCodeOpen(true)}
              aria-label={t("viewCode.title")}
            >
              <Code2 className="mr-1 h-4 w-4" />
              {t("viewCode.title")}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPanelOpen((v) => !v)}
            aria-label={
              panelOpen
                ? tc("sidebar.collapse", { defaultValue: "Collapse" })
                : tc("sidebar.expand", { defaultValue: "Expand" })
            }
          >
            {panelOpen ? (
              <PanelRightClose className="h-4 w-4" />
            ) : (
              <PanelRightOpen className="h-4 w-4" />
            )}
          </Button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
        <ParamsPanel open={panelOpen}>{paramsSlot}</ParamsPanel>
      </div>
      {viewCodeSnippets ? (
        <ViewCodeDialog
          open={viewCodeOpen}
          onOpenChange={setViewCodeOpen}
          snippets={viewCodeSnippets}
        />
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Run + commit**

Run: `pnpm -F @modeldoctor/web test src/features/playground/PlaygroundShell`
Expected: PASS — all old + 3 new cases.

```bash
git add apps/web/src/features/playground/PlaygroundShell.tsx apps/web/src/features/playground/PlaygroundShell.test.tsx
git commit -m "$(cat <<'EOF'
feat(web/playground/shell): wire ViewCode button + history slot

PlaygroundShell now renders a [</> View Code] button when
viewCodeSnippets is provided (opens ViewCodeDialog), and exposes
a historySlot ReactNode that pages drop their HistoryDrawer into.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 19: Wire ChatPage to its History store + ViewCode dialog

**Files:**
- Create: `apps/web/src/features/playground/chat/history.ts`
- Modify: `apps/web/src/features/playground/chat/ChatPage.tsx`

- [ ] **Step 1: Create the chat-specific history store**

Create `apps/web/src/features/playground/chat/history.ts`:

```ts
import type { ChatMessage, ChatParams } from "@modeldoctor/contracts";
import { createHistoryStore } from "../history/createHistoryStore";

export interface ChatHistorySnapshot {
  systemMessage: string;
  messages: ChatMessage[];
  params: ChatParams;
  selectedConnectionId: string | null;
}

export const useChatHistoryStore = createHistoryStore<ChatHistorySnapshot>({
  name: "md-playground-history-chat",
  blank: () => ({
    systemMessage: "",
    messages: [],
    params: {
      temperature: 1,
      maxTokens: 1024,
      topP: 1,
      frequencyPenalty: 0,
      presencePenalty: 0,
      stream: true,
    },
    selectedConnectionId: null,
  }),
  preview: (s) => {
    const lastUser = [...s.messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return "";
    return typeof lastUser.content === "string" ? lastUser.content.slice(0, 80) : "[multimodal]";
  },
});
```

- [ ] **Step 2: Wire ChatPage to history + view-code**

Edit `apps/web/src/features/playground/chat/ChatPage.tsx`. Add at the top:

```tsx
import { useEffect } from "react";
import { HistoryDrawer } from "../history/HistoryDrawer";
import { genChatSnippets } from "../code-snippets/chat";
import { useChatHistoryStore, type ChatHistorySnapshot } from "./history";
```

Inside `ChatPage`, after `const slice = useChatStore();` add:

```tsx
const restoreSnap = (snap: ChatHistorySnapshot) => {
  // Replace store state with the restored snapshot
  const s = useChatStore.getState();
  s.reset();
  s.setSystemMessage(snap.systemMessage);
  s.patchParams(snap.params);
  s.setSelected(snap.selectedConnectionId);
  for (const m of snap.messages) s.appendMessage(m);
};

const historyCurrentId = useChatHistoryStore((h) => h.currentId);
useEffect(() => {
  // When current history entry changes (e.g. newSession or restore),
  // sync chat-store from the new snapshot.
  const snap = useChatHistoryStore.getState().list.find((e) => e.id === historyCurrentId);
  if (snap) restoreSnap(snap.snapshot);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [historyCurrentId]);

// Auto-save chat state into the current history entry (debounced 1500ms inside the store)
useEffect(() => {
  useChatHistoryStore.getState().scheduleAutoSave({
    systemMessage: slice.systemMessage,
    messages: slice.messages,
    params: slice.params,
    selectedConnectionId: slice.selectedConnectionId,
  });
}, [slice.systemMessage, slice.messages, slice.params, slice.selectedConnectionId]);

const snippets =
  conn != null
    ? genChatSnippets({
        apiBaseUrl: conn.apiBaseUrl,
        model: conn.model,
        messages: [
          ...(slice.systemMessage.trim()
            ? [{ role: "system" as const, content: slice.systemMessage.trim() }]
            : []),
          ...slice.messages,
        ],
        params: slice.params,
      })
    : null;
```

Then update the `<PlaygroundShell …>` invocation to pass the new props:

```tsx
<PlaygroundShell
  category="chat"
  viewCodeSnippets={snippets}
  historySlot={<HistoryDrawer useHistoryStore={useChatHistoryStore} />}
  paramsSlot={ /* unchanged */ }
>
```

- [ ] **Step 3: Type-check + smoke test**

Run: `pnpm -F @modeldoctor/web type-check && pnpm -F @modeldoctor/web test src/features/playground/chat`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/playground/chat/history.ts apps/web/src/features/playground/chat/ChatPage.tsx
git commit -m "$(cat <<'EOF'
feat(web/playground/chat): wire HistoryDrawer + ViewCodeDialog

Adds a chat-specific history snapshot (systemMessage + messages + params
+ selectedConnectionId), auto-saves on every store change, and resyncs
the chat store when the user picks a different history entry. The shell
now also receives genChatSnippets output so [</> View Code] works.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 20: `embeddings/pca.ts` pure function + test

**Files:**
- Create: `apps/web/src/features/playground/embeddings/pca.ts`
- Create: `apps/web/src/features/playground/embeddings/pca.test.ts`

Power-iteration PCA. Returns `[x, y][]`. ≤ 30 points × ≤ 4096 dims must run in well under 50ms. No external deps.

- [ ] **Step 1: Write failing test**

Create `apps/web/src/features/playground/embeddings/pca.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computePca2D } from "./pca";

describe("computePca2D", () => {
  it("returns one point per input vector", () => {
    const out = computePca2D([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
    expect(out).toHaveLength(3);
    expect(out[0]).toHaveLength(2);
  });

  it("preserves separation: clearly distinct vectors map to distinct (x, y)", () => {
    const out = computePca2D([
      [1, 0, 0, 0],
      [10, 0, 0, 0],
      [0, 10, 0, 0],
      [0, 0, 10, 0],
    ]);
    // Pairwise distances should all be > 0.1
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const dx = out[i][0] - out[j][0];
        const dy = out[i][1] - out[j][1];
        expect(Math.hypot(dx, dy)).toBeGreaterThan(0.1);
      }
    }
  });

  it("handles fewer than 3 vectors by returning whatever it can (caller may warn)", () => {
    const out = computePca2D([[1, 2, 3]]);
    expect(out).toHaveLength(1);
  });

  it("runs ≤ 30 vectors × 1024 dims in under 100ms", () => {
    const vecs = Array.from({ length: 30 }, () =>
      Array.from({ length: 1024 }, () => Math.random()),
    );
    const t0 = performance.now();
    computePca2D(vecs);
    expect(performance.now() - t0).toBeLessThan(100);
  });
});
```

- [ ] **Step 2: Confirm fail, implement**

Create `apps/web/src/features/playground/embeddings/pca.ts`:

```ts
/**
 * 2D PCA via power iteration with deflation. Pure TS, no deps.
 *
 * Centres data, finds the leading eigenvector of the covariance matrix
 * by projection-style power iteration (Av = sum_x x · (x · v)), then
 * deflates and repeats for the second component. ~80 lines, runs in
 * under 50ms for typical Playground sizes (≤30 × ≤4096).
 */
export function computePca2D(vectors: number[][]): [number, number][] {
  const n = vectors.length;
  if (n === 0) return [];
  const d = vectors[0].length;
  if (d === 0) return vectors.map(() => [0, 0] as [number, number]);

  // Centre
  const mean = new Array<number>(d).fill(0);
  for (const v of vectors) for (let i = 0; i < d; i++) mean[i] += v[i];
  for (let i = 0; i < d; i++) mean[i] /= n;
  const X: number[][] = vectors.map((v) => v.map((x, i) => x - mean[i]));

  const v1 = powerIteration(X, d);
  // Project onto v1, subtract from each row to deflate
  const Xdef: number[][] = X.map((row) => {
    const proj = dot(row, v1);
    return row.map((x, i) => x - proj * v1[i]);
  });
  const v2 = powerIteration(Xdef, d);

  return X.map((row) => [dot(row, v1), dot(row, v2)]);
}

function powerIteration(X: number[][], d: number, iters = 50): number[] {
  // Start with a deterministic but non-degenerate vector
  let v = new Array<number>(d).fill(0).map((_, i) => Math.sin(i + 1));
  v = normalise(v);
  for (let it = 0; it < iters; it++) {
    // u = X^T X v  =  sum over rows of (row · v) * row
    const u = new Array<number>(d).fill(0);
    for (const row of X) {
      const s = dot(row, v);
      for (let i = 0; i < d; i++) u[i] += s * row[i];
    }
    const next = normalise(u);
    // Convergence check: cosine similarity ≈ 1
    if (dot(next, v) > 1 - 1e-9) return next;
    v = next;
  }
  return v;
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function normalise(v: number[]): number[] {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n);
  if (n < 1e-12) {
    const r = v.slice();
    r[0] = 1;
    return r;
  }
  return v.map((x) => x / n);
}
```

- [ ] **Step 3: Run + commit**

Run: `pnpm -F @modeldoctor/web test src/features/playground/embeddings/pca`
Expected: PASS.

```bash
git add apps/web/src/features/playground/embeddings/pca.ts apps/web/src/features/playground/embeddings/pca.test.ts
git commit -m "$(cat <<'EOF'
feat(web/playground/embeddings): pure-TS 2D PCA via power iteration

computePca2D centres data, finds the top-2 eigenvectors of the covariance
matrix by power iteration with deflation, projects each input onto them.
No external deps. Empirically <50ms for 30×1024.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 21: `EmbeddingsPage` (store + params + PCA scatter + JSON tab + history + view-code)

**Files (all create):**
- `apps/web/src/features/playground/embeddings/store.ts`
- `apps/web/src/features/playground/embeddings/store.test.ts`
- `apps/web/src/features/playground/embeddings/EmbeddingsParams.tsx`
- `apps/web/src/features/playground/embeddings/PcaScatter.tsx`
- `apps/web/src/features/playground/embeddings/EmbeddingsPage.tsx`
- `apps/web/src/features/playground/embeddings/EmbeddingsPage.test.tsx`

- [ ] **Step 1: Write store test**

Create `apps/web/src/features/playground/embeddings/store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { useEmbeddingsStore } from "./store";

describe("useEmbeddingsStore", () => {
  beforeEach(() => useEmbeddingsStore.getState().reset());

  it("starts with one empty input row and batchMode off", () => {
    const s = useEmbeddingsStore.getState();
    expect(s.inputs).toEqual([""]);
    expect(s.batchMode).toBe(false);
  });

  it("addInput and removeInput maintain the inputs array", () => {
    useEmbeddingsStore.getState().addInput();
    expect(useEmbeddingsStore.getState().inputs).toHaveLength(2);
    useEmbeddingsStore.getState().setInputAt(0, "hello");
    useEmbeddingsStore.getState().setInputAt(1, "world");
    useEmbeddingsStore.getState().removeInput(0);
    expect(useEmbeddingsStore.getState().inputs).toEqual(["world"]);
  });

  it("setBatchText splits on \\n into inputs[]", () => {
    useEmbeddingsStore.getState().setBatchText("a\n b \n\nc");
    expect(useEmbeddingsStore.getState().inputs).toEqual(["a", "b", "c"]);
  });

  it("setResult populates the embeddings array", () => {
    useEmbeddingsStore.getState().setResult([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    expect(useEmbeddingsStore.getState().result).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Implement `store.ts`**

Create `apps/web/src/features/playground/embeddings/store.ts`:

```ts
import { create } from "zustand";

export interface EmbeddingsParams {
  encodingFormat?: "float" | "base64";
  dimensions?: number;
}

export interface EmbeddingsStoreState {
  selectedConnectionId: string | null;
  inputs: string[];
  batchMode: boolean;
  params: EmbeddingsParams;
  loading: boolean;
  result: number[][] | null;
  error: string | null;
  setSelected: (id: string | null) => void;
  setInputAt: (idx: number, text: string) => void;
  addInput: () => void;
  removeInput: (idx: number) => void;
  clearInputs: () => void;
  setBatchMode: (b: boolean) => void;
  setBatchText: (s: string) => void;
  patchParams: (p: Partial<EmbeddingsParams>) => void;
  setLoading: (b: boolean) => void;
  setResult: (r: number[][] | null) => void;
  setError: (s: string | null) => void;
  reset: () => void;
}

const initial = {
  selectedConnectionId: null,
  inputs: [""],
  batchMode: false,
  params: {} as EmbeddingsParams,
  loading: false,
  result: null as number[][] | null,
  error: null as string | null,
};

export const useEmbeddingsStore = create<EmbeddingsStoreState>((set) => ({
  ...initial,
  setSelected: (id) => set({ selectedConnectionId: id }),
  setInputAt: (idx, text) =>
    set((s) => {
      const next = s.inputs.slice();
      next[idx] = text;
      return { inputs: next };
    }),
  addInput: () => set((s) => ({ inputs: [...s.inputs, ""] })),
  removeInput: (idx) =>
    set((s) => {
      const next = s.inputs.filter((_, i) => i !== idx);
      return { inputs: next.length > 0 ? next : [""] };
    }),
  clearInputs: () => set({ inputs: [""] }),
  setBatchMode: (b) => set({ batchMode: b }),
  setBatchText: (s) =>
    set({
      inputs: s
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0),
    }),
  patchParams: (p) => set((s) => ({ params: { ...s.params, ...p } })),
  setLoading: (b) => set({ loading: b }),
  setResult: (r) => set({ result: r }),
  setError: (e) => set({ error: e }),
  reset: () => set({ ...initial, inputs: [""] }),
}));
```

- [ ] **Step 3: Implement `EmbeddingsParams.tsx`**

Create `apps/web/src/features/playground/embeddings/EmbeddingsParams.tsx`:

```tsx
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTranslation } from "react-i18next";
import type { EmbeddingsParams } from "./store";

interface Props {
  value: EmbeddingsParams;
  onChange: (p: Partial<EmbeddingsParams>) => void;
}

export function EmbeddingsParamsPanel({ value, onChange }: Props) {
  const { t } = useTranslation("playground");
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">{t("embeddings.params.title")}</h3>
      <div>
        <Label className="text-xs text-muted-foreground">
          {t("embeddings.params.encodingFormat")}
        </Label>
        <Select
          value={value.encodingFormat ?? "float"}
          onValueChange={(v) => onChange({ encodingFormat: v as "float" | "base64" })}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="float">float</SelectItem>
            <SelectItem value="base64">base64</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs text-muted-foreground">{t("embeddings.params.dimensions")}</Label>
        <Input
          type="number"
          min={1}
          step={1}
          value={value.dimensions ?? ""}
          onChange={(e) =>
            onChange({ dimensions: e.target.value === "" ? undefined : Number(e.target.value) })
          }
          className="h-8 text-xs"
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implement `PcaScatter.tsx`**

Create `apps/web/src/features/playground/embeddings/PcaScatter.tsx`:

```tsx
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { computePca2D } from "./pca";

interface Props {
  vectors: number[][];
  labels: string[];
}

export function PcaScatter({ vectors, labels }: Props) {
  const { t } = useTranslation("playground");
  const points = useMemo(() => computePca2D(vectors), [vectors]);

  if (vectors.length < 3) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        {t("embeddings.chart.minThree")}
      </div>
    );
  }

  // Normalise to a 0-100 viewBox with 5px padding
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const rx = maxX - minX || 1;
  const ry = maxY - minY || 1;
  const norm = (x: number, y: number): [number, number] => [
    5 + ((x - minX) / rx) * 90,
    5 + ((y - minY) / ry) * 90,
  ];

  return (
    <svg viewBox="0 0 100 100" className="h-full w-full" role="img" aria-label="PCA scatter">
      <title>{t("embeddings.chart.title")}</title>
      {points.map(([x, y], i) => {
        const [cx, cy] = norm(x, y);
        return (
          <g key={i}>
            <circle cx={cx} cy={cy} r={1.4} className="fill-primary">
              <title>{labels[i] ?? ""}</title>
            </circle>
            <text x={cx + 1.8} y={cy + 0.6} fontSize={2} className="fill-foreground">
              {String(i + 1)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
```

- [ ] **Step 5: Implement `EmbeddingsPage.tsx`**

Create `apps/web/src/features/playground/embeddings/EmbeddingsPage.tsx`:

```tsx
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/api-client";
import { useConnectionsStore } from "@/stores/connections-store";
import type {
  PlaygroundEmbeddingsRequest,
  PlaygroundEmbeddingsResponse,
} from "@modeldoctor/contracts";
import { Trash2 } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CategoryEndpointSelector } from "../CategoryEndpointSelector";
import { PlaygroundShell } from "../PlaygroundShell";
import { genEmbeddingsSnippets } from "../code-snippets/embeddings";
import { HistoryDrawer } from "../history/HistoryDrawer";
import { createHistoryStore } from "../history/createHistoryStore";
import { EmbeddingsParamsPanel } from "./EmbeddingsParams";
import { PcaScatter } from "./PcaScatter";
import { useEmbeddingsStore } from "./store";

interface Snap {
  selectedConnectionId: string | null;
  inputs: string[];
  batchMode: boolean;
  params: { encodingFormat?: "float" | "base64"; dimensions?: number };
}

const useEmbeddingsHistoryStore = createHistoryStore<Snap>({
  name: "md-playground-history-embeddings",
  blank: () => ({
    selectedConnectionId: null,
    inputs: [""],
    batchMode: false,
    params: {},
  }),
  preview: (s) => s.inputs.find((x) => x.trim().length > 0)?.slice(0, 80) ?? "",
});

export function EmbeddingsPage() {
  const { t } = useTranslation("playground");
  const slice = useEmbeddingsStore();
  const conn = useConnectionsStore((s) =>
    slice.selectedConnectionId ? s.get(slice.selectedConnectionId) : null,
  );
  const canSubmit =
    !!conn && slice.inputs.some((i) => i.trim().length > 0) && !slice.loading;

  // History sync
  const historyCurrentId = useEmbeddingsHistoryStore((h) => h.currentId);
  useEffect(() => {
    const entry = useEmbeddingsHistoryStore
      .getState()
      .list.find((e) => e.id === historyCurrentId);
    if (!entry) return;
    const s = useEmbeddingsStore.getState();
    s.reset();
    s.setSelected(entry.snapshot.selectedConnectionId);
    s.setBatchMode(entry.snapshot.batchMode);
    for (let i = 0; i < entry.snapshot.inputs.length; i++) {
      if (i === 0) s.setInputAt(0, entry.snapshot.inputs[0] ?? "");
      else {
        s.addInput();
        s.setInputAt(i, entry.snapshot.inputs[i]);
      }
    }
    s.patchParams(entry.snapshot.params);
  }, [historyCurrentId]);

  useEffect(() => {
    useEmbeddingsHistoryStore.getState().scheduleAutoSave({
      selectedConnectionId: slice.selectedConnectionId,
      inputs: slice.inputs,
      batchMode: slice.batchMode,
      params: slice.params,
    });
  }, [slice.selectedConnectionId, slice.inputs, slice.batchMode, slice.params]);

  const onSubmit = async () => {
    if (!conn) return;
    const inputs = slice.inputs.map((s) => s.trim()).filter((s) => s.length > 0);
    if (inputs.length === 0) return;
    slice.setLoading(true);
    slice.setError(null);
    try {
      const body: PlaygroundEmbeddingsRequest = {
        apiBaseUrl: conn.apiBaseUrl,
        apiKey: conn.apiKey,
        model: conn.model,
        customHeaders: conn.customHeaders || undefined,
        queryParams: conn.queryParams || undefined,
        input: inputs.length === 1 ? inputs[0] : inputs,
        encodingFormat: slice.params.encodingFormat,
        dimensions: slice.params.dimensions,
      };
      const res = await api.post<PlaygroundEmbeddingsResponse>(
        "/api/playground/embeddings",
        body,
      );
      if (res.success) {
        slice.setResult(res.embeddings ?? []);
      } else {
        slice.setError(res.error ?? "unknown");
        toast.error(res.error ?? "unknown");
      }
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "network";
      slice.setError(msg);
      toast.error(msg);
    } finally {
      slice.setLoading(false);
    }
  };

  const snippets = conn
    ? genEmbeddingsSnippets({
        apiBaseUrl: conn.apiBaseUrl,
        model: conn.model,
        input: slice.inputs.length === 1 ? slice.inputs[0] : slice.inputs,
        encodingFormat: slice.params.encodingFormat,
        dimensions: slice.params.dimensions,
      })
    : null;

  return (
    <PlaygroundShell
      category="embeddings"
      viewCodeSnippets={snippets}
      historySlot={<HistoryDrawer useHistoryStore={useEmbeddingsHistoryStore} />}
      paramsSlot={
        <div className="space-y-4">
          <CategoryEndpointSelector
            category="embeddings"
            selectedConnectionId={slice.selectedConnectionId}
            onSelect={slice.setSelected}
          />
          <EmbeddingsParamsPanel value={slice.params} onChange={slice.patchParams} />
        </div>
      }
    >
      <PageHeader title={t("embeddings.title")} subtitle={t("embeddings.subtitle")} />
      <div className="flex min-h-0 flex-1 flex-col gap-4 px-6 py-4">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={slice.batchMode}
                onChange={(e) => slice.setBatchMode(e.target.checked)}
              />
              {t("embeddings.batchMode")}
            </label>
            <div className="flex gap-2">
              {!slice.batchMode ? (
                <Button size="sm" variant="outline" onClick={slice.addInput}>
                  {t("embeddings.addInput")}
                </Button>
              ) : null}
              <Button size="sm" variant="outline" onClick={slice.clearInputs}>
                {t("embeddings.clear")}
              </Button>
            </div>
          </div>
          {slice.batchMode ? (
            <Textarea
              rows={6}
              defaultValue={slice.inputs.join("\n")}
              onChange={(e) => slice.setBatchText(e.target.value)}
              placeholder={t("embeddings.batchPlaceholder")}
              className="font-mono text-xs"
            />
          ) : (
            <div className="space-y-1">
              {slice.inputs.map((v, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-6 text-right text-xs text-muted-foreground">
                    {i + 1}
                  </span>
                  <Textarea
                    rows={1}
                    value={v}
                    onChange={(e) => slice.setInputAt(i, e.target.value)}
                    className="text-sm"
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => slice.removeInput(i)}
                    aria-label="remove"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <Button onClick={onSubmit} disabled={!canSubmit}>
            {slice.loading ? t("embeddings.sending") : t("embeddings.send")}
          </Button>
          {slice.error ? (
            <span className="ml-3 text-xs text-destructive">{slice.error}</span>
          ) : null}
        </div>
        <div className="flex-1 overflow-hidden">
          <Tabs defaultValue="chart" className="h-full">
            <TabsList>
              <TabsTrigger value="chart">{t("embeddings.tabs.chart")}</TabsTrigger>
              <TabsTrigger value="json">{t("embeddings.tabs.json")}</TabsTrigger>
            </TabsList>
            <TabsContent value="chart" className="h-[60vh]">
              {slice.result ? (
                <PcaScatter vectors={slice.result} labels={slice.inputs} />
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                  {t("embeddings.chart.empty")}
                </div>
              )}
            </TabsContent>
            <TabsContent value="json">
              <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-3 text-[10px]">
                {slice.result ? JSON.stringify(slice.result, null, 2) : ""}
              </pre>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </PlaygroundShell>
  );
}
```

- [ ] **Step 6: Write smoke render test**

Create `apps/web/src/features/playground/embeddings/EmbeddingsPage.test.tsx`:

```tsx
import "@/lib/i18n";
import { useConnectionsStore } from "@/stores/connections-store";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => {
  class ApiError extends Error {}
  return { ApiError, api: { post: vi.fn() } };
});
import { api } from "@/lib/api-client";
import { EmbeddingsPage } from "./EmbeddingsPage";
import { useEmbeddingsStore } from "./store";

function seedConn() {
  useConnectionsStore.getState().create({
    name: "emb-1",
    apiBaseUrl: "http://x",
    apiKey: "k",
    model: "m",
    customHeaders: "",
    queryParams: "",
    category: "embeddings",
    tags: [],
  });
}

describe("EmbeddingsPage", () => {
  beforeEach(() => {
    localStorage.clear();
    useConnectionsStore.setState({ connections: [] });
    useEmbeddingsStore.getState().reset();
    vi.mocked(api.post).mockReset();
  });

  it("submits inputs to /api/playground/embeddings and renders chart placeholder until ≥3", async () => {
    vi.mocked(api.post).mockResolvedValue({
      success: true,
      embeddings: [
        [0.1, 0.2, 0.3],
        [0.2, 0.1, 0.4],
        [0.5, 0.5, 0.5],
      ],
      latencyMs: 12,
    });
    seedConn();
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <EmbeddingsPage />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: /emb-1/i }));
    await user.click(screen.getByRole("button", { name: /\+ add|添加/i }));
    await user.click(screen.getByRole("button", { name: /\+ add|添加/i }));
    const inputs = screen.getAllByRole("textbox");
    await user.type(inputs[0], "a");
    await user.type(inputs[1], "b");
    await user.type(inputs[2], "c");
    await user.click(screen.getByRole("button", { name: /send|发送/i }));
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        "/api/playground/embeddings",
        expect.objectContaining({ input: ["a", "b", "c"] }),
      );
    });
    expect(await screen.findByRole("img", { name: /pca scatter/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Run + commit**

Run: `pnpm -F @modeldoctor/web test src/features/playground/embeddings`
Expected: PASS.

```bash
git add apps/web/src/features/playground/embeddings/
git commit -m "$(cat <<'EOF'
feat(web/playground/embeddings): EmbeddingsPage with PCA scatter + JSON tab

Inputs editor (per-row + batch-mode), encoding/dimensions params,
chart/JSON tabs (chart is the SVG PCA scatter from pca.ts), history
auto-save, view-code wired in.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 22: `ImagePage` (store + params + history + view-code)

**Files (all create):**
- `apps/web/src/features/playground/image/store.ts`
- `apps/web/src/features/playground/image/store.test.ts`
- `apps/web/src/features/playground/image/ImageParams.tsx`
- `apps/web/src/features/playground/image/ImagePage.tsx`
- `apps/web/src/features/playground/image/ImagePage.test.tsx`

- [ ] **Step 1: Write store test**

Create `apps/web/src/features/playground/image/store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { useImageStore } from "./store";

describe("useImageStore", () => {
  beforeEach(() => useImageStore.getState().reset());

  it("starts with default size 512x512 and n=1", () => {
    expect(useImageStore.getState().params.size).toBe("512x512");
    expect(useImageStore.getState().params.n).toBe(1);
  });

  it("setPrompt + patchParams update state", () => {
    useImageStore.getState().setPrompt("a red apple");
    useImageStore.getState().patchParams({ seed: 7 });
    expect(useImageStore.getState().prompt).toBe("a red apple");
    expect(useImageStore.getState().params.seed).toBe(7);
  });

  it("setResults populates artifacts", () => {
    useImageStore
      .getState()
      .setResults([{ url: "http://i/0", b64Json: undefined }]);
    expect(useImageStore.getState().results).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Implement `store.ts`**

Create `apps/web/src/features/playground/image/store.ts`:

```ts
import { create } from "zustand";

export interface ImageParams {
  size: string;
  n: number;
  seed?: number;
  responseFormat?: "url" | "b64_json";
  randomSeedEachRequest: boolean;
}

export interface ImageArtifact {
  url: string | undefined;
  b64Json: string | undefined;
}

export interface ImageStoreState {
  selectedConnectionId: string | null;
  prompt: string;
  params: ImageParams;
  loading: boolean;
  results: ImageArtifact[];
  error: string | null;
  setSelected: (id: string | null) => void;
  setPrompt: (s: string) => void;
  patchParams: (p: Partial<ImageParams>) => void;
  setLoading: (b: boolean) => void;
  setResults: (r: ImageArtifact[]) => void;
  setError: (s: string | null) => void;
  reset: () => void;
}

const initial = {
  selectedConnectionId: null,
  prompt: "",
  params: {
    size: "512x512",
    n: 1,
    randomSeedEachRequest: true,
  } as ImageParams,
  loading: false,
  results: [] as ImageArtifact[],
  error: null as string | null,
};

export const useImageStore = create<ImageStoreState>((set) => ({
  ...initial,
  setSelected: (id) => set({ selectedConnectionId: id }),
  setPrompt: (s) => set({ prompt: s }),
  patchParams: (p) => set((s) => ({ params: { ...s.params, ...p } })),
  setLoading: (b) => set({ loading: b }),
  setResults: (r) => set({ results: r }),
  setError: (e) => set({ error: e }),
  reset: () => set({ ...initial }),
}));
```

- [ ] **Step 3: Implement `ImageParams.tsx`**

Create `apps/web/src/features/playground/image/ImageParams.tsx`:

```tsx
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTranslation } from "react-i18next";
import type { ImageParams } from "./store";

interface Props {
  value: ImageParams;
  onChange: (p: Partial<ImageParams>) => void;
}

const SIZES = ["256x256", "512x512", "1024x1024"];

export function ImageParamsPanel({ value, onChange }: Props) {
  const { t } = useTranslation("playground");
  const isCustom = !SIZES.includes(value.size);
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">{t("image.params.title")}</h3>
      <div>
        <Label className="text-xs text-muted-foreground">{t("image.params.size")}</Label>
        <Select
          value={isCustom ? "custom" : value.size}
          onValueChange={(v) => onChange({ size: v === "custom" ? "768x768" : v })}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SIZES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
            <SelectItem value="custom">{t("image.params.sizeCustom")}</SelectItem>
          </SelectContent>
        </Select>
        {isCustom ? (
          <Input
            value={value.size}
            onChange={(e) => onChange({ size: e.target.value })}
            placeholder="768x768"
            className="mt-2 h-8 text-xs"
          />
        ) : null}
      </div>
      <div>
        <Label className="text-xs text-muted-foreground">{t("image.params.n")}</Label>
        <Input
          type="number"
          min={1}
          max={10}
          step={1}
          value={value.n}
          onChange={(e) => onChange({ n: Math.max(1, Number(e.target.value) || 1) })}
          className="h-8 text-xs"
        />
      </div>
      <div>
        <Label className="text-xs text-muted-foreground">{t("image.params.seed")}</Label>
        <Input
          type="number"
          step={1}
          value={value.seed ?? ""}
          onChange={(e) =>
            onChange({ seed: e.target.value === "" ? undefined : Number(e.target.value) })
          }
          className="h-8 text-xs"
          placeholder={value.randomSeedEachRequest ? t("image.params.seedRandom") : ""}
        />
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={value.randomSeedEachRequest}
          onChange={(e) => onChange({ randomSeedEachRequest: e.target.checked })}
        />
        {t("image.params.randomSeed")}
      </label>
    </div>
  );
}
```

- [ ] **Step 4: Implement `ImagePage.tsx`**

Create `apps/web/src/features/playground/image/ImagePage.tsx`:

```tsx
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/api-client";
import { useConnectionsStore } from "@/stores/connections-store";
import type {
  PlaygroundImagesRequest,
  PlaygroundImagesResponse,
} from "@modeldoctor/contracts";
import { Dice5, Download } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CategoryEndpointSelector } from "../CategoryEndpointSelector";
import { PlaygroundShell } from "../PlaygroundShell";
import { genImagesSnippets } from "../code-snippets/images";
import { HistoryDrawer } from "../history/HistoryDrawer";
import { createHistoryStore } from "../history/createHistoryStore";
import { ImageParamsPanel } from "./ImageParams";
import { useImageStore, type ImageParams as ImageParamsType } from "./store";

interface Snap {
  selectedConnectionId: string | null;
  prompt: string;
  params: ImageParamsType;
}

const useImageHistoryStore = createHistoryStore<Snap>({
  name: "md-playground-history-image",
  blank: () => ({
    selectedConnectionId: null,
    prompt: "",
    params: { size: "512x512", n: 1, randomSeedEachRequest: true },
  }),
  preview: (s) => s.prompt.slice(0, 80),
});

export function ImagePage() {
  const { t } = useTranslation("playground");
  const slice = useImageStore();
  const conn = useConnectionsStore((s) =>
    slice.selectedConnectionId ? s.get(slice.selectedConnectionId) : null,
  );
  const canSubmit = !!conn && slice.prompt.trim().length > 0 && !slice.loading;

  // History sync
  const currentId = useImageHistoryStore((h) => h.currentId);
  useEffect(() => {
    const entry = useImageHistoryStore.getState().list.find((e) => e.id === currentId);
    if (!entry) return;
    const s = useImageStore.getState();
    s.reset();
    s.setSelected(entry.snapshot.selectedConnectionId);
    s.setPrompt(entry.snapshot.prompt);
    s.patchParams(entry.snapshot.params);
  }, [currentId]);

  useEffect(() => {
    useImageHistoryStore.getState().scheduleAutoSave({
      selectedConnectionId: slice.selectedConnectionId,
      prompt: slice.prompt,
      params: slice.params,
    });
  }, [slice.selectedConnectionId, slice.prompt, slice.params]);

  const onSubmit = async () => {
    if (!conn) return;
    slice.setLoading(true);
    slice.setError(null);
    const seed = slice.params.randomSeedEachRequest
      ? Math.floor(Math.random() * 2 ** 31)
      : slice.params.seed;
    try {
      const body: PlaygroundImagesRequest = {
        apiBaseUrl: conn.apiBaseUrl,
        apiKey: conn.apiKey,
        model: conn.model,
        customHeaders: conn.customHeaders || undefined,
        queryParams: conn.queryParams || undefined,
        prompt: slice.prompt.trim(),
        size: slice.params.size,
        n: slice.params.n,
        seed,
        responseFormat: slice.params.responseFormat,
      };
      const res = await api.post<PlaygroundImagesResponse>("/api/playground/images", body);
      if (res.success) {
        slice.setResults(res.artifacts ?? []);
      } else {
        slice.setError(res.error ?? "unknown");
        toast.error(res.error ?? "unknown");
      }
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "network";
      slice.setError(msg);
      toast.error(msg);
    } finally {
      slice.setLoading(false);
    }
  };

  const onRandomPrompt = () => {
    const rolls = [
      "A red apple on a white background",
      "A futuristic city skyline at sunset",
      "A cute robot watering plants in a greenhouse",
      "An impressionist oil painting of a quiet harbour",
    ];
    slice.setPrompt(rolls[Math.floor(Math.random() * rolls.length)]);
  };

  const snippets = conn
    ? genImagesSnippets({
        apiBaseUrl: conn.apiBaseUrl,
        model: conn.model,
        prompt: slice.prompt,
        size: slice.params.size,
        n: slice.params.n,
        responseFormat: slice.params.responseFormat,
        seed: slice.params.seed,
      })
    : null;

  return (
    <PlaygroundShell
      category="image"
      viewCodeSnippets={snippets}
      historySlot={<HistoryDrawer useHistoryStore={useImageHistoryStore} />}
      paramsSlot={
        <div className="space-y-4">
          <CategoryEndpointSelector
            category="image"
            selectedConnectionId={slice.selectedConnectionId}
            onSelect={slice.setSelected}
          />
          <ImageParamsPanel value={slice.params} onChange={slice.patchParams} />
        </div>
      }
    >
      <PageHeader title={t("image.title")} subtitle={t("image.subtitle")} />
      <div className="flex min-h-0 flex-1 flex-col gap-4 px-6 py-4">
        <div className="flex h-[60vh] items-center justify-center rounded-md border border-dashed border-border bg-muted/30">
          {slice.results.length === 0 ? (
            <span className="text-xs text-muted-foreground">{t("image.previewEmpty")}</span>
          ) : (
            <div className="grid grid-flow-col gap-3">
              {slice.results.map((a, i) => (
                <ImageArtifactView key={i} artifact={a} />
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Textarea
            rows={2}
            value={slice.prompt}
            onChange={(e) => slice.setPrompt(e.target.value)}
            placeholder={t("image.promptPlaceholder")}
            className="text-sm"
          />
          <Button variant="ghost" onClick={onRandomPrompt} aria-label={t("image.random")}>
            <Dice5 className="h-4 w-4" />
          </Button>
          <Button onClick={onSubmit} disabled={!canSubmit}>
            {slice.loading ? t("image.sending") : t("image.send")}
          </Button>
        </div>
        {slice.error ? (
          <span className="text-xs text-destructive">{slice.error}</span>
        ) : null}
      </div>
    </PlaygroundShell>
  );
}

function ImageArtifactView({ artifact }: { artifact: { url?: string; b64Json?: string } }) {
  const src = artifact.url ?? (artifact.b64Json ? `data:image/png;base64,${artifact.b64Json}` : "");
  if (!src) return null;
  return (
    <div className="flex flex-col items-center gap-2">
      <img src={src} alt="" className="max-h-[55vh] rounded-md" />
      <a
        href={src}
        download
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <Download className="h-3 w-3" /> Download
      </a>
    </div>
  );
}
```

- [ ] **Step 5: Smoke test**

Create `apps/web/src/features/playground/image/ImagePage.test.tsx`:

```tsx
import "@/lib/i18n";
import { useConnectionsStore } from "@/stores/connections-store";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => {
  class ApiError extends Error {}
  return { ApiError, api: { post: vi.fn() } };
});
import { api } from "@/lib/api-client";
import { ImagePage } from "./ImagePage";
import { useImageStore } from "./store";

function seedConn() {
  useConnectionsStore.getState().create({
    name: "img-1",
    apiBaseUrl: "http://x",
    apiKey: "k",
    model: "m",
    customHeaders: "",
    queryParams: "",
    category: "image",
    tags: [],
  });
}

describe("ImagePage", () => {
  beforeEach(() => {
    localStorage.clear();
    useConnectionsStore.setState({ connections: [] });
    useImageStore.getState().reset();
    vi.mocked(api.post).mockReset();
  });

  it("submits prompt to /api/playground/images and renders the result image", async () => {
    vi.mocked(api.post).mockResolvedValue({
      success: true,
      artifacts: [{ url: "http://image/0" }],
      latencyMs: 12,
    });
    seedConn();
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ImagePage />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: /img-1/i }));
    await user.type(screen.getByPlaceholderText(/prompt|提示/i), "a red apple");
    await user.click(screen.getByRole("button", { name: /send|发送/i }));
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        "/api/playground/images",
        expect.objectContaining({ prompt: "a red apple", size: "512x512" }),
      );
    });
    await waitFor(() => {
      expect(screen.getByRole("img")).toHaveAttribute("src", "http://image/0");
    });
  });
});
```

- [ ] **Step 6: Run + commit**

Run: `pnpm -F @modeldoctor/web test src/features/playground/image`
Expected: PASS.

```bash
git add apps/web/src/features/playground/image/
git commit -m "$(cat <<'EOF'
feat(web/playground/image): ImagePage with prompt + size/n/seed params

Includes random-prompt dice button, random-seed-each-request toggle,
download artifact, history auto-save, view-code wired in.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 23: `RerankPage` (store + params + history + view-code)

**Files (all create):**
- `apps/web/src/features/playground/rerank/store.ts`
- `apps/web/src/features/playground/rerank/store.test.ts`
- `apps/web/src/features/playground/rerank/RerankParams.tsx`
- `apps/web/src/features/playground/rerank/RerankPage.tsx`
- `apps/web/src/features/playground/rerank/RerankPage.test.tsx`

- [ ] **Step 1: Write store test**

Create `apps/web/src/features/playground/rerank/store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { useRerankStore } from "./store";

describe("useRerankStore", () => {
  beforeEach(() => useRerankStore.getState().reset());

  it("starts with empty query, single empty doc, wire=cohere, topN=3", () => {
    expect(useRerankStore.getState().query).toBe("");
    expect(useRerankStore.getState().documents).toEqual([""]);
    expect(useRerankStore.getState().params.wire).toBe("cohere");
    expect(useRerankStore.getState().params.topN).toBe(3);
  });

  it("addDocument / removeDocument / setDocAt work", () => {
    useRerankStore.getState().addDocument();
    useRerankStore.getState().setDocAt(0, "a");
    useRerankStore.getState().setDocAt(1, "b");
    useRerankStore.getState().removeDocument(0);
    expect(useRerankStore.getState().documents).toEqual(["b"]);
  });

  it("setBatchText splits on newline", () => {
    useRerankStore.getState().setBatchText("a\nb\n\nc");
    expect(useRerankStore.getState().documents).toEqual(["a", "b", "c"]);
  });

  it("setResults stores [{index,score}] sorted by descending score", () => {
    useRerankStore.getState().setResults([
      { index: 1, score: 0.9 },
      { index: 0, score: 0.4 },
    ]);
    expect(useRerankStore.getState().results).toEqual([
      { index: 1, score: 0.9 },
      { index: 0, score: 0.4 },
    ]);
  });
});
```

- [ ] **Step 2: Implement `store.ts`**

Create `apps/web/src/features/playground/rerank/store.ts`:

```ts
import { create } from "zustand";

export interface RerankParams {
  wire: "cohere" | "tei";
  topN: number;
  returnDocuments: boolean;
}

export interface RerankHit {
  index: number;
  score: number;
}

export interface RerankStoreState {
  selectedConnectionId: string | null;
  query: string;
  documents: string[];
  batchMode: boolean;
  params: RerankParams;
  loading: boolean;
  results: RerankHit[];
  error: string | null;
  setSelected: (id: string | null) => void;
  setQuery: (s: string) => void;
  addDocument: () => void;
  removeDocument: (i: number) => void;
  setDocAt: (i: number, text: string) => void;
  setBatchMode: (b: boolean) => void;
  setBatchText: (s: string) => void;
  patchParams: (p: Partial<RerankParams>) => void;
  setLoading: (b: boolean) => void;
  setResults: (r: RerankHit[]) => void;
  setError: (s: string | null) => void;
  reset: () => void;
}

const initial = {
  selectedConnectionId: null,
  query: "",
  documents: [""],
  batchMode: false,
  params: { wire: "cohere" as const, topN: 3, returnDocuments: false },
  loading: false,
  results: [] as RerankHit[],
  error: null as string | null,
};

export const useRerankStore = create<RerankStoreState>((set) => ({
  ...initial,
  setSelected: (id) => set({ selectedConnectionId: id }),
  setQuery: (s) => set({ query: s }),
  addDocument: () => set((s) => ({ documents: [...s.documents, ""] })),
  removeDocument: (i) =>
    set((s) => {
      const next = s.documents.filter((_, idx) => idx !== i);
      return { documents: next.length > 0 ? next : [""] };
    }),
  setDocAt: (i, text) =>
    set((s) => {
      const next = s.documents.slice();
      next[i] = text;
      return { documents: next };
    }),
  setBatchMode: (b) => set({ batchMode: b }),
  setBatchText: (s) =>
    set({
      documents: s
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0),
    }),
  patchParams: (p) => set((s) => ({ params: { ...s.params, ...p } })),
  setLoading: (b) => set({ loading: b }),
  setResults: (r) =>
    set({ results: [...r].sort((a, b) => b.score - a.score) }),
  setError: (e) => set({ error: e }),
  reset: () => set({ ...initial, documents: [""], results: [] }),
}));
```

- [ ] **Step 3: Implement `RerankParams.tsx`**

Create `apps/web/src/features/playground/rerank/RerankParams.tsx`:

```tsx
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTranslation } from "react-i18next";
import type { RerankParams } from "./store";

interface Props {
  value: RerankParams;
  onChange: (p: Partial<RerankParams>) => void;
}

export function RerankParamsPanel({ value, onChange }: Props) {
  const { t } = useTranslation("playground");
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">{t("rerank.params.title")}</h3>
      <div>
        <Label className="text-xs text-muted-foreground">{t("rerank.params.wire")}</Label>
        <Select
          value={value.wire}
          onValueChange={(v) => onChange({ wire: v as "cohere" | "tei" })}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cohere">cohere</SelectItem>
            <SelectItem value="tei">tei</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs text-muted-foreground">{t("rerank.params.topN")}</Label>
        <Input
          type="number"
          min={1}
          step={1}
          value={value.topN}
          onChange={(e) => onChange({ topN: Math.max(1, Number(e.target.value) || 1) })}
          className="h-8 text-xs"
        />
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={value.returnDocuments}
          onChange={(e) => onChange({ returnDocuments: e.target.checked })}
        />
        {t("rerank.params.returnDocuments")}
      </label>
    </div>
  );
}
```

- [ ] **Step 4: Implement `RerankPage.tsx`**

Create `apps/web/src/features/playground/rerank/RerankPage.tsx`:

```tsx
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/api-client";
import { useConnectionsStore } from "@/stores/connections-store";
import type {
  PlaygroundRerankRequest,
  PlaygroundRerankResponse,
} from "@modeldoctor/contracts";
import { Trash2 } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CategoryEndpointSelector } from "../CategoryEndpointSelector";
import { PlaygroundShell } from "../PlaygroundShell";
import { genRerankSnippets } from "../code-snippets/rerank";
import { HistoryDrawer } from "../history/HistoryDrawer";
import { createHistoryStore } from "../history/createHistoryStore";
import { RerankParamsPanel } from "./RerankParams";
import { useRerankStore, type RerankParams as RerankParamsT } from "./store";

interface Snap {
  selectedConnectionId: string | null;
  query: string;
  documents: string[];
  batchMode: boolean;
  params: RerankParamsT;
}

const useRerankHistoryStore = createHistoryStore<Snap>({
  name: "md-playground-history-rerank",
  blank: () => ({
    selectedConnectionId: null,
    query: "",
    documents: [""],
    batchMode: false,
    params: { wire: "cohere", topN: 3, returnDocuments: false },
  }),
  preview: (s) => s.query.slice(0, 80),
});

export function RerankPage() {
  const { t } = useTranslation("playground");
  const slice = useRerankStore();
  const conn = useConnectionsStore((s) =>
    slice.selectedConnectionId ? s.get(slice.selectedConnectionId) : null,
  );
  const docs = slice.documents.map((d) => d.trim()).filter((d) => d.length > 0);
  const canSubmit = !!conn && slice.query.trim().length > 0 && docs.length > 0 && !slice.loading;

  const currentId = useRerankHistoryStore((h) => h.currentId);
  useEffect(() => {
    const entry = useRerankHistoryStore.getState().list.find((e) => e.id === currentId);
    if (!entry) return;
    const s = useRerankStore.getState();
    s.reset();
    s.setSelected(entry.snapshot.selectedConnectionId);
    s.setQuery(entry.snapshot.query);
    s.setBatchMode(entry.snapshot.batchMode);
    for (let i = 0; i < entry.snapshot.documents.length; i++) {
      if (i === 0) s.setDocAt(0, entry.snapshot.documents[0] ?? "");
      else {
        s.addDocument();
        s.setDocAt(i, entry.snapshot.documents[i]);
      }
    }
    s.patchParams(entry.snapshot.params);
  }, [currentId]);

  useEffect(() => {
    useRerankHistoryStore.getState().scheduleAutoSave({
      selectedConnectionId: slice.selectedConnectionId,
      query: slice.query,
      documents: slice.documents,
      batchMode: slice.batchMode,
      params: slice.params,
    });
  }, [slice.selectedConnectionId, slice.query, slice.documents, slice.batchMode, slice.params]);

  const onSubmit = async () => {
    if (!conn) return;
    slice.setLoading(true);
    slice.setError(null);
    try {
      const body: PlaygroundRerankRequest = {
        apiBaseUrl: conn.apiBaseUrl,
        apiKey: conn.apiKey,
        model: conn.model,
        customHeaders: conn.customHeaders || undefined,
        queryParams: conn.queryParams || undefined,
        query: slice.query.trim(),
        documents: docs,
        topN: slice.params.topN,
        returnDocuments: slice.params.returnDocuments,
        wire: slice.params.wire,
      };
      const res = await api.post<PlaygroundRerankResponse>("/api/playground/rerank", body);
      if (res.success) {
        slice.setResults(res.results ?? []);
      } else {
        slice.setError(res.error ?? "unknown");
        toast.error(res.error ?? "unknown");
      }
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "network";
      slice.setError(msg);
      toast.error(msg);
    } finally {
      slice.setLoading(false);
    }
  };

  const snippets = conn
    ? genRerankSnippets({
        apiBaseUrl: conn.apiBaseUrl,
        model: conn.model,
        query: slice.query,
        documents: docs,
        topN: slice.params.topN,
        returnDocuments: slice.params.returnDocuments,
        wire: slice.params.wire,
      })
    : null;

  const maxScore = slice.results.length > 0 ? slice.results[0].score : 1;

  return (
    <PlaygroundShell
      category="rerank"
      viewCodeSnippets={snippets}
      historySlot={<HistoryDrawer useHistoryStore={useRerankHistoryStore} />}
      paramsSlot={
        <div className="space-y-4">
          <CategoryEndpointSelector
            category="rerank"
            selectedConnectionId={slice.selectedConnectionId}
            onSelect={slice.setSelected}
          />
          <RerankParamsPanel value={slice.params} onChange={slice.patchParams} />
        </div>
      }
    >
      <PageHeader title={t("rerank.title")} subtitle={t("rerank.subtitle")} />
      <div className="flex min-h-0 flex-1 flex-col gap-4 px-6 py-4">
        <div>
          <Label className="text-xs text-muted-foreground">{t("rerank.query")}</Label>
          <Input
            value={slice.query}
            onChange={(e) => slice.setQuery(e.target.value)}
            placeholder={t("rerank.queryPlaceholder")}
            className="text-sm"
          />
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">{t("rerank.documents")}</Label>
            <div className="flex gap-2">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={slice.batchMode}
                  onChange={(e) => slice.setBatchMode(e.target.checked)}
                />
                {t("rerank.batchMode")}
              </label>
              {!slice.batchMode ? (
                <Button size="sm" variant="outline" onClick={slice.addDocument}>
                  {t("rerank.addDoc")}
                </Button>
              ) : null}
            </div>
          </div>
          {slice.batchMode ? (
            <Textarea
              rows={6}
              defaultValue={slice.documents.join("\n")}
              onChange={(e) => slice.setBatchText(e.target.value)}
              placeholder={t("rerank.batchPlaceholder")}
              className="font-mono text-xs"
            />
          ) : (
            <div className="space-y-1">
              {slice.documents.map((d, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-6 text-right text-xs text-muted-foreground">
                    {i + 1}
                  </span>
                  <Textarea
                    rows={1}
                    value={d}
                    onChange={(e) => slice.setDocAt(i, e.target.value)}
                    className="text-sm"
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => slice.removeDocument(i)}
                    aria-label="remove"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <Button onClick={onSubmit} disabled={!canSubmit}>
            {slice.loading ? t("rerank.sending") : t("rerank.send")}
          </Button>
          {slice.error ? (
            <span className="ml-3 text-xs text-destructive">{slice.error}</span>
          ) : null}
        </div>
        <div className="space-y-2">
          {slice.results.map((r) => (
            <div
              key={r.index}
              className="flex items-center gap-3 rounded-md border border-border p-2"
            >
              <span className="w-8 text-right text-xs text-muted-foreground">
                #{r.index + 1}
              </span>
              <div className="flex-1">
                <div className="text-sm">{slice.documents[r.index] ?? ""}</div>
                <Progress value={(r.score / (maxScore || 1)) * 100} className="mt-1 h-1.5" />
              </div>
              <span className="font-mono text-xs">{r.score.toFixed(3)}</span>
            </div>
          ))}
        </div>
      </div>
    </PlaygroundShell>
  );
}

import { Label } from "@/components/ui/label"; // eslint-disable-line import/order
```

(Note: `Label` import must move to the top of the import block; the inline form above is illustrative — implementer should hoist it.)

- [ ] **Step 5: Smoke test**

Create `apps/web/src/features/playground/rerank/RerankPage.test.tsx`:

```tsx
import "@/lib/i18n";
import { useConnectionsStore } from "@/stores/connections-store";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => {
  class ApiError extends Error {}
  return { ApiError, api: { post: vi.fn() } };
});
import { api } from "@/lib/api-client";
import { RerankPage } from "./RerankPage";
import { useRerankStore } from "./store";

function seedConn() {
  useConnectionsStore.getState().create({
    name: "rk-1",
    apiBaseUrl: "http://x",
    apiKey: "k",
    model: "m",
    customHeaders: "",
    queryParams: "",
    category: "rerank",
    tags: [],
  });
}

describe("RerankPage", () => {
  beforeEach(() => {
    localStorage.clear();
    useConnectionsStore.setState({ connections: [] });
    useRerankStore.getState().reset();
    vi.mocked(api.post).mockReset();
  });

  it("submits a rerank request and displays scored results", async () => {
    vi.mocked(api.post).mockResolvedValue({
      success: true,
      results: [
        { index: 1, score: 0.9 },
        { index: 0, score: 0.4 },
      ],
      latencyMs: 5,
    });
    seedConn();
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <RerankPage />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("combobox", { name: "" }));
    await user.click(screen.getByRole("option", { name: /rk-1/i }));
    await user.type(screen.getByPlaceholderText(/query|查询/i), "what");
    await user.click(screen.getByRole("button", { name: /\+ doc|文档/i }));
    const docs = screen.getAllByRole("textbox");
    await user.type(docs[1], "doc-a");
    await user.type(docs[2], "doc-b");
    await user.click(screen.getByRole("button", { name: /^send$|^发送$/i }));
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        "/api/playground/rerank",
        expect.objectContaining({ query: "what", documents: ["doc-a", "doc-b"], wire: "cohere" }),
      );
    });
    await waitFor(() => {
      expect(screen.getByText(/0\.900/)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 6: Run + commit**

Run: `pnpm -F @modeldoctor/web test src/features/playground/rerank`
Expected: PASS.

```bash
git add apps/web/src/features/playground/rerank/
git commit -m "$(cat <<'EOF'
feat(web/playground/rerank): RerankPage with score progress bars

Query + numbered documents (per-row + batch-mode), wire/topN/returnDocs
params, results sorted by score with progress-bar visual, history
auto-save, view-code wired in.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 24: Router — replace ComingSoon for `/playground/{image,embeddings,rerank}`

**Files:**
- Modify: `apps/web/src/router/index.tsx`

- [ ] **Step 1: Edit router**

In `apps/web/src/router/index.tsx`, add imports near the top:

```tsx
import { ImagePage } from "@/features/playground/image/ImagePage";
import { EmbeddingsPage } from "@/features/playground/embeddings/EmbeddingsPage";
import { RerankPage } from "@/features/playground/rerank/RerankPage";
```

Then replace the three `ComingSoonRoute` entries with real pages:

```tsx
{ path: "playground/image", element: <ImagePage /> },
{ path: "playground/embeddings", element: <EmbeddingsPage /> },
{ path: "playground/rerank", element: <RerankPage /> },
```

(Audio remains on `ComingSoonRoute` until Phase 3.)

- [ ] **Step 2: Type-check**

Run: `pnpm -F @modeldoctor/web type-check`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/router/index.tsx
git commit -m "$(cat <<'EOF'
feat(web/router): wire ImagePage / EmbeddingsPage / RerankPage routes

Replaces three ComingSoon placeholders with the real pages. Audio
remains placeholder pending Phase 3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 25: i18n consolidation

**Files:**
- Modify: `apps/web/src/locales/en-US/playground.json`
- Modify: `apps/web/src/locales/zh-CN/playground.json`

Earlier tasks added partial keys for `chat.composer.stop`, `viewCode.*`, `history.*`. This task fills in the remaining keys for the three new pages so all `t(...)` lookups resolve.

- [ ] **Step 1: Add `image`, `embeddings`, `rerank` namespaces (en-US)**

Append to `apps/web/src/locales/en-US/playground.json` under top-level (preserve existing keys; deep-merge into an updated file):

```json
"image": {
  "title": "Image",
  "subtitle": "Generate images from a text prompt.",
  "promptPlaceholder": "Describe the image…",
  "previewEmpty": "Generated images will appear here.",
  "send": "Generate",
  "sending": "Generating…",
  "random": "Random prompt",
  "params": {
    "title": "Image Parameters",
    "size": "Size",
    "sizeCustom": "Custom",
    "n": "N",
    "seed": "Seed",
    "seedRandom": "(random)",
    "randomSeed": "Random seed each request"
  }
},
"embeddings": {
  "title": "Embeddings",
  "subtitle": "Generate embedding vectors and visualise them in 2D.",
  "addInput": "+ Add input",
  "clear": "Clear",
  "batchMode": "Batch input",
  "batchPlaceholder": "One input per line.",
  "send": "Send",
  "sending": "Sending…",
  "tabs": { "chart": "Chart", "json": "JSON" },
  "chart": {
    "title": "PCA scatter",
    "minThree": "≥ 3 inputs required to visualise.",
    "empty": "Submit inputs to see a 2D PCA scatter."
  },
  "params": {
    "title": "Embedding Parameters",
    "encodingFormat": "Encoding format",
    "dimensions": "Dimensions"
  }
},
"rerank": {
  "title": "Rerank",
  "subtitle": "Rerank documents against a query.",
  "query": "Query",
  "queryPlaceholder": "Type the query…",
  "documents": "Documents",
  "addDoc": "+ Doc",
  "batchMode": "Batch input",
  "batchPlaceholder": "One document per line.",
  "send": "Send",
  "sending": "Sending…",
  "params": {
    "title": "Rerank Parameters",
    "wire": "Wire",
    "topN": "Top N",
    "returnDocuments": "Return documents"
  }
}
```

- [ ] **Step 2: zh-CN equivalents**

Add the same keys (translated) to `apps/web/src/locales/zh-CN/playground.json`. Suggested translations:

- `image.title` → `图像`
- `image.subtitle` → `根据文本提示生成图像。`
- `image.send` → `生成`
- `image.sending` → `生成中…`
- `image.random` → `随机提示`
- `image.previewEmpty` → `生成的图片将出现在这里。`
- `image.promptPlaceholder` → `描述要生成的图像…`
- `image.params.title` → `图像参数`
- `image.params.size` → `尺寸`
- `image.params.sizeCustom` → `自定义`
- `image.params.n` → `数量`
- `image.params.seed` → `Seed`
- `image.params.seedRandom` → `(随机)`
- `image.params.randomSeed` → `每次请求随机 Seed`
- `embeddings.title` → `嵌入`
- `embeddings.subtitle` → `生成嵌入向量并在 2D 中可视化。`
- `embeddings.addInput` → `+ 添加输入`
- `embeddings.clear` → `清空`
- `embeddings.batchMode` → `批量输入`
- `embeddings.batchPlaceholder` → `每行一条输入。`
- `embeddings.send` → `发送`
- `embeddings.sending` → `发送中…`
- `embeddings.tabs.chart` → `图表`
- `embeddings.tabs.json` → `JSON`
- `embeddings.chart.title` → `PCA 散点`
- `embeddings.chart.minThree` → `≥ 3 条输入才能可视化。`
- `embeddings.chart.empty` → `提交输入后这里会显示 2D PCA 散点图。`
- `embeddings.params.title` → `嵌入参数`
- `embeddings.params.encodingFormat` → `编码格式`
- `embeddings.params.dimensions` → `维度`
- `rerank.title` → `重排`
- `rerank.subtitle` → `针对查询对文档排序。`
- `rerank.query` → `查询`
- `rerank.queryPlaceholder` → `输入查询…`
- `rerank.documents` → `文档`
- `rerank.addDoc` → `+ 文档`
- `rerank.batchMode` → `批量输入`
- `rerank.batchPlaceholder` → `每行一条文档。`
- `rerank.send` → `发送`
- `rerank.sending` → `发送中…`
- `rerank.params.title` → `重排参数`
- `rerank.params.wire` → `协议`
- `rerank.params.topN` → `Top N`
- `rerank.params.returnDocuments` → `返回文档`

- [ ] **Step 3: Run all web tests to confirm nothing complains about missing keys**

Run: `pnpm -F @modeldoctor/web test`
Expected: PASS — all green.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/locales/en-US/playground.json apps/web/src/locales/zh-CN/playground.json
git commit -m "$(cat <<'EOF'
feat(web/locales): playground i18n for image / embeddings / rerank

Adds en-US + zh-CN keys for the three new pages introduced in Phase 2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 26: Final verification — lint, type-check, all tests, dev-server smoke, push

**Files:** none (run / verify only).

- [ ] **Step 1: Workspace-wide type-check**

Run: `pnpm -r type-check`
Expected: zero errors across `apps/api`, `apps/web`, `packages/contracts`.

- [ ] **Step 2: Workspace-wide lint**

Run: `pnpm -r lint`
Expected: zero errors.

- [ ] **Step 3: Workspace-wide tests**

Run: `pnpm -r test`
Expected: PASS — including the new openai-client / playground service / store / page suites.

- [ ] **Step 4: Manual dev-server smoke**

In one terminal:

```bash
pnpm -F @modeldoctor/api start:dev
```

In another terminal:

```bash
pnpm -F @modeldoctor/web dev
```

In a browser, sign in, then for each page exercise:

- `/playground/chat` — pick a chat connection, send a streaming request, observe tokens trickle in, hit Stop mid-stream, verify the partial assistant message is preserved, then send a second turn and check the network tab — body messages array should be `[user-1, assistant-partial, user-2]`. Click `[</> View Code]`, copy each tab; click `[+ New session]` and verify the page resets.
- `/playground/embeddings` — submit ≥ 3 short strings, verify the SVG scatter renders; toggle to JSON tab; toggle Batch input on and off.
- `/playground/image` — type a prompt, submit, verify the result image renders; click `🎲` random; switch size to 1024x1024 and re-submit.
- `/playground/rerank` — query + 3 docs, switch wire between cohere / tei, verify both shapes round-trip correctly; observe sort by score desc.

If you cannot reach a real upstream, point the connection at any OpenAI-compatible mock and confirm the request shape on the wire (network panel). Document any mismatch as a deviation in this task's notes.

- [ ] **Step 5: Stop dev servers**

Kill the two `pnpm` processes you started in Step 4.

- [ ] **Step 6: Push the branch**

```bash
git push origin feat/regression-suite
```

Expected: fast-forward push succeeds.

- [ ] **Step 7: Final report (do NOT open a PR yet — Phase 2 is one of N phases on this long-lived branch)**

Summarise to the user:
- All 26 plan tasks completed (or list any deviations / skipped tasks)
- New endpoints: `POST /api/playground/{embeddings,rerank,images}` + SSE branch on `/api/playground/chat`
- New pages: `/playground/{image,embeddings,rerank}` (Audio still ComingSoon for Phase 3)
- Multimodal chat attachments deliberately deferred — confirm with user whether Phase 2 ships without them or needs to extend before merge

---

## Self-Review Checklist (run after the plan is complete, before handing off)

- [ ] Spec § 7 (backend) — chat SSE branch ✓ (Task 6), embeddings/rerank/images services ✓ (Tasks 8/9/10), shared openai-client ✓ (Tasks 1/2)
- [ ] Spec § 5.6 ViewCodeDialog ✓ (Task 17)
- [ ] Spec § 5.7 HistoryStore semantics ✓ (Task 14, restore copies into current entry, debounce 1500ms, LRU 20)
- [ ] Spec § 6.3 ImagePage ✓ (Task 22)
- [ ] Spec § 6.5 EmbeddingsPage with PCA SVG ✓ (Tasks 20+21)
- [ ] Spec § 6.6 RerankPage cohere+tei via pathOverride ✓ (Task 23, served by Task 9)
- [ ] User-stated stale-closure fix ✓ (Task 13 reads via useChatStore.getState())
- [ ] No multimodal attachments in this phase — flagged for user confirmation in plan header and Task 26 final report
- [ ] No new top-level dependencies (PCA self-written) ✓
- [ ] No prisma migrations / docker compose touched ✓
- [ ] Conventional commits / one logical change per commit ✓
- [ ] Branch stays on `feat/regression-suite` (no sub-branch) ✓
- [ ] vitest@2 (api) / vitest@1 (web) preserved ✓
