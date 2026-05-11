import { z } from "zod";

const baseShape = {
  type: z.enum(["slack", "webhook", "feishu", "dingtalk"]),
  name: z.string().min(1).max(100),
  // Subscriptions baked into the channel form.
  connectionIds: z.array(z.string()).default([]),
  applyToAll: z.boolean().default(false),
  events: z
    .array(z.enum(["benchmark.completed", "benchmark.failed", "diagnostics.failed"]))
    .default([]),
};

/** Create mode — URL is required. */
export const channelFormCreateSchema = z.object({
  ...baseShape,
  url: z.string().url(),
});

/** Edit mode — URL is optional. Empty string means "keep the existing URL".
 *  Non-empty values are still validated as URLs. */
export const channelFormEditSchema = z.object({
  ...baseShape,
  url: z
    .string()
    .optional()
    .refine((v) => !v || /^https?:\/\/.+/.test(v), { message: "validation.invalidUrl" }),
});

export type ChannelForm = z.infer<typeof channelFormCreateSchema>;
