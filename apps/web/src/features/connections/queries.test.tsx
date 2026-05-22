import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  useConnection,
  useConnections,
  useCreateConnection,
  useDeleteConnection,
  useDiscoverConnection,
  useUpdateConnection,
} from "./queries";

vi.mock("@/lib/api-client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() },
}));

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("useConnections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("fetches list and exposes items", async () => {
    (api.get as any).mockResolvedValue({
      items: [{ id: "c1", name: "n", apiKeyPreview: "sk-...1234" }],
    });
    const { result } = renderHook(() => useConnections(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: "c1", name: "n", apiKeyPreview: "sk-...1234" }]);
    expect(api.get).toHaveBeenCalledWith("/api/connections");
  });
});

describe("useConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("is disabled when id is null", () => {
    const { result } = renderHook(() => useConnection(null), { wrapper: wrap() });
    expect(result.current.fetchStatus).toBe("idle");
  });
  it("fetches the detail when id is set", async () => {
    (api.get as any).mockResolvedValue({ id: "c1", name: "n" });
    const { result } = renderHook(() => useConnection("c1"), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith("/api/connections/c1");
  });
});

describe("useCreateConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("posts the body and returns ConnectionWithSecret", async () => {
    (api.post as any).mockResolvedValue({ id: "c1", apiKey: "sk-x" });
    const { result } = renderHook(() => useCreateConnection(), { wrapper: wrap() });
    await result.current.mutateAsync({
      name: "n",
      baseUrl: "http://x",
      apiKey: "sk-x",
      model: "m",
      customHeaders: "",
      queryParams: "",
      category: "chat",
      tags: [],
    });
    expect(api.post).toHaveBeenCalledWith(
      "/api/connections",
      expect.objectContaining({ apiKey: "sk-x" }),
    );
  });
});

describe("useUpdateConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("patches the row by id", async () => {
    (api.patch as any).mockResolvedValue({ id: "c1" });
    const { result } = renderHook(() => useUpdateConnection(), { wrapper: wrap() });
    await result.current.mutateAsync({ id: "c1", body: { name: "renamed" } });
    expect(api.patch).toHaveBeenCalledWith("/api/connections/c1", { name: "renamed" });
  });
});

describe("useDeleteConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("deletes by id", async () => {
    (api.del as any).mockResolvedValue(undefined);
    const { result } = renderHook(() => useDeleteConnection(), { wrapper: wrap() });
    await result.current.mutateAsync("c1");
    expect(api.del).toHaveBeenCalledWith("/api/connections/c1");
  });
});

describe("useDiscoverConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("posts to /api/connections/discover and returns the response", async () => {
    const fakeResponse = {
      health: { durationMs: 100, probesAttempted: 4, probesFailed: [], warnings: [] },
      inferred: {
        serverKind: { value: "vllm", confidence: "certain", evidence: "ok" },
        models: { values: ["llama-3-8b"], confidence: "certain", evidence: "ok" },
        category: { value: "chat", confidence: "guess", evidence: "default" },
        suggestedTags: { values: ["vllm", "chat", "8b"], confidence: "guess", evidence: "ok" },
      },
    };
    (api.post as any).mockResolvedValue(fakeResponse);
    const { result } = renderHook(() => useDiscoverConnection(), { wrapper: wrap() });
    const r = await result.current.mutateAsync({ baseUrl: "http://x", apiKey: "sk-test" });
    expect(api.post).toHaveBeenCalledWith("/api/connections/discover", {
      baseUrl: "http://x",
      apiKey: "sk-test",
    });
    expect(r.inferred.serverKind.value).toBe("vllm");
  });

  it("works with baseUrl-only (no apiKey)", async () => {
    (api.post as any).mockResolvedValue({
      health: { durationMs: 50, probesAttempted: 4, probesFailed: [], warnings: [] },
      inferred: {
        serverKind: { value: null, confidence: "unknown", evidence: "no signal" },
        models: { values: [], confidence: "unknown", evidence: "endpoint unreachable" },
        category: { value: null, confidence: "unknown", evidence: "no models" },
        suggestedTags: { values: [], confidence: "unknown", evidence: "no signal" },
      },
    });
    const { result } = renderHook(() => useDiscoverConnection(), { wrapper: wrap() });
    await result.current.mutateAsync({ baseUrl: "http://x" });
    expect(api.post).toHaveBeenCalledWith("/api/connections/discover", { baseUrl: "http://x" });
  });
});
