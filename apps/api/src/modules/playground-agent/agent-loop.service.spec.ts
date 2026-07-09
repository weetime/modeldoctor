import type {
  AgentRunRequest,
  AgentSseEvent,
  AgentVerdict,
  ChatMessage,
} from "@modeldoctor/contracts";
import { describe, expect, it, vi } from "vitest";
import type { DecryptedConnection } from "../connection/connection.service.js";
import type { McpClientService } from "../mcp-client/mcp-client.service.js";
import type { DecryptedMcpServer, McpServerService } from "../mcp-server/mcp-server.service.js";
import type { AgentJudgeService } from "./agent-judge.service.js";
import { AgentLoopService } from "./agent-loop.service.js";
import * as builtinToolsModule from "./builtin-tools.js";

const SAMPLE_VERDICT: AgentVerdict = {
  taskCompleted: true,
  toolUseCorrect: true,
  extraSteps: 0,
  oneLineVerdict: "Agent solved the task correctly.",
};

function fakeAgentJudgeService(judge: AgentJudgeService["judge"]): AgentJudgeService {
  return { judge } as unknown as AgentJudgeService;
}

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

/** Extracts the `tools` array passed to a given callModel mock call (0-indexed). */
function toolsAt(mock: ReturnType<typeof vi.fn>, callIndex: number): unknown[] {
  const call = mock.mock.calls[callIndex] as [DecryptedConnection, { tools?: unknown[] }];
  return call[1].tools ?? [];
}

function fakeMcpServer(overrides: Partial<DecryptedMcpServer> = {}): DecryptedMcpServer {
  return {
    id: "mcp_1",
    name: "higress-gw",
    url: "https://higress.local/mcp",
    headers: "",
    authToken: "",
    ...overrides,
  };
}

function fakeMcpClient(): McpClientService {
  return {
    discoverTools: vi.fn(),
    callTool: vi.fn(),
  } as unknown as McpClientService;
}

function fakeMcpServerService(): McpServerService {
  return {
    getOwnedDecrypted: vi.fn(),
  } as unknown as McpServerService;
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
          {
            id: "call_1",
            type: "function",
            function: { name: "get_current_time", arguments: "{}" },
          },
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
        step: {
          kind: "tool_call",
          name: "my_custom_tool",
          args: { foo: "bar" },
          toolCallId: "call_9",
          tMs: expect.any(Number),
        },
      },
      {
        type: "tool_result_needed",
        toolCallId: "call_9",
        name: "my_custom_tool",
        args: { foo: "bar" },
      },
      {
        type: "done",
        // Full-transcript continuation (Task 11 fix pass): `done` carries the
        // transcript so far — here just the user task + the assistant's
        // tool_calls message, since the one call in this turn is the inline
        // tool that never got a `role: "tool"` answer.
        messages: [
          { role: "user", content: "what time is it?" },
          {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call_9",
                type: "function",
                function: { name: "my_custom_tool", arguments: '{"foo":"bar"}' },
              },
            ],
          },
        ],
      },
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
    await svc.run(fakeConnection(), baseReq({ builtinTools: ["calculator"] }), (e) =>
      events.push(e),
    );

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
      Number.isNaN(
        new Date(String((toolResultStep.step as { content?: unknown }).content)).getTime(),
      ),
    ).toBe(false);
    expect(stepEvents[2]).toMatchObject({
      step: {
        kind: "tool_call",
        name: "my_custom_tool",
        args: { foo: "bar" },
        toolCallId: "call_i",
      },
    });

    expect(events).toContainEqual({
      type: "tool_result_needed",
      toolCallId: "call_i",
      name: "my_custom_tool",
      args: { foo: "bar" },
    });
    // Full-transcript continuation: `done.messages` must include the
    // builtin's already-executed tool result (not just the assistant's
    // tool_calls message) — this is exactly what lets a resumed request
    // skip re-running it.
    const doneEvent = events.at(-1) as Extract<AgentSseEvent, { type: "done" }>;
    expect(doneEvent.type).toBe("done");
    expect(doneEvent.messages).toEqual([
      { role: "user", content: "what time is it?" },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call_b",
            type: "function",
            function: { name: "get_current_time", arguments: "{}" },
          },
          {
            id: "call_i",
            type: "function",
            function: { name: "my_custom_tool", arguments: '{"foo":"bar"}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_b", content: expect.any(String) },
    ]);
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
      step: {
        kind: "tool_call",
        name: "my_custom_tool",
        args: { foo: "bar" },
        toolCallId: "call_i",
      },
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
    const doneEvent = events.at(-1) as Extract<AgentSseEvent, { type: "done" }>;
    expect(doneEvent.type).toBe("done");
    expect(doneEvent.messages).toEqual([
      { role: "user", content: "what time is it?" },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call_i",
            type: "function",
            function: { name: "my_custom_tool", arguments: '{"foo":"bar"}' },
          },
          {
            id: "call_b",
            type: "function",
            function: { name: "get_current_time", arguments: "{}" },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_b", content: expect.any(String) },
    ]);
  });

  // ─── MCP wiring (Task 11) ────────────────────────────────────────────────

  it("G: autoRunMcp=true executes the discovered MCP tool via callTool, feeds the result back, and continues the loop", async () => {
    const mcpClient = fakeMcpClient();
    const mcpServerService = fakeMcpServerService();
    (mcpServerService.getOwnedDecrypted as ReturnType<typeof vi.fn>).mockResolvedValue(
      fakeMcpServer(),
    );
    (mcpClient.discoverTools as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        name: "search",
        description: "Search docs",
        inputSchema: { type: "object", properties: {} },
      },
    ]);
    (mcpClient.callTool as ReturnType<typeof vi.fn>).mockResolvedValue("search result text");

    const svc = new AgentLoopService(mcpClient, mcpServerService);
    svc.callModel = vi
      .fn()
      .mockResolvedValueOnce({
        content: "",
        usage: undefined,
        tool_calls: [
          {
            id: "call_mcp",
            type: "function",
            function: { name: "mcp__mcp_1__search", arguments: '{"q":"x"}' },
          },
        ],
      })
      .mockResolvedValueOnce({
        content: "Here's what I found.",
        usage: undefined,
        tool_calls: undefined,
      });

    const events: AgentSseEvent[] = [];
    await svc.run(
      fakeConnection(),
      baseReq({ mcpServerIds: ["mcp_1"], autoRunMcp: true }),
      (e) => events.push(e),
      undefined,
      undefined,
      "user_1",
    );

    expect(mcpServerService.getOwnedDecrypted).toHaveBeenCalledWith("user_1", "mcp_1");
    expect(mcpClient.discoverTools).toHaveBeenCalledWith(fakeMcpServer());
    expect(mcpClient.callTool).toHaveBeenCalledWith(fakeMcpServer(), "search", { q: "x" });

    // The discovered tool was advertised to the model, namespaced.
    const advertisedTools = toolsAt(
      svc.callModel as unknown as ReturnType<typeof vi.fn>,
      0,
    ) as Array<{
      function: { name: string };
    }>;
    expect(advertisedTools.map((t) => t.function.name)).toContain("mcp__mcp_1__search");

    const kinds = events
      .filter((e): e is Extract<AgentSseEvent, { type: "step" }> => e.type === "step")
      .map((e) => e.step.kind);
    expect(kinds).toEqual(["tool_call", "tool_result", "assistant"]);
    expect(events.at(-1)).toEqual({ type: "done" });

    const secondCallMessages = lastMessages(svc.callModel as unknown as ReturnType<typeof vi.fn>);
    const toolMsg = secondCallMessages.find((m) => m.role === "tool");
    expect(toolMsg?.tool_call_id).toBe("call_mcp");
    expect(toolMsg?.content).toBe("search result text");
  });

  it("M: a large MCP result is truncated in the model-facing message but the emitted step keeps the full content", async () => {
    const huge = "x".repeat(20000); // > MAX_TOOL_RESULT_CHARS (8000)
    const mcpClient = fakeMcpClient();
    const mcpServerService = fakeMcpServerService();
    (mcpServerService.getOwnedDecrypted as ReturnType<typeof vi.fn>).mockResolvedValue(
      fakeMcpServer(),
    );
    (mcpClient.discoverTools as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: "list", description: "List", inputSchema: { type: "object", properties: {} } },
    ]);
    (mcpClient.callTool as ReturnType<typeof vi.fn>).mockResolvedValue(huge);

    const svc = new AgentLoopService(mcpClient, mcpServerService);
    svc.callModel = vi
      .fn()
      .mockResolvedValueOnce({
        content: "",
        usage: undefined,
        tool_calls: [
          {
            id: "call_mcp",
            type: "function",
            function: { name: "mcp__mcp_1__list", arguments: "{}" },
          },
        ],
      })
      .mockResolvedValueOnce({ content: "done.", usage: undefined, tool_calls: undefined });

    const events: AgentSseEvent[] = [];
    await svc.run(
      fakeConnection(),
      baseReq({ mcpServerIds: ["mcp_1"], autoRunMcp: true }),
      (e) => events.push(e),
      undefined,
      undefined,
      "user_1",
    );

    // The UI step keeps the FULL result for inspection.
    const resultStep = events.find(
      (e): e is Extract<AgentSseEvent, { type: "step" }> =>
        e.type === "step" && e.step.kind === "tool_result",
    );
    expect(resultStep?.step.content).toBe(huge);

    // The model-facing tool message is truncated to the cap + a marker.
    const secondCallMessages = lastMessages(svc.callModel as unknown as ReturnType<typeof vi.fn>);
    const toolContent = secondCallMessages.find((m) => m.role === "tool")?.content as string;
    expect(toolContent.length).toBeLessThan(huge.length);
    expect(toolContent.startsWith("x".repeat(8000))).toBe(true);
    expect(toolContent).toContain("[truncated:");
  });

  it("H: autoRunMcp=false (default) emits tool_approval + done without ever calling callTool", async () => {
    const mcpClient = fakeMcpClient();
    const mcpServerService = fakeMcpServerService();
    (mcpServerService.getOwnedDecrypted as ReturnType<typeof vi.fn>).mockResolvedValue(
      fakeMcpServer({ id: "mcp_1", name: "higress-gw" }),
    );
    (mcpClient.discoverTools as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        name: "search",
        description: "Search docs",
        inputSchema: { type: "object", properties: {} },
      },
    ]);

    const svc = new AgentLoopService(mcpClient, mcpServerService);
    svc.callModel = vi.fn().mockResolvedValue({
      content: "",
      usage: undefined,
      tool_calls: [
        {
          id: "call_mcp",
          type: "function",
          function: { name: "mcp__mcp_1__search", arguments: '{"q":"x"}' },
        },
      ],
    });

    const events: AgentSseEvent[] = [];
    await svc.run(
      fakeConnection(),
      baseReq({ mcpServerIds: ["mcp_1"] }),
      (e) => events.push(e),
      undefined,
      undefined,
      "user_1",
    );

    expect(svc.callModel).toHaveBeenCalledTimes(1);
    expect(mcpClient.callTool).not.toHaveBeenCalled();
    expect(events).toContainEqual({
      type: "tool_approval",
      toolCallId: "call_mcp",
      server: { id: "mcp_1", name: "higress-gw" },
      name: "mcp__mcp_1__search",
      args: { q: "x" },
    });
    const doneEvent = events.at(-1) as Extract<AgentSseEvent, { type: "done" }>;
    expect(doneEvent.type).toBe("done");
    expect(doneEvent.messages).toEqual([
      { role: "user", content: "what time is it?" },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call_mcp",
            type: "function",
            function: { name: "mcp__mcp_1__search", arguments: '{"q":"x"}' },
          },
        ],
      },
    ]);
  });

  it("I: a server that fails discovery emits an error step but the run still completes normally", async () => {
    const mcpClient = fakeMcpClient();
    const mcpServerService = fakeMcpServerService();
    (mcpServerService.getOwnedDecrypted as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("boom: unreachable"),
    );

    const svc = new AgentLoopService(mcpClient, mcpServerService);
    svc.callModel = vi.fn().mockResolvedValue({
      content: "All good, no tools needed.",
      usage: undefined,
      tool_calls: undefined,
    });

    const events: AgentSseEvent[] = [];
    await svc.run(
      fakeConnection(),
      baseReq({ mcpServerIds: ["mcp_bad"] }),
      (e) => events.push(e),
      undefined,
      undefined,
      "user_1",
    );

    expect(mcpClient.discoverTools).not.toHaveBeenCalled();
    const errorStep = events.find(
      (e): e is Extract<AgentSseEvent, { type: "step" }> =>
        e.type === "step" && e.step.kind === "error",
    );
    expect(errorStep?.step.content).toMatch(/mcp_bad/);
    expect(errorStep?.step.content).toMatch(/boom: unreachable/);

    const assistantStep = events.find(
      (e): e is Extract<AgentSseEvent, { type: "step" }> =>
        e.type === "step" && e.step.kind === "assistant",
    );
    expect(assistantStep?.step.content).toBe("All good, no tools needed.");
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  // ─── Full-transcript continuation / resume (Task 11 fix pass) ─────────────

  it("J: [builtin, mcp-needs-approval] pauses with the builtin result in done.messages; resuming with autoRunMcp=true executes ONLY the approved MCP tool (builtin never re-runs)", async () => {
    const executeBuiltinSpy = vi.spyOn(builtinToolsModule, "executeBuiltin");

    const mcpClient = fakeMcpClient();
    const mcpServerService = fakeMcpServerService();
    (mcpServerService.getOwnedDecrypted as ReturnType<typeof vi.fn>).mockResolvedValue(
      fakeMcpServer({ id: "mcp_1", name: "higress-gw" }),
    );
    (mcpClient.discoverTools as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        name: "search",
        description: "Search docs",
        inputSchema: { type: "object", properties: {} },
      },
    ]);

    const svc = new AgentLoopService(mcpClient, mcpServerService);

    // ── First request: model asks for a builtin + an MCP tool in one turn.
    svc.callModel = vi.fn().mockResolvedValueOnce({
      content: "",
      usage: undefined,
      tool_calls: [
        { id: "call_b", type: "function", function: { name: "get_current_time", arguments: "{}" } },
        {
          id: "call_mcp",
          type: "function",
          function: { name: "mcp__mcp_1__search", arguments: '{"q":"x"}' },
        },
      ],
    });

    const firstEvents: AgentSseEvent[] = [];
    await svc.run(
      fakeConnection(),
      baseReq({ builtinTools: ["get_current_time"], mcpServerIds: ["mcp_1"] }),
      (e) => firstEvents.push(e),
      undefined,
      undefined,
      "user_1",
    );

    expect(svc.callModel).toHaveBeenCalledTimes(1);
    expect(executeBuiltinSpy).toHaveBeenCalledTimes(1);
    expect(mcpClient.callTool).not.toHaveBeenCalled();
    expect(firstEvents).toContainEqual({
      type: "tool_approval",
      toolCallId: "call_mcp",
      server: { id: "mcp_1", name: "higress-gw" },
      name: "mcp__mcp_1__search",
      args: { q: "x" },
    });

    const firstDone = firstEvents.at(-1) as Extract<AgentSseEvent, { type: "done" }>;
    expect(firstDone.type).toBe("done");
    const transcript = firstDone.messages as ChatMessage[];
    // The builtin already executed — its result MUST be in the handed-back
    // transcript so the resume never has to (and doesn't) re-run it.
    expect(transcript).toEqual([
      { role: "user", content: "what time is it?" },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call_b",
            type: "function",
            function: { name: "get_current_time", arguments: "{}" },
          },
          {
            id: "call_mcp",
            type: "function",
            function: { name: "mcp__mcp_1__search", arguments: '{"q":"x"}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_b", content: expect.any(String) },
    ]);

    // ── Second request: frontend "approve" resend — same transcript,
    // autoRunMcp now true. The builtin's tool_call has no unanswered
    // sibling other than the MCP one, so only the MCP tool should execute.
    (mcpClient.callTool as ReturnType<typeof vi.fn>).mockResolvedValue("search result text");
    svc.callModel = vi.fn().mockResolvedValueOnce({
      content: "Done both.",
      usage: undefined,
      tool_calls: undefined,
    });

    const secondEvents: AgentSseEvent[] = [];
    await svc.run(
      fakeConnection(),
      baseReq({
        builtinTools: ["get_current_time"],
        mcpServerIds: ["mcp_1"],
        autoRunMcp: true,
        messages: transcript,
      }),
      (e) => secondEvents.push(e),
      undefined,
      undefined,
      "user_1",
    );

    // The builtin executor is still called exactly once in total — the
    // resume must NOT re-execute it, only the newly-approved MCP tool runs.
    expect(executeBuiltinSpy).toHaveBeenCalledTimes(1);
    expect(mcpClient.callTool).toHaveBeenCalledTimes(1);
    expect(mcpClient.callTool).toHaveBeenCalledWith(
      expect.objectContaining({ id: "mcp_1" }),
      "search",
      { q: "x" },
    );

    // Resume must NOT restart from turn 0 — the model is called exactly
    // once more (the turn that concludes the run), not from scratch.
    expect(svc.callModel).toHaveBeenCalledTimes(1);

    // The already-shown `tool_call` step for the builtin/MCP calls is not
    // re-emitted on resume (it's already in the frontend's persisted
    // trace) — only the MCP tool's result and the final assistant turn are.
    const secondSteps = secondEvents.filter(
      (e): e is Extract<AgentSseEvent, { type: "step" }> => e.type === "step",
    );
    expect(secondSteps.map((e) => e.step.kind)).toEqual(["tool_result", "assistant"]);
    expect(secondSteps[0]).toMatchObject({
      step: {
        kind: "tool_result",
        name: "mcp__mcp_1__search",
        toolCallId: "call_mcp",
        content: "search result text",
      },
    });
    expect(secondSteps[1]).toMatchObject({ step: { kind: "assistant", content: "Done both." } });

    // Normal completion (no further pause) — `done` carries no `messages`.
    expect(secondEvents.at(-1)).toEqual({ type: "done" });

    executeBuiltinSpy.mockRestore();
  });

  it("K: an mcp__<serverId>__tool naming a server NOT in mcpServerIds/not owned is rejected with an error step, callTool is never called, and the run continues", async () => {
    const mcpClient = fakeMcpClient();
    const mcpServerService = fakeMcpServerService();
    (mcpServerService.getOwnedDecrypted as ReturnType<typeof vi.fn>).mockResolvedValue(
      fakeMcpServer({ id: "mcp_1", name: "higress-gw" }),
    );
    (mcpClient.discoverTools as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        name: "search",
        description: "Search docs",
        inputSchema: { type: "object", properties: {} },
      },
    ]);

    const svc = new AgentLoopService(mcpClient, mcpServerService);
    svc.callModel = vi
      .fn()
      .mockResolvedValueOnce({
        content: "",
        usage: undefined,
        tool_calls: [
          {
            id: "call_bad",
            type: "function",
            // Names a server ("mcp_2") never discovered/owned — only
            // "mcp_1" was requested via mcpServerIds below.
            function: { name: "mcp__mcp_2__search", arguments: '{"q":"y"}' },
          },
        ],
      })
      .mockResolvedValueOnce({
        content: "Handled the rejection and moved on.",
        usage: undefined,
        tool_calls: undefined,
      });

    const events: AgentSseEvent[] = [];
    await svc.run(
      fakeConnection(),
      baseReq({ mcpServerIds: ["mcp_1"], autoRunMcp: true }),
      (e) => events.push(e),
      undefined,
      undefined,
      "user_1",
    );

    expect(mcpClient.callTool).not.toHaveBeenCalled();
    const errorStep = events.find(
      (e): e is Extract<AgentSseEvent, { type: "step" }> =>
        e.type === "step" && e.step.kind === "error" && e.step.toolCallId === "call_bad",
    );
    expect(errorStep?.step.content).toMatch(/unknown or unavailable MCP server\/tool/i);

    // Rejecting one unknown-server call is not a pause condition — the loop
    // continues to a second model turn and finishes normally.
    expect(svc.callModel).toHaveBeenCalledTimes(2);
    expect(events.at(-1)).toEqual({ type: "done" });

    const secondCallMessages = lastMessages(svc.callModel as unknown as ReturnType<typeof vi.fn>);
    const toolMsg = secondCallMessages.find(
      (m) => m.role === "tool" && m.tool_call_id === "call_bad",
    );
    expect(toolMsg?.content).toMatch(/unknown or unavailable MCP server\/tool/i);
  });

  // Task 13: lightweight trajectory judge — emitted on TRUE completion only.
  it("G: on normal completion (no more tool_calls) with a judge configured, emits verdict then done", async () => {
    const judgeFn = vi.fn().mockResolvedValue(SAMPLE_VERDICT);
    const svc = new AgentLoopService(undefined, undefined, fakeAgentJudgeService(judgeFn));
    svc.callModel = vi.fn().mockResolvedValueOnce({
      content: "The answer is 2.",
      usage: undefined,
      tool_calls: undefined,
    });

    const events: AgentSseEvent[] = [];
    await svc.run(fakeConnection(), baseReq(), (e) => events.push(e));

    expect(judgeFn).toHaveBeenCalledTimes(1);
    expect(judgeFn.mock.calls[0][0].task).toBe("what time is it?");
    // The final assistant turn's content isn't pushed into `messages` on
    // this path — the judge input must still carry it.
    expect(judgeFn.mock.calls[0][0].messages).toContainEqual({
      role: "assistant",
      content: "The answer is 2.",
    });

    expect(events).toEqual([
      {
        type: "step",
        step: { kind: "assistant", content: "The answer is 2.", tMs: expect.any(Number) },
      },
      { type: "verdict", verdict: SAMPLE_VERDICT },
      { type: "done" },
    ]);
  });

  it("H: reaching maxSteps also judges the trajectory (true completion, not a pause)", async () => {
    const judgeFn = vi.fn().mockResolvedValue(SAMPLE_VERDICT);
    const svc = new AgentLoopService(undefined, undefined, fakeAgentJudgeService(judgeFn));
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

    expect(judgeFn).toHaveBeenCalledTimes(1);
    const verdictIdx = events.findIndex((e) => e.type === "verdict");
    const doneIdx = events.findIndex((e) => e.type === "done");
    expect(verdictIdx).toBeGreaterThanOrEqual(0);
    expect(verdictIdx).toBeLessThan(doneIdx);
  });

  it("I: NO verdict is emitted when the run pauses for an inline tool_result_needed", async () => {
    const judgeFn = vi.fn().mockResolvedValue(SAMPLE_VERDICT);
    const svc = new AgentLoopService(undefined, undefined, fakeAgentJudgeService(judgeFn));
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

    expect(judgeFn).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === "verdict")).toBe(false);
  });

  it("J: NO verdict is emitted when the run pauses for an MCP tool_approval", async () => {
    const judgeFn = vi.fn().mockResolvedValue(SAMPLE_VERDICT);
    const mcpClient = fakeMcpClient();
    const mcpServerService = fakeMcpServerService();
    (mcpServerService.getOwnedDecrypted as ReturnType<typeof vi.fn>).mockResolvedValue(
      fakeMcpServer(),
    );
    (mcpClient.discoverTools as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: "search", description: "search", inputSchema: { type: "object" } },
    ]);
    const svc = new AgentLoopService(mcpClient, mcpServerService, fakeAgentJudgeService(judgeFn));
    svc.callModel = vi.fn().mockResolvedValue({
      content: "",
      usage: undefined,
      tool_calls: [
        {
          id: "call_mcp",
          type: "function",
          function: { name: "mcp__mcp_1__search", arguments: '{"q":"x"}' },
        },
      ],
    });

    const events: AgentSseEvent[] = [];
    await svc.run(
      fakeConnection(),
      baseReq({ mcpServerIds: ["mcp_1"] }),
      (e) => events.push(e),
      undefined,
      undefined,
      "user_1",
    );

    expect(events.some((e) => e.type === "tool_approval")).toBe(true);
    expect(judgeFn).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === "verdict")).toBe(false);
  });

  it("K: NO verdict is emitted when the upstream model call fails", async () => {
    const judgeFn = vi.fn().mockResolvedValue(SAMPLE_VERDICT);
    const svc = new AgentLoopService(undefined, undefined, fakeAgentJudgeService(judgeFn));
    svc.callModel = vi.fn().mockRejectedValue(new Error("upstream 500: boom"));

    const events: AgentSseEvent[] = [];
    await svc.run(fakeConnection(), baseReq(), (e) => events.push(e));

    expect(judgeFn).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === "verdict")).toBe(false);
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("L: a judge that returns null (no provider / failure) emits no verdict event", async () => {
    const judgeFn = vi.fn().mockResolvedValue(null);
    const svc = new AgentLoopService(undefined, undefined, fakeAgentJudgeService(judgeFn));
    svc.callModel = vi.fn().mockResolvedValueOnce({
      content: "done.",
      usage: undefined,
      tool_calls: undefined,
    });

    const events: AgentSseEvent[] = [];
    await svc.run(fakeConnection(), baseReq(), (e) => events.push(e));

    expect(judgeFn).toHaveBeenCalledTimes(1);
    expect(events.some((e) => e.type === "verdict")).toBe(false);
    expect(events.at(-1)).toEqual({ type: "done" });
  });
});
