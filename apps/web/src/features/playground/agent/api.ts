import type { AgentRunRequest, AgentSseEvent, ChatMessage } from "@modeldoctor/contracts";
import { playgroundFetchStream } from "@/lib/playground-stream";

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
 * Full-transcript continuation (Task 11 fix pass): appends one
 * `{role:"tool", tool_call_id, content}` entry — the user-supplied result
 * for a `tool_result_needed` inline tool — onto the server-authoritative
 * `continuationMessages` transcript carried by the pausing `done` event.
 * The server seeds `messages` from this array verbatim on resume (see
 * `AgentRunRequest.messages` doc) rather than rebuilding it, so this MUST be
 * the exact array the server handed back, not a hand-rebuilt minimal one —
 * that's what lets the resume skip re-running anything (systemPrompt, prior
 * turns, already-executed builtins/MCP calls) that already happened.
 */
export function appendToolResultMessage(
  continuationMessages: ChatMessage[],
  toolCallId: string,
  resultContent: string,
): ChatMessage[] {
  return [
    ...continuationMessages,
    { role: "tool", tool_call_id: toolCallId, content: resultContent },
  ];
}
