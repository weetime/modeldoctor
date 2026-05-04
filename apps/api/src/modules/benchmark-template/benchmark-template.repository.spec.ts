import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaService } from "../../database/prisma.service.js";
import { BenchmarkTemplateRepository } from "./benchmark-template.repository.js";

/**
 * Minimal placeholder spec — full coverage lands in PR2 (BenchmarkTemplate
 * CRUD). For now this only proves the skeleton wires up against the live
 * Prisma client and that findByIdOrNull returns null on a miss.
 */
describe("BenchmarkTemplateRepository", () => {
  let repo: BenchmarkTemplateRepository;
  let prisma: PrismaService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        BenchmarkTemplateRepository,
        PrismaService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === "DATABASE_URL") return process.env.DATABASE_URL;
              return undefined;
            },
          },
        },
      ],
    }).compile();

    repo = moduleRef.get(BenchmarkTemplateRepository);
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("findByIdOrNull returns null when no template exists for the given id", async () => {
    const result = await repo.findByIdOrNull("00000000-0000-0000-0000-000000000000");
    expect(result).toBeNull();
  });
});
