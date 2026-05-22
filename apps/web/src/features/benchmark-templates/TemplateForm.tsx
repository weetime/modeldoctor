import type { ToolName } from "@modeldoctor/tool-adapters/schemas";
import { useId } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { FormSection } from "@/components/common/form-section";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  TOOL_DEFAULTS,
  ToolParamsForm,
  ToolSelectorField,
} from "@/features/benchmarks/forms/ToolParamsEditor";
import { SCENARIOS, type ScenarioId } from "@/features/benchmarks/scenarios";

export interface TemplateFormProps {
  mode: "create" | "edit-owner" | "edit-readonly";
  isAdmin: boolean;
  displayScenario?: ScenarioId;
  displayTool?: ToolName;
}

export function TemplateForm({ mode, isAdmin, displayScenario, displayTool }: TemplateFormProps) {
  const { t } = useTranslation("benchmark-templates");
  const { control, reset, getValues, register } = useFormContext();
  const id = useId();
  const tagsId = `${id}-tags`;
  const scenarioId = `${id}-scenario`;
  const officialId = `${id}-official`;

  const formScenario = (useWatch({ control, name: "scenario" }) ?? "inference") as
    | ScenarioId
    | undefined;
  const scenario =
    mode === "create" ? (formScenario ?? "inference") : (displayScenario ?? "inference");
  const disableScenarioTool = mode !== "create";
  const disableAll = mode === "edit-readonly";

  function handleScenarioChange(next: ScenarioId) {
    const nextTool = SCENARIOS[next].tools[0];
    reset({
      ...getValues(),
      scenario: next,
      tool: nextTool,
      config: TOOL_DEFAULTS[nextTool] as Record<string, unknown>,
    });
  }

  return (
    <div className="space-y-8">
      <FormSection title={t("create.sections.basic")}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField
            control={control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>{t("create.fields.name")}</FormLabel>
                <FormControl>
                  <Input
                    placeholder={t("create.fields.namePlaceholder")}
                    disabled={disableAll}
                    {...field}
                    value={field.value ?? ""}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="space-y-2">
            <Label htmlFor={tagsId}>{t("create.fields.tags")}</Label>
            <Input
              id={tagsId}
              placeholder={t("create.fields.tagsPlaceholder")}
              disabled={disableAll}
              {...register("tags", {
                setValueAs: (v) =>
                  typeof v === "string"
                    ? v
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean)
                    : (v ?? []),
              })}
            />
          </div>
        </div>
        <FormField
          control={control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("create.fields.description")}</FormLabel>
              <FormControl>
                <Textarea
                  rows={2}
                  disabled={disableAll}
                  {...field}
                  value={field.value ?? ""}
                  onChange={(e) =>
                    field.onChange(e.target.value === "" ? undefined : e.target.value)
                  }
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </FormSection>

      <FormSection title={t("create.sections.scenario")}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={scenarioId}>{t("create.fields.scenario")}</Label>
            {disableScenarioTool ? (
              <div className="flex h-10 items-center rounded-md border border-input bg-muted px-3 text-sm">
                {t(`list.tabs.${scenario}`)}
              </div>
            ) : (
              <Select value={scenario} onValueChange={(v) => handleScenarioChange(v as ScenarioId)}>
                <SelectTrigger id={scenarioId} aria-label="Scenario">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(
                    ["inference", "capacity", "gateway", "prefix-cache-validation"] as ScenarioId[]
                  ).map((sid) => (
                    <SelectItem key={sid} value={sid}>
                      {t(`list.tabs.${sid}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <ToolSelectorField
            scenario={scenario}
            paramsFieldName="config"
            displayTool={mode !== "create" ? displayTool : undefined}
          />
        </div>
      </FormSection>

      <FormSection
        title={t("benchmarks:create.sections.parameters", { defaultValue: "Parameters" })}
      >
        <ToolParamsForm
          scenario={scenario}
          paramsFieldName="config"
          displayTool={mode !== "create" ? displayTool : undefined}
        />
      </FormSection>

      {mode === "create" && isAdmin && (
        <FormSection title={t("create.sections.official")}>
          <label htmlFor={officialId} className="flex items-center gap-2 text-sm">
            <input
              id={officialId}
              type="checkbox"
              className="h-4 w-4 rounded border border-primary"
              {...register("isOfficial")}
            />
            {t("create.fields.isOfficial")}
          </label>
          <p className="mt-1 text-xs text-muted-foreground">{t("create.officialHint")}</p>
        </FormSection>
      )}
    </div>
  );
}
