import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pickTestDatabaseUrl } from "./pick-test-db-url.js";

const here = dirname(fileURLToPath(import.meta.url));
const apiDir = resolve(here, "../..");

/**
 * Vitest globalSetup: applies pending Prisma migrations to the test database
 * before any spec runs. Idempotent — if schema is current it's a no-op.
 *
 * Defends against a footgun: spec files in this repo call `deleteMany()` to
 * clear shared tables between cases. The URL pick logic in
 * `pick-test-db-url.ts` ignores a dev-pointing `DATABASE_URL` (the common
 * case when the developer's shell has it exported for `pnpm start:dev`)
 * and falls back to `modeldoctor_test`.
 *
 * If the test DB doesn't exist yet on a fresh checkout, run
 * `pnpm -F @modeldoctor/api db:setup:test` first (one-time createdb +
 * grant + migrate). Prisma's "database does not exist" error message
 * also points the way.
 */
export async function setup() {
  const url = pickTestDatabaseUrl();
  execSync("pnpm exec prisma migrate deploy", {
    stdio: "inherit",
    cwd: apiDir,
    env: { ...process.env, DATABASE_URL: url },
  });
}
