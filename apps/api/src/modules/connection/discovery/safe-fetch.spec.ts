import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeFetch } from "./safe-fetch.js";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

describe("safeFetch", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("returns response on 2xx", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("ok", { status: 200, headers: { "content-type": "text/plain" } }),
    );
    const r = await safeFetch("http://10.0.0.1:8000/health");
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("ok");
  });

  it("aborts after timeoutMs", async () => {
    fetchMock.mockImplementationOnce(
      (_url: string, init?: RequestInit) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    await expect(safeFetch("http://x", { timeoutMs: 50 })).rejects.toThrow(/abort/i);
  });

  it("rejects when response body exceeds maxBytes", async () => {
    const big = new ArrayBuffer(2 * 1024 * 1024); // 2 MB
    fetchMock.mockResolvedValueOnce(
      new Response(big, { status: 200, headers: { "content-length": "2097152" } }),
    );
    await expect(safeFetch("http://x", { maxBytes: 1024 * 1024 })).rejects.toThrow(/too large/i);
  });

  it("includes Authorization header when apiKey provided", async () => {
    fetchMock.mockResolvedValueOnce(new Response("[]", { status: 200 }));
    await safeFetch("http://x", { apiKey: "sk-abc" });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://x",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer sk-abc" }),
      }),
    );
  });

  it("does not include Authorization when apiKey is undefined", async () => {
    fetchMock.mockResolvedValueOnce(new Response("ok", { status: 200 }));
    await safeFetch("http://x");
    const call = fetchMock.mock.calls[0];
    const headers = (call[1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it("forwards extraHeaders to the request", async () => {
    fetchMock.mockResolvedValueOnce(new Response("[]", { status: 200 }));
    await safeFetch("http://gateway", {
      extraHeaders: { "x-higress-llm-model": "qwen-72b", "X-Project-Id": "p_123" },
    });
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers["x-higress-llm-model"]).toBe("qwen-72b");
    expect(headers["X-Project-Id"]).toBe("p_123");
  });

  it("apiKey-derived Authorization wins over Authorization in extraHeaders", async () => {
    fetchMock.mockResolvedValueOnce(new Response("[]", { status: 200 }));
    await safeFetch("http://x", {
      apiKey: "sk-canonical",
      extraHeaders: { Authorization: "Bearer sk-from-curl-paste", authorization: "old-token" },
    });
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-canonical");
    expect(headers.authorization).toBeUndefined();
  });

  it("drops reserved headers (Host, Content-Length, Connection) from extraHeaders", async () => {
    fetchMock.mockResolvedValueOnce(new Response("[]", { status: 200 }));
    await safeFetch("http://x", {
      extraHeaders: {
        Host: "evil.example.com",
        "content-length": "9999",
        Connection: "close",
        "X-Allowed": "yes",
      },
    });
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Host).toBeUndefined();
    expect(headers["content-length"]).toBeUndefined();
    expect(headers.Connection).toBeUndefined();
    expect(headers["X-Allowed"]).toBe("yes");
  });
});
