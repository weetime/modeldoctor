import { useAuthStore } from "@/stores/auth-store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "./api-client";

const mockUser = {
  id: "u1",
  email: "test@example.com",
  roles: ["user"],
  createdAt: new Date().toISOString(),
};

describe("api-client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ accessToken: null, user: null });
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

  it("attaches Authorization header when accessToken is in store", async () => {
    useAuthStore.setState({ accessToken: "my-token", user: mockUser });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ ok: true })),
    });
    vi.stubGlobal("fetch", fetchMock);

    await api.get("/api/health");

    const calledHeaders: Headers = fetchMock.mock.calls[0][1].headers;
    expect(calledHeaders.get("Authorization")).toBe("Bearer my-token");
  });

  it("on 401 → refreshes → retries original request with new token", async () => {
    useAuthStore.setState({ accessToken: "expired-token", user: mockUser });

    const fetchMock = vi
      .fn()
      // First call: original request returns 401
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () =>
          Promise.resolve(
            JSON.stringify({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }),
          ),
      })
      // Second call: refresh returns new token
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ accessToken: "new-token", user: mockUser }),
      })
      // Third call: retried original request with new token
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ data: "secret" })),
      });

    vi.stubGlobal("fetch", fetchMock);

    const result = await api.get<{ data: string }>("/api/protected");
    expect(result).toEqual({ data: "secret" });

    // Third fetch call should carry the new token
    const retryHeaders: Headers = fetchMock.mock.calls[2][1].headers;
    expect(retryHeaders.get("Authorization")).toBe("Bearer new-token");

    // Store should be updated with new token
    expect(useAuthStore.getState().accessToken).toBe("new-token");
  });

  it("on 401 → refresh fails → clears store and throws ApiError", async () => {
    useAuthStore.setState({ accessToken: "expired-token", user: mockUser });

    const fetchMock = vi
      .fn()
      // First call: 401
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve(""),
      })
      // Second call: refresh fails
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({}),
      });

    vi.stubGlobal("fetch", fetchMock);

    await expect(api.get("/api/protected")).rejects.toMatchObject({
      status: 401,
      message: "Unauthorized",
    });

    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it("del() issues DELETE", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      text: () => Promise.resolve(""),
    });
    vi.stubGlobal("fetch", fetchMock);
    await api.del("/api/foo/123");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/foo/123",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("does not attempt refresh for /api/auth/ paths", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () =>
        Promise.resolve(JSON.stringify({ error: { message: "bad creds", code: "UNAUTHORIZED" } })),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.post("/api/auth/login", {})).rejects.toMatchObject({ status: 401 });

    // Only one fetch call — no refresh attempt
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("api-client: concurrent 401s issue only one refresh", () => {
  beforeEach(() => {
    useAuthStore.setState({ accessToken: "old-token", user: mockUser });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ accessToken: null, user: null });
  });

  it("fires only a single /api/auth/refresh request for concurrent 401s", async () => {
    let refreshCallCount = 0;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/api/auth/refresh")) {
        refreshCallCount++;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ accessToken: "fresh-token", user: mockUser }),
        });
      }
      // Simulate 401 for all other calls on first attempt
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ ok: true })),
      });
    });

    // Override: first two calls are 401s, then success after refresh
    let callCount = 0;
    const orderedFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      callCount++;
      if (url.includes("/api/auth/refresh")) {
        refreshCallCount++;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ accessToken: "fresh-token", user: mockUser }),
        });
      }
      // Return 401 on the initial access-token calls, success after
      const auth = (init?.headers as Headers)?.get("Authorization") ?? "";
      if (auth === "Bearer old-token") {
        return Promise.resolve({
          ok: false,
          status: 401,
          text: () => Promise.resolve(""),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ ok: true })),
      });
    });

    vi.stubGlobal("fetch", orderedFetch);

    // Fire two requests simultaneously
    const [r1, r2] = await Promise.all([api.get("/api/something"), api.get("/api/else")]);

    expect(r1).toEqual({ ok: true });
    expect(r2).toEqual({ ok: true });
    expect(refreshCallCount).toBe(1);

    void fetchMock;
    void callCount;
  });
});
