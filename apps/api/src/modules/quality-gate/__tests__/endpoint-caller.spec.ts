import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EndpointCaller } from "../endpoint-caller.js";

const connection = {
  id: "c1",
  baseUrl: "https://example.test",
  model: "qwen3-32b",
  apiKey: "sk-abc",
};

const stubConnectionsService = {
  // Mirrors ConnectionService.getOwnedDecrypted(userId, id) → connection
  getOwnedDecrypted: vi.fn().mockResolvedValue(connection),
};

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const buildOk = (content: string) => ({
  ok: true,
  json: async () => ({
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 4, completion_tokens: 3 },
  }),
});

describe("EndpointCaller", () => {
  const caller = new EndpointCaller(stubConnectionsService as never);
  const signal = new AbortController().signal;

  it("returns content + latency + tokens on success", async () => {
    fetchMock.mockResolvedValueOnce(buildOk("hello"));
    const r = await caller.call("c1", "u1", "q", signal);
    expect(r).toMatchObject({ rawAnswer: "hello", tokensIn: 4, tokensOut: 3 });
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("retries once on first failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET")).mockResolvedValueOnce(buildOk("ok"));
    const r = await caller.call("c1", "u1", "q", signal);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(r.rawAnswer).toBe("ok");
  });

  it("returns error result after second failure", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));
    const r = await caller.call("c1", "u1", "q", signal);
    expect(r.error).toBeDefined();
    expect(r.rawAnswer).toBe("");
  });

  it("does not retry when caller signal already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    fetchMock.mockRejectedValueOnce(new Error("aborted"));
    const r = await caller.call("c1", "u1", "q", ac.signal);
    expect(r.error).toBeDefined();
  });

  it("attaches Authorization header when apiKey present", async () => {
    fetchMock.mockResolvedValueOnce(buildOk("hi"));
    await caller.call("c1", "u1", "q", signal);
    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer sk-abc" });
  });
});
