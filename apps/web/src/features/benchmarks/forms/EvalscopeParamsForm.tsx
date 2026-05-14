import { FormSection } from "@/components/common/form-section";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useFormContext } from "react-hook-form";
import { useTranslation } from "react-i18next";

const DATASETS = ["longalpaca", "openqa", "random"] as const;
const API_PATHS = ["/v1/chat/completions", "/v1/completions"] as const;

interface EvalscopeParamsFormProps {
  fieldPrefix?: "params" | "config";
}

export function EvalscopeParamsForm({ fieldPrefix = "params" }: EvalscopeParamsFormProps = {}) {
  const { control } = useFormContext();
  const { t } = useTranslation("benchmarks");

  return (
    <FormSection title={t("forms.evalscope.section")}>
      <div className="space-y-4">
        {/* Row 1: dataset · parallel · number */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <FormField
            control={control}
            name={`${fieldPrefix}.dataset`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("forms.evalscope.dataset")}</FormLabel>
                <Select onValueChange={field.onChange} value={field.value ?? ""}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {DATASETS.map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name={`${fieldPrefix}.parallel`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("forms.evalscope.parallel")}</FormLabel>
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
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name={`${fieldPrefix}.number`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("forms.evalscope.number")}</FormLabel>
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
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Row 2a: minPromptLength · maxPromptLength */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField
            control={control}
            name={`${fieldPrefix}.minPromptLength`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("forms.evalscope.minPromptLength")}</FormLabel>
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
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name={`${fieldPrefix}.maxPromptLength`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("forms.evalscope.maxPromptLength")}</FormLabel>
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
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Row 2b: minTokens · maxTokens */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField
            control={control}
            name={`${fieldPrefix}.minTokens`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("forms.evalscope.minTokens")}</FormLabel>
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
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name={`${fieldPrefix}.maxTokens`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("forms.evalscope.maxTokens")}</FormLabel>
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
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Row 3: apiPath · stream · seed */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <FormField
            control={control}
            name={`${fieldPrefix}.apiPath`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("forms.evalscope.apiPath")}</FormLabel>
                <Select onValueChange={field.onChange} value={field.value ?? ""}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {API_PATHS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name={`${fieldPrefix}.stream`}
            render={({ field }) => (
              <FormItem className="flex flex-row items-center justify-between rounded-md border px-3 py-2">
                <FormLabel className="mb-0">{t("forms.evalscope.stream")}</FormLabel>
                <FormControl>
                  <Switch checked={field.value === true} onCheckedChange={field.onChange} />
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name={`${fieldPrefix}.seed`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("forms.evalscope.seed")}</FormLabel>
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
                <FormDescription>{t("forms.evalscope.seedHint")}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </div>
    </FormSection>
  );
}
