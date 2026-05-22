import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseDotenv } from "dotenv";

/**
 * Test-mode env fixture, parsed from apps/api/.env.test.
 *
 * apps/api/.env.test is the single source of truth: AppConfigModule loads it
 * automatically when NODE_ENV=test (see apps/api/src/config/config.module.ts).
 * Spec files that need to send a Bearer header matching what ConfigService
 * sees re-import E2E_ENV_DEFAULTS.X to stay in sync.
 *
 * Parsed via the same `dotenv` library that `@nestjs/config` uses internally,
 * so the TypeScript const and the ConfigService.get(...) values can never
 * diverge on quoted strings, inline comments, or other dotenv-spec edge
 * cases. The path is resolved relative to this file so it doesn't depend on
 * the vitest worker cwd.
 *
 * Setting `process.env.X = ...` in a spec's `beforeAll` is a known anti-pattern
 * here: forRoot has already locked the value from .env.test, so the late
 * mutation has no effect on ConfigService.get. Use this fixture instead. The
 * lint at apps/api/scripts/check-e2e-no-env-mutation.mjs (wired into
 * `pnpm lint`) fails CI if a new spec re-introduces the pattern — see #209.
 *
 * NOT included by design:
 * - DATABASE_URL — vitest configs override it dynamically via pickTestDatabaseUrl().
 */
const ENV_TEST_PATH = resolve(fileURLToPath(import.meta.url), "..", "..", "..", ".env.test");
const parsed = parseDotenv(readFileSync(ENV_TEST_PATH));

function required(key: string): string {
  const v = parsed[key];
  if (!v) throw new Error(`apps/api/.env.test missing required key: ${key}`);
  return v;
}

export const E2E_ENV_DEFAULTS = {
  JWT_ACCESS_SECRET: required("JWT_ACCESS_SECRET"),
  BENCHMARK_CALLBACK_SECRET: required("BENCHMARK_CALLBACK_SECRET"),
  BENCHMARK_CALLBACK_URL: required("BENCHMARK_CALLBACK_URL"),
  CONNECTION_API_KEY_ENCRYPTION_KEY: required("CONNECTION_API_KEY_ENCRYPTION_KEY"),
  ALERTMANAGER_WEBHOOK_SECRET: required("ALERTMANAGER_WEBHOOK_SECRET"),
  MCP_BEARER_TOKEN: required("MCP_BEARER_TOKEN"),
  MCP_USER_ID: required("MCP_USER_ID"),
} as const;
