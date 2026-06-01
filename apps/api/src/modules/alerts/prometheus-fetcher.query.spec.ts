// apps/api/src/modules/alerts/prometheus-fetcher.query.spec.ts
import type { PrometheusDatasource } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrometheusFetcherService } from "./prometheus-fetcher.service.js";

const DS: PrometheusDatasource = {
  id: "ds1",
  name: "primary",
  baseUrl: "http://prom.local",
  bearerCipher: null,
  customHeaders: null,
  isDefault: true,
  // remaining columns are not read by runQuery; cast keeps the test focused.
} as unknown as PrometheusDatasource;

function makeService() {
  const prisma = {
    prometheusDatasource: { findUnique: vi.fn(), findFirst: vi.fn() },
    connection: { findUnique: vi.fn() },
  };
  const config = { guard: { blockPrivate: false, allowHosts: null }, maxBodyBytes: 1_000_000 };
  const svc = new PrometheusFetcherService(
    prisma as never,
    Buffer.from("0".repeat(32)).toString("base64"),
    config as never,
  );
  return { svc, prisma };
}

afterEach(() => vi.restoreAllMocks());

describe("PrometheusFetcherService.runQuery", () => {
  it("hits /api/v1/query (instant) and maps the vector result", async () => {
    const { svc } = makeService();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "success",
          data: {
            resultType: "vector",
            result: [{ metric: { job: "vllm" }, value: [1750000000, "0.42"] }],
          },
        }),
        { status: 200 },
      ),
    );
    const out = await svc.runQuery(DS, "up", { kind: "instant" });
    expect(fetchMock.mock.calls[0]?.[0]?.toString()).toContain("/api/v1/query?");
    expect(out.truncated).toBe(false);
    expect(out.series[0]?.labels.job).toBe("vllm");
    expect(out.series[0]?.value).toBeCloseTo(0.42);
  });

  it("maps non-finite Prometheus values ('+Inf'/'NaN') to explicit null", async () => {
    const { svc } = makeService();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "success",
          data: {
            resultType: "vector",
            result: [
              { metric: { a: "1" }, value: [1750000000, "+Inf"] },
              { metric: { a: "2" }, value: [1750000000, "NaN"] },
            ],
          },
        }),
        { status: 200 },
      ),
    );
    const out = await svc.runQuery(DS, "up", { kind: "instant" });
    expect(out.series[0]?.value).toBeNull();
    expect(out.series[1]?.value).toBeNull();
  });

  it("truncates series beyond the cap", async () => {
    const { svc } = makeService();
    const many = Array.from({ length: 50 }, (_, i) => ({
      metric: { i: String(i) },
      value: [1750000000, "1"],
    }));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ status: "success", data: { resultType: "vector", result: many } }),
        { status: 200 },
      ),
    );
    const out = await svc.runQuery(DS, "up", { kind: "instant" });
    expect(out.truncated).toBe(true);
    expect(out.series.length).toBeLessThanOrEqual(20);
  });

  it("resolveDatasourceByRef prefers datasourceId, then connection, then default", async () => {
    const { svc, prisma } = makeService();
    prisma.prometheusDatasource.findUnique.mockResolvedValue(DS);
    expect(await svc.resolveDatasourceByRef({ datasourceId: "ds1" })).toBe(DS);
    expect(prisma.prometheusDatasource.findUnique).toHaveBeenCalledWith({ where: { id: "ds1" } });

    prisma.connection.findUnique.mockResolvedValue({ prometheusDatasource: DS });
    expect(await svc.resolveDatasourceByRef({ connectionId: "c1" })).toBe(DS);

    prisma.connection.findUnique.mockResolvedValue({ prometheusDatasource: null });
    prisma.prometheusDatasource.findFirst.mockResolvedValue(DS);
    expect(await svc.resolveDatasourceByRef({ connectionId: "c1" })).toBe(DS);
    expect(prisma.prometheusDatasource.findFirst).toHaveBeenCalledWith({
      where: { isDefault: true },
    });
  });
});
