import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pickTestDatabaseUrl } from "./pick-test-db-url.js";

const here = dirname(fileURLToPath(import.meta.url));
const apiDir = resolve(here, "../..");

/**
 * Vitest globalSetup: applies pending Prisma migrations to the test database
 * AND seeds built-in / official content via `prisma db seed`. Both steps
 * are idempotent — if schema and seed are current, both are no-ops.
 *
 * Defends against a footgun: spec files in this repo call `deleteMany()` to
 * clear shared tables between cases. The URL pick logic in
 * `pick-test-db-url.ts` ignores a dev-pointing `DATABASE_URL` (the common
 * case when the developer's shell has it exported for `pnpm start:dev`)
 * and falls back to `modeldoctor_test`.
 *
 * The seed step is required because tests like
 * `evaluation-profile.service.spec.ts` assert that the 5 built-in
 * evaluation_profiles exist in the DB. Built-ins moved from migration
 * INSERTs to `apps/api/prisma/seed.ts` (see seed.ts header), so we run
 * the seed here right after migrate deploy.
 *
 * If the test DB doesn't exist yet on a fresh checkout, run
 * `pnpm -F @modeldoctor/api db:setup:test` first (one-time createdb +
 * grant + migrate + seed). Prisma's "database does not exist" error message
 * also points the way.
 */
export async function setup() {
  const url = pickTestDatabaseUrl();
  const env = { ...process.env, DATABASE_URL: url };
  execSync("pnpm exec prisma migrate deploy", { stdio: "inherit", cwd: apiDir, env });
  execSync("pnpm exec prisma db seed", { stdio: "inherit", cwd: apiDir, env });
}
