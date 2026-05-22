import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Test-mode env fixture, parsed from apps/api/.env.test.
 *
 * apps/api/.env.test is the single source of truth: AppConfigModule loads it
 * automatically when NODE_ENV=test (see apps/api/src/config/config.module.ts).
 * Spec files that need to send a Bearer header matching what ConfigService
 * sees re-import E2E_ENV_DEFAULTS.X to stay in sync.
 *
 * Parsed at module-load time (synchronous read) so spec files can use the
 * const at top level. The path is resolved relative to this file so the
 * resolution doesn't depend on vitest worker cwd.
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

// Minimal KEY=VALUE parser. Handles `#` line comments, blank lines, and
// values without quoting. We control the file (apps/api/.env.test), so we
// don't need the full dotenv spec (no quoted values, no escape sequences,
// no $-expansion). If you reach for those, switch to the dotenv lib instead.
function parseEnvFile(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    out[key] = value;
  }
  return out;
}

const parsed = parseEnvFile(readFileSync(ENV_TEST_PATH, "utf8"));

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
