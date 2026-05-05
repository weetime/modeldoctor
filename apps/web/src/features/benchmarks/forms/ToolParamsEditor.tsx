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

const TOOL_DEFAULTS: Record<ToolName, unknown> = {
  guidellm: guidellmParamDefaults,
  vegeta: vegetaParamDefaults,
  "genai-perf": genaiPerfParamDefaults,
};

export interface ToolParamsEditorProps {
  scenario: ScenarioId;
  /** Form field name where the tool's params live. Defaults to "params" so
   * existing BenchmarkCreatePage callers don't need to change. Template
   * forms pass "config" because that's the BenchmarkTemplate column name. */
  paramsFieldName?: "params" | "config";
}

export function ToolParamsEditor({ scenario, paramsFieldName = "params" }: ToolParamsEditorProps) {
  const { t } = useTranslation("benchmarks");
  const { control, reset, getValues } = useFormContext();
  const tool = (useWatch({ control, name: "tool" }) ?? SCENARIOS[scenario].tools[0]) as ToolName;
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

  const ParamsForm =
    tool === "guidellm" ? GuidellmParamsForm
      : tool === "vegeta" ? VegetaParamsForm
        : GenaiPerfParamsForm;

  return (
    <>
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t("create.sections.tool")}
        </h2>
        <div className="max-w-xs">
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
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t("create.sections.parameters")}
        </h2>
        <ParamsForm fieldPrefix={paramsFieldName} />
      </section>
    </>
  );
}
