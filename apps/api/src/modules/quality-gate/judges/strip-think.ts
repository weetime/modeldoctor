const THINK_BLOCK = /<think>[\s\S]*?<\/think>/gi;

/**
 * Strip closed `<think>…</think>` reasoning blocks from a model answer before
 * judging. Server-agnostic safety net for reasoning models (Qwen3, DeepSeek-R1)
 * on vLLM deployments that DON'T run a `--reasoning-parser` (so thinking leaks
 * into `content`). When the deployment DOES separate reasoning into a distinct
 * field, `content` has no think tags and this is a no-op.
 *
 * Unclosed `<think>` (e.g. thinking truncated by max_tokens before the answer)
 * is left intact — there's no final answer to recover, and keeping the text
 * makes the failure visible rather than silently blanking it.
 */
export function stripThink(text: string): string {
  return text.replace(THINK_BLOCK, "").trim();
}
