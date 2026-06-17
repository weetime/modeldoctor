import { useFormContext } from "react-hook-form";
import { useTranslation } from "react-i18next";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";

/**
 * Power-user escape hatch shared by the argv-based tool param forms
 * (aiperf / evalscope / guidellm). Binds a raw-CLI textarea to
 * `${fieldPrefix}.extraArgs`. The server is authoritative on locked-flag
 * rejection (appendExtraArgs); this is a plain passthrough input with a caveat.
 */
export function ExtraArgsField({ fieldPrefix }: { fieldPrefix: "params" | "config" }) {
  const { t } = useTranslation("benchmarks");
  const { control } = useFormContext();
  return (
    <FormField
      control={control}
      name={`${fieldPrefix}.extraArgs`}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{t("forms.extraArgs.label")}</FormLabel>
          <FormControl>
            <Textarea
              rows={2}
              spellCheck={false}
              className="font-mono text-xs"
              placeholder={t("forms.extraArgs.placeholder")}
              {...field}
              value={field.value ?? ""}
            />
          </FormControl>
          <FormDescription>{t("forms.extraArgs.help")}</FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
