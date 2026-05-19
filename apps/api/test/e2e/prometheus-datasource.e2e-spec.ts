import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../../src/database/prisma.service.js";
import { type E2EContext, bootE2E, registerUser } from "../helpers/app.js";

describe("PrometheusDatasource e2e", () => {
  let ctx: E2EContext;
  let prisma: PrismaService;
  let adminToken: string;
  let userToken: string;

  beforeAll(async () => {
    ctx = await bootE2E();
    prisma = ctx.app.get(PrismaService);
    // First user registered becomes admin by auth.service.ts convention
    // (`total === 0 → ["admin"]`); subsequent users default to ["user"].
    const admin = await registerUser(ctx.app, "ds-admin@example.com");
    const normal = await registerUser(ctx.app, "ds-user@example.com");
    adminToken = admin.token;
    userToken = normal.token;
  }, 120_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  it("GET list is empty for fresh DB", async () => {
    const res = await request(ctx.app.getHttpServer())
      .get("/api/prometheus-datasources")
      .set("Authorization", `Bearer ${userToken}`)
      .expect(200);
    expect(res.body.items).toEqual([]);
  });

  it("POST requires admin", async () => {
    await request(ctx.app.getHttpServer())
      .post("/api/prometheus-datasources")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ name: "p1", baseUrl: "https://p1.example.com" })
      .expect(403);
  });

  it("admin can create + list + set-default + delete", async () => {
    const createRes = await request(ctx.app.getHttpServer())
      .post("/api/prometheus-datasources")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "p1",
        baseUrl: "https://p1.example.com",
        bearerToken: "tok-long-enough-for-preview",
      })
      .expect(201);
    expect(createRes.body.id).toBeTruthy();
    expect(createRes.body.bearerToken).toBe("tok-long-enough-for-preview");

    const id = createRes.body.id as string;

    const listRes = await request(ctx.app.getHttpServer())
      .get("/api/prometheus-datasources")
      .set("Authorization", `Bearer ${userToken}`)
      .expect(200);
    expect(listRes.body.items).toHaveLength(1);
    // bearerToken (plaintext) MUST NOT appear in list responses; only the
    // create / update / rotate paths echo it once.
    expect(listRes.body.items[0].bearerToken).toBeUndefined();
    expect(listRes.body.items[0].bearerPreview).toContain("...");

    await request(ctx.app.getHttpServer())
      .post(`/api/prometheus-datasources/${id}/set-default`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(201);

    const deleteRes = await request(ctx.app.getHttpServer())
      .delete(`/api/prometheus-datasources/${id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(deleteRes.body.consumersDetached).toBe(0);

    // Cleanup verified via list
    const after = await request(ctx.app.getHttpServer())
      .get("/api/prometheus-datasources")
      .set("Authorization", `Bearer ${userToken}`)
      .expect(200);
    expect(after.body.items).toEqual([]);
  });

  it("rejects duplicate name with 409 PROMETHEUS_DATASOURCE_NAME_TAKEN", async () => {
    await prisma.prometheusDatasource.deleteMany();

    await request(ctx.app.getHttpServer())
      .post("/api/prometheus-datasources")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "dupe", baseUrl: "https://a.example.com" })
      .expect(201);

    const r = await request(ctx.app.getHttpServer())
      .post("/api/prometheus-datasources")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "dupe", baseUrl: "https://b.example.com" })
      .expect(409);
    // AllExceptionsFilter wraps domain errors as { error: { code, message, ... } }
    expect(r.body.error.code).toBe("PROMETHEUS_DATASOURCE_NAME_TAKEN");
  });

  it("rejects duplicate baseUrl with 409 PROMETHEUS_DATASOURCE_BASEURL_TAKEN", async () => {
    // Self-contained setup: start from a clean table, seed the colliding row,
    // then attempt a second create on the same baseUrl. Independent of any
    // ordering relative to the duplicate-name test above.
    await prisma.prometheusDatasource.deleteMany();

    await request(ctx.app.getHttpServer())
      .post("/api/prometheus-datasources")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "p-baseurl-base", baseUrl: "https://baseurl-collide.example.com" })
      .expect(201);

    const r = await request(ctx.app.getHttpServer())
      .post("/api/prometheus-datasources")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "p-baseurl-collide", baseUrl: "https://baseurl-collide.example.com" })
      .expect(409);
    expect(r.body.error.code).toBe("PROMETHEUS_DATASOURCE_BASEURL_TAKEN");
  });
});
