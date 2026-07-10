import { describe, expect, it } from "vitest";
import { buildPlaygroundChatBody, parsePlaygroundChatResponse } from "./chat.js";

describe("buildPlaygroundChatBody", () => {
  it("emits tools + tool_choice when present", () => {
    const body = buildPlaygroundChatBody({
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      params: {
        tools: [{ type: "function", function: { name: "t", parameters: {} } }],
        tool_choice: "auto",
      },
    });
    expect(body.tools).toBeDefined();
    expect(body.tool_choice).toBe("auto");
  });

  it("omits tools/tool_choice when absent (regression: unchanged for plain chat)", () => {
    const body = buildPlaygroundChatBody({ model: "m", messages: [], params: {} });
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
    expect("tools" in body).toBe(false);
    expect("tool_choice" in body).toBe(false);
  });

  it("plain-chat body is byte-identical to the pre-tool-calling shape", () => {
    const body = buildPlaygroundChatBody({
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      params: { temperature: 0.5, maxTokens: 100, stream: false },
    });
    expect(body).toEqual({
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      temperature: 0.5,
      max_tokens: 100,
      stream: false,
    });
  });

  it("does not emit tools when tool_choice is set without tools", () => {
    const body = buildPlaygroundChatBody({
      model: "m",
      messages: [],
      params: { tool_choice: "auto" },
    });
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
  });
});

describe("parsePlaygroundChatResponse", () => {
  it("reads tool_calls from choices[0].message when present", () => {
    const parsed = parsePlaygroundChatResponse({
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "get_weather", arguments: '{"city":"sf"}' },
              },
            ],
          },
        },
      ],
    });
    expect(parsed.tool_calls).toHaveLength(1);
    expect(parsed.tool_calls?.[0]?.function.name).toBe("get_weather");
  });

  it("leaves tool_calls undefined when absent (regression: plain content parse unchanged)", () => {
    const parsed = parsePlaygroundChatResponse({
      choices: [{ message: { content: "hello" } }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    });
    expect(parsed.content).toBe("hello");
    expect(parsed.usage).toEqual({ prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 });
    expect(parsed.tool_calls).toBeUndefined();
  });
});
