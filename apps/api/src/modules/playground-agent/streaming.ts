import type { ToolCall } from "@modeldoctor/contracts";

/**
 * In-progress accumulation slot for a streamed tool call. Same shape as the
 * contract `ToolCall`, kept as a separate local type because during
 * accumulation `arguments` is a partial (not-yet-valid-JSON) string being
 * built up fragment by fragment — the contract type is what we return once
 * accumulation is done, not what we hold mid-stream.
 */
export interface StreamingToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * One SSE chunk's fragment of a single tool call, keyed by `index` (its
 * position in the assistant message's `tool_calls[]`). Per the OpenAI
 * streaming chat-completions format: `id` and `function.name` are only
 * present on the FIRST fragment for a given index; every fragment
 * (including the first) carries a slice of `function.arguments` that must
 * be concatenated in order.
 */
export interface ToolCallDelta {
  index: number;
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

/**
 * Accumulates one `ToolCallDelta` fragment into `acc` (mutated in place),
 * keyed by `delta.index`. This is the classic streaming-tool-calls footgun:
 * `id`/`function.name` normally arrive ONLY on the first fragment for an
 * index, so they must be overwritten (not appended) when present, while
 * `function.arguments` arrives split across every fragment and must always
 * be string-appended to reconstruct the full JSON-encoded arguments.
 */
export function accumulateToolCallDelta(acc: StreamingToolCall[], delta: ToolCallDelta): void {
  const existing = acc[delta.index];
  if (!existing) {
    acc[delta.index] = {
      id: delta.id ?? "",
      type: "function",
      function: {
        name: delta.function?.name ?? "",
        arguments: delta.function?.arguments ?? "",
      },
    };
    return;
  }
  if (delta.id !== undefined) existing.id = delta.id;
  if (delta.function?.name !== undefined) existing.function.name = delta.function.name;
  if (delta.function?.arguments !== undefined)
    existing.function.arguments += delta.function.arguments;
}

/** Minimal shape read out of each SSE record's parsed JSON payload. */
interface StreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
      tool_calls?: ToolCallDelta[];
    };
  }>;
}

/**
 * Reads an OpenAI-style streaming chat-completions `Response` to completion,
 * calling `onTextDelta` for every `delta.content` fragment as it arrives and
 * accumulating `delta.tool_calls` fragments by index (see
 * `accumulateToolCallDelta`). Resolves once the stream ends (either a
 * `data: [DONE]` record or the underlying reader reports `done`) with the
 * fully assembled `{ content, tool_calls }`.
 *
 * SSE framing mirrors `apps/web/src/lib/playground-stream.ts`: records are
 * separated by a blank line (`\n\n`), each record's payload line is
 * prefixed with `data:`. Bytes are buffered across reader chunks so a
 * record split mid-JSON across two `reader.read()` calls is still parsed
 * correctly. A record that fails `JSON.parse` (or has no usable
 * `choices[0].delta`) is skipped rather than throwing, so one malformed/
 * comment record never aborts the whole stream.
 */
export async function readStreamingChatCompletion(
  upstream: Response,
  onTextDelta: (s: string) => void,
): Promise<{ content: string; tool_calls: ToolCall[] }> {
  if (!upstream.body) throw new Error("streaming response has no body");
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const toolCalls: StreamingToolCall[] = [];
  let content = "";
  let buf = "";

  const handleRecord = (record: string): boolean => {
    for (const line of record.split("\n")) {
      const trimmed = line.startsWith("data:") ? line.slice(5).trim() : line.trim();
      if (!trimmed) continue;
      if (trimmed === "[DONE]") return true;
      let parsed: StreamChunk;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue;
      }
      const delta = parsed?.choices?.[0]?.delta;
      if (!delta) continue;
      if (typeof delta.content === "string" && delta.content.length > 0) {
        content += delta.content;
        onTextDelta(delta.content);
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const tcDelta of delta.tool_calls) {
          accumulateToolCallDelta(toolCalls, tcDelta);
        }
      }
    }
    return false;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx = buf.indexOf("\n\n");
    while (idx !== -1) {
      const record = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      if (handleRecord(record)) return { content, tool_calls: finalizeToolCalls(toolCalls) };
      idx = buf.indexOf("\n\n");
    }
  }
  // Flush any trailing record that wasn't terminated by a final \n\n.
  if (buf.trim().length > 0) handleRecord(buf);

  return { content, tool_calls: finalizeToolCalls(toolCalls) };
}

/**
 * `toolCalls` is a sparse-by-index array populated via `acc[index] = ...`;
 * skip any hole (an index the upstream never actually sent a fragment for)
 * and map each slot to the contract `ToolCall` shape.
 */
function finalizeToolCalls(toolCalls: StreamingToolCall[]): ToolCall[] {
  return toolCalls
    .filter((tc): tc is StreamingToolCall => Boolean(tc))
    .map((tc) => ({
      id: tc.id,
      type: "function" as const,
      function: { name: tc.function.name, arguments: tc.function.arguments },
    }));
}
