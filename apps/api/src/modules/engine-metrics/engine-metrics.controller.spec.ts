import { engineMetricsSnapshotResponseSchema } from "@modeldoctor/contracts";
import { Test } from "@nestjs/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EngineMetricsController } from "./engine-metrics.controller.js";
import { EngineMetricsService } from "./engine-metrics.service.js";

describe("EngineMetricsController", () => {
  let ctrl: EngineMetricsController;
  let svc: { fetchSnapshot: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    svc = { fetchSnapshot: vi.fn() };
    const ref = await Test.createTestingModule({
      controllers: [EngineMetricsController],
      providers: [{ provide: EngineMetricsService, useValue: svc }],
    }).compile();
    ctrl = ref.get(EngineMetricsController);
  });
  afterEach(() => vi.clearAllMocks());

  it("forwards user/connection/query to service and returns shape", async () => {
    const sample = {
      engineId: "vllm" as const,
      capability: "generative" as const,
      window: {
        from: "2026-05-09T00:00:00.000Z",
        to: "2026-05-09T00:01:00.000Z",
        step: 15,
      },
      panels: [],
    };
    svc.fetchSnapshot.mockResolvedValueOnce(sample);
    const result = await ctrl.snapshot({ sub: "u1" } as never, "c1", {
      from: "2026-05-09T00:00:00.000Z",
      to: "2026-05-09T00:01:00.000Z",
      step: 15,
    });
    expect(svc.fetchSnapshot).toHaveBeenCalledWith("u1", "c1", {
      from: "2026-05-09T00:00:00.000Z",
      to: "2026-05-09T00:01:00.000Z",
      step: 15,
    });
    expect(engineMetricsSnapshotResponseSchema.parse(result)).toBeTruthy();
  });
});
