import { describe, expect, it, vi } from "vitest";
import { EvaluationsService } from "../evaluations.service.js";

const userId = "u1";

function repoMock() {
  return {
    create: vi
      .fn()
      .mockResolvedValue({ id: "e1", userId, name: "x", samples: [], totalSamples: 0 }),
    list: vi.fn().mockResolvedValue([]),
    findById: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
}

describe("EvaluationsService", () => {
  it("create calls repo and returns dto", async () => {
    const r = repoMock();
    const svc = new EvaluationsService(r as never, undefined as never);
    const out = await svc.create(userId, {
      name: "x",
      samples: [
        { id: "s0", idx: 0, prompt: "Q", expected: "A", judgeConfig: { kind: "exact-match" } },
      ],
    });
    expect(out.id).toBe("e1");
    expect(r.create).toHaveBeenCalledWith(userId, expect.objectContaining({ name: "x" }));
  });

  it("importFromCsv parses CSV rows into samples", async () => {
    const r = repoMock();
    const svc = new EvaluationsService(r as never, undefined as never);
    const csv = [
      "prompt,expected,judgeKind,judgeConfig,tags",
      `"What is 2+2?","4","exact-match",,`,
      `"翻译: hi","你好","contains","{""substrings"":[""你好""],""mode"":""any""}",greeting`,
    ].join("\n");
    const samples = await svc.parseCsv(csv);
    expect(samples.length).toBe(2);
    expect(samples[1].judgeConfig).toMatchObject({ kind: "contains" });
    expect(samples[1].tags).toEqual(["greeting"]);
  });

  it("parseCsv rejects unknown judgeKind", async () => {
    const r = repoMock();
    const svc = new EvaluationsService(r as never, undefined as never);
    await expect(svc.parseCsv("prompt,expected,judgeKind\nQ,A,wat")).rejects.toThrow();
  });

  it("parseCsv preserves newlines inside quoted fields (RFC-4180)", async () => {
    const svc = new EvaluationsService(repoMock() as never, undefined as never);
    const csv =
      'prompt,expected,judgeKind\n"line one\nline two","ok","exact-match"\n"single","ok2","exact-match"';
    const samples = await svc.parseCsv(csv);
    expect(samples.length).toBe(2);
    expect(samples[0].prompt).toBe("line one\nline two");
    expect(samples[1].prompt).toBe("single");
  });

  it("parseCsv matches headers case-insensitively", async () => {
    const svc = new EvaluationsService(repoMock() as never, undefined as never);
    const csv = "Prompt,Expected,JudgeKind\nQ,A,exact-match";
    const samples = await svc.parseCsv(csv);
    expect(samples.length).toBe(1);
    expect(samples[0].prompt).toBe("Q");
  });
});

describe("setBaseline", () => {
  const userId = "u1";
  const evaluationId = "ev1";
  const runId = "run-pinned";

  function build() {
    const repo = {
      findById: vi.fn().mockResolvedValue({
        id: evaluationId,
        userId,
        name: "demo",
        baselineRunId: null,
      }),
      update: vi.fn().mockImplementation(async (_u, id, body) => ({
        id,
        userId,
        name: "demo",
        baselineRunId: body.baselineRunId ?? null,
      })),
    };
    const runsRepo = {
      findById: vi.fn().mockResolvedValue({
        id: runId,
        userId,
        evaluationId,
        status: "COMPLETED",
        gateResult: "PASSED",
      }),
    };
    return { repo, runsRepo };
  }

  it("pins a completed run owned by the user", async () => {
    const { repo, runsRepo } = build();
    const svc = new EvaluationsService(repo as never, runsRepo as never);
    const out = await svc.setBaseline(userId, evaluationId, runId);
    expect(out.baselineRunId).toBe(runId);
    expect(repo.update).toHaveBeenCalledWith(userId, evaluationId, { baselineRunId: runId });
  });

  it("unpins when runId is null", async () => {
    const { repo, runsRepo } = build();
    const svc = new EvaluationsService(repo as never, runsRepo as never);
    const out = await svc.setBaseline(userId, evaluationId, null);
    expect(out.baselineRunId).toBeNull();
    expect(repo.update).toHaveBeenCalledWith(userId, evaluationId, { baselineRunId: null });
  });

  it("rejects when run belongs to different evaluation", async () => {
    const { repo, runsRepo } = build();
    runsRepo.findById.mockResolvedValueOnce({
      id: runId,
      userId,
      evaluationId: "different-eval",
      status: "COMPLETED",
    });
    const svc = new EvaluationsService(repo as never, runsRepo as never);
    await expect(svc.setBaseline(userId, evaluationId, runId)).rejects.toThrow(
      /belongs to a different evaluation/,
    );
  });

  it("rejects when run is not COMPLETED", async () => {
    const { repo, runsRepo } = build();
    runsRepo.findById.mockResolvedValueOnce({
      id: runId,
      userId,
      evaluationId,
      status: "RUNNING",
    });
    const svc = new EvaluationsService(repo as never, runsRepo as never);
    await expect(svc.setBaseline(userId, evaluationId, runId)).rejects.toThrow(/must be COMPLETED/);
  });

  it("rejects when run not found / not owned", async () => {
    const { repo, runsRepo } = build();
    runsRepo.findById.mockResolvedValueOnce(null);
    const svc = new EvaluationsService(repo as never, runsRepo as never);
    await expect(svc.setBaseline(userId, evaluationId, runId)).rejects.toThrow(/run .* not found/);
  });

  it("rejects when run has FAILED gate verdict", async () => {
    const { repo, runsRepo } = build();
    runsRepo.findById.mockResolvedValueOnce({
      id: runId,
      userId,
      evaluationId,
      status: "COMPLETED",
      gateResult: "FAILED",
    });
    const svc = new EvaluationsService(repo as never, runsRepo as never);
    await expect(svc.setBaseline(userId, evaluationId, runId)).rejects.toThrow(
      /failed its gate verdict/,
    );
  });
});
