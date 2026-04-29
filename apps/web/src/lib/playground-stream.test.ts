import { useAuthStore } from "@/stores/auth-store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { playgroundFetchStream } from "./playground-stream";

function makeSseResponse(events: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const e of events) c.enqueue(encoder.encode(e));
      c.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("playgroundFetchStream", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    useAuthStore.setState({ accessToken: "tok" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    useAuthStore.setState({ accessToken: null });
  });

  it("posts JSON body with bearer token, then yields SSE 'data:' frames", async () => {
    fetchMock.mockResolvedValue(
      makeSseResponse([
        'data: {"choices":[{"delta":{"content":"he"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"llo"}}]}\n\n',
        "data: [DONE]\n\n",
      ]),
    );
    const events: string[] = [];
    const ac = new AbortController();
    await playgroundFetchStream({
      path: "/api/playground/chat",
      body: { hello: "world" },
      signal: ac.signal,
      onSseEvent: (data) => events.push(data),
    });
    expect(events).toEqual([
      '{"choices":[{"delta":{"content":"he"}}]}',
      '{"choices":[{"delta":{"content":"llo"}}]}',
      "[DONE]",
    ]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/playground/chat");
    expect((init as RequestInit).method).toBe("POST");
    const headers = (init as RequestInit).headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer tok");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect((init as RequestInit).body).toBe(JSON.stringify({ hello: "world" }));
  });

  it("throws on non-2xx with the upstream body in the message", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));
    await expect(
      playgroundFetchStream({
        path: "/x",
        body: {},
        signal: new AbortController().signal,
        onSseEvent: () => {},
      }),
    ).rejects.toThrow(/500.*nope/);
  });

  it("reassembles events split across chunks", async () => {
    fetchMock.mockResolvedValue(makeSseResponse(["data: hel", "lo\n", "\ndata: world\n\n"]));
    const events: string[] = [];
    await playgroundFetchStream({
      path: "/x",
      body: {},
      signal: new AbortController().signal,
      onSseEvent: (d) => events.push(d),
    });
    expect(events).toEqual(["hello", "world"]);
  });

  it("respects AbortSignal: throws AbortError after caller aborts", async () => {
    let cancelled = false;
    fetchMock.mockImplementation((_url, init: RequestInit) => {
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode("data: 1\n\n"));
        },
        cancel() {
          cancelled = true;
        },
      });
      const sig = init.signal as AbortSignal;
      sig.addEventListener("abort", () => {});
      return Promise.resolve(new Response(stream, { status: 200 }));
    });

    const ac = new AbortController();
    const p = playgroundFetchStream({
      path: "/x",
      body: {},
      signal: ac.signal,
      onSseEvent: () => {
        ac.abort();
      },
    });
    await expect(p).rejects.toThrow(/abort/i);
    expect(cancelled).toBe(true);
  });
});
