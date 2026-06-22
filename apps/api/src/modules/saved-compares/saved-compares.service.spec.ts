import { ConfigService } from "@nestjs/config";
import type { TestingModule } from "@nestjs/testing";
import { Test } from "@nestjs/testing";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaService } from "../../database/prisma.service.js";
import { deriveCompareDims, SavedComparesService } from "./saved-compares.service.js";

describe("deriveCompareDims", () => {
  it("returns the shared dims when homogeneous", () => {
    expect(
      deriveCompareDims([
        { scenario: "lb-strategy", tool: "aiperf" },
        { scenario: "lb-strategy", tool: "aiperf" },
      ]),
    ).toEqual({ scenario: "lb-strategy", tool: "aiperf" });
  });
  it("returns nulls when scenarios differ", () => {
    expect(
      deriveCompareDims([
        { scenario: "lb-strategy", tool: "aiperf" },
        { scenario: "inference", tool: "aiperf" },
      ]),
    ).toEqual({ scenario: null, tool: "aiperf" });
  });
});

describe("SavedComparesService", () => {
  let mod: TestingModule;
  let svc: SavedComparesService;
  let prisma: PrismaService;
  let userId: string;
  let otherUserId: string;
  let runIds: string[];

  beforeAll(async () => {
    mod = await Test.createTestingModule({
      providers: [
        SavedComparesService,
        PrismaService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => (key === "DATABASE_URL" ? process.env.DATABASE_URL : undefined),
          },
        },
      ],
    }).compile();
    svc = mod.get(SavedComparesService);
    prisma = mod.get(PrismaService);
    await prisma.$connect();
  });

  beforeEach(async () => {
    await prisma.savedCompare.deleteMany();
    await prisma.benchmark.deleteMany();
    await prisma.user.deleteMany();

    const u1 = await prisma.user.create({
      data: { email: `a-${Date.now()}@x`, passwordHash: "x" },
    });
    const u2 = await prisma.user.create({
      data: { email: `b-${Date.now()}@x`, passwordHash: "x" },
    });
    userId = u1.id;
    otherUserId = u2.id;
    const b1 = await prisma.benchmark.create({
      data: { userId, scenario: "inference", tool: "guidellm", name: "r1", params: {} },
    });
    const b2 = await prisma.benchmark.create({
      data: { userId, scenario: "inference", tool: "guidellm", name: "r2", params: {} },
    });
    runIds = [b1.id, b2.id];
  });

  it("creates a SavedCompare and returns it", async () => {
    const sc = await svc.create(userId, {
      name: "Study A",
      benchmarkIds: runIds,
      stageLabels: { [runIds[0]]: "A", [runIds[1]]: "B" },
    });
    expect(sc.name).toBe("Study A");
    expect(sc.benchmarkIds).toEqual(runIds);
  });

  it("returns null from get() if owner mismatch", async () => {
    const sc = await svc.create(userId, {
      name: "n",
      benchmarkIds: runIds,
      stageLabels: { [runIds[0]]: "A", [runIds[1]]: "B" },
    });
    expect(await svc.get(otherUserId, sc.id)).toBeNull();
  });

  it("hydrates benchmarks, returning placeholder for missing ids", async () => {
    const sc = await svc.create(userId, {
      name: "n",
      benchmarkIds: [...runIds, "deleted-id"],
      stageLabels: {
        [runIds[0]]: "A",
        [runIds[1]]: "B",
        "deleted-id": "C",
      },
    });
    const hydrated = await svc.getHydrated(userId, sc.id);
    if (!hydrated) throw new Error("hydrated should not be null");
    expect(hydrated.benchmarks).toHaveLength(3);
    expect(hydrated.benchmarks[2]).toMatchObject({ id: "deleted-id", missing: true });
  });
});
