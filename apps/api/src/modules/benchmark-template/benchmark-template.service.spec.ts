import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type { BenchmarkTemplate as PrismaBenchmarkTemplate } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BenchmarkTemplateRepository } from "./benchmark-template.repository.js";
import { BenchmarkTemplateService } from "./benchmark-template.service.js";

vi.mock("@modeldoctor/tool-adapters", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    applyScenarioConstraints: () => ({ parse: (x: unknown) => x }),
    byTool: (name: string) => ({
      name,
      // guidellm supports inference + capacity, vegeta only gateway —
      // matches the real adapter declarations.
      scenarios:
        name === "guidellm"
          ? ["inference", "capacity"]
          : name === "vegeta"
            ? ["gateway"]
            : ["inference"],
      paramsSchema: { parse: (x: unknown) => x },
    }),
  };
});

function makeRow(over: Partial<PrismaBenchmarkTemplate> = {}): PrismaBenchmarkTemplate {
  return {
    id: "tpl-1",
    name: "t",
    description: null,
    scenario: "inference",
    tool: "guidellm",
    config: {},
    isOfficial: false,
    createdBy: "owner-1",
    tags: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as PrismaBenchmarkTemplate;
}

function makeRepo(): BenchmarkTemplateRepository {
  return {
    findByIdOrNull: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
  } as unknown as BenchmarkTemplateRepository;
}

describe("BenchmarkTemplateService", () => {
  let svc: BenchmarkTemplateService;
  let repo: BenchmarkTemplateRepository;

  beforeEach(() => {
    repo = makeRepo();
    svc = new BenchmarkTemplateService(repo);
  });

  describe("create", () => {
    it("creates a non-official template for any authenticated user", async () => {
      (repo.create as ReturnType<typeof vi.fn>).mockResolvedValue(makeRow());
      const out = await svc.create(
        { sub: "user-2", isAdmin: false },
        {
          name: "t",
          scenario: "inference",
          tool: "guidellm",
          config: {},
          isOfficial: false,
          tags: [],
        },
      );
      expect(out.id).toBe("tpl-1");
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ isOfficial: false, createdBy: "user-2" }),
      );
    });

    it("rejects isOfficial=true from non-admin with BENCHMARK_TEMPLATE_OFFICIAL_FORBIDDEN", async () => {
      await expect(
        svc.create(
          { sub: "user-2", isAdmin: false },
          {
            name: "t",
            scenario: "inference",
            tool: "guidellm",
            config: {},
            isOfficial: true,
            tags: [],
          },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it("permits isOfficial=true from admin", async () => {
      (repo.create as ReturnType<typeof vi.fn>).mockResolvedValue(makeRow({ isOfficial: true }));
      const out = await svc.create(
        { sub: "admin-1", isAdmin: true },
        {
          name: "Official",
          scenario: "inference",
          tool: "guidellm",
          config: {},
          isOfficial: true,
          tags: [],
        },
      );
      expect(out.isOfficial).toBe(true);
    });

    it("rejects scenario × tool mismatch with BENCHMARK_TEMPLATE_SCENARIO_TOOL_MISMATCH", async () => {
      await expect(
        svc.create(
          { sub: "user-2", isAdmin: false },
          {
            name: "t",
            scenario: "gateway", // gateway only supports vegeta
            tool: "guidellm",
            config: {},
            isOfficial: false,
            tags: [],
          },
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("update", () => {
    it("allows the owner to patch name/config", async () => {
      (repo.findByIdOrNull as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRow({ createdBy: "owner-1" }),
      );
      (repo.update as ReturnType<typeof vi.fn>).mockResolvedValue(makeRow({ name: "renamed" }));
      const out = await svc.update({ sub: "owner-1", isAdmin: false }, "tpl-1", {
        name: "renamed",
      });
      expect(out.name).toBe("renamed");
    });

    it("re-validates config against the existing row's (scenario, tool) when patch.config is supplied", async () => {
      // The existing row is inference + guidellm. We patch with a NEW config.
      // The mocked applyScenarioConstraints / paramsSchema accept anything,
      // so this should succeed — what matters is verifying repo.update
      // received the new config (i.e. validateConfig didn't reject it).
      (repo.findByIdOrNull as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRow({ createdBy: "owner-1", scenario: "inference", tool: "guidellm" }),
      );
      (repo.update as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRow({ config: { rateType: "constant", rate: 99 } }),
      );
      const out = await svc.update({ sub: "owner-1", isAdmin: false }, "tpl-1", {
        config: { rateType: "constant", rate: 99 },
      });
      expect(repo.update).toHaveBeenCalledWith(
        "tpl-1",
        expect.objectContaining({ config: { rateType: "constant", rate: 99 } }),
      );
      expect(out.config).toEqual({ rateType: "constant", rate: 99 });
    });

    it("allows admin to patch any template", async () => {
      (repo.findByIdOrNull as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRow({ createdBy: "owner-1" }),
      );
      (repo.update as ReturnType<typeof vi.fn>).mockResolvedValue(makeRow());
      await svc.update({ sub: "admin-1", isAdmin: true }, "tpl-1", { name: "x" });
      expect(repo.update).toHaveBeenCalled();
    });

    it("rejects non-owner non-admin with ForbiddenException", async () => {
      (repo.findByIdOrNull as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRow({ createdBy: "owner-1" }),
      );
      await expect(
        svc.update({ sub: "intruder", isAdmin: false }, "tpl-1", { name: "x" }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("returns 404 when template missing", async () => {
      (repo.findByIdOrNull as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      await expect(
        svc.update({ sub: "owner-1", isAdmin: false }, "missing", { name: "x" }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("delete", () => {
    it("allows owner to delete", async () => {
      (repo.findByIdOrNull as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRow({ createdBy: "owner-1" }),
      );
      await svc.delete({ sub: "owner-1", isAdmin: false }, "tpl-1");
      expect(repo.delete).toHaveBeenCalledWith("tpl-1");
    });

    it("rejects non-owner non-admin", async () => {
      (repo.findByIdOrNull as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRow({ createdBy: "owner-1" }),
      );
      await expect(svc.delete({ sub: "intruder", isAdmin: false }, "tpl-1")).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
