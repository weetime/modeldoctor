import { beforeEach, describe, expect, it, vi } from "vitest";
import { runModelsProbe } from "./models.js";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

describe("runModelsProbe", () => {
  beforeEach(() => fetchMock.mockReset());

  it("parses OpenAI-shape response", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: "llama-3-8b" }, { id: "mistral-7b" }] }), {
        status: 200,
        headers: { "content-type": "application/json", "content-length": "60" },
      }),
    );
    const r = await runModelsProbe({ baseUrl: "http://x" });
    expect(r.ok).toBe(true);
    expect(r.data?.models).toEqual(["llama-3-8b", "mistral-7b"]);
  });

  it("falls back to top-level array", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([{ id: "x" }, { id: "y" }]), {
        status: 200,
        headers: { "content-type": "application/json", "content-length": "20" },
      }),
    );
    const r = await runModelsProbe({ baseUrl: "http://x" });
    expect(r.data?.models).toEqual(["x", "y"]);
  });

  it("returns ok=false on 401", async () => {
    fetchMock.mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));
    const r = await runModelsProbe({ baseUrl: "http://x" });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/401/);
  });

  it("returns ok=false on 404", async () => {
    fetchMock.mockResolvedValueOnce(new Response("Not Found", { status: 404 }));
    const r = await runModelsProbe({ baseUrl: "http://x" });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/404/);
  });

  it("returns ok=false on JSON parse error", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("<html>not json</html>", {
        status: 200,
        headers: { "content-type": "text/html", "content-length": "20" },
      }),
    );
    const r = await runModelsProbe({ baseUrl: "http://x" });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/parse/i);
  });

  it("forwards apiKey to safeFetch", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/json", "content-length": "12" },
      }),
    );
    await runModelsProbe({ baseUrl: "http://x", apiKey: "sk-1" });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-1");
  });
});
