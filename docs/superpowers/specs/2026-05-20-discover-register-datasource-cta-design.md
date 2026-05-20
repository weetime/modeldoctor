# Discover → Register-as-Datasource CTA (issue #207)

**Status:** approved · 2026-05-20
**Scope:** apps/web (ConnectionSheet + DatasourceSheet)
**Closes:** #207

## Problem

After PR #199, `DiscoverConnectionResponse.inferred.prometheusUrl.value`
is detected by Connection Discover but there is no UX path from
"discovered" to "registered as a Prometheus datasource". The user must
copy the URL, navigate to `/settings/prometheus-datasources`, click
"+ 新增数据源", and paste — at which point most users give up.

The original issue surveyed three directions and recommended a toast
action button (Direction 1). On re-read of the auto-apply success path
in `ConnectionSheet.tsx` we are picking **Direction 2 — an inline pill
beneath the `prometheusDatasourceId` Select** — because the user is
contextually right there, the pill persists until acted on, and the
"toast TTL is too short" failure mode is real for users who scan the
form for a few seconds.

## Out of scope

- Auto-registration without user confirm (security).
- Re-running Discover on `edit` open of an existing Connection to
  populate `inferredPrometheusUrl` without an explicit user gesture.
- Promoting Alertmanager to a first-class entity (tracked in #210).
- Any backend changes — `POST /api/prometheus-datasources` already
  exists and is admin-gated.

## Visibility rule

The pill renders when ALL four conditions hold:

```
showPill =
     inferredPrometheusUrl != null                              // (1)
  && !datasources.some(d => d.baseUrl === inferredPrometheusUrl) // (2)
  && form.watch("prometheusDatasourceId") == null                // (3)
  && isAdmin                                                     // (4)
```

1. **Source of `inferredPrometheusUrl`** — a new
   `useState<string | null>` in `ConnectionSheet`. `runDiscover`'s
   success branch sets it from `res.inferred.prometheusUrl.value`
   regardless of `filled === 0` vs `filled > 0`. The existing
   `discoverResult` state's semantics are **unchanged**: it is still
   set only on the `filled === 0` fallback so the
   `DiscoverResultBanner` mount condition stays identical.
   - Cleared on **ConnectionSheet** close (alongside `discoverResult` /
     `discoverError` in the existing reset `useEffect`) and when
     `onSaved` fires (condition 3 alone would already hide it once the
     form's id is set, but explicit clear avoids a one-frame flash).
2. **Dup-check** uses `useDatasources()` which is already loaded in
   `ConnectionSheet` for the Select options. Compare on `baseUrl`
   (string equality — the create schema already trims/normalizes).
3. **Already-bound** — if the user has selected any datasource from
   the dropdown (including the auto-default), respect that choice and
   stop nudging.
4. **Admin gate** — backend rejects non-admin with 403. Use the
   established pattern `useAuthStore(s => s.user)` +
   `(user?.roles ?? []).includes("admin")`. Non-admin sees nothing.

## Pill placement and visual

The pill lives inside the existing `<FormField name="prometheusDatasourceId">`
`FormItem`, after the `<p className="mt-1 text-xs text-muted-foreground">`
help line and before `<FormMessage />`. Rendering only when
`showPrometheusDatasourceField` is already true keeps it scoped to the
right `serverKind`s (model + gateway).

Visual style:

- One row, `rounded-md border bg-muted/40 px-3 py-2 text-sm`.
- Left half: `<Sparkles className="h-4 w-4 text-muted-foreground" />`
  + headline `推断到 <code>{url}</code>` + secondary `尚未注册为数据源`.
- Right side: `<Button size="sm" variant="outline">注册为数据源 →</Button>`.

No emoji. No dismiss button — pill self-dismisses when any of the four
conditions flips false. The "nag" risk is low because conditions 2 + 3
naturally clear it after the user takes any action.

## DatasourceSheet extension

`DatasourceSheetMode` gains an optional `initial` on the `create`
variant:

```ts
export type DatasourceSheetMode =
  | { kind: "create"; initial?: Partial<DatasourceInput> }
  | { kind: "edit"; existing: PrometheusDatasourcePublic };
```

The form `defaultValues` resolve to `{ ...empty, ...(mode.initial ?? {}) }`
when `mode.kind === "create"`. `edit` mode is untouched.

`useEffect` that resets the form on `open` / `mode` change must thread
`mode.initial` through so re-opening the sheet with different initial
values re-seeds the form (today the equivalent loop seeds from
`existing`).

Existing call site in `DatasourcesPage.tsx` (which always passes
`{ kind: "create" }` with no initial) needs no change — `initial` is
optional.

## Name-derivation utility

```ts
// apps/web/src/features/prometheus-datasources/derive-name.ts
export function deriveDatasourceNameFromUrl(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}
```

Pure function, exported for unit testing. Used by ConnectionSheet to
build `initial.name` when opening the register sheet. If it returns
empty, the user simply types a name in the Sheet — the form is still
valid because `baseUrl` is pre-filled.

## Post-save behavior

`<DatasourceSheet onSaved={(ds) => …}>` callback fires
`form.setValue("prometheusDatasourceId", ds.id, { shouldDirty: true })`
on the Connection form and clears `inferredPrometheusUrl`. The
`shouldDirty: true` is intentional — this is a user-initiated bind, so
the Connection's Save button must light up.

`useCreateDatasource` already invalidates the `datasources` query on
success, so the Select's options re-render with the new row and the
new `id` resolves cleanly.

## i18n keys

`apps/web/locales/{zh,en}/connections.json`:

```jsonc
"dialog.discover.registerCta": {
  "headline": "推断到 {{url}}",     // en: "Detected {{url}}"
  "body": "尚未注册为数据源",         // en: "Not registered as a datasource yet"
  "action": "注册为数据源"            // en: "Register as datasource"
}
```

## Tests

### ConnectionSheet (vitest + RTL, existing `ConnectionSheet.test.tsx`)

1. **Renders pill on the auto-apply path** — mock `useDatasources` →
   `[]`, `useAuthStore` user with `roles: ["admin"]`, mock
   `discoverConnection` returning `inferred.prometheusUrl.value =
   "http://prom:9090"` plus at least one other inferred field so
   `countFilledFields > 0` (the toast/auto-apply branch). Trigger
   Discover via the explicit button. Assert pill visible.
2. **Hidden by dup** — same as (1) but `useDatasources` returns
   `[{ baseUrl: "http://prom:9090", … }]`. Assert pill absent.
3. **Hidden when bound** — same as (1) but the Connection being
   edited already has `prometheusDatasourceId` set. Assert pill absent.
4. **Hidden for non-admin** — same as (1) but `roles: []`. Assert
   pill absent.
5. **Opens sheet with initial** — click pill, assert
   `DatasourceSheet` rendered with `mode.kind === "create"` and
   `mode.initial.baseUrl === "http://prom:9090"` (mock the sheet to
   capture props rather than render its internals).
6. **onSaved auto-selects + clears pill** — simulate the captured
   `onSaved({ id: "new-id" })`. Assert
   `form.getValues("prometheusDatasourceId") === "new-id"` (via a
   hidden test probe or by asserting the Select displays the new
   option label). Assert pill no longer in the DOM.

### DatasourceSheet (extend existing `DatasourceSheet.test.tsx`)

7. **initial pre-fills form** —
   `mode={{ kind: "create", initial: { baseUrl: "http://x", name: "x" } }}`.
   Assert the rendered inputs carry those values without user typing.
8. **Regression: create with no initial** — `mode={{ kind: "create" }}`.
   Assert empty defaults (same as current behavior).

### derive-name (new tiny unit test)

9. `deriveDatasourceNameFromUrl("http://prom.lab:9090/")` → `"prom.lab:9090"`.
10. `deriveDatasourceNameFromUrl("not a url")` → `""`.
11. `deriveDatasourceNameFromUrl(null)` → `""`.

## Files touched

- `apps/web/src/features/connections/ConnectionSheet.tsx` — new
  `inferredPrometheusUrl` state, `runDiscover` augmentation, pill
  render block, register-sheet state + `onSaved`.
- `apps/web/src/features/connections/ConnectionSheet.test.tsx` —
  tests 1–6.
- `apps/web/src/features/prometheus-datasources/DatasourceSheet.tsx`
  — type widening + `defaultValues` resolution.
- `apps/web/src/features/prometheus-datasources/DatasourceSheet.test.tsx`
  — tests 7–8.
- `apps/web/src/features/prometheus-datasources/derive-name.ts`
  (new) + `derive-name.test.ts` (new) — tests 9–11.
- `apps/web/locales/zh/connections.json`,
  `apps/web/locales/en/connections.json` — three i18n keys.

## Acceptance (issue #207)

- [x] After Discover success with `inferred.prometheusUrl.value`
  present, user sees an actionable affordance — **the pill**.
- [x] Click → DatasourceSheet opens pre-populated (URL + name from
  baseUrl host).
- [x] Test on the auto-apply path asserts the CTA appears (test 1).
