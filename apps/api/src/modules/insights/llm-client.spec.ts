// apps/api/src/modules/insights/llm-client.spec.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { chatCompletion } from "./llm-client.js";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => fetchMock.mockReset());

describe("chatCompletion", () => {
  it("posts to /chat/completions with bearer auth", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "hi" } }] }),
    } as any);
    const r = await chatCompletion({ baseUrl: "https://x/v1", apiKey: "sk", model: "m" }, [
      { role: "user", content: "hi" },
    ]);
    expect(r.content).toBe("hi");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://x/v1/chat/completions");
    expect((init as any).headers.authorization).toBe("Bearer sk");
  });

  it("throws on non-200", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, text: async () => "bad key" } as any);
    await expect(
      chatCompletion({ baseUrl: "https://x", apiKey: "k", model: "m" }, []),
    ).rejects.toThrow(/HTTP 401/);
  });

  it("anthropic style posts to /v1/messages with x-api-key, hoists system, no temperature", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: "pong" }] }),
    } as any);
    const r = await chatCompletion(
      {
        baseUrl: "https://api.anthropic.com",
        apiKey: "sk-ant",
        model: "claude-opus-4-8",
        apiStyle: "anthropic",
      },
      [
        { role: "system", content: "be terse" },
        { role: "user", content: "ping" },
      ],
    );
    expect(r.content).toBe("pong");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const headers = (init as any).headers;
    expect(headers["x-api-key"]).toBe("sk-ant");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers.authorization).toBeUndefined();
    const body = JSON.parse((init as any).body);
    expect(body.system).toBe("be terse");
    expect(body.messages).toEqual([{ role: "user", content: "ping" }]);
    expect(body.max_tokens).toBeGreaterThan(0);
    expect(body.temperature).toBeUndefined();
  });

  it("anthropic style concatenates only text blocks", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [
          { type: "thinking", thinking: "" },
          { type: "text", text: "a" },
          { type: "text", text: "b" },
        ],
      }),
    } as any);
    const r = await chatCompletion(
      { baseUrl: "https://api.anthropic.com", apiKey: "k", model: "m", apiStyle: "anthropic" },
      [{ role: "user", content: "x" }],
    );
    expect(r.content).toBe("ab");
  });
});
