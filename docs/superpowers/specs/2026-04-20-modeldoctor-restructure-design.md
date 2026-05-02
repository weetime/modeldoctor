> **Status: ✅ Completed · historical record.** 本文是提交时的设计/计划快照；其中字段名、目录路径、env 名、API 路由为当时状态，重构后已演进。**当前实现请以代码与 `CLAUDE.md` 为准；本文正文不再修改，仅作归档。**

# ModelDoctor Restructure — Spec 1 (Frontend Skeleton)

**Status:** Approved design — ready for implementation planning
**Date:** 2026-04-20
**Predecessor:** Existing `inferbench` codebase (single-page Express app, vanilla ES modules)
**Successor:** Spec 2 — Backend hardening (SQLite persistence, encrypted API keys, reverse-proxy auth, async task queue, history persistence)

## 1. Purpose and Scope

### 1.1 Project Repositioning

Rename `InferBench` to **ModelDoctor**. New positioning: a troubleshooting toolkit for model-serving APIs — not just a load tester. Tagline: *"Troubleshooting toolkit for model-serving APIs"*.

The long-term product roadmap (across multiple specs) includes nine functional tabs grouped by troubleshooting intent:

| Group | Tab | Purpose |
|-------|-----|---------|
| Performance | Load Test | Throughput / latency under sustained QPS |
| Performance | Soak / Stability | Long-duration low-QPS to surface drift / leaks |
| Performance | Streaming TTFT | Time-to-first-token, inter-token latency |
| Correctness | E2E Smoke | Functional probes across text / image / audio paths |
| Correctness | Regression (A/B) | Output/latency comparison between two endpoints |
| Observability | Health Monitor | Periodic ping of API / metrics endpoints |
| Observability | History | Timeline of prior runs, visualization |
| Debug | Request Debug | Single-shot request with full req/res/headers/timing |

Plus a **Connections** library and a **Settings** page.

### 1.2 Spec 1 Delivery Scope

This spec delivers:

- A complete frontend rewrite from vanilla ES modules to **Vite + React + TypeScript + Tailwind + shadcn/ui**.
- Left-sidebar / right-main layout with grouped collapsible navigation for all nine tabs.
- Three tabs fully implemented:
  - **Load Test** — 1:1 migration from the existing feature.
  - **E2E Smoke** — 1:1 migration from the existing feature.
  - **Request Debug** — new tab reusing the current curl parser.
- The remaining five tabs present as sidebar entries rendering a **Coming Soon** placeholder.
- A **Connections library** persisted in `localStorage` behind a `ConnectionsStore` interface abstraction, so Spec 2 can swap to a backend implementation without touching UI code.
- **i18n** (English + Simplified Chinese) via `react-i18next`, per-tab namespaces.
- **Theme** (Light / Dark / System) using shadcn/Tailwind conventions.
- A **Settings** page consolidating appearance, environment info, and data import/export.

Explicitly **out of scope** for Spec 1 (deferred to Spec 2 or later):

- Any database persistence, API-key encryption, authentication, or authorization.
- Async task queue for long-running loads — Load Test still runs synchronously through the existing `exec`-based route.
- History persistence — the History tab is a placeholder; old `localStorage.testHistory` is discarded.
- Implementation of Soak / Streaming TTFT / Regression / Health / History tabs.
- Backwards-compatibility with the old `inferbench` frontend — this is treated as a clean-slate rewrite.

### 1.3 Deployment Target

ModelDoctor is intended for **internal corporate network deployment** (single-tenant, trusted users). It is not designed for direct public-internet exposure. Security hardening appropriate for that environment arrives in Spec 2.

## 2. Repository Layout and Build

### 2.1 Directory Structure

The repository directory name `BlastBench` is kept as-is (changing it would churn every clone). The npm package name becomes `modeldoctor`.

```
BlastBench/
├── package.json                      # name "modeldoctor", version "0.1.0"
├── pnpm-lock.yaml
├── server.js                         # Existing entry point, minimal changes
├── src/                              # Existing backend (routes, builders, probes, parsers, utils)
│   ├── routes/
│   │   ├── health.js
│   │   ├── load-test.js
│   │   ├── e2e-test.js
│   │   └── debug-proxy.js            # NEW in Spec 1 — single new backend route
│   ├── builders/, probes/, parsers/, utils/
│
├── web/                              # NEW — frontend source root
│   ├── index.html                    # Vite entry; replaces public/index.html
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── tailwind.config.ts
│   ├── postcss.config.cjs
│   ├── biome.json
│   ├── public/                       # Vite static assets (favicon, logo)
│   └── src/
│       ├── main.tsx                  # React entry
│       ├── App.tsx                   # Router + root layout wiring
│       ├── layouts/
│       │   └── AppShell.tsx
│       ├── components/
│       │   ├── sidebar/              # SidebarGroup, SidebarItem, BrandHeader
│       │   ├── connection/           # EndpointSelector, ConnectionFormDialog
│       │   ├── ui/                   # shadcn-generated primitives (copied, not npm)
│       │   └── common/               # PageHeader, EmptyState, LoadingSpinner, CopyButton
│       ├── features/                 # One directory per tab, fully isolated
│       │   ├── load-test/
│       │   ├── e2e-smoke/
│       │   ├── request-debug/
│       │   ├── coming-soon/
│       │   ├── connections/
│       │   └── settings/
│       ├── stores/                   # Zustand slices
│       │   ├── connections-store.ts
│       │   ├── theme-store.ts
│       │   └── locale-store.ts
│       ├── lib/
│       │   ├── api-client.ts
│       │   ├── curl-parser.ts
│       │   └── utils.ts
│       ├── locales/
│       │   ├── en-US/
│       │   └── zh-CN/
│       ├── router/
│       │   └── index.tsx
│       └── types/
│
├── dist/                             # Vite build output; gitignored; Express serves it in prod
├── tmp/                              # Existing vegeta runtime artifacts
├── docs/
│   └── superpowers/specs/
├── ai-docs/                          # Existing — retained
└── .gitignore                        # Add dist/
```

Files to **delete** during implementation (clean-slate, no migration):

- `public/` (old frontend)
- `QUICKSTART.md`, `changelog.md`, `allaboutproject.md`, `start.sh`
- `package-lock.json` (replaced by `pnpm-lock.yaml`)

Files to **rewrite**:

- `README.md` — short, focused on Spec 1 scope, running instructions, disclaimer that Spec 2 is pending.
- `server.js` — change `express.static("public")` to `express.static("dist")`; mount new `debug-proxy` router.
- `package.json` — rename, reset version to `0.1.0`, unified scripts.

### 2.2 Build, Dev, Deploy

- **Package manager:** pnpm.
- **Scripts** (root `package.json`):
  - `pnpm dev` — runs Vite dev server (port 5173) and Express (port 3001) in parallel via `concurrently`. Vite proxies `/api/*` to `http://localhost:3001`.
  - `pnpm build` — `vite build` with root pointing at `web/`, output to repo-root `dist/`.
  - `pnpm start` — `node server.js` for production (serves `dist/` statically, one port `3001`).
  - `pnpm lint` — `biome check .` over `web/src/`.
  - `pnpm format` — `biome format --write .`.
  - `pnpm type-check` — `tsc --noEmit` in `web/`.
- **Node version:** `>=18` (unchanged from current).

### 2.3 Tech Stack (Frozen)

| Concern | Choice |
|---------|--------|
| Bundler / dev server | Vite |
| UI framework | React 18 + TypeScript (strict) |
| Component library | shadcn/ui (copied primitives over Radix UI) |
| Styling | Tailwind CSS |
| State management | Zustand (with `persist` middleware) |
| Forms | react-hook-form + zod resolver |
| Server state / fetching | TanStack Query v5 |
| Router | React Router v7 (Data Router mode, `createBrowserRouter`) |
| i18n | react-i18next |
| Dates | date-fns (+ `date-fns-tz` where needed) |
| Icons | lucide-react |
| Lint / format | Biome |
| Package manager | pnpm |

**Explicitly not added in Spec 1:** Recharts (no chart-heavy tab ships this spec), Monaco editor (bundle cost), Redux, Formik, SWR, ESLint/Prettier.

Backend stays on Node 18 + Express + CommonJS. No TypeScript migration for the backend in Spec 1.

## 3. Visual Design Language

### 3.1 Aesthetic Principles

ModelDoctor targets the restrained, tool-focused aesthetic of Linear / Vercel / Raycast / the shadcn docs site. It deliberately avoids any visual signature that reads as "AI-generated SaaS template":

- **No emoji as functional icons anywhere in the UI.** Icons come exclusively from `lucide-react` (1.5px stroke, single-color).
- **No decorative gradient fills** on section backgrounds, hero banners, or buttons.
- **No purple-as-brand-accent** signals. The neutral accent is zinc/slate; status colors (green / red / amber) appear only on result artifacts (pass/fail badges, destructive buttons, alert strips), never on navigation or branding.
- **No stacked soft shadows.** Hierarchy is built with `border + bg-card` and `bg-muted/30` background shifts.
- **Typography-first** — Inter for UI, JetBrains Mono for numeric and code-like content (metrics, raw reports, JSON).
- **Radius discipline** — `rounded-md` (6px) for most controls, `rounded-lg` for large result cards; avoid pill shapes on buttons.

### 3.2 Color Tokens (shadcn convention)

Light and dark palettes use the standard shadcn CSS variables (`--background`, `--foreground`, `--card`, `--border`, `--muted`, `--muted-foreground`, `--accent`, `--accent-foreground`, `--destructive`, `--primary`, `--ring`). Primary is set to a neutral zinc rather than a brand color.

- Light: near-white background, subtle light-gray panels, single mid-gray border color.
- Dark: near-black background (`hsl(240 6% 8%)`), one step lighter for panels, thin dark border.
- Status accents (reserved for result regions): `--success` green, `--destructive` red, `--warning` amber.

### 3.3 Layout Shell

The application shell is a two-column layout at `lg` breakpoint and above:

- **Sidebar** — fixed 260px wide, `border-r`, contains brand header, grouped navigation, footer utilities.
- **Main** — flex-1, contains page header and the active route.

At `md` and below, the sidebar collapses to a 56px icon rail (tooltips on hover). A full mobile drawer is not implemented in Spec 1 (YAGNI — this is a desktop troubleshooting tool).

### 3.4 Sidebar Structure

```
ModelDoctor
Troubleshooting for model APIs

PERFORMANCE                     ▾
    Activity        Load Test
    Timer           Soak / Stability     [Soon]
    Zap             Streaming TTFT       [Soon]

CORRECTNESS                     ▾
    CheckCircle2    E2E Smoke
    GitCompare      Regression           [Soon]

OBSERVABILITY                   ▾
    HeartPulse      Health Monitor       [Soon]
    History         History              [Soon]

DEBUG                           ▾
    Bug             Request Debug

────────────────────────────────────
    Database        Connections
    Settings        Settings
```

- Group headers are 11px uppercase, tracked letter-spacing, muted foreground. Clicking toggles group collapse; state persists to `localStorage.sidebar-groups-collapsed`.
- `[Soon]` is a small outlined badge (`text-[10px] uppercase border rounded-sm`), not a colored pill.
- Active item: 2px vertical bar on the left edge plus `bg-accent/50` background. No colored text highlight.
- The bottom section (Connections, Settings) is separated by a thin `border-t`.
- Theme and language toggles are **not** in the sidebar. Theme lives as a single icon-only toggle in the top-right of each page header; language lives on the Settings page.

### 3.5 Page Header

Each route renders a `PageHeader` slot:

- Title — `text-2xl font-semibold tracking-tight`.
- Optional subtitle — `text-sm text-muted-foreground`.
- Right-aligned utility slot — houses the `EndpointSelector` (for tabs that use one) and an icon-only theme toggle.
- Thin `border-b` below the header.

No centered big hero title, no status banner in the header area, no "installed ✅" badges.

## 4. Routing and Information Architecture

### 4.1 Route Table

| Path | Component | Sidebar Group | Implemented in Spec 1 |
|------|-----------|--------------|-----------------------|
| `/` | Redirect → `/load-test` | — | Yes |
| `/load-test` | `features/load-test/LoadTestPage` | Performance | Yes (migrated) |
| `/soak` | `ComingSoon` | Performance | Placeholder |
| `/streaming` | `ComingSoon` | Performance | Placeholder |
| `/e2e` | `features/e2e-smoke/E2ESmokePage` | Correctness | Yes (migrated) |
| `/regression` | `ComingSoon` | Correctness | Placeholder |
| `/health` | `ComingSoon` | Observability | Placeholder |
| `/history` | `ComingSoon` | Observability | Placeholder |
| `/debug` | `features/request-debug/RequestDebugPage` | Debug | Yes (new) |
| `/connections` | `features/connections/ConnectionsPage` | — (utility) | Yes |
| `/settings` | `features/settings/SettingsPage` | — (utility) | Yes |
| `*` | `NotFound` | — | Yes |

### 4.2 Router Configuration

- `createBrowserRouter` with a single root `AppShell` layout route wrapping all children.
- No route `loader` or `action` functions are used in Spec 1. Data fetching happens inside components via `useMutation` (TanStack Query) for submits and Zustand selectors for local state.
- `NavLink` drives sidebar active state.
- `NotFound` provides a "Go to Load Test" link back.

### 4.3 Coming Soon Template

A single shared component rendering:

- Center-aligned lucide icon (the tab's icon, large, muted).
- Tab title and group label.
- `i18n`-backed message: "This feature is under development."
- A button "Back to Load Test" (`<Link to="/load-test">`).

## 5. State Model

### 5.1 Independence Rule

Each tab maintains its own Zustand slice for all business state (selected connection, form fields, last result). Switching tabs does **not** share `selectedConnectionId`, form values, or results across tabs. This satisfies the "independent test projects" requirement.

Slices are persisted to `localStorage` under stable keys:

- `md.load-test.v1`
- `md.e2e.v1`
- `md.debug.v1`
- `md.connections.v1`
- `md.theme.v1`
- `md.locale.v1`
- `md.sidebar-groups-collapsed.v1`

The `.v1` suffix reserves a clean migration path if the state shape changes.

### 5.2 Connections Store Contract

```typescript
// web/src/types/connection.ts
export interface Connection {
  id: string;              // uuid
  name: string;            // unique within the library
  apiUrl: string;
  apiKey: string;          // Spec 1: plaintext in localStorage. Spec 2: encrypted server-side.
  model: string;
  customHeaders: string;   // multi-line "Header-Name: value"
  queryParams: string;     // multi-line "key=value"
  createdAt: string;       // ISO 8601
  updatedAt: string;       // ISO 8601
}

// web/src/stores/connections-store.ts
export interface ConnectionsStore {
  list(): Connection[];
  get(id: string): Connection | null;
  create(input: Omit<Connection, "id" | "createdAt" | "updatedAt">): Connection;
  update(id: string, patch: Partial<Omit<Connection, "id" | "createdAt">>): Connection;
  remove(id: string): void;
  exportAll(): string;  // serialized ConnectionsExport JSON
  importAll(json: string, mode: "merge" | "replace"): { added: number; skipped: number };
}

export interface ConnectionsExport {
  version: 1;
  connections: Connection[];
}
```

- **Name uniqueness:** `create` and `update` reject collisions with an error; UI surfaces a dialog suggestion to rename.
- **Spec 1 implementation:** `LocalStorageConnectionsStore` persists via Zustand `persist` middleware under `md.connections.v1`.
- **Spec 2 implementation:** A `RemoteConnectionsStore` backed by `/api/connections` CRUD routes. Consumers (`useConnectionsStore` hook) call the same interface methods — no UI changes.
- **Notably absent from `Connection`:** `apiType`. That is a per-tab operation choice, not an endpoint property.

### 5.3 Per-Tab State Slices

Each implemented tab defines its own Zustand slice.

**Load Test** (`md.load-test.v1`):

```typescript
interface LoadTestState {
  selectedConnectionId: string | null;
  unsavedOverrides: Partial<Connection> | null;
  apiType: "chat" | "embeddings" | "rerank" | "images" | "chat-vision" | "chat-audio";
  chat:          { prompt: string; maxTokens: number; temperature: number; stream: boolean };
  embeddings:    { input: string };
  rerank:        { query: string; texts: string };
  images:        { prompt: string; size: string; n: number };
  chatVision:    { imageUrl: string; prompt: string; systemPrompt: string; maxTokens: number; temperature: number };
  chatAudio:     { prompt: string; systemPrompt: string };
  attack:        { rate: number; duration: number };
  lastResult:    LoadTestResult | null;
}
```

**E2E Smoke** (`md.e2e.v1`):

```typescript
interface E2EState {
  selectedConnectionId: string | null;
  unsavedOverrides: Partial<Connection> | null;
  probeResults: Record<"text" | "image" | "audio", ProbeResult | null>;
}
```

**Request Debug** (`md.debug.v1`):

```typescript
interface DebugState {
  selectedConnectionId: string | null;
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  url: string;
  headers: Array<{ key: string; value: string; enabled: boolean }>;
  queryParams: Array<{ key: string; value: string; enabled: boolean }>;
  body: string;                         // raw text; JSON formatting is a user-invoked action
  lastResponse: DebugResponse | null;
}
```

### 5.4 EndpointSelector Behavior

A component placed in the right slot of each implementing tab's `PageHeader`:

1. Renders a `Select` listing "— Manual (unsaved) —" at top, then all connections sorted by name.
2. Selecting a connection:
   - Writes `selectedConnectionId` in the current tab's slice.
   - Overwrites the tab's form fields with connection values.
   - Clears `unsavedOverrides`.
3. Any user edit to a form field that diverges from the selected connection's values populates `unsavedOverrides` and shows a small "modified" dot next to the selector.
4. An adjacent `MoreHorizontal` button opens a menu with:
   - **Save** — writes current form values back into the selected connection via `update`. Disabled when "— Manual —" is selected or when there are no overrides.
   - **Save as new…** — opens a name-entry dialog, then `create`.
   - **Manage connections** — navigates to `/connections`.
5. With "— Manual —" selected, form values never auto-sync to any connection. Submissions still work; they use the current form values.

### 5.5 Empty-State Handling

On first launch the Connections library is empty. Load Test, E2E Smoke, and Request Debug render a centered Empty state when `list().length === 0` and the user has not entered any inputs:

- Headline: `No connections yet`.
- Body: `Create one to get started, or paste a curl command to auto-fill.`
- Two buttons: `New connection` (opens the connection dialog) and `Paste curl` (scrolls to/expands the curl input region if the tab has one; for E2E Smoke, which has no curl input, only the first button shows).

## 6. Tab Implementations

### 6.1 Load Test (`/load-test`)

**Page structure (top to bottom):**

1. `PageHeader` with title "Load Test", subtitle from i18n, and right-slot `EndpointSelector` + theme toggle.
2. `Section: Request`
   - API Type `Select` (six types).
   - Collapsible "Import from cURL" panel (closed by default). Expands into a monospace textarea and a `Parse & Fill` button.
3. `Section: Parameters`
   - Dynamically rendered sub-form keyed by `apiType`. Each sub-form has its own zod schema and form fields mirroring the existing implementation (prompt, max tokens, temperature, stream, etc., per type).
4. `Section: Attack`
   - Rate (QPS) `Input type=number`, min 1, max 10000.
   - Duration (seconds) `Input type=number`, min 1, max 3600.
5. Action row: `Start` primary button + `Reset` secondary button.
6. Result region (hidden until a run completes):
   - Status strip: shadcn `Alert` variant `default` (success) or `destructive` (failure), with a lucide `CheckCircle2` or `AlertCircle` icon.
   - Metrics grid: 8 cards in responsive grid — Total Requests, Success Rate, Throughput, Mean / P50 / P95 / P99 / Max Latency. Each card: 11px uppercase muted label, `text-xl font-semibold tabular-nums` in JetBrains Mono, unit in `text-xs text-muted-foreground`.
   - Raw report `<pre>` — JetBrains Mono, `bg-muted/40`, with a top-right `Copy` button (lucide `Copy`).
   - Test Configuration `<pre>` — same treatment.

**Form handling:** react-hook-form with zod resolver. Each apiType has its own schema; switching apiType swaps `resolver`. All fields are persisted to the Load Test slice, so navigating away and back preserves them.

**Submit flow:** `useMutation` → `POST /api/load-test` with the same request shape the existing backend already accepts. On success, `lastResult` is written to the slice. On failure, an inline `Alert` appears in the result region.

**Run state:** The `Start` button disables while the mutation is pending. A thin `Progress` bar appears above the result region and advances using a client-side timer based on the configured duration — it is an estimate, not a real backend progress signal. If the mutation returns before the estimate reaches 100%, the bar completes immediately; if it overruns, the bar caps at 100% and shows an indeterminate pulse until the response arrives. No modal spinners are used.

**Backend:** `/api/load-test` route unchanged in Spec 1. Vegeta availability is not surfaced in this page; it moves to Settings → Environment.

### 6.2 E2E Smoke (`/e2e`)

**Page structure:**

1. `PageHeader` with title, subtitle, right slot `EndpointSelector` + theme toggle.
2. `Section: Probes` — three probe cards in a responsive grid (3-col on `lg`, 1-col on narrow).
3. Action row: `Run All` primary + `Clear Results` secondary.

**Probe card:**

- Header: probe name, probe path string (small muted monospace), right-aligned status `Badge` (idle / running / pass / fail).
- `Run` button (outline variant).
- Expandable result area: latency strip, checks list (lucide `Check` / `X` icons instead of `✓` / `✗`), probe-specific output (content line for Text; inline image preview up to 120px for Image; native `<audio controls>` and byte count for Audio).
- Status-driven border: idle = default, running = warning accent left border, pass = success accent left border, fail = destructive.

**Backend:** `/api/e2e-test` route unchanged. Probes fixed at `text`, `image`, `audio` for Spec 1.

**Run concurrency:** Running all three fires a single request (`probes: ["text","image","audio"]`) so the backend runs them in parallel, matching current behavior. Single-card runs fire with a one-element `probes` array.

### 6.3 Request Debug (`/debug`) — New

**Goal:** Single-shot request inspection. No QPS, no probes — just a full HTTP round-trip with visibility into request and response including headers and timing. Intended as the "one request is failing, what's in it and what's the server saying" tool.

**Page structure:**

1. `PageHeader` — title "Request Debug", subtitle, right slot `EndpointSelector`.
2. `Section: Paste curl` (collapsible, open on first visit if the form is empty)
   - Monospace textarea.
   - `Parse` button: runs `curlParser`, populates method / url / headers / body in the sections below.
3. `Section: Request`
   - Method `Select` (GET / POST / PUT / DELETE / PATCH).
   - URL `Input` (full-width).
   - Tabs (shadcn `Tabs`):
     - **Headers** — editable key/value table, rows addable/removable, per-row `enabled` toggle.
     - **Body** — monospace `Textarea`, min height 200px. A `Format as JSON` button attempts `JSON.parse` + stringify-indent; errors surface as a small inline notice. No Monaco in Spec 1.
     - **Query** — editable key/value table.
4. Action row: `Send` primary + `Clear` secondary.
5. `Section: Response` (hidden until a request returns)
   - Status strip: method and URL summary, HTTP status (colored: 2xx success, 4xx warning, 5xx destructive), total latency in ms, response size.
   - Tabs:
     - **Body** — auto-rendered by `Content-Type`: JSON is passed through `JSON.stringify(parsed, null, 2)` and rendered in a `<pre>` with JetBrains Mono (no syntax highlighter); `image/*` renders an `<img>` preview; `audio/*` renders a native `<audio controls>`; `text/*` renders as plain monospace; any other content-type shows a Download button that triggers a blob download.
     - **Headers** — two-column table of response headers.
     - **Timing** — two numbers, `TTFB` (backend-measured time from outbound request start to first byte from target) and `Total` (frontend-measured time from `Send` click to response arrival). No DNS/TCP breakdown in v1.
     - **Raw** — raw response text (for binary, the base64 string).

**Transport:**

Spec 1 introduces **one new backend route**: `POST /api/debug/proxy`. Rationale: browsers block cross-origin API calls to arbitrary model-serving endpoints without CORS. Routing through the backend removes this friction and enables server-measured timing.

Request shape:

```json
{
  "method": "POST",
  "url": "https://example/v1/chat/completions",
  "headers": { "Authorization": "Bearer sk-...", "Content-Type": "application/json" },
  "body": "{\"model\":\"x\",\"messages\":[...]}"
}
```

Response shape:

```json
{
  "success": true,
  "status": 200,
  "statusText": "OK",
  "headers": { "content-type": "application/json", ... },
  "body": "<raw response text or base64 if binary>",
  "bodyEncoding": "text" | "base64",
  "timingMs": { "ttfbMs": 123, "totalMs": 245 },
  "sizeBytes": 1234
}
```

Errors (network, invalid URL, timeout): `{ "success": false, "error": "..." }`.

Implementation: Node `undici`-style `fetch` with manual `Performance.now()` for timing; 60s timeout; 20MB body limit; follow up to 5 redirects; return response body as text unless content-type looks binary, in which case base64.

**Security / scope note (debt):** The proxy is an open relay inside the internal network in Spec 1. It must gain authentication and a target allowlist in Spec 2. This is recorded explicitly in README and in Section 9.

### 6.4 Connections Page (`/connections`)

- Table (shadcn `Table`) with columns: Name, API URL, Model, Custom Headers (truncated), Created, Actions.
- `apiKey` is not displayed in the table — there is no column for it, preventing accidental screen-capture leakage.
- Row actions: Edit (opens connection dialog), Delete (opens confirm dialog).
- Top-right actions: `New connection`, `Import`, `Export`.
- Connection dialog: name, URL, API Key (input type `password`, with a reveal toggle `Eye`/`EyeOff`), model, custom headers (textarea), query params (textarea). Validated by zod.
- Import dialog: file picker or paste JSON; shows preview of count; mode toggle Merge / Replace; confirms before applying.
- Export: triggers a browser download of `modeldoctor-connections-<YYYY-MM-DD>.json`.

### 6.5 Settings Page (`/settings`)

Three sections:

**Appearance**

- Theme radio group: Light / Dark / System. Persists to theme store.
- Language select: English / 中文. Persists to locale store.

**Environment**

- Vegeta check: `Check Vegeta` button calls `/api/check-vegeta`. Renders installed path or a "Not installed" notice with a copyable `brew install vegeta` hint.
- Server info: version from `/api/health` (the backend returns `package.json` version), build mode from `import.meta.env.MODE`.

**Data**

- `Export connections` button.
- `Import connections` button.
- `Reset app state` — destructive button behind a two-step confirm dialog. Clears every `md.*` key from localStorage and reloads the page.

### 6.6 Coming Soon Pages

Five routes (`/soak`, `/streaming`, `/regression`, `/health`, `/history`) render the shared `ComingSoon` component. Each passes in its icon and i18n key. No backend calls.

## 7. i18n

### 7.1 Library and Setup

- `react-i18next` with `i18next-http-backend` or bundled JSON imports. Spec 1 uses **bundled JSON** (via Vite's JSON import) for simplicity; no HTTP round trip for translations.
- Initialization reads `localStorage.md.locale.v1`, falls back to `navigator.language` mapped to `zh-CN` / `en-US`, defaults to `en-US`.
- Language change mutates the locale store, which calls `i18n.changeLanguage()` and persists.

### 7.2 Namespaces

One JSON file per namespace per language, under `web/src/locales/{en-US,zh-CN}/<ns>.json`:

- `common` — buttons, form labels, generic status words.
- `sidebar` — group labels, tab names.
- `load-test`
- `e2e`
- `debug`
- `connections`
- `settings`
- `coming-soon`
- `errors`

### 7.3 Rules

- No hard-coded visible strings in components. Spec 1 enforces this via manual review during the phase 5 string audit; a Biome lint rule to automate detection is **not** added in Spec 1 (no suitable off-the-shelf rule exists for Biome at the time of writing).
- Number formatting via `Intl.NumberFormat(currentLocale)`.
- Date formatting via `date-fns.format(date, pattern, { locale })` with dynamic `import()` for `zh-CN` locale module.

## 8. Theme and Accessibility

### 8.1 Theme Switching

- Shadcn/Tailwind convention: `darkMode: "class"`; tokens defined for `:root` and `.dark`.
- A small inline script in `web/index.html` reads `md.theme.v1` (values: `light`, `dark`, `system`) and the `prefers-color-scheme` media query, then adds or removes `.dark` on `<html>` before React hydrates. This prevents flash.
- Theme toggle: an icon-only button in each `PageHeader` that opens a shadcn `DropdownMenu` with three explicit items (Light / Dark / System). Clicking an item writes the value to the theme store and immediately applies it. The button's icon reflects the current effective theme (`Sun` when light is active, `Moon` when dark, `Monitor` when system). Cycling behavior is avoided — a three-option dropdown is less ambiguous than a three-state toggle.

### 8.2 Accessibility Baseline

- All interactive primitives come from shadcn (Radix-backed), retaining default keyboard handling and ARIA attributes.
- Global focus ring preserved via `focus-visible:ring-2 ring-ring`.
- Sidebar group headers are `<button>` elements.
- No keyboard shortcuts (Cmd+K palette, etc.) are implemented in Spec 1. They are a post-Spec-1 concern.
- No screen-reader audit is performed in Spec 1. This is accepted technical debt.

## 9. Known Debt and Future Work

Recorded explicitly so they land in Spec 2 scoping:

- **Plaintext `apiKey` in localStorage** — acceptable only under the "transitional" framing. README and the Settings page surface this fact. Spec 2 moves connections to a backend store with envelope encryption.
- **Open debug proxy** — `POST /api/debug/proxy` is an unauthenticated relay inside the internal network. Spec 2 gates it behind authentication and a target URL allowlist (DNS name / CIDR list) to prevent the service from being used as an internal SSRF pivot.
- **No async task queue** — Load Test still runs inside a single HTTP request, blocking for the full duration. Long tests are therefore capped at the reverse proxy's response timeout. Spec 2 introduces an async run model (`POST /api/runs` returning an id + `GET /api/runs/:id` for status/polling) backed by SQLite.
- **No history persistence** — every run is ephemeral. The History tab ships as a placeholder. Spec 2 captures each completed run and renders them here.
- **No observability of ModelDoctor itself** — no metrics, no structured logs. Deferred.
- **No automated tests** for UI behavior. Spec 1 tests only pure logic (`curl-parser`, `ConnectionsStore`). Component-level tests (Playwright or Vitest + Testing Library) are added once Spec 2 stabilizes interfaces.
- **Recharts deferred** — Recharts is not installed in Spec 1. It arrives with the first tab that renders charts (Streaming TTFT or Health), to keep the Spec 1 bundle lean.
- **Monaco editor** — not added in Spec 1. The Request Debug body field is a plain monospace textarea with a `Format as JSON` convenience button.

## 10. Acceptance Criteria

The following must be true for Spec 1 to be considered complete:

**Build and run**

- [ ] `pnpm install` succeeds on a clean clone with no warnings treated as errors.
- [ ] `pnpm dev` starts Vite on 5173 and Express on 3001; `/api/*` proxies correctly; hot reload works on file edits.
- [ ] `pnpm build && pnpm start` serves the production bundle on port 3001 alone.
- [ ] `pnpm type-check` passes with zero errors.
- [ ] `pnpm lint` passes with zero errors.

**Navigation**

- [ ] All nine sidebar entries render; the five placeholders show the `ComingSoon` page with a working link back to Load Test.
- [ ] Sidebar group collapse state persists across reloads.
- [ ] Navigating between tabs preserves each tab's form state and selected connection.
- [ ] Deep-linking to any route on first load renders correctly.

**Load Test**

- [ ] All six `apiType` variants produce correct request bodies and the backend load-test route returns parseable reports.
- [ ] Metrics grid, raw report, and test-configuration panes all render.
- [ ] `Reset` restores form fields to the currently-selected connection's values (or empty for Manual).

**E2E Smoke**

- [ ] Each probe runs individually and as `Run All`.
- [ ] Image probe shows inline preview; Audio probe plays.
- [ ] Pass/fail border and badge reflect probe outcome.

**Request Debug**

- [ ] Pasting a curl command and clicking Parse populates method, URL, headers, body.
- [ ] Send flows through `/api/debug/proxy` and returns a response.
- [ ] Response body renders appropriately for JSON, text, image, and audio content types.
- [ ] Timing strip shows TTFB and Total; Raw tab shows the unprocessed text.
- [ ] `Save as Connection` persists the current request details into the Connections library.

**Connections**

- [ ] CRUD works end to end; duplicate names are rejected with a helpful message.
- [ ] API Key defaults to masked and reveal toggle works.
- [ ] Export produces a `version: 1` JSON; Import validates `version` and reports added/skipped counts; Merge and Replace modes behave distinctly.
- [ ] EndpointSelector in all three tabs reflects the library and does not leak selection between tabs.

**Settings**

- [ ] Theme switch (Light / Dark / System) works without flash.
- [ ] Language switch updates every visible string on every implemented page.
- [ ] Vegeta check surfaces installed or not-installed state.
- [ ] Reset app state clears every `md.*` key and reloads to an empty Connections library.

**Visual QA (Section 3 compliance)**

- [ ] No emoji characters in the rendered UI. Grep over the built bundle finds no emoji codepoints in user-visible strings.
- [ ] All icons come from `lucide-react`.
- [ ] No decorative gradient backgrounds.
- [ ] Primary button uses the neutral accent; status colors appear only in result regions and destructive confirmations.

## 11. Implementation Phases (Hand-off to Writing-Plans)

The implementation plan should decompose the work into five phases, each independently reviewable and demo-able:

1. **Scaffolding & build** — repo cleanup (delete legacy files), pnpm init, Vite + React + TS + Tailwind + shadcn CLI, Biome, Vite proxy, `server.js` static path change, script set, README rewrite.
2. **AppShell & routing** — layout shell, Sidebar with groups and collapse, all nine routes wired (Coming Soon placeholders for five), theme token setup and FOUC-safe theme bootstrap, i18n skeleton (`common` + `sidebar` namespaces in both locales).
3. **Connections subsystem** — `ConnectionsStore` interface + `LocalStorageConnectionsStore`, `useConnectionsStore` hook, `/connections` page (table, dialogs, import/export), `EndpointSelector` component, shared Empty state template.
4. **Implemented tabs** — Load Test migration, E2E Smoke migration, Request Debug (including `POST /api/debug/proxy` backend route), form state persistence, result renderers.
5. **Settings & polish** — Settings page (Appearance, Environment, Data sections), Vegeta check relocation, i18n string audit, final visual QA against Section 3, acceptance checklist walk-through.

Each phase ends with a commit and a manual smoke check against that phase's scope before starting the next.

---

**End of Spec 1 design.**
