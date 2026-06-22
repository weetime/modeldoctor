// apps/api/test/e2e/llm-judge.e2e-spec.ts
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootE2E, type E2EContext, registerUser } from "../helpers/app.js";

describe("/api/llm-judge providers (e2e)", () => {
  let ctx: E2EContext;
  let adminToken: string;
  let userToken: string;

  beforeAll(async () => {
    ctx = await bootE2E();
    // First registered user becomes admin (auth.service convention).
    const admin = await registerUser(ctx.app, "llm-judge-admin@example.com");
    const normal = await registerUser(ctx.app, "llm-judge-user@example.com");
    adminToken = admin.token;
    userToken = normal.token;
  }, 120_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  const server = () => ctx.app.getHttpServer();

  it("GET list is empty for fresh DB", async () => {
    const res = await request(server())
      .get("/api/llm-judge/providers")
      .set("Authorization", `Bearer ${userToken}`)
      .expect(200);
    expect(res.body.items).toEqual([]);
  });

  it("POST requires admin", async () => {
    await request(server())
      .post("/api/llm-judge/providers")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ name: "p1", baseUrl: "https://x.example.com/v1", apiKey: "sk-test", model: "gpt-x" })
      .expect(403);
  });

  it("POST :id/set-default requires admin", async () => {
    await request(server())
      .post("/api/llm-judge/providers/nope/set-default")
      .set("Authorization", `Bearer ${userToken}`)
      .expect(403);
  });

  it("admin can create + list (apiKey redacted) + set-default + delete", async () => {
    const created = await request(server())
      .post("/api/llm-judge/providers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "primary",
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-secret-key-long",
        model: "gpt-x",
        isDefault: true,
      })
      .expect(201);
    expect(created.body.id).toBeTruthy();
    expect(created.body.isDefault).toBe(true);
    expect(created.body.enabled).toBe(true);
    expect(created.body).not.toHaveProperty("apiKey");
    expect(created.body.apiKeyPreview).toContain("...");
    const id = created.body.id as string;

    // Global: a normal user sees it too.
    const list = await request(server())
      .get("/api/llm-judge/providers")
      .set("Authorization", `Bearer ${userToken}`)
      .expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].apiKey).toBeUndefined();

    // Second provider, then promote it.
    const second = await request(server())
      .post("/api/llm-judge/providers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "secondary",
        baseUrl: "https://api2.example.com/v1",
        apiKey: "sk-second-key-long",
        model: "gpt-y",
      })
      .expect(201);
    const secondId = second.body.id as string;

    await request(server())
      .post(`/api/llm-judge/providers/${secondId}/set-default`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(201);

    const afterPromote = await request(server())
      .get(`/api/llm-judge/providers/${id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(afterPromote.body.isDefault).toBe(false);

    await request(server())
      .delete(`/api/llm-judge/providers/${secondId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(204);

    const finalList = await request(server())
      .get("/api/llm-judge/providers")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(finalList.body.items).toHaveLength(1);
    expect(finalList.body.items[0].id).toBe(id);
  });

  it("rejects duplicate name with 409", async () => {
    await request(server())
      .post("/api/llm-judge/providers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "primary", baseUrl: "https://dup.example.com/v1", apiKey: "sk-x", model: "m" })
      .expect(409);
  });

  it("rejects disabling the default provider with 400", async () => {
    // Self-contained: promote a provider to default first (prior tests may have
    // left the workspace with zero defaults), then assert disabling it is denied.
    const list = await request(server())
      .get("/api/llm-judge/providers")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const target = list.body.items[0];
    expect(target).toBeTruthy();
    await request(server())
      .post(`/api/llm-judge/providers/${target.id}/set-default`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(201);
    await request(server())
      .patch(`/api/llm-judge/providers/${target.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ enabled: false })
      .expect(400);
  });
});
