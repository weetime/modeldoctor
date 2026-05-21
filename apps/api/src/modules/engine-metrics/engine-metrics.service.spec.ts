import { ENGINE_CAPABILITY, getEngineManifest } from "@modeldoctor/contracts";
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
    prometheusDatasource: {
      id: "ds_1",
      baseUrl: "http://prom:9090",
      bearerToken: null,
    },
    prometheusDatasourceId: "ds_1",
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

  it("rejects when connection has no prometheusDatasource bound (422)", async () => {
    connections.getOwnedDecrypted.mockResolvedValueOnce(
      makeConn({ prometheusDatasource: null, prometheusDatasourceId: null }),
    );
    await expect(
      svc.fetchSnapshot("u1", "c1", {
        from: "2026-05-09T00:00:00.000Z",
        to: "2026-05-09T00:01:00.000Z",
      }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("rejects when serverKind has no manifest (e.g. generic) (422)", async () => {
    // `generic` is the only serverKind in the enum that has no engine-
    // metrics manifest by design — it represents "we know it's an OpenAI-
    // compatible endpoint but not which engine". Previously this case was
    // exercised via "higress", but Higress is no longer in the engine
    // enum (it's a gateway tag).
    connections.getOwnedDecrypted.mockResolvedValueOnce(makeConn({ serverKind: "generic" }));
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
    expect(manifest).not.toBeNull();
    expect(r.panels).toHaveLength(manifest?.metrics.length ?? -1);
    expect(r.engineId).toBe("vllm");
    expect(r.capability).toBe(ENGINE_CAPABILITY.vllm);
    const calls = promClient.queryRange.mock.calls;
    // Every query must have the placeholder substituted; process-level
    // metrics (no model_name label) just won't reference the model at all.
    let modelScopedSeen = 0;
    for (const [args] of calls) {
      expect(args.query).not.toContain("${model}");
      if (args.query.includes("model_name=")) {
        expect(args.query).toContain("Qwen2.5-7B-Instruct");
        modelScopedSeen += 1;
      }
    }
    expect(modelScopedSeen).toBeGreaterThan(0);
  });

  it("falls through to second variant when first returns no_data", async () => {
    connections.getOwnedDecrypted.mockResolvedValueOnce(makeConn());

    // Default behavior: every panel returns one usable series.
    // For the prefix_cache_savings panel specifically (which has 2 variants —
    // v1 prefix_cache_*, v0 gpu_prefix_cache_*), simulate v1 having no data so
    // we fall through to v0.
    promClient.queryRange.mockImplementation(async (args: { query: string }) => {
      if (
        args.query.includes("vllm:prefix_cache_") &&
        !args.query.includes("vllm:gpu_prefix_cache_")
      ) {
        // v1 variant — pretend no data, force fallthrough
        return { unavailable: true, reason: "no_data", series: [] };
      }
      if (args.query.includes("vllm:gpu_prefix_cache_")) {
        // v0 variant — has data
        return {
          unavailable: false,
          series: [{ samples: [[1715212800, 0.85]] }],
        };
      }
      // All other panels: arbitrary success.
      return {
        unavailable: false,
        series: [{ samples: [[1715212800, 1]] }],
      };
    });

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
    // The third metric in the array (system_efficiency) throws. Every other
    // panel succeeds. The thrown panel should still come back, just marked
    // unavailable with reason: prom_error.
    let n = 0;
    promClient.queryRange.mockImplementation(async (args: { query: string }) => {
      n++;
      if (args.query.includes("system_efficiency") || n === 3) {
        throw new Error("boom");
      }
      return { unavailable: false, series: [{ samples: [[1, 1]] }] };
    });
    const r = await svc.fetchSnapshot("u1", "c1", {
      from: "2026-05-09T00:00:00.000Z",
      to: "2026-05-09T00:01:00.000Z",
    });
    // Note: this is a soft assertion — Promise.allSettled may dispatch all 19
    // queries before the first throw lands; the n===3 trigger keeps it
    // deterministic that exactly ONE panel throws.
    const unavailable = r.panels.filter((p) => p.unavailable);
    expect(unavailable).toHaveLength(1);
    expect(unavailable[0].reason).toBe("prom_error");
  });
});
