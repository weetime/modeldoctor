import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaService } from "../../database/prisma.service.js";
import { UsersService } from "./users.service.js";

describe("UsersService.countAll", () => {
  let service: UsersService;
  let count: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    count = vi.fn();
    const mod = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: { user: { count } } },
      ],
    }).compile();
    service = mod.get(UsersService);
  });

  it("filters out seed-time system rows so the first real registration sees total=0", async () => {
    // The seed creates a user with roles=["system"] to own built-in
    // evaluations. The auth.service "first user becomes admin" check
    // depends on countAll() returning 0 for a fresh deployment; without
    // the filter, the seed bumps total to 1 and no human ever gets admin.
    count.mockResolvedValueOnce(0);
    await service.countAll();
    expect(count).toHaveBeenCalledWith({
      where: { NOT: { roles: { has: "system" } } },
    });
  });

  it("returns whatever prisma.user.count returns under the system-excluding filter", async () => {
    count.mockResolvedValueOnce(3);
    expect(await service.countAll()).toBe(3);
  });
});
