import type { AgentRunRequest, AgentSseEvent, ChatMessage } from "@modeldoctor/contracts";
import { playgroundFetchStream } from "@/lib/playground-stream";
import type { PendingInlineTool } from "./store";

export const AGENT_PATH = "/api/playground/agent";

/**
 * Server-side builtin demo tools (mirrors `BUILTIN_TOOLS` in
 * `apps/api/src/modules/playground-agent/builtin-tools.ts`). Hardcoded here
 * rather than fetched — there's no list endpoint for builtins, and this trio
 * is stable/small enough that duplicating the names is cheaper than adding
 * one just for the picker.
 */
export const AGENT_BUILTIN_TOOL_NAMES = ["get_current_time", "calculator", "http_get"] as const;
export type AgentBuiltinToolName = (typeof AGENT_BUILTIN_TOOL_NAMES)[number];

/**
 * Runs one `POST /api/playground/agent` SSE request, forwarding each parsed
 * `AgentSseEvent` to `onEvent`. Non-JSON / malformed lines are ignored —
 * mirrors ChatPage's tolerant SSE parsing.
 */
export async function runAgentSse(
  body: AgentRunRequest,
  signal: AbortSignal,
  onEvent: (evt: AgentSseEvent) => void,
): Promise<void> {
  await playgroundFetchStream({
    path: AGENT_PATH,
    body,
    signal,
    onSseEvent: (data) => {
      try {
        onEvent(JSON.parse(data) as AgentSseEvent);
      } catch {
        // Ignore non-JSON SSE lines/comments.
      }
    },
  });
}

/**
 * Minimal continuation transcript for a resolved `tool_result_needed`
 * inline tool: the original task, the assistant's tool-call request, and the
 * tool result keyed by `toolCallId`. This is NOT a full replay of every step
 * emitted so far (the frontend only sees `AgentStep`s, not raw `ChatMessage`s)
 * — but it is enough for the loop to resume with the one tool result the
 * model was blocked on, which is the contract `tool_result_needed`'s doc
 * comment describes.
 */
export function buildContinuationMessages(
  task: string,
  pending: PendingInlineTool,
  resultContent: string,
): ChatMessage[] {
  return [
    { role: "user", content: task },
    {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: pending.toolCallId,
          type: "function",
          function: {
            name: pending.name,
            arguments: JSON.stringify(pending.args ?? {}),
          },
        },
      ],
    },
    { role: "tool", tool_call_id: pending.toolCallId, content: resultContent },
  ];
}
