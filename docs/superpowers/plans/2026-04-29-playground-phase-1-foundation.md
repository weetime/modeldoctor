# Playground Phase 1 — Foundation + Minimal Chat E2E

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the minimum that proves the Playground end-to-end loop: user creates a `chat`-category Connection, navigates to `/playground/chat`, sends a single text message, and sees the assistant's reply rendered. No streaming, no multimodal, no history, no compare, no View Code yet — those come in Phase 2/3.

**Architecture:** Frontend = new `apps/web/src/features/playground/` directory with a `PlaygroundShell` (header + main + right `ParamsPanel`) that all 5 modality pages will eventually share, plus a `CategoryEndpointSelector` that filters connections by category. Backend = new `apps/api/src/modules/playground/` Nest module with one controller `POST /api/playground/chat` (non-streaming) that proxies to the user's upstream URL. Connection model gains `category` (required single-pick) and `tags` (optional string array); localStorage version bumps `1 → 2` and discards old data per the no-compat-shims policy.

**Tech Stack:** NestJS 10 / Vite 5 / React 18 / Zustand 4 + persist / react-hook-form + zod / vitest + RTL / shadcn UI / TailwindCSS.

**Spec:** [`../specs/2026-04-29-playground-design.md`](../specs/2026-04-29-playground-design.md).

**Phase 1 deliberate omissions** (deferred to Phase 2 to honor YAGNI; spec § 10 lists them as "Phase 1 components" but Phase 1 has no consumer):

- `ViewCodeDialog` — no Phase 1 consumer
- `HistoryStore` — Phase 1 ChatPage explicitly "不带历史"
- `apps/api/src/integrations/openai-client/` shared client — only one wire (chat) needed in Phase 1; defer extraction to Phase 2 when Embeddings/Rerank/Images need it (per spec § 13.1)

---

## File Map

### Created

| Path | Responsibility |
|---|---|
| `packages/contracts/src/modality.ts` | `ModalityCategorySchema` enum (chat/audio/embeddings/rerank/image) — single source of truth shared by Connection + e2e probes |
| `packages/contracts/src/playground.ts` | `PlaygroundChatRequestSchema`, `PlaygroundChatResponseSchema`, `ChatMessageSchema` — wire contract for `POST /api/playground/chat` |
| `apps/web/src/features/playground/PlaygroundShell.tsx` | Layout wrapper: header (tabs + collapse btn) + main slot + right `ParamsPanel` slot |
| `apps/web/src/features/playground/ParamsPanel.tsx` | Right column container with collapse animation + scroll |
| `apps/web/src/features/playground/CategoryEndpointSelector.tsx` | Connection picker filtered by `category` with "Show all" toggle and category-mismatch warning |
| `apps/web/src/features/playground/chat/ChatPage.tsx` | Compose Shell + Selector + MessageList + Composer + ChatParams + send-message effect |
| `apps/web/src/features/playground/chat/ChatPage.test.tsx` | Smoke RTL test: renders, send disabled until connection chosen, success path mocks `/api/playground/chat` and renders assistant reply |
| `apps/web/src/features/playground/chat/MessageList.tsx` | Render array of messages with role labels |
| `apps/web/src/features/playground/chat/MessageComposer.tsx` | System message textarea + user input textarea + Send button (no attachments in Phase 1) |
| `apps/web/src/features/playground/chat/ChatParams.tsx` | Slider + input controls for the 8 chat params |
| `apps/web/src/features/playground/chat/store.ts` | Zustand chat slice: connection id, endpoint, messages, params, sending bool |
| `apps/web/src/features/playground/chat/store.test.ts` | Reducer-style tests for store actions |
| `apps/web/src/features/playground/CategoryEndpointSelector.test.tsx` | RTL: filtered list, "show all" toggle, mismatch warning chip, "+ new" prefill |
| `apps/web/src/features/playground/PlaygroundShell.test.tsx` | RTL: tab change callback, collapse btn toggles params panel visibility |
| `apps/web/src/locales/en-US/playground.json` | Phase 1 keys: chat-only structure |
| `apps/web/src/locales/zh-CN/playground.json` | zh translations (mirror of en) |
| `apps/api/src/modules/playground/playground.module.ts` | NestJS module wiring |
| `apps/api/src/modules/playground/chat.controller.ts` | `POST /api/playground/chat` controller with `ZodValidationPipe(PlaygroundChatRequestSchema)` |
| `apps/api/src/modules/playground/chat.service.ts` | Build upstream URL/headers, fetch, parse OpenAI chat-completions JSON, return shape |
| `apps/api/src/modules/playground/chat.service.spec.ts` | vitest: mock global `fetch`, assert URL + headers + body construction + response parsing + error mapping |

### Modified

| Path | Change |
|---|---|
| `packages/contracts/src/e2e-test.ts` | Replace `ProbeCategorySchema` body with `export const ProbeCategorySchema = ModalityCategorySchema;` (alias). Keep `ProbeCategory` type alias. |
| `packages/contracts/src/index.ts` | Add `export * from "./modality.js"; export * from "./playground.js";` |
| `apps/web/src/types/connection.ts` | Add `category: ModalityCategory` (required) and `tags: string[]` to `Connection`; add to `emptyEndpointValues`'s sibling? — only Connection itself, not EndpointValues (endpoint values stay shape-stable) |
| `apps/web/src/features/connections/schema.ts` | Add `category` and `tags` to `connectionInputSchema` |
| `apps/web/src/features/connections/schema.test.ts` | New tests covering category-required and tags-trim |
| `apps/web/src/stores/connections-store.ts` | Bump persist `version` `1 → 2`; default `category: "chat"` and `tags: []` not applied to old data — old data is discarded by zustand persist version mismatch; `exportAll` writes `version: 2`; `importAll` rejects non-2 |
| `apps/web/src/stores/connections-store.test.ts` | Update existing tests to pass `category` + `tags` in inputs; add v1→v2 drop test |
| `apps/web/src/features/connections/ConnectionDialog.tsx` | Add category `<Select>` + tag chip input; reset/save logic includes new fields |
| `apps/web/src/features/connections/ConnectionsPage.tsx` | Add table columns for category (badge) + tags (chip strip); add header filters for both |
| `apps/web/src/locales/en-US/connections.json` | Add `category.label`, `category.options.{chat,audio,embeddings,rerank,image}`, `tags.label`, `tags.placeholder`, `tags.suggestions`, table column labels |
| `apps/web/src/locales/zh-CN/connections.json` | Mirror zh translations |
| `apps/web/src/locales/en-US/sidebar.json` | Add `groups.playground` and 5 `items.{playgroundChat,playgroundImage,playgroundAudio,playgroundEmbeddings,playgroundRerank}` |
| `apps/web/src/locales/zh-CN/sidebar.json` | Mirror zh |
| `apps/web/src/components/sidebar/sidebar-config.tsx` | Insert `playground` group BEFORE `performance`; `chat` is real, the other 4 are `comingSoon: true` until Phase 2/3 |
| `apps/web/src/router/index.tsx` | Add `/playground` redirect → `/playground/chat`; `/playground/chat` → `<ChatPage/>`; the other 4 modalities use `<ComingSoonRoute/>` placeholders |
| `apps/web/src/lib/i18n.ts` | Register the new `playground` namespace in resources + ns array |
| `apps/api/src/app.module.ts` | Register `PlaygroundModule` in `imports` |

---

## Task 1: Extract `ModalityCategorySchema` to its own contract module

**Files:**
- Create: `packages/contracts/src/modality.ts`
- Modify: `packages/contracts/src/e2e-test.ts:26-27`
- Modify: `packages/contracts/src/index.ts`

- [ ] **Step 1: Write the failing test for the new module**

Create `packages/contracts/src/modality.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ModalityCategorySchema, type ModalityCategory } from "./modality.js";

describe("ModalityCategorySchema", () => {
  it("accepts each of the 5 known categories", () => {
    for (const c of ["chat", "audio", "embeddings", "rerank", "image"] as ModalityCategory[]) {
      expect(ModalityCategorySchema.parse(c)).toBe(c);
    }
  });

  it("rejects unknown values", () => {
    expect(() => ModalityCategorySchema.parse("video")).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm -F @modeldoctor/contracts test --run src/modality.test.ts
```

Expected: FAIL — `Cannot find module './modality.js'`.

- [ ] **Step 3: Create the schema module**

Create `packages/contracts/src/modality.ts`:

```ts
import { z } from "zod";

/**
 * Single source of truth for the 5 model-service categories. Both the
 * `Connection.category` field (in the web app) and the e2e-probe categories
 * use this enum — keep it in sync.
 *
 * Iteration order determines display order in UI dropdowns.
 */
export const ModalityCategorySchema = z.enum(["chat", "audio", "embeddings", "rerank", "image"]);
export type ModalityCategory = z.infer<typeof ModalityCategorySchema>;
```

- [ ] **Step 4: Update `e2e-test.ts` to alias the new schema**

Open `packages/contracts/src/e2e-test.ts` and replace the existing `ProbeCategorySchema` definition (lines 26-27) with:

```ts
import { ModalityCategorySchema } from "./modality.js";

// Alias kept for backwards-compatible naming inside e2e-probe code paths.
export const ProbeCategorySchema = ModalityCategorySchema;
export type ProbeCategory = z.infer<typeof ProbeCategorySchema>;
```

(Leave the rest of the file unchanged. The `import { z } from "zod"` line at the top stays.)

- [ ] **Step 5: Re-export from `index.ts`**

Add to `packages/contracts/src/index.ts` (keep alphabetical order is not enforced; just add a new line above `e2e-test.js`):

```ts
export * from "./modality.js";
```

- [ ] **Step 6: Run the new test plus the existing contracts test suite**

```bash
pnpm -F @modeldoctor/contracts test --run
```

Expected: ALL PASS.

- [ ] **Step 7: Verify the contracts package still builds**

```bash
pnpm -F @modeldoctor/contracts build
```

Expected: clean build.

- [ ] **Step 8: Commit**

```bash
git add packages/contracts/src/modality.ts packages/contracts/src/modality.test.ts packages/contracts/src/e2e-test.ts packages/contracts/src/index.ts
git commit -m "$(cat <<'EOF'
refactor(contracts): extract ModalityCategorySchema as shared enum

Both Connection (web) and e2e-probes use the same 5-category enum.
Pull it into its own module so the upcoming playground feature can import
it without dragging in the full e2e-test schema. ProbeCategorySchema is
kept as a re-export for callsite stability.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add `category` + `tags` to the Connection type and zod schema

**Files:**
- Modify: `apps/web/src/types/connection.ts`
- Modify: `apps/web/src/features/connections/schema.ts`
- Modify: `apps/web/src/features/connections/schema.test.ts`

- [ ] **Step 1: Add the new fields to the schema's failing tests**

Open `apps/web/src/features/connections/schema.test.ts`. Append:

```ts
import { describe, expect, it } from "vitest";
import { connectionInputSchema } from "./schema";

describe("connectionInputSchema (category + tags)", () => {
  const baseInput = {
    name: "n",
    apiBaseUrl: "http://x",
    apiKey: "k",
    model: "m",
    customHeaders: "",
    queryParams: "",
  };

  it("requires a category", () => {
    expect(() => connectionInputSchema.parse({ ...baseInput, tags: [] })).toThrow();
  });

  it("rejects an unknown category", () => {
    expect(() =>
      connectionInputSchema.parse({ ...baseInput, category: "video", tags: [] }),
    ).toThrow();
  });

  it("trims and dedupes tags", () => {
    const out = connectionInputSchema.parse({
      ...baseInput,
      category: "chat",
      tags: ["  vLLM  ", "vLLM", "production", ""],
    });
    expect(out.tags).toEqual(["vLLM", "production"]);
  });

  it("defaults tags to an empty array when omitted", () => {
    const out = connectionInputSchema.parse({ ...baseInput, category: "chat" });
    expect(out.tags).toEqual([]);
  });
});
```

(If the file already has a top describe block, place this as a sibling describe.)

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm -F @modeldoctor/web test --run src/features/connections/schema.test.ts
```

Expected: FAIL — schema does not yet validate `category` / `tags`.

- [ ] **Step 3: Update the zod schema**

Open `apps/web/src/features/connections/schema.ts` and replace the file contents:

```ts
import { ModalityCategorySchema } from "@modeldoctor/contracts";
import { z } from "zod";

export const connectionInputSchema = z.object({
  name: z
    .string()
    .transform((v) => v.trim())
    .pipe(z.string().min(1, "required")),
  apiBaseUrl: z.string().url("invalid URL"),
  apiKey: z.string().min(1, "required"),
  model: z.string().min(1, "required"),
  customHeaders: z.string(),
  queryParams: z.string(),
  category: ModalityCategorySchema,
  tags: z
    .array(z.string())
    .default([])
    .transform((arr) => {
      const seen = new Set<string>();
      const out: string[] = [];
      for (const t of arr) {
        const trimmed = t.trim();
        if (!trimmed || seen.has(trimmed)) continue;
        seen.add(trimmed);
        out.push(trimmed);
      }
      return out;
    }),
});

export type ConnectionInput = z.infer<typeof connectionInputSchema>;
```

- [ ] **Step 4: Update the Connection type**

Open `apps/web/src/types/connection.ts` and replace its contents:

```ts
import type { ModalityCategory } from "@modeldoctor/contracts";

export interface Connection {
  id: string;
  name: string;
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  customHeaders: string;
  queryParams: string;
  category: ModalityCategory;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

/** The subset of Connection fields a feature page edits inline. */
export type EndpointValues = Pick<
  Connection,
  "apiBaseUrl" | "apiKey" | "model" | "customHeaders" | "queryParams"
>;

export const emptyEndpointValues: EndpointValues = {
  apiBaseUrl: "",
  apiKey: "",
  model: "",
  customHeaders: "",
  queryParams: "",
};

export interface ConnectionsExport {
  version: 2;
  connections: Connection[];
}
```

(Note: `EndpointValues` purposely does NOT gain `category` / `tags` — those live on the Connection record only; inline endpoint editors don't change them.)

- [ ] **Step 5: Run the schema test to verify it passes**

```bash
pnpm -F @modeldoctor/web test --run src/features/connections/schema.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run type-check (the rest of the codebase will scream)**

```bash
pnpm -F @modeldoctor/web type-check
```

Expected: many errors — connections-store and ConnectionDialog now miss the required fields. **That's the next two tasks.** Note them and proceed.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/types/connection.ts apps/web/src/features/connections/schema.ts apps/web/src/features/connections/schema.test.ts
git commit -m "$(cat <<'EOF'
feat(connections): add category + tags to Connection type and zod schema

Category (single-pick from the 5-modality enum) is required so the
upcoming playground UI can deterministically filter the connection
picker. Tags are an optional, free-form, deduped+trimmed string array
for vendor / wire / environment labels (vLLM, SGLang, production, …).

Type-check fails until the store and dialog adopt the new fields — see
the next two commits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Bump connections-store to v2 (drop legacy data) and surface category/tags

**Files:**
- Modify: `apps/web/src/stores/connections-store.ts`
- Modify: `apps/web/src/stores/connections-store.test.ts`

- [ ] **Step 1: Update existing tests to include `category` + `tags` in `baseInput`, and add a v1→v2 drop test**

Open `apps/web/src/stores/connections-store.test.ts` and:

(a) Replace the `baseInput` constant near the top:

```ts
const baseInput = {
  name: "prod",
  apiBaseUrl: "http://x",
  apiKey: "sk-1",
  model: "m1",
  customHeaders: "",
  queryParams: "",
  category: "chat" as const,
  tags: [] as string[],
};
```

(b) Update the `exportAll produces a versioned envelope` test to expect version `2`:

```ts
it("exportAll produces a versioned envelope", () => {
  useConnectionsStore.getState().create(baseInput);
  const json = useConnectionsStore.getState().exportAll();
  const parsed = JSON.parse(json);
  expect(parsed.version).toBe(2);
  expect(parsed.connections).toHaveLength(1);
});
```

(c) Update the two `importAll` tests to use `version: 2` in the `incoming` envelopes (search for `version: 1` and replace with `version: 2`; also add `category: "chat"`, `tags: []` to each connection record literal).

(d) Update the `importAll rejects unknown version` test — it now should also reject version 1:

```ts
it("importAll rejects unknown version", () => {
  expect(() =>
    useConnectionsStore
      .getState()
      .importAll(JSON.stringify({ version: 99, connections: [] }), "merge"),
  ).toThrow(/version/i);
});

it("importAll rejects v1 envelopes (no longer supported)", () => {
  expect(() =>
    useConnectionsStore
      .getState()
      .importAll(JSON.stringify({ version: 1, connections: [] }), "merge"),
  ).toThrow(/version/i);
});
```

(e) Replace the `drops persisted v0 state on version mismatch` test name + body to drop v1 state instead:

```ts
it("drops persisted v1 state on version mismatch", async () => {
  // Pre-populate localStorage with a v1 snapshot — must be discarded.
  localStorage.setItem(
    "modeldoctor-connections",
    JSON.stringify({
      state: {
        connections: [
          {
            id: "c-old",
            name: "old",
            apiBaseUrl: "http://old.example.com",
            apiKey: "k",
            model: "m",
            customHeaders: "",
            queryParams: "",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            // no category / no tags — v1 record
          },
        ],
      },
      version: 1,
    }),
  );

  vi.resetModules();
  const { useConnectionsStore: fresh } = await import("./connections-store");
  expect(fresh.getState().list()).toEqual([]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm -F @modeldoctor/web test --run src/stores/connections-store.test.ts
```

Expected: FAIL — store still on version 1, doesn't accept `category`/`tags`.

- [ ] **Step 3: Update the store**

Open `apps/web/src/stores/connections-store.ts`. Make these changes:

(a) Update `ConnectionsExport` import-or-redeclare to `version: 2`:

```ts
// `Connection` type already has category + tags from Task 2.
// `ConnectionsExport` already has version: 2 from Task 2 type update.
```

(b) Update `exportAll` to emit version 2 (it reads from `ConnectionsExport`'s type — should be a one-line literal):

```ts
exportAll: () => {
  const env: ConnectionsExport = {
    version: 2,
    connections: get().connections,
  };
  return JSON.stringify(env, null, 2);
},
```

(c) Update `importAll`'s parse + version check:

```ts
importAll: (json, mode) => {
  const parsed = JSON.parse(json) as ConnectionsExport;
  if (parsed.version !== 2) {
    throw new Error(`Unsupported export version: ${parsed.version}`);
  }
  // ... rest of body unchanged
},
```

(d) Bump persist version from 1 to 2 in the persist config at the bottom of the file:

```ts
{
  name: "modeldoctor-connections",
  version: 2, // bumped from 1; v1 (pre-category) data is dropped
  partialize: (state) => ({ connections: state.connections }),
},
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm -F @modeldoctor/web test --run src/stores/connections-store.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/stores/connections-store.ts apps/web/src/stores/connections-store.test.ts
git commit -m "$(cat <<'EOF'
feat(connections): bump store to v2 with category + tags fields

Category is required, so any v1 snapshot in localStorage is missing
the field and would fail validation downstream. Per CLAUDE.md
no-compat-shims policy, zustand persist version mismatch silently
discards old data; users re-create or re-import.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: ConnectionDialog — add category select + tag chip input

**Files:**
- Modify: `apps/web/src/features/connections/ConnectionDialog.tsx`
- Modify: `apps/web/src/locales/en-US/connections.json`
- Modify: `apps/web/src/locales/zh-CN/connections.json`
- Create: `apps/web/src/features/connections/ConnectionDialog.test.tsx`

- [ ] **Step 1: Add the i18n keys (en-US first)**

Open `apps/web/src/locales/en-US/connections.json` and add inside `dialog.fields`:

```json
"category": "Category",
"categoryHelp": "Used by the Playground to filter the connection picker.",
"tags": "Tags",
"tagsPlaceholder": "Type and press Enter (e.g. vLLM, production)",
"tagsHelp": "Optional. Used for grouping and quick filtering."
```

Add a sibling `categoryOptions` block under `dialog`:

```json
"categoryOptions": {
  "chat": "Chat",
  "audio": "Audio",
  "embeddings": "Embeddings",
  "rerank": "Rerank",
  "image": "Image"
}
```

Add at the top level of the file:

```json
"table": {
  ...existing keys,
  "category": "Category",
  "tags": "Tags"
}
```

(If `table` already exists, just add the two new keys.)

- [ ] **Step 2: Mirror the keys in zh-CN**

Open `apps/web/src/locales/zh-CN/connections.json` and add the same shape with Chinese text:

```json
"category": "分类",
"categoryHelp": "Playground 用它来过滤连接下拉。",
"tags": "标签",
"tagsPlaceholder": "输入后按回车（如 vLLM、production）",
"tagsHelp": "可选。用于分组和快速筛选。"
```

```json
"categoryOptions": {
  "chat": "对话",
  "audio": "语音",
  "embeddings": "嵌入",
  "rerank": "重排",
  "image": "图像"
}
```

```json
"table": {
  "category": "分类",
  "tags": "标签"
}
```

- [ ] **Step 3: Write the failing dialog tests**

Create `apps/web/src/features/connections/ConnectionDialog.test.tsx`:

```tsx
import "@/lib/i18n";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { useConnectionsStore } from "@/stores/connections-store";
import { ConnectionDialog } from "./ConnectionDialog";

function fillBaseFields(user: ReturnType<typeof userEvent.setup>) {
  return Promise.all([
    user.type(screen.getByLabelText(/^name$/i), "n1"),
    user.type(screen.getByLabelText(/api base url/i), "http://x.test"),
    user.type(screen.getByLabelText(/api key/i), "sk-1"),
    user.type(screen.getByLabelText(/^model$/i), "m1"),
  ]);
}

describe("ConnectionDialog (category + tags)", () => {
  beforeEach(() => {
    localStorage.clear();
    useConnectionsStore.setState({ connections: [] });
  });

  it("requires a category before save", async () => {
    const user = userEvent.setup();
    render(<ConnectionDialog open onOpenChange={() => {}} />);
    await fillBaseFields(user);
    await user.click(screen.getByRole("button", { name: /save|保存/i }));

    // The dialog should still be open because category is required.
    expect(screen.getByText(/category|分类/i)).toBeInTheDocument();
    expect(useConnectionsStore.getState().list()).toHaveLength(0);
  });

  it("creates a connection with selected category and entered tags", async () => {
    const user = userEvent.setup();
    render(<ConnectionDialog open onOpenChange={() => {}} />);
    await fillBaseFields(user);

    // Open category dropdown and pick "Chat"
    await user.click(screen.getByRole("combobox", { name: /category|分类/i }));
    await user.click(screen.getByRole("option", { name: /^chat$|^对话$/i }));

    // Add two tags
    const tagInput = screen.getByPlaceholderText(/vLLM/i);
    await user.type(tagInput, "vLLM{Enter}");
    await user.type(tagInput, "production{Enter}");

    await user.click(screen.getByRole("button", { name: /save|保存/i }));

    await waitFor(() => {
      const list = useConnectionsStore.getState().list();
      expect(list).toHaveLength(1);
      expect(list[0].category).toBe("chat");
      expect(list[0].tags).toEqual(["vLLM", "production"]);
    });
  });

  it("removing a chip drops the tag", async () => {
    const user = userEvent.setup();
    render(<ConnectionDialog open onOpenChange={() => {}} />);
    const tagInput = screen.getByPlaceholderText(/vLLM/i);
    await user.type(tagInput, "x{Enter}");
    await user.type(tagInput, "y{Enter}");

    await user.click(screen.getByRole("button", { name: /remove tag x|移除标签 x/i }));

    expect(screen.queryByText("x")).not.toBeInTheDocument();
    expect(screen.getByText("y")).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

```bash
pnpm -F @modeldoctor/web test --run src/features/connections/ConnectionDialog.test.tsx
```

Expected: FAIL — UI lacks category + tags fields.

- [ ] **Step 5: Update `ConnectionDialog.tsx` — add category Select + tags chip input**

Edit `apps/web/src/features/connections/ConnectionDialog.tsx`:

(a) Add imports:

```tsx
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ModalityCategory } from "@modeldoctor/contracts";
import { Controller } from "react-hook-form";
import { X as XIcon } from "lucide-react";
```

(b) Update the `empty` constant to include the new fields:

```tsx
const empty: ConnectionInput = {
  name: "",
  apiBaseUrl: "",
  apiKey: "",
  model: "",
  customHeaders: "",
  queryParams: "",
  category: "chat",
  tags: [],
};
```

(c) Add a constant for category options near the top of the file (outside the component):

```tsx
const CATEGORIES: ModalityCategory[] = ["chat", "audio", "embeddings", "rerank", "image"];
const PRESET_TAGS = [
  "vLLM",
  "SGLang",
  "TGI",
  "Ollama",
  "OpenAI",
  "Anthropic",
  "multimodal",
  "streaming",
  "production",
  "test",
];
```

(d) Inside the component, near `useState` calls, add:

```tsx
const [tagDraft, setTagDraft] = useState("");
```

(e) Inside the `<form>` JSX, AFTER the `model` field's `</div>` and BEFORE the `customHeaders` field, insert:

```tsx
<div>
  <Label htmlFor="category">{t("dialog.fields.category")}</Label>
  <Controller
    control={form.control}
    name="category"
    render={({ field }) => (
      <Select value={field.value} onValueChange={field.onChange}>
        <SelectTrigger id="category" aria-label={t("dialog.fields.category")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CATEGORIES.map((c) => (
            <SelectItem key={c} value={c}>
              {t(`dialog.categoryOptions.${c}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )}
  />
  <p className="mt-1 text-xs text-muted-foreground">{t("dialog.fields.categoryHelp")}</p>
</div>

<div>
  <Label htmlFor="tags">{t("dialog.fields.tags")}</Label>
  <Controller
    control={form.control}
    name="tags"
    render={({ field }) => {
      const current = field.value ?? [];
      const tryAdd = (raw: string) => {
        const trimmed = raw.trim();
        if (!trimmed) return;
        if (current.includes(trimmed)) return;
        field.onChange([...current, trimmed]);
      };
      const remove = (tag: string) => field.onChange(current.filter((t: string) => t !== tag));
      const suggestions = PRESET_TAGS.filter((p) => !current.includes(p));
      return (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1">
            {current.map((tag: string) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs"
              >
                {tag}
                <button
                  type="button"
                  aria-label={t("dialog.fields.tagsRemove", { tag, defaultValue: `Remove tag ${tag}` })}
                  onClick={() => remove(tag)}
                >
                  <XIcon className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
          <Input
            id="tags"
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                tryAdd(tagDraft);
                setTagDraft("");
              }
            }}
            placeholder={t("dialog.fields.tagsPlaceholder")}
          />
          {suggestions.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {suggestions.slice(0, 8).map((s) => (
                <button
                  type="button"
                  key={s}
                  onClick={() => tryAdd(s)}
                  className="rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent/40"
                >
                  + {s}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      );
    }}
  />
  <p className="mt-1 text-xs text-muted-foreground">{t("dialog.fields.tagsHelp")}</p>
</div>
```

Add the `tagsRemove` key to both locale files:

`en-US/connections.json` → `dialog.fields.tagsRemove`: `"Remove tag {{tag}}"`

`zh-CN/connections.json` → `dialog.fields.tagsRemove`: `"移除标签 {{tag}}"`

(f) **No change** to `onSubmit` — `react-hook-form` will already include `category` and `tags` since they are registered via `Controller`.

- [ ] **Step 6: Run the dialog tests to verify they pass**

```bash
pnpm -F @modeldoctor/web test --run src/features/connections/ConnectionDialog.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/connections/ConnectionDialog.tsx apps/web/src/features/connections/ConnectionDialog.test.tsx apps/web/src/locales/en-US/connections.json apps/web/src/locales/zh-CN/connections.json
git commit -m "$(cat <<'EOF'
feat(web/connections): category select + tag chips in dialog

Required-Select for category (5 options) and chip-input for tags with
preset suggestions (vLLM, SGLang, …). Tags trim/dedupe at the schema
layer (Task 2).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: ConnectionsPage — show category badge + tag chips, with header filters

**Files:**
- Modify: `apps/web/src/features/connections/ConnectionsPage.tsx`
- Modify: `apps/web/src/locales/en-US/connections.json`
- Modify: `apps/web/src/locales/zh-CN/connections.json`
- Create: `apps/web/src/features/connections/ConnectionsPage.test.tsx`

- [ ] **Step 1: Add filter-strip i18n keys**

Add to `en-US/connections.json` at top level:

```json
"filters": {
  "label": "Filter",
  "allCategories": "All categories",
  "allTags": "All tags",
  "clear": "Clear filters"
}
```

Mirror to zh-CN:

```json
"filters": {
  "label": "筛选",
  "allCategories": "全部分类",
  "allTags": "全部标签",
  "clear": "清除筛选"
}
```

- [ ] **Step 2: Write the failing list test**

Create `apps/web/src/features/connections/ConnectionsPage.test.tsx`:

```tsx
import "@/lib/i18n";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { useConnectionsStore } from "@/stores/connections-store";
import { ConnectionsPage } from "./ConnectionsPage";

function seed() {
  const s = useConnectionsStore.getState();
  s.create({
    name: "chat-prod",
    apiBaseUrl: "http://a",
    apiKey: "k",
    model: "qwen",
    customHeaders: "",
    queryParams: "",
    category: "chat",
    tags: ["vLLM", "production"],
  });
  s.create({
    name: "embed-test",
    apiBaseUrl: "http://b",
    apiKey: "k",
    model: "bge",
    customHeaders: "",
    queryParams: "",
    category: "embeddings",
    tags: ["TEI"],
  });
}

describe("ConnectionsPage (category + tags)", () => {
  beforeEach(() => {
    localStorage.clear();
    useConnectionsStore.setState({ connections: [] });
  });

  it("renders category badge and tag chips for each row", () => {
    seed();
    render(
      <MemoryRouter>
        <ConnectionsPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("chat-prod")).toBeInTheDocument();
    expect(screen.getByText("embed-test")).toBeInTheDocument();
    expect(screen.getByText("vLLM")).toBeInTheDocument();
    expect(screen.getByText("TEI")).toBeInTheDocument();
  });

  it("filtering by category hides non-matching rows", async () => {
    const user = userEvent.setup();
    seed();
    render(
      <MemoryRouter>
        <ConnectionsPage />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("combobox", { name: /category|分类/i }));
    await user.click(screen.getByRole("option", { name: /^chat$|^对话$/i }));

    expect(screen.getByText("chat-prod")).toBeInTheDocument();
    expect(screen.queryByText("embed-test")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
pnpm -F @modeldoctor/web test --run src/features/connections/ConnectionsPage.test.tsx
```

Expected: FAIL — table doesn't render category/tags yet.

- [ ] **Step 4: Update `ConnectionsPage.tsx` to render the new columns and filter state**

Open `apps/web/src/features/connections/ConnectionsPage.tsx`. Add imports + filter state + filtered list + new table columns:

(a) Add to imports:

```tsx
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ModalityCategory } from "@modeldoctor/contracts";
```

(b) Inside the component, add filter state above the existing dialog state:

```tsx
const [filterCategory, setFilterCategory] = useState<ModalityCategory | "all">("all");
const [filterTag, setFilterTag] = useState<string | "all">("all");

const allTags = Array.from(new Set(list.flatMap((c) => c.tags))).sort();

const filtered = list.filter((c) => {
  if (filterCategory !== "all" && c.category !== filterCategory) return false;
  if (filterTag !== "all" && !c.tags.includes(filterTag)) return false;
  return true;
});
```

(c) Replace the `list.map` body inside the `TableBody` with `filtered.map(...)`.

(d) Insert the filter strip BEFORE the `<Table>` element:

```tsx
<div className="mb-3 flex items-center gap-2">
  <span className="text-xs text-muted-foreground">{t("filters.label")}:</span>
  <Select value={filterCategory} onValueChange={(v) => setFilterCategory(v as ModalityCategory | "all")}>
    <SelectTrigger className="h-8 w-40 text-xs" aria-label={t("dialog.fields.category")}>
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="all">{t("filters.allCategories")}</SelectItem>
      {(["chat", "audio", "embeddings", "rerank", "image"] as ModalityCategory[]).map((c) => (
        <SelectItem key={c} value={c}>{t(`dialog.categoryOptions.${c}`)}</SelectItem>
      ))}
    </SelectContent>
  </Select>
  <Select value={filterTag} onValueChange={setFilterTag}>
    <SelectTrigger className="h-8 w-40 text-xs" aria-label={t("dialog.fields.tags")}>
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="all">{t("filters.allTags")}</SelectItem>
      {allTags.map((tag) => (
        <SelectItem key={tag} value={tag}>{tag}</SelectItem>
      ))}
    </SelectContent>
  </Select>
</div>
```

(e) Add new `<TableHead>` cells for `category` and `tags` BEFORE `customHeaders`:

```tsx
<TableHead>{t("table.category")}</TableHead>
<TableHead>{t("table.tags")}</TableHead>
```

(f) Add corresponding `<TableCell>` rendering inside the row body, matching column position:

```tsx
<TableCell>
  <Badge variant="outline" className="text-xs">
    {t(`dialog.categoryOptions.${c.category}`)}
  </Badge>
</TableCell>
<TableCell>
  <div className="flex flex-wrap gap-1">
    {c.tags.map((tag) => (
      <span key={tag} className="rounded-full bg-secondary px-2 py-0.5 text-[10px]">
        {tag}
      </span>
    ))}
  </div>
</TableCell>
```

- [ ] **Step 5: Run the page test**

```bash
pnpm -F @modeldoctor/web test --run src/features/connections/ConnectionsPage.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/connections/ConnectionsPage.tsx apps/web/src/features/connections/ConnectionsPage.test.tsx apps/web/src/locales/en-US/connections.json apps/web/src/locales/zh-CN/connections.json
git commit -m "$(cat <<'EOF'
feat(web/connections): table columns + filter strip for category and tags

Adds two columns (Category badge, Tags chip strip) and a header filter
strip with two Select dropdowns. Tag dropdown auto-collects every tag
from the current connection list.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Playground i18n namespace + sidebar group + routes (placeholders for non-chat modalities)

**Files:**
- Create: `apps/web/src/locales/en-US/playground.json`
- Create: `apps/web/src/locales/zh-CN/playground.json`
- Modify: `apps/web/src/lib/i18n.ts`
- Modify: `apps/web/src/locales/en-US/sidebar.json`
- Modify: `apps/web/src/locales/zh-CN/sidebar.json`
- Modify: `apps/web/src/components/sidebar/sidebar-config.tsx`
- Modify: `apps/web/src/router/index.tsx`

- [ ] **Step 1: Create `playground.json` (en-US) with the Phase 1 chat-only structure**

Create `apps/web/src/locales/en-US/playground.json`:

```json
{
  "title": "Playground",
  "categories": {
    "chat": "Chat",
    "audio": "Audio",
    "embeddings": "Embeddings",
    "rerank": "Rerank",
    "image": "Image"
  },
  "endpoint": {
    "categoryFilter": "Category filter",
    "showAll": "Show all",
    "categoryMismatch": "Selected connection's category ({{category}}) doesn't match this page",
    "clearSelection": "Clear",
    "noMatchingConnections": "No {{category}} connections yet",
    "newConnection": "+ New connection"
  },
  "chat": {
    "title": "Chat",
    "subtitle": "Send a single message to a chat-completions endpoint and see the reply.",
    "system": {
      "label": "System message",
      "placeholder": "Optional. e.g. You are a helpful assistant."
    },
    "composer": {
      "placeholder": "Type your message…",
      "send": "Send",
      "sending": "Sending…",
      "needConnection": "Pick a chat connection first"
    },
    "messages": {
      "system": "system",
      "user": "user",
      "assistant": "assistant",
      "empty": "Send a message to get started."
    },
    "params": {
      "title": "Parameters",
      "temperature": "Temperature",
      "maxTokens": "Max Tokens",
      "topP": "Top P",
      "frequencyPenalty": "Frequency Penalty",
      "presencePenalty": "Presence Penalty",
      "seed": "Seed",
      "stop": "Stop Sequence",
      "stream": "Stream (Phase 2)"
    },
    "errors": {
      "send": "Failed to send: {{message}}"
    }
  },
  "comingSoon": {
    "title": "Coming in Phase {{phase}}",
    "body": "This modality is part of the Playground roadmap but isn't built yet."
  }
}
```

- [ ] **Step 2: Create the zh-CN mirror**

Create `apps/web/src/locales/zh-CN/playground.json`:

```json
{
  "title": "试验场",
  "categories": {
    "chat": "对话",
    "audio": "语音",
    "embeddings": "嵌入",
    "rerank": "重排",
    "image": "图像"
  },
  "endpoint": {
    "categoryFilter": "分类过滤",
    "showAll": "显示全部",
    "categoryMismatch": "当前连接是 {{category}} 类，与本页不符",
    "clearSelection": "清除",
    "noMatchingConnections": "暂无 {{category}} 类连接",
    "newConnection": "+ 新建连接"
  },
  "chat": {
    "title": "对话",
    "subtitle": "向 chat-completions 接口发送一条消息，查看回复。",
    "system": {
      "label": "系统消息",
      "placeholder": "可选。如：你是一个有帮助的助手。"
    },
    "composer": {
      "placeholder": "输入消息…",
      "send": "发送",
      "sending": "发送中…",
      "needConnection": "请先选择一个对话类连接"
    },
    "messages": {
      "system": "系统",
      "user": "用户",
      "assistant": "助手",
      "empty": "发送一条消息开始对话。"
    },
    "params": {
      "title": "参数",
      "temperature": "Temperature",
      "maxTokens": "Max Tokens",
      "topP": "Top P",
      "frequencyPenalty": "Frequency Penalty",
      "presencePenalty": "Presence Penalty",
      "seed": "Seed",
      "stop": "停止序列",
      "stream": "流式 (Phase 2)"
    },
    "errors": {
      "send": "发送失败：{{message}}"
    }
  },
  "comingSoon": {
    "title": "Phase {{phase}} 推出",
    "body": "本模态在 Playground 路线图中，但还没实现。"
  }
}
```

- [ ] **Step 3: Register the new namespace in `i18n.ts`**

Open `apps/web/src/lib/i18n.ts`. Add imports:

```ts
import enPlayground from "@/locales/en-US/playground.json";
import zhPlayground from "@/locales/zh-CN/playground.json";
```

Add `playground: enPlayground` to the `en-US` resources object and `playground: zhPlayground` to the `zh-CN` resources object. Add `"playground"` to the `ns` array.

- [ ] **Step 4: Add sidebar group label + 5 item labels (en-US then zh-CN)**

Open `apps/web/src/locales/en-US/sidebar.json`. Add inside `groups`:

```json
"playground": "Playground"
```

Add inside `items`:

```json
"playgroundChat": "Chat",
"playgroundImage": "Image",
"playgroundAudio": "Audio",
"playgroundEmbeddings": "Embeddings",
"playgroundRerank": "Rerank"
```

Mirror in `zh-CN/sidebar.json`:

```json
"playground": "试验场"
```

```json
"playgroundChat": "对话",
"playgroundImage": "图像",
"playgroundAudio": "语音",
"playgroundEmbeddings": "嵌入",
"playgroundRerank": "重排"
```

- [ ] **Step 5: Update `sidebar-config.tsx` to insert the playground group at the top**

Open `apps/web/src/components/sidebar/sidebar-config.tsx`. Add icon imports (use lucide icons that are already available or compatible — `MessageSquare`, `Image`, `Mic`, `Boxes`, `ListOrdered`):

```tsx
import { Boxes, Image as ImageIcon, ListOrdered, MessageSquare, Mic } from "lucide-react";
```

Then prepend a new group BEFORE the `performance` group in the `sidebarGroups` array:

```tsx
{
  id: "playground",
  labelKey: "groups.playground",
  items: [
    { to: "/playground/chat", icon: MessageSquare, labelKey: "items.playgroundChat" },
    { to: "/playground/image", icon: ImageIcon, labelKey: "items.playgroundImage", comingSoon: true },
    { to: "/playground/audio", icon: Mic, labelKey: "items.playgroundAudio", comingSoon: true },
    { to: "/playground/embeddings", icon: Boxes, labelKey: "items.playgroundEmbeddings", comingSoon: true },
    { to: "/playground/rerank", icon: ListOrdered, labelKey: "items.playgroundRerank", comingSoon: true },
  ],
},
```

- [ ] **Step 6: Add the `/playground` routes to `router/index.tsx`**

Open `apps/web/src/router/index.tsx`. Add the `Navigate` already imported is fine. Add an import:

```tsx
// Placeholder — ChatPage is created in Task 13.
// Use a tiny inline stub here so the route resolves; we'll swap it.
```

Actually the cleanest path: create the file `apps/web/src/features/playground/chat/ChatPage.tsx` as a one-liner stub now, and fully implement it in Task 13. Insert the stub:

```tsx
// apps/web/src/features/playground/chat/ChatPage.tsx (Task 6 stub — replaced in Task 13)
import { PageHeader } from "@/components/common/page-header";
import { useTranslation } from "react-i18next";

export function ChatPage() {
  const { t } = useTranslation("playground");
  return (
    <>
      <PageHeader title={t("chat.title")} subtitle={t("chat.subtitle")} />
      <div className="px-8 py-6 text-sm text-muted-foreground">Stub — built in Task 13.</div>
    </>
  );
}
```

Add the route children, BEFORE the `path: "*"` catch-all:

```tsx
{ path: "playground", element: <Navigate to="/playground/chat" replace /> },
{ path: "playground/chat", element: <ChatPage /> },
{
  path: "playground/image",
  element: <ComingSoonRoute icon={ImageIcon} itemKey="playgroundImage" />,
},
{
  path: "playground/audio",
  element: <ComingSoonRoute icon={Mic} itemKey="playgroundAudio" />,
},
{
  path: "playground/embeddings",
  element: <ComingSoonRoute icon={Boxes} itemKey="playgroundEmbeddings" />,
},
{
  path: "playground/rerank",
  element: <ComingSoonRoute icon={ListOrdered} itemKey="playgroundRerank" />,
},
```

Add the corresponding imports at the top of `router/index.tsx`:

```tsx
import { ChatPage } from "@/features/playground/chat/ChatPage";
import { Boxes, Image as ImageIcon, ListOrdered, Mic } from "lucide-react";
```

(MessageSquare not needed in router since chat has no ComingSoonRoute.)

- [ ] **Step 7: Verify the dev server boots and the route resolves**

```bash
pnpm -F @modeldoctor/web type-check
pnpm -F @modeldoctor/web test --run
```

Expected: type-check clean; existing tests still pass. Manual smoke (optional but encouraged):

```bash
pnpm -F @modeldoctor/web dev
```

Then open `http://localhost:5173/playground/chat` and confirm the stub page renders with title "Chat" and the sidebar shows the new "Playground" group with 5 items.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/locales/en-US/playground.json apps/web/src/locales/zh-CN/playground.json apps/web/src/lib/i18n.ts apps/web/src/locales/en-US/sidebar.json apps/web/src/locales/zh-CN/sidebar.json apps/web/src/components/sidebar/sidebar-config.tsx apps/web/src/router/index.tsx apps/web/src/features/playground/chat/ChatPage.tsx
git commit -m "$(cat <<'EOF'
feat(web/playground): scaffold sidebar group, routes, and i18n namespace

New top-level "Playground" group above Performance, with chat live and
the other four modalities marked coming-soon. Adds the playground i18n
namespace (en + zh) covering Phase 1 chat copy. ChatPage is a stub
that is replaced by the real implementation in Task 13.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `PlaygroundShell` + `ParamsPanel` shared layout components

**Files:**
- Create: `apps/web/src/features/playground/PlaygroundShell.tsx`
- Create: `apps/web/src/features/playground/ParamsPanel.tsx`
- Create: `apps/web/src/features/playground/PlaygroundShell.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/features/playground/PlaygroundShell.test.tsx`:

```tsx
import "@/lib/i18n";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PlaygroundShell } from "./PlaygroundShell";

describe("PlaygroundShell", () => {
  it("renders main content and params slot side by side", () => {
    render(
      <PlaygroundShell category="chat" paramsSlot={<div>params-here</div>}>
        <div>main-here</div>
      </PlaygroundShell>,
    );
    expect(screen.getByText("main-here")).toBeInTheDocument();
    expect(screen.getByText("params-here")).toBeInTheDocument();
  });

  it("renders tabs and calls onTabChange when clicked", async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();
    render(
      <PlaygroundShell
        category="chat"
        tabs={[
          { key: "single", label: "Single" },
          { key: "compare", label: "Compare" },
        ]}
        activeTab="single"
        onTabChange={onTabChange}
        paramsSlot={null}
      >
        <div />
      </PlaygroundShell>,
    );
    await user.click(screen.getByRole("button", { name: "Compare" }));
    expect(onTabChange).toHaveBeenCalledWith("compare");
  });

  it("collapse button hides the params panel", async () => {
    const user = userEvent.setup();
    render(
      <PlaygroundShell category="chat" paramsSlot={<div>panel-x</div>}>
        <div />
      </PlaygroundShell>,
    );
    expect(screen.getByText("panel-x")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /collapse|折叠/i }));
    expect(screen.queryByText("panel-x")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
pnpm -F @modeldoctor/web test --run src/features/playground/PlaygroundShell.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ParamsPanel.tsx`**

Create `apps/web/src/features/playground/ParamsPanel.tsx`:

```tsx
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface ParamsPanelProps {
  open: boolean;
  children: ReactNode;
}

export function ParamsPanel({ open, children }: ParamsPanelProps) {
  if (!open) return null;
  return (
    <aside
      className={cn(
        "w-80 shrink-0 overflow-y-auto border-l border-border bg-card",
        "px-4 py-4",
      )}
    >
      {children}
    </aside>
  );
}
```

- [ ] **Step 4: Implement `PlaygroundShell.tsx`**

Create `apps/web/src/features/playground/PlaygroundShell.tsx`:

```tsx
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ModalityCategory } from "@modeldoctor/contracts";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { ParamsPanel } from "./ParamsPanel";

export interface PlaygroundShellProps {
  category: ModalityCategory;
  tabs?: Array<{ key: string; label: string }>;
  activeTab?: string;
  onTabChange?: (k: string) => void;
  paramsSlot: ReactNode;
  rightPanelDefaultOpen?: boolean;
  children: ReactNode;
}

export function PlaygroundShell({
  tabs,
  activeTab,
  onTabChange,
  paramsSlot,
  rightPanelDefaultOpen = true,
  children,
}: PlaygroundShellProps) {
  const { t: tc } = useTranslation("common");
  const [panelOpen, setPanelOpen] = useState(rightPanelDefaultOpen);

  return (
    <div className="flex h-[calc(100vh-0px)] min-h-0 flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 py-3">
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
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setPanelOpen((v) => !v)}
          aria-label={panelOpen ? tc("sidebar.collapse", { defaultValue: "Collapse" }) : tc("sidebar.expand", { defaultValue: "Expand" })}
        >
          {panelOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
        </Button>
      </header>
      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
        <ParamsPanel open={panelOpen}>{paramsSlot}</ParamsPanel>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm -F @modeldoctor/web test --run src/features/playground/PlaygroundShell.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/playground/PlaygroundShell.tsx apps/web/src/features/playground/ParamsPanel.tsx apps/web/src/features/playground/PlaygroundShell.test.tsx
git commit -m "$(cat <<'EOF'
feat(web/playground): PlaygroundShell + ParamsPanel layout primitives

Shared layout for all 5 modality sub-pages: header (optional tabs +
collapse-panel button), main slot, right ParamsPanel. The panel can
collapse to give the main area more room.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `CategoryEndpointSelector` — connection picker filtered by category

**Files:**
- Create: `apps/web/src/features/playground/CategoryEndpointSelector.tsx`
- Create: `apps/web/src/features/playground/CategoryEndpointSelector.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/features/playground/CategoryEndpointSelector.test.tsx`:

```tsx
import "@/lib/i18n";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConnectionsStore } from "@/stores/connections-store";
import { CategoryEndpointSelector } from "./CategoryEndpointSelector";

function seed() {
  const s = useConnectionsStore.getState();
  s.create({
    name: "chat-A",
    apiBaseUrl: "http://a",
    apiKey: "k",
    model: "m",
    customHeaders: "",
    queryParams: "",
    category: "chat",
    tags: [],
  });
  s.create({
    name: "embed-B",
    apiBaseUrl: "http://b",
    apiKey: "k",
    model: "m",
    customHeaders: "",
    queryParams: "",
    category: "embeddings",
    tags: [],
  });
}

describe("CategoryEndpointSelector", () => {
  beforeEach(() => {
    localStorage.clear();
    useConnectionsStore.setState({ connections: [] });
  });

  it("only lists connections of the matching category by default", async () => {
    const user = userEvent.setup();
    seed();
    render(
      <CategoryEndpointSelector
        category="chat"
        selectedConnectionId={null}
        onSelect={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("combobox"));
    expect(screen.getByRole("option", { name: /chat-A/i })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /embed-B/i })).not.toBeInTheDocument();
  });

  it("show-all toggle reveals all connections", async () => {
    const user = userEvent.setup();
    seed();
    render(
      <CategoryEndpointSelector
        category="chat"
        selectedConnectionId={null}
        onSelect={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("checkbox", { name: /show all|显示全部/i }));
    await user.click(screen.getByRole("combobox"));
    expect(screen.getByRole("option", { name: /chat-A/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /embed-B/i })).toBeInTheDocument();
  });

  it("warns when selected connection's category mismatches", () => {
    seed();
    const embedId = useConnectionsStore.getState().list().find((c) => c.name === "embed-B")!.id;
    render(
      <CategoryEndpointSelector
        category="chat"
        selectedConnectionId={embedId}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText(/doesn't match|不符/i)).toBeInTheDocument();
  });

  it("emits onSelect with the picked connection id", async () => {
    const user = userEvent.setup();
    seed();
    const onSelect = vi.fn();
    render(
      <CategoryEndpointSelector
        category="chat"
        selectedConnectionId={null}
        onSelect={onSelect}
      />,
    );
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: /chat-A/i }));
    const expectedId = useConnectionsStore.getState().list().find((c) => c.name === "chat-A")!.id;
    expect(onSelect).toHaveBeenCalledWith(expectedId);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm -F @modeldoctor/web test --run src/features/playground/CategoryEndpointSelector.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `CategoryEndpointSelector.tsx`**

Create `apps/web/src/features/playground/CategoryEndpointSelector.tsx`:

```tsx
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConnectionsStore } from "@/stores/connections-store";
import type { ModalityCategory } from "@modeldoctor/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export interface CategoryEndpointSelectorProps {
  category: ModalityCategory;
  selectedConnectionId: string | null;
  onSelect: (id: string | null) => void;
}

export function CategoryEndpointSelector({
  category,
  selectedConnectionId,
  onSelect,
}: CategoryEndpointSelectorProps) {
  const { t } = useTranslation("playground");
  const { t: tc } = useTranslation("connections");
  const list = useConnectionsStore((s) => s.list());
  const [showAll, setShowAll] = useState(false);

  const visible = showAll ? list : list.filter((c) => c.category === category);
  const selected = selectedConnectionId
    ? list.find((c) => c.id === selectedConnectionId) ?? null
    : null;
  const mismatched = selected && selected.category !== category;
  const showAllId = "playground-show-all-connections";

  return (
    <div className="space-y-2">
      <Select
        value={selectedConnectionId ?? ""}
        onValueChange={(v) => onSelect(v || null)}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder={t("endpoint.noMatchingConnections", {
            category: tc(`dialog.categoryOptions.${category}`),
          })} />
        </SelectTrigger>
        <SelectContent>
          {visible.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              {t("endpoint.noMatchingConnections", {
                category: tc(`dialog.categoryOptions.${category}`),
              })}
            </div>
          ) : (
            visible.map((c) => (
              <SelectItem
                key={c.id}
                value={c.id}
                className={c.category !== category ? "opacity-60" : ""}
              >
                {c.name}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>

      <label htmlFor={showAllId} className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          id={showAllId}
          type="checkbox"
          checked={showAll}
          onChange={(e) => setShowAll(e.target.checked)}
        />
        {t("endpoint.showAll")}
      </label>

      {mismatched ? (
        <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-xs text-warning-foreground">
          <span>
            {t("endpoint.categoryMismatch", {
              category: tc(`dialog.categoryOptions.${selected!.category}`),
            })}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            onClick={() => onSelect(null)}
          >
            {t("endpoint.clearSelection")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm -F @modeldoctor/web test --run src/features/playground/CategoryEndpointSelector.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/playground/CategoryEndpointSelector.tsx apps/web/src/features/playground/CategoryEndpointSelector.test.tsx
git commit -m "$(cat <<'EOF'
feat(web/playground): CategoryEndpointSelector with show-all + mismatch warn

Connection picker that defaults to category-filtered, with a "show all"
toggle for multi-modal endpoints and a warning chip when the currently
selected connection's category doesn't match the page.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Playground contracts (chat request + response + message schemas)

**Files:**
- Create: `packages/contracts/src/playground.ts`
- Create: `packages/contracts/src/playground.test.ts`
- Modify: `packages/contracts/src/index.ts`

- [ ] **Step 1: Write the failing schema tests**

Create `packages/contracts/src/playground.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  ChatMessageSchema,
  PlaygroundChatRequestSchema,
  PlaygroundChatResponseSchema,
} from "./playground.js";

describe("ChatMessageSchema", () => {
  it("accepts a string-content message", () => {
    expect(() =>
      ChatMessageSchema.parse({ role: "user", content: "hello" }),
    ).not.toThrow();
  });

  it("accepts a content-parts array with text + image_url", () => {
    expect(() =>
      ChatMessageSchema.parse({
        role: "user",
        content: [
          { type: "text", text: "what is in this image?" },
          { type: "image_url", image_url: { url: "data:image/png;base64,iVB..." } },
        ],
      }),
    ).not.toThrow();
  });

  it("rejects an unknown role", () => {
    expect(() =>
      ChatMessageSchema.parse({ role: "tool", content: "hi" }),
    ).toThrow();
  });
});

describe("PlaygroundChatRequestSchema", () => {
  const base = {
    apiBaseUrl: "http://x.test",
    apiKey: "k",
    model: "m",
    messages: [{ role: "user", content: "hi" }],
  };

  it("accepts a minimal request", () => {
    expect(() => PlaygroundChatRequestSchema.parse(base)).not.toThrow();
  });

  it("requires at least one message", () => {
    expect(() =>
      PlaygroundChatRequestSchema.parse({ ...base, messages: [] }),
    ).toThrow();
  });

  it("defaults params to an empty object", () => {
    const out = PlaygroundChatRequestSchema.parse(base);
    expect(out.params).toEqual({});
  });
});

describe("PlaygroundChatResponseSchema", () => {
  it("accepts the OK shape", () => {
    expect(() =>
      PlaygroundChatResponseSchema.parse({
        success: true,
        content: "hi back",
        latencyMs: 123,
      }),
    ).not.toThrow();
  });

  it("accepts an error shape", () => {
    expect(() =>
      PlaygroundChatResponseSchema.parse({
        success: false,
        error: "upstream 500",
        latencyMs: 50,
      }),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
pnpm -F @modeldoctor/contracts test --run src/playground.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `playground.ts` schemas**

Create `packages/contracts/src/playground.ts`:

```ts
import { z } from "zod";

/**
 * OpenAI-compatible chat message. Content is either a plain string OR an
 * array of typed content parts (used for multimodal — image_url, input_audio
 * — added in Phase 2).
 */
export const ChatMessageContentPartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("image_url"),
    image_url: z.object({ url: z.string() }),
  }),
  z.object({
    type: z.literal("input_audio"),
    input_audio: z.object({ data: z.string(), format: z.string() }),
  }),
]);

export const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.union([z.string(), z.array(ChatMessageContentPartSchema)]),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ChatParamsSchema = z
  .object({
    temperature: z.number().optional(),
    maxTokens: z.number().int().positive().optional(),
    topP: z.number().optional(),
    frequencyPenalty: z.number().optional(),
    presencePenalty: z.number().optional(),
    seed: z.number().int().optional(),
    stop: z.array(z.string()).optional(),
    stream: z.boolean().optional(),
  })
  .partial();
export type ChatParams = z.infer<typeof ChatParamsSchema>;

export const PlaygroundChatRequestSchema = z.object({
  apiBaseUrl: z.string().min(1),
  apiKey: z.string().min(1),
  model: z.string().min(1),
  customHeaders: z.string().optional(),
  queryParams: z.string().optional(),
  /** Override the default `/v1/chat/completions` path tail. */
  pathOverride: z.string().optional(),
  messages: z.array(ChatMessageSchema).min(1),
  params: ChatParamsSchema.default({}),
});
export type PlaygroundChatRequest = z.infer<typeof PlaygroundChatRequestSchema>;

export const PlaygroundChatResponseSchema = z.object({
  success: z.boolean(),
  /** Assistant's reply text. Present iff success === true. */
  content: z.string().optional(),
  /** Error message. Present iff success === false. */
  error: z.string().optional(),
  /** End-to-end wall-clock duration of the upstream call. */
  latencyMs: z.number(),
  /** Raw OpenAI usage block (if returned). */
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
      total_tokens: z.number().optional(),
    })
    .optional(),
});
export type PlaygroundChatResponse = z.infer<typeof PlaygroundChatResponseSchema>;
```

- [ ] **Step 4: Re-export from `index.ts`**

Add to `packages/contracts/src/index.ts`:

```ts
export * from "./playground.js";
```

- [ ] **Step 5: Run tests + build to verify**

```bash
pnpm -F @modeldoctor/contracts test --run
pnpm -F @modeldoctor/contracts build
```

Expected: ALL PASS, clean build.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/playground.ts packages/contracts/src/playground.test.ts packages/contracts/src/index.ts
git commit -m "$(cat <<'EOF'
feat(contracts): playground chat request/response + message schemas

Wire shape for POST /api/playground/chat (Phase 1, non-streaming).
ChatMessageContentPartSchema covers text + image_url + input_audio so
Phase 2 multimodal Chat doesn't need another schema bump.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Backend `PlaygroundModule` + `ChatController` + `ChatService` (non-streaming)

**Files:**
- Create: `apps/api/src/modules/playground/playground.module.ts`
- Create: `apps/api/src/modules/playground/chat.controller.ts`
- Create: `apps/api/src/modules/playground/chat.service.ts`
- Create: `apps/api/src/modules/playground/chat.service.spec.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Write the failing service test**

Create `apps/api/src/modules/playground/chat.service.spec.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatService } from "./chat.service.js";

describe("ChatService.run", () => {
  let svc: ChatService;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    svc = new ChatService();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to {apiBaseUrl}/v1/chat/completions with Bearer auth and OpenAI body shape", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "hello back", role: "assistant" } }],
          usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const out = await svc.run({
      apiBaseUrl: "http://upstream.test",
      apiKey: "sk-1",
      model: "m1",
      messages: [{ role: "user", content: "hello" }],
      params: {},
    });

    expect(out.success).toBe(true);
    expect(out.content).toBe("hello back");
    expect(out.usage?.total_tokens).toBe(12);
    expect(out.latencyMs).toBeGreaterThanOrEqual(0);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://upstream.test/v1/chat/completions");
    expect((init as RequestInit).method).toBe("POST");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer sk-1");
    expect(headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe("m1");
    expect(body.messages).toEqual([{ role: "user", content: "hello" }]);
  });

  it("honours pathOverride", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }),
    );
    await svc.run({
      apiBaseUrl: "http://x",
      apiKey: "k",
      model: "m",
      pathOverride: "/custom/chat",
      messages: [{ role: "user", content: "h" }],
      params: {},
    });
    expect(fetchMock.mock.calls[0][0]).toBe("http://x/custom/chat");
  });

  it("maps OpenAI-style snake_case params from camelCase", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }),
    );
    await svc.run({
      apiBaseUrl: "http://x",
      apiKey: "k",
      model: "m",
      messages: [{ role: "user", content: "h" }],
      params: {
        temperature: 0.7,
        maxTokens: 256,
        topP: 0.9,
        frequencyPenalty: 0.1,
        presencePenalty: 0.2,
        seed: 42,
        stop: ["</s>"],
      },
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.temperature).toBe(0.7);
    expect(body.max_tokens).toBe(256);
    expect(body.top_p).toBe(0.9);
    expect(body.frequency_penalty).toBe(0.1);
    expect(body.presence_penalty).toBe(0.2);
    expect(body.seed).toBe(42);
    expect(body.stop).toEqual(["</s>"]);
  });

  it("merges customHeaders (newline-delimited 'K: v' pairs)", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }),
    );
    await svc.run({
      apiBaseUrl: "http://x",
      apiKey: "k",
      model: "m",
      customHeaders: "X-Foo: bar\nX-Baz: qux",
      messages: [{ role: "user", content: "h" }],
      params: {},
    });
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers["X-Foo"]).toBe("bar");
    expect(headers["X-Baz"]).toBe("qux");
  });

  it("returns success=false with upstream body when status >= 400", async () => {
    fetchMock.mockResolvedValue(
      new Response("model not found", { status: 404 }),
    );
    const out = await svc.run({
      apiBaseUrl: "http://x",
      apiKey: "k",
      model: "m",
      messages: [{ role: "user", content: "h" }],
      params: {},
    });
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/404/);
    expect(out.error).toMatch(/model not found/);
  });

  it("returns success=false on network error", async () => {
    fetchMock.mockRejectedValue(new Error("network kaboom"));
    const out = await svc.run({
      apiBaseUrl: "http://x",
      apiKey: "k",
      model: "m",
      messages: [{ role: "user", content: "h" }],
      params: {},
    });
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/network kaboom/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm -F @modeldoctor/api test --run src/modules/playground/chat.service.spec.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `chat.service.ts`**

Create `apps/api/src/modules/playground/chat.service.ts`:

```ts
import type { PlaygroundChatRequest, PlaygroundChatResponse } from "@modeldoctor/contracts";
import { Injectable } from "@nestjs/common";

const DEFAULT_PATH = "/v1/chat/completions";

function parseHeaderLines(s: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!s || !s.trim()) return out;
  for (const rawLine of s.split("\n").map((l) => l.trim())) {
    if (!rawLine || !rawLine.includes(":")) continue;
    const idx = rawLine.indexOf(":");
    out[rawLine.slice(0, idx).trim()] = rawLine.slice(idx + 1).trim();
  }
  return out;
}

function buildBody(req: PlaygroundChatRequest): Record<string, unknown> {
  const p = req.params ?? {};
  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages,
  };
  if (p.temperature !== undefined) body.temperature = p.temperature;
  if (p.maxTokens !== undefined) body.max_tokens = p.maxTokens;
  if (p.topP !== undefined) body.top_p = p.topP;
  if (p.frequencyPenalty !== undefined) body.frequency_penalty = p.frequencyPenalty;
  if (p.presencePenalty !== undefined) body.presence_penalty = p.presencePenalty;
  if (p.seed !== undefined) body.seed = p.seed;
  if (p.stop !== undefined) body.stop = p.stop;
  // Phase 1: stream is ignored (always non-streaming).
  return body;
}

@Injectable()
export class ChatService {
  async run(req: PlaygroundChatRequest): Promise<PlaygroundChatResponse> {
    const url = req.apiBaseUrl + (req.pathOverride ?? DEFAULT_PATH);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${req.apiKey}`,
      ...parseHeaderLines(req.customHeaders),
    };
    const start = Date.now();
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(buildBody(req)),
      });
      const latencyMs = Date.now() - start;
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return {
          success: false,
          error: `upstream ${res.status}: ${text || res.statusText}`.slice(0, 1024),
          latencyMs,
        };
      }
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const content = json.choices?.[0]?.message?.content ?? "";
      return {
        success: true,
        content,
        latencyMs,
        usage: json.usage,
      };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
        latencyMs: Date.now() - start,
      };
    }
  }
}
```

- [ ] **Step 4: Implement `chat.controller.ts`**

Create `apps/api/src/modules/playground/chat.controller.ts`:

```ts
import {
  type PlaygroundChatRequest,
  PlaygroundChatRequestSchema,
  type PlaygroundChatResponse,
  PlaygroundChatResponseSchema,
} from "@modeldoctor/contracts";
import { Body, Controller, HttpCode, HttpStatus, Post, UsePipes } from "@nestjs/common";
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { ChatService } from "./chat.service.js";

class PlaygroundChatRequestDto extends createZodDto(PlaygroundChatRequestSchema) {}
class PlaygroundChatResponseDto extends createZodDto(PlaygroundChatResponseSchema) {}

@ApiTags("playground")
@Controller("playground")
export class ChatController {
  constructor(private readonly svc: ChatService) {}

  @ApiOperation({ summary: "Send a chat completion via the Playground (non-streaming)" })
  @ApiBody({ type: PlaygroundChatRequestDto })
  @ApiOkResponse({ type: PlaygroundChatResponseDto })
  @Post("chat")
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(PlaygroundChatRequestSchema))
  chat(@Body() body: PlaygroundChatRequest): Promise<PlaygroundChatResponse> {
    return this.svc.run(body);
  }
}
```

- [ ] **Step 5: Implement `playground.module.ts`**

Create `apps/api/src/modules/playground/playground.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { ChatController } from "./chat.controller.js";
import { ChatService } from "./chat.service.js";

@Module({
  controllers: [ChatController],
  providers: [ChatService],
})
export class PlaygroundModule {}
```

- [ ] **Step 6: Register the module in `app.module.ts`**

Open `apps/api/src/app.module.ts`. Add the import alphabetically near other modules:

```ts
import { PlaygroundModule } from "./modules/playground/playground.module.js";
```

Add to the `imports` array (after `LoadTestModule` is fine):

```ts
LoadTestModule,
PlaygroundModule,
BenchmarkModule,
```

- [ ] **Step 7: Run the service spec to verify it passes**

```bash
pnpm -F @modeldoctor/api test --run src/modules/playground/chat.service.spec.ts
```

Expected: PASS.

- [ ] **Step 8: Run the full api test suite + type-check**

```bash
pnpm -F @modeldoctor/api test --run
pnpm -F @modeldoctor/api type-check
```

Expected: ALL PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/playground/playground.module.ts apps/api/src/modules/playground/chat.controller.ts apps/api/src/modules/playground/chat.service.ts apps/api/src/modules/playground/chat.service.spec.ts apps/api/src/app.module.ts
git commit -m "$(cat <<'EOF'
feat(api/playground): POST /api/playground/chat (non-streaming)

Forwards a chat-completions request to the user's upstream URL with
Bearer auth and merged custom headers. CamelCase params are mapped to
the OpenAI-canonical snake_case body. Errors (upstream non-2xx + network
faults) are returned as { success: false, error, latencyMs }.

Streaming SSE is deferred to Phase 2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Frontend chat store

**Files:**
- Create: `apps/web/src/features/playground/chat/store.ts`
- Create: `apps/web/src/features/playground/chat/store.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/web/src/features/playground/chat/store.test.ts`:

```ts
import type { ChatMessage } from "@modeldoctor/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { useChatStore } from "./store";

describe("useChatStore", () => {
  beforeEach(() => {
    useChatStore.getState().reset();
  });

  it("starts empty", () => {
    const s = useChatStore.getState();
    expect(s.selectedConnectionId).toBeNull();
    expect(s.messages).toEqual([]);
    expect(s.systemMessage).toBe("");
    expect(s.sending).toBe(false);
  });

  it("appendMessage adds to the end", () => {
    const m: ChatMessage = { role: "user", content: "hi" };
    useChatStore.getState().appendMessage(m);
    expect(useChatStore.getState().messages).toEqual([m]);
  });

  it("setSelected stores the connection id", () => {
    useChatStore.getState().setSelected("conn-1");
    expect(useChatStore.getState().selectedConnectionId).toBe("conn-1");
  });

  it("patchParams merges with existing params", () => {
    useChatStore.getState().patchParams({ temperature: 0.5 });
    useChatStore.getState().patchParams({ maxTokens: 100 });
    expect(useChatStore.getState().params).toEqual({ temperature: 0.5, maxTokens: 100 });
  });

  it("clearMessages keeps system message but drops messages", () => {
    useChatStore.getState().setSystemMessage("you are helpful");
    useChatStore.getState().appendMessage({ role: "user", content: "hi" });
    useChatStore.getState().clearMessages();
    expect(useChatStore.getState().messages).toEqual([]);
    expect(useChatStore.getState().systemMessage).toBe("you are helpful");
  });

  it("reset wipes everything", () => {
    useChatStore.getState().setSystemMessage("x");
    useChatStore.getState().appendMessage({ role: "user", content: "y" });
    useChatStore.getState().setSelected("c");
    useChatStore.getState().reset();
    expect(useChatStore.getState().selectedConnectionId).toBeNull();
    expect(useChatStore.getState().messages).toEqual([]);
    expect(useChatStore.getState().systemMessage).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm -F @modeldoctor/web test --run src/features/playground/chat/store.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `store.ts`**

Create `apps/web/src/features/playground/chat/store.ts`:

```ts
import type { ChatMessage, ChatParams } from "@modeldoctor/contracts";
import { create } from "zustand";

export interface ChatStoreState {
  selectedConnectionId: string | null;
  systemMessage: string;
  messages: ChatMessage[];
  params: ChatParams;
  sending: boolean;
  error: string | null;
  setSelected: (id: string | null) => void;
  setSystemMessage: (s: string) => void;
  appendMessage: (m: ChatMessage) => void;
  clearMessages: () => void;
  patchParams: (p: Partial<ChatParams>) => void;
  setSending: (b: boolean) => void;
  setError: (s: string | null) => void;
  reset: () => void;
}

const initial = {
  selectedConnectionId: null,
  systemMessage: "",
  messages: [] as ChatMessage[],
  params: {} as ChatParams,
  sending: false,
  error: null as string | null,
};

export const useChatStore = create<ChatStoreState>((set) => ({
  ...initial,
  setSelected: (id) => set({ selectedConnectionId: id }),
  setSystemMessage: (s) => set({ systemMessage: s }),
  appendMessage: (m) => set((s) => ({ messages: [...s.messages, m] })),
  clearMessages: () => set({ messages: [] }),
  patchParams: (p) => set((s) => ({ params: { ...s.params, ...p } })),
  setSending: (b) => set({ sending: b }),
  setError: (e) => set({ error: e }),
  reset: () => set({ ...initial }),
}));
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm -F @modeldoctor/web test --run src/features/playground/chat/store.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/playground/chat/store.ts apps/web/src/features/playground/chat/store.test.ts
git commit -m "$(cat <<'EOF'
feat(web/playground/chat): zustand store for chat session state

Plain in-memory store (no persist) — Phase 2 will add the per-modality
HistoryStore that wraps it. Holds the selected connection id, system
message, message list, params, send-in-flight bool, and last error.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Chat sub-components — `MessageList`, `MessageComposer`, `ChatParams`

**Files:**
- Create: `apps/web/src/features/playground/chat/MessageList.tsx`
- Create: `apps/web/src/features/playground/chat/MessageComposer.tsx`
- Create: `apps/web/src/features/playground/chat/ChatParams.tsx`

These three are presentational, get tested transitively by `ChatPage.test.tsx` in Task 13. No standalone tests — keeps Phase 1 lean.

- [ ] **Step 1: Implement `MessageList.tsx`**

Create `apps/web/src/features/playground/chat/MessageList.tsx`:

```tsx
import type { ChatMessage } from "@modeldoctor/contracts";
import { useTranslation } from "react-i18next";

function renderContent(m: ChatMessage): string {
  if (typeof m.content === "string") return m.content;
  return m.content
    .map((p) => (p.type === "text" ? p.text : `[${p.type}]`))
    .join(" ");
}

export function MessageList({ messages }: { messages: ChatMessage[] }) {
  const { t } = useTranslation("playground");

  if (messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t("chat.messages.empty")}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-6 py-4">
      {messages.map((m, idx) => (
        <div key={`${idx}-${m.role}`} className="rounded-md border border-border bg-card p-3">
          <div className="mb-1 text-xs font-semibold text-muted-foreground">
            {t(`chat.messages.${m.role}`)}
          </div>
          <div className="whitespace-pre-wrap text-sm">{renderContent(m)}</div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Implement `MessageComposer.tsx`**

Create `apps/web/src/features/playground/chat/MessageComposer.tsx`:

```tsx
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface MessageComposerProps {
  systemMessage: string;
  onSystemMessageChange: (s: string) => void;
  onSend: (text: string) => void;
  sending: boolean;
  disabled: boolean;
  disabledReason?: string;
}

export function MessageComposer({
  systemMessage,
  onSystemMessageChange,
  onSend,
  sending,
  disabled,
  disabledReason,
}: MessageComposerProps) {
  const { t } = useTranslation("playground");
  const [draft, setDraft] = useState("");

  const submit = () => {
    if (disabled || sending) return;
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft("");
  };

  return (
    <div className="border-t border-border bg-card px-6 py-3">
      <details className="mb-2">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
          {t("chat.system.label")}
        </summary>
        <Textarea
          rows={2}
          value={systemMessage}
          onChange={(e) => onSystemMessageChange(e.target.value)}
          placeholder={t("chat.system.placeholder")}
          className="mt-2 font-mono text-xs"
        />
      </details>
      <div className="flex gap-2">
        <Textarea
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={t("chat.composer.placeholder")}
          className="text-sm"
          disabled={disabled || sending}
        />
        <Button
          onClick={submit}
          disabled={disabled || sending || !draft.trim()}
          title={disabled ? disabledReason : undefined}
        >
          {sending ? t("chat.composer.sending") : t("chat.composer.send")}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Implement `ChatParams.tsx`**

Create `apps/web/src/features/playground/chat/ChatParams.tsx`:

```tsx
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ChatParams as ChatParamsType } from "@modeldoctor/contracts";
import { useTranslation } from "react-i18next";

interface ChatParamsProps {
  value: ChatParamsType;
  onChange: (patch: Partial<ChatParamsType>) => void;
}

function NumField({
  label,
  value,
  onChange,
  step = 0.1,
  min,
  max,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type="number"
        step={step}
        min={min}
        max={max}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        className="h-8 text-xs"
      />
    </div>
  );
}

export function ChatParams({ value, onChange }: ChatParamsProps) {
  const { t } = useTranslation("playground");
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">{t("chat.params.title")}</h3>
      <NumField label={t("chat.params.temperature")} value={value.temperature} onChange={(v) => onChange({ temperature: v })} step={0.1} min={0} max={2} />
      <NumField label={t("chat.params.maxTokens")} value={value.maxTokens} onChange={(v) => onChange({ maxTokens: v })} step={1} min={1} />
      <NumField label={t("chat.params.topP")} value={value.topP} onChange={(v) => onChange({ topP: v })} step={0.05} min={0} max={1} />
      <NumField label={t("chat.params.frequencyPenalty")} value={value.frequencyPenalty} onChange={(v) => onChange({ frequencyPenalty: v })} step={0.1} min={-2} max={2} />
      <NumField label={t("chat.params.presencePenalty")} value={value.presencePenalty} onChange={(v) => onChange({ presencePenalty: v })} step={0.1} min={-2} max={2} />
      <NumField label={t("chat.params.seed")} value={value.seed} onChange={(v) => onChange({ seed: v })} step={1} />
      <div>
        <Label className="text-xs text-muted-foreground">{t("chat.params.stop")}</Label>
        <Input
          value={value.stop?.join(",") ?? ""}
          onChange={(e) => onChange({ stop: e.target.value ? e.target.value.split(",").map((s) => s.trim()).filter(Boolean) : undefined })}
          placeholder=","
          className="h-8 text-xs"
        />
      </div>
      <p className="text-[10px] italic text-muted-foreground">{t("chat.params.stream")}</p>
    </div>
  );
}
```

- [ ] **Step 4: Type-check**

```bash
pnpm -F @modeldoctor/web type-check
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/playground/chat/MessageList.tsx apps/web/src/features/playground/chat/MessageComposer.tsx apps/web/src/features/playground/chat/ChatParams.tsx
git commit -m "$(cat <<'EOF'
feat(web/playground/chat): MessageList, MessageComposer, ChatParams

Three presentational pieces consumed by ChatPage. Composer collapses
the system-message field into a <details> to keep visual weight low.
Params are 8 number/text inputs (no sliders in Phase 1 — defer until
the design system has a slider primitive).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Assemble `ChatPage` and wire end-to-end

**Files:**
- Modify (replace stub): `apps/web/src/features/playground/chat/ChatPage.tsx`
- Create: `apps/web/src/features/playground/chat/ChatPage.test.tsx`

- [ ] **Step 1: Write the failing page test**

Create `apps/web/src/features/playground/chat/ChatPage.test.tsx`:

```tsx
import "@/lib/i18n";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConnectionsStore } from "@/stores/connections-store";
import { ChatPage } from "./ChatPage";
import { useChatStore } from "./store";

vi.mock("@/lib/api-client", () => {
  class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  return {
    ApiError,
    api: { get: vi.fn(), post: vi.fn() },
  };
});

import { api } from "@/lib/api-client";

function seedChatConn() {
  useConnectionsStore.getState().create({
    name: "chat-1",
    apiBaseUrl: "http://x",
    apiKey: "k",
    model: "m",
    customHeaders: "",
    queryParams: "",
    category: "chat",
    tags: [],
  });
}

describe("ChatPage", () => {
  beforeEach(() => {
    localStorage.clear();
    useConnectionsStore.setState({ connections: [] });
    useChatStore.getState().reset();
    vi.mocked(api.post).mockReset();
  });

  it("send button is disabled until a connection is selected", () => {
    seedChatConn();
    render(
      <MemoryRouter>
        <ChatPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: /send|发送/i })).toBeDisabled();
  });

  it("sends to /api/playground/chat and renders the assistant reply", async () => {
    vi.mocked(api.post).mockResolvedValue({
      success: true,
      content: "hello back",
      latencyMs: 12,
    });
    seedChatConn();
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ChatPage />
      </MemoryRouter>,
    );

    // Pick the connection
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: /chat-1/i }));

    // Type message
    const input = screen.getByPlaceholderText(/type your message|输入消息/i);
    await user.type(input, "hi there");
    await user.click(screen.getByRole("button", { name: /^send$|^发送$/i }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        "/api/playground/chat",
        expect.objectContaining({
          apiBaseUrl: "http://x",
          apiKey: "k",
          model: "m",
          messages: [{ role: "user", content: "hi there" }],
        }),
      );
      expect(screen.getByText("hello back")).toBeInTheDocument();
    });
  });

  it("renders an error toast (or inline error) when api returns success=false", async () => {
    vi.mocked(api.post).mockResolvedValue({
      success: false,
      error: "upstream 500: boom",
      latencyMs: 1,
    });
    seedChatConn();
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ChatPage />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: /chat-1/i }));
    await user.type(screen.getByPlaceholderText(/type your message|输入消息/i), "hi");
    await user.click(screen.getByRole("button", { name: /^send$|^发送$/i }));

    await waitFor(() => {
      expect(screen.getByText(/upstream 500: boom/)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm -F @modeldoctor/web test --run src/features/playground/chat/ChatPage.test.tsx
```

Expected: FAIL — ChatPage is still the stub.

- [ ] **Step 3: Replace the stub with the real `ChatPage.tsx`**

Open `apps/web/src/features/playground/chat/ChatPage.tsx` and overwrite with:

```tsx
import { PageHeader } from "@/components/common/page-header";
import { ApiError, api } from "@/lib/api-client";
import { useConnectionsStore } from "@/stores/connections-store";
import type { PlaygroundChatRequest, PlaygroundChatResponse } from "@modeldoctor/contracts";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CategoryEndpointSelector } from "../CategoryEndpointSelector";
import { PlaygroundShell } from "../PlaygroundShell";
import { ChatParams } from "./ChatParams";
import { MessageComposer } from "./MessageComposer";
import { MessageList } from "./MessageList";
import { useChatStore } from "./store";

export function ChatPage() {
  const { t } = useTranslation("playground");
  const slice = useChatStore();
  const conn = useConnectionsStore((s) =>
    slice.selectedConnectionId ? s.get(slice.selectedConnectionId) : null,
  );

  const canSend = !!conn;
  const disabledReason = canSend ? undefined : t("chat.composer.needConnection");

  const onSend = async (text: string) => {
    if (!conn) return;
    slice.appendMessage({ role: "user", content: text });
    slice.setSending(true);
    slice.setError(null);

    const messages = (
      slice.systemMessage.trim()
        ? [{ role: "system" as const, content: slice.systemMessage.trim() }]
        : []
    )
      .concat(slice.messages)
      .concat([{ role: "user", content: text }]);

    const body: PlaygroundChatRequest = {
      apiBaseUrl: conn.apiBaseUrl,
      apiKey: conn.apiKey,
      model: conn.model,
      customHeaders: conn.customHeaders || undefined,
      queryParams: conn.queryParams || undefined,
      messages,
      params: slice.params,
    };
    try {
      const res = await api.post<PlaygroundChatResponse>("/api/playground/chat", body);
      if (res.success) {
        slice.appendMessage({ role: "assistant", content: res.content ?? "" });
      } else {
        const msg = res.error ?? "unknown";
        slice.setError(msg);
        toast.error(t("chat.errors.send", { message: msg }));
      }
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "network";
      slice.setError(msg);
      toast.error(t("chat.errors.send", { message: msg }));
    } finally {
      slice.setSending(false);
    }
  };

  return (
    <PlaygroundShell
      category="chat"
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
      <PageHeader title={t("chat.title")} subtitle={t("chat.subtitle")} />
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto">
          <MessageList messages={slice.messages} />
          {slice.error ? (
            <div className="mx-6 mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {slice.error}
            </div>
          ) : null}
        </div>
        <MessageComposer
          systemMessage={slice.systemMessage}
          onSystemMessageChange={slice.setSystemMessage}
          onSend={onSend}
          sending={slice.sending}
          disabled={!canSend}
          disabledReason={disabledReason}
        />
      </div>
    </PlaygroundShell>
  );
}
```

- [ ] **Step 4: Run the page test to verify it passes**

```bash
pnpm -F @modeldoctor/web test --run src/features/playground/chat/ChatPage.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Run the full web test suite + type-check**

```bash
pnpm -F @modeldoctor/web test --run
pnpm -F @modeldoctor/web type-check
```

Expected: ALL PASS, type-check clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/playground/chat/ChatPage.tsx apps/web/src/features/playground/chat/ChatPage.test.tsx
git commit -m "$(cat <<'EOF'
feat(web/playground/chat): wire ChatPage end-to-end

Replaces the Task 6 stub: assembles PlaygroundShell + Selector +
MessageList + MessageComposer + ChatParams, and on Send POSTs to
/api/playground/chat. Errors surface as both an inline error block and
a toast.

Phase 1 omits streaming, multimodal attachments, view-code, and
history — all in subsequent phases.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: End-to-end manual smoke verification

No code, no commit — this is the human acceptance gate. **Do not skip.**

- [ ] **Step 1: Start the backend**

```bash
pnpm -F @modeldoctor/api dev
```

Expected: Nest boots cleanly; logs include `playground` controller registration around `[RouterExplorer]`.

- [ ] **Step 2: Start the frontend in a separate shell**

```bash
pnpm -F @modeldoctor/web dev
```

Expected: Vite serves at `http://localhost:5173` (or printed port).

- [ ] **Step 3: Smoke the new flow in a browser**

1. Visit `http://localhost:5173/connections`. Confirm: empty connections page (any prior v1 data was discarded by Task 3).
2. Click `+ New connection`. Confirm: dialog now shows a `Category` dropdown and a `Tags` input strip.
3. Create a chat connection pointing at any OpenAI-compatible endpoint you control (e.g., a local vLLM, an LM Studio, or a free OpenRouter key). Choose category `Chat`, optionally add tag `vLLM`.
4. Confirm the row appears with a `Chat` badge and the chip in the table.
5. Click the new `Playground → Chat` item in the sidebar. URL should be `/playground/chat`.
6. Confirm: right ParamsPanel shows the connection picker with **only your chat connection** listed (since show-all is off).
7. Pick the connection. Type "say hello in one word" in the composer. Press Enter (or click Send).
8. Confirm: a `user` bubble appears with your text, and within a few seconds an `assistant` bubble appears with the model's reply.
9. Confirm: the network tab shows a single `POST /api/playground/chat` returning 200 with `{success: true, content: "...", latencyMs: ...}`.
10. Force an error: edit the connection's `apiBaseUrl` to `http://127.0.0.1:1` (a closed port). Send another message. Confirm: a red inline error block AND a toast both surface the network error message.
11. Sidebar smoke: confirm the four other Playground items (`Image / Audio / Embeddings / Rerank`) all show the "coming soon" badge and route to the existing `<ComingSoonRoute>` placeholder.

If any of the 11 checks fails, file the issue against the corresponding task and fix before merging.

---

## Self-Review (run before opening PR)

These checks were performed against the spec and the plan above before this plan was finalized. Re-run them after implementation to catch drift:

1. **Spec coverage** — Phase 1 deliverables in spec § 10 mapped to tasks:
   - "提取 ModalityCategorySchema" → Task 1 ✓
   - "Connection 模型加 category + tags" → Tasks 2-5 ✓
   - "CategoryEndpointSelector / PlaygroundShell / ParamsPanel" → Tasks 7, 8 ✓
   - "ViewCodeDialog / HistoryStore" → **Deferred** (documented in Phase 1 omissions header)
   - "路由壳 + sidebar 分组 + i18n key 落位" → Task 6 ✓
   - "ChatPage 仅文本、非流式、不带历史" → Tasks 11, 12, 13 ✓
   - "后端 /api/playground/chat 非流式" → Tasks 9, 10 ✓
   - "验收标准" → Task 14 ✓

2. **Placeholder scan** — no TBD/TODO/"similar to" patterns. Every code block is concrete.

3. **Type consistency** —
   - `ModalityCategory` used identically in `Connection`, `connectionInputSchema`, `CategoryEndpointSelector`, sidebar config: ✓
   - `ChatMessage`, `ChatParams`, `PlaygroundChatRequest`, `PlaygroundChatResponse` consumed identically by frontend store, ChatPage, backend service, and contracts: ✓
   - `useChatStore` action names (`appendMessage`, `clearMessages`, `patchParams`, `setSelected`, `setSending`, `setError`, `setSystemMessage`, `reset`) consistent across store + ChatPage + tests: ✓

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-29-playground-phase-1-foundation.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Which approach?
