import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api-client";
import { playgroundFetchMultipart } from "./playground-multipart";

describe("playgroundFetchMultipart", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    void vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    void vi.unstubAllGlobals();
  });

  it("POSTs without Content-Type so fetch picks the multipart boundary", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    const form = new FormData();
    form.append("hello", "world");
    const out = await playgroundFetchMultipart<{ ok: number }>({
      path: "/api/playground/audio/transcriptions",
      form,
    });
    expect(out).toEqual({ ok: 1 });
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe("/api/playground/audio/transcriptions");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    const headers = init.headers as Headers;
    expect(headers.get("Content-Type")).toBeNull();
  });

  it("throws ApiError on non-2xx with message from JSON body", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: "bad request" }), { status: 400 }),
    );
    await expect(
      playgroundFetchMultipart({ path: "/api/x", form: new FormData() }),
    ).rejects.toThrow(ApiError);
  });

  it("propagates AbortError when signal aborts before fetch resolves", async () => {
    const ac = new AbortController();
    fetchMock.mockImplementation(
      (_p: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    const promise = playgroundFetchMultipart({
      path: "/api/x",
      form: new FormData(),
      signal: ac.signal,
    });
    ac.abort();
    await expect(promise).rejects.toThrow(DOMException);
  });
});
