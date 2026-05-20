# Test audit (2026-05-20) — minor findings re-enumeration

Follow-up to issue #211. The original 2026-05-19 audit shipped critical
+ important findings in PRs #202 / #203 / #204; the minor tier was
deferred. This pass re-enumerates the minor items with crisp
`file:line` references and triages each as fix-now, fix-later, or
wontfix.

Method: 3 parallel subagent sweeps (apps/api, apps/web, packages)
constrained to MINOR-tier and the six categories listed in #211. PRs
#202–#204 territory was excluded by instruction.

**Totals:** 18 findings · 5 fix-now · 13 fix-later · 0 wontfix.

The fix-now subset lands in this same PR. Fix-later items are recorded
here so future contributors can pick them up without rediscovery; each
is small enough to fit a single-purpose PR if/when prioritized.

---

## apps/api

### fix-now

- `apps/api/test/e2e/prometheus-datasource.e2e-spec.ts:63-64` — **stale comment** — Says "the create / update / rotate paths echo it once" but neither PATCH (update) nor a rotate path is tested in this file; the claim misleads future authors into thinking the coverage exists. **Fix:** trim the clause to only mention `create`.
- `apps/api/test/e2e/prometheus-datasource.e2e-spec.ts:35-41` — **single-branch coverage** — Non-admin 403 is asserted for `POST /api/prometheus-datasources` but `POST /:id/set-default` (also admin-gated via `requireAdmin`) has no 403 branch. **Fix:** add a 4-line `it("POST set-default requires admin")` mirroring the existing 403 test.
- `apps/api/test/e2e/insights.e2e-spec.ts:48-128` — **duplicate fixture setup** — Four consecutive `it` blocks each inline `prisma.connection.create({ data: { userId, name, baseUrl: "http://x", apiKeyCipher: "v1:a:b:c", model: "m", category: "chat" } })` verbatim; only `name` varies. **Fix:** extract a `makeConn(name)` helper at the top of the describe.

### fix-later

- `apps/api/test/e2e/prometheus-datasource.e2e-spec.ts:87-123` — **test isolation** — Duplicate-name/duplicate-baseUrl tests call `prisma.prometheusDatasource.deleteMany()` inline at the top of each `it` rather than in `beforeEach`; under `vitest --shuffle` cross-test contamination is possible.
- `apps/api/src/modules/connection/connection.service.spec.ts:303` — **single-branch coverage** — `toContractPublic` is tested with a bound datasource; the unbound (`prometheusDatasource: null`) branch is not.
- `apps/api/test/e2e/{alerts,insights,saved-compares}.e2e-spec.ts` — **cross-file duplicate setup** — Three e2e files seed an `llmJudgeProvider` with the same `deleteMany + create + encrypt` shape; ripe for a `seedLlmJudgeProvider(prisma, key)` helper in `test/helpers/`.

---

## apps/web

### fix-now

- `apps/web/src/features/benchmarks/__tests__/SetBaselineDialog.test.tsx:40-41, 67-69, 82-84` — **fragile selector** — `getAllByRole("button").find(b => b.type === "submit")` selects by DOM attribute rather than accessible name. Three occurrences in the same file. **Fix:** replace each with `getByRole("button", { name: /^保存$|^Save$/i })` (the dialog has only one Save button).

### fix-later

- `apps/web/src/features/playground/image/ImagePage.test.tsx:72` — **fragile selector** — `.at(-1)` on `getAllByRole("button", { name: /^generate$/i })` silently picks the wrong button if a second "generate" appears in the page tree. Add `data-testid="generate-btn"` and switch to `getByTestId`.
- `apps/web/src/features/quality-gate/__tests__/EvaluationsListPage.test.tsx:76` — **fragile selector** — `getByText("4")` matches a raw digit globally. Replace with `within(row).getByText("4")`.
- `apps/web/src/features/connections/ConnectionsPage.test.tsx` — **single-branch coverage** — Only populated case tested; no empty-list, no loading, no fetch-error branch. Add at least empty + error cases.
- `apps/web/src/features/quality-gate/__tests__/RunsListPage.test.tsx` — **single-branch coverage** — Only happy-path; no empty, loading, or error tested.
- `apps/web/src/features/benchmark-templates/__tests__/{TemplateCreatePage,TemplateEditPage,TemplateListPage}.test.tsx` — **wrapper duplication** — Three near-identical `Wrapper` (QueryClientProvider + MemoryRouter) declarations. Extract a `__tests__/helpers.tsx` with an optional `initialEntries` param.
- `apps/web/src/features/playground/{image,embeddings,chat,rerank}/*Page.test.tsx` — **mock duplication** — Identical 9-line `vi.mock("@/features/connections/queries", ...)` block + matching `SAMPLE_CONN` fixture across 4+ playground test files. Hoist to a shared playground fixtures module.
- `apps/web/src/features/playground/chat/{MessageList,MessageComposer}.test.tsx` — **helper duplication** — Two files in the same dir each define an identical `renderWithI18n`. Move to a shared helper.

---

## packages

### fix-now

- `packages/tool-adapters/src/category-defaults.ts:39` — **stale comment** — JSDoc references "`prometheusUrl` presence" but post-#199 the gate is `connection.prometheusDatasource` (an object, not a URL). Comment is in production source but content-only — the runtime check elsewhere already uses the new field. **Fix:** update the comment to reference `prometheusDatasource`.

### fix-later

- `packages/contracts/src/engine-metrics.spec.ts:64` — **uncommented magic index** — `ok.panels[2].thresholds` accesses the third panel by bare numeric index. Add an inline comment explaining why `panels[2]` is the `success_rate` panel.
- `packages/contracts/src/quality-gate/__tests__/judge-config.spec.ts` — **single-branch coverage** — `contains` and `regex` judge variants only have failure tests; happy-path `.parse(valid)` assertions are missing.
- `packages/contracts/src/connection.spec.ts:234-270` — **single-branch coverage** — `discoverConnectionResponseSchema` has two happy-path tests but zero failure cases (missing `inferred.serverKind`, invalid `prometheusUrl` format, etc.).

---

## Notes on what isn't here

- The original audit's CRITICAL + IMPORTANT findings — already shipped in PRs #202 / #203 / #204.
- The `process.env.X = ...` anti-pattern in e2e specs — already locked in by the lint script in PR #214 (closes #209).
- The MCP_* fixture fold — already shipped in PR #213 (closes #206).
- The echarts mock pre-existing fragmentation — already deduped by PR #204; this audit verified no regressions.

## Acceptance check vs. issue #211

- [x] Markdown report committed at `docs/superpowers/audit/2026-05-20-test-minor-followup.md` with crisp `file:line` items.
- [x] Each item triaged: 5 fix-now / 13 fix-later / 0 wontfix.
- [x] Fix-now subset ships in this same PR.
