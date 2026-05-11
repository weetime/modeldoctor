import { z } from "zod";

export const channelTypeSchema = z.enum(["slack", "webhook", "feishu", "dingtalk"]);
export const eventTypeSchema = z.enum([
  "benchmark.completed",
  "benchmark.failed",
  "diagnostics.failed",
]);

export const createChannelSchema = z.object({
  type: channelTypeSchema,
  name: z.string().min(1).max(100),
  url: z.string().url(),
});

export const updateChannelSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  url: z.string().url().optional(),
});

export const createSubscriptionSchema = z.object({
  channelId: z.string().min(1),
  eventType: eventTypeSchema,
  connectionId: z.string().min(1).optional(),
});

export type CreateChannelDto = z.infer<typeof createChannelSchema>;
export type UpdateChannelDto = z.infer<typeof updateChannelSchema>;
export type CreateSubscriptionDto = z.infer<typeof createSubscriptionSchema>;
