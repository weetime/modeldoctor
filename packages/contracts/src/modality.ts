import { z } from "zod";

/**
 * Single source of truth for the 6 model-service categories. Both the
 * `Connection.category` field (in the web app) and the e2e-probe categories
 * use this enum — keep it in sync.
 *
 * Iteration order determines display order in UI dropdowns.
 */
export const ModalityCategorySchema = z.enum([
  "chat",
  "omni",
  "audio",
  "embeddings",
  "rerank",
  "image",
]);
export type ModalityCategory = z.infer<typeof ModalityCategorySchema>;
