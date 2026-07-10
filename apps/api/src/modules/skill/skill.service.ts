import type {
  CreateSkill,
  ListSkillsResponse,
  SkillPublic,
  ToolDef,
  UpdateSkill,
} from "@modeldoctor/contracts";
import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Skill as PrismaSkill } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service.js";

/**
 * A Skill is a LOCAL preset — a composition of systemPrompt +
 * modelConnectionId? + mcpServerIds[] + inlineTools[] + agent-loop knobs.
 * It references a Connection and McpServers by id, but holds no secret of
 * its own, so this service (unlike ConnectionService / McpServerService)
 * has no crypto dependency at all.
 */
@Injectable()
export class SkillService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, input: CreateSkill): Promise<SkillPublic> {
    const row = await this.prisma.skill.create({
      data: {
        userId,
        name: input.name,
        description: input.description,
        systemPrompt: input.systemPrompt,
        modelConnectionId: input.modelConnectionId,
        mcpServerIds: input.mcpServerIds,
        inlineTools: this.toJsonInput(input.inlineTools),
        planFirst: input.planFirst,
        maxSteps: input.maxSteps,
      },
    });
    return this.toContract(row);
  }

  async list(userId: string): Promise<ListSkillsResponse> {
    const rows = await this.prisma.skill.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    return { items: rows.map((r) => this.toContract(r)) };
  }

  async findOwnedPublic(userId: string, id: string): Promise<SkillPublic> {
    const row = await this.findOwnedRow(userId, id);
    return this.toContract(row);
  }

  async update(userId: string, id: string, input: UpdateSkill): Promise<SkillPublic> {
    await this.findOwnedRow(userId, id);
    const data: Prisma.SkillUncheckedUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.systemPrompt !== undefined) data.systemPrompt = input.systemPrompt;
    if (input.modelConnectionId !== undefined) data.modelConnectionId = input.modelConnectionId;
    if (input.mcpServerIds !== undefined) data.mcpServerIds = input.mcpServerIds;
    if (input.inlineTools !== undefined) data.inlineTools = this.toJsonInput(input.inlineTools);
    if (input.planFirst !== undefined) data.planFirst = input.planFirst;
    if (input.maxSteps !== undefined) data.maxSteps = input.maxSteps;

    const row = await this.prisma.skill.update({ where: { id }, data });
    return this.toContract(row);
  }

  async delete(userId: string, id: string): Promise<void> {
    await this.findOwnedRow(userId, id);
    await this.prisma.skill.delete({ where: { id } });
  }

  private async findOwnedRow(userId: string, id: string): Promise<PrismaSkill> {
    const row = await this.prisma.skill.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Skill ${id} not found`);
    if (row.userId !== userId) throw new ForbiddenException();
    return row;
  }

  /**
   * `undefined` → omit from the Prisma write (leaves the column untouched
   * on update / defaults to NULL on create). Explicit `null` → JsonNull
   * sentinel, since a bare JS `null` is ambiguous for a Prisma Json column.
   */
  private toJsonInput(
    tools: ToolDef[] | null | undefined,
  ): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
    if (tools === undefined) return undefined;
    if (tools === null) return Prisma.JsonNull;
    return tools as unknown as Prisma.InputJsonValue;
  }

  private toContract(row: PrismaSkill): SkillPublic {
    return {
      id: row.id,
      userId: row.userId,
      name: row.name,
      description: row.description ?? undefined,
      systemPrompt: row.systemPrompt ?? undefined,
      modelConnectionId: row.modelConnectionId ?? undefined,
      mcpServerIds: row.mcpServerIds,
      inlineTools: (row.inlineTools as ToolDef[] | null) ?? null,
      planFirst: row.planFirst,
      maxSteps: row.maxSteps,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
