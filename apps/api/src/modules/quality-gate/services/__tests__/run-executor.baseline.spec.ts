import { describe, expect, it, vi } from "vitest";
import { QualityGateRunExecutor } from "../run-executor.service.js";

function judgePass() {
  return { passed: true };
}
function judgeFail() {
  return { passed: false };
}

function buildExecutor(overrides: {
  baselineRunIdAtExecution?: string | null;
  baselineSamples?: Map<string, { resultA: unknown }>;
  endpointAReturns?: Array<{ rawAnswer: string; latencyMs: number }>;
} = {}) {
  const samples = [
    { id: "s0", idx: 0, prompt: "Q1", expected: "A", judgeConfig: { kind: "exact-match" as const } },
    { id: "s1", idx: 1, prompt: "Q2", expected: "B", judgeConfig: { kind: "exact-match" as const } },
  ];
  const repo = {
    findFullRun: vi.fn().mockResolvedValue({
      id: "r1",
      userId: "u1",
      endpointAId: "epA",
      endpointBId: null,
      evaluationSnapshot: { samples },
      gateConfig: { passRateMin: 0.5 },
      baselineRunIdAtExecution: overrides.baselineRunIdAtExecution ?? null,
    }),
    loadCompletedSamplesById: vi
      .fn()
      .mockResolvedValue(overrides.baselineSamples ?? new Map()),
    markRunning: vi.fn(),
    saveSample: vi.fn(),
    updateProgress: vi.fn(),
    sampleRowsForAggregate: vi.fn().mockResolvedValue([]),
    markCompleted: vi.fn(),
    markFailed: vi.fn(),
    markCancelled: vi.fn(),
    sweepRunningOnBoot: vi.fn(),
  };
  const endpointCaller = {
    call: vi.fn(async (_id, _u, prompt) => {
      const idx = prompt === "Q1" ? 0 : 1;
      return (
        overrides.endpointAReturns?.[idx] ?? { rawAnswer: prompt === "Q1" ? "A" : "B", latencyMs: 10 }
      );
    }),
  };
  const judges = {
    apply: vi.fn(async (_cfg, { expected, answer }) =>
      expected === answer ? judgePass() : judgeFail(),
    ),
  };
  return {
    executor: new QualityGateRunExecutor(repo as never, endpointCaller as never, judges as never),
    repo,
    endpointCaller,
    judges,
  };
}

describe("QualityGateRunExecutor baseline mode", () => {
  it("loads baseline samples when baselineRunIdAtExecution is set", async () => {
    const baseline = new Map([
      ["s0", { resultA: { call: { rawAnswer: "A", latencyMs: 5 }, judge: { passed: true } } }],
      ["s1", { resultA: { call: { rawAnswer: "B", latencyMs: 5 }, judge: { passed: true } } }],
    ]);
    const { executor, repo } = buildExecutor({
      baselineRunIdAtExecution: "baseline-r",
      baselineSamples: baseline as never,
    });
    await executor.start("r1");
    expect(repo.loadCompletedSamplesById).toHaveBeenCalledWith("baseline-r");
    expect(repo.saveSample).toHaveBeenCalledTimes(2);
    const calls = repo.saveSample.mock.calls.map((c: never[]) => c[0] as { resultB: unknown });
    expect(calls.every((c) => c.resultB !== null)).toBe(true);
  });

  it("does NOT load baseline when baselineRunIdAtExecution is null", async () => {
    const { executor, repo } = buildExecutor({ baselineRunIdAtExecution: null });
    await executor.start("r1");
    expect(repo.loadCompletedSamplesById).not.toHaveBeenCalled();
  });

  it("falls back to delta=NA when baseline is missing a sample", async () => {
    const baseline = new Map([
      ["s0", { resultA: { call: { rawAnswer: "A", latencyMs: 5 }, judge: { passed: true } } }],
    ]);
    const { executor, repo } = buildExecutor({
      baselineRunIdAtExecution: "baseline-r",
      baselineSamples: baseline as never,
    });
    await executor.start("r1");
    const calls = repo.saveSample.mock.calls.map((c: never[]) => c[0] as { sampleId: string; delta: string; resultB: unknown });
    const s1 = calls.find((c) => c.sampleId === "s1");
    expect(s1).toBeDefined();
    expect(s1?.delta).toBe("NA");
    expect(s1?.resultB).toBeNull();
  });

  it("computes REGRESSION when today fails but baseline passed", async () => {
    const baseline = new Map([
      ["s0", { resultA: { call: { rawAnswer: "A", latencyMs: 5 }, judge: { passed: true } } }],
    ]);
    const { executor, repo, endpointCaller } = buildExecutor({
      baselineRunIdAtExecution: "baseline-r",
      baselineSamples: baseline as never,
      endpointAReturns: [{ rawAnswer: "wrong", latencyMs: 10 }, { rawAnswer: "B", latencyMs: 10 }],
    });
    await executor.start("r1");
    const calls = repo.saveSample.mock.calls.map((c: never[]) => c[0] as { sampleId: string; delta: string });
    expect(calls.find((c) => c.sampleId === "s0")?.delta).toBe("REGRESSION");
  });
});
