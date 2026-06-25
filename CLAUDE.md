# ModelDoctor — Claude autonomous-operation policy

**User authorization scope.** The user has authorized autonomous operation within this repo. In this project, do NOT stop to ask for confirmation before taking these actions:

- All local, reversible edits (Read / Edit / Write under this repo)
- Running `pnpm …`, `pnpm -r …`, `pnpm -F <pkg> …`, `pnpm dev/build/test/lint/format/type-check` (including starting and later killing the dev server the session itself launched)
- Running `psql` against the local dev DB (`postgresql://modeldoctor:modeldoctor@localhost:5432/modeldoctor`, started via brew services — no docker-compose)
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
- `git reset --hard`, `git clean -fd`, `git branch -D` of branches that have ever been pushed
- `git push origin --delete <branch>` for branches whose PR is NOT merged (in-progress work). Deleting branches whose PR is in MERGED state — verified via `gh pr list --state all --head <branch>` — is pre-authorized; clean up local worktree, local branch, and remote branch in the same turn the PR merges, and proactively prune sibling MERGED branches that are still on `origin`
- `rm -rf` that touches anything outside this repo, or that targets `.git`, `node_modules` of another worktree, or anything the user didn't explicitly nominate
- Installing a new top-level dependency the active plan did not specify, or changing `pnpm.onlyBuiltDependencies` / `packageManager` / lockfile-regeneration flags
- Running `prisma migrate reset`, dropping tables, or any other destructive DB operation against shared data
- Production deploys, uploading to registries, publishing packages, operating on cloud credentials

**Plan discipline.** When executing an implementation plan from `docs/superpowers/plans/`, follow it literally. If reality forces a deviation (npm API changed, path doesn't exist, recommended config doesn't work), **report the deviation in the turn it's discovered**; do not silently rewrite the plan.

**Commit / PR conventions.** Conventional-commit prefixes (`feat:`, `build:`, `refactor:`, `test:`, `fix:`, `docs:`, `chore:`), one logical change per commit, explicit `git add <files>` (never `git add -A`), commit bodies end with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`. For structurally-coupled work (full-stack renames, schema reset + cascading consumer changes), prefer a single PR with phase-per-commit over multiple incremental PRs that would require shim layers — long-lived feature branches are acceptable in exchange for atomic merges.

**PR follow-through.** A PR is not "done" at `gh pr create`. After opening a PR — and after every subsequent `git push` to the same branch — verify the signals before handing back to the user:

- `gh pr view <N> --json comments,reviews,statusCheckRollup,mergeStateStatus`
- `gh api repos/weetime/modeldoctor/pulls/<N>/comments` for inline review comments (top-level reviews don't include them)
- `gh pr checks <N>` for CI conclusions; if pending, `gh run watch <run-id> --exit-status` until it resolves

Surface reviewer feedback and any red checks back to the user, then either fix in a follow-up commit (with reply on the inline comment thread) or pause for direction. Do not declare "PR is open" without these signals confirmed. CI catches things that local `pnpm lint` misses when biome's cache is stale, so treat a CI failure as authoritative even if local was clean.

**Project-specific constraints (do not violate):**

- `apps/api/tsconfig.json` must not set `incremental: true` (conflicts with `nest-cli.json` `deleteOutDir`).
- Vitest config files in `apps/api/` must stay `.mts`.
- Vitest 2 across the workspace. `apps/web/src/test/setup.ts` MUST use the explicit `expect.extend(matchers)` form (importing `@testing-library/jest-dom/matchers`); the side-effect `import "@testing-library/jest-dom/vitest"` does not extend `expect` under Vitest 2.
- `apps/api/tsconfig.json` `include` must stay narrow (`["src/**/*"]`).

## Seeding built-in / official content

Built-in `evaluation_profiles` and official `benchmark_templates` are seeded via **`apps/api/prisma/seed.ts`** (Prisma's blessed seed pattern), NOT via INSERT statements inside migrations. Each row is validated through the relevant zod schema (`profileRulesSchema` from `@modeldoctor/contracts`; `guidellmParamsSchema` / `evalscopeParamsSchema` / `aiperfParamsSchema` + `applyScenarioConstraints` from `@modeldoctor/tool-adapters`) before `prisma.<model>.upsert` by stable `id` / `slug`. The schema-picker handles all three tools; add the case alongside the others when a new tool's official template lands.

- **Auto-runs** after `prisma migrate dev` and `prisma migrate reset` (Prisma reads `package.json#prisma.seed`).
- **Prod / CI**: `prisma migrate deploy` does **not** auto-seed by design — deploy pipeline must invoke `pnpm prisma db seed` after `migrate deploy`.
- **Adding a new built-in / official row**: append to `EVALUATION_PROFILES` or `BENCHMARK_TEMPLATES` in `seed.ts` with a fresh stable id/slug, then `pnpm -F @modeldoctor/api db:seed` to verify upsert.
- **Editing**: change the seed object in place — next seed run UPDATEs.
- **Removing**: delete from seed.ts AND ship a one-off migration with `DELETE FROM ... WHERE id = '...'` (seed.ts only upserts, never deletes).
- **Migrations are schema-only**. Never put `INSERT`/`UPDATE`/`DELETE` of business data in a migration — only schema changes plus the data fixups required by those schema changes (e.g., backfilling a new column from an old one). The one acceptable data-DML case is **tool-retirement deletes**: when the runtime `benchmarkToolSchema` zod enum narrows (e.g. Tasks 19/20 went 7 → 5 tools), pre-existing rows tagged with the dropped tool name become orphans that fail subsequent zod parses on every list / detail / metric read. Shipping a one-off `DELETE FROM benchmarks/benchmark_templates/saved_compares WHERE tool IN (...dropped...)` alongside the enum narrowing is a required data fixup, not a seed/business-data write. Keep this carve-out strictly to enum-narrowing fallout — adding back any other DML invites abuse.

## Insights & AI judge

- `evaluation_profiles` is read-only via API; built-ins live in seed.ts (see above section).
- `llm_judge_providers` reuses `CONNECTION_API_KEY_ENCRYPTION_KEY` (no separate env var).
- `POST /api/insights/:connectionId/synthesize` is synchronous (5-30s); cache is in-memory LRU on the API process. Do not rely on consistency across multi-replica deploys.
- AI narrative supports both `zh-CN` and `en-US`. The synthesize endpoint takes a `locale` (request schema `compareSynthesizeRequestSchema`, default `zh-CN`); the report's language follows the app UI language (Settings → Language) — the frontend passes `i18n.language` (`en-US` → `en-US`, else `zh-CN`). Prompts have per-locale instructions (`EN_SCHEMA_INSTRUCTIONS` / `ZH_SCHEMA_INSTRUCTIONS` in `prompts.ts`).

## Testing layers

1. **Unit / component (Vitest)** — `apps/web/src/**/*.test.{ts,tsx}` (UI components, stores, schemas) and `apps/api/src/**/*.spec.ts` (services, pipes). Fast, mocked.
2. **HTTP-layer e2e (Vitest + supertest)** — `apps/api/test/e2e/*.e2e-spec.ts`. Runs against `modeldoctor_test` Postgres via `pickTestDatabaseUrl`. Tests api routes end-to-end without a browser. Run via `pnpm test:e2e:api`.
3. **Browser e2e (Playwright)** — `e2e/*.spec.ts`. Auto-starts api + web on test ports (`E2E_API_PORT=3401`, `E2E_WEB_PORT=5573` by default), uses the SAME `modeldoctor_test` DB as #2 — so do not run vitest e2e and Playwright concurrently. Run via `pnpm test:e2e:browser` (or `pnpm test:e2e:browser:ui` for the UI runner).

`pnpm test:e2e` runs api e2e then browser e2e in sequence. Use it pre-PR; in CI they should be separate jobs (db reset between them).

The first browser-e2e run in a fresh worktree needs `pnpm -r build` first (so `packages/contracts/dist` exists for the api typecheck). The api e2e env in `e2e/playwright.config.ts` sets `NODE_ENV=test` plus the JWT/encryption/callback secrets explicitly — auth would silently use empty defaults otherwise.

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

### Breadcrumbs

Detail / edit / create pages MUST pass `breadcrumbs` to `PageHeader`. List pages and top-level pages (Connections, Settings, Diagnostics, Debug, Playground, Dev) MUST NOT — empty/omitted breadcrumbs render no row.

- **Shape:** `Array<{ label: string; to?: string }>` — three entries by convention: section, parent list, current page.
- **First entry (section):** `tSidebar("groups.benchmarks")` etc. No `to` — it's a grouping label, not routable.
- **Middle entry (parent list):** Always has `to` pointing at the list URL. Reuse the sidebar item label (`tSidebar("items.benchmarkInference")` etc.) so breadcrumb labels stay in sync with the nav.
- **Last entry (current):** Plain label, no `to`. For detail pages, the entity name (`benchmark.name`, `tpl.name`, `connection.name`); for create pages, `tCommon("actions.create")`.
- **Placement:** Inside `PageHeader`, immediately above the title. Single source of truth — do NOT also render a "Back to list" button in `rightSlot` (breadcrumbs absorb the nav role; `rightSlot` is for entity actions only: Re-run, Delete, Set baseline, etc.).
- **Loading / 404 states:** Still render breadcrumbs with a placeholder for the last crumb (e.g. `t("edit.title")`). Don't drop the breadcrumb row in these states — it preserves spatial consistency.

Reference: `apps/web/src/features/benchmarks/BenchmarkDetailPage.tsx` (`SCENARIO_SIDEBAR_KEY` map for scenario→sidebar key lookup).

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

### Shared field components

- **Connection picker:** any page that lets the user choose a saved connection MUST use `<ConnectionPicker>` from `apps/web/src/components/connection/ConnectionPicker.tsx`. It provides the unified dropdown (saved entries + optional Manual + "+ 新建连接") with a "粘贴 cURL" button. Do NOT roll your own select with just `useConnections()` — that misses curl-import + new-connection affordances. `<EndpointPicker>` (端点检测 / playground) embeds it for the manual-mode flow; creation pages use it directly with `allowManual={false}`.

### Page vs Dialog (creation flows)

- **Page-style** when: > 5 fields, multiple sections, contains a dynamic sub-form (e.g. `ToolParamsEditor`), needs deep-link URL params, submit navigates to a detail page. Examples: `BenchmarkCreatePage`, `TemplateCreatePage` / `TemplateEditPage`.
- **Sheet/Dialog-style** when: ≤ 5 fields (or all same-category), no sub-form, submit stays in the originating list/detail context. Most entity create/edit use shadcn `<Sheet>` (right-side drawer) for the extra vertical space — examples: `ConnectionSheet`, `DatasourceSheet`, `ChannelSheet`. Reserve `<Dialog>` (modal) for transient one-off operations that aren't full entity edits — example: `SetBaselineDialog`.

Field-count is a guideline, not a hard rule — final call is "needs sections / sub-form / deep-link".

### Table-based list pages

Skeleton, table-column conventions, action-column shape (Edit icon + DropdownMenu(Delete) under `<AlertDialog>`), and empty-state mirroring are SSOT-defined in **`docs/project-standards.md` §5 "表格列表页骨架"**. New / refactored list pages MUST follow that section. Reference impl: `apps/web/src/features/connections/ConnectionsPage.tsx`.

### Multi-section settings pages (User Center, etc.)

Pages whose body is a **set of related but independently-saved forms** (Profile, Password, Notifications, …) MUST NOT stack every section vertically on a single route — that produces a very tall page where the bottom forms are out of reach and unrelated sections compete for context.

Instead, use a **layout route with a left-rail sub-nav**:

- One `<PageHeader>` at the top (rendered by the layout) with the section's umbrella title — e.g. `me:page.title`.
- Body splits into:
  - **Left rail (`w-48 shrink-0`):** vertical `<NavLink>` list of sub-pages. Active item gets the same `bg-accent/50 text-foreground` styling as the main sidebar.
  - **Right pane (`flex-1 min-w-0`):** `<Outlet />` renders the active sub-page — typically a single `<FormSection>` with that sub-page's fields.
- **Sub-routes deep-link:** each section is a real route (e.g. `/me/profile`, `/me/security`, `/me/notifications`), so the URL identifies the active panel and back/forward navigation works.
- **Default index:** the bare parent path (`/me`) MUST redirect to the canonical first child (`/me/profile` for user center).
- **Sub-pages DON'T render their own `<PageHeader>`** — the layout owns the title. Sub-pages render their body directly (one `<FormSection>` is the common shape).
- **Sub-page action buttons** (e.g. "+ New channel" on `/me/notifications`) live as a top-right row inside the right pane, NOT in the layout's `rightSlot` — the layout's header is shared across all sub-pages and shouldn't show per-sub-page actions.

Reference: `apps/web/src/features/me/MeLayout.tsx`.
