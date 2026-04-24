import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { execSync } from "node:child_process";

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
    execSync("pnpm exec prisma migrate deploy", {
      cwd: process.cwd(), // apps/api when run via `pnpm -F @modeldoctor/api test:e2e`
      env: { ...process.env, DATABASE_URL: url },
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
