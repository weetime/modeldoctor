import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaService } from "../../database/prisma.service.js";
import { BenchmarkTemplateRepository } from "./benchmark-template.repository.js";

describe("BenchmarkTemplateRepository", () => {
  let repo: BenchmarkTemplateRepository;
  let prisma: PrismaService;
  let userId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        BenchmarkTemplateRepository,
        PrismaService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => (key === "DATABASE_URL" ? process.env.DATABASE_URL : undefined),
          },
        },
      ],
    }).compile();
    repo = moduleRef.get(BenchmarkTemplateRepository);
    prisma = moduleRef.get(PrismaService);

    const u = await prisma.user.create({
      data: {
        email: `repo-spec-${Date.now()}@example.com`,
        passwordHash: "x",
        roles: ["user"],
      },
    });
    userId = u.id;
  });

  beforeEach(async () => {
    await prisma.benchmarkTemplate.deleteMany({ where: { createdBy: userId } });
  });

  afterAll(async () => {
    await prisma.benchmarkTemplate.deleteMany({ where: { createdBy: userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("findByIdOrNull returns null for missing id", async () => {
    const result = await repo.findByIdOrNull("00000000-0000-0000-0000-000000000000");
    expect(result).toBeNull();
  });

  it("create persists a row with sensible defaults", async () => {
    const created = await repo.create({
      name: "My GuideLLM Template",
      description: "constant rate baseline",
      scenario: "inference",
      tool: "guidellm",
      config: { rateType: "constant", rate: 5 },
      createdBy: userId,
      tags: ["baseline", "qa"],
    });
    expect(created.id).toBeDefined();
    expect(created.isOfficial).toBe(false);
    expect(created.tags).toEqual(["baseline", "qa"]);
    expect(created.config).toEqual({ rateType: "constant", rate: 5 });

    const found = await repo.findByIdOrNull(created.id);
    expect(found).not.toBeNull();
    expect(found?.name).toBe("My GuideLLM Template");
  });

  it("update mutates name/description/config/tags but not scenario/tool/isOfficial", async () => {
    const created = await repo.create({
      name: "v1",
      scenario: "inference",
      tool: "guidellm",
      config: { rateType: "constant", rate: 5 },
      createdBy: userId,
    });
    const before = created.updatedAt;
    await new Promise((r) => setTimeout(r, 10));
    const updated = await repo.update(created.id, {
      name: "v2",
      tags: ["promoted"],
      config: { rateType: "constant", rate: 10 },
    });
    expect(updated.name).toBe("v2");
    expect(updated.tags).toEqual(["promoted"]);
    expect(updated.config).toEqual({ rateType: "constant", rate: 10 });
    expect(updated.scenario).toBe("inference");
    expect(updated.tool).toBe("guidellm");
    expect(updated.isOfficial).toBe(false);
    expect(updated.updatedAt.getTime()).toBeGreaterThan(before.getTime());
  });

  it("delete removes the row", async () => {
    const created = await repo.create({
      name: "doomed",
      scenario: "inference",
      tool: "guidellm",
      config: {},
      createdBy: userId,
    });
    await repo.delete(created.id);
    expect(await repo.findByIdOrNull(created.id)).toBeNull();
  });

  it("deleting a template referenced by a benchmark sets benchmark.templateId to null", async () => {
    const tpl = await repo.create({
      name: "t",
      scenario: "inference",
      tool: "guidellm",
      config: { rateType: "constant", rate: 5 },
      createdBy: userId,
    });
    const conn = await prisma.connection.create({
      data: {
        userId,
        name: "c",
        baseUrl: "http://upstream/",
        apiKeyCipher: "v1:placeholder",
        model: "m",
        category: "text",
      },
    });
    const bm = await prisma.benchmark.create({
      data: {
        userId,
        connectionId: conn.id,
        scenario: "inference",
        tool: "guidellm",
        driverKind: "local",
        name: "test-benchmark",
        params: {},
        templateId: tpl.id,
      },
    });
    await repo.delete(tpl.id);
    const reloaded = await prisma.benchmark.findUnique({ where: { id: bm.id } });
    expect(reloaded?.templateId).toBeNull();

    await prisma.benchmark.delete({ where: { id: bm.id } });
    await prisma.connection.delete({ where: { id: conn.id } });
  });

  it("list returns rows ordered by isOfficial DESC, updatedAt DESC, id DESC", async () => {
    const a = await repo.create({
      name: "A user",
      scenario: "inference",
      tool: "guidellm",
      config: {},
      createdBy: userId,
    });
    await new Promise((r) => setTimeout(r, 10));
    const b = await repo.create({
      name: "B user",
      scenario: "inference",
      tool: "guidellm",
      config: {},
      createdBy: userId,
    });
    await new Promise((r) => setTimeout(r, 10));
    const off = await prisma.benchmarkTemplate.create({
      data: {
        name: "Official",
        scenario: "inference",
        tool: "guidellm",
        config: {},
        isOfficial: true,
        creator: { connect: { id: userId } },
      },
    });

    const res = await repo.list({ scenario: "inference" });
    const ids = res.items.map((r) => r.id);
    expect(ids[0]).toBe(off.id);
    expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id));
  });

  it("list filters by scenario", async () => {
    await repo.create({
      name: "inf",
      scenario: "inference",
      tool: "guidellm",
      config: {},
      createdBy: userId,
    });
    await repo.create({
      name: "cap",
      scenario: "capacity",
      tool: "guidellm",
      config: {},
      createdBy: userId,
    });
    const inf = await repo.list({ scenario: "inference" });
    expect(inf.items.every((r) => r.scenario === "inference")).toBe(true);
    expect(inf.items.some((r) => r.name === "inf")).toBe(true);
    expect(inf.items.some((r) => r.name === "cap")).toBe(false);
  });

  it("list filters by isOfficial", async () => {
    await prisma.benchmarkTemplate.create({
      data: {
        name: "off",
        scenario: "inference",
        tool: "guidellm",
        config: {},
        isOfficial: true,
        creator: { connect: { id: userId } },
      },
    });
    await repo.create({
      name: "personal",
      scenario: "inference",
      tool: "guidellm",
      config: {},
      createdBy: userId,
    });
    const officials = await repo.list({ isOfficial: true });
    expect(officials.items.every((r) => r.isOfficial)).toBe(true);
  });

  it("list filters by search (case-insensitive on name + description)", async () => {
    await repo.create({
      name: "Latency baseline",
      description: null,
      scenario: "inference",
      tool: "guidellm",
      config: {},
      createdBy: userId,
    });
    await repo.create({
      name: "Throughput peak",
      description: "for capacity planning",
      scenario: "capacity",
      tool: "guidellm",
      config: {},
      createdBy: userId,
    });
    const lat = await repo.list({ search: "lateNCY" });
    expect(lat.items.some((r) => r.name === "Latency baseline")).toBe(true);
    expect(lat.items.some((r) => r.name === "Throughput peak")).toBe(false);
    const cap = await repo.list({ search: "capacity" });
    expect(cap.items.some((r) => r.name === "Throughput peak")).toBe(true);
  });

  it("list paginates via cursor", async () => {
    for (let i = 0; i < 5; i++) {
      await repo.create({
        name: `p${i}`,
        scenario: "inference",
        tool: "guidellm",
        config: {},
        createdBy: userId,
      });
      await new Promise((r) => setTimeout(r, 5));
    }
    const page1 = await repo.list({ scenario: "inference", limit: 2 });
    expect(page1.items.length).toBe(2);
    expect(page1.nextCursor).not.toBeNull();
    const cursor = page1.nextCursor ?? undefined;
    const page2 = await repo.list({
      scenario: "inference",
      limit: 2,
      cursor,
    });
    expect(page2.items.length).toBe(2);
    expect(page2.items.map((r) => r.id)).not.toEqual(page1.items.map((r) => r.id));
  });
});
