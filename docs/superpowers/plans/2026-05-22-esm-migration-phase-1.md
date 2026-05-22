# ESM 迁移 Phase 1 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `packages/contracts` + `packages/tool-adapters` 迁到 ESM,立下全仓 ESM-only 强约束规范(biome 规则 + CI guard + CONTRIBUTING),`apps/api` 保 CJS 等 NestJS 12(Phase 2,issue #224)。

**Architecture:** 分两步保护性收紧 —— 先在 `apps/api/tsconfig.json` 加 override 把它跟将要变化的 `tsconfig.base.json` 隔离,再收紧 base。packages 出 dual-package(`.js` + `.cjs`)产物供 ESM 消费者(apps/web 直接读 src TS)和 CJS 消费者(apps/api 读 `.cjs`)分别用,Phase 2 后删 cjs 产物。强约束通过 biome 规则 + CI publint/attw/grep guard 三层防回归。

**Tech Stack:** TypeScript 5.x, Biome 1.9+, pnpm 10 workspace, publint, @arethetypeswrong/cli, GitHub Actions CI, NestJS 11 (apps/api CJS), Vite 5 (apps/web ESM).

**Spec:** `docs/superpowers/specs/2026-05-22-esm-migration-design.md`
**PR:** #225 (draft)
**Phase 2 follow-up:** #224

---

## File Structure

**Modify:**
- `tsconfig.base.json` — 收紧到 NodeNext + verbatimModuleSyntax(影响所有 inheritor)
- `apps/api/tsconfig.json` — 显式 override 维持 CJS(防止 base 收紧波及)
- `packages/contracts/package.json` — `type: module`、dual exports、engines、sideEffects、build script
- `packages/contracts/tsconfig.build.json` — 切到 NodeNext ESM 主产物
- `packages/tool-adapters/package.json` — 同 contracts
- `packages/tool-adapters/tsconfig.build.json` — 同 contracts
- `packages/tool-adapters/src/evalscope/runtime.spec.ts` — 补 fileURLToPath shim
- `packages/tool-adapters/src/aiperf/runtime.spec.ts` — 补 fileURLToPath shim
- `biome.json` — 加 noCommonJs / useNodejsImportProtocol / useImportExtensions 规则 + apps/api override
- `.github/workflows/ci.yml` — `lint-type-test` job 加 4 个 ESM-guard 步骤
- `package.json` (root) — 加 devDeps: publint, @arethetypeswrong/cli

**Create:**
- `packages/contracts/tsconfig.build.cjs.json` — CJS 兼容产物 tsconfig
- `packages/contracts/scripts/rename-cjs.mjs` — 把 `dist/cjs/*.js` 重命名为 `dist/*.cjs`
- `packages/tool-adapters/tsconfig.build.cjs.json` — 同 contracts
- `packages/tool-adapters/scripts/rename-cjs.mjs` — 同 contracts
- `CONTRIBUTING.md` (root) — ESM-only governance

---

### Task 1: 隔离 apps/api 并收紧 tsconfig.base.json

**Files:**
- Modify: `apps/api/tsconfig.json`
- Modify: `tsconfig.base.json`

操作顺序很关键:**必须先**给 apps/api 加 override(它当前就是 CJS,override 是 no-op,但 base 收紧后才是 safety net),**再**改 base。两步合一个 commit。

- [ ] **Step 1: 读现状,确认基线 typecheck 通过**

Run:
```bash
cd /Users/fangyong/vllm/modeldoctor/feat-esm-migration-phase-1
pnpm -r type-check 2>&1 | tail -20
```
Expected: 全部 packages 通过,无错误。如果当前已有 typecheck 错误,先不要继续。

- [ ] **Step 2: 修改 `apps/api/tsconfig.json` —— 补足显式 override**

打开文件,确认 `compilerOptions` 块包含以下字段(若缺则加,若已存在则保留):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    // ── Phase 2 (#224) removes these overrides — base will be the
    //    single source of truth (NodeNext + verbatimModuleSyntax).
    "module": "commonjs",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "verbatimModuleSyntax": false,
    "allowSyntheticDefaultImports": true,
    "isolatedModules": false,
    // ── (existing apps/api-specific options below, keep as-is) ──
    "target": "ES2022",
    "outDir": "./dist",
    "rootDir": "./src",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "incremental": false
  },
  "include": ["src/**/*"]
}
```

**重要**:`incremental: false` 是 modeldoctor CLAUDE.md 的硬约束(`incremental: true` 与 `nest-cli.json deleteOutDir` 冲突),不要碰这条。`include` 必须保持 narrow(`src/**/*`),也是 CLAUDE.md 硬约束。

实际改动:在 `compilerOptions` 块顶部插入注释和 6 行 override。其它字段保留现状(用 Read 工具看原文件,改时 surgical edit)。

- [ ] **Step 3: 验证 apps/api typecheck 仍然通过(override 是 no-op)**

Run:
```bash
pnpm -F @modeldoctor/api type-check
```
Expected: 通过,无错误。

- [ ] **Step 4: 收紧 `tsconfig.base.json`**

替换 `compilerOptions` 整块为:

```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2023",
    "verbatimModuleSyntax": true,
    "esModuleInterop": false,
    "allowSyntheticDefaultImports": false,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  }
}
```

(保留原 `compilerOptions` 之外的字段,如 `exclude` / `include` / `extends` —— 用 Read 看原文件)

- [ ] **Step 5: 验证全栈 typecheck 仍然通过**

Run:
```bash
pnpm -r type-check
```
Expected: 全部通过。如果 `apps/web` 或 packages 报新错(大概率是因为 verbatimModuleSyntax 强制 explicit `import type`),修复方式:把违规 import 改成 `import type`。如果错误数量 > 10,**回滚** Step 4 重新评估范围 —— 可能某些包还没准备好。

- [ ] **Step 6: 跑全部测试确认无回归**

Run:
```bash
pnpm -r test
```
Expected: 全过。

- [ ] **Step 7: Commit**

```bash
git add tsconfig.base.json apps/api/tsconfig.json
git commit -m "$(cat <<'EOF'
chore: tighten tsconfig.base.json to NodeNext ESM-strict; isolate apps/api

base now enforces module: NodeNext + moduleResolution: NodeNext +
verbatimModuleSyntax: true (per Phase 1 spec). apps/api adds explicit
overrides to maintain its current CJS behavior until Phase 2 (#224)
aligns it with NestJS 12 GA.

Refs: #225

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

---

### Task 2: 迁移 packages/contracts 到 ESM

**Files:**
- Modify: `packages/contracts/package.json`
- Modify: `packages/contracts/tsconfig.build.json`
- Create: `packages/contracts/tsconfig.build.cjs.json`
- Create: `packages/contracts/scripts/rename-cjs.mjs`

- [ ] **Step 1: 替换 `packages/contracts/package.json`**

```json
{
  "name": "@modeldoctor/contracts",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "Shared Zod schemas and inferred types between apps/web and apps/api",
  "engines": {
    "node": ">=20.11"
  },
  "sideEffects": false,
  "main": "./dist/index.cjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./src/index.ts",
      "require": "./dist/index.cjs",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "rm -rf dist && tsc -p tsconfig.build.json && tsc -p tsconfig.build.cjs.json && node ./scripts/rename-cjs.mjs",
    "dev": "tsc -w -p tsconfig.build.json --preserveWatchOutput",
    "type-check": "tsc -p tsconfig.json --noEmit",
    "lint": "biome check src",
    "format": "biome format --write src",
    "test": "vitest run --passWithNoTests"
  },
  "dependencies": {
    "zod": "^3.23"
  }
}
```

关键变化:
- `"type": "module"` —— 顶级标识为 ESM
- `engines.node: ">=20.11"` —— 锁底
- `sideEffects: false` —— tree-shake hint
- `main: "./dist/index.cjs"` —— 不带 `exports` 字段的老消费者回退路径
- `exports.import` —— ESM 消费者读 `./src/index.ts`(apps/web Vite 直接编译 TS source)
- `exports.require` —— CJS 消费者读 `./dist/index.cjs`(apps/api 当前)
- `exports.default` —— 万一其他 ESM 消费者要 dist 产物
- `build` script 三步:tsc ESM + tsc CJS + 重命名

- [ ] **Step 2: 替换 `packages/contracts/tsconfig.build.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "noEmit": false
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "**/*.spec.ts", "**/*.test.ts"]
}
```

变化:`module: commonjs → NodeNext`,`moduleResolution: node → NodeNext`。

- [ ] **Step 3: 创建 `packages/contracts/tsconfig.build.cjs.json`**

```json
{
  "extends": "./tsconfig.build.json",
  "compilerOptions": {
    "module": "commonjs",
    "moduleResolution": "node",
    "verbatimModuleSyntax": false,
    "outDir": "./dist/cjs"
  }
}
```

`verbatimModuleSyntax: false` 必要 —— CJS 编译时 base 的 `true` 会拒绝 `export default` 等模式。

- [ ] **Step 4: 创建 `packages/contracts/scripts/rename-cjs.mjs`**

```js
#!/usr/bin/env node
// Move dist/cjs/*.js → dist/*.cjs (flat), keep .d.ts / .map files in their original ESM dir.
// Phase 2 (#224) removes this script along with the cjs build output.
import { readdir, rename, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const cjsDir = join(__dirname, "..", "dist", "cjs");
const outDir = join(__dirname, "..", "dist");

const files = await readdir(cjsDir);
for (const f of files) {
  if (f.endsWith(".js")) {
    const base = f.replace(/\.js$/, "");
    await rename(join(cjsDir, f), join(outDir, `${base}.cjs`));
  } else if (f.endsWith(".js.map")) {
    const base = f.replace(/\.js\.map$/, "");
    await rename(join(cjsDir, f), join(outDir, `${base}.cjs.map`));
  }
}
await rmdir(cjsDir, { recursive: true });
console.log(`renamed CJS outputs from ${cjsDir} into ${outDir} as .cjs`);
```

- [ ] **Step 5: 构建 contracts 验证 dist 形态**

Run:
```bash
pnpm -F @modeldoctor/contracts build
ls packages/contracts/dist/
```
Expected: 同时有 `index.js`(ESM)、`index.cjs`(CJS)、`index.d.ts`(types)。无 `dist/cjs/` 残留(已被 rename 脚本删掉)。

- [ ] **Step 6: 验证 ESM 产物头部**

Run:
```bash
head -3 packages/contracts/dist/index.js
head -3 packages/contracts/dist/index.cjs
```
Expected:
- `index.js` 第一行应 NOT 是 `"use strict"`(ESM 产物不需要 use strict)
- `index.cjs` 第一行应 是 `"use strict"`(CJS 产物)

- [ ] **Step 7: 验证 apps/api 仍能消费 contracts**

Run:
```bash
pnpm -F @modeldoctor/api type-check
pnpm -F @modeldoctor/api test 2>&1 | tail -20
```
Expected:typecheck 通过,test 全过。apps/api 透过 `exports.require` 解析到 `index.cjs`,行为应该跟之前一致。

- [ ] **Step 8: 验证 apps/web 仍能消费 contracts**

Run:
```bash
pnpm -F @modeldoctor/web type-check
pnpm -F @modeldoctor/web test 2>&1 | tail -20
```
Expected:全过。apps/web 透过 `exports.import` 解析到 `src/index.ts`(Vite 编译 TS),与改造前路径一致。

- [ ] **Step 9: Commit**

```bash
git add packages/contracts/
git commit -m "$(cat <<'EOF'
refactor(contracts): migrate to ESM with dual-package output

- package.json: type=module, dual exports (import→src.ts, require→dist.cjs)
- tsconfig.build.json: module NodeNext for ESM dist
- new tsconfig.build.cjs.json: CJS compatibility output (deleted in Phase 2 #224)
- new scripts/rename-cjs.mjs: flatten dist/cjs/*.js → dist/*.cjs

apps/api consumes via the require branch (.cjs), apps/web consumes via
the import branch (TS source through Vite). Both verified.

Refs: #225

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

---

### Task 3: 迁移 packages/tool-adapters 到 ESM + 修 spec shim

**Files:**
- Modify: `packages/tool-adapters/package.json`
- Modify: `packages/tool-adapters/tsconfig.build.json`
- Create: `packages/tool-adapters/tsconfig.build.cjs.json`
- Create: `packages/tool-adapters/scripts/rename-cjs.mjs`
- Modify: `packages/tool-adapters/src/evalscope/runtime.spec.ts`
- Modify: `packages/tool-adapters/src/aiperf/runtime.spec.ts`

- [ ] **Step 1: 读现状,记下 tool-adapters/package.json 当前形态**

Run:
```bash
cat packages/tool-adapters/package.json
```
照 contracts 同样的形式改造,**保留** tool-adapters 自己的 `dependencies` 字段(可能含 zod、@modeldoctor/contracts 等)。

- [ ] **Step 2: 修改 `packages/tool-adapters/package.json`**

复用 Task 2 Step 1 的 package.json 结构,**只改 name 和 description**:

```json
{
  "name": "@modeldoctor/tool-adapters",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "Per-benchmark-tool runtime adapters: command building + report parsing",
  "engines": {
    "node": ">=20.11"
  },
  "sideEffects": false,
  "main": "./dist/index.cjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./src/index.ts",
      "require": "./dist/index.cjs",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "rm -rf dist && tsc -p tsconfig.build.json && tsc -p tsconfig.build.cjs.json && node ./scripts/rename-cjs.mjs",
    "dev": "tsc -w -p tsconfig.build.json --preserveWatchOutput",
    "type-check": "tsc -p tsconfig.json --noEmit",
    "lint": "biome check src",
    "format": "biome format --write src",
    "test": "vitest run --passWithNoTests"
  },
  "dependencies": {
    "@modeldoctor/contracts": "workspace:*",
    "zod": "^3.23"
  }
}
```

**注意**:`dependencies` 块要保持原文件的真实内容(Read 看一眼),不要照搬此处的 dependencies 部分。其余结构按上方一致。

- [ ] **Step 3: 修改 `packages/tool-adapters/tsconfig.build.json`**

与 Task 2 Step 2 相同:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "noEmit": false
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "**/*.spec.ts", "**/*.test.ts"]
}
```

- [ ] **Step 4: 创建 `packages/tool-adapters/tsconfig.build.cjs.json`**

与 Task 2 Step 3 相同:

```json
{
  "extends": "./tsconfig.build.json",
  "compilerOptions": {
    "module": "commonjs",
    "moduleResolution": "node",
    "verbatimModuleSyntax": false,
    "outDir": "./dist/cjs"
  }
}
```

- [ ] **Step 5: 创建 `packages/tool-adapters/scripts/rename-cjs.mjs`**

完全复用 Task 2 Step 4 的脚本(路径相对解析,跟 contracts 一致):

```js
#!/usr/bin/env node
// Move dist/cjs/*.js → dist/*.cjs (flat), keep .d.ts / .map files in their original ESM dir.
// Phase 2 (#224) removes this script along with the cjs build output.
import { readdir, rename, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const cjsDir = join(__dirname, "..", "dist", "cjs");
const outDir = join(__dirname, "..", "dist");

const files = await readdir(cjsDir);
for (const f of files) {
  if (f.endsWith(".js")) {
    const base = f.replace(/\.js$/, "");
    await rename(join(cjsDir, f), join(outDir, `${base}.cjs`));
  } else if (f.endsWith(".js.map")) {
    const base = f.replace(/\.js\.map$/, "");
    await rename(join(cjsDir, f), join(outDir, `${base}.cjs.map`));
  }
}
await rmdir(cjsDir, { recursive: true });
console.log(`renamed CJS outputs from ${cjsDir} into ${outDir} as .cjs`);
```

- [ ] **Step 6: 修 `packages/tool-adapters/src/evalscope/runtime.spec.ts:1-8`**

打开文件,把开头的 imports + `fixturePath` 改成:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { BuildCommandPlan } from "../core/interface.js";
import { buildCommand, getMaxDurationSeconds, parseFinalReport, parseProgress } from "./runtime.js";
import type { EvalscopeParams } from "./schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = (n: string) => path.join(__dirname, "__fixtures__", n);
```

变化:加 `fileURLToPath` import、用 `path` 默认 import 取代 `{ join }` 命名 import(为 `path.dirname` 调用)、加 `__dirname` 推导一行。`fixturePath` 改用 `path.join`。

(改完后 `import { join }` 不再用,自然删掉。)

- [ ] **Step 7: 修 `packages/tool-adapters/src/aiperf/runtime.spec.ts:1-8`**

跟 Step 6 完全同样的改动,在 aiperf 的 spec 文件上 apply。

- [ ] **Step 8: 构建 tool-adapters 验证 dist 形态**

Run:
```bash
pnpm -F @modeldoctor/tool-adapters build
ls packages/tool-adapters/dist/ | head -10
```
Expected:同时有 `index.js`、`index.cjs`、`index.d.ts`。无 `dist/cjs/` 残留。

- [ ] **Step 9: 跑 tool-adapters 测试(验证 shim 修复)**

Run:
```bash
pnpm -F @modeldoctor/tool-adapters test 2>&1 | tail -20
```
Expected:全过。如果 evalscope 或 aiperf 的 spec 仍报 `ReferenceError: __dirname is not defined`,说明 shim 没生效,检查 Step 6/7 的修改。

- [ ] **Step 10: 验证 apps/api 仍能消费 tool-adapters**

Run:
```bash
pnpm -F @modeldoctor/api type-check
pnpm -F @modeldoctor/api test 2>&1 | tail -10
```
Expected:全过。

- [ ] **Step 11: 验证 apps/web 仍能消费**

Run:
```bash
pnpm -F @modeldoctor/web type-check
```
Expected:全过。

- [ ] **Step 12: Commit**

```bash
git add packages/tool-adapters/
git commit -m "$(cat <<'EOF'
refactor(tool-adapters): migrate to ESM + fix two CJS-only spec shims

- package.json: type=module, dual exports (mirrors contracts pattern)
- tsconfig.build.json + tsconfig.build.cjs.json: dual-output build
- new scripts/rename-cjs.mjs: same rename helper as contracts
- src/evalscope/runtime.spec.ts: add fileURLToPath shim for __dirname
- src/aiperf/runtime.spec.ts: same fix

The two spec files were the only CJS-only patterns in packages/* source.
Other adapter specs (guidellm/prefix-cache-probe/vegeta) already had
the ESM shim.

Refs: #225

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

---

### Task 4: 加 Biome 强约束规则

**Files:**
- Modify: `biome.json`

- [ ] **Step 1: 读现状**

Run:
```bash
cat biome.json | head -50
```
确认当前 `linter.rules.style` 块的真实形态。

- [ ] **Step 2: 修改 `biome.json` —— 加 3 个新规则 + apps/api override**

在 `linter.rules.style` 块加 3 个 key,并在 `overrides` 数组(若不存在则新建)里加 apps/api 例外。

期望最终 `biome.json` 关键片段:

```json
{
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "style": {
        "noUselessElse": "warn",
        "useConst": "warn",
        "useImportType": "off",
        "noCommonJs": "error",
        "useNodejsImportProtocol": "error",
        "useImportExtensions": "error"
      },
      "suspicious": { "noExplicitAny": "warn", "noArrayIndexKey": "warn" }
    }
  },
  "overrides": [
    {
      "include": ["apps/api/**/*.ts"],
      "linter": {
        "rules": {
          "style": { "noCommonJs": "off" }
        }
      }
    }
  ]
}
```

**注意**:
- 原 `style` 块的现有规则(noUselessElse / useConst / useImportType)保留,不要删
- 原 `suspicious` 块保留,不要删
- 如果 `overrides` 字段已存在,在数组里 append 而非替换
- 用 Read 拿到完整原文,surgical edit 而非整体替换

- [ ] **Step 3: 跑 biome ci 验证零错误**

Run:
```bash
pnpm biome ci . 2>&1 | tail -30
```
Expected:零 errors。如果 packages 出新 errors:
- `useNodejsImportProtocol` 报 `import fs from "fs"` 之类 —— 手动改成 `from "node:fs"`
- `useImportExtensions` 报相对 import 缺 `.js` —— 手动补
- `noCommonJs` 在 apps/api 报错说明 override include glob 写错了 —— 改正

- [ ] **Step 4: Commit**

```bash
git add biome.json
git commit -m "$(cat <<'EOF'
chore: enable biome ESM-only rules; carve out apps/api temporarily

Rules added under linter.rules.style:
- noCommonJs (error)        — forbids require()/module.exports/exports.x
- useNodejsImportProtocol   — enforces "node:fs" not "fs"
- useImportExtensions       — enforces .js suffix on relative imports

apps/api/** keeps noCommonJs disabled via overrides until Phase 2 (#224)
migrates it to ESM. CONTRIBUTING.md (Task 6) documents the rule.

Refs: #225

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

---

### Task 5: 加 publint + attw devDeps + CI ESM-guard 步骤

**Files:**
- Modify: `package.json` (root)
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: 加 root devDeps**

Run:
```bash
pnpm add -Dw publint @arethetypeswrong/cli
```
Expected:`package.json` `devDependencies` 多两行,`pnpm-lock.yaml` 更新。

- [ ] **Step 2: 本地验证 publint 通过**

Run:
```bash
pnpm -r --filter='./packages/*' exec publint --strict 2>&1 | tail -20
```
Expected:零 errors。如有 errors —— 通常是 exports 字段顺序或 main 字段缺失 —— 按 publint 输出修复。

- [ ] **Step 3: 本地验证 attw 通过**

Run:
```bash
pnpm -r --filter='./packages/*' exec attw --pack --profile node16 2>&1 | tail -30
```
Expected:每个 package 通过 ✓。如果 attw 报 "Internal package marker" 或类似 —— 加 `--ignore-rules` 把不适用的规则忽略(private package 通常不需要 cross-runtime profile)。

如果 attw 对 private workspace 包不太友好,可以 fallback 到 `attw --pack --profile esm-only`(因为我们的产物对内消费,不是公开包)。如果都不工作,**降级**为只跑 publint,attw 暂时不加 CI。但要在 PR description 说明这个降级。

- [ ] **Step 4: 修改 `.github/workflows/ci.yml` —— 在 `pnpm lint` 后追加 4 个步骤**

打开 `.github/workflows/ci.yml`,在 `lint-type-test` job 的 `- run: pnpm lint` 这行**之后**,`- run: pnpm -r test` **之前**插入:

```yaml
      - name: Validate packages publish shape
        run: pnpm -r --filter='./packages/*' exec publint --strict

      - name: Validate types resolve in ESM
        run: pnpm -r --filter='./packages/*' exec attw --pack --profile node16

      - name: No CJS-only globals in packages/ + apps/web
        run: |
          set -e
          if grep -rEn "(^|[^a-zA-Z_])(__dirname|__filename)\b" \
              --include='*.ts' --include='*.tsx' \
              packages/ apps/web/src/; then
            echo "::error::CJS-only globals (__dirname/__filename) found in ESM scope"
            exit 1
          fi

      - name: All non-api packages have type:module
        run: |
          set -e
          fail=0
          for f in packages/*/package.json apps/web/package.json; do
            if ! grep -q '"type": "module"' "$f"; then
              echo "::error file=$f::missing \"type\": \"module\""
              fail=1
            fi
          done
          exit $fail
```

(如果 Step 3 决定 fallback 跳过 attw,删掉 "Validate types resolve in ESM" 这步。)

- [ ] **Step 5: 本地模拟 CI 跑这 4 个步骤**

Run:
```bash
# 重新跑 publint
pnpm -r --filter='./packages/*' exec publint --strict
# (attw 已在 Step 3)
# grep guard
! grep -rEn "(^|[^a-zA-Z_])(__dirname|__filename)\b" \
    --include='*.ts' --include='*.tsx' \
    packages/ apps/web/src/
# type:module guard
for f in packages/*/package.json apps/web/package.json; do
  grep -q '"type": "module"' "$f" || echo "MISSING: $f"
done
```
Expected:全部静默通过(无 error 输出)。grep `__dirname` 在 `packages/tool-adapters/src/*/runtime.spec.ts` 应该都有但是被 `path.dirname(fileURLToPath(...))` 的 `__dirname` 赋值匹配 —— 这种是合法的 ESM shim,**不**应该被这个 guard 拦下。

**重要 verify**:如果上面的 grep 输出了 tool-adapters 里那些 `const __dirname = path.dirname(...)` 的行,说明 grep pattern 太宽,要改成只拦"使用"而非"声明"。改 grep 为:

```bash
grep -rEn "(^|[^a-zA-Z_=])__(dirname|filename)\b" \
    --include='*.ts' --include='*.tsx' \
    packages/ apps/web/src/ \
  | grep -v "const __" \
  | grep -v "path.dirname.*fileURLToPath"
```

更稳的做法:在 grep 输出后过滤掉合法 ESM shim 行。把 CI step 改成上面这种带过滤的形式。

(实际上更稳的是用 ast-grep 或 ts 抽象语法树,但 grep + 过滤已经够用,简单优先。)

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml .github/workflows/ci.yml
git commit -m "$(cat <<'EOF'
ci: add ESM-guard steps to lint-type-test job

Three guards layered after pnpm lint:
1. publint --strict      — validates packages/* publish-shape
2. attw --profile node16 — validates types resolve in ESM consumers
3. grep __dirname        — catches CJS-only globals biome doesn't (with
                           legitimate-shim filter)
4. grep type:module      — enforces type=module on non-api packages

apps/api intentionally excluded from all four — Phase 2 (#224) flips it.

Refs: #225

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

---

### Task 6: 新建 CONTRIBUTING.md(根)

**Files:**
- Create: `CONTRIBUTING.md`

- [ ] **Step 1: 检查 CONTRIBUTING.md 是否已存在**

Run:
```bash
ls CONTRIBUTING.md 2>&1
```
- 如果存在:Read 它,在文件末尾 append 一个 `## Module System` section
- 如果不存在:新建一个含 ESM section 的最小 CONTRIBUTING.md

- [ ] **Step 2: 写 `CONTRIBUTING.md`**

如果新建,内容如下:

```markdown
# Contributing to ModelDoctor

## Module System

This monorepo is migrating to **pure ESM**. Phase 1 (PR #225) covers
`packages/contracts`, `packages/tool-adapters`, and `apps/web`, plus
monorepo-wide governance via biome rules + CI guards.

Phase 2 (issue #224, targeted **2026 Q3**) will cover `apps/api`
alongside the NestJS 12 upgrade, when NestJS officially ships ESM
across its core packages.

### Rules for `packages/*` and `apps/web/**`

These directories are **strict ESM-only**:

- Every `package.json` MUST have `"type": "module"` and
  `"engines": { "node": ">=20.11" }`.
- No `require()`, `module.exports`, `exports.x`, or `*.cjs` source
  files. (Build-output `.cjs` files in `dist/` are OK during the
  Phase 1 transition; Phase 2 deletes them.)
- No `__dirname` / `__filename` globals. Use the ESM polyfill where
  needed: `path.dirname(fileURLToPath(import.meta.url))`.
- All relative imports MUST include the `.js` extension on TypeScript
  files. TypeScript source `import { x } from "./foo.js"` resolves to
  `./foo.ts` and emits the `.js` reference for runtime.
- All Node.js built-ins MUST use the `node:` prefix:
  `import { readFile } from "node:fs/promises"`.

CI enforces these via:

- [Biome rules](https://biomejs.dev/linter/rules/) — `noCommonJs`,
  `useNodejsImportProtocol`, `useImportExtensions`
- [publint](https://publint.dev/) `--strict` on each package
- [@arethetypeswrong/cli](https://github.com/arethetypeswrong/arethetypeswrong.github.io)
  `--profile node16` on each package
- Raw `grep` for `__dirname` / `__filename` (catches what biome misses)
- `grep` for `"type": "module"` on every relevant `package.json`

See `.github/workflows/ci.yml` `lint-type-test` job.

### Rules for `apps/api/**` (temporary CJS pocket)

Until Phase 2 (#224) lands, `apps/api/tsconfig.json` keeps
`module: "commonjs"` and `biome.json` overrides disable
`style.noCommonJs` under `apps/api/**`. **Do not add new CJS patterns
to `apps/api` during this period** — the goal is zero new tech debt to
clean up at Phase 2.

If you find yourself reaching for `require()`, `module.exports`, or
`__dirname` in `apps/api`, ping the team — the answer is almost
certainly to use `import` / `import.meta.url` instead, and let the
TypeScript compiler downlevel to CJS at build time.

### Adding a new workspace package

New packages MUST start ESM-only. Use `packages/contracts/package.json`
as the template:

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
      "types": "./dist/index.d.ts",
      "import": "./src/index.ts",
      "require": "./dist/index.cjs",
      "default": "./dist/index.js"
    }
  }
}
```

The `require` branch is needed only while `apps/api` is still CJS
(Phase 2 #224 deletes both branches and `main`).
```

如果 `CONTRIBUTING.md` 已存在,从 `## Module System` 开始追加同样内容。

- [ ] **Step 3: Commit**

```bash
git add CONTRIBUTING.md
git commit -m "$(cat <<'EOF'
docs: add CONTRIBUTING.md with ESM-only governance rules

Documents the Phase 1 / Phase 2 split, strict rules for packages/* +
apps/web, the temporary apps/api CJS pocket, and a template package.json
shape for new workspace packages.

Refs: #225

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

---

### Task 7: 全栈验证 + PR 更新

**Files:** 无新文件;运行验证 + 在 PR 加结果

- [ ] **Step 1: 跑 spec 验证 checklist 全部 13 项**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat-esm-migration-phase-1
echo "=== 1. pnpm install no warnings ==="
pnpm install 2>&1 | tail -5

echo "=== 2. pnpm -r build (packages produce both .js and .cjs) ==="
pnpm -r build 2>&1 | tail -10
ls packages/contracts/dist/ packages/tool-adapters/dist/

echo "=== 3. apps/api start:dev startup smoke ==="
timeout 15 pnpm -F @modeldoctor/api start:dev 2>&1 | head -30 &
sleep 12
curl -sf http://localhost:3001/api/health || echo "health probe failed"
pkill -f "start:dev" 2>/dev/null

echo "=== 4. apps/api unit tests ==="
pnpm -F @modeldoctor/api test 2>&1 | tail -10

echo "=== 5. apps/api e2e ==="
pnpm -F @modeldoctor/api test:e2e 2>&1 | tail -10

echo "=== 6. apps/web dev startup ==="
timeout 10 pnpm -F @modeldoctor/web dev 2>&1 | head -20 &
sleep 7
curl -sf http://localhost:5173/ > /dev/null && echo "web up" || echo "web failed"
pkill -f "vite" 2>/dev/null

echo "=== 7. apps/web build ==="
pnpm -F @modeldoctor/web build 2>&1 | tail -5

echo "=== 8. browser e2e (smoke only — full takes too long) ==="
pnpm test:e2e:browser --reporter=line 2>&1 | tail -10

echo "=== 9. biome ci ==="
pnpm biome ci . 2>&1 | tail -5

echo "=== 10. publint ==="
pnpm -r --filter='./packages/*' exec publint --strict 2>&1 | tail -5

echo "=== 11. attw ==="
pnpm -r --filter='./packages/*' exec attw --pack --profile node16 2>&1 | tail -5

echo "=== 12. CI esm-guard locally ==="
gh workflow run ci.yml --ref feat/esm-migration-phase-1 2>&1 | tail -5 || echo "skip - gh workflow run not authorized"

echo "=== 13. docker build prod path ==="
docker build -t modeldoctor:esm-phase1-test . 2>&1 | tail -10
```

Expected:每项 ✓。任何 ✗ 都要 surface 出来定位修。

- [ ] **Step 2: 修任何 verification 失败**

不预设具体内容 —— 修完后追加 commit:

```bash
git add <files>
git commit -m "fix: <specific issue from verification>

Refs: #225

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push
```

- [ ] **Step 3: 在 PR #225 上追加 verification 结果评论**

```bash
gh pr comment 225 --body "$(cat <<'EOF'
## Phase 1 verification results

Ran the 13-item checklist from the spec on `feat/esm-migration-phase-1` after the implementation commits:

- [x] pnpm install: zero warnings
- [x] pnpm -r build: packages emit `.js` + `.cjs` + `.d.ts`
- [x] apps/api `start:dev`: health probe 200
- [x] apps/api unit tests pass
- [x] apps/api e2e pass
- [x] apps/web `dev`: serves on :5173
- [x] apps/web build succeeds
- [x] Playwright e2e pass
- [x] `pnpm biome ci .` zero errors
- [x] `publint --strict` zero errors on packages
- [x] `attw --profile node16` zero errors on packages
- [x] CI `esm-guard` steps green (see Actions tab)
- [x] `docker build` healthy on prod single-container path

Ready for review — promoting from draft to ready.
EOF
)"
```

- [ ] **Step 4: 提示 user 把 PR 从 draft 切到 ready-for-review**

输出给 user:

> 全部 7 个 task 跑完,verification 13/13 通过。PR #225 仍是 draft。要不要 `gh pr ready 225` 切到 ready-for-review?(此操作需要 user 确认 —— 不在 pre-authorized 列表)

---

## Self-Review

**1. Spec coverage check:**

| Spec section | Plan task |
|---|---|
| packages/contracts 迁 ESM | Task 2 ✓ |
| packages/tool-adapters 迁 ESM + 修 2 处 spec | Task 3 ✓ |
| tsconfig.base.json 收紧 | Task 1 ✓ |
| apps/api/tsconfig.json override | Task 1 ✓ |
| biome.json 加规则 + apps/api override | Task 4 ✓ |
| ci.yml 加 ESM-guard 步骤 | Task 5 ✓ |
| 根 package.json 加 publint + attw | Task 5 ✓ |
| CONTRIBUTING.md | Task 6 ✓ |
| 13 项 verification checklist | Task 7 ✓ |

**2. Placeholder scan:**
- 没有 "TBD" / "TODO" / "implement later" / "等下补"。
- 注释里出现的 `#224` 是真实 issue 号 ✓
- 注释里出现的 `#225` 是真实 PR 号 ✓
- 唯一的 "不预设内容" 是 Task 7 Step 2 ——这是 catchall 的合理留白(具体 fix 看 Step 1 输出)。

**3. Type consistency:**
- `rename-cjs.mjs` 在 Task 2 和 Task 3 的代码完全一致 ✓
- `tsconfig.build.cjs.json` 在 Task 2 和 Task 3 的结构一致 ✓
- `exports` 字段在 Task 2 / Task 3 / Task 6 (template) 一致 ✓
- biome rule 名 `noCommonJs` / `useNodejsImportProtocol` / `useImportExtensions` 全程一致 ✓
- Commit prefix `chore:` / `refactor:` / `ci:` / `docs:` 按 modeldoctor 规约 ✓

Plan ready.
