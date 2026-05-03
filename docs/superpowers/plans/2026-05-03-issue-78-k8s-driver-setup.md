# Issue #78 — K8s Driver Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unblock the `/runs/new → /runs/:id` end-to-end flow on K8s driver by fixing three independent bugs that surfaced after PR #77: stale env-schema requirement, wrong k3d hostname in `.env.example`, and root-owned `/app` cwd in three wrapper Dockerfiles.

**Architecture:** Three independent, code-local fixes shipped as one PR with three conventional-commit-prefixed commits. No new modules, no preflight enhancements, no CI smoke test. Tag bump `:dev → :dev2` forces consumers to re-import wrapper images.

**Tech Stack:** TypeScript (Zod schema), `apps/api` vitest@2, plain-text `.env.example`, three Dockerfiles + one Markdown README.

**Spec reference:** `docs/superpowers/specs/2026-05-03-issue-78-k8s-driver-setup-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `apps/api/src/config/env.schema.ts` | Modify | Replace legacy `BENCHMARK_RUNNER_IMAGE` declaration + require with per-tool `RUNNER_IMAGE_*` require under `BENCHMARK_DRIVER === "k8s"`. |
| `apps/api/src/config/env.spec.ts` | Modify | Replace legacy k8s-driver test with per-tool tests (one per missing var) + happy-path + subprocess regression. |
| `.env.example` | Modify | Fix callback URL comment for Docker Desktop, drop legacy `BENCHMARK_RUNNER_IMAGE` block, uncomment per-tool `RUNNER_IMAGE_*` defaults with rebuild/import instructions. |
| `apps/benchmark-runner/images/guidellm.Dockerfile` | Modify | Single-RUN combine `useradd` with `chown -R runner:runner /app`. |
| `apps/benchmark-runner/images/vegeta.Dockerfile` | Modify | Same. |
| `apps/benchmark-runner/images/genai-perf.Dockerfile` | Modify | Same. |
| `apps/benchmark-runner/README.md` | Modify | Bump 5 `:dev` references → `:dev2`. |

---

## Task 1: env.schema per-tool image requirement (TDD)

**Files:**
- Modify: `apps/api/src/config/env.schema.ts:63-68, 131-137`
- Modify: `apps/api/src/config/env.spec.ts:188-202`

**Working dir:** `/Users/fangyong/vllm/modeldoctor/issue-78-k8s-setup`

### Step 1: Replace legacy k8s-driver test with per-tool tests

- [ ] Open `apps/api/src/config/env.spec.ts`. Find the existing block at lines 188-202:

```ts
    it("requires BENCHMARK_RUNNER_IMAGE when BENCHMARK_DRIVER=k8s", () => {
      expect(() => validateEnv({ ...baseDev, BENCHMARK_DRIVER: "k8s" })).toThrow(
        /BENCHMARK_RUNNER_IMAGE/,
      );
    });

    it("accepts BENCHMARK_DRIVER=k8s when image + namespace are set", () => {
      const env = validateEnv({
        ...baseDev,
        BENCHMARK_DRIVER: "k8s",
        BENCHMARK_RUNNER_IMAGE: "modeldoctor/benchmark-runner:dev",
      });
      expect(env.BENCHMARK_DRIVER).toBe("k8s");
      expect(env.BENCHMARK_K8S_NAMESPACE).toBe("modeldoctor-benchmarks");
    });
```

Replace with:

```ts
    it("requires RUNNER_IMAGE_GUIDELLM when BENCHMARK_DRIVER=k8s", () => {
      expect(() =>
        validateEnv({
          ...baseDev,
          BENCHMARK_DRIVER: "k8s",
          RUNNER_IMAGE_VEGETA: "md-runner-vegeta:dev2",
          RUNNER_IMAGE_GENAI_PERF: "md-runner-genai-perf:dev2",
        }),
      ).toThrow(/RUNNER_IMAGE_GUIDELLM/);
    });

    it("requires RUNNER_IMAGE_VEGETA when BENCHMARK_DRIVER=k8s", () => {
      expect(() =>
        validateEnv({
          ...baseDev,
          BENCHMARK_DRIVER: "k8s",
          RUNNER_IMAGE_GUIDELLM: "md-runner-guidellm:dev2",
          RUNNER_IMAGE_GENAI_PERF: "md-runner-genai-perf:dev2",
        }),
      ).toThrow(/RUNNER_IMAGE_VEGETA/);
    });

    it("requires RUNNER_IMAGE_GENAI_PERF when BENCHMARK_DRIVER=k8s", () => {
      expect(() =>
        validateEnv({
          ...baseDev,
          BENCHMARK_DRIVER: "k8s",
          RUNNER_IMAGE_GUIDELLM: "md-runner-guidellm:dev2",
          RUNNER_IMAGE_VEGETA: "md-runner-vegeta:dev2",
        }),
      ).toThrow(/RUNNER_IMAGE_GENAI_PERF/);
    });

    it("accepts BENCHMARK_DRIVER=k8s when all three RUNNER_IMAGE_* are set", () => {
      const env = validateEnv({
        ...baseDev,
        BENCHMARK_DRIVER: "k8s",
        RUNNER_IMAGE_GUIDELLM: "md-runner-guidellm:dev2",
        RUNNER_IMAGE_VEGETA: "md-runner-vegeta:dev2",
        RUNNER_IMAGE_GENAI_PERF: "md-runner-genai-perf:dev2",
      });
      expect(env.BENCHMARK_DRIVER).toBe("k8s");
      expect(env.BENCHMARK_K8S_NAMESPACE).toBe("modeldoctor-benchmarks");
      expect(env.RUNNER_IMAGE_GUIDELLM).toBe("md-runner-guidellm:dev2");
      expect(env.RUNNER_IMAGE_VEGETA).toBe("md-runner-vegeta:dev2");
      expect(env.RUNNER_IMAGE_GENAI_PERF).toBe("md-runner-genai-perf:dev2");
    });

    it("does NOT require RUNNER_IMAGE_* when BENCHMARK_DRIVER=subprocess", () => {
      const env = validateEnv({ ...baseDev, BENCHMARK_DRIVER: "subprocess" });
      expect(env.BENCHMARK_DRIVER).toBe("subprocess");
      expect(env.RUNNER_IMAGE_GUIDELLM).toBeUndefined();
    });
```

### Step 2: Run tests, verify failure

Run: `pnpm --filter @modeldoctor/api test src/config/env.spec.ts`

Expected: 3 of the 4 new k8s tests fail (the per-var "requires X" tests fail because the schema currently throws `BENCHMARK_RUNNER_IMAGE` not the per-tool name; the happy path passes because the new vars are present and the legacy require triggers a different error). The subprocess regression should pass.

If unexpected results — STOP and inspect. The exact failure shape informs the next step.

### Step 3: Update env.schema.ts — drop legacy declaration + require, add per-tool require

- [ ] Open `apps/api/src/config/env.schema.ts`. Delete line 63 and the comment at lines 64-65:

Before:
```ts
    BENCHMARK_RUNNER_IMAGE: z.string().min(1).optional(),
    // #53 Phase 2: per-tool runner images. Old BENCHMARK_RUNNER_IMAGE is
    // kept for the legacy benchmark module's path until Phase 3 deletes it.
    RUNNER_IMAGE_GUIDELLM: z.string().min(1).optional(),
```

After:
```ts
    // #53 Phase 2 (#78): per-tool runner images, required when k8s driver.
    RUNNER_IMAGE_GUIDELLM: z.string().min(1).optional(),
```

- [ ] Replace the superRefine block at lines 131-137:

Before:
```ts
    if (env.BENCHMARK_DRIVER === "k8s" && !env.BENCHMARK_RUNNER_IMAGE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["BENCHMARK_RUNNER_IMAGE"],
        message: "BENCHMARK_RUNNER_IMAGE is required when BENCHMARK_DRIVER='k8s'",
      });
    }
```

After:
```ts
    if (env.BENCHMARK_DRIVER === "k8s") {
      const perToolImages = [
        "RUNNER_IMAGE_GUIDELLM",
        "RUNNER_IMAGE_VEGETA",
        "RUNNER_IMAGE_GENAI_PERF",
      ] as const;
      for (const key of perToolImages) {
        if (!env[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when BENCHMARK_DRIVER='k8s'`,
          });
        }
      }
    }
```

### Step 4: Run tests, verify all pass

Run: `pnpm --filter @modeldoctor/api test src/config/env.spec.ts`

Expected: all tests pass, including the 4 new k8s-driver tests and the subprocess regression. No other test files run in this filter.

### Step 5: Run full api unit suite to catch regressions

Run: `pnpm --filter @modeldoctor/api test`

Expected: all tests pass. Watch for any test that referenced `BENCHMARK_RUNNER_IMAGE` outside `env.spec.ts` — there shouldn't be any (issue confirms grep was clean), but verify.

If anything breaks because some test fixture sets `BENCHMARK_RUNNER_IMAGE`, that's a stale fixture — replace with the three per-tool vars.

### Step 6: Commit

```bash
git add apps/api/src/config/env.schema.ts apps/api/src/config/env.spec.ts
git commit -m "$(cat <<'EOF'
fix(api): require per-tool RUNNER_IMAGE_* envs when k8s driver

env.schema previously asserted on the legacy single
BENCHMARK_RUNNER_IMAGE var, but the runtime path
(RunService.start → K8sJobDriver → imageForTool) reads per-tool
RUNNER_IMAGE_GUIDELLM / _VEGETA / _GENAI_PERF. After PR #77 deleted
the legacy /api/benchmarks facade, BENCHMARK_RUNNER_IMAGE has no
remaining consumer. Replace the schema requirement so a config that
validates also runs.

Per-var addIssue calls so the error names exactly the missing
variable instead of one combined message.

Refs #78 (Task 1).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `.env.example` callback URL fix + per-tool image entries

**Files:**
- Modify: `.env.example:38, 53-68`

### Step 1: Fix the callback URL comment

- [ ] Open `.env.example`. At line 38 replace:

```
# k3d:        http://host.k3d.internal:3001
```

with:

```
# k3d (Docker Desktop on Mac): http://host.docker.internal:3001
```

### Step 2: Drop the legacy BENCHMARK_RUNNER_IMAGE block

- [ ] Find the block at lines 53-60 (starts with `# Our wrapper image built from apps/benchmark-runner/Dockerfile` and ends with `BENCHMARK_RUNNER_IMAGE=modeldoctor/benchmark-runner:dev`). Delete the entire block, including its leading comment paragraph.

The block to remove (verbatim from current file):

```
# Our wrapper image built from apps/benchmark-runner/Dockerfile — entrypoint
# is `python -m runner`, which implements the env-var contract + state/metrics
# callbacks the API expects. The upstream base (gpustack/benchmark-runner) is
# bare guidellm and won't call back, so don't point this at it directly.
# Build locally first:
#   docker build -t modeldoctor/benchmark-runner:dev apps/benchmark-runner/
#   k3d image import modeldoctor/benchmark-runner:dev -c modeldoctor
# Once CI publishes per-SHA tags, switch this to modeldoctor/benchmark-runner:<sha>.
BENCHMARK_RUNNER_IMAGE=modeldoctor/benchmark-runner:dev
```

### Step 3: Replace the per-tool block

- [ ] Find the block (post-deletion line numbers will shift; locate by content) starting with `# #53 Phase 2: per-tool runner image tags` and ending with the three commented `# RUNNER_IMAGE_GENAI_PERF=...` lines:

```
# #53 Phase 2: per-tool runner image tags (used when BENCHMARK_DRIVER=k8s).
# Required when creating a run with the matching tool. The legacy
# BENCHMARK_RUNNER_IMAGE above is kept for the old benchmark module's path
# until Phase 3 deletes it.
# RUNNER_IMAGE_GUIDELLM=ghcr.io/your-org/modeldoctor-runner-guidellm:latest
# RUNNER_IMAGE_VEGETA=ghcr.io/your-org/modeldoctor-runner-vegeta:latest
# RUNNER_IMAGE_GENAI_PERF=ghcr.io/your-org/modeldoctor-runner-genai-perf:latest
```

Replace with:

```
# Per-tool runner images. Required when BENCHMARK_DRIVER=k8s.
# Build + import into k3d:
#   docker build -f apps/benchmark-runner/images/guidellm.Dockerfile   -t md-runner-guidellm:dev2   apps/benchmark-runner/
#   docker build -f apps/benchmark-runner/images/vegeta.Dockerfile     -t md-runner-vegeta:dev2     apps/benchmark-runner/
#   docker build -f apps/benchmark-runner/images/genai-perf.Dockerfile -t md-runner-genai-perf:dev2 apps/benchmark-runner/
#   k3d image import md-runner-guidellm:dev2 md-runner-vegeta:dev2 md-runner-genai-perf:dev2 -c modeldoctor
RUNNER_IMAGE_GUIDELLM=md-runner-guidellm:dev2
RUNNER_IMAGE_VEGETA=md-runner-vegeta:dev2
RUNNER_IMAGE_GENAI_PERF=md-runner-genai-perf:dev2
```

### Step 4: Verify with diff

Run: `git diff .env.example`

Expected: 3 changes total — line 38 callback URL, removed legacy block, replaced per-tool block. No accidental whitespace edits elsewhere.

### Step 5: Commit

```bash
git add .env.example
git commit -m "$(cat <<'EOF'
docs(env): correct k8s callback URL + add per-tool image entries

- Line 38: host.k3d.internal does not work on Docker Desktop for Mac
  (k3d sets it as a 198.18.0.0/15 alias that establishes a TCP
  connection but immediately closes — Empty reply from server).
  Switch to host.docker.internal which Docker Desktop already
  publishes (192.168.65.254). Annotate the line with "(Docker
  Desktop on Mac)" so Linux users know to look elsewhere.

- Drop the legacy BENCHMARK_RUNNER_IMAGE block — it has no consumer
  after PR #77 and after Task 1's schema cleanup.

- Replace the commented-out ghcr placeholders with real defaults
  matching the local build convention (md-runner-<tool>:dev2). Tag
  bump :dev → :dev2 forces a re-import; see Task 3 for why.

Refs #78 (Task 2).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Wrapper Dockerfiles chown + README tag bump

**Files:**
- Modify: `apps/benchmark-runner/images/guidellm.Dockerfile:25`
- Modify: `apps/benchmark-runner/images/vegeta.Dockerfile:54`
- Modify: `apps/benchmark-runner/images/genai-perf.Dockerfile:36`
- Modify: `apps/benchmark-runner/README.md:38, 43, 88, 131, 143`

### Step 1: Patch guidellm.Dockerfile

- [ ] Open `apps/benchmark-runner/images/guidellm.Dockerfile`. Replace line 25:

Before:
```dockerfile
RUN useradd --create-home --shell /sbin/nologin runner
```

After:
```dockerfile
RUN useradd --create-home --shell /sbin/nologin runner \
    && chown -R runner:runner /app
```

### Step 2: Patch vegeta.Dockerfile

- [ ] Open `apps/benchmark-runner/images/vegeta.Dockerfile`. Replace line 54 (same pattern):

Before:
```dockerfile
RUN useradd --create-home --shell /sbin/nologin runner
```

After:
```dockerfile
RUN useradd --create-home --shell /sbin/nologin runner \
    && chown -R runner:runner /app
```

### Step 3: Patch genai-perf.Dockerfile

- [ ] Open `apps/benchmark-runner/images/genai-perf.Dockerfile`. Replace line 36 (same pattern):

Before:
```dockerfile
RUN useradd --create-home --shell /sbin/nologin runner
```

After:
```dockerfile
RUN useradd --create-home --shell /sbin/nologin runner \
    && chown -R runner:runner /app
```

### Step 4: Verify all three diffs

Run: `git diff apps/benchmark-runner/images/`

Expected: 3 files changed; each has exactly one one-line addition (the `\` continuation + `chown -R runner:runner /app` line) and the `RUN useradd ...` line gets the trailing `\`. No other edits.

### Step 5: Local smoke build — vegeta image (the one whose bug is most reproducible)

This is local verification only, NOT a CI test (per spec, "no CI smoke test").

Run:
```bash
cd /Users/fangyong/vllm/modeldoctor/issue-78-k8s-setup
docker build -f apps/benchmark-runner/images/vegeta.Dockerfile \
             -t md-runner-vegeta:dev2-smoke \
             apps/benchmark-runner/
```

Expected: clean build through the new chown layer. The build prints the `useradd ... chown` step and proceeds.

If the build fails — STOP. Likely cause: shell line-continuation slipped, `\` is on the wrong line, or there's a stray space. Fix the Dockerfile and rerun.

### Step 6: Local smoke run — verify runner user can write to /app

Run:
```bash
docker run --rm --entrypoint sh md-runner-vegeta:dev2-smoke -c \
  'whoami && touch /app/touch-test && ls -la /app/touch-test && rm /app/touch-test && echo OK'
```

Expected output (verbatim except for the timestamp):
```
runner
-rw-r--r--    1 runner   runner   0 ... /app/touch-test
OK
```

If `touch: /app/touch-test: Permission denied` — chown didn't take. Inspect `RUN` ordering in the Dockerfile (chown must come BEFORE `USER runner`).

### Step 7: Drop the smoke image

```bash
docker image rm md-runner-vegeta:dev2-smoke
```

(Just hygiene — keeps `docker images` uncluttered.)

### Step 8: Bump README tags

- [ ] Open `apps/benchmark-runner/README.md`. Replace each `md-runner-guidellm:dev` and `md-runner-vegeta:dev` with the `:dev2` form. There are exactly 5 occurrences (lines 38, 43, 88, 131, 143).

Sanity-check after edits:

```bash
grep -n ":dev" apps/benchmark-runner/README.md
```

Expected: 5 lines, all showing `:dev2`. Zero `:dev` (without the `2`) remaining.

### Step 9: Verify no other `:dev` references in benchmark-runner that should be bumped

Run:
```bash
grep -rn "md-runner.*:dev[^2]" apps/benchmark-runner/ \
  --exclude-dir=__pycache__ --exclude-dir=node_modules
```

Expected: no output. (No stragglers — exit code 1 is fine, that just means "no matches".)

### Step 10: Commit

```bash
git add apps/benchmark-runner/images/guidellm.Dockerfile \
        apps/benchmark-runner/images/vegeta.Dockerfile \
        apps/benchmark-runner/images/genai-perf.Dockerfile \
        apps/benchmark-runner/README.md
git commit -m "$(cat <<'EOF'
fix(runner): chown /app to runner user in wrapper images

The three wrapper Dockerfiles set WORKDIR /app (root-owned) and
later switched to USER runner. At runtime the wrapper's
_materialize_input_files calls Path.cwd().symlink_to(...) into /app
and got EACCES — silently producing empty input files. vegeta hit
this most visibly: targets.txt symlink failed → cat targets.txt
empty → no report.txt → "missing 'report' output file" failure.

Single-RUN combine of useradd + chown -R so it stays one image
layer. Bump tag :dev → :dev2 (mirrored in .env.example + README) so
local devs MUST rebuild + re-import — stale :dev images keep failing
silently.

Rebuild + import:
  docker build -f apps/benchmark-runner/images/guidellm.Dockerfile   -t md-runner-guidellm:dev2   apps/benchmark-runner/
  docker build -f apps/benchmark-runner/images/vegeta.Dockerfile     -t md-runner-vegeta:dev2     apps/benchmark-runner/
  docker build -f apps/benchmark-runner/images/genai-perf.Dockerfile -t md-runner-genai-perf:dev2 apps/benchmark-runner/
  k3d image import md-runner-guidellm:dev2 md-runner-vegeta:dev2 md-runner-genai-perf:dev2 -c modeldoctor

Refs #78 (Task 3).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Push branch + open PR

### Step 1: Push branch

Run:
```bash
git push -u origin feat/issue-78-k8s-setup
```

### Step 2: Open PR

Run:
```bash
gh pr create --title "fix(api,runner): unblock k8s benchmark flow (#78)" --body "$(cat <<'EOF'
## Summary

Closes #78. Three independent blocker bugs prevented the
`/runs/new → /runs/:id` flow from running on a fresh k3d install
with `BENCHMARK_DRIVER=k8s`. None were introduced by PR #77, but
PR #77's deletion of the legacy `/api/benchmarks` facade exposed
all three in the same code path.

- **fix(api):** env.schema required the legacy
  `BENCHMARK_RUNNER_IMAGE` but the runtime path reads the per-tool
  `RUNNER_IMAGE_*` vars. Replace the schema requirement to match
  runtime; per-var error messages name the missing variable.
- **docs(env):** `.env.example` line 38 pointed at
  `host.k3d.internal:3001`, which Docker Desktop on Mac opens then
  immediately closes (`Empty reply from server`). Switch to
  `host.docker.internal:3001`. Drop the now-unused
  `BENCHMARK_RUNNER_IMAGE` block; uncomment the per-tool entries
  with build + k3d-import instructions.
- **fix(runner):** Three wrapper Dockerfiles (`guidellm`, `vegeta`,
  `genai-perf`) set `WORKDIR /app` (root-owned) before
  `USER runner`. The runner's `_materialize_input_files` symlinks
  into cwd → `EACCES`. `chown -R runner:runner /app` after
  `useradd` fixes it.

Tag bump `:dev → :dev2` is intentional — devs must rebuild +
re-import; stale `:dev` images keep failing silently.

## Out of scope

Two preflight enhancements from issue #78 are deferred (Issue
Tasks 4 and 5: callback URL preflight, connection apiBaseUrl
preflight). They make errors friendlier but don't change whether
the flow runs.

## Test plan

- [ ] `pnpm --filter @modeldoctor/api test` — env.schema tests pass
- [ ] `pnpm -r build` — clean
- [ ] Rebuild + k3d-import all three runner images per the
      commands in commit 3.
- [ ] Submit a vegeta run from `/runs/new` → reaches
      `status=completed` with `<VegetaReportView>` rendering.
- [ ] Same for guidellm (small config:
      `totalRequests=10, maxDurationSeconds=60, maxConcurrency=2`).
- [ ] Same for genai-perf (small config:
      `numPrompts=10, concurrency=1`).

## Migration note for existing local devs

After pulling this PR:

1. `cp -n .env.example .env.diff && diff .env .env.example` to see
   what changed; in particular delete `BENCHMARK_RUNNER_IMAGE` from
   your `.env` (now unused) and add the three `RUNNER_IMAGE_*`
   entries.
2. Rebuild + re-import the wrapper images at `:dev2`. The
   `:dev`-tagged images already in the cluster are stale and
   would still fail.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed. Capture for the final summary report.

### Step 3: Verify PR opens with correct files

Run:
```bash
gh pr view --json title,body,files,additions,deletions
```

Expected fields:
- `title`: matches the one above
- `files`: 7 files (env.schema.ts, env.spec.ts, .env.example, 3 Dockerfiles, README.md), plus the spec doc and this plan from the brainstorming/writing-plans phases
- `additions/deletions`: small numbers — this is a tight diff

---

## Self-Review Notes

**Spec coverage:** All three Issue Tasks (1, 2, 3) mapped to a single PR with three commits. Tag bump strategy referenced consistently across spec and plan. Out-of-scope items (Tasks 4, 5, CI smoke) explicitly deferred.

**Placeholder scan:** None. Every code block is concrete. Every command has a verbatim expected output description.

**Type consistency:** Variable names `RUNNER_IMAGE_GUIDELLM` / `_VEGETA` / `_GENAI_PERF` and image tags `md-runner-<tool>:dev2` consistent across env.schema test cases, env.example block, Dockerfile build commands, and PR description.

---

## Execution Handoff

After plan is approved by the user:

1. **Subagent-driven** for Tasks 1, 2, 3 — each task gets a fresh subagent + spec reviewer + code quality reviewer.
2. **Inline** for Task 4 (push + PR open) — single command sequence, no review needed.
3. **Then** post-merge: rebuild + k3d import images, restart api dev server, run Playwright validation for all 3 tools, write final markdown summary.
