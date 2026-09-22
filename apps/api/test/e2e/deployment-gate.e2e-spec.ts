import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AutomationRunnerService } from "../../src/modules/platform-source/automation/automation-runner.service.js";
import { bootE2E, type E2EContext, registerUser } from "../helpers/app.js";

let ctx: E2EContext;
let token: string;
let fake: Server;
let fakeUrl: string;
let backendParams = ["--max-num-seqs=256"];

function page(items: unknown[]) {
  return JSON.stringify({
    items,
    pagination: { page: 1, perPage: 100, total: items.length, totalPage: 1 },
  });
}

beforeAll(async () => {
  fake = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    res.setHeader("content-type", "application/json");
    if (url.pathname === "/v2/models" && url.searchParams.get("watch") === "true") {
      res.setHeader("content-type", "text/event-stream");
      res.write("\n\n"); // keep the connection open, never emit an event
      return;
    }
    if (url.pathname === "/v2/models") {
      return res.end(
        page([
          {
            id: 7,
            name: "qwen",
            categories: ["llm"],
            cluster_id: 1,
            replicas: 1,
            ready_replicas: 1,
            backend: "vLLM",
            backend_version: "0.10.1",
            backend_parameters: backendParams,
            source: "huggingface",
            huggingface_repo_id: "Qwen/Qwen3-8B",
          },
        ]),
      );
    }
    if (url.pathname === "/v2/model-routes") {
      return res.end(page([{ id: 1, name: "qwen", created_model_id: 7, targets: 1 }]));
    }
    if (url.pathname === "/v2/model-instances") {
      return res.end(
        page([
          {
            id: 9,
            model_id: 7,
            state: "running",
            worker_name: "w1",
            gpu_type: "A100",
            gpu_indexes: [0],
          },
        ]),
      );
    }
    // Real GPUStack convention: the OpenAI-compatible surface lives at the
    // server ROOT (`/v1/chat/completions`), not nested under a model route.
    if (url.pathname === "/v1/chat/completions") {
      return res.end(
        JSON.stringify({
          id: "x",
          object: "chat.completion",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "OK-TEXT-123" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        }),
      );
    }
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise<void>((resolve) => fake.listen(0, "127.0.0.1", () => resolve()));
  fakeUrl = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
  ctx = await bootE2E();
  token = (await registerUser(ctx.app, `gate-${Date.now()}@t.io`)).token;
}, 180_000);

afterAll(async () => {
  await ctx?.teardown();
  fake?.closeAllConnections();
  await new Promise<void>((resolve) => fake?.close(() => resolve()));
});

const auth = () => ({ Authorization: `Bearer ${token}` });

describe("deployment gate e2e", () => {
  let sourceId: string;
  let modelId: string;

  it("creates source and discovers the model with a host-root connection", async () => {
    const test = await request(ctx.app.getHttpServer())
      .post("/api/platform-sources/test")
      .set(auth())
      .send({ baseUrl: fakeUrl, apiKey: "k" });
    expect(test.body).toEqual({ ok: true, modelCount: 1, error: null });

    const created = await request(ctx.app.getHttpServer())
      .post("/api/platform-sources")
      .set(auth())
      .send({ name: "fake", baseUrl: fakeUrl, apiKey: "k" })
      .expect(201);
    sourceId = created.body.id;

    const sync = await request(ctx.app.getHttpServer())
      .post(`/api/platform-sources/${sourceId}/sync`)
      .set(auth())
      .expect(200);
    expect(sync.body.models).toBe(1);

    const list = await request(ctx.app.getHttpServer())
      .get("/api/discovered-models")
      .set(auth())
      .expect(200);
    expect(list.body).toHaveLength(1);
    modelId = list.body[0].id;
    expect(list.body[0]).toMatchObject({ name: "qwen", status: "new", routeName: "qwen" });
    expect(list.body[0].currentRevision).toMatchObject({
      backend: "vLLM",
      backendVersion: "0.10.1",
    });

    const conn = await request(ctx.app.getHttpServer())
      .get(`/api/connections/${list.body[0].connectionId}`)
      .set(auth())
      .expect(200);
    expect(conn.body).toMatchObject({ baseUrl: fakeUrl, model: "qwen" });
  });

  it("parameter change creates a new revision with diff", async () => {
    backendParams = ["--max-num-seqs=512"];
    await request(ctx.app.getHttpServer())
      .post(`/api/platform-sources/${sourceId}/sync`)
      .set(auth())
      .expect(200);
    const revs = await request(ctx.app.getHttpServer())
      .get(`/api/discovered-models/${modelId}/revisions`)
      .set(auth())
      .expect(200);
    expect(revs.body).toHaveLength(2);
    expect(revs.body[0].diff).toEqual([
      { field: "backend_parameters", before: ["--max-num-seqs=256"], after: ["--max-num-seqs=512"] },
    ]);
  });

  it("enabling diagnostics-only automation runs and passes", async () => {
    const upd = await request(ctx.app.getHttpServer())
      .patch(`/api/discovered-models/${modelId}`)
      .set(auth())
      .send({ automationEnabled: true, steps: ["diagnostics"] })
      .expect(200);
    expect(upd.body.automationEnabled).toBe(true);

    const runner = ctx.app.get(AutomationRunnerService);
    for (let i = 0; i < 5; i++) await runner.tick();

    const got = await request(ctx.app.getHttpServer())
      .get(`/api/discovered-models/${modelId}`)
      .set(auth())
      .expect(200);
    expect(got.body.lastRun).toMatchObject({
      trigger: "enable",
      status: "completed",
      verdict: "passed",
    });
    expect(got.body.lastRun.diagnosticsRunId).toBeTruthy();
  });
});
