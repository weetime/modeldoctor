import { useEffect } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
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
import { numberField } from "./_shared/numberField";

const DATASETS = ["synthetic", "sharegpt", "mooncake-trace"] as const;
// NOTE: AIPerf's CLI takes `--endpoint-type chat|completions` (not a full path);
// the underlying value is therefore "chat" / "completions" while we surface the
// familiar /v1/... path strings as user-facing labels.
const ENDPOINT_TYPES = [
  { value: "chat", label: "/v1/chat/completions" },
  { value: "completions", label: "/v1/completions" },
] as const;

const CONVERSATION_TYPES = ["pooled", "sticky-user-sessions"] as const;
const MOONCAKE_TRACES = ["conversation", "toolagent"] as const;

interface AiperfParamsFormProps {
  fieldPrefix?: "params" | "config";
}

export function AiperfParamsForm({ fieldPrefix = "params" }: AiperfParamsFormProps = {}) {
  const { control, setValue } = useFormContext();
  const { t } = useTranslation("benchmarks");

  const dataset = useWatch({ control, name: `${fieldPrefix}.dataset` });
  const isMooncake = dataset === "mooncake-trace";

  // Clear the now-irrelevant branch's fields when dataset changes, so stale
  // values never trigger the superRefine rejection for the opposing branch.
  useEffect(() => {
    if (isMooncake) {
      // switched TO mooncake-trace: clear closed-loop conversation fields
      setValue(`${fieldPrefix}.conversationNum`, undefined);
      setValue(`${fieldPrefix}.conversationTurnMean`, undefined);
      setValue(`${fieldPrefix}.conversationType`, undefined);
    } else {
      // switched AWAY from mooncake-trace: clear mooncake-only fields
      setValue(`${fieldPrefix}.mooncakeTrace`, undefined);
    }
  }, [isMooncake, fieldPrefix, setValue]);

  return (
    <FormSection title={t("forms.aiperf.section")}>
      <div className="space-y-4">
        {/* Row 1: concurrency · requestCount · dataset */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <FormField
            control={control}
            name={`${fieldPrefix}.concurrency`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("forms.aiperf.concurrency")}</FormLabel>
                <FormControl>
                  <Input type="number" {...numberField(field)} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name={`${fieldPrefix}.requestCount`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("forms.aiperf.requestCount")}</FormLabel>
                <FormControl>
                  <Input type="number" {...numberField(field)} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name={`${fieldPrefix}.dataset`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("forms.aiperf.dataset")}</FormLabel>
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
        </div>

        {/* Row 2a: inputTokensMean · inputTokensStddev */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField
            control={control}
            name={`${fieldPrefix}.inputTokensMean`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("forms.aiperf.inputTokensMean")}</FormLabel>
                <FormControl>
                  <Input type="number" {...numberField(field)} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name={`${fieldPrefix}.inputTokensStddev`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("forms.aiperf.inputTokensStddev")}</FormLabel>
                <FormControl>
                  <Input type="number" {...numberField(field)} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Row 2b: outputTokensMean · outputTokensStddev */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField
            control={control}
            name={`${fieldPrefix}.outputTokensMean`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("forms.aiperf.outputTokensMean")}</FormLabel>
                <FormControl>
                  <Input type="number" {...numberField(field)} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name={`${fieldPrefix}.outputTokensStddev`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("forms.aiperf.outputTokensStddev")}</FormLabel>
                <FormControl>
                  <Input type="number" {...numberField(field)} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Row 3: endpointType · streaming · seed */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <FormField
            control={control}
            name={`${fieldPrefix}.endpointType`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("forms.aiperf.endpointType")}</FormLabel>
                <Select onValueChange={field.onChange} value={field.value ?? ""}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {ENDPOINT_TYPES.map((e) => (
                      <SelectItem key={e.value} value={e.value}>
                        {e.label}
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
            name={`${fieldPrefix}.streaming`}
            render={({ field }) => (
              <FormItem className="flex flex-row items-center justify-between rounded-md border px-3 py-2">
                <FormLabel className="mb-0">{t("forms.aiperf.streaming")}</FormLabel>
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
                <FormLabel>{t("forms.aiperf.seed")}</FormLabel>
                <FormControl>
                  <Input type="number" {...numberField(field)} />
                </FormControl>
                <FormDescription>{t("forms.aiperf.seedHint")}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Conditional: multi-turn fields (synthetic / sharegpt only) */}
        {!isMooncake && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <FormField
              control={control}
              name={`${fieldPrefix}.conversationNum`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("forms.aiperf.conversationNum")}</FormLabel>
                  <FormControl>
                    <Input type="number" {...numberField(field)} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={control}
              name={`${fieldPrefix}.conversationTurnMean`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("forms.aiperf.conversationTurnMean")}</FormLabel>
                  <FormControl>
                    <Input type="number" {...numberField(field)} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={control}
              name={`${fieldPrefix}.conversationType`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("forms.aiperf.conversationType")}</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? ""}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {CONVERSATION_TYPES.map((ct) => (
                        <SelectItem key={ct} value={ct}>
                          {ct}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        )}

        {/* Conditional: mooncake fields (mooncake-trace only) */}
        {isMooncake && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField
              control={control}
              name={`${fieldPrefix}.mooncakeTrace`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("forms.aiperf.mooncakeTrace")}</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? ""}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {MOONCAKE_TRACES.map((mt) => (
                        <SelectItem key={mt} value={mt}>
                          {mt}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        )}
      </div>
    </FormSection>
  );
}
