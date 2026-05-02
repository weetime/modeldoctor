import { type ExecutionContext, UnauthorizedException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { describe, expect, it } from "vitest";
import type { Env } from "../../config/env.schema.js";
import { HmacCallbackGuard } from "./hmac-callback.guard.js";
import { signCallbackToken } from "./hmac-token.js";

const SECRET_STR = "x".repeat(48);
const SECRET = Buffer.from(SECRET_STR, "utf8");

function buildConfig(value: string | undefined): ConfigService<Env, true> {
  return {
    get: (key: string) => (key === "BENCHMARK_CALLBACK_SECRET" ? value : undefined),
  } as unknown as ConfigService<Env, true>;
}

function ctx(headers: Record<string, string>, params: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers, params }) }),
  } as unknown as ExecutionContext;
}

describe("HmacCallbackGuard", () => {
  it("accepts a valid token", () => {
    const id = "run-123";
    const token = signCallbackToken(id, SECRET, 600);
    const guard = new HmacCallbackGuard(buildConfig(SECRET_STR));
    expect(guard.canActivate(ctx({ authorization: `Bearer ${token}` }, { id }))).toBe(true);
  });

  it("rejects when Authorization header is missing", () => {
    const guard = new HmacCallbackGuard(buildConfig(SECRET_STR));
    expect(() => guard.canActivate(ctx({}, { id: "run-123" }))).toThrow(UnauthorizedException);
  });

  it("rejects when scheme is not Bearer", () => {
    const guard = new HmacCallbackGuard(buildConfig(SECRET_STR));
    expect(() => guard.canActivate(ctx({ authorization: "Basic abc" }, { id: "run-123" }))).toThrow(
      UnauthorizedException,
    );
  });

  it("rejects when :id route param is missing", () => {
    const id = "run-123";
    const token = signCallbackToken(id, SECRET, 600);
    const guard = new HmacCallbackGuard(buildConfig(SECRET_STR));
    expect(() => guard.canActivate(ctx({ authorization: `Bearer ${token}` }, {}))).toThrow(
      UnauthorizedException,
    );
  });

  it("rejects an expired token", () => {
    const id = "run-123";
    const past = Math.floor(Date.now() / 1000) - 3600;
    const token = signCallbackToken(id, SECRET, -1, past);
    const guard = new HmacCallbackGuard(buildConfig(SECRET_STR));
    expect(() => guard.canActivate(ctx({ authorization: `Bearer ${token}` }, { id }))).toThrow(
      UnauthorizedException,
    );
  });

  it("rejects a token signed for a different id", () => {
    const token = signCallbackToken("other", SECRET, 600);
    const guard = new HmacCallbackGuard(buildConfig(SECRET_STR));
    expect(() =>
      guard.canActivate(ctx({ authorization: `Bearer ${token}` }, { id: "run-123" })),
    ).toThrow(UnauthorizedException);
  });

  it("throws fail-loud at construction if the secret is missing", () => {
    expect(() => new HmacCallbackGuard(buildConfig(undefined))).toThrow(
      /BENCHMARK_CALLBACK_SECRET/,
    );
  });
});
