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
