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
