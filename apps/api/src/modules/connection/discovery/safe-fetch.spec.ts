import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the SSRF guard so redirect tests can drive its decision without
// hitting DNS / system resolvers. The non-redirect tests don't reach this
// import path so the mock has no effect on them.
vi.mock("./ssrf-guard.js", () => ({
  assertSafeUrl: vi.fn(async (url: string) => ({
    safeUrl: new URL(url),
    resolvedIp: "10.0.0.1",
  })),
}));

import { safeFetch } from "./safe-fetch.js";
import { assertSafeUrl } from "./ssrf-guard.js";

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

  // -- Redirect handling (SSRF re-validation) -------------------------------

  it("uses redirect: 'manual' on the underlying fetch call", async () => {
    fetchMock.mockResolvedValueOnce(new Response("ok", { status: 200 }));
    await safeFetch("http://x");
    expect((fetchMock.mock.calls[0][1] as RequestInit).redirect).toBe("manual");
  });

  it("follows a 302 redirect to a re-validated public URL", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: "http://x.test/final" } }),
      )
      .mockResolvedValueOnce(new Response("done", { status: 200 }));
    vi.mocked(assertSafeUrl).mockResolvedValue({
      safeUrl: new URL("http://x.test/final"),
      resolvedIp: "1.2.3.4",
    });

    const r = await safeFetch("http://x.test/start");

    expect(r.status).toBe(200);
    expect(await r.text()).toBe("done");
    // assertSafeUrl called once for hop 1 (the redirect target); hop 0 trusts caller.
    expect(assertSafeUrl).toHaveBeenCalledWith("http://x.test/final");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects when a redirect lands on an SSRF-blocked URL", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest" } }),
    );
    vi.mocked(assertSafeUrl).mockRejectedValueOnce(new Error("Cloud metadata endpoint blocked"));

    await expect(safeFetch("http://public.test/start")).rejects.toThrow(/Cloud metadata/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects on redirect chain longer than maxRedirects", async () => {
    // Always respond with a 302 → infinite loop, bounded by maxRedirects.
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(null, { status: 302, headers: { location: "http://x.test/again" } }),
      ),
    );
    vi.mocked(assertSafeUrl).mockResolvedValue({
      safeUrl: new URL("http://x.test/again"),
      resolvedIp: "1.2.3.4",
    });

    await expect(safeFetch("http://x.test/start", { maxRedirects: 2 })).rejects.toThrow(
      /Too many redirects/,
    );
    // hop 0 + hop 1 + hop 2 + one more attempt that exceeds → loop exits after 3 calls.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  // -- Streaming body cap (chunked / no Content-Length) ---------------------

  it("rejects oversized body even when Content-Length is missing (streaming cap)", async () => {
    // Build a streaming body with no Content-Length header that emits 2KB.
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(1024).fill(65));
        controller.enqueue(new Uint8Array(1024).fill(66));
        controller.close();
      },
    });
    fetchMock.mockResolvedValueOnce(new Response(stream, { status: 200 }));

    await expect(safeFetch("http://x", { maxBytes: 1024 })).rejects.toThrow(/exceeded.*bytes/);
  });

  it("buffers and returns a re-readable Response after streaming", async () => {
    // Chunked body, total under cap → safeFetch returns a Response whose
    // body can still be consumed by `res.text()` (we wrap a new Response).
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("hel"));
        controller.enqueue(new TextEncoder().encode("lo"));
        controller.close();
      },
    });
    fetchMock.mockResolvedValueOnce(
      new Response(stream, { status: 200, headers: { "content-type": "text/plain" } }),
    );

    const r = await safeFetch("http://x");
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("hello");
  });
});
