import { NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { decodeKey, decrypt } from "../../../common/crypto/aes-gcm.js";
import { PrismaService } from "../../../database/prisma.service.js";
import { GpustackClientFactory } from "../gpustack/gpustack-client.js";
import { PlatformSourcesService } from "./platform-sources.service.js";

const KEY_B64 = Buffer.alloc(32, 7).toString("base64");

function row(over: Record<string, unknown> = {}) {
  return {
    id: "s1",
    userId: "u1",
    kind: "gpustack",
    name: "prod",
    baseUrl: "http://gs",
    apiKeyCipher: "x",
    clusterId: null,
    enabled: true,
    lastSyncAt: null,
    lastSyncError: null,
    createdAt: new Date("2026-09-22T00:00:00Z"),
    updatedAt: new Date("2026-09-22T00:00:00Z"),
    _count: { models: 3 },
    ...over,
  };
}

describe("PlatformSourcesService", () => {
  let prisma: {
    platformSource: Record<string, ReturnType<typeof vi.fn>>;
  };
  let factory: { create: ReturnType<typeof vi.fn> };
  let service: PlatformSourcesService;

  beforeEach(async () => {
    prisma = {
      platformSource: {
        create: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
    };
    factory = { create: vi.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        PlatformSourcesService,
        { provide: PrismaService, useValue: prisma },
        { provide: GpustackClientFactory, useValue: factory },
        { provide: ConfigService, useValue: { get: () => KEY_B64 } },
      ],
    }).compile();
    service = moduleRef.get(PlatformSourcesService);
  });

  it("create encrypts api key and returns public shape without secret", async () => {
    prisma.platformSource.create.mockImplementation(async ({ data }) =>
      row({ apiKeyCipher: data.apiKeyCipher }),
    );
    const out = await service.create("u1", {
      kind: "gpustack",
      name: "prod",
      baseUrl: "http://gs",
      apiKey: "secret",
    });
    const data = prisma.platformSource.create.mock.calls[0][0].data;
    expect(decrypt(data.apiKeyCipher, decodeKey(KEY_B64))).toBe("secret");
    expect(out).toMatchObject({ id: "s1", modelCount: 3, lastSyncAt: null });
    expect(out).not.toHaveProperty("apiKeyCipher");
  });

  it("get throws 404 for other user's source", async () => {
    prisma.platformSource.findFirst.mockResolvedValue(null);
    await expect(service.get("u2", "s1")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("test returns ok + count", async () => {
    factory.create.mockResolvedValue({ countModels: vi.fn().mockResolvedValue(5) });
    expect(await service.test({ baseUrl: "http://gs", apiKey: "k" })).toEqual({
      ok: true,
      modelCount: 5,
      error: null,
    });
  });

  it("test returns error message instead of throwing", async () => {
    factory.create.mockResolvedValue({
      countModels: vi.fn().mockRejectedValue(new Error("HTTP 401")),
    });
    expect(await service.test({ baseUrl: "http://gs", apiKey: "k" })).toEqual({
      ok: false,
      modelCount: null,
      error: "HTTP 401",
    });
  });

  it("notifies change listeners on create", async () => {
    prisma.platformSource.create.mockResolvedValue(row());
    const l = vi.fn();
    service.onChange(l);
    await service.create("u1", { kind: "gpustack", name: "p", baseUrl: "http://gs", apiKey: "k" });
    expect(l).toHaveBeenCalledWith("s1", "upsert");
  });
});
