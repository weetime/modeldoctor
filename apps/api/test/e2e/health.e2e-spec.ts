import { HealthResponseSchema } from "@modeldoctor/contracts";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootE2E, type E2EContext } from "../helpers/app.js";

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
});
