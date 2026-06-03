# Benchmark Compare Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the benchmark-compare surfaces from 4 routes / 3 views into a 2-page model — one compare workbench (raw data always + AI narrative inline) and one print/share report page — by deleting the redundant `SavedCompareDetailPage` middle layer and locking the AI narrative to light "paper".

**Architecture:** The saved-compare detail page becomes the destination (renamed `SavedComparePage`): it renders the AI narrative **inline** via the existing `<SavedCompareReport>` (in a new `embedded` mode) above the raw `<ReportSections>`. The ad-hoc compare page's primary CTA becomes "生成 AI 解读" = save + auto-synthesize (bridged by a `?generate=1` URL flag the saved page consumes). `/reports/:id` stays as the full-screen print mode. The narrative is locked to light by removing the single `.dark .primer-report` CSS override, so it renders as light paper whether inline on a dark compare page or full-screen.

**Tech Stack:** React 18 + react-router-dom v6, TanStack Query v5, react-i18next, Tailwind + shadcn/ui, Vitest 2 (component) + Playwright (browser e2e), Biome (lint). Worktree: `/Users/fangyong/vllm/modeldoctor/compare-consolidation` on branch `feat/compare-consolidation`.

**Pre-flight (run once before Task 1):** This is a fresh worktree — `packages/*/dist` is empty, so web typecheck and browser-e2e will fail until built.

```bash
cd /Users/fangyong/vllm/modeldoctor/compare-consolidation && pnpm install && pnpm -r build
```
Expected: all packages build; `packages/contracts/dist` now exists.

---

### Task 1: Add i18n keys for the new two-CTA + inline-report wording

**Files:**
- Modify: `apps/web/src/locales/zh-CN/benchmarks.json` (the `savedCompare` object)
- Modify: `apps/web/src/locales/en-US/benchmarks.json` (the `savedCompare` object)

No test (pure data); validated by lint + the component tests in later tasks that reference these keys.

- [ ] **Step 1: Add zh-CN keys**

In `apps/web/src/locales/zh-CN/benchmarks.json`, inside `savedCompare`:

Add a new `compare` block (sibling of `dialog`):
```json
"compare": {
  "generate": "生成 AI 解读",
  "saveOnly": "仅保存"
},
```
Add to the existing `savedCompare.dialog` block:
```json
"submitGenerate": "保存并生成",
```
Add to the existing `savedCompare.detail` block:
```json
"openReport": "打开报告",
```
Add to the existing `savedCompare.report` block:
```json
"openPrint": "打开打印视图",
"inlineHeading": "AI 解读"
```

- [ ] **Step 2: Add en-US keys (mirror)**

In `apps/web/src/locales/en-US/benchmarks.json`, inside `savedCompare`, add the parallel keys:
```json
"compare": { "generate": "Generate AI report", "saveOnly": "Save only" },
```
`dialog.submitGenerate`: `"Save & generate"`; `detail.openReport`: `"Open report"`; `report.openPrint`: `"Open print view"`; `report.inlineHeading`: `"AI analysis"`.

- [ ] **Step 3: Verify JSON parses**

Run: `cd apps/web && node -e "require('./src/locales/zh-CN/benchmarks.json');require('./src/locales/en-US/benchmarks.json');console.log('ok')"`
Expected: prints `ok` (no JSON syntax error).

- [ ] **Step 4: Commit**

```bash
cd /Users/fangyong/vllm/modeldoctor/compare-consolidation
git add apps/web/src/locales/zh-CN/benchmarks.json apps/web/src/locales/en-US/benchmarks.json
git commit -m "feat(compare): i18n keys for two-CTA compare + inline report

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Lock the AI narrative to light ("paper") + embedded layout CSS

**Files:**
- Modify: `apps/web/src/styles/primer-report.css:53-66` (delete the `.dark .primer-report` block); add `.pr-layout-embedded` rule.

The narrative must render light regardless of app theme. The ONLY thing flipping it dark today is the `.dark .primer-report` token override at lines 53–66. Removing it makes `.primer-report` permanently light. Also add a block-layout variant for embedded (no-TOC) rendering used in Task 3.

- [ ] **Step 1: Delete the dark override block**

Remove lines 53–66 exactly (the whole `.dark .primer-report { … }` rule plus the blank line after it):
```css
.dark .primer-report {
  --pr-bg-canvas: #0d1117;
  --pr-bg-subtle: #161b22;
  --pr-bg-muted: #21262d;
  --pr-fg-default: #e6edf3;
  --pr-fg-muted: #8d96a0;
  --pr-fg-subtle: #6e7681;
  --pr-border-default: #30363d;
  --pr-border-muted: #21262d;
  --pr-accent-subtle: #0e2a52;
  --pr-success-subtle: #033a16;
  --pr-danger-subtle: #5a0c0c;
  --pr-attention-subtle: #4e3d0e;
}
```

- [ ] **Step 2: Add embedded single-column layout rule**

Immediately after the `.primer-report .pr-layout { … }` rule (around line 90, the `max-width: 1760px` block), append:
```css
/* Embedded mode (inline on the compare page): drop the TOC column so the
 * canvas flows full-width. Overrides the grid set on .pr-layout. */
.primer-report .pr-layout-embedded {
  display: block;
}
```

- [ ] **Step 3: Verify no `.dark` rules remain in the file**

Run: `cd apps/web && grep -c "\.dark" src/styles/primer-report.css`
Expected: `0`

- [ ] **Step 4: Commit**

```bash
cd /Users/fangyong/vllm/modeldoctor/compare-consolidation
git add apps/web/src/styles/primer-report.css
git commit -m "feat(compare): lock AI narrative to light paper, add embedded layout

Remove the .dark .primer-report override so the report renders light
regardless of app theme (paper-on-canvas). Add .pr-layout-embedded for
inline rendering without the TOC column.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Add `embedded` prop to `SavedCompareReport`

**Files:**
- Modify: `apps/web/src/features/benchmarks/compare/SavedCompareReport.tsx`
- Test: `apps/web/src/features/benchmarks/compare/SavedCompareReport.test.tsx` (create)

In embedded mode the report renders inline on the compare page: no sticky left-rail TOC, no document scroll-spy, and no `data-report-root` (the page's `<ReportSections>` already owns that attribute for the HTML export).

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/benchmarks/compare/SavedCompareReport.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@/lib/i18n";
import type { CompareNarrative } from "@modeldoctor/contracts";
import { SavedCompareReport } from "./SavedCompareReport";

const narrative: CompareNarrative = {
  schemaVersion: 2,
  locale: "zh-CN",
  hero: { eyebrow: "EB", title: "Hero Title", subtitle: "Sub", metaItems: [] },
  summaryCards: [],
  sections: [
    { id: "summary", num: "01", title: "Summary", bodyMarkdown: "body one" },
    { id: "advice", num: "06", title: "Advice", bodyMarkdown: "body six" },
  ],
  figures: [],
  lintWarnings: [],
};

describe("SavedCompareReport", () => {
  it("renders the TOC nav in standalone mode", () => {
    const { container } = render(<SavedCompareReport narrative={narrative} runs={[]} />);
    expect(container.querySelector(".pr-toc")).not.toBeNull();
    expect(container.querySelector("[data-report-root]")).not.toBeNull();
  });

  it("drops the TOC nav and data-report-root in embedded mode", () => {
    const { container } = render(<SavedCompareReport narrative={narrative} runs={[]} embedded />);
    expect(container.querySelector(".pr-toc")).toBeNull();
    expect(container.querySelector(".pr-layout-embedded")).not.toBeNull();
    expect(container.querySelector("[data-report-root]")).toBeNull();
    // Section content still renders.
    expect(screen.getByRole("heading", { name: "Hero Title" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd apps/web && pnpm exec vitest run src/features/benchmarks/compare/SavedCompareReport.test.tsx`
Expected: FAIL — `embedded` prop not yet supported (TOC still present / `data-report-root` still present).

- [ ] **Step 3: Implement the `embedded` prop**

In `SavedCompareReport.tsx`:

Update the props interface (after line 13):
```tsx
export interface SavedCompareReportProps {
  narrative: CompareNarrative;
  runs: ReportRun[];
  /** Optional print-time header text (one-line, gray). */
  printHeader?: string;
  /** Inline on the compare page: no TOC, no scroll-spy, no data-report-root. */
  embedded?: boolean;
}
```

Update the signature (line 28):
```tsx
export function SavedCompareReport({ narrative, runs, printHeader, embedded = false }: SavedCompareReportProps) {
```

Guard the scroll-spy effect (top of the `useEffect` body, line 44):
```tsx
  useEffect(() => {
    if (embedded) return;
    function onScroll() {
```
and add `embedded` to its dependency array (line 59): `}, [sections, embedded]);`

Update the outer wrapper (line 68) to conditionally drop `data-report-root`:
```tsx
    <div
      className="primer-report"
      {...(embedded ? {} : { "data-report-root": true })}
      data-print-header={printHeader ?? ""}
    >
      <div className={embedded ? "pr-layout pr-layout-embedded" : "pr-layout"}>
        {embedded ? null : (
          <nav
            className="pr-toc"
            aria-label={t("savedCompare.report.toc", { defaultValue: "Contents" })}
          >
```
Close the conditional after the existing `</nav>` (line 89): change `</nav>` to `</nav>\n        )}`.

(The `<main className="pr-canvas">…</main>` block and everything inside it is unchanged.)

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd apps/web && pnpm exec vitest run src/features/benchmarks/compare/SavedCompareReport.test.tsx`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/fangyong/vllm/modeldoctor/compare-consolidation
git add apps/web/src/features/benchmarks/compare/SavedCompareReport.tsx apps/web/src/features/benchmarks/compare/SavedCompareReport.test.tsx
git commit -m "feat(compare): embedded mode for SavedCompareReport (no TOC/scroll-spy)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Rename detail page → `SavedComparePage`, render narrative inline, auto-generate on `?generate=1`

**Files:**
- Create: `apps/web/src/features/benchmarks/compare/SavedComparePage.tsx` (from `SavedCompareDetailPage.tsx`)
- Delete: `apps/web/src/features/benchmarks/compare/SavedCompareDetailPage.tsx`
- Create: `apps/web/src/features/benchmarks/compare/SavedComparePage.test.tsx` (from the old `.test.tsx`)
- Delete: `apps/web/src/features/benchmarks/compare/SavedCompareDetailPage.test.tsx`
- Modify: `apps/web/src/router/index.tsx:18,90` (import + element)

The page now (a) renders `<SavedCompareReport embedded>` above `<ReportSections>` when a narrative exists, (b) relabels the strip's "open report" link via `detail.openReport` / `report.openPrint`, and (c) auto-runs generate once when the URL carries `?generate=1` (the ad-hoc → generate bridge) and no narrative exists.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/features/benchmarks/compare/SavedComparePage.test.tsx` by copying the existing `SavedCompareDetailPage.test.tsx` content, then changing the import + describe + the rendered element to `SavedComparePage`, and adding a narrative-inline test. Full file:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import "@/lib/i18n";
import { SavedComparePage } from "./SavedComparePage";

function makeApi(narrative: unknown) {
  return {
    get: vi.fn(async (path: string) => {
      if (path.startsWith("/api/saved-compares/")) {
        return {
          id: "sc1",
          userId: "u",
          name: "Study A",
          benchmarkIds: ["b1", "b2"],
          stageLabels: { b1: "A", b2: "B" },
          baselineId: "b1",
          context: "8x NPU",
          narrative,
          narrativeAt: narrative ? "2026-05-12T00:00:00.000Z" : null,
          createdAt: "2026-05-12T00:00:00.000Z",
          updatedAt: "2026-05-12T00:00:00.000Z",
          benchmarks: [
            {
              id: "b1",
              stageLabel: "A",
              missing: false,
              name: "r1",
              tool: "guidellm",
              scenario: "inference",
              params: {},
              summaryMetrics: { tool: "guidellm", data: { ttft: { p50: 100, p90: 200, p99: 500 } } },
              createdAt: "2026-05-12T00:00:00.000Z",
            },
            {
              id: "b2",
              stageLabel: "B",
              missing: false,
              name: "r2",
              tool: "guidellm",
              scenario: "inference",
              params: {},
              summaryMetrics: { tool: "guidellm", data: { ttft: { p50: 80, p90: 160, p99: 400 } } },
              createdAt: "2026-05-12T00:00:00.000Z",
            },
          ],
        };
      }
      if (path === "/api/llm-judge-providers/active") return { id: "p", enabled: true };
      throw new Error(`unmocked: ${path}`);
    }),
    post: vi.fn(),
    patch: vi.fn(),
    del: vi.fn(),
  };
}

const apiMock = makeApi(null);
vi.mock("@/lib/api-client", () => ({ api: apiMock }));

function renderAt(entry: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <QueryClientProvider client={qc}>
        <Routes>
          <Route path="/benchmarks/compare/saved/:id" element={<SavedComparePage />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("SavedComparePage", () => {
  it("renders the raw data once loaded", async () => {
    renderAt("/benchmarks/compare/saved/sc1");
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1, name: "Study A" })).toBeInTheDocument(),
    );
    expect(screen.getByText(/8x NPU/)).toBeInTheDocument();
  });

  it("renders the AI narrative inline when present", async () => {
    apiMock.get.mockImplementationOnce(makeApi({
      schemaVersion: 2,
      locale: "zh-CN",
      hero: { eyebrow: "EB", title: "Inline Hero", subtitle: "S", metaItems: [] },
      summaryCards: [],
      sections: [{ id: "summary", num: "01", title: "Summary", bodyMarkdown: "x" }],
      figures: [],
      lintWarnings: [],
    }).get);
    renderAt("/benchmarks/compare/saved/sc1");
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Inline Hero" })).toBeInTheDocument(),
    );
  });
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `cd apps/web && pnpm exec vitest run src/features/benchmarks/compare/SavedComparePage.test.tsx`
Expected: FAIL — module `./SavedComparePage` does not exist.

- [ ] **Step 3: Create `SavedComparePage.tsx`**

Create `apps/web/src/features/benchmarks/compare/SavedComparePage.tsx` from the current `SavedCompareDetailPage.tsx`, with these changes:

1. Rename the function: `export function SavedComparePage() {`
2. Add imports: `useEffect, useRef` from react (alongside `useState`); `useSearchParams` from react-router-dom; `SavedCompareReport` from `./SavedCompareReport`.
3. Read the generate flag and add a one-shot auto-generate. After the existing `const [narrativeOverride, setNarrativeOverride] = useState<…>(null);` line and BEFORE the `if (query.isLoading)` early return, add:
```tsx
  const [searchParams, setSearchParams] = useSearchParams();
  const autoGenFired = useRef(false);
```
4. Move the `generate` function definition above the effect (it currently sits after the early returns — hoist the `async function generate()` so the effect can call it; keep its body identical). Then add the effect (must run before early returns, so place it right after `autoGenFired`):
```tsx
  // Ad-hoc → generate bridge: the compare page navigates here with ?generate=1
  // after a save-and-generate. Fire synthesize once, then strip the flag.
  useEffect(() => {
    if (autoGenFired.current) return;
    if (searchParams.get("generate") !== "1") return;
    const sc = query.data;
    if (!sc || sc.narrative) {
      // Nothing to generate (still loading or already has a narrative): clear flag.
      if (sc?.narrative) {
        autoGenFired.current = true;
        setSearchParams({}, { replace: true });
      }
      return;
    }
    if (!provider.data?.enabled || synth.isPending) return;
    autoGenFired.current = true;
    setSearchParams({}, { replace: true });
    void generate();
  }, [searchParams, query.data, provider.data?.enabled, synth.isPending, setSearchParams]);
```
   Note: `generate`, `provider`, `synth` are already defined in the component; ensure `generate` is hoisted above this effect. Because hooks must precede the early `return null`, keep all of `useState/useSearchParams/useRef/useEffect` above the `if (query.isLoading)` block. The `generate` function references `synth` and `setNarrativeOverride`, both defined above — keep it as a function declaration (hoisted) so order is not an issue.
5. Update breadcrumbs middle crumb label to the list (unchanged target): keep `{ label: t("compare.title"), to: "/benchmarks/compare/saved" }`.
6. Relabel the strip's "open report" buttons to point at the print view and add proper i18n. Both `<Link to={`/reports/${sc.id}`}>` buttons currently use `t("savedCompare.detail.openReport", { defaultValue: "Open report" })`; change their label to `t("savedCompare.report.openPrint")` (keeps the same `/reports/:id` target — now explicitly "print view").
7. Render the inline narrative ABOVE `<ReportSections>`. Replace the final body block:
```tsx
      <div className="space-y-6 px-8 py-6">
        {/* Report status / generate strip */}
        { /* …existing strip unchanged… */ }

        {narrative ? (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">{t("savedCompare.report.inlineHeading")}</h2>
            <div className="overflow-hidden rounded-md border border-border">
              <SavedCompareReport narrative={narrative} runs={reportRuns} embedded />
            </div>
          </section>
        ) : null}

        <ReportSections
          runs={reportRuns}
          baselineId={sc.baselineId}
          narrative={null}
          context={sc.context}
          environmentLines={environmentLines}
        />
      </div>
```
   (`narrative` and `reportRuns` are already computed above. `narrative` is `narrativeOverride ?? sc.narrative` — so a freshly generated report renders inline immediately.)

- [ ] **Step 4: Delete the old page + its test**

```bash
cd /Users/fangyong/vllm/modeldoctor/compare-consolidation
git rm apps/web/src/features/benchmarks/compare/SavedCompareDetailPage.tsx apps/web/src/features/benchmarks/compare/SavedCompareDetailPage.test.tsx
```

- [ ] **Step 5: Update the router**

In `apps/web/src/router/index.tsx`:
- Line 18: change import to `import { SavedComparePage } from "@/features/benchmarks/compare/SavedComparePage";`
- Line 90: change element to `{ path: "benchmarks/compare/saved/:id", element: <SavedComparePage /> },`

- [ ] **Step 6: Run the tests, verify they pass**

Run: `cd apps/web && pnpm exec vitest run src/features/benchmarks/compare/SavedComparePage.test.tsx`
Expected: PASS (both tests).

- [ ] **Step 7: Commit**

```bash
cd /Users/fangyong/vllm/modeldoctor/compare-consolidation
git add apps/web/src/features/benchmarks/compare/SavedComparePage.tsx apps/web/src/features/benchmarks/compare/SavedComparePage.test.tsx apps/web/src/router/index.tsx
git commit -m "feat(compare): inline AI narrative on saved compare page + auto-generate

Rename SavedCompareDetailPage -> SavedComparePage. Render the narrative
inline (embedded, light paper) above the raw matrix instead of forcing a
jump to /reports/:id, which is now just the print view. Auto-run
synthesize once when arriving with ?generate=1.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Ad-hoc compare page — two CTAs ("生成 AI 解读" + "仅保存") + dialog bridge

**Files:**
- Modify: `apps/web/src/features/benchmarks/compare/SaveCompareDialog.tsx` (add `generateAfterSave` prop, branch navigate + submit label)
- Modify: `apps/web/src/features/benchmarks/compare/BenchmarkComparePage.tsx` (two buttons + state)
- Test: `apps/web/src/features/benchmarks/compare/SaveCompareDialog.test.tsx` (create)

- [ ] **Step 1: Write the failing test for the dialog navigation target**

Create `apps/web/src/features/benchmarks/compare/SaveCompareDialog.test.tsx`:
```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import "@/lib/i18n";
import { SaveCompareDialog } from "./SaveCompareDialog";

vi.mock("@/lib/api-client", () => ({
  api: { post: vi.fn(async () => ({ id: "scNEW" })), get: vi.fn(), patch: vi.fn(), del: vi.fn() },
}));

function Loc() {
  const l = useLocation();
  return <div data-testid="loc">{l.pathname + l.search}</div>;
}

function renderDialog(generateAfterSave: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={["/benchmarks/compare?ids=b1,b2"]}>
      <QueryClientProvider client={qc}>
        <Routes>
          <Route
            path="/benchmarks/compare"
            element={
              <SaveCompareDialog
                open
                onOpenChange={() => {}}
                runs={[{ id: "b1", name: "r1", tool: "guidellm" }, { id: "b2", name: "r2", tool: "guidellm" }]}
                baselineId="b1"
                context=""
                generateAfterSave={generateAfterSave}
              />
            }
          />
          <Route path="/benchmarks/compare/saved/:id" element={<Loc />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

async function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText("名称", { selector: "#sc-name" }), { target: { value: "X" } });
  fireEvent.change(screen.getByLabelText("r1"), { target: { value: "A" } });
  fireEvent.change(screen.getByLabelText("r2"), { target: { value: "B" } });
  fireEvent.click(screen.getByRole("button", { name: /保存/ }));
}

describe("SaveCompareDialog navigation", () => {
  it("navigates to the saved page without generate flag when generateAfterSave is false", async () => {
    renderDialog(false);
    await fillAndSubmit();
    await waitFor(() =>
      expect(screen.getByTestId("loc")).toHaveTextContent("/benchmarks/compare/saved/scNEW"),
    );
    expect(screen.getByTestId("loc")).not.toHaveTextContent("generate=1");
  });

  it("appends ?generate=1 when generateAfterSave is true", async () => {
    renderDialog(true);
    await fillAndSubmit();
    await waitFor(() =>
      expect(screen.getByTestId("loc")).toHaveTextContent("/benchmarks/compare/saved/scNEW?generate=1"),
    );
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd apps/web && pnpm exec vitest run src/features/benchmarks/compare/SaveCompareDialog.test.tsx`
Expected: FAIL — `generateAfterSave` prop unknown / no `?generate=1` appended.

- [ ] **Step 3: Add `generateAfterSave` to the dialog**

In `SaveCompareDialog.tsx`:

Extend the props interface (after `context: string;`, line 36):
```tsx
  /** When true, navigate to the saved page with ?generate=1 so it auto-synthesizes. */
  generateAfterSave?: boolean;
```
Add to the destructured params (line 45): add `generateAfterSave = false,`.

Update the navigate call (line 70):
```tsx
    onOpenChange(false);
    const suffix = generateAfterSave ? "?generate=1" : "";
    navigate(`/benchmarks/compare/saved/${sc.id}${suffix}`);
```

Update the submit button label (line 170-172) to reflect the mode:
```tsx
          <Button onClick={submit} disabled={!canSubmit}>
            {generateAfterSave
              ? t("savedCompare.dialog.submitGenerate")
              : t("savedCompare.dialog.submit")}
          </Button>
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd apps/web && pnpm exec vitest run src/features/benchmarks/compare/SaveCompareDialog.test.tsx`
Expected: PASS (both tests).

- [ ] **Step 5: Wire the two CTAs into the ad-hoc compare page**

In `BenchmarkComparePage.tsx`:

Add a state alongside `saveOpen` (line 51):
```tsx
  const [saveOpen, setSaveOpen] = useState(false);
  const [generateAfterSave, setGenerateAfterSave] = useState(false);
```

Replace the action row (lines 216-221) — the `<Button variant="outline" asChild>…历史对比…</Button>` + the single Save button — with:
```tsx
            <div className="flex items-center justify-between">
              <Button variant="outline" asChild>
                <Link to="/benchmarks/compare/saved">{t("savedCompare.savedListLink")}</Link>
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setGenerateAfterSave(false);
                    setSaveOpen(true);
                  }}
                >
                  {t("savedCompare.compare.saveOnly")}
                </Button>
                <Button
                  onClick={() => {
                    setGenerateAfterSave(true);
                    setSaveOpen(true);
                  }}
                >
                  {t("savedCompare.compare.generate")}
                </Button>
              </div>
            </div>
```

Pass the flag to the dialog (the existing `<SaveCompareDialog … />` at line 229-235): add `generateAfterSave={generateAfterSave}` to its props.

- [ ] **Step 6: Run the compare-folder component tests**

Run: `cd apps/web && pnpm exec vitest run src/features/benchmarks/compare`
Expected: PASS — all tests in the compare folder (SavedCompareReport, SavedComparePage, SaveCompareDialog).

- [ ] **Step 7: Commit**

```bash
cd /Users/fangyong/vllm/modeldoctor/compare-consolidation
git add apps/web/src/features/benchmarks/compare/SaveCompareDialog.tsx apps/web/src/features/benchmarks/compare/SaveCompareDialog.test.tsx apps/web/src/features/benchmarks/compare/BenchmarkComparePage.tsx
git commit -m "feat(compare): ad-hoc compare page two-CTA (generate vs save-only)

Primary CTA saves and auto-generates the AI report (bridged via
?generate=1); secondary CTA saves only. Fulfills select-runs -> report
in one step while landing on the data-backed saved page.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Cleanup, full verification, and e2e

**Files:**
- Modify: `apps/web/src/features/benchmarks/compare/ReportSections.tsx:24-33` (doc comment: it's no longer rendered by a separate detail page)
- Verify only: `apps/web/src/features/benchmarks/compare/ReportPage.tsx` (its `/benchmarks/compare/saved/:id` links now resolve to `SavedComparePage` — no code change needed)
- Verify only: `e2e/saved-compares.spec.ts` (only touches the list route + auth gate, both unchanged)

- [ ] **Step 1: Update the stale ReportSections doc comment**

In `ReportSections.tsx`, the block comment (lines 24-33) says it's "Used by … SavedCompareDetailPage when the saved compare has no narrative yet." Replace that bullet with:
```tsx
 *   - BenchmarkComparePage (ad-hoc compare, no narrative)
 *   - SavedComparePage (raw matrix below the inline AI narrative)
```

- [ ] **Step 2: Confirm no dangling references to the old page**

Run: `cd /Users/fangyong/vllm/modeldoctor/compare-consolidation && grep -rn "SavedCompareDetailPage" apps/web/src; echo "exit:$?"`
Expected: no matches (grep exit 1 → prints `exit:1`).

- [ ] **Step 3: Typecheck the web package**

Run: `cd /Users/fangyong/vllm/modeldoctor/compare-consolidation && pnpm -F @modeldoctor/web type-check`
Expected: no type errors. (If the script name differs, use `pnpm -F @modeldoctor/web exec tsc --noEmit`.)

- [ ] **Step 4: Lint (Biome)**

Run: `cd /Users/fangyong/vllm/modeldoctor/compare-consolidation && pnpm -F @modeldoctor/web lint`
Expected: clean. Fix any import-order / formatting findings Biome reports, then re-run.

- [ ] **Step 5: Full web unit/component test run**

Run: `cd /Users/fangyong/vllm/modeldoctor/compare-consolidation/apps/web && pnpm exec vitest run`
Expected: PASS — whole web suite green (no test still imports the deleted page).

- [ ] **Step 6: Browser e2e for saved compares**

Run: `cd /Users/fangyong/vllm/modeldoctor/compare-consolidation && pnpm test:e2e:browser -- saved-compares`
Expected: both tests pass (list empty-state renders, anonymous redirects to /login). The routes they touch (`/benchmarks/compare/saved`) are unchanged.

- [ ] **Step 7: Manual visual check (dark-mode paper)**

Run the app, switch the app to dark theme, open a saved compare that has a generated narrative.
Expected: page chrome + raw tables/charts are dark; the inline AI narrative renders as a light "paper" card (not dark). Open `/reports/:id` → still light.
(If no narrative exists locally, generate one from the ad-hoc "生成 AI 解读" CTA first.)

- [ ] **Step 8: Commit**

```bash
cd /Users/fangyong/vllm/modeldoctor/compare-consolidation
git add apps/web/src/features/benchmarks/compare/ReportSections.tsx
git commit -m "docs(compare): refresh ReportSections usage comment after consolidation

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- 2 content pages + list index → Tasks 4 (saved page inline), 5 (ad-hoc page), ReportPage untouched, list page untouched. ✅
- Delete `SavedCompareDetailPage` middle layer → Task 4 Step 4. ✅
- AI narrative inline on the compare page → Task 4 Step 3 (renders `<SavedCompareReport embedded>`). ✅
- "select runs → directly AI report" bridge → Tasks 5 (two-CTA + dialog flag) + 4 (auto-generate on `?generate=1`). ✅
- Narrative locked to light paper-on-canvas → Task 2 (delete `.dark .primer-report`) + Task 3 (embedded). ✅
- No backend/schema/contract changes, no data migration → confirmed; no task touches `apps/api` or Prisma. ✅
- e2e link updated → Task 6 confirms the only e2e routes are unchanged. ✅

**Placeholder scan:** No TBD/TODO; every code step shows concrete code. ✅

**Type consistency:** `embedded?: boolean` (Task 3) consumed in Task 4; `generateAfterSave?: boolean` (Task 5 dialog) set by Task 5 page; `?generate=1` written by Task 5 dialog, read by Task 4 page; i18n keys added in Task 1 are all referenced (`compare.generate`, `compare.saveOnly`, `dialog.submitGenerate`, `report.openPrint`, `report.inlineHeading`, `detail.openReport`). ✅

**Risks called out for the implementer:**
- The `generate` function in `SavedComparePage` must be hoisted (function declaration) above the auto-generate `useEffect`, and all hooks must stay above the `if (query.isLoading)` early return — React's rules-of-hooks.
- If `pnpm -F @modeldoctor/web type-check` script name differs, fall back to `tsc --noEmit` (noted inline).
- Biome may reorder the new imports in `SavedComparePage.tsx` / `BenchmarkComparePage.tsx`; run lint and accept its fixes.
