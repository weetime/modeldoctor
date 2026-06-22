import { toast } from "sonner";
import { ApiError } from "@/lib/api-client";

/**
 * Per-code i18n mapper for errors raised by /api/llm-judge/providers.
 * `t` is the i18next `t` bound to the "llm-judge-providers" namespace.
 */
export function toastLlmJudgeError(
  t: (key: string, opts?: Record<string, unknown>) => string,
  e: unknown,
): void {
  const code = e instanceof ApiError ? e.code : undefined;
  if (code === "LLM_JUDGE_PROVIDER_NAME_TAKEN") {
    toast.error(t("toast.errors.nameTaken"));
    return;
  }
  const message = e instanceof Error ? e.message : "";
  toast.error(t("toast.errors.generic", { message }));
}
