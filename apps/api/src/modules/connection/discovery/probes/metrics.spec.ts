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

  it("forwards apiKey AND extraHeaders (gateway-protected /metrics is real)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("metric 1", {
        status: 200,
        headers: { "content-type": "text/plain", "content-length": "8" },
      }),
    );
    await runMetricsProbe({
      baseUrl: "http://gateway",
      apiKey: "sk-1",
      extraHeaders: { "x-higress-llm-model": "qwen-72b" },
    });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-1");
    expect(headers["x-higress-llm-model"]).toBe("qwen-72b");
  });

  // Sanity-check the body shape: a 200 OK with HTML / a login wall / a SPA
  // fallback all need to count as a failed metrics probe, not a successful
  // one. Downstream inference is robust (no prefix match → no engine guess),
  // but the probe lying about success leaks into the discover summary.
  it("returns ok=false when /metrics returns 200 + HTML (SPA fallback / login wall)", async () => {
    const html = "<!DOCTYPE html><html><body>Login required</body></html>";
    fetchMock.mockResolvedValueOnce(
      new Response(html, {
        status: 200,
        headers: { "content-type": "text/html", "content-length": String(html.length) },
      }),
    );
    const r = await runMetricsProbe({ baseUrl: "http://x" });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not Prometheus exposition format/);
  });

  it("returns ok=false when /metrics returns 200 + JSON (wildcard route)", async () => {
    const json = JSON.stringify({ status: "ok", uptime: 1234 });
    fetchMock.mockResolvedValueOnce(
      new Response(json, {
        status: 200,
        headers: { "content-type": "application/json", "content-length": String(json.length) },
      }),
    );
    const r = await runMetricsProbe({ baseUrl: "http://x" });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not Prometheus exposition format/);
  });

  it("returns ok=false when /metrics returns 200 + empty body", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("", {
        status: 200,
        headers: { "content-type": "text/plain", "content-length": "0" },
      }),
    );
    const r = await runMetricsProbe({ baseUrl: "http://x" });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not Prometheus exposition format/);
  });

  // Some exporters skip the # HELP / # TYPE comments and emit only sample
  // lines. The shape check must accept that case too.
  it("returns ok=true when body has sample lines but no HELP/TYPE comments", async () => {
    const body = 'process_cpu_seconds_total 12.3\nvllm:request_success_total{model="qwen"} 42\n';
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
});
