import { FormSection } from "@/components/common/form-section";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConnections } from "@/features/connections/queries";
import type { ScenarioId } from "@modeldoctor/contracts";
import {
  GENAI_PERF_CATEGORY_DEFAULTS,
  GUIDELLM_CATEGORY_DEFAULTS,
  VEGETA_CATEGORY_DEFAULTS,
  genaiPerfParamDefaults,
  guidellmParamDefaults,
  vegetaParamDefaults,
} from "@modeldoctor/tool-adapters/schemas";
import type { ToolName } from "@modeldoctor/tool-adapters/schemas";
import { useId } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { SCENARIOS } from "../scenarios";

const TOOL_CATEGORY_DEFAULTS = {
  vegeta: VEGETA_CATEGORY_DEFAULTS,
  guidellm: GUIDELLM_CATEGORY_DEFAULTS,
  "genai-perf": GENAI_PERF_CATEGORY_DEFAULTS,
} as const;
import { GenaiPerfParamsForm } from "./GenaiPerfParamsForm";
import { GuidellmParamsForm } from "./GuidellmParamsForm";
import { VegetaParamsForm } from "./VegetaParamsForm";

export const TOOL_DEFAULTS: Record<ToolName, unknown> = {
  guidellm: guidellmParamDefaults,
  vegeta: vegetaParamDefaults,
  "genai-perf": genaiPerfParamDefaults,
};

export interface ToolEditorProps {
  scenario: ScenarioId;
  /** Form field name where the tool's params live. Defaults to "params" so
   * existing BenchmarkCreatePage callers don't need to change. Template
   * forms pass "config" because that's the BenchmarkTemplate column name. */
  paramsFieldName?: "params" | "config";
  /** Display-only tool value for edit modes where the tool selector is
   * disabled and the value is not stored in the form. When omitted the tool
   * is read from the form via useWatch (create mode). */
  displayTool?: ToolName;
}

function useToolFromForm(scenario: ScenarioId, displayTool?: ToolName): ToolName {
  const { control } = useFormContext();
  const formTool = (useWatch({ control, name: "tool" }) ??
    SCENARIOS[scenario].tools[0]) as ToolName;
  return displayTool ?? formTool;
}

/**
 * Standalone tool-picker field. Use this when the tool selector should sit
 * in a multi-column row alongside another field (e.g. scenario + tool, or
 * connection + tool). When you don't need that flexibility, use the bundled
 * `<ToolParamsEditor>` instead — it composes ToolSelectorField + ToolParamsForm.
 */
export function ToolSelectorField({
  scenario,
  paramsFieldName = "params",
  displayTool,
}: ToolEditorProps) {
  const { t } = useTranslation("benchmarks");
  const { control, reset, getValues } = useFormContext();
  const tool = useToolFromForm(scenario, displayTool);
  const id = useId();
  const toolFieldId = `${id}-tool`;

  const availableTools = SCENARIOS[scenario].tools;

  // Watch the form's connectionId so we can mark tools that don't speak the
  // picked connection's modality as disabled. When no connection is picked
  // every tool stays enabled — disabling pre-emptively would surprise the
  // user before they've made any choice.
  const connectionId = useWatch({ control, name: "connectionId" }) as string | undefined;
  const connections = useConnections();
  const connection = connectionId
    ? connections.data?.find((c) => c.id === connectionId)
    : undefined;
  const isToolUnsupported = (tn: ToolName): boolean => {
    if (!connection) return false;
    const def = TOOL_CATEGORY_DEFAULTS[tn][connection.category];
    return "unsupported" in def;
  };

  function handleToolChange(next: ToolName) {
    reset({
      ...getValues(),
      tool: next,
      [paramsFieldName]: TOOL_DEFAULTS[next] as Record<string, unknown>,
    });
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={toolFieldId}>{t("create.fields.tool")}</Label>
      {availableTools.length > 1 ? (
        <Select value={tool} onValueChange={(v) => handleToolChange(v as ToolName)}>
          <SelectTrigger id={toolFieldId} aria-label="Tool">
            <SelectValue>{t(`create.tools.${tool}`)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {availableTools.map((tn) => {
              const unsupported = isToolUnsupported(tn);
              return (
                <SelectItem key={tn} value={tn} className="py-2" disabled={unsupported}>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">{t(`create.tools.${tn}`)}</span>
                    <span className="text-[11px] text-muted-foreground/70">
                      {t(`create.toolDescriptions.${tn}`)}
                    </span>
                    {unsupported && connection ? (
                      <span className="text-[11px] text-amber-600 dark:text-amber-400">
                        {t("create.unsupportedToolForCategory", {
                          category: connection.category,
                        })}
                      </span>
                    ) : null}
                  </div>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      ) : (
        // Single-tool scenario (e.g. gateway → vegeta). Render as plain
        // inline text — no input chrome, no description: the user has no
        // choice to make here so the field is purely informational.
        <div id={toolFieldId} aria-label="Tool" className="text-sm font-medium">
          {t(`create.tools.${tool}`)}
        </div>
      )}
    </div>
  );
}

/** Tool-specific parameter form (no tool selector, no section heading). */
export function ToolParamsForm({
  scenario,
  paramsFieldName = "params",
  displayTool,
}: ToolEditorProps) {
  const tool = useToolFromForm(scenario, displayTool);
  const ParamsForm =
    tool === "guidellm"
      ? GuidellmParamsForm
      : tool === "vegeta"
        ? VegetaParamsForm
        : GenaiPerfParamsForm;
  return <ParamsForm fieldPrefix={paramsFieldName} />;
}

/** Default bundled view: tool selector + params, each in its own FormSection. */
export function ToolParamsEditor(props: ToolEditorProps) {
  const { t } = useTranslation("benchmarks");
  return (
    <>
      <FormSection title={t("create.sections.tool")}>
        <div className="max-w-xs">
          <ToolSelectorField {...props} />
        </div>
      </FormSection>
      <FormSection title={t("create.sections.parameters")}>
        <ToolParamsForm {...props} />
      </FormSection>
    </>
  );
}
