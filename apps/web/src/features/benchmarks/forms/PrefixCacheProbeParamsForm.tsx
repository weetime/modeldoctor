import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useConnections } from "@/features/connections/queries";
import { AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useFormContext, useWatch } from "react-hook-form";

interface PrefixCacheProbeParamsFormProps {
  fieldPrefix?: "params" | "config";
}

export function PrefixCacheProbeParamsForm({ fieldPrefix = "params" }: PrefixCacheProbeParamsFormProps = {}) {
  const { control } = useFormContext();
  const { t } = useTranslation("benchmarks");
  const connectionId = useWatch({ control, name: "connectionId" }) as string | undefined;
  const connections = useConnections();
  const connection = connectionId ? connections.data?.find((c) => c.id === connectionId) : undefined;

  if (connection && !connection.prometheusUrl) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{t("forms.prefixCacheProbe.missingPromUrl")}</AlertDescription>
      </Alert>
    );
  }

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

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {numberField(
          "promptSets",
          "forms.prefixCacheProbe.promptSets",
          "forms.prefixCacheProbe.promptSetsHelp",
        )}
        {numberField("requestsPerSet", "forms.prefixCacheProbe.requestsPerSet")}
        {numberField("maxTokens", "forms.prefixCacheProbe.maxTokens")}
        {numberField(
          "promBackoffSec",
          "forms.prefixCacheProbe.promBackoffSec",
          "forms.prefixCacheProbe.promBackoffSecHelp",
        )}
      </div>
    </div>
  );
}
