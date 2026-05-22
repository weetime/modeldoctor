import { createHash, timingSafeEqual } from "node:crypto";
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request } from "express";
import type { Env } from "../../config/env.schema.js";

/**
 * Gate for `/mcp` routes. Requires BOTH `MCP_BEARER_TOKEN` and `MCP_USER_ID`
 * to be set in env; if either is missing the route is disabled (503). When
 * enabled, validates `Authorization: Bearer <token>` against MCP_BEARER_TOKEN
 * using a constant-time comparison.
 *
 * Stamps the resolved user id onto `req.mcpUserId` so tool handlers can scope
 * their queries.
 *
 * Deliberately NOT the same auth as the rest of the api (JWT). The MCP config
 * lives in Claude Code and would need a long-lived token; rotating short JWTs
 * don't fit. The env-pinned token is the V1 trade-off for "local single-user
 * deployment only" (per Roadmap §不做: "✗ 把 MCP server 暴露在公网").
 */
@Injectable()
export class McpAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService<Env, true>) {}

  canActivate(ctx: ExecutionContext): boolean {
    const expected = this.config.get("MCP_BEARER_TOKEN", { infer: true });
    const userId = this.config.get("MCP_USER_ID", { infer: true });
    if (!expected || !userId) {
      throw new ServiceUnavailableException(
        "MCP is not configured. Set MCP_BEARER_TOKEN and MCP_USER_ID in the api .env.",
      );
    }

    const req = ctx.switchToHttp().getRequest<Request & { mcpUserId?: string }>();
    const header = req.headers.authorization ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(header);
    const presented = match?.[1];
    if (!presented || !constantTimeEqual(presented, expected)) {
      throw new UnauthorizedException("Invalid MCP bearer token");
    }

    req.mcpUserId = userId;
    return true;
  }
}

/**
 * Constant-time compare for arbitrary-length strings. SHA-256s both inputs
 * so the buffers handed to `crypto.timingSafeEqual` are always 32 bytes —
 * which sidesteps both the "must be same length" precondition and any
 * timing channel from the input lengths themselves. The hash collision risk
 * for SHA-256 with random-ish bearer tokens is negligible.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}
