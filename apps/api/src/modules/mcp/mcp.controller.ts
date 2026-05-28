import { All, Controller, InternalServerErrorException, Req, Res, UseGuards } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
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
// Excluded from OpenAPI: this is the JSON-RPC transport for the MCP server,
// not a REST endpoint. Its protocol is described by the MCP spec, not OpenAPI.
@ApiExcludeController()
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
      // misbehaved. Throw so the global exception filter renders the response
      // (consistent logging + shape with the rest of the api).
      throw new InternalServerErrorException("MCP user context missing");
    }
    await this.mcp.handleRequest(req, res, userId, req.body);
  }
}
