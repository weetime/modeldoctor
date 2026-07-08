import type { ChatMessage } from "@modeldoctor/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DecryptedLlmJudgeProvider, LlmJudgeService } from "../llm-judge/llm-judge.service.js";
import { AgentJudgeService } from "./agent-judge.service.js";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  fetchMock.mockReset();
});

function fakeProvider(
  overrides: Partial<DecryptedLlmJudgeProvider> = {},
): DecryptedLlmJudgeProvider {
  return {
    id: "judge_1",
    name: "default-judge",
    baseUrl: "https://judge.example.com/v1",
    apiKey: "sk-judge",
    model: "judge-model",
    apiStyle: "openai",
    enabled: true,
    isDefault: true,
    ...overrides,
  };
}

function fakeLlmJudgeService(getDecrypted: LlmJudgeService["getDecrypted"]): LlmJudgeService {
  return { getDecrypted } as unknown as LlmJudgeService;
}

function okResponse(content: string): Response {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
  } as unknown as Response;
}

const TRANSCRIPT: ChatMessage[] = [
  { role: "user", content: "what is 1+1?" },
  {
    role: "assistant",
    content: "",
    tool_calls: [
      {
        id: "call_1",
        type: "function",
        function: { name: "calculator", arguments: '{"expression":"1+1"}' },
      },
    ],
  },
  { role: "tool", tool_call_id: "call_1", content: "2" },
  { role: "assistant", content: "The answer is 2." },
];

const VERDICT_JSON = {
  taskCompleted: true,
  toolUseCorrect: true,
  extraSteps: 0,
  oneLineVerdict: "Agent solved the task correctly using the calculator tool.",
};

describe("AgentJudgeService", () => {
  it("returns null without calling fetch when no judge provider is configured", async () => {
    const judge = new AgentJudgeService(fakeLlmJudgeService(vi.fn().mockResolvedValue(null)));
    const result = await judge.judge({ task: "what is 1+1?", messages: TRANSCRIPT });
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null when the resolved provider is disabled", async () => {
    const judge = new AgentJudgeService(
      fakeLlmJudgeService(vi.fn().mockResolvedValue(fakeProvider({ enabled: false }))),
    );
    const result = await judge.judge({ task: "what is 1+1?", messages: TRANSCRIPT });
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("parses a strict-JSON verdict from the judge completion", async () => {
    fetchMock.mockResolvedValueOnce(okResponse(JSON.stringify(VERDICT_JSON)));
    const judge = new AgentJudgeService(
      fakeLlmJudgeService(vi.fn().mockResolvedValue(fakeProvider())),
    );
    const result = await judge.judge({ task: "what is 1+1?", messages: TRANSCRIPT });
    expect(result).toEqual(VERDICT_JSON);

    // Sanity-check the request actually went to the configured provider.
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://judge.example.com/v1/chat/completions");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-judge");
  });

  it("tolerates a ```json-fenced verdict body", async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse(
        `Here is my assessment:\n\`\`\`json\n${JSON.stringify(VERDICT_JSON)}\n\`\`\`\nThanks!`,
      ),
    );
    const judge = new AgentJudgeService(
      fakeLlmJudgeService(vi.fn().mockResolvedValue(fakeProvider())),
    );
    const result = await judge.judge({ task: "what is 1+1?", messages: TRANSCRIPT });
    expect(result).toEqual(VERDICT_JSON);
  });

  it("returns null (never throws) when the completion content is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(okResponse("I refuse to answer in JSON today."));
    const judge = new AgentJudgeService(
      fakeLlmJudgeService(vi.fn().mockResolvedValue(fakeProvider())),
    );
    await expect(judge.judge({ task: "what is 1+1?", messages: TRANSCRIPT })).resolves.toBeNull();
  });

  it("returns null (never throws) when the parsed JSON doesn't match the verdict schema", async () => {
    fetchMock.mockResolvedValueOnce(okResponse(JSON.stringify({ foo: "bar" })));
    const judge = new AgentJudgeService(
      fakeLlmJudgeService(vi.fn().mockResolvedValue(fakeProvider())),
    );
    await expect(judge.judge({ task: "what is 1+1?", messages: TRANSCRIPT })).resolves.toBeNull();
  });

  it("returns null (never throws) when the network call itself fails", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const judge = new AgentJudgeService(
      fakeLlmJudgeService(vi.fn().mockResolvedValue(fakeProvider())),
    );
    await expect(judge.judge({ task: "what is 1+1?", messages: TRANSCRIPT })).resolves.toBeNull();
  });

  it("returns null (never throws) when getDecrypted itself rejects", async () => {
    const judge = new AgentJudgeService(
      fakeLlmJudgeService(vi.fn().mockRejectedValue(new Error("db down"))),
    );
    await expect(judge.judge({ task: "what is 1+1?", messages: TRANSCRIPT })).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
