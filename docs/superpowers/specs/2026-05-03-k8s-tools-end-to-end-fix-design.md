# K8s Benchmark Tools End-to-End Fix — Design

**Status:** Approved (verbal — design aligned with user via chat)
**Date:** 2026-05-03
**Branch:** `feat/k8s-tools-end-to-end`
**Refs:** [#78 follow-up comment](https://github.com/weetime/modeldoctor/issues/78#issuecomment-4365367933) (after PR #79 merged)

## Summary

PR #79 unblocked the `K8s benchmark` flow at the surface (env.schema, .env.example, Dockerfile chown). End-to-end Playwright validation revealed three deeper bugs that prevent guidellm and genai-perf from producing real metrics on a typical OpenAI-compatible gateway like 4pd gen-studio:

1. **The runner wrapper never injects `OPENAI_API_KEY` into guidellm's `--backend-kwargs`**, despite a comment in `tool-adapters/src/guidellm/runtime.ts:18` claiming it does. Result: every guidellm request hits the gateway without an `Authorization` header → `401 Unauthorized` → 0% success.
2. **`validateBackend` defaults to `true`**, which makes guidellm probe `/health` on the connection's apiBaseUrl. Most OpenAI-compatible gateways (gen-studio, vLLM behind some routers, etc.) don't expose `/health`, so guidellm aborts before benchmarking.
3. **Both guidellm and genai-perf load tokenizer from HuggingFace using `connection.model` as the repo id.** When the model name is a local-served identifier (e.g. `gen-studio_Qwen2.5-0.5B-Instruct-hJfe`), HF returns 401/404 and the run dies. guidellm's UI exposes a per-run "Processor" override; genai-perf has no override at all.

A fourth bug surfaces only on genai-perf: the adapter does not pass any `Authorization` header to the tool, so even after R3 is fixed, every request still gets 401.

This PR fixes all four (R1–R4) in a single change so all three tools (vegeta, guidellm, genai-perf) produce real success metrics on a typical OpenAI-compatible endpoint with a single connection setup step.

## Goals

- Vegeta still 100% success (no regression).
- Guidellm reaches `status=completed` with real success metrics (10/10 success on the test connection).
- Genai-perf reaches `status=completed` with real success metrics.
- A user creating a new connection against a gateway whose model name is not a real HF id (the common case) sets `tokenizerHfId` once on the connection and never has to re-enter it per run.

## Non-Goals

- K8sJobDriver callback URL preflight (Issue #78 Task 4 — still deferred).
- Connection apiBaseUrl preflight from inside cluster (Issue #78 Task 5 — still deferred).
- Pass-through of `connection.customHeaders` / `connection.queryParams` to guidellm and genai-perf (vegeta already passes them; the other two don't, but no live bug yet — open follow-up issue if needed).
- Any change to vegeta adapter or its image.
- CI smoke tests.

## Architecture / Components

### Bug → fix → file map

| ID | Bug | Fix site |
|---|---|---|
| R1 | guidellm `Authorization` header missing | `apps/benchmark-runner/runner/main.py` — argv preprocessor merges `OPENAI_API_KEY` into the JSON of any `--backend-kwargs=` argument before `subprocess.Popen`. Stale comment in `packages/tool-adapters/src/guidellm/runtime.ts:14-19` rewritten to describe the new contract honestly. |
| R2 | `validateBackend` default `true` probes `/health` | `packages/tool-adapters/src/guidellm/schema.ts` — flip `validateBackend.default(true)` → `default(false)` in both `guidellmParamsSchema` and `guidellmParamDefaults`. `apps/api/src/config/env.schema.ts` — flip `BENCHMARK_VALIDATE_BACKEND` default to `false`. `.env.example` line for `BENCHMARK_VALIDATE_BACKEND` updated with new default + comment about why it changed. |
| R3 | Both tools fail to load tokenizer when `connection.model` is not a HF id | `apps/api/prisma/schema.prisma` — add `tokenizerHfId String?` to `Connection`. Prisma migration via `prisma migrate dev --create-only`. `packages/tool-adapters/src/core/interface.ts` — add `tokenizerHfId?: string` to `BuildCommandPlan.connection` and update the acceptance-gate comment to reflect the new reality. `packages/tool-adapters/src/guidellm/runtime.ts` — when no `params.processor`, use `connection.tokenizerHfId`. `packages/tool-adapters/src/genai-perf/runtime.ts` — accept new `tokenizer?: string` param; resolve `params.tokenizer ?? connection.tokenizerHfId` and emit `--tokenizer` flag when non-empty. `apps/api/src/modules/run/run.service.ts:155-166` — extend the `connection` literal in the single `buildCommand` call site to include `tokenizerHfId: conn.tokenizerHfId`. `packages/contracts/src/connection.ts` — add the field to the contract. `apps/api/src/modules/connection/connection.service.ts` (and controller, DTOs) — accept + return the new field. `apps/web/src/features/connections/...` — Connections create/edit form adds "Tokenizer (HuggingFace id, optional)" field with helptext. |
| R4 | genai-perf has no `Authorization` header | `packages/tool-adapters/src/genai-perf/runtime.ts` — shell script gains `--header "Authorization: Bearer $OPENAI_API_KEY"` (the env var is already in pod env via existing `secretEnv`; shell does the substitution at runtime so api_key never enters argv). |

### Acceptance gate update

The comment at `interface.ts:67-68` says:

> ⚠ ACCEPTANCE GATE: in Phase 4 (PR 53.4), `git diff main -- this file` MUST be empty. Adding genai-perf must not require any change here.

Adding `tokenizerHfId` is consistent with the gate's *intent* (which was: adding a new tool should not require interface changes). Adding a connection-level capability that all existing tools consume identically is a different change. The new comment will read:

> ⚠ ACCEPTANCE GATE: This file is the stable interface between the api/driver layer and tool adapters. Adding a new TOOL must not require any change here. Adding a new CONNECTION-LEVEL capability that flows from db → driver → adapter (e.g. `tokenizerHfId` added in #78 follow-up) is a deliberate interface evolution and should be documented in the changelog.

### Image rebuild

R1 changes `runner/main.py`, so all three wrapper images must rebuild. Tag bumps `:dev2 → :dev3` (per the same convention PR #79 used). `.env.example` defaults synchronized to `:dev3`.

### Data flow (R3 wiring)

```
Connection row
  └── tokenizerHfId: String?  (NEW)
       │
       ↓ via ConnectionService → RunService
       │
       ↓ via K8sJobDriver.start(...) → adapter.buildCommand(plan)
       │
BuildCommandPlan.connection
  └── tokenizerHfId?: string  (NEW)
       │
       ↓ resolved in adapter
       │
guidellm: argv += [--processor=${params.processor ?? connection.tokenizerHfId}]  (when either is set)
genai-perf: shell += [--tokenizer "$N"]  with $N = params.tokenizer ?? connection.tokenizerHfId  (when either is set)
```

### Per-run override semantics

- `params.processor` (guidellm) and `params.tokenizer` (genai-perf, NEW) remain available as per-run overrides on the `/runs/new` form.
- If both per-run override and connection-level default are set, per-run wins.
- If only connection-level default is set, that's used.
- If neither is set, no `--processor` / `--tokenizer` flag is emitted (current behavior — tools fall back to using `connection.model` as the HF id, which is the original failure mode but only triggered when user explicitly avoided setting either).

## PR / Commit Layout

One PR. Six commits in dependency order (each independently reviewable):

1. `fix(runner): inject OPENAI_API_KEY into guidellm --backend-kwargs at runtime` (R1) — `apps/benchmark-runner/runner/main.py` adds `_inject_api_key_into_backend_kwargs(argv)` helper invoked before `subprocess.Popen`. Adapter comment in `tool-adapters/src/guidellm/runtime.ts` rewritten to describe the actual mechanism. Includes pytest coverage for the helper (env-set/env-unset, argv with/without --backend-kwargs, malformed JSON, multiple --backend-kwargs guards).

2. `fix(api,adapter): default validateBackend to false` (R2) — `tool-adapters/src/guidellm/schema.ts` two default flips + spec update. `apps/api/src/config/env.schema.ts` BENCHMARK_VALIDATE_BACKEND default flip + spec update. `.env.example` annotation tweak.

3. `feat(api): add Connection.tokenizerHfId field` (R3 — schema only) — Prisma migration via `prisma migrate dev --create-only`. Update `connection.service.ts` + `connection.controller.ts` + DTOs + `packages/contracts/src/connection.ts`. Vitest coverage for create/update/response shape.

4. `feat(adapters): plumb connection.tokenizerHfId through buildCommand` (R3 — wiring + R4 auth) — `packages/tool-adapters/src/core/interface.ts` field add + acceptance-gate comment rewrite. guidellm runtime: fallback to `connection.tokenizerHfId` when `params.processor` empty. genai-perf schema: add optional `tokenizer` field. genai-perf runtime: shell script adds `--header "Authorization: Bearer $OPENAI_API_KEY"` AND `--tokenizer "$N"` (when resolved value non-empty). `apps/api/src/modules/run/run.service.ts:155-166` extends the `connection` literal with `tokenizerHfId: conn.tokenizerHfId`. Adapter unit tests updated. `run.service.spec.ts` fixture extended.

5. `feat(web): expose tokenizerHfId on Connections form + tokenizer override on genai-perf` (R3 + R4 UI) — Connections form gains text input "Tokenizer (HuggingFace id, optional)" with help "Set when the connection's model name is not a HuggingFace identifier (e.g. local served names like `gen-studio_*`)." `/runs/new` genai-perf params block gains "Tokenizer (HuggingFace id, optional)" mirroring guidellm's "Processor" field.

6. `chore(runner): bump wrapper image tags :dev2 → :dev3` — `.env.example` defaults updated. `apps/benchmark-runner/README.md` `:dev2` → `:dev3` references bumped.

## Testing Strategy

### Automated
- pytest for the runner wrapper helper (`_inject_api_key_into_backend_kwargs`).
- vitest for adapter param/runtime changes (existing patterns).
- vitest for Connection contract / service / controller field add (existing patterns).
- vitest for env.schema BENCHMARK_VALIDATE_BACKEND default flip.

### Manual / Playwright (post-merge — drives the validation acceptance criteria)

The same Playwright sequence run after PR #79 (worktree at `feat/k8s-tools-end-to-end`):

1. Open Connections, edit the existing Qwen connection: set `Tokenizer = Qwen/Qwen2.5-0.5B-Instruct`, save.
2. Submit vegeta run (default params). Expect status=completed, 100% success, real metrics. (Regression guard.)
3. Submit guidellm run with the small config (`totalRequests=10, maxDurationSeconds=60, maxConcurrency=2, validateBackend=false default-now-correct`). Expect status=completed, 10/10 success, real TTFT/ITL/E2E latency in `<GuidellmReportView>`.
4. Submit genai-perf run with the small config (`numPrompts=10, concurrency=1`). Expect status=completed, 10/10 success, real metrics in `<GenaiPerfReportView>`.

If any tool's request still 401s after these changes, that's a new bug — capture in a fresh comment on the PR.

## Migration Considerations

- The new `tokenizerHfId` column is nullable. Existing connections (created before this PR) read as `null` — both adapters omit the `--processor` / `--tokenizer` flag in that case, falling back to current behavior. No backfill needed.
- Existing local devs need to:
  1. Pull this PR.
  2. Run `pnpm --filter @modeldoctor/api prisma migrate dev` to apply the new migration on the local dev DB. (Local dev DB is disposable — `prisma migrate reset --force` is pre-authorized per memory.)
  3. Rebuild + re-import all three wrapper images at `:dev3` (commands in commit 6 / PR description).
  4. Edit existing connections in the UI to set `tokenizerHfId` if their model name isn't a real HF id.

## Risks / Edge Cases

- The runner-side argv preprocessor for R1 must not mangle `--backend-kwargs=` JSON when it's already valid. Helper merges into existing JSON when present, replaces with `{"api_key": "..."}` when no backend-kwargs flag exists. Pytest covers both paths.
- The runner's `OPENAI_API_KEY` env var IS the connection's apiKey (encrypted at rest, decrypted in api before pod creation). After R1, the api_key is briefly visible in JSON inside argv to the guidellm process. Process memory exposure was already true (env var is visible to the process); no new attack surface — but the api_key now also lands in the rendered argv kept by the runner wrapper for log purposes. Existing redaction at `runner/main.py:115-123` already masks `--backend-kwargs=` so logs won't expose it. The redaction logic must continue to fire after R1 — verified by retaining the existing test for `_redacted` and adding a new test that asserts logs from a real Popen do not contain the api_key.
- The `Authorization` header literal in genai-perf's shell script (`--header "Authorization: Bearer $OPENAI_API_KEY"`) must not be quote-mangled. The shell wrapper passes positional args, so the header value isn't parameterized — it's a literal in the script. Shell expands `$OPENAI_API_KEY` at runtime. This is the same pattern vegeta uses today (writes the bearer token directly into `targets.txt`). Test by running the genai-perf adapter's `buildCommand` and asserting the script contains the literal `--header "Authorization: Bearer $OPENAI_API_KEY"`.
- Adding `tokenizerHfId` to `BuildCommandPlan.connection` violates the literal letter of the #53 Phase 4 acceptance gate but not its spirit. Comment update documents the new policy: "adding a new tool" must not change the interface; "adding a new connection-level capability" is a deliberate evolution.
- If a user sets `tokenizerHfId` to an invalid HF id (typo, deleted repo, gated repo without auth), guidellm/genai-perf will still 401/404 from HF. That's a per-connection user error surfaced through the run's stderr; no schema-level validation possible since we don't probe HF at connection-create time.

## Out-of-Scope Follow-ups

After this PR:

- Issue #78 Task 4 — K8sJobDriver callback URL preflight.
- Issue #78 Task 5 — Connection apiBaseUrl preflight from inside cluster.
- Pass-through of `connection.customHeaders` / `queryParams` to guidellm and genai-perf adapters (open new issue when first needed).
- Auto-detect `serverKind` at connection-create time and write defaults including `tokenizerHfId` (large; out of scope here).
