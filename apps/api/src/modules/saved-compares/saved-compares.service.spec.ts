import { ConfigService } from "@nestjs/config";
import type { TestingModule } from "@nestjs/testing";
import { Test } from "@nestjs/testing";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaService } from "../../database/prisma.service.js";
import { BenchmarkChartsService } from "../benchmark/benchmark-charts.service.js";
import {
  deriveCompareDims,
  downsampleSamples,
  SavedComparesService,
} from "./saved-compares.service.js";

describe("downsampleSamples", () => {
  it("returns the same length when at or below cap", () => {
    const arr = Array.from({ length: 10 }, (_, i) => i);
    const result = downsampleSamples(arr, 1500);
    expect(result).toHaveLength(10);
  });

  it("returns exactly cap elements when above cap", () => {
    const arr = Array.from({ length: 5000 }, (_, i) => i);
    const result = downsampleSamples(arr, 1500);
    expect(result).toHaveLength(1500);
  });

  it("first element matches original first", () => {
    const arr = Array.from({ length: 5000 }, (_, i) => i);
    const result = downsampleSamples(arr, 1500);
    expect(result[0]).toBe(arr[0]);
  });

  it("last element matches original last (preserves tail latency)", () => {
    const arr = Array.from({ length: 5000 }, (_, i) => i);
    const result = downsampleSamples(arr, 1500);
    expect(result[result.length - 1]).toBe(arr[arr.length - 1]);
  });

  it("result is monotonic non-decreasing", () => {
    const arr = Array.from({ length: 5000 }, (_, i) => i);
    const result = downsampleSamples(arr, 1500);
    for (let i = 1; i < result.length; i++) {
      expect(result[i]).toBeGreaterThanOrEqual(result[i - 1]);
    }
  });
});

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
  it("returns nulls for an empty set", () => {
    expect(deriveCompareDims([])).toEqual({ scenario: null, tool: null });
  });
  it("returns nulls when both dims differ", () => {
    expect(
      deriveCompareDims([
        { scenario: "lb-strategy", tool: "aiperf" },
        { scenario: "inference", tool: "guidellm" },
      ]),
    ).toEqual({ scenario: null, tool: null });
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
        BenchmarkChartsService,
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
