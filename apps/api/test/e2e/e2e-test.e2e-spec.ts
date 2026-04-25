import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type E2EContext, bootE2E, registerUser } from "../helpers/app.js";

describe("E2ETest (e2e)", () => {
  let ctx: E2EContext;
  let accessToken: string;

  beforeAll(async () => {
    ctx = await bootE2E();
    const registered = await registerUser(ctx.app, "e2etest@example.com", "Password1!");
    accessToken = registered.token;
  }, 120_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  it("rejects missing apiUrl", async () => {
    const res = await request(ctx.app.getHttpServer())
      .post("/api/e2e-test")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ apiKey: "k", model: "m", probes: ["text"] })
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    expect(res.body.error.message).toMatch(/apiUrl/);
    expect(res.body.error.requestId).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("rejects empty probes array", async () => {
    const res = await request(ctx.app.getHttpServer())
      .post("/api/e2e-test")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ apiUrl: "x", apiKey: "k", model: "m", probes: [] })
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    expect(res.body.error.message).toMatch(/probes/);
    expect(res.body.error.requestId).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("rejects unknown probe name", async () => {
    const res = await request(ctx.app.getHttpServer())
      .post("/api/e2e-test")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ apiUrl: "x", apiKey: "k", model: "m", probes: ["bogus"] })
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    expect(res.body.error.message).toMatch(/probes/);
    expect(res.body.error.requestId).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
