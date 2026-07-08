import { z } from "zod";
import { toolDefSchema } from "./agent.js";

/**
 * A Skill is a LOCAL preset — not an external endpoint. It composes an
 * optional system prompt, an optional model Connection reference, zero or
 * more McpServer references (by id), and/or inline function-tool
 * definitions, plus agent-loop knobs (planFirst / maxSteps). No secrets, no
 * encryption — mirrors McpServer's ownership/CRUD shape minus the crypto
 * layer, since a Skill holds no credential of its own.
 */
export const skillSchema = z.object({
  id: z.string(),
  userId: z.string().optional(),
  name: z.string().min(1).max(120),
  description: z.string().optional(),
  systemPrompt: z.string().optional(),
  modelConnectionId: z.string().optional(),
  mcpServerIds: z.array(z.string()).default([]),
  // Prisma Json? — an unset/never-written column round-trips as `null`, not
  // `undefined`. Same nullable lesson as McpServer.toolsCache.
  inlineTools: z.array(toolDefSchema).nullable().optional(),
  planFirst: z.boolean().default(false),
  maxSteps: z.number().int().min(1).max(50).default(12),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type SkillPublic = z.infer<typeof skillSchema>;

export const createSkillSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().optional(),
  systemPrompt: z.string().optional(),
  modelConnectionId: z.string().optional(),
  mcpServerIds: z.array(z.string()).default([]),
  inlineTools: z.array(toolDefSchema).nullable().optional(),
  planFirst: z.boolean().default(false),
  maxSteps: z.number().int().min(1).max(50).default(12),
});
export type CreateSkill = z.infer<typeof createSkillSchema>;

// PATCH semantics: every field optional.
export const updateSkillSchema = createSkillSchema.partial();
export type UpdateSkill = z.infer<typeof updateSkillSchema>;

export const listSkillsResponseSchema = z.object({
  items: z.array(skillSchema),
});
export type ListSkillsResponse = z.infer<typeof listSkillsResponseSchema>;
