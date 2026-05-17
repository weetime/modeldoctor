import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { PrismaService } from "../../src/database/prisma.service.js";
import { type E2EContext, bootE2E, registerUser } from "../helpers/app.js";

const TEST_SECRET = "alertmanager-test-secret-padded-to-32-chars-min";

describe("Alerts webhook e2e", () => {
  let ctx: E2EContext;
  let prisma: PrismaService;
  let token: string;

  beforeAll(async () => {
    process.env.ALERTMANAGER_WEBHOOK_SECRET = TEST_SECRET;
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
