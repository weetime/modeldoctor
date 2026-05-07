// apps/api/src/modules/insights/evaluation-profile.service.ts
import type { EvaluationProfile, ProfileRules } from "@modeldoctor/contracts";
import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service.js";

@Injectable()
export class EvaluationProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<EvaluationProfile[]> {
    const rows = await this.prisma.evaluationProfile.findMany({
      orderBy: [{ isBuiltin: "desc" }, { slug: "asc" }],
    });
    return rows.map((r) => this.toContract(r));
  }

  async getBySlug(slug: string): Promise<EvaluationProfile> {
    const row = await this.prisma.evaluationProfile.findUnique({ where: { slug } });
    if (!row) throw new NotFoundException(`Profile ${slug} not found`);
    return this.toContract(row);
  }

  private toContract(r: any): EvaluationProfile {
    return {
      id: r.id, slug: r.slug, name: r.name, nameKey: r.nameKey,
      description: r.description, isBuiltin: r.isBuiltin,
      rules: r.rules as ProfileRules,
      source: r.source,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}
