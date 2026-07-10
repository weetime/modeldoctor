import { z } from "zod";

/**
 * A user-registered external MCP (Model Context Protocol) server. Separate
 * from `Connection` (which always points at an OpenAI-shape model
 * endpoint) — an McpServer exposes *tools* over the MCP protocol, not a
 * chat/completions API. Mirrors connection.ts's public/withSecret/create/
 * update layering: `authTokenCipher` (server-only) never leaves the API;
 * clients see `authTokenPreview` instead, mirroring `apiKeyPreview`.
 */
export const mcpServerTransportSchema = z.enum(["http"]);
export type McpServerTransport = z.infer<typeof mcpServerTransportSchema>;

/** A single tool advertised by an MCP server, as returned by tools/list. */
export const mcpServerToolSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  inputSchema: z.record(z.unknown()),
  annotations: z.record(z.unknown()).optional(),
});
export type McpServerTool = z.infer<typeof mcpServerToolSchema>;

/** What clients see on list / detail. No plaintext authToken, only preview. */
export const mcpServerPublicSchema = z.object({
  id: z.string(),
  userId: z.string().optional(),
  name: z.string().min(1).max(120),
  description: z.string().optional(),
  transport: mcpServerTransportSchema,
  url: z.string().url(),
  authTokenPreview: z.string().optional(),
  headers: z.string(),
  toolsCache: z.array(mcpServerToolSchema).nullable().optional(),
  toolsCachedAt: z.string().datetime().nullable().optional(),
  enabled: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type McpServerPublic = z.infer<typeof mcpServerPublicSchema>;

/** Returned exactly once by POST /api/mcp-servers, and by PATCH when authToken is rotated. */
export const mcpServerWithSecretSchema = mcpServerPublicSchema.extend({
  authToken: z.string(),
});
export type McpServerWithSecret = z.infer<typeof mcpServerWithSecretSchema>;

const authTokenStringSchema = z
  .string()
  .min(1)
  .refine((v) => !/\p{Cc}/u.test(v), {
    message: "authToken must not contain control characters",
  })
  .refine((v) => v === v.trim(), {
    message: "authToken must not have leading or trailing whitespace",
  });

export const createMcpServerSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().optional(),
  transport: mcpServerTransportSchema.default("http"),
  url: z.string().url(),
  authToken: authTokenStringSchema.optional(),
  headers: z.string().default(""),
});
export type CreateMcpServer = z.infer<typeof createMcpServerSchema>;

// PATCH semantics: every field is optional, but if the client sends
// authToken, the same shape rules apply (non-empty, trimmed, etc.).
// `enabled` is update-only — an McpServer is always created enabled, then
// archived/restored via PATCH.
export const updateMcpServerSchema = createMcpServerSchema.partial().extend({
  enabled: z.boolean().optional(),
});
export type UpdateMcpServer = z.infer<typeof updateMcpServerSchema>;

export const listMcpServersResponseSchema = z.object({
  items: z.array(mcpServerPublicSchema),
});
export type ListMcpServersResponse = z.infer<typeof listMcpServersResponseSchema>;
