import { z } from "zod";

export const severitySchema = z.enum(["info", "warning", "critical"]);
export type Severity = z.infer<typeof severitySchema>;

export const createSubscriberSchema = z.object({
  channelId: z.string().min(1),
  minSeverity: severitySchema.default("warning"),
  enabled: z.boolean().default(true),
  // Optional: subscribe on behalf of another user (admin only — server
  // checks). Default = self.
  userId: z.string().optional(),
});

export type CreateSubscriberDto = z.infer<typeof createSubscriberSchema>;

export const updateSubscriberSchema = z
  .object({
    minSeverity: severitySchema.optional(),
    enabled: z.boolean().optional(),
  })
  .refine((v) => v.minSeverity !== undefined || v.enabled !== undefined, {
    message: "at least one field must be present",
  });

export type UpdateSubscriberDto = z.infer<typeof updateSubscriberSchema>;
