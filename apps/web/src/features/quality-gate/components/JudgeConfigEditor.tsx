import type { JudgeConfig } from "@modeldoctor/contracts";
import { useFormContext, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

interface JudgeConfigEditorProps {
  /** Dot path inside the parent form (e.g. `samples.0.judgeConfig`). */
  namePrefix: string;
}

// Defaults applied when the user switches the judge kind. We seed each
// branch with the minimum content needed to pass its zod schema so the
// form is not immediately invalid the moment kind changes; the user can
// still edit any field after the switch.
const KIND_DEFAULTS: Record<JudgeConfig["kind"], JudgeConfig> = {
  "exact-match": { kind: "exact-match" },
  contains: { kind: "contains", substrings: [], mode: "all" },
  regex: { kind: "regex", pattern: "" },
  "llm-judge": { kind: "llm-judge", rubric: "", scale: "0-5" },
};

export function JudgeConfigEditor({ namePrefix }: JudgeConfigEditorProps) {
  const { t } = useTranslation("quality-gate");
  const { control, setValue } = useFormContext();
  const kind = useWatch({ control, name: `${namePrefix}.kind` }) as JudgeConfig["kind"];

  return (
    <div className="space-y-3">
      <FormField
        control={control}
        name={`${namePrefix}.kind`}
        render={() => (
          <FormItem>
            <FormLabel required>{t("judges.kindLabel")}</FormLabel>
            <FormControl>
              <Select
                value={kind}
                onValueChange={(k) =>
                  setValue(namePrefix, KIND_DEFAULTS[k as JudgeConfig["kind"]], {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="exact-match">{t("judges.exact-match")}</SelectItem>
                  <SelectItem value="contains">{t("judges.contains")}</SelectItem>
                  <SelectItem value="regex">{t("judges.regex")}</SelectItem>
                  <SelectItem value="llm-judge">{t("judges.llm-judge")}</SelectItem>
                </SelectContent>
              </Select>
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {kind === "exact-match" && (
        <FormField
          control={control}
          name={`${namePrefix}.caseSensitive`}
          render={({ field }) => (
            <FormItem className="flex items-center gap-3 space-y-0">
              <FormControl>
                <Switch checked={field.value === true} onCheckedChange={field.onChange} />
              </FormControl>
              <FormLabel>{t("judges.caseSensitive")}</FormLabel>
            </FormItem>
          )}
        />
      )}

      {kind === "contains" && (
        <>
          <FormField
            control={control}
            name={`${namePrefix}.substrings`}
            render={({ field }) => (
              <FormItem>
                <FormLabel required>{t("judges.substringsLabel")}</FormLabel>
                <FormControl>
                  <Input
                    value={(field.value as string[] | undefined)?.join(", ") ?? ""}
                    onChange={(e) =>
                      field.onChange(
                        e.target.value
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      )
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name={`${namePrefix}.mode`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("judges.modeLabel")}</FormLabel>
                <FormControl>
                  <Select value={field.value ?? "all"} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("judges.modeAll")}</SelectItem>
                      <SelectItem value="any">{t("judges.modeAny")}</SelectItem>
                    </SelectContent>
                  </Select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </>
      )}

      {kind === "regex" && (
        <>
          <FormField
            control={control}
            name={`${namePrefix}.pattern`}
            render={({ field }) => (
              <FormItem>
                <FormLabel required>{t("judges.patternLabel")}</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value ?? ""} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name={`${namePrefix}.flags`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("judges.flagsLabel")}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    value={field.value ?? ""}
                    onChange={(e) => field.onChange(e.target.value || undefined)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </>
      )}

      {kind === "llm-judge" && (
        <>
          <FormField
            control={control}
            name={`${namePrefix}.rubric`}
            render={({ field }) => (
              <FormItem>
                <FormLabel required>{t("judges.rubricLabel")}</FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    rows={4}
                    value={field.value ?? ""}
                    placeholder={t("judges.rubricPlaceholder")}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name={`${namePrefix}.scale`}
            render={({ field }) => (
              <FormItem>
                <FormLabel required>{t("judges.scaleLabel")}</FormLabel>
                <FormControl>
                  <Select value={field.value ?? "0-5"} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0-1">0–1</SelectItem>
                      <SelectItem value="0-5">0–5</SelectItem>
                      <SelectItem value="pass-fail">pass/fail</SelectItem>
                    </SelectContent>
                  </Select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name={`${namePrefix}.passThreshold`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("judges.thresholdLabel")}</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="0.1"
                    value={field.value ?? ""}
                    onChange={(e) =>
                      field.onChange(e.target.value === "" ? undefined : Number(e.target.value))
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </>
      )}
    </div>
  );
}
