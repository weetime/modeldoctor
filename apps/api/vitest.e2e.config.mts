import swc from "unplugin-swc";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";
import { pickTestDatabaseUrl } from "./test/setup/pick-test-db-url.js";

// Same test DB resolution as vitest.config.mts. See that file for rationale.
const TEST_DATABASE_URL = pickTestDatabaseUrl();

export default defineConfig({
  plugins: [
    tsconfigPaths(),
    swc.vite({
      module: { type: "es6" },
      jsc: {
        parser: { syntax: "typescript", decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: "es2022",
      },
    }),
  ],
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.e2e-spec.ts"],
    exclude: ["node_modules", "dist"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    globalSetup: ["./test/setup/global-setup.mts"],
    setupFiles: ["./test/setup/db-guard.ts"],
    env: {
      // DATABASE_URL is the only env we inject dynamically — pickTestDatabaseUrl
      // honours TEST_DATABASE_URL overrides and refuses to pass a non-`_test`
      // URL through. All other test-mode values (JWT secret, callback URL,
      // encryption key, ALERTMANAGER / MCP / RUNNER_IMAGE_* …) live in
      // apps/api/.env.test and are auto-loaded by AppConfigModule when
      // NODE_ENV=test (vitest sets NODE_ENV=test by default).
      DATABASE_URL: TEST_DATABASE_URL,
    },
  },
});
