import { describe, expect, it } from "vitest";
import { validateEnv } from "./env.schema.js";

describe("validateEnv", () => {
  it("accepts minimal env in test mode", () => {
    const env = validateEnv({ NODE_ENV: "test" });
    expect(env.NODE_ENV).toBe("test");
    expect(env.PORT).toBe(3001);
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.CORS_ORIGINS).toEqual(["http://localhost:5173"]);
  });

  it("coerces PORT string to number", () => {
    const env = validateEnv({ NODE_ENV: "test", PORT: "8080" });
    expect(env.PORT).toBe(8080);
  });

  it("rejects bad LOG_LEVEL", () => {
    expect(() => validateEnv({ NODE_ENV: "test", LOG_LEVEL: "chatty" })).toThrow(/LOG_LEVEL/);
  });

  it("splits CORS_ORIGINS on comma", () => {
    const env = validateEnv({ NODE_ENV: "test", CORS_ORIGINS: "http://a,http://b" });
    expect(env.CORS_ORIGINS).toEqual(["http://a", "http://b"]);
  });

  it("rejects JWT_ACCESS_SECRET shorter than 32 chars when provided", () => {
    expect(() => validateEnv({ NODE_ENV: "test", JWT_ACCESS_SECRET: "short" })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  // DATABASE_URL enforcement tests
  it("throws when NODE_ENV=development and DATABASE_URL is missing", () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });

  it("throws when NODE_ENV=production and DATABASE_URL is missing", () => {
    expect(() => validateEnv({ NODE_ENV: "production" })).toThrow(/DATABASE_URL/);
  });

  it("accepts NODE_ENV=production with a valid DATABASE_URL", () => {
    const env = validateEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://u:p@h:5432/d",
      JWT_ACCESS_SECRET: "a".repeat(32),
    });
    expect(env.DATABASE_URL).toBe("postgresql://u:p@h:5432/d");
  });

  it("rejects non-URL DATABASE_URL in production", () => {
    expect(() => validateEnv({ NODE_ENV: "production", DATABASE_URL: "not-a-url" })).toThrow(
      /DATABASE_URL/,
    );
  });

  // JWT_ACCESS_SECRET enforcement tests
  it("throws when NODE_ENV=development and JWT_ACCESS_SECRET is missing", () => {
    expect(() => validateEnv({})).toThrow(/JWT_ACCESS_SECRET/);
  });

  it("throws when NODE_ENV=production and JWT_ACCESS_SECRET is missing", () => {
    expect(() =>
      validateEnv({ NODE_ENV: "production", DATABASE_URL: "postgresql://u:p@h:5432/d" }),
    ).toThrow(/JWT_ACCESS_SECRET/);
  });

  it("accepts NODE_ENV=production with a valid JWT_ACCESS_SECRET and valid DATABASE_URL", () => {
    const env = validateEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://u:p@h:5432/d",
      JWT_ACCESS_SECRET: "a".repeat(32),
    });
    expect(env.JWT_ACCESS_SECRET).toBe("a".repeat(32));
  });

  // DISABLE_FIRST_USER_ADMIN string-to-boolean coercion (safe-by-default semantics).
  // Regression guard: z.coerce.boolean() treated string "false" as truthy.
  it("DISABLE_FIRST_USER_ADMIN defaults to false when unset", () => {
    const env = validateEnv({ NODE_ENV: "test" });
    expect(env.DISABLE_FIRST_USER_ADMIN).toBe(false);
  });

  it('DISABLE_FIRST_USER_ADMIN reads string "false" as boolean false', () => {
    const env = validateEnv({ NODE_ENV: "test", DISABLE_FIRST_USER_ADMIN: "false" });
    expect(env.DISABLE_FIRST_USER_ADMIN).toBe(false);
  });

  it('DISABLE_FIRST_USER_ADMIN reads string "true" as boolean true', () => {
    const env = validateEnv({ NODE_ENV: "test", DISABLE_FIRST_USER_ADMIN: "true" });
    expect(env.DISABLE_FIRST_USER_ADMIN).toBe(true);
  });

  it("DISABLE_FIRST_USER_ADMIN accepts native booleans", () => {
    expect(validateEnv({ NODE_ENV: "test", DISABLE_FIRST_USER_ADMIN: true }).DISABLE_FIRST_USER_ADMIN).toBe(true);
    expect(validateEnv({ NODE_ENV: "test", DISABLE_FIRST_USER_ADMIN: false }).DISABLE_FIRST_USER_ADMIN).toBe(false);
  });

  it("DISABLE_FIRST_USER_ADMIN rejects ambiguous strings (loud failure on typos)", () => {
    // Includes common boolean-ish conventions to surface a deliberate design
    // choice: env vars are strict — typos like "ture" or case-mismatched
    // "TRUE" must crash boot rather than silently resolve to false (the prior
    // bug behavior with z.coerce.boolean() was the symmetric mistake).
    for (const v of ["", "0", "no", "off", "TRUE", "yes", "1", "ture", "False"]) {
      expect(() => validateEnv({ NODE_ENV: "test", DISABLE_FIRST_USER_ADMIN: v })).toThrow(
        /DISABLE_FIRST_USER_ADMIN/,
      );
    }
  });

  // BENCHMARK_API_KEY_ENCRYPTION_KEY: optional, but if provided must be a
  // base64 string that decodes to exactly 32 bytes (AES-256 key length).
  it("BENCHMARK_API_KEY_ENCRYPTION_KEY is optional", () => {
    const env = validateEnv({ NODE_ENV: "test" });
    expect(env.BENCHMARK_API_KEY_ENCRYPTION_KEY).toBeUndefined();
  });

  it("BENCHMARK_API_KEY_ENCRYPTION_KEY accepts a 32-byte base64 key", () => {
    const key = Buffer.alloc(32, 0x42).toString("base64");
    const env = validateEnv({ NODE_ENV: "test", BENCHMARK_API_KEY_ENCRYPTION_KEY: key });
    expect(env.BENCHMARK_API_KEY_ENCRYPTION_KEY).toBe(key);
  });

  it("BENCHMARK_API_KEY_ENCRYPTION_KEY rejects a key that decodes to ≠ 32 bytes", () => {
    const tooShort = Buffer.alloc(16, 0x42).toString("base64");
    expect(() =>
      validateEnv({ NODE_ENV: "test", BENCHMARK_API_KEY_ENCRYPTION_KEY: tooShort }),
    ).toThrow(/BENCHMARK_API_KEY_ENCRYPTION_KEY/);
  });

  it("BENCHMARK_API_KEY_ENCRYPTION_KEY rejects non-base64 input", () => {
    expect(() =>
      validateEnv({ NODE_ENV: "test", BENCHMARK_API_KEY_ENCRYPTION_KEY: "not!base64!@#$" }),
    ).toThrow(/BENCHMARK_API_KEY_ENCRYPTION_KEY/);
  });
});
