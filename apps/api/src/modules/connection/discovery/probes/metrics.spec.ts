import { beforeEach, describe, expect, it, vi } from "vitest";
import { runMetricsProbe } from "./metrics.js";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

describe("runMetricsProbe", () => {
  beforeEach(() => fetchMock.mockReset());

  it("returns ok with body on 200", async () => {
    const body = "# HELP vllm:request_success_total ...\nvllm:request_success_total 42\n";
    fetchMock.mockResolvedValueOnce(
      new Response(body, {
        status: 200,
        headers: { "content-type": "text/plain", "content-length": String(body.length) },
      }),
    );
    const r = await runMetricsProbe({ baseUrl: "http://x" });
    expect(r.ok).toBe(true);
    expect(r.data?.body).toContain("vllm:request_success_total");
  });

  it("returns ok=false on 404 (engine doesn't expose /metrics)", async () => {
    fetchMock.mockResolvedValueOnce(new Response("Not Found", { status: 404 }));
    const r = await runMetricsProbe({ baseUrl: "http://x" });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/404/);
  });

  it("trims body to 64 KiB", async () => {
    const huge = "vllm:metric 1\n".repeat(20000); // ~260 KB
    fetchMock.mockResolvedValueOnce(
      new Response(huge, {
        status: 200,
        headers: { "content-type": "text/plain", "content-length": String(huge.length) },
      }),
    );
    const r = await runMetricsProbe({ baseUrl: "http://x" });
    expect(r.ok).toBe(true);
    expect(r.data?.body.length).toBeLessThanOrEqual(64 * 1024);
  });

  it("does NOT forward apiKey (most /metrics endpoints are unauthenticated)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("metric 1", {
        status: 200,
        headers: { "content-type": "text/plain", "content-length": "8" },
      }),
    );
    await runMetricsProbe({ baseUrl: "http://x", apiKey: "sk-1" });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });
});
