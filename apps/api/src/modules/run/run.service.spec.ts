import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { PrismaService } from "../../database/prisma.service.js";
import { RunRepository } from "./run.repository.js";
import { RunService } from "./run.service.js";

describe("RunService", () => {
  let service: RunService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        RunService,
        RunRepository,
        PrismaService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === "DATABASE_URL") return process.env["DATABASE_URL"];
              return undefined;
            },
          },
        },
      ],
    }).compile();

    service = moduleRef.get(RunService);
    prisma = moduleRef.get(PrismaService);

    await prisma.run.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns a Run with createdAt as ISO string", async () => {
    const user = await prisma.user.create({
      data: { email: "rs@example.com", passwordHash: "x" },
    });
    const created = await prisma.run.create({
      data: {
        userId: user.id,
        kind: "benchmark",
        tool: "guidellm",
        scenario: { model: "llama" },
        mode: "fixed",
        driverKind: "local",
        params: { rate: 5 },
      },
    });

    const dto = await service.findById(created.id);
    expect(dto).not.toBeNull();
    expect(typeof dto!.createdAt).toBe("string");
    expect(dto!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(dto!.tool).toBe("guidellm");
  });

  it("throws NotFound when run does not exist", async () => {
    await expect(service.findByIdOrFail("nope")).rejects.toThrow();
  });
});
