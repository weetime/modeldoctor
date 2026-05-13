import { describe, expect, it, vi } from "vitest";
import { QualityGateRunExecutor } from "../run-executor.service.js";

function buildMocks() {
  const repo = {
    findFullRun: vi.fn(),
    markRunning: vi.fn().mockResolvedValue(undefined),
    updateProgress: vi.fn().mockResolvedValue(undefined),
    saveSample: vi.fn().mockResolvedValue(undefined),
    sampleRowsForAggregate: vi.fn().mockResolvedValue([]),
    markCompleted: vi.fn().mockResolvedValue(undefined),
    markCancelled: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    sweepRunningOnBoot: vi.fn().mockResolvedValue(0),
  };
  const caller = { call: vi.fn().mockResolvedValue({ rawAnswer: "ok", latencyMs: 1 }) };
  const judge = { apply: vi.fn().mockResolvedValue({ passed: true }) };
  return { repo, caller, judge };
}

const sample = (i: number) => ({
  id: `s${i}`,
  idx: i,
  prompt: "Q",
  expected: "A",
  judgeConfig: { kind: "exact-match" as const },
});

describe("QualityGateRunExecutor", () => {
  it("happy path runs through samples and marks COMPLETED with metrics", async () => {
    const m = buildMocks();
    m.repo.findFullRun.mockResolvedValue({
      id: "r1",
      userId: "u1",
      endpointAId: "a",
      endpointBId: null,
      evaluationSnapshot: { samples: [sample(0), sample(1), sample(2)] },
      gateConfig: { passRateMin: 0.9 },
    });
    m.repo.sampleRowsForAggregate.mockResolvedValue([
      { resultA: { call: {}, judge: { passed: true } }, resultB: null },
      { resultA: { call: {}, judge: { passed: true } }, resultB: null },
      { resultA: { call: {}, judge: { passed: true } }, resultB: null },
    ]);
    const ex = new QualityGateRunExecutor(m.repo as never, m.caller as never, m.judge as never);
    await ex.start("r1");
    expect(m.caller.call).toHaveBeenCalledTimes(3);
    expect(m.judge.apply).toHaveBeenCalledTimes(3);
    expect(m.repo.markCompleted).toHaveBeenCalled();
  });

  it("dual-endpoint mode calls both A and B per sample", async () => {
    const m = buildMocks();
    m.repo.findFullRun.mockResolvedValue({
      id: "r2",
      userId: "u1",
      endpointAId: "a",
      endpointBId: "b",
      evaluationSnapshot: { samples: [sample(0), sample(1)] },
      gateConfig: { passRateMin: 0.9 },
    });
    const ex = new QualityGateRunExecutor(m.repo as never, m.caller as never, m.judge as never);
    await ex.start("r2");
    expect(m.caller.call).toHaveBeenCalledTimes(4);
    expect(m.judge.apply).toHaveBeenCalledTimes(4);
  });

  it("cancel stops issuing further calls and marks CANCELLED", async () => {
    const m = buildMocks();
    m.repo.findFullRun.mockResolvedValue({
      id: "r3",
      userId: "u1",
      endpointAId: "a",
      endpointBId: null,
      evaluationSnapshot: { samples: Array.from({ length: 20 }, (_, i) => sample(i)) },
      gateConfig: { passRateMin: 0.9 },
    });
    m.caller.call.mockImplementation(
      async (_id: string, _userId: string, _q: string, signal: AbortSignal) => {
        await new Promise((r) => setTimeout(r, 30));
        if (signal.aborted) return { rawAnswer: "", latencyMs: 0, error: "cancelled" };
        return { rawAnswer: "x", latencyMs: 1 };
      },
    );
    const ex = new QualityGateRunExecutor(m.repo as never, m.caller as never, m.judge as never);
    const p = ex.start("r3");
    await new Promise((r) => setTimeout(r, 10));
    ex.cancel("r3");
    await p;
    expect(m.repo.markCancelled).toHaveBeenCalled();
  });

  it("repo error → markFailed", async () => {
    const m = buildMocks();
    m.repo.findFullRun.mockRejectedValueOnce(new Error("boom"));
    const ex = new QualityGateRunExecutor(m.repo as never, m.caller as never, m.judge as never);
    await ex.start("r4");
    expect(m.repo.markFailed).toHaveBeenCalledWith("r4", expect.stringContaining("boom"));
  });

  it("onModuleInit calls sweepRunningOnBoot", async () => {
    const m = buildMocks();
    const ex = new QualityGateRunExecutor(m.repo as never, m.caller as never, m.judge as never);
    await ex.onModuleInit();
    expect(m.repo.sweepRunningOnBoot).toHaveBeenCalled();
  });
});
