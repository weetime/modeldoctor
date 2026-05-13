import { Button } from "@/components/ui/button";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { useFormContext } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { JudgeConfigEditor } from "./JudgeConfigEditor";

interface Props {
  /** Dot path inside the parent form (e.g. `samples.0`). */
  namePrefix: string;
  index: number;
  onRemove: () => void;
}

export function EvaluationSampleEditor({ namePrefix, index, onRemove }: Props) {
  const { t } = useTranslation("quality-gate");
  const { control } = useFormContext();

  return (
    <div className="rounded-md border p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {t("samples.indexPrefix")}
          {index + 1}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-destructive"
          onClick={onRemove}
        >
          {t("samples.remove")}
        </Button>
      </div>

      <FormField
        control={control}
        name={`${namePrefix}.prompt`}
        render={({ field }) => (
          <FormItem>
            <FormLabel required>{t("samples.promptLabel")}</FormLabel>
            <FormControl>
              <Textarea {...field} rows={2} value={field.value ?? ""} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={control}
        name={`${namePrefix}.expected`}
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("samples.expectedLabel")}</FormLabel>
            <FormControl>
              <Textarea {...field} rows={2} value={field.value ?? ""} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <JudgeConfigEditor namePrefix={`${namePrefix}.judgeConfig`} />
    </div>
  );
}
