import { ConfigService } from "@nestjs/config";
// apps/api/src/modules/insights/comparison.service.spec.ts
import { Test } from "@nestjs/testing";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaService } from "../../database/prisma.service.js";
import { ComparisonService } from "./comparison.service.js";

describe("ComparisonService.baseline", () => {
  let svc: ComparisonService;
  let prisma: PrismaService;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        ComparisonService,
        PrismaService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => (key === "DATABASE_URL" ? process.env.DATABASE_URL : undefined),
          },
        },
      ],
    }).compile();
    svc = mod.get(ComparisonService);
    prisma = mod.get(PrismaService);
    await prisma.$connect();
  });

  beforeEach(async () => {
    await prisma.benchmark.deleteMany({ where: { name: { startsWith: "cmp-test-" } } });
  });

  afterEach(async () => {
    await prisma.benchmark.deleteMany({ where: { name: { startsWith: "cmp-test-" } } });
  });

  it("returns empty when sample size below threshold", async () => {
    const items = await svc.baseline(
      "nonexistent-user",
      "nonexistent-connection",
      new Date().toISOString(),
    );
    expect(items).toEqual([]);
  });
});
