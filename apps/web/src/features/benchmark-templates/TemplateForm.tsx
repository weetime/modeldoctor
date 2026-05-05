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
import { TOOL_DEFAULTS, ToolParamsEditor } from "@/features/benchmarks/forms/ToolParamsEditor";
import { SCENARIOS, type ScenarioId } from "@/features/benchmarks/scenarios";
import { useId } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";

export interface TemplateFormProps {
  /** "create" exposes scenario/tool selectors + admin-only isOfficial.
   *  "edit-owner" disables scenario/tool/isOfficial; rest editable.
   *  "edit-readonly" disables everything (used when viewer is not owner+not admin). */
  mode: "create" | "edit-owner" | "edit-readonly";
  isAdmin: boolean;
}

export function TemplateForm({ mode, isAdmin }: TemplateFormProps) {
  const { t } = useTranslation("benchmark-templates");
  const { register, control, reset, getValues } = useFormContext();
  const id = useId();
  const nameId = `${id}-name`;
  const descId = `${id}-desc`;
  const tagsId = `${id}-tags`;
  const scenarioId = `${id}-scenario`;
  const officialId = `${id}-official`;

  const scenario = (useWatch({ control, name: "scenario" }) ?? "inference") as ScenarioId;
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
    <div className="space-y-6">
      <section className="rounded-lg border border-border bg-card p-4 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t("create.sections.basic")}
        </h2>
        <div>
          <Label htmlFor={nameId}>{t("create.fields.name")}</Label>
          <Input
            id={nameId}
            {...register("name")}
            placeholder={t("create.fields.namePlaceholder")}
            disabled={disableAll}
          />
        </div>
        <div>
          <Label htmlFor={descId}>{t("create.fields.description")}</Label>
          <Textarea
            id={descId}
            rows={2}
            {...register("description", {
              setValueAs: (v) => (v === "" || v === undefined ? null : v),
            })}
            disabled={disableAll}
          />
        </div>
        <div>
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
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t("create.sections.scenario")}
        </h2>
        <div className="max-w-xs">
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
                {(["inference", "capacity", "gateway"] as ScenarioId[]).map((sid) => (
                  <SelectItem key={sid} value={sid}>
                    {t(`list.tabs.${sid}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </section>

      <ToolParamsEditor scenario={scenario} paramsFieldName="config" />

      {mode === "create" && isAdmin && (
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t("create.sections.official")}
          </h2>
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
        </section>
      )}
    </div>
  );
}
