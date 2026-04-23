import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "./api-client";

describe("api-client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns parsed JSON on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ ok: true })),
      }),
    );
    const data = await api.get<{ ok: boolean }>("/api/health");
    expect(data).toEqual({ ok: true });
  });

  it("parses standard error envelope", async () => {
    const envelope = {
      error: {
        code: "VALIDATION_FAILED",
        message: "body: url is required",
        details: [{ path: ["url"], message: "Required" }],
        requestId: "abc123xyz_",
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve(JSON.stringify(envelope)),
      }),
    );
    await expect(api.post("/api/debug/proxy", {})).rejects.toMatchObject({
      status: 400,
      message: "body: url is required",
      code: "VALIDATION_FAILED",
      requestId: "abc123xyz_",
    });
  });

  it("falls back for non-conforming error bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        text: () => Promise.resolve("<html>Bad Gateway</html>"),
      }),
    );
    let caught: unknown;
    try {
      await api.get("/api/upstream");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(502);
    expect((caught as ApiError).code).toBeUndefined();
  });
});
