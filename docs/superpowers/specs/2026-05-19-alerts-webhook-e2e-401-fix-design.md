# alerts.e2e-spec 401 修复 — vitest pre-injected env defaults 共享 fixture

**Date**: 2026-05-19
**Status**: design
**Tracks**: PR #199 follow-up evaluated on #189 follow-up comment
**Branch**: `fix/alerts-e2e-401`

## 背景

PR #199 落地后,`apps/api/test/e2e/alerts.e2e-spec.ts` 4 个 webhook 用例 + `subscribers.e2e-spec.ts` 1 个用例稳定 401 失败:

- `accepts well-formed payload, creates AlertEvent, returns 202`
- `idempotent: same fingerprint + startsAt does not duplicate row`
- `infers connectionId when model_name matches a Connection.model`
- `GET /api/alerts returns only the caller's connection-attributed alerts`
- `alert dispatch fans out to matching subscribers (severity gate enforced)`

PR #199 期间因为 Task 5 用 direct-service 入口规避了这条路径,问题被推到 follow-up。

## 根因

通过 ConfigService.get 源码追踪 + 在 `validateEnv` 加 console.log debug,确认根因:

### 时序

1. **vitest worker 启动** —— `vitest.e2e.config.mts` 的 `env:` 块写 `process.env`(JWT/callback/callback-url/connection-key 共 4 个 secret)
2. **spec 文件加载** —— top-level `import { bootE2E }` 拉到 `helpers/app.ts`,后者 `import AppModule`,触发 `@Module({ imports: [AppConfigModule] })` 元数据求值
3. **`NestConfigModule.forRoot({ validate: validateEnv })` 在此时同步执行**:
   - 读 `apps/api/.env`(默认 `${cwd}/.env`)→ `config = { ALERTMANAGER_WEBHOOK_SECRET: "QIV6bGhX...", ... }`
   - merge `{ ...config, ...process.env }` —— process.env 后 spread 胜出
   - 但此时 `process.env.ALERTMANAGER_WEBHOOK_SECRET` 还没被 `beforeAll` 设过 → merge 后该 key 仍是 `.env` 的值
   - `validateEnv(merged)` → `validatedConfig` 缓存进 ConfigService
4. **`beforeAll` 执行** —— `process.env.ALERTMANAGER_WEBHOOK_SECRET = TEST_SECRET` 设上,**为时已晚**
5. **测试发起请求** —— 服务端 `config.get("ALERTMANAGER_WEBHOOK_SECRET")` 返 `.env` 的值,与请求头 Bearer(TEST_SECRET)不等 → 401

### ConfigService.get 的关键回退逻辑

读 `@nestjs/config/dist/config.service.js`:

```js
get(key) {
  // 1. internalConfig (registerAs) — 通常空
  // 2. validatedConfig — 来自 forRoot 时的 validateEnv 结果
  if (!isUndefined(validatedEnvValue)) {
    return validatedEnvValue;   // ← ALERTMANAGER 走这里:返 .env 值
  }
  // 3. live process.env — 仅在 validatedConfig 该 key === undefined 时落到这里
  return getFromProcessEnv(...);  // ← MCP_BEARER 走这里:返 beforeAll 设的值
}
```

**所以同样模式(`process.env.X = ...` in beforeAll)在 MCP e2e 跑通,在 alerts e2e 失败,差异点是 `.env` 是否定义了 `X`**。`.env` 有 `ALERTMANAGER_WEBHOOK_SECRET=QIV6bGhX...`,没有 `MCP_BEARER_TOKEN`。

### 现存 vitest env 注入的 4 个 secret 走对了路径

`JWT_ACCESS_SECRET` / `BENCHMARK_CALLBACK_SECRET` / `BENCHMARK_CALLBACK_URL` / `CONNECTION_API_KEY_ENCRYPTION_KEY` 都在 `vitest.e2e.config.mts:env:` 里 pre-inject,在 vitest worker 启动时就写 `process.env`,**早于** `forRoot` 调用的时刻 → merge 时 process.env 胜出 → validatedConfig 持 fixture 值。

`ALERTMANAGER_WEBHOOK_SECRET` 是 #191(alert loop)新增的 secret,当时只在 spec 的 `beforeAll` 改 process.env,**没同步加到 vitest pre-inject 列表**。本设计修这个漏。

## 设计选型

### 修复方向:vitest pre-inject(单源 fixture)

唯一在时序上正确的位置是 vitest config 的 `env:` 块(spec 文件加载之前)。但不直接把字面值塞回去,而是抽出**共享 fixture** —— `apps/api/test/setup/e2e-env-defaults.ts`:

- vitest config import 它,spread 进 `env:`
- spec 文件想发同一个 secret 作为 Bearer,也 import 它
- **构造上保证 vitest pre-inject 与 spec 使用值同步**,杜绝"漏改一处"的回归

### Carve-out:MCP_BEARER_TOKEN / MCP_USER_ID 不放入 fixture

`mcp.e2e-spec.ts` 第一个 describe 故意 `delete process.env.MCP_*` 测 503 路径,第二个 describe `process.env.MCP_* = ...` 测正常路径。**两个都依赖 ConfigService 回退到 live process.env 的行为**。如果把 MCP_* 放入 pre-inject fixture,validatedConfig 就锁住值,`delete` 失效 → 503 case fail。所以 fixture 明确不收。

### 替代方案为何不选

- **在 spec 里 `ConfigService.set()`** —— 需要拿到 app instance 后才能调,但 forRoot 已经在更早的时刻完成验证;set 只改运行时 internalConfig,不改 .env 已缓存的值;且 `set` 接口语义偏 "动态配置" 不偏 "测试覆写"
- **改 controller 直接 `process.env.X`** —— 抛弃 ConfigService 抽象,prod 看不见,且和其他 secret(均走 config.get)风格不统一
- **从 `.env` 删 ALERTMANAGER_WEBHOOK_SECRET** —— 那是真实 dev 密钥,删了 dev 环境炸
- **加 lint 规则禁 `process.env.X = ...` in beforeAll** —— 过严;某些 carve-out(如 MCP)仍然需要这种模式

## §1 文件布局

### 新文件 `apps/api/test/setup/e2e-env-defaults.ts`

```ts
/**
 * Pre-injected env defaults for ALL e2e tests. Spread into vitest.e2e.config.mts
 * `env:` block so they land in process.env BEFORE NestJS's ConfigModule.forRoot
 * runs (which happens at AppModule file-import time, before any beforeAll).
 *
 * Why these live here and not inline in vitest.e2e.config.mts:
 * - e2e spec files often need to send the SAME secret as the Bearer in their
 *   HTTP requests. Importing E2E_ENV_DEFAULTS.X gives a single source of truth —
 *   if vitest pre-injects X and the spec sends Bearer X, they MUST stay in sync.
 * - Setting `process.env.X = ...` in a spec's `beforeAll` is a known anti-pattern
 *   here: forRoot has already locked the value from .env, so the late mutation
 *   has no effect on ConfigService.get. Use this file instead.
 *
 * NOT included by design:
 * - DATABASE_URL — computed dynamically by pickTestDatabaseUrl()
 * - MCP_BEARER_TOKEN / MCP_USER_ID — mcp.e2e-spec relies on the
 *   "ConfigService falls back to live process.env when validatedEnv is undefined"
 *   path (since .env doesn't define MCP_*). Adding them here would BREAK the
 *   existing "503 when unset" test because validatedEnv would lock them.
 */
export const E2E_ENV_DEFAULTS = {
  JWT_ACCESS_SECRET: "e2e-test-jwt-secret-not-for-production-use-only-32+chars",
  BENCHMARK_CALLBACK_SECRET: "e2e-test-callback-secret-not-for-production-use-32+chars",
  BENCHMARK_CALLBACK_URL: "http://e2e-test-placeholder.invalid/",
  CONNECTION_API_KEY_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  ALERTMANAGER_WEBHOOK_SECRET: "alertmanager-test-secret-padded-to-32-chars-min",
} as const;
```

### 改 `apps/api/vitest.e2e.config.mts`

`env:` 块从 5 行字面值(带注释)简化为 spread:

```ts
import { E2E_ENV_DEFAULTS } from "./test/setup/e2e-env-defaults.js";

// ...
test: {
  // ...
  env: {
    DATABASE_URL: TEST_DATABASE_URL,
    ...E2E_ENV_DEFAULTS,
  },
},
```

注释段从 vitest.e2e.config.mts 删除(已搬到 fixture 文件的 docstring)。

### 改 `apps/api/test/e2e/alerts.e2e-spec.ts:24-32`

```diff
+import { E2E_ENV_DEFAULTS } from "../setup/e2e-env-defaults.js";
+
-const TEST_SECRET = "alertmanager-test-secret-padded-to-32-chars-min";
+const TEST_SECRET = E2E_ENV_DEFAULTS.ALERTMANAGER_WEBHOOK_SECRET;

 describe("Alerts webhook e2e", () => {
   // ...
   beforeAll(async () => {
-    process.env.ALERTMANAGER_WEBHOOK_SECRET = TEST_SECRET;
     ctx = await bootE2E();
     // ...
   });
```

### 改 `apps/api/test/e2e/subscribers.e2e-spec.ts:14-20`

同上:删 `process.env.ALERTMANAGER_WEBHOOK_SECRET = TEST_SECRET;`,改 `TEST_SECRET = E2E_ENV_DEFAULTS.ALERTMANAGER_WEBHOOK_SECRET`。

### 改 `apps/api/test/e2e/connection-kind.e2e-spec.ts:218-302`(A2 — 单独 commit)

> 来源:2026-05-19 全仓 audit findings A2 — `connection × prometheusDatasourceId` inner describe 用 `prisma.prometheusDatasource.deleteMany()` 做 `beforeAll`,但没有对称 `afterAll`,导致 inner 创建的 default datasource 残留到 outer describe 后续的 connection 创建(`POST /api/connections` 命中 auto-fill 路径),进一步污染同进程顺序跑的下一个 e2e 文件(如果它依赖 datasource 表为空)。
>
> 当前 vitest e2e 是单进程顺序跑,实际还没引发可见失败;但属于潜在 flakiness,且修复成本极低(3 行)。和本 PR 的 fixture 重构**根因不同**,只是同属"e2e 状态卫生"族,顺手在本 PR 多加一个 commit 收编。

```diff
   describe("connection × prometheusDatasourceId", () => {
     let datasourceId: string;

     beforeAll(async () => {
       // Make sure no prior test left a default datasource sitting around;
       // these cases assert auto-fill behavior precisely.
       await prisma.prometheusDatasource.deleteMany();
       const r = await request(ctx.app.getHttpServer())
         .post("/api/prometheus-datasources")
         .set("Authorization", `Bearer ${token}`)
         .send({ name: "default", baseUrl: "https://prom.example.com", isDefault: true })
         .expect(201);
       datasourceId = r.body.id;
     });

+    afterAll(async () => {
+      // Symmetric cleanup — without this the default datasource leaks to the
+      // outer describe's subsequent connection-creation tests (which would
+      // auto-fill prometheusDatasourceId) and to other e2e files sharing the
+      // same DB. Connections that FK-reference the datasource are removed
+      // first (Connection.prometheusDatasourceId is ON DELETE SET NULL, so
+      // raw deleteMany works, but doing connection first avoids a noisy
+      // "default datasource is still referenced" log line if the FK ever
+      // changes to RESTRICT).
+      await prisma.connection.deleteMany({ where: { prometheusDatasourceId: datasourceId } });
+      await prisma.prometheusDatasource.deleteMany();
+    });
+
     it("POST /connections (kind=model, no prometheusDatasourceId) auto-fills default", async () => {
```

**不动:** outer describe 的 connection 残留(那是 connection-kind 自身的状态,后续文件如果在意可自己 cleanup)。只对 inner describe 引入的 datasource 做对称 cleanup,保持 PR scope 紧凑。

## §2 验证清单(按顺序)

1. **修复目标 e2e 各自通过**:
   ```bash
   pnpm -F @modeldoctor/api exec vitest run --config vitest.e2e.config.mts test/e2e/alerts.e2e-spec.ts
   pnpm -F @modeldoctor/api exec vitest run --config vitest.e2e.config.mts test/e2e/subscribers.e2e-spec.ts
   ```
   期望:alerts 7/7,subscribers 全 pass

2. **MCP 回归保护**:
   ```bash
   pnpm -F @modeldoctor/api exec vitest run --config vitest.e2e.config.mts test/e2e/mcp.e2e-spec.ts
   ```
   期望:2/2 仍 pass(carve-out 没踩 MCP)

3. **connection-kind 回归保护**(A2):
   ```bash
   pnpm -F @modeldoctor/api exec vitest run --config vitest.e2e.config.mts test/e2e/connection-kind.e2e-spec.ts
   ```
   期望:13/13 仍 pass(对称 cleanup 不影响 inner describe 用例)

4. **全 e2e suite**:
   ```bash
   pnpm -F @modeldoctor/api test:e2e --run
   ```
   期望:**94/94 pass**(目前 89/94,本 PR 后 +5;A2 不增量,只防回归)

5. **静态门禁**:
   - `pnpm -F @modeldoctor/api type-check` clean
   - `pnpm lint` clean(workspace 级)
   - `pnpm -r build` clean

## §3 提交策略

**2 个 commit** —— 不同根因分离,reviewer 易读:

### Commit 1: env fixture 重构 + 修 401

```
fix(api-test): pre-inject ALERTMANAGER_WEBHOOK_SECRET in vitest e2e env

5 e2e tests (4 alerts + 1 subscribers) were failing with 401 because
ConfigService.get("ALERTMANAGER_WEBHOOK_SECRET") returned the value from
apps/api/.env instead of the test's TEST_SECRET. Root cause:
NestConfigModule.forRoot runs validate() at AppModule file-import time —
before any beforeAll — so `process.env.X = ...` in beforeAll has no
effect on the cached validatedConfig.

Fix: pre-inject the secret in vitest.e2e.config.mts `env:` block, where
the value lands in process.env before forRoot. Extract all e2e env
defaults to a shared fixture (test/setup/e2e-env-defaults.ts) so any
secret added there is automatically pre-injected — no drift possible
between vitest config and the spec that sends it as a Bearer.

MCP_BEARER_TOKEN / MCP_USER_ID intentionally NOT in the fixture: the
"503 when unset" path in mcp.e2e-spec depends on ConfigService falling
back to live process.env (which only happens when validatedEnv === undefined).

fixes 401 from #199 follow-up

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

文件:`test/setup/e2e-env-defaults.ts` (new) · `vitest.e2e.config.mts` · `test/e2e/alerts.e2e-spec.ts` · `test/e2e/subscribers.e2e-spec.ts`

### Commit 2: A2 — 对称 cleanup

```
test(api): symmetric afterAll cleanup for prometheus-datasource inner describe

connection-kind.e2e-spec `connection × prometheusDatasourceId` inner
describe used prisma.prometheusDatasource.deleteMany() in beforeAll
without a matching afterAll, leaking the default datasource into the
outer describe's later connection-creation tests (which would hit the
auto-fill path) and into any e2e file run sequentially after it.

Add afterAll that removes both the FK-referencing connections and the
datasource itself. No test behavior changes; this is a latent flakiness
fix flagged by the 2026-05-19 full-repo test audit (finding A2).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

文件:`test/e2e/connection-kind.e2e-spec.ts`(单文件,~3 行净增)

PR branch:`fix/alerts-e2e-401`(per CLAUDE.md `fix/` prefix 预授权)。

## Follow-ups(不在本 PR 范围)

- **MCP 收编进 fixture** —— 需要先重写 `mcp.e2e-spec.ts` 的 "503 when unset" 测试不依赖 `delete process.env.MCP_*`(可能改为 spawn subprocess 测,或拆 unit test 测 guard 单独)。单独 follow-up。
- **lint 规则禁 `process.env.X = ...` in e2e beforeAll** —— 太严会误伤 MCP carve-out;留作观察项。
- **Audit critical/important 余下项** —— 2026-05-19 全仓测试 audit 还有 A1(`verifyPrometheus` 无单测)、B1(DatasourcesPage set-default/delete mutation 零断言)等高价值项,作为单独 PR 或 issue 推进;A2 之外不塞进本 PR。
- **DiscoverResultBanner CTA**(#199 review 提的)+ **Alertmanager 同构**(#189 follow-up)、**`set_default_prometheus_datasource` MCP tool**、**CLAUDE.md Page vs Dialog doc fix** —— 与本修复无关。

## 不做(明确范围外)

- 不动 `apps/api/.env`(真实 dev 密钥)
- 不改 ConfigService 调用方式(controller 仍走 `this.config.get`)
- 不为 MCP_* 测试做特殊兜底(carve-out 文档化即可)
- 不动 webhook 认证方式本身(Bearer token 校验逻辑无 bug)
