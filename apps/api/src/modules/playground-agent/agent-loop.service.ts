import type {
  AgentRunRequest,
  AgentSseEvent,
  ChatMessage,
  ToolCall,
  ToolDef,
} from "@modeldoctor/contracts";
import { Injectable, Optional } from "@nestjs/common";
import {
  buildHeaders,
  buildPlaygroundChatBody,
  buildUrl,
  type ParsedPlaygroundChatResponse,
} from "../../integrations/openai-client/index.js";
import type { DecryptedConnection } from "../connection/connection.service.js";
import { McpClientService } from "../mcp-client/mcp-client.service.js";
import type { DecryptedMcpServer } from "../mcp-server/mcp-server.service.js";
import { McpServerService } from "../mcp-server/mcp-server.service.js";
import { AgentJudgeService } from "./agent-judge.service.js";
import { BUILTIN_TOOLS, executeBuiltin } from "./builtin-tools.js";
import { readStreamingChatCompletion } from "./streaming.js";

const DEFAULT_PATH = "/v1/chat/completions";
const DEFAULT_MAX_STEPS = 12;
/** MCP tool names are namespaced `mcp__<serverId>__<tool>` (Task 11). */
const MCP_TOOL_PREFIX = "mcp__";
/**
 * Max characters of a tool result fed BACK to the model. A large result (e.g. a
 * 342 KB MCP `list_*` dump) otherwise blows the model's context window and the
 * next turn fails with an upstream 400. The full result is still streamed to
 * the UI (the `tool_result` step) for inspection — only the copy the model sees
 * is capped, with a marker telling it the result was truncated.
 */
const MAX_TOOL_RESULT_CHARS = 8000;

export type EmitFn = (event: AgentSseEvent) => void;
/** Polled between turns/tool-calls so a closed SSE connection stops the loop promptly. */
export type IsAbortedFn = () => boolean;

export type ModelCaller = (
  conn: DecryptedConnection,
  body: Record<string, unknown>,
  signal?: AbortSignal,
  /**
   * Called synchronously for every `delta.content` fragment as the upstream
   * streams the turn's assistant text. Optional so existing unit specs that
   * stub `callModel` entirely (`service.callModel = vi.fn()...`) keep
   * compiling/passing untouched — a stub is free to ignore it.
   */
  onTextDelta?: (delta: string) => void,
  /**
   * Called synchronously for every reasoning fragment (chain-of-thought) as
   * a reasoning model streams it — emitted BEFORE any `onTextDelta`. Optional
   * for the same reason as `onTextDelta`; non-reasoning models never call it.
   */
  onReasoningDelta?: (delta: string) => void,
) => Promise<ParsedPlaygroundChatResponse>;

/**
 * `req.task` (Task 1+ unified playground) is either plain text or multimodal
 * content parts. The judge (`AgentJudgeService`) and any other plain-text
 * consumer only ever need the textual gist of the task, so this collapses
 * either shape to a single string — for an array, it joins the `text` parts
 * (ignoring images/audio/files, which the judge prompt has no use for).
 */
export function taskToText(task: AgentRunRequest["task"]): string {
  if (typeof task === "string") return task;
  return task
    .filter(
      (part): part is Extract<(typeof task)[number], { type: "text" }> => part.type === "text",
    )
    .map((part) => part.text)
    .join(" ");
}

/**
 * Server-side multi-turn tool-call loop for the Agent Playground (Task 8;
 * MCP wiring Task 11).
 *
 * One `run()` call drives *one* HTTP request's worth of turns: builtin and
 * MCP (when `autoRunMcp` is set) tools execute inline and the loop keeps
 * going; a hand-authored "inline" tool with no server-side executor, or an
 * MCP tool without `autoRunMcp`, cannot be resolved here, so the loop emits
 * `tool_result_needed` / `tool_approval` + `done { messages }` and returns —
 * the frontend is expected to either fill in that tool's result (inline) or
 * re-send with `autoRunMcp: true` (MCP), passing the exact `done.messages`
 * transcript back as `AgentRunRequest.messages`, and start a *new* `run()`
 * (POST) (SSE requests are short-lived and stateless; the server never
 * blocks waiting on a human).
 *
 * Full-transcript continuation (Task 11 fix pass): a resumed `run()` seeds
 * `messages` verbatim from `req.messages` (never rebuilt from
 * `task`/`systemPrompt`), then — before calling the model — resolves any
 * `tool_calls` from the prior (paused) turn that aren't answered yet. This
 * guarantees a builtin or auto-run MCP tool that already executed before the
 * pause is never re-executed on resume; only the newly-approved/newly-filled
 * call(s) run. See `findUnansweredToolCalls`/`processToolCalls`.
 */
@Injectable()
export class AgentLoopService {
  /**
   * All three are `@Optional()` (undefined when unset) purely so unit specs
   * can `new AgentLoopService()` with no DI container at all when a test
   * doesn't touch MCP/judging — real requests always get them via
   * `PlaygroundAgentModule` importing `McpClientModule` + `McpServerModule`
   * + `LlmJudgeModule`. When `judge` is undefined, verdict emission is
   * simply skipped (see `maybeEmitVerdict`) — it is never required for the
   * loop to function.
   */
  constructor(
    @Optional() private readonly mcpClient?: McpClientService,
    @Optional() private readonly mcpServerService?: McpServerService,
    @Optional() private readonly judge?: AgentJudgeService,
  ) {}

  /**
   * Upstream chat-completions call for a single turn. A plain overridable
   * instance property (not a constructor-injected token) so specs can stub
   * it directly — `service.callModel = vi.fn()...` — without any network
   * I/O or NestJS DI ceremony. Streaming (Task 3, unified playground): the
   * caller passes `stream: true` in `body` and this reads the SSE response
   * via `readStreamingChatCompletion`, forwarding each text fragment to
   * `onTextDelta` as it arrives while still returning the fully assembled
   * `{content, tool_calls}` once the stream ends — the loop still needs the
   * complete `tool_calls` array before it can dispatch a turn. `usage` isn't
   * available from a streamed response, so it's always `undefined` here
   * (kept in the return shape only for `ParsedPlaygroundChatResponse`
   * compatibility).
   */
  callModel: ModelCaller = async (conn, body, signal, onTextDelta, onReasoningDelta) => {
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
    const { content, tool_calls } = await readStreamingChatCompletion(
      res,
      onTextDelta ?? (() => {}),
      onReasoningDelta ?? (() => {}),
    );
    return { content, usage: undefined, tool_calls };
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
    // Task 4 (unified playground): with NO tools advertised at all (no
    // builtinTools/inlineTools/mcpServerIds), a run is an equivalent
    // streaming CHAT — text_delta* -> assistant_end -> done, no tool/step
    // noise. The trajectory verdict is an agent-capability score (did it
    // pick the right tool, etc.) and is meaningless for plain conversation,
    // so it's gated off here even when a judge provider IS configured. See
    // the two `maybeEmitVerdict` call sites below.
    const toolsWereAvailable = tools.length > 0;
    const isResume = Boolean(req.messages && req.messages.length > 0);
    const messages: ChatMessage[] = isResume
      ? [...(req.messages as ChatMessage[])]
      : this.buildInitialMessages(req);

    // Full-transcript continuation (Task 11 fix pass): a resumed request's
    // `messages` may end with an assistant `tool_calls` message that wasn't
    // *fully* answered yet in the paused turn — e.g. the frontend just
    // approved one MCP tool_call, but that assistant turn also included a
    // builtin call that already executed (and is already in `messages` as a
    // `role: "tool"` entry) before the pause. Resolve only the still-
    // unanswered call(s) first — this is what executes the newly-approved
    // MCP tool (or re-pauses if it's still not resolvable) WITHOUT
    // re-running anything that already executed — before calling the model
    // for a new turn.
    if (isResume) {
      if (isAborted()) return;
      const unanswered = this.findUnansweredToolCalls(messages);
      if (unanswered) {
        const { sawInlineTool, sawApprovalNeeded } = await this.processToolCalls(
          unanswered,
          messages,
          emit,
          { mcpServerMap, autoRunMcp: req.autoRunMcp, tMs, isAborted },
          { skipToolCallStep: true },
        );
        if (isAborted()) return;
        if (sawInlineTool || sawApprovalNeeded) {
          emit({ type: "done", messages: [...messages] });
          return;
        }
      }
    }

    for (let turn = 0; turn < maxSteps; turn++) {
      if (isAborted()) return;

      // planFirst: force the FIRST turn of a fresh run to be text-only via
      // `tool_choice: "none"`, so a tool-happy model has to write a plan
      // instead of jumping straight to tool calls (a soft "please plan first"
      // instruction alone gets ignored). The plan turn is NOT a completion —
      // we emit it and continue to execute with tools enabled next turn.
      const isPlanTurn = turn === 0 && req.planFirst && !isResume;

      let parsed: ParsedPlaygroundChatResponse;
      try {
        const body = buildPlaygroundChatBody({
          model: conn.model,
          messages,
          params: {
            // Sampling params (temperature/maxTokens/topP/...) are always
            // relevant, chat or agent — spread FIRST so the internal
            // tools/tool_choice/stream keys below (derived from this turn's
            // tool state, not user-configurable) always win.
            ...(req.params ?? {}),
            tools: tools.length > 0 ? tools : undefined,
            tool_choice: isPlanTurn ? "none" : req.tool_choice,
            stream: true,
          },
        });
        // A plan turn's text is NOT streamed to the client — it's emitted as
        // a single `{kind:"plan"}` step below once the full plan text is in,
        // so the pinned plan strip never shows a partial/duplicated plan.
        // Every other turn streams its assistant text live via `text_delta`,
        // and its chain-of-thought (reasoning models only) via `reasoning_delta`.
        parsed = await this.callModel(
          conn,
          body,
          signal,
          isPlanTurn ? undefined : (delta) => emit({ type: "text_delta", delta }),
          isPlanTurn ? undefined : (delta) => emit({ type: "reasoning_delta", delta }),
        );
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

      if (isPlanTurn) {
        if (parsed.content && parsed.content.trim().length > 0) {
          emit({ type: "step", step: { kind: "plan", content: parsed.content, tMs: tMs() } });
          messages.push({ role: "assistant", content: parsed.content });
        }
        continue;
      }

      // The text itself already streamed out via `text_delta` above (from
      // inside `callModel`) — `assistant_end` just marks the turn's text
      // boundary so the frontend can close off the in-progress bubble
      // without waiting for the terminal `done`. No more whole-turn
      // `{kind:"assistant"}` step is emitted.
      //
      // Guard is `.length > 0`, NOT `.trim().length > 0`: `text_delta`
      // (`streaming.ts`) fires for ANY non-empty `delta.content`, whitespace
      // included, so a whitespace-only turn still opens a bubble on the
      // frontend. Trimming here would leave that bubble unclosed (orphan
      // `assistant_text` timeline item) — this must mirror the same
      // non-empty condition `text_delta` uses.
      if (parsed.content && parsed.content.length > 0) {
        emit({ type: "assistant_end" });
      }

      const toolCalls = parsed.tool_calls ?? [];
      if (toolCalls.length === 0) {
        // True completion: the model produced a final answer with no further
        // tool_calls. Judge this trajectory (best-effort) BEFORE `done` — the
        // final assistant turn's content never gets pushed into `messages`
        // on this path (only prior turns are), so splice it in for the judge.
        if (toolsWereAvailable) {
          await this.maybeEmitVerdict(
            taskToText(req.task),
            [...messages, { role: "assistant", content: parsed.content ?? "" }],
            emit,
          );
        }
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
      const { sawInlineTool, sawApprovalNeeded } = await this.processToolCalls(
        toolCalls,
        messages,
        emit,
        { mcpServerMap, autoRunMcp: req.autoRunMcp, tMs, isAborted },
      );
      if (isAborted()) return;

      if (sawInlineTool || sawApprovalNeeded) {
        // Full-transcript continuation: hand back the accumulated transcript
        // so far (system/user/assistant + every tool result already
        // executed this turn) so a resumed request can pick up exactly
        // where this one left off instead of restarting from turn 0.
        emit({ type: "done", messages: [...messages] });
        return;
      }
    }

    emit({
      type: "step",
      step: {
        kind: "error",
        content: `Stopped after reaching maxSteps (${maxSteps}).`,
        tMs: tMs(),
      },
    });
    // Also a true completion (the run ran to its full budget rather than
    // pausing for a human) — judge it the same as the no-more-tool-calls path.
    // maxSteps is only reachable when tools were requested (a tools-off run
    // never has tool_calls to loop on), but the gate applies uniformly here
    // too for consistency with the other call site.
    if (toolsWereAvailable) {
      await this.maybeEmitVerdict(taskToText(req.task), messages, emit);
    }
    emit({ type: "done" });
  }

  /**
   * Best-effort trajectory verdict, emitted immediately before a terminal
   * `done` on a TRUE completion only (see call sites). No-op when no
   * `AgentJudgeService` was injected (unit specs, or a deployment with no
   * LLM-judge provider wired up at all). `AgentJudgeService.judge()` itself
   * never throws (returns `null` on any failure/timeout), but this is
   * wrapped defensively too so a judge outage can never surface as a run
   * failure or hang the response.
   */
  private async maybeEmitVerdict(
    task: string,
    messages: ChatMessage[],
    emit: EmitFn,
  ): Promise<void> {
    if (!this.judge) return;
    try {
      const verdict = await this.judge.judge({ task, messages });
      if (verdict) emit({ type: "verdict", verdict });
    } catch {
      // Never let a judge failure affect the agent run itself.
    }
  }

  /**
   * Dispatches every `toolCalls` entry: builtin (execute inline + append
   * `role: "tool"`), MCP (execute inline when `ctx.autoRunMcp`, else emit
   * `tool_approval`), or hand-authored inline (emit `tool_result_needed`).
   * Always processes ALL calls before returning — see the "trailing calls"
   * regression tests (E/F) this preserves. Shared by the per-turn loop in
   * `run()` and by `resumeUnansweredToolCalls` (continuation resume), which
   * is why the MCP-server lookup / `autoRunMcp` / clock are threaded through
   * `ctx` rather than read off `this`/a closure.
   *
   * `opts.skipToolCallStep` suppresses the `tool_call` step re-emission —
   * set by the resume path, where these `tool_call`s were already emitted
   * (and are already in the frontend's persisted trace) in the request that
   * originally paused.
   */
  private async processToolCalls(
    toolCalls: ToolCall[],
    messages: ChatMessage[],
    emit: EmitFn,
    ctx: {
      mcpServerMap: Map<string, DecryptedMcpServer>;
      autoRunMcp?: boolean;
      tMs: () => number;
      isAborted: IsAbortedFn;
    },
    opts: { skipToolCallStep?: boolean } = {},
  ): Promise<{ sawInlineTool: boolean; sawApprovalNeeded: boolean }> {
    let sawInlineTool = false;
    let sawApprovalNeeded = false;

    for (const call of toolCalls) {
      if (ctx.isAborted()) return { sawInlineTool, sawApprovalNeeded };
      const name = call.function.name;
      const args = this.parseArgs(call.function.arguments);

      if (!opts.skipToolCallStep) {
        emit({
          type: "step",
          step: { kind: "tool_call", name, args, toolCallId: call.id, tMs: ctx.tMs() },
        });
      }

      if (name.startsWith(MCP_TOOL_PREFIX)) {
        const parsedName = this.parseMcpToolName(name);
        const server = parsedName ? ctx.mcpServerMap.get(parsedName.serverId) : undefined;
        if (!parsedName || !server) {
          const msg = "error: unknown or unavailable MCP server/tool";
          emit({
            type: "step",
            step: { kind: "error", name, toolCallId: call.id, content: msg, tMs: ctx.tMs() },
          });
          messages.push({ role: "tool", tool_call_id: call.id, content: msg });
          continue;
        }

        if (ctx.autoRunMcp) {
          try {
            // biome-ignore lint/style/noNonNullAssertion: `server` resolved only via mcpServerMap, which is only populated when `this.mcpClient` succeeded
            const result = await this.mcpClient!.callTool(server, parsedName.toolName, args);
            emit({
              type: "step",
              step: {
                kind: "tool_result",
                name,
                content: result,
                toolCallId: call.id,
                tMs: ctx.tMs(),
              },
            });
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: this.truncateToolResult(result),
            });
          } catch (e) {
            const msg = this.errMsg(e);
            emit({
              type: "step",
              step: { kind: "error", name, toolCallId: call.id, content: msg, tMs: ctx.tMs() },
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

      if (Object.hasOwn(BUILTIN_TOOLS, name)) {
        try {
          const result = await executeBuiltin(name, args);
          emit({
            type: "step",
            step: {
              kind: "tool_result",
              name,
              content: result,
              toolCallId: call.id,
              tMs: ctx.tMs(),
            },
          });
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: this.truncateToolResult(result),
          });
        } catch (e) {
          const msg = this.errMsg(e);
          emit({
            type: "step",
            step: { kind: "error", name, toolCallId: call.id, content: msg, tMs: ctx.tMs() },
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

    return { sawInlineTool, sawApprovalNeeded };
  }

  /**
   * Finds the most recent assistant `tool_calls` message and returns
   * whichever of its calls have no `{role:"tool", tool_call_id}` answer
   * anywhere in `messages` yet — i.e. this is a resumed request picking
   * back up mid-turn.
   *
   * Deliberately does NOT require that assistant message to be the literal
   * last entry: a turn with `[builtin, mcp-needs-approval]` appends the
   * builtin's `role: "tool"` answer right after the assistant message
   * *before* pausing, so the actual last message at pause time is that
   * `tool` entry, not the assistant one. Scanning backward for the most
   * recent assistant-with-tool_calls message and cross-checking ALL of
   * `messages` for each call's answer handles that (every earlier
   * assistant-with-tool_calls turn is guaranteed fully answered already —
   * the loop always pauses/returns on the first turn with any unresolved
   * call, so only the latest such turn can have one).
   *
   * Returns `null` when there's nothing to resolve (fresh run, or every
   * call in the latest tool_calls turn was already answered before the
   * pause).
   */
  private findUnansweredToolCalls(messages: ChatMessage[]): ToolCall[] | null {
    let lastToolCallsMsg: ChatMessage | undefined;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0) {
        lastToolCallsMsg = m;
        break;
      }
    }
    if (!lastToolCallsMsg?.tool_calls) return null;

    const answeredIds = new Set(
      messages
        .filter((m) => m.role === "tool" && typeof m.tool_call_id === "string")
        .map((m) => m.tool_call_id as string),
    );
    const unanswered = lastToolCallsMsg.tool_calls.filter((tc) => !answeredIds.has(tc.id));
    return unanswered.length > 0 ? unanswered : null;
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

  /**
   * Cap a tool result before it's fed back to the model, so a large result
   * doesn't overflow the context window. The UI still gets the full result via
   * the `tool_result` step — only this model-facing copy is truncated.
   */
  private truncateToolResult(result: string): string {
    if (result.length <= MAX_TOOL_RESULT_CHARS) return result;
    const omitted = result.length - MAX_TOOL_RESULT_CHARS;
    return `${result.slice(0, MAX_TOOL_RESULT_CHARS)}\n\n[truncated: showing first ${MAX_TOOL_RESULT_CHARS} of ${result.length} chars; ${omitted} omitted to fit the model context. Narrow the query or ask for fewer items.]`;
  }
}
