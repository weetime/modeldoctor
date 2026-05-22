import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../../src/database/prisma.service.js";
import { bootE2E, type E2EContext, registerUser } from "../helpers/app.js";

// Originally "Connection.kind e2e", scoped to enum behavior around model /
// gateway / alertmanager kinds. After #220 retired the `Connection.kind`
// field entirely (every Connection is a model endpoint; the gateway
// distinction lives in `serverKind`), this file shrank to the
// model-endpoint required-field guards + the PrometheusDatasource
// three-state binding. The filename is kept for git-history continuity.
describe("Connection e2e (model-endpoint contract + PrometheusDatasource binding)", () => {
  let ctx: E2EContext;
  let prisma: PrismaService;
  let token: string;

  beforeAll(async () => {
    ctx = await bootE2E();
    prisma = ctx.app.get(PrismaService);
    const u = await registerUser(ctx.app, "kind@example.com");
    token = u.token;
  }, 120_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  it("create still requires apiKey + model + category", async () => {
    await request(ctx.app.getHttpServer())
      .post("/api/connections")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "missing-fields",
        baseUrl: "http://x.test",
        // missing apiKey, model, category
      })
      .expect(400);
  });

  it("create succeeds with all required fields", async () => {
    const res = await request(ctx.app.getHttpServer())
      .post("/api/connections")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "model-good",
        baseUrl: "http://x.test",
        apiKey: "sk-test",
        model: "qwen-test",
        category: "chat",
      })
      .expect(201);
    expect(res.body.model).toBe("qwen-test");
    expect(res.body.category).toBe("chat");
  });

  it("create with extraneous kind field is silently accepted (zod strips unknown keys)", async () => {
    // Defensive: clients on old contracts may still POST `kind:"model"`.
    // zod's default behavior strips unknown keys at parse time, so the
    // request succeeds without the field ever reaching the DB.
    const res = await request(ctx.app.getHttpServer())
      .post("/api/connections")
      .set("Authorization", `Bearer ${token}`)
      .send({
        kind: "model",
        name: "ignores-kind",
        baseUrl: "http://x.test",
        apiKey: "sk-test",
        model: "qwen-test",
        category: "chat",
      })
      .expect(201);
    expect(res.body).not.toHaveProperty("kind");
  });

  it("create gateway-fronted connection works (engine serverKind + gateway-routing headers + 'higress' tag)", async () => {
    // Gateways (Higress / istio-envoy / envoy) are NOT engines — serverKind
    // accepts only real inference engines (vllm/sglang/tgi/mindie/lmdeploy)
    // or 'generic'. Gateway presence surfaces as a free-form tag instead;
    // this test pins the shape to make sure that contract stays intact.
    const res = await request(ctx.app.getHttpServer())
      .post("/api/connections")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "higress-fronted-vllm",
        baseUrl: "http://higress.test",
        apiKey: "gateway-key",
        model: "qwen3-32b-via-higress",
        category: "chat",
        serverKind: "vllm",
        customHeaders: "x-higress-llm-model: qwen3-32b",
        tags: ["higress"],
      })
      .expect(201);
    expect(res.body.serverKind).toBe("vllm");
    expect(res.body.tags).toContain("higress");
    expect(res.body.customHeaders).toContain("x-higress-llm-model");
  });

  it("GET /api/connections returns rows without a `kind` field", async () => {
    const res = await request(ctx.app.getHttpServer())
      .get("/api/connections")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    for (const row of res.body.items) {
      expect(row).not.toHaveProperty("kind");
    }
  });

  it("PATCH rejects clearing required fields", async () => {
    const created = await request(ctx.app.getHttpServer())
      .post("/api/connections")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "patch-guard",
        baseUrl: "http://x.test",
        apiKey: "sk-orig",
        model: "qwen-orig",
        category: "chat",
      })
      .expect(201);

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

  // ---------------------------------------------------------------------------
  // Connection × PrometheusDatasource three-state binding.
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
      if (!datasourceId) return;
      await prisma.connection.deleteMany({ where: { prometheusDatasourceId: datasourceId } });
      await prisma.prometheusDatasource.deleteMany();
    });

    it("POST /connections (no prometheusDatasourceId) auto-fills default", async () => {
      const r = await request(ctx.app.getHttpServer())
        .post("/api/connections")
        .set("Authorization", `Bearer ${token}`)
        .send({
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
          name: "no-source",
          baseUrl: "https://g.example.com",
          apiKey: "sk-abc",
          model: "gpt-4",
          category: "chat",
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
          name: "bad-ds",
          baseUrl: "https://g-bad.example.com",
          apiKey: "sk-abc",
          model: "gpt-4",
          category: "chat",
          prometheusDatasourceId: "ds_does_not_exist",
        })
        .expect(400);
      expect(r.body.error.code).toBe("PROMETHEUS_DATASOURCE_NOT_FOUND");
    });
  });
});
