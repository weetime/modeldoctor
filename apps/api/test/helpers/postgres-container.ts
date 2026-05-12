import { execSync } from "node:child_process";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";

export interface TestDatabase {
  container: StartedPostgreSqlContainer;
  url: string;
  teardown: () => Promise<void>;
}

export async function startPostgres(): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer("postgres:16")
    .withDatabase("modeldoctor_test")
    .withUsername("test")
    .withPassword("test")
    .start();
  const url = container.getConnectionUri();

  try {
    const env = { ...process.env, DATABASE_URL: url };
    execSync("pnpm exec prisma migrate deploy", {
      cwd: process.cwd(), // apps/api when run via `pnpm -F @modeldoctor/api test:e2e`
      env,
      stdio: "inherit",
    });
    // Seed built-in / official content (5 evaluation_profiles, 10
    // benchmark_templates). E2E tests like insights.e2e-spec.ts assert
    // that `profileSlug: "default"` resolves — that only works because
    // seed.ts populated `evaluation_profiles` on this fresh container.
    execSync("pnpm exec prisma db seed", {
      cwd: process.cwd(),
      env,
      stdio: "inherit",
    });
  } catch (err) {
    // Stop the container before surfacing the failure so we don't leak docker resources.
    await container.stop();
    throw err;
  }

  return {
    container,
    url,
    teardown: async () => {
      await container.stop();
    },
  };
}
