/**
 * Vitest setupFiles guard: fail-fast assertion that the DATABASE_URL the
 * test worker sees points at a `_test` database, before any spec runs.
 *
 * Belt-and-suspenders next to vitest.config.mts `test.env` and the
 * `pickTestDatabaseUrl` helper — if either layer is bypassed (someone
 * runs vitest directly, an IDE plugin overrides env, etc.), this throws
 * here before spec-level `deleteMany()` calls can wipe a dev DB.
 *
 * Lives in `test/setup/` (not `src/test/`) because `tsconfig.json#include`
 * is intentionally narrow to `src/**` (see project CLAUDE.md).
 */
const url = process.env.DATABASE_URL ?? "";
const dbName = url.split("/").pop()?.split("?")[0] ?? "";
if (!/_test(\W|$)/.test(dbName)) {
  throw new Error(
    `db-guard: refusing to run tests against DATABASE_URL='${url}'. Expected database name ending with '_test' (got '${dbName}'). This prevents spec-level deleteMany() from wiping your dev DB.`,
  );
}
