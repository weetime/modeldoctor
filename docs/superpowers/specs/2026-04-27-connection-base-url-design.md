# Connection Schema Refactor — `apiBaseUrl` + Server-Side Path Construction

**Status:** Draft — pending user approval
**Date:** 2026-04-27
**Predecessors:**

- `2026-04-25-benchmark-design.md` — established Benchmark feature; Phase 5 smoke surfaced the URL semantics gap.
- `2026-04-26-benchmark-phase-5-web-ui-design.md` — Phase 5 web UI; introduced the second consumer of saved Connections.

This spec describes a one-shot refactor that disentangles the dual semantics of `Connection.apiUrl` (currently a full URL for LoadTest/E2E, but a base URL for Benchmark). Connections become pure identity objects (`apiBaseUrl + apiKey + model + headers + queryParams`), and each backend service constructs the full URL it needs from the API type or probe type it already knows.

## 1. Purpose and Scope

### 1.1 Problem

`Connection` was first introduced for LoadTest. The user pastes a curl command, the parser extracts the URL verbatim, and the backend hands that URL straight to Vegeta. That requires `apiUrl` to include the full path (e.g. `/v1/chat/completions`).

When Benchmark (Phase 5) reused the same Connection record, it ran into guidellm's `--target` semantics: guidellm expects the **base** URL and appends `/v1/chat/completions` itself. Our smoke test reproduced this — the user's saved connection (full URL) made guidellm hit `…/chat/completions/v1/chat/completions` and 404.

The fix space had two extremes:

1. Patch only Benchmark to strip the path tail (Phase 6.1, ~50 LOC). Adds a per-consumer normalization rule; future consumers must remember it.
2. Refactor the schema so `apiUrl` always means "base URL", with each consumer reconstructing the full URL. This spec.

The user chose path 2: the project is pre-production, so we pick the final-form design rather than carrying a transitional fixup.

### 1.2 What this spec delivers

- **Field rename** `apiUrl → apiBaseUrl` everywhere it appears (contracts, Prisma, Web types, API services, drivers).
- **`apiBaseUrl` convention:** `scheme://host[:port][/optional-proxy-prefix]` only — never includes `/v1`, `/chat/completions`, etc. guidellm + LoadTest + E2E all assume this.
- **`toApiBaseUrl()` helper** in `apps/web/src/lib/curl-parser.ts` — strips known OpenAI-compat path tails. Idempotent: applying it twice yields the same result. Called at curl-paste time AND at form submission (defense-in-depth for users who hand-type a full URL).
- **`loadTestApiTypePath(apiType): string`** in `packages/contracts/src/load-test.ts` — single source of truth for LoadTest's apiType→OpenAI path mapping.
- **LoadTest backend** constructs `${apiBaseUrl}${loadTestApiTypePath(apiType)}` instead of using the raw apiUrl.
- **E2E probes** each construct their own path (`/v1/chat/completions`, `/v1/images/generations`, `/v1/audio/transcriptions`) — probes are 1:1 with paths, no shared util needed.
- **Benchmark backend** passes `apiBaseUrl` directly to the runner (already correct after Phase 5 smoke).
- **Database**: drop and recreate via `prisma migrate reset --force`. New unified initial migration. No data preserved.
- **localStorage Connections**: bump zustand persist version `0 → 1` so old data is dropped. No `migrate` function. Users re-paste any saved curls.

### 1.3 Explicit non-goals

- **No backward-compat shim.** No transitional aliases, no auto-migration of old localStorage entries to new format, no "old format still accepted" parsing on the server.
- **No curl-paste in BenchmarkEndpointFields.** Benchmark's create modal still loads from a saved Connection only; pasting raw curl into Benchmark is a separate Phase 6 feature if requested.
- **No new "API type" field on Connection.** Connection is identity-only. Each test type defines its own apiType in its own request body (LoadTest already has it; Benchmark already has it; E2E uses probe names instead).
- **No "show full reconstructed URL" preview beyond LoadTest.** A small read-only preview in the LoadTest/E2E EndpointPicker is in scope; Benchmark's modal does not get one (Benchmark spans only `chat / completion` so the preview is trivially "+ /v1/chat/completions").
- **No restoration of historical `LoadTestRun` / `BenchmarkRun` / `E2ESmokeRun` rows.** All wiped by `prisma migrate reset`.

### 1.4 Why now (and why one PR)

Three coupled changes — Connection field rename, server-side URL construction, and persist-version bump — all need to land together. Splitting would leave the codebase in a half-state where one consumer expects base, another expects full. Single PR with four logical commits, each individually green.

## 2. Architecture

### 2.1 Before vs. after

```
BEFORE (mixed semantics)
─────────────────────────
   Connection.apiUrl = "http://host/v1/chat/completions"   ← full URL
       ↓
   ┌───────────┬──────────────┬───────────────┐
   ↓           ↓              ↓               ↓
LoadTest    E2E probes     Benchmark        future tests
(uses raw)  (uses raw)     (BROKEN — guidellm
                            wants base)


AFTER (clean separation)
────────────────────────
   Connection.apiBaseUrl = "http://host"                   ← base URL only
       ↓
   ┌───────────────────┬──────────────────────┬───────────────────┐
   ↓                   ↓                      ↓                   ↓
LoadTest service    Each E2E probe         Benchmark           future tests
(${base} +          (`${base}/v1/...`     (passes ${base}      (own logic)
 loadTestApiType-    inside probe)         to guidellm)
 Path(apiType))
```

### 2.2 Convention: what does `apiBaseUrl` look like

| Input the user might paste | Stored `apiBaseUrl` after `toApiBaseUrl()` |
|---|---|
| `https://api.openai.com/v1/chat/completions` | `https://api.openai.com` |
| `https://api.openai.com/v1/embeddings` | `https://api.openai.com` |
| `https://api.openai.com/v1` | `https://api.openai.com` |
| `https://api.openai.com/` | `https://api.openai.com` |
| `https://api.openai.com` | `https://api.openai.com` |
| `http://10.100.121.67:30888/v1/chat/completions` | `http://10.100.121.67:30888` |
| `http://gateway/proxy/qwen/v1/chat/completions` | `http://gateway/proxy/qwen` |

Idempotent: `toApiBaseUrl(toApiBaseUrl(x)) === toApiBaseUrl(x)` for all inputs.

### 2.3 Trust boundaries unchanged

The user-supplied apiKey is still encrypted at rest in `BenchmarkRun.apiKeyCipher`; LoadTest still passes apiKey via env to the spawned vegeta wrapper; the API server still validates JWT+RBAC on every test endpoint. None of this changes.

## 3. Path Mapping

### 3.1 `loadTestApiTypePath(apiType)` — co-located with the type

Defined in `packages/contracts/src/load-test.ts` next to `ApiTypeSchema`:

```ts
export function loadTestApiTypePath(t: ApiType): string {
  switch (t) {
    case "chat":
    case "chat-vision":
    case "chat-audio":
      return "/v1/chat/completions";
    case "embeddings":
      return "/v1/embeddings";
    case "rerank":
      return "/v1/rerank";
    case "images":
      return "/v1/images/generations";
  }
}
```

Exhaustive over `ApiType`; TS verifies via `switch` exhaustiveness on the type union (no `default` clause). Adding a new `ApiType` value forces a compile error here.

### 3.2 E2E probes embed their path

Each probe file picks its own path inline. There are three probe files (`text.ts`, `image.ts`, `audio.ts`) and each is 1:1 with one OpenAI endpoint. No shared util — that would be over-abstraction.

```ts
// text.ts
const url = `${ctx.apiBaseUrl}/v1/chat/completions`;

// image.ts
const url = `${ctx.apiBaseUrl}/v1/images/generations`;

// audio.ts
const url = `${ctx.apiBaseUrl}/v1/audio/transcriptions`;
```

### 3.3 Benchmark — no path construction

guidellm appends its own `/v1/<endpoint>` to whatever `--target` it receives. The Benchmark service forwards `apiBaseUrl` verbatim; the runner sets `TARGET_URL=$apiBaseUrl`; the wrapper passes `--target=$TARGET_URL`. End of story.

## 4. URL Normalization Helper

`apps/web/src/lib/curl-parser.ts` adds:

```ts
export function toApiBaseUrl(url: string): string {
  return url
    .replace(
      /\/v1\/(chat\/completions|completions|embeddings|rerank|images\/generations|audio\/transcriptions)\/?$/,
      "",
    )
    .replace(
      /\/(chat\/completions|completions|embeddings|rerank|images\/generations|audio\/transcriptions)\/?$/,
      "",
    )
    .replace(/\/v1\/?$/, "")
    .replace(/\/$/, "");
}
```

Run order matters: strip the most specific suffix first (path with `/v1/` prefix), then bare path, then bare `/v1`, then trailing slash. Each replace is independent and idempotent on its own.

Used in two places:

1. `apply-curl-to-endpoint.ts`: after the parser extracts `parsed.url`, the patch sets `apiBaseUrl: toApiBaseUrl(parsed.url)`.
2. ConnectionDialog and EndpointPicker form `onSubmit`: defense-in-depth for users who hand-type a full URL.

## 5. Database

Prisma schema changes for `LoadTestRun` and `BenchmarkRun`:

```prisma
// before
apiUrl String @map("api_url")

// after
apiBaseUrl String @map("api_base_url")
```

Migration strategy: **drop & recreate**, no preserve.

```bash
pnpm -F @modeldoctor/api db:migrate:reset --force
# Recreates the database from schema; all LoadTestRun + BenchmarkRun rows lost.
# A new initial migration replaces the existing migration history.
```

Per the project's no-compat-shims rule (memory: `feedback_no_compat_shims`). Confirmed by user: "数据库可以删除重建 不需要考虑历史数据的问题".

## 6. Web Layer Changes

### 6.1 Type rename

`apps/web/src/types/connection.ts`:

```ts
export interface Connection {
  id: string;
  name: string;
  apiBaseUrl: string;   // was apiUrl
  apiKey: string;
  model: string;
  customHeaders: string;
  queryParams: string;
  createdAt: string;
  updatedAt: string;
}

export type EndpointValues = Pick<
  Connection,
  "apiBaseUrl" | "apiKey" | "model" | "customHeaders" | "queryParams"
>;
```

`emptyEndpointValues.apiBaseUrl = ""`.

### 6.2 Curl parsing

`apps/web/src/lib/curl-parser.ts`: keep `parseCurlCommand` and `detectApiType` unchanged. Add `toApiBaseUrl` (§4).

`apps/web/src/lib/apply-curl-to-endpoint.ts`: change

```ts
// before
patch.apiUrl = parsed.url;

// after
patch.apiBaseUrl = toApiBaseUrl(parsed.url);
```

`detectApiType(parsed.url, body)` continues to receive the original URL (it inspects the path tail to infer type). The `apiType` it returns is pushed into the **active test's slice** (LoadTest's `setApiType`, etc.) — Connection itself does not store apiType.

### 6.3 Connection store

`apps/web/src/stores/connections-store.ts`:

```ts
persist(
  (set, get) => ({ ... }),
  {
    name: "modeldoctor-connections",
    version: 1,  // bumped from default 0
    // no `migrate` — pre-prod, no compat shim
  },
)
```

Old persisted state at version 0 is dropped silently by zustand. Users re-paste any saved curls. ConnectionsImportDialog continues to support import-from-JSON for users who want to bring connections from another machine.

### 6.4 UI: form labels and helper text

ConnectionDialog and EndpointPicker:

```
[label]    API Base URL
[input]    ____________________________________
[helper]   只填 base URL，例如 http://host:port 或 https://api.openai.com。
           不要带 /v1/... 后缀；发起测试时由后端按 API 类型自动拼接。
```

EndpointPicker also shows a read-only preview line below the URL input:

```
→ POST ${apiBaseUrl}${loadTestApiTypePath(activeApiType)}
```

Updates live as the user types or changes `apiType`. Small, gray text. No preview in BenchmarkEndpointFields (benchmark's apiType is `chat | completion` only — preview adds little value).

### 6.5 BenchmarkEndpointFields

`onPickConnection`: connection record now stores `apiBaseUrl` directly, no normalization needed at load time. Just `setValue("apiBaseUrl", conn.apiBaseUrl)`. The same applies to `apiKey` and `model`. The Phase 5 `normalize`-on-load codepath, if any was ever introduced, is removed.

`requireApiKeyHighlight` and the duplicate-flow logic stay as-is. `mapDuplicateToDefaults` reads `run.apiBaseUrl` (not `apiUrl`) to populate the duplicate form.

### 6.6 Form field naming consistency

Web form field name aligns with contract: `apiBaseUrl`. RHF `register("apiBaseUrl")`, zod schema's `apiBaseUrl: z.string().url()`. The form DOES emit a final URL never — only the base.

## 7. API Layer Changes

### 7.1 LoadTest service

```ts
// before
let finalUrl = req.apiUrl;
// + query-param tacking-on logic

// after
import { loadTestApiTypePath } from "@modeldoctor/contracts";
let finalUrl = req.apiBaseUrl + loadTestApiTypePath(req.apiType);
// + query-param logic unchanged
```

### 7.2 E2E probes

`ProbeCtx` interface (`probes/index.ts`):

```ts
export interface ProbeCtx {
  apiBaseUrl: string;   // was apiUrl
  apiKey: string;
  model: string;
  extraHeaders: Record<string, string>;
}
```

Each probe constructs its target URL inline as in §3.2. `E2ETestService.run` builds the ctx with the renamed field.

### 7.3 Benchmark service + drivers

`BenchmarkExecutionContext.apiUrl` renamed to `apiBaseUrl` in `execution-driver.interface.ts`. SubprocessDriver and K8sJobManifest's env passthrough source field renamed accordingly. The pod-side env name `TARGET_URL` is **unchanged** — the runner image's contract is independent of our internal field naming.

`BenchmarkRun` Prisma column: `apiUrl` → `apiBaseUrl`. Service code that reads/writes the column updates accordingly.

`BenchmarkRunSchema` and `BenchmarkRunSummarySchema` in `packages/contracts/src/benchmark.ts` get the field rename. So does `CreateBenchmarkRequestSchema`.

### 7.4 Reconciler

The reconciler reads `BenchmarkRun.jobName`, doesn't care about the URL. No code change beyond field rename if it ever read `apiUrl` (it doesn't).

## 8. Testing Strategy

| Layer | Tests added/updated |
|---|---|
| `packages/contracts` | New `loadTestApiTypePath.test.ts`: 6 cases (one per ApiType value). Type assertion that switch is exhaustive. |
| `apps/web/lib/curl-parser.test.ts` | New describe block for `toApiBaseUrl`: 7 input variants from §2.2 table; idempotency test. |
| `apps/web/lib/apply-curl-to-endpoint.test.ts` | Update existing tests to expect `apiBaseUrl: <base>` instead of `apiUrl: <full>`. |
| `apps/web/stores/connections-store.test.ts` | Add test: pre-populated `localStorage` with `version: 0` payload → store loads as empty (zustand version mismatch). |
| `apps/web/features/load-test/LoadTestPage.test.tsx` | EndpointPicker preview line shows `${apiBaseUrl}/v1/chat/completions`; changes when user switches apiType. |
| `apps/web/features/e2e-smoke/E2ESmokePage.test.tsx` | Field rename only — minimal update. |
| `apps/web/features/benchmark/__tests__/BenchmarkEndpointFields.test.tsx` | onPickConnection no longer normalizes (input is already base); form field renamed. |
| `apps/web/features/benchmark/__tests__/BenchmarkCreateModal.test.tsx` | All `apiUrl` references in fixtures + assertions become `apiBaseUrl`. |
| `apps/api/src/modules/load-test/load-test.service.spec.ts` | Test `finalUrl` is composed of `apiBaseUrl + loadTestApiTypePath(apiType)`. |
| `apps/api/src/integrations/probes/*.spec.ts` (if exist) | ctx.apiBaseUrl + probe-specific URL composition. |
| `apps/api/src/modules/benchmark/benchmark.service.spec.ts` | Field rename in fixtures. |
| `apps/api/src/modules/benchmark/drivers/*.spec.ts` | Field rename in BenchmarkExecutionContext fixtures. |
| `apps/api/src/modules/benchmark/drivers/k8s-job-manifest.spec.ts` | Confirm pod env still has `TARGET_URL: <apiBaseUrl>`. |

## 9. Phase Decomposition

Single PR `refactor/connection-base-url`, cut from `feat/restructure` (PR #18 already merged). Four logical commits:

### Commit 1 — `refactor(contracts): rename apiUrl → apiBaseUrl + add loadTestApiTypePath`
- `packages/contracts/src/{load-test,e2e-test,benchmark}.ts`: field rename in zod schemas; comment updates explaining base URL convention.
- Add `loadTestApiTypePath(apiType)` + test.
- Other packages still use the old name, fail type-check; they're fixed in commits 2 + 3.

### Commit 2 — `refactor(api): construct full URL from apiBaseUrl + apiType in LoadTest/E2E/Benchmark`
- `apps/api/src/modules/load-test/load-test.service.ts`: use `loadTestApiTypePath`.
- `apps/api/src/integrations/probes/*.ts`: each probe constructs its own URL.
- `apps/api/src/modules/benchmark/{benchmark.service.ts, drivers/*.ts}`: field rename.
- `apps/api/prisma/schema.prisma`: column rename.
- `pnpm -F @modeldoctor/api db:migrate:reset --force` then re-init migration via `db:migrate:dev --name 0_init`.
- All API tests updated.

### Commit 3 — `refactor(web): apiBaseUrl + toApiBaseUrl helper + persist version bump`
- `apps/web/src/types/connection.ts`: type rename.
- `apps/web/src/lib/curl-parser.ts`: add `toApiBaseUrl`.
- `apps/web/src/lib/apply-curl-to-endpoint.ts`: use it.
- `apps/web/src/stores/connections-store.ts`: persist version 1.
- `apps/web/src/components/connection/EndpointPicker.tsx`: label, helper text, preview.
- `apps/web/src/features/connections/ConnectionDialog.tsx`: label, helper text.
- `apps/web/src/features/{load-test,e2e-smoke,benchmark}/...`: field name updates.
- All web tests updated.

### Commit 4 — `docs(benchmark): update specs to reflect apiBaseUrl semantics`
- Search-and-replace `apiUrl` → `apiBaseUrl` in `docs/superpowers/specs/2026-04-25-benchmark-design.md` and `docs/superpowers/specs/2026-04-26-benchmark-phase-5-web-ui-design.md` where the sense is "user-facing URL field". Add a short paragraph in §3 of the parent benchmark spec explaining the convention.
- This spec doc itself is the source of truth — referenced from the others.

Each commit individually green:
- type-check ✓
- biome check ✓
- vitest unit ✓
- (commit 2 only) prisma client generated and migration applied

## 10. Manual Smoke Checklist

After commit 3 (web layer), repeat the Phase 5 smoke (spec §12 of `2026-04-26-benchmark-phase-5-web-ui-design.md`):

1. Reset local Postgres: `pnpm -F @modeldoctor/api db:migrate:reset --force`.
2. Start `pnpm dev`, browse to `/connections`, paste curl: `curl http://10.100.121.67:30888/v1/chat/completions -H "Authorization: Bearer sk-…" -d '{"model": "gen-studio_…", "messages": [...]}'`.
3. Verify the form shows `apiBaseUrl = http://10.100.121.67:30888` (no `/v1/...` tail), inferred apiType = `chat`, model populated.
4. Save the connection.
5. `/load-test` page: load that connection. Verify EndpointPicker preview shows `→ POST http://10.100.121.67:30888/v1/chat/completions`. Switch apiType to `embeddings`, preview updates to `…/v1/embeddings`. Run a small load test → expect Vegeta to hit the right URL (check apps/api logs).
6. `/benchmarks` → Add → load the same connection. Verify `apiBaseUrl` field is `http://10.100.121.67:30888`. Run a benchmark with Throughput preset → expect the same end-to-end success as the Phase 5 smoke (40s, 1000/1000, real metrics). Confirms the field rename didn't break the K8s driver.
7. `/e2e` → load connection, run text/image/audio probes → text probe hits `…/v1/chat/completions`, image hits `…/v1/images/generations`, audio hits `…/v1/audio/transcriptions`.

If all 7 pass: the refactor is end-to-end clean. PR ready for merge.

## 11. Risks

1. **Forgotten consumer.** A grep for `apiUrl` in the codebase after the refactor should return zero hits. Mitigated by exhaustive search in commit 3 + a CI grep test if we want belt-and-suspenders (out of scope for this PR).
2. **Probe path divergence from upstream.** If a probe targets a non-standard upstream (e.g. a vendor that exposes audio at `/v1/audio/translations` instead of `/transcriptions`), the hard-coded path in the probe is wrong. We accept this for now — current probes match OpenAI standard and that's what we test. Future per-probe overrides can be added when a real divergence appears.
3. **Lost benchmark history.** All `BenchmarkRun` and `LoadTestRun` rows from prior testing wiped by `prisma migrate reset`. User explicitly opted in.
4. **Zustand persist version bump → empty connections list.** One-time inconvenience: users re-paste any locally-saved curls. Acceptable per pre-prod no-compat rule.
5. **Phase 5 smoke env vars get re-applied.** The `.env` already has `BENCHMARK_PROCESSOR=Qwen/Qwen2.5-0.5B-Instruct` etc. from the earlier smoke; those are unaffected by this refactor. Just confirm.

## 12. Open Items

None. All decisions made during brainstorm:

- ✅ Field naming: `apiBaseUrl` (not retain `apiUrl`).
- ✅ Connection schema does NOT carry `apiType` (it's per-test).
- ✅ Path util lives in contracts (`loadTestApiTypePath`).
- ✅ E2E probes embed paths inline (no shared probe-path util).
- ✅ Database: drop & recreate via `prisma migrate reset`.
- ✅ localStorage: bump persist version, no migrate function.
- ✅ Single PR with 4 commits.
- ✅ Convention: `apiBaseUrl` never includes `/v1` or any OpenAI path.
