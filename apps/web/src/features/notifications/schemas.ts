import { z } from "zod";

export const channelFormSchema = z.object({
  type: z.enum(["slack", "webhook", "feishu", "dingtalk"]),
  name: z.string().min(1).max(100),
  url: z.string().url(),
});
export type ChannelForm = z.infer<typeof channelFormSchema>;

export const subscriptionFormSchema = z.object({
  channelId: z.string().min(1),
  eventType: z.enum(["benchmark.completed", "benchmark.failed", "diagnostics.failed"]),
  connectionId: z.string().optional(),
});
export type SubscriptionForm = z.infer<typeof subscriptionFormSchema>;
