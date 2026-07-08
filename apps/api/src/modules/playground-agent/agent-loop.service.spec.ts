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

  it("E: a turn with [builtin, inline] tool_calls executes the builtin AND flags the inline one, then done (regression for dropped trailing calls)", async () => {
    const svc = new AgentLoopService();
    svc.callModel = vi.fn().mockResolvedValue({
      content: "",
      usage: undefined,
      tool_calls: [
        { id: "call_b", type: "function", function: { name: "get_current_time", arguments: "{}" } },
        {
          id: "call_i",
          type: "function",
          function: { name: "my_custom_tool", arguments: '{"foo":"bar"}' },
        },
      ],
    });

    const events: AgentSseEvent[] = [];
    await svc.run(
      fakeConnection(),
      baseReq({
        builtinTools: ["get_current_time"],
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

    // Only one turn: the trailing inline tool ends the request, but the
    // leading builtin tool_call must still have been executed first.
    expect(svc.callModel).toHaveBeenCalledTimes(1);

    const stepEvents = events.filter(
      (e): e is Extract<AgentSseEvent, { type: "step" }> => e.type === "step",
    );
    expect(stepEvents.map((e) => e.step.kind)).toEqual(["tool_call", "tool_result", "tool_call"]);
    expect(stepEvents[0]).toMatchObject({
      step: { kind: "tool_call", name: "get_current_time", toolCallId: "call_b" },
    });
    const toolResultStep = stepEvents[1];
    expect(toolResultStep.step.kind).toBe("tool_result");
    expect(toolResultStep.step.toolCallId).toBe("call_b");
    expect(
      Number.isNaN(new Date(String((toolResultStep.step as { content?: unknown }).content)).getTime()),
    ).toBe(false);
    expect(stepEvents[2]).toMatchObject({
      step: { kind: "tool_call", name: "my_custom_tool", args: { foo: "bar" }, toolCallId: "call_i" },
    });

    expect(events).toContainEqual({
      type: "tool_result_needed",
      toolCallId: "call_i",
      name: "my_custom_tool",
      args: { foo: "bar" },
    });
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("F: a turn with [inline, builtin] tool_calls (reverse order) still executes the builtin AND flags the inline one, then done", async () => {
    const svc = new AgentLoopService();
    svc.callModel = vi.fn().mockResolvedValue({
      content: "",
      usage: undefined,
      tool_calls: [
        {
          id: "call_i",
          type: "function",
          function: { name: "my_custom_tool", arguments: '{"foo":"bar"}' },
        },
        { id: "call_b", type: "function", function: { name: "get_current_time", arguments: "{}" } },
      ],
    });

    const events: AgentSseEvent[] = [];
    await svc.run(
      fakeConnection(),
      baseReq({
        builtinTools: ["get_current_time"],
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

    const stepEvents = events.filter(
      (e): e is Extract<AgentSseEvent, { type: "step" }> => e.type === "step",
    );
    expect(stepEvents.map((e) => e.step.kind)).toEqual(["tool_call", "tool_call", "tool_result"]);
    expect(stepEvents[0]).toMatchObject({
      step: { kind: "tool_call", name: "my_custom_tool", args: { foo: "bar" }, toolCallId: "call_i" },
    });
    expect(stepEvents[1]).toMatchObject({
      step: { kind: "tool_call", name: "get_current_time", toolCallId: "call_b" },
    });
    const toolResultStep = stepEvents[2];
    expect(toolResultStep.step.kind).toBe("tool_result");
    expect(toolResultStep.step.toolCallId).toBe("call_b");

    // The builtin's result MUST still be executed (and fed back via
    // messages) even though the inline tool_call came first in the turn —
    // this is the exact ordering the pre-fix `return` inside the loop broke.
    expect(events).toContainEqual({
      type: "tool_result_needed",
      toolCallId: "call_i",
      name: "my_custom_tool",
      args: { foo: "bar" },
    });
    expect(events.at(-1)).toEqual({ type: "done" });
  });
});
