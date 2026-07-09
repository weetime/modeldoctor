import { describe, expect, it } from "vitest";
import {
  accumulateToolCallDelta,
  readStreamingChatCompletion,
  type StreamingToolCall,
} from "./streaming.js";

/** Builds a fake streaming `Response` whose body emits `chunks` in order. */
function fakeStreamResponse(chunks: string[]): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      },
    }),
  );
}

describe("accumulateToolCallDelta", () => {
  it("accumulates id/name from the first fragment and appends arguments across fragments, by index", () => {
    const acc: StreamingToolCall[] = [];
    accumulateToolCallDelta(acc, {
      index: 0,
      id: "c1",
      function: { name: "f", arguments: '{"a":' },
    });
    accumulateToolCallDelta(acc, { index: 0, function: { arguments: "1}" } });
    accumulateToolCallDelta(acc, { index: 1, id: "c2", function: { name: "g", arguments: "{}" } });

    expect(acc).toEqual([
      { id: "c1", type: "function", function: { name: "f", arguments: '{"a":1}' } },
      { id: "c2", type: "function", function: { name: "g", arguments: "{}" } },
    ]);
  });

  it("overwrites id/name only when the delta provides them, never clears them on later fragments", () => {
    const acc: StreamingToolCall[] = [];
    accumulateToolCallDelta(acc, { index: 0, id: "c1", function: { name: "f", arguments: "" } });
    accumulateToolCallDelta(acc, { index: 0, function: { arguments: "x" } });
    expect(acc[0]).toEqual({ id: "c1", type: "function", function: { name: "f", arguments: "x" } });
  });

  it("creates a slot with empty defaults when a delta has no id/function at all", () => {
    const acc: StreamingToolCall[] = [];
    accumulateToolCallDelta(acc, { index: 0 });
    expect(acc[0]).toEqual({ id: "", type: "function", function: { name: "", arguments: "" } });
  });
});

describe("readStreamingChatCompletion — text content", () => {
  it("streams content deltas via onTextDelta and returns the joined content with no tool_calls", async () => {
    const res = fakeStreamResponse([
      'data: {"choices":[{"delta":{"content":"He"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"llo"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const seen: string[] = [];
    const result = await readStreamingChatCompletion(res, (s) => seen.push(s));

    expect(seen).toEqual(["He", "llo"]);
    expect(result).toEqual({ content: "Hello", reasoning: "", tool_calls: [] });
  });

  it("stops at [DONE] without requiring the reader to report done", async () => {
    const res = fakeStreamResponse([
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const result = await readStreamingChatCompletion(res, () => {});
    expect(result.content).toBe("hi");
  });
});

describe("readStreamingChatCompletion — reasoning (chain-of-thought)", () => {
  it("streams `reasoning` deltas (before content) via onReasoningDelta and returns joined reasoning", async () => {
    // Reasoning models (Qwen3 / some gateways) emit thinking in `delta.reasoning`
    // FIRST, then the answer in `delta.content`.
    const res = fakeStreamResponse([
      'data: {"choices":[{"delta":{"reasoning":"Let me "}}]}\n\n',
      'data: {"choices":[{"delta":{"reasoning":"think."}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Blue."}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const text: string[] = [];
    const reason: string[] = [];
    const result = await readStreamingChatCompletion(
      res,
      (s) => text.push(s),
      (s) => reason.push(s),
    );

    expect(reason).toEqual(["Let me ", "think."]);
    expect(text).toEqual(["Blue."]);
    expect(result).toEqual({ content: "Blue.", reasoning: "Let me think.", tool_calls: [] });
  });

  it("also reads the vLLM `reasoning_content` field name", async () => {
    const res = fakeStreamResponse([
      'data: {"choices":[{"delta":{"reasoning_content":"hmm"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const reason: string[] = [];
    const result = await readStreamingChatCompletion(
      res,
      () => {},
      (s) => reason.push(s),
    );
    expect(reason).toEqual(["hmm"]);
    expect(result.reasoning).toBe("hmm");
  });
});

describe("readStreamingChatCompletion — tool_calls", () => {
  it("assembles tool_calls fragmented across multiple SSE records, with empty content", async () => {
    const res = fakeStreamResponse([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"get_weather","arguments":"{\\"loc"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ation\\":\\"NYC\\"}"}}]}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const result = await readStreamingChatCompletion(res, () => {});

    expect(result.content).toBe("");
    expect(result.tool_calls).toEqual([
      {
        id: "call_1",
        type: "function",
        function: { name: "get_weather", arguments: '{"location":"NYC"}' },
      },
    ]);
  });

  it("assembles multiple concurrent tool_calls by their distinct index", async () => {
    const res = fakeStreamResponse([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"f","arguments":"{}"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"c2","function":{"name":"g","arguments":"{}"}}]}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const result = await readStreamingChatCompletion(res, () => {});
    expect(result.tool_calls).toEqual([
      { id: "c1", type: "function", function: { name: "f", arguments: "{}" } },
      { id: "c2", type: "function", function: { name: "g", arguments: "{}" } },
    ]);
  });
});

describe("readStreamingChatCompletion — robustness", () => {
  it("parses a record split across two reader chunks (half a JSON line each)", async () => {
    const full = 'data: {"choices":[{"delta":{"content":"He"}}]}\n\n';
    const splitAt = 20; // arbitrary mid-JSON split point
    const chunkA = full.slice(0, splitAt);
    const chunkB = full.slice(splitAt);
    const res = fakeStreamResponse([chunkA, chunkB, "data: [DONE]\n\n"]);

    const seen: string[] = [];
    const result = await readStreamingChatCompletion(res, (s) => seen.push(s));
    expect(seen).toEqual(["He"]);
    expect(result.content).toBe("He");
  });

  it("skips a malformed JSON record without throwing, continuing to the next valid record", async () => {
    const res = fakeStreamResponse([
      "data: {not valid json\n\n",
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const result = await readStreamingChatCompletion(res, () => {});
    expect(result.content).toBe("ok");
  });

  it("skips an SSE comment record (no data: prefix) without throwing", async () => {
    const res = fakeStreamResponse([
      ": heartbeat\n\n",
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const result = await readStreamingChatCompletion(res, () => {});
    expect(result.content).toBe("ok");
  });

  it("returns cleanly when the stream ends without an explicit [DONE] record", async () => {
    const res = fakeStreamResponse(['data: {"choices":[{"delta":{"content":"end"}}]}\n\n']);
    const result = await readStreamingChatCompletion(res, () => {});
    expect(result.content).toBe("end");
  });
});
