# Vegeta gateway: customizable request path & body, request-detail visibility, cross-tool category defaulting

**Date:** 2026-05-06
**Scope by tool/scenario:**
- **Vegeta (gateway)** — full design: path + body editing, request-details panel.
- **Vegeta + Guidellm + Genai-perf** — also fix the shared "default `apiType` ignores connection.category" bug.
- Inference / capacity scenario _runtime behavior_ is otherwise untouched.

## Problem

Vegeta gateway runs land at 100% errors when the connection's category does not line up with the form-level `apiType` default (`chat`). Two compounding issues:

1. The form defaults `apiType: "chat"` regardless of `connection.category`, so an embeddings connection submits a chat request → 100% errors.
2. Even with `apiType` corrected, the runtime hardcodes both the path (`API_TYPE_TO_PATH[apiType]`) and the body (`API_TYPE_TO_BODY[apiType](model)`) inside `packages/tool-adapters/src/vegeta/runtime.ts`. Gateways that expose `/embeddings` instead of `/v1/embeddings` (or `/v2/foo`) cannot be tested without code changes.
3. The benchmark detail page shows scenario / tool / status / connection name / timings — nothing about the URL, headers, body, or run params. Users cannot diagnose what was actually sent without spelunking through raw output.

The same "default chat ignores connection.category" trap also exists in the **inference** (`guidellm`, `genai-perf`) and **capacity** (`guidellm`) forms. Their `apiType` / `endpointType` defaults to `chat` regardless of connection. Worth fixing in the same PR — small, high-value.

## Goals

- **Vegeta-only:** make request **path** editable per benchmark, with a sensible default derived from `apiType` (which itself derives from `connection.category`).
- **Vegeta-only:** make request **body** editable per benchmark, with a sensible default derived from `apiType` and `connection.model`.
- **Vegeta-only:** keep simple form flow; put new fields under an "Advanced" `<details>` disclosure (same pattern as `GuidellmParamsForm.tsx:345`).
- **Vegeta-only:** new "Request details" section on the benchmark detail page (gateway + vegeta only) — URL, headers (Authorization plaintext), body, params, copy-cURL.
- **All three tools:** when the user (or the form's connection picker) sets a `connectionId`, derive and apply the form's `apiType` / `endpointType` from `connection.category`. Show an inline warning if the picked tool does not support the connection's category.

## Non-goals

- No path/body editing on `guidellm` or `genai-perf` forms — those tools synthesize requests internally; raw HTTP body editing is the wrong abstraction for them.
- No path-presets list (`/v1/x` vs `/x`) — customization satisfies that need.
- No connection-level `pathOverride` field — path lives on the benchmark, not the connection.
- No template substitution at runtime (`{{model}}` etc.); body is a raw JSON string with the model pre-substituted on the FE at default-fill time.
- No snapshot of connection state on the benchmark record. Detail page shows `benchmark.params` (path/body — immutable) plus the **current** connection (for baseUrl / apiKey / customHeaders / queryParams), with a hint that connection settings reflect the current state, not the run's state.
- **No vegeta default-body alignment with playground** (e.g. real `image_url` for `chat-vision`, real `audio_url` for `chat-audio`) — tracked as follow-up issue [#136](https://github.com/weetime/modeldoctor/issues/136).

## Architecture

### 1. Vegeta schema — `packages/tool-adapters/src/vegeta/schema.ts`

Extend `vegetaParamsSchema`:

```ts
export const vegetaParamsSchema = z.object({
  apiType: z.enum(["chat", "embeddings", "rerank", "images", "chat-vision", "chat-audio"]),
  rate: z.number().int().min(1).max(10_000),
  duration: z.number().int().min(1).max(3_600),
  // NEW — required for new submissions; FE form always populates.
  path: z.string().min(1).regex(/^\//, "must start with /"),
  body: z.string().min(1).refine((s) => {
    try { JSON.parse(s); return true; } catch { return false; }
  }, "must be valid JSON"),
});
```

`apiType` stays — it acts as the **template selector** that produces the defaults for `path` and `body`. Once the user customizes either field, switching `apiType` resets the defaults again (see Form behavior).

### 2. Vegeta runtime — `packages/tool-adapters/src/vegeta/runtime.ts`

Replace `const path = API_TYPE_TO_PATH[params.apiType]` with `const path = params.path`, and `const body = API_TYPE_TO_BODY[params.apiType](connection.model)` with `const body = params.body`.

Keep `API_TYPE_TO_PATH` and `API_TYPE_TO_BODY` exported as **public defaults** — the FE uses them to compute initial values when picking an apiType / connection.

### 3. Cross-tool category → apiType helper — new `packages/tool-adapters/src/category-defaults.ts`

Single source of truth for "given this `ModalityCategory`, what `apiType` (per tool) is the closest match?" Returns `{ apiType: T } | { unsupported: true }` so forms can branch.

```ts
import type { ModalityCategory } from "@modeldoctor/contracts";

export const VEGETA_CATEGORY_DEFAULTS: Record<ModalityCategory,
  { apiType: VegetaParams["apiType"] }
> = {
  chat: { apiType: "chat" },
  audio: { apiType: "chat-audio" },
  embeddings: { apiType: "embeddings" },
  rerank: { apiType: "rerank" },
  image: { apiType: "images" },
};

export const GENAI_PERF_CATEGORY_DEFAULTS: Record<ModalityCategory,
  { endpointType: GenaiPerfParams["endpointType"] } | { unsupported: true }
> = {
  chat: { endpointType: "chat" },
  audio: { unsupported: true },           // genai-perf has no audio endpoint
  embeddings: { endpointType: "embeddings" },
  rerank: { endpointType: "rankings" },
  image: { unsupported: true },           // genai-perf has no image endpoint
};

export const GUIDELLM_CATEGORY_DEFAULTS: Record<ModalityCategory,
  { apiType: GuidellmParams["apiType"] } | { unsupported: true }
> = {
  chat: { apiType: "chat" },
  audio: { unsupported: true },
  embeddings: { unsupported: true },      // guidellm only does chat / completion
  rerank: { unsupported: true },
  image: { unsupported: true },
};
```

Lives in `tool-adapters` because each map's value type references that tool's enum.

### 4. FE forms — three forms, shared `useWatch` pattern

Each form watches the parent form's `connectionId`. When it changes:

```ts
const connectionId = useWatch({ control, name: "connectionId" });
const connection = useConnections().data?.items.find((c) => c.id === connectionId);

useEffect(() => {
  if (!connection) return;
  const def = TOOL_CATEGORY_DEFAULTS[connection.category];
  if ("unsupported" in def) return; // form's separate warning UI handles this
  setValue("params.apiType" /* or endpointType */, def.apiType,
           { shouldDirty: false, shouldValidate: false });
  // Vegeta only: also reset path + body to the new apiType's templates.
}, [connectionId]);
```

**Vegeta-specific** (`VegetaParamsForm.tsx`):
- Layout: keep `apiType / rate / duration` at top.
- Add `<details>▶ Advanced` (matching `GuidellmParamsForm.tsx:345` pattern):
  - `path` — text input, placeholder shows derived default.
  - `body` — textarea (rows=6, monospaced), placeholder shows derived default.
- Watch `apiType`: any manual change resets `path` and `body` to that type's templates (rule: "apiType is the template selector").
- Watch `connectionId`: as above, but also reset `path` + `body` (using the new `apiType` and the new `connection.model`).

**Guidellm form** (`GuidellmParamsForm.tsx`):
- Watch `connectionId` → set `params.apiType` from `GUIDELLM_CATEGORY_DEFAULTS`. If unsupported, render a `<FormMessage>`-style warning under the apiType field: `"guidellm 不支持 {category} 类型连接，请改用 vegeta 或 genai-perf"`. Form does not block submit (some users may know what they're doing).

**Genai-perf form** (`GenaiPerfParamsForm.tsx`):
- Watch `connectionId` → set `params.endpointType` from `GENAI_PERF_CATEGORY_DEFAULTS`. If unsupported (audio/image), warn: `"genai-perf 不支持 {category} 类型连接，请改用 vegeta"`.

### 5. Detail page — `RequestDetailsSection.tsx` (new)

Rendered in `BenchmarkDetailPage.tsx` only when `scenario === "gateway" && tool === "vegeta" && isTerminal`, between `BenchmarkDetailMetadata` and `ReportSection`.

Inputs:
- `benchmark.params` — apiType, rate, duration, path, body. Path/body fall back to derived defaults if missing for legacy rows.
- `benchmark.connectionId` → fetched via existing `useConnection(connectionId)` query (live, not snapshot).
- Plaintext `apiKey` → fetched via new `useRevealApiKey(connectionId)` (lazy, only when this section mounts).

Renders:
- **Method**: `POST` (constant).
- **URL**: `${connection.baseUrl}${params.path}` + queryParams suffix.
- **Headers**: `Content-Type`, `Authorization: Bearer <plaintext>`, custom headers.
- **Body**: pretty-printed JSON in `<pre>`. Falls back to raw string if invalid JSON.
- **Run params**: small grid — `apiType`, `rate (req/s)`, `duration (s)`, `path` (highlighted as customized).
- **Copy cURL** button: composes `curl -X POST '<url>' -H ... -d '<body>'`, single-quoted body, copies via `useClipboard`, toasts on success.
- **Hint**: small muted text — `"连接信息（baseUrl / apiKey / Headers）来自当前连接配置；如该连接被修改，本次压测实际发送的可能不同"`.

### 6. Backend — reveal-key endpoint

Add `GET /api/connections/:id/reveal-key` → `{ apiKey: string }`, owner-only, returns 403 for non-owners and 404 for missing. Decrypts the stored apiKey via the existing encryption service used by playground today. The list endpoint stays clean (apiKey not in `connectionPublicSchema`).

### 7. Backwards compatibility

Existing benchmark rows have `params: { apiType, rate, duration }` only. The schema makes `path` and `body` **required for new submissions**. Old rows store `Record<string, unknown>`, not re-validated on read. Surfaces:

- **Detail page**: fall back to `API_TYPE_TO_PATH[apiType]` / `API_TYPE_TO_BODY[apiType](connection?.model ?? "<unknown>")` when missing.
- **Rerun**: wrap source `params` through a `migrateVegetaParams(params, connectionModel)` helper (in tool-adapters) that fills in defaults before the new POST.

## Data flow (vegeta gateway)

```
[BenchmarkCreatePage] → user picks connection X (category=embeddings)
   ↓ ToolParamsEditor renders <VegetaParamsForm>
[VegetaParamsForm]
   useWatch(connectionId) fires
   → connection.category = "embeddings"
   → VEGETA_CATEGORY_DEFAULTS → apiType = "embeddings"
   → form.setValue(apiType, "embeddings")
   → form.setValue(path, "/v1/embeddings")
   → form.setValue(body, '{"model":"bge-m3-…","input":"hello"}')
   ↓
   user expands Advanced, edits path → "/embeddings"
   ↓
   user submits
[POST /api/benchmarks] body.params = { apiType, rate, duration, path, body }
   ↓ benchmark.service.ts validates via vegetaParamsSchema → OK
   ↓ k8s runner buildCommand uses params.path / params.body verbatim
[detail page]
   useBenchmarkDetail(id) → benchmark
   useConnection(benchmark.connectionId) → connection (live)
   useRevealApiKey(benchmark.connectionId) → apiKey (lazy)
   <RequestDetailsSection> renders URL, headers, body, params, copy-cURL
```

## Testing

**Schema / runtime (vitest):**
- `vegeta/schema.spec.ts`: existing cases still pass; new tests for `path` (rejects empty / no leading slash, accepts `/v2/foo`) and `body` (rejects invalid JSON, accepts valid JSON).
- `vegeta/runtime.spec.ts`: existing `buildCommand` cases updated to provide `path` / `body`; assert runtime no longer reads `connection.model` for body construction (it comes from params now).
- New `category-defaults.spec.ts`: each tool's mapping returns expected `apiType` / `endpointType` for supported categories and `unsupported: true` otherwise.

**Component (vitest + RTL):**
- `VegetaParamsForm.test.tsx`:
  - Advanced is collapsed by default.
  - Expanding shows path + body fields.
  - Changing `apiType` resets path + body to new defaults.
  - Changing `connectionId` (via parent form value) updates apiType + path + body when category supported.
  - All 5 categories (chat / audio / embeddings / rerank / image) → corresponding apiType + path defaults.
- `GuidellmParamsForm.test.tsx`: changing `connectionId` to a chat connection sets apiType=chat; embedding/audio/rerank/image connections show warning, leave apiType untouched.
- `GenaiPerfParamsForm.test.tsx`: chat/embeddings/rerank connections set endpointType correctly; audio/image connections show warning.
- New `RequestDetailsSection.test.tsx`: renders URL with path appended, queryParams suffix, plaintext Bearer header, custom headers, pretty-printed body, run params table, copy-cURL writes to clipboard.

**Backend (vitest + supertest):**
- `connection.controller.spec.ts`: add cases for `GET /:id/reveal-key` — owner returns plaintext, non-owner returns 403, unknown id returns 404, unauthenticated returns 401.

**E2E (Playwright):**
- Smoke: gateway-vegeta against an embeddings connection — expand Advanced, confirm path defaults to `/v1/embeddings`, body has `"input"` field; submit; on detail page verify "Request details" section shows URL with `/v1/embeddings` and plaintext Bearer header.

## Implementation order (informs the plan)

1. **`category-defaults.ts`** + spec.
2. **Vegeta schema + runtime** (path, body, migrateVegetaParams).
3. **Backend**: reveal-key endpoint + spec.
4. **FE forms** — three forms, shared connection-watch logic. Vegeta first (Advanced + path/body), then guidellm + genai-perf for category defaulting + warning.
5. **FE detail section** — `RequestDetailsSection` + integration into `BenchmarkDetailPage`.
6. **Rerun migration helper** plumbed into the rerun mutation.
7. **E2E smoke**.

Each step ships behind passing unit/component tests before moving on.

## Open questions

None blocking. Tier 3 (align vegeta default body shapes with playground) is filed as [#136](https://github.com/weetime/modeldoctor/issues/136) and will be picked up after this PR lands.
