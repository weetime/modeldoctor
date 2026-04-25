import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../../src/database/prisma.service.js";
import { type E2EContext, bootE2E, registerUser } from "../helpers/app.js";

describe("LoadTestRuns (e2e)", () => {
  let ctx: E2EContext;
  let adminToken: string;

  beforeAll(async () => {
    ctx = await bootE2E();

    // Register the first user — first user becomes admin (Task 5.6 logic)
    const registered = await registerUser(ctx.app, "admin@example.com", "Password1!");
    adminToken = registered.token;
  }, 120_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  it("returns an empty list when no runs exist", async () => {
    const res = await request(ctx.app.getHttpServer())
      .get("/api/load-test/runs")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.nextCursor).toBeNull();
  });

  it("inserts a row directly and lists it", async () => {
    const prisma = ctx.app.get(PrismaService);
    await prisma.loadTestRun.create({
      data: {
        apiType: "chat",
        apiUrl: "http://x",
        model: "m",
        rate: 1,
        duration: 1,
        status: "completed",
        summaryJson: {
          requests: 1,
          success: 1,
          throughput: 1,
          latencies: { mean: "1ms", p50: "1ms", p95: "1ms", p99: "1ms", max: "1ms" },
        },
        rawReport: "raw",
      },
    });
    const res = await request(ctx.app.getHttpServer())
      .get("/api/load-test/runs")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.items.length).toBe(1);
    expect(res.body.items[0].apiType).toBe("chat");
    expect(res.body.items[0].status).toBe("completed");
  });

  it("paginates with cursor", async () => {
    const prisma = ctx.app.get(PrismaService);
    // State carries over from the previous test within the same describe; seed 3 more rows
    for (let i = 0; i < 3; i++) {
      await prisma.loadTestRun.create({
        data: {
          apiType: "chat",
          apiUrl: `http://x/${i}`,
          model: "m",
          rate: 1,
          duration: 1,
          status: "completed",
          summaryJson: {},
          rawReport: "",
        },
      });
    }
    const first = await request(ctx.app.getHttpServer())
      .get("/api/load-test/runs?limit=2")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(first.body.items.length).toBe(2);
    expect(first.body.nextCursor).not.toBeNull();

    const second = await request(ctx.app.getHttpServer())
      .get(`/api/load-test/runs?limit=2&cursor=${first.body.nextCursor}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    // Total 4 rows (1 from previous it + 3 seeded here), limit=2 → exactly 2 on each page
    expect(second.body.items.length).toBe(2);
    // Pages must not overlap
    const firstIds = first.body.items.map((r: { id: string }) => r.id);
    const secondIds = second.body.items.map((r: { id: string }) => r.id);
    for (const id of secondIds) {
      expect(firstIds).not.toContain(id);
    }
  });

  it("non-admin users see only their own runs", async () => {
    const prisma = ctx.app.get(PrismaService);

    // Register a second user (role=user, not admin since admin is already taken)
    const user2Res = await request(ctx.app.getHttpServer())
      .post("/api/auth/register")
      .send({ email: "user2@example.com", password: "Password1!" });
    expect(user2Res.status).toBe(201);
    const user2Token = user2Res.body.accessToken as string;
    const user2Id = user2Res.body.user.id as string;

    // Seed a run owned by user2
    await prisma.loadTestRun.create({
      data: {
        userId: user2Id,
        apiType: "chat",
        apiUrl: "http://user2-run",
        model: "m",
        rate: 1,
        duration: 1,
        status: "completed",
        summaryJson: {},
        rawReport: "user2-raw",
      },
    });

    // user2 lists runs — should see only their own run
    const user2Runs = await request(ctx.app.getHttpServer())
      .get("/api/load-test/runs")
      .set("Authorization", `Bearer ${user2Token}`)
      .expect(200);
    expect(user2Runs.body.items.every((r: { userId: string }) => r.userId === user2Id)).toBe(true);

    // admin lists runs — should see all (including user2's run)
    const adminRuns = await request(ctx.app.getHttpServer())
      .get("/api/load-test/runs")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const adminRunIds = adminRuns.body.items.map((r: { apiUrl: string }) => r.apiUrl);
    expect(adminRunIds).toContain("http://user2-run");
    // admin sees more rows than user2 alone
    expect(adminRuns.body.items.length).toBeGreaterThan(user2Runs.body.items.length);
  });

  it("admin sees all runs across users", async () => {
    // Register a third user and get their token
    const user3Res = await request(ctx.app.getHttpServer())
      .post("/api/auth/register")
      .send({ email: "user3@example.com", password: "Password1!" });
    expect(user3Res.status).toBe(201);
    const user3Id = user3Res.body.user.id as string;

    const prisma = ctx.app.get(PrismaService);
    await prisma.loadTestRun.create({
      data: {
        userId: user3Id,
        apiType: "completions",
        apiUrl: "http://user3-run",
        model: "m",
        rate: 1,
        duration: 1,
        status: "completed",
        summaryJson: {},
        rawReport: "user3-raw",
      },
    });

    // admin should see this new run
    const adminRuns = await request(ctx.app.getHttpServer())
      .get("/api/load-test/runs")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const adminUrls = adminRuns.body.items.map((r: { apiUrl: string }) => r.apiUrl);
    expect(adminUrls).toContain("http://user3-run");
  });
});
