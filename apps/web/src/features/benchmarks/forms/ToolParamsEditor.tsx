import { FormSection } from "@/components/common/form-section";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ScenarioId } from "@modeldoctor/contracts";
import {
  genaiPerfParamDefaults,
  guidellmParamDefaults,
  vegetaParamDefaults,
} from "@modeldoctor/tool-adapters/schemas";
import type { ToolName } from "@modeldoctor/tool-adapters/schemas";
import { useId } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { SCENARIOS } from "../scenarios";
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
  const { reset, getValues } = useFormContext();
  const tool = useToolFromForm(scenario, displayTool);
  const id = useId();
  const toolFieldId = `${id}-tool`;

  const availableTools = SCENARIOS[scenario].tools;

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
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {availableTools.map((tn) => (
              <SelectItem key={tn} value={tn}>
                {t(`create.tools.${tn}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <div
          id={toolFieldId}
          aria-label="Tool"
          className="flex h-10 items-center rounded-md border border-input bg-muted px-3 text-sm"
        >
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
