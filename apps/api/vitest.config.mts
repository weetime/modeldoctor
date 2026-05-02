import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import swc from "unplugin-swc";

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
    // Many repository/service specs share the local Postgres dev DB and
    // wipe rows in `beforeEach`. Running spec files in parallel races
    // those wipes against in-flight inserts (FK violations on baselines
    // → runs). Force file-level serialization; tests within a file still
    // run in order.
    fileParallelism: false,
  },
});
