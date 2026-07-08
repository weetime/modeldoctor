import { z } from "zod";
import { toolDefSchema } from "./agent.js";
import { ChatMessageSchema } from "./playground.js";

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
 */
export const AgentRunRequestSchema = z.object({
  connectionId: z.string().min(1),
  task: z.string().min(1),
  systemPrompt: z.string().optional(),
  /** Ask the model to write a short plan before acting (first turn only). */
  planFirst: z.boolean().optional(),
  maxSteps: z.number().int().min(1).max(50).default(12),
  /** Ad-hoc, hand-authored tools with no server-side executor. */
  inlineTools: z.array(toolDefSchema).optional(),
  /** Names of server-side builtins (see `BUILTIN_TOOLS`) to advertise. */
  builtinTools: z.array(z.string()).optional(),
  /** Full transcript so far — present on continuation requests. */
  messages: z.array(ChatMessageSchema).optional(),
  tool_choice: z.union([z.enum(["auto", "none", "required"]), z.record(z.unknown())]).optional(),
});
export type AgentRunRequest = z.infer<typeof AgentRunRequestSchema>;
