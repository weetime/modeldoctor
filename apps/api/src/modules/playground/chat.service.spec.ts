import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatService } from "./chat.service.js";

describe("ChatService.run", () => {
  let svc: ChatService;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    svc = new ChatService();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to {apiBaseUrl}/v1/chat/completions with Bearer auth and OpenAI body shape", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "hello back", role: "assistant" } }],
          usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const out = await svc.run({
      apiBaseUrl: "http://upstream.test",
      apiKey: "sk-1",
      model: "m1",
      messages: [{ role: "user", content: "hello" }],
      params: {},
    });

    expect(out.success).toBe(true);
    expect(out.content).toBe("hello back");
    expect(out.usage?.total_tokens).toBe(12);
    expect(out.latencyMs).toBeGreaterThanOrEqual(0);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://upstream.test/v1/chat/completions");
    expect((init as RequestInit).method).toBe("POST");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-1");
    expect(headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe("m1");
    expect(body.messages).toEqual([{ role: "user", content: "hello" }]);
  });

  it("honours pathOverride", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }),
    );
    await svc.run({
      apiBaseUrl: "http://x",
      apiKey: "k",
      model: "m",
      pathOverride: "/custom/chat",
      messages: [{ role: "user", content: "h" }],
      params: {},
    });
    expect(fetchMock.mock.calls[0][0]).toBe("http://x/custom/chat");
  });

  it("maps OpenAI-style snake_case params from camelCase", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }),
    );
    await svc.run({
      apiBaseUrl: "http://x",
      apiKey: "k",
      model: "m",
      messages: [{ role: "user", content: "h" }],
      params: {
        temperature: 0.7,
        maxTokens: 256,
        topP: 0.9,
        frequencyPenalty: 0.1,
        presencePenalty: 0.2,
        seed: 42,
        stop: ["</s>"],
      },
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.temperature).toBe(0.7);
    expect(body.max_tokens).toBe(256);
    expect(body.top_p).toBe(0.9);
    expect(body.frequency_penalty).toBe(0.1);
    expect(body.presence_penalty).toBe(0.2);
    expect(body.seed).toBe(42);
    expect(body.stop).toEqual(["</s>"]);
  });

  it("merges customHeaders (newline-delimited 'K: v' pairs)", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }),
    );
    await svc.run({
      apiBaseUrl: "http://x",
      apiKey: "k",
      model: "m",
      customHeaders: "X-Foo: bar\nX-Baz: qux",
      messages: [{ role: "user", content: "h" }],
      params: {},
    });
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers["X-Foo"]).toBe("bar");
    expect(headers["X-Baz"]).toBe("qux");
  });

  it("returns success=false with upstream body when status >= 400", async () => {
    fetchMock.mockResolvedValue(new Response("model not found", { status: 404 }));
    const out = await svc.run({
      apiBaseUrl: "http://x",
      apiKey: "k",
      model: "m",
      messages: [{ role: "user", content: "h" }],
      params: {},
    });
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/404/);
    expect(out.error).toMatch(/model not found/);
  });

  it("returns success=false on network error", async () => {
    fetchMock.mockRejectedValue(new Error("network kaboom"));
    const out = await svc.run({
      apiBaseUrl: "http://x",
      apiKey: "k",
      model: "m",
      messages: [{ role: "user", content: "h" }],
      params: {},
    });
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/network kaboom/);
  });

  it("collapses trailing slash in apiBaseUrl to a single slash", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }),
    );
    await svc.run({
      apiBaseUrl: "http://x.test/",
      apiKey: "k",
      model: "m",
      messages: [{ role: "user", content: "h" }],
      params: {},
    });
    expect(fetchMock.mock.calls[0][0]).toBe("http://x.test/v1/chat/completions");
  });

  it("appends queryParams (newline-delimited key=value) to the URL", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }),
    );
    await svc.run({
      apiBaseUrl: "http://x",
      apiKey: "k",
      model: "m",
      queryParams: "api-version=2024-02-01\nfoo=bar",
      messages: [{ role: "user", content: "h" }],
      params: {},
    });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("api-version=2024-02-01");
    expect(url).toContain("foo=bar");
    expect(url.split("?")[0]).toBe("http://x/v1/chat/completions");
  });
});
