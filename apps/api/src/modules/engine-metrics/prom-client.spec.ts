import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PromClient, type PromQueryRangeResult } from "./prom-client.js";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

describe("PromClient.queryRange", () => {
  let client: PromClient;
  beforeEach(() => {
    client = new PromClient();
    fetchMock.mockReset();
  });
  afterEach(() => fetchMock.mockReset());

  it("returns parsed series on 200 + matrix payload", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        status: "success",
        data: {
          resultType: "matrix",
          result: [
            {
              metric: { pod: "infer-0" },
              values: [
                [1715212800, "0.42"],
                [1715212815, "0.55"],
              ],
            },
          ],
        },
      }),
    });

    const r = await client.queryRange({
      baseUrl: "http://prom:9090",
      query: 'sum(vllm:num_requests_running{model_name="m"})',
      from: new Date("2026-05-09T00:00:00Z"),
      to: new Date("2026-05-09T00:01:00Z"),
      step: 15,
    });

    expect(r.unavailable).toBe(false);
    expect(r.series).toHaveLength(1);
    expect(r.series[0].label).toBe("infer-0");
    expect(r.series[0].samples).toEqual([
      [1715212800, 0.42],
      [1715212815, 0.55],
    ]);
  });

  it("returns no_data on empty result array", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: "success", data: { resultType: "matrix", result: [] } }),
    });
    const r = await client.queryRange({
      baseUrl: "http://prom:9090",
      query: "x",
      from: new Date(0),
      to: new Date(60_000),
      step: 15,
    });
    expect(r).toMatchObject<Partial<PromQueryRangeResult>>({
      unavailable: true,
      reason: "no_data",
      series: [],
    });
  });

  it("returns prom_error on HTTP 503", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, text: async () => "down" });
    const r = await client.queryRange({
      baseUrl: "http://prom:9090",
      query: "x",
      from: new Date(0),
      to: new Date(60_000),
      step: 15,
    });
    expect(r).toMatchObject<Partial<PromQueryRangeResult>>({
      unavailable: true,
      reason: "prom_error",
    });
  });

  it("returns prom_error on fetch throw (network)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const r = await client.queryRange({
      baseUrl: "http://prom:9090",
      query: "x",
      from: new Date(0),
      to: new Date(60_000),
      step: 15,
    });
    expect(r.unavailable).toBe(true);
    expect(r.reason).toBe("prom_error");
  });

  it("encodes start/end/step in seconds", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: "success", data: { resultType: "matrix", result: [] } }),
    });
    await client.queryRange({
      baseUrl: "http://prom:9090",
      query: 'up{job="vllm"}',
      from: new Date("2026-05-09T00:00:00Z"),
      to: new Date("2026-05-09T00:01:00Z"),
      step: 30,
    });
    const [calledUrl] = fetchMock.mock.calls[0] as [string];
    expect(calledUrl).toContain("/api/v1/query_range?");
    expect(calledUrl).toContain("start=1778284800");
    expect(calledUrl).toContain("end=1778284860");
    expect(calledUrl).toContain("step=30");
  });

  it("falls back to series label when pod/instance missing", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        status: "success",
        data: {
          resultType: "matrix",
          result: [
            {
              metric: { series: "p99" },
              values: [[1715212800, "187.4"]],
            },
            {
              metric: { series: "p50" },
              values: [[1715212800, "120.5"]],
            },
          ],
        },
      }),
    });
    const r = await client.queryRange({
      baseUrl: "http://prom:9090",
      query: "x",
      from: new Date(0),
      to: new Date(60_000),
      step: 15,
    });
    expect(r.series.map((s) => s.label).sort()).toEqual(["p50", "p99"]);
  });
});
