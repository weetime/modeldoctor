# Browser e2e (Playwright)

This directory holds **browser-level** end-to-end tests. They start the full
stack — Vite-served web + NestJS api + Postgres `modeldoctor_test` — and
drive Chromium through real user flows.

> Not the same as `apps/api/test/e2e/` (Vitest + supertest, HTTP-layer only).
> See [CLAUDE.md → Testing layers](../CLAUDE.md) for the layer breakdown
> and the rule that these two suites share the test DB and **must not run
> concurrently**.

## When to add a spec here

- The flow involves the browser (clicks, form fills, navigation).
- The bug it would catch is at the integration boundary — RHF + shadcn
  Form + react-i18next + react-query + the api — not pure logic that a
  Vitest unit could cover.
- HTTP-layer e2e (`apps/api/test/e2e/`) already has good coverage; you
  want to verify the UI stays wired to the api after a contract change.

## When NOT to add a spec here

- You're testing pure component logic → put it in
  `apps/web/src/.../*.test.tsx` (Vitest, fast).
- You're testing api routes / DB side-effects → put it in
  `apps/api/test/e2e/*.e2e-spec.ts` (Vitest+supertest, no browser).
- Your check would actually invoke an LLM. The test env uses placeholder
  API keys — real LLM calls 401. Smoke specs verify the request shape
  and let the upstream fail; they don't assert end-to-end success.

## Layout

```
e2e/
├── playwright.config.ts        webServer auto-starts api + web on test ports
├── helpers/
│   ├── auth.ts                 registerAndLogin(page)
│   ├── db.ts                   resetTestDb()
│   └── form.ts                 clickSave(scope) — waits for enabled
├── auth/                       register / login / logout flows
├── connections/                ConnectionDialog CRUD via UI
├── benchmarks/                 BenchmarkCreatePage + TemplateForm flows
├── playground/                 per-mode mount smokes (chat/image/audio/…)
└── diagnostics/                /diagnostics + /debug page smokes
```

Subdirs are by feature, not by user role or page — when adding a new
feature with > 1 spec, prefer a folder over piling specs at the root.
Single-spec features can stay at one file inside the folder for room to
grow.

## Running

```bash
# One-time per fresh worktree
pnpm install
pnpm -r build                                    # packages/*/dist needed by api typecheck
pnpm -F @modeldoctor/api db:setup:test           # creates modeldoctor_test + migrate deploy

# Run the suite (auto-starts api+web)
pnpm test:e2e:browser

# UI mode for local debugging (record, retry, time-travel)
pnpm test:e2e:browser:ui

# Single file
pnpm test:e2e:browser e2e/auth/auth.spec.ts
```

## Selector patterns established (copy these in new specs)

- **Cells in a table where names overlap with model column** — use
  `exact: true`: `getByRole("cell", { name: "foo", exact: true })`.
- **Inside a dialog** — scope first:
  `const dialog = page.getByRole("dialog"); dialog.getByLabel(...)`.
- **ConnectionPicker SelectTrigger** has no explicit aria-label;
  accessible name comes from placeholder text. Use
  `getByRole("combobox").first()` (the picker is the first combobox on
  pages that use it).
- **Save / Submit buttons** are gated on `formState.isValid` (mode:
  `"onTouched"`). Use `helpers/form.ts → clickSave()` which waits for
  enabled, or `await locator.press("Tab")` to force blur after `fill()`.

## What the test env can NOT test

- **Real LLM responses** — connections use a placeholder API key.
- **Successful benchmark runs** — the `subprocess` runner needs vegeta /
  guidellm / genai-perf binaries, not installed in test env. Smokes
  verify the api accepts the request body and let the runner-spawn 5xx
  through.
- **External webhooks / k8s** — same story; specs that hit those paths
  belong as opt-in integration tests with the real infra, not here.
