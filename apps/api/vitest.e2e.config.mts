import swc from "unplugin-swc";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

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
    env: {
      // passport-jwt validates secretOrKey at strategy-construction time,
      // so AppModule boot needs a non-empty JWT secret even in test mode.
      JWT_ACCESS_SECRET: "e2e-test-jwt-secret-not-for-production-use-only-32+chars",
    },
  },
});
