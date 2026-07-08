import type { AgentRunRequest, AgentSseEvent, ChatMessage, ToolDef } from "@modeldoctor/contracts";
import { Injectable } from "@nestjs/common";
import {
  buildHeaders,
  buildPlaygroundChatBody,
  buildUrl,
  type ParsedPlaygroundChatResponse,
  parsePlaygroundChatResponse,
} from "../../integrations/openai-client/index.js";
import type { DecryptedConnection } from "../connection/connection.service.js";
import { BUILTIN_TOOLS, executeBuiltin } from "./builtin-tools.js";

const DEFAULT_PATH = "/v1/chat/completions";
const DEFAULT_MAX_STEPS = 12;
/** MCP tool names are namespaced `mcp__<server>__<tool>`; wiring is Task 11. */
const MCP_TOOL_PREFIX = "mcp__";

export type EmitFn = (event: AgentSseEvent) => void;
/** Polled between turns/tool-calls so a closed SSE connection stops the loop promptly. */
export type IsAbortedFn = () => boolean;

export type ModelCaller = (
  conn: DecryptedConnection,
  body: Record<string, unknown>,
) => Promise<ParsedPlaygroundChatResponse>;

/**
 * Server-side multi-turn tool-call loop for the Agent Playground (Task 8).
 *
 * One `run()` call drives *one* HTTP request's worth of turns: builtin (and,
 * later, MCP) tools execute inline and the loop keeps going; a hand-authored
 * "inline" tool with no server-side executor cannot be resolved here, so the
 * loop emits `tool_result_needed` + `done` and returns — the frontend is
 * expected to fill in that tool's result and start a *new* `run()` (POST)
 * with the accumulated `messages`, per the brief's continuation design
 * (SSE requests are short-lived and stateless; the server never blocks
 * waiting on a human).
 */
@Injectable()
export class AgentLoopService {
  /**
   * Upstream chat-completions call for a single turn. A plain overridable
   * instance property (not a constructor-injected token) so specs can stub
   * it directly — `service.callModel = vi.fn()...` — without any network
   * I/O or NestJS DI ceremony. Non-streaming: the loop needs the complete
   * `tool_calls` array before it can dispatch, so there's no benefit to
   * streaming deltas per turn.
   */
  callModel: ModelCaller = async (conn, body) => {
    const url = buildUrl({
      apiBaseUrl: conn.baseUrl,
      defaultPath: DEFAULT_PATH,
      queryParams: conn.queryParams,
    });
    const headers = buildHeaders(conn.apiKey, conn.customHeaders);
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
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
  ): Promise<void> {
    const start = Date.now();
    const tMs = () => Date.now() - start;
    const maxSteps = req.maxSteps ?? DEFAULT_MAX_STEPS;
    const tools = this.resolveTools(req);
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
        parsed = await this.callModel(conn, body);
      } catch (e) {
        emit({
          type: "step",
          step: { kind: "error", content: this.errMsg(e), tMs: tMs() },
        });
        emit({ type: "done" });
        return;
      }

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

      for (const call of toolCalls) {
        if (isAborted()) return;
        const name = call.function.name;
        const args = this.parseArgs(call.function.arguments);

        emit({
          type: "step",
          step: { kind: "tool_call", name, args, toolCallId: call.id, tMs: tMs() },
        });

        if (name.startsWith(MCP_TOOL_PREFIX)) {
          emit({
            type: "step",
            step: {
              kind: "error",
              name,
              toolCallId: call.id,
              content: "MCP not yet available",
              tMs: tMs(),
            },
          });
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: "error: MCP tools are not yet available",
          });
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
        // waiting for a human — emit the event and let the frontend
        // continue with a fresh request once it has the result.
        emit({ type: "tool_result_needed", toolCallId: call.id, name, args });
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
