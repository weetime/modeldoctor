import { beforeEach, describe, expect, it, vi } from "vitest";
import { runServerHeaderProbe } from "./server-header.js";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

describe("runServerHeaderProbe", () => {
  beforeEach(() => fetchMock.mockReset());

  it("captures Server header (lowercased)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("ok", { status: 200, headers: { Server: "Higress/2.0.0" } }),
    );
    const r = await runServerHeaderProbe({ baseUrl: "http://x" });
    expect(r.ok).toBe(true);
    expect(r.data?.server).toBe("higress/2.0.0");
  });

  it("captures X-Powered-By header (lowercased)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("ok", { status: 200, headers: { "X-Powered-By": "vLLM" } }),
    );
    const r = await runServerHeaderProbe({ baseUrl: "http://x" });
    expect(r.data?.poweredBy).toBe("vllm");
  });

  it("ok=true even on 4xx — we still get the headers", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("Not Found", { status: 404, headers: { Server: "envoy" } }),
    );
    const r = await runServerHeaderProbe({ baseUrl: "http://x" });
    expect(r.ok).toBe(true);
    expect(r.data?.server).toBe("envoy");
  });

  it("returns ok=false on network failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const r = await runServerHeaderProbe({ baseUrl: "http://x" });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/ECONNREFUSED/);
  });
});
