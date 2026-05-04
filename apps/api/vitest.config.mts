import swc from "unplugin-swc";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";
import { pickTestDatabaseUrl } from "./test/setup/pick-test-db-url.js";

// Spec processes must connect to a `_test` database. A developer shell
// typically exports DATABASE_URL pointing at the dev DB so `pnpm start:dev`
// works; if that leaked into the test worker, `deleteMany()` would wipe
// real data. `pickTestDatabaseUrl` ignores a non-`_test` DATABASE_URL and
// falls back to `modeldoctor_test`; see that file for the full order.
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
    include: ["src/**/*.spec.ts"],
    exclude: ["node_modules", "dist", "test/**"],
    // Repository / service specs share one Postgres DB and clear rows in
    // beforeEach; running spec files in parallel races those wipes against
    // in-flight inserts (FK violations on baselines → runs). Force file
    // serialization; tests within a single file still run in order.
    fileParallelism: false,
    globalSetup: ["./test/setup/global-setup.mts"],
    setupFiles: ["./test/setup/db-guard.ts"],
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
    },
  },
});
