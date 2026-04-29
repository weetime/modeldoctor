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
import type { RerankParams } from "./store";

interface Props {
  value: RerankParams;
  onChange: (p: Partial<RerankParams>) => void;
}

export function RerankParamsPanel({ value, onChange }: Props) {
  const { t } = useTranslation("playground");
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">{t("rerank.params.title")}</h3>
      <div>
        <Label className="text-xs text-muted-foreground">{t("rerank.params.wire")}</Label>
        <Select value={value.wire} onValueChange={(v) => onChange({ wire: v as "cohere" | "tei" })}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cohere">cohere</SelectItem>
            <SelectItem value="tei">tei</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs text-muted-foreground">{t("rerank.params.topN")}</Label>
        <Input
          type="number"
          min={1}
          step={1}
          value={value.topN}
          onChange={(e) => onChange({ topN: Math.max(1, Number(e.target.value) || 1) })}
          className="h-8 text-xs"
        />
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={value.returnDocuments}
          onChange={(e) => onChange({ returnDocuments: e.target.checked })}
        />
        {t("rerank.params.returnDocuments")}
      </label>
    </div>
  );
}
