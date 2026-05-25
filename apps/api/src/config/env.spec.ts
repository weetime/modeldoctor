import { describe, expect, it } from "vitest";
import { validateEnv } from "./env.schema.js";

// Single fixture: a fully-valid env that every spec starts from and mutates
// to assert a single failure mode. Mirrors the dummy values in
// apps/api/.env.test (the SSOT consumed at runtime when NODE_ENV=test). After
// #223 the schema is uniformly required across all envs — test isolation
// lives at the loading layer, not the schema.
const validEnv = () => ({
  NODE_ENV: "test" as const,
  DATABASE_URL: "postgresql://u:p@h:5432/d",
  JWT_ACCESS_SECRET: "x".repeat(48),
  CONNECTION_API_KEY_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
  BENCHMARK_CALLBACK_SECRET: "y".repeat(48),
  BENCHMARK_CALLBACK_URL: "http://localhost:3001",
  ALERTMANAGER_WEBHOOK_SECRET: "z".repeat(48),
  RUNNER_IMAGE_GUIDELLM: "md-runner-guidellm:test",
  RUNNER_IMAGE_VEGETA: "md-runner-vegeta:test",
  RUNNER_IMAGE_PREFIX_CACHE_PROBE: "md-runner-prefix-cache-probe:test",
  RUNNER_IMAGE_EVALSCOPE: "md-runner-evalscope:test",
  RUNNER_IMAGE_AIPERF: "md-runner-aiperf:test",
  // S3-compatible object storage (required since Phase 2).
  S3_ENDPOINT: "http://localhost:9999",
  S3_ACCESS_KEY: "test-access-key",
  S3_SECRET_KEY: "test-secret-key",
  S3_BUCKET: "test-bucket",
});

describe("validateEnv", () => {
  it("accepts a fully-populated env in test mode", () => {
    const env = validateEnv(validEnv());
    expect(env.NODE_ENV).toBe("test");
    expect(env.PORT).toBe(3001);
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.CORS_ORIGINS).toEqual(["http://localhost:5173"]);
    expect(env.BENCHMARK_K8S_NAMESPACE).toBe("modeldoctor-benchmarks");
    expect(env.BENCHMARK_DEFAULT_MAX_DURATION_SECONDS).toBe(1800);
  });

  it("accepts the same env in production", () => {
    const env = validateEnv({ ...validEnv(), NODE_ENV: "production" });
    expect(env.NODE_ENV).toBe("production");
    expect(env.JWT_ACCESS_SECRET).toBe("x".repeat(48));
  });

  it("coerces PORT string to number", () => {
    const env = validateEnv({ ...validEnv(), PORT: "8080" });
    expect(env.PORT).toBe(8080);
  });

  it("rejects bad LOG_LEVEL", () => {
    expect(() => validateEnv({ ...validEnv(), LOG_LEVEL: "chatty" })).toThrow(/LOG_LEVEL/);
  });

  it("splits CORS_ORIGINS on comma", () => {
    const env = validateEnv({ ...validEnv(), CORS_ORIGINS: "http://a,http://b" });
    expect(env.CORS_ORIGINS).toEqual(["http://a", "http://b"]);
  });

  // Uniformly-required fields — schema rejects missing values in EVERY env,
  // including test mode (#223). Each spec omits one required key and asserts
  // the corresponding ZodIssue path is reported.
  describe("uniformly required fields", () => {
    const requiredKeys = [
      "DATABASE_URL",
      "JWT_ACCESS_SECRET",
      "CONNECTION_API_KEY_ENCRYPTION_KEY",
      "BENCHMARK_CALLBACK_SECRET",
      "BENCHMARK_CALLBACK_URL",
      "ALERTMANAGER_WEBHOOK_SECRET",
      "RUNNER_IMAGE_GUIDELLM",
      "RUNNER_IMAGE_VEGETA",
      "RUNNER_IMAGE_PREFIX_CACHE_PROBE",
      "RUNNER_IMAGE_EVALSCOPE",
      "RUNNER_IMAGE_AIPERF",
      // S3 (required since Phase 2 — S3_REGION has a default so excluded)
      "S3_ENDPOINT",
      "S3_ACCESS_KEY",
      "S3_SECRET_KEY",
      "S3_BUCKET",
    ] as const;

    for (const key of requiredKeys) {
      it(`rejects when ${key} is missing in test mode`, () => {
        const { [key]: _omitted, ...rest } = validEnv();
        expect(() => validateEnv(rest)).toThrow(new RegExp(key));
      });

      it(`rejects when ${key} is missing in production`, () => {
        const { [key]: _omitted, ...rest } = validEnv();
        expect(() => validateEnv({ ...rest, NODE_ENV: "production" })).toThrow(new RegExp(key));
      });
    }
  });

  // Per-field shape constraints (length, format) — these guarded the same
  // mistakes pre-#223 and still apply.
  it("rejects JWT_ACCESS_SECRET shorter than 32 chars", () => {
    expect(() => validateEnv({ ...validEnv(), JWT_ACCESS_SECRET: "short" })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  it("rejects non-URL DATABASE_URL", () => {
    expect(() => validateEnv({ ...validEnv(), DATABASE_URL: "not-a-url" })).toThrow(/DATABASE_URL/);
  });

  it("rejects BENCHMARK_CALLBACK_SECRET shorter than 32 chars", () => {
    expect(() => validateEnv({ ...validEnv(), BENCHMARK_CALLBACK_SECRET: "x".repeat(31) })).toThrow(
      /BENCHMARK_CALLBACK_SECRET/,
    );
  });

  it("rejects CONNECTION_API_KEY_ENCRYPTION_KEY that decodes to ≠ 32 bytes", () => {
    const tooShort = Buffer.alloc(16, 0x42).toString("base64");
    expect(() =>
      validateEnv({ ...validEnv(), CONNECTION_API_KEY_ENCRYPTION_KEY: tooShort }),
    ).toThrow(/CONNECTION_API_KEY_ENCRYPTION_KEY/);
  });

  it("rejects CONNECTION_API_KEY_ENCRYPTION_KEY with non-base64 input", () => {
    expect(() =>
      validateEnv({ ...validEnv(), CONNECTION_API_KEY_ENCRYPTION_KEY: "not!base64!@#$" }),
    ).toThrow(/CONNECTION_API_KEY_ENCRYPTION_KEY/);
  });

  // DISABLE_FIRST_USER_ADMIN string-to-boolean coercion (safe-by-default
  // semantics). Regression guard: z.coerce.boolean() treated string "false"
  // as truthy.
  it("DISABLE_FIRST_USER_ADMIN defaults to false when unset", () => {
    const env = validateEnv(validEnv());
    expect(env.DISABLE_FIRST_USER_ADMIN).toBe(false);
  });

  it('DISABLE_FIRST_USER_ADMIN reads string "false" as boolean false', () => {
    const env = validateEnv({ ...validEnv(), DISABLE_FIRST_USER_ADMIN: "false" });
    expect(env.DISABLE_FIRST_USER_ADMIN).toBe(false);
  });

  it('DISABLE_FIRST_USER_ADMIN reads string "true" as boolean true', () => {
    const env = validateEnv({ ...validEnv(), DISABLE_FIRST_USER_ADMIN: "true" });
    expect(env.DISABLE_FIRST_USER_ADMIN).toBe(true);
  });

  it("DISABLE_FIRST_USER_ADMIN accepts native booleans", () => {
    expect(
      validateEnv({ ...validEnv(), DISABLE_FIRST_USER_ADMIN: true }).DISABLE_FIRST_USER_ADMIN,
    ).toBe(true);
    expect(
      validateEnv({ ...validEnv(), DISABLE_FIRST_USER_ADMIN: false }).DISABLE_FIRST_USER_ADMIN,
    ).toBe(false);
  });

  it("DISABLE_FIRST_USER_ADMIN rejects ambiguous strings (loud failure on typos)", () => {
    // Includes common boolean-ish conventions to surface a deliberate design
    // choice: env vars are strict — typos like "ture" or case-mismatched
    // "TRUE" must crash boot rather than silently resolve to false (the prior
    // bug behavior with z.coerce.boolean() was the symmetric mistake).
    for (const v of ["", "0", "no", "off", "TRUE", "yes", "1", "ture", "False"]) {
      expect(() => validateEnv({ ...validEnv(), DISABLE_FIRST_USER_ADMIN: v })).toThrow(
        /DISABLE_FIRST_USER_ADMIN/,
      );
    }
  });
});
