import { z } from "zod";

export const SuccessFlagSchema = z.object({
  success: z.literal(true),
});
