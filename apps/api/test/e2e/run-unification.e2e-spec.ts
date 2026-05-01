/**
 * Smoke spec: unified Run model end-to-end verification (Task 13).
 *
 * Exercises:
 *   - GET /api/runs  →  empty list
 *   - POST /api/e2e-test  →  persists a Run row (kind=e2e, tool=e2e)
 *   - GET /api/runs  →  list contains the e2e run
 *   - GET /api/runs?kind=e2e  →  filter works
 *   - Direct RunRepository insert (benchmark kind)  →  visible via GET /api/runs
 *   - GET /api/runs/:id  →  detail route returns the run
 */
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../../src/database/prisma.service.js";
import { RunRepository } from "../../src/modules/run/run.repository.js";
import { type E2EContext, bootE2E, registerUser } from "../helpers/app.js";

describe("Run Unification smoke (e2e)", () => {
  let ctx: E2EContext;
  let accessToken: string;
  let userId: string;

  beforeAll(async () => {
    ctx = await bootE2E();
    const registered = await registerUser(ctx.app, "smoke@example.com", "Password1!");
    accessToken = registered.token;
    userId = registered.user.id;
  }, 120_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  // ─── Step 1: /api/runs starts empty ────────────────────────────────────────

  it("GET /api/runs returns empty list initially", async () => {
    const res = await request(ctx.app.getHttpServer())
      .get("/api/runs")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.nextCursor).toBeNull();
  });

  it("GET /api/runs requires authentication", async () => {
    await request(ctx.app.getHttpServer()).get("/api/runs").expect(401);
  });

  // ─── Step 2: POST /api/e2e-test persists a Run row ─────────────────────────

  let e2eRunId: string;

  it("POST /api/e2e-test persists a Run row and returns runId", async () => {
    // The probe will fail (no real server) but the Run row is always persisted.
    const res = await request(ctx.app.getHttpServer())
      .post("/api/e2e-test")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        apiBaseUrl: "http://localhost:11111", // intentionally unreachable
        apiKey: "test-key",
        model: "test-model",
        probes: ["chat-text"],
      })
      .expect(200);

    expect(res.body.runId).toBeTruthy();
    expect(typeof res.body.runId).toBe("string");
    // success may be false (probe hit a dead server), but runId must be present
    expect(res.body).toHaveProperty("success");
    expect(Array.isArray(res.body.results)).toBe(true);
    e2eRunId = res.body.runId as string;
  }, 60_000);

  // ─── Step 3: GET /api/runs shows the e2e run ───────────────────────────────

  it("GET /api/runs shows the e2e run with kind=e2e and tool=e2e", async () => {
    const res = await request(ctx.app.getHttpServer())
      .get("/api/runs")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    const runs = res.body.items as Array<{ id: string; kind: string; tool: string }>;
    expect(runs.length).toBeGreaterThanOrEqual(1);
    const eRun = runs.find((r) => r.id === e2eRunId);
    expect(eRun).toBeDefined();
    expect(eRun!.kind).toBe("e2e");
    expect(eRun!.tool).toBe("e2e");
  });

  it("GET /api/runs?kind=e2e filters to only e2e runs", async () => {
    const res = await request(ctx.app.getHttpServer())
      .get("/api/runs?kind=e2e")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    const runs = res.body.items as Array<{ kind: string }>;
    expect(runs.length).toBeGreaterThanOrEqual(1);
    for (const r of runs) {
      expect(r.kind).toBe("e2e");
    }
  });

  // ─── Step 4: Direct benchmark Run insert visible via /api/runs ─────────────

  let benchmarkRunId: string;

  it("a benchmark Run inserted via RunRepository is visible in GET /api/runs", async () => {
    const repo = ctx.app.get(RunRepository);
    const prisma = ctx.app.get(PrismaService);

    // Seed a benchmark Run row directly (mimicking what BenchmarkService does)
    const row = await repo.create({
      userId,
      kind: "benchmark",
      tool: "guidellm",
      scenario: { model: "test-model", max_requests: 10 },
      mode: "fixed",
      driverKind: "local",
      params: { rate: 5 },
      name: "smoke-benchmark-run",
    });
    benchmarkRunId = row.id;

    // Manually mark it completed so we can verify status round-trips
    await prisma.run.update({
      where: { id: benchmarkRunId },
      data: { status: "completed", completedAt: new Date() },
    });

    const res = await request(ctx.app.getHttpServer())
      .get("/api/runs")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    const runs = res.body.items as Array<{ id: string; kind: string; tool: string; status: string }>;
    const bRun = runs.find((r) => r.id === benchmarkRunId);
    expect(bRun).toBeDefined();
    expect(bRun!.kind).toBe("benchmark");
    expect(bRun!.tool).toBe("guidellm");
    expect(bRun!.status).toBe("completed");
  });

  it("GET /api/runs?kind=benchmark returns the benchmark run", async () => {
    const res = await request(ctx.app.getHttpServer())
      .get("/api/runs?kind=benchmark")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    const runs = res.body.items as Array<{ id: string; kind: string }>;
    expect(runs.every((r) => r.kind === "benchmark")).toBe(true);
    const bRun = runs.find((r) => r.id === benchmarkRunId);
    expect(bRun).toBeDefined();
  });

  // ─── Step 5: GET /api/runs/:id detail route ─────────────────────────────────

  it("GET /api/runs/:id returns the run detail", async () => {
    const res = await request(ctx.app.getHttpServer())
      .get(`/api/runs/${benchmarkRunId}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.id).toBe(benchmarkRunId);
    expect(res.body.kind).toBe("benchmark");
    expect(res.body.tool).toBe("guidellm");
    expect(res.body.status).toBe("completed");
    expect(res.body.name).toBe("smoke-benchmark-run");
  });

  it("GET /api/runs/:id returns 404 for unknown id", async () => {
    await request(ctx.app.getHttpServer())
      .get("/api/runs/00000000-0000-0000-0000-000000000000")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(404);
  });

  // ─── Step 6: Both kinds visible without kind filter ─────────────────────────

  it("GET /api/runs (no filter) lists runs from both kinds", async () => {
    const res = await request(ctx.app.getHttpServer())
      .get("/api/runs")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    const runs = res.body.items as Array<{ kind: string }>;
    const kinds = new Set(runs.map((r) => r.kind));
    expect(kinds.has("e2e")).toBe(true);
    expect(kinds.has("benchmark")).toBe(true);
  });
});
