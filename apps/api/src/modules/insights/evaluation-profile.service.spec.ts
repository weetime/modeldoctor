// apps/api/src/modules/insights/evaluation-profile.service.spec.ts
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../../database/prisma.service.js";
import { EvaluationProfileService } from "./evaluation-profile.service.js";

describe("EvaluationProfileService", () => {
  let svc: EvaluationProfileService;
  let prisma: PrismaService;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        EvaluationProfileService,
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
    svc = mod.get(EvaluationProfileService);
    prisma = mod.get(PrismaService);
    await prisma.$connect();
  });

  afterEach(() => undefined);

  it("list returns the 5 seeded built-in profiles", async () => {
    const items = await svc.list();
    const slugs = items.map((p) => p.slug);
    expect(slugs).toEqual(expect.arrayContaining(["default", "chatbot", "rag", "code-completion", "long-form"]));
    expect(items.every((p) => p.isBuiltin)).toBe(true);
  });

  it("getBySlug returns the requested profile", async () => {
    const p = await svc.getBySlug("chatbot");
    expect(p.slug).toBe("chatbot");
    expect(p.rules.checks["inference.ttft.p95.ms"].crit).toBeDefined();
  });

  it("getBySlug throws on unknown slug", async () => {
    await expect(svc.getBySlug("nope")).rejects.toThrow();
  });
});
