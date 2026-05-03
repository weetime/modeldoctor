import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DecryptedConnection } from "../connection/connection.service.js";
import { ImagesService } from "./images.service.js";

function makeConn(overrides: Partial<DecryptedConnection> = {}): DecryptedConnection {
  return {
    id: "conn-1",
    name: "test",
    baseUrl: "http://x",
    apiKey: "k",
    model: "m",
    customHeaders: "",
    queryParams: "",
    category: "image",
    tokenizerHfId: null,
    ...overrides,
  };
}

describe("ImagesService.run", () => {
  let svc: ImagesService;
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    svc = new ImagesService();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to {baseUrl}/v1/images/generations with prompt+size+n", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: [{ url: "http://image/0" }] }), { status: 200 }),
    );
    const out = await svc.run(makeConn(), {
      connectionId: "conn-1",
      prompt: "a red apple",
      size: "512x512",
      n: 1,
    });
    expect(out.success).toBe(true);
    expect(out.artifacts).toEqual([{ url: "http://image/0", b64Json: undefined }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://x/v1/images/generations");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ model: "m", prompt: "a red apple", size: "512x512", n: 1 });
  });

  it("forwards responseFormat + seed when set", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: "AAA" }] }), { status: 200 }),
    );
    await svc.run(makeConn(), {
      connectionId: "conn-1",
      prompt: "p",
      responseFormat: "b64_json",
      seed: 42,
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({ response_format: "b64_json", seed: 42 });
  });

  it("returns success=false on non-2xx", async () => {
    fetchMock.mockResolvedValue(new Response("denied", { status: 403 }));
    const out = await svc.run(makeConn(), {
      connectionId: "conn-1",
      prompt: "p",
    });
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/403/);
  });
});

describe("ImagesService.runEdit", () => {
  let svc: ImagesService;
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    svc = new ImagesService();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const makeFile = (originalname: string, mimetype: string) => ({
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    originalname,
    mimetype,
    size: 4,
  });

  it("posts multipart to {baseUrl}/v1/images/edits with image+mask+prompt+model", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: [{ url: "http://image/edit/0" }] }), { status: 200 }),
    );
    const out = await svc.runEdit(makeConn(), {
      prompt: "make it blue",
      image: makeFile("input.png", "image/png"),
      mask: makeFile("mask.png", "image/png"),
      n: 1,
      size: "512x512",
    });
    expect(out.success).toBe(true);
    expect(out.artifacts).toEqual([{ url: "http://image/edit/0", b64Json: undefined }]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://x/v1/images/edits");
    const initObj = init as RequestInit;
    // Multipart bodies are FormData instances — fetch derives the boundary.
    expect(initObj.body).toBeInstanceOf(FormData);
    const form = initObj.body as FormData;
    expect(form.get("model")).toBe("m");
    expect(form.get("prompt")).toBe("make it blue");
    expect(form.get("size")).toBe("512x512");
    expect(form.get("n")).toBe("1");
    expect(form.get("image")).toBeInstanceOf(Blob);
    expect(form.get("mask")).toBeInstanceOf(Blob);

    // Critical: NO Content-Type header — fetch sets it with boundary.
    const headers = (initObj.headers ?? {}) as Record<string, string>;
    expect(headers["Content-Type"]).toBeUndefined();
    expect(headers.Authorization).toBe("Bearer k");
  });

  it("forwards customHeaders + queryParams from connection", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: "AAA" }] }), { status: 200 }),
    );
    await svc.runEdit(
      makeConn({ customHeaders: "X-Org: my-org", queryParams: "api-version=2024-01" }),
      {
        prompt: "p",
        image: makeFile("a.png", "image/png"),
        mask: makeFile("b.png", "image/png"),
      },
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://x/v1/images/edits?api-version=2024-01");
    const headers = ((init as RequestInit).headers ?? {}) as Record<string, string>;
    expect(headers["X-Org"]).toBe("my-org");
  });

  it("returns success=false on non-2xx", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 400 }));
    const out = await svc.runEdit(makeConn(), {
      prompt: "p",
      image: makeFile("a.png", "image/png"),
      mask: makeFile("b.png", "image/png"),
    });
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/400/);
  });
});
