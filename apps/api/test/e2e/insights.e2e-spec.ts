import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaService } from "../../src/database/prisma.service.js";
import { type E2EContext, bootE2E, registerUser } from "../helpers/app.js";

describe("/api/insights comparison endpoints (e2e)", () => {
  let ctx: E2EContext;
  let prisma: PrismaService;
  let token: string;
  let userId: string;

  beforeAll(async () => {
    ctx = await bootE2E();
    prisma = ctx.app.get(PrismaService);
    await prisma.benchmark.deleteMany();
    await prisma.connection.deleteMany();
    await prisma.user.deleteMany();
    const u = await registerUser(ctx.app, "comparison-e2e@example.com", "Password1!");
    token = u.token;
    userId = u.user.id;
  }, 120_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  beforeEach(async () => {
    await prisma.benchmark.deleteMany();
    await prisma.connection.deleteMany({ where: { userId } });
  });

  it("baseline-comparison returns empty when no historical data", async () => {
    const conn = await prisma.connection.create({
      data: {
        userId,
        name: "t",
        baseUrl: "http://x",
        apiKeyCipher: "v1:a:b:c",
        model: "m",
        category: "chat",
      },
    });
    const r = await request(ctx.app.getHttpServer())
      .get(`/api/insights/${conn.id}/baseline-comparison?from=${new Date().toISOString()}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(r.body).toEqual({ items: [] });
  });

  it("fleet-comparison returns empty when only one connection in category", async () => {
    const conn = await prisma.connection.create({
      data: {
        userId,
        name: "t2",
        baseUrl: "http://x",
        apiKeyCipher: "v1:a:b:c",
        model: "m",
        category: "chat",
      },
    });
    const r = await request(ctx.app.getHttpServer())
      .get(`/api/insights/${conn.id}/fleet-comparison?from=${new Date().toISOString()}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(r.body).toEqual({ items: [] });
  });
});
