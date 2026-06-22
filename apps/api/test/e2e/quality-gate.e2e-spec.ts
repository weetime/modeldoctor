import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { bootE2E, type E2EContext, registerUser } from "../helpers/app.js";

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
    .send({
      name,
      baseUrl: "http://127.0.0.1:1",
      apiKey: "sk-test",
      model: "demo",
      category: "chat",
    })
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
          {
            id: "s0",
            idx: 0,
            prompt: "say hi",
            expected: "hi",
            judgeConfig: { kind: "exact-match" },
          },
          {
            id: "s1",
            idx: 1,
            prompt: "say hi",
            expected: "hi",
            judgeConfig: { kind: "contains", substrings: ["hi"], mode: "all" },
          },
        ],
      })
      .expect(201);
    const evalId = evalRes.body.id as string;
    expect(evalId).toBeTruthy();

    const runRes = await request(ctx.app.getHttpServer())
      .post("/api/quality-gate/runs")
      .set("Authorization", `Bearer ${token}`)
      .send({
        evaluationId: evalId,
        endpointAId: a,
        endpointBId: b,
        gateConfig: { passRateMin: 0.9 },
      })
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

describe("baseline (comparison run) flow", () => {
  it("explicit baselineRunIdOverride → new run completes with delta + gate verdict", async () => {
    // 1. Create an evaluation with a small sample set
    const ev = await request(ctx.app.getHttpServer())
      .post("/api/quality-gate/evaluations")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "comparison-run-flow-test",
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

    // 3. Create a NEW run with an explicit per-run baseline pick.
    // There is no longer a per-evaluation pin — every comparison is opt-in
    // at run-creation time via baselineRunIdOverride.
    const newRun = await request(ctx.app.getHttpServer())
      .post("/api/quality-gate/runs")
      .set("Authorization", `Bearer ${token}`)
      .send({
        evaluationId,
        endpointAId: connId,
        baselineRunIdOverride: baselineRun.body.id,
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

  it("no override → baselineRunIdAtExecution is null", async () => {
    const ev2 = await request(ctx.app.getHttpServer())
      .post("/api/quality-gate/evaluations")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "no-comparison-test",
        samples: [{ prompt: "Q", expected: "A", judgeConfig: { kind: "exact-match" } }],
      })
      .expect(201);
    const connId = await createConnection("conn-no-comparison");
    const run = await request(ctx.app.getHttpServer())
      .post("/api/quality-gate/runs")
      .set("Authorization", `Bearer ${token}`)
      .send({
        evaluationId: ev2.body.id,
        endpointAId: connId,
        gateConfig: { passRateMin: 0.5 },
      })
      .expect(201);
    expect(run.body.baselineRunIdAtExecution).toBeNull();
  }, 60_000);
});

describe("LLM judge guard at run creation", () => {
  // LLM judge providers are rows in llm_judge_providers. The run-creation guard
  // keys off getDecrypted() — the *default* provider — so "enabled" here means
  // "an enabled default exists" and "disabled" means "no enabled default"
  // (a provider may exist but not be the default). Each test sets the desired
  // state via the /api/llm-judge/providers REST endpoints.

  afterEach(() => deleteProvider());

  async function deleteProvider() {
    // Wipe every provider so tests are independent of ordering. Tolerate errors.
    try {
      const list = await request(ctx.app.getHttpServer())
        .get("/api/llm-judge/providers")
        .set("Authorization", `Bearer ${token}`);
      for (const p of (list.body.items ?? []) as Array<{ id: string }>) {
        await request(ctx.app.getHttpServer())
          .delete(`/api/llm-judge/providers/${p.id}`)
          .set("Authorization", `Bearer ${token}`);
      }
    } catch {
      // ignore
    }
  }

  async function upsertProvider(opts: { enabled: boolean }) {
    // enabled → register as the default (default is always enabled).
    // disabled → register a non-default provider so no enabled default exists.
    await request(ctx.app.getHttpServer())
      .post("/api/llm-judge/providers")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: `judge-guard-${opts.enabled ? "on" : "off"}`,
        baseUrl: "https://judge.example/v1",
        apiKey: "sk-test",
        model: "judge-model",
        enabled: opts.enabled,
        isDefault: opts.enabled,
      })
      .expect(201);
  }

  async function createLlmJudgeEval(name: string) {
    const r = await request(ctx.app.getHttpServer())
      .post("/api/quality-gate/evaluations")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name,
        samples: [
          {
            id: "s0",
            idx: 0,
            prompt: "summarise: the sky is blue",
            expected: "blue sky",
            judgeConfig: {
              kind: "llm-judge",
              rubric:
                "Score 1 if the summary mentions blue and sky, otherwise 0.",
              scale: "pass-fail",
            },
          },
        ],
      })
      .expect(201);
    return r.body.id as string;
  }

  async function createExactMatchEval(name: string) {
    const r = await request(ctx.app.getHttpServer())
      .post("/api/quality-gate/evaluations")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name,
        samples: [
          {
            id: "s0",
            idx: 0,
            prompt: "echo hi",
            expected: "hi",
            judgeConfig: { kind: "exact-match" },
          },
        ],
      })
      .expect(201);
    return r.body.id as string;
  }

  it("rejects with 400 when eval has llm-judge samples and no provider configured", async () => {
    await deleteProvider();
    const evalId = await createLlmJudgeEval("guard-no-provider");
    const conn = await createConnection("guard-target-1");

    const r = await request(ctx.app.getHttpServer())
      .post("/api/quality-gate/runs")
      .set("Authorization", `Bearer ${token}`)
      .send({
        evaluationId: evalId,
        endpointAId: conn,
        gateConfig: { passRateMin: 0.9 },
      })
      .expect(400);

    expect(String(r.body.message ?? r.text)).toMatch(
      /No enabled LLM judge provider/i,
    );
  }, 60_000);

  it("rejects with 400 when provider exists but enabled=false", async () => {
    await upsertProvider({ enabled: false });
    const evalId = await createLlmJudgeEval("guard-disabled-provider");
    const conn = await createConnection("guard-target-2");

    const r = await request(ctx.app.getHttpServer())
      .post("/api/quality-gate/runs")
      .set("Authorization", `Bearer ${token}`)
      .send({
        evaluationId: evalId,
        endpointAId: conn,
        gateConfig: { passRateMin: 0.9 },
      })
      .expect(400);

    expect(String(r.body.message ?? r.text)).toMatch(
      /No enabled LLM judge provider/i,
    );
  }, 60_000);

  it("succeeds when llm-judge eval has an enabled provider", async () => {
    await upsertProvider({ enabled: true });
    const evalId = await createLlmJudgeEval("guard-happy-path");
    const conn = await createConnection("guard-target-3");

    const r = await request(ctx.app.getHttpServer())
      .post("/api/quality-gate/runs")
      .set("Authorization", `Bearer ${token}`)
      .send({
        evaluationId: evalId,
        endpointAId: conn,
        gateConfig: { passRateMin: 0.9 },
      })
      .expect(201);

    expect(r.body.id).toBeTruthy();
    expect(["PENDING", "RUNNING", "COMPLETED", "FAILED"]).toContain(
      r.body.status,
    );
  }, 60_000);

  it("succeeds when eval has only non-llm-judge samples even without provider", async () => {
    await deleteProvider();
    const evalId = await createExactMatchEval("guard-no-llm-judge-needed");
    const conn = await createConnection("guard-target-4");

    const r = await request(ctx.app.getHttpServer())
      .post("/api/quality-gate/runs")
      .set("Authorization", `Bearer ${token}`)
      .send({
        evaluationId: evalId,
        endpointAId: conn,
        gateConfig: { passRateMin: 0.9 },
      })
      .expect(201);

    expect(r.body.id).toBeTruthy();
  }, 60_000);
});
