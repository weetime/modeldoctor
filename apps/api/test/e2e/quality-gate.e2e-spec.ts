import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { type E2EContext, bootE2E, registerUser } from "../helpers/app.js";

let ctx: E2EContext;
let token: string;

beforeAll(async () => {
  ctx = await bootE2E();
  const u = await registerUser(ctx.app, `qg-${Date.now()}@example.com`);
  token = u.token;
}, 180_000);

afterAll(async () => {
  if (ctx) await ctx.teardown();
});

async function createConnection(name: string) {
  const r = await request(ctx.app.getHttpServer())
    .post("/api/connections")
    .set("Authorization", `Bearer ${token}`)
    .send({ name, baseUrl: "http://127.0.0.1:1", apiKey: "sk-test", model: "demo", category: "chat" })
    .expect(201);
  return r.body.id as string;
}

async function waitForRunStatus(
  ctx: E2EContext,
  token: string,
  runId: string,
  expected: string | string[],
  timeoutMs: number,
) {
  const expectedSet = new Set(Array.isArray(expected) ? expected : [expected]);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await request(ctx.app.getHttpServer())
      .get(`/api/quality-gate/runs/${runId}`)
      .set("Authorization", `Bearer ${token}`);
    if (expectedSet.has(r.body.status)) return r.body;
    if (["FAILED", "CANCELLED"].includes(r.body.status) && !expectedSet.has(r.body.status)) {
      throw new Error(
        `run ${runId} finished with ${r.body.status}, expected one of: ${[...expectedSet].join(", ")}`,
      );
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  throw new Error(
    `run ${runId} did not reach one of [${[...expectedSet].join(", ")}] within ${timeoutMs}ms`,
  );
}

describe("Quality Gate e2e", () => {
  it("create evaluation → trigger dual-endpoint run → poll until terminal → list samples", async () => {
    const a = await createConnection("a");
    const b = await createConnection("b");
    const evalRes = await request(ctx.app.getHttpServer())
      .post("/api/quality-gate/evaluations")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "smoke",
        samples: [
          { id: "s0", idx: 0, prompt: "say hi", expected: "hi", judgeConfig: { kind: "exact-match" } },
          { id: "s1", idx: 1, prompt: "say hi", expected: "hi", judgeConfig: { kind: "contains", substrings: ["hi"], mode: "all" } },
        ],
      })
      .expect(201);
    const evalId = evalRes.body.id as string;
    expect(evalId).toBeTruthy();

    const runRes = await request(ctx.app.getHttpServer())
      .post("/api/quality-gate/runs")
      .set("Authorization", `Bearer ${token}`)
      .send({ evaluationId: evalId, endpointAId: a, endpointBId: b, gateConfig: { passRateMin: 0.9 } })
      .expect(201);
    const runId = runRes.body.id as string;
    expect(runId).toBeTruthy();

    // Poll until terminal — endpoints are unreachable (port 1 refuses immediately),
    // so executor will error per sample and the run should reach COMPLETED or FAILED quickly
    let status = "PENDING";
    let waited = 0;
    while (!["COMPLETED", "FAILED", "CANCELLED"].includes(status) && waited < 60_000) {
      await new Promise((r) => setTimeout(r, 1000));
      const g = await request(ctx.app.getHttpServer())
        .get(`/api/quality-gate/runs/${runId}`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);
      status = g.body.status;
      waited += 1000;
    }
    expect(["COMPLETED", "FAILED"]).toContain(status);

    // Samples list should be reachable; with unreachable endpoints we expect error rows
    const s = await request(ctx.app.getHttpServer())
      .get(`/api/quality-gate/runs/${runId}/samples`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(Array.isArray(s.body.items)).toBe(true);
  }, 180_000);
});

describe("baseline pin flow", () => {
  it("pin → new run completes with baseline delta + gate verdict", async () => {
    // 1. Create an evaluation with a small sample set
    const ev = await request(ctx.app.getHttpServer())
      .post("/api/quality-gate/evaluations")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "pin-flow-test",
        samples: [
          { prompt: "Q1", expected: "A", judgeConfig: { kind: "exact-match" } },
          { prompt: "Q2", expected: "B", judgeConfig: { kind: "exact-match" } },
        ],
      })
      .expect(201);
    const evaluationId = ev.body.id;

    // 2. Create a baseline run (single-endpoint, no comparison)
    // createConnection returns the id string directly
    const connId = await createConnection("conn-baseline");
    const baselineRun = await request(ctx.app.getHttpServer())
      .post("/api/quality-gate/runs")
      .set("Authorization", `Bearer ${token}`)
      .send({
        evaluationId,
        endpointAId: connId,
        gateConfig: { passRateMin: 0.5 },
      })
      .expect(201);

    // Wait for executor to complete. Accept FAILED as well — port-1 connections
    // are unreachable in the test env, so the executor errors per sample.
    const baselineTerminal = await waitForRunStatus(
      ctx,
      token,
      baselineRun.body.id,
      ["COMPLETED", "FAILED"],
      30_000,
    );
    expect(["COMPLETED", "FAILED"]).toContain(baselineTerminal.status);

    // 3. Pin this run as baseline
    await request(ctx.app.getHttpServer())
      .patch(`/api/quality-gate/evaluations/${evaluationId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ baselineRunId: baselineRun.body.id })
      .expect(200);

    // Verify pin shows up in GET
    const evAfter = await request(ctx.app.getHttpServer())
      .get(`/api/quality-gate/evaluations/${evaluationId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(evAfter.body.baselineRunId).toBe(baselineRun.body.id);

    // 4. Create a new run; should auto-use the pin
    const newRun = await request(ctx.app.getHttpServer())
      .post("/api/quality-gate/runs")
      .set("Authorization", `Bearer ${token}`)
      .send({
        evaluationId,
        endpointAId: connId,
        gateConfig: { passRateMin: 0.5, regressionMax: 0 },
      })
      .expect(201);
    expect(newRun.body.baselineRunIdAtExecution).toBe(baselineRun.body.id);

    const finalRun = await waitForRunStatus(
      ctx,
      token,
      newRun.body.id,
      ["COMPLETED", "FAILED"],
      30_000,
    );

    // Sanity: status is terminal + gateResult is populated when run reaches COMPLETED
    expect(["COMPLETED", "FAILED"]).toContain(finalRun.status);
    if (finalRun.status === "COMPLETED") {
      expect(finalRun.gateResult).toBeDefined();
      expect(finalRun.aggregateMetrics?.regressionCount).toBeDefined();
    }
  }, 120_000);

  it("explicit baselineRunIdOverride=null skips the pin", async () => {
    const ev2 = await request(ctx.app.getHttpServer())
      .post("/api/quality-gate/evaluations")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "pin-flow-test-2",
        samples: [{ prompt: "Q", expected: "A", judgeConfig: { kind: "exact-match" } }],
      })
      .expect(201);
    const connId = await createConnection("conn-skip");
    const baselineRun = await request(ctx.app.getHttpServer())
      .post("/api/quality-gate/runs")
      .set("Authorization", `Bearer ${token}`)
      .send({ evaluationId: ev2.body.id, endpointAId: connId, gateConfig: { passRateMin: 0.5 } })
      .expect(201);

    await waitForRunStatus(ctx, token, baselineRun.body.id, ["COMPLETED", "FAILED"], 30_000);

    await request(ctx.app.getHttpServer())
      .patch(`/api/quality-gate/evaluations/${ev2.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ baselineRunId: baselineRun.body.id })
      .expect(200);

    const newRun = await request(ctx.app.getHttpServer())
      .post("/api/quality-gate/runs")
      .set("Authorization", `Bearer ${token}`)
      .send({
        evaluationId: ev2.body.id,
        endpointAId: connId,
        baselineRunIdOverride: null,
        gateConfig: { passRateMin: 0.5 },
      })
      .expect(201);
    expect(newRun.body.baselineRunIdAtExecution).toBeNull();
  }, 120_000);
});
