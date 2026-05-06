import type { ToolName } from "@modeldoctor/tool-adapters/schemas";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";

interface Props {
  tool: ToolName;
  category: string;
  /** Tools in the current scenario that DO support this category. May be
   * empty (e.g. capacity scenario only has guidellm — picking embeddings
   * leaves no usable alternative). */
  alternatives: ToolName[];
}

/**
 * Replaces the params form when the picked connection's category is not
 * supported by the currently-selected tool. Surfaces the conflict + a
 * concrete next action instead of letting the user fill out a form whose
 * submit is guaranteed to fail.
 */
export function ToolUnsupportedNotice({ tool, category, alternatives }: Props) {
  const { t } = useTranslation("benchmarks");
  const toolLabel = t(`create.tools.${tool}`);
  const altLabels = alternatives.map((a) => t(`create.tools.${a}`)).join(" / ");
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-700 dark:bg-amber-950/40"
    >
      <AlertTriangle
        className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400"
        strokeWidth={2}
      />
      <div className="space-y-1">
        <div className="font-medium text-amber-900 dark:text-amber-100">
          {t("create.toolUnsupported.title", { tool: toolLabel, category })}
        </div>
        <div className="text-muted-foreground">
          {alternatives.length > 0
            ? t("create.toolUnsupported.suggestSwitch", { alternatives: altLabels })
            : t("create.toolUnsupported.suggestChangeConnection")}
        </div>
      </div>
    </div>
  );
}
