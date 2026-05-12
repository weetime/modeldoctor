// apps/api/test/e2e/llm-judge.e2e-spec.ts
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type E2EContext, bootE2E } from "../helpers/app.js";

describe("/api/llm-judge (e2e)", () => {
  let ctx: E2EContext;
  let token: string;

  beforeAll(async () => {
    ctx = await bootE2E();
    const reg = await request(ctx.app.getHttpServer())
      .post("/api/auth/register")
      .send({ email: "llm-judge-e2e@example.com", password: "Password1!" })
      .expect(201);
    token = reg.body.accessToken as string;
  }, 120_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  it("PUT then GET round-trips public payload (apiKey redacted)", async () => {
    await request(ctx.app.getHttpServer())
      .put("/api/llm-judge/provider")
      .set("Authorization", `Bearer ${token}`)
      .send({ baseUrl: "https://x.example/v1", apiKey: "sk-test", model: "gpt-x", enabled: true })
      .expect(200);

    const r = await request(ctx.app.getHttpServer())
      .get("/api/llm-judge/provider")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(r.body.baseUrl).toBe("https://x.example/v1");
    expect(r.body).not.toHaveProperty("apiKey");
  });

  it("DELETE removes provider", async () => {
    await request(ctx.app.getHttpServer())
      .put("/api/llm-judge/provider")
      .set("Authorization", `Bearer ${token}`)
      .send({ baseUrl: "https://x.example/v1", apiKey: "sk-test", model: "m", enabled: true })
      .expect(200);

    await request(ctx.app.getHttpServer())
      .delete("/api/llm-judge/provider")
      .set("Authorization", `Bearer ${token}`)
      .expect(204);

    const r = await request(ctx.app.getHttpServer())
      .get("/api/llm-judge/provider")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    // NestJS serialises a null return as an empty body; check text is empty.
    expect(r.text).toBe("");
  });

  it("provider config is global — visible across users", async () => {
    // user B registers separately
    const regB = await request(ctx.app.getHttpServer())
      .post("/api/auth/register")
      .send({ email: `llm-judge-b-${Date.now()}@example.com`, password: "Password1!" })
      .expect(201);
    const tokenB = regB.body.accessToken as string;

    // user A (existing `token`) writes
    await request(ctx.app.getHttpServer())
      .put("/api/llm-judge/provider")
      .set("Authorization", `Bearer ${token}`)
      .send({
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-A",
        model: "shared",
        enabled: true,
      })
      .expect(200);

    // user B reads — sees A's config
    const r = await request(ctx.app.getHttpServer())
      .get("/api/llm-judge/provider")
      .set("Authorization", `Bearer ${tokenB}`)
      .expect(200);
    expect(r.body.baseUrl).toBe("https://api.example.com/v1");
    expect(r.body.model).toBe("shared");
  });

  it("a second user updating overwrites the global config for everyone", async () => {
    const regB = await request(ctx.app.getHttpServer())
      .post("/api/auth/register")
      .send({ email: `llm-judge-c-${Date.now()}@example.com`, password: "Password1!" })
      .expect(201);
    const tokenB = regB.body.accessToken as string;

    // user A seeds
    await request(ctx.app.getHttpServer())
      .put("/api/llm-judge/provider")
      .set("Authorization", `Bearer ${token}`)
      .send({ baseUrl: "https://api.example.com/v1", apiKey: "sk-A", model: "m1", enabled: true })
      .expect(200);

    // user B overwrites (re-uses saved key by omitting apiKey)
    await request(ctx.app.getHttpServer())
      .put("/api/llm-judge/provider")
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ baseUrl: "https://api.example.com/v2", model: "m2", enabled: true })
      .expect(200);

    // user A re-reads — sees B's overwrite
    const r = await request(ctx.app.getHttpServer())
      .get("/api/llm-judge/provider")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(r.body.baseUrl).toBe("https://api.example.com/v2");
    expect(r.body.model).toBe("m2");
  });
});
