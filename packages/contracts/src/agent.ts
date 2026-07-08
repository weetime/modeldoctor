import { z } from "zod";

/**
 * OpenAI-style function-tool definition. Shared by `Skill.inlineTools`
 * (a Skill's ad-hoc tool list, alongside its referenced McpServers) and by
 * later agent-run request/response shapes. Kept minimal — only what a
 * chat-completions `tools` array needs.
 */
export const toolDefSchema = z.object({
  type: z.literal("function"),
  function: z.object({
    name: z.string(),
    description: z.string().optional(),
    parameters: z.record(z.unknown()),
  }),
});
export type ToolDef = z.infer<typeof toolDefSchema>;

/**
 * OpenAI-style tool-call emitted by an assistant message (chat-completions
 * `message.tool_calls[]`). `function.arguments` is a JSON-encoded string
 * (not a parsed object) — that's how the upstream API returns it.
 */
export const ToolCallSchema = z.object({
  id: z.string(),
  type: z.literal("function"),
  function: z.object({
    name: z.string(),
    arguments: z.string(),
  }),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;
