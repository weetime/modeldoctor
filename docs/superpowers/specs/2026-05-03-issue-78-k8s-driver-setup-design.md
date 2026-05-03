# Issue #78 — K8s driver setup: env-schema/runtime mismatch + wrapper /app perm + .env doc errors

**Status:** Approved
**Date:** 2026-05-03
**Issue:** [#78](https://github.com/weetime/modeldoctor/issues/78)
**Branch:** `feat/issue-78-k8s-setup`

## Summary

Three blocker bugs surface on a fresh k3d install with `BENCHMARK_DRIVER=k8s` after PR #77 merged. Together they make the `/runs/new → /runs/:id` end-to-end flow unrunnable. Each is independent in code but they ship as one PR because no single fix unblocks the flow on its own.

## Scope

In-scope (this PR):

1. **env.schema** — replace legacy `BENCHMARK_RUNNER_IMAGE` requirement with per-tool `RUNNER_IMAGE_*` requirement when `BENCHMARK_DRIVER === "k8s"`. (Issue Task 1)
2. **`.env.example`** — fix wrong k3d callback URL comment + add per-tool `RUNNER_IMAGE_*` entries with build/import instructions. (Issue Task 2)
3. **3 wrapper Dockerfiles** — `chown` `/app` to runner user; bump image tag from `:dev` → `:dev2` so consumers know to re-import. (Issue Task 3)

Out-of-scope (deferred, no follow-up commit on issue #78 yet — left for separate issue/PR if user wants):

- Issue Task 4 — K8sJobDriver callback URL preflight (P2 enhancement).
- Issue Task 5 — Connection apiBaseUrl preflight from inside cluster (P3 enhancement).
- Optional CI smoke test for wrapper symlink permissions (issue called this "Consider adding").

Rationale: user explicitly scoped this round to "纯修 bug 让流程跑通，不要额外扩散". Both preflights are nice-to-have; they improve error messages but don't change whether the flow runs.

## Architecture / Components Touched

### `apps/api/src/config/env.schema.ts`

- Delete line 63 (`BENCHMARK_RUNNER_IMAGE` declaration) and the accompanying comment block at lines 64-65.
- Delete the `superRefine` block at lines 131-137 (legacy require).
- Add a new `superRefine` block: when `env.BENCHMARK_DRIVER === "k8s"`, each of `RUNNER_IMAGE_GUIDELLM`, `RUNNER_IMAGE_VEGETA`, `RUNNER_IMAGE_GENAI_PERF` that is missing emits its own `addIssue` (path = the missing var's name, message names that var). Per-var issues, not one combined message — so devs see exactly which var(s) to set.

### `apps/api/src/config/env.spec.ts`

- Replace existing test at line 188 (`requires BENCHMARK_RUNNER_IMAGE when BENCHMARK_DRIVER=k8s`) with three tests, one per missing var, asserting the specific var name appears in the error.
- Replace existing test at line 194 (`accepts BENCHMARK_DRIVER=k8s when image + namespace are set`) — set the three `RUNNER_IMAGE_*` vars instead of `BENCHMARK_RUNNER_IMAGE`.
- Add a regression test: `BENCHMARK_DRIVER=subprocess` does NOT require the per-tool vars.

### `.env.example`

- Line 38: `# k3d:        http://host.k3d.internal:3001` → `# k3d (Docker Desktop on Mac): http://host.docker.internal:3001`
- Delete lines 53-60 (the legacy `BENCHMARK_RUNNER_IMAGE` block including the build-instructions comment that pointed at the old single Dockerfile).
- Replace lines 62-68 (the commented-out per-tool section) with an uncommented block:
  ```
  # Per-tool runner images. Required when BENCHMARK_DRIVER=k8s.
  # Build + import into k3d:
  #   docker build -f apps/benchmark-runner/images/guidellm.Dockerfile  -t md-runner-guidellm:dev2  apps/benchmark-runner/
  #   docker build -f apps/benchmark-runner/images/vegeta.Dockerfile    -t md-runner-vegeta:dev2    apps/benchmark-runner/
  #   docker build -f apps/benchmark-runner/images/genai-perf.Dockerfile -t md-runner-genai-perf:dev2 apps/benchmark-runner/
  #   k3d image import md-runner-guidellm:dev2 md-runner-vegeta:dev2 md-runner-genai-perf:dev2 -c modeldoctor
  RUNNER_IMAGE_GUIDELLM=md-runner-guidellm:dev2
  RUNNER_IMAGE_VEGETA=md-runner-vegeta:dev2
  RUNNER_IMAGE_GENAI_PERF=md-runner-genai-perf:dev2
  ```

### Wrapper Dockerfiles (3 files)

`apps/benchmark-runner/images/{guidellm,vegeta,genai-perf}.Dockerfile`:

```dockerfile
RUN useradd --create-home --shell /sbin/nologin runner \
    && chown -R runner:runner /app
USER runner
```

(Single `RUN` to merge the chown into the user-creation layer; no separate layer needed.)

### `apps/benchmark-runner/README.md`

Bump all 5 `:dev` references at lines 38, 43, 88, 131, 143 to `:dev2`.

### What is NOT touched

`K8sJobDriver`, `run-driver.factory.ts`, runner Python wrapper, web/UI code, any other config.

## Data Flow

Unchanged. Only the validation surface (env.schema), the documentation surface (`.env.example`), and the container build artifact (Dockerfile) change. Runtime path through `RunService.start → K8sJobDriver → imageForTool(env, tool)` already reads the per-tool envs correctly — that's why the schema fix simply removes a stale guard rather than wiring new logic.

## PR / Commit Layout

One PR. Three commits in this order:

1. `fix(api): require per-tool RUNNER_IMAGE_* envs when k8s driver`
   - env.schema.ts changes + env.spec.ts updates.
   - Verifiable in isolation by running `pnpm --filter @modeldoctor/api test`.

2. `docs(env): correct k8s callback URL + add per-tool image entries`
   - `.env.example` only.
   - Pure documentation; no code.

3. `fix(runner): chown /app to runner user in wrapper images`
   - 3 Dockerfile changes + README bump if applicable.
   - Image tag bumped to `:dev2`. Commit message body lists the rebuild + `k3d image import` commands so reviewers can reproduce.

Conventional-commit prefixes per repo convention.

## Tag Bump Strategy

`:dev` → `:dev2`. Both `.env.example` defaults and (if present) README build commands switch to `:dev2`. This forces local devs to rebuild + re-import; otherwise stale `:dev` images would silently keep failing with EACCES.

## Testing Strategy

- **Unit:** `apps/api/src/config/env.spec.ts` — extend existing k8s-driver test cases.
- **Build verify:** `pnpm -r build` clean.
- **End-to-end (post-merge, in worktree):** Playwright run-through of all 3 tools (vegeta / guidellm / genai-perf) via `/runs/new → /runs/:id`. Each must reach `status=completed` with the correct `*ReportView` rendering.
- **No CI smoke test added** for wrapper symlink permission (deferred).

## Error Handling

Schema-level validation surfaces missing per-tool images at boot time (Zod refine). The error message names the specific env var so the dev knows which one to set. No runtime probing/fallback.

## Risks / Edge Cases

- Existing local `.env` files that still set `BENCHMARK_RUNNER_IMAGE` and rely on the legacy requirement: after this PR, that var becomes unused. Schema doesn't reject unknown vars (Zod default), so no breakage — the var simply has no effect. PR description should call this out.
- Existing k3d clusters with `:dev`-tagged wrapper images: those won't be auto-rebuilt. Devs need to follow the new build/import commands. PR description must include them prominently.
- `host.docker.internal` only works on Docker Desktop (Mac/Windows). Linux users using k3d-on-Docker need `--add-host=host.docker.internal:host-gateway` or similar — outside this PR's scope; the comment update calls out "(Docker Desktop)" so Linux devs know to look elsewhere.

## Out-of-Scope Follow-up Items

After this PR merges:

- File a separate issue (or comment on #78) tracking the deferred Tasks 4 and 5 (preflight enhancements).
- Optionally: a small docs note for Linux k3d devs.
