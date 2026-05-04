/**
 * Resolve which Postgres URL the test process should use.
 *
 * Order:
 *   1. `TEST_DATABASE_URL` — explicit override (e.g. CI matrix variant).
 *   2. `DATABASE_URL` if it already names a `_test` database — honors the
 *      CI pattern where the workflow sets DATABASE_URL directly.
 *   3. Local Postgres convention: `postgresql://modeldoctor:modeldoctor@localhost:5432/modeldoctor_test`.
 *
 * **A non-test `DATABASE_URL` is intentionally ignored**: the developer
 * shell typically exports `DATABASE_URL=postgresql://.../modeldoctor` so
 * that `pnpm start:dev` connects to the dev DB. Honoring that here would
 * silently route `pnpm test` at the dev DB and let `deleteMany()` wipe
 * real data. The fallback in step 3 keeps the test process safe by
 * default; `db-guard.ts` is the second layer that asserts whatever URL
 * we end up with names a `_test` database.
 *
 * Imported by both `global-setup.mts` (vitest parent process, before
 * `test.env` is applied) and `vitest.config.mts` (which sets `test.env`
 * for the worker process). Keep this module dependency-free so the
 * `.mts` setup can import it without a transformer.
 */
const DEFAULT_TEST_DATABASE_URL =
  "postgresql://modeldoctor:modeldoctor@localhost:5432/modeldoctor_test";

const TEST_DB_PATTERN = /_test(\W|$)/;

export function pickTestDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const env = process.env.DATABASE_URL;
  if (env && TEST_DB_PATTERN.test(env)) return env;
  return DEFAULT_TEST_DATABASE_URL;
}
