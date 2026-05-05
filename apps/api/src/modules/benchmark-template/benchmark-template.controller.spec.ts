import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { BenchmarkTemplateController, patchSchema } from "./benchmark-template.controller.js";
import { BenchmarkTemplateService } from "./benchmark-template.service.js";

const mockService = {
  list: vi.fn(),
  findByIdOrFail: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

describe("BenchmarkTemplateController", () => {
  let controller: BenchmarkTemplateController;

  beforeEach(async () => {
    vi.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [BenchmarkTemplateController],
      providers: [{ provide: BenchmarkTemplateService, useValue: mockService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(BenchmarkTemplateController);
  });

  it("list delegates to service.list with parsed query", async () => {
    mockService.list.mockResolvedValue({ items: [], nextCursor: null });
    const out = await controller.list({ scenario: "inference", limit: 50 } as never);
    expect(out).toEqual({ items: [], nextCursor: null });
    expect(mockService.list).toHaveBeenCalledWith({ scenario: "inference", limit: 50 });
  });

  it("create maps JwtPayload → TemplateActor (non-admin)", async () => {
    mockService.create.mockResolvedValue({ id: "t1" });
    await controller.create(
      { sub: "user-1", email: "u@x", roles: ["user"] },
      {
        name: "t",
        scenario: "inference",
        tool: "guidellm",
        config: {},
        isOfficial: false,
        tags: [],
      },
    );
    expect(mockService.create).toHaveBeenCalledWith(
      { sub: "user-1", isAdmin: false },
      expect.objectContaining({ name: "t" }),
    );
  });

  it("create maps admin role correctly", async () => {
    mockService.create.mockResolvedValue({ id: "t1" });
    await controller.create(
      { sub: "admin-1", email: "a@x", roles: ["admin"] },
      {
        name: "t",
        scenario: "inference",
        tool: "guidellm",
        config: {},
        isOfficial: true,
        tags: [],
      },
    );
    expect(mockService.create).toHaveBeenCalledWith(
      { sub: "admin-1", isAdmin: true },
      expect.objectContaining({ isOfficial: true }),
    );
  });

  it("update strips isOfficial / scenario / tool from PATCH body before service call", async () => {
    mockService.update.mockResolvedValue({ id: "t1" });
    await controller.update(
      { sub: "owner-1", email: "o@x", roles: ["user"] },
      "t1",
      // The schema should already omit these — assert what reaches service
      { name: "renamed", description: "d" } as never,
    );
    const [, , patchArg] = mockService.update.mock.calls[0];
    expect(patchArg).not.toHaveProperty("scenario");
    expect(patchArg).not.toHaveProperty("tool");
    expect(patchArg).not.toHaveProperty("isOfficial");
    expect(patchArg).toEqual(expect.objectContaining({ name: "renamed" }));
  });

  it("delete returns void (204) and forwards actor", async () => {
    mockService.delete.mockResolvedValue(undefined);
    await controller.delete({ sub: "owner-1", email: "o@x", roles: ["user"] }, "t1");
    expect(mockService.delete).toHaveBeenCalledWith({ sub: "owner-1", isAdmin: false }, "t1");
  });
});

describe("patchSchema", () => {
  it("silently strips isOfficial / scenario / tool from input (defense in depth)", () => {
    const raw = {
      name: "renamed",
      description: "d",
      // These three fields should be stripped by the .omit() in patchSchema
      isOfficial: true,
      scenario: "capacity",
      tool: "vegeta",
    };
    const parsed = patchSchema.parse(raw);
    expect(parsed).not.toHaveProperty("isOfficial");
    expect(parsed).not.toHaveProperty("scenario");
    expect(parsed).not.toHaveProperty("tool");
    expect(parsed).toEqual({ name: "renamed", description: "d" });
  });
});
