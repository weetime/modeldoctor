import { z } from "zod";

export const progressEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("progress"),
    pct: z.number().min(0).max(1),
    currentRequests: z.number().int().nonnegative().optional(),
    message: z.string().optional(),
  }),
  z.object({
    kind: z.literal("log"),
    level: z.enum(["info", "warn", "error"]),
    line: z.string(),
  }),
]);
