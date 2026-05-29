import { useFormContext } from "react-hook-form";
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

interface Props {
  /** Dot path of the GenConfig object in the parent form (e.g. `genConfig`). */
  namePrefix: string;
}

/**
 * Per-run generation parameters. `thinking` is the key control for reasoning
 * models: "off" disables vLLM thinking so they answer short-form directly
 * instead of burning the token budget mid-<think>.
 */
export function GenConfigForm({ namePrefix }: Props) {
  const { t } = useTranslation("quality-gate");
  const { control } = useFormContext();
  return (
    <div className="space-y-3 max-w-md">
      <FormField
        control={control}
        name={`${namePrefix}.thinking`}
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("gen.thinkingLabel")}</FormLabel>
            <FormControl>
              <Select value={field.value ?? "auto"} onValueChange={field.onChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">{t("gen.thinkingAuto")}</SelectItem>
                  <SelectItem value="off">{t("gen.thinkingOff")}</SelectItem>
                  <SelectItem value="on">{t("gen.thinkingOn")}</SelectItem>
                </SelectContent>
              </Select>
            </FormControl>
            <p className="text-xs text-muted-foreground">{t("gen.thinkingHint")}</p>
            <FormMessage />
          </FormItem>
        )}
      />
      <div className="grid grid-cols-2 gap-4">
        <FormField
          control={control}
          name={`${namePrefix}.maxTokens`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("gen.maxTokensLabel")}</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min={1}
                  max={32768}
                  step={256}
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
        <FormField
          control={control}
          name={`${namePrefix}.temperature`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("gen.temperatureLabel")}</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min={0}
                  max={2}
                  step={0.1}
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
      </div>
    </div>
  );
}
