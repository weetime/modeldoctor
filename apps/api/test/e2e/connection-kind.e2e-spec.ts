import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// SSRF guard mock so we can hit a non-resolvable hostname in the verify-kind
// probe without flaky DNS in CI.
vi.mock("../../src/modules/connection/discovery/ssrf-guard.js", () => ({
  assertSafeUrl: vi.fn(async (url: string) => ({
    safeUrl: new URL(url),
    resolvedIp: "10.0.0.1",
  })),
  PRIVATE_HOSTS: new Set<string>(),
}));

import request from "supertest";
import { PrismaService } from "../../src/database/prisma.service.js";
import { type E2EContext, bootE2E, registerUser } from "../helpers/app.js";

describe("Connection.kind e2e", () => {
  let ctx: E2EContext;
  let prisma: PrismaService;
  let token: string;

  beforeAll(async () => {
    ctx = await bootE2E();
    prisma = ctx.app.get(PrismaService);
    const u = await registerUser(ctx.app, "kind@example.com");
    token = u.token;
  }, 120_000);

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await ctx.teardown();
  });

  it("create kind=model still requires apiKey + model + category", async () => {
    await request(ctx.app.getHttpServer())
      .post("/api/connections")
      .set("Authorization", `Bearer ${token}`)
      .send({
        kind: "model",
        name: "model-bad",
        baseUrl: "http://x.test",
        // missing apiKey, model, category
      })
      .expect(400);
  });

  it("create kind=model succeeds with all required fields", async () => {
    const res = await request(ctx.app.getHttpServer())
      .post("/api/connections")
      .set("Authorization", `Bearer ${token}`)
      .send({
        kind: "model",
        name: "model-good",
        baseUrl: "http://x.test",
        apiKey: "sk-test",
        model: "qwen-test",
        category: "chat",
      })
      .expect(201);
    expect(res.body.kind).toBe("model");
    expect(res.body.model).toBe("qwen-test");
    expect(res.body.category).toBe("chat");
  });

  it("create kind=prometheus skips apiKey/model/category", async () => {
    const res = await request(ctx.app.getHttpServer())
      .post("/api/connections")
      .set("Authorization", `Bearer ${token}`)
      .send({
        kind: "prometheus",
        name: "prom-1",
        baseUrl: "http://prom.test:9090",
      })
      .expect(201);
    expect(res.body.kind).toBe("prometheus");
    expect(res.body.apiKeyPreview).toBe("");
    expect(res.body.model).toBe("");
    expect(res.body.category).toBeNull();
  });

  it("create kind=alertmanager works without apiKey/model/category", async () => {
    const res = await request(ctx.app.getHttpServer())
      .post("/api/connections")
      .set("Authorization", `Bearer ${token}`)
      .send({
        kind: "alertmanager",
        name: "am-1",
        baseUrl: "http://am.test:9093",
      })
      .expect(201);
    expect(res.body.kind).toBe("alertmanager");
  });

  it("create kind=gateway carries model/apiKey when supplied", async () => {
    const res = await request(ctx.app.getHttpServer())
      .post("/api/connections")
      .set("Authorization", `Bearer ${token}`)
      .send({
        kind: "gateway",
        name: "higress-1",
        baseUrl: "http://higress.test",
        apiKey: "gateway-key",
        model: "qwen3-32b-via-higress",
        category: "chat",
        serverKind: "higress",
      })
      .expect(201);
    expect(res.body.kind).toBe("gateway");
    expect(res.body.serverKind).toBe("higress");
  });

  it("legacy GET /api/connections still works (kind exposed on each row)", async () => {
    const res = await request(ctx.app.getHttpServer())
      .get("/api/connections")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    for (const row of res.body.items) {
      expect(row.kind).toBeDefined();
    }
  });

  it("POST /api/connections/verify-kind rejects kind=model", async () => {
    const res = await request(ctx.app.getHttpServer())
      .post("/api/connections/verify-kind")
      .set("Authorization", `Bearer ${token}`)
      .send({ kind: "model", baseUrl: "http://x.test" })
      .expect(201);
    expect(res.body.ok).toBe(false);
    expect(res.body.reason).toMatch(/non-model/);
  });

  it("verify-kind reports Prometheus version from buildinfo", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "success",
          data: { version: "2.51.0", revision: "abc123" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(ctx.app.getHttpServer())
      .post("/api/connections/verify-kind")
      .set("Authorization", `Bearer ${token}`)
      .send({ kind: "prometheus", baseUrl: "http://prom.test:9090" })
      .expect(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.version).toBe("2.51.0");
    expect(res.body.details).toMatchObject({ revision: "abc123" });
  });

  it("verify-kind reports Alertmanager version from /api/v2/status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          versionInfo: { version: "0.27.0" },
          cluster: { peers: [{ name: "peer-a" }] },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(ctx.app.getHttpServer())
      .post("/api/connections/verify-kind")
      .set("Authorization", `Bearer ${token}`)
      .send({ kind: "alertmanager", baseUrl: "http://am.test:9093" })
      .expect(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.version).toBe("0.27.0");
    expect(res.body.details).toMatchObject({ clusterPeers: 1 });
  });

  it("verify-kind returns ok=false when target shape is wrong", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ not: "prometheus shape" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(ctx.app.getHttpServer())
      .post("/api/connections/verify-kind")
      .set("Authorization", `Bearer ${token}`)
      .send({ kind: "prometheus", baseUrl: "http://prom.test:9090" })
      .expect(201);
    expect(res.body.ok).toBe(false);
    expect(res.body.reason).toMatch(/Prometheus shape/);
  });

  it("PATCH on kind=model rejects clearing model/category/apiKey even when kind is omitted", async () => {
    const created = await request(ctx.app.getHttpServer())
      .post("/api/connections")
      .set("Authorization", `Bearer ${token}`)
      .send({
        kind: "model",
        name: "patch-guard",
        baseUrl: "http://x.test",
        apiKey: "sk-orig",
        model: "qwen-orig",
        category: "chat",
      })
      .expect(201);

    // PATCH without `kind` — superRefine alone would let this through;
    // the service-layer invariant must reject it.
    await request(ctx.app.getHttpServer())
      .patch(`/api/connections/${created.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ model: "" })
      .expect(400);
    await request(ctx.app.getHttpServer())
      .patch(`/api/connections/${created.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ category: null })
      .expect(400);
    await request(ctx.app.getHttpServer())
      .patch(`/api/connections/${created.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ apiKey: "" })
      .expect(400);
  });

  it("verify-kind for gateway returns model count from /v1/models", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ id: "m1" }, { id: "m2" }, { id: "m3" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(ctx.app.getHttpServer())
      .post("/api/connections/verify-kind")
      .set("Authorization", `Bearer ${token}`)
      .send({ kind: "gateway", baseUrl: "http://higress.test" })
      .expect(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.details).toMatchObject({ modelCount: 3 });
  });
});
