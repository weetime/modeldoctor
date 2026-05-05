import { execFileSync } from "node:child_process";

/**
 * Wipe domain tables on the test DB before a spec runs.
 *
 * Why a SQL truncate over Prisma deleteMany: keeps the e2e suite
 * independent of the api's runtime — we don't want to import
 * @modeldoctor/api just to clean state. The Postgres CLI is enough.
 *
 * `execFileSync` (not `execSync`) is used so the SQL string isn't
 * re-quoted by a shell — table names like `"User"` need to keep their
 * literal double quotes for Postgres identifier casing.
 *
 * `TRUNCATE … CASCADE` handles FKs in one shot. `_prisma_migrations`
 * is left alone since it tracks schema, not data.
 */
export function resetTestDb(): void {
  const dbUrl =
    process.env.TEST_DATABASE_URL ??
    "postgresql://modeldoctor:modeldoctor@localhost:5432/modeldoctor_test";

  // Tables use Prisma's `@@map(...)` snake_case names (see schema.prisma).
  const sql =
    "TRUNCATE TABLE baselines, benchmarks, benchmark_templates, diagnostics_runs, connections, refresh_tokens, users RESTART IDENTITY CASCADE;";

  execFileSync("psql", [dbUrl, "-v", "ON_ERROR_STOP=1", "-c", sql], {
    stdio: "pipe",
  });
}
