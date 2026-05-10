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
});
