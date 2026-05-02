> **Status: ✅ Completed · historical record.** 本文是提交时的设计/计划快照；其中字段名、目录路径、env 名、API 路由为当时状态，重构后已演进。**当前实现请以代码与 `CLAUDE.md` 为准；本文正文不再修改，仅作归档。**

# NestJS Refactor — Phase 0 Implementation Plan (Workspace Scaffold)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the pnpm-workspace layout (`apps/web`, `apps/api`, `packages/contracts`) and scaffold an empty NestJS 10 app at `apps/api`, while keeping the existing frontend fully functional. No existing routes are ported in this plan. After this plan merges, `pnpm dev` runs the old Express backend alongside the new Nest scaffold — Phase 1 (not in this plan) will cut over.

**Architecture:** Three-package pnpm workspace rooted at the repo. `apps/web` is the existing frontend relocated verbatim. `apps/api` is a fresh NestJS 10 scaffold using Express adapter, with Nest's default Jest setup replaced by Vitest to match the rest of the repo. `packages/contracts` is an empty shared-schemas package with Zod as its only runtime dependency. The legacy Express app (`server.js` + `src/*.js`) remains in place and runnable — it is deleted by Phase 1, not this phase.

**Tech Stack:** pnpm workspaces, TypeScript 5.4 strict, NestJS 10 (Express adapter), Vitest (both FE and BE), Zod, Node ≥ 20. Frontend unchanged: Vite 5, React 18, Tailwind, shadcn/ui, Zustand.

**Source spec:** `docs/superpowers/specs/2026-04-22-nestjs-backend-refactor-design.md` (Phase 0, §5)

**Testing discipline:**
- **Verification steps, not TDD.** Phase 0 is config and scaffolding; runtime business logic arrives in later phases. Each task ends with a concrete verification command (install succeeds, dev server boots, type-check passes, URL responds) — not a unit test.
- **One runtime-code commit happens in this phase:** replacing Nest's default `AppController` spec with a Vitest-flavored equivalent (Task 9). That single spec serves as a smoke test proving the Vitest runner is wired correctly against Nest.
- Manual smoke checks at Task 6 (FE), Task 10 (API), and Task 16 (full end-to-end). Each has explicit success criteria.

**Commit cadence:** One commit per task. Message prefix convention:
- `chore:` workspace plumbing, config
- `build:` package.json / tsconfig / scripts changes
- `feat:` new runtime code (rare in this phase)
- `test:` test-only changes
- `docs:` README / plan / spec updates

**Environment assumptions:**
- Working directory: `/Users/fangyong/vllm/modeldoctor/feat/e2e-smoke` (or whatever worktree the user is on). **Commands are written as repo-root-relative** (no leading `./`); run them from the repo root.
- **Node ≥ 20 required** (bumping engines is part of this plan; Phase 0 both declares and requires it).
- **pnpm 9.x required** (pnpm 8 works too but the plan targets 9).
- Vegeta and any Phase 1+ runtime prerequisites are NOT needed to complete Phase 0.

---

## Pre-flight

- [ ] **Step 0.1: Confirm a clean working tree**

Run:
```bash
git status
```
Expected: `nothing to commit, working tree clean` (or only untracked files you don't mind carrying). If dirty, commit or stash before proceeding — this plan produces a long sequence of commits and merging them into an unclean tree is error-prone.

- [ ] **Step 0.2: Confirm tooling versions**

Run:
```bash
node --version
pnpm --version
```
Expected: Node `v20.*` or newer; pnpm `9.*` (8.15+ works but untested with this plan). If Node is `v18.*`, upgrade before proceeding (e.g. `nvm install 20 && nvm use 20`). If pnpm is missing: `npm install -g pnpm@9`.

- [ ] **Step 0.3: Create the Phase 0 branch**

Run:
```bash
git checkout -b feat/nestjs-phase-0
```
Expected: `Switched to a new branch 'feat/nestjs-phase-0'`. All commits in this plan land on this branch. When the plan is complete, open a single PR `feat/nestjs-phase-0 → main` (or whatever integration branch your repo uses).

- [ ] **Step 0.4: Baseline smoke — the old stack still works**

Run (in one terminal):
```bash
pnpm install
pnpm dev
```
In a second terminal or browser:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/api/health
```
Expected: `200` from each. **If either fails, stop** — Phase 0 must start from a working baseline. Kill `pnpm dev` (`Ctrl-C`) once verified.

---

## Phase 0 Tasks

Phase goal (restated): repo has `apps/web`, `apps/api`, `packages/contracts` as workspace packages; `pnpm dev` brings up FE on 5173 and a new Nest scaffold on 3001; old `server.js` + `src/*.js` still present but unused-by-dev. Type-check, lint, and test commands work across all three packages.

### Task 1: Add workspace skeleton and shared base tsconfig

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `apps/.gitkeep`
- Create: `packages/.gitkeep`

- [ ] **Step 1.1: Create `pnpm-workspace.yaml`**

Write this exact content to the repo root:
```yaml
packages:
  - apps/*
  - packages/*
```

- [ ] **Step 1.2: Create `tsconfig.base.json`**

Write this exact content to the repo root:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": false,
    "sourceMap": true
  }
}
```
Rationale: the three packages each extend this and add their own overrides (`web` adds DOM libs + jsx; `api` adds Node lib + decorators + emitDecoratorMetadata; `contracts` is library-style).

- [ ] **Step 1.3: Create `apps/` and `packages/` directories with placeholder files**

Run:
```bash
mkdir -p apps packages
touch apps/.gitkeep packages/.gitkeep
```
The placeholders keep the empty directories in git until the next tasks populate them.

- [ ] **Step 1.4: Verify `pnpm install` still works with an empty workspace**

Run:
```bash
pnpm install
```
Expected: installs as before; a `Scope: all 1 workspace projects` (the root) line may appear. No errors. Because `apps/*` and `packages/*` are empty directory globs, pnpm reports one workspace (the root) and does not complain.

- [ ] **Step 1.5: Commit**

```bash
git add pnpm-workspace.yaml tsconfig.base.json apps/.gitkeep packages/.gitkeep
git commit -m "chore: introduce pnpm workspace skeleton and base tsconfig"
```

---

### Task 2: Relocate `web/` to `apps/web/`

**Files:**
- Move: `web/` → `apps/web/`

- [ ] **Step 2.1: Move the directory preserving git history**

Run:
```bash
git mv web apps/web
```
Expected: `git status` now shows `renamed: web/... -> apps/web/...` for every file. No file content has changed.

- [ ] **Step 2.2: Inspect the move summary**

Run:
```bash
git status | head -30
ls apps/web
```
Expected: all former `web/*` entries now under `apps/web/`, including `src/`, `vite.config.ts`, `vitest.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `tailwind.config.ts`, `biome.json`, `postcss.config.cjs`, `index.html`.

- [ ] **Step 2.3: Commit the move as a rename**

```bash
git commit -m "chore: relocate web/ to apps/web/"
```
Keeping this commit rename-only (no content changes) ensures `git log --follow` tracks each file through the move.

---

### Task 3: Give `apps/web` its own `package.json` with frontend-scoped deps

**Files:**
- Create: `apps/web/package.json`
- Modify: `apps/web/tsconfig.json` (next task)

- [ ] **Step 3.1: Create `apps/web/package.json`**

Write this exact content:
```json
{
  "name": "@modeldoctor/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --config vite.config.ts",
    "build": "vite build --config vite.config.ts",
    "preview": "vite preview",
    "lint": "biome check src",
    "format": "biome format --write src",
    "type-check": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run --config vitest.config.ts",
    "test:watch": "vitest --config vitest.config.ts"
  },
  "dependencies": {
    "@hookform/resolvers": "^3",
    "@radix-ui/react-alert-dialog": "^1",
    "@radix-ui/react-dialog": "^1",
    "@radix-ui/react-dropdown-menu": "^2",
    "@radix-ui/react-label": "^2",
    "@radix-ui/react-progress": "^1",
    "@radix-ui/react-radio-group": "^1",
    "@radix-ui/react-scroll-area": "^1",
    "@radix-ui/react-select": "^2",
    "@radix-ui/react-separator": "^1",
    "@radix-ui/react-slot": "^1",
    "@radix-ui/react-switch": "^1",
    "@radix-ui/react-tabs": "^1",
    "@radix-ui/react-tooltip": "^1",
    "@tanstack/react-query": "^5",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2",
    "date-fns": "^3",
    "i18next": "^23",
    "lucide-react": "^0.453",
    "react": "^18.3",
    "react-dom": "^18.3",
    "react-hook-form": "^7",
    "react-i18next": "^14",
    "react-router-dom": "^7",
    "sonner": "^2.0.7",
    "tailwind-merge": "^2",
    "zod": "^3.23",
    "zustand": "^4.5"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6",
    "@testing-library/react": "^16",
    "@testing-library/user-event": "^14",
    "@types/react": "^18.3",
    "@types/react-dom": "^18.3",
    "@vitejs/plugin-react": "^4",
    "@vitest/ui": "^1",
    "autoprefixer": "^10",
    "jsdom": "^24",
    "postcss": "^8",
    "tailwindcss": "^3.4",
    "tailwindcss-animate": "^1",
    "vite": "^5",
    "vitest": "^1"
  }
}
```
Notes on what's included vs excluded:
- `zod` is listed here because the FE uses it directly. When `@modeldoctor/contracts` consumes it too, pnpm will dedupe.
- `typescript` and `@biomejs/biome` are NOT here — they are shared dev tools hoisted at the repo root (Task 14).
- The scripts deliberately use `--config vite.config.ts` explicit paths so `pnpm --filter @modeldoctor/web dev` works from any cwd.

- [ ] **Step 3.2: Verify pnpm sees the new workspace package**

Run:
```bash
pnpm install
pnpm -r list --depth 0 | head -20
```
Expected: output lists `@modeldoctor/web` as a workspace package. `pnpm install` may download new packages but should not error.

- [ ] **Step 3.3: Commit**

```bash
git add apps/web/package.json
git commit -m "build: add apps/web package.json with FE-scoped dependencies"
```

---

### Task 4: Adjust `apps/web/vite.config.ts` build outDir to be package-local

**Files:**
- Modify: `apps/web/vite.config.ts:55-58`

The current config writes the build to `path.resolve(__dirname, "..", "dist")`, which after the move points to `apps/dist/` — wrong. The spec (§5 Phase 6) requires FE build output at `apps/web/dist/` so the Docker stage can copy it directly.

- [ ] **Step 4.1: Edit `apps/web/vite.config.ts`**

Find the `build` block (lines 54–58):
```typescript
  build: {
    outDir: path.resolve(__dirname, "..", "dist"),
    emptyOutDir: true,
    sourcemap: true,
  },
```

Replace with:
```typescript
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
    sourcemap: true,
  },
```

- [ ] **Step 4.2: Verify the build lands in the expected place**

Run:
```bash
pnpm -F @modeldoctor/web build
ls apps/web/dist | head -5
```
Expected: `apps/web/dist/index.html` and `apps/web/dist/assets/` exist. (This also validates that the relocated Vite config still resolves its tailwind/postcss imports correctly after the move.)

- [ ] **Step 4.3: Commit**

```bash
git add apps/web/vite.config.ts
git commit -m "build: scope apps/web vite build output to package-local dist/"
```

---

### Task 5: Update `apps/web/tsconfig.json` to extend the shared base

**Files:**
- Modify: `apps/web/tsconfig.json`

- [ ] **Step 5.1: Edit `apps/web/tsconfig.json`**

Replace the entire file with:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "types": ["vite/client", "vitest/globals", "@testing-library/jest-dom"],
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"],
      "@modeldoctor/contracts": ["../../packages/contracts/src"]
    }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```
Changes from the previous file:
- `extends` the workspace base (removes duplication of `target`, `module`, `strict`, etc.)
- Adds path alias `@modeldoctor/contracts` → `packages/contracts/src` so FE can import the shared schemas once Task 12 publishes them.
- Removes redundant fields now inherited from base.

- [ ] **Step 5.2: Verify type-check still passes**

Run:
```bash
pnpm -F @modeldoctor/web type-check
```
Expected: zero errors. (The `@modeldoctor/contracts` alias resolves to an empty placeholder file created in Task 11, but no FE code imports it yet, so the alias is silently unused — fine.)

- [ ] **Step 5.3: Commit**

```bash
git add apps/web/tsconfig.json
git commit -m "build: extend apps/web tsconfig from shared workspace base"
```

---

### Task 6: Smoke-test `apps/web` independently

**Files:** (no changes)

- [ ] **Step 6.1: Start the FE dev server via the workspace filter**

In one terminal:
```bash
pnpm -F @modeldoctor/web dev
```
Expected: Vite prints `Local: http://localhost:5173/`. Open the URL in a browser — the ModelDoctor UI renders (sidebar, Load Test tab).

API calls will 502 in the network tab because the backend isn't running. That's expected for this smoke — we're verifying the FE move alone.

- [ ] **Step 6.2: Run FE unit tests**

In a second terminal:
```bash
pnpm -F @modeldoctor/web test
```
Expected: all existing tests pass. (Relocation shouldn't have broken any test — they use `__dirname`-relative imports and the vitest config auto-adjusts.)

- [ ] **Step 6.3: Stop the dev server**

`Ctrl-C` in the terminal running `pnpm dev`. No commit — this task is verification only.

---

### Task 7: Trim root `package.json` of FE-only dependencies

**Files:**
- Modify: `package.json`

The root `package.json` currently holds **all** FE deps (which are now duplicated into `apps/web/package.json`) plus the three Express-era BE deps. We strip it to a workspace-coordination shell. Express/body-parser/cors stay **for now** — the old `server.js` still needs them until Phase 1 deletes it.

- [ ] **Step 7.1: Rewrite `package.json`**

Replace the entire file with:
```json
{
  "name": "modeldoctor",
  "version": "0.1.0",
  "private": true,
  "description": "Troubleshooting toolkit for model-serving APIs",
  "engines": {
    "node": ">=20.0.0"
  },
  "scripts": {
    "dev:legacy": "concurrently -k -n web,api -c cyan,magenta \"pnpm -F @modeldoctor/web dev\" \"node server.js\"",
    "dev": "pnpm dev:legacy",
    "build": "pnpm -F @modeldoctor/web build",
    "start": "node server.js",
    "lint": "pnpm -r --if-present lint",
    "format": "pnpm -r --if-present format",
    "type-check": "pnpm -r --if-present type-check",
    "test": "pnpm -r --if-present test",
    "test:backend": "vitest run --config vitest.backend.config.ts"
  },
  "dependencies": {
    "body-parser": "^1.20.2",
    "cors": "^2.8.5",
    "express": "^4.18.2"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9",
    "@types/node": "^20",
    "concurrently": "^8",
    "supertest": "^7",
    "typescript": "^5.4",
    "vitest": "^1"
  }
}
```

Notes:
- `dev` currently aliases `dev:legacy` (the old Express backend). Task 15 updates `dev` to run the new Nest scaffold once `apps/api` is viable.
- Express, body-parser, cors stay in root `dependencies` because `server.js` needs them. They are deleted in Phase 1.
- `build` only builds web for now. `apps/api` will plug in here once it has something to build.
- `typescript`, `@biomejs/biome`, `vitest`, `concurrently`, `supertest`, `@types/node` are hoisted at root so all workspace packages share one version. pnpm's hoisting is on by default.
- `test:backend` keeps working against the existing `vitest.backend.config.ts` so Phase 0 doesn't break the current backend test (`src/routes/debug-proxy.test.js`).

- [ ] **Step 7.2: Reinstall to apply the dep split**

Run:
```bash
rm -rf node_modules apps/web/node_modules
pnpm install
```
Expected: clean install. The FE deps now live under `apps/web/node_modules` (hoisted where safe). No `ERESOLVE` or peer errors.

- [ ] **Step 7.3: Verify the legacy dev flow still works**

Run:
```bash
pnpm dev:legacy
```
In another terminal:
```bash
curl -s http://localhost:3001/api/health
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173
```
Expected: health JSON from Express; `200` from Vite. Kill the dev process.

- [ ] **Step 7.4: Commit**

```bash
git add package.json
git commit -m "build: trim root package.json to workspace shell, keep legacy backend runnable"
```

---

### Task 8: Scaffold `apps/api` via @nestjs/cli

**Files:**
- Create: `apps/api/` (entire Nest scaffold subtree, then trimmed in later tasks)

- [ ] **Step 8.1: Generate the scaffold in a temp dir, then relocate**

Run:
```bash
TMP_API_DIR="$(mktemp -d)"
(cd "$TMP_API_DIR" && pnpm dlx @nestjs/cli@^10 new api --package-manager pnpm --skip-git)
mv "$TMP_API_DIR/api" apps/api
rm -rf "$TMP_API_DIR"
```
Expected: `apps/api/` exists with Nest's default structure: `src/app.module.ts`, `src/app.controller.ts`, `src/app.service.ts`, `src/main.ts`, plus `test/`, `package.json`, `tsconfig.json`, `tsconfig.build.json`, `nest-cli.json`, `.prettierrc`, `.eslintrc.js`.

Why `--skip-git`: the scaffold tries to `git init` which would conflict with the outer repo. `--package-manager pnpm` makes Nest emit a `pnpm-lock.yaml` inside `apps/api/` — we delete that in Step 8.3 because the workspace uses a single root lockfile.

- [ ] **Step 8.2: Delete scaffold cruft that conflicts with our conventions**

Run:
```bash
rm -rf apps/api/node_modules
rm -f apps/api/pnpm-lock.yaml apps/api/.eslintrc.js apps/api/.prettierrc
rm -f apps/api/README.md
```
Rationale: we use Biome (not ESLint + Prettier); we use one workspace lockfile; the generated README is generic boilerplate we'll overwrite later.

- [ ] **Step 8.3: Rename the package to `@modeldoctor/api` and align scripts**

Open `apps/api/package.json` and replace its entire content with:
```json
{
  "name": "@modeldoctor/api",
  "version": "0.1.0",
  "private": true,
  "description": "ModelDoctor API (NestJS)",
  "scripts": {
    "build": "nest build",
    "start": "node dist/main.js",
    "start:dev": "nest start --watch",
    "start:debug": "nest start --debug --watch",
    "start:prod": "node dist/main.js",
    "type-check": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "vitest run --config vitest.e2e.config.ts"
  },
  "dependencies": {
    "@nestjs/common": "^10",
    "@nestjs/config": "^3",
    "@nestjs/core": "^10",
    "@nestjs/platform-express": "^10",
    "@nestjs/swagger": "^7",
    "nestjs-pino": "^4",
    "nestjs-zod": "^3",
    "pino": "^9",
    "pino-http": "^10",
    "reflect-metadata": "^0.2",
    "rxjs": "^7",
    "zod": "^3.23"
  },
  "devDependencies": {
    "@nestjs/cli": "^10",
    "@nestjs/schematics": "^10",
    "@nestjs/testing": "^10",
    "@types/express": "^4",
    "@types/supertest": "^6",
    "pino-pretty": "^11",
    "vite-tsconfig-paths": "^5"
  }
}
```
Notes:
- Jest and its ecosystem (`jest`, `ts-jest`, `@types/jest`, `jest-environment-node`) are gone. Vitest replaces them (Task 9).
- `typescript`, `@biomejs/biome`, `vitest`, `supertest`, `@types/node` are hoisted from root — not duplicated here.
- `start:prod` duplicates `start` deliberately; Docker (`CMD`) will use one name and `pnpm start` the other.
- **Deps installed but not yet wired in Phase 0:** `@nestjs/config`, `@nestjs/swagger`, `nestjs-pino`, `nestjs-zod`, `pino`, `pino-http`, `pino-pretty`, `zod`. Per spec §5 Phase 0, the full Phase-2-and-earlier dep set installs now so Phase 2's PR can focus entirely on wiring, not on `pnpm install`. They produce zero runtime footprint until imported.
- **Deferred to their own phases:** Prisma (Phase 4), Passport + JWT + argon2 (Phase 5), throttler (Phase 5), terminus (Phase 6).

- [ ] **Step 8.4: Verify the scaffold installs cleanly**

Run:
```bash
pnpm install
pnpm -F @modeldoctor/api type-check
```
Expected: install succeeds; `type-check` passes against the default scaffold. If type-check fails, it is almost certainly because the scaffold's `tsconfig.json` sets options incompatible with our base — continue to Task 9 where we adjust tsconfig as part of Vitest wiring.

- [ ] **Step 8.5: Commit**

```bash
git add apps/api
git commit -m "build: scaffold apps/api via @nestjs/cli, strip defaults we don't use"
```

---

### Task 9: Replace Nest's Jest setup with Vitest

**Files:**
- Delete: `apps/api/test/` (Jest e2e scaffold)
- Delete: `apps/api/src/app.controller.spec.ts` (will be recreated as Vitest)
- Modify: `apps/api/tsconfig.json`
- Create: `apps/api/tsconfig.build.json` (simplified)
- Create: `apps/api/vitest.config.ts`
- Create: `apps/api/vitest.e2e.config.ts`
- Create: `apps/api/src/app.controller.spec.ts` (Vitest version)

- [ ] **Step 9.1: Delete the Jest scaffold**

Run:
```bash
rm -rf apps/api/test
rm -f apps/api/src/app.controller.spec.ts
```

- [ ] **Step 9.2: Replace `apps/api/tsconfig.json`**

Write this exact content:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "commonjs",
    "moduleResolution": "node",
    "lib": ["ES2022"],
    "types": ["node", "vitest/globals"],
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "target": "ES2022",
    "baseUrl": "./",
    "outDir": "./dist",
    "incremental": true,
    "declaration": false,
    "sourceMap": true,
    "paths": {
      "@modeldoctor/contracts": ["../../packages/contracts/src"]
    }
  },
  "include": ["src/**/*", "vitest.config.ts", "vitest.e2e.config.ts"],
  "exclude": ["node_modules", "dist"]
}
```
Notes:
- `module: commonjs` + `moduleResolution: node` is the Nest-on-Node convention — matches what `nest build` expects. Our base uses `ESNext`/`bundler`, which is FE-oriented. We override here.
- `emitDecoratorMetadata` + `experimentalDecorators` are mandatory for NestJS DI.
- `types: ["node", "vitest/globals"]` enables Vitest globals (`describe`, `it`, `expect`) without per-file imports.

- [ ] **Step 9.3: Replace `apps/api/tsconfig.build.json`**

Write this exact content:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "declaration": false,
    "sourceMap": true
  },
  "exclude": ["node_modules", "dist", "**/*.spec.ts", "**/*.e2e-spec.ts", "test"]
}
```

- [ ] **Step 9.4: Create `apps/api/vitest.config.ts` (unit tests)**

Write this exact content:
```typescript
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import swc from "unplugin-swc";

export default defineConfig({
  plugins: [
    tsconfigPaths(),
    swc.vite({
      module: { type: "es6" },
      jsc: {
        parser: { syntax: "typescript", decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: "es2022",
      },
    }),
  ],
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.spec.ts"],
    exclude: ["node_modules", "dist", "test/**"],
  },
});
```

Explanation: Vitest defaults to `esbuild` which doesn't emit decorator metadata. Nest DI requires that metadata, so we swap in `@swc/core` via `unplugin-swc` (the standard Vitest-on-Nest recipe). Add the plugin deps in the next step.

- [ ] **Step 9.5: Create `apps/api/vitest.e2e.config.ts` (e2e tests)**

Write this exact content:
```typescript
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import swc from "unplugin-swc";

export default defineConfig({
  plugins: [
    tsconfigPaths(),
    swc.vite({
      module: { type: "es6" },
      jsc: {
        parser: { syntax: "typescript", decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: "es2022",
      },
    }),
  ],
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.e2e-spec.ts"],
    exclude: ["node_modules", "dist"],
    // e2e suites need enough time to boot an INestApplication per suite.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
```

- [ ] **Step 9.6: Add SWC and paths plugin deps to `apps/api/package.json`**

Edit `apps/api/package.json` — in `devDependencies` add two keys (keep existing alphabetical ordering):
```json
    "@swc/core": "^1",
    "unplugin-swc": "^1",
    "vite-tsconfig-paths": "^5"
```
(`vite-tsconfig-paths` was already added in Task 8.3; keep it there if present.)

After the edit, the devDependencies block should contain at least:
```json
  "devDependencies": {
    "@nestjs/cli": "^10",
    "@nestjs/schematics": "^10",
    "@nestjs/testing": "^10",
    "@swc/core": "^1",
    "@types/express": "^4",
    "@types/supertest": "^6",
    "unplugin-swc": "^1",
    "vite-tsconfig-paths": "^5"
  }
```

- [ ] **Step 9.7: Write the Vitest-flavored AppController spec**

Create `apps/api/src/app.controller.spec.ts` with this exact content:
```typescript
import { Test, TestingModule } from "@nestjs/testing";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";

describe("AppController", () => {
  let appController: AppController;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = moduleRef.get(AppController);
  });

  it("returns the default greeting", () => {
    expect(appController.getHello()).toBe("Hello World!");
  });
});
```
This single spec is the smoke test that proves Vitest + SWC + Nest DI wire together correctly. It will be deleted in Phase 1 when `AppController` itself is removed.

- [ ] **Step 9.8: Install new deps and run the unit test**

Run:
```bash
pnpm install
pnpm -F @modeldoctor/api test
```
Expected: `Test Files  1 passed (1)` and `Tests  1 passed (1)`. If you see `ReferenceError: Reflect.getMetadata is not a function`, ensure `reflect-metadata` is imported early (Task 10 handles this for the runtime; the test passes because `@nestjs/testing` imports it).

If the test fails with a SWC-related error, confirm `@swc/core` installed correctly with `pnpm -F @modeldoctor/api list @swc/core unplugin-swc`.

- [ ] **Step 9.9: Verify `type-check` passes**

Run:
```bash
pnpm -F @modeldoctor/api type-check
```
Expected: zero errors. If `Cannot find type definition file for 'vitest/globals'` appears, confirm `vitest` installed via `pnpm list vitest` at repo root.

- [ ] **Step 9.10: Commit**

```bash
git add apps/api/tsconfig.json apps/api/tsconfig.build.json apps/api/vitest.config.ts apps/api/vitest.e2e.config.ts apps/api/src/app.controller.spec.ts apps/api/package.json
git commit -m "build: swap Nest's Jest scaffold for Vitest + SWC (decorator metadata preserved)"
```

---

### Task 10: Customize `apps/api/src/main.ts` — port 3001, `/api` global prefix, dev CORS

**Files:**
- Modify: `apps/api/src/main.ts`

The scaffold defaults to port 3000 with no prefix. Our dev proxy expects `http://localhost:3001/api/*`. Without these changes, the Vite dev proxy (Task 6's config) would 502 against the Nest scaffold.

- [ ] **Step 10.1: Replace `apps/api/src/main.ts`**

Write this exact content:
```typescript
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app: INestApplication = await NestFactory.create(AppModule);

  app.setGlobalPrefix("api");

  // Dev-time CORS: Vite dev server runs on 5173; browser calls here hit the
  // Vite proxy server-to-server, so CORS is not strictly needed for the FE
  // dev loop. But developers occasionally curl/fetch the API from other
  // origins (notebooks, Postman browser), and permissive dev CORS is harmless.
  // Production CORS policy is revisited in Phase 2 with @nestjs/config.
  if (process.env.NODE_ENV !== "production") {
    app.enableCors({
      origin: ["http://localhost:5173"],
      credentials: true,
    });
  }

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  console.log(`[api] listening on http://localhost:${port}`);
}

void bootstrap();
```

Notes on what changed from the scaffold:
- Global prefix `/api` so the scaffold's `GET /` becomes `GET /api/`.
- Explicit port from env with a 3001 default to match current Express behavior.
- Dev-only CORS wrapping.
- `void bootstrap()` instead of `bootstrap()` to satisfy strict TS no-floating-promises lint (which we don't enforce yet but may later).

- [ ] **Step 10.2: Boot the API standalone and probe it**

In one terminal:
```bash
pnpm -F @modeldoctor/api start:dev
```
Wait for `[api] listening on http://localhost:3001` (may take 2–3 seconds for first compile).

In another terminal:
```bash
curl -s http://localhost:3001/api
```
Expected: `Hello World!`

The scaffold's `AppController` exposes `@Get()` at the root, which with the `/api` prefix becomes `/api`. A request to `/api/health` returns 404 — that endpoint belongs to the old Express server and arrives in Phase 1 of the Nest port.

- [ ] **Step 10.3: Kill the dev server**

`Ctrl-C` the Nest process.

- [ ] **Step 10.4: Commit**

```bash
git add apps/api/src/main.ts
git commit -m "feat(api): set /api global prefix, bind to 3001, enable dev CORS"
```

---

### Task 11: Create `packages/contracts/` skeleton

**Files:**
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/index.ts`

- [ ] **Step 11.1: Create `packages/contracts/package.json`**

Write this exact content:
```json
{
  "name": "@modeldoctor/contracts",
  "version": "0.0.0",
  "private": true,
  "description": "Shared Zod schemas and inferred types between apps/web and apps/api",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    }
  },
  "scripts": {
    "type-check": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run --passWithNoTests"
  },
  "dependencies": {
    "zod": "^3.23"
  }
}
```

Notes:
- No build step. Consumers (`apps/web` via Vite, `apps/api` via ts-node-like runtime through `vite-tsconfig-paths` + SWC) read the `.ts` sources directly via the workspace path alias. This avoids the classic "publish-to-consume" cycle during early development.
- `"type": "module"` aligns with the spec's ESM direction for new code (even though `apps/api` is CJS for now, its bundler/tsconfig resolves the `.ts` source directly — no module-interop problem).

- [ ] **Step 11.2: Create `packages/contracts/tsconfig.json`**

Write this exact content:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 11.3: Create `packages/contracts/src/index.ts`**

Write this exact content:
```typescript
/**
 * @modeldoctor/contracts
 *
 * Shared Zod schemas that define the HTTP wire format between the web UI and
 * the API. Consumers import schemas from here and derive types via z.infer.
 *
 * Phase 0 scaffold: no schemas yet. Phase 1 populates health, e2e-test,
 * load-test, and debug-proxy schemas.
 */

export {};
```

- [ ] **Step 11.4: Install and sanity-check**

Run:
```bash
pnpm install
pnpm -F @modeldoctor/contracts type-check
```
Expected: install links the workspace package; type-check passes on the empty scaffold.

- [ ] **Step 11.5: Commit**

```bash
git add packages/contracts
git commit -m "build: add empty packages/contracts scaffold (no schemas yet)"
```

---

### Task 12: Wire `@modeldoctor/contracts` as a workspace dependency of `apps/web` and `apps/api`

**Files:**
- Modify: `apps/web/package.json` (add dep)
- Modify: `apps/api/package.json` (add dep)

- [ ] **Step 12.1: Add `@modeldoctor/contracts` to `apps/web/package.json`**

In `apps/web/package.json`, extend the `dependencies` block to include:
```json
    "@modeldoctor/contracts": "workspace:*",
```
(Insert alphabetically; it sorts between `@hookform/resolvers` and `@radix-ui/...`.)

- [ ] **Step 12.2: Add `@modeldoctor/contracts` to `apps/api/package.json`**

In `apps/api/package.json`, extend the `dependencies` block to include:
```json
    "@modeldoctor/contracts": "workspace:*",
```
(Insert alphabetically; it sorts before `@nestjs/common`.)

- [ ] **Step 12.3: Reinstall to link the workspace package**

Run:
```bash
pnpm install
```
Expected: pnpm reports linking `@modeldoctor/contracts` into both `apps/web` and `apps/api` via symlink. Verify with:
```bash
ls -la apps/web/node_modules/@modeldoctor/
ls -la apps/api/node_modules/@modeldoctor/
```
Each should show a `contracts` entry that is a symlink pointing to `../../../packages/contracts` (or similar).

- [ ] **Step 12.4: Smoke-verify TS can resolve the import**

Create a scratch file `apps/api/src/_contracts-smoke.ts` with:
```typescript
// Deleted at end of this task — temporary resolution smoke check.
import type {} from "@modeldoctor/contracts";
```

Run:
```bash
pnpm -F @modeldoctor/api type-check
```
Expected: zero errors.

Then delete the scratch file:
```bash
rm apps/api/src/_contracts-smoke.ts
```

- [ ] **Step 12.5: Commit**

```bash
git add apps/web/package.json apps/api/package.json
git commit -m "build: wire @modeldoctor/contracts as workspace dep in web and api"
```

---

### Task 13: Extend `.gitignore` for the new workspace layout

**Files:**
- Modify: `.gitignore`

- [ ] **Step 13.1: Append workspace patterns to `.gitignore`**

Edit `.gitignore`. Find the current "Web workspace" block near the bottom (lines 50-53):
```
# Web workspace
web/node_modules/
.vite/
```
Replace with:
```
# Workspace packages
apps/*/node_modules/
apps/*/dist/
packages/*/node_modules/
packages/*/dist/

# Build caches
*.tsbuildinfo
.vite/

# Local Postgres data (arrives in Phase 4)
postgres-data/
```

Also confirm these lines still exist higher up:
- `node_modules/`
- `dist/` (matches legacy repo-root dist; later phases' `apps/*/dist/` is also excluded above)

Note: Prisma migration files **are** committed, so we do NOT add `apps/api/prisma/migrations/` to `.gitignore`. This matches the spec's explicit policy (§2.4).

- [ ] **Step 13.2: Verify the ignore rules don't exclude anything we need**

Run:
```bash
git status --ignored | head -30
```
Expected: `apps/web/node_modules/`, `apps/api/node_modules/`, `packages/contracts/node_modules/` each appear under "Ignored files". No tracked file is now reported as ignored (pnpm's `node_modules` directories should be the only newly-ignored paths).

- [ ] **Step 13.3: Commit**

```bash
git add .gitignore
git commit -m "chore: extend .gitignore for workspace dist/ and node_modules/"
```

---

### Task 14: Update root scripts to default `pnpm dev` to the new Nest scaffold

**Files:**
- Modify: `package.json` (scripts block only)

At the end of Task 7 we aliased `dev` to `dev:legacy` so the plan kept working while `apps/api` didn't exist. Now the Nest scaffold is live — repoint `dev` at it and keep `dev:legacy` as an escape hatch.

- [ ] **Step 14.1: Rewrite the `scripts` block in root `package.json`**

Open `package.json` and replace the `scripts` block with:
```json
  "scripts": {
    "dev": "concurrently -k -n web,api -c cyan,magenta \"pnpm -F @modeldoctor/web dev\" \"pnpm -F @modeldoctor/api start:dev\"",
    "dev:legacy": "concurrently -k -n web,api -c cyan,magenta \"pnpm -F @modeldoctor/web dev\" \"node server.js\"",
    "build": "pnpm -F @modeldoctor/contracts type-check && pnpm -F @modeldoctor/web build && pnpm -F @modeldoctor/api build",
    "start": "node apps/api/dist/main.js",
    "lint": "pnpm -r --if-present lint",
    "format": "pnpm -r --if-present format",
    "type-check": "pnpm -r --if-present type-check",
    "test": "pnpm -r --if-present test",
    "test:e2e": "pnpm -F @modeldoctor/api test:e2e",
    "test:backend:legacy": "vitest run --config vitest.backend.config.ts"
  },
```

Changes from Task 7:
- `dev` now runs Nest by default.
- `dev:legacy` preserved — run it when you need to compare against the old Express behavior (Phase 1 fixture capture).
- `build` compiles contracts (type-check only; no emit), then web, then api.
- `start` runs the new Nest build artifact, not the old `server.js`. This will fail if you haven't run `pnpm build` first — expected.
- `test:backend:legacy` renamed from `test:backend` to flag that it targets the old JS backend tests, which are deleted by Phase 1.

- [ ] **Step 14.2: Verify `pnpm dev` brings up both servers**

Run:
```bash
pnpm dev
```
Wait for both `[web]` (Vite on 5173) and `[api]` (Nest on 3001) startup lines. In a second terminal:
```bash
curl -s http://localhost:3001/api
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173
curl -s http://localhost:5173/api
```
Expected:
- `http://localhost:3001/api` → `Hello World!`
- `http://localhost:5173` → `200`
- `http://localhost:5173/api` → `Hello World!` (via Vite proxy)

The third probe is the important one: it proves the Vite dev proxy reaches Nest.

- [ ] **Step 14.3: Verify `pnpm type-check` sweeps all three packages**

Kill `pnpm dev`, then run:
```bash
pnpm type-check
```
Expected: runs three type-checks (web, api, contracts — the root doesn't have one), all pass.

- [ ] **Step 14.4: Commit**

```bash
git add package.json
git commit -m "build: default pnpm dev to apps/api (Nest), keep dev:legacy escape hatch"
```

---

### Task 15: Update README Install / Develop / Scripts sections

**Files:**
- Modify: `README.md`

- [ ] **Step 15.1: Rewrite the Install, Develop, Production build, Repo layout, Scripts sections**

The current `README.md` describes a single-package layout. Update these four sections to reflect the workspace:

Replace the content between `## Prerequisites` (keep the header) and `## License` with:

```markdown
## Prerequisites

- Node.js **≥ 20** (upgraded from 18 in Phase 0 of the NestJS refactor)
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

Vite serves the frontend on <http://localhost:5173>. NestJS serves the API on <http://localhost:3001>. Vite proxies `/api/*` through to NestJS.

**Legacy Express backend** (temporarily preserved through Phase 0 and Phase 1 of the refactor): `pnpm dev:legacy` runs Vite against the old `server.js` + `src/*.js` implementation. Phase 1 deletes those files and this script.

### Running multiple worktrees in parallel

Each worktree has its own `node_modules` and can run `pnpm dev` independently **as long as the ports differ**. Override via env:

```bash
# worktree A (defaults)
pnpm dev

# worktree B (in another shell)
VITE_PORT=5174 API_PORT=3002 pnpm dev
```

`strictPort: true` in Vite and an explicit port in Nest's `main.ts` mean a wrong setting fails loudly instead of auto-falling-back.

## Production build

```bash
pnpm build
pnpm start
```

`pnpm build` compiles `@modeldoctor/contracts` (type-check only), then `apps/web` (Vite → `apps/web/dist/`), then `apps/api` (Nest → `apps/api/dist/`). `pnpm start` runs the compiled API (`node apps/api/dist/main.js`). Static web serving from Nest arrives in Phase 2 — for now, `pnpm start` serves API only.

## Repo layout

```
modeldoctor/
├── apps/
│   ├── web/                # React + Vite + TS frontend (@modeldoctor/web)
│   └── api/                # NestJS 10 backend (@modeldoctor/api) — scaffold only, routes arrive in Phase 1
├── packages/
│   └── contracts/          # Shared Zod schemas (@modeldoctor/contracts) — empty in Phase 0
├── server.js               # LEGACY Express entry — deleted by Phase 1
├── src/                    # LEGACY backend — deleted by Phase 1
├── docs/superpowers/       # Specs and implementation plans
├── tmp/                    # Runtime artifacts (Vegeta request.txt)
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── package.json            # Workspace coordinator
```

## Scripts

| Command | Purpose |
|---------|---------|
| `pnpm dev` | Run Vite + NestJS together (new backend) |
| `pnpm dev:legacy` | Run Vite + legacy Express (remove after Phase 1) |
| `pnpm build` | Build contracts, web, and api |
| `pnpm start` | Run compiled NestJS (`node apps/api/dist/main.js`) |
| `pnpm lint` | Biome lint across all packages |
| `pnpm format` | Biome format across all packages |
| `pnpm type-check` | `tsc --noEmit` across all packages |
| `pnpm test` | Vitest across all packages |
| `pnpm test:e2e` | Nest e2e tests (supertest, empty until Phase 1) |
| `pnpm test:backend:legacy` | Legacy Express tests (removed after Phase 1) |

Before a PR lands, all three must pass:

```bash
pnpm type-check
pnpm lint
pnpm test
```

Conventions and the full debt list live in [`docs/project-standards.md`](docs/project-standards.md).
```

Keep the existing `# ModelDoctor` title, tagline, and `## License` section unchanged.

- [ ] **Step 15.2: Verify markdown renders cleanly**

Run:
```bash
# If you have a markdown linter or just eyeball it:
head -80 README.md
```
Expected: section headers are sane; no duplicated text from the old version; the scripts table has aligned columns.

- [ ] **Step 15.3: Commit**

```bash
git add README.md
git commit -m "docs: update README for workspace layout and Nest-by-default pnpm dev"
```

---

### Task 16: End-to-end smoke — clean install, full stack boots, all checks pass

**Files:** (no changes)

This is the final acceptance gate for Phase 0. Treat any failure here as blocking: fix it in a follow-up step within this task, re-run from the top, then commit the fix.

- [ ] **Step 16.1: Clean reinstall**

Run:
```bash
rm -rf node_modules apps/web/node_modules apps/api/node_modules packages/contracts/node_modules
pnpm install
```
Expected: clean install, no `ERESOLVE` or peer-dep warnings treated as errors. The root lockfile (`pnpm-lock.yaml`) covers all workspace packages.

- [ ] **Step 16.2: Type-check all packages**

Run:
```bash
pnpm type-check
```
Expected: three packages (`web`, `api`, `contracts`) type-check, zero errors.

- [ ] **Step 16.3: Lint all packages**

Run:
```bash
pnpm lint
```
Expected: zero errors. Only `apps/web` has a `lint` script defined in Phase 0 (its Biome config is `apps/web/biome.json`). `apps/api` and `packages/contracts` intentionally have no `lint` / `format` scripts yet — Phase 2 introduces a shared Biome config and adds them back. `pnpm -r --if-present lint` therefore runs lint only for web.

- [ ] **Step 16.4: Run all unit tests**

Run:
```bash
pnpm test
```
Expected:
- `@modeldoctor/web` — all existing tests pass (sidebar-store, load-test store, e2e-smoke store, etc.).
- `@modeldoctor/api` — 1 passed (the `AppController` smoke from Task 9).
- `@modeldoctor/contracts` — 0 tests (no `*.spec.ts` files exist; Vitest reports "No test files found" but exits 0 with `--if-present` — if it exits non-zero, remove the contracts `test` script or add a placeholder spec).

- [ ] **Step 16.5: Run the full stack via `pnpm dev`**

In one terminal:
```bash
pnpm dev
```
Wait until both `[web]` and `[api]` lines appear.

In another terminal:
```bash
# FE reachable
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173

# API reachable directly
curl -s http://localhost:3001/api

# API reachable through Vite proxy
curl -s http://localhost:5173/api
```
Expected: `200`, `Hello World!`, `Hello World!`.

Then open `http://localhost:5173` in a browser:
- Sidebar renders.
- Clicking Load Test / E2E Smoke / Request Debug tabs loads their UIs (FE-only, no backend calls yet for these tabs in Phase 0 — the calls will 404 because those `/api/load-test`, `/api/e2e-test`, `/api/debug/proxy` routes don't exist on the Nest scaffold. This is expected and documented: Phase 1 ports them.)
- Clicking any action button that fires an API request will show a network error. **This is expected Phase 0 behavior** and not a regression — it's the whole reason Phase 1 exists.

If you need to smoke-test actual API functionality, run `pnpm dev:legacy` instead.

Kill `pnpm dev` when done.

- [ ] **Step 16.6: Production build dry-run**

Run:
```bash
pnpm build
ls apps/web/dist | head -3
ls apps/api/dist | head -3
```
Expected:
- `apps/web/dist/index.html` and `apps/web/dist/assets/` present.
- `apps/api/dist/main.js` present.
- No errors from any step.

- [ ] **Step 16.7: Production start dry-run**

Run:
```bash
pnpm start &
sleep 2
curl -s http://localhost:3001/api
kill %1
```
Expected: `Hello World!`. The Nest bundle boots from `apps/api/dist/main.js` using only prod deps. No Vite/FE served here — that's Phase 2.

- [ ] **Step 16.8: Final commit if any tweaks were needed**

If Steps 16.1–16.7 required any config tweaks (e.g. missing `--if-present` flag, a script name adjustment), commit them:
```bash
git status
# review any uncommitted changes
git add -A
git commit -m "chore: Phase 0 smoke fixups"
```
If there are no changes, skip this step.

---

## Phase 0 Definition of Done Checklist

All of these must be true before opening the PR:

- [ ] `pnpm install` succeeds on a clean clone with zero warnings treated as errors.
- [ ] `pnpm dev` starts both `apps/web` (5173) and `apps/api` (3001); `curl http://localhost:5173/api` returns `Hello World!` via the Vite proxy.
- [ ] `pnpm type-check` passes for `apps/web`, `apps/api`, `packages/contracts` — all three.
- [ ] `pnpm test` passes across all packages (includes the `AppController` Vitest smoke in `apps/api`).
- [ ] `pnpm build` produces `apps/web/dist/` and `apps/api/dist/`.
- [ ] `pnpm start` boots `apps/api/dist/main.js` and responds on `/api`.
- [ ] `pnpm dev:legacy` still works — the old Express backend is runnable as a fallback.
- [ ] Old `server.js`, `src/*.js`, and `vitest.backend.config.ts` remain unchanged and in their original locations (Phase 1 deletes them, not this phase).
- [ ] README accurately describes the new workspace layout and scripts.
- [ ] Node `engines` is `>=20.0.0`.
- [ ] `.gitignore` covers `apps/*/node_modules`, `apps/*/dist`, `packages/*/node_modules`, `packages/*/dist`, `*.tsbuildinfo`.
- [ ] Workspace dependency `@modeldoctor/contracts@workspace:*` is linked in both `apps/web` and `apps/api`.
- [ ] Git log shows one commit per task, prefixed per the commit cadence convention.

---

## Out of Scope for This Plan (Phase 1+)

Recorded so a reader doesn't mistake absence for oversight:

- **Porting the 4 existing Express routes to Nest.** That is Phase 1 and will get its own plan document written via `writing-plans` after this plan merges.
- **Deleting `server.js` and `src/*.js`.** Phase 1.
- **Populating `packages/contracts/src/*`** with Zod schemas. Phase 1.
- **@nestjs/config, nestjs-pino, swagger, AllExceptionsFilter, ServeStaticModule.** Phase 2.
- **FE consuming `@modeldoctor/contracts`.** Phase 3.
- **Prisma, Postgres, testcontainers.** Phase 4.
- **Auth (Passport, JWT, guards, throttler).** Phase 5.
- **Docker, GitHub Actions CI, terminus DB health probe.** Phase 6.

Attempting any of these inside this plan is scope creep. If a step in this plan would require one of them to complete, stop and adjust the plan — don't smuggle the next phase in.

---

**End of Phase 0 plan.**
