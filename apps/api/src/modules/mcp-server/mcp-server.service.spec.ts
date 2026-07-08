import type { McpServerPublic } from "@modeldoctor/contracts";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import type { McpServer as PrismaMcpServer } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaService } from "../../database/prisma.service.js";
import { McpServerService } from "./mcp-server.service.js";

const KEY_B64 = Buffer.alloc(32, 7).toString("base64");

function makePrismaMock() {
  return {
    mcpServer: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
}

function makeRow(overrides: Partial<PrismaMcpServer> = {}): PrismaMcpServer {
  return {
    id: "mcp_1",
    userId: "u_1",
    name: "higress-gw",
    description: null,
    transport: "http",
    url: "https://higress.local/mcp",
    authTokenCipher: null,
    headers: "",
    toolsCache: null,
    toolsCachedAt: null,
    enabled: true,
    createdAt: new Date("2026-05-01T00:00:00Z"),
    updatedAt: new Date("2026-05-01T00:00:00Z"),
    ...overrides,
  };
}

async function makeService(prismaMock: ReturnType<typeof makePrismaMock>) {
  const moduleRef = await Test.createTestingModule({
    providers: [
      McpServerService,
      { provide: PrismaService, useValue: prismaMock },
      {
        provide: ConfigService,
        useValue: { get: () => KEY_B64 },
      },
    ],
  }).compile();
  return moduleRef.get(McpServerService);
}

describe("McpServerService", () => {
  let prismaMock: ReturnType<typeof makePrismaMock>;
  let service: McpServerService;

  beforeEach(async () => {
    prismaMock = makePrismaMock();
    service = await makeService(prismaMock);
  });

  describe("create", () => {
    it("encrypts authToken, stores cipher, returns McpServerWithSecret containing plaintext once", async () => {
      const PLAINTEXT = "mcp-token-12345";
      let storedCipher: string | null = null;
      prismaMock.mcpServer.create.mockImplementation(
        async (args: { data: { authTokenCipher: string | null } & Record<string, unknown> }) => {
          storedCipher = args.data.authTokenCipher;
          return makeRow({ authTokenCipher: storedCipher });
        },
      );
      const out = await service.create("u_1", {
        name: "higress-gw",
        transport: "http",
        url: "https://higress.local/mcp",
        authToken: PLAINTEXT,
        headers: "",
      });
      expect(storedCipher).toMatch(/^v1:/);
      expect(storedCipher).not.toContain(PLAINTEXT);
      expect(out.authToken).toBe(PLAINTEXT);
      expect(out.authTokenPreview).toBe("mcp...2345");
    });

    it("stores null cipher and returns empty authToken when authToken is omitted", async () => {
      prismaMock.mcpServer.create.mockImplementation(
        async (args: { data: { authTokenCipher: string | null } & Record<string, unknown> }) => {
          return makeRow({ authTokenCipher: args.data.authTokenCipher });
        },
      );
      const out = await service.create("u_1", {
        name: "no-auth-gw",
        transport: "http",
        url: "https://open.local/mcp",
        headers: "",
      });
      expect(out.authToken).toBe("");
      expect(out.authTokenPreview).toBeUndefined();
    });
  });

  describe("list", () => {
    it("returns items with authTokenPreview only, never plaintext or cipher", async () => {
      const cipher = await encryptForTest("mcp-secret-abcdefgh");
      prismaMock.mcpServer.findMany.mockResolvedValue([makeRow({ authTokenCipher: cipher })]);
      const out = await service.list("u_1");
      expect(out.items).toHaveLength(1);
      const item = out.items[0] as McpServerPublic;
      expect(item).not.toHaveProperty("authToken");
      expect(item).not.toHaveProperty("authTokenCipher");
      expect(item.authTokenPreview).toBe("mcp...efgh");
    });

    it("parses a row with toolsCache: null (unset nullable Prisma column)", async () => {
      prismaMock.mcpServer.findMany.mockResolvedValue([makeRow({ toolsCache: null })]);
      const out = await service.list("u_1");
      expect(out.items[0].toolsCache).toBeNull();
    });
  });

  describe("findOwnedPublic", () => {
    it("returns McpServerPublic for the owner", async () => {
      prismaMock.mcpServer.findUnique.mockResolvedValue(makeRow());
      const out = await service.findOwnedPublic("u_1", "mcp_1");
      expect(out.id).toBe("mcp_1");
    });
    it("throws NotFoundException for missing", async () => {
      prismaMock.mcpServer.findUnique.mockResolvedValue(null);
      await expect(service.findOwnedPublic("u_1", "mcp_x")).rejects.toThrow(NotFoundException);
    });
    it("throws ForbiddenException when userId mismatches", async () => {
      prismaMock.mcpServer.findUnique.mockResolvedValue(makeRow({ userId: "u_other" }));
      await expect(service.findOwnedPublic("u_1", "mcp_1")).rejects.toThrow(ForbiddenException);
    });
  });

  describe("update", () => {
    it("returns McpServerWithSecret when authToken is rotated", async () => {
      prismaMock.mcpServer.findUnique.mockResolvedValue(makeRow());
      let newCipher = "";
      prismaMock.mcpServer.update.mockImplementation(
        async (args: { data: { authTokenCipher?: string | null } }) => {
          newCipher = args.data.authTokenCipher ?? "";
          return makeRow({ authTokenCipher: newCipher });
        },
      );
      const out = await service.update("u_1", "mcp_1", { authToken: "mcp-new-5678" });
      expect("authToken" in out).toBe(true);
      expect((out as { authToken: string }).authToken).toBe("mcp-new-5678");
      expect(newCipher).toMatch(/^v1:/);
    });

    it("returns McpServerPublic (no plaintext) when authToken is not rotated", async () => {
      const cipher = await encryptForTest("mcp-keep-1234");
      prismaMock.mcpServer.findUnique.mockResolvedValue(makeRow({ authTokenCipher: cipher }));
      prismaMock.mcpServer.update.mockResolvedValue(
        makeRow({ authTokenCipher: cipher, name: "renamed" }),
      );
      const out = await service.update("u_1", "mcp_1", { name: "renamed" });
      expect("authToken" in out).toBe(false);
      expect(out.name).toBe("renamed");
      expect(prismaMock.mcpServer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({ authTokenCipher: expect.anything() }),
        }),
      );
    });

    it("does not re-encrypt when authToken is not passed", async () => {
      const cipher = await encryptForTest("mcp-keep-1234");
      prismaMock.mcpServer.findUnique.mockResolvedValue(makeRow({ authTokenCipher: cipher }));
      let updateData: Record<string, unknown> = {};
      prismaMock.mcpServer.update.mockImplementation(
        async (args: { data: Record<string, unknown> }) => {
          updateData = args.data;
          return makeRow({ authTokenCipher: cipher, enabled: false });
        },
      );
      await service.update("u_1", "mcp_1", { enabled: false });
      expect(updateData).not.toHaveProperty("authTokenCipher");
      expect(updateData.enabled).toBe(false);
    });
  });

  describe("update RBAC", () => {
    it("throws ForbiddenException for cross-user access", async () => {
      prismaMock.mcpServer.findUnique.mockResolvedValue(makeRow({ userId: "u_other" }));
      await expect(service.update("u_1", "mcp_1", { name: "x" })).rejects.toThrow(
        ForbiddenException,
      );
      expect(prismaMock.mcpServer.update).not.toHaveBeenCalled();
    });
  });

  describe("getOwnedDecrypted", () => {
    it("decrypts authToken and returns the credential bundle", async () => {
      const cipher = await encryptForTest("mcp-decrypt-test");
      prismaMock.mcpServer.findUnique.mockResolvedValue(makeRow({ authTokenCipher: cipher }));
      const out = await service.getOwnedDecrypted("u_1", "mcp_1");
      expect(out.authToken).toBe("mcp-decrypt-test");
      expect(out.url).toBe("https://higress.local/mcp");
      expect(out.headers).toBe("");
    });

    it("returns empty authToken when no cipher is set (no auth configured)", async () => {
      prismaMock.mcpServer.findUnique.mockResolvedValue(makeRow({ authTokenCipher: null }));
      const out = await service.getOwnedDecrypted("u_1", "mcp_1");
      expect(out.authToken).toBe("");
    });

    it("throws ForbiddenException for cross-user access", async () => {
      prismaMock.mcpServer.findUnique.mockResolvedValue(makeRow({ userId: "u_other" }));
      await expect(service.getOwnedDecrypted("u_1", "mcp_1")).rejects.toThrow(ForbiddenException);
    });
  });

  describe("delete", () => {
    it("throws ForbiddenException for cross-user access", async () => {
      prismaMock.mcpServer.findUnique.mockResolvedValue(makeRow({ userId: "u_other" }));
      await expect(service.delete("u_1", "mcp_1")).rejects.toThrow(ForbiddenException);
      expect(prismaMock.mcpServer.delete).not.toHaveBeenCalled();
    });

    it("calls prisma.delete after ownership check passes", async () => {
      prismaMock.mcpServer.findUnique.mockResolvedValue(makeRow());
      prismaMock.mcpServer.delete.mockResolvedValue(makeRow());
      await service.delete("u_1", "mcp_1");
      expect(prismaMock.mcpServer.delete).toHaveBeenCalledWith({ where: { id: "mcp_1" } });
    });
  });

  describe("cacheTools", () => {
    it("writes toolsCache + toolsCachedAt and returns the public shape", async () => {
      prismaMock.mcpServer.findUnique.mockResolvedValue(makeRow());
      let updateData: Record<string, unknown> = {};
      const tools = [{ name: "search", inputSchema: {} }];
      prismaMock.mcpServer.update.mockImplementation(
        async (args: { data: Record<string, unknown> }) => {
          updateData = args.data;
          return makeRow({
            toolsCache: tools,
            toolsCachedAt: new Date("2026-06-01T00:00:00Z"),
          });
        },
      );
      const out = await service.cacheTools("u_1", "mcp_1", tools);
      expect(updateData.toolsCache).toEqual(tools);
      expect(updateData.toolsCachedAt).toBeInstanceOf(Date);
      expect(out.toolsCache).toEqual(tools);
      expect(out.toolsCachedAt).toBe("2026-06-01T00:00:00.000Z");
    });

    it("throws ForbiddenException for cross-user access", async () => {
      prismaMock.mcpServer.findUnique.mockResolvedValue(makeRow({ userId: "u_other" }));
      await expect(service.cacheTools("u_1", "mcp_1", [])).rejects.toThrow(ForbiddenException);
      expect(prismaMock.mcpServer.update).not.toHaveBeenCalled();
    });
  });
});

async function encryptForTest(plaintext: string): Promise<string> {
  const { encrypt, decodeKey } = await import("../../common/crypto/aes-gcm.js");
  return encrypt(plaintext, decodeKey(KEY_B64));
}
