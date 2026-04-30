import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "react-i18next";
import type { TtsFormat, TtsSlice } from "./store";

interface TtsParamsProps {
  value: TtsSlice;
  onChange: (p: Partial<TtsSlice>) => void;
}

const FORMATS: TtsFormat[] = ["mp3", "wav", "flac", "opus", "aac", "pcm"];

export function TtsParams({ value, onChange }: TtsParamsProps) {
  const { t } = useTranslation("playground");
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">{t("audio.tts.params.voice")}</Label>
        <Input value={value.voice} onChange={(e) => onChange({ voice: e.target.value })} />
      </div>
      <div>
        <Label className="text-xs">{t("audio.tts.params.format")}</Label>
        <Select value={value.format} onValueChange={(v) => onChange({ format: v as TtsFormat })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {FORMATS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs">{t("audio.tts.params.speed")}</Label>
        <Input
          type="number" min={0.25} max={4.0} step={0.05}
          value={value.speed ?? ""} placeholder="1.0"
          onChange={(e) => {
            const v = e.target.value.trim();
            onChange({ speed: v === "" ? undefined : Number(v) });
          }}
        />
      </div>
      <details>
        <summary className="cursor-pointer text-xs text-muted-foreground">
          {t("audio.tts.params.advanced")}
        </summary>
        <div className="mt-2 space-y-2 text-xs text-muted-foreground">
          <div>
            <Label className="text-xs">{t("audio.tts.params.referenceAudio")}</Label>
            <Input disabled placeholder={t("audio.tts.advancedV2Note")} />
          </div>
          <div>
            <Label className="text-xs">{t("audio.tts.params.referenceText")}</Label>
            <Input disabled placeholder={t("audio.tts.advancedV2Note")} />
          </div>
        </div>
      </details>
    </div>
  );
}
