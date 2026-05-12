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
});
