import type { AgentRunRequest, AgentSseEvent, ChatMessage, ToolDef } from "@modeldoctor/contracts";
import { Injectable, Optional } from "@nestjs/common";
import {
  buildHeaders,
  buildPlaygroundChatBody,
  buildUrl,
  type ParsedPlaygroundChatResponse,
  parsePlaygroundChatResponse,
} from "../../integrations/openai-client/index.js";
import type { DecryptedConnection } from "../connection/connection.service.js";
import { McpClientService } from "../mcp-client/mcp-client.service.js";
import type { DecryptedMcpServer } from "../mcp-server/mcp-server.service.js";
import { McpServerService } from "../mcp-server/mcp-server.service.js";
import { BUILTIN_TOOLS, executeBuiltin } from "./builtin-tools.js";

const DEFAULT_PATH = "/v1/chat/completions";
const DEFAULT_MAX_STEPS = 12;
/** MCP tool names are namespaced `mcp__<serverId>__<tool>` (Task 11). */
const MCP_TOOL_PREFIX = "mcp__";

export type EmitFn = (event: AgentSseEvent) => void;
/** Polled between turns/tool-calls so a closed SSE connection stops the loop promptly. */
export type IsAbortedFn = () => boolean;

export type ModelCaller = (
  conn: DecryptedConnection,
  body: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<ParsedPlaygroundChatResponse>;

/**
 * Server-side multi-turn tool-call loop for the Agent Playground (Task 8;
 * MCP wiring Task 11).
 *
 * One `run()` call drives *one* HTTP request's worth of turns: builtin and
 * MCP (when `autoRunMcp` is set) tools execute inline and the loop keeps
 * going; a hand-authored "inline" tool with no server-side executor, or an
 * MCP tool without `autoRunMcp`, cannot be resolved here, so the loop emits
 * `tool_result_needed` / `tool_approval` + `done` and returns — the frontend
 * is expected to either fill in that tool's result (inline) or re-send with
 * `autoRunMcp: true` (MCP) and start a *new* `run()` (POST) with the
 * accumulated `messages`, per the brief's continuation design (SSE requests
 * are short-lived and stateless; the server never blocks waiting on a
 * human).
 */
@Injectable()
export class AgentLoopService {
  /**
   * Both are `@Optional()` (undefined when unset) purely so unit specs can
   * `new AgentLoopService()` with no DI container at all when a test doesn't
   * touch MCP — real requests always get them via `PlaygroundAgentModule`
   * importing `McpClientModule` + `McpServerModule`.
   */
  constructor(
    @Optional() private readonly mcpClient?: McpClientService,
    @Optional() private readonly mcpServerService?: McpServerService,
  ) {}

  /**
   * Upstream chat-completions call for a single turn. A plain overridable
   * instance property (not a constructor-injected token) so specs can stub
   * it directly — `service.callModel = vi.fn()...` — without any network
   * I/O or NestJS DI ceremony. Non-streaming: the loop needs the complete
   * `tool_calls` array before it can dispatch, so there's no benefit to
   * streaming deltas per turn.
   */
  callModel: ModelCaller = async (conn, body, signal) => {
    const url = buildUrl({
      apiBaseUrl: conn.baseUrl,
      defaultPath: DEFAULT_PATH,
      queryParams: conn.queryParams,
    });
    const headers = buildHeaders(conn.apiKey, conn.customHeaders);
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`upstream ${res.status}: ${text || res.statusText}`);
    }
    const json = await res.json();
    return parsePlaygroundChatResponse(json);
  };

  async run(
    conn: DecryptedConnection,
    req: AgentRunRequest,
    emit: EmitFn,
    isAborted: IsAbortedFn = () => false,
    signal?: AbortSignal,
    /** Owner of `req.mcpServerIds` — required only when that field is set. */
    userId?: string,
  ): Promise<void> {
    const start = Date.now();
    const tMs = () => Date.now() - start;
    const maxSteps = req.maxSteps ?? DEFAULT_MAX_STEPS;
    const { toolDefs: mcpToolDefs, serverMap: mcpServerMap } = await this.discoverMcpTools(
      req,
      userId,
      emit,
      tMs,
    );
    const tools = [...this.resolveTools(req), ...mcpToolDefs];
    const messages: ChatMessage[] =
      req.messages && req.messages.length > 0 ? [...req.messages] : this.buildInitialMessages(req);

    for (let turn = 0; turn < maxSteps; turn++) {
      if (isAborted()) return;

      let parsed: ParsedPlaygroundChatResponse;
      try {
        const body = buildPlaygroundChatBody({
          model: conn.model,
          messages,
          params: {
            tools: tools.length > 0 ? tools : undefined,
            tool_choice: req.tool_choice,
            stream: undefined,
          },
        });
        parsed = await this.callModel(conn, body, signal);
      } catch (e) {
        if (isAborted()) return;
        emit({
          type: "step",
          step: { kind: "error", content: this.errMsg(e), tMs: tMs() },
        });
        emit({ type: "done" });
        return;
      }

      // The upstream call may have taken long enough for the client to
      // disconnect; check immediately before emitting anything derived
      // from `parsed` so we never `res.write` after the connection closed.
      if (isAborted()) return;

      if (parsed.content && parsed.content.trim().length > 0) {
        const kind = turn === 0 && req.planFirst ? "plan" : "assistant";
        emit({ type: "step", step: { kind, content: parsed.content, tMs: tMs() } });
      }

      const toolCalls = parsed.tool_calls ?? [];
      if (toolCalls.length === 0) {
        emit({ type: "done" });
        return;
      }

      messages.push({ role: "assistant", content: parsed.content ?? "", tool_calls: toolCalls });

      // A turn can request several tool_calls at once. Every one of them
      // MUST be emitted/executed (or, for inline tools, flagged as needing
      // a result) before we decide whether to end the request — otherwise
      // any call ordered after an inline tool would be silently dropped,
      // leaving the assistant message above with tool_call_ids that never
      // got a `role: "tool"` response.
      let sawInlineTool = false;
      let sawApprovalNeeded = false;

      for (const call of toolCalls) {
        if (isAborted()) return;
        const name = call.function.name;
        const args = this.parseArgs(call.function.arguments);

        emit({
          type: "step",
          step: { kind: "tool_call", name, args, toolCallId: call.id, tMs: tMs() },
        });

        if (name.startsWith(MCP_TOOL_PREFIX)) {
          const parsedName = this.parseMcpToolName(name);
          const server = parsedName ? mcpServerMap.get(parsedName.serverId) : undefined;
          if (!parsedName || !server) {
            const msg = "error: unknown or unavailable MCP server/tool";
            emit({
              type: "step",
              step: { kind: "error", name, toolCallId: call.id, content: msg, tMs: tMs() },
            });
            messages.push({ role: "tool", tool_call_id: call.id, content: msg });
            continue;
          }

          if (req.autoRunMcp) {
            try {
              // biome-ignore lint/style/noNonNullAssertion: `server` resolved only via mcpServerMap, which is only populated when `this.mcpClient` succeeded
              const result = await this.mcpClient!.callTool(server, parsedName.toolName, args);
              emit({
                type: "step",
                step: { kind: "tool_result", name, content: result, toolCallId: call.id, tMs: tMs() },
              });
              messages.push({ role: "tool", tool_call_id: call.id, content: result });
            } catch (e) {
              const msg = this.errMsg(e);
              emit({
                type: "step",
                step: { kind: "error", name, toolCallId: call.id, content: msg, tMs: tMs() },
              });
              messages.push({ role: "tool", tool_call_id: call.id, content: `error: ${msg}` });
            }
            continue;
          }

          // Not auto-run: cannot execute inline, mirror the inline-tool
          // continuation model — emit the approval request and keep
          // iterating so any remaining tool_calls in this same turn still
          // get executed/flagged before the request ends.
          emit({
            type: "tool_approval",
            toolCallId: call.id,
            server: { id: server.id, name: server.name },
            name,
            args,
          });
          sawApprovalNeeded = true;
          continue;
        }

        if (Object.prototype.hasOwnProperty.call(BUILTIN_TOOLS, name)) {
          try {
            const result = await executeBuiltin(name, args);
            emit({
              type: "step",
              step: { kind: "tool_result", name, content: result, toolCallId: call.id, tMs: tMs() },
            });
            messages.push({ role: "tool", tool_call_id: call.id, content: result });
          } catch (e) {
            const msg = this.errMsg(e);
            emit({
              type: "step",
              step: { kind: "error", name, toolCallId: call.id, content: msg, tMs: tMs() },
            });
            messages.push({ role: "tool", tool_call_id: call.id, content: `error: ${msg}` });
          }
          continue;
        }

        // Hand-authored inline tool with no server-side executor: cannot
        // resolve within this request. Per the design note, do NOT block
        // waiting for a human — emit the event and keep iterating so any
        // remaining tool_calls in this same turn still get executed; the
        // frontend continues with a fresh request once it has filled in
        // every `tool_result_needed` from this turn.
        emit({ type: "tool_result_needed", toolCallId: call.id, name, args });
        sawInlineTool = true;
      }

      if (sawInlineTool || sawApprovalNeeded) {
        emit({ type: "done" });
        return;
      }
    }

    emit({
      type: "step",
      step: { kind: "error", content: `Stopped after reaching maxSteps (${maxSteps}).`, tMs: tMs() },
    });
    emit({ type: "done" });
  }

  private resolveTools(req: AgentRunRequest): ToolDef[] {
    const builtins = (req.builtinTools ?? [])
      .map((name) => BUILTIN_TOOLS[name]?.def)
      .filter((d): d is ToolDef => Boolean(d));
    return [...builtins, ...(req.inlineTools ?? [])];
  }

  /**
   * Discovers tools for every requested `mcpServerIds` entry and turns them
   * into namespaced `ToolDef`s (`mcp__<serverId>__<tool>`) advertised to the
   * model alongside builtins/inline tools. A dead/unauthorized server (bad
   * credentials, unreachable, not owned by `userId`, …) emits an `error`
   * step for that one server and is simply excluded from the returned map —
   * it does NOT throw and does NOT stop the other servers or the run.
   */
  private async discoverMcpTools(
    req: AgentRunRequest,
    userId: string | undefined,
    emit: EmitFn,
    tMs: () => number,
  ): Promise<{ toolDefs: ToolDef[]; serverMap: Map<string, DecryptedMcpServer> }> {
    const toolDefs: ToolDef[] = [];
    const serverMap = new Map<string, DecryptedMcpServer>();
    const serverIds = req.mcpServerIds ?? [];
    if (serverIds.length === 0) return { toolDefs, serverMap };

    for (const serverId of serverIds) {
      try {
        if (!userId) throw new Error("no authenticated user to resolve MCP servers for");
        if (!this.mcpServerService || !this.mcpClient) {
          throw new Error("MCP client is not available on this AgentLoopService instance");
        }
        const server = await this.mcpServerService.getOwnedDecrypted(userId, serverId);
        const tools = await this.mcpClient.discoverTools(server);
        serverMap.set(serverId, server);
        for (const tool of tools) {
          toolDefs.push({
            type: "function",
            function: {
              name: `${MCP_TOOL_PREFIX}${serverId}__${tool.name}`,
              description: tool.description,
              parameters: tool.inputSchema,
            },
          });
        }
      } catch (e) {
        emit({
          type: "step",
          step: {
            kind: "error",
            content: `MCP discovery failed for server ${serverId}: ${this.errMsg(e)}`,
            tMs: tMs(),
          },
        });
      }
    }
    return { toolDefs, serverMap };
  }

  /** Splits `mcp__<serverId>__<tool>` into its parts; `null` if malformed. */
  private parseMcpToolName(name: string): { serverId: string; toolName: string } | null {
    const rest = name.slice(MCP_TOOL_PREFIX.length);
    const sepIdx = rest.indexOf("__");
    if (sepIdx <= 0 || sepIdx === rest.length - 2) return null;
    return { serverId: rest.slice(0, sepIdx), toolName: rest.slice(sepIdx + 2) };
  }

  private buildInitialMessages(req: AgentRunRequest): ChatMessage[] {
    const messages: ChatMessage[] = [];
    if (req.systemPrompt) messages.push({ role: "system", content: req.systemPrompt });
    if (req.planFirst) {
      messages.push({
        role: "system",
        content:
          "Before taking any action, first write a short numbered plan of the steps you intend to take, then proceed to execute it.",
      });
    }
    messages.push({ role: "user", content: req.task });
    return messages;
  }

  private parseArgs(rawArguments: string): Record<string, unknown> {
    if (!rawArguments) return {};
    try {
      const parsed = JSON.parse(rawArguments);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  private errMsg(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }
}
