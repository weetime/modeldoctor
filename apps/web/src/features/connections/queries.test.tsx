import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import {
  useConnections,
  useConnection,
  useCreateConnection,
  useDeleteConnection,
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
  beforeEach(() => vi.clearAllMocks());
  it("fetches list and exposes items", async () => {
    (api.get as any).mockResolvedValue({ items: [{ id: "c1", name: "n", apiKeyPreview: "sk-...1234" }] });
    const { result } = renderHook(() => useConnections(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: "c1", name: "n", apiKeyPreview: "sk-...1234" }]);
    expect(api.get).toHaveBeenCalledWith("/api/connections");
  });
});

describe("useConnection", () => {
  beforeEach(() => vi.clearAllMocks());
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
  beforeEach(() => vi.clearAllMocks());
  it("posts the body and returns ConnectionWithSecret", async () => {
    (api.post as any).mockResolvedValue({ id: "c1", apiKey: "sk-x" });
    const { result } = renderHook(() => useCreateConnection(), { wrapper: wrap() });
    await result.current.mutateAsync({ name: "n", baseUrl: "http://x", apiKey: "sk-x", model: "m", customHeaders: "", queryParams: "", category: "chat", tags: [] });
    expect(api.post).toHaveBeenCalledWith("/api/connections", expect.objectContaining({ apiKey: "sk-x" }));
  });
});

describe("useUpdateConnection", () => {
  beforeEach(() => vi.clearAllMocks());
  it("patches the row by id", async () => {
    (api.patch as any).mockResolvedValue({ id: "c1" });
    const { result } = renderHook(() => useUpdateConnection(), { wrapper: wrap() });
    await result.current.mutateAsync({ id: "c1", body: { name: "renamed" } });
    expect(api.patch).toHaveBeenCalledWith("/api/connections/c1", { name: "renamed" });
  });
});

describe("useDeleteConnection", () => {
  beforeEach(() => vi.clearAllMocks());
  it("deletes by id", async () => {
    (api.del as any).mockResolvedValue(undefined);
    const { result } = renderHook(() => useDeleteConnection(), { wrapper: wrap() });
    await result.current.mutateAsync("c1");
    expect(api.del).toHaveBeenCalledWith("/api/connections/c1");
  });
});
