import type { AgentRunRequest, AgentSseEvent, ChatMessage } from "@modeldoctor/contracts";
import { describe, expect, it, vi } from "vitest";
import type { DecryptedConnection } from "../connection/connection.service.js";
import { AgentLoopService } from "./agent-loop.service.js";

function fakeConnection(): DecryptedConnection {
  return {
    id: "conn-1",
    name: "test",
    baseUrl: "https://upstream.example.com",
    apiKey: "sk-test",
    model: "test-model",
    customHeaders: "",
    queryParams: "",
    category: null,
    tokenizerHfId: null,
    prometheusDatasource: null,
    prometheusDatasourceId: null,
    serverKind: null,
  };
}

function baseReq(overrides: Partial<AgentRunRequest> = {}): AgentRunRequest {
  return {
    connectionId: "conn-1",
    task: "what time is it?",
    maxSteps: 12,
    ...overrides,
  };
}

/** Extracts the last `messages` array passed to a callModel mock call. */
function lastMessages(mock: ReturnType<typeof vi.fn>): ChatMessage[] {
  const call = mock.mock.calls.at(-1) as [DecryptedConnection, { messages: ChatMessage[] }];
  return call[1].messages;
}

describe("AgentLoopService", () => {
  it("A: executes a builtin tool_call, feeds the result back, and finishes with an assistant turn", async () => {
    const svc = new AgentLoopService();
    svc.callModel = vi
      .fn()
      .mockResolvedValueOnce({
        content: "",
        usage: undefined,
        tool_calls: [
          { id: "call_1", type: "function", function: { name: "get_current_time", arguments: "{}" } },
        ],
      })
      .mockResolvedValueOnce({
        content: "It is currently a valid ISO timestamp.",
        usage: undefined,
        tool_calls: undefined,
      });

    const events: AgentSseEvent[] = [];
    await svc.run(fakeConnection(), baseReq({ builtinTools: ["get_current_time"] }), (e) =>
      events.push(e),
    );

    expect(svc.callModel).toHaveBeenCalledTimes(2);

    const kinds = events
      .filter((e): e is Extract<AgentSseEvent, { type: "step" }> => e.type === "step")
      .map((e) => e.step.kind);
    expect(kinds).toEqual(["tool_call", "tool_result", "assistant"]);
    expect(events.at(-1)).toEqual({ type: "done" });

    // The tool result was fed back to the model as a `role: "tool"` message
    // on the second call, correlated to the original tool_call id.
    const secondCallMessages = lastMessages(svc.callModel as unknown as ReturnType<typeof vi.fn>);
    const toolMsg = secondCallMessages.find((m) => m.role === "tool");
    expect(toolMsg?.tool_call_id).toBe("call_1");
    expect(Number.isNaN(new Date(String(toolMsg?.content)).getTime())).toBe(false);
  });

  it("B: stops at maxSteps when the model keeps requesting tool_calls", async () => {
    const svc = new AgentLoopService();
    svc.callModel = vi.fn().mockResolvedValue({
      content: "",
      usage: undefined,
      tool_calls: [
        { id: "call_x", type: "function", function: { name: "get_current_time", arguments: "{}" } },
      ],
    });

    const events: AgentSseEvent[] = [];
    await svc.run(
      fakeConnection(),
      baseReq({ builtinTools: ["get_current_time"], maxSteps: 1 }),
      (e) => events.push(e),
    );

    expect(svc.callModel).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toEqual({ type: "done" });
    const errorStep = events.find(
      (e): e is Extract<AgentSseEvent, { type: "step" }> =>
        e.type === "step" && e.step.kind === "error",
    );
    expect(errorStep?.step.content).toMatch(/maxSteps/i);
  });

  it("C: an inline tool with no executor emits tool_result_needed + done and returns without looping", async () => {
    const svc = new AgentLoopService();
    svc.callModel = vi.fn().mockResolvedValue({
      content: "",
      usage: undefined,
      tool_calls: [
        {
          id: "call_9",
          type: "function",
          function: { name: "my_custom_tool", arguments: '{"foo":"bar"}' },
        },
      ],
    });

    const events: AgentSseEvent[] = [];
    await svc.run(
      fakeConnection(),
      baseReq({
        inlineTools: [
          {
            type: "function",
            function: {
              name: "my_custom_tool",
              description: "hand-authored, no server executor",
              parameters: { type: "object", properties: {} },
            },
          },
        ],
      }),
      (e) => events.push(e),
    );

    expect(svc.callModel).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      {
        type: "step",
        step: { kind: "tool_call", name: "my_custom_tool", args: { foo: "bar" }, toolCallId: "call_9", tMs: expect.any(Number) },
      },
      { type: "tool_result_needed", toolCallId: "call_9", name: "my_custom_tool", args: { foo: "bar" } },
      { type: "done" },
    ]);
  });

  it("D: a builtin throwing emits an error step, feeds the error back, and the loop continues gracefully", async () => {
    const svc = new AgentLoopService();
    svc.callModel = vi
      .fn()
      .mockResolvedValueOnce({
        content: "",
        usage: undefined,
        tool_calls: [
          {
            id: "call_5",
            type: "function",
            function: { name: "calculator", arguments: '{"expression":"1/0"}' },
          },
        ],
      })
      .mockResolvedValueOnce({
        content: "I can't divide by zero.",
        usage: undefined,
        tool_calls: undefined,
      });

    const events: AgentSseEvent[] = [];
    await svc.run(fakeConnection(), baseReq({ builtinTools: ["calculator"] }), (e) => events.push(e));

    expect(svc.callModel).toHaveBeenCalledTimes(2);
    const errorStep = events.find(
      (e): e is Extract<AgentSseEvent, { type: "step" }> =>
        e.type === "step" && e.step.kind === "error",
    );
    expect(errorStep?.step.content).toMatch(/division by zero/i);
    expect(events.at(-1)).toEqual({ type: "done" });

    const secondCallMessages = lastMessages(svc.callModel as unknown as ReturnType<typeof vi.fn>);
    const toolMsg = secondCallMessages.find((m) => m.role === "tool");
    expect(toolMsg?.content).toMatch(/^error:/);
  });
});
