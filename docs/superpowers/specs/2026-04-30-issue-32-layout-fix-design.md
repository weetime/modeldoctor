# Issue #32 — Page-layout unification & layout-related fixes

**Issue:** [weetime/modeldoctor#32](https://github.com/weetime/modeldoctor/issues/32) — 页面布局异常
**Branch:** `fix/issue-30-smoke-fixes` (long-lived `feat/regression-suite` lineage)
**Date:** 2026-04-30
**Status:** Design approved (awaiting implementation plan)

## Problem statement

Issue #32 reports four layout problems:

1. **查看代码 Dialog 内容溢出** — clicking "查看代码" on a Playground page opens `ViewCodeDialog`; long single-line content (e.g. a long assistant message inside a curl body) pushes the dialog wider than its `max-w-3xl` constraint, so the dialog left-edge sticks to the viewport left and the right-edge is clipped off-screen.
2. **Chat 顶部 tabs 与 Image 顶部 tabs 风格不一致** — `ChatPage` / `ChatComparePage` render a separate `<ChatModeTabs />` row (NavLink-driven) above `PageHeader`, while `ImagePage` puts its `generate` / `edit` tabs in `PlaygroundShell`'s `tabs` slot. Same purpose, different rows, different visual treatment.
3. **Chat 内嵌图片观感被拉伸** — `MessageList.tsx` renders `<img>` inside a `flex flex-col` container. Tailwind preflight sets `img { display: block }`, the flex parent's default `align-items: stretch` widens the box, and `max-w-full` lets it fill the row, so wide source images appear visually stretched at the rendered size.
4. **Playground 页面布局与其他页面不统一** — every Playground page renders an extra `PlaygroundShell` toolbar strip *above* `PageHeader`, so the visual order is `Shell-toolbar → PageHeader → content`. Pages outside Playground (e.g. `LoadTestPage`) render just `PageHeader → content`. Issue calls for unifying everything to the LoadTest pattern (single primary header: title + subtitle on the left, theme toggle in the upper-right) and codifying the convention in `CLAUDE.md`.

## Goals

- One single primary header convention: `PageHeader` (title + subtitle + theme toggle) is always the first visual row of every top-level routed page.
- Playground-specific affordances (mode tabs / history / view-code / right-panel toggle / page-specific buttons) live in a *secondary* sub-toolbar below `PageHeader`, rendered only when non-empty.
- Mode tabs across Playground (chat single/compare, image generate/edit, audio TTS/STT) all use the *same* tab mechanism — no more bespoke tab rows.
- Fix the three concrete bugs (#1, #2, #3) in the same change so the layout pass is one coherent PR rather than scattered patches.
- Document the convention in `CLAUDE.md` so future page additions stay consistent without further nudging.

## Non-goals

- No changes to non-Playground pages (`LoadTestPage`, `ConnectionsPage`, `SettingsPage`, `BenchmarkListPage`, `BenchmarkDetailPage`, `RequestDebugPage`, `E2ESmokePage`, `AudioPage` body, etc.) — they already match the convention or fall outside its scope.
- No design changes to `ParamsPanel` (right-side params drawer), `HistoryDrawer`, or any individual params form.
- No new chart / data visualisation work; no copy/i18n redesign beyond what falls out of moving title/subtitle into a Shell prop.
- No backend / contracts changes.

## Design

### `PlaygroundShell` API change

`apps/web/src/features/playground/PlaygroundShell.tsx` becomes the canonical Playground layout host. It renders `PageHeader` internally and exposes a sub-toolbar below it.

```tsx
export interface PlaygroundShellProps {
  // NEW — required: shell renders PageHeader internally
  title: string;
  subtitle?: string;

  // existing
  category: ModalityCategory;
  paramsSlot: ReactNode;
  children: ReactNode;
  rightPanelDefaultOpen?: boolean;

  // sub-toolbar (rendered only when at least one of these is non-empty)
  tabs?: Array<{ key: string; label: string }>;
  activeTab?: string;
  onTabChange?: (k: string) => void;
  viewCodeSnippets?: CodeSnippets | null;
  historySlot?: ReactNode;
  // additional buttons living next to history/viewCode (e.g. PanelCountSwitcher)
  toolbarRightSlot?: ReactNode;
}
```

Visual structure (top-to-bottom):

```
┌──────────────────────────────────────────────────────────────────────────┐
│ <PageHeader title subtitle />            [ThemeToggle from PageHeader]   │ ← row 1, ALWAYS rendered
├──────────────────────────────────────────────────────────────────────────┤
│ [tabs]              [historySlot] [查看代码] [toolbarRightSlot] [折叠右栏]  │ ← row 2, only when any slot is non-empty
├──────────────────────────────────────────────┬───────────────────────────┤
│ children                                     │ ParamsPanel (right drawer)│
└──────────────────────────────────────────────┴───────────────────────────┘
```

Sub-toolbar render rule:

```tsx
// Panel-collapse is only meaningful when there is a params panel to collapse.
const showCollapseButton = paramsSlot != null;
const showToolbar =
  showCollapseButton ||
  Boolean(tabs?.length) ||
  Boolean(historySlot) ||
  Boolean(viewCodeSnippets) ||
  Boolean(toolbarRightSlot);
```

In other words: any Playground page with a right params panel always shows the sub-toolbar (because the collapse button must be reachable). A page with `paramsSlot={null}` (e.g. `ChatComparePage`) only shows the toolbar when there is a tab/history/view-code/custom-button to put in it. `ChatComparePage` does have tabs and history, so it will show; an imaginary Shell-using page with no panel and no slots would render zero toolbar rows.

### Per-page changes

Every Playground page deletes its own `<PageHeader title subtitle />` call and passes `title` / `subtitle` to the Shell.

| File | Change |
|---|---|
| `apps/web/src/features/playground/chat/ChatPage.tsx` | Remove `<PageHeader />` and `<ChatModeTabs />` from children. Pass `title={t("chat.title")}`, `subtitle={t("chat.subtitle")}` to `PlaygroundShell`. Pass `tabs/activeTab/onTabChange` from `useChatModeTabs()`. |
| `apps/web/src/features/playground/chat-compare/ChatComparePage.tsx` | Same as above (uses the same `useChatModeTabs()` hook). `historySlot` keeps `<CompareHistoryControls />` only; move `<PanelCountSwitcher />` out of `historySlot` and into the new `toolbarRightSlot`. |
| `apps/web/src/features/playground/image/ImagePage.tsx` | Remove `<PageHeader />`. Pass `title`/`subtitle` to Shell. `tabs` prop already in use (no change). |
| `apps/web/src/features/playground/embeddings/EmbeddingsPage.tsx` | Remove `<PageHeader />`. Pass `title`/`subtitle` to Shell. No `tabs`. |
| `apps/web/src/features/playground/rerank/RerankPage.tsx` | Same as embeddings. |
| `apps/web/src/features/playground/audio/AudioPage.tsx` | Remove `<PageHeader />`. Pass `title`/`subtitle` to Shell. `tabs` prop already in use (no change). |

### `ChatModeTabs` becomes a hook

`apps/web/src/features/playground/chat-compare/ChatModeTabs.tsx` — old component is deleted; replace with a hook returning Shell-compatible tab config.

```tsx
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

export function useChatModeTabs() {
  const { t } = useTranslation("playground");
  const nav = useNavigate();
  const { pathname } = useLocation();
  const active = pathname.endsWith("/compare") ? "compare" : "single";
  return {
    tabs: [
      { key: "single",  label: t("chat.compare.modeTabs.single") },
      { key: "compare", label: t("chat.compare.modeTabs.compare") },
    ] satisfies Array<{ key: string; label: string }>,
    active,
    onChange: (k: string) =>
      nav(k === "compare" ? "/playground/chat/compare" : "/playground/chat"),
  };
}
```

### Issue #1 — `ViewCodeDialog` overflow fix

`apps/web/src/features/playground/ViewCodeDialog.tsx`:

- Add `min-w-0` to `<Tabs>` and to each `<TabsContent>` so they participate properly inside `DialogContent`'s grid layout.
- Extract a local `<CodeBlock>` to remove duplication and apply: `max-w-full overflow-auto whitespace-pre-wrap break-all` so long single-line content wraps softly inside the pre, never widening the dialog.

```tsx
function CodeBlock({ text }: { text: string }) {
  return (
    <pre className="max-h-[60vh] max-w-full overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs">
      {text}
    </pre>
  );
}
```

`overflow-auto` is kept as a safety net for pathological cases (e.g. a 50KB single token); `whitespace-pre-wrap break-all` handles the common case (long natural-language assistant content embedded in curl JSON).

### Issue #3 — Chat inline image fix

`apps/web/src/features/playground/chat/MessageList.tsx` — change the `<img>` className inside `renderPart`:

```tsx
<img
  src={p.image_url.url}
  alt=""
  className="max-h-64 w-auto max-w-full self-start rounded border border-border object-contain"
/>
```

Three new utility classes:
- `w-auto` — width follows intrinsic image size (not the parent's full width).
- `self-start` — overrides the flex parent's default `align-items: stretch`.
- `object-contain` — defensive fallback if a wrapper ever forces both width and height.

### CLAUDE.md addition

Append a new section near the end of `CLAUDE.md`:

```markdown
## Page layout convention

All top-level routed pages MUST render `PageHeader` as their first visual row:

- Left:  `title` (required) + `subtitle` (optional)
- Right: `ThemeToggle` (default-on inside `PageHeader`)
- `rightSlot` is reserved for page-level toggles (e.g. RequestDebug "show all" checkbox). Mode tabs do NOT belong in `rightSlot`.

### Non-Playground pages
Render `<PageHeader title=... subtitle=... />` directly at the top of the page, then page body. Reference: `apps/web/src/features/load-test/LoadTestPage.tsx`.

### Playground pages
Do NOT render `<PageHeader />` directly. Pass `title` / `subtitle` as props to `PlaygroundShell`. Shell renders, top-to-bottom:

1. `PageHeader` (row 1, always)
2. Optional sub-toolbar (row 2): mode tabs · history · 查看代码 · custom buttons · right-panel toggle
3. Children (main content) + `ParamsPanel` (right drawer)

Reference: `apps/web/src/features/playground/chat/ChatPage.tsx`.

### Mode tabs
Mode tabs (different modes of the same feature — e.g. image generate/edit, audio TTS/STT, chat single/compare) MUST be passed via `PlaygroundShell`'s `tabs` / `activeTab` / `onTabChange` props. Do NOT render a bespoke tab row.
```

## Testing strategy

### Unit / component (Vitest)

| Test file | New / changed assertion |
|---|---|
| `apps/web/src/features/playground/PlaygroundShell.test.tsx` | (a) Renders `PageHeader` with given `title`/`subtitle`. (b) When `tabs`, `historySlot`, `viewCodeSnippets`, `toolbarRightSlot` are all empty *and* `paramsSlot` is null, sub-toolbar row is not rendered. (c) `ThemeToggle` lives inside the `PageHeader` row, not the sub-toolbar. (d) When `viewCodeSnippets` is non-null, "查看代码" button shows in sub-toolbar. |
| `apps/web/src/features/playground/ViewCodeDialog.test.tsx` | Render with a snippet whose `curlReadable` contains a 2KB single-line string; assert the rendered `<pre>` has `whitespace-pre-wrap` (via `closest('pre')?.className`). |
| `apps/web/src/features/playground/chat/MessageList.test.tsx` | (new file if absent) Render a message with one `image_url` content part; assert the rendered `<img>` has `object-contain`, `self-start`, `w-auto` in its className. |
| Existing `ChatPage.test.tsx` / `ChatComparePage.test.tsx` / `ImagePage.test.tsx` / `EmbeddingsPage.test.tsx` / `RerankPage.test.tsx` | Update any assertion that targets a top-level `<PageHeader>` rendered from the page; the title/subtitle now reach the DOM via `PlaygroundShell` so `getByRole("heading", { name: ... })` keeps working but DOM placement changes. Adjust as needed. |
| `apps/web/src/features/playground/chat-compare/ChatModeTabs.tsx` test (was implicit in `ChatComparePage.test.tsx`) | Replace with a `useChatModeTabs` hook test (renderHook + MemoryRouter) — confirm `active` flips on path change. |

### Manual visual verification (browser, after `pnpm -F web dev`)

1. Visit each page and confirm a single `PageHeader` row at the top, theme toggle in the upper-right:
   - `/playground/chat` · `/playground/chat/compare` · `/playground/image` · `/playground/embeddings` · `/playground/rerank` · `/playground/audio`
   - `/load-test` · `/connections` · `/settings` (regression check — these should be unchanged)
2. On `/playground/chat`, click 查看代码; paste an assistant message containing a 2-3KB string and reopen — dialog must stay within `max-w-3xl`, content wraps softly.
3. On `/playground/chat`, attach a wide landscape image (e.g. 3000×800) and send — message-list image must render at correct aspect ratio (no horizontal stretch).
4. Tabs visual parity: `/playground/chat` ↔ `/playground/image` — tab rows look identical (same height, alignment, hover/active style) because both use Shell `tabs`.
5. Resize viewport to 768px wide — sub-toolbar should not overflow; `view-code` / theme buttons remain visible.

### Regression risks

- The right-panel collapse button is currently always visible in the existing toolbar; the new render rule (suppress when `paramsSlot` is null *and* no other slots) needs special-case handling for `ChatComparePage` (which has `paramsSlot={null}` but still shows tabs/history) so the panel-collapse button is hidden cleanly without breaking the toolbar.
- `ChatModeTabs` is consumed only by `ChatPage` and `ChatComparePage` today (verified by grep at design time); deleting the component is safe but the implementation plan must re-grep before deletion.
- Existing `data-testid` / aria-label assertions in tests that target the old `ChatModeTabs` row should be remapped to the Shell tab buttons.
