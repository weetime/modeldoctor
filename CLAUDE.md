# ModelDoctor — Claude autonomous-operation policy

**User authorization scope.** The user has authorized autonomous operation within this repo. In this project, do NOT stop to ask for confirmation before taking these actions:

- All local, reversible edits (Read / Edit / Write under this repo)
- Running `pnpm …`, `pnpm -r …`, `pnpm -F <pkg> …`, `pnpm dev/build/test/lint/format/type-check` (including starting and later killing the dev server the session itself launched)
- Running `docker compose up/down/ps/logs` for the repo's own `docker-compose.yml` and `psql` against the local dev DB
- Running `vegeta`, `curl`, and other read-only CLI tooling
- `git add`, `git commit`, `git status/diff/log/show`, `git checkout <existing-branch>`, `git stash`, `git restore` of unstaged changes
- Creating git branches whose name begins with `feat/`, `fix/`, `chore/`, `test/`, `refactor/`, `build/`, or `docs/`
- `git worktree add/remove` under `/Users/fangyong/vllm/modeldoctor/*`
- `git push -u origin <feat|fix|chore|test|refactor|build|docs>/*` — first push and subsequent fast-forward pushes to the same feature branch
- `gh pr create`, `gh pr view`, `gh pr comment`, `gh pr checks`, `gh pr diff`, `gh issue view/list/comment`, `gh run list/view`
- Dispatching subagents via the `Agent` tool; running skills

**Still confirm with the user before:**

- `gh pr merge` (or any merge to `main`/`master`)
- `git push --force*` (anywhere, on any branch)
- Any commit, push, rebase, or reset targeting `main` / `master` directly
- `git reset --hard`, `git clean -fd`, `git branch -D` of branches that have ever been pushed, `git push origin --delete …`
- `rm -rf` that touches anything outside this repo, or that targets `.git`, `node_modules` of another worktree, or anything the user didn't explicitly nominate
- Installing a new top-level dependency the active plan did not specify, or changing `pnpm.onlyBuiltDependencies` / `packageManager` / lockfile-regeneration flags
- Running `prisma migrate reset`, dropping tables, or any other destructive DB operation against shared data
- Production deploys, uploading to registries, publishing packages, operating on cloud credentials

**Plan discipline.** When executing an implementation plan from `docs/superpowers/plans/`, follow it literally. If reality forces a deviation (npm API changed, path doesn't exist, recommended config doesn't work), **report the deviation in the turn it's discovered**; do not silently rewrite the plan.

**Commit / PR conventions.** Conventional-commit prefixes (`feat:`, `build:`, `refactor:`, `test:`, `fix:`, `docs:`, `chore:`), one logical change per commit, explicit `git add <files>` (never `git add -A`), commit bodies end with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`. One phase of the NestJS refactor = one PR from a `feat/nestjs-phase-<N>` branch cut from `main`; do not mix commits across phases.

**Project-specific constraints (do not violate):**

- `apps/api/tsconfig.json` must not set `incremental: true` (conflicts with `nest-cli.json` `deleteOutDir`).
- Vitest config files in `apps/api/` must stay `.mts`.
- `apps/api` uses vitest@2, `apps/web` uses vitest@1 — do not unify.
- `apps/api/tsconfig.json` `include` must stay narrow (`["src/**/*"]`).

## Page layout convention

All top-level routed pages MUST render `PageHeader` as their first visual row:

- Left:  `title` (required) + `subtitle` (optional)
- Right: `ThemeToggle` (default-on inside `PageHeader`)
- `showThemeToggle` (default `true`) — set to `false` on pages that provide their own theme control.
- `PageHeader`'s `rightSlot` is reserved for page-level toggles (e.g. RequestDebug "show all" checkbox). Mode tabs do NOT belong in `rightSlot` — they go through `PlaygroundShell`'s `tabs` prop instead.

### Non-Playground pages

Render `<PageHeader title=... subtitle=... />` directly at the top of the page, then page body. Reference: `apps/web/src/features/load-test/LoadTestPage.tsx`.

### Playground pages

Do NOT render `<PageHeader />` directly. Pass `title` / `subtitle` as props to `PlaygroundShell`. Shell renders, top-to-bottom:

1. `PageHeader` (row 1, always)
2. Optional sub-toolbar (row 2):
   - Left: mode tabs
   - Right (left-to-right): `historySlot` · view-code button (`viewCodeSnippets`) · `toolbarRightSlot` · right-panel toggle
3. Children (main content) + `ParamsPanel` (right drawer)

Reference: `apps/web/src/features/playground/chat/ChatPage.tsx`.

### Mode tabs

Mode tabs (different modes of the same feature — e.g. image generate/edit, audio TTS/STT, chat single/compare) MUST be passed via `PlaygroundShell`'s `tabs` / `activeTab` / `onTabChange` props. Do NOT render a bespoke tab row.
