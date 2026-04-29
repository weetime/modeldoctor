import { ModalityCategorySchema } from "@modeldoctor/contracts";
import { z } from "zod";

export const connectionInputSchema = z.object({
  name: z
    .string()
    .transform((v) => v.trim())
    .pipe(z.string().min(1, "required")),
  apiBaseUrl: z.string().url("invalid URL"),
  apiKey: z.string().min(1, "required"),
  model: z.string().min(1, "required"),
  customHeaders: z.string(),
  queryParams: z.string(),
  category: ModalityCategorySchema,
  tags: z
    .array(z.string().trim())
    .default([])
    .transform((arr) => {
      const seen = new Set<string>();
      const out: string[] = [];
      for (const t of arr) {
        if (!t || seen.has(t)) continue;
        seen.add(t);
        out.push(t);
      }
      return out;
    }),
});

export type ConnectionInput = z.infer<typeof connectionInputSchema>;
