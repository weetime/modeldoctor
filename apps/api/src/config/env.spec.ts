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
      CONNECTION_API_KEY_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
      BENCHMARK_CALLBACK_SECRET: "y".repeat(48),
      BENCHMARK_CALLBACK_URL: "http://localhost:3001",
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
      CONNECTION_API_KEY_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
      BENCHMARK_CALLBACK_SECRET: "y".repeat(48),
      BENCHMARK_CALLBACK_URL: "http://localhost:3001",
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
    expect(
      validateEnv({ NODE_ENV: "test", DISABLE_FIRST_USER_ADMIN: true }).DISABLE_FIRST_USER_ADMIN,
    ).toBe(true);
    expect(
      validateEnv({ NODE_ENV: "test", DISABLE_FIRST_USER_ADMIN: false }).DISABLE_FIRST_USER_ADMIN,
    ).toBe(false);
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

  // CONNECTION_API_KEY_ENCRYPTION_KEY: optional, but if provided must be a
  // base64 string that decodes to exactly 32 bytes (AES-256 key length).
  it("CONNECTION_API_KEY_ENCRYPTION_KEY is optional", () => {
    const env = validateEnv({ NODE_ENV: "test" });
    expect(env.CONNECTION_API_KEY_ENCRYPTION_KEY).toBeUndefined();
  });

  it("CONNECTION_API_KEY_ENCRYPTION_KEY accepts a 32-byte base64 key", () => {
    const key = Buffer.alloc(32, 0x42).toString("base64");
    const env = validateEnv({ NODE_ENV: "test", CONNECTION_API_KEY_ENCRYPTION_KEY: key });
    expect(env.CONNECTION_API_KEY_ENCRYPTION_KEY).toBe(key);
  });

  it("CONNECTION_API_KEY_ENCRYPTION_KEY rejects a key that decodes to ≠ 32 bytes", () => {
    const tooShort = Buffer.alloc(16, 0x42).toString("base64");
    expect(() =>
      validateEnv({ NODE_ENV: "test", CONNECTION_API_KEY_ENCRYPTION_KEY: tooShort }),
    ).toThrow(/CONNECTION_API_KEY_ENCRYPTION_KEY/);
  });

  it("CONNECTION_API_KEY_ENCRYPTION_KEY rejects non-base64 input", () => {
    expect(() =>
      validateEnv({ NODE_ENV: "test", CONNECTION_API_KEY_ENCRYPTION_KEY: "not!base64!@#$" }),
    ).toThrow(/CONNECTION_API_KEY_ENCRYPTION_KEY/);
  });

  // BENCHMARK_CALLBACK_SECRET: optional, but if provided must be ≥ 32 chars.
  it("BENCHMARK_CALLBACK_SECRET is optional", () => {
    const env = validateEnv({ NODE_ENV: "test" });
    expect(env.BENCHMARK_CALLBACK_SECRET).toBeUndefined();
  });

  it("BENCHMARK_CALLBACK_SECRET accepts a 32-char string", () => {
    const env = validateEnv({ NODE_ENV: "test", BENCHMARK_CALLBACK_SECRET: "x".repeat(32) });
    expect(env.BENCHMARK_CALLBACK_SECRET).toBe("x".repeat(32));
  });

  it("BENCHMARK_CALLBACK_SECRET rejects a string shorter than 32 chars", () => {
    expect(() =>
      validateEnv({ NODE_ENV: "test", BENCHMARK_CALLBACK_SECRET: "x".repeat(31) }),
    ).toThrow(/BENCHMARK_CALLBACK_SECRET/);
  });

  describe("Phase 3 benchmark env", () => {
    const baseTest = {
      NODE_ENV: "test" as const,
    };
    const baseDev = {
      NODE_ENV: "development" as const,
      DATABASE_URL: "postgres://localhost:5432/db",
      JWT_ACCESS_SECRET: "x".repeat(32),
      CONNECTION_API_KEY_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
      BENCHMARK_CALLBACK_SECRET: "y".repeat(48),
      BENCHMARK_CALLBACK_URL: "http://localhost:3001",
    };

    it("defaults BENCHMARK_DRIVER to subprocess", () => {
      const env = validateEnv(baseDev);
      expect(env.BENCHMARK_DRIVER).toBe("subprocess");
    });

    it("rejects unknown BENCHMARK_DRIVER values", () => {
      expect(() => validateEnv({ ...baseDev, BENCHMARK_DRIVER: "bogus" })).toThrow(
        /BENCHMARK_DRIVER/,
      );
    });

    it("requires RUNNER_IMAGE_GUIDELLM when BENCHMARK_DRIVER=k8s", () => {
      expect(() =>
        validateEnv({
          ...baseDev,
          BENCHMARK_DRIVER: "k8s",
          RUNNER_IMAGE_VEGETA: "md-runner-vegeta:dev2",
          RUNNER_IMAGE_GENAI_PERF: "md-runner-genai-perf:dev2",
        }),
      ).toThrow(/RUNNER_IMAGE_GUIDELLM/);
    });

    it("requires RUNNER_IMAGE_VEGETA when BENCHMARK_DRIVER=k8s", () => {
      expect(() =>
        validateEnv({
          ...baseDev,
          BENCHMARK_DRIVER: "k8s",
          RUNNER_IMAGE_GUIDELLM: "md-runner-guidellm:dev2",
          RUNNER_IMAGE_GENAI_PERF: "md-runner-genai-perf:dev2",
        }),
      ).toThrow(/RUNNER_IMAGE_VEGETA/);
    });

    it("requires RUNNER_IMAGE_GENAI_PERF when BENCHMARK_DRIVER=k8s", () => {
      expect(() =>
        validateEnv({
          ...baseDev,
          BENCHMARK_DRIVER: "k8s",
          RUNNER_IMAGE_GUIDELLM: "md-runner-guidellm:dev2",
          RUNNER_IMAGE_VEGETA: "md-runner-vegeta:dev2",
        }),
      ).toThrow(/RUNNER_IMAGE_GENAI_PERF/);
    });

    it("accepts BENCHMARK_DRIVER=k8s when all three RUNNER_IMAGE_* are set", () => {
      const env = validateEnv({
        ...baseDev,
        BENCHMARK_DRIVER: "k8s",
        RUNNER_IMAGE_GUIDELLM: "md-runner-guidellm:dev2",
        RUNNER_IMAGE_VEGETA: "md-runner-vegeta:dev2",
        RUNNER_IMAGE_GENAI_PERF: "md-runner-genai-perf:dev2",
      });
      expect(env.BENCHMARK_DRIVER).toBe("k8s");
      expect(env.BENCHMARK_K8S_NAMESPACE).toBe("modeldoctor-benchmarks");
      expect(env.RUNNER_IMAGE_GUIDELLM).toBe("md-runner-guidellm:dev2");
      expect(env.RUNNER_IMAGE_VEGETA).toBe("md-runner-vegeta:dev2");
      expect(env.RUNNER_IMAGE_GENAI_PERF).toBe("md-runner-genai-perf:dev2");
    });

    it("does NOT require RUNNER_IMAGE_* when BENCHMARK_DRIVER=subprocess", () => {
      const env = validateEnv({ ...baseDev, BENCHMARK_DRIVER: "subprocess" });
      expect(env.BENCHMARK_DRIVER).toBe("subprocess");
      expect(env.RUNNER_IMAGE_GUIDELLM).toBeUndefined();
    });

    it("defaults BENCHMARK_DEFAULT_MAX_DURATION_SECONDS to 1800", () => {
      const env = validateEnv(baseDev);
      expect(env.BENCHMARK_DEFAULT_MAX_DURATION_SECONDS).toBe(1800);
    });

    it("requires CONNECTION_API_KEY_ENCRYPTION_KEY outside test mode", () => {
      const noKey = { ...baseDev, CONNECTION_API_KEY_ENCRYPTION_KEY: undefined };
      expect(() => validateEnv(noKey)).toThrow(/CONNECTION_API_KEY_ENCRYPTION_KEY/);
    });

    it("requires BENCHMARK_CALLBACK_SECRET outside test mode", () => {
      const noSecret = { ...baseDev, BENCHMARK_CALLBACK_SECRET: undefined };
      expect(() => validateEnv(noSecret)).toThrow(/BENCHMARK_CALLBACK_SECRET/);
    });

    it("requires BENCHMARK_CALLBACK_URL outside test mode", () => {
      const noUrl = { ...baseDev, BENCHMARK_CALLBACK_URL: undefined };
      expect(() => validateEnv(noUrl)).toThrow(/BENCHMARK_CALLBACK_URL/);
    });

    it("does not require benchmark vars in test mode", () => {
      // Sanity: existing baseTest still passes.
      const env = validateEnv(baseTest);
      expect(env.NODE_ENV).toBe("test");
      expect(env.BENCHMARK_DRIVER).toBe("subprocess");
    });
  });
});
