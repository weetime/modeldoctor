import { z } from "zod";

export const channelFormSchema = z.object({
  type: z.enum(["slack", "webhook", "feishu", "dingtalk"]),
  name: z.string().min(1).max(100),
  url: z.string().url(),
  // The set of connection IDs this channel should notify on. Empty list +
  // applyToAll=false means "no subscriptions". applyToAll=true means
  // "every event of every (current AND future) connection" — stored as
  // a single subscription row per event with connectionId=null.
  connectionIds: z.array(z.string()).default([]),
  applyToAll: z.boolean().default(false),
  // Event types this channel is wired to. The cartesian product of
  // (connections × events) is materialised as backend subscription rows.
  events: z
    .array(z.enum(["benchmark.completed", "benchmark.failed", "diagnostics.failed"]))
    .default([]),
});
export type ChannelForm = z.infer<typeof channelFormSchema>;
