import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

export function ChatParams({ value, onChange }: ChatParamsProps) {
  const { t } = useTranslation("playground");
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">{t("chat.params.title")}</h3>
      <NumField
        label={t("chat.params.temperature")}
        value={value.temperature}
        onChange={(v) => onChange({ temperature: v })}
        step={0.1}
        min={0}
        max={2}
      />
      <NumField
        label={t("chat.params.maxTokens")}
        value={value.maxTokens}
        onChange={(v) => onChange({ maxTokens: v })}
        step={1}
        min={1}
      />
      <NumField
        label={t("chat.params.topP")}
        value={value.topP}
        onChange={(v) => onChange({ topP: v })}
        step={0.05}
        min={0}
        max={1}
      />
      <NumField
        label={t("chat.params.frequencyPenalty")}
        value={value.frequencyPenalty}
        onChange={(v) => onChange({ frequencyPenalty: v })}
        step={0.1}
        min={-2}
        max={2}
      />
      <NumField
        label={t("chat.params.presencePenalty")}
        value={value.presencePenalty}
        onChange={(v) => onChange({ presencePenalty: v })}
        step={0.1}
        min={-2}
        max={2}
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
