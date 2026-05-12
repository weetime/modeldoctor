import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/modules/insights/llm-client.js", () => ({
  chatCompletion: vi.fn(async () => ({
    content: JSON.stringify({
      tldr: [{ headline: "QPS up", oneLine: "B is 27% faster" }],
      analysis: [{ metricLabel: "QPS", body: "Cache hit explains the gain." }],
      conclusion: { recommendation: "Pick B for throughput.", caveats: [] },
    }),
    latencyMs: 100,
  })),
}));

import { PrismaService } from "../../src/database/prisma.service.js";
import { type E2EContext, bootE2E, registerUser } from "../helpers/app.js";

describe("/api/saved-compares (e2e)", () => {
  let ctx: E2EContext;
  let prisma: PrismaService;
  let token: string;
  let userId: string;
  let runIds: string[];

  beforeAll(async () => {
    ctx = await bootE2E();
    prisma = ctx.app.get(PrismaService);
    await prisma.savedCompare.deleteMany();
    await prisma.benchmark.deleteMany();
    await prisma.user.deleteMany();
    const u = await registerUser(ctx.app, "sc-e2e@example.com", "Password1!");
    token = u.token;
    userId = u.user.id;
  }, 120_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  beforeEach(async () => {
    await prisma.savedCompare.deleteMany();
    await prisma.llmJudgeProvider.deleteMany();
    await prisma.benchmark.deleteMany({ where: { userId } });
    const b1 = await prisma.benchmark.create({
      data: {
        userId,
        scenario: "inference",
        tool: "guidellm",
        name: "r1",
        params: {},
        summaryMetrics: {
          tool: "guidellm",
          data: {
            ttft: { p50: 100, p90: 200, p99: 500 },
            e2eLatency: { p50: 800, p90: 1500, p99: 3000 },
            requestsPerSecond: { mean: 3 },
            requests: { total: 1000, error: 0 },
          },
        },
      },
    });
    const b2 = await prisma.benchmark.create({
      data: {
        userId,
        scenario: "inference",
        tool: "guidellm",
        name: "r2",
        params: {},
        summaryMetrics: {
          tool: "guidellm",
          data: {
            ttft: { p50: 80, p90: 160, p99: 400 },
            e2eLatency: { p50: 700, p90: 1300, p99: 2700 },
            requestsPerSecond: { mean: 3.8 },
            requests: { total: 1000, error: 10 },
          },
        },
      },
    });
    runIds = [b1.id, b2.id];
  });

  it("POST creates, GET hydrates with benchmarks", async () => {
    const created = await request(ctx.app.getHttpServer())
      .post("/api/saved-compares")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "test",
        benchmarkIds: runIds,
        stageLabels: { [runIds[0]]: "A", [runIds[1]]: "B" },
        baselineId: runIds[0],
      })
      .expect(201);

    const detail = await request(ctx.app.getHttpServer())
      .get(`/api/saved-compares/${created.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(detail.body.benchmarks).toHaveLength(2);
    expect(detail.body.benchmarks[0].missing).toBe(false);
  });

  it("synthesize returns narrative and second call is fromCache", async () => {
    const sc = await request(ctx.app.getHttpServer())
      .post("/api/saved-compares")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "test",
        benchmarkIds: runIds,
        stageLabels: { [runIds[0]]: "A", [runIds[1]]: "B" },
      })
      .expect(201);

    // Use the API to create the provider so the apiKey is properly encrypted
    await request(ctx.app.getHttpServer())
      .put("/api/llm-judge/provider")
      .set("Authorization", `Bearer ${token}`)
      .send({ baseUrl: "http://llm", apiKey: "sk-test", model: "gpt-4", enabled: true })
      .expect(200);

    const r1 = await request(ctx.app.getHttpServer())
      .post(`/api/saved-compares/${sc.body.id}/synthesize`)
      .set("Authorization", `Bearer ${token}`)
      .send({ locale: "zh-CN" })
      .expect(201);

    expect(r1.body.fromCache).toBe(false);
    expect(r1.body.narrative.tldr).toHaveLength(1);

    const r2 = await request(ctx.app.getHttpServer())
      .post(`/api/saved-compares/${sc.body.id}/synthesize`)
      .set("Authorization", `Bearer ${token}`)
      .send({ locale: "zh-CN" })
      .expect(201);
    expect(r2.body.fromCache).toBe(true);
  });
});
