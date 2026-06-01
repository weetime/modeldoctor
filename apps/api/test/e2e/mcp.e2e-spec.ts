import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootE2E, type E2EContext } from "../helpers/app.js";
import { E2E_ENV_DEFAULTS } from "../setup/e2e-env-defaults.js";

/**
 * MCP route smoke tests. The full JSON-RPC handshake + tool roundtrip is the
 * SDK's responsibility (covered by its own tests); we verify our own additions:
 * that all expected tools are registered and exposed at the configured path.
 *
 * The McpAuthGuard's 503-when-unset and 401 bearer-mismatch branches are
 * unit-tested in apps/api/src/modules/mcp/mcp.guard.spec.ts — no need to
 * re-assert them through the HTTP layer (and doing so would force the brittle
 * `delete process.env.MCP_*` carve-out we deliberately removed).
 *
 * MCP_BEARER_TOKEN / MCP_USER_ID come from E2E_ENV_DEFAULTS so the Bearer the
 * test sends matches the value ConfigService loaded at app boot. Mutating
 * process.env in beforeAll is the anti-pattern E2E_ENV_DEFAULTS exists to
 * prevent (see that file's docstring for the alerts 401 backstory).
 */
describe("MCP /mcp tools registry (e2e)", () => {
  let ctx: E2EContext;
  const TOKEN = E2E_ENV_DEFAULTS.MCP_BEARER_TOKEN;

  beforeAll(async () => {
    ctx = await bootE2E();
  }, 120_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  it("tools/list exposes the alert-loop tools (list_alerts / get_alert_explanation / subscribe_connection)", async () => {
    const res = await request(ctx.app.getHttpServer())
      .post("/api/mcp")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("Accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", method: "tools/list", id: 1, params: {} })
      .buffer(true);

    // StreamableHTTPServerTransport responds as SSE; supertest captures
    // the raw body in res.text. Pluck the first `data:` line and parse.
    const raw = (res.text ?? "").toString();
    const m = raw.match(/^data:\s*(\{.*\})\s*$/m);
    expect(m).not.toBeNull();
    const json = JSON.parse(m?.[1] ?? "{}") as {
      result?: { tools?: Array<{ name: string }> };
    };
    const names = (json.result?.tools ?? []).map((t) => t.name);
    expect(names).toContain("list_alerts");
    expect(names).toContain("get_alert_explanation");
    expect(names).toContain("subscribe_connection");
  });

  it("tools/list includes the new actuation tools", async () => {
    const res = await request(ctx.app.getHttpServer())
      .post("/api/mcp")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("Accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", method: "tools/list", id: 1, params: {} })
      .buffer(true);
    const raw = (res.text ?? "").toString();
    const m = raw.match(/^data:\s*(\{.*\})\s*$/m);
    const json = JSON.parse(m?.[1] ?? "{}") as { result?: { tools?: Array<{ name: string }> } };
    const names = (json.result?.tools ?? []).map((t) => t.name);
    // read tools always present
    expect(names).toContain("query_prometheus");
    expect(names).toContain("get_engine_metric_catalog");
    expect(names).toContain("compare_benchmarks");
    expect(names).toContain("get_benchmark");
    expect(names).toContain("get_quality_gate_run");
    // execute tools present because .env.test leaves MCP_ALLOW_EXECUTE at its
    // default (true)
    expect(names).toContain("run_benchmark");
    expect(names).toContain("run_quality_gate");
  });

  it("run_benchmark dry-run returns a confirmToken without creating a Job", async () => {
    const res = await request(ctx.app.getHttpServer())
      .post("/api/mcp")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        method: "tools/call",
        id: 2,
        params: {
          name: "run_benchmark",
          arguments: {
            scenario: "inference",
            tool: "guidellm",
            connectionId: "does-not-need-to-exist-for-dry-run",
            name: "e2e dry-run",
            params: {},
          },
        },
      })
      .buffer(true);
    const raw = (res.text ?? "").toString();
    const m = raw.match(/^data:\s*(\{.*\})\s*$/m);
    const json = JSON.parse(m?.[1] ?? "{}") as {
      result?: { structuredContent?: { dryRun?: boolean; confirmToken?: string } };
    };
    expect(json.result?.structuredContent?.dryRun).toBe(true);
    expect(typeof json.result?.structuredContent?.confirmToken).toBe("string");
  });
});
