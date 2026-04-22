# ModelDoctor

Troubleshooting toolkit for model-serving APIs.

**Current state:** Spec 1 — frontend skeleton with three working tabs (Load Test, E2E Smoke, Request Debug). Five additional tabs (Soak / Stability, Streaming TTFT, Regression, Health Monitor, History) are visible in the sidebar as placeholders and arrive in later specs. Connection credentials are persisted to browser `localStorage` in plaintext; Spec 2 will move them to an encrypted backend store. Do **not** deploy Spec 1 on an untrusted network.

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
├── docs/superpowers/       # Specs and implementation plans
├── tmp/                    # Runtime artifacts (Vegeta request.txt)
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── package.json            # Workspace coordinator
```

## Scripts

| Command | Purpose |
|---------|---------|
| `pnpm dev` | Run Vite + NestJS together |
| `pnpm build` | Build contracts, web, and api |
| `pnpm start` | Run compiled NestJS (`node apps/api/dist/main.js`) |
| `pnpm lint` | Biome lint across all packages |
| `pnpm format` | Biome format across all packages |
| `pnpm type-check` | `tsc --noEmit` across all packages |
| `pnpm test` | Vitest across all packages |
| `pnpm test:e2e` | Nest e2e tests (supertest, empty until Phase 1) |

Before a PR lands, all three must pass:

```bash
pnpm type-check
pnpm lint
pnpm test
```

Conventions and the full debt list live in [`docs/project-standards.md`](docs/project-standards.md).

## License

MIT
