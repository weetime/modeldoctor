import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../../src/database/prisma.service.js";
import { type E2EContext, bootE2E, registerUser } from "../helpers/app.js";

/**
 * Minimum valid config for scenario=inference + tool=guidellm.
 * The inference scenario merges `rateType` (required enum) into the base
 * guidellm schema; `profile`, `apiType`, `datasetName` are required base fields.
 * Using datasetName="sharegpt" avoids the extra datasetInputTokens requirement.
 */
const VALID_GUIDELLM_CONFIG = {
  profile: "throughput",
  apiType: "chat",
  datasetName: "sharegpt",
  rateType: "constant",
} as const;

describe("BenchmarkTemplate (e2e)", () => {
  let ctx: E2EContext;
  let adminToken: string;
  let userToken: string;
  let adminId: string;
  let userId: string;

  beforeAll(async () => {
    ctx = await bootE2E();
    // Wipe so the first registration becomes the admin (per the
    // auth-bootstrap rule: first user gets ["admin"] role).
    // Delete in reverse FK order to avoid constraint violations:
    // Baseline.benchmarkId has onDelete: Restrict, so baselines must go first.
    const prisma = ctx.app.get(PrismaService);
    await prisma.baseline.deleteMany();
    await prisma.benchmark.deleteMany();
    await prisma.benchmarkTemplate.deleteMany();
    await prisma.diagnosticsRun.deleteMany();
    await prisma.connection.deleteMany();
    await prisma.user.deleteMany();

    const admin = await registerUser(ctx.app, "admin@example.com", "Password1!");
    adminToken = admin.token;
    adminId = admin.user.id;
    expect(admin.user.roles).toContain("admin");

    const user = await registerUser(ctx.app, "user@example.com", "Password1!");
    userToken = user.token;
    userId = user.user.id;
    expect(user.user.roles).not.toContain("admin");
  }, 120_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  it("admin can create an official template", async () => {
    const res = await request(ctx.app.getHttpServer())
      .post("/api/benchmark-templates")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Inference baseline",
        scenario: "inference",
        tool: "guidellm",
        config: VALID_GUIDELLM_CONFIG,
        isOfficial: true,
        tags: ["baseline"],
      });
    expect(res.status).toBe(201);
    expect(res.body.isOfficial).toBe(true);
    expect(res.body.createdBy).toBe(adminId);
  });

  it("non-admin gets 403 attempting isOfficial=true", async () => {
    const res = await request(ctx.app.getHttpServer())
      .post("/api/benchmark-templates")
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        name: "fake official",
        scenario: "inference",
        tool: "guidellm",
        config: VALID_GUIDELLM_CONFIG,
        isOfficial: true,
        tags: [],
      });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("BENCHMARK_TEMPLATE_OFFICIAL_FORBIDDEN");
  });

  it("non-admin can create a personal template", async () => {
    const res = await request(ctx.app.getHttpServer())
      .post("/api/benchmark-templates")
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        name: "My personal config",
        scenario: "inference",
        tool: "guidellm",
        config: VALID_GUIDELLM_CONFIG,
        isOfficial: false,
        tags: ["personal"],
      });
    expect(res.status).toBe(201);
    expect(res.body.isOfficial).toBe(false);
    expect(res.body.createdBy).toBe(userId);
  });

  it("any authenticated user can list — official first", async () => {
    const res = await request(ctx.app.getHttpServer())
      .get("/api/benchmark-templates?scenario=inference")
      .set("Authorization", `Bearer ${userToken}`);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(2);
    expect(res.body.items[0].isOfficial).toBe(true);
  });

  it("non-owner non-admin cannot edit a foreign template", async () => {
    // Find admin's official template
    const list = await request(ctx.app.getHttpServer())
      .get("/api/benchmark-templates?isOfficial=true")
      .set("Authorization", `Bearer ${userToken}`);
    const officialId = list.body.items[0].id;

    const res = await request(ctx.app.getHttpServer())
      .patch(`/api/benchmark-templates/${officialId}`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({ name: "hijacked" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("BENCHMARK_TEMPLATE_FORBIDDEN");
  });

  it("PATCH strips isOfficial/scenario/tool from body", async () => {
    const list = await request(ctx.app.getHttpServer())
      .get("/api/benchmark-templates?isOfficial=false")
      .set("Authorization", `Bearer ${userToken}`);
    const personalId = list.body.items.find(
      (t: { createdBy: string }) => t.createdBy === userId,
    ).id;

    const res = await request(ctx.app.getHttpServer())
      .patch(`/api/benchmark-templates/${personalId}`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        name: "renamed",
        // These three should be silently stripped by the schema
        isOfficial: true,
        scenario: "capacity",
        tool: "vegeta",
      });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("renamed");
    expect(res.body.isOfficial).toBe(false); // unchanged
    expect(res.body.scenario).toBe("inference"); // unchanged
    expect(res.body.tool).toBe("guidellm"); // unchanged
  });

  it("owner can delete their template", async () => {
    const created = await request(ctx.app.getHttpServer())
      .post("/api/benchmark-templates")
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        name: "doomed",
        scenario: "inference",
        tool: "guidellm",
        config: VALID_GUIDELLM_CONFIG,
        isOfficial: false,
        tags: [],
      });
    const res = await request(ctx.app.getHttpServer())
      .delete(`/api/benchmark-templates/${created.body.id}`)
      .set("Authorization", `Bearer ${userToken}`);
    expect(res.status).toBe(204);

    const after = await request(ctx.app.getHttpServer())
      .get(`/api/benchmark-templates/${created.body.id}`)
      .set("Authorization", `Bearer ${userToken}`);
    expect(after.status).toBe(404);
  });

  it("(scenario, tool) mismatch surfaces a 400 with explicit code", async () => {
    const res = await request(ctx.app.getHttpServer())
      .post("/api/benchmark-templates")
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        name: "bad pair",
        scenario: "gateway",
        tool: "guidellm", // gateway only supports vegeta
        config: {},
        isOfficial: false,
        tags: [],
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BENCHMARK_TEMPLATE_SCENARIO_TOOL_MISMATCH");
  });
});
