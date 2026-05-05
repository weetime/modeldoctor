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

**PR follow-through.** A PR is not "done" at `gh pr create`. After opening a PR — and after every subsequent `git push` to the same branch — verify the signals before handing back to the user:

- `gh pr view <N> --json comments,reviews,statusCheckRollup,mergeStateStatus`
- `gh api repos/weetime/modeldoctor/pulls/<N>/comments` for inline review comments (top-level reviews don't include them)
- `gh pr checks <N>` for CI conclusions; if pending, `gh run watch <run-id> --exit-status` until it resolves

Surface reviewer feedback and any red checks back to the user, then either fix in a follow-up commit (with reply on the inline comment thread) or pause for direction. Do not declare "PR is open" without these signals confirmed. CI catches things that local `pnpm lint` misses when biome's cache is stale, so treat a CI failure as authoritative even if local was clean.

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

Render `<PageHeader title=... subtitle=... />` directly at the top of the page, then page body. Reference: `apps/web/src/features/benchmarks/BenchmarkCreatePage.tsx`.

### Playground pages

Do NOT render `<PageHeader />` directly. Pass `title` / `subtitle` as props to `PlaygroundShell`. Shell renders, top-to-bottom:

1. `PageHeader` (row 1, always)
2. Sub-toolbar (row 2) — rendered when `paramsSlot` is non-null OR any of `tabs` / `historySlot` / `viewCodeSnippets` / `toolbarRightSlot` is non-empty:
   - Left: mode tabs
   - Right (left-to-right): `historySlot` · view-code button (`viewCodeSnippets`) · `toolbarRightSlot` · right-panel toggle (only when `paramsSlot` is non-null)
3. Children (main content) + `ParamsPanel` (right drawer)

Reference: `apps/web/src/features/playground/chat/ChatPage.tsx`.

### Mode tabs

Mode tabs (different modes of the same feature — e.g. image generate/edit, audio TTS/STT, chat single/compare) MUST be passed via `PlaygroundShell`'s `tabs` / `activeTab` / `onTabChange` props. Do NOT render a bespoke tab row.

### Page body layout (right-side main area)

All non-Playground page bodies (the area below `PageHeader`) MUST follow these rules:

- **Wrapper:** `<div className="px-8 py-6 space-y-6">` (or `space-y-4` for tighter pages). NEVER add `mx-auto` or `max-w-*` to the page body — content is left-aligned and fills the available width inside the sidebar/main split. Reference: `apps/web/src/features/diagnostics/DiagnosticsPage.tsx` (端点检测).
- **Padding:** `px-8 py-6` is the standard. Do not vary unless the page has a special full-bleed need.
- **Section spacing:** between sibling sections, prefer `space-y-6` or `space-y-8`. Inside a section, `space-y-3` (default in `<FormSection>`).

### Creation/edit form pages

All forms (page-style and dialog-style alike) follow the unified shadcn `<Form>` stack. Required components live in `apps/web/src/components/ui/form.tsx` and `apps/web/src/components/common/{form-section,form-actions}.tsx`.

- **Form provider:** wrap fields in `<Form {...form}>`. Use `useForm({ mode: "onTouched", resolver: zodResolver(schema), defaultValues })`.
- **Validated fields:** use `<FormField>` → `<FormItem>` → `<FormLabel required?>` + `<FormControl>` + `<FormMessage />`. Required fields get `<FormLabel required>` (renders red `*`).
- **Non-validated auxiliary fields** (`tags` chip input, `isOfficial` checkbox, etc.): keep bare `<Label>` + native input outside `<FormField>` — `FormLabel`/`FormItem` would crash without `FormField` context.
- **Sections:** use `<FormSection title? description?>`. Renders flat (no card chrome) — fields sit on the page background, sections separated by small-caps title + bottom spacing.
- **Field grouping:** pair fields by business meaning, don't waste a row on a single narrow control. Use `<div className="grid grid-cols-1 gap-4 md:grid-cols-2">` (responsive: stacks on mobile, 2-col on tablet+) for natural pairs (e.g. name + tags, baseUrl + model, scenario + tool). Long inputs (textarea, full URL) keep their own row.
- **Footer:** use `<FormActions onCancel cancelLabel submitLabel disabled pending leading?>`. `cancelLabel` MUST be passed (no English fallback). For destructive actions (Delete on edit pages), pass them via `leading` slot.
- **i18n validation:** zod default error messages route through the global `z.setErrorMap` in `apps/web/src/lib/i18n.ts` (zh-CN + en-US under `common.validation.*`). For `.refine(message: …)` use `validation.someKey` keys — zod v3 short-circuits the errorMap for explicit refine messages, so `<FormMessage>` performs a render-time `i18n.t()` fallback.

### Page vs Dialog (creation flows)

- **Page-style** when: > 5 fields, multiple sections, contains a dynamic sub-form (e.g. `ToolParamsEditor`), needs deep-link URL params, submit navigates to a detail page. Examples: `BenchmarkCreatePage`, `TemplateCreatePage` / `TemplateEditPage`.
- **Dialog-style** when: ≤ 5 fields (or all same-category), no sub-form, submit stays in the originating list/detail context. Examples: `ConnectionDialog`, `SetBaselineDialog`.

Field-count is a guideline, not a hard rule — final call is "needs sections / sub-form / deep-link".
