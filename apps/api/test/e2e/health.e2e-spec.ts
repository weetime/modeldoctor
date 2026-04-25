import { CheckVegetaResponseSchema, HealthResponseSchema } from "@modeldoctor/contracts";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type E2EContext, bootE2E } from "../helpers/app.js";

describe("Health (e2e)", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = await bootE2E();
  }, 120_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  it("GET /api/health → 200 with terminus shape", async () => {
    const res = await request(ctx.app.getHttpServer()).get("/api/health").expect(200);
    const parsed = HealthResponseSchema.parse(res.body);
    expect(parsed.status).toBe("ok");
    expect(res.body.info?.database?.status).toBe("up");
  });

  it("GET /api/check-vegeta → 200 with legacy-compatible shape", async () => {
    const res = await request(ctx.app.getHttpServer()).get("/api/check-vegeta").expect(200);
    const parsed = CheckVegetaResponseSchema.parse(res.body);
    expect(typeof parsed.installed).toBe("boolean");
    if (parsed.installed) {
      expect(parsed.path).toMatch(/\S/);
    } else {
      expect(parsed.path).toBeNull();
    }
  });
});
