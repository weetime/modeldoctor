import { useFormContext } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { FormSection } from "@/components/common/form-section";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { numberField } from "./_shared/numberField";

/** Comma-separated concurrency levels ↔ number[]. Invalid segments are
 * dropped; zod's array constraints (length, dupes) validate the rest. */
function parseLevels(text: string): number[] {
  return text
    .split(",")
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

interface VllmOmniBenchParamsFormProps {
  fieldPrefix?: "params" | "config";
}

export function VllmOmniBenchParamsForm({
  fieldPrefix = "params",
}: VllmOmniBenchParamsFormProps = {}) {
  const { t } = useTranslation("benchmarks");
  const { control } = useFormContext();

  return (
    <FormSection title={t("forms.omni.section")}>
      <div className="grid gap-4 md:grid-cols-2">
        <FormField
          control={control}
          name={`${fieldPrefix}.concurrencyLevels`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("forms.omni.concurrencyLevels")}</FormLabel>
              <FormControl>
                <Input
                  value={((field.value as number[] | undefined) ?? []).join(",")}
                  onChange={(e) => field.onChange(parseLevels(e.target.value))}
                  placeholder="1,8,16,32"
                />
              </FormControl>
              <p className="text-xs text-muted-foreground">
                {t("forms.omni.concurrencyLevelsHint")}
              </p>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name={`${fieldPrefix}.inputTokens`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("forms.omni.inputTokens")}</FormLabel>
              <FormControl>
                <Input type="number" {...numberField(field)} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name={`${fieldPrefix}.outputTokens`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("forms.omni.outputTokens")}</FormLabel>
              <FormControl>
                <Input type="number" {...numberField(field)} />
              </FormControl>
              <p className="text-xs text-muted-foreground">{t("forms.omni.outputTokensHint")}</p>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name={`${fieldPrefix}.perPointTimeoutSeconds`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("forms.omni.perPointTimeout")}</FormLabel>
              <FormControl>
                <Input type="number" {...numberField(field)} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name={`${fieldPrefix}.voiceTax`}
          render={({ field }) => (
            <FormItem className="flex flex-row items-center justify-between rounded-md border px-3 py-2 md:col-span-2">
              <div className="space-y-0.5">
                <FormLabel className="mb-0">{t("forms.omni.voiceTax")}</FormLabel>
                <p className="text-xs text-muted-foreground">{t("forms.omni.voiceTaxHint")}</p>
              </div>
              <FormControl>
                <Switch checked={field.value === true} onCheckedChange={field.onChange} />
              </FormControl>
            </FormItem>
          )}
        />
      </div>
    </FormSection>
  );
}
