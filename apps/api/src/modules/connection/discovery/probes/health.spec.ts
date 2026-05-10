import { beforeEach, describe, expect, it, vi } from "vitest";
import { runHealthProbe } from "./health.js";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

describe("runHealthProbe", () => {
  beforeEach(() => fetchMock.mockReset());

  it("returns ok with path=/health when /health is 2xx", async () => {
    fetchMock.mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const r = await runHealthProbe({ baseUrl: "http://x" });
    expect(r.ok).toBe(true);
    expect(r.data?.path).toBe("/health");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to /healthz on /health 404", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("Not Found", { status: 404 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const r = await runHealthProbe({ baseUrl: "http://x" });
    expect(r.ok).toBe(true);
    expect(r.data?.path).toBe("/healthz");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns ok=false when both fail", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("Not Found", { status: 404 }))
      .mockResolvedValueOnce(new Response("Not Found", { status: 404 }));
    const r = await runHealthProbe({ baseUrl: "http://x" });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no health endpoint/i);
  });
});
