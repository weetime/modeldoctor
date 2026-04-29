import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "react-i18next";
import type { ImageParams } from "./store";

interface Props {
  value: ImageParams;
  onChange: (p: Partial<ImageParams>) => void;
}

const SIZES = ["256x256", "512x512", "1024x1024"];

export function ImageParamsPanel({ value, onChange }: Props) {
  const { t } = useTranslation("playground");
  const isCustom = !SIZES.includes(value.size);
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">{t("image.params.title")}</h3>
      <div>
        <Label className="text-xs text-muted-foreground">{t("image.params.size")}</Label>
        <Select
          value={isCustom ? "custom" : value.size}
          onValueChange={(v) => onChange({ size: v === "custom" ? "768x768" : v })}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SIZES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
            <SelectItem value="custom">{t("image.params.sizeCustom")}</SelectItem>
          </SelectContent>
        </Select>
        {isCustom ? (
          <Input
            value={value.size}
            onChange={(e) => onChange({ size: e.target.value })}
            placeholder="768x768"
            className="mt-2 h-8 text-xs"
          />
        ) : null}
      </div>
      <div>
        <Label className="text-xs text-muted-foreground">{t("image.params.n")}</Label>
        <Input
          type="number"
          min={1}
          max={10}
          step={1}
          value={value.n}
          onChange={(e) => onChange({ n: Math.max(1, Number(e.target.value) || 1) })}
          className="h-8 text-xs"
        />
      </div>
      <div>
        <Label className="text-xs text-muted-foreground">{t("image.params.seed")}</Label>
        <Input
          type="number"
          step={1}
          value={value.seed ?? ""}
          onChange={(e) =>
            onChange({ seed: e.target.value === "" ? undefined : Number(e.target.value) })
          }
          className="h-8 text-xs"
          placeholder={value.randomSeedEachRequest ? t("image.params.seedRandom") : ""}
        />
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={value.randomSeedEachRequest}
          onChange={(e) => onChange({ randomSeedEachRequest: e.target.checked })}
        />
        {t("image.params.randomSeed")}
      </label>
    </div>
  );
}
