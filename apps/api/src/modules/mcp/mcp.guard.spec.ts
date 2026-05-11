import {
  type ExecutionContext,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { describe, expect, it } from "vitest";
import { McpAuthGuard } from "./mcp.guard.js";

function mockCtx(authorization?: string): {
  ctx: ExecutionContext;
  req: { headers: Record<string, string | undefined>; mcpUserId?: string };
} {
  const req = { headers: { authorization }, mcpUserId: undefined as string | undefined };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { ctx, req };
}

function mockConfig(
  values: Record<string, string | undefined>,
): ConfigService<Record<string, unknown>, true> {
  return {
    get: (key: string) => values[key],
    // biome-ignore lint/suspicious/noExplicitAny: minimal mock
  } as any;
}

describe("McpAuthGuard", () => {
  const validToken = "a".repeat(40);
  const userId = "user-1";

  it("503 when MCP_BEARER_TOKEN is unset", () => {
    const guard = new McpAuthGuard(mockConfig({ MCP_USER_ID: userId }));
    const { ctx } = mockCtx("Bearer anything");
    expect(() => guard.canActivate(ctx)).toThrow(ServiceUnavailableException);
  });

  it("503 when MCP_USER_ID is unset", () => {
    const guard = new McpAuthGuard(mockConfig({ MCP_BEARER_TOKEN: validToken }));
    const { ctx } = mockCtx(`Bearer ${validToken}`);
    expect(() => guard.canActivate(ctx)).toThrow(ServiceUnavailableException);
  });

  it("401 when Authorization header is missing", () => {
    const guard = new McpAuthGuard(
      mockConfig({ MCP_BEARER_TOKEN: validToken, MCP_USER_ID: userId }),
    );
    const { ctx } = mockCtx(undefined);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it("401 when bearer token mismatches", () => {
    const guard = new McpAuthGuard(
      mockConfig({ MCP_BEARER_TOKEN: validToken, MCP_USER_ID: userId }),
    );
    const { ctx } = mockCtx("Bearer wrong-token");
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it("401 when bearer token same prefix but shorter (constant-time guard)", () => {
    const guard = new McpAuthGuard(
      mockConfig({ MCP_BEARER_TOKEN: validToken, MCP_USER_ID: userId }),
    );
    const { ctx } = mockCtx(`Bearer ${validToken.slice(0, -1)}`);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it("passes + stamps mcpUserId on correct bearer", () => {
    const guard = new McpAuthGuard(
      mockConfig({ MCP_BEARER_TOKEN: validToken, MCP_USER_ID: userId }),
    );
    const { ctx, req } = mockCtx(`Bearer ${validToken}`);
    expect(guard.canActivate(ctx)).toBe(true);
    expect(req.mcpUserId).toBe(userId);
  });
});
