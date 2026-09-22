import { beforeEach, describe, expect, it, vi } from "vitest";
import { GpustackClient, GpustackError, type SafeFetch } from "./gpustack-client.js";

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function streamRes(chunks: string[], { hang = false } = {}) {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      if (!hang) controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("GpustackClient", () => {
  const fetchMock = vi.fn();
  const safeFetchMock = vi.fn();
  let client: GpustackClient;
  beforeEach(() => {
    fetchMock.mockReset();
    safeFetchMock.mockReset();
    client = new GpustackClient(
      "http://gs",
      "key",
      fetchMock as unknown as typeof fetch,
      safeFetchMock as unknown as SafeFetch,
    );
  });

  it("listModels walks all pages through safeFetch with bearer auth and a raised body cap", async () => {
    safeFetchMock
      .mockResolvedValueOnce(
        jsonRes({
          items: [{ id: 1, name: "a" }],
          pagination: { page: 1, perPage: 100, total: 2, totalPage: 2 },
        }),
      )
      .mockResolvedValueOnce(
        jsonRes({
          items: [{ id: 2, name: "b" }],
          pagination: { page: 2, perPage: 100, total: 2, totalPage: 2 },
        }),
      );
    const models = await client.listModels();
    expect(models.map((m) => m.id)).toEqual([1, 2]);
    expect(safeFetchMock.mock.calls[0][0]).toBe("http://gs/v2/models?page=1&perPage=100");
    expect(safeFetchMock.mock.calls[1][0]).toBe("http://gs/v2/models?page=2&perPage=100");
    // The whole point of routing through safeFetch: `redirect: "manual"` +
    // per-hop assertSafeUrl + a response size cap, none of which raw fetch has.
    expect(safeFetchMock.mock.calls[0][1]).toMatchObject({
      apiKey: "key",
      maxBytes: 8 * 1024 * 1024,
    });
    // Raw fetch must not be used for list calls at all.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("list calls never bypass safeFetch — every paginated endpoint goes through it", async () => {
    const page = () =>
      jsonRes({ items: [], pagination: { page: 1, perPage: 100, total: 0, totalPage: 1 } });
    safeFetchMock.mockImplementation(async () => page());
    await client.listRoutes();
    await client.listInstances();
    await client.countModels();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(safeFetchMock).toHaveBeenCalledTimes(3);
  });

  it("surfaces a safeFetch SSRF rejection as GpustackError instead of leaking the hop", async () => {
    safeFetchMock.mockRejectedValueOnce(
      new Error("Blocked host: 169.254.169.254 resolves to a private address"),
    );
    await expect(client.listModels()).rejects.toMatchObject({
      name: "GpustackError",
      message: expect.stringContaining("169.254.169.254"),
    });
  });

  it("throws GpustackError with status on 401", async () => {
    safeFetchMock.mockResolvedValueOnce(jsonRes({ detail: "unauthorized" }, 401));
    await expect(client.listRoutes()).rejects.toMatchObject({ name: "GpustackError", status: 401 });
  });

  it("countModels reads pagination.total", async () => {
    safeFetchMock.mockResolvedValueOnce(
      jsonRes({ items: [], pagination: { page: 1, perPage: 1, total: 7, totalPage: 7 } }),
    );
    expect(await client.countModels()).toBe(7);
    expect(safeFetchMock.mock.calls[0][0]).toBe("http://gs/v2/models?page=1&perPage=1");
  });

  it("watchModels sends redirect:manual and refuses to follow a 3xx", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest" } }),
    );
    await expect(
      client.watchModels({ signal: new AbortController().signal, onEvent: vi.fn() }),
    ).rejects.toMatchObject({ name: "GpustackError", status: 302 });
    expect((fetchMock.mock.calls[0][1] as RequestInit).redirect).toBe("manual");
    // Exactly one request: the redirect target was never fetched.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("watchModels calls onEvent per JSON event, ignores heartbeats, resolves on stream end", async () => {
    fetchMock.mockResolvedValueOnce(
      streamRes([
        "\n\n",
        '{"type":"UPDATED","data":{"id":1}}\n\n{"type":"CREATED","data":',
        '{"id":2}}\n\n',
      ]),
    );
    const onEvent = vi.fn();
    await client.watchModels({ signal: new AbortController().signal, onEvent });
    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("http://gs/v2/models?watch=true");
  });

  it("watchModels rejects when no bytes within heartbeat timeout", async () => {
    fetchMock.mockResolvedValueOnce(streamRes([], { hang: true }));
    await expect(
      client.watchModels({
        signal: new AbortController().signal,
        onEvent: vi.fn(),
        heartbeatTimeoutMs: 50,
      }),
    ).rejects.toBeInstanceOf(GpustackError);
  });

  it("watchModels resolves (does not reject) when the caller aborts mid-stream, after delivering prior events", async () => {
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode('{"type":"UPDATED","data":{"id":1}}\n\n'));
        // deliberately never enqueue again or close — simulates a still-open watch connection
      },
    });
    fetchMock.mockResolvedValueOnce(
      new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }),
    );
    const onEvent = vi.fn();
    const controller = new AbortController();
    const promise = client.watchModels({
      signal: controller.signal,
      onEvent,
      heartbeatTimeoutMs: 10_000,
    });
    // give the first event a chance to be delivered before the caller aborts
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledTimes(1));
    controller.abort();
    await expect(promise).resolves.toBeUndefined();
    expect(onEvent).toHaveBeenCalledTimes(1);
  });
});
