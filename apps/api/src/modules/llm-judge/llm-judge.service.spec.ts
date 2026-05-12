// apps/api/src/modules/llm-judge/llm-judge.service.spec.ts
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaService } from "../../database/prisma.service.js";
import { LlmJudgeService } from "./llm-judge.service.js";

// 32-byte base64 key for AES-256-GCM
const TEST_KEY_B64 = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";

// Helper to build a realistic DB row
function makeRow(
  overrides: Partial<{
    id: string;
    baseUrl: string;
    apiKeyCipher: string;
    model: string;
    enabled: boolean;
    createdAt: Date;
    updatedAt: Date;
  }> = {},
) {
  return {
    id: "row-1",
    baseUrl: "https://x",
    apiKeyCipher: "CIPHER",
    model: "gpt-x",
    enabled: true,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("LlmJudgeService", () => {
  let svc: LlmJudgeService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        LlmJudgeService,
        PrismaService,
        { provide: ConfigService, useValue: { get: () => TEST_KEY_B64 } },
      ],
    }).compile();
    svc = mod.get(LlmJudgeService);
    prisma = mod.get(PrismaService);

    // Stub out all prisma methods used by LlmJudgeService
    vi.spyOn(prisma.llmJudgeProvider, "findFirst").mockResolvedValue(null);
    vi.spyOn(prisma.llmJudgeProvider, "create").mockResolvedValue(makeRow());
    vi.spyOn(prisma.llmJudgeProvider, "update").mockResolvedValue(makeRow());
    vi.spyOn(prisma.llmJudgeProvider, "deleteMany").mockResolvedValue({ count: 0 });
  });

  // -------------------------------------------------------------------------
  // getPublic / getDecrypted — no row
  // -------------------------------------------------------------------------
  it("returns null when no provider configured", async () => {
    vi.spyOn(prisma.llmJudgeProvider, "findFirst").mockResolvedValue(null);

    expect(await svc.getPublic()).toBeNull();
    expect(await svc.getDecrypted()).toBeNull();
  });

  // -------------------------------------------------------------------------
  // upsert — create path (table empty)
  // -------------------------------------------------------------------------
  it("upsert encrypts and round-trips (create path)", async () => {
    // findFirst returns null → create branch
    vi.spyOn(prisma.llmJudgeProvider, "findFirst").mockResolvedValue(null);

    // We need a placeholder row to return from create; the real cipher will be
    // captured from the create spy's call args so we can decrypt it in getDecrypted.
    vi.spyOn(prisma.llmJudgeProvider, "create").mockResolvedValue(
      makeRow({ baseUrl: "https://x", model: "gpt-x", enabled: true }),
    );

    const pub = await svc.upsert({
      baseUrl: "https://x",
      apiKey: "sk-secret",
      model: "gpt-x",
      enabled: true,
    });
    expect(pub.baseUrl).toBe("https://x");

    // Capture the real cipher that encrypt() produced and pass it to findFirst
    const createSpy = vi.mocked(prisma.llmJudgeProvider.create);
    const savedCipher = (createSpy.mock.calls[0][0].data as { apiKeyCipher: string }).apiKeyCipher;
    vi.spyOn(prisma.llmJudgeProvider, "findFirst").mockResolvedValue(
      makeRow({ apiKeyCipher: savedCipher }),
    );

    const dec = await svc.getDecrypted();
    expect(dec?.apiKey).toBe("sk-secret");
  });

  // -------------------------------------------------------------------------
  // upsert — update path (existing row)
  // -------------------------------------------------------------------------
  it("upsert idempotent — second call updates existing row", async () => {
    // First upsert: table empty → create
    vi.spyOn(prisma.llmJudgeProvider, "findFirst").mockResolvedValue(null);
    vi.spyOn(prisma.llmJudgeProvider, "create").mockResolvedValue(
      makeRow({ id: "row-1", baseUrl: "https://a", model: "m1", enabled: true }),
    );
    await svc.upsert({ baseUrl: "https://a", apiKey: "k1", model: "m1", enabled: true });

    // Second upsert: existing row present → update
    vi.spyOn(prisma.llmJudgeProvider, "findFirst").mockResolvedValue(
      makeRow({ id: "row-1", baseUrl: "https://a", model: "m1", enabled: true }),
    );
    vi.spyOn(prisma.llmJudgeProvider, "update").mockResolvedValue(
      makeRow({ id: "row-1", baseUrl: "https://b", model: "m2", enabled: false }),
    );
    await svc.upsert({ baseUrl: "https://b", apiKey: "k2", model: "m2", enabled: false });

    // Capture cipher from update call so we can decrypt it
    const updateSpy = vi.mocked(prisma.llmJudgeProvider.update);
    const savedCipher = (updateSpy.mock.calls[0][0].data as { apiKeyCipher: string }).apiKeyCipher;
    vi.spyOn(prisma.llmJudgeProvider, "findFirst").mockResolvedValue(
      makeRow({
        id: "row-1",
        baseUrl: "https://b",
        model: "m2",
        enabled: false,
        apiKeyCipher: savedCipher,
      }),
    );

    const dec = await svc.getDecrypted();
    expect(dec?.baseUrl).toBe("https://b");
    expect(dec?.enabled).toBe(false);
    expect(dec?.apiKey).toBe("k2");

    // update must have been called with the matching row id
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "row-1" } }));
  });

  // -------------------------------------------------------------------------
  // delete
  // -------------------------------------------------------------------------
  it("delete removes all rows", async () => {
    vi.spyOn(prisma.llmJudgeProvider, "deleteMany").mockResolvedValue({ count: 1 });
    await svc.delete();

    expect(prisma.llmJudgeProvider.deleteMany).toHaveBeenCalledWith({});
  });

  it("delete throws NotFoundException when no row exists", async () => {
    vi.spyOn(prisma.llmJudgeProvider, "deleteMany").mockResolvedValue({ count: 0 });
    await expect(svc.delete()).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // "latest wins" semantics
  // -------------------------------------------------------------------------
  it("getPublic returns the most-recently-updated row when multiple exist", async () => {
    const newerRow = makeRow({
      id: "row-newer",
      baseUrl: "https://newer",
      model: "newer-model",
      enabled: true,
      updatedAt: new Date("2024-06-01T12:00:00Z"),
    });

    // findFirst({ orderBy: { updatedAt: "desc" } }) is supposed to return the newest row
    vi.spyOn(prisma.llmJudgeProvider, "findFirst").mockResolvedValue(newerRow);

    const pub = await svc.getPublic();

    expect(pub).not.toBeNull();
    expect(pub?.id).toBe("row-newer");
    expect(pub?.baseUrl).toBe("https://newer");
    expect(pub?.model).toBe("newer-model");

    // Confirm the spy was called with the correct orderBy
    expect(prisma.llmJudgeProvider.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { updatedAt: "desc" } }),
    );
  });
});
