/**
 * auth-flow.e2e-spec.ts — isolated rate-limit scenario.
 *
 * Lives in its own file so the ThrottlerModule IP bucket (which is per-AppModule
 * instance) is completely separate from auth.e2e-spec.ts. Each test file boots
 * its own AppModule, so throttle state never bleeds between files.
 *
 * Strategy: register a user first (register is NOT throttled at 10/60s), then
 * fire 11 login attempts with wrong credentials. The first 10 must return 401
 * (wrong password), the 11th must return 429 (too many requests).
 */
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type E2EContext, bootE2E } from "../helpers/app.js";

describe("Auth rate limit (e2e)", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = await bootE2E();

    // Register the target user via register (not throttled) so the email exists.
    await request(ctx.app.getHttpServer())
      .post("/api/auth/register")
      .send({ email: "ratelimit@example.com", password: "Password1!" })
      .expect(201);
  }, 120_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  it("11 login attempts → 10×401 then 429", async () => {
    const results: number[] = [];

    for (let i = 0; i < 11; i++) {
      const res = await request(ctx.app.getHttpServer())
        .post("/api/auth/login")
        .send({ email: "ratelimit@example.com", password: "WRONG_PASSWORD" });
      results.push(res.status);
    }

    // First 10 should be 401 (wrong credentials, throttle not yet hit)
    for (let i = 0; i < 10; i++) {
      expect(results[i], `attempt ${i + 1} should be 401`).toBe(401);
    }
    // 11th should be 429 (rate limited)
    expect(results[10], "attempt 11 should be 429").toBe(429);
  });
});
