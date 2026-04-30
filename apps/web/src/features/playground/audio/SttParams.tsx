import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "react-i18next";
import type { SttSlice } from "./store";

interface SttParamsProps {
  value: SttSlice;
  onChange: (p: Partial<SttSlice>) => void;
}

const COMMON_LANGUAGES = ["", "auto", "zh", "en", "ja", "ko", "es", "fr", "de"];

export function SttParams({ value, onChange }: SttParamsProps) {
  const { t } = useTranslation("playground");
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">{t("audio.stt.params.language")}</Label>
        <Select
          value={value.language === "" ? "auto" : value.language}
          onValueChange={(v) => onChange({ language: v === "auto" ? "" : v })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {COMMON_LANGUAGES.map((l) => (
              <SelectItem key={l || "auto"} value={l || "auto"}>{l || "auto"}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs">{t("audio.stt.params.task")}</Label>
        <Select value={value.task} onValueChange={(v) => onChange({ task: v as SttSlice["task"] })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="transcribe">transcribe</SelectItem>
            <SelectItem value="translate">translate</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs">{t("audio.stt.params.prompt")}</Label>
        <Input value={value.prompt} onChange={(e) => onChange({ prompt: e.target.value })} />
      </div>
      <div>
        <Label className="text-xs">{t("audio.stt.params.temperature")}</Label>
        <Input
          type="number" min={0} max={1} step={0.05}
          value={value.temperature ?? ""} placeholder="0"
          onChange={(e) => {
            const v = e.target.value.trim();
            onChange({ temperature: v === "" ? undefined : Number(v) });
          }}
        />
      </div>
    </div>
  );
}
