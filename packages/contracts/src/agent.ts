import { z } from "zod";
// Type-only: `playground.ts` imports `toolDefSchema`/`ToolCallSchema` from
// THIS module at the value level, so a value import of `ChatMessageSchema`
// back from `playground.ts` here would be a real ESM circular-import (the
// same hazard documented on `AgentRunRequestSchema` in agent-run.ts). A
// `import type` is erased entirely at compile time — no runtime cycle — so
// it's safe to reference the `ChatMessage` *type* (not its zod schema) for
// the `done` event's `messages` field below.
import type { ChatMessage } from "./playground.js";

/**
 * OpenAI-style function-tool definition. Shared by `Skill.inlineTools`
 * (a Skill's ad-hoc tool list, alongside its referenced McpServers) and by
 * later agent-run request/response shapes. Kept minimal — only what a
 * chat-completions `tools` array needs.
 */
export const toolDefSchema = z.object({
  type: z.literal("function"),
  function: z.object({
    name: z.string(),
    description: z.string().optional(),
    parameters: z.record(z.unknown()),
  }),
});
export type ToolDef = z.infer<typeof toolDefSchema>;

/**
 * OpenAI-style tool-call emitted by an assistant message (chat-completions
 * `message.tool_calls[]`). `function.arguments` is a JSON-encoded string
 * (not a parsed object) — that's how the upstream API returns it.
 */
export const ToolCallSchema = z.object({
  id: z.string(),
  type: z.literal("function"),
  function: z.object({
    name: z.string(),
    arguments: z.string(),
  }),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

// ─── AgentLoopService SSE events (Task 8) ──────────────────────────────────

/**
 * One step in the agent's execution trace, streamed to the client as it
 * happens. `tMs` is the elapsed wall-clock time (ms) since the run started,
 * so the frontend timeline can lay steps out on a shared axis without doing
 * its own clock bookkeeping.
 *
 * - `plan` — the model's up-front plan text (only emitted for the very
 *   first turn when `AgentRunRequest.planFirst` was set).
 * - `tool_call` — the model asked to invoke `name` with `args`.
 * - `tool_result` — a builtin/MCP tool's own successful execution result
 *   (`content`), correlated back to `toolCallId`.
 * - `assistant` — assistant free-text content, on any turn (including the
 *   final one with no further tool calls).
 * - `error` — either an upstream call failed, a builtin/MCP tool threw, an
 *   MCP tool call named an unknown/unavailable server, or `maxSteps` was hit.
 */
export const AgentStepKindSchema = z.enum(["plan", "tool_call", "tool_result", "assistant", "error"]);
export type AgentStepKind = z.infer<typeof AgentStepKindSchema>;

export const AgentStepSchema = z.object({
  kind: AgentStepKindSchema,
  content: z.string().optional(),
  name: z.string().optional(),
  args: z.unknown().optional(),
  toolCallId: z.string().optional(),
  /** Elapsed ms since the run started. */
  tMs: z.number(),
});
export type AgentStep = z.infer<typeof AgentStepSchema>;

/**
 * SSE payload shape for `POST /api/playground/agent`. Each server-sent
 * `data:` line JSON.stringify()s one of these.
 *
 * `tool_result_needed` is emitted for a tool the loop cannot execute itself
 * (an inline/hand-authored tool with no server-side executor). Per the
 * design note in the Task 8 brief: the loop does NOT block waiting for the
 * result — it emits this event followed by `done` and the connection ends.
 * The frontend fills in the tool result out of band and starts a *new*
 * `POST /api/playground/agent` request, passing the accumulated
 * `messages` (including a `{role:"tool", tool_call_id, content}` entry for
 * this call) via `AgentRunRequest.messages` to continue the run.
 *
 * `tool_approval` (Task 11) is the MCP analogue: emitted when the loop
 * dispatches a `mcp__<serverId>__<tool>` call and `AgentRunRequest.autoRunMcp`
 * was not set. The loop does NOT execute the MCP tool — it emits this event
 * (with the owning server's id/name for display) followed by `done`. The
 * frontend either re-sends the same request with `autoRunMcp: true` (simplest
 * V1 "approve" flow — see `AgentRunRequest.autoRunMcp` doc) or discards the
 * run ("reject").
 *
 * `done.messages` (full-transcript continuation, Task 11 fix pass): populated
 * ONLY when the loop is pausing for a continuation (i.e. this same request
 * also emitted a `tool_result_needed` and/or `tool_approval` beforehand) —
 * every other `done` (normal completion, upstream error, maxSteps) omits it.
 * It carries the FULL running transcript so far (system message if any, the
 * user task, every assistant `tool_calls` message, and every tool result
 * already executed in this turn — builtins and any auto-run MCP calls). The
 * frontend resends this array verbatim (plus, for an inline tool, one more
 * `{role:"tool", ...}` entry) as `AgentRunRequest.messages` to continue —
 * this is what lets `run()` resume without re-executing anything that
 * already ran (see `AgentRunRequest.messages` doc).
 */
export const AgentSseEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("step"), step: AgentStepSchema }),
  z.object({
    type: z.literal("tool_result_needed"),
    toolCallId: z.string(),
    name: z.string(),
    args: z.unknown(),
  }),
  z.object({
    type: z.literal("tool_approval"),
    toolCallId: z.string(),
    server: z.object({ id: z.string(), name: z.string() }),
    name: z.string(),
    args: z.unknown(),
  }),
  z.object({ type: z.literal("done"), messages: z.array(z.custom<ChatMessage>()).optional() }),
]);
export type AgentSseEvent = z.infer<typeof AgentSseEventSchema>;
