import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import type { ChatParams as ChatParamsType } from "@modeldoctor/contracts";
import { useTranslation } from "react-i18next";

interface ChatParamsProps {
  value: ChatParamsType;
  onChange: (patch: Partial<ChatParamsType>) => void;
}

function NumField({
  label,
  value,
  onChange,
  step = 0.1,
  min,
  max,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type="number"
        step={step}
        min={min}
        max={max}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        className="h-8 text-xs"
      />
    </div>
  );
}

function SliderField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  defaultDisplayValue,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  min: number;
  max: number;
  step: number;
  defaultDisplayValue: number;
}) {
  const sliderValue = value ?? defaultDisplayValue;
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <Input
          type="number"
          step={step}
          min={min}
          max={max}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
          className="h-7 w-20 text-xs"
        />
      </div>
      <Slider
        value={[sliderValue]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0])}
        className="mt-2"
        aria-label={label}
      />
    </div>
  );
}

export function ChatParams({ value, onChange }: ChatParamsProps) {
  const { t } = useTranslation("playground");
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">{t("chat.params.title")}</h3>
      <SliderField
        label={t("chat.params.temperature")}
        value={value.temperature}
        onChange={(v) => onChange({ temperature: v })}
        min={0}
        max={2}
        step={0.1}
        defaultDisplayValue={1}
      />
      <SliderField
        label={t("chat.params.maxTokens")}
        value={value.maxTokens}
        onChange={(v) => onChange({ maxTokens: v })}
        min={1}
        max={8192}
        step={1}
        defaultDisplayValue={1024}
      />
      <SliderField
        label={t("chat.params.topP")}
        value={value.topP}
        onChange={(v) => onChange({ topP: v })}
        min={0}
        max={1}
        step={0.05}
        defaultDisplayValue={1}
      />
      <SliderField
        label={t("chat.params.frequencyPenalty")}
        value={value.frequencyPenalty}
        onChange={(v) => onChange({ frequencyPenalty: v })}
        min={-2}
        max={2}
        step={0.1}
        defaultDisplayValue={0}
      />
      <SliderField
        label={t("chat.params.presencePenalty")}
        value={value.presencePenalty}
        onChange={(v) => onChange({ presencePenalty: v })}
        min={-2}
        max={2}
        step={0.1}
        defaultDisplayValue={0}
      />
      <NumField
        label={t("chat.params.seed")}
        value={value.seed}
        onChange={(v) => onChange({ seed: v })}
        step={1}
      />
      <div>
        <Label className="text-xs text-muted-foreground">{t("chat.params.stop")}</Label>
        <Input
          value={value.stop?.join(",") ?? ""}
          onChange={(e) => {
            const parts = e.target.value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            onChange({ stop: parts.length > 0 ? parts : undefined });
          }}
          placeholder="stop1, stop2"
          className="h-8 text-xs"
        />
      </div>
      <p className="text-[10px] italic text-muted-foreground">{t("chat.params.stream")}</p>
    </div>
  );
}
