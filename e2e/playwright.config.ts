import { defineConfig, devices } from "@playwright/test";

/**
 * Browser-level e2e smoke for ModelDoctor.
 *
 * Distinct from `apps/api/test/e2e/*.e2e-spec.ts` (HTTP-layer Vitest tests):
 * this runs Playwright against the full stack (web + api + Postgres) to
 * catch integration issues unit/HTTP tests miss — wiring between RHF,
 * shadcn Form, react-i18next, react-query, and the api.
 *
 * Local run:
 *   1. `pnpm -F @modeldoctor/api db:setup:test` (creates modeldoctor_test
 *      and runs migrate deploy — idempotent).
 *   2. `pnpm test:e2e` — Playwright auto-starts api+web with TEST_DATABASE_URL
 *      and runs the suite.
 *
 * The api connects to `modeldoctor_test`; this is the SAME DB that
 * `apps/api/test/e2e` uses, so do not run vitest e2e and Playwright
 * concurrently. CI runs them as separate jobs.
 */

const E2E_API_PORT = Number(process.env.E2E_API_PORT) || 3401;
const E2E_WEB_PORT = Number(process.env.E2E_WEB_PORT) || 5573;
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://modeldoctor:modeldoctor@localhost:5432/modeldoctor_test";

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false, // shared DB → serialize for now
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  outputDir: "./test-results",

  use: {
    baseURL: `http://localhost:${E2E_WEB_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: [
    {
      // API on a non-default port hitting modeldoctor_test.
      command: "pnpm -F @modeldoctor/api start:dev",
      url: `http://localhost:${E2E_API_PORT}/api/health`,
      cwd: "..",
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: {
        // NODE_ENV=test triggers AppConfigModule to load apps/api/.env.test —
        // that file is the single source of truth for JWT/encryption/callback
        // secrets and runner image tags. We only inline the server-shape config
        // here (port, DB URL pointing at the e2e DB, CORS origin matching the
        // playwright web server, log level).
        NODE_ENV: "test",
        PORT: String(E2E_API_PORT),
        DATABASE_URL: TEST_DATABASE_URL,
        CORS_ORIGINS: `http://localhost:${E2E_WEB_PORT}`,
        // Quiet logs during e2e — pino logs at info+ by default.
        LOG_LEVEL: "warn",
      },
    },
    {
      // Web Vite dev pointed at the e2e api via VITE_API_PORT.
      command: "pnpm -F @modeldoctor/web dev",
      url: `http://localhost:${E2E_WEB_PORT}`,
      cwd: "..",
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
      env: {
        VITE_PORT: String(E2E_WEB_PORT),
        API_PORT: String(E2E_API_PORT),
      },
    },
  ],
});
