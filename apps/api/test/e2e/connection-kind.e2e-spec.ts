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

  it("create kind=alertmanager is rejected (kind retired in #218)", async () => {
    const res = await request(ctx.app.getHttpServer())
      .post("/api/connections")
      .set("Authorization", `Bearer ${token}`)
      .send({
        kind: "alertmanager",
        name: "am-1",
        baseUrl: "http://am.test:9093",
      })
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
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

  it("verify-kind with kind=alertmanager is rejected by the validation pipe (#218)", async () => {
    const res = await request(ctx.app.getHttpServer())
      .post("/api/connections/verify-kind")
      .set("Authorization", `Bearer ${token}`)
      .send({ kind: "alertmanager", baseUrl: "http://am.test:9093" })
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
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

  // ---------------------------------------------------------------------------
  // Connection × PrometheusDatasource three-state binding (Task 4)
  //
  // `token` belongs to the first registered user → admin (auth.service:
  // `total === 0 → roles=["admin"]`), so we reuse it for both datasource
  // CRUD (admin-gated) and connection CRUD (user-allowed).
  // ---------------------------------------------------------------------------
  describe("connection × prometheusDatasourceId", () => {
    let datasourceId: string;

    beforeAll(async () => {
      // Make sure no prior test left a default datasource sitting around;
      // these cases assert auto-fill behavior precisely.
      await prisma.prometheusDatasource.deleteMany();
      const r = await request(ctx.app.getHttpServer())
        .post("/api/prometheus-datasources")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "default", baseUrl: "https://prom.example.com", isDefault: true })
        .expect(201);
      datasourceId = r.body.id;
    });

    afterAll(async () => {
      // Symmetric cleanup — without this the default datasource leaks into
      // any e2e file run sequentially after this one (vitest runs e2e files
      // one at a time but shares the DB), and would also auto-fill onto
      // any further connection created later in this describe. FK is
      // ON DELETE SET NULL on Connection.prometheusDatasourceId, but
      // dropping the referencing rows first keeps the log free of orphan
      // chatter if the FK ever tightens to RESTRICT.
      //
      // Guard against beforeAll failing before datasourceId is assigned —
      // vitest still runs afterAll on beforeAll failure, and Prisma silently
      // ignores `where: { x: undefined }`, which would otherwise drop EVERY
      // connection in the test DB and confuse debugging across e2e files.
      if (!datasourceId) return;
      await prisma.connection.deleteMany({ where: { prometheusDatasourceId: datasourceId } });
      await prisma.prometheusDatasource.deleteMany();
    });

    it("POST /connections (kind=model, no prometheusDatasourceId) auto-fills default", async () => {
      const r = await request(ctx.app.getHttpServer())
        .post("/api/connections")
        .set("Authorization", `Bearer ${token}`)
        .send({
          kind: "model",
          name: "auto-fill",
          baseUrl: "https://m.example.com",
          apiKey: "sk-abc",
          model: "gpt-4",
          category: "chat",
        })
        .expect(201);
      expect(r.body.prometheusDatasourceId).toBe(datasourceId);
      expect(r.body.prometheusDatasource).toMatchObject({
        id: datasourceId,
        name: "default",
      });
    });

    it("POST /connections with explicit null preserves null even when a default exists", async () => {
      const r = await request(ctx.app.getHttpServer())
        .post("/api/connections")
        .set("Authorization", `Bearer ${token}`)
        .send({
          kind: "gateway",
          name: "g-no-source",
          baseUrl: "https://g.example.com",
          prometheusDatasourceId: null,
        })
        .expect(201);
      expect(r.body.prometheusDatasourceId).toBeNull();
      expect(r.body.prometheusDatasource).toBeNull();
    });

    it("POST /connections with explicit non-existent id → 400 PROMETHEUS_DATASOURCE_NOT_FOUND", async () => {
      const r = await request(ctx.app.getHttpServer())
        .post("/api/connections")
        .set("Authorization", `Bearer ${token}`)
        .send({
          kind: "gateway",
          name: "g-bad-ds",
          baseUrl: "https://g-bad.example.com",
          prometheusDatasourceId: "ds_does_not_exist",
        })
        .expect(400);
      expect(r.body.error.code).toBe("PROMETHEUS_DATASOURCE_NOT_FOUND");
    });
  });
});
