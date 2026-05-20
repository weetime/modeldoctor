# Discover → Register-as-Datasource CTA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After Connection Discover infers a Prometheus URL that isn't yet a registered datasource, show the admin user a contextual pill below the `prometheusDatasourceId` Select. Clicking it opens `DatasourceSheet` pre-populated with the URL + a derived name; on save, the new datasource id is auto-bound into the Connection form.

**Architecture:**
- One new tiny pure utility (`derive-name.ts`) for URL → host extraction.
- One discriminated-union widening (`DatasourceSheetMode.create.initial`) so the existing sheet can be opened with pre-filled values.
- New state + render block in `ConnectionSheet` that tracks the inferred URL across Discover runs and renders the pill when 4 conditions hold (URL present, not already registered, no datasource bound, user is admin).

**Tech Stack:** React 18 + TypeScript, React Hook Form, react-query (already wired), sonner (toast — not used by this feature), vitest + @testing-library/react, i18next.

---

## Spec reference

`docs/superpowers/specs/2026-05-20-discover-register-datasource-cta-design.md` — read it first if anything below is ambiguous.

## File map

| Path | Action | Purpose |
|---|---|---|
| `apps/web/src/features/prometheus-datasources/derive-name.ts` | create | `deriveDatasourceNameFromUrl(url)` — URL→host, empty on parse fail |
| `apps/web/src/features/prometheus-datasources/derive-name.test.ts` | create | unit tests for the utility |
| `apps/web/src/features/prometheus-datasources/DatasourceSheet.tsx` | modify | widen `DatasourceSheetMode`, thread `initial` into default values + reset effect |
| `apps/web/src/features/prometheus-datasources/DatasourceSheet.test.tsx` | modify | tests 7 + 8 from spec (initial pre-fills + create-with-no-initial regression) |
| `apps/web/src/features/connections/ConnectionSheet.tsx` | modify | `inferredPrometheusUrl` state, Discover wiring, pill render, register-sheet wiring, `onSaved` auto-select |
| `apps/web/src/features/connections/ConnectionSheet.test.tsx` | modify | tests 1–6 from spec |
| `apps/web/src/locales/zh-CN/connections.json` | modify | `dialog.discover.registerCta.{headline,body,action}` |
| `apps/web/src/locales/en-US/connections.json` | modify | same three keys in English (lint enforces parity) |

---

## Task 1: `deriveDatasourceNameFromUrl` utility

**Files:**
- Create: `apps/web/src/features/prometheus-datasources/derive-name.ts`
- Create: `apps/web/src/features/prometheus-datasources/derive-name.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/prometheus-datasources/derive-name.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deriveDatasourceNameFromUrl } from "./derive-name";

describe("deriveDatasourceNameFromUrl", () => {
  it("returns host:port for a typical Prometheus URL", () => {
    expect(deriveDatasourceNameFromUrl("http://prom.lab:9090/")).toBe("prom.lab:9090");
  });

  it("returns just the host when the default port is used", () => {
    expect(deriveDatasourceNameFromUrl("http://prom.example.com/")).toBe("prom.example.com");
  });

  it("returns empty string for an unparseable URL", () => {
    expect(deriveDatasourceNameFromUrl("not a url")).toBe("");
  });

  it("returns empty string for null", () => {
    expect(deriveDatasourceNameFromUrl(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(deriveDatasourceNameFromUrl(undefined)).toBe("");
  });

  it("returns empty string for empty string", () => {
    expect(deriveDatasourceNameFromUrl("")).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @modeldoctor/web exec vitest run src/features/prometheus-datasources/derive-name.test.ts`

Expected: FAIL — `Cannot find module './derive-name'`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/src/features/prometheus-datasources/derive-name.ts`:

```ts
// Derive a sensible default Datasource `name` from a Prometheus base URL.
// Used by the Discover→register CTA so the pre-filled DatasourceSheet
// already has a reasonable name the admin can accept or edit.
export function deriveDatasourceNameFromUrl(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @modeldoctor/web exec vitest run src/features/prometheus-datasources/derive-name.test.ts`

Expected: PASS — 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/prometheus-datasources/derive-name.ts \
        apps/web/src/features/prometheus-datasources/derive-name.test.ts
git commit -m "feat(web): deriveDatasourceNameFromUrl utility for Discover CTA pre-fill (refs #207)"
```

---

## Task 2: Widen `DatasourceSheetMode` to accept `initial` on create

**Files:**
- Modify: `apps/web/src/features/prometheus-datasources/DatasourceSheet.tsx`
- Modify: `apps/web/src/features/prometheus-datasources/DatasourceSheet.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/features/prometheus-datasources/DatasourceSheet.test.tsx`, find the existing `describe("DatasourceSheet", ...)` block and add two new tests AT THE END of the block (before the closing `});`):

```tsx
  it("create mode pre-fills baseUrl + name from `initial`", () => {
    render(
      <DatasourceSheet
        open
        onOpenChange={() => {}}
        mode={{
          kind: "create",
          initial: { baseUrl: "http://discover.example:9090/", name: "discover.example:9090" },
        }}
      />,
    );
    expect(screen.getByLabelText(/base url/i)).toHaveValue("http://discover.example:9090/");
    expect(screen.getByLabelText(/^name\b/i)).toHaveValue("discover.example:9090");
  });

  it("create mode without `initial` still starts with empty form (regression)", () => {
    render(<DatasourceSheet open onOpenChange={() => {}} mode={{ kind: "create" }} />);
    expect(screen.getByLabelText(/base url/i)).toHaveValue("");
    expect(screen.getByLabelText(/^name\b/i)).toHaveValue("");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -F @modeldoctor/web exec vitest run src/features/prometheus-datasources/DatasourceSheet.test.tsx`

Expected: The new "pre-fills" test FAILS (`initial` not a valid prop in current type, or value is `""` because defaults ignore it). The regression test may pass already — that's fine; we need its assertion locked in.

If TypeScript blocks the test from even compiling, that IS the failure — proceed to step 3.

- [ ] **Step 3: Widen the discriminated union**

Edit `apps/web/src/features/prometheus-datasources/DatasourceSheet.tsx`. Locate the type alias around line 43:

```ts
export type DatasourceSheetMode =
  | { kind: "create" }
  | { kind: "edit"; existing: PrometheusDatasourcePublic };
```

The `interface DatasourceInput { … }` declaration sits below this union (around line 55). Move it ABOVE the union AND `export` it so the widened union can reference it and external consumers (and tests) get the full shape:

```ts
/** Form input shape — mirrors the create schema with empty strings for absent values. */
export interface DatasourceInput {
  name: string;
  baseUrl: string;
  bearerToken: string;
  customHeaders: string;
  isDefault: boolean;
}

export type DatasourceSheetMode =
  | { kind: "create"; initial?: Partial<DatasourceInput> }
  | { kind: "edit"; existing: PrometheusDatasourcePublic };
```

- [ ] **Step 4: Thread `initial` into form defaults + reset effect**

Still in `DatasourceSheet.tsx`. The current state (around lines 94-113):

```tsx
const form = useForm<DatasourceInput>({
  resolver: zodResolver(
    isEdit ? updatePrometheusDatasourceSchema : createPrometheusDatasourceSchema,
  ) as never,
  mode: "onTouched",
  defaultValues: empty,
});

useEffect(() => {
  if (!open) return;
  if (existing) {
    form.reset(existingToFormValues(existing));
  } else {
    form.reset(empty);
  }
  setSubmitError(null);
  setRotateBearer(false);
}, [open, existing, form]);
```

Replace both blocks with:

```tsx
const form = useForm<DatasourceInput>({
  resolver: zodResolver(
    isEdit ? updatePrometheusDatasourceSchema : createPrometheusDatasourceSchema,
  ) as never,
  mode: "onTouched",
  defaultValues: existing
    ? existingToFormValues(existing)
    : { ...empty, ...(mode.kind === "create" ? (mode.initial ?? {}) : {}) },
});

// Reseed the form whenever the sheet opens (or `existing` swaps) so a
// reopen with a fresh `initial` doesn't stick on stale state. We read
// `mode.initial` inside the effect rather than via deps — `mode` is a
// fresh object identity per parent render and would cause the effect
// to fire on every render. The "open false → true" transition is the
// only moment we need a reseed in practice (pill click always toggles
// `open` through false-to-true).
useEffect(() => {
  if (!open) return;
  const next: DatasourceInput = existing
    ? existingToFormValues(existing)
    : { ...empty, ...(mode.kind === "create" ? (mode.initial ?? {}) : {}) };
  form.reset(next);
  setSubmitError(null);
  setRotateBearer(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `mode` identity is unstable; we read it inside the effect intentionally
}, [open, existing, form]);
```

(If your editor or biome flags the missing `mode` dep, the inline biome-ignore comment above suppresses it — paired with the explanatory comment above.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm -F @modeldoctor/web exec vitest run src/features/prometheus-datasources/DatasourceSheet.test.tsx`

Expected: All tests (existing + the two new ones) PASS.

If TypeScript complains about `Partial<DatasourceInput>` not being exported, export the `DatasourceInput` type or move it above the `DatasourceSheetMode` declaration. (Quick check: `interface DatasourceInput { … }` should sit above the union now.)

- [ ] **Step 6: Run apps/web lint as a regression guard**

Run: `pnpm -F @modeldoctor/web lint`

Expected: PASS — no new biome / native-select / i18n parity failures.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/prometheus-datasources/DatasourceSheet.tsx \
        apps/web/src/features/prometheus-datasources/DatasourceSheet.test.tsx
git commit -m "feat(web): DatasourceSheet create mode accepts \`initial\` pre-fill (refs #207)"
```

---

## Task 3: i18n keys for the pill

**Files:**
- Modify: `apps/web/src/locales/zh-CN/connections.json`
- Modify: `apps/web/src/locales/en-US/connections.json`

We add these now (not later) because the next task's tests reference the keys via `t()` — i18next falls back to the key string if the value is missing, which produces confusing test failures.

- [ ] **Step 1: Add Chinese keys**

In `apps/web/src/locales/zh-CN/connections.json`, locate the `"discover"` block (around line 101). Inside it, immediately before the closing `"confidence": { … }` block, add:

```json
      "registerCta": {
        "headline": "推断到 {{url}}",
        "body": "尚未注册为数据源",
        "action": "注册为数据源"
      },
```

Don't forget the trailing comma so the `confidence` block still parses.

- [ ] **Step 2: Add English keys**

In `apps/web/src/locales/en-US/connections.json`, find the equivalent `"discover"` block. Add the same key at the same position with English copy:

```json
      "registerCta": {
        "headline": "Detected {{url}}",
        "body": "Not registered as a datasource yet",
        "action": "Register as datasource"
      },
```

- [ ] **Step 3: Verify i18n parity check passes**

Run: `pnpm -F @modeldoctor/web exec node scripts/check-i18n-parity.mjs`

Expected: PASS (no missing keys between zh-CN and en-US). If it fails listing a missing key, double-check both files have the exact same key path.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/locales/zh-CN/connections.json \
        apps/web/src/locales/en-US/connections.json
git commit -m "i18n(web): add discover.registerCta strings (refs #207)"
```

---

## Task 4: ConnectionSheet — track `inferredPrometheusUrl` across Discover

**Files:**
- Modify: `apps/web/src/features/connections/ConnectionSheet.tsx`
- Modify: `apps/web/src/features/connections/ConnectionSheet.test.tsx`

This task adds the new state and wires Discover to populate it. The pill itself + register-sheet plumbing come in Task 5. We split because the state plumbing is testable on its own (test 1 from the spec covers "pill appears after Discover").

We add the pill render block IN THIS TASK so test 1 is a real RED→GREEN cycle (test referring to a not-yet-rendered DOM node).

- [ ] **Step 1: Add state + Discover wiring**

In `apps/web/src/features/connections/ConnectionSheet.tsx`, around line 172 where `discoverResult` is declared, add a sibling state hook:

```tsx
const [inferredPrometheusUrl, setInferredPrometheusUrl] = useState<string | null>(null);
```

Find the `runDiscover` function (around line 256). Inside the `try` block, RIGHT AFTER the `const res = await discoverMut.mutateAsync(...)` line, add:

```tsx
      setInferredPrometheusUrl(res.inferred.prometheusUrl.value ?? null);
```

Find `dismissDiscoverFeedback` (around line 297) and add the new state to its clear list:

```tsx
const dismissDiscoverFeedback = () => {
  setDiscoverError(null);
  setDiscoverResult(null);
  setInferredPrometheusUrl(null);
};
```

Find the `useEffect` that resets state on sheet close (search for `if (!open)` near line 308). Inside its `if (!open)` body, add:

```tsx
      setInferredPrometheusUrl(null);
```

- [ ] **Step 2: Compute pill visibility + derive name**

ABOVE the `return (` of the component (search for the JSX root), add:

```tsx
// Discover → register CTA — see issue #207. Show the pill only when all
// four conditions hold: an inferred URL exists, it's not already a
// registered datasource, the user hasn't picked any datasource yet, and
// the current user is an admin (backend requires admin for create).
const user = useAuthStore((s) => s.user);
const isAdmin = (user?.roles ?? []).includes("admin");
const watchedDsId = form.watch("prometheusDatasourceId");
const inferredAlreadyRegistered = inferredPrometheusUrl
  ? (datasources ?? []).some((d) => d.baseUrl === inferredPrometheusUrl)
  : false;
const showRegisterCta =
  showPrometheusDatasourceField &&
  inferredPrometheusUrl != null &&
  !inferredAlreadyRegistered &&
  watchedDsId == null &&
  isAdmin;
```

At the TOP of the file, near the other imports, add:

```tsx
import { useAuthStore } from "@/stores/auth-store";
import { Sparkles } from "lucide-react";
```

(`useState` and `useEffect` are already imported.)

- [ ] **Step 3: Write the failing test**

In `apps/web/src/features/connections/ConnectionSheet.test.tsx`, add an admin-store mock at the top alongside the other `vi.mock` calls (after the alerts/notifications mocks, before the `import { ConnectionSheet }` line):

```tsx
let mockUserRoles: string[] = ["admin"];
vi.mock("@/stores/auth-store", () => ({
  useAuthStore: <T,>(selector: (s: { user: { roles: string[] } }) => T) =>
    selector({ user: { roles: mockUserRoles } }),
}));
```

Then add a new `describe("Discover register CTA", () => { … })` block at the end of the file (before any final closing `});` of an outer describe — if the file has no outer describe wrapping all tests, just add it at module scope):

```tsx
describe("Discover register CTA", () => {
  beforeEach(() => {
    mockUserRoles = ["admin"];
    discoverMutate.mockReset();
  });

  it("shows the pill on the auto-apply path when inferred URL is unregistered", async () => {
    const user = userEvent.setup();
    discoverMutate.mockResolvedValue({
      inferred: {
        serverKind: { value: "vllm", confidence: "certain", evidence: "" },
        models: { values: ["m1"], confidence: "certain", evidence: "" },
        category: { value: null, confidence: "unknown", evidence: "" },
        suggestedTags: { values: [], confidence: "unknown", evidence: "" },
        prometheusUrl: {
          value: "http://discovered-prom:9090",
          confidence: "likely",
          evidence: "",
        },
      },
      health: { durationMs: 50, probesAttempted: 4, probesFailed: [], warnings: [] },
    });
    render(<ConnectionSheet open onOpenChange={() => {}} mode={{ kind: "create" }} />, { wrapper: Wrapper });
    await fillBaseFields(user);
    await user.click(screen.getByRole("button", { name: /自动发现|auto.?discover|🔍/i }));
    await waitFor(() => {
      expect(screen.getByText(/推断到/)).toBeInTheDocument();
      expect(screen.getByText(/http:\/\/discovered-prom:9090/)).toBeInTheDocument();
    });
  });
});
```

(The Discover button label is `🔍 自动发现` in zh-CN. The regex above matches either localization defensively.)

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm -F @modeldoctor/web exec vitest run src/features/connections/ConnectionSheet.test.tsx -t "register CTA"`

Expected: FAIL — `Unable to find element with text /推断到/`. We have the state, but no pill in the JSX yet.

- [ ] **Step 5: Add register-sheet state, imports, and wrap return in a Fragment**

In `ConnectionSheet.tsx`, near the other `useState` declarations in the component body, add:

```tsx
const [registerSheetOpen, setRegisterSheetOpen] = useState(false);
```

At the TOP of the file alongside the other feature imports, add:

```tsx
import { DatasourceSheet } from "@/features/prometheus-datasources/DatasourceSheet";
import { deriveDatasourceNameFromUrl } from "@/features/prometheus-datasources/derive-name";
```

The component's current return is a single `<Sheet>` root (around line 450 → 1059). To add a sibling `<DatasourceSheet>`, change:

```tsx
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      …
    </Sheet>
  );
```

to:

```tsx
  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        …
      </Sheet>
      <DatasourceSheet
        open={registerSheetOpen}
        onOpenChange={setRegisterSheetOpen}
        mode={{
          kind: "create",
          initial: {
            baseUrl: inferredPrometheusUrl ?? "",
            name: deriveDatasourceNameFromUrl(inferredPrometheusUrl),
          },
        }}
        onSaved={(ds) => {
          form.setValue("prometheusDatasourceId", ds.id, { shouldDirty: true });
          setInferredPrometheusUrl(null);
          setRegisterSheetOpen(false);
        }}
      />
    </>
  );
```

At this point the file compiles (the pill JSX comes next).

- [ ] **Step 6: Render the pill in JSX**

In `ConnectionSheet.tsx`, locate the `prometheusDatasourceId` `FormField` block (around lines 922–965). Find the closing `</FormItem>` that follows the help `<p>` and `<FormMessage />`. INSIDE that `FormItem`, AFTER `<FormMessage />`, insert the pill:

```tsx
                            {showRegisterCta ? (
                              <div className="mt-2 flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                                <Sparkles className="h-4 w-4 shrink-0 text-muted-foreground" />
                                <div className="min-w-0 flex-1">
                                  <p className="truncate">
                                    {t("dialog.discover.registerCta.headline", { url: inferredPrometheusUrl })}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {t("dialog.discover.registerCta.body")}
                                  </p>
                                </div>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setRegisterSheetOpen(true)}
                                >
                                  {t("dialog.discover.registerCta.action")} →
                                </Button>
                              </div>
                            ) : null}
```

`setRegisterSheetOpen` doesn't exist yet — we add it in the next step so the file still compiles.

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm -F @modeldoctor/web exec vitest run src/features/connections/ConnectionSheet.test.tsx -t "register CTA"`

Expected: PASS — the pill renders, text matches.

- [ ] **Step 8: Run the full ConnectionSheet test file to ensure no regression**

Run: `pnpm -F @modeldoctor/web exec vitest run src/features/connections/ConnectionSheet.test.tsx`

Expected: All existing tests + the new one pass.

If existing tests fail because `useAuthStore` isn't mocked in their setup, the mock added in Step 3 should cover them (it's module-scoped). If a specific test wants a non-admin user, future tests can set `mockUserRoles = []` in their own `beforeEach`.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/features/connections/ConnectionSheet.tsx \
        apps/web/src/features/connections/ConnectionSheet.test.tsx
git commit -m "feat(web): track inferred Prometheus URL + render register CTA pill (refs #207)"
```

---

## Task 5: ConnectionSheet — pill visibility edge cases + DatasourceSheet wiring tests

**Files:**
- Modify: `apps/web/src/features/connections/ConnectionSheet.test.tsx`

We've already shipped the JSX in Task 4. This task locks in the visibility rules and the post-save flow via mocking `DatasourceSheet`.

- [ ] **Step 1: Add DatasourceSheet mock that captures props**

In `apps/web/src/features/connections/ConnectionSheet.test.tsx`, at module scope alongside the other mocks, add:

```tsx
type CapturedDatasourceSheetProps = {
  open: boolean;
  mode: { kind: string; initial?: { baseUrl?: string; name?: string } };
  onSaved?: (ds: { id: string; [k: string]: unknown }) => void;
};
let lastDatasourceSheetProps: CapturedDatasourceSheetProps | null = null;
vi.mock("@/features/prometheus-datasources/DatasourceSheet", () => ({
  DatasourceSheet: (props: CapturedDatasourceSheetProps) => {
    lastDatasourceSheetProps = props;
    // Render nothing — we just want to observe props and let tests call onSaved.
    return null;
  },
}));
```

Reset in each test's `beforeEach` for the new describe block:

```tsx
beforeEach(() => {
  // ... existing resets ...
  lastDatasourceSheetProps = null;
});
```

- [ ] **Step 2: Write the four edge-case tests + the open/save tests**

Inside the `describe("Discover register CTA", …)` block from Task 4, add five tests AFTER the existing "shows the pill" test. Use the same Discover mock shape as the first test (extract a helper if it cleans up the noise):

```tsx
  function mockDiscoverWithProm(url: string | null) {
    discoverMutate.mockResolvedValue({
      inferred: {
        serverKind: { value: "vllm", confidence: "certain", evidence: "" },
        models: { values: ["m1"], confidence: "certain", evidence: "" },
        category: { value: null, confidence: "unknown", evidence: "" },
        suggestedTags: { values: [], confidence: "unknown", evidence: "" },
        prometheusUrl: { value: url, confidence: "likely", evidence: "" },
      },
      health: { durationMs: 50, probesAttempted: 4, probesFailed: [], warnings: [] },
    });
  }

  it("hides the pill when the inferred URL is already registered", async () => {
    const user = userEvent.setup();
    // Mocked datasources list (top of file) already contains baseUrl
    // "http://prom:9090" with id "ds-default". Use that exact URL so
    // dup-check fires.
    mockDiscoverWithProm("http://prom:9090");
    render(<ConnectionSheet open onOpenChange={() => {}} mode={{ kind: "create" }} />, { wrapper: Wrapper });
    await fillBaseFields(user);
    await user.click(screen.getByRole("button", { name: /自动发现|auto.?discover|🔍/i }));
    await waitFor(() => {
      // Discover has run (a result-side effect we can assert; here we
      // just wait a tick by querying any field the auto-apply touched).
      expect(discoverMutate).toHaveBeenCalled();
    });
    expect(screen.queryByText(/推断到/)).not.toBeInTheDocument();
  });

  it("hides the pill when a datasource is already bound", async () => {
    const user = userEvent.setup();
    mockDiscoverWithProm("http://discovered-prom:9090");
    const existing: ConnectionPublic = { ...EXISTING, prometheusDatasourceId: "ds-default" };
    render(<ConnectionSheet open onOpenChange={() => {}} mode={{ kind: "edit", existing }} />, { wrapper: Wrapper });
    await user.click(screen.getByRole("button", { name: /自动发现|auto.?discover|🔍/i }));
    await waitFor(() => expect(discoverMutate).toHaveBeenCalled());
    expect(screen.queryByText(/推断到/)).not.toBeInTheDocument();
  });

  it("hides the pill for non-admin users", async () => {
    const user = userEvent.setup();
    mockUserRoles = []; // viewer
    mockDiscoverWithProm("http://discovered-prom:9090");
    render(<ConnectionSheet open onOpenChange={() => {}} mode={{ kind: "create" }} />, { wrapper: Wrapper });
    await fillBaseFields(user);
    await user.click(screen.getByRole("button", { name: /自动发现|auto.?discover|🔍/i }));
    await waitFor(() => expect(discoverMutate).toHaveBeenCalled());
    expect(screen.queryByText(/推断到/)).not.toBeInTheDocument();
  });

  it("opens DatasourceSheet pre-populated with the inferred URL + derived name", async () => {
    const user = userEvent.setup();
    mockDiscoverWithProm("http://discovered-prom:9090");
    render(<ConnectionSheet open onOpenChange={() => {}} mode={{ kind: "create" }} />, { wrapper: Wrapper });
    await fillBaseFields(user);
    await user.click(screen.getByRole("button", { name: /自动发现|auto.?discover|🔍/i }));
    await waitFor(() => expect(screen.getByText(/推断到/)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /注册为数据源|register as datasource/i }));
    await waitFor(() => {
      expect(lastDatasourceSheetProps?.open).toBe(true);
      expect(lastDatasourceSheetProps?.mode.kind).toBe("create");
      expect(lastDatasourceSheetProps?.mode.initial?.baseUrl).toBe("http://discovered-prom:9090");
      expect(lastDatasourceSheetProps?.mode.initial?.name).toBe("discovered-prom:9090");
    });
  });

  it("onSaved binds the new datasource id and hides the pill", async () => {
    const user = userEvent.setup();
    mockDiscoverWithProm("http://discovered-prom:9090");
    render(<ConnectionSheet open onOpenChange={() => {}} mode={{ kind: "create" }} />, { wrapper: Wrapper });
    await fillBaseFields(user);
    await user.click(screen.getByRole("button", { name: /自动发现|auto.?discover|🔍/i }));
    await waitFor(() => expect(screen.getByText(/推断到/)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /注册为数据源|register as datasource/i }));
    await waitFor(() => expect(lastDatasourceSheetProps?.onSaved).toBeDefined());
    // Simulate the sheet's save callback firing with the new row.
    lastDatasourceSheetProps?.onSaved?.({
      id: "ds-new",
      name: "discovered-prom:9090",
      baseUrl: "http://discovered-prom:9090",
    });
    // Pill goes away because (a) form id is now set and (b) inferred state cleared.
    await waitFor(() => expect(screen.queryByText(/推断到/)).not.toBeInTheDocument());
  });
```

- [ ] **Step 3: Run the new tests**

Run: `pnpm -F @modeldoctor/web exec vitest run src/features/connections/ConnectionSheet.test.tsx -t "register CTA"`

Expected: All five new tests + the original "shows the pill" test PASS (6 total in the new describe).

If any test fails, the most common root cause is:
- Pill text matcher: confirm the i18n key resolved to `推断到 …`. Hard-code English copy if your environment defaults to en-US.
- Discover button selector: the existing button label is `🔍 自动发现`. The regex matches by `自动发现` substring.

- [ ] **Step 4: Run the full ConnectionSheet test file + apps/web tests**

Run: `pnpm -F @modeldoctor/web exec vitest run src/features/connections/ConnectionSheet.test.tsx`

Expected: All tests pass (existing + 6 new).

Then run: `pnpm -F @modeldoctor/web test`

Expected: All apps/web tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/connections/ConnectionSheet.test.tsx
git commit -m "test(web): lock in pill visibility + DatasourceSheet wiring (refs #207)"
```

---

## Task 6: Final verification + lint

- [ ] **Step 1: Type-check apps/web**

Run: `pnpm -F @modeldoctor/web type-check`

Expected: PASS — no TypeScript errors.

- [ ] **Step 2: Lint apps/web**

Run: `pnpm -F @modeldoctor/web lint`

Expected: PASS — biome + no-native-select + no-confirm + no-handcrafted-popover-list + i18n parity all clean.

- [ ] **Step 3: Root-level smoke**

Run: `pnpm lint`

Expected: PASS — all workspaces clean (apps/api lint includes our #209 e2e-env check, which should still report OK).

- [ ] **Step 4: Manual sanity (optional but recommended)**

If a dev server is convenient:

```bash
pnpm dev
```

Open the app, log in as admin, open ConnectionSheet for a new model connection, paste a URL whose host serves a Prometheus endpoint (or use a mock fixture), trigger Discover, confirm the pill appears under "Prometheus 数据源", click it, confirm the DatasourceSheet opens with the URL pre-filled, save, confirm the Connection's datasource Select shows the new row selected.

**Kill the dev server before continuing** (cmd-c) — leaving it running between agent sessions has historically wedged the machine.

- [ ] **Step 5: Push + open PR**

```bash
git push -u origin HEAD
gh pr create --base main \
  --title "feat(web): Discover → register-as-datasource CTA (closes #207)" \
  --body "$(cat <<'EOF'
## Summary

- Inline pill below the `prometheusDatasourceId` Select that fires when Discover infers a Prometheus URL that's not already a registered datasource (admin only). Click → `DatasourceSheet` opens pre-filled (URL + name = `new URL(url).host`) → on save, the new datasource id is auto-bound to the Connection form (with `shouldDirty: true` so the Save button lights up).
- `DatasourceSheet` `create` mode now accepts an optional `initial?: Partial<DatasourceInput>`; existing call sites (`DatasourcesPage`) unaffected.
- New tiny pure utility `deriveDatasourceNameFromUrl` (URL → host, empty string on parse fail).
- i18n: 3 new keys under `dialog.discover.registerCta.*` (zh-CN + en-US).

## Visibility rule

The pill renders only when **all four** of these hold:
1. Discover returned an `inferred.prometheusUrl.value`
2. No existing datasource matches that `baseUrl`
3. Connection form's `prometheusDatasourceId` is unset
4. Current user has `admin` role (backend rejects non-admin with 403)

## Why Direction 2 (inline pill) over Direction 1 (toast action)

Spec rationale: `docs/superpowers/specs/2026-05-20-discover-register-datasource-cta-design.md`. TL;DR — toast TTL is too short for the typical "scan the form for a few seconds" pattern; the pill persists until acted on and lives where the user is already looking.

## Test plan

- [x] `pnpm -F @modeldoctor/web exec vitest run src/features/prometheus-datasources/derive-name.test.ts` → 6/6 pass
- [x] `pnpm -F @modeldoctor/web exec vitest run src/features/prometheus-datasources/DatasourceSheet.test.tsx` → existing + 2 new (`initial` pre-fill, regression with no `initial`)
- [x] `pnpm -F @modeldoctor/web exec vitest run src/features/connections/ConnectionSheet.test.tsx` → existing + 6 new (pill render / dup-hide / bound-hide / non-admin-hide / open with initial / onSaved binds + clears)
- [x] `pnpm -F @modeldoctor/web type-check`
- [x] `pnpm -F @modeldoctor/web lint` (i18n parity included)
- [x] Root `pnpm lint`
- [ ] Manual: admin user, Discover a real Prometheus URL not in datasources, click pill, save → new row appears + Connection auto-bound

Closes #207.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: After CI green + merge — cleanup**

(Standard branch-cleanup flow per project memory: delete local + remote feature branch and worktree once #207 closes.)

---

## Spec ↔ Plan coverage check

- Spec §"Visibility rule" → Task 4 step 2 (the `showRegisterCta` computation).
- Spec §"Pill placement and visual" → Task 4 step 5 (the JSX block).
- Spec §"DatasourceSheet extension" → Task 2.
- Spec §"Name-derivation utility" → Task 1.
- Spec §"Post-save behavior" → Task 4 step 6 (onSaved handler).
- Spec §"i18n keys" → Task 3.
- Spec §"Tests" tests 1-6 → Task 4 step 3 (test 1) + Task 5 step 2 (tests 2-6).
- Spec §"Tests" tests 7-8 → Task 2 step 1.
- Spec §"Tests" tests 9-11 → Task 1 step 1.
