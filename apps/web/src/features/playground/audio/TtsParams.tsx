import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
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
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FORMATS.map((f) => (
              <SelectItem key={f} value={f}>
                {f}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs">{t("audio.tts.params.speed")}</Label>
        <Input
          type="number"
          min={0.25}
          max={4.0}
          step={0.05}
          value={value.speed ?? ""}
          placeholder="1.0"
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
            <input
              type="file"
              accept="audio/wav,audio/mp3,audio/mpeg,audio/webm,audio/ogg,audio/flac"
              className="mt-1 block w-full text-xs"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (f.size > 15 * 1024 * 1024) {
                  toast.error(t("audio.tts.params.referenceAudioTooLarge"));
                  e.target.value = "";
                  return;
                }
                const r = new FileReader();
                r.onload = () => {
                  onChange({
                    referenceAudioBase64: r.result as string,
                    referenceAudioFilename: f.name,
                  });
                };
                r.readAsDataURL(f);
              }}
            />
            {value.referenceAudioFilename && (
              <p className="mt-1 text-xs text-muted-foreground">
                {value.referenceAudioFilename}
                <button
                  type="button"
                  className="ml-2 text-destructive underline"
                  onClick={() =>
                    onChange({ referenceAudioBase64: undefined, referenceAudioFilename: undefined })
                  }
                >
                  {t("audio.tts.params.removeReferenceAudio")}
                </button>
              </p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              {t("audio.tts.params.referenceAudioHint")}
            </p>
          </div>
          <div>
            <Label className="text-xs">{t("audio.tts.params.referenceText")}</Label>
            <Textarea
              value={value.referenceText ?? ""}
              onChange={(e) => onChange({ referenceText: e.target.value })}
              rows={2}
              placeholder={t("audio.tts.params.referenceTextPlaceholder")}
              className="mt-1"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {t("audio.tts.params.referenceTextHint")}
            </p>
          </div>
        </div>
      </details>
    </div>
  );
}
