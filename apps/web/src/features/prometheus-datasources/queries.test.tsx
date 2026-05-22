import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  useCreateDatasource,
  useDatasource,
  useDatasources,
  useDeleteDatasource,
  useSetDefaultDatasource,
  useUpdateDatasource,
  useVerifyDatasource,
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

describe("useDatasources", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("fetches list and selects items", async () => {
    (api.get as any).mockResolvedValue({
      items: [{ id: "ds1", name: "prom" }],
    });
    const { result } = renderHook(() => useDatasources(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: "ds1", name: "prom" }]);
    expect(api.get).toHaveBeenCalledWith("/api/prometheus-datasources");
  });
});

describe("useDatasource", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("is idle when id is null", () => {
    const { result } = renderHook(() => useDatasource(null), { wrapper: wrap() });
    expect(result.current.fetchStatus).toBe("idle");
  });
  it("fetches detail when id provided", async () => {
    (api.get as any).mockResolvedValue({ id: "ds1", name: "prom" });
    const { result } = renderHook(() => useDatasource("ds1"), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith("/api/prometheus-datasources/ds1");
  });
});

describe("useCreateDatasource", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("POSTs the body and returns with-secret payload", async () => {
    (api.post as any).mockResolvedValue({ id: "ds1", bearerToken: "tok" });
    const { result } = renderHook(() => useCreateDatasource(), { wrapper: wrap() });
    await result.current.mutateAsync({
      name: "prom",
      baseUrl: "https://prom.example.com",
      customHeaders: "",
      isDefault: false,
    });
    expect(api.post).toHaveBeenCalledWith(
      "/api/prometheus-datasources",
      expect.objectContaining({ name: "prom" }),
    );
  });
});

describe("useUpdateDatasource", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("PATCHes by id", async () => {
    (api.patch as any).mockResolvedValue({ id: "ds1" });
    const { result } = renderHook(() => useUpdateDatasource(), { wrapper: wrap() });
    await result.current.mutateAsync({ id: "ds1", body: { name: "renamed" } });
    expect(api.patch).toHaveBeenCalledWith("/api/prometheus-datasources/ds1", {
      name: "renamed",
    });
  });
});

describe("useDeleteDatasource", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("DELETEs by id and returns consumersDetached", async () => {
    (api.del as any).mockResolvedValue({ consumersDetached: 2 });
    const { result } = renderHook(() => useDeleteDatasource(), { wrapper: wrap() });
    const res = await result.current.mutateAsync("ds1");
    expect(res).toEqual({ consumersDetached: 2 });
    expect(api.del).toHaveBeenCalledWith("/api/prometheus-datasources/ds1");
  });
});

describe("useSetDefaultDatasource", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("POSTs /set-default", async () => {
    (api.post as any).mockResolvedValue({ id: "ds1", isDefault: true });
    const { result } = renderHook(() => useSetDefaultDatasource(), { wrapper: wrap() });
    await result.current.mutateAsync("ds1");
    expect(api.post).toHaveBeenCalledWith("/api/prometheus-datasources/ds1/set-default", {});
  });
});

describe("useVerifyDatasource", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("POSTs /verify and returns the response", async () => {
    (api.post as any).mockResolvedValue({ ok: true, version: "2.50.0" });
    const { result } = renderHook(() => useVerifyDatasource(), { wrapper: wrap() });
    const r = await result.current.mutateAsync({ baseUrl: "https://prom" });
    expect(api.post).toHaveBeenCalledWith("/api/prometheus-datasources/verify", {
      baseUrl: "https://prom",
    });
    expect(r.ok).toBe(true);
    expect(r.version).toBe("2.50.0");
  });
});
