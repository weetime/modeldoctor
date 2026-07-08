import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Skill as PrismaSkill } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaService } from "../../database/prisma.service.js";
import { SkillService } from "./skill.service.js";

function makePrismaMock() {
  return {
    skill: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
}

function makeRow(overrides: Partial<PrismaSkill> = {}): PrismaSkill {
  return {
    id: "sk_1",
    userId: "u_1",
    name: "researcher",
    description: null,
    systemPrompt: null,
    modelConnectionId: null,
    mcpServerIds: [],
    inlineTools: null,
    planFirst: false,
    maxSteps: 12,
    createdAt: new Date("2026-05-01T00:00:00Z"),
    updatedAt: new Date("2026-05-01T00:00:00Z"),
    ...overrides,
  };
}

async function makeService(prismaMock: ReturnType<typeof makePrismaMock>) {
  const moduleRef = await Test.createTestingModule({
    providers: [SkillService, { provide: PrismaService, useValue: prismaMock }],
  }).compile();
  return moduleRef.get(SkillService);
}

describe("SkillService", () => {
  let prismaMock: ReturnType<typeof makePrismaMock>;
  let service: SkillService;

  beforeEach(async () => {
    prismaMock = makePrismaMock();
    service = await makeService(prismaMock);
  });

  describe("create", () => {
    it("creates a skill with defaults and returns the public shape", async () => {
      prismaMock.skill.create.mockImplementation(async (args: { data: Record<string, unknown> }) =>
        makeRow(args.data),
      );
      const out = await service.create("u_1", {
        name: "researcher",
        mcpServerIds: [],
        planFirst: false,
        maxSteps: 12,
      });
      expect(out.name).toBe("researcher");
      expect(out.mcpServerIds).toEqual([]);
      expect(out.inlineTools).toBeNull();
      expect(out.userId).toBe("u_1");
    });

    it("stores mcpServerIds + inlineTools when supplied", async () => {
      let stored: Record<string, unknown> = {};
      prismaMock.skill.create.mockImplementation(
        async (args: { data: Record<string, unknown> }) => {
          stored = args.data;
          return makeRow(args.data);
        },
      );
      const tools = [
        {
          type: "function" as const,
          function: { name: "search", parameters: { type: "object", properties: {} } },
        },
      ];
      const out = await service.create("u_1", {
        name: "researcher",
        mcpServerIds: ["mcp_1"],
        inlineTools: tools,
        planFirst: true,
        maxSteps: 20,
      });
      expect(stored.mcpServerIds).toEqual(["mcp_1"]);
      expect(out.inlineTools).toEqual(tools);
      expect(out.planFirst).toBe(true);
      expect(out.maxSteps).toBe(20);
    });
  });

  describe("list", () => {
    it("returns items scoped to the user", async () => {
      prismaMock.skill.findMany.mockResolvedValue([makeRow()]);
      const out = await service.list("u_1");
      expect(out.items).toHaveLength(1);
      expect(prismaMock.skill.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: "u_1" } }),
      );
    });

    it("parses a row with inlineTools: null (unset nullable Prisma column)", async () => {
      prismaMock.skill.findMany.mockResolvedValue([makeRow({ inlineTools: null })]);
      const out = await service.list("u_1");
      expect(out.items[0].inlineTools).toBeNull();
    });
  });

  describe("findOwnedPublic", () => {
    it("returns SkillPublic for the owner", async () => {
      prismaMock.skill.findUnique.mockResolvedValue(makeRow());
      const out = await service.findOwnedPublic("u_1", "sk_1");
      expect(out.id).toBe("sk_1");
    });

    it("throws NotFoundException for missing", async () => {
      prismaMock.skill.findUnique.mockResolvedValue(null);
      await expect(service.findOwnedPublic("u_1", "sk_x")).rejects.toThrow(NotFoundException);
    });

    it("throws ForbiddenException when userId mismatches", async () => {
      prismaMock.skill.findUnique.mockResolvedValue(makeRow({ userId: "u_other" }));
      await expect(service.findOwnedPublic("u_1", "sk_1")).rejects.toThrow(ForbiddenException);
    });
  });

  describe("update", () => {
    it("updates fields and returns the public shape", async () => {
      prismaMock.skill.findUnique.mockResolvedValue(makeRow());
      prismaMock.skill.update.mockImplementation(async (args: { data: Record<string, unknown> }) =>
        makeRow({ name: "renamed", ...args.data }),
      );
      const out = await service.update("u_1", "sk_1", { name: "renamed", maxSteps: 30 });
      expect(out.name).toBe("renamed");
      expect(out.maxSteps).toBe(30);
    });

    it("throws ForbiddenException for cross-user access, without calling update", async () => {
      prismaMock.skill.findUnique.mockResolvedValue(makeRow({ userId: "u_other" }));
      await expect(service.update("u_1", "sk_1", { name: "x" })).rejects.toThrow(
        ForbiddenException,
      );
      expect(prismaMock.skill.update).not.toHaveBeenCalled();
    });

    it("round-trips inlineTools: null explicitly cleared via update", async () => {
      prismaMock.skill.findUnique.mockResolvedValue(
        makeRow({ inlineTools: [{ type: "function", function: { name: "x", parameters: {} } }] }),
      );
      let updateData: Record<string, unknown> = {};
      prismaMock.skill.update.mockImplementation(
        async (args: { data: Record<string, unknown> }) => {
          updateData = args.data;
          return makeRow({ inlineTools: null });
        },
      );
      const out = await service.update("u_1", "sk_1", { inlineTools: null });
      expect(updateData.inlineTools).not.toBeUndefined();
      expect(out.inlineTools).toBeNull();
    });
  });

  describe("delete", () => {
    it("throws ForbiddenException for cross-user access", async () => {
      prismaMock.skill.findUnique.mockResolvedValue(makeRow({ userId: "u_other" }));
      await expect(service.delete("u_1", "sk_1")).rejects.toThrow(ForbiddenException);
      expect(prismaMock.skill.delete).not.toHaveBeenCalled();
    });

    it("calls prisma.delete after ownership check passes", async () => {
      prismaMock.skill.findUnique.mockResolvedValue(makeRow());
      prismaMock.skill.delete.mockResolvedValue(makeRow());
      await service.delete("u_1", "sk_1");
      expect(prismaMock.skill.delete).toHaveBeenCalledWith({ where: { id: "sk_1" } });
    });
  });
});
