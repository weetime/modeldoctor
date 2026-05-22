import {
  type BenchmarkTemplate,
  type CreateBenchmarkTemplateRequest,
  type ListBenchmarkTemplatesQuery,
  type ListBenchmarkTemplatesResponse,
} from "@modeldoctor/contracts";
import { applyScenarioConstraints, byTool, type ToolName } from "@modeldoctor/tool-adapters";
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma, BenchmarkTemplate as PrismaBenchmarkTemplate } from "@prisma/client";
import { ZodError } from "zod";
import { formatZodError } from "../../common/zod/format-zod-error.js";
import {
  BenchmarkTemplateRepository,
  type UpdateBenchmarkTemplateInput,
} from "./benchmark-template.repository.js";

/**
 * Caller identity used for authorization decisions. The controller flattens
 * `JwtPayload` into this shape so the service stays test-friendly without
 * a JwtPayload import in tests.
 */
export interface TemplateActor {
  sub: string;
  isAdmin: boolean;
}

@Injectable()
export class BenchmarkTemplateService {
  constructor(private readonly repo: BenchmarkTemplateRepository) {}

  async list(query: ListBenchmarkTemplatesQuery): Promise<ListBenchmarkTemplatesResponse> {
    const result = await this.repo.list(query);
    return {
      items: result.items.map(toContract),
      nextCursor: result.nextCursor,
    };
  }

  async findByIdOrFail(id: string): Promise<BenchmarkTemplate> {
    const row = await this.repo.findByIdOrNull(id);
    if (!row) throw new NotFoundException(`BenchmarkTemplate ${id} not found`);
    return toContract(row);
  }

  async create(
    actor: TemplateActor,
    req: CreateBenchmarkTemplateRequest,
  ): Promise<BenchmarkTemplate> {
    if (req.isOfficial && !actor.isAdmin) {
      throw new ForbiddenException({
        code: "BENCHMARK_TEMPLATE_OFFICIAL_FORBIDDEN",
        message: "only admin can create official templates",
      });
    }
    this.assertScenarioToolPair(req.scenario, req.tool);
    this.validateConfig(req.scenario, req.tool, req.config);

    const row = await this.repo.create({
      name: req.name,
      description: req.description ?? null,
      scenario: req.scenario,
      tool: req.tool,
      config: req.config as Prisma.InputJsonValue,
      isOfficial: req.isOfficial ?? false,
      createdBy: actor.sub,
      tags: req.tags ?? [],
      categories: req.categories,
    });
    return toContract(row);
  }

  async update(
    actor: TemplateActor,
    id: string,
    patch: UpdateBenchmarkTemplateInput,
  ): Promise<BenchmarkTemplate> {
    const row = await this.repo.findByIdOrNull(id);
    if (!row) throw new NotFoundException(`BenchmarkTemplate ${id} not found`);
    this.assertCanWrite(actor, row);

    if (patch.config !== undefined) {
      this.validateConfig(row.scenario, row.tool, patch.config);
    }
    const updated = await this.repo.update(id, patch);
    return toContract(updated);
  }

  async delete(actor: TemplateActor, id: string): Promise<void> {
    const row = await this.repo.findByIdOrNull(id);
    if (!row) throw new NotFoundException(`BenchmarkTemplate ${id} not found`);
    this.assertCanWrite(actor, row);
    await this.repo.delete(id);
  }

  private assertCanWrite(actor: TemplateActor, row: PrismaBenchmarkTemplate): void {
    if (actor.isAdmin) return;
    if (row.createdBy === actor.sub) return;
    throw new ForbiddenException({
      code: "BENCHMARK_TEMPLATE_FORBIDDEN",
      message: "only the template owner or an admin can modify this template",
    });
  }

  private assertScenarioToolPair(scenario: string, tool: string): void {
    const adapter = byTool(tool as ToolName);
    if (!(adapter.scenarios as readonly string[]).includes(scenario)) {
      throw new BadRequestException({
        code: "BENCHMARK_TEMPLATE_SCENARIO_TOOL_MISMATCH",
        message: `scenario '${scenario}' does not support tool '${tool}'`,
      });
    }
  }

  private validateConfig(scenario: string, tool: string, config: unknown): void {
    try {
      // Same double-parse pattern as BenchmarkService.create:
      // 1) scenario-narrowed schema (e.g. capacity forces rateType=sweep)
      // 2) adapter base schema (preserves cross-field superRefine rules
      //    that applyScenarioConstraints unwraps)
      applyScenarioConstraints(
        scenario as Parameters<typeof applyScenarioConstraints>[0],
        tool as ToolName,
      ).parse(config);
      byTool(tool as ToolName).paramsSchema.parse(config);
    } catch (e) {
      const detail = e instanceof ZodError ? formatZodError(e) : (e as Error).message;
      throw new BadRequestException({
        code: "BENCHMARK_TEMPLATE_CONFIG_INVALID",
        message: `config validation failed: ${detail}`,
      });
    }
  }
}

function toContract(row: PrismaBenchmarkTemplate): BenchmarkTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    scenario: row.scenario as BenchmarkTemplate["scenario"],
    tool: row.tool as BenchmarkTemplate["tool"],
    config: row.config as Record<string, unknown>,
    isOfficial: row.isOfficial,
    createdBy: row.createdBy,
    tags: row.tags,
    categories: row.categories as BenchmarkTemplate["categories"],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
