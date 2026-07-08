import { AgentRunRequestSchema, type AgentRunRequest, type AgentSseEvent } from "@modeldoctor/contracts";
import { Body, Controller, HttpCode, HttpStatus, Post, Res, UseGuards } from "@nestjs/common";
import { ApiBody, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { createZodDto } from "nestjs-zod";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { ConnectionService } from "../connection/connection.service.js";
import { AgentLoopService } from "./agent-loop.service.js";

class AgentRunRequestDto extends createZodDto(AgentRunRequestSchema) {}

/**
 * `POST /api/playground/agent` — Server-Sent Events stream of one Agent
 * Playground run (Task 8). Mirrors `ChatController`'s streaming branch:
 * manual SSE headers (no NestJS interceptor magic), `res.write` per event,
 * `res.end()` once `AgentLoopService.run` resolves.
 *
 * The client closing the connection (nav away, tab close, explicit abort)
 * flips `aborted`, which `AgentLoopService.run` polls between turns/tool
 * calls so the loop doesn't keep burning upstream calls for a dead request.
 */
@ApiTags("playground")
@Controller("playground")
@UseGuards(JwtAuthGuard)
export class AgentController {
  constructor(
    private readonly svc: AgentLoopService,
    private readonly connections: ConnectionService,
  ) {}

  @ApiOperation({
    summary:
      "Run one Agent Playground turn-loop over SSE (builtin + inline tools; MCP tools placeholder until Task 11)",
  })
  @ApiBody({ type: AgentRunRequestDto })
  @Post("agent")
  @HttpCode(HttpStatus.OK)
  async run(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(AgentRunRequestSchema)) body: AgentRunRequest,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const conn = await this.connections.getOwnedDecrypted(user.sub, body.connectionId);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    let aborted = false;
    res.on("close", () => {
      aborted = true;
    });

    const emit = (event: AgentSseEvent): void => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      await this.svc.run(conn, body, emit, () => aborted);
    } catch (e) {
      if (!aborted) {
        emit({
          type: "step",
          step: {
            kind: "error",
            content: e instanceof Error ? e.message : String(e),
            tMs: 0,
          },
        });
        emit({ type: "done" });
      }
    } finally {
      if (!aborted) res.end();
    }
  }
}
