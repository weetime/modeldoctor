import { insightsMatrixResponseSchema } from "@modeldoctor/contracts";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../../src/database/prisma.service.js";
import { bootE2E, type E2EContext, registerUser } from "../helpers/app.js";

describe("GET /api/insights/matrix (e2e)", () => {
  let ctx: E2EContext;
  let prisma: PrismaService;
  let token: string;
  let userId: string;
  let connectionId: string;

  beforeAll(async () => {
    ctx = await bootE2E();
    prisma = ctx.app.get(PrismaService);
    await prisma.benchmark.deleteMany();
    await prisma.connection.deleteMany();
    await prisma.user.deleteMany();

    const u = await registerUser(ctx.app, "insights-matrix-e2e@example.com", "Password1!");
    token = u.token;
    userId = u.user.id;

    const conn = await prisma.connection.create({
      data: {
        userId,
        name: "matrix-conn",
        baseUrl: "http://x",
        apiKeyCipher: "v1:a:b:c",
        model: "m",
        category: "chat",
      },
    });
    connectionId = conn.id;

    await prisma.benchmark.create({
      data: {
        userId,
        connectionId,
        scenario: "inference",
        tool: "guidellm",
        name: "matrix seed run",
        status: "completed",
        params: {},
        summaryMetrics: {
          tool: "guidellm",
          data: {
            ttft: { p95: 120, p99: 160 },
            e2eLatency: { p95: 2000, p99: 4000 },
            requests: { total: 1000, error: 5 },
            requestsPerSecond: { mean: 12 },
          },
        },
      },
    });
  }, 120_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  it("returns 200 with a zod-valid matrix containing the seeded endpoint + scenario dimension", async () => {
    const res = await request(ctx.app.getHttpServer())
      .get("/api/insights/matrix?aggregate=scenario&range=30d")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    const parsed = insightsMatrixResponseSchema.parse(res.body);

    expect(parsed.endpoints.some((e) => e.id === connectionId)).toBe(true);
    expect(parsed.dimensions.some((d) => d.key === "inference")).toBe(true);
  });
});
