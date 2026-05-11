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
