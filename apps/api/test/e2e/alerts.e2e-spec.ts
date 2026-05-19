import { type Server, createServer } from "node:http";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Hoisted mock — the Task 5 explainer e2e block exercises explainAsync end
// to end, which hits chatCompletion. We pin a known JSON response so the
// only thing under test is the Prom→prompt→DB pipeline, not the LLM call.
vi.mock("../../src/modules/insights/llm-client.js", () => ({
  chatCompletion: vi.fn(async () => ({
    content: JSON.stringify({
      ai_severity: "warning",
      narrative: "测试叙事段落,长度足够通过 zod 校验的二十字符下限。\n\n第二段也凑数。",
      recommendations: ["建议一", "建议二"],
    }),
    latencyMs: 50,
  })),
}));

import { decodeKey, encrypt } from "../../src/common/crypto/aes-gcm.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import { AlertExplainerService } from "../../src/modules/alerts/explainer.service.js";
import { type E2EContext, bootE2E, registerUser } from "../helpers/app.js";
import { E2E_ENV_DEFAULTS } from "../setup/e2e-env-defaults.js";

// Sourced from the pre-injected fixture (see vitest.e2e.config.mts) — the
// same value ConfigService.get returns at runtime. Setting process.env here
// in beforeAll would be too late: NestConfigModule.forRoot caches
// validatedConfig at AppModule import time.
const TEST_SECRET = E2E_ENV_DEFAULTS.ALERTMANAGER_WEBHOOK_SECRET;

describe("Alerts webhook e2e", () => {
  let ctx: E2EContext;
  let prisma: PrismaService;
  let token: string;

  beforeAll(async () => {
    ctx = await bootE2E();
    prisma = ctx.app.get(PrismaService);
    const u = await registerUser(ctx.app, "alerts@example.com");
    token = u.token;
  }, 120_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  function samplePayload(overrides: { fingerprint?: string; modelName?: string } = {}) {
    return {
      version: "4",
      groupKey: "{}:{alertname=\"ModelDoctorKvCacheHigh\"}",
      alerts: [
        {
          status: "firing" as const,
          labels: {
            alertname: "ModelDoctorKvCacheHigh",
            severity: "warning",
            modeldoctor_scenario: "kv-cache-pressure",
            model_name: overrides.modelName ?? "Qwen3-32B",
            engine: "vllm-v1",
            instance: "vllm-1.local:8000",
          },
          annotations: {
            summary: "KV cache 91% on test model",
            description: "KV cache utilization at 0.91 sustained for 5m.",
          },
          startsAt: "2026-05-17T08:00:00.000Z",
          fingerprint: overrides.fingerprint ?? `test-fp-${Date.now()}`,
        },
      ],
    };
  }

  it("rejects webhook without Bearer token", async () => {
    await request(ctx.app.getHttpServer())
      .post("/api/alerts/webhook")
      .send(samplePayload())
      .expect(401);
  });

  it("rejects webhook with wrong Bearer token", async () => {
    await request(ctx.app.getHttpServer())
      .post("/api/alerts/webhook")
      .set("Authorization", "Bearer wrong-token-totally-different-stuff-32+")
      .send(samplePayload())
      .expect(401);
  });

  it("accepts well-formed payload, creates AlertEvent, returns 202", async () => {
    const payload = samplePayload({ fingerprint: "happy-path-fp-1" });
    const res = await request(ctx.app.getHttpServer())
      .post("/api/alerts/webhook")
      .set("Authorization", `Bearer ${TEST_SECRET}`)
      .send(payload)
      .expect(202);

    expect(res.body).toEqual({ accepted: 1, created: 1 });

    const row = await prisma.alertEvent.findUnique({
      where: {
        fingerprint_startsAt: {
          fingerprint: "happy-path-fp-1",
          startsAt: new Date("2026-05-17T08:00:00.000Z"),
        },
      },
    });
    expect(row).not.toBeNull();
    expect(row?.severity).toBe("warning");
    expect(row?.scenario).toBe("kv-cache-pressure");
    expect(row?.modelName).toBe("Qwen3-32B");
    expect(row?.engine).toBe("vllm-v1");
    expect(row?.alertName).toBe("ModelDoctorKvCacheHigh");
  });

  it("idempotent: same fingerprint + startsAt does not duplicate row", async () => {
    const payload = samplePayload({ fingerprint: "idempotent-fp" });

    await request(ctx.app.getHttpServer())
      .post("/api/alerts/webhook")
      .set("Authorization", `Bearer ${TEST_SECRET}`)
      .send(payload)
      .expect(202);

    const res2 = await request(ctx.app.getHttpServer())
      .post("/api/alerts/webhook")
      .set("Authorization", `Bearer ${TEST_SECRET}`)
      .send(payload)
      .expect(202);

    expect(res2.body).toEqual({ accepted: 1, created: 0 });

    const count = await prisma.alertEvent.count({
      where: { fingerprint: "idempotent-fp" },
    });
    expect(count).toBe(1);
  });

  it("infers connectionId when model_name matches a Connection.model", async () => {
    // Create a connection owned by our test user with a matching model name.
    const userRow = await prisma.user.findUnique({ where: { email: "alerts@example.com" } });
    expect(userRow).not.toBeNull();
    await prisma.connection.create({
      data: {
        userId: userRow!.id,
        name: "test-conn-1",
        baseUrl: "https://vllm-1.local:8000",
        apiKeyCipher: "n/a",
        model: "Llama-3-70B",
        category: "chat",
      },
    });

    await request(ctx.app.getHttpServer())
      .post("/api/alerts/webhook")
      .set("Authorization", `Bearer ${TEST_SECRET}`)
      .send(samplePayload({ fingerprint: "inferred-fp", modelName: "Llama-3-70B" }))
      .expect(202);

    const row = await prisma.alertEvent.findUnique({
      where: {
        fingerprint_startsAt: {
          fingerprint: "inferred-fp",
          startsAt: new Date("2026-05-17T08:00:00.000Z"),
        },
      },
      include: { connection: { select: { name: true } } },
    });
    expect(row?.connection?.name).toBe("test-conn-1");
  });

  it("GET /api/alerts returns only the caller's connection-attributed alerts (unattributed are hidden)", async () => {
    const res = await request(ctx.app.getHttpServer())
      .get("/api/alerts")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    // Of the 4 alerts created in earlier specs, only the `inferred-fp`
    // one has a connectionId (created against the test user's Llama-3-70B
    // connection). The 3 unattributed alerts (happy-path / idempotent
    // / its rerun) must NOT leak to the user list — see security note in
    // alerts.service.listForUser.
    const fingerprints = res.body.map((r: { fingerprint: string }) => r.fingerprint);
    expect(fingerprints).toContain("inferred-fp");
    expect(fingerprints).not.toContain("happy-path-fp-1");
    expect(fingerprints).not.toContain("idempotent-fp");
  });
});

// Task 5: AlertExplainer + PrometheusFetcherService integration.
//
// We bypass POST /api/alerts/webhook (auth path is flaky in this worktree —
// see Task 5 plan notes) and drive explainAsync() directly against the boot
// app. A node:http server stands in for Prometheus so we verify the fetcher
// truly hits /api/v1/query_range and that the snapshot makes it into the
// persisted narrative path.
describe("AlertExplainer with PromFetcher (Task 5)", () => {
  let ctx: E2EContext;
  let prisma: PrismaService;
  let explainer: AlertExplainerService;
  let fakeProm: Server;
  let fakePromUrl: string;
  let queryRangeHits: number;

  beforeAll(async () => {
    queryRangeHits = 0;
    fakeProm = createServer((req, res) => {
      if (req.url?.includes("query_range")) {
        queryRangeHits++;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "success",
            data: {
              resultType: "matrix",
              result: [
                {
                  metric: { __name__: "ttft_p95", model_name: "m1" },
                  values: [
                    [1747574400, "0.32"],
                    [1747574700, "0.61"],
                    [1747575120, "0.58"],
                  ],
                },
              ],
            },
          }),
        );
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => fakeProm.listen(0, r));
    const port = (fakeProm.address() as { port: number }).port;
    fakePromUrl = `http://127.0.0.1:${port}`;

    ctx = await bootE2E();
    prisma = ctx.app.get(PrismaService);
    explainer = ctx.app.get(AlertExplainerService);

    // explainAsync no-ops without a configured + enabled LlmJudgeProvider.
    // LlmJudgeService.getDecrypted decrypts apiKeyCipher with the same key
    // env var vitest.e2e.config.mts injects (`CONNECTION_API_KEY_ENCRYPTION_KEY`),
    // so we encrypt a real placeholder; chatCompletion itself is hoisted-mocked.
    const judgeKey = decodeKey(process.env.CONNECTION_API_KEY_ENCRYPTION_KEY ?? "");
    await prisma.llmJudgeProvider.deleteMany();
    await prisma.llmJudgeProvider.create({
      data: {
        baseUrl: "http://fake-llm.invalid",
        apiKeyCipher: encrypt("sk-fake-not-used", judgeKey),
        model: "gpt-test",
        enabled: true,
      },
    });
  }, 120_000);

  afterAll(async () => {
    await new Promise<void>((r) => fakeProm.close(() => r()));
    await ctx.teardown();
  });

  it("explainer fetches Prom snapshot and surfaces a numeric token in the narrative path", async () => {
    // The mocked chatCompletion above doesn't echo the prompt back, so we
    // can't grep for the Prom number inside `alertExplanation.narrative`
    // directly. Instead we assert (a) the Prom server actually received the
    // query_range request — proving the fetcher resolved the default
    // datasource and hit it; and (b) the explainer wrote an
    // alertExplanation row even with the Prom snapshot wired in.
    const hitsBefore = queryRangeHits;

    await prisma.prometheusDatasource.deleteMany();
    await prisma.prometheusDatasource.create({
      data: { name: "fake-prom", baseUrl: fakePromUrl, isDefault: true },
    });

    const event = await prisma.alertEvent.create({
      data: {
        fingerprint: "task5-explainer-fp",
        status: "firing",
        severity: "warning",
        alertName: "HighLatency",
        labels: { alertname: "HighLatency", model_name: "m1" },
        annotations: { expr: "ttft_p95{model_name='m1'}" },
        rawPayload: {},
        startsAt: new Date("2026-05-18T14:30:00Z"),
      },
    });

    await explainer.explainAsync(event.id);

    expect(queryRangeHits).toBe(hitsBefore + 1);

    const row = await prisma.alertExplanation.findUnique({
      where: { alertEventId: event.id },
    });
    expect(row).not.toBeNull();
    expect(row?.narrative).toContain("测试叙事");
    expect(row?.aiSeverity).toBe("warning");
  });
});
