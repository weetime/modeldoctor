# ModelDoctor Spec 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the existing InferBench frontend as ModelDoctor — a React + TypeScript + shadcn/ui troubleshooting tool with a sidebar layout, three working tabs (Load Test, E2E Smoke, Request Debug), a localStorage-backed Connections library, i18n, and theming. Backend stays largely untouched (one new `/api/debug/proxy` route).

**Architecture:** Single repo with root `package.json`. Frontend in `web/` (Vite root), built to `dist/`, served in production by the existing Express app on port 3001. Dev mode runs Vite (5173) and Express (3001) in parallel with Vite proxying `/api/*`. Tab state lives in per-tab Zustand slices; a shared `ConnectionsStore` interface isolates persistence so Spec 2 can swap localStorage for a backend without touching UI.

**Tech Stack:** Vite, React 18, TypeScript strict, Tailwind CSS, shadcn/ui, Zustand, react-hook-form + zod, TanStack Query v5, React Router v7 (Data Router), react-i18next, date-fns, lucide-react, Biome, Vitest + @testing-library/react, pnpm. Backend unchanged: Node 18 + Express + CommonJS.

**Source spec:** `docs/superpowers/specs/2026-04-20-modeldoctor-restructure-design.md`

**Testing discipline:**
- **Strict TDD** for pure logic (curl parser, ConnectionsStore, backend debug-proxy, zod validators).
- **Render tests** (Vitest + Testing Library) for components with meaningful state transitions (EndpointSelector, Connection dialog, Request Debug send flow).
- **Manual smoke steps** for pure layout/presentation scaffolds (AppShell, Sidebar chrome, Coming Soon template) — these end with a "run dev server, verify X, commit" step.

**Commit cadence:** One commit per task (numbered sequentially). Every task ends with an explicit `git add <paths>` + `git commit -m "…"` step. Commit message prefix convention:
- `build:` for tooling / config
- `feat:` for new user-visible functionality
- `refactor:` for structural changes
- `test:` for test-only changes
- `docs:` for README / spec updates
- `chore:` for housekeeping

**Environment assumptions:**
- Working directory: repo root (`/Users/fangyong/vllm/BlastBench`).
- Node 18+ and pnpm installed (`npm install -g pnpm` if missing).
- Vegeta installed (`brew install vegeta`) for Load Test manual checks. Unit-test phases do not need it.

---

## Pre-flight

- [ ] **Step 0.1: Confirm you are on `main` with a clean working tree**

Run:
```bash
git status
```
Expected: no untracked/modified files the plan cares about. If you have unrelated local changes from pre-existing exploratory work (the repo has modifications to `public/`, `server.js`, `start.sh` etc. from prior sessions), stash them now:
```bash
git stash push -u -m "pre-modeldoctor-restructure WIP" -- \
  .gitignore README.md package.json public/ server.js start.sh request.json request.txt
```
After the plan is merged you can decide whether to drop the stash. Do **not** attempt to integrate the stashed changes into this restructure; the plan treats the repo as a clean slate beyond the backend `src/`.

- [ ] **Step 0.2: Confirm `pnpm --version`**

Run:
```bash
pnpm --version
```
Expected: any 8.x or 9.x. If missing: `npm install -g pnpm@9`.

- [ ] **Step 0.3: Confirm Node ≥ 18**

Run:
```bash
node --version
```
Expected: `v18.*` or newer.

---

## Phase 1 — Scaffolding and Build

Phase goal: new pnpm + Vite + React + TS + Tailwind + shadcn + Biome toolchain in place, legacy frontend files deleted, `server.js` updated to serve `dist/`, root scripts (`dev` / `build` / `start` / `lint` / `type-check`) working. At phase end, `pnpm dev` opens a blank React page at `http://localhost:5173` whose `/api/*` calls are proxied to `http://localhost:3001`.

### Task 1: Clear legacy frontend and reset root package

**Files:**
- Delete: `public/`, `package-lock.json`, `QUICKSTART.md`, `changelog.md`, `allaboutproject.md`, `start.sh`, `request.json`, `request.txt`
- Modify: `package.json`, `.gitignore`
- Create: `web/.gitkeep`

- [ ] **Step 1.1: Delete legacy frontend and obsolete top-level files**

Run:
```bash
rm -rf public/
rm -f package-lock.json QUICKSTART.md changelog.md allaboutproject.md start.sh request.json request.txt
```

- [ ] **Step 1.2: Replace root `package.json`**

Write `package.json` (overwrite):
```json
{
  "name": "modeldoctor",
  "version": "0.1.0",
  "private": true,
  "description": "Troubleshooting toolkit for model-serving APIs",
  "main": "server.js",
  "scripts": {
    "dev": "concurrently -k -n web,api -c cyan,magenta \"pnpm --silent dev:web\" \"pnpm --silent dev:api\"",
    "dev:web": "vite --config web/vite.config.ts",
    "dev:api": "node server.js",
    "build": "vite build --config web/vite.config.ts",
    "start": "node server.js",
    "lint": "biome check web/src",
    "format": "biome format --write web/src",
    "type-check": "tsc -p web/tsconfig.json --noEmit",
    "test": "vitest run --config web/vitest.config.ts",
    "test:watch": "vitest --config web/vitest.config.ts"
  },
  "dependencies": {
    "body-parser": "^1.20.2",
    "cors": "^2.8.5",
    "express": "^4.18.2"
  },
  "devDependencies": {},
  "engines": {
    "node": ">=18.0.0"
  }
}
```

- [ ] **Step 1.3: Update `.gitignore`**

Read current `.gitignore` first, then add these lines if not already present:
```
dist/
web/node_modules/
.vite/
coverage/
```
Keep existing entries (`node_modules/`, `tmp/*` etc.) intact.

- [ ] **Step 1.4: Create `web/` directory placeholder**

Run:
```bash
mkdir -p web
touch web/.gitkeep
```

- [ ] **Step 1.5: Commit**

```bash
git add -A
git commit -m "chore: remove legacy frontend and reset root package for ModelDoctor"
```

### Task 2: Install dependencies and create Vite + React + TS workspace

**Files:**
- Create: `web/vite.config.ts`, `web/tsconfig.json`, `web/tsconfig.node.json`, `web/index.html`, `web/src/main.tsx`, `web/src/App.tsx`, `web/src/vite-env.d.ts`
- Delete: `web/.gitkeep`

- [ ] **Step 2.1: Install runtime and dev dependencies via pnpm**

Run in repo root:
```bash
pnpm add -D \
  vite@^5 \
  @vitejs/plugin-react@^4 \
  typescript@^5.4 \
  react@^18.3 react-dom@^18.3 \
  @types/react@^18.3 @types/react-dom@^18.3 \
  concurrently@^8
```
Then the UI stack:
```bash
pnpm add \
  react-router-dom@^7 \
  zustand@^4.5 \
  react-hook-form@^7 @hookform/resolvers@^3 zod@^3.23 \
  @tanstack/react-query@^5 \
  react-i18next@^14 i18next@^23 \
  date-fns@^3 \
  lucide-react@^0.453 \
  clsx@^2 tailwind-merge@^2
```
Tailwind + shadcn base:
```bash
pnpm add -D tailwindcss@^3.4 postcss@^8 autoprefixer@^10 \
  class-variance-authority@^0.7 \
  tailwindcss-animate@^1
```
Testing and lint:
```bash
pnpm add -D vitest@^1 @vitest/ui@^1 jsdom@^24 \
  @testing-library/react@^16 @testing-library/jest-dom@^6 @testing-library/user-event@^14 \
  @biomejs/biome@^1.9
```

- [ ] **Step 2.2: Create `web/vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: path.resolve(__dirname, "..", "dist"),
    emptyOutDir: true,
    sourcemap: true,
  },
});
```

- [ ] **Step 2.3: Create `web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "types": ["vite/client", "vitest/globals", "@testing-library/jest-dom"],
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src", "vite.config.ts", "vitest.config.ts"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 2.4: Create `web/tsconfig.node.json`**

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 2.5: Create `web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ModelDoctor</title>
    <script>
      (function () {
        try {
          var stored = localStorage.getItem("md.theme.v1");
          var theme = stored ? JSON.parse(stored).state.mode : "system";
          var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
          var isDark = theme === "dark" || (theme === "system" && prefersDark);
          if (isDark) document.documentElement.classList.add("dark");
        } catch (_) {}
      })();
    </script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2.6: Create `web/src/main.tsx`**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 2.7: Create `web/src/App.tsx`** (placeholder — routing added in Phase 2)

```tsx
export default function App() {
  return (
    <div style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>ModelDoctor</h1>
      <p>Scaffold alive. Phase 2 wires the real shell.</p>
    </div>
  );
}
```

- [ ] **Step 2.8: Create `web/src/vite-env.d.ts`**

```ts
/// <reference types="vite/client" />
```

- [ ] **Step 2.9: Remove the placeholder and verify dev server boots**

```bash
rm web/.gitkeep
pnpm dev:web
```
Expected: Vite prints `Local: http://localhost:5173/`. Open it in a browser; the placeholder "Scaffold alive" page renders. Stop the server with Ctrl+C.

- [ ] **Step 2.10: Commit**

```bash
git add -A
git commit -m "build: scaffold web/ with Vite + React + TypeScript"
```

### Task 3: Configure Tailwind and shadcn base layer

**Files:**
- Create: `web/tailwind.config.ts`, `web/postcss.config.cjs`, `web/src/styles/globals.css`, `web/src/lib/utils.ts`
- Modify: `web/src/main.tsx`, `web/index.html`

- [ ] **Step 3.1: Create `web/tailwind.config.ts`**

```ts
import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const config: Config = {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "2rem", screens: { "2xl": "1400px" } },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        success: "hsl(var(--success))",
        warning: "hsl(var(--warning))",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "SF Mono",
          "Menlo",
          "ui-monospace",
          "monospace",
        ],
      },
    },
  },
  plugins: [animate],
};

export default config;
```

- [ ] **Step 3.2: Create `web/postcss.config.cjs`**

```js
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 3.3: Create `web/src/styles/globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 240 10% 3.9%;
    --card: 0 0% 100%;
    --card-foreground: 240 10% 3.9%;
    --primary: 240 5.9% 10%;
    --primary-foreground: 0 0% 98%;
    --secondary: 240 4.8% 95.9%;
    --secondary-foreground: 240 5.9% 10%;
    --muted: 240 4.8% 95.9%;
    --muted-foreground: 240 3.8% 46.1%;
    --accent: 240 4.8% 95.9%;
    --accent-foreground: 240 5.9% 10%;
    --destructive: 0 72% 50%;
    --destructive-foreground: 0 0% 98%;
    --border: 240 5.9% 90%;
    --input: 240 5.9% 90%;
    --ring: 240 5% 64.9%;
    --success: 142 72% 35%;
    --warning: 38 92% 50%;
    --radius: 0.5rem;
  }

  .dark {
    --background: 240 6% 8%;
    --foreground: 0 0% 98%;
    --card: 240 6% 10%;
    --card-foreground: 0 0% 98%;
    --primary: 0 0% 98%;
    --primary-foreground: 240 5.9% 10%;
    --secondary: 240 3.7% 15.9%;
    --secondary-foreground: 0 0% 98%;
    --muted: 240 3.7% 15.9%;
    --muted-foreground: 240 5% 64.9%;
    --accent: 240 3.7% 15.9%;
    --accent-foreground: 0 0% 98%;
    --destructive: 0 62.8% 45%;
    --destructive-foreground: 0 0% 98%;
    --border: 240 3.7% 15.9%;
    --input: 240 3.7% 15.9%;
    --ring: 240 4.9% 63.9%;
    --success: 142 70% 45%;
    --warning: 38 92% 55%;
  }

  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground font-sans antialiased;
    font-feature-settings: "cv11", "ss01";
  }
  code, pre {
    @apply font-mono;
  }
}
```

- [ ] **Step 3.4: Create `web/src/lib/utils.ts`** (shadcn's `cn` helper)

```ts
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 3.5: Import globals in `web/src/main.tsx`**

Replace contents:
```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/globals.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 3.6: Smoke-check Tailwind works**

Temporarily replace `web/src/App.tsx` with:
```tsx
export default function App() {
  return (
    <div className="min-h-screen bg-background text-foreground p-6">
      <h1 className="text-2xl font-semibold tracking-tight">ModelDoctor</h1>
      <p className="text-sm text-muted-foreground mt-2">Tailwind token check.</p>
      <button
        type="button"
        className="mt-4 rounded-md border border-border bg-card px-3 py-1.5 text-sm hover:bg-accent"
        onClick={() => document.documentElement.classList.toggle("dark")}
      >
        Toggle dark
      </button>
    </div>
  );
}
```
Run `pnpm dev:web`. Verify in the browser that the button toggles between light and dark themes and the colors come from the CSS variables. Stop the server.

- [ ] **Step 3.7: Commit**

```bash
git add -A
git commit -m "build: add Tailwind CSS, shadcn color tokens, and cn utility"
```

### Task 4: Configure Biome and Vitest

**Files:**
- Create: `web/biome.json`, `web/vitest.config.ts`, `web/src/test/setup.ts`

- [ ] **Step 4.1: Create `web/biome.json`**

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "files": {
    "ignore": ["dist", "node_modules", "coverage"]
  },
  "organizeImports": { "enabled": true },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100,
    "lineEnding": "lf"
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double",
      "jsxQuoteStyle": "double",
      "trailingCommas": "all",
      "semicolons": "always"
    }
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "style": {
        "noUselessElse": "warn",
        "useConst": "warn"
      },
      "suspicious": {
        "noExplicitAny": "warn",
        "noArrayIndexKey": "warn"
      },
      "correctness": {
        "useExhaustiveDependencies": "warn"
      }
    }
  }
}
```

- [ ] **Step 4.2: Create `web/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: true,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
```

- [ ] **Step 4.3: Create `web/src/test/setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
```

- [ ] **Step 4.4: Verify lint, type-check, and test commands work**

Run from repo root:
```bash
pnpm lint
pnpm type-check
pnpm test
```
Expected:
- `lint` passes (no files to check yet triggers an info line; zero errors).
- `type-check` passes with zero output.
- `test` passes with "No test files found" (expected — we have no tests yet; Vitest exits 0 on no-files by default when running `run`, or warns — if it exits non-zero, add a dummy test file `web/src/test/smoke.test.ts` with `import { test, expect } from "vitest"; test("smoke", () => expect(true).toBe(true));` and re-run).

- [ ] **Step 4.5: Commit**

```bash
git add -A
git commit -m "build: configure Biome lint/format and Vitest + Testing Library"
```

### Task 5: Update `server.js` to serve `dist/` and reserve new API mount

**Files:**
- Modify: `server.js`

- [ ] **Step 5.1: Replace `server.js` contents**

```js
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const path = require("node:path");

const healthRouter = require("./src/routes/health");
const loadTestRouter = require("./src/routes/load-test");
const e2eRouter = require("./src/routes/e2e-test");
// debug-proxy router is added in Phase 4 Task 22.

const PORT = process.env.PORT || 3001;
const DIST_DIR = path.join(__dirname, "dist");

const app = express();
app.disable("x-powered-by");
app.use(cors());
app.use(bodyParser.json({ limit: "10mb" }));

app.use("/api", healthRouter);
app.use("/api", loadTestRouter);
app.use("/api", e2eRouter);

app.use(express.static(DIST_DIR));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(DIST_DIR, "index.html"));
});

app.listen(PORT, () => {
  console.log("ModelDoctor server");
  console.log(`Listening on http://localhost:${PORT}`);
});
```

Key changes vs the old file:
- Static dir is `dist/`, not `public/`.
- SPA fallback (`app.get("*")`) serves `index.html` for non-`/api/*` routes so client-side routes like `/load-test` survive reloads in production.
- Removed the "💡 Tip: brew install vegeta" log (moved to Settings page UI in Phase 5).
- Left a comment marking where the debug-proxy router will mount in Task 22.

- [ ] **Step 5.2: Verify the API still starts cleanly**

Run:
```bash
node server.js
```
Expected: `ModelDoctor server` / `Listening on http://localhost:3001`. In another terminal: `curl http://localhost:3001/api/health` should return the health router's response (whatever the existing implementation returns — 200 JSON). Stop the server.

- [ ] **Step 5.3: Commit**

```bash
git add server.js
git commit -m "refactor: serve dist/ and add SPA fallback in server.js"
```

### Task 6: Verify `pnpm dev` runs both processes with proxy

**Files:** none changed; this task is a smoke check.

- [ ] **Step 6.1: Start `pnpm dev`**

```bash
pnpm dev
```
Expected output interleaved with `[web]` and `[api]` prefixes. Vite on 5173, Express on 3001.

- [ ] **Step 6.2: Verify proxy works**

In a browser, open `http://localhost:5173`. The scaffold page renders (possibly the Tailwind smoke-check version from Task 3 — that's fine for now). Open devtools → Network, then in the browser console run:
```js
fetch("/api/health").then((r) => r.json()).then(console.log);
```
Expected: a JSON response from the backend (via Vite proxy). No CORS errors.

- [ ] **Step 6.3: Stop `pnpm dev`**

Ctrl+C in the terminal.

- [ ] **Step 6.4: No commit needed (smoke check only)**

### Task 7: Rewrite README for Spec 1 state

**Files:**
- Modify: `README.md`

- [ ] **Step 7.1: Replace `README.md` contents**

```markdown
# ModelDoctor

Troubleshooting toolkit for model-serving APIs.

**Current state:** Spec 1 — frontend skeleton with three working tabs (Load Test, E2E Smoke, Request Debug). Five additional tabs (Soak / Stability, Streaming TTFT, Regression, Health Monitor, History) are visible in the sidebar as placeholders and arrive in later specs. Connection credentials are persisted to browser `localStorage` in plaintext; Spec 2 will move them to an encrypted backend store. Do **not** deploy Spec 1 on an untrusted network.

## Prerequisites

- Node.js ≥ 18
- pnpm 9 (`npm install -g pnpm@9`)
- Vegeta for Load Test (`brew install vegeta` on macOS, or releases at <https://github.com/tsenart/vegeta/releases>)

## Install

```bash
pnpm install
```

## Develop

```bash
pnpm dev
```

Vite serves the frontend on <http://localhost:5173>. Express serves the API on <http://localhost:3001>. Vite proxies `/api/*` through to Express. Edit files in `web/src/`; HMR updates the browser.

## Production build

```bash
pnpm build
pnpm start
```

The Vite bundle is emitted to `dist/`. Express serves it on port 3001 together with the API. One port, one process.

## Repo layout

```
BlastBench/
├── server.js               # Express entry (API + static serve for dist/)
├── src/                    # Backend routes, builders, probes, parsers
├── web/                    # Frontend (Vite root)
│   ├── index.html
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── layouts/, components/, features/, stores/, lib/, locales/, router/, types/
│   │   └── styles/globals.css
│   ├── vite.config.ts, tsconfig.json, tailwind.config.ts, biome.json
├── dist/                   # Vite build output (gitignored)
├── docs/superpowers/       # Specs and implementation plans
└── tmp/                    # Runtime artifacts (Vegeta request.txt)
```

## Scripts

| Command | Purpose |
|---------|---------|
| `pnpm dev` | Run Vite + Express together |
| `pnpm build` | Build the frontend to `dist/` |
| `pnpm start` | Run Express on `dist/` (production) |
| `pnpm lint` | Biome lint over `web/src/` |
| `pnpm format` | Biome format over `web/src/` |
| `pnpm type-check` | TypeScript no-emit check |
| `pnpm test` | Vitest run |
| `pnpm test:watch` | Vitest watch mode |

## License

MIT
```

- [ ] **Step 7.2: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README for ModelDoctor Spec 1"
```

### Phase 1 completion check

- [ ] `pnpm dev` starts both processes with interleaved logs.
- [ ] `http://localhost:5173` renders a React page.
- [ ] `fetch("/api/health")` from the browser console succeeds via the Vite proxy.
- [ ] `pnpm build && pnpm start` produces `dist/index.html` and serves it on 3001 alongside the API (the page is still the Task-3 smoke content; that's fine — Phase 2 replaces it).
- [ ] `pnpm lint`, `pnpm type-check`, `pnpm test` all exit 0.

---

## Phase 2 — AppShell, Routing, Theme, i18n

Phase goal: complete navigation skeleton with sidebar (groups + items + brand header), nine routes wired (3 placeholders for tabs implemented later in Phase 4 + 5 Coming Soon + Connections + Settings + 404), theme switching (Light / Dark / System) with no flash, and i18n initialization (English + Simplified Chinese) covering the `common` and `sidebar` namespaces. End-of-phase: every sidebar entry navigates correctly, theme dropdown works, language toggle (placed temporarily in the page header for now; final home is Settings page in Phase 5) updates sidebar copy.

### Task 8: Add core shadcn primitives for the shell

shadcn/ui primitives are copied into `src/components/ui/` rather than installed from npm. Follow the canonical shadcn source verbatim — they are stable across v0.x.

**Files:**
- Create: `web/src/components/ui/button.tsx`, `web/src/components/ui/dropdown-menu.tsx`, `web/src/components/ui/tooltip.tsx`, `web/src/components/ui/badge.tsx`, `web/src/components/ui/separator.tsx`, `web/src/components/ui/scroll-area.tsx`

- [ ] **Step 8.1: Install Radix primitives needed by these components**

```bash
pnpm add @radix-ui/react-dropdown-menu@^2 \
  @radix-ui/react-tooltip@^1 \
  @radix-ui/react-separator@^1 \
  @radix-ui/react-scroll-area@^1 \
  @radix-ui/react-slot@^1
```

- [ ] **Step 8.2: Create `web/src/components/ui/button.tsx`**

```tsx
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-6",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
```

- [ ] **Step 8.3: Create `web/src/components/ui/dropdown-menu.tsx`**

Use the canonical shadcn source. For brevity, run this command which downloads the file from shadcn's registry, or paste the contents from <https://ui.shadcn.com/docs/components/dropdown-menu>:

```bash
mkdir -p web/src/components/ui
curl -fsSL https://raw.githubusercontent.com/shadcn-ui/ui/main/apps/www/registry/default/ui/dropdown-menu.tsx \
  -o web/src/components/ui/dropdown-menu.tsx
```
If curl fails (offline), copy the canonical content from the shadcn docs page. After download, open the file and ensure imports use `@/lib/utils` (it should already; if not, fix the import path).

- [ ] **Step 8.4: Create `web/src/components/ui/tooltip.tsx`**

```bash
curl -fsSL https://raw.githubusercontent.com/shadcn-ui/ui/main/apps/www/registry/default/ui/tooltip.tsx \
  -o web/src/components/ui/tooltip.tsx
```
Same fallback applies.

- [ ] **Step 8.5: Create `web/src/components/ui/badge.tsx`**

```tsx
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide transition-colors",
  {
    variants: {
      variant: {
        default: "border-border bg-muted text-muted-foreground",
        outline: "border-border text-muted-foreground",
        success: "border-transparent bg-success/15 text-success",
        warning: "border-transparent bg-warning/15 text-warning",
        destructive: "border-transparent bg-destructive/15 text-destructive",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
```

- [ ] **Step 8.6: Create `web/src/components/ui/separator.tsx`**

```tsx
import * as React from "react";
import * as SeparatorPrimitive from "@radix-ui/react-separator";
import { cn } from "@/lib/utils";

const Separator = React.forwardRef<
  React.ElementRef<typeof SeparatorPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>
>(({ className, orientation = "horizontal", decorative = true, ...props }, ref) => (
  <SeparatorPrimitive.Root
    ref={ref}
    decorative={decorative}
    orientation={orientation}
    className={cn(
      "shrink-0 bg-border",
      orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
      className,
    )}
    {...props}
  />
));
Separator.displayName = SeparatorPrimitive.Root.displayName;

export { Separator };
```

- [ ] **Step 8.7: Create `web/src/components/ui/scroll-area.tsx`**

```bash
curl -fsSL https://raw.githubusercontent.com/shadcn-ui/ui/main/apps/www/registry/default/ui/scroll-area.tsx \
  -o web/src/components/ui/scroll-area.tsx
```

- [ ] **Step 8.8: Verify the primitives compile**

Run:
```bash
pnpm type-check
```
Expected: zero errors. If any shadcn-fetched file imports something missing, fix imports (usually they reference `@/lib/utils` which already exists).

- [ ] **Step 8.9: Commit**

```bash
git add -A
git commit -m "feat: add core shadcn primitives (button, dropdown, tooltip, badge, separator, scroll-area)"
```

### Task 9: Theme store and theme toggle

The bootstrap `<script>` in `index.html` already reads `md.theme.v1`. Now build the Zustand store and the dropdown that mutates it.

**Files:**
- Create: `web/src/stores/theme-store.ts`, `web/src/components/common/theme-toggle.tsx`, `web/src/stores/theme-store.test.ts`

- [ ] **Step 9.1: Write failing test for `useThemeStore`**

Create `web/src/stores/theme-store.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { useThemeStore } from "./theme-store";

describe("themeStore", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
    useThemeStore.setState({ mode: "system" });
  });

  it("defaults to system mode", () => {
    expect(useThemeStore.getState().mode).toBe("system");
  });

  it("setMode('dark') adds the .dark class to <html>", () => {
    useThemeStore.getState().setMode("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("setMode('light') removes the .dark class", () => {
    document.documentElement.classList.add("dark");
    useThemeStore.getState().setMode("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("setMode('system') follows prefers-color-scheme", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (q: string) => ({
        matches: q.includes("dark"),
        media: q,
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
      }),
    });
    useThemeStore.getState().setMode("system");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
```

- [ ] **Step 9.2: Run test, expect failure**

```bash
pnpm test theme-store
```
Expected: failure on import (file does not exist yet).

- [ ] **Step 9.3: Implement `web/src/stores/theme-store.ts`**

```ts
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeMode = "light" | "dark" | "system";

interface ThemeStore {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

function applyMode(mode: ThemeMode): void {
  const isDark =
    mode === "dark" ||
    (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", isDark);
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set) => ({
      mode: "system",
      setMode: (mode) => {
        applyMode(mode);
        set({ mode });
      },
    }),
    {
      name: "md.theme.v1",
      onRehydrateStorage: () => (state) => {
        if (state) applyMode(state.mode);
      },
    },
  ),
);
```

- [ ] **Step 9.4: Run test, expect pass**

```bash
pnpm test theme-store
```
Expected: all four tests pass.

- [ ] **Step 9.5: Build the `ThemeToggle` component**

Create `web/src/components/common/theme-toggle.tsx`:
```tsx
import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type ThemeMode, useThemeStore } from "@/stores/theme-store";

export function ThemeToggle() {
  const { t } = useTranslation("common");
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);

  const Icon = mode === "light" ? Sun : mode === "dark" ? Moon : Monitor;

  const items: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
    { value: "light", label: t("theme.light"), icon: Sun },
    { value: "dark", label: t("theme.dark"), icon: Moon },
    { value: "system", label: t("theme.system"), icon: Monitor },
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("theme.toggle")}>
          <Icon className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[8rem]">
        {items.map((item) => (
          <DropdownMenuItem
            key={item.value}
            onClick={() => setMode(item.value)}
            className="gap-2"
          >
            <item.icon className="h-4 w-4" />
            <span>{item.label}</span>
            {mode === item.value ? (
              <span className="ml-auto text-xs text-muted-foreground">●</span>
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

(`useTranslation` will exist after Task 10; this file imports it now and the type-check will fail until then. That's fine — Task 10 follows immediately and the next type-check will pass.)

- [ ] **Step 9.6: Commit**

```bash
git add -A
git commit -m "feat: add theme Zustand store and theme toggle dropdown"
```

### Task 10: i18n initialization with English and Chinese (common + sidebar namespaces)

**Files:**
- Create: `web/src/lib/i18n.ts`, `web/src/stores/locale-store.ts`, `web/src/locales/en-US/common.json`, `web/src/locales/en-US/sidebar.json`, `web/src/locales/zh-CN/common.json`, `web/src/locales/zh-CN/sidebar.json`
- Modify: `web/src/main.tsx`

- [ ] **Step 10.1: Create `web/src/locales/en-US/common.json`**

```json
{
  "appName": "ModelDoctor",
  "tagline": "Troubleshooting toolkit for model-serving APIs",
  "actions": {
    "save": "Save",
    "cancel": "Cancel",
    "delete": "Delete",
    "edit": "Edit",
    "create": "Create",
    "import": "Import",
    "export": "Export",
    "reset": "Reset",
    "clear": "Clear",
    "send": "Send",
    "run": "Run",
    "runAll": "Run All",
    "start": "Start",
    "back": "Back",
    "manageConnections": "Manage connections",
    "saveAsNew": "Save as new…",
    "copy": "Copy",
    "copied": "Copied",
    "format": "Format as JSON"
  },
  "status": {
    "idle": "Idle",
    "running": "Running",
    "pass": "Pass",
    "fail": "Fail",
    "comingSoon": "Soon"
  },
  "theme": {
    "toggle": "Toggle theme",
    "light": "Light",
    "dark": "Dark",
    "system": "System"
  },
  "endpoint": {
    "label": "Endpoint",
    "manual": "— Manual (unsaved) —",
    "modified": "Modified"
  },
  "comingSoon": {
    "title": "Coming soon",
    "body": "This feature is under development.",
    "backToLoadTest": "Back to Load Test"
  },
  "empty": {
    "noConnections": "No connections yet",
    "noConnectionsBody": "Create one to get started, or paste a curl command to auto-fill.",
    "newConnection": "New connection",
    "pasteCurl": "Paste curl"
  },
  "errors": {
    "unknown": "Unknown error",
    "network": "Network error",
    "required": "This field is required"
  }
}
```

- [ ] **Step 10.2: Create `web/src/locales/en-US/sidebar.json`**

```json
{
  "groups": {
    "performance": "Performance",
    "correctness": "Correctness",
    "observability": "Observability",
    "debug": "Debug"
  },
  "items": {
    "loadTest": "Load Test",
    "soak": "Soak / Stability",
    "streaming": "Streaming TTFT",
    "e2e": "E2E Smoke",
    "regression": "Regression",
    "health": "Health Monitor",
    "history": "History",
    "requestDebug": "Request Debug",
    "connections": "Connections",
    "settings": "Settings"
  }
}
```

- [ ] **Step 10.3: Create `web/src/locales/zh-CN/common.json`**

```json
{
  "appName": "ModelDoctor",
  "tagline": "模型服务 API 的排障工具集",
  "actions": {
    "save": "保存",
    "cancel": "取消",
    "delete": "删除",
    "edit": "编辑",
    "create": "新建",
    "import": "导入",
    "export": "导出",
    "reset": "重置",
    "clear": "清空",
    "send": "发送",
    "run": "运行",
    "runAll": "全部运行",
    "start": "开始",
    "back": "返回",
    "manageConnections": "管理连接",
    "saveAsNew": "另存为…",
    "copy": "复制",
    "copied": "已复制",
    "format": "格式化为 JSON"
  },
  "status": {
    "idle": "待运行",
    "running": "运行中",
    "pass": "通过",
    "fail": "失败",
    "comingSoon": "即将推出"
  },
  "theme": {
    "toggle": "切换主题",
    "light": "浅色",
    "dark": "深色",
    "system": "跟随系统"
  },
  "endpoint": {
    "label": "连接",
    "manual": "— 手动（未保存）—",
    "modified": "已修改"
  },
  "comingSoon": {
    "title": "敬请期待",
    "body": "该功能正在开发中。",
    "backToLoadTest": "返回 Load Test"
  },
  "empty": {
    "noConnections": "尚未创建任何连接",
    "noConnectionsBody": "新建一条以开始，或者粘贴一条 curl 自动填充。",
    "newConnection": "新建连接",
    "pasteCurl": "粘贴 curl"
  },
  "errors": {
    "unknown": "未知错误",
    "network": "网络错误",
    "required": "此项必填"
  }
}
```

- [ ] **Step 10.4: Create `web/src/locales/zh-CN/sidebar.json`**

```json
{
  "groups": {
    "performance": "性能",
    "correctness": "正确性",
    "observability": "可观测性",
    "debug": "排障"
  },
  "items": {
    "loadTest": "压力测试",
    "soak": "稳定性测试",
    "streaming": "流式首字延迟",
    "e2e": "E2E Smoke",
    "regression": "回归对比",
    "health": "健康监控",
    "history": "历史记录",
    "requestDebug": "请求调试",
    "connections": "连接库",
    "settings": "设置"
  }
}
```

- [ ] **Step 10.5: Create `web/src/stores/locale-store.ts`**

```ts
import { create } from "zustand";
import { persist } from "zustand/middleware";
import i18n from "@/lib/i18n";

export type Locale = "en-US" | "zh-CN";

interface LocaleStore {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

function detectInitial(): Locale {
  const nav = typeof navigator !== "undefined" ? navigator.language : "en-US";
  return nav.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

export const useLocaleStore = create<LocaleStore>()(
  persist(
    (set) => ({
      locale: detectInitial(),
      setLocale: (locale) => {
        i18n.changeLanguage(locale);
        set({ locale });
      },
    }),
    {
      name: "md.locale.v1",
      onRehydrateStorage: () => (state) => {
        if (state) i18n.changeLanguage(state.locale);
      },
    },
  ),
);
```

- [ ] **Step 10.6: Create `web/src/lib/i18n.ts`**

```ts
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import enCommon from "@/locales/en-US/common.json";
import enSidebar from "@/locales/en-US/sidebar.json";
import zhCommon from "@/locales/zh-CN/common.json";
import zhSidebar from "@/locales/zh-CN/sidebar.json";

void i18n.use(initReactI18next).init({
  resources: {
    "en-US": { common: enCommon, sidebar: enSidebar },
    "zh-CN": { common: zhCommon, sidebar: zhSidebar },
  },
  lng: "en-US",
  fallbackLng: "en-US",
  defaultNS: "common",
  ns: ["common", "sidebar"],
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
```

Each tab namespace (`load-test`, `e2e`, `debug`, `connections`, `settings`, `coming-soon`, `errors`) is added in later tasks alongside the feature.

- [ ] **Step 10.7: Wire i18n initialization into `web/src/main.tsx`**

Replace contents:
```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/globals.css";
import "./lib/i18n";
import { useLocaleStore } from "./stores/locale-store";

// Force the locale store to hydrate before render so i18n.language is correct.
useLocaleStore.getState();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 10.8: Verify type-check passes**

```bash
pnpm type-check
```
Expected: zero errors. The `ThemeToggle` from Task 9 now resolves `useTranslation` and the `common` namespace.

- [ ] **Step 10.9: Commit**

```bash
git add -A
git commit -m "feat: initialize i18n with en-US and zh-CN (common + sidebar namespaces)"
```

### Task 11: Coming Soon page and shared empty-state pattern

**Files:**
- Create: `web/src/components/common/empty-state.tsx`, `web/src/features/coming-soon/ComingSoonPage.tsx`

- [ ] **Step 11.1: Create `web/src/components/common/empty-state.tsx`**

```tsx
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  body?: string;
  actions?: ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, body, actions, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card/40 px-8 py-16 text-center",
        className,
      )}
    >
      <Icon className="h-8 w-8 text-muted-foreground" strokeWidth={1.5} />
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      {body ? <p className="max-w-sm text-sm text-muted-foreground">{body}</p> : null}
      {actions ? <div className="mt-2 flex gap-2">{actions}</div> : null}
    </div>
  );
}
```

- [ ] **Step 11.2: Create `web/src/features/coming-soon/ComingSoonPage.tsx`**

```tsx
import type { LucideIcon } from "lucide-react";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";

interface ComingSoonPageProps {
  icon: LucideIcon;
  title: string;
}

export function ComingSoonPage({ icon, title }: ComingSoonPageProps) {
  const { t } = useTranslation("common");
  return (
    <div className="px-8 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("comingSoon.title")}</p>
      </div>
      <EmptyState
        icon={icon}
        title={t("comingSoon.title")}
        body={t("comingSoon.body")}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/load-test">
              <ArrowLeft className="h-4 w-4" />
              {t("comingSoon.backToLoadTest")}
            </Link>
          </Button>
        }
      />
    </div>
  );
}
```

- [ ] **Step 11.3: Commit**

```bash
git add -A
git commit -m "feat: add EmptyState and ComingSoon page templates"
```

### Task 12: PageHeader shared component

Used by Load Test, E2E Smoke, Request Debug, Connections, and Settings.

**Files:**
- Create: `web/src/components/common/page-header.tsx`

- [ ] **Step 12.1: Create `web/src/components/common/page-header.tsx`**

```tsx
import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/common/theme-toggle";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  rightSlot?: ReactNode;
  showThemeToggle?: boolean;
}

export function PageHeader({
  title,
  subtitle,
  rightSlot,
  showThemeToggle = true,
}: PageHeaderProps) {
  return (
    <header className="border-b border-border bg-background">
      <div className="flex items-start justify-between gap-4 px-8 py-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle ? (
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {rightSlot}
          {showThemeToggle ? <ThemeToggle /> : null}
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 12.2: Commit**

```bash
git add web/src/components/common/page-header.tsx
git commit -m "feat: add PageHeader component"
```

### Task 13: Sidebar (brand header, groups, items, persistence)

**Files:**
- Create: `web/src/stores/sidebar-store.ts`, `web/src/components/sidebar/Sidebar.tsx`, `web/src/components/sidebar/sidebar-config.tsx`

- [ ] **Step 13.1: Create `web/src/stores/sidebar-store.ts`** (collapsed-group persistence)

```ts
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SidebarStore {
  collapsedGroups: Record<string, boolean>;
  toggleGroup: (id: string) => void;
}

export const useSidebarStore = create<SidebarStore>()(
  persist(
    (set) => ({
      collapsedGroups: {},
      toggleGroup: (id) =>
        set((s) => ({
          collapsedGroups: { ...s.collapsedGroups, [id]: !s.collapsedGroups[id] },
        })),
    }),
    { name: "md.sidebar-groups-collapsed.v1" },
  ),
);
```

- [ ] **Step 13.2: Create `web/src/components/sidebar/sidebar-config.tsx`** (single source of truth for the sidebar tree)

```tsx
import {
  Activity,
  Bug,
  CheckCircle2,
  Database,
  GitCompare,
  HeartPulse,
  History,
  Settings,
  Timer,
  Zap,
  type LucideIcon,
} from "lucide-react";

export interface SidebarItem {
  to: string;
  icon: LucideIcon;
  labelKey: string;       // sidebar:items.X
  comingSoon?: boolean;
}

export interface SidebarGroup {
  id: string;
  labelKey: string;       // sidebar:groups.X
  items: SidebarItem[];
}

export const sidebarGroups: SidebarGroup[] = [
  {
    id: "performance",
    labelKey: "groups.performance",
    items: [
      { to: "/load-test", icon: Activity, labelKey: "items.loadTest" },
      { to: "/soak", icon: Timer, labelKey: "items.soak", comingSoon: true },
      { to: "/streaming", icon: Zap, labelKey: "items.streaming", comingSoon: true },
    ],
  },
  {
    id: "correctness",
    labelKey: "groups.correctness",
    items: [
      { to: "/e2e", icon: CheckCircle2, labelKey: "items.e2e" },
      { to: "/regression", icon: GitCompare, labelKey: "items.regression", comingSoon: true },
    ],
  },
  {
    id: "observability",
    labelKey: "groups.observability",
    items: [
      { to: "/health", icon: HeartPulse, labelKey: "items.health", comingSoon: true },
      { to: "/history", icon: History, labelKey: "items.history", comingSoon: true },
    ],
  },
  {
    id: "debug",
    labelKey: "groups.debug",
    items: [{ to: "/debug", icon: Bug, labelKey: "items.requestDebug" }],
  },
];

export const sidebarUtilityItems: SidebarItem[] = [
  { to: "/connections", icon: Database, labelKey: "items.connections" },
  { to: "/settings", icon: Settings, labelKey: "items.settings" },
];
```

- [ ] **Step 13.3: Create `web/src/components/sidebar/Sidebar.tsx`**

```tsx
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useSidebarStore } from "@/stores/sidebar-store";
import {
  type SidebarItem as Item,
  sidebarGroups,
  sidebarUtilityItems,
} from "./sidebar-config";

function ItemRow({ item, t }: { item: Item; t: (k: string) => string }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        cn(
          "group relative flex items-center gap-2 rounded-md px-3 py-1.5 text-sm",
          "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
          isActive && "bg-accent/50 text-foreground",
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive ? (
            <span className="absolute left-0 top-1.5 h-5 w-0.5 rounded-r bg-foreground" />
          ) : null}
          <Icon className="h-4 w-4" strokeWidth={1.5} />
          <span className="flex-1">{t(item.labelKey)}</span>
          {item.comingSoon ? <Badge variant="outline">{t("status.comingSoon")}</Badge> : null}
        </>
      )}
    </NavLink>
  );
}

export function Sidebar() {
  const { t } = useTranslation("sidebar");
  const { t: tc } = useTranslation("common");
  const collapsed = useSidebarStore((s) => s.collapsedGroups);
  const toggleGroup = useSidebarStore((s) => s.toggleGroup);

  return (
    <aside className="flex h-screen w-64 flex-col border-r border-border bg-card">
      <div className="px-5 py-5">
        <div className="text-sm font-semibold tracking-tight">{tc("appName")}</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">{tc("tagline")}</div>
      </div>

      <Separator />

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {sidebarGroups.map((group) => {
          const isCollapsed = collapsed[group.id];
          return (
            <div key={group.id} className="mb-3">
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                className="flex w-full items-center justify-between px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
              >
                <span>{t(group.labelKey)}</span>
                <ChevronDown
                  className={cn("h-3 w-3 transition-transform", isCollapsed && "-rotate-90")}
                  strokeWidth={2}
                />
              </button>
              {isCollapsed ? null : (
                <div className="mt-1 flex flex-col gap-px">
                  {group.items.map((item) => (
                    <ItemRow key={item.to} item={item} t={(k) => t(k)} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <Separator />

      <div className="px-2 py-3">
        {sidebarUtilityItems.map((item) => (
          <ItemRow key={item.to} item={item} t={(k) => t(k)} />
        ))}
      </div>
    </aside>
  );
}
```

- [ ] **Step 13.4: Commit**

```bash
git add -A
git commit -m "feat: add Sidebar with grouped items, brand header, and collapse persistence"
```

### Task 14: AppShell layout

**Files:**
- Create: `web/src/layouts/AppShell.tsx`

- [ ] **Step 14.1: Create `web/src/layouts/AppShell.tsx`**

```tsx
import { Outlet } from "react-router-dom";
import { Sidebar } from "@/components/sidebar/Sidebar";

export function AppShell() {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <Sidebar />
      <main className="flex-1 min-w-0 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 14.2: Commit**

```bash
git add web/src/layouts/AppShell.tsx
git commit -m "feat: add AppShell two-column layout"
```

### Task 15: Router with all nine routes + 404, replace `App.tsx`

**Files:**
- Create: `web/src/router/index.tsx`, `web/src/features/not-found/NotFoundPage.tsx`, `web/src/features/load-test/LoadTestPage.tsx`, `web/src/features/e2e-smoke/E2ESmokePage.tsx`, `web/src/features/request-debug/RequestDebugPage.tsx`, `web/src/features/connections/ConnectionsPage.tsx`, `web/src/features/settings/SettingsPage.tsx`
- Modify: `web/src/App.tsx`

The three implemented tab pages and the Connections / Settings pages start as **stub placeholders** here so all routes resolve. They get filled in during Phase 3, 4, and 5.

- [ ] **Step 15.1: Create stub pages**

For each of the five files below, create them with this minimal content (substitute `TITLE_KEY` from the `sidebar:items` namespace per file):

`web/src/features/load-test/LoadTestPage.tsx`:
```tsx
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/common/page-header";

export function LoadTestPage() {
  const { t } = useTranslation("sidebar");
  return (
    <>
      <PageHeader title={t("items.loadTest")} />
      <div className="px-8 py-10 text-sm text-muted-foreground">
        Phase 4 will replace this stub with the full Load Test form and results.
      </div>
    </>
  );
}
```

`web/src/features/e2e-smoke/E2ESmokePage.tsx`:
```tsx
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/common/page-header";

export function E2ESmokePage() {
  const { t } = useTranslation("sidebar");
  return (
    <>
      <PageHeader title={t("items.e2e")} />
      <div className="px-8 py-10 text-sm text-muted-foreground">
        Phase 4 will replace this stub with the E2E Smoke probe cards.
      </div>
    </>
  );
}
```

`web/src/features/request-debug/RequestDebugPage.tsx`:
```tsx
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/common/page-header";

export function RequestDebugPage() {
  const { t } = useTranslation("sidebar");
  return (
    <>
      <PageHeader title={t("items.requestDebug")} />
      <div className="px-8 py-10 text-sm text-muted-foreground">
        Phase 4 will replace this stub with the Request Debug interface.
      </div>
    </>
  );
}
```

`web/src/features/connections/ConnectionsPage.tsx`:
```tsx
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/common/page-header";

export function ConnectionsPage() {
  const { t } = useTranslation("sidebar");
  return (
    <>
      <PageHeader title={t("items.connections")} />
      <div className="px-8 py-10 text-sm text-muted-foreground">
        Phase 3 will replace this stub with the Connections library.
      </div>
    </>
  );
}
```

`web/src/features/settings/SettingsPage.tsx`:
```tsx
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/common/page-header";

export function SettingsPage() {
  const { t } = useTranslation("sidebar");
  return (
    <>
      <PageHeader title={t("items.settings")} />
      <div className="px-8 py-10 text-sm text-muted-foreground">
        Phase 5 will replace this stub with the Settings sections.
      </div>
    </>
  );
}
```

- [ ] **Step 15.2: Create `web/src/features/not-found/NotFoundPage.tsx`**

```tsx
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  const { t } = useTranslation("common");
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
      <h1 className="text-3xl font-semibold tracking-tight">404</h1>
      <p className="text-sm text-muted-foreground">Page not found.</p>
      <Button asChild variant="outline" size="sm">
        <Link to="/load-test">{t("comingSoon.backToLoadTest")}</Link>
      </Button>
    </div>
  );
}
```

- [ ] **Step 15.3: Create `web/src/router/index.tsx`**

```tsx
import {
  Activity,
  CheckCircle2,
  GitCompare,
  HeartPulse,
  History as HistoryIcon,
  Timer,
  Zap,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Navigate, type RouteObject } from "react-router-dom";
import { AppShell } from "@/layouts/AppShell";
import { ComingSoonPage } from "@/features/coming-soon/ComingSoonPage";
import { ConnectionsPage } from "@/features/connections/ConnectionsPage";
import { E2ESmokePage } from "@/features/e2e-smoke/E2ESmokePage";
import { LoadTestPage } from "@/features/load-test/LoadTestPage";
import { NotFoundPage } from "@/features/not-found/NotFoundPage";
import { RequestDebugPage } from "@/features/request-debug/RequestDebugPage";
import { SettingsPage } from "@/features/settings/SettingsPage";

function ComingSoonRoute({
  icon,
  itemKey,
}: {
  icon: typeof Activity;
  itemKey: string;
}) {
  const { t } = useTranslation("sidebar");
  return <ComingSoonPage icon={icon} title={t(`items.${itemKey}`)} />;
}

export const routes: RouteObject[] = [
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/load-test" replace /> },
      { path: "load-test", element: <LoadTestPage /> },
      { path: "soak", element: <ComingSoonRoute icon={Timer} itemKey="soak" /> },
      { path: "streaming", element: <ComingSoonRoute icon={Zap} itemKey="streaming" /> },
      { path: "e2e", element: <E2ESmokePage /> },
      { path: "regression", element: <ComingSoonRoute icon={GitCompare} itemKey="regression" /> },
      { path: "health", element: <ComingSoonRoute icon={HeartPulse} itemKey="health" /> },
      { path: "history", element: <ComingSoonRoute icon={HistoryIcon} itemKey="history" /> },
      { path: "debug", element: <RequestDebugPage /> },
      { path: "connections", element: <ConnectionsPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];
```

- [ ] **Step 15.4: Replace `web/src/App.tsx`**

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createBrowserRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { routes } from "@/router";

const router = createBrowserRouter(routes);
const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={150}>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
```

- [ ] **Step 15.5: Smoke check — every route resolves**

```bash
pnpm dev
```
In the browser at <http://localhost:5173>, click each sidebar item:
- `/load-test`, `/e2e`, `/debug`, `/connections`, `/settings` show their stub PageHeader.
- `/soak`, `/streaming`, `/regression`, `/health`, `/history` show the ComingSoon page with a working "Back to Load Test" button.
- Manually visit a bogus path like `/nonsense` — the 404 page shows.
- Open the theme dropdown in the page header; cycling Light / Dark / System changes the page's appearance with no flash on reload.
- Set browser language preference to Chinese and reload (or run `useLocaleStore.getState().setLocale("zh-CN")` in the console) — sidebar copy switches to 中文.
- Click a group header in the sidebar; the items collapse and the chevron rotates. Reload the page; the collapse state persists.

Stop the server.

- [ ] **Step 15.6: Run lint and type-check**

```bash
pnpm lint
pnpm type-check
```
Expected: zero errors.

- [ ] **Step 15.7: Commit**

```bash
git add -A
git commit -m "feat: wire router with all nine routes, AppShell, stub pages, and 404"
```

### Phase 2 completion check

- [ ] Sidebar shows 4 groups with the correct items in both languages.
- [ ] Five Coming Soon routes show the placeholder page with a back link.
- [ ] Theme dropdown applies Light / Dark / System without flash on reload.
- [ ] Locale store toggles English ↔ Chinese on the sidebar.
- [ ] Group collapse persists across reload.
- [ ] `pnpm lint`, `pnpm type-check`, `pnpm test` all exit 0.

---

## Phase 3 — Connections Subsystem

Phase goal: a fully working Connections library — types, zod schema, the `ConnectionsStore` interface and its `LocalStorageConnectionsStore` implementation (TDD), the `/connections` management page with create / edit / delete / import / export, and the `EndpointSelector` component used by every implemented tab in Phase 4. By phase end, the user can populate a library of endpoints and observe per-tab `selectedConnectionId` independence.

### Task 16: Connection type and zod schema

**Files:**
- Create: `web/src/types/connection.ts`, `web/src/features/connections/schema.ts`, `web/src/features/connections/schema.test.ts`

- [ ] **Step 16.1: Create `web/src/types/connection.ts`**

```ts
export interface Connection {
  id: string;
  name: string;
  apiUrl: string;
  apiKey: string;
  model: string;
  customHeaders: string;
  queryParams: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectionsExport {
  version: 1;
  connections: Connection[];
}
```

- [ ] **Step 16.2: Write failing tests for the input schema**

Create `web/src/features/connections/schema.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { connectionInputSchema } from "./schema";

describe("connectionInputSchema", () => {
  const valid = {
    name: "prod-vllm",
    apiUrl: "http://10.0.0.1:8000/v1/chat/completions",
    apiKey: "sk-abc",
    model: "qwen-2.5-7b",
    customHeaders: "",
    queryParams: "",
  };

  it("accepts a valid input", () => {
    expect(connectionInputSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects empty name", () => {
    const r = connectionInputSchema.safeParse({ ...valid, name: " " });
    expect(r.success).toBe(false);
  });

  it("rejects invalid URL", () => {
    const r = connectionInputSchema.safeParse({ ...valid, apiUrl: "not-a-url" });
    expect(r.success).toBe(false);
  });

  it("rejects empty apiKey", () => {
    const r = connectionInputSchema.safeParse({ ...valid, apiKey: "" });
    expect(r.success).toBe(false);
  });

  it("rejects empty model", () => {
    const r = connectionInputSchema.safeParse({ ...valid, model: "" });
    expect(r.success).toBe(false);
  });

  it("normalizes name by trimming", () => {
    const r = connectionInputSchema.safeParse({ ...valid, name: "  staging  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("staging");
  });
});
```

- [ ] **Step 16.3: Run test, expect failure**

```bash
pnpm test schema
```
Expected: failure (file does not exist).

- [ ] **Step 16.4: Implement `web/src/features/connections/schema.ts`**

```ts
import { z } from "zod";

export const connectionInputSchema = z.object({
  name: z
    .string()
    .transform((v) => v.trim())
    .pipe(z.string().min(1, "required")),
  apiUrl: z.string().url("invalid URL"),
  apiKey: z.string().min(1, "required"),
  model: z.string().min(1, "required"),
  customHeaders: z.string(),
  queryParams: z.string(),
});

export type ConnectionInput = z.infer<typeof connectionInputSchema>;
```

- [ ] **Step 16.5: Run test, expect pass**

```bash
pnpm test schema
```
Expected: 6 tests pass.

- [ ] **Step 16.6: Commit**

```bash
git add -A
git commit -m "feat: add Connection type and zod input schema"
```

### Task 17: `ConnectionsStore` interface and `LocalStorageConnectionsStore`

**Files:**
- Create: `web/src/stores/connections-store.ts`, `web/src/stores/connections-store.test.ts`

- [ ] **Step 17.1: Write failing tests**

Create `web/src/stores/connections-store.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { useConnectionsStore } from "./connections-store";

const baseInput = {
  name: "prod",
  apiUrl: "http://x/y",
  apiKey: "sk-1",
  model: "m1",
  customHeaders: "",
  queryParams: "",
};

describe("connectionsStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useConnectionsStore.setState({ connections: [] });
  });

  it("starts empty", () => {
    expect(useConnectionsStore.getState().list()).toEqual([]);
  });

  it("creates a connection with id and timestamps", () => {
    const c = useConnectionsStore.getState().create(baseInput);
    expect(c.id).toBeTruthy();
    expect(c.createdAt).toBeTruthy();
    expect(c.updatedAt).toBe(c.createdAt);
    expect(useConnectionsStore.getState().list()).toHaveLength(1);
  });

  it("rejects duplicate names", () => {
    useConnectionsStore.getState().create(baseInput);
    expect(() => useConnectionsStore.getState().create(baseInput)).toThrow(
      /name.*exists/i,
    );
  });

  it("get returns null for unknown id", () => {
    expect(useConnectionsStore.getState().get("nope")).toBeNull();
  });

  it("update modifies fields and bumps updatedAt", async () => {
    const c = useConnectionsStore.getState().create(baseInput);
    await new Promise((r) => setTimeout(r, 5));
    const updated = useConnectionsStore.getState().update(c.id, { model: "m2" });
    expect(updated.model).toBe("m2");
    expect(updated.updatedAt).not.toBe(c.updatedAt);
  });

  it("update rejects renaming to an existing name on another connection", () => {
    const a = useConnectionsStore.getState().create(baseInput);
    useConnectionsStore.getState().create({ ...baseInput, name: "stage" });
    expect(() =>
      useConnectionsStore.getState().update(a.id, { name: "stage" }),
    ).toThrow(/name.*exists/i);
  });

  it("remove deletes the connection", () => {
    const c = useConnectionsStore.getState().create(baseInput);
    useConnectionsStore.getState().remove(c.id);
    expect(useConnectionsStore.getState().list()).toHaveLength(0);
  });

  it("exportAll produces a versioned envelope", () => {
    useConnectionsStore.getState().create(baseInput);
    const json = useConnectionsStore.getState().exportAll();
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe(1);
    expect(parsed.connections).toHaveLength(1);
  });

  it("importAll merge preserves existing names and skips collisions", () => {
    useConnectionsStore.getState().create(baseInput);
    const incoming = JSON.stringify({
      version: 1,
      connections: [
        { ...baseInput, id: "ext-1", createdAt: "x", updatedAt: "x" },
        { ...baseInput, id: "ext-2", name: "new", createdAt: "x", updatedAt: "x" },
      ],
    });
    const r = useConnectionsStore.getState().importAll(incoming, "merge");
    expect(r.added).toBe(1);
    expect(r.skipped).toBe(1);
    expect(useConnectionsStore.getState().list()).toHaveLength(2);
  });

  it("importAll replace wipes existing", () => {
    useConnectionsStore.getState().create(baseInput);
    const incoming = JSON.stringify({
      version: 1,
      connections: [
        { ...baseInput, id: "ext-1", name: "only", createdAt: "x", updatedAt: "x" },
      ],
    });
    const r = useConnectionsStore.getState().importAll(incoming, "replace");
    expect(r.added).toBe(1);
    expect(useConnectionsStore.getState().list()).toHaveLength(1);
    expect(useConnectionsStore.getState().list()[0].name).toBe("only");
  });

  it("importAll rejects unknown version", () => {
    expect(() =>
      useConnectionsStore
        .getState()
        .importAll(JSON.stringify({ version: 99, connections: [] }), "merge"),
    ).toThrow(/version/i);
  });
});
```

- [ ] **Step 17.2: Run tests, expect failure**

```bash
pnpm test connections-store
```
Expected: failures (file missing).

- [ ] **Step 17.3: Implement `web/src/stores/connections-store.ts`**

```ts
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Connection, ConnectionsExport } from "@/types/connection";

export type ConnectionInputForStore = Omit<
  Connection,
  "id" | "createdAt" | "updatedAt"
>;

export interface ConnectionsStore {
  connections: Connection[];
  list: () => Connection[];
  get: (id: string) => Connection | null;
  create: (input: ConnectionInputForStore) => Connection;
  update: (
    id: string,
    patch: Partial<Omit<Connection, "id" | "createdAt">>,
  ) => Connection;
  remove: (id: string) => void;
  exportAll: () => string;
  importAll: (
    json: string,
    mode: "merge" | "replace",
  ) => { added: number; skipped: number };
}

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `c_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

function nameTaken(list: Connection[], name: string, exceptId?: string): boolean {
  return list.some((c) => c.name === name && c.id !== exceptId);
}

export const useConnectionsStore = create<ConnectionsStore>()(
  persist(
    (set, get) => ({
      connections: [],
      list: () =>
        [...get().connections].sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
        ),
      get: (id) => get().connections.find((c) => c.id === id) ?? null,
      create: (input) => {
        const list = get().connections;
        if (nameTaken(list, input.name)) {
          throw new Error(`Connection name "${input.name}" already exists`);
        }
        const ts = nowIso();
        const c: Connection = {
          ...input,
          id: newId(),
          createdAt: ts,
          updatedAt: ts,
        };
        set({ connections: [...list, c] });
        return c;
      },
      update: (id, patch) => {
        const list = get().connections;
        const existing = list.find((c) => c.id === id);
        if (!existing) throw new Error(`Connection ${id} not found`);
        if (patch.name !== undefined && nameTaken(list, patch.name, id)) {
          throw new Error(`Connection name "${patch.name}" already exists`);
        }
        const updated: Connection = {
          ...existing,
          ...patch,
          id: existing.id,
          createdAt: existing.createdAt,
          updatedAt: nowIso(),
        };
        set({
          connections: list.map((c) => (c.id === id ? updated : c)),
        });
        return updated;
      },
      remove: (id) => {
        set({ connections: get().connections.filter((c) => c.id !== id) });
      },
      exportAll: () => {
        const env: ConnectionsExport = {
          version: 1,
          connections: get().connections,
        };
        return JSON.stringify(env, null, 2);
      },
      importAll: (json, mode) => {
        const parsed = JSON.parse(json) as ConnectionsExport;
        if (parsed.version !== 1) {
          throw new Error(`Unsupported export version: ${parsed.version}`);
        }
        if (mode === "replace") {
          set({ connections: parsed.connections });
          return { added: parsed.connections.length, skipped: 0 };
        }
        const current = [...get().connections];
        let added = 0;
        let skipped = 0;
        for (const incoming of parsed.connections) {
          if (nameTaken(current, incoming.name)) {
            skipped += 1;
            continue;
          }
          current.push({ ...incoming, id: incoming.id || newId() });
          added += 1;
        }
        set({ connections: current });
        return { added, skipped };
      },
    }),
    {
      name: "md.connections.v1",
      partialize: (state) => ({ connections: state.connections }),
    },
  ),
);
```

- [ ] **Step 17.4: Run tests, expect pass**

```bash
pnpm test connections-store
```
Expected: all 11 tests pass.

- [ ] **Step 17.5: Commit**

```bash
git add -A
git commit -m "feat: add ConnectionsStore interface and LocalStorageConnectionsStore (TDD)"
```

### Task 18: shadcn primitives for forms, dialogs, tables

Add the primitives Phase 3 and Phase 4 will reuse heavily.

**Files:**
- Create: `web/src/components/ui/{input,label,textarea,select,dialog,alert-dialog,table,tabs,alert,progress,switch,radio-group,form}.tsx`

- [ ] **Step 18.1: Install Radix dependencies**

```bash
pnpm add @radix-ui/react-dialog@^1 \
  @radix-ui/react-alert-dialog@^1 \
  @radix-ui/react-label@^2 \
  @radix-ui/react-select@^2 \
  @radix-ui/react-tabs@^1 \
  @radix-ui/react-progress@^1 \
  @radix-ui/react-switch@^1 \
  @radix-ui/react-radio-group@^1
```

- [ ] **Step 18.2: Create primitives**

Run the following to fetch each canonical shadcn file. If offline, copy the corresponding file from <https://ui.shadcn.com/docs/components/>.

```bash
for c in input label textarea select dialog alert-dialog table tabs alert progress switch radio-group form; do
  curl -fsSL "https://raw.githubusercontent.com/shadcn-ui/ui/main/apps/www/registry/default/ui/${c}.tsx" \
    -o "web/src/components/ui/${c}.tsx"
done
```

After download, open each file and verify:
- Imports use `@/lib/utils` (already correct in upstream).
- The `form.tsx` file imports from `react-hook-form` (a peer dep we already installed).

- [ ] **Step 18.3: Verify type-check**

```bash
pnpm type-check
```
Expected: zero errors.

- [ ] **Step 18.4: Commit**

```bash
git add -A
git commit -m "feat: add shadcn primitives for forms, dialogs, tables, alerts"
```

### Task 19: Connection edit/create dialog

**Files:**
- Create: `web/src/features/connections/ConnectionDialog.tsx`, `web/src/locales/en-US/connections.json`, `web/src/locales/zh-CN/connections.json`
- Modify: `web/src/lib/i18n.ts`

- [ ] **Step 19.1: Add `connections` namespace**

Create `web/src/locales/en-US/connections.json`:
```json
{
  "title": "Connections",
  "subtitle": "A library of named API endpoints. Selected from each tab via the Endpoint dropdown.",
  "table": {
    "name": "Name",
    "apiUrl": "API URL",
    "model": "Model",
    "customHeaders": "Headers",
    "createdAt": "Created",
    "actions": "Actions"
  },
  "dialog": {
    "createTitle": "New connection",
    "editTitle": "Edit connection",
    "fields": {
      "name": "Name",
      "namePlaceholder": "e.g. prod-vllm",
      "apiUrl": "API URL",
      "apiUrlPlaceholder": "http://host:port/v1/chat/completions",
      "apiKey": "API Key",
      "apiKeyPlaceholder": "sk-…",
      "model": "Model",
      "modelPlaceholder": "model-name",
      "customHeaders": "Custom headers (one per line)",
      "customHeadersPlaceholder": "Header-Name: value",
      "queryParams": "Query parameters (one per line)",
      "queryParamsPlaceholder": "key=value"
    },
    "errors": {
      "duplicateName": "A connection with this name already exists",
      "invalidUrl": "Must be a valid URL"
    }
  },
  "actions": {
    "new": "New connection",
    "import": "Import",
    "export": "Export",
    "delete": "Delete",
    "edit": "Edit"
  },
  "delete": {
    "title": "Delete connection",
    "body": "Delete \"{{name}}\"? This cannot be undone.",
    "confirm": "Delete"
  },
  "import": {
    "title": "Import connections",
    "body": "Paste a previously exported JSON or upload a file.",
    "mode": "Mode",
    "merge": "Merge (skip existing names)",
    "replace": "Replace (wipe current library)",
    "submit": "Import",
    "result": "Added {{added}}, skipped {{skipped}}",
    "invalid": "Invalid JSON or unsupported format."
  },
  "empty": {
    "title": "No connections yet",
    "body": "Click New connection to add one.",
    "create": "New connection"
  }
}
```

Create `web/src/locales/zh-CN/connections.json`:
```json
{
  "title": "连接库",
  "subtitle": "已命名的 API 端点集合。在每个测试 tab 顶部的 Endpoint 下拉中选择。",
  "table": {
    "name": "名称",
    "apiUrl": "API URL",
    "model": "模型",
    "customHeaders": "自定义 Headers",
    "createdAt": "创建时间",
    "actions": "操作"
  },
  "dialog": {
    "createTitle": "新建连接",
    "editTitle": "编辑连接",
    "fields": {
      "name": "名称",
      "namePlaceholder": "例如 prod-vllm",
      "apiUrl": "API URL",
      "apiUrlPlaceholder": "http://host:port/v1/chat/completions",
      "apiKey": "API Key",
      "apiKeyPlaceholder": "sk-…",
      "model": "模型",
      "modelPlaceholder": "model-name",
      "customHeaders": "自定义 Headers（每行一条）",
      "customHeadersPlaceholder": "Header-Name: value",
      "queryParams": "查询参数（每行一条）",
      "queryParamsPlaceholder": "key=value"
    },
    "errors": {
      "duplicateName": "已存在同名连接",
      "invalidUrl": "URL 格式无效"
    }
  },
  "actions": {
    "new": "新建连接",
    "import": "导入",
    "export": "导出",
    "delete": "删除",
    "edit": "编辑"
  },
  "delete": {
    "title": "删除连接",
    "body": "确定要删除「{{name}}」吗？该操作无法撤销。",
    "confirm": "删除"
  },
  "import": {
    "title": "导入连接",
    "body": "粘贴之前导出的 JSON 或上传文件。",
    "mode": "模式",
    "merge": "合并（跳过同名）",
    "replace": "替换（清空现有库）",
    "submit": "导入",
    "result": "新增 {{added}} 条，跳过 {{skipped}} 条",
    "invalid": "JSON 无效或格式不支持。"
  },
  "empty": {
    "title": "尚未创建任何连接",
    "body": "点击「新建连接」开始。",
    "create": "新建连接"
  }
}
```

- [ ] **Step 19.2: Register the namespace in `web/src/lib/i18n.ts`**

Add the import and resource entries:
```ts
// at the top
import enConnections from "@/locales/en-US/connections.json";
import zhConnections from "@/locales/zh-CN/connections.json";

// inside resources:
"en-US": { common: enCommon, sidebar: enSidebar, connections: enConnections },
"zh-CN": { common: zhCommon, sidebar: zhSidebar, connections: zhConnections },

// inside ns:
ns: ["common", "sidebar", "connections"],
```

- [ ] **Step 19.3: Create `web/src/features/connections/ConnectionDialog.tsx`**

```tsx
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useConnectionsStore } from "@/stores/connections-store";
import type { Connection } from "@/types/connection";
import { type ConnectionInput, connectionInputSchema } from "./schema";

interface ConnectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connection?: Connection;            // undefined → create mode
  onSaved?: (c: Connection) => void;
}

const empty: ConnectionInput = {
  name: "",
  apiUrl: "",
  apiKey: "",
  model: "",
  customHeaders: "",
  queryParams: "",
};

export function ConnectionDialog({
  open,
  onOpenChange,
  connection,
  onSaved,
}: ConnectionDialogProps) {
  const { t } = useTranslation("connections");
  const { t: tc } = useTranslation("common");
  const create = useConnectionsStore((s) => s.create);
  const update = useConnectionsStore((s) => s.update);
  const [revealKey, setRevealKey] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm<ConnectionInput>({
    resolver: zodResolver(connectionInputSchema),
    defaultValues: empty,
  });

  useEffect(() => {
    if (open) {
      form.reset(connection ?? empty);
      setSubmitError(null);
      setRevealKey(false);
    }
  }, [open, connection, form]);

  const onSubmit = form.handleSubmit((values) => {
    try {
      const saved = connection
        ? update(connection.id, values)
        : create(values);
      onSaved?.(saved);
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : tc("errors.unknown");
      setSubmitError(msg);
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {connection ? t("dialog.editTitle") : t("dialog.createTitle")}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label htmlFor="name">{t("dialog.fields.name")}</Label>
            <Input
              id="name"
              autoComplete="off"
              placeholder={t("dialog.fields.namePlaceholder")}
              {...form.register("name")}
            />
            {form.formState.errors.name ? (
              <p className="mt-1 text-xs text-destructive">{tc("errors.required")}</p>
            ) : null}
          </div>

          <div>
            <Label htmlFor="apiUrl">{t("dialog.fields.apiUrl")}</Label>
            <Input
              id="apiUrl"
              autoComplete="off"
              placeholder={t("dialog.fields.apiUrlPlaceholder")}
              {...form.register("apiUrl")}
            />
            {form.formState.errors.apiUrl ? (
              <p className="mt-1 text-xs text-destructive">
                {t("dialog.errors.invalidUrl")}
              </p>
            ) : null}
          </div>

          <div>
            <Label htmlFor="apiKey">{t("dialog.fields.apiKey")}</Label>
            <div className="relative">
              <Input
                id="apiKey"
                autoComplete="off"
                type={revealKey ? "text" : "password"}
                placeholder={t("dialog.fields.apiKeyPlaceholder")}
                {...form.register("apiKey")}
              />
              <button
                type="button"
                onClick={() => setRevealKey((v) => !v)}
                className="absolute inset-y-0 right-2 flex items-center text-muted-foreground hover:text-foreground"
                aria-label={revealKey ? "hide" : "show"}
              >
                {revealKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {form.formState.errors.apiKey ? (
              <p className="mt-1 text-xs text-destructive">{tc("errors.required")}</p>
            ) : null}
          </div>

          <div>
            <Label htmlFor="model">{t("dialog.fields.model")}</Label>
            <Input
              id="model"
              autoComplete="off"
              placeholder={t("dialog.fields.modelPlaceholder")}
              {...form.register("model")}
            />
            {form.formState.errors.model ? (
              <p className="mt-1 text-xs text-destructive">{tc("errors.required")}</p>
            ) : null}
          </div>

          <div>
            <Label htmlFor="customHeaders">{t("dialog.fields.customHeaders")}</Label>
            <Textarea
              id="customHeaders"
              rows={3}
              placeholder={t("dialog.fields.customHeadersPlaceholder")}
              {...form.register("customHeaders")}
            />
          </div>

          <div>
            <Label htmlFor="queryParams">{t("dialog.fields.queryParams")}</Label>
            <Textarea
              id="queryParams"
              rows={2}
              placeholder={t("dialog.fields.queryParamsPlaceholder")}
              {...form.register("queryParams")}
            />
          </div>

          {submitError ? (
            <p className="text-sm text-destructive">
              {submitError.toLowerCase().includes("exists")
                ? t("dialog.errors.duplicateName")
                : submitError}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {tc("actions.cancel")}
            </Button>
            <Button type="submit">{tc("actions.save")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 19.4: Commit**

```bash
git add -A
git commit -m "feat: add Connection create/edit dialog with masked API key"
```

### Task 20: Connections page (table, delete confirm)

**Files:**
- Create: `web/src/features/connections/ConnectionsImportDialog.tsx`
- Modify: `web/src/features/connections/ConnectionsPage.tsx`

- [ ] **Step 20.1: Create `web/src/features/connections/ConnectionsImportDialog.tsx`**

```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { useConnectionsStore } from "@/stores/connections-store";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ConnectionsImportDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation("connections");
  const { t: tc } = useTranslation("common");
  const importAll = useConnectionsStore((s) => s.importAll);
  const [json, setJson] = useState("");
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ added: number; skipped: number } | null>(null);

  const onSubmit = () => {
    setError(null);
    setResult(null);
    try {
      const r = importAll(json, mode);
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("import.invalid"));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setJson("");
          setError(null);
          setResult(null);
        }
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("import.title")}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t("import.body")}</p>

        <div>
          <Label htmlFor="import-file" className="text-sm">
            {tc("actions.import")} (file)
          </Label>
          <input
            id="import-file"
            type="file"
            accept="application/json,.json"
            className="block w-full text-sm"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) setJson(await file.text());
            }}
          />
        </div>

        <Textarea
          rows={8}
          className="font-mono text-xs"
          placeholder='{"version":1,"connections":[…]}'
          value={json}
          onChange={(e) => setJson(e.target.value)}
        />

        <div>
          <Label className="text-sm">{t("import.mode")}</Label>
          <RadioGroup
            value={mode}
            onValueChange={(v) => setMode(v as "merge" | "replace")}
            className="mt-2"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem id="m-merge" value="merge" />
              <Label htmlFor="m-merge" className="font-normal">{t("import.merge")}</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem id="m-replace" value="replace" />
              <Label htmlFor="m-replace" className="font-normal">{t("import.replace")}</Label>
            </div>
          </RadioGroup>
        </div>

        {result ? (
          <p className="text-sm text-success">
            {t("import.result", { added: result.added, skipped: result.skipped })}
          </p>
        ) : null}
        {error ? <p className="text-sm text-destructive">{t("import.invalid")}</p> : null}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {tc("actions.cancel")}
          </Button>
          <Button onClick={onSubmit} disabled={!json.trim()}>
            {t("import.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 20.2: Replace `web/src/features/connections/ConnectionsPage.tsx`**

```tsx
import { format } from "date-fns";
import { Database, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useConnectionsStore } from "@/stores/connections-store";
import type { Connection } from "@/types/connection";
import { ConnectionDialog } from "./ConnectionDialog";
import { ConnectionsImportDialog } from "./ConnectionsImportDialog";

export function ConnectionsPage() {
  const { t } = useTranslation("connections");
  const { t: tc } = useTranslation("common");
  const list = useConnectionsStore((s) => s.list());
  const removeConn = useConnectionsStore((s) => s.remove);
  const exportAll = useConnectionsStore((s) => s.exportAll);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Connection | undefined>(undefined);
  const [importOpen, setImportOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Connection | null>(null);

  const onExport = () => {
    const blob = new Blob([exportAll()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `modeldoctor-connections-${format(new Date(), "yyyy-MM-dd")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        rightSlot={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              {t("actions.import")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onExport}
              disabled={list.length === 0}
            >
              {t("actions.export")}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setEditing(undefined);
                setDialogOpen(true);
              }}
            >
              {t("actions.new")}
            </Button>
          </div>
        }
      />

      <div className="px-8 py-6">
        {list.length === 0 ? (
          <EmptyState
            icon={Database}
            title={t("empty.title")}
            body={t("empty.body")}
            actions={
              <Button
                size="sm"
                onClick={() => {
                  setEditing(undefined);
                  setDialogOpen(true);
                }}
              >
                {t("empty.create")}
              </Button>
            }
          />
        ) : (
          <div className="rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("table.name")}</TableHead>
                  <TableHead>{t("table.apiUrl")}</TableHead>
                  <TableHead>{t("table.model")}</TableHead>
                  <TableHead>{t("table.customHeaders")}</TableHead>
                  <TableHead>{t("table.createdAt")}</TableHead>
                  <TableHead className="w-[120px] text-right">
                    {t("table.actions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="font-mono text-xs">{c.apiUrl}</TableCell>
                    <TableCell className="font-mono text-xs">{c.model}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {c.customHeaders ? c.customHeaders.split("\n")[0] + "…" : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {format(new Date(c.createdAt), "yyyy-MM-dd HH:mm")}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("actions.edit")}
                        onClick={() => {
                          setEditing(c);
                          setDialogOpen(true);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("actions.delete")}
                        onClick={() => setPendingDelete(c)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <ConnectionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        connection={editing}
      />
      <ConnectionsImportDialog open={importOpen} onOpenChange={setImportOpen} />

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => {
          if (!o) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("delete.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("delete.body", { name: pendingDelete?.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDelete) removeConn(pendingDelete.id);
                setPendingDelete(null);
              }}
            >
              {t("delete.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
```

- [ ] **Step 20.3: Smoke check**

```bash
pnpm dev
```
Visit `/connections`:
- Empty state shows with the create CTA.
- Click "New connection" → dialog opens. Submit empty → field errors render. Fill values → save → row appears.
- Open dialog again with same name → submit → "duplicate name" error.
- Edit pencil → values pre-populate; change model and save → row updates.
- Delete trash → confirm dialog → confirm → row removed.
- Export downloads `modeldoctor-connections-…json`.
- Import the same JSON in merge mode → "added 0, skipped 1".
- Switch language to 中文 → all copy localized.

Stop the server.

- [ ] **Step 20.4: Commit**

```bash
git add -A
git commit -m "feat: implement Connections page with CRUD, delete confirm, import/export"
```

### Task 21: EndpointSelector component

**Files:**
- Create: `web/src/components/connection/EndpointSelector.tsx`

The selector is wired into the three implemented tabs in Phase 4. It exposes a controlled API: parent owns `selectedConnectionId` and an `onChange` callback, plus optional "modified" state hooks.

- [ ] **Step 21.1: Create `web/src/components/connection/EndpointSelector.tsx`**

```tsx
import { ChevronDown, MoreHorizontal, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ConnectionDialog } from "@/features/connections/ConnectionDialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConnectionsStore } from "@/stores/connections-store";
import type { Connection } from "@/types/connection";

const MANUAL = "__manual__";

export interface EndpointSelectorProps {
  selectedId: string | null;
  modified?: boolean;
  onSelect: (id: string | null) => void;
  onSaveCurrent?: () => void;     // "Save" — write current form back to selected connection
  onSaveAsNew?: (name: string) => Connection;
}

export function EndpointSelector({
  selectedId,
  modified,
  onSelect,
  onSaveCurrent,
  onSaveAsNew,
}: EndpointSelectorProps) {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const list = useConnectionsStore((s) => s.list());
  const [createOpen, setCreateOpen] = useState(false);
  const [namePromptOpen, setNamePromptOpen] = useState(false);
  const [draftName, setDraftName] = useState("");

  const currentValue = selectedId ?? MANUAL;

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1">
        <Select
          value={currentValue}
          onValueChange={(v) => onSelect(v === MANUAL ? null : v)}
        >
          <SelectTrigger className="h-8 min-w-[180px] text-xs">
            <SelectValue placeholder={t("endpoint.label")} />
            <ChevronDown className="h-3 w-3 opacity-60" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={MANUAL}>{t("endpoint.manual")}</SelectItem>
            {list.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {modified ? (
          <span
            aria-label={t("endpoint.modified")}
            title={t("endpoint.modified")}
            className="h-2 w-2 rounded-full bg-warning"
          />
        ) : null}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="more">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            disabled={!selectedId || !modified || !onSaveCurrent}
            onClick={() => onSaveCurrent?.()}
          >
            {t("actions.save")}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!onSaveAsNew}
            onClick={() => {
              setDraftName("");
              setNamePromptOpen(true);
            }}
          >
            {t("actions.saveAsNew")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => navigate("/connections")}>
            {t("actions.manageConnections")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button variant="outline" size="icon" onClick={() => setCreateOpen(true)} aria-label="new connection">
        <Plus className="h-4 w-4" />
      </Button>
      <ConnectionDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={(c) => onSelect(c.id)}
      />

      {namePromptOpen ? (
        <NamePrompt
          value={draftName}
          onChange={setDraftName}
          onCancel={() => setNamePromptOpen(false)}
          onSubmit={() => {
            const created = onSaveAsNew?.(draftName.trim());
            if (created) onSelect(created.id);
            setNamePromptOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function NamePrompt({
  value,
  onChange,
  onCancel,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="absolute right-8 top-16 z-50 flex w-72 items-center gap-2 rounded-md border border-border bg-card p-2 shadow-md">
      <input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="connection-name"
        className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs"
      />
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      <Button size="sm" onClick={onSubmit} disabled={!value.trim()}>
        Save
      </Button>
    </div>
  );
}
```

- [ ] **Step 21.2: Commit**

```bash
git add -A
git commit -m "feat: add EndpointSelector with select / save / save-as-new / manage actions"
```

### Phase 3 completion check

- [ ] All 17 connections-store tests pass.
- [ ] All 6 schema tests pass.
- [ ] `/connections` supports full CRUD; duplicate names rejected with localized error.
- [ ] Export downloads a `version: 1` JSON; import in merge and replace modes both behave correctly.
- [ ] EndpointSelector renders in isolation and exposes the documented props (Phase 4 tabs will wire it in).
- [ ] `pnpm lint`, `pnpm type-check`, `pnpm test` all exit 0.

---

## Phase 4 — Three Implemented Tabs

Phase goal: replace the three stub pages with full implementations, port the curl parser to TypeScript with tests, and add the single new backend route `POST /api/debug/proxy`. By phase end, the user can run a real Vegeta load test, run E2E probes, and round-trip arbitrary HTTP requests through the debug proxy.

### Task 22: Migrate curl parser to TypeScript (TDD)

**Files:**
- Create: `web/src/lib/curl-parser.ts`, `web/src/lib/curl-parser.test.ts`

The legacy `public/pages/shared-config.js` had a `parseCurlCommand` and a `detectApiType`. Re-implement both as pure TS functions with tests for each pattern the legacy code handled.

- [ ] **Step 22.1: Write failing tests**

```ts
import { describe, expect, it } from "vitest";
import { detectApiType, parseCurlCommand } from "./curl-parser";

describe("parseCurlCommand", () => {
  it("extracts URL", () => {
    const r = parseCurlCommand(`curl http://x.test/v1/chat/completions`);
    expect(r.url).toBe("http://x.test/v1/chat/completions");
  });

  it("extracts URL with quoted form", () => {
    const r = parseCurlCommand(`curl 'https://x.test/path'`);
    expect(r.url).toBe("https://x.test/path");
  });

  it("strips query params and surfaces them separately", () => {
    const r = parseCurlCommand(`curl 'https://x.test/path?a=1&b=2'`);
    expect(r.url).toBe("https://x.test/path");
    expect(r.queryParams).toBe("a=1\nb=2");
  });

  it("extracts headers via -H", () => {
    const r = parseCurlCommand(
      `curl https://x.test -H "Authorization: Bearer sk-1" -H "X-Foo: bar"`,
    );
    expect(r.headers["authorization"].value).toBe("Bearer sk-1");
    expect(r.headers["x-foo"].value).toBe("bar");
  });

  it("extracts JSON body via -d single-quoted", () => {
    const r = parseCurlCommand(
      `curl https://x.test -d '{"model":"m","messages":[]}'`,
    );
    expect(r.body).toEqual({ model: "m", messages: [] });
  });

  it("extracts JSON body via --data-raw double-quoted", () => {
    const r = parseCurlCommand(
      `curl https://x.test --data-raw "{\\"a\\":1}"`,
    );
    expect(r.body).toEqual({ a: 1 });
  });

  it("supports backslash-newline continuations", () => {
    const r = parseCurlCommand(
      `curl http://x.test \\
  -H "Authorization: Bearer sk-1" \\
  -d '{"a":1}'`,
    );
    expect(r.url).toBe("http://x.test");
    expect(r.headers["authorization"].value).toBe("Bearer sk-1");
    expect(r.body).toEqual({ a: 1 });
  });
});

describe("detectApiType", () => {
  it("detects images by URL", () => {
    expect(detectApiType("https://x/v1/images/generations", null)).toBe("images");
  });
  it("detects embeddings by URL", () => {
    expect(detectApiType("https://x/v1/embeddings", null)).toBe("embeddings");
  });
  it("detects rerank by URL", () => {
    expect(detectApiType("https://x/rerank", null)).toBe("rerank");
  });
  it("detects rerank by body when URL is generic", () => {
    expect(detectApiType("https://x/foo", { query: "q", texts: ["a"] })).toBe("rerank");
  });
  it("detects images by body", () => {
    expect(detectApiType("https://x/foo", { prompt: "cat" })).toBe("images");
  });
  it("detects embeddings by body", () => {
    expect(detectApiType("https://x/foo", { input: "hello" })).toBe("embeddings");
  });
  it("falls back to chat", () => {
    expect(detectApiType("https://x/foo", { messages: [] })).toBe("chat");
  });
});
```

- [ ] **Step 22.2: Run tests, expect failure**

```bash
pnpm test curl-parser
```
Expected: failures.

- [ ] **Step 22.3: Implement `web/src/lib/curl-parser.ts`**

```ts
export interface ParsedCurl {
  url: string;
  headers: Record<string, { originalKey: string; value: string }>;
  body: Record<string, unknown> | null;
  queryParams: string;
}

export type ApiType =
  | "chat"
  | "embeddings"
  | "rerank"
  | "images"
  | "chat-vision"
  | "chat-audio";

export function parseCurlCommand(input: string): ParsedCurl {
  const result: ParsedCurl = { url: "", headers: {}, body: null, queryParams: "" };
  const cmd = input.replace(/\\\s*\n/g, " ").trim().replace(/^curl\s+/, "");

  const urlMatch = cmd.match(/(?:^|\s)(['"]?)(https?:\/\/[^\s'"]+)\1/);
  if (urlMatch) result.url = urlMatch[2];

  if (result.url) {
    try {
      const u = new URL(result.url);
      if (u.search) {
        const parts: string[] = [];
        u.searchParams.forEach((v, k) => parts.push(`${k}=${v}`));
        result.queryParams = parts.join("\n");
        u.search = "";
        result.url = u.toString().replace(/\/$/, (m) =>
          result.url.endsWith("/") ? m : "",
        );
      }
    } catch {
      /* leave as-is */
    }
  }

  const hRe = /(?:-H|--header)\s+['"]([^'"]+)['"]/g;
  for (let m = hRe.exec(cmd); m !== null; m = hRe.exec(cmd)) {
    const colon = m[1].indexOf(":");
    if (colon > 0) {
      const key = m[1].slice(0, colon).trim();
      const value = m[1].slice(colon + 1).trim();
      result.headers[key.toLowerCase()] = { originalKey: key, value };
    }
  }

  const bodySingle = cmd.match(/(?:-d|--data-raw|--data)\s+'([\s\S]*?)(?:(?<!\\)')/);
  if (bodySingle) {
    try {
      result.body = JSON.parse(bodySingle[1]);
    } catch {
      try {
        result.body = JSON.parse(bodySingle[1].replace(/\\'/g, "'"));
      } catch { /* swallow */ }
    }
  }
  if (!result.body) {
    const bodyDouble = cmd.match(/(?:-d|--data-raw|--data)\s+"([\s\S]*?)(?:(?<!\\)")/);
    if (bodyDouble) {
      try {
        result.body = JSON.parse(bodyDouble[1].replace(/\\"/g, '"'));
      } catch { /* swallow */ }
    }
  }

  return result;
}

export function detectApiType(url: string, body: Record<string, unknown> | null): ApiType {
  if (url.includes("/images/generations")) return "images";
  if (url.includes("/embeddings")) return "embeddings";
  if (url.includes("/rerank")) return "rerank";
  if (body) {
    if ("query" in body && "texts" in body) return "rerank";
    if ("prompt" in body && !("messages" in body)) return "images";
    if ("input" in body && !("messages" in body)) return "embeddings";
  }
  return "chat";
}
```

- [ ] **Step 22.4: Run tests, expect pass**

```bash
pnpm test curl-parser
```
Expected: 14 tests pass.

- [ ] **Step 22.5: Commit**

```bash
git add -A
git commit -m "feat: port curl parser to TypeScript (TDD)"
```

### Task 23: API client utility

**Files:**
- Create: `web/src/lib/api-client.ts`

- [ ] **Step 23.1: Create `web/src/lib/api-client.ts`**

```ts
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new ApiError(res.status, text || `HTTP ${res.status}`);
    }
  }
  if (!res.ok) {
    const message =
      (data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : null) ?? `HTTP ${res.status}`;
    throw new ApiError(res.status, message);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
};
```

- [ ] **Step 23.2: Commit**

```bash
git add web/src/lib/api-client.ts
git commit -m "feat: add api-client utility with ApiError"
```

### Task 24: Load Test — slice, schemas, page header wiring

**Files:**
- Create: `web/src/features/load-test/store.ts`, `web/src/features/load-test/schemas.ts`, `web/src/features/load-test/types.ts`, `web/src/locales/en-US/load-test.json`, `web/src/locales/zh-CN/load-test.json`
- Modify: `web/src/lib/i18n.ts`

- [ ] **Step 24.1: Create `web/src/features/load-test/types.ts`**

```ts
export const API_TYPES = [
  "chat",
  "embeddings",
  "rerank",
  "images",
  "chat-vision",
  "chat-audio",
] as const;

export type ApiType = (typeof API_TYPES)[number];

export interface LoadTestParsed {
  requests: number | null;
  success: number | null;
  throughput: number | null;
  latencies: {
    mean: string | null;
    p50: string | null;
    p95: string | null;
    p99: string | null;
    max: string | null;
  };
}

export interface LoadTestResult {
  report: string;
  parsed: LoadTestParsed;
  config: Record<string, unknown>;
}
```

- [ ] **Step 24.2: Create `web/src/features/load-test/schemas.ts`**

```ts
import { z } from "zod";

export const chatSchema = z.object({
  prompt: z.string().min(1),
  maxTokens: z.coerce.number().int().min(1).max(32000),
  temperature: z.coerce.number().min(0).max(2),
  stream: z.boolean(),
});

export const embeddingsSchema = z.object({
  embeddingInput: z.string().min(1),
});

export const rerankSchema = z.object({
  rerankQuery: z.string().min(1),
  rerankTexts: z.string().min(1),
});

export const imagesSchema = z.object({
  imagePrompt: z.string().min(1),
  imageSize: z.string(),
  imageN: z.coerce.number().int().min(1).max(4),
});

export const chatVisionSchema = z.object({
  imageUrl: z.string().min(1),
  prompt: z.string().min(1),
  systemPrompt: z.string(),
  maxTokens: z.coerce.number().int().min(1).max(32000),
  temperature: z.coerce.number().min(0).max(2),
});

export const chatAudioSchema = z.object({
  prompt: z.string().min(1),
  systemPrompt: z.string(),
});

export const attackSchema = z.object({
  rate: z.coerce.number().int().min(1).max(10000),
  duration: z.coerce.number().int().min(1).max(3600),
});

export type ChatParams = z.infer<typeof chatSchema>;
export type EmbeddingsParams = z.infer<typeof embeddingsSchema>;
export type RerankParams = z.infer<typeof rerankSchema>;
export type ImagesParams = z.infer<typeof imagesSchema>;
export type ChatVisionParams = z.infer<typeof chatVisionSchema>;
export type ChatAudioParams = z.infer<typeof chatAudioSchema>;
export type AttackParams = z.infer<typeof attackSchema>;
```

- [ ] **Step 24.3: Create `web/src/features/load-test/store.ts`**

```ts
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ApiType, LoadTestResult } from "./types";

export interface LoadTestSlice {
  selectedConnectionId: string | null;
  modified: boolean;
  apiType: ApiType;
  chat: { prompt: string; maxTokens: number; temperature: number; stream: boolean };
  embeddings: { embeddingInput: string };
  rerank: { rerankQuery: string; rerankTexts: string };
  images: { imagePrompt: string; imageSize: string; imageN: number };
  chatVision: {
    imageUrl: string; prompt: string; systemPrompt: string;
    maxTokens: number; temperature: number;
  };
  chatAudio: { prompt: string; systemPrompt: string };
  attack: { rate: number; duration: number };
  curlExpanded: boolean;
  curlInput: string;
  lastResult: LoadTestResult | null;
  setSelected: (id: string | null) => void;
  setModified: (m: boolean) => void;
  setApiType: (t: ApiType) => void;
  patch: <K extends keyof Omit<LoadTestSlice, never>>(key: K, value: LoadTestSlice[K]) => void;
  setLastResult: (r: LoadTestResult | null) => void;
}

const defaults = {
  selectedConnectionId: null,
  modified: false,
  apiType: "chat" as ApiType,
  chat: { prompt: "", maxTokens: 1000, temperature: 0.7, stream: false },
  embeddings: { embeddingInput: "" },
  rerank: { rerankQuery: "", rerankTexts: "" },
  images: { imagePrompt: "", imageSize: "1024x1024", imageN: 1 },
  chatVision: {
    imageUrl: "", prompt: "", systemPrompt: "",
    maxTokens: 256, temperature: 0,
  },
  chatAudio: { prompt: "", systemPrompt: "" },
  attack: { rate: 2, duration: 60 },
  curlExpanded: false,
  curlInput: "",
  lastResult: null as LoadTestResult | null,
};

export const useLoadTestStore = create<LoadTestSlice>()(
  persist(
    (set) => ({
      ...defaults,
      setSelected: (id) => set({ selectedConnectionId: id, modified: false }),
      setModified: (m) => set({ modified: m }),
      setApiType: (t) => set({ apiType: t }),
      patch: (key, value) => set({ [key]: value } as Partial<LoadTestSlice>),
      setLastResult: (r) => set({ lastResult: r }),
    }),
    { name: "md.load-test.v1" },
  ),
);
```

- [ ] **Step 24.4: Create `web/src/locales/en-US/load-test.json`**

```json
{
  "title": "Load Test",
  "subtitle": "Measure throughput and latency under sustained QPS.",
  "sections": {
    "request": "Request",
    "parameters": "Parameters",
    "attack": "Attack",
    "results": "Results"
  },
  "fields": {
    "apiType": "API type",
    "prompt": "User prompt",
    "maxTokens": "Max tokens",
    "temperature": "Temperature",
    "stream": "Stream",
    "embeddingInput": "Input text",
    "rerankQuery": "Query",
    "rerankTexts": "Texts (one per line)",
    "imagePrompt": "Prompt",
    "imageSize": "Size",
    "imageN": "Number",
    "imageUrl": "Image URL or data URL",
    "systemPrompt": "System prompt",
    "rate": "Rate (QPS)",
    "duration": "Duration (s)"
  },
  "curl": { "import": "Import from cURL", "parse": "Parse & Fill", "filled": "Filled: {{fields}}" },
  "attack": {
    "start": "Start",
    "running": "Running…",
    "estimated": "About {{requests}} requests over {{seconds}}s"
  },
  "metrics": {
    "totalRequests": "Total Requests",
    "successRate": "Success Rate",
    "throughput": "Throughput",
    "meanLatency": "Mean Latency",
    "p50": "P50",
    "p95": "P95",
    "p99": "P99",
    "maxLatency": "Max Latency"
  },
  "raw": "Detailed report",
  "config": "Test configuration",
  "alerts": { "success": "Load test completed.", "failure": "Load test failed: {{error}}" }
}
```

- [ ] **Step 24.5: Create `web/src/locales/zh-CN/load-test.json`**

```json
{
  "title": "压力测试",
  "subtitle": "在持续 QPS 下测量吞吐和延迟。",
  "sections": {
    "request": "请求",
    "parameters": "参数",
    "attack": "压测",
    "results": "结果"
  },
  "fields": {
    "apiType": "API 类型",
    "prompt": "用户输入",
    "maxTokens": "最大 tokens",
    "temperature": "Temperature",
    "stream": "启用流式",
    "embeddingInput": "输入文本",
    "rerankQuery": "查询",
    "rerankTexts": "文本（每行一条）",
    "imagePrompt": "提示词",
    "imageSize": "尺寸",
    "imageN": "数量",
    "imageUrl": "图片 URL 或 data URL",
    "systemPrompt": "System prompt",
    "rate": "速率 (QPS)",
    "duration": "时长 (秒)"
  },
  "curl": { "import": "从 cURL 导入", "parse": "解析填充", "filled": "已填充：{{fields}}" },
  "attack": {
    "start": "开始",
    "running": "运行中…",
    "estimated": "预计 {{requests}} 个请求，时长 {{seconds}}s"
  },
  "metrics": {
    "totalRequests": "总请求数",
    "successRate": "成功率",
    "throughput": "吞吐",
    "meanLatency": "平均延迟",
    "p50": "P50",
    "p95": "P95",
    "p99": "P99",
    "maxLatency": "最大延迟"
  },
  "raw": "详细报告",
  "config": "测试配置",
  "alerts": { "success": "压测完成。", "failure": "压测失败：{{error}}" }
}
```

- [ ] **Step 24.6: Register the namespace in `web/src/lib/i18n.ts`**

Add `import enLoadTest from "@/locales/en-US/load-test.json";` and Chinese counterpart, add `loadTest: enLoadTest` to each language's resources, add `"load-test"` to `ns: [...]`.

Wait — i18next namespace keys must match the import names used in `useTranslation("load-test")`. Use the dashed form. Update accordingly:

```ts
import enLoadTest from "@/locales/en-US/load-test.json";
import zhLoadTest from "@/locales/zh-CN/load-test.json";

resources: {
  "en-US": { common: enCommon, sidebar: enSidebar, connections: enConnections, "load-test": enLoadTest },
  "zh-CN": { common: zhCommon, sidebar: zhSidebar, connections: zhConnections, "load-test": zhLoadTest },
},
ns: ["common", "sidebar", "connections", "load-test"],
```

- [ ] **Step 24.7: Commit**

```bash
git add -A
git commit -m "feat: add Load Test slice, zod schemas, types, and i18n strings"
```

### Task 25: Load Test — page implementation

**Files:**
- Modify: `web/src/features/load-test/LoadTestPage.tsx`
- Create: `web/src/features/load-test/forms/`*.tsx files (one per apiType), `web/src/features/load-test/CurlImport.tsx`, `web/src/features/load-test/Results.tsx`, `web/src/features/load-test/MetricsGrid.tsx`

This is the largest single task in the plan. Split it into clear sub-files.

- [ ] **Step 25.1: Create `web/src/features/load-test/CurlImport.tsx`**

```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { detectApiType, parseCurlCommand } from "@/lib/curl-parser";
import { useLoadTestStore } from "./store";
import type { ApiType } from "./types";

export function CurlImport() {
  const { t } = useTranslation("load-test");
  const setApiType = useLoadTestStore((s) => s.setApiType);
  const patch = useLoadTestStore((s) => s.patch);
  const curlInput = useLoadTestStore((s) => s.curlInput);
  const [feedback, setFeedback] = useState<string | null>(null);

  const onParse = () => {
    const parsed = parseCurlCommand(curlInput);
    const filled: string[] = [];
    if (parsed.url || parsed.body) {
      const t: ApiType = detectApiType(parsed.url, parsed.body);
      setApiType(t);
      filled.push(`type=${t}`);
    }
    if (parsed.body) {
      if (parsed.body.model) filled.push("model");
      // Parameter-specific fields are populated by the targeted form components
      // when apiType matches; here we only set apiType + record what was found.
    }
    setFeedback(t("curl.filled", { fields: filled.join(", ") }));
    // Persist the curl input so user can re-parse after navigation
    patch("curlInput", curlInput);
  };

  return (
    <div className="space-y-2">
      <Textarea
        rows={5}
        value={curlInput}
        onChange={(e) => patch("curlInput", e.target.value)}
        placeholder={`curl http://example/v1/chat/completions \\\n  -H "Authorization: Bearer sk-…" \\\n  -d '{...}'`}
        className="font-mono text-xs"
      />
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" onClick={onParse}>
          {t("curl.parse")}
        </Button>
        {feedback ? <span className="text-xs text-success">{feedback}</span> : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 25.2: Create `web/src/features/load-test/forms/chat.tsx`**

```tsx
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useLoadTestStore } from "../store";

export function ChatForm() {
  const { t } = useTranslation("load-test");
  const v = useLoadTestStore((s) => s.chat);
  const patch = useLoadTestStore((s) => s.patch);
  const set = (next: Partial<typeof v>) => patch("chat", { ...v, ...next });
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="col-span-2">
        <Label>{t("fields.prompt")}</Label>
        <Textarea
          rows={4}
          value={v.prompt}
          onChange={(e) => set({ prompt: e.target.value })}
        />
      </div>
      <div>
        <Label>{t("fields.maxTokens")}</Label>
        <Input
          type="number"
          value={v.maxTokens}
          onChange={(e) => set({ maxTokens: Number(e.target.value) })}
        />
      </div>
      <div>
        <Label>{t("fields.temperature")}</Label>
        <Input
          type="number"
          step="0.1"
          value={v.temperature}
          onChange={(e) => set({ temperature: Number(e.target.value) })}
        />
      </div>
      <div className="col-span-2 flex items-center gap-2">
        <Switch
          id="lt-stream"
          checked={v.stream}
          onCheckedChange={(b) => set({ stream: b })}
        />
        <Label htmlFor="lt-stream">{t("fields.stream")}</Label>
      </div>
    </div>
  );
}
```

- [ ] **Step 25.3: Create the other five form files**

For each apiType, create the analogous form file under `web/src/features/load-test/forms/`. Follow the exact field set in the spec § 6.1 and the slice fields defined in Task 24.3. Filenames and component names:

- `embeddings.tsx` → `EmbeddingsForm` — single textarea bound to `embeddings.embeddingInput`.
- `rerank.tsx` → `RerankForm` — `rerankQuery` input + `rerankTexts` textarea.
- `images.tsx` → `ImagesForm` — `imagePrompt` textarea, `imageSize` select (`""`, `256x256`, `512x512`, `1024x1024`), `imageN` number 1-4.
- `chat-vision.tsx` → `ChatVisionForm` — `imageUrl` input, `prompt` textarea, `systemPrompt` textarea, `maxTokens` number, `temperature` number.
- `chat-audio.tsx` → `ChatAudioForm` — `prompt` textarea, `systemPrompt` textarea.

Each follows the exact same pattern as `chat.tsx`: pull slice value, render fields, write back via `patch`. Reuse `Input`, `Label`, `Textarea`, `Select` (`SelectTrigger`, `SelectContent`, `SelectItem`, `SelectValue`).

- [ ] **Step 25.4: Create `web/src/features/load-test/MetricsGrid.tsx`**

```tsx
import { useTranslation } from "react-i18next";
import type { LoadTestParsed } from "./types";

interface Metric { label: string; value: string; unit?: string }

export function MetricsGrid({ parsed }: { parsed: LoadTestParsed }) {
  const { t } = useTranslation("load-test");
  const metrics: Metric[] = [
    { label: t("metrics.totalRequests"), value: String(parsed.requests ?? "—") },
    { label: t("metrics.successRate"), value: parsed.success !== null ? parsed.success.toFixed(2) : "—", unit: "%" },
    { label: t("metrics.throughput"), value: parsed.throughput !== null ? parsed.throughput.toFixed(2) : "—", unit: "req/s" },
    { label: t("metrics.meanLatency"), value: parsed.latencies.mean ?? "—" },
    { label: t("metrics.p50"), value: parsed.latencies.p50 ?? "—" },
    { label: t("metrics.p95"), value: parsed.latencies.p95 ?? "—" },
    { label: t("metrics.p99"), value: parsed.latencies.p99 ?? "—" },
    { label: t("metrics.maxLatency"), value: parsed.latencies.max ?? "—" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {metrics.map((m) => (
        <div key={m.label} className="rounded-lg border border-border bg-card p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {m.label}
          </div>
          <div className="mt-1 font-mono text-xl font-semibold tabular-nums">
            {m.value}
            {m.unit ? <span className="ml-1 text-xs text-muted-foreground">{m.unit}</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 25.5: Create `web/src/features/load-test/Results.tsx`**

```tsx
import { AlertCircle, CheckCircle2, Copy } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { MetricsGrid } from "./MetricsGrid";
import type { LoadTestResult } from "./types";

interface Props {
  result: LoadTestResult | null;
  error: string | null;
}

function CopyBlock({ label, text }: { label: string; text: string }) {
  const { t } = useTranslation("common");
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-lg border border-border bg-muted/40">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          <Copy className="h-3 w-3" />
          <span className="ml-1 text-xs">{copied ? t("actions.copied") : t("actions.copy")}</span>
        </Button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed">{text}</pre>
    </div>
  );
}

export function LoadTestResults({ result, error }: Props) {
  const { t } = useTranslation("load-test");
  if (error) {
    return (
      <Alert variant="destructive" className="mt-4">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{t("alerts.failure", { error })}</AlertDescription>
      </Alert>
    );
  }
  if (!result) return null;
  return (
    <div className="mt-4 space-y-4">
      <Alert>
        <CheckCircle2 className="h-4 w-4" />
        <AlertDescription>{t("alerts.success")}</AlertDescription>
      </Alert>
      <MetricsGrid parsed={result.parsed} />
      <CopyBlock label={t("raw")} text={result.report} />
      <CopyBlock label={t("config")} text={JSON.stringify(result.config, null, 2)} />
    </div>
  );
}
```

- [ ] **Step 25.6: Replace `web/src/features/load-test/LoadTestPage.tsx`**

```tsx
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { EndpointSelector } from "@/components/connection/EndpointSelector";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError, api } from "@/lib/api-client";
import { useConnectionsStore } from "@/stores/connections-store";
import { CurlImport } from "./CurlImport";
import { ChatForm } from "./forms/chat";
import { ChatAudioForm } from "./forms/chat-audio";
import { ChatVisionForm } from "./forms/chat-vision";
import { EmbeddingsForm } from "./forms/embeddings";
import { ImagesForm } from "./forms/images";
import { RerankForm } from "./forms/rerank";
import { LoadTestResults } from "./Results";
import { useLoadTestStore } from "./store";
import { API_TYPES, type ApiType, type LoadTestResult } from "./types";

const formByType: Record<ApiType, () => JSX.Element> = {
  chat: ChatForm,
  embeddings: EmbeddingsForm,
  rerank: RerankForm,
  images: ImagesForm,
  "chat-vision": ChatVisionForm,
  "chat-audio": ChatAudioForm,
};

export function LoadTestPage() {
  const { t } = useTranslation("load-test");
  const { t: tc } = useTranslation("common");
  const slice = useLoadTestStore();
  const conns = useConnectionsStore();
  const conn = slice.selectedConnectionId ? conns.get(slice.selectedConnectionId) : null;
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const ActiveForm = formByType[slice.apiType];

  const mutation = useMutation<LoadTestResult, ApiError>({
    mutationFn: async () => {
      if (!conn) throw new ApiError(400, "Select a connection or enter manual values.");
      const body = buildLoadTestBody(slice, conn);
      return api.post("/api/load-test", body);
    },
    onSuccess: (data) => {
      slice.setLastResult(data);
      setProgress(100);
    },
    onError: (e) => setError(e.message),
  });

  const onStart = () => {
    setError(null);
    setProgress(0);
    slice.setLastResult(null);
    const totalMs = slice.attack.duration * 1000;
    const startedAt = Date.now();
    const tick = setInterval(() => {
      const pct = Math.min(99, ((Date.now() - startedAt) / totalMs) * 100);
      setProgress(pct);
      if (mutation.isIdle === false && !mutation.isPending) clearInterval(tick);
    }, 250);
    mutation.mutate(undefined, { onSettled: () => clearInterval(tick) });
  };

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        rightSlot={
          <EndpointSelector
            selectedId={slice.selectedConnectionId}
            modified={slice.modified}
            onSelect={slice.setSelected}
          />
        }
      />
      <div className="space-y-6 px-8 py-6">
        <Section title={t("sections.request")}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t("fields.apiType")}</Label>
                <Select
                  value={slice.apiType}
                  onValueChange={(v) => slice.setApiType(v as ApiType)}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {API_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>{type}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <details
              open={slice.curlExpanded}
              onToggle={(e) =>
                slice.patch("curlExpanded", (e.target as HTMLDetailsElement).open)
              }
            >
              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                {t("curl.import")}
              </summary>
              <div className="mt-2"><CurlImport /></div>
            </details>
          </div>
        </Section>

        <Section title={t("sections.parameters")}>
          <ActiveForm />
        </Section>

        <Section title={t("sections.attack")}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t("fields.rate")}</Label>
              <Input
                type="number"
                value={slice.attack.rate}
                onChange={(e) =>
                  slice.patch("attack", { ...slice.attack, rate: Number(e.target.value) })
                }
              />
            </div>
            <div>
              <Label>{t("fields.duration")}</Label>
              <Input
                type="number"
                value={slice.attack.duration}
                onChange={(e) =>
                  slice.patch("attack", { ...slice.attack, duration: Number(e.target.value) })
                }
              />
            </div>
          </div>
        </Section>

        <div className="flex items-center gap-2">
          <Button onClick={onStart} disabled={mutation.isPending}>
            {mutation.isPending ? t("attack.running") : t("attack.start")}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              slice.setLastResult(null);
              setError(null);
              setProgress(0);
            }}
          >
            {tc("actions.reset")}
          </Button>
        </div>

        {mutation.isPending ? <Progress value={progress} className="h-1" /> : null}

        <LoadTestResults result={slice.lastResult} error={error} />
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

function buildLoadTestBody(s: ReturnType<typeof useLoadTestStore.getState>, conn: import("@/types/connection").Connection) {
  const base = {
    apiType: s.apiType,
    apiUrl: conn.apiUrl,
    apiKey: conn.apiKey,
    model: conn.model,
    customHeaders: conn.customHeaders,
    queryParams: conn.queryParams,
    rate: s.attack.rate,
    duration: s.attack.duration,
  };
  switch (s.apiType) {
    case "chat": return { ...base, ...s.chat };
    case "embeddings": return { ...base, ...s.embeddings };
    case "rerank": return { ...base, ...s.rerank };
    case "images": return { ...base, ...s.images };
    case "chat-vision":
      return {
        ...base,
        visionImageUrl: s.chatVision.imageUrl,
        visionPrompt: s.chatVision.prompt,
        visionSystemPrompt: s.chatVision.systemPrompt,
        visionMaxTokens: s.chatVision.maxTokens,
        visionTemperature: s.chatVision.temperature,
      };
    case "chat-audio":
      return {
        ...base,
        audioPrompt: s.chatAudio.prompt,
        audioSystemPrompt: s.chatAudio.systemPrompt,
      };
  }
}
```

- [ ] **Step 25.7: Smoke check Load Test end-to-end**

```bash
pnpm dev
```

Pre-step: create a `default` connection at `/connections` pointing to a real reachable inference API (or use `httpbin.org/post` with a stub apiType=chat for a smoke run). Then on `/load-test`:
- Switch apiType — the right form swaps.
- Enter a prompt (or other apiType payload).
- Set rate=1, duration=2.
- Click Start. Within ~3s, results appear with metrics, raw report, and config blocks.
- Failure smoke: change URL to a bogus one in the connection, run again. The destructive Alert appears.

If running the actual `/api/load-test` requires a live model server, mock it by hitting any endpoint that returns 200 — vegeta will still produce a usable report.

Stop the server.

- [ ] **Step 25.8: Commit**

```bash
git add -A
git commit -m "feat: implement Load Test tab with form per apiType, attack runner, results"
```

### Task 26: E2E Smoke — slice and page

**Files:**
- Create: `web/src/features/e2e-smoke/store.ts`, `web/src/features/e2e-smoke/types.ts`, `web/src/features/e2e-smoke/ProbeCard.tsx`, `web/src/locales/en-US/e2e.json`, `web/src/locales/zh-CN/e2e.json`
- Modify: `web/src/lib/i18n.ts`, `web/src/features/e2e-smoke/E2ESmokePage.tsx`

- [ ] **Step 26.1: Create `web/src/features/e2e-smoke/types.ts`**

```ts
export type ProbeName = "text" | "image" | "audio";

export interface ProbeCheck { name: string; pass: boolean; info?: string }

export interface ProbeResult {
  pass: boolean;
  latencyMs: number | null;
  checks: ProbeCheck[];
  details: {
    content?: string;
    usage?: { prompt_tokens: number; completion_tokens: number };
    imagePreviewB64?: string;
    imageMime?: string;
    audioB64?: string;
    audioBytes?: number;
    numChoices?: number;
    textReply?: string;
    error?: string;
  };
}
```

- [ ] **Step 26.2: Create `web/src/features/e2e-smoke/store.ts`**

```ts
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ProbeName, ProbeResult } from "./types";

interface E2EState {
  selectedConnectionId: string | null;
  modified: boolean;
  results: Record<ProbeName, ProbeResult | null>;
  running: Record<ProbeName, boolean>;
  setSelected: (id: string | null) => void;
  setRunning: (name: ProbeName, running: boolean) => void;
  setResult: (name: ProbeName, r: ProbeResult | null) => void;
  clearAll: () => void;
}

export const useE2EStore = create<E2EState>()(
  persist(
    (set) => ({
      selectedConnectionId: null,
      modified: false,
      results: { text: null, image: null, audio: null },
      running: { text: false, image: false, audio: false },
      setSelected: (id) => set({ selectedConnectionId: id, modified: false }),
      setRunning: (name, running) =>
        set((s) => ({ running: { ...s.running, [name]: running } })),
      setResult: (name, r) =>
        set((s) => ({ results: { ...s.results, [name]: r } })),
      clearAll: () =>
        set({
          results: { text: null, image: null, audio: null },
          running: { text: false, image: false, audio: false },
        }),
    }),
    { name: "md.e2e.v1" },
  ),
);
```

- [ ] **Step 26.3: Create `web/src/locales/en-US/e2e.json`**

```json
{
  "title": "E2E Smoke",
  "subtitle": "Functional probes across text, image, and audio paths.",
  "probes": {
    "text": { "title": "Text", "path": "thinker (text → text)" },
    "image": { "title": "Image + Text", "path": "vision encoder → thinker" },
    "audio": { "title": "Text → Audio", "path": "thinker → talker → code2wav" }
  },
  "actions": { "run": "Run", "runAll": "Run All", "clear": "Clear results" },
  "meta": { "latency": "{{ms}} ms" }
}
```

And `web/src/locales/zh-CN/e2e.json`:

```json
{
  "title": "E2E Smoke",
  "subtitle": "覆盖文本 / 图像 / 音频路径的功能性 probe。",
  "probes": {
    "text": { "title": "文本", "path": "thinker (text → text)" },
    "image": { "title": "图像 + 文本", "path": "vision encoder → thinker" },
    "audio": { "title": "文本 → 音频", "path": "thinker → talker → code2wav" }
  },
  "actions": { "run": "运行", "runAll": "全部运行", "clear": "清空结果" },
  "meta": { "latency": "{{ms}} ms" }
}
```

Register `e2e` namespace in `web/src/lib/i18n.ts` the same way Task 19.2 added `connections`.

- [ ] **Step 26.4: Create `web/src/features/e2e-smoke/ProbeCard.tsx`**

```tsx
import { Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ProbeName, ProbeResult } from "./types";

interface Props {
  name: ProbeName;
  result: ProbeResult | null;
  running: boolean;
  onRun: () => void;
}

export function ProbeCard({ name, result, running, onRun }: Props) {
  const { t } = useTranslation("e2e");
  const { t: tc } = useTranslation("common");
  const variant: "default" | "warning" | "success" | "destructive" = running
    ? "warning"
    : result === null
      ? "default"
      : result.pass
        ? "success"
        : "destructive";

  const status = running
    ? tc("status.running")
    : result === null
      ? tc("status.idle")
      : result.pass
        ? tc("status.pass")
        : tc("status.fail");

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-border bg-card p-4",
        result?.pass && "border-l-2 border-l-success",
        result && !result.pass && "border-l-2 border-l-destructive",
        running && "border-l-2 border-l-warning",
      )}
    >
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">{t(`probes.${name}.title`)}</h3>
          <p className="font-mono text-[10px] text-muted-foreground">
            {t(`probes.${name}.path`)}
          </p>
        </div>
        <Badge variant={variant}>{status}</Badge>
      </div>

      <Button variant="outline" size="sm" onClick={onRun} disabled={running}>
        {tc("actions.run")}
      </Button>

      {result ? (
        <div className="space-y-2 text-xs">
          <p className="text-muted-foreground">
            {t("meta.latency", { ms: result.latencyMs ?? "—" })}
          </p>
          <ul className="space-y-1 font-mono">
            {result.checks.map((c) => (
              <li
                key={c.name}
                className="flex items-start gap-1"
              >
                {c.pass ? (
                  <Check className="mt-0.5 h-3 w-3 text-success" />
                ) : (
                  <X className="mt-0.5 h-3 w-3 text-destructive" />
                )}
                <span>{c.name}</span>
                {c.info ? (
                  <span className="text-muted-foreground">({c.info})</span>
                ) : null}
              </li>
            ))}
          </ul>
          {result.details.content ? (
            <div className="rounded-md bg-muted/40 px-2 py-1 text-foreground">
              {result.details.content}
            </div>
          ) : null}
          {result.details.imagePreviewB64 ? (
            <img
              alt="probe input"
              src={`data:${result.details.imageMime ?? "image/png"};base64,${result.details.imagePreviewB64}`}
              className="max-w-[120px] rounded-md border border-border"
            />
          ) : null}
          {result.details.audioB64 ? (
            <audio
              controls
              src={`data:audio/wav;base64,${result.details.audioB64}`}
              className="w-full"
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 26.5: Replace `web/src/features/e2e-smoke/E2ESmokePage.tsx`**

```tsx
import { useTranslation } from "react-i18next";
import { EndpointSelector } from "@/components/connection/EndpointSelector";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api-client";
import { useConnectionsStore } from "@/stores/connections-store";
import { ProbeCard } from "./ProbeCard";
import { useE2EStore } from "./store";
import type { ProbeName } from "./types";

interface E2EApiResponse {
  success: boolean;
  results: Array<{ probe: ProbeName } & import("./types").ProbeResult>;
  error?: string;
}

export function E2ESmokePage() {
  const { t } = useTranslation("e2e");
  const slice = useE2EStore();
  const conns = useConnectionsStore();
  const conn = slice.selectedConnectionId ? conns.get(slice.selectedConnectionId) : null;

  const runProbes = async (probes: ProbeName[]) => {
    if (!conn) {
      alert("Please select a connection.");
      return;
    }
    for (const p of probes) slice.setRunning(p, true);
    try {
      const data = await api.post<E2EApiResponse>("/api/e2e-test", {
        apiUrl: conn.apiUrl,
        apiKey: conn.apiKey,
        model: conn.model,
        customHeaders: conn.customHeaders,
        probes,
      });
      if (!data.success) {
        for (const p of probes) {
          slice.setResult(p, {
            pass: false,
            latencyMs: null,
            checks: [{ name: "request", pass: false, info: data.error }],
            details: { error: data.error ?? "unknown" },
          });
        }
        return;
      }
      for (const r of data.results) {
        slice.setResult(r.probe, r);
      }
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "network";
      for (const p of probes) {
        slice.setResult(p, {
          pass: false,
          latencyMs: null,
          checks: [{ name: "request", pass: false, info: msg }],
          details: { error: msg },
        });
      }
    } finally {
      for (const p of probes) slice.setRunning(p, false);
    }
  };

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        rightSlot={
          <EndpointSelector
            selectedId={slice.selectedConnectionId}
            modified={false}
            onSelect={slice.setSelected}
          />
        }
      />
      <div className="space-y-4 px-8 py-6">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {(["text", "image", "audio"] as ProbeName[]).map((p) => (
            <ProbeCard
              key={p}
              name={p}
              result={slice.results[p]}
              running={slice.running[p]}
              onRun={() => runProbes([p])}
            />
          ))}
        </div>
        <div className="flex gap-2">
          <Button onClick={() => runProbes(["text", "image", "audio"])}>
            {t("actions.runAll")}
          </Button>
          <Button variant="ghost" onClick={() => slice.clearAll()}>
            {t("actions.clear")}
          </Button>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 26.6: Smoke check E2E Smoke**

```bash
pnpm dev
```
On `/e2e`:
- Select a connection (any model server you have access to).
- Click each probe's `Run` — text probe completes within seconds. Image and audio depend on the model's modalities.
- Click `Run All` — three cards transition idle → running → pass/fail.
- Click `Clear results` — cards reset to idle.

Stop the server.

- [ ] **Step 26.7: Commit**

```bash
git add -A
git commit -m "feat: implement E2E Smoke tab with probe cards and run-all flow"
```

### Task 27: Backend `POST /api/debug/proxy` route (TDD)

**Files:**
- Create: `src/routes/debug-proxy.js`, `src/routes/debug-proxy.test.js`
- Modify: `server.js`, `package.json`

- [ ] **Step 27.1: Add testing deps to root package**

```bash
pnpm add -D supertest@^7 vitest@^1
```
(`vitest` is already installed; the second pin ensures the same version. Adding it again is a no-op.)

- [ ] **Step 27.2: Add backend test config**

Create `vitest.backend.config.ts` at repo root:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.{js,ts}"],
    globals: true,
  },
});
```

Update root `package.json` `scripts`:
```json
"test:backend": "vitest run --config vitest.backend.config.ts",
```

- [ ] **Step 27.3: Write failing test `src/routes/debug-proxy.test.js`**

```js
const express = require("express");
const bodyParser = require("body-parser");
const request = require("supertest");
const { describe, it, expect, beforeAll, afterAll } = require("vitest");

const debugProxyRouter = require("./debug-proxy");

let server;
let baseUrl;

beforeAll(async () => {
  // Local fake target
  const target = express();
  target.use(bodyParser.json());
  target.post("/echo", (req, res) => {
    res.status(200).json({ youSent: req.body, header: req.headers["x-foo"] });
  });
  target.get("/timeout", () => {
    // Never respond — exercises proxy timeout
  });
  await new Promise((resolve) => {
    server = target.listen(0, () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

afterAll(() => {
  server.close();
});

function makeApp() {
  const app = express();
  app.use(bodyParser.json());
  app.use("/api", debugProxyRouter);
  return app;
}

describe("POST /api/debug/proxy", () => {
  it("forwards body and returns parsed response", async () => {
    const app = makeApp();
    const res = await request(app).post("/api/debug/proxy").send({
      method: "POST",
      url: `${baseUrl}/echo`,
      headers: { "X-Foo": "bar", "Content-Type": "application/json" },
      body: JSON.stringify({ a: 1 }),
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe(200);
    expect(res.body.bodyEncoding).toBe("text");
    const echoed = JSON.parse(res.body.body);
    expect(echoed.youSent).toEqual({ a: 1 });
    expect(echoed.header).toBe("bar");
    expect(typeof res.body.timingMs.totalMs).toBe("number");
  });

  it("returns success:false on timeout", async () => {
    const app = makeApp();
    const res = await request(app).post("/api/debug/proxy").send({
      method: "GET",
      url: `${baseUrl}/timeout`,
      headers: {},
      body: null,
      timeoutMs: 200,
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/timeout|aborted/i);
  });

  it("rejects missing url", async () => {
    const app = makeApp();
    const res = await request(app).post("/api/debug/proxy").send({});
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 27.4: Run test, expect failure**

```bash
pnpm test:backend
```
Expected: failure (file does not exist).

- [ ] **Step 27.5: Implement `src/routes/debug-proxy.js`**

```js
const express = require("express");

const router = express.Router();

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_BODY_BYTES = 20 * 1024 * 1024; // 20 MB

function looksBinary(contentType) {
  if (!contentType) return false;
  if (contentType.startsWith("image/")) return true;
  if (contentType.startsWith("audio/")) return true;
  if (contentType.startsWith("video/")) return true;
  if (contentType === "application/octet-stream") return true;
  return false;
}

router.post("/debug/proxy", async (req, res) => {
  const {
    method = "GET",
    url,
    headers = {},
    body = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = req.body || {};

  if (!url || typeof url !== "string") {
    return res.status(400).json({ success: false, error: "url is required" });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const startedAt = Date.now();
  let ttfbAt = null;

  try {
    const init = {
      method: method.toUpperCase(),
      headers,
      signal: controller.signal,
    };
    if (body !== null && body !== undefined && init.method !== "GET" && init.method !== "HEAD") {
      init.body = body;
    }
    const response = await fetch(url, init);
    ttfbAt = Date.now();

    const contentType = response.headers.get("content-type") || "";
    const buffer = Buffer.from(await response.arrayBuffer());

    if (buffer.byteLength > MAX_BODY_BYTES) {
      return res.json({
        success: false,
        error: `Response body exceeds ${MAX_BODY_BYTES} bytes`,
      });
    }

    const binary = looksBinary(contentType);
    const responseBody = binary
      ? buffer.toString("base64")
      : buffer.toString("utf-8");

    const responseHeaders = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    res.json({
      success: true,
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: responseBody,
      bodyEncoding: binary ? "base64" : "text",
      timingMs: {
        ttfbMs: ttfbAt - startedAt,
        totalMs: Date.now() - startedAt,
      },
      sizeBytes: buffer.byteLength,
    });
  } catch (err) {
    res.json({
      success: false,
      error: err.name === "AbortError" ? "Request timeout / aborted" : String(err.message || err),
    });
  } finally {
    clearTimeout(timer);
  }
});

module.exports = router;
```

- [ ] **Step 27.6: Mount the router in `server.js`**

Replace the placeholder comment in `server.js`:
```js
// debug-proxy router is added in Phase 4 Task 22.
```
with:
```js
const debugProxyRouter = require("./src/routes/debug-proxy");
```
And add `app.use("/api", debugProxyRouter);` after `e2eRouter`.

- [ ] **Step 27.7: Run test, expect pass**

```bash
pnpm test:backend
```
Expected: 3 tests pass.

- [ ] **Step 27.8: Commit**

```bash
git add -A
git commit -m "feat: add /api/debug/proxy route with timing, timeout, binary-body handling (TDD)"
```

### Task 28: Request Debug — slice and i18n

**Files:**
- Create: `web/src/features/request-debug/store.ts`, `web/src/features/request-debug/types.ts`, `web/src/locales/en-US/debug.json`, `web/src/locales/zh-CN/debug.json`
- Modify: `web/src/lib/i18n.ts`

- [ ] **Step 28.1: Create `web/src/features/request-debug/types.ts`**

```ts
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export interface KeyValueRow { key: string; value: string; enabled: boolean }

export interface DebugResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  bodyEncoding: "text" | "base64";
  timingMs: { ttfbMs: number; totalMs: number };
  sizeBytes: number;
}
```

- [ ] **Step 28.2: Create `web/src/features/request-debug/store.ts`**

```ts
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { DebugResponse, HttpMethod, KeyValueRow } from "./types";

interface DebugState {
  selectedConnectionId: string | null;
  curlInput: string;
  method: HttpMethod;
  url: string;
  headers: KeyValueRow[];
  query: KeyValueRow[];
  body: string;
  lastResponse: DebugResponse | null;
  lastError: string | null;
  setSelected: (id: string | null) => void;
  patch: <K extends keyof DebugState>(key: K, value: DebugState[K]) => void;
  setLastResponse: (r: DebugResponse | null) => void;
  setLastError: (e: string | null) => void;
}

export const useDebugStore = create<DebugState>()(
  persist(
    (set) => ({
      selectedConnectionId: null,
      curlInput: "",
      method: "POST",
      url: "",
      headers: [{ key: "Content-Type", value: "application/json", enabled: true }],
      query: [],
      body: "",
      lastResponse: null,
      lastError: null,
      setSelected: (id) => set({ selectedConnectionId: id }),
      patch: (key, value) => set({ [key]: value } as Partial<DebugState>),
      setLastResponse: (r) => set({ lastResponse: r, lastError: null }),
      setLastError: (e) => set({ lastError: e, lastResponse: null }),
    }),
    { name: "md.debug.v1" },
  ),
);
```

- [ ] **Step 28.3: Add `debug` namespace localizations**

`web/src/locales/en-US/debug.json`:
```json
{
  "title": "Request Debug",
  "subtitle": "Send a single request and inspect the full round-trip.",
  "sections": {
    "paste": "Paste curl",
    "request": "Request",
    "response": "Response"
  },
  "fields": {
    "method": "Method",
    "url": "URL",
    "headers": "Headers",
    "body": "Body",
    "query": "Query"
  },
  "actions": { "send": "Send", "clear": "Clear", "format": "Format as JSON" },
  "response": {
    "status": "Status",
    "size": "Size",
    "ttfb": "TTFB",
    "total": "Total",
    "tabs": {
      "body": "Body",
      "headers": "Headers",
      "timing": "Timing",
      "raw": "Raw"
    },
    "download": "Download"
  },
  "empty": {
    "title": "No request yet",
    "body": "Paste a curl command, or select a connection to begin."
  },
  "errors": { "invalidJson": "Invalid JSON — leaving body untouched." }
}
```

`web/src/locales/zh-CN/debug.json`:
```json
{
  "title": "请求调试",
  "subtitle": "发送单次请求并查看完整的往返信息。",
  "sections": {
    "paste": "粘贴 curl",
    "request": "请求",
    "response": "响应"
  },
  "fields": {
    "method": "方法",
    "url": "URL",
    "headers": "Headers",
    "body": "Body",
    "query": "查询参数"
  },
  "actions": { "send": "发送", "clear": "清空", "format": "格式化为 JSON" },
  "response": {
    "status": "状态",
    "size": "大小",
    "ttfb": "TTFB",
    "total": "总耗时",
    "tabs": { "body": "Body", "headers": "Headers", "timing": "耗时", "raw": "原文" },
    "download": "下载"
  },
  "empty": {
    "title": "尚未发送请求",
    "body": "粘贴一条 curl 命令，或选择一个连接开始。"
  },
  "errors": { "invalidJson": "JSON 无效 — Body 未变更。" }
}
```

Register `debug` namespace in `web/src/lib/i18n.ts`.

- [ ] **Step 28.4: Commit**

```bash
git add -A
git commit -m "feat: add Request Debug slice, types, and i18n strings"
```

### Task 29: Request Debug — page implementation

**Files:**
- Create: `web/src/features/request-debug/KeyValueTable.tsx`, `web/src/features/request-debug/ResponseViewer.tsx`
- Modify: `web/src/features/request-debug/RequestDebugPage.tsx`

- [ ] **Step 29.1: Create `web/src/features/request-debug/KeyValueTable.tsx`**

```tsx
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { KeyValueRow } from "./types";

interface Props {
  rows: KeyValueRow[];
  onChange: (rows: KeyValueRow[]) => void;
}

export function KeyValueTable({ rows, onChange }: Props) {
  const update = (i: number, patch: Partial<KeyValueRow>) => {
    const next = rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    onChange(next);
  };
  const remove = (i: number) => onChange(rows.filter((_, idx) => idx !== i));
  const add = () => onChange([...rows, { key: "", value: "", enabled: true }]);

  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2">
          <Switch
            checked={r.enabled}
            onCheckedChange={(b) => update(i, { enabled: b })}
          />
          <Input
            placeholder="key"
            value={r.key}
            onChange={(e) => update(i, { key: e.target.value })}
            className="font-mono text-xs"
          />
          <Input
            placeholder="value"
            value={r.value}
            onChange={(e) => update(i, { value: e.target.value })}
            className="font-mono text-xs"
          />
          <Button variant="ghost" size="icon" onClick={() => remove(i)} aria-label="remove">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button size="sm" variant="outline" onClick={add}>
        + Row
      </Button>
    </div>
  );
}
```

- [ ] **Step 29.2: Create `web/src/features/request-debug/ResponseViewer.tsx`**

```tsx
import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import type { DebugResponse } from "./types";

interface Props {
  response: DebugResponse | null;
  error: string | null;
}

function statusColor(status: number): string {
  if (status >= 500) return "text-destructive";
  if (status >= 400) return "text-warning";
  if (status >= 200 && status < 300) return "text-success";
  return "text-foreground";
}

function renderBody(response: DebugResponse) {
  const ct = response.headers["content-type"] || "";
  if (response.bodyEncoding === "base64") {
    if (ct.startsWith("image/")) {
      return (
        <img
          alt="response"
          src={`data:${ct};base64,${response.body}`}
          className="max-w-full rounded-md border border-border"
        />
      );
    }
    if (ct.startsWith("audio/")) {
      return (
        <audio
          controls
          src={`data:${ct};base64,${response.body}`}
          className="w-full"
        />
      );
    }
    return (
      <BinaryDownload base64={response.body} contentType={ct} />
    );
  }
  // text
  let text = response.body;
  if (ct.includes("application/json")) {
    try {
      text = JSON.stringify(JSON.parse(response.body), null, 2);
    } catch { /* leave as-is */ }
  }
  return (
    <pre className="max-h-[480px] overflow-auto rounded-md bg-muted/40 p-3 font-mono text-xs">
      {text}
    </pre>
  );
}

function BinaryDownload({ base64, contentType }: { base64: string; contentType: string }) {
  const { t } = useTranslation("debug");
  const onDownload = () => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: contentType || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "response.bin";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Button variant="outline" size="sm" onClick={onDownload}>
      <Download className="h-3 w-3" />
      <span className="ml-1">{t("response.download")}</span>
    </Button>
  );
}

export function ResponseViewer({ response, error }: Props) {
  const { t } = useTranslation("debug");
  if (error) {
    return (
      <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
        {error}
      </div>
    );
  }
  if (!response) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <span className={statusColor(response.status)}>
          {t("response.status")}: <span className="font-mono">{response.status} {response.statusText}</span>
        </span>
        <span className="text-muted-foreground">
          {t("response.size")}: <span className="font-mono">{response.sizeBytes}</span> B
        </span>
        <span className="text-muted-foreground">
          {t("response.ttfb")}: <span className="font-mono">{response.timingMs.ttfbMs}</span> ms
        </span>
        <span className="text-muted-foreground">
          {t("response.total")}: <span className="font-mono">{response.timingMs.totalMs}</span> ms
        </span>
      </div>

      <Tabs defaultValue="body">
        <TabsList>
          <TabsTrigger value="body">{t("response.tabs.body")}</TabsTrigger>
          <TabsTrigger value="headers">{t("response.tabs.headers")}</TabsTrigger>
          <TabsTrigger value="timing">{t("response.tabs.timing")}</TabsTrigger>
          <TabsTrigger value="raw">{t("response.tabs.raw")}</TabsTrigger>
        </TabsList>
        <TabsContent value="body">{renderBody(response)}</TabsContent>
        <TabsContent value="headers">
          <table className="w-full text-xs">
            <tbody>
              {Object.entries(response.headers).map(([k, v]) => (
                <tr key={k} className="border-b border-border">
                  <td className="py-1 pr-3 font-mono text-muted-foreground">{k}</td>
                  <td className="py-1 font-mono">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TabsContent>
        <TabsContent value="timing">
          <div className="space-y-1 text-sm">
            <div>TTFB: <span className="font-mono">{response.timingMs.ttfbMs} ms</span></div>
            <div>Total: <span className="font-mono">{response.timingMs.totalMs} ms</span></div>
          </div>
        </TabsContent>
        <TabsContent value="raw">
          <pre className="max-h-[480px] overflow-auto rounded-md bg-muted/40 p-3 font-mono text-xs">
            {response.body}
          </pre>
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 29.3: Replace `web/src/features/request-debug/RequestDebugPage.tsx`**

```tsx
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { EndpointSelector } from "@/components/connection/EndpointSelector";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/api-client";
import { parseCurlCommand } from "@/lib/curl-parser";
import { useConnectionsStore } from "@/stores/connections-store";
import { KeyValueTable } from "./KeyValueTable";
import { ResponseViewer } from "./ResponseViewer";
import { useDebugStore } from "./store";
import type { DebugResponse, HttpMethod } from "./types";

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "DELETE", "PATCH"];

interface ProxyResponse {
  success: boolean;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: string;
  bodyEncoding?: "text" | "base64";
  timingMs?: { ttfbMs: number; totalMs: number };
  sizeBytes?: number;
  error?: string;
}

export function RequestDebugPage() {
  const { t } = useTranslation("debug");
  const { t: tc } = useTranslation("common");
  const slice = useDebugStore();
  const conns = useConnectionsStore();

  const onSelect = (id: string | null) => {
    slice.setSelected(id);
    if (id) {
      const c = conns.get(id);
      if (c) {
        slice.patch("url", c.apiUrl);
        const apiKeyHeader = { key: "Authorization", value: `Bearer ${c.apiKey}`, enabled: true };
        const ctHeader = { key: "Content-Type", value: "application/json", enabled: true };
        slice.patch("headers", [apiKeyHeader, ctHeader]);
      }
    }
  };

  const onParseCurl = () => {
    const parsed = parseCurlCommand(slice.curlInput);
    if (parsed.url) slice.patch("url", parsed.url);
    const headers = Object.entries(parsed.headers).map(([, h]) => ({
      key: h.originalKey,
      value: h.value,
      enabled: true,
    }));
    if (headers.length) slice.patch("headers", headers);
    if (parsed.queryParams) {
      const q = parsed.queryParams.split("\n").map((line) => {
        const [k, ...v] = line.split("=");
        return { key: k, value: v.join("="), enabled: true };
      });
      slice.patch("query", q);
    }
    if (parsed.body) slice.patch("body", JSON.stringify(parsed.body, null, 2));
  };

  const onFormat = () => {
    try {
      slice.patch("body", JSON.stringify(JSON.parse(slice.body), null, 2));
    } catch {
      slice.setLastError(t("errors.invalidJson"));
    }
  };

  const mutation = useMutation<DebugResponse, ApiError>({
    mutationFn: async () => {
      const headers: Record<string, string> = {};
      for (const r of slice.headers) {
        if (r.enabled && r.key) headers[r.key] = r.value;
      }
      let url = slice.url;
      if (slice.query.length) {
        const params = new URLSearchParams();
        for (const r of slice.query) {
          if (r.enabled && r.key) params.set(r.key, r.value);
        }
        const qs = params.toString();
        if (qs) url += (url.includes("?") ? "&" : "?") + qs;
      }
      const proxy = await api.post<ProxyResponse>("/api/debug/proxy", {
        method: slice.method,
        url,
        headers,
        body: ["GET", "HEAD"].includes(slice.method) ? null : slice.body,
      });
      if (!proxy.success || !proxy.headers || !proxy.timingMs) {
        throw new ApiError(proxy.status ?? 0, proxy.error ?? "proxy error");
      }
      return {
        status: proxy.status!,
        statusText: proxy.statusText ?? "",
        headers: proxy.headers,
        body: proxy.body ?? "",
        bodyEncoding: proxy.bodyEncoding ?? "text",
        timingMs: proxy.timingMs,
        sizeBytes: proxy.sizeBytes ?? 0,
      };
    },
    onSuccess: (r) => slice.setLastResponse(r),
    onError: (e) => slice.setLastError(e.message),
  });

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        rightSlot={
          <EndpointSelector
            selectedId={slice.selectedConnectionId}
            modified={false}
            onSelect={onSelect}
          />
        }
      />
      <div className="space-y-6 px-8 py-6">
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-muted-foreground hover:text-foreground">
            {t("sections.paste")}
          </summary>
          <div className="mt-2 space-y-2">
            <Textarea
              rows={5}
              className="font-mono text-xs"
              placeholder={`curl http://example/v1/chat/completions \\\n  -H "Authorization: Bearer …"`}
              value={slice.curlInput}
              onChange={(e) => slice.patch("curlInput", e.target.value)}
            />
            <Button size="sm" onClick={onParseCurl}>{t("actions.send")}</Button>
          </div>
        </details>

        <section className="space-y-3 rounded-lg border border-border bg-card p-4">
          <div className="grid grid-cols-[120px,1fr] gap-3">
            <div>
              <Label>{t("fields.method")}</Label>
              <Select
                value={slice.method}
                onValueChange={(v) => slice.patch("method", v as HttpMethod)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t("fields.url")}</Label>
              <Input
                value={slice.url}
                onChange={(e) => slice.patch("url", e.target.value)}
                className="font-mono text-xs"
              />
            </div>
          </div>

          <Tabs defaultValue="headers">
            <TabsList>
              <TabsTrigger value="headers">{t("fields.headers")}</TabsTrigger>
              <TabsTrigger value="body">{t("fields.body")}</TabsTrigger>
              <TabsTrigger value="query">{t("fields.query")}</TabsTrigger>
            </TabsList>
            <TabsContent value="headers">
              <KeyValueTable rows={slice.headers} onChange={(r) => slice.patch("headers", r)} />
            </TabsContent>
            <TabsContent value="body">
              <div className="space-y-2">
                <Textarea
                  rows={10}
                  className="font-mono text-xs"
                  value={slice.body}
                  onChange={(e) => slice.patch("body", e.target.value)}
                />
                <Button size="sm" variant="outline" onClick={onFormat}>
                  {t("actions.format")}
                </Button>
              </div>
            </TabsContent>
            <TabsContent value="query">
              <KeyValueTable rows={slice.query} onChange={(r) => slice.patch("query", r)} />
            </TabsContent>
          </Tabs>

          <div className="flex gap-2">
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !slice.url}>
              {mutation.isPending ? "…" : t("actions.send")}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                slice.setLastResponse(null);
                slice.setLastError(null);
              }}
            >
              {tc("actions.clear")}
            </Button>
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t("sections.response")}
          </h2>
          {slice.lastResponse || slice.lastError ? (
            <ResponseViewer response={slice.lastResponse} error={slice.lastError} />
          ) : (
            <p className="text-sm text-muted-foreground">{t("empty.body")}</p>
          )}
        </section>
      </div>
    </>
  );
}
```

- [ ] **Step 29.4: Smoke check Request Debug**

```bash
pnpm dev
```
On `/debug`:
- Paste a curl command, click parse — method, URL, headers, body populate.
- Click `Send`. The response section fills with status, headers, body, timing.
- For a JSON response, the Body tab pretty-prints. The Raw tab shows the original.
- For an image endpoint (e.g. `https://httpbin.org/image/png`, set method GET), the Body tab shows the inline image.
- Reload the page — the form state and last response remain (Zustand persist).

Stop the server.

- [ ] **Step 29.5: Commit**

```bash
git add -A
git commit -m "feat: implement Request Debug tab with paste-curl, key/value editor, response viewer"
```

### Phase 4 completion check

- [ ] Curl-parser tests (14) pass.
- [ ] Backend debug-proxy tests (3) pass via `pnpm test:backend`.
- [ ] Load Test page exercises all six apiTypes against a live backend.
- [ ] E2E Smoke page runs probes individually and as Run All.
- [ ] Request Debug page parses curl, sends through proxy, renders JSON / text / image / audio bodies.
- [ ] Each tab's `selectedConnectionId` is independent — switching tabs preserves per-tab selection.
- [ ] `pnpm lint`, `pnpm type-check`, `pnpm test`, `pnpm test:backend` all exit 0.

---

## Phase 5 — Settings, i18n Audit, Final QA

Phase goal: complete the Settings page (Appearance / Environment / Data sections), audit every implemented page for missing i18n strings, perform the visual QA checklist from the spec § 10, and verify the production build serves correctly on a single port.

### Task 30: Settings — i18n strings and Appearance section

**Files:**
- Create: `web/src/locales/en-US/settings.json`, `web/src/locales/zh-CN/settings.json`
- Modify: `web/src/lib/i18n.ts`, `web/src/features/settings/SettingsPage.tsx`

- [ ] **Step 30.1: Create `web/src/locales/en-US/settings.json`**

```json
{
  "title": "Settings",
  "subtitle": "Appearance, environment, and library data.",
  "appearance": {
    "title": "Appearance",
    "theme": "Theme",
    "themeOptions": { "light": "Light", "dark": "Dark", "system": "System" },
    "language": "Language",
    "languages": { "en": "English", "zh": "中文" }
  },
  "environment": {
    "title": "Environment",
    "vegeta": "Vegeta",
    "vegetaCheck": "Check Vegeta",
    "vegetaInstalled": "Installed at {{path}}",
    "vegetaMissing": "Vegeta is not installed. Install via:",
    "version": "Server version",
    "buildMode": "Build mode"
  },
  "data": {
    "title": "Data",
    "exportConnections": "Export connections",
    "importConnections": "Import connections",
    "resetState": "Reset app state",
    "resetWarning": "This deletes every connection, every form value, theme, and locale preference. Are you sure?",
    "resetConfirm": "Reset everything"
  }
}
```

- [ ] **Step 30.2: Create `web/src/locales/zh-CN/settings.json`**

```json
{
  "title": "设置",
  "subtitle": "外观、环境与库数据。",
  "appearance": {
    "title": "外观",
    "theme": "主题",
    "themeOptions": { "light": "浅色", "dark": "深色", "system": "跟随系统" },
    "language": "语言",
    "languages": { "en": "English", "zh": "中文" }
  },
  "environment": {
    "title": "环境",
    "vegeta": "Vegeta",
    "vegetaCheck": "检查 Vegeta",
    "vegetaInstalled": "已安装于 {{path}}",
    "vegetaMissing": "未安装 Vegeta，请通过以下命令安装：",
    "version": "服务版本",
    "buildMode": "构建模式"
  },
  "data": {
    "title": "数据",
    "exportConnections": "导出连接",
    "importConnections": "导入连接",
    "resetState": "重置应用状态",
    "resetWarning": "将删除所有连接、表单数据、主题和语言偏好。确定继续？",
    "resetConfirm": "确认重置"
  }
}
```

- [ ] **Step 30.3: Register namespace and replace Settings page**

Add `settings` namespace in `web/src/lib/i18n.ts` (same pattern as `connections`).

Replace `web/src/features/settings/SettingsPage.tsx`:

```tsx
import { format } from "date-fns";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/common/page-header";
import { ConnectionsImportDialog } from "@/features/connections/ConnectionsImportDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api-client";
import { useConnectionsStore } from "@/stores/connections-store";
import { type Locale, useLocaleStore } from "@/stores/locale-store";
import { type ThemeMode, useThemeStore } from "@/stores/theme-store";

export function SettingsPage() {
  const { t } = useTranslation("settings");
  const { t: tc } = useTranslation("common");
  const theme = useThemeStore((s) => s.mode);
  const setTheme = useThemeStore((s) => s.setMode);
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);
  const exportAll = useConnectionsStore((s) => s.exportAll);
  const [importOpen, setImportOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  const [vegeta, setVegeta] = useState<{ installed: boolean; path?: string } | null>(null);

  const onExport = () => {
    const blob = new Blob([exportAll()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `modeldoctor-connections-${format(new Date(), "yyyy-MM-dd")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onCheckVegeta = async () => {
    try {
      const data = await api.get<{ installed: boolean; path?: string }>("/api/check-vegeta");
      setVegeta(data);
    } catch {
      setVegeta({ installed: false });
    }
  };

  const onResetAll = () => {
    Object.keys(localStorage)
      .filter((k) => k.startsWith("md."))
      .forEach((k) => localStorage.removeItem(k));
    window.location.reload();
  };

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="space-y-6 px-8 py-6">
        <Section title={t("appearance.title")}>
          <div className="space-y-4">
            <div>
              <Label>{t("appearance.theme")}</Label>
              <RadioGroup
                value={theme}
                onValueChange={(v) => setTheme(v as ThemeMode)}
                className="mt-2 flex gap-4"
              >
                {(["light", "dark", "system"] as ThemeMode[]).map((m) => (
                  <div key={m} className="flex items-center gap-2">
                    <RadioGroupItem id={`th-${m}`} value={m} />
                    <Label htmlFor={`th-${m}`} className="font-normal">
                      {t(`appearance.themeOptions.${m}`)}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
            <div>
              <Label>{t("appearance.language")}</Label>
              <Select value={locale} onValueChange={(v) => setLocale(v as Locale)}>
                <SelectTrigger className="mt-2 max-w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en-US">{t("appearance.languages.en")}</SelectItem>
                  <SelectItem value="zh-CN">{t("appearance.languages.zh")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </Section>

        <Section title={t("environment.title")}>
          <div className="space-y-4 text-sm">
            <div>
              <div className="font-medium">{t("environment.vegeta")}</div>
              <div className="mt-2 flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={onCheckVegeta}>
                  {t("environment.vegetaCheck")}
                </Button>
                {vegeta?.installed ? (
                  <span className="text-success">
                    {t("environment.vegetaInstalled", { path: vegeta.path })}
                  </span>
                ) : null}
                {vegeta && !vegeta.installed ? (
                  <span className="text-destructive">
                    {t("environment.vegetaMissing")}{" "}
                    <code className="ml-1 rounded bg-muted px-1 font-mono text-xs">
                      brew install vegeta
                    </code>
                  </span>
                ) : null}
              </div>
            </div>
            <div className="text-muted-foreground">
              {t("environment.buildMode")}: <span className="font-mono">{import.meta.env.MODE}</span>
            </div>
          </div>
        </Section>

        <Section title={t("data.title")}>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={onExport}>
              {t("data.exportConnections")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              {t("data.importConnections")}
            </Button>
            <Button variant="destructive" size="sm" onClick={() => setResetOpen(true)}>
              {t("data.resetState")}
            </Button>
          </div>
        </Section>
      </div>

      <ConnectionsImportDialog open={importOpen} onOpenChange={setImportOpen} />
      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("data.resetState")}</AlertDialogTitle>
            <AlertDialogDescription>{t("data.resetWarning")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={onResetAll}>
              {t("data.resetConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}
```

- [ ] **Step 30.4: Smoke check Settings**

```bash
pnpm dev
```
On `/settings`:
- Appearance: switching theme radio applies immediately and persists.
- Appearance: switching language updates every page's copy.
- Environment: Click "Check Vegeta" — shows installed path or the install hint.
- Data: Export downloads JSON. Import opens the same dialog used in `/connections`. Reset opens an AlertDialog; cancelling does nothing; confirming reloads with empty state.

Stop the server.

- [ ] **Step 30.5: Commit**

```bash
git add -A
git commit -m "feat: implement Settings page (Appearance, Environment, Data sections)"
```

### Task 31: i18n string audit

**Files:** none modified unless violations found.

- [ ] **Step 31.1: Generate the audit list**

Run from repo root:
```bash
pnpm exec biome check web/src 2>&1 | head -n 50
```
Then perform a manual grep for ASCII string literals inside JSX:

```bash
grep -RnE ">[A-Z][a-zA-Z ]{3,}<" web/src --include="*.tsx" | grep -v "{t(" | grep -v "// " || true
grep -RnE 'placeholder="[A-Z]' web/src --include="*.tsx" | grep -v "i18n" | grep -v "{t(" || true
```

- [ ] **Step 31.2: Fix any violations inline**

For each line surfaced, replace the literal with `t(...)` from the appropriate namespace. The most likely offenders:
- `RequestDebugPage`: the curl `<Textarea>` placeholder; replace with a `t("debug.placeholder.curl")` key (add to both locale files).
- `KeyValueTable`: the literal `"key"`, `"value"`, `"+ Row"`, `"remove"` placeholders. These are ephemeral and OK to leave in English given the column is purely structural; add to debug.json only if you want full localization.
- `EndpointSelector`'s `NamePrompt` inputs use literal English. Localize via the `common` namespace (`endpoint.namePrompt`, `endpoint.placeholder`).
- `LoadTestPage`'s "Reset" hard-coded button label. Replace with `tc("actions.reset")`.

Make those fixes, then re-run the grep. The list should shrink to zero or to keys that belong to truly structural placeholders.

- [ ] **Step 31.3: Run lint, type-check, all tests**

```bash
pnpm lint && pnpm type-check && pnpm test && pnpm test:backend
```
Expected: all pass.

- [ ] **Step 31.4: Commit (only if changes made)**

```bash
git add -A
git commit -m "i18n: audit and localize remaining hard-coded strings"
```
If no violations were found, skip the commit and continue.

### Task 32: Visual QA against spec § 3 and § 10

This task produces no code changes — it is a manual checklist walk-through. If you find a violation, fix it and commit under that fix's natural message before continuing.

- [ ] **Step 32.1: Boot the production build**

```bash
pnpm build
pnpm start
```
Open `http://localhost:3001`.

- [ ] **Step 32.2: Walk every spec § 10 acceptance bullet**

Open the spec at `docs/superpowers/specs/2026-04-20-modeldoctor-restructure-design.md`, jump to "10. Acceptance Criteria", and verify each checkbox:

- Build and run group — already verified in earlier phases. Re-confirm `pnpm build && pnpm start` works on this machine.
- Navigation group — click every sidebar item, including the five Coming Soon entries. Verify deep-linking by typing `/e2e` directly in the address bar.
- Load Test, E2E Smoke, Request Debug groups — exercise as in their respective Phase 4 smoke checks.
- Connections group — repeat Task 20.3 against the production build.
- Settings group — repeat Task 30.4.
- Visual QA group — see Step 32.3.

- [ ] **Step 32.3: Confirm Section 3 visual rules**

Check by inspection:
- No emoji codepoints in user-visible text. Run a portable Node one-liner (BSD grep on macOS lacks `-P`):
  ```bash
  node -e "
    const fs = require('fs');
    const path = require('path');
    const re = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    const dir = 'dist/assets';
    const hits = [];
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.js')) continue;
      const text = fs.readFileSync(path.join(dir, f), 'utf-8');
      const m = text.match(re);
      if (m) hits.push(\`\${f}: \${m[0]}\`);
    }
    console.log(hits.length ? hits.join('\n') : 'no emoji');
  "
  ```
  Expected: `no emoji`.
- All sidebar / page icons are lucide glyphs. Inspect the sidebar visually.
- No decorative gradient backgrounds. The Connections page, every PageHeader, every section header should use solid color tokens.
- Primary buttons use neutral zinc; status colors (green / red / amber) appear only in the result regions and destructive Alert/AlertDialog confirmations.
- Both light and dark themes look balanced with no flash on reload.

- [ ] **Step 32.4: Stop the server, commit if needed**

If the visual audit produced any fixes, commit them. Otherwise no commit required.

### Phase 5 completion check

- [ ] Settings page renders all three sections in both languages.
- [ ] Vegeta check returns expected state.
- [ ] Reset app state confirms then reloads with empty Connections.
- [ ] Spec § 10 acceptance criteria all check off.
- [ ] `pnpm build && pnpm start` runs the entire app on port 3001.
- [ ] `pnpm lint && pnpm type-check && pnpm test && pnpm test:backend` all pass.

---

## Final Self-Review (run before handing the plan to the executor)

This section is for the plan author / reviewer, not the executor.

1. **Spec coverage**: Walk Section 10 of the spec. Every acceptance bullet maps to either a feature implemented in Phase 1-5 or to a smoke-check step in Phase 5 Task 32. There is one implicit gap — the spec § 10 mentions "Sidebar group collapse state persists across reloads" which is implemented in Task 13 (`useSidebarStore`) and verified in Task 15.5; covered.

2. **Placeholder scan**: No `TBD`, `TODO`, or "implement later" remain. Form factories in `formByType` and the per-apiType form files in `web/src/features/load-test/forms/` are listed by name and pattern in Task 25.3 — the engineer follows the `chat.tsx` pattern verbatim for each.

3. **Type / signature consistency**:
   - `ConnectionsStore` interface defined in Task 17 matches every consumer in Tasks 19, 20, 21, 25, 26, 29, 30.
   - `LoadTestResult` defined in Task 24 used in Tasks 25 and Phase 5.
   - `ProbeResult` defined in Task 26 used by `ProbeCard` and the API response handler.
   - `DebugResponse` defined in Task 28 used by `ResponseViewer` and the proxy mutation.
   - i18n namespace IDs align with the `useTranslation` calls everywhere (`common`, `sidebar`, `connections`, `load-test`, `e2e`, `debug`, `settings`).

4. **Backend / frontend contract**: `/api/load-test`, `/api/e2e-test`, `/api/check-vegeta`, `/api/health` already exist and are not modified. The single new route `/api/debug/proxy` has its request and response shapes pinned both in spec § 6.3 and in the test in Task 27.3 + the implementation in Task 27.5.

5. **Commit cadence**: 32 named commits. Each task ends in a single commit; smoke-check-only steps (Task 6, Task 32) call out "no commit needed."

---

## Execution Choice

Plan complete and saved to `docs/superpowers/plans/2026-04-20-modeldoctor-restructure.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task; main session reviews between tasks; fast iteration.
2. **Inline Execution** — execute tasks in this session using the `executing-plans` skill; batch execution with checkpoints.

Which approach?
