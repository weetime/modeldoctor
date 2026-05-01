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
      // HmacCallbackGuard validates BENCHMARK_CALLBACK_SECRET at constructor
      // time (same pattern as passport-jwt), so AppModule boot needs a
      // non-empty value even when no benchmark e2e test cares about it.
      // env.schema.ts treats it as optional under NODE_ENV=test; this
      // injects a placeholder so the guard doesn't throw on construction.
      BENCHMARK_CALLBACK_SECRET: "e2e-test-callback-secret-not-for-production-use-32+chars",
      // BenchmarkService.constructor → decodeKey() runs at module init time,
      // same constructor-validation pattern. env.schema.ts treats this as
      // optional in test mode; inject a 32-byte base64 placeholder so the
      // service can boot. (32 zero bytes; never used to encrypt real data.)
      CONNECTION_API_KEY_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    },
  },
});
