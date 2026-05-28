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
    const svc = new EvaluationsService(r as never);
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
    const svc = new EvaluationsService(r as never);
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
    const svc = new EvaluationsService(r as never);
    await expect(svc.parseCsv("prompt,expected,judgeKind\nQ,A,wat")).rejects.toThrow();
  });

  it("parseCsv preserves newlines inside quoted fields (RFC-4180)", async () => {
    const svc = new EvaluationsService(repoMock() as never);
    const csv =
      'prompt,expected,judgeKind\n"line one\nline two","ok","exact-match"\n"single","ok2","exact-match"';
    const samples = await svc.parseCsv(csv);
    expect(samples.length).toBe(2);
    expect(samples[0].prompt).toBe("line one\nline two");
    expect(samples[1].prompt).toBe("single");
  });

  it("parseCsv matches headers case-insensitively", async () => {
    const svc = new EvaluationsService(repoMock() as never);
    const csv = "Prompt,Expected,JudgeKind\nQ,A,exact-match";
    const samples = await svc.parseCsv(csv);
    expect(samples.length).toBe(1);
    expect(samples[0].prompt).toBe("Q");
  });
});

describe("Official evaluation guards", () => {
  const userId = "u1";
  const officialId = "ev_official";

  function buildOfficialRepo() {
    return {
      findById: vi.fn().mockResolvedValue({
        id: officialId,
        userId: "usr_system_seed_00000000000",
        name: "Built-in",
        description: "official",
        samples: [
          { id: "s0", idx: 0, prompt: "Q", expected: "A", judgeConfig: { kind: "exact-match" } },
        ],
        isOfficial: true,
      }),
      update: vi.fn(),
      delete: vi.fn(),
      create: vi.fn().mockResolvedValue({
        id: "ev_copy",
        userId,
        name: "Built-in (副本)",
        samples: [],
        isOfficial: false,
      }),
    };
  }

  it("update rejects any change on official evaluations", async () => {
    const repo = buildOfficialRepo();
    const svc = new EvaluationsService(repo as never);

    await expect(svc.update(userId, officialId, { name: "hacked" })).rejects.toThrow(
      /is official and read-only/,
    );
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("delete rejects official evaluations", async () => {
    const repo = buildOfficialRepo();
    const svc = new EvaluationsService(repo as never);
    await expect(svc.delete(userId, officialId)).rejects.toThrow(
      /is official and cannot be deleted/,
    );
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it("duplicate creates a user-owned copy with name suffix", async () => {
    const repo = buildOfficialRepo();
    const svc = new EvaluationsService(repo as never);
    const out = await svc.duplicate(userId, officialId);
    expect(out.id).toBe("ev_copy");
    expect(repo.create).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({
        name: "Built-in (副本)",
        samples: expect.arrayContaining([expect.objectContaining({ prompt: "Q" })]),
      }),
    );
  });

  it("duplicate rejects when source not found / not accessible", async () => {
    const repo = buildOfficialRepo();
    repo.findById.mockResolvedValueOnce(null);
    const svc = new EvaluationsService(repo as never);
    await expect(svc.duplicate(userId, "missing")).rejects.toThrow(/not found/);
  });
});
