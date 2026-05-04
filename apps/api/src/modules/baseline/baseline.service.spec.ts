import { ConflictException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  Prisma,
  type Baseline as PrismaBaseline,
  type Benchmark as PrismaBenchmark,
} from "@prisma/client";
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
    benchmark: {
      findUnique: vi.fn(),
    },
  };
}

function makeBenchmark(overrides: Partial<PrismaBenchmark> = {}): PrismaBenchmark {
  return {
    id: "r_1",
    userId: "u_1",
    connectionId: null,
    scenario: "inference",
    tool: "guidellm",
    toolVersion: null,
    driverKind: "local",
    name: null,
    description: null,
    status: "completed",
    statusMessage: null,
    progress: null,
    driverHandle: null,
    params: {},
    rawOutput: null,
    summaryMetrics: null,
    serverMetrics: null,
    templateId: null,
    parentBenchmarkId: null,
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
    benchmarkId: "r_1",
    name: "throughput-anchor",
    description: null,
    tags: [],
    templateId: null,
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
    it("creates with userId from caller, copies templateId from Benchmark", async () => {
      prismaMock.benchmark.findUnique.mockResolvedValue(makeBenchmark({ templateId: null }));
      let created: Record<string, unknown> = {};
      prismaMock.baseline.create.mockImplementation(
        async (args: { data: Record<string, unknown> }) => {
          created = args.data;
          return makeBaseline();
        },
      );
      const out = await service.create("u_1", {
        benchmarkId: "r_1",
        name: "throughput-anchor",
        tags: [],
      });
      expect(created.userId).toBe("u_1");
      expect(created.benchmarkId).toBe("r_1");
      expect(created.templateId).toBeNull();
      expect(out.id).toBe("b_1");
    });

    it("404 when Benchmark does not exist", async () => {
      prismaMock.benchmark.findUnique.mockResolvedValue(null);
      await expect(
        service.create("u_1", { benchmarkId: "r_x", name: "x", tags: [] }),
      ).rejects.toThrow(NotFoundException);
    });

    it("404 when Benchmark belongs to a different user (don't leak existence)", async () => {
      prismaMock.benchmark.findUnique.mockResolvedValue(makeBenchmark({ userId: "u_other" }));
      await expect(
        service.create("u_1", { benchmarkId: "r_1", name: "x", tags: [] }),
      ).rejects.toThrow(NotFoundException);
    });

    it("409 when the Benchmark already has a baseline (P2002 on benchmarkId)", async () => {
      prismaMock.benchmark.findUnique.mockResolvedValue(makeBenchmark());
      const dup = new Prisma.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "x",
      });
      prismaMock.baseline.create.mockRejectedValue(dup);
      await expect(
        service.create("u_1", { benchmarkId: "r_1", name: "x", tags: [] }),
      ).rejects.toThrow(ConflictException);
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

    it("404 when not owned (don't leak existence)", async () => {
      prismaMock.baseline.findUnique.mockResolvedValue(makeBaseline({ userId: "u_other" }));
      await expect(service.delete("u_1", "b_1")).rejects.toThrow(NotFoundException);
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
