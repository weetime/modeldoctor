import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/modules/insights/llm-client.js", () => ({
  chatCompletion: vi.fn(async () => ({
    content: JSON.stringify({
      findings: [{
        severity: "warning",
        title: "TTFT high",
        rootCause: "p95 1240ms exceeds threshold",
        recommendations: ["warm up"],
      }],
    }),
    latencyMs: 100,
  })),
}));

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
    await prisma.llmJudgeProvider.deleteMany({ where: { userId } });
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

  it("POST /api/insights/:id/synthesize returns NarrativeFinding[] (mocked LLM)", async () => {
    const conn = await prisma.connection.create({
      data: {
        userId,
        name: "ai",
        baseUrl: "http://x",
        apiKeyCipher: "v1:a:b:c",
        model: "m",
        category: "chat",
      },
    });
    // Use the API to create the provider so the apiKey is properly encrypted
    await request(ctx.app.getHttpServer())
      .put("/api/llm-judge/provider")
      .set("Authorization", `Bearer ${token}`)
      .send({ baseUrl: "http://llm", apiKey: "sk-test", model: "m", enabled: true })
      .expect(200);
    const r = await request(ctx.app.getHttpServer())
      .post(`/api/insights/${conn.id}/synthesize`)
      .set("Authorization", `Bearer ${token}`)
      .send({ profileSlug: "default", range: "30d", runIds: [] })
      .expect(201);
    expect(r.body.findings).toHaveLength(1);
    expect(r.body.findings[0].severity).toBe("warning");
    expect(r.body.fromCache).toBe(false);
  });

  it("synthesize returns 404 when provider not configured", async () => {
    const conn = await prisma.connection.create({
      data: {
        userId,
        name: "noai",
        baseUrl: "http://x",
        apiKeyCipher: "v1:a:b:c",
        model: "m",
        category: "chat",
      },
    });
    // Note: beforeEach already wiped llmJudgeProvider; explicitly confirm clean state
    await prisma.llmJudgeProvider.deleteMany({ where: { userId } });
    await request(ctx.app.getHttpServer())
      .post(`/api/insights/${conn.id}/synthesize`)
      .set("Authorization", `Bearer ${token}`)
      .send({ profileSlug: "default", range: "30d", runIds: [] })
      .expect(404);
  });
});
