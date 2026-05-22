# ESM 迁移 — Phase 1: packages + monorepo 强约束规范

**Status:** draft · 2026-05-22
**Scope:** packages/contracts, packages/tool-adapters, root biome/tsconfig/CI 治理规则
**Tracks:** 新建 issue（spec 落地后创建）
**Follow-up:** apps/api ESM 迁移（独立 issue,跟 NestJS 12 GA 同步,预计 2026 Q3）

## Goal

把 modeldoctor monorepo 迁到 ESM 并立强约束规范,让 CJS 永久不能回归。

## 触发事件 / Why now

1. 当前 `apps/api` 是 CJS,导致 `@kubernetes/client-node` 锁在 0.21(最后一个 CJS 版本),1.0+ 是 pure ESM。这间接卡住了 K8s pod watcher 设计中的 lease election 库选型 —— `@codedependant/kubernetes-leader-election` 要求 client-node `^1.3`,因 ESM 锁直接出局。
2. CJS 模式实际上依赖 Node.js 20.17+ 的 `--experimental-require-module` flag 才能 `require()` 调 `nanoid@5`(pure ESM)。这是个隐性 fragility —— Docker base image 升级、Node 版本调整可能让现有 CJS app 突然崩。
3. apps/web / Vite / Vitest / Prisma 6 都已经 ESM-native。CJS 的只剩 `apps/api` source + packages 的 dist 产物。
4. **NestJS 12 (2026 Q3 目标)** 是官方 ESM cutover —— "every official package from CommonJS to ESM",CLI 默认 ESM。强约束规范现在立,packages 现在迁,apps/api 跟 NestJS 12 一起切是最低返工路径。

## 现状事实表

| 包 | `package.json` type | tsconfig module | 产物形态 |
|---|---|---|---|
| root | (无 = CJS) | ESNext (base) | — |
| `apps/api` | (无 = CJS) | **commonjs** (覆盖 base) | CJS |
| `apps/web` | `module` (ESM) | ESNext (继承 base) | ESM (Vite) |
| `packages/contracts` | (无 = CJS) | `commonjs` (build override) | CJS `dist/index.js` |
| `packages/tool-adapters` | (无 = CJS) | `commonjs` (build override) | CJS `dist/index.js` |
| `tsconfig.base.json` | — | **ESNext** | — |

源码层关键观察:
- ✅ apps/api 所有 relative import 已带 `.js` 后缀(ESM 规范要求)
- ✅ 没有 `__dirname` / `__filename` / `require()` 使用
- ✅ 已有 4 处 `await import()` dynamic import

## 阶段化决策

经过 4 项独立调研 —— NestJS 11 + ESM 实测、Prisma 6 + ESM、Vitest ESM mocking、ESM governance 业内主流 —— 决定**分两阶段**:

| Phase | 范围 | 时机 | 风险 |
|---|---|---|---|
| **Phase 1(本 spec)** | packages/contracts、packages/tool-adapters、root 治理规则 | 现在,~1 天 | 低 |
| **Phase 2** | apps/api ESM + `@kubernetes/client-node` 升 1.x | 跟 NestJS 12 GA 同步(预计 2026 Q3) | 中(NestJS 11 期间 ESM 是 early adopter 状态) |

### 为什么不一次性全栈迁(方案 A 拒绝)

NestJS 11 没有官方 ESM 模式 —— [Kamil Mysliwiec 在 nestjs/nest#15375 回复](https://github.com/nestjs/nest/issues/15375#issuecomment-3068588039)(2025-07-14):"ES modules are now natively supported by Node.js" —— 意思是 NestJS 框架自己不做任何事,靠 Node + TS 兜。NestJS 官方 ESM samples (`sample/34-using-esm-packages`, `sample/35-use-esm-package-after-node22`) 至今都是 `"type": "commonjs"`,只示范 *消费* ESM 包,不示范 *构建* NestJS ESM app。

`@nestjs/swagger` 一周前(2026-04-29 [PR #3866](https://github.com/nestjs/swagger/pull/3866) 合并,11.4.4 于 2026-05-21 发布)才修了 `"type": "module"` 下 `ERR_MODULE_NOT_FOUND`。NestJS 11 ESM 没有 high-star (>500) 生产 repo 先例。现在迁 apps/api 等于做 early adopter,遇到的 bug 大概率没人撞过。

### 为什么不完全等 NestJS 12(方案 C 拒绝)

- packages 迁 ESM 跟 NestJS 完全无关,等 5 个月没意义
- 强约束规范越晚立,新增代码越多需要回头修
- watcher PR 等不起 5 个月

## Out of scope (Phase 1)

- 不动 `apps/api/tsconfig.json` 的 `module: "commonjs"` —— Phase 2 处理
- 不升 `@kubernetes/client-node` —— Phase 2 处理
- 不改 `apps/api` 源代码 —— packages dist 形态变化对 apps/api 透明(contracts 的 dual-package exports 保留 `require` 分支供 apps/api CJS 消费)
- 不动 `apps/web` 业务代码 —— 已经是 ESM,本 spec 顺便给它套上同一份强约束规范

## Phase 1 详细变更

### 1. packages/contracts 迁 ESM

**`packages/contracts/package.json`**:

```json
{
  "name": "@modeldoctor/contracts",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./src/index.ts",
      "require": "./dist/index.cjs",
      "default": "./dist/index.js"
    }
  },
  "engines": { "node": ">=20.11" },
  "sideEffects": false
}
```

- 加 `"type": "module"`
- 加 `engines.node` 锁底
- 加 `sideEffects: false` 帮助 tree-shake
- exports 保留 `require` 分支(指向新建的 `.cjs` 产物)供 apps/api CJS 期间消费 —— Phase 2 后删
- `import` 分支仍指 `src/index.ts`(apps/web ESM 消费,Vite 直接 import TS)

**`packages/contracts/tsconfig.build.json`**(ESM 主产物):

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

**`packages/contracts/tsconfig.build.cjs.json`**(CJS 兼容产物,新建):

```json
{
  "extends": "./tsconfig.build.json",
  "compilerOptions": {
    "module": "commonjs",
    "moduleResolution": "node",
    "outDir": "./dist/cjs"
  }
}
```

后处理:把 `./dist/cjs/*.js` 重命名为 `./dist/*.cjs` 并扁平化(用 `tsc-alias` 或简单的 shell 步骤)。或者 cjs 产物直接发到 `./dist/index.cjs` —— 取决于产物层级。**implementation 时确定**这两种之一。

**`packages/contracts/package.json` scripts**:

```json
"build": "rm -rf dist && tsc -p tsconfig.build.json && tsc -p tsconfig.build.cjs.json && node ./scripts/rename-cjs.mjs"
```

`rename-cjs.mjs` 是个 5 行 Node 脚本,把 `dist/cjs/*.js` move 到 `dist/*.cjs`。具体内容在 implementation PR 给出。

### 2. packages/tool-adapters 迁 ESM

同 contracts 模式。已审计源码,实际要修的 CJS-only 残留:

- `packages/tool-adapters/src/evalscope/runtime.spec.ts:8` —— `__dirname` 未加 fileURLToPath shim,需补:
  ```ts
  import { fileURLToPath } from "node:url";
  import path from "node:path";
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  ```
- `packages/tool-adapters/src/aiperf/runtime.spec.ts:8` —— 同上

其余 spec(`guidellm/runtime.spec.ts`、`prefix-cache-probe/runtime.spec.ts`、`vegeta/runtime.spec.ts`)已经有正确 shim,不动。

源码主体(非 spec)审计完无 CJS-only 模式:`require()` / `module.exports` / `__dirname` 在 src 主体里全为 0。

### 2.5 packages/contracts 源码审计

contracts 已审计:零 CJS-only patterns。`require()` / `module.exports` / `__dirname` / 缺 `.js` 后缀的相对 import 全部 grep 返回空。**纯配置层改动即可完成迁 ESM**(不需要改任何 .ts source)。

### 3. root tsconfig.base.json — 收紧到 ESM-strict

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
    "strict": true
  }
}
```

**为什么 `NodeNext` 不是 `ESNext`**:`NodeNext` 强制 `.js` 后缀 + 拒绝 CJS-only resolution。`ESNext` 给 bundler 用太宽松。([TS 官方建议](https://www.typescriptlang.org/docs/handbook/modules/guides/choosing-compiler-options.html))

**`verbatimModuleSyntax: true`**:强制 explicit `import type`,禁止 `export default` 在会编译成 CJS 的代码里。([TS 文档](https://www.typescriptlang.org/tsconfig/verbatimModuleSyntax.html))

**`apps/api/tsconfig.json` 必须覆盖**: 临时保持 `module: "commonjs" + moduleResolution: "node" + esModuleInterop: true + verbatimModuleSyntax: false`,直到 Phase 2。在文件头加注释:`// Phase 2 (#XXX) removes these overrides — module: NodeNext globally.`

### 4. Biome 强约束规则

**版本约束已验证**:
- `noCommonJs` —— Biome **v1.9.0+** stable,我们 `@biomejs/biome ^1.9` ✓
- `useImportExtensions` —— Biome **v1.8.0+** stable ✓
- `useNodejsImportProtocol` —— Biome 1.x 早期已有 ✓

**`biome.json`** 在现有 `linter.rules.style` 块加规则:

```json
{
  "linter": {
    "rules": {
      "style": {
        "noUselessElse": "warn",
        "useConst": "warn",
        "useImportType": "off",
        "noCommonJs": "error",
        "useNodejsImportProtocol": "error",
        "useImportExtensions": "error"
      }
    }
  },
  "overrides": [
    {
      "include": ["apps/api/**/*.ts"],
      "linter": { "rules": { "style": { "noCommonJs": "off" } } }
    }
  ]
}
```

- [`noCommonJs`](https://biomejs.dev/linter/rules/no-common-js/) —— 禁 `require()` / `module.exports` / `exports.x`(注:此规则非 `recommended`,需显式 enable)
- [`useNodejsImportProtocol`](https://biomejs.dev/linter/rules/use-nodejs-import-protocol/) —— 强制 `import fs from "node:fs"`,不允许 `from "fs"`
- [`useImportExtensions`](https://biomejs.dev/linter/rules/use-import-extensions/) —— 强制 `.js` 后缀
- `apps/api` override 暂关 `noCommonJs`(Phase 2 删 override)

### 5. CI Guardrails — 复用现有 `.github/workflows/ci.yml`

不新建独立 workflow。当前 `ci.yml` 的 `lint-type-test` job 已经有 `pnpm install` / `pnpm lint` / `pnpm -r build` 步骤;在 `pnpm lint` 后插入 ESM-guard steps:

```yaml
# .github/workflows/ci.yml — 在 lint-type-test job 中,pnpm lint 后追加:

      - run: pnpm lint  # 现有,Biome 加规则后会自动捕 CJS 违规

      # Pure-ESM package shape validation
      - name: Validate packages publish shape
        run: pnpm -r --filter='./packages/*' exec publint --strict

      # Types resolution under Node16 ESM
      - name: Validate types resolve in ESM
        run: pnpm -r --filter='./packages/*' exec attw --pack --profile node16

      # Raw grep — catch __dirname / __filename / require( (biome 不查全)
      - name: No CJS-only globals in packages/ + apps/web
        run: |
          set -e
          # Skip apps/api (Phase 2)
          ! grep -rEn "(^|[^a-zA-Z_])(__dirname|__filename)\b" \
              --include='*.ts' --include='*.tsx' \
              packages/ apps/web/src/

      # type:module 强制(packages + apps/web,不含 apps/api 直到 Phase 2)
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

**根 `package.json` 新增 dev deps**: `publint`、`@arethetypeswrong/cli` (root devDependencies,不污染 packages 自身)。

### 6. CONTRIBUTING.md(根目录,新建或追加)

```markdown
## Module System

This monorepo is migrating to **pure ESM**. Phase 1 (this commit) covers
`packages/*` and `apps/web`. Phase 2 (tracked by issue #XXX) will cover
`apps/api` alongside the NestJS 12 upgrade (~2026 Q3).

**For packages/* and apps/web — strict rules:**

- Every `package.json` MUST have `"type": "module"` and `engines.node: ">=20.11"`.
- No `require()`, `module.exports`, `exports.x`, `__dirname`, `__filename`, or `*.cjs` source files.
- All relative imports MUST include the `.js` extension (TypeScript files import as `.js`).
- All Node.js built-ins MUST use the `node:` prefix: `import { readFile } from "node:fs/promises"`.
- No `*.cjs` config files; use `*.mjs` or plain `.ts` via `tsx`.

CI enforces these via Biome (`noCommonJs`, `useNodejsImportProtocol`,
`useImportExtensions`), `publint --strict`, `attw --profile node16`, and
raw grep checks (see `.github/workflows/esm-guard.yml`).

**For apps/api — temporary CJS pocket:**

`apps/api/tsconfig.json` keeps `module: "commonjs"` until Phase 2.
Biome's `noCommonJs` is disabled in `apps/api/**` via `biome.json` overrides.
Do not add new CJS patterns to apps/api during this period — the goal is
zero new tech debt to clean up later.
```

## Phase 1 验证 checklist

- [ ] `pnpm install` 在改完后零警告
- [ ] `pnpm -r build` 成功(packages dist 同时产 ESM `.js` + CJS `.cjs`)
- [ ] `pnpm -F @modeldoctor/api start:dev` 仍能启动(apps/api 通过 `require` 分支消费 contracts/tool-adapters 的 `.cjs`)
- [ ] `pnpm -F @modeldoctor/api test` 全过(单测)
- [ ] `pnpm test:e2e:api` 全过(api e2e)
- [ ] `pnpm -F @modeldoctor/web dev` 仍能启动(web 通过 `import` 分支直接消费 TS source)
- [ ] `pnpm -F @modeldoctor/web build` 成功
- [ ] `pnpm test:e2e:browser` 全过(playwright)
- [ ] `pnpm biome ci .` 零错误
- [ ] `pnpm -r --filter='./packages/*' exec publint --strict` 零错误
- [ ] `pnpm -r --filter='./packages/*' exec attw --pack --profile node16` 零错误
- [ ] `.github/workflows/esm-guard.yml` 跑通(本地 act 或推 draft PR 验证)
- [ ] 单 Docker 容器 `docker build -t modeldoctor . && docker run` 健康(prod path)

## Phase 2 计划(follow-up issue,本 spec 不实施)

落地后立刻创建 follow-up issue 跟踪:

**`refactor(api): migrate apps/api to ESM alongside NestJS 12 upgrade`**

范围(届时操作):
- `apps/api/package.json` + `"type": "module"`
- `apps/api/tsconfig.json` 删 `module/moduleResolution/verbatimModuleSyntax` override,继承 base 的 NodeNext
- `apps/api/nest-cli.json` 切到 SWC builder + `.swcrc` ESM target([NestJS SWC 文档](https://docs.nestjs.com/recipes/swc))
- 升 `@kubernetes/client-node` 0.21 → 1.x(同时改所有 K8s API 调用从位置参数到对象参数 `createNamespacedJob({namespace, body})`)
- 升 `@nestjs/swagger` 到 ≥ 11.4.4(已包含 ESM 修复 PR #3866)
- Prisma generator 切到 `prisma-client`(非 `prisma-client-js`),`moduleFormat = "esm"`,`importFileExtension = "js"`;sitewide codemod `import { PrismaClient } from "@prisma/client"` → `from "../generated/prisma/client"`;`prisma db seed` runner 从 `ts-node` 切到 `tsx`
- 审计 ~70 个 spec/e2e 文件:`vi.mock(path, factory)` 闭包外部变量改 `vi.hoisted()`;`vi.spyOn` on imported function exports 改 `vi.mock(..., { spy: true })`
- 删 `apps/api/**` 的 biome `noCommonJs` override
- 删 packages 的 `.cjs` 兼容产物,exports 只剩 ESM
- 删 CI guardrails 里的 "skip apps/api" 例外

触发时机:`@nestjs/cli` v12 GA,或者 NestJS 12 RC 期间提早验证。

## 接受的 trade-off

| Trade-off | 理由 |
|---|---|
| Packages dist 期内出双产物(`.js` + `.cjs`),包体积 ×2 | apps/api 还在 CJS,packages 必须 dual-package。包体积对私有化镜像影响 < 1MB,可接受。Phase 2 删 |
| apps/api `tsconfig` 在 ESM-strict 时代继续 CJS | NestJS 11 ESM 是 early adopter,撞 bug 自负。等 5 个月跟 NestJS 12 一起切是最低风险路径 |
| `apps/api` 在 Phase 1 期间不应用 `noCommonJs` lint | 短期 tech debt;CONTRIBUTING.md 写明"不要新增 CJS 模式" |
| `apps/api` 继续依赖 Node 20.17+ `--experimental-require-module` flag | 已经在用,Phase 1 不增加新依赖;Phase 2 一并解除 |

## Risks

| Risk | 缓解 |
|---|---|
| Phase 1 改完 packages dual-package exports,apps/api 通过 `require` 解析到 `.cjs` 失败 | 验证 checklist 第 3 项必过;失败则 rollback,先调 exports 字段顺序 |
| Biome 升到能跑 `useImportExtensions` 的版本可能引入大量需要补 `.js` 后缀的修改 | 在 PR 里分两 commit:一个开规则 + 一个 codemod 全仓库补后缀 |
| `publint` / `attw` 在私有 workspace 包上的报错语义跟公开包不同 | 先在 contracts 一个包上试跑,确认 baseline 后再加到 CI |
| CI 新加的 `esm-guard.yml` 跟现有 workflow 重叠或冲突 | 看 `.github/workflows/` 现有 workflows;复用现有 lint job 还是独立?决定后再开 PR |

## Rollback plan

Phase 1 改动范围有限,rollback 路径清晰:

1. `git revert` Phase 1 PR
2. packages 回到当前 CJS 形态(`tsc -p tsconfig.build.json` 单产物 commonjs)
3. apps/api 不受影响(它从未感知 packages 是 ESM 还是 CJS,只用 `exports.require` 分支)
4. apps/web 继续按 dual-package 的 `exports.import` 分支消费 TS source —— rollback 前后行为一致

## References

- [sindresorhus / Pure ESM package gist](https://gist.github.com/sindresorhus/a39789f98801d908bbc7ff3ecc99d99c) —— 业内 SSOT
- [antfu / Move on to ESM-only](https://antfu.me/posts/move-on-to-esm-only)
- [Vite / packages/vite/package.json](https://github.com/vitejs/vite/blob/main/packages/vite/package.json) —— 产品级 pure-ESM 参考形态
- [Biome / noCommonJs rule](https://biomejs.dev/linter/rules/no-common-js/)
- [Biome / useNodejsImportProtocol](https://biomejs.dev/linter/rules/use-nodejs-import-protocol/)
- [Biome / useImportExtensions](https://biomejs.dev/linter/rules/use-import-extensions/)
- [TypeScript / verbatimModuleSyntax](https://www.typescriptlang.org/tsconfig/verbatimModuleSyntax.html)
- [TypeScript / Choosing module compiler options](https://www.typescriptlang.org/docs/handbook/modules/guides/choosing-compiler-options.html)
- [publint](https://publint.dev/)
- [@arethetypeswrong/cli](https://www.npmjs.com/package/@arethetypeswrong/cli)
- [InfoQ — NestJS v12 Roadmap: Full ESM Migration](https://www.infoq.com/news/2026/04/nestjs-12-roadmap-esm/)
- [nestjs/nest #15375 — Support ESM Modules (Kamil 回复)](https://github.com/nestjs/nest/issues/15375#issuecomment-3068588039)
- [nestjs/swagger PR #3866 — fix(package): add exports field](https://github.com/nestjs/swagger/pull/3866)
- [Prisma 6.6.0 — ESM Support](https://www.prisma.io/blog/prisma-orm-6-6-0-esm-support-d1-migrations-and-prisma-mcp-server)
- [Prisma 7 + NestJS discussion #28608](https://github.com/prisma/prisma/discussions/28608)
- [Vitest Mocking Modules guide](https://vitest.dev/guide/mocking/modules)
- [Vitest PR #3258 — ESM mock + vi.hoisted](https://github.com/vitest-dev/vitest/pull/3258)
