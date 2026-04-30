# Issue #32 — Layout fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify all top-level pages on a single `PageHeader` row (title + subtitle + theme toggle) and put Playground-specific affordances (mode tabs, history, view-code, panel toggle) in a sub-toolbar rendered by `PlaygroundShell`. Fix Dialog horizontal overflow and chat inline-image stretch in the same pass. Codify the convention in `CLAUDE.md`.

**Architecture:** `PlaygroundShell` becomes the canonical Playground layout host: it accepts `title`/`subtitle` props, renders `PageHeader` as row 1, and renders an optional sub-toolbar as row 2. All Playground pages stop rendering `<PageHeader />` themselves. `ChatModeTabs` is replaced by a `useChatModeTabs` hook that returns Shell-compatible tab config. Two small CSS-class fixes address the Dialog overflow (`min-w-0` chain + `whitespace-pre-wrap break-all` on `<pre>`) and the chat-image stretch (`w-auto self-start object-contain`).

**Tech Stack:** React 18, TypeScript, Tailwind CSS, vitest@1, react-router-dom, @testing-library/react, @testing-library/user-event, biome, shadcn/ui (Dialog, Tabs, Button).

**Spec:** `docs/superpowers/specs/2026-04-30-issue-32-layout-fix-design.md`

---

## File map

**Modify:**
- `apps/web/src/features/playground/PlaygroundShell.tsx` — add `title`, `subtitle`, `toolbarRightSlot` props; render `PageHeader`; new sub-toolbar render rule; conditional collapse button.
- `apps/web/src/features/playground/PlaygroundShell.test.tsx` — new tests for the props above.
- `apps/web/src/features/playground/ViewCodeDialog.tsx` — `min-w-0` chain + extracted `<CodeBlock>` with wrap classes.
- `apps/web/src/features/playground/ViewCodeDialog.test.tsx` — assert `<pre>` has `whitespace-pre-wrap`.
- `apps/web/src/features/playground/chat/MessageList.tsx` — `<img>` className change.
- `apps/web/src/features/playground/chat/MessageList.test.tsx` — assert image className.
- `apps/web/src/features/playground/chat-compare/ChatModeTabs.tsx` — replace component with `useChatModeTabs` hook.
- `apps/web/src/features/playground/chat/ChatPage.tsx` — adopt new Shell API; remove local `<PageHeader />` and `<ChatModeTabs />`.
- `apps/web/src/features/playground/chat-compare/ChatComparePage.tsx` — adopt new Shell API; split `historySlot` / `toolbarRightSlot`.
- `apps/web/src/features/playground/image/ImagePage.tsx` — pass `title`/`subtitle` to Shell; remove local `<PageHeader />`.
- `apps/web/src/features/playground/embeddings/EmbeddingsPage.tsx` — same.
- `apps/web/src/features/playground/rerank/RerankPage.tsx` — same.
- `apps/web/src/features/playground/audio/AudioPage.tsx` — same.
- `CLAUDE.md` — append "Page layout convention" section.

**No new files.**

## Phase ordering

- **Phase 1 (Tasks 1–2):** Self-contained bug fixes (overflow + image stretch). No API change.
- **Phase 2 (Tasks 3–4):** New infrastructure (`useChatModeTabs` hook, Shell API extension). Backwards-compatible (new props are optional).
- **Phase 3 (Tasks 5–10):** Migrate each Playground page. Build stays green after every commit because `title` is optional in this phase.
- **Phase 4 (Tasks 11–13):** Tighten `title` to required, append CLAUDE.md convention, full verification.

---

### Task 1: Fix `ViewCodeDialog` horizontal overflow (Issue #1)

**Files:**
- Modify: `apps/web/src/features/playground/ViewCodeDialog.tsx`
- Test: `apps/web/src/features/playground/ViewCodeDialog.test.tsx`

- [ ] **Step 1: Add a failing test for the wrap classes**

Append the following `describe` block to the end of `apps/web/src/features/playground/ViewCodeDialog.test.tsx`:

```tsx
describe("ViewCodeDialog — long-line wrap (Issue #32)", () => {
  it("renders <pre> with whitespace-pre-wrap and break-all so long lines never widen the dialog", () => {
    const longLineSnips = {
      curlReadable: `curl -X POST http://x -d '{"content":"${"A".repeat(2048)}"}'`,
      curlFull: `curl -X POST http://x -d '{"content":"${"A".repeat(2048)}"}'`,
      pythonReadable: "x",
      pythonFull: "x",
      nodeReadable: "x",
      nodeFull: "x",
    };
    render(<ViewCodeDialog open={true} onOpenChange={() => {}} snippets={longLineSnips} />);
    const pre = document.querySelector("pre");
    expect(pre).toBeTruthy();
    expect(pre?.className).toContain("whitespace-pre-wrap");
    expect(pre?.className).toContain("break-all");
    expect(pre?.className).toContain("max-w-full");
  });

  it("Tabs and TabsContent have min-w-0 so grid children can shrink", () => {
    render(<ViewCodeDialog open={true} onOpenChange={() => {}} snippets={plainSnips} />);
    // TabsList wraps a child div with role=tablist
    const tabList = document.querySelector("[role='tablist']");
    expect(tabList).toBeTruthy();
    // Walk up to the Tabs container (Radix injects data-orientation on Tabs root)
    const tabsRoot = tabList?.closest("[data-orientation]");
    expect(tabsRoot?.className).toContain("min-w-0");
    // The active TabsContent is rendered with role=tabpanel
    const activePanel = document.querySelector("[role='tabpanel']");
    expect(activePanel?.className).toContain("min-w-0");
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL**

Run: `pnpm -F web test -- src/features/playground/ViewCodeDialog.test.tsx`

Expected: 2 new tests fail because the existing `<pre>` lacks `whitespace-pre-wrap`/`break-all`/`max-w-full` and `Tabs`/`TabsContent` lack `min-w-0`.

- [ ] **Step 3: Implement the wrap classes**

Edit `apps/web/src/features/playground/ViewCodeDialog.tsx`. (a) Insert this `CodeBlock` helper just above the `ViewCodeDialog` function (after the existing `getSnippet` helper):

```tsx
function CodeBlock({ text }: { text: string }) {
  return (
    <pre className="max-h-[60vh] max-w-full overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs">
      {text}
    </pre>
  );
}
```

(b) Replace the three `<TabsContent>` blocks at the bottom of the dialog. The current block looks like:

```tsx
<Tabs value={active} onValueChange={(v) => setActive(v as Lang)}>
  <div className="flex items-center justify-between gap-2">
    ...
  </div>
  <TabsContent value="curl">
    <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-3 text-xs">
      {currentText}
    </pre>
  </TabsContent>
  <TabsContent value="python">
    <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-3 text-xs">
      {currentText}
    </pre>
  </TabsContent>
  <TabsContent value="node">
    <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-3 text-xs">
      {currentText}
    </pre>
  </TabsContent>
</Tabs>
```

Change it to:

```tsx
<Tabs value={active} onValueChange={(v) => setActive(v as Lang)} className="min-w-0">
  <div className="flex items-center justify-between gap-2">
    ...
  </div>
  <TabsContent value="curl" className="min-w-0">
    <CodeBlock text={currentText} />
  </TabsContent>
  <TabsContent value="python" className="min-w-0">
    <CodeBlock text={currentText} />
  </TabsContent>
  <TabsContent value="node" className="min-w-0">
    <CodeBlock text={currentText} />
  </TabsContent>
</Tabs>
```

(Leave the inner `<div className="flex items-center justify-between gap-2">` and its children — Tabs list, copy buttons — unchanged.)

- [ ] **Step 4: Run the test — expect PASS**

Run: `pnpm -F web test -- src/features/playground/ViewCodeDialog.test.tsx`

Expected: all tests pass (the 2 new ones plus all existing).

- [ ] **Step 5: Run lint and type-check**

Run: `pnpm -F web lint && pnpm -F web type-check`

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/playground/ViewCodeDialog.tsx apps/web/src/features/playground/ViewCodeDialog.test.tsx
git commit -m "$(cat <<'EOF'
fix(web/playground): wrap long lines in ViewCodeDialog so it stops widening past max-w-3xl

DialogContent uses display:grid; long single-line content (e.g. a 2KB
assistant message embedded in curl JSON) sized the grid item past the
max-w-3xl constraint, pushing the dialog off-screen. Add min-w-0 to
Tabs/TabsContent so grid children may shrink, and apply
whitespace-pre-wrap + break-all + max-w-full on the <pre> via a
shared CodeBlock helper.

Issue: #32 (item 1)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Fix chat inline-image stretch (Issue #3)

**Files:**
- Modify: `apps/web/src/features/playground/chat/MessageList.tsx`
- Test: `apps/web/src/features/playground/chat/MessageList.test.tsx`

- [ ] **Step 1: Add a failing test for the image className**

Append to the existing `describe("MessageList multimodal", …)` block in `apps/web/src/features/playground/chat/MessageList.test.tsx`:

```tsx
  it("renders <img> with object-contain, w-auto, and self-start to prevent flex stretch (Issue #32)", () => {
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } },
        ],
      },
    ];
    const { container } = renderWithI18n(<MessageList messages={messages} />);
    const img = container.querySelector("img");
    expect(img).toBeTruthy();
    expect(img?.className).toContain("object-contain");
    expect(img?.className).toContain("w-auto");
    expect(img?.className).toContain("self-start");
  });
```

- [ ] **Step 2: Run the test — expect FAIL**

Run: `pnpm -F web test -- src/features/playground/chat/MessageList.test.tsx`

Expected: the new test fails (image lacks the three classes).

- [ ] **Step 3: Implement the className change**

Edit `apps/web/src/features/playground/chat/MessageList.tsx`. Replace the `<img>` block at lines 13–20 (inside `renderPart`):

Before:

```tsx
  if (p.type === "image_url") {
    return (
      <img
        key={idx}
        src={p.image_url.url}
        alt=""
        className="max-h-64 max-w-full rounded border border-border"
      />
    );
  }
```

After:

```tsx
  if (p.type === "image_url") {
    return (
      <img
        key={idx}
        src={p.image_url.url}
        alt=""
        className="max-h-64 w-auto max-w-full self-start rounded border border-border object-contain"
      />
    );
  }
```

- [ ] **Step 4: Run the test — expect PASS**

Run: `pnpm -F web test -- src/features/playground/chat/MessageList.test.tsx`

Expected: all tests pass.

- [ ] **Step 5: Run lint**

Run: `pnpm -F web lint`

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/playground/chat/MessageList.tsx apps/web/src/features/playground/chat/MessageList.test.tsx
git commit -m "$(cat <<'EOF'
fix(web/playground/chat): preserve aspect ratio on inline message images

The chat message <img> sat inside a flex flex-col container whose
default align-items:stretch combined with max-w-full + Tailwind
preflight's display:block on <img> made the rendered box widen
beyond the natural image size, producing the stretched look from
issue #32. Add w-auto (don't force max width), self-start (opt out
of stretch), and object-contain (defensive fallback if a wrapper
ever forces both width and height).

Issue: #32 (item 3)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Replace `ChatModeTabs` component with `useChatModeTabs` hook

**Files:**
- Modify: `apps/web/src/features/playground/chat-compare/ChatModeTabs.tsx`

- [ ] **Step 1: Verify only ChatPage and ChatComparePage import the old component**

Run: `grep -rln "ChatModeTabs" apps/web/src --include="*.tsx" --include="*.ts"`

Expected: only `apps/web/src/features/playground/chat/ChatPage.tsx`, `apps/web/src/features/playground/chat-compare/ChatModeTabs.tsx`, and `apps/web/src/features/playground/chat-compare/ChatComparePage.tsx`. If any other consumer exists, stop and report — the deletion in Tasks 5/6 is unsafe until they migrate first.

- [ ] **Step 2: Write the hook (replaces the file contents wholesale)**

Replace the entire contents of `apps/web/src/features/playground/chat-compare/ChatModeTabs.tsx` with:

```tsx
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

export interface ChatModeTab {
  key: string;
  label: string;
}

/**
 * Returns Shell-compatible tabs config + active key + onChange handler that
 * navigates between /playground/chat (single) and /playground/chat/compare.
 */
export function useChatModeTabs(): {
  tabs: ChatModeTab[];
  active: "single" | "compare";
  onChange: (k: string) => void;
} {
  const { t } = useTranslation("playground");
  const nav = useNavigate();
  const { pathname } = useLocation();
  const active = pathname.endsWith("/compare") ? "compare" : "single";
  return {
    tabs: [
      { key: "single", label: t("chat.compare.modeTabs.single") },
      { key: "compare", label: t("chat.compare.modeTabs.compare") },
    ],
    active,
    onChange: (k: string) =>
      nav(k === "compare" ? "/playground/chat/compare" : "/playground/chat"),
  };
}
```

(`ChatPage` and `ChatComparePage` still import `ChatModeTabs` at this point; their JSX usages still reference `<ChatModeTabs />`. Build is broken until those files migrate. We accept this short window: Tasks 5 and 6 must immediately follow.)

- [ ] **Step 3: Re-export a deprecation shim so the import statement keeps compiling**

To keep build green between tasks, append the following compatibility shim to the same file:

```tsx
/**
 * @deprecated Use `useChatModeTabs()` and pass the result to PlaygroundShell.
 * Kept until ChatPage and ChatComparePage migrate.
 */
export function ChatModeTabs(): null {
  // Renders nothing; remove the JSX usage in ChatPage/ChatComparePage in
  // Tasks 5 and 6 of plan 2026-04-30-issue-32-layout-fix.md.
  return null;
}
```

This deliberately renders nothing — the visual tab row is gone temporarily until consumers migrate, but the codebase compiles.

- [ ] **Step 4: Run the relevant tests**

Run: `pnpm -F web test -- src/features/playground/chat-compare`

Expected: all existing tests still pass. (The visual tab row is missing for one or two intermediate commits; this is fine for unit tests because they don't assert on the tab DOM.)

- [ ] **Step 5: Run type-check and lint**

Run: `pnpm -F web type-check && pnpm -F web lint`

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/playground/chat-compare/ChatModeTabs.tsx
git commit -m "$(cat <<'EOF'
refactor(web/playground): convert ChatModeTabs component into useChatModeTabs hook

Mode tabs in chat / chat-compare were rendered as their own
NavLink-driven row above PageHeader, which made chat pages look
heavier than image/audio (where mode tabs sit in PlaygroundShell's
tab slot). Convert the component into a hook that returns Shell-
compatible {tabs, active, onChange} so Tasks 5 and 6 can wire it
through Shell and the visual treatment matches.

The old ChatModeTabs export is kept as a deprecation shim that
renders null, so the build remains green while ChatPage and
ChatComparePage are migrated in the next two commits.

Issue: #32 (item 2)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Extend `PlaygroundShell` API (optional `title` / `subtitle`, `toolbarRightSlot`, new toolbar render rule)

**Files:**
- Modify: `apps/web/src/features/playground/PlaygroundShell.tsx`
- Test: `apps/web/src/features/playground/PlaygroundShell.test.tsx`

- [ ] **Step 1: Add failing tests for the new behavior**

Append the following `describe` block to the end of `apps/web/src/features/playground/PlaygroundShell.test.tsx`:

```tsx
describe("PlaygroundShell — PageHeader + sub-toolbar (Issue #32)", () => {
  it("renders PageHeader as the first row when title is provided", () => {
    render(
      <PlaygroundShell category="chat" paramsSlot={null} title="My Title" subtitle="An intro">
        <div>main</div>
      </PlaygroundShell>,
    );
    expect(screen.getByRole("heading", { name: "My Title" })).toBeInTheDocument();
    expect(screen.getByText("An intro")).toBeInTheDocument();
  });

  it("does NOT render PageHeader when title is omitted (backwards-compat)", () => {
    render(
      <PlaygroundShell category="chat" paramsSlot={null}>
        <div>main</div>
      </PlaygroundShell>,
    );
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("does NOT render the sub-toolbar when paramsSlot is null and no slots are provided", () => {
    const { container } = render(
      <PlaygroundShell category="chat" paramsSlot={null} title="X">
        <div>main</div>
      </PlaygroundShell>,
    );
    // PageHeader's <header> is still present; assert there is exactly ONE <header>.
    expect(container.querySelectorAll("header")).toHaveLength(1);
  });

  it("renders the sub-toolbar when paramsSlot is non-null (collapse button needs to be reachable)", () => {
    const { container } = render(
      <PlaygroundShell category="chat" paramsSlot={<div>p</div>} title="X">
        <div>main</div>
      </PlaygroundShell>,
    );
    // Two <header>s: PageHeader + sub-toolbar.
    expect(container.querySelectorAll("header")).toHaveLength(2);
    expect(screen.getByRole("button", { name: /collapse|折叠/i })).toBeInTheDocument();
  });

  it("renders the sub-toolbar when only tabs are provided (no params panel)", () => {
    const { container } = render(
      <PlaygroundShell
        category="chat"
        paramsSlot={null}
        title="X"
        tabs={[
          { key: "a", label: "A" },
          { key: "b", label: "B" },
        ]}
        activeTab="a"
        onTabChange={() => {}}
      >
        <div>main</div>
      </PlaygroundShell>,
    );
    expect(container.querySelectorAll("header")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "A" })).toBeInTheDocument();
    // Collapse button is suppressed when paramsSlot is null.
    expect(screen.queryByRole("button", { name: /collapse|折叠/i })).not.toBeInTheDocument();
  });

  it("renders toolbarRightSlot in the sub-toolbar", () => {
    render(
      <PlaygroundShell
        category="chat"
        paramsSlot={null}
        title="X"
        toolbarRightSlot={<button type="button">extra-btn</button>}
      >
        <div>main</div>
      </PlaygroundShell>,
    );
    expect(screen.getByText("extra-btn")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests — expect FAIL**

Run: `pnpm -F web test -- src/features/playground/PlaygroundShell.test.tsx`

Expected: 6 new tests fail (props don't exist, render rule not implemented).

- [ ] **Step 3: Implement the new Shell**

Replace the entire contents of `apps/web/src/features/playground/PlaygroundShell.tsx` with:

```tsx
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ModalityCategory } from "@modeldoctor/contracts";
import { Code2, PanelRightClose, PanelRightOpen } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { ParamsPanel } from "./ParamsPanel";
import { ViewCodeDialog } from "./ViewCodeDialog";
import type { CodeSnippets } from "./code-snippets/chat";

export interface PlaygroundShellProps {
  /**
   * Page title rendered inside PageHeader (row 1). Optional during the
   * issue-32 migration; will become required in Task 11.
   */
  title?: string;
  subtitle?: string;
  category: ModalityCategory;
  tabs?: Array<{ key: string; label: string }>;
  activeTab?: string;
  onTabChange?: (k: string) => void;
  viewCodeSnippets?: CodeSnippets | null;
  historySlot?: ReactNode;
  /** Extra buttons that sit next to history / view-code in the sub-toolbar. */
  toolbarRightSlot?: ReactNode;
  paramsSlot: ReactNode;
  rightPanelDefaultOpen?: boolean;
  children: ReactNode;
}

export function PlaygroundShell({
  title,
  subtitle,
  tabs,
  activeTab,
  onTabChange,
  viewCodeSnippets,
  historySlot,
  toolbarRightSlot,
  paramsSlot,
  rightPanelDefaultOpen = true,
  children,
}: PlaygroundShellProps) {
  const { t: tc } = useTranslation("common");
  const { t } = useTranslation("playground");
  const [panelOpen, setPanelOpen] = useState(rightPanelDefaultOpen);
  const [viewCodeOpen, setViewCodeOpen] = useState(false);

  const showCollapseButton = paramsSlot != null;
  const showToolbar =
    showCollapseButton ||
    Boolean(tabs?.length) ||
    Boolean(historySlot) ||
    Boolean(viewCodeSnippets) ||
    Boolean(toolbarRightSlot);

  return (
    <div className="flex h-screen min-h-0 flex-col">
      {title ? <PageHeader title={title} subtitle={subtitle} /> : null}
      {showToolbar ? (
        <header className="flex items-center justify-between border-b border-border px-6 py-2">
          <div className="flex items-center gap-1">
            {tabs?.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => onTabChange?.(tab.key)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm",
                  tab.key === activeTab
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {historySlot}
            {viewCodeSnippets ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setViewCodeOpen(true)}
                aria-label={t("viewCode.title")}
              >
                <Code2 className="mr-1 h-4 w-4" />
                {t("viewCode.title")}
              </Button>
            ) : null}
            {toolbarRightSlot}
            {showCollapseButton ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPanelOpen((v) => !v)}
                aria-label={
                  panelOpen
                    ? tc("sidebar.collapse", { defaultValue: "Collapse" })
                    : tc("sidebar.expand", { defaultValue: "Expand" })
                }
              >
                {panelOpen ? (
                  <PanelRightClose className="h-4 w-4" />
                ) : (
                  <PanelRightOpen className="h-4 w-4" />
                )}
              </Button>
            ) : null}
          </div>
        </header>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
        <ParamsPanel open={panelOpen}>{paramsSlot}</ParamsPanel>
      </div>
      {viewCodeSnippets ? (
        <ViewCodeDialog
          open={viewCodeOpen}
          onOpenChange={setViewCodeOpen}
          snippets={viewCodeSnippets}
        />
      ) : null}
    </div>
  );
}
```

Key changes vs the previous implementation:
1. New optional `title` / `subtitle` props; renders `<PageHeader />` when `title` is set.
2. New `toolbarRightSlot` prop, rendered between view-code and the panel-collapse button.
3. New `showToolbar` / `showCollapseButton` booleans to suppress the sub-toolbar / collapse button when the page has no panel and no other slots.
4. Sub-toolbar `py-2` instead of `py-3` (slightly tighter, since PageHeader already takes ~80 px of vertical space).

- [ ] **Step 4: Run the tests — expect PASS**

Run: `pnpm -F web test -- src/features/playground/PlaygroundShell.test.tsx`

Expected: all tests pass (6 new + all existing).

- [ ] **Step 5: Run type-check and lint**

Run: `pnpm -F web type-check && pnpm -F web lint`

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/playground/PlaygroundShell.tsx apps/web/src/features/playground/PlaygroundShell.test.tsx
git commit -m "$(cat <<'EOF'
feat(web/playground): PlaygroundShell renders PageHeader and sub-toolbar

Add optional title/subtitle props so Shell can be the single source
of the visual primary header for every Playground page. Add a new
toolbarRightSlot for page-specific buttons (e.g. PanelCountSwitcher)
and a render rule that suppresses the sub-toolbar entirely when
nothing needs to live in it. Title is optional in this commit so
the per-page migrations in tasks 5–10 can land independently;
Task 11 will tighten title to required.

Issue: #32 (item 4 — infrastructure)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Migrate `ChatPage` to the new Shell API

**Files:**
- Modify: `apps/web/src/features/playground/chat/ChatPage.tsx`

- [ ] **Step 1: Make the edit**

Edit `apps/web/src/features/playground/chat/ChatPage.tsx`:

(a) Replace the `ChatModeTabs` import line at the top:

```tsx
import { ChatModeTabs } from "../chat-compare/ChatModeTabs";
```

with:

```tsx
import { useChatModeTabs } from "../chat-compare/ChatModeTabs";
```

(b) Remove the `PageHeader` import line:

```tsx
import { PageHeader } from "@/components/common/page-header";
```

(c) Inside the `ChatPage` function, just below the existing `const { t } = useTranslation("playground");` line, add:

```tsx
  const chatModeTabs = useChatModeTabs();
```

(d) Replace the JSX at the bottom of the component. The current return is:

```tsx
  return (
    <PlaygroundShell
      category="chat"
      viewCodeSnippets={snippets}
      historySlot={<HistoryDrawer useHistoryStore={useChatHistoryStore} />}
      paramsSlot={
        <div className="space-y-4">
          <CategoryEndpointSelector
            category="chat"
            selectedConnectionId={slice.selectedConnectionId}
            onSelect={slice.setSelected}
          />
          <ChatParams value={slice.params} onChange={slice.patchParams} />
        </div>
      }
    >
      <ChatModeTabs />
      <PageHeader title={t("chat.title")} subtitle={t("chat.subtitle")} />
      <div className="flex min-h-0 flex-1 flex-col">
        ...
      </div>
    </PlaygroundShell>
  );
```

Change to:

```tsx
  return (
    <PlaygroundShell
      category="chat"
      title={t("chat.title")}
      subtitle={t("chat.subtitle")}
      tabs={chatModeTabs.tabs}
      activeTab={chatModeTabs.active}
      onTabChange={chatModeTabs.onChange}
      viewCodeSnippets={snippets}
      historySlot={<HistoryDrawer useHistoryStore={useChatHistoryStore} />}
      paramsSlot={
        <div className="space-y-4">
          <CategoryEndpointSelector
            category="chat"
            selectedConnectionId={slice.selectedConnectionId}
            onSelect={slice.setSelected}
          />
          <ChatParams value={slice.params} onChange={slice.patchParams} />
        </div>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col">
        ...
      </div>
    </PlaygroundShell>
  );
```

(Leave the inner `<div className="flex min-h-0 flex-1 flex-col">` and its children — `MessageList`, error block, `MessageComposer` — exactly as they are.)

- [ ] **Step 2: Run the chat tests**

Run: `pnpm -F web test -- src/features/playground/chat/ChatPage.test.tsx`

Expected: all tests pass. The existing tests look up the send button, message list, and stop button by accessible name — they don't assert on PageHeader DOM placement, so removing the local PageHeader and adding it via Shell does not break them.

- [ ] **Step 3: Run type-check and lint**

Run: `pnpm -F web type-check && pnpm -F web lint`

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/playground/chat/ChatPage.tsx
git commit -m "$(cat <<'EOF'
refactor(web/playground/chat): migrate ChatPage to PlaygroundShell title/tabs API

Stop rendering local <PageHeader/> and <ChatModeTabs/> inside
ChatPage children; pass title/subtitle and the useChatModeTabs()
result to PlaygroundShell instead. Visually this drops one row
(the standalone tab row above PageHeader) and aligns chat with
image/audio.

Issue: #32 (item 2 + 4)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Migrate `ChatComparePage` to the new Shell API

**Files:**
- Modify: `apps/web/src/features/playground/chat-compare/ChatComparePage.tsx`

- [ ] **Step 1: Make the edit**

Edit `apps/web/src/features/playground/chat-compare/ChatComparePage.tsx`:

(a) Replace the `ChatModeTabs` import:

```tsx
import { ChatModeTabs } from "./ChatModeTabs";
```

with:

```tsx
import { useChatModeTabs } from "./ChatModeTabs";
```

(b) Remove the `PageHeader` import:

```tsx
import { PageHeader } from "@/components/common/page-header";
```

(c) Inside `ChatComparePage`, just below the existing `const { t } = useTranslation("playground");` line, add:

```tsx
  const chatModeTabs = useChatModeTabs();
```

(d) Replace the JSX. The current return starts:

```tsx
  return (
    <PlaygroundShell
      category="chat"
      paramsSlot={null}
      rightPanelDefaultOpen={false}
      historySlot={
        <>
          <CompareHistoryControls />
          <PanelCountSwitcher />
        </>
      }
    >
      <ChatModeTabs />
      <PageHeader title={t("chat.compare.title")} subtitle={t("chat.compare.subtitle")} />
      <div className="px-6 pb-3">
        ...
```

Change to:

```tsx
  return (
    <PlaygroundShell
      category="chat"
      title={t("chat.compare.title")}
      subtitle={t("chat.compare.subtitle")}
      tabs={chatModeTabs.tabs}
      activeTab={chatModeTabs.active}
      onTabChange={chatModeTabs.onChange}
      paramsSlot={null}
      rightPanelDefaultOpen={false}
      historySlot={<CompareHistoryControls />}
      toolbarRightSlot={<PanelCountSwitcher />}
    >
      <div className="px-6 pb-3">
        ...
```

(Leave everything below the `<div className="px-6 pb-3">` line untouched — the system-message details, the panel grid, the bottom MessageComposer + Stop-all bar.)

- [ ] **Step 2: Run the compare tests**

Run: `pnpm -F web test -- src/features/playground/chat-compare`

Expected: all tests pass. (The compare tests assert on panel rendering, not on the specific DOM placement of mode tabs or PageHeader.)

- [ ] **Step 3: Run type-check and lint**

Run: `pnpm -F web type-check && pnpm -F web lint`

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/playground/chat-compare/ChatComparePage.tsx
git commit -m "$(cat <<'EOF'
refactor(web/playground/chat-compare): migrate ChatComparePage to Shell title/tabs API

Move title/subtitle into PlaygroundShell props, drop the local
<PageHeader/> and <ChatModeTabs/>. Split the previous combined
historySlot fragment so CompareHistoryControls stays in historySlot
and PanelCountSwitcher moves to the new toolbarRightSlot — the two
have different semantics (one is per-history, one is per-layout).

Issue: #32 (item 2 + 4)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Migrate `ImagePage` to the new Shell API

**Files:**
- Modify: `apps/web/src/features/playground/image/ImagePage.tsx`

- [ ] **Step 1: Make the edit**

Edit `apps/web/src/features/playground/image/ImagePage.tsx`:

(a) Remove the `PageHeader` import.

(b) In the JSX return, current PlaygroundShell call has `tabs={[…]}` prop already set (good). The first child is `<PageHeader title={t("image.title")} subtitle={t("image.subtitle")} />`. Remove that line. Pass `title`/`subtitle` to Shell as props.

The current return looks like:

```tsx
  return (
    <PlaygroundShell
      category="image"
      tabs={[
        { key: "generate", label: t("image.tabs.generate") },
        { key: "edit", label: t("image.tabs.edit") },
      ]}
      activeTab={mode}
      onTabChange={(k) => { ... }}
      viewCodeSnippets={snippets}
      historySlot={mode === "generate" ? <HistoryDrawer ... /> : null}
      paramsSlot={...}
    >
      <PageHeader title={t("image.title")} subtitle={t("image.subtitle")} />
      {mode === "generate" ? (
        ...
      ) : (
        <InpaintMode />
      )}
    </PlaygroundShell>
  );
```

Change to:

```tsx
  return (
    <PlaygroundShell
      category="image"
      title={t("image.title")}
      subtitle={t("image.subtitle")}
      tabs={[
        { key: "generate", label: t("image.tabs.generate") },
        { key: "edit", label: t("image.tabs.edit") },
      ]}
      activeTab={mode}
      onTabChange={(k) => { ... }}
      viewCodeSnippets={snippets}
      historySlot={mode === "generate" ? <HistoryDrawer ... /> : null}
      paramsSlot={...}
    >
      {mode === "generate" ? (
        ...
      ) : (
        <InpaintMode />
      )}
    </PlaygroundShell>
  );
```

- [ ] **Step 2: Run the image tests**

Run: `pnpm -F web test -- src/features/playground/image`

Expected: all tests pass.

- [ ] **Step 3: Run type-check and lint**

Run: `pnpm -F web type-check && pnpm -F web lint`

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/playground/image/ImagePage.tsx
git commit -m "$(cat <<'EOF'
refactor(web/playground/image): migrate ImagePage to PlaygroundShell title API

Drop local <PageHeader/>; pass title/subtitle to PlaygroundShell.
Tabs prop was already wired through Shell, so this is purely a
header-ownership change.

Issue: #32 (item 4)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Migrate `EmbeddingsPage` to the new Shell API

**Files:**
- Modify: `apps/web/src/features/playground/embeddings/EmbeddingsPage.tsx`

- [ ] **Step 1: Make the edit**

Edit `apps/web/src/features/playground/embeddings/EmbeddingsPage.tsx`:

(a) Remove the `PageHeader` import.

(b) The current return contains:

```tsx
    <PlaygroundShell
      category="embeddings"
      viewCodeSnippets={snippets}
      historySlot={<HistoryDrawer useHistoryStore={useEmbeddingsHistoryStore} />}
      paramsSlot={...}
    >
      <PageHeader title={t("embeddings.title")} subtitle={t("embeddings.subtitle")} />
      <div className="flex min-h-0 flex-1 flex-col gap-4 px-6 py-4">
        ...
```

Change to:

```tsx
    <PlaygroundShell
      category="embeddings"
      title={t("embeddings.title")}
      subtitle={t("embeddings.subtitle")}
      viewCodeSnippets={snippets}
      historySlot={<HistoryDrawer useHistoryStore={useEmbeddingsHistoryStore} />}
      paramsSlot={...}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 px-6 py-4">
        ...
```

- [ ] **Step 2: Run the embeddings tests**

Run: `pnpm -F web test -- src/features/playground/embeddings`

Expected: all tests pass.

- [ ] **Step 3: Run type-check and lint**

Run: `pnpm -F web type-check && pnpm -F web lint`

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/playground/embeddings/EmbeddingsPage.tsx
git commit -m "$(cat <<'EOF'
refactor(web/playground/embeddings): migrate EmbeddingsPage to PlaygroundShell title API

Issue: #32 (item 4)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Migrate `RerankPage` to the new Shell API

**Files:**
- Modify: `apps/web/src/features/playground/rerank/RerankPage.tsx`

- [ ] **Step 1: Make the edit**

Edit `apps/web/src/features/playground/rerank/RerankPage.tsx`:

(a) Remove the `PageHeader` import.

(b) Identify the existing `<PlaygroundShell …>` opening and the immediate `<PageHeader title={t("rerank.title")} subtitle={t("rerank.subtitle")} />` that follows. Remove that PageHeader line. Add `title={t("rerank.title")}` and `subtitle={t("rerank.subtitle")}` to the Shell's prop list.

For example, change:

```tsx
    <PlaygroundShell
      category="rerank"
      viewCodeSnippets={...}
      historySlot={...}
      paramsSlot={...}
    >
      <PageHeader title={t("rerank.title")} subtitle={t("rerank.subtitle")} />
      ...
```

to:

```tsx
    <PlaygroundShell
      category="rerank"
      title={t("rerank.title")}
      subtitle={t("rerank.subtitle")}
      viewCodeSnippets={...}
      historySlot={...}
      paramsSlot={...}
    >
      ...
```

(Match the exact prop names already present in RerankPage.tsx — only `title`/`subtitle` are added and the local `<PageHeader />` is removed.)

- [ ] **Step 2: Run the rerank tests**

Run: `pnpm -F web test -- src/features/playground/rerank`

Expected: all tests pass.

- [ ] **Step 3: Run type-check and lint**

Run: `pnpm -F web type-check && pnpm -F web lint`

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/playground/rerank/RerankPage.tsx
git commit -m "$(cat <<'EOF'
refactor(web/playground/rerank): migrate RerankPage to PlaygroundShell title API

Issue: #32 (item 4)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Migrate `AudioPage` to the new Shell API

**Files:**
- Modify: `apps/web/src/features/playground/audio/AudioPage.tsx`

- [ ] **Step 1: Make the edit**

Edit `apps/web/src/features/playground/audio/AudioPage.tsx`:

(a) Remove the `PageHeader` import (line 1).

(b) AudioPage already passes `tabs={[…]}` to Shell. Inside the JSX, find the `<PageHeader title={t("audio.title")} subtitle={t("audio.subtitle")} />` line (around line 236) and delete it.

(c) Add `title={t("audio.title")}` and `subtitle={t("audio.subtitle")}` to the `<PlaygroundShell …>` prop list (just before `category` or near it — placement doesn't matter as long as the props are passed).

- [ ] **Step 2: Run the audio tests**

Run: `pnpm -F web test -- src/features/playground/audio`

Expected: all tests pass.

- [ ] **Step 3: Run type-check and lint**

Run: `pnpm -F web type-check && pnpm -F web lint`

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/playground/audio/AudioPage.tsx
git commit -m "$(cat <<'EOF'
refactor(web/playground/audio): migrate AudioPage to PlaygroundShell title API

Issue: #32 (item 4)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Tighten `PlaygroundShell.title` to required + remove deprecated `ChatModeTabs` shim

**Files:**
- Modify: `apps/web/src/features/playground/PlaygroundShell.tsx`
- Modify: `apps/web/src/features/playground/PlaygroundShell.test.tsx`
- Modify: `apps/web/src/features/playground/chat-compare/ChatModeTabs.tsx`

- [ ] **Step 1: Update the failing-test that expected optional title**

In `apps/web/src/features/playground/PlaygroundShell.test.tsx`, find the test:

```tsx
  it("does NOT render PageHeader when title is omitted (backwards-compat)", () => {
    render(
      <PlaygroundShell category="chat" paramsSlot={null}>
        <div>main</div>
      </PlaygroundShell>,
    );
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });
```

Delete it (the migration window is closed; title is now mandatory).

Also confirm that every other test in the file passes a `title` prop. If any test still omits `title`, edit it to include `title="X"`.

- [ ] **Step 2: Make `title` required in the type**

Edit `apps/web/src/features/playground/PlaygroundShell.tsx`. Change:

```tsx
  title?: string;
```

to:

```tsx
  title: string;
```

Also remove the comment "Optional during the issue-32 migration; will become required in Task 11.".

- [ ] **Step 3: Delete the deprecated `ChatModeTabs` shim**

Edit `apps/web/src/features/playground/chat-compare/ChatModeTabs.tsx`. Remove the trailing block:

```tsx
/**
 * @deprecated Use `useChatModeTabs()` and pass the result to PlaygroundShell.
 * Kept until ChatPage and ChatComparePage migrate.
 */
export function ChatModeTabs(): null {
  return null;
}
```

(Keep the `useChatModeTabs` hook and `ChatModeTab` type.)

- [ ] **Step 4: Run all Playground tests**

Run: `pnpm -F web test -- src/features/playground`

Expected: all tests pass. If any per-page test fails because the page file forgot to pass `title`, fix the page.

- [ ] **Step 5: Run type-check and lint**

Run: `pnpm -F web type-check && pnpm -F web lint`

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/playground/PlaygroundShell.tsx apps/web/src/features/playground/PlaygroundShell.test.tsx apps/web/src/features/playground/chat-compare/ChatModeTabs.tsx
git commit -m "$(cat <<'EOF'
refactor(web/playground): make Shell title required and remove ChatModeTabs shim

Migration window closed: every Playground page now passes title to
PlaygroundShell, so the optional-title affordance is no longer
needed. The transient ChatModeTabs deprecation shim added in Task 3
is also removed — useChatModeTabs is the only export left.

Issue: #32

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Append "Page layout convention" section to `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Append the section**

Append the following block to the end of `CLAUDE.md` (after the existing "Project-specific constraints" section):

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
2. Optional sub-toolbar (row 2): mode tabs · history · 查看代码 · `toolbarRightSlot` · right-panel toggle
3. Children (main content) + `ParamsPanel` (right drawer)

Reference: `apps/web/src/features/playground/chat/ChatPage.tsx`.

### Mode tabs

Mode tabs (different modes of the same feature — e.g. image generate/edit, audio TTS/STT, chat single/compare) MUST be passed via `PlaygroundShell`'s `tabs` / `activeTab` / `onTabChange` props. Do NOT render a bespoke tab row.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: codify page layout convention in CLAUDE.md

Add a 'Page layout convention' section that pins the PageHeader
contract for non-Playground pages and the PlaygroundShell contract
for Playground pages, plus the mode-tabs rule. Future page work
inherits these without further nudging.

Issue: #32

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Final verification — full test suite + manual visual check

**Files:** none modified

- [ ] **Step 1: Run the full web test suite**

Run: `pnpm -F web test`

Expected: zero failures across all suites.

- [ ] **Step 2: Run lint and type-check on the whole web app**

Run: `pnpm -F web lint && pnpm -F web type-check`

Expected: zero errors.

- [ ] **Step 3: Sanity-grep for stragglers**

Run: `grep -rn "<PageHeader" apps/web/src/features/playground --include="*.tsx"`

Expected: ZERO matches inside `apps/web/src/features/playground/` (Playground pages must not render `<PageHeader />` directly any more — Shell does).

Run: `grep -rn "<ChatModeTabs " apps/web/src --include="*.tsx"`

Expected: zero matches (component-style usage is gone; only the hook remains).

- [ ] **Step 4: Manual visual check (browser)**

In one terminal:

```bash
pnpm -F web dev
```

Then in a browser, walk through every page below and confirm the visual checklist:

1. **PageHeader is row 1 on every page**, with title + subtitle on the left and theme toggle in the upper-right:
   - http://localhost:5173/playground/chat
   - http://localhost:5173/playground/chat/compare
   - http://localhost:5173/playground/image
   - http://localhost:5173/playground/embeddings
   - http://localhost:5173/playground/rerank
   - http://localhost:5173/playground/audio
   - http://localhost:5173/load-test  ← regression check, must look identical to before this PR
   - http://localhost:5173/connections ← regression check
   - http://localhost:5173/settings    ← regression check

2. **Tabs visual parity**: open `/playground/chat` and `/playground/image` in two tabs and visually compare — the tab rows (single/compare vs generate/edit) must look identical (height, padding, hover state, active state).

3. **ViewCodeDialog overflow fix**: on `/playground/chat`, send a message such that the assistant reply contains a 2KB+ single-line string (the demo seed input usually triggers a long reply). Click "查看代码". Confirm the dialog stays within ~max-w-3xl, the long line wraps softly inside the `<pre>`, and the dialog is centered (no off-screen left edge).

4. **Chat image stretch fix**: on `/playground/chat`, attach a wide landscape image (e.g. 3000×800 px) and a tall portrait image (e.g. 600×1800) and send each. Confirm the rendered messages preserve aspect ratio (no stretched look).

5. **Mobile width sanity**: resize the browser to ~768px wide. Confirm the sub-toolbar doesn't overflow horizontally on any Playground page; theme toggle is still visible in the upper-right.

- [ ] **Step 5: Push the branch (still no PR)**

Run: `git push -u origin fix/issue-30-smoke-fixes`

Expected: push succeeds. (PR creation / merge is out-of-scope for this plan; the user will trigger that.)

---

## Self-review notes

- **Spec coverage**:
  - Issue #1 (ViewCodeDialog overflow) → Task 1.
  - Issue #2 (chat tabs vs image tabs unified) → Tasks 3 + 5 + 6 (hook + ChatPage migration + ChatComparePage migration).
  - Issue #3 (chat image stretch) → Task 2.
  - Issue #4 (Playground / non-Playground layout unification) → Tasks 4 (Shell extension) + 5–10 (per-page migrations) + 11 (tighten title) + 12 (CLAUDE.md).
  - Spec's `ParamsPanel` regression caveat (collapse button only when `paramsSlot != null`) → covered by Task 4 Step 3 (`showCollapseButton = paramsSlot != null`) and explicit test in Task 4 Step 1.
  - Spec's `useChatModeTabs` typing concern (Shell expects mutable Array) → addressed by typing the hook return as `ChatModeTab[]` (not `as const`) in Task 3 Step 2.
  - Spec's `PanelCountSwitcher` slot move → Task 6 Step 1 (d).
- **Placeholder scan**: every code block contains complete code; no "TBD", "TODO", "fill in details", or "similar to Task N" without repeating code.
- **Type consistency**: `useChatModeTabs` returns `ChatModeTab[]` matching Shell's `tabs?: Array<{ key: string; label: string }>`. `title` flips from optional (Tasks 4–10) to required (Task 11) — consistent with the per-task narration.
- **Risk**: between Task 3 and Task 5, `ChatPage` still renders `<ChatModeTabs />` (the deprecation shim returning null) — so the chat-mode tab row is briefly invisible in the running app. Acceptable because (a) Tasks 5 and 6 land in the same PR and (b) only affects intermediate commits visited via `git checkout`.
