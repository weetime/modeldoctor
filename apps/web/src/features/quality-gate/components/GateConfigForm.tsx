import type { GateConfig } from "@modeldoctor/contracts";
import { useFormContext, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

interface Props {
  /** Dot path of the GateConfig object in the parent form (e.g. `gateConfig`). */
  namePrefix: string;
  dual: boolean;
  /** When set and !dual, the regressionMax row is rendered but disabled with this hint. */
  maxRegressionsDisabledHint?: string;
}

type Key = keyof GateConfig;

const DEFAULTS: Record<Key, number> = {
  passRateMin: 0.9,
  regressionMax: 3,
  judgeScoreMin: 4,
};

const STEP: Record<Key, { min: number; max?: number; step: number }> = {
  passRateMin: { min: 0, max: 1, step: 0.05 },
  regressionMax: { min: 0, step: 1 },
  judgeScoreMin: { min: 0, max: 5, step: 0.5 },
};

function Row({
  namePrefix,
  fieldKey,
  label,
  disabled,
  disabledHint,
}: {
  namePrefix: string;
  fieldKey: Key;
  label: string;
  disabled?: boolean;
  disabledHint?: string;
}) {
  const { control, setValue } = useFormContext();
  const value = useWatch({ control, name: `${namePrefix}.${fieldKey}` }) as number | undefined;
  const enabled = value != null;
  const { min, max, step } = STEP[fieldKey];

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3">
        <Switch
          checked={enabled}
          disabled={disabled}
          onCheckedChange={(b) =>
            setValue(`${namePrefix}.${fieldKey}`, b ? DEFAULTS[fieldKey] : undefined, {
              shouldDirty: true,
              shouldValidate: true,
            })
          }
        />
        <FormField
          control={control}
          name={`${namePrefix}.${fieldKey}`}
          render={({ field }) => (
            <FormItem className="flex flex-1 items-center gap-3 space-y-0">
              <FormLabel className="flex-1">{label}</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min={min}
                  max={max}
                  step={step}
                  className="w-24"
                  disabled={!enabled || disabled}
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
      {disabled && disabledHint && (
        <div className="text-xs text-muted-foreground ml-12">{disabledHint}</div>
      )}
    </div>
  );
}

export function GateConfigForm({ namePrefix, dual, maxRegressionsDisabledHint }: Props) {
  const { t } = useTranslation("quality-gate");
  return (
    <div className="space-y-3 max-w-md">
      <Row namePrefix={namePrefix} fieldKey="passRateMin" label={t("gate.passRateMin")} />
      <Row
        namePrefix={namePrefix}
        fieldKey="regressionMax"
        label={t("gate.regressionMax")}
        disabled={!dual}
        disabledHint={!dual ? maxRegressionsDisabledHint : undefined}
      />
      <Row namePrefix={namePrefix} fieldKey="judgeScoreMin" label={t("gate.judgeScoreMin")} />
    </div>
  );
}
