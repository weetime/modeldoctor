// Mock the SSRF guard so unit tests don't try to actually resolve the
// placeholder hostnames we pass in. The probe code calls `safeFetch` →
// `assertSafeUrl` → DNS, which would fail on `prom.example.test`.
import { vi } from "vitest";
vi.mock("./ssrf-guard.js", () => ({
  assertSafeUrl: vi.fn(async (url: string) => ({
    safeUrl: new URL(url),
    resolvedIp: "10.0.0.1",
  })),
  PRIVATE_HOSTS: new Set<string>(),
}));

import { beforeEach, describe, expect, it } from "vitest";
import { verifyPrometheus } from "./verify-kind.js";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function promResponse(
  body: unknown,
  init: { status?: number; contentType?: string } = {},
): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, {
    status: init.status ?? 200,
    headers: {
      "content-type": init.contentType ?? "application/json",
      "content-length": String(text.length),
    },
  });
}

describe("verifyPrometheus", () => {
  beforeEach(() => fetchMock.mockReset());

  it("ok with version + revision when buildinfo is well-formed", async () => {
    fetchMock.mockResolvedValueOnce(
      promResponse({
        status: "success",
        data: { version: "2.51.0", revision: "abc123", branch: "HEAD" },
      }),
    );
    const r = await verifyPrometheus("https://prom.example.test", { method: "GET" });
    expect(r.ok).toBe(true);
    expect(r.version).toBe("2.51.0");
    expect(r.details).toEqual({ revision: "abc123" });
    expect(r.reason).toBeUndefined();
    // Hits the documented buildinfo path, not /api/v1/query or anything else.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://prom.example.test/api/v1/status/buildinfo");
  });

  it("ok without details when buildinfo has version but no revision", async () => {
    fetchMock.mockResolvedValueOnce(
      promResponse({ status: "success", data: { version: "3.0.0" } }),
    );
    const r = await verifyPrometheus("https://prom.example.test", { method: "GET" });
    expect(r.ok).toBe(true);
    expect(r.version).toBe("3.0.0");
    expect(r.details).toBeUndefined();
  });

  it("ok=false with HTTP status surfaced when upstream returns non-2xx", async () => {
    fetchMock.mockResolvedValueOnce(
      promResponse("forbidden", { status: 401, contentType: "text/plain" }),
    );
    const r = await verifyPrometheus("https://prom.example.test", { method: "GET" });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/HTTP 401/);
    expect(r.reason).toMatch(/\/api\/v1\/status\/buildinfo/);
    expect(r.version).toBeUndefined();
  });

  it("ok=false when status field is not 'success' (Prometheus error envelope)", async () => {
    fetchMock.mockResolvedValueOnce(
      promResponse({ status: "error", errorType: "internal", error: "broken" }),
    );
    const r = await verifyPrometheus("https://prom.example.test", { method: "GET" });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Prometheus shape/);
  });

  it("ok=false when data.version is missing (looks-like-prom but isn't)", async () => {
    fetchMock.mockResolvedValueOnce(promResponse({ status: "success", data: { revision: "xyz" } }));
    const r = await verifyPrometheus("https://prom.example.test", { method: "GET" });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Prometheus shape/);
  });

  it("ok=false when body is not JSON (treated as missing shape)", async () => {
    // res.json() throws → the inline `.catch(() => null)` makes body null and
    // the shape check fires.
    fetchMock.mockResolvedValueOnce(
      promResponse("<html>nginx default page</html>", { contentType: "text/html" }),
    );
    const r = await verifyPrometheus("https://prom.example.test", { method: "GET" });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Prometheus shape/);
  });

  it("trailing slash on baseUrl is NOT stripped by verifyPrometheus itself", async () => {
    // The controller in prometheus-datasource.controller.ts trims trailing
    // slashes before calling verifyPrometheus. We assert verifyPrometheus
    // does NOT do it again — that responsibility lives at the controller
    // boundary so probe internals can stay focused.
    fetchMock.mockResolvedValueOnce(
      promResponse({ status: "success", data: { version: "2.51.0" } }),
    );
    await verifyPrometheus("https://prom.example.test/", { method: "GET" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://prom.example.test//api/v1/status/buildinfo");
  });
});
