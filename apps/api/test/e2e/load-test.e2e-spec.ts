import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type E2EContext, bootE2E, registerUser } from "../helpers/app.js";

describe("LoadTest (e2e)", () => {
  let ctx: E2EContext;
  let accessToken: string;

  beforeAll(async () => {
    ctx = await bootE2E();
    const registered = await registerUser(ctx.app, "loadtest@example.com", "Password1!");
    accessToken = registered.token;
  }, 120_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  it("rejects missing apiUrl", async () => {
    const res = await request(ctx.app.getHttpServer())
      .post("/api/load-test")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ apiKey: "k", model: "m", rate: 1, duration: 1 })
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    expect(res.body.error.requestId).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("rejects rate=0", async () => {
    const res = await request(ctx.app.getHttpServer())
      .post("/api/load-test")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ apiUrl: "x", apiKey: "k", model: "m", rate: 0, duration: 1 })
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    expect(res.body.error.message).toMatch(/rate/i);
    expect(res.body.error.requestId).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("rejects duration>3600", async () => {
    const res = await request(ctx.app.getHttpServer())
      .post("/api/load-test")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ apiUrl: "x", apiKey: "k", model: "m", rate: 1, duration: 99999 })
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    expect(res.body.error.message).toMatch(/duration/i);
    expect(res.body.error.requestId).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
