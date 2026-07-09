import { z } from "zod";
import { toolDefSchema } from "./agent.js";
import { ChatMessageContentPartSchema, ChatMessageSchema, ChatParamsSchema } from "./playground.js";

/**
 * Sampling-only subset of `ChatParamsSchema` — everything except `tools`,
 * `tool_choice` (the agent loop derives these itself from
 * `inlineTools`/`builtinTools`/`mcpServerIds`) and `stream` (the agent loop
 * always streams; there's no non-streaming mode to opt into).
 */
const AgentRunParamsSchema = ChatParamsSchema.pick({
  temperature: true,
  maxTokens: true,
  topP: true,
  frequencyPenalty: true,
  presencePenalty: true,
  seed: true,
  stop: true,
}).partial();

/**
 * Request body for `POST /api/playground/agent`.
 *
 * Split into its own module (rather than living in `agent.ts` alongside
 * `AgentSseEvent`) because it needs `ChatMessageSchema` from `playground.ts`,
 * which itself imports `toolDefSchema`/`ToolCallSchema` from `agent.ts` —
 * putting this schema in `agent.ts` directly would create an agent.ts ⇄
 * playground.ts circular import (a real problem under NodeNext ESM: the
 * first module's top-level `const` schema exports would still be in the
 * temporal dead zone when the second module's top-level code tries to read
 * them). This module sits "above" both and has no reverse dependency.
 *
 * `messages` carries the full running transcript for a *continuation*
 * request — see `AgentSseEvent`'s `tool_result_needed` doc comment for the
 * multi-request continuation model (inline tools with no server-side
 * executor). `task` is still required even on a continuation call; the
 * loop ignores it in favor of `messages` when the latter is present.
 *
 * Full-transcript continuation (Task 11 fix pass): `messages` here MUST be
 * the *exact* array the server handed back on `AgentSseEvent`'s `done.messages`
 * (see that field's doc) — the frontend does not rebuild it. When `run()`
 * sees this array end in an assistant message whose `tool_calls` aren't all
 * answered by a following `role: "tool"` message yet, it resolves ONLY the
 * unanswered ones (executing a newly-approved MCP tool when `autoRunMcp` is
 * now true, or re-pausing) before calling the model again — so builtins and
 * auto-run MCP tools that already executed in the paused turn are never
 * re-run on continuation.
 */
export const AgentRunRequestSchema = z.object({
  connectionId: z.string().min(1),
  /**
   * The user's task, either as plain text or as multimodal content parts
   * (Task 1+ unified playground — mirrors `ChatMessage.content`'s shape so
   * the same composer/attachment UI can feed both plain chat and the agent
   * loop). Non-empty either way: a string can't be `""`, an array can't be
   * `[]`.
   */
  task: z.union([z.string().min(1), z.array(ChatMessageContentPartSchema).min(1)]),
  systemPrompt: z.string().optional(),
  /** Ask the model to write a short plan before acting (first turn only). */
  planFirst: z.boolean().optional(),
  /**
   * Sampling params (temperature/maxTokens/topP/...) forwarded to the
   * upstream call, same fields as `PlaygroundChatRequest.params` minus
   * tools/tool_choice/stream — see `AgentRunParamsSchema` above.
   */
  params: AgentRunParamsSchema.optional(),
  maxSteps: z.number().int().min(1).max(50).default(12),
  /** Ad-hoc, hand-authored tools with no server-side executor. */
  inlineTools: z.array(toolDefSchema).optional(),
  /** Names of server-side builtins (see `BUILTIN_TOOLS`) to advertise. */
  builtinTools: z.array(z.string()).optional(),
  /** Full transcript so far — present on continuation requests. */
  messages: z.array(ChatMessageSchema).optional(),
  tool_choice: z.union([z.enum(["auto", "none", "required"]), z.record(z.unknown())]).optional(),
  /** IDs of user-owned McpServers to discover + advertise as tools (Task 11). */
  mcpServerIds: z.array(z.string()).optional(),
  /**
   * When true, MCP tool calls execute in-request via `McpClientService`
   * (same continuous multi-turn model as builtins). When false/omitted, an
   * MCP tool call instead emits a `tool_approval` event + `done` — the
   * frontend re-sends with `autoRunMcp: true` (or the approved result) to
   * continue, mirroring the `tool_result_needed` continuation model.
   */
  autoRunMcp: z.boolean().optional(),
});
export type AgentRunRequest = z.infer<typeof AgentRunRequestSchema>;
