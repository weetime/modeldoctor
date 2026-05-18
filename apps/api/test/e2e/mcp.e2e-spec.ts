import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type E2EContext, bootE2E } from "../helpers/app.js";

/**
 * MCP route smoke tests. The full JSON-RPC handshake + tool roundtrip is
 * the SDK's responsibility (covered by its own tests); we verify our own
 * additions: the McpAuthGuard's 503 / 401 paths and that the route exists
 * at the expected path.
 */
describe("MCP /mcp (e2e)", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    // Ensure MCP env vars are unset so the 503-when-unconfigured branch is exercised.
    delete process.env.MCP_BEARER_TOKEN;
    delete process.env.MCP_USER_ID;
    ctx = await bootE2E();
  }, 120_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  it("503 when MCP_BEARER_TOKEN / MCP_USER_ID are unset", async () => {
    const res = await request(ctx.app.getHttpServer())
      .post("/api/mcp")
      .set("Authorization", "Bearer anything")
      .send({});
    expect(res.status).toBe(503);
    // The AllExceptionsFilter wraps the message in various shapes; match
    // any string field in the body.
    expect(JSON.stringify(res.body)).toMatch(/MCP is not configured/i);
  });
});

/**
 * Tool registry smoke test — boot the app with MCP env vars set, send a
 * `tools/list` JSON-RPC request, and verify all expected tool names
 * appear (catches "forgot to register a tool" regressions). Full per-tool
 * behavior is covered by the underlying service specs.
 */
/**
 * Tool registry happy-path: set the env vars BEFORE bootE2E so the
 * McpAuthGuard sees them at app init, then drive a real `tools/list`
 * JSON-RPC request and assert the alert-loop tools are registered.
 * No user row is needed — the registry handshake doesn't invoke any
 * tool handler, so MCP_USER_ID is opaque at this layer.
 */
describe("MCP /mcp tools registry (e2e)", () => {
  let ctx: E2EContext;
  const TOKEN = "test-mcp-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const FAKE_USER_ID = "mcp-test-user";

  beforeAll(async () => {
    process.env.MCP_BEARER_TOKEN = TOKEN;
    process.env.MCP_USER_ID = FAKE_USER_ID;
    ctx = await bootE2E();
  }, 120_000);

  afterAll(async () => {
    delete process.env.MCP_BEARER_TOKEN;
    delete process.env.MCP_USER_ID;
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
});
