import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Prisma, type Baseline as PrismaBaseline, type Run as PrismaRun } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaService } from "../../database/prisma.service.js";
import { BaselineService } from "./baseline.service.js";

function makePrismaMock() {
  return {
    baseline: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    run: {
      findUnique: vi.fn(),
    },
  };
}

function makeRun(overrides: Partial<PrismaRun> = {}): PrismaRun {
  return {
    id: "r_1",
    userId: "u_1",
    connectionId: null,
    kind: "benchmark",
    tool: "guidellm",
    scenario: {},
    mode: "fixed",
    driverKind: "local",
    name: null,
    description: null,
    status: "completed",
    statusMessage: null,
    progress: null,
    driverHandle: null,
    params: {},
    canonicalReport: null,
    rawOutput: null,
    summaryMetrics: null,
    serverMetrics: null,
    templateId: null,
    templateVersion: null,
    parentRunId: null,
    baselineId: null,
    logs: null,
    createdAt: new Date("2026-05-02T00:00:00Z"),
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function makeBaseline(overrides: Partial<PrismaBaseline> = {}): PrismaBaseline {
  return {
    id: "b_1",
    userId: "u_1",
    runId: "r_1",
    name: "throughput-anchor",
    description: null,
    tags: [],
    templateId: null,
    templateVersion: null,
    active: true,
    createdAt: new Date("2026-05-02T00:00:00Z"),
    updatedAt: new Date("2026-05-02T00:00:00Z"),
    ...overrides,
  };
}

async function makeService(prismaMock: ReturnType<typeof makePrismaMock>) {
  const moduleRef = await Test.createTestingModule({
    providers: [BaselineService, { provide: PrismaService, useValue: prismaMock }],
  }).compile();
  return moduleRef.get(BaselineService);
}

describe("BaselineService", () => {
  let prismaMock: ReturnType<typeof makePrismaMock>;
  let service: BaselineService;

  beforeEach(async () => {
    prismaMock = makePrismaMock();
    service = await makeService(prismaMock);
  });

  describe("create", () => {
    it("creates with userId from caller, copies templateId/version from Run", async () => {
      prismaMock.run.findUnique.mockResolvedValue(
        makeRun({ templateId: null, templateVersion: null }),
      );
      let created: Record<string, unknown> = {};
      prismaMock.baseline.create.mockImplementation(
        async (args: { data: Record<string, unknown> }) => {
          created = args.data;
          return makeBaseline();
        },
      );
      const out = await service.create("u_1", {
        runId: "r_1",
        name: "throughput-anchor",
        tags: [],
      });
      expect(created.userId).toBe("u_1");
      expect(created.runId).toBe("r_1");
      expect(created.templateId).toBeNull();
      expect(created.templateVersion).toBeNull();
      expect(out.id).toBe("b_1");
    });

    it("404 when Run does not exist", async () => {
      prismaMock.run.findUnique.mockResolvedValue(null);
      await expect(service.create("u_1", { runId: "r_x", name: "x", tags: [] })).rejects.toThrow(
        NotFoundException,
      );
    });

    it("403 when Run belongs to a different user", async () => {
      prismaMock.run.findUnique.mockResolvedValue(makeRun({ userId: "u_other" }));
      await expect(service.create("u_1", { runId: "r_1", name: "x", tags: [] })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("409 when the Run already has a baseline (P2002 on runId)", async () => {
      prismaMock.run.findUnique.mockResolvedValue(makeRun());
      const dup = new Prisma.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "x",
      });
      prismaMock.baseline.create.mockRejectedValue(dup);
      await expect(service.create("u_1", { runId: "r_1", name: "x", tags: [] })).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe("list", () => {
    it("returns items scoped to userId, createdAt desc", async () => {
      prismaMock.baseline.findMany.mockResolvedValue([
        makeBaseline({ id: "b_2", createdAt: new Date("2026-05-02T01:00:00Z") }),
        makeBaseline({ id: "b_1", createdAt: new Date("2026-05-02T00:00:00Z") }),
      ]);
      const out = await service.list("u_1");
      expect(prismaMock.baseline.findMany).toHaveBeenCalledWith({
        where: { userId: "u_1" },
        orderBy: { createdAt: "desc" },
      });
      expect(out.items.map((b) => b.id)).toEqual(["b_2", "b_1"]);
    });
  });

  describe("delete", () => {
    it("404 when missing", async () => {
      prismaMock.baseline.findUnique.mockResolvedValue(null);
      await expect(service.delete("u_1", "b_x")).rejects.toThrow(NotFoundException);
      expect(prismaMock.baseline.delete).not.toHaveBeenCalled();
    });

    it("403 when not owned", async () => {
      prismaMock.baseline.findUnique.mockResolvedValue(makeBaseline({ userId: "u_other" }));
      await expect(service.delete("u_1", "b_1")).rejects.toThrow(ForbiddenException);
      expect(prismaMock.baseline.delete).not.toHaveBeenCalled();
    });

    it("calls prisma.baseline.delete after ownership check", async () => {
      prismaMock.baseline.findUnique.mockResolvedValue(makeBaseline());
      prismaMock.baseline.delete.mockResolvedValue(makeBaseline());
      await service.delete("u_1", "b_1");
      expect(prismaMock.baseline.delete).toHaveBeenCalledWith({ where: { id: "b_1" } });
    });
  });
});
