import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/modules/insights/llm-client.js", () => ({
  chatCompletion: vi.fn(async () => ({
    content: JSON.stringify({
      schemaVersion: 2,
      locale: "zh-CN",
      hero: {
        eyebrow: "MODELDOCTOR · 双 stage 对比",
        title: "stage B 吞吐 3.8 req/s 领先 A 27%",
        subtitle: "B 吞吐 3.8 req/s 比 A 高 27%,但错误率非零。",
        metaItems: [{ label: "tool", value: "guidellm" }],
      },
      summaryCards: [
        { label: "B 吞吐", value: "3.8", unit: "req/s", tone: "success", trend: "领先 27%" },
        { label: "B 错误率", value: "1.0", unit: "%", tone: "danger" },
      ],
      sections: [
        {
          id: "summary",
          num: "01",
          title: "stage B 吞吐 3.8 req/s 领先 A 27%",
          bodyMarkdown: "B 吞吐 3.8 req/s 高于 A 3.0,A 错误率 0,B 1%。",
        },
        {
          id: "scope",
          num: "02",
          title: "两 stage guidellm 推理对比",
          bodyMarkdown: "对比 A / B 两个 stage 的吞吐与错误率。",
        },
        {
          id: "method",
          num: "03",
          title: "guidellm + 1000 req 样本固定",
          bodyMarkdown: "工具 guidellm,每 stage 1000 请求。",
        },
        {
          id: "results",
          num: "04",
          title: "B 在 TTFT / E2E / 吞吐三项均领先",
          bodyMarkdown: "B 吞吐 3.8,A 3.0。TTFT p50 B 80 ms,A 100 ms。",
        },
        {
          id: "caveats",
          num: "05",
          title: "B 错误率 1% 需复测",
          bodyMarkdown: "B 10/1000 失败,建议复测确认。",
        },
        {
          id: "advice",
          num: "06",
          title: "吞吐优先选 B",
          bodyMarkdown: "吞吐优先 B,错误率 0 严格场景 A。",
        },
      ],
      figures: [],
      lintWarnings: [],
    }),
    latencyMs: 100,
  })),
}));

import { PrismaService } from "../../src/database/prisma.service.js";
import { bootE2E, type E2EContext, registerUser } from "../helpers/app.js";

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

  it("POST rejects mixed-scenario benchmarks with 400", async () => {
    // Seed a third benchmark with a different scenario
    const bOther = await prisma.benchmark.create({
      data: {
        userId,
        scenario: "lb-strategy",
        tool: "guidellm",
        name: "r-lb",
        params: {},
        summaryMetrics: {
          tool: "guidellm",
          data: {
            ttft: { p50: 90, p90: 180, p99: 450 },
            e2eLatency: { p50: 750, p90: 1400, p99: 2800 },
            requestsPerSecond: { mean: 3.5 },
            requests: { total: 1000, error: 5 },
          },
        },
      },
    });

    // runIds[0] is scenario="inference", bOther is scenario="lb-strategy"
    await request(ctx.app.getHttpServer())
      .post("/api/saved-compares")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "mixed-scenario-compare",
        benchmarkIds: [runIds[0], bOther.id],
        stageLabels: { [runIds[0]]: "A", [bOther.id]: "B" },
      })
      .expect(400);
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

    // Use the API to create the default provider so the apiKey is encrypted.
    await request(ctx.app.getHttpServer())
      .post("/api/llm-judge/providers")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "default", baseUrl: "http://llm", apiKey: "sk-test", model: "gpt-4", isDefault: true })
      .expect(201);

    const r1 = await request(ctx.app.getHttpServer())
      .post(`/api/saved-compares/${sc.body.id}/synthesize`)
      .set("Authorization", `Bearer ${token}`)
      .send({ locale: "zh-CN" })
      .expect(201);

    expect(r1.body.fromCache).toBe(false);
    expect(r1.body.narrative.schemaVersion).toBe(2);
    expect(r1.body.narrative.sections).toHaveLength(6);
    expect(r1.body.narrative.hero.title).toContain("3.8");

    const r2 = await request(ctx.app.getHttpServer())
      .post(`/api/saved-compares/${sc.body.id}/synthesize`)
      .set("Authorization", `Bearer ${token}`)
      .send({ locale: "zh-CN" })
      .expect(201);
    expect(r2.body.fromCache).toBe(true);
  });
});
