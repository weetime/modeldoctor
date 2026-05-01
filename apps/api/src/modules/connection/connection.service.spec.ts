import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import type { Connection as PrismaConnection } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaService } from "../../database/prisma.service.js";
import { ConnectionService } from "./connection.service.js";

const KEY_B64 = Buffer.alloc(32, 7).toString("base64");

function makePrismaMock() {
  return {
    connection: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
}

function makeRow(overrides: Partial<PrismaConnection> = {}): PrismaConnection {
  return {
    id: "c_1",
    userId: "u_1",
    name: "vllm-prod",
    baseUrl: "http://10.x.x.x:30888",
    apiKeyCipher: "v1:placeholder",
    model: "qwen2.5",
    customHeaders: "",
    queryParams: "",
    category: "chat",
    tags: [],
    prometheusUrl: null,
    serverKind: null,
    createdAt: new Date("2026-05-01T00:00:00Z"),
    updatedAt: new Date("2026-05-01T00:00:00Z"),
    ...overrides,
  };
}

async function makeService(prismaMock: ReturnType<typeof makePrismaMock>) {
  const moduleRef = await Test.createTestingModule({
    providers: [
      ConnectionService,
      { provide: PrismaService, useValue: prismaMock },
      {
        provide: ConfigService,
        useValue: { get: () => KEY_B64 },
      },
    ],
  }).compile();
  return moduleRef.get(ConnectionService);
}

describe("ConnectionService", () => {
  let prismaMock: ReturnType<typeof makePrismaMock>;
  let service: ConnectionService;

  beforeEach(async () => {
    prismaMock = makePrismaMock();
    service = await makeService(prismaMock);
  });

  describe("create", () => {
    it("encrypts apiKey, stores cipher, returns ConnectionWithSecret containing plaintext once", async () => {
      const PLAINTEXT = "sk-secret-12345";
      let storedCipher = "";
      prismaMock.connection.create.mockImplementation(
        async (args: { data: { apiKeyCipher: string } & Record<string, unknown> }) => {
          storedCipher = args.data.apiKeyCipher;
          return makeRow({ apiKeyCipher: storedCipher });
        },
      );
      const out = await service.create("u_1", {
        name: "vllm-prod",
        baseUrl: "http://10.x.x.x:30888",
        apiKey: PLAINTEXT,
        model: "qwen2.5",
        customHeaders: "",
        queryParams: "",
        category: "chat",
        tags: [],
      });
      expect(storedCipher).toMatch(/^v1:/);
      expect(storedCipher).not.toContain(PLAINTEXT);
      expect(out.apiKey).toBe(PLAINTEXT);
      expect(out.apiKeyPreview).toBe("sk-...2345");
    });

    it("persists prometheusUrl + serverKind when provided", async () => {
      let storedData: Record<string, unknown> = {};
      prismaMock.connection.create.mockImplementation(
        async (args: { data: Record<string, unknown> & { apiKeyCipher: string } }) => {
          storedData = args.data;
          return makeRow({
            apiKeyCipher: args.data.apiKeyCipher as string,
            prometheusUrl: "http://prom:9090",
            serverKind: "vllm",
          });
        },
      );
      const out = await service.create("u_1", {
        name: "vllm-prod",
        baseUrl: "http://10.x.x.x:30888",
        apiKey: "sk-abc",
        model: "qwen2.5",
        customHeaders: "",
        queryParams: "",
        category: "chat",
        tags: [],
        prometheusUrl: "http://prom:9090",
        serverKind: "vllm",
      });
      expect(storedData.prometheusUrl).toBe("http://prom:9090");
      expect(storedData.serverKind).toBe("vllm");
      expect(out.prometheusUrl).toBe("http://prom:9090");
      expect(out.serverKind).toBe("vllm");
    });

    it("defaults prometheusUrl + serverKind to null when omitted", async () => {
      prismaMock.connection.create.mockImplementation(
        async (args: { data: Record<string, unknown> & { apiKeyCipher: string } }) => {
          return makeRow({ apiKeyCipher: args.data.apiKeyCipher as string });
        },
      );
      const out = await service.create("u_1", {
        name: "x",
        baseUrl: "http://x",
        apiKey: "k",
        model: "m",
        customHeaders: "",
        queryParams: "",
        category: "chat",
        tags: [],
      });
      expect(out.prometheusUrl).toBeNull();
      expect(out.serverKind).toBeNull();
    });
  });

  describe("list", () => {
    it("returns items with apiKeyPreview only, never plaintext or cipher", async () => {
      const cipher = await encryptForTest("sk-secret-abcdefgh");
      prismaMock.connection.findMany.mockResolvedValue([makeRow({ apiKeyCipher: cipher })]);
      const out = await service.list("u_1");
      expect(out.items).toHaveLength(1);
      const item = out.items[0];
      expect(item).not.toHaveProperty("apiKey");
      expect(item).not.toHaveProperty("apiKeyCipher");
      expect(item.apiKeyPreview).toBe("sk-...efgh");
    });
  });

  describe("findOwnedPublic", () => {
    it("returns ConnectionPublic for the owner", async () => {
      const cipher = await encryptForTest("sk-aaa1234");
      prismaMock.connection.findUnique.mockResolvedValue(makeRow({ apiKeyCipher: cipher }));
      const out = await service.findOwnedPublic("u_1", "c_1");
      expect(out.id).toBe("c_1");
      expect(out.apiKeyPreview).toBe("sk-...1234");
    });
    it("throws NotFoundException for missing", async () => {
      prismaMock.connection.findUnique.mockResolvedValue(null);
      await expect(service.findOwnedPublic("u_1", "c_x")).rejects.toThrow(NotFoundException);
    });
    it("throws ForbiddenException when userId mismatches", async () => {
      prismaMock.connection.findUnique.mockResolvedValue(makeRow({ userId: "u_other" }));
      await expect(service.findOwnedPublic("u_1", "c_1")).rejects.toThrow(ForbiddenException);
    });
  });

  describe("update", () => {
    it("returns ConnectionWithSecret when apiKey is rotated", async () => {
      const oldCipher = await encryptForTest("sk-old-1234");
      prismaMock.connection.findUnique.mockResolvedValue(makeRow({ apiKeyCipher: oldCipher }));
      let newCipher = "";
      prismaMock.connection.update.mockImplementation(
        async (args: { data: { apiKeyCipher?: string } }) => {
          newCipher = args.data.apiKeyCipher ?? "";
          return makeRow({ apiKeyCipher: newCipher });
        },
      );
      const out = await service.update("u_1", "c_1", { apiKey: "sk-new-5678" });
      expect("apiKey" in out).toBe(true);
      expect((out as { apiKey: string }).apiKey).toBe("sk-new-5678");
      expect(newCipher).toMatch(/^v1:/);
      expect(newCipher).not.toBe(oldCipher);
    });
    it("returns ConnectionPublic (no plaintext) when apiKey is not rotated", async () => {
      const cipher = await encryptForTest("sk-keep-1234");
      prismaMock.connection.findUnique.mockResolvedValue(makeRow({ apiKeyCipher: cipher }));
      prismaMock.connection.update.mockResolvedValue(
        makeRow({ apiKeyCipher: cipher, name: "renamed" }),
      );
      const out = await service.update("u_1", "c_1", { name: "renamed" });
      expect("apiKey" in out).toBe(false);
      expect(out.name).toBe("renamed");
    });

    it("clears prometheusUrl + serverKind when caller passes null", async () => {
      const cipher = await encryptForTest("sk-keep-1234");
      prismaMock.connection.findUnique.mockResolvedValue(
        makeRow({
          apiKeyCipher: cipher,
          prometheusUrl: "http://old:9090",
          serverKind: "vllm",
        }),
      );
      let updateData: Record<string, unknown> = {};
      prismaMock.connection.update.mockImplementation(
        async (args: { data: Record<string, unknown> }) => {
          updateData = args.data;
          return makeRow({
            apiKeyCipher: cipher,
            prometheusUrl: null,
            serverKind: null,
          });
        },
      );
      const out = await service.update("u_1", "c_1", {
        prometheusUrl: null,
        serverKind: null,
      });
      expect(updateData.prometheusUrl).toBeNull();
      expect(updateData.serverKind).toBeNull();
      // The DTO returned should reflect the cleared values.
      expect(out.prometheusUrl).toBeNull();
      expect(out.serverKind).toBeNull();
    });
  });

  describe("getOwnedDecrypted", () => {
    it("decrypts apiKey and returns the full credential bundle", async () => {
      const cipher = await encryptForTest("sk-decrypt-test");
      prismaMock.connection.findUnique.mockResolvedValue(makeRow({ apiKeyCipher: cipher }));
      const out = await service.getOwnedDecrypted("u_1", "c_1");
      expect(out.apiKey).toBe("sk-decrypt-test");
      expect(out.baseUrl).toBe("http://10.x.x.x:30888");
      expect(out.model).toBe("qwen2.5");
    });
    it("throws ForbiddenException for cross-user access", async () => {
      prismaMock.connection.findUnique.mockResolvedValue(makeRow({ userId: "u_other" }));
      await expect(service.getOwnedDecrypted("u_1", "c_1")).rejects.toThrow(ForbiddenException);
    });
  });

  describe("delete", () => {
    it("throws ForbiddenException for cross-user access", async () => {
      prismaMock.connection.findUnique.mockResolvedValue(makeRow({ userId: "u_other" }));
      await expect(service.delete("u_1", "c_1")).rejects.toThrow(ForbiddenException);
      expect(prismaMock.connection.delete).not.toHaveBeenCalled();
    });

    it("calls prisma.delete after ownership check passes", async () => {
      prismaMock.connection.findUnique.mockResolvedValue(makeRow());
      prismaMock.connection.delete.mockResolvedValue(makeRow());
      await service.delete("u_1", "c_1");
      expect(prismaMock.connection.delete).toHaveBeenCalledWith({ where: { id: "c_1" } });
    });
  });

  describe("update RBAC", () => {
    it("throws ForbiddenException for cross-user access", async () => {
      prismaMock.connection.findUnique.mockResolvedValue(makeRow({ userId: "u_other" }));
      await expect(service.update("u_1", "c_1", { name: "x" })).rejects.toThrow(ForbiddenException);
      expect(prismaMock.connection.update).not.toHaveBeenCalled();
    });
  });
});

async function encryptForTest(plaintext: string): Promise<string> {
  const { encrypt, decodeKey } = await import("../../common/crypto/aes-gcm.js");
  return encrypt(plaintext, decodeKey(KEY_B64));
}
