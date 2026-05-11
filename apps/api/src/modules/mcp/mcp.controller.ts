import { All, Controller, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { Public } from "../../common/decorators/public.decorator.js";
import { McpAuthGuard } from "./mcp.guard.js";
import { McpService } from "./mcp.service.js";

/**
 * HTTP entry point for the MCP server. A single `/mcp` endpoint accepts
 * POST (JSON-RPC requests + SSE-streamed responses) and GET (long-poll
 * server-initiated notifications); the SDK's transport switches on method
 * internally.
 *
 * @Public bypasses the global JwtAuthGuard. MCP auth is handled by
 * McpAuthGuard (fixed env-pinned bearer token) — totally separate from the
 * web app's rotating JWT, see mcp.guard.ts for rationale.
 */
@Controller("mcp")
@Public()
@UseGuards(McpAuthGuard)
export class McpController {
  constructor(private readonly mcp: McpService) {}

  @All()
  async handle(@Req() req: Request & { mcpUserId?: string }, @Res() res: Response): Promise<void> {
    const userId = req.mcpUserId;
    if (!userId) {
      // McpAuthGuard sets mcpUserId on success; reaching here means the guard
      // misbehaved. Fail closed.
      res.status(500).json({ error: "MCP user context missing" });
      return;
    }
    await this.mcp.handleRequest(req, res, userId, req.body);
  }
}
