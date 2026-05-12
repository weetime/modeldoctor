import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useFormContext } from "react-hook-form";
import { useTranslation } from "react-i18next";

interface KvCacheStressParamsFormProps {
  fieldPrefix?: "params" | "config";
}

export function KvCacheStressParamsForm({
  fieldPrefix = "params",
}: KvCacheStressParamsFormProps = {}) {
  const { control } = useFormContext();
  const { t } = useTranslation("benchmarks");

  const numberField = (name: string, labelKey: string, helpKey?: string) => (
    <FormField
      control={control}
      name={`${fieldPrefix}.${name}`}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{t(labelKey)}</FormLabel>
          <FormControl>
            <Input
              type="number"
              {...field}
              value={field.value ?? ""}
              onChange={(e) =>
                field.onChange(e.target.value === "" ? undefined : Number(e.target.value))
              }
            />
          </FormControl>
          {helpKey && <FormDescription>{t(helpKey)}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );

  const stringField = (name: string, labelKey: string, helpKey?: string) => (
    <FormField
      control={control}
      name={`${fieldPrefix}.${name}`}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{t(labelKey)}</FormLabel>
          <FormControl>
            <Input {...field} value={field.value ?? ""} />
          </FormControl>
          {helpKey && <FormDescription>{t(helpKey)}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {numberField(
          "numSessions",
          "forms.kvCacheStress.numSessions",
          "forms.kvCacheStress.numSessionsHelp",
        )}
        {numberField("turns", "forms.kvCacheStress.turns", "forms.kvCacheStress.turnsHelp")}
        {numberField("concurrency", "forms.kvCacheStress.concurrency")}
        {numberField("maxTokens", "forms.kvCacheStress.maxTokens")}
        {numberField(
          "durationSec",
          "forms.kvCacheStress.durationSec",
          "forms.kvCacheStress.durationSecHelp",
        )}
        {stringField(
          "systemPromptSeed",
          "forms.kvCacheStress.systemPromptSeed",
          "forms.kvCacheStress.systemPromptSeedHelp",
        )}
      </div>
    </div>
  );
}
