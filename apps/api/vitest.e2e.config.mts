import swc from "unplugin-swc";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";
import { E2E_ENV_DEFAULTS } from "./test/setup/e2e-env-defaults.js";
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
      DATABASE_URL: TEST_DATABASE_URL,
      // Shared fixture so spec files can import the same constants they
      // expect ConfigService to see. See test/setup/e2e-env-defaults.ts for
      // per-key rationale.
      ...E2E_ENV_DEFAULTS,
    },
  },
});
