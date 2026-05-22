# Contributing to ModelDoctor

## Module System

This monorepo is migrating to **pure ESM**. Phase 1 (PR #225) covers
`packages/contracts`, `packages/tool-adapters`, and `apps/web`, plus
monorepo-wide governance via biome rules and CI guards.

Phase 2 (issue #224, targeted **2026 Q3**) covers `apps/api` alongside
the NestJS 12 upgrade, when NestJS officially ships ESM across its core
packages.

### Rules for `packages/*` and `apps/web/**`

These directories are **strict ESM-only**:

- Every `package.json` MUST have `"type": "module"` and
  `"engines": { "node": ">=20.11" }`.
- No `require()`, `module.exports`, `exports.x`, or `*.cjs` source
  files. (Build-output `.cjs` and `.d.cts` files in `dist/` are
  expected during the Phase 1 transition — those are CJS compatibility
  artifacts for apps/api consumers; Phase 2 deletes them.)
- No `__dirname` / `__filename` globals. Use the ESM polyfill where
  needed:
  ```ts
  import { fileURLToPath } from "node:url";
  import path from "node:path";
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  ```
- All Node.js built-ins MUST use the `node:` prefix:
  ```ts
  import { readFile } from "node:fs/promises";
  ```
  Biome's `useNodejsImportProtocol` rule enforces this monorepo-wide.

### `.js` extension on relative imports — recommended but not enforced

Biome's `useImportExtensions` rule was attempted but dropped in
this migration because Biome 1.x cannot scope rules per-workspace in
a way that survives `pnpm -r lint`'s per-package biome invocation
(see commit `00326ba` for the technical details).

**Recommendation:** When writing new code in `packages/*`, write
relative imports with explicit `.js` extensions (e.g.,
`import { foo } from "./bar.js"`). This is forward-compatible with
NodeNext resolution and required when this monorepo eventually moves
to a Biome 2.x or migrates to a strict node-resolver. The existing
code in `packages/contracts` and `packages/tool-adapters` already
follows this convention.

### CI enforcement layers

- **Biome rules** ([catalog](https://biomejs.dev/linter/rules/)):
  `noCommonJs` (forbids `require()`), `useNodejsImportProtocol`
  (forces `node:` prefix). Run via `pnpm lint` per workspace.
- **[publint](https://publint.dev/) `--strict`** — validates each
  `packages/*` exports field, main, types resolution shape.
- **[@arethetypeswrong/cli](https://github.com/arethetypeswrong/arethetypeswrong.github.io)
  `--profile node16`** — verifies type resolution works for ESM
  consumers under Node 16+.
- **Raw `grep` guards** — catches `__dirname` / `__filename` that
  Biome 1.x doesn't flag, plus the `"type": "module"` presence check
  on every relevant `package.json`. Test files (`*.spec.ts`,
  `*.test.ts`) are excluded from the `__dirname` check because they
  legitimately use the ESM shim form shown above.

All of the above run in `.github/workflows/ci.yml`, `lint-type-test`
job, after `pnpm lint`.

### Rules for `apps/api/**` (temporary CJS pocket)

Until Phase 2 (#224) lands, `apps/api/tsconfig.json` keeps
`module: "commonjs"` and `biome.json` overrides disable
`style.noCommonJs` under `apps/api/**`. **Do not add new CJS patterns
to `apps/api` during this period** — the goal is zero new tech debt
to clean up at Phase 2.

If you find yourself reaching for `require()`, `module.exports`, or
`__dirname` in `apps/api`, the answer is almost certainly to use
`import` / `import.meta.url` instead. The CJS-mode TypeScript
compiler downlevels to `require` at build time, so writing ESM-style
import statements works fine today and avoids Phase 2 rewrite.

### Adding a new workspace package

New packages MUST start ESM-only. Use `packages/contracts/package.json`
as the template (note the nested-types `exports` shape required by
publint):

```json
{
  "name": "@modeldoctor/<name>",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20.11" },
  "sideEffects": false,
  "main": "./dist/index.cjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": {
        "types": "./dist/index.d.ts",
        "default": "./src/index.ts"
      },
      "require": {
        "types": "./dist/index.d.cts",
        "default": "./dist/index.cjs"
      },
      "default": "./dist/index.js"
    }
  }
}
```

The `require` branch and `.d.cts` types are needed only while
`apps/api` is still CJS (Phase 2 #224 simplifies this once apps/api
flips to ESM).

For a new package, copy `tsconfig.build.json`, `tsconfig.build.cjs.json`,
and `scripts/rename-cjs.mjs` from `packages/contracts` as starting
templates.
