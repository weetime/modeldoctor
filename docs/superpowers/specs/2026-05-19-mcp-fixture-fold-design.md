# MCP e2e fixture fold-in (#206)

**Date:** 2026-05-19
**Issue:** [#206](https://github.com/weetime/modeldoctor/issues/206) — `e2e: fold MCP_BEARER_TOKEN / MCP_USER_ID into E2E_ENV_DEFAULTS fixture`
**Labels:** area/api, P3, refactor, test

## Problem

`apps/api/test/setup/e2e-env-defaults.ts` (introduced in PR #201) pre-injects e2e
secrets via vitest's `env:` block so they reach `NestConfigModule.forRoot`
before any spec's `beforeAll` runs. All e2e secrets use this fixture **except**
`MCP_BEARER_TOKEN` / `MCP_USER_ID` — those two are the last hold-outs of the
"set `process.env.X` in `beforeAll`" anti-pattern.

Why the carve-out existed: `mcp.e2e-spec.ts` has a `503 when MCP_* unset` test
that depends on `ConfigService` falling back to live `process.env`. If
`E2E_ENV_DEFAULTS` defined `MCP_*`, `validatedEnv` would lock those values at
forRoot time and the unset path would no longer be reachable.

Risk: a future MCP e2e test that runs in a different file ordering can trip
the same root cause that originally caused the alerts webhook 401 fixed by
PR #201.

## Resolution: delete the redundant e2e + fold the fixture

The "503 when unset" path is **already** unit-covered comprehensively by
`apps/api/src/modules/mcp/mcp.guard.spec.ts`:

- L34–38: `MCP_BEARER_TOKEN` unset → `ServiceUnavailableException`
- L40–44: `MCP_USER_ID` unset → `ServiceUnavailableException`

The matching e2e in `mcp.e2e-spec.ts` (`describe "MCP /mcp (e2e)"`, L11–35)
re-asserts the same `canActivate` branch through the HTTP layer. The
`ServiceUnavailableException → 503` mapping is a Nest framework guarantee
covered by the global `AllExceptionsFilter` spec. Net: the e2e block adds no
unique coverage — it only forces the `process.env` carve-out.

Once that block is gone, MCP_* can join the fixture and the second describe
block (`MCP /mcp tools registry (e2e)`) drops its `process.env` mutations in
favour of importing from `E2E_ENV_DEFAULTS`, matching the pattern that
`alerts.e2e-spec.ts` and `subscribers.e2e-spec.ts` already follow.

## Changes

### 1. `apps/api/test/setup/e2e-env-defaults.ts`

- Add `MCP_BEARER_TOKEN` (40-char placeholder) and `MCP_USER_ID` ("e2e-mcp-test-user") to the constant.
- Drop the "MCP_BEARER_TOKEN / MCP_USER_ID" paragraph from the "NOT included by design" docstring block.

### 2. `apps/api/test/e2e/mcp.e2e-spec.ts`

- Delete `describe("MCP /mcp (e2e)")` (the 503-when-unset block, lines 11–35).
- In the remaining `describe("MCP /mcp tools registry (e2e)")`:
  - Remove `process.env.MCP_BEARER_TOKEN = TOKEN` / `process.env.MCP_USER_ID = FAKE_USER_ID` lines from `beforeAll`.
  - Remove the matching `delete process.env.MCP_*` lines from `afterAll`.
  - Replace local `const TOKEN = "test-mcp-token-…"` / `const FAKE_USER_ID = "mcp-test-user"` with imports from `../setup/e2e-env-defaults.js`.

### 3. `apps/api/vitest.e2e.config.mts`

- Update the inline comment near `...E2E_ENV_DEFAULTS` to drop the "MCP_* carve-out" reference (currently lines 33–35).

### 4. No new tests

The "missing secret → 503" guarantee is already covered by the existing
`mcp.guard.spec.ts` unit tests. Adding more would be redundant.

## Acceptance (from issue)

- [x] `mcp.e2e-spec.ts` no longer mutates `process.env.MCP_*`
- [x] "missing secret → 503" still has explicit test coverage (unit, in `mcp.guard.spec.ts`)
- [x] `E2E_ENV_DEFAULTS` is the single source of truth for ALL e2e secrets

## Out of scope

- Spawn-subprocess approach (issue's option 2) — rejected: high cost, no
  additional coverage beyond what the guard unit spec already provides.
- Any change to MCP guard runtime behaviour. This is a pure test refactor.
- Adding new MCP e2e coverage — separate concern.

## Verification plan

1. `pnpm -F @modeldoctor/api test -- mcp.guard.spec` — unit tests still pass.
2. `pnpm test:e2e:api` — full api e2e suite passes, including the surviving
   tools/list test in `mcp.e2e-spec.ts`.
3. `pnpm -F @modeldoctor/api lint` / `type-check`.
