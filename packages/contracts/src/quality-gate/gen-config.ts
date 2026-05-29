import { z } from "zod";

/**
 * Generation parameters for an evaluation run's model calls.
 *
 * Eval ≠ Playground: these are recorded config, snapshotted onto the run for
 * reproducibility and cross-run comparison — not ephemeral playground knobs.
 * Layering: eval-level default → run-level override → snapshot on the run.
 *
 * `thinking`:
 *   - "auto": send nothing — use the model/server default (safe for every
 *             OpenAI-compatible endpoint).
 *   - "off":  send `chat_template_kwargs: { enable_thinking: false }` (vLLM /
 *             Qwen3 etc.) so reasoning models answer directly. Do NOT make this
 *             a global default — non-vLLM endpoints reject the extra field.
 *   - "on":   send `enable_thinking: true`; callers should also raise maxTokens.
 */
export const genConfigSchema = z.object({
  maxTokens: z.number().int().min(1).max(32768).default(2048),
  temperature: z.number().min(0).max(2).default(0),
  thinking: z.enum(["auto", "on", "off"]).default("auto"),
  stop: z.array(z.string().min(1).max(64)).max(4).optional(),
});
export type GenConfig = z.infer<typeof genConfigSchema>;

/** Greedy, no thinking override, 2048-token budget — the gate-friendly default. */
export const DEFAULT_GEN_CONFIG: GenConfig = {
  maxTokens: 2048,
  temperature: 0,
  thinking: "auto",
};

/**
 * Resolve the effective gen config for a run: schema defaults < eval-level
 * default < per-run override. Each layer may be partial; later layers win.
 */
export function resolveGenConfig(
  evalDefault?: Partial<GenConfig> | null,
  runOverride?: Partial<GenConfig> | null,
): GenConfig {
  return genConfigSchema.parse({
    ...DEFAULT_GEN_CONFIG,
    ...(evalDefault ?? {}),
    ...(runOverride ?? {}),
  });
}
