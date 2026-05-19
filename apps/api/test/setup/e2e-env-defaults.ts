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
  // passport-jwt validates secretOrKey at strategy-construction time, so
  // AppModule boot needs a non-empty JWT secret even in test mode.
  JWT_ACCESS_SECRET: "e2e-test-jwt-secret-not-for-production-use-only-32+chars",
  // HmacCallbackGuard validates BENCHMARK_CALLBACK_SECRET at constructor time
  // (same pattern as passport-jwt), so AppModule boot needs a non-empty value
  // even when no benchmark e2e test cares about it. env.schema.ts treats it as
  // optional under NODE_ENV=test; this injects a placeholder so the guard
  // doesn't throw on construction.
  BENCHMARK_CALLBACK_SECRET: "e2e-test-callback-secret-not-for-production-use-32+chars",
  // RunService validates BENCHMARK_CALLBACK_URL at constructor time so a
  // misconfigured deployment fails at boot instead of crashing with TypeError
  // on the first run. env.schema.ts treats it as optional under NODE_ENV=test;
  // inject a placeholder so the service can boot for AppModule e2e.
  BENCHMARK_CALLBACK_URL: "http://e2e-test-placeholder.invalid/",
  // BenchmarkService.constructor → decodeKey() runs at module init time, same
  // constructor-validation pattern. env.schema.ts treats this as optional in
  // test mode; inject a 32-byte base64 placeholder so the service can boot.
  // (32 zero bytes; never used to encrypt real data.)
  CONNECTION_API_KEY_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  // AlertsController.verifyAuth compares against this in constant time. .env
  // defines a real dev value, so without pre-injection ConfigService.get would
  // return that dev value (validatedConfig caches it at forRoot time) and the
  // spec's "Bearer X" wouldn't match.
  ALERTMANAGER_WEBHOOK_SECRET: "alertmanager-test-secret-padded-to-32-chars-min",
} as const;
