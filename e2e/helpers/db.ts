import { execFileSync } from "node:child_process";

/**
 * Wipe domain tables on the test DB before a spec runs.
 *
 * Why a SQL command over Prisma deleteMany: keeps the e2e suite
 * independent of the api's runtime — we don't want to import
 * @modeldoctor/api just to clean state. The Postgres CLI is enough.
 *
 * `execFileSync` (not `execSync`) is used so the SQL string isn't
 * re-quoted by a shell — table names like `"User"` need to keep their
 * literal double quotes for Postgres identifier casing.
 *
 * Why DELETE in dependency order over `TRUNCATE … CASCADE`: the previous
 * cascade wiped `evaluation_profiles` because it has a SetNull FK to
 * `users` (created_by) and CASCADE on TRUNCATE ignores onDelete rules.
 * That broke the seeded built-in profiles between Playwright runs and
 * spec runs that share the same DB. Going through DELETE respects the
 * schema's onDelete: Cascade / SetNull semantics, so:
 *  - cascading children (connections, refresh_tokens, llm_judge_providers,
 *    baselines) get cleaned automatically when users go.
 *  - SetNull children (benchmarks, diagnostics_runs, benchmark_templates,
 *    custom evaluation_profiles) are deleted explicitly first.
 *  - built-in evaluation_profiles (`is_builtin = true`) survive — that's
 *    the migration-seeded data.
 *
 * Order matters because `baselines.benchmark_id` is `onDelete: Restrict`
 * (block-on-orphan): baselines must go before benchmarks.
 */
export function resetTestDb(): void {
  const dbUrl =
    process.env.TEST_DATABASE_URL ??
    "postgresql://modeldoctor:modeldoctor@localhost:5432/modeldoctor_test";

  const sql = [
    "DELETE FROM baselines;",
    "DELETE FROM diagnostics_runs;",
    "DELETE FROM benchmarks;",
    "DELETE FROM benchmark_templates;",
    "DELETE FROM evaluation_profiles WHERE is_builtin = false;",
    "DELETE FROM users;",
  ].join(" ");

  execFileSync("psql", [dbUrl, "-v", "ON_ERROR_STOP=1", "-c", sql], {
    stdio: "pipe",
  });
}
