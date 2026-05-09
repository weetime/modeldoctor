import {
  ENGINE_CAPABILITY,
  getEngineManifest,
} from "@modeldoctor/contracts";
import { Test } from "@nestjs/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionService, type DecryptedConnection } from "../connection/connection.service.js";
import { EngineMetricsService } from "./engine-metrics.service.js";
import { PromClient } from "./prom-client.js";

function makeConn(over: Partial<DecryptedConnection> = {}): DecryptedConnection {
  return {
    id: "c1",
    name: "test",
    baseUrl: "http://m:8000",
    apiKey: "x",
    model: "Qwen2.5-7B-Instruct",
    customHeaders: "",
    queryParams: "",
    category: "chat",
    tokenizerHfId: null,
    prometheusUrl: "http://prom:9090",
    serverKind: "vllm",
    ...over,
  };
}

describe("EngineMetricsService", () => {
  let svc: EngineMetricsService;
  let promClient: { queryRange: ReturnType<typeof vi.fn> };
  let connections: { getOwnedDecrypted: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    promClient = { queryRange: vi.fn() };
    connections = { getOwnedDecrypted: vi.fn() };
    const ref = await Test.createTestingModule({
      providers: [
        EngineMetricsService,
        { provide: PromClient, useValue: promClient },
        { provide: ConnectionService, useValue: connections },
      ],
    }).compile();
    svc = ref.get(EngineMetricsService);
  });
  afterEach(() => vi.clearAllMocks());

  it("rejects when connection lacks prometheusUrl (422)", async () => {
    connections.getOwnedDecrypted.mockResolvedValueOnce(
      makeConn({ prometheusUrl: null }),
    );
    await expect(
      svc.fetchSnapshot("u1", "c1", {
        from: "2026-05-09T00:00:00.000Z",
        to: "2026-05-09T00:01:00.000Z",
      }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("rejects when serverKind has no manifest (e.g. higress) (422)", async () => {
    connections.getOwnedDecrypted.mockResolvedValueOnce(
      makeConn({ serverKind: "higress" }),
    );
    await expect(
      svc.fetchSnapshot("u1", "c1", {
        from: "2026-05-09T00:00:00.000Z",
        to: "2026-05-09T00:01:00.000Z",
      }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("returns one panel per spec, escapes ${model}", async () => {
    connections.getOwnedDecrypted.mockResolvedValueOnce(makeConn());
    promClient.queryRange.mockResolvedValue({
      unavailable: false,
      series: [{ label: "infer-0", samples: [[1715212800, 0.42]] }],
    });
    const r = await svc.fetchSnapshot("u1", "c1", {
      from: "2026-05-09T00:00:00.000Z",
      to: "2026-05-09T00:01:00.000Z",
      step: 15,
    });
    const manifest = getEngineManifest("vllm");
    expect(r.panels).toHaveLength(manifest!.metrics.length);
    expect(r.engineId).toBe("vllm");
    expect(r.capability).toBe(ENGINE_CAPABILITY.vllm);
    const calls = promClient.queryRange.mock.calls;
    for (const [args] of calls) {
      expect(args.query).not.toContain("${model}");
      expect(args.query).toContain('Qwen2.5-7B-Instruct');
    }
  });

  it("falls through to second variant when first returns no_data", async () => {
    connections.getOwnedDecrypted.mockResolvedValueOnce(makeConn());
    promClient.queryRange
      .mockResolvedValueOnce({ unavailable: true, reason: "no_data", series: [] })
      .mockResolvedValueOnce({
        unavailable: false,
        series: [{ samples: [[1715212800, 0.85]] }],
      })
      .mockResolvedValue({ unavailable: true, reason: "no_data", series: [] });

    const r = await svc.fetchSnapshot("u1", "c1", {
      from: "2026-05-09T00:00:00.000Z",
      to: "2026-05-09T00:01:00.000Z",
    });
    const prefix = r.panels.find((p) => p.key === "prefix_cache_savings");
    expect(prefix?.unavailable).toBe(false);
    expect(prefix?.series[0].samples[0][1]).toBe(0.85);
  });

  it("marks panel unavailable when all variants return prom_error", async () => {
    connections.getOwnedDecrypted.mockResolvedValueOnce(makeConn());
    promClient.queryRange.mockResolvedValue({
      unavailable: true,
      reason: "prom_error",
      series: [],
    });
    const r = await svc.fetchSnapshot("u1", "c1", {
      from: "2026-05-09T00:00:00.000Z",
      to: "2026-05-09T00:01:00.000Z",
    });
    expect(r.panels.every((p) => p.unavailable)).toBe(true);
    expect(r.panels[0].reason).toBe("prom_error");
  });

  it("isolates per-panel failures (Promise.allSettled)", async () => {
    connections.getOwnedDecrypted.mockResolvedValueOnce(makeConn());
    let n = 0;
    promClient.queryRange.mockImplementation(async () => {
      n++;
      if (n === 3) throw new Error("boom");
      return { unavailable: false, series: [{ samples: [[1, 1]] }] };
    });
    const r = await svc.fetchSnapshot("u1", "c1", {
      from: "2026-05-09T00:00:00.000Z",
      to: "2026-05-09T00:01:00.000Z",
    });
    const unavailable = r.panels.filter((p) => p.unavailable);
    expect(unavailable).toHaveLength(1);
    expect(unavailable[0].reason).toBe("prom_error");
  });
});
