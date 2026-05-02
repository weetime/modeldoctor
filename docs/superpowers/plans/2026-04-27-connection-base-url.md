> **Status: ✅ Completed · historical record.** 本文是提交时的设计/计划快照；其中字段名、目录路径、env 名、API 路由为当时状态，重构后已演进。**当前实现请以代码与 `CLAUDE.md` 为准；本文正文不再修改，仅作归档。**

# Connection Base-URL Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename `apiUrl → apiBaseUrl` across contracts/Prisma/API/Web; hoist URL-path construction into a contracts util (LoadTest), inline-per-probe (E2E), or skip entirely (Benchmark — guidellm self-appends).

**Architecture:** Connection becomes pure identity (base URL + key + model + headers + queryParams). Each backend service constructs the full URL it needs from the apiType / probe type already in its request. Single PR, four commits in dependency order: contracts → api → web → docs. Type-check is intentionally broken between commits 1↔2 and 2↔3; full green only after commit 3.

**Tech Stack:** TypeScript, NestJS + Prisma 6, Zod, React + Vite, Zustand persist, vitest + RTL, biome.

**Spec:** `docs/superpowers/specs/2026-04-27-connection-base-url-design.md`.

**Branch:** `refactor/connection-base-url` (already exists; commit at HEAD is the spec doc itself, `1505c0d`).

---

## File Structure

### Modified

**Contracts (4 files):**
- `packages/contracts/src/load-test.ts` — zod field rename + new `loadTestApiTypePath` export
- `packages/contracts/src/e2e-test.ts` — zod field rename
- `packages/contracts/src/benchmark.ts` — zod field rename (3 schemas: Create / Summary / Run)
- `packages/contracts/src/benchmark.spec.ts` — fixture rename

**Contracts (1 new file):**
- `packages/contracts/src/load-test.spec.ts` — test `loadTestApiTypePath`

**API (18 files):**
- `apps/api/prisma/schema.prisma` — column rename in 2 models
- `apps/api/prisma/migrations/` — directory cleared and regenerated as a single `init` migration
- `apps/api/src/modules/load-test/load-test.service.ts` — compose final URL via `loadTestApiTypePath`
- `apps/api/src/integrations/probes/index.ts` — `ProbeCtx` field rename
- `apps/api/src/integrations/probes/text.ts` — inline `/v1/chat/completions`
- `apps/api/src/integrations/probes/image.ts` — inline `/v1/images/generations`
- `apps/api/src/integrations/probes/audio.ts` — inline `/v1/audio/transcriptions`
- `apps/api/src/modules/e2e-test/e2e-test.service.ts` — `ProbeCtx` construction rename
- `apps/api/src/modules/benchmark/benchmark.service.ts` — DTO field rename throughout
- `apps/api/src/modules/benchmark/drivers/execution-driver.interface.ts` — `BenchmarkExecutionContext` field rename
- `apps/api/src/modules/benchmark/drivers/subprocess-driver.ts` — `ctx.apiBaseUrl` reference
- `apps/api/src/modules/benchmark/drivers/k8s-job-manifest.ts` — `ctx.apiBaseUrl` reference (env stays `TARGET_URL`)
- `apps/api/src/modules/benchmark/benchmark.service.spec.ts` — fixture rename
- `apps/api/src/modules/benchmark/benchmark.controller.spec.ts` — fixture rename
- `apps/api/src/modules/benchmark/drivers/subprocess-driver.spec.ts` — fixture rename
- `apps/api/src/modules/benchmark/drivers/k8s-job-driver.spec.ts` — fixture rename
- `apps/api/src/modules/benchmark/drivers/k8s-job-manifest.spec.ts` — fixture rename
- `apps/api/src/modules/benchmark/drivers/execution-driver.interface.spec.ts` — fixture rename

**Web (32 files, mostly mechanical rename):**
- `apps/web/src/types/connection.ts` — `apiUrl` → `apiBaseUrl` in `Connection` + `EndpointValues`
- `apps/web/src/lib/curl-parser.ts` — add `toApiBaseUrl` export (existing exports unchanged)
- `apps/web/src/lib/curl-parser.test.ts` — extend with `toApiBaseUrl` cases
- `apps/web/src/lib/apply-curl-to-endpoint.ts` — call `toApiBaseUrl(parsed.url)`
- `apps/web/src/stores/connections-store.ts` — bump `version: 1` in persist config
- `apps/web/src/stores/connections-store.test.ts` — fixture rename + new "version mismatch drops state" test
- `apps/web/src/components/connection/EndpointPicker.tsx` — label "API Base URL", helper text, optional preview line
- `apps/web/src/features/connections/ConnectionDialog.tsx` — label, helper text
- `apps/web/src/features/connections/ConnectionsPage.tsx` — column header
- `apps/web/src/features/connections/schema.ts` — zod `apiBaseUrl`
- `apps/web/src/features/connections/schema.test.ts` — fixture rename
- `apps/web/src/features/load-test/store.ts` — slice field rename
- `apps/web/src/features/load-test/store.test.ts` — fixture rename
- `apps/web/src/features/load-test/LoadTestPage.tsx` — `endpoint.apiBaseUrl` references
- `apps/web/src/features/load-test/LoadTestPage.test.tsx` — fixture rename
- `apps/web/src/features/e2e-smoke/store.ts` (if it has apiUrl; verify)
- `apps/web/src/features/e2e-smoke/store.test.ts`
- `apps/web/src/features/e2e-smoke/E2ESmokePage.tsx`
- `apps/web/src/features/e2e-smoke/E2ESmokePage.test.tsx`
- `apps/web/src/features/request-debug/RequestDebugPage.tsx`
- `apps/web/src/features/benchmark/BenchmarkEndpointFields.tsx` — drop normalize, rename
- `apps/web/src/features/benchmark/BenchmarkCreateModal.tsx` — RHF default values + `mapDuplicateToDefaults`
- `apps/web/src/features/benchmark/BenchmarkDetailPage.tsx` — display `data.apiBaseUrl`
- `apps/web/src/features/benchmark/__tests__/BenchmarkEndpointFields.test.tsx`
- `apps/web/src/features/benchmark/__tests__/BenchmarkCreateModal.test.tsx`
- `apps/web/src/features/benchmark/__tests__/BenchmarkDetailPage.test.tsx`
- `apps/web/src/features/benchmark/__tests__/BenchmarkListPage.test.tsx`
- `apps/web/src/features/benchmark/__tests__/BenchmarkProfilePicker.test.tsx`
- `apps/web/src/features/benchmark/__tests__/queries.test.tsx`
- `apps/web/src/locales/en-US/{common,connections,load-test,benchmark}.json` — i18n key updates / new helper text
- `apps/web/src/locales/zh-CN/{common,connections,load-test,benchmark}.json` — same

**Docs (3 files):**
- `docs/superpowers/specs/2026-04-25-benchmark-design.md` — replace `apiUrl` → `apiBaseUrl` in user-facing references; add base-URL convention paragraph in §3
- `docs/superpowers/specs/2026-04-26-benchmark-phase-5-web-ui-design.md` — search/replace
- `.env.example` — comment update if any reference

---

## Task 1: Contracts package — rename + add `loadTestApiTypePath`

This task changes contracts only. After this commit, `apps/api` and `apps/web` will fail type-check (intentional — fixed in Tasks 2 + 3). The `pnpm -F @modeldoctor/contracts build` step at the end is what allows downstream packages to even attempt their (broken) type-checks.

**Files:**
- Create: `packages/contracts/src/load-test.spec.ts`
- Modify: `packages/contracts/src/load-test.ts`, `packages/contracts/src/e2e-test.ts`, `packages/contracts/src/benchmark.ts`, `packages/contracts/src/benchmark.spec.ts`

- [ ] **Step 1.1: Write failing test for `loadTestApiTypePath`**

Create `packages/contracts/src/load-test.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ApiType } from "./load-test";
import { loadTestApiTypePath } from "./load-test";

describe("loadTestApiTypePath", () => {
  it("maps chat-family types to /v1/chat/completions", () => {
    expect(loadTestApiTypePath("chat")).toBe("/v1/chat/completions");
    expect(loadTestApiTypePath("chat-vision")).toBe("/v1/chat/completions");
    expect(loadTestApiTypePath("chat-audio")).toBe("/v1/chat/completions");
  });

  it("maps embeddings to /v1/embeddings", () => {
    expect(loadTestApiTypePath("embeddings")).toBe("/v1/embeddings");
  });

  it("maps rerank to /v1/rerank", () => {
    expect(loadTestApiTypePath("rerank")).toBe("/v1/rerank");
  });

  it("maps images to /v1/images/generations", () => {
    expect(loadTestApiTypePath("images")).toBe("/v1/images/generations");
  });

  it("type union exhaustively covered", () => {
    const all: ApiType[] = [
      "chat",
      "embeddings",
      "rerank",
      "images",
      "chat-vision",
      "chat-audio",
    ];
    for (const t of all) {
      expect(typeof loadTestApiTypePath(t)).toBe("string");
      expect(loadTestApiTypePath(t).startsWith("/v1/")).toBe(true);
    }
  });
});
```

- [ ] **Step 1.2: Run the test to confirm failure**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat/restructure
pnpm -F @modeldoctor/contracts test load-test -- --run
```

Expected: FAIL — `loadTestApiTypePath` is not exported.

- [ ] **Step 1.3: Add `loadTestApiTypePath` and rename `apiUrl` in `load-test.ts`**

Read `packages/contracts/src/load-test.ts` first. Then edit:

a) Rename every `apiUrl` field in zod schemas to `apiBaseUrl`. Today the file has it in three schemas (the partial-load-base, request, and response schemas).

b) Add at the bottom of the file (before any default-export, after schemas):

```ts
/**
 * Map a load-test ApiType to its OpenAI-compatible URL path.
 *
 * The connection store holds only the base URL (e.g. "http://host:port"
 * or "https://api.openai.com"); each backend service constructs the
 * full target by appending the apiType's path. Exhaustive switch over
 * `ApiType` — TS will error here if a new variant is added without a
 * corresponding path.
 */
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

- [ ] **Step 1.4: Rename `apiUrl` in `e2e-test.ts`**

Read `packages/contracts/src/e2e-test.ts` first. Replace every occurrence of `apiUrl` with `apiBaseUrl` in zod schemas. Update any inline doc comments that say "API URL" to "API base URL". Add a brief paragraph at the top of the file (or near the schema) noting the convention:

```ts
// Convention: `apiBaseUrl` is the origin (scheme://host[:port][/proxy-prefix]),
// without `/v1/...` path tail. Each probe constructs its target URL by
// appending its OpenAI-compatible path.
```

- [ ] **Step 1.5: Rename `apiUrl` in `benchmark.ts`**

Read `packages/contracts/src/benchmark.ts` first. Three schemas have the field today: `CreateBenchmarkRequestSchema`, `BenchmarkRunSummarySchema`, `BenchmarkRunSchema`. Replace `apiUrl` with `apiBaseUrl` in all three. Update doc-comment from "URL of the OpenAI-compatible endpoint" to "Base URL of the OpenAI-compatible endpoint (no `/v1/...` path tail; guidellm appends it)."

- [ ] **Step 1.6: Update `benchmark.spec.ts` fixtures**

Read `packages/contracts/src/benchmark.spec.ts`. Replace every `apiUrl:` literal with `apiBaseUrl:` and update the URL VALUE to be a base URL (drop any `/v1/...` tail in the test fixture's URL string).

Quick search-and-replace pattern:
```bash
sed -i '' 's/apiUrl: /apiBaseUrl: /g' packages/contracts/src/benchmark.spec.ts
```

Then manually inspect the file: any test fixture URL that ends in `/v1/chat/completions` becomes the host portion. e.g. `"http://api.example.com/v1/chat/completions"` → `"http://api.example.com"`.

- [ ] **Step 1.7: Build contracts**

```bash
pnpm -F @modeldoctor/contracts build
```

Expected: success. (If this fails, the rename is incomplete inside contracts.)

- [ ] **Step 1.8: Run contracts tests**

```bash
pnpm -F @modeldoctor/contracts test -- --run
```

Expected: All tests pass — both the new `load-test.spec.ts` (5 cases) and the updated `benchmark.spec.ts`.

- [ ] **Step 1.9: Verify downstream packages now fail (sanity)**

```bash
pnpm -F @modeldoctor/api type-check 2>&1 | tail -3
```

Expected: type errors on `apiUrl` (now removed from contracts). This confirms Task 1 is complete and Task 2 has work to do.

```bash
pnpm -F @modeldoctor/web type-check 2>&1 | tail -3
```

Same — type errors expected.

- [ ] **Step 1.10: Commit**

```bash
git add packages/contracts/src/load-test.ts \
        packages/contracts/src/load-test.spec.ts \
        packages/contracts/src/e2e-test.ts \
        packages/contracts/src/benchmark.ts \
        packages/contracts/src/benchmark.spec.ts
git commit -m "$(cat <<'EOF'
refactor(contracts): rename apiUrl → apiBaseUrl + add loadTestApiTypePath

Connection becomes pure identity (base URL only). Each backend
service constructs full URL from apiType (LoadTest) or probe type
(E2E); Benchmark/guidellm appends the path itself.

loadTestApiTypePath() lives in contracts as the single source of
truth for apiType → OpenAI path mapping. Exhaustive switch over
ApiType so future variants force a path entry at compile time.

This commit deliberately breaks downstream type-check; tasks 2 + 3
of refactor/connection-base-url restore green status. Per spec
docs/superpowers/specs/2026-04-27-connection-base-url-design.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: API + Prisma — full URL construction, schema rename, fresh init migration

This task modifies the API package and Prisma schema. After this commit, `apps/web` still has type errors but the API and DB are coherent.

**Files:** see "API (18 files)" in File Structure above.

- [ ] **Step 2.1: Read schema.prisma**

```bash
cat /Users/fangyong/vllm/modeldoctor/feat/restructure/apps/api/prisma/schema.prisma
```

Note the two models that have `apiUrl`: `LoadTestRun` and `BenchmarkRun`. Both use `@map("api_url")`.

- [ ] **Step 2.2: Edit `apps/api/prisma/schema.prisma`**

Rename the column on both models:

```prisma
// LoadTestRun
apiBaseUrl String @map("api_base_url")

// BenchmarkRun
apiBaseUrl String @map("api_base_url")
```

(Replace the existing `apiUrl String @map("api_url")` on each.)

- [ ] **Step 2.3: Reset database + delete existing migrations**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat/restructure
DATABASE_URL=$(grep "^DATABASE_URL=" .env | cut -d= -f2-) \
  pnpm -F @modeldoctor/api exec prisma migrate reset --force --skip-seed
```

Expected: Database `modeldoctor` is dropped and recreated with the OLD migrations applied. (This step exists to confirm the toolchain works before we delete the migration files.)

Now delete migration history:

```bash
rm -rf apps/api/prisma/migrations
```

- [ ] **Step 2.4: Generate fresh init migration with the new schema**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat/restructure
DATABASE_URL=$(grep "^DATABASE_URL=" .env | cut -d= -f2-) \
  pnpm -F @modeldoctor/api exec prisma migrate dev --name init
```

Expected: Prisma detects the empty migrations folder + drifted DB, prompts to reset, and generates a single `apps/api/prisma/migrations/<timestamp>_init/migration.sql` containing every table with the new column name. Database is recreated fresh; Prisma client is regenerated.

If the prompt is blocking, run with `--skip-seed` and answer "yes" interactively, or pre-empt by `pnpm -F @modeldoctor/api exec prisma migrate reset --force --skip-seed` first.

- [ ] **Step 2.5: Confirm Prisma client matches schema**

```bash
DATABASE_URL=$(grep "^DATABASE_URL=" .env | cut -d= -f2-) \
  pnpm -F @modeldoctor/api exec prisma generate
```

This re-emits the TS Prisma client with the new field name. Without this, `db.benchmarkRun.findMany({ select: { apiBaseUrl: true } })` won't compile.

- [ ] **Step 2.6: Update `load-test.service.ts`**

Read the file first. Find the line `let finalUrl = req.apiUrl;`. Replace the URL composition with:

```ts
import { loadTestApiTypePath } from "@modeldoctor/contracts";
// ...
let finalUrl = req.apiBaseUrl + loadTestApiTypePath(req.apiType);
```

Keep the existing query-param tacking-on logic (the `if (req.queryParams?.trim()) { ... }` block) — it operates on `finalUrl`, no other change needed.

Update any other `req.apiUrl` references in the file to `req.apiBaseUrl`. Search for the literal:

```bash
grep -n "apiUrl" apps/api/src/modules/load-test/load-test.service.ts
```

Replace each occurrence (likely 3-5 total).

- [ ] **Step 2.7: Update probes**

Edit the four probe files:

```ts
// apps/api/src/integrations/probes/index.ts
export interface ProbeCtx {
  apiBaseUrl: string;   // was apiUrl
  apiKey: string;
  model: string;
  extraHeaders: Record<string, string>;
}
```

```ts
// apps/api/src/integrations/probes/text.ts
// at the top of runTextProbe, after destructuring ctx
const { apiBaseUrl, apiKey, model, extraHeaders = {} } = ctx;
const targetUrl = `${apiBaseUrl}/v1/chat/completions`;
// ... in the fetch call, replace `apiUrl` with `targetUrl`:
const res = await fetch(targetUrl, { ... });
```

```ts
// apps/api/src/integrations/probes/image.ts  — analogous
const targetUrl = `${apiBaseUrl}/v1/images/generations`;
```

```ts
// apps/api/src/integrations/probes/audio.ts  — analogous
const targetUrl = `${apiBaseUrl}/v1/audio/transcriptions`;
```

- [ ] **Step 2.8: Update `e2e-test.service.ts`**

Read the file. The ctx construction looks like:

```ts
const ctx: ProbeCtx = {
  apiUrl: req.apiUrl,    // OLD
  apiKey: req.apiKey,
  ...
};
```

Replace with:

```ts
const ctx: ProbeCtx = {
  apiBaseUrl: req.apiBaseUrl,
  apiKey: req.apiKey,
  model: req.model,
  extraHeaders,
};
```

- [ ] **Step 2.9: Update `benchmark.service.ts`**

Read the file. Replace every `apiUrl` reference with `apiBaseUrl`:
- Constructor / class state: any `private readonly apiUrl` (likely none)
- `create()` writes to Prisma — change `apiUrl: req.apiUrl` to `apiBaseUrl: req.apiBaseUrl`
- `start()` builds `BenchmarkExecutionContext` — change `apiUrl: row.apiBaseUrl` to `apiBaseUrl: row.apiBaseUrl`
- Detail / summary mapping methods that copy from Prisma row to DTO

Search:
```bash
grep -n "apiUrl" apps/api/src/modules/benchmark/benchmark.service.ts
```

Each hit becomes `apiBaseUrl`.

- [ ] **Step 2.10: Update `execution-driver.interface.ts`**

```ts
// before
apiUrl: string;

// after
apiBaseUrl: string;
```

In the `BenchmarkExecutionContext` interface. Update inline doc-comment to say "Base URL (origin only); guidellm appends `/v1/chat/completions` itself."

- [ ] **Step 2.11: Update `subprocess-driver.ts`**

Read the file. The driver currently does:

```ts
TARGET_URL: ctx.apiUrl,
```

Change to:

```ts
TARGET_URL: ctx.apiBaseUrl,
```

The pod-side env name `TARGET_URL` stays — that's the runner image's contract, independent of our internal field naming.

- [ ] **Step 2.12: Update `k8s-job-manifest.ts`**

Same change: `ctx.apiUrl` → `ctx.apiBaseUrl` in the env passthrough that sets `TARGET_URL`.

- [ ] **Step 2.13: Update API spec fixtures**

Six spec files in `apps/api/src/modules/benchmark/` and one in `apps/api/src/modules/benchmark/drivers/` reference `apiUrl:` in fixtures. Mechanical search-and-replace:

```bash
for f in \
  apps/api/src/modules/benchmark/benchmark.service.spec.ts \
  apps/api/src/modules/benchmark/benchmark.controller.spec.ts \
  apps/api/src/modules/benchmark/drivers/subprocess-driver.spec.ts \
  apps/api/src/modules/benchmark/drivers/k8s-job-driver.spec.ts \
  apps/api/src/modules/benchmark/drivers/k8s-job-manifest.spec.ts \
  apps/api/src/modules/benchmark/drivers/execution-driver.interface.spec.ts; do
  sed -i '' 's/apiUrl:/apiBaseUrl:/g' "$f"
done
```

Then manually inspect each file: fixture URL strings ending in `/v1/chat/completions` → strip the suffix in the fixture so the value matches the new "base URL" semantics. e.g. `"http://api.example.com/v1/chat/completions"` → `"http://api.example.com"`.

In `k8s-job-manifest.spec.ts`, also update any assertion that the env array includes a `{ name: "TARGET_URL", value: "<full URL>" }` entry — the value now must be the base URL.

- [ ] **Step 2.14: Update LoadTest service test**

`apps/api/src/modules/load-test/load-test.service.spec.ts` — note this file may not exist as a separate spec; search for tests:

```bash
ls apps/api/src/modules/load-test/*.spec.ts 2>/dev/null
```

If it exists, update fixtures:
- `apiUrl` → `apiBaseUrl`
- Strings with `/v1/chat/completions` → strip
- Add new test: when apiType=`embeddings`, finalUrl ends in `/v1/embeddings`. When apiType=`chat-vision`, finalUrl ends in `/v1/chat/completions` (same as `chat`).

If it doesn't exist, skip — the integration tests of LoadTestPage at the web level will catch regressions.

- [ ] **Step 2.15: Run API type-check**

```bash
pnpm -F @modeldoctor/api type-check
```

Expected: 0 errors. If errors remain, search the error output for any remaining `apiUrl` reference and fix.

- [ ] **Step 2.16: Run API tests**

```bash
pnpm -F @modeldoctor/api test 2>&1 | tail -8
```

Expected: 159+ tests pass. (Count varies after our edits; main signal is "all pass".)

If any test fails:
- For "expected `apiUrl` got `apiBaseUrl`" assertion errors → update the assertion
- For URL-mismatch errors (`expected http://x got http://x/v1/chat/completions`) → the test was checking the OLD full-URL behavior; update to expect the new base-URL behavior

- [ ] **Step 2.17: Run API lint**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat/restructure/apps/api
pnpm exec biome check src
```

Expected: 0 errors.

- [ ] **Step 2.18: Commit**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat/restructure
git add apps/api/src/integrations/probes/index.ts \
        apps/api/src/integrations/probes/text.ts \
        apps/api/src/integrations/probes/image.ts \
        apps/api/src/integrations/probes/audio.ts \
        apps/api/src/modules/e2e-test/e2e-test.service.ts \
        apps/api/src/modules/load-test/load-test.service.ts \
        apps/api/src/modules/benchmark/benchmark.service.ts \
        apps/api/src/modules/benchmark/benchmark.controller.spec.ts \
        apps/api/src/modules/benchmark/benchmark.service.spec.ts \
        apps/api/src/modules/benchmark/drivers/execution-driver.interface.ts \
        apps/api/src/modules/benchmark/drivers/execution-driver.interface.spec.ts \
        apps/api/src/modules/benchmark/drivers/subprocess-driver.ts \
        apps/api/src/modules/benchmark/drivers/subprocess-driver.spec.ts \
        apps/api/src/modules/benchmark/drivers/k8s-job-manifest.ts \
        apps/api/src/modules/benchmark/drivers/k8s-job-manifest.spec.ts \
        apps/api/src/modules/benchmark/drivers/k8s-job-driver.spec.ts \
        apps/api/prisma/schema.prisma \
        apps/api/prisma/migrations
git commit -m "$(cat <<'EOF'
refactor(api): rename apiUrl → apiBaseUrl + construct full URL server-side

LoadTest now composes the target URL via apiBaseUrl + loadTestApiTypePath(apiType).
Each E2E probe inlines its own /v1/<endpoint> path. Benchmark passes
apiBaseUrl verbatim to the runner; guidellm appends the path itself
(verified end-to-end against 4pd gen-studio in the Phase 5 smoke).

Prisma schema renames the api_url column on LoadTestRun + BenchmarkRun
to api_base_url. Existing migrations cleared and replaced with a
fresh init migration — pre-prod project, no data preserved.

Web layer still uses apiUrl; type-check is intentionally broken
between this commit and the web rename. PR contains commit 3 to
restore green status.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Web — `apiBaseUrl`, `toApiBaseUrl`, persist version bump, UI labels

This task makes the web package compile against the new contracts. After this commit, the entire repo type-checks and all tests pass.

**Files:** see "Web (32 files)" in File Structure above.

- [ ] **Step 3.1: Add `toApiBaseUrl` to curl-parser with TDD**

Edit `apps/web/src/lib/curl-parser.test.ts`. Add at the end:

```ts
import { toApiBaseUrl } from "./curl-parser";

describe("toApiBaseUrl", () => {
  it.each([
    ["https://api.openai.com/v1/chat/completions", "https://api.openai.com"],
    ["https://api.openai.com/v1/embeddings", "https://api.openai.com"],
    ["https://api.openai.com/v1/rerank", "https://api.openai.com"],
    ["https://api.openai.com/v1/images/generations", "https://api.openai.com"],
    ["https://api.openai.com/v1/audio/transcriptions", "https://api.openai.com"],
    ["https://api.openai.com/v1", "https://api.openai.com"],
    ["https://api.openai.com/", "https://api.openai.com"],
    ["https://api.openai.com", "https://api.openai.com"],
    ["http://10.100.121.67:30888/v1/chat/completions", "http://10.100.121.67:30888"],
    ["http://gateway/proxy/qwen/v1/chat/completions", "http://gateway/proxy/qwen"],
    ["http://gateway/proxy/qwen", "http://gateway/proxy/qwen"],
  ])("strips %s → %s", (input, expected) => {
    expect(toApiBaseUrl(input)).toBe(expected);
  });

  it("is idempotent", () => {
    const url = "https://api.openai.com/v1/chat/completions";
    const once = toApiBaseUrl(url);
    expect(toApiBaseUrl(once)).toBe(once);
  });
});
```

Run: `pnpm -F @modeldoctor/web test src/lib/curl-parser.test.ts -- --run`. Expected: FAIL — `toApiBaseUrl` not exported.

- [ ] **Step 3.2: Implement `toApiBaseUrl`**

Edit `apps/web/src/lib/curl-parser.ts`. Add (near the existing `detectApiType` export, since they're conceptually related):

```ts
/**
 * Strip OpenAI-compatible URL path tails so `apiBaseUrl` is the canonical
 * origin (scheme://host[:port][/proxy-prefix]) — matches what guidellm
 * expects as `--target` and what LoadTest/E2E will append paths to.
 *
 * Idempotent: applying twice yields the same result. Safe to call at
 * curl-paste time AND at form submission as defense-in-depth.
 */
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

Run: `pnpm -F @modeldoctor/web test src/lib/curl-parser.test.ts -- --run`. Expected: 11+ new test cases pass.

- [ ] **Step 3.3: Update `apply-curl-to-endpoint.ts` to use `toApiBaseUrl`**

Edit `apps/web/src/lib/apply-curl-to-endpoint.ts`. Find:

```ts
if (parsed.url) {
  patch.apiUrl = parsed.url;
  filledKeys.push("apiUrl");
}
```

Replace with:

```ts
if (parsed.url) {
  patch.apiBaseUrl = toApiBaseUrl(parsed.url);
  filledKeys.push("apiBaseUrl");
}
```

Add the import:

```ts
import { type ParsedCurl, toApiBaseUrl } from "./curl-parser";
```

(Update existing import line accordingly.)

`EndpointKey` will need its element renamed too — change wherever `EndpointKey` is the type union.

- [ ] **Step 3.4: Rename `Connection` and `EndpointValues` types**

Edit `apps/web/src/types/connection.ts`:

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

export const emptyEndpointValues: EndpointValues = {
  apiBaseUrl: "",
  apiKey: "",
  model: "",
  customHeaders: "",
  queryParams: "",
};
```

- [ ] **Step 3.5: Update `connections-store.ts` — bump persist version**

Edit `apps/web/src/stores/connections-store.ts`. Find the `persist(...)` call and add/update the version field:

```ts
persist(
  (set, get) => ({ /* ... */ }),
  {
    name: "modeldoctor-connections",
    version: 1,   // bumped from default 0; old format (apiUrl with full URL) is dropped
  },
)
```

(If the file already had `version: 0` explicitly, change to 1; if not, add.)

- [ ] **Step 3.6: Update connections-store test**

Edit `apps/web/src/stores/connections-store.test.ts`:

a) Replace every `apiUrl` reference with `apiBaseUrl`. Strings ending in `/v1/...` → strip in the fixture.

b) Add a new test (at the end of the existing describe block):

```tsx
it("drops persisted v0 state on version mismatch", async () => {
  // Pre-populate localStorage with an "old format" snapshot at version 0.
  localStorage.setItem(
    "modeldoctor-connections",
    JSON.stringify({
      state: {
        connections: [
          {
            id: "c1",
            name: "old",
            apiUrl: "http://old.example.com/v1/chat/completions",
            apiKey: "k",
            model: "m",
            customHeaders: "",
            queryParams: "",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      },
      version: 0,
    }),
  );

  // Re-create the store (simulating page reload).
  // Note: the store module caches its zustand instance — reset by re-importing.
  const { useConnectionsStore: fresh } = await import(
    "./connections-store?reset=" + Date.now()
  );
  expect(fresh.getState().list()).toEqual([]);
});
```

If the dynamic re-import pattern doesn't work in this codebase (zustand module-level caching), simplify the test to:
- Pre-populate localStorage with version-0 payload
- Use `vi.resetModules()` then `await import("./connections-store")` — fresh state should be empty.

If still problematic, accept the test as out-of-scope and rely on manual verification per spec §10 step 1.

- [ ] **Step 3.7: Update `connections/schema.ts`**

Edit `apps/web/src/features/connections/schema.ts`. The zod schema for connection input has `apiUrl: z.string().url()` — rename to `apiBaseUrl`. Update inline `.refine` rules if any reference the old name.

Update `apps/web/src/features/connections/schema.test.ts` fixtures.

- [ ] **Step 3.8: Update `EndpointPicker.tsx`**

Read the file first. Three categories of edits:

a) **Field rename** — every `endpoint.apiUrl` reference becomes `endpoint.apiBaseUrl`. The component is controlled by props from a parent slice; the prop name reflects the type.

b) **Form label** — the input that today says "API URL" or `t("fields.apiUrl")` becomes "API Base URL" / `t("fields.apiBaseUrl")`. Add helper text below:

```tsx
<p className="mt-1 text-xs text-muted-foreground">
  {t("fields.apiBaseUrlHelp")}
</p>
```

(i18n key `fields.apiBaseUrlHelp` added to locales in step 3.13.)

c) **Read-only preview** — only when this picker is mounted in a context that has an `apiType` (LoadTest, E2E). Since EndpointPicker is shared, add an optional prop `previewUrl?: string`. Parent computes and passes:

```tsx
// in LoadTestPage.tsx
<EndpointPicker
  endpoint={endpoint}
  /* ...other props... */
  previewUrl={
    endpoint.apiBaseUrl
      ? `${endpoint.apiBaseUrl}${loadTestApiTypePath(slice.apiType)}`
      : undefined
  }
/>
```

Inside EndpointPicker:

```tsx
{previewUrl && (
  <div className="mt-1 text-[11px] text-muted-foreground tabular-nums">
    → POST {previewUrl}
  </div>
)}
```

For LoadTest, the import is `import { loadTestApiTypePath } from "@modeldoctor/contracts";`. For E2E, the page may want a similar preview; see step 3.10.

d) **`onSubmit` defense-in-depth** — there is likely a "save as connection" code path. Wherever the form's apiBaseUrl is committed (to local store or shipped to the server), call `toApiBaseUrl(value)` once more — covers users who hand-paste a full URL into the field. Add the import:

```ts
import { toApiBaseUrl } from "@/lib/curl-parser";
```

Then before the connection save:

```ts
const sanitized = { ...endpoint, apiBaseUrl: toApiBaseUrl(endpoint.apiBaseUrl) };
```

Do the same in `ConnectionDialog.tsx` save handler.

- [ ] **Step 3.9: Update `ConnectionDialog.tsx` and `ConnectionsPage.tsx`**

Mechanical:
- Field name: `apiUrl` → `apiBaseUrl` in form state, schema, JSX
- Label text and helper text similar to EndpointPicker
- Submit handler runs `toApiBaseUrl()` once on the value

`ConnectionsPage.tsx` (the table view): rename column header. Find any "API URL" string or `t("columns.apiUrl")` and update.

- [ ] **Step 3.10: Update LoadTest, E2E, RequestDebug pages**

Mechanical updates in three feature folders:

`apps/web/src/features/load-test/`:
- `store.ts`: any `apiUrl` field in the slice → `apiBaseUrl`
- `store.test.ts`: fixture rename
- `LoadTestPage.tsx`: `endpoint.apiUrl` references → `endpoint.apiBaseUrl`. Pass `previewUrl` to EndpointPicker (see step 3.8c).
- `LoadTestPage.test.tsx`: fixture rename + assertion updates (any test that checked the body included `apiUrl` now checks `apiBaseUrl`)

`apps/web/src/features/e2e-smoke/`:
- `store.ts`, `store.test.ts`: rename
- `E2ESmokePage.tsx`: `endpoint.apiUrl` → `endpoint.apiBaseUrl`. Optional preview here too — E2E doesn't have a single apiType so the preview can list all probes' paths or omit; pick "omit" for simplicity unless the test expects otherwise.
- `E2ESmokePage.test.tsx`: fixture rename

`apps/web/src/features/request-debug/RequestDebugPage.tsx`:
- This page sends a raw curl-style HTTP request for debugging; it might use `endpoint.apiUrl` as the literal target URL (not via apiType-path construction). Inspect the file: if it sends a fully-formed URL, KEEP that semantic but change the field name. If it relies on a saved Connection's `apiUrl`, update to use `connection.apiBaseUrl` and let the user manually append the path in the URL field at request-debug time. Read the existing tests to understand intent.

Quick search to find every web-side `apiUrl` site:

```bash
grep -rn "apiUrl" apps/web/src/ | grep -v "node_modules\|__pycache__\|locales/.*json"
```

Update each site manually — most are simple property renames.

- [ ] **Step 3.11: Update Benchmark feature folder**

`apps/web/src/features/benchmark/BenchmarkEndpointFields.tsx`:

a) Form field `register("apiUrl")` → `register("apiBaseUrl")`. Label text + helper text updated.

b) `onPickConnection` — drop any normalization step (the input `conn.apiBaseUrl` is already correct). Just:

```ts
const onPickConnection = (id: string) => {
  if (id === MANUAL) {
    /* ... */
    return;
  }
  const conn = useConnectionsStore.getState().get(id);
  if (!conn) return;
  setValue("apiBaseUrl", conn.apiBaseUrl);
  setValue("apiKey", conn.apiKey);
  setValue("model", conn.model);
  /* ...header/queryParam patches stay */
};
```

`apps/web/src/features/benchmark/BenchmarkCreateModal.tsx`:

a) RHF default values: `apiUrl: ""` → `apiBaseUrl: ""`.

b) `mapDuplicateToDefaults(run)`:

```ts
return {
  name: `${run.name}-2`,
  description: run.description ?? "",
  profile: run.profile,
  apiType: run.apiType,
  apiBaseUrl: run.apiBaseUrl,   // was run.apiUrl
  apiKey: "",
  model: run.model,
  /* ... */
};
```

c) Search for any other `apiUrl` reference in the file and rename.

`apps/web/src/features/benchmark/BenchmarkDetailPage.tsx`:

The detail view displays the saved benchmark's URL. Change `data.apiUrl` references to `data.apiBaseUrl`. Update the displayed label string ("Target URL" → "Target Base URL" or i18n equivalent).

`apps/web/src/features/benchmark/__tests__/*.test.tsx`:

Six test files. Mechanical search-and-replace:

```bash
for f in apps/web/src/features/benchmark/__tests__/*.test.tsx; do
  sed -i '' 's/apiUrl:/apiBaseUrl:/g' "$f"
  sed -i '' 's/apiUrl"/apiBaseUrl"/g' "$f"  # JSX prop names in object literals
done
```

Then manually inspect: any fixture URL string like `"http://api.test/v1/chat/completions"` becomes `"http://api.test"`.

- [ ] **Step 3.12: Update i18n locale files**

For each of `en-US/{common,connections,load-test,benchmark}.json` and `zh-CN/{common,connections,load-test,benchmark}.json`:

a) Find any key containing `apiUrl` and rename to `apiBaseUrl`.

b) Add new helper-text key under `fields` or the appropriate section:

```json
// en-US/common.json (or wherever fields are)
{
  "fields": {
    "apiBaseUrl": "API Base URL",
    "apiBaseUrlHelp": "Origin only (e.g. http://host:port or https://api.openai.com). Don't include /v1/... — the path is appended automatically based on API type."
  }
}
```

```json
// zh-CN
{
  "fields": {
    "apiBaseUrl": "API 端点 (Base URL)",
    "apiBaseUrlHelp": "只填 base URL，例如 http://host:port 或 https://api.openai.com。不要带 /v1/... 后缀；测试时根据 API 类型自动拼接。"
  }
}
```

Verify keys are referenced from the components edited above.

- [ ] **Step 3.13: Run web type-check**

```bash
pnpm -F @modeldoctor/web type-check
```

Expected: 0 errors. If errors remain, search the error output for any remaining `apiUrl` reference.

- [ ] **Step 3.14: Run web tests**

```bash
pnpm -F @modeldoctor/web test -- --run 2>&1 | tail -8
```

Expected: all tests pass. Common breakage: tests that check for specific URL strings in fixtures or assertions. Update each.

- [ ] **Step 3.15: Run web lint**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat/restructure/apps/web
pnpm exec biome check src
```

Expected: 0 errors.

- [ ] **Step 3.16: Run full repo green check**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat/restructure
pnpm -r type-check 2>&1 | tail -5
pnpm -r test -- --run 2>&1 | tail -5
```

Expected: all packages green. This is the first green commit since Task 1.

- [ ] **Step 3.17: Commit**

```bash
git add apps/web/src
git commit -m "$(cat <<'EOF'
refactor(web): apiBaseUrl + toApiBaseUrl helper + persist version bump

Connection store now persists `apiBaseUrl` (origin only). The
toApiBaseUrl() helper in curl-parser strips OpenAI-compatible path
tails idempotently — called at curl-paste time AND at form submission
as defense-in-depth.

Zustand persist version bumped from 0 → 1 so old localStorage state
(full URL) is dropped silently. Pre-prod project, no migrate function.

EndpointPicker shows a live read-only "→ POST <full-URL>" preview
based on the active LoadTest apiType. ConnectionDialog and
BenchmarkEndpointFields gain helper text spelling out the convention.

After this commit, the entire monorepo is green again — first green
state since Task 1's contracts rename.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Docs — propagate the rename through specs and `.env.example`

This task contains no code changes, only documentation. It is small enough that one commit covers everything.

**Files:**
- Modify: `docs/superpowers/specs/2026-04-25-benchmark-design.md`, `docs/superpowers/specs/2026-04-26-benchmark-phase-5-web-ui-design.md`, `.env.example`

- [ ] **Step 4.1: Search-and-replace in `2026-04-25-benchmark-design.md`**

Read the file first. The spec talks about `apiUrl` in §3.1 (Prisma schema), §4.1 (request body), §6 (security), and elsewhere.

Apply:

```bash
sed -i '' 's/apiUrl/apiBaseUrl/g' docs/superpowers/specs/2026-04-25-benchmark-design.md
sed -i '' 's/api_url/api_base_url/g' docs/superpowers/specs/2026-04-25-benchmark-design.md
sed -i '' 's/API URL/API Base URL/g' docs/superpowers/specs/2026-04-25-benchmark-design.md
```

Then read the file and inspect: any URL string in an example or table that shows `/v1/chat/completions` should be reduced to the base. Add a paragraph in §3 (or near the schema definition) noting the convention:

```markdown
### apiBaseUrl convention

`apiBaseUrl` is the origin (scheme://host[:port][/proxy-prefix]) — never includes `/v1/...` or any OpenAI-compatible path tail. The runner image translates `--target=$apiBaseUrl` and guidellm appends its own request path. See `2026-04-27-connection-base-url-design.md` for the full rationale.
```

- [ ] **Step 4.2: Search-and-replace in `2026-04-26-benchmark-phase-5-web-ui-design.md`**

Same treatment:

```bash
sed -i '' 's/apiUrl/apiBaseUrl/g' docs/superpowers/specs/2026-04-26-benchmark-phase-5-web-ui-design.md
sed -i '' 's/API URL/API Base URL/g' docs/superpowers/specs/2026-04-26-benchmark-phase-5-web-ui-design.md
```

Read the file; touch up any inline URL examples that include path tails.

- [ ] **Step 4.3: Update `.env.example`**

Read the file. The phase-3 / phase-5 sections may have inline URL examples in comments. Update any to base-URL form. The actual env-var names (`BENCHMARK_CALLBACK_URL` etc.) are unaffected.

- [ ] **Step 4.4: Commit**

```bash
git add docs/superpowers/specs/2026-04-25-benchmark-design.md \
        docs/superpowers/specs/2026-04-26-benchmark-phase-5-web-ui-design.md \
        .env.example
git commit -m "$(cat <<'EOF'
docs: propagate apiBaseUrl rename through specs + .env.example

Search-and-replace `apiUrl` → `apiBaseUrl` and `API URL` → `API Base URL`
across the two pre-existing benchmark spec docs so the older specs
agree with 2026-04-27-connection-base-url-design.md. Adds a short
"apiBaseUrl convention" paragraph to the parent benchmark spec.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Manual smoke gate (PR description checklist, not a code task)

Spec §10 lists seven smoke steps. Run them against your local k3d + 4pd gen-studio target and attach screenshots to the PR description.

- [ ] **Step 5.1: Reset DB**

```bash
DATABASE_URL=$(grep "^DATABASE_URL=" .env | cut -d= -f2-) \
  pnpm -F @modeldoctor/api exec prisma migrate reset --force --skip-seed
```

- [ ] **Step 5.2: Start dev servers**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat/restructure
pnpm dev
```

(Wait for both `localhost:3001/api/health` and `localhost:5173` to respond.)

- [ ] **Step 5.3: Walk through the 7 smoke steps from the spec**

- [ ] On `/connections`, paste a curl with full URL `http://10.100.121.67:30888/v1/chat/completions`. Verify the form auto-fills `apiBaseUrl = http://10.100.121.67:30888` (no path tail), inferred apiType = `chat`, model populated.
- [ ] Save the connection.
- [ ] On `/load-test`, load the saved connection. Verify EndpointPicker preview reads `→ POST http://10.100.121.67:30888/v1/chat/completions`. Switch apiType to `embeddings` — preview updates to `…/v1/embeddings`. Run a 5-second load test against the gateway → verify success in the API logs (the URL Vegeta hits should be the full reconstructed URL).
- [ ] On `/benchmarks`, click "Add", load the same connection. Verify the form's apiBaseUrl is the base. Run Throughput preset → expect ~40 s success, 1000/1000 metrics, same as the original Phase 5 smoke. This confirms the K8s driver still works after the field rename.
- [ ] On `/e2e`, load the connection, run text + image + audio probes. Verify each probe hits the correct path (check API logs).
- [ ] All four feature pages compile and render with no console errors.

- [ ] **Step 5.4: Push branch + open PR**

```bash
git push -u origin refactor/connection-base-url
gh pr create --base feat/restructure --head refactor/connection-base-url \
  --title "refactor(connection): apiBaseUrl + server-side path construction" \
  --body "$(cat <<'EOF'
## Summary

One-shot refactor disentangling Connection's dual semantics. `apiUrl` (which served LoadTest as a full URL but Benchmark as a base URL) becomes `apiBaseUrl` everywhere — pure base URL, never includes `/v1/...`. Each backend service constructs the full URL it needs:

- **LoadTest** uses `loadTestApiTypePath(apiType)` (new contracts util)
- **E2E probes** inline their own `/v1/<endpoint>` path
- **Benchmark** passes `apiBaseUrl` straight to guidellm — no path construction needed (verified end-to-end against 4pd gen-studio in the Phase 5 smoke)

Pre-prod project, so we drop the database (prisma migrate reset, fresh init migration) and bump the localStorage persist version to 1 instead of writing migration code.

## Spec
`docs/superpowers/specs/2026-04-27-connection-base-url-design.md`

## Commits
1. `refactor(contracts): rename apiUrl → apiBaseUrl + add loadTestApiTypePath`
2. `refactor(api): rename apiUrl → apiBaseUrl + construct full URL server-side`
3. `refactor(web): apiBaseUrl + toApiBaseUrl helper + persist version bump`
4. `docs: propagate apiBaseUrl rename through specs + .env.example`

Type-check is intentionally broken between commits 1↔2 and 2↔3; only the merged tip is green. This is OK because the four commits land as a single PR.

## Test plan

- [x] `pnpm -r type-check` clean
- [x] `pnpm -r test -- --run` all green (159 API + N web tests passing)
- [x] `pnpm -r exec biome check src` clean
- [x] Manual smoke checklist (spec §10) — see attached screenshots
- [x] LoadTest preview line shows live URL composition
- [x] localStorage persist v1 drops old saved connections (verified by re-launching from a clean tab)

## Known cleanup

After merge, any developer with a checkout that has the old DB schema will need to `pnpm -F @modeldoctor/api exec prisma migrate reset --force --skip-seed` once.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review

Done. Coverage check vs. spec sections:

| Spec section | Plan task |
|---|---|
| §1.2 deliverables (5 items) | All addressed across tasks 1-3 |
| §2.1 before/after architecture | Task 2 (api) implements the path construction split |
| §2.2 apiBaseUrl convention | Task 3 step 3.2 has the regex chain + tests |
| §3 path mapping (`loadTestApiTypePath` + probe inline + benchmark skip) | Task 1 step 1.3 + Task 2 steps 2.6-2.8 |
| §4 toApiBaseUrl helper | Task 3 steps 3.1-3.2 |
| §5 database (drop + recreate) | Task 2 steps 2.2-2.5 |
| §6 web layer changes (6 sub-areas) | Task 3 steps 3.4-3.12 |
| §7 API layer changes (3 sub-areas) | Task 2 steps 2.6-2.13 |
| §8 testing strategy | Tests embedded in each task; full suite verified at end of Task 3 |
| §9 phase decomposition (4 commits) | Tasks 1-4 |
| §10 manual smoke (7 steps) | Task 5 |
| §11 risks (5 items) | Acknowledged; no specific tasks (they're operational) |

Placeholder scan: no "TBD", no "appropriate", no "etc." used as a free-pass; every code step shows the actual code.

Type consistency: `loadTestApiTypePath` signature `(t: ApiType): string` consistent across spec, Task 1 step 1.3, Task 2 step 2.6. `toApiBaseUrl(url: string): string` consistent across spec §4, Task 3 steps 3.1-3.2, Task 3 step 3.8d, Task 3 step 3.11.
