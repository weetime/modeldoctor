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
});
