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
});
