import type { ComponentPropsWithoutRef } from "react";
import { forwardRef, useEffect, useRef, useState } from "react";
import type { ControllerRenderProps, FieldValues } from "react-hook-form";
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

/**
 * Fully-controlled `value={levels.join(",")}` + parse-on-change made
 * hand-typing impossible: parseLevels drops the trailing comma so a
 * controlled re-render collapses "1," back to "1" before the next digit
 * lands, merging "1,8" into "18". Instead we keep the raw text as local
 * state while the input is focused and only parse-and-commit to RHF on
 * blur, resyncing the local text from the external field value (template
 * prefill, tool switch, form reset) whenever the input isn't focused.
 */
interface ConcurrencyLevelsInputProps
  extends Omit<
    ComponentPropsWithoutRef<typeof Input>,
    "value" | "onChange" | "onFocus" | "onBlur"
  > {
  field: ControllerRenderProps<FieldValues, string>;
}

// forwardRef + rest-prop passthrough so FormControl's Radix Slot can still
// inject id / aria-describedby / aria-invalid / ref onto the underlying
// <input>, exactly as it did when this was a plain <Input> child.
const ConcurrencyLevelsInput = forwardRef<HTMLInputElement, ConcurrencyLevelsInputProps>(
  ({ field, ...rest }, forwardedRef) => {
    const committed = ((field.value as number[] | undefined) ?? []).join(",");
    const [text, setText] = useState(committed);
    const isFocused = useRef(false);

    useEffect(() => {
      if (!isFocused.current) {
        setText(committed);
      }
    }, [committed]);

    return (
      <Input
        {...rest}
        name={field.name}
        ref={(node) => {
          field.ref(node);
          if (typeof forwardedRef === "function") {
            forwardedRef(node);
          } else if (forwardedRef) {
            forwardedRef.current = node;
          }
        }}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => {
          isFocused.current = true;
        }}
        onBlur={() => {
          isFocused.current = false;
          const parsed = parseLevels(text);
          field.onChange(parsed);
          setText(parsed.join(","));
          field.onBlur();
        }}
        placeholder="1,8,16,32"
      />
    );
  },
);
ConcurrencyLevelsInput.displayName = "ConcurrencyLevelsInput";

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
                <ConcurrencyLevelsInput field={field} />
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
