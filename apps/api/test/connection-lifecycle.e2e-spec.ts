import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../src/database/prisma.service.js";
import { type E2EContext, bootE2E } from "./helpers/app.js";

describe("Connection lifecycle (e2e)", () => {
  let ctx: E2EContext;
  let bearer: string;
  let connId: string;

  beforeAll(async () => {
    ctx = await bootE2E();

    // Clean up any leftover rows from prior runs before registering
    const prisma = ctx.app.get(PrismaService);
    await prisma.user.deleteMany({
      where: { email: { in: ["conn-e2e@example.com", "other@example.com"] } },
    });

    // Register + login to get a bearer
    await request(ctx.app.getHttpServer())
      .post("/api/auth/register")
      .send({ email: "conn-e2e@example.com", password: "PasswordPassword1!" });
    const login = await request(ctx.app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: "conn-e2e@example.com", password: "PasswordPassword1!" });
    bearer = login.body.accessToken;
  }, 120_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  it("creates a connection, returns plaintext once, lists with preview only", async () => {
    const create = await request(ctx.app.getHttpServer())
      .post("/api/connections")
      .set("Authorization", `Bearer ${bearer}`)
      .send({
        name: "e2e-test-conn",
        baseUrl: "http://localhost:9999",
        apiKey: "sk-e2etest1234",
        model: "test-model",
        customHeaders: "",
        queryParams: "",
        category: "chat",
        tags: [],
      });
    expect(create.status).toBe(201);
    expect(create.body.apiKey).toBe("sk-e2etest1234");
    expect(create.body.apiKeyPreview).toBe("sk-...1234");
    connId = create.body.id;

    const list = await request(ctx.app.getHttpServer())
      .get("/api/connections")
      .set("Authorization", `Bearer ${bearer}`);
    expect(list.status).toBe(200);
    const item = list.body.items.find((c: { id: string }) => c.id === connId);
    expect(item).toBeDefined();
    expect(item.apiKey).toBeUndefined();
    expect(item.apiKeyPreview).toBe("sk-...1234");
  });

  it("rejects cross-user access with 403", async () => {
    // Register a second user
    await request(ctx.app.getHttpServer())
      .post("/api/auth/register")
      .send({ email: "other@example.com", password: "PasswordPassword1!" });
    const login2 = await request(ctx.app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: "other@example.com", password: "PasswordPassword1!" });
    const otherBearer = login2.body.accessToken;

    const res = await request(ctx.app.getHttpServer())
      .get(`/api/connections/${connId}`)
      .set("Authorization", `Bearer ${otherBearer}`);
    expect(res.status).toBe(403);
  });

  it("deletes the connection", async () => {
    const res = await request(ctx.app.getHttpServer())
      .delete(`/api/connections/${connId}`)
      .set("Authorization", `Bearer ${bearer}`);
    expect(res.status).toBe(204);
  });
});
