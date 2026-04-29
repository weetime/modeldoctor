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
import type { EmbeddingsParams } from "./store";

interface Props {
  value: EmbeddingsParams;
  onChange: (p: Partial<EmbeddingsParams>) => void;
}

export function EmbeddingsParamsPanel({ value, onChange }: Props) {
  const { t } = useTranslation("playground");
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">{t("embeddings.params.title")}</h3>
      <div>
        <Label className="text-xs text-muted-foreground">
          {t("embeddings.params.encodingFormat")}
        </Label>
        <Select
          value={value.encodingFormat ?? "float"}
          onValueChange={(v) => onChange({ encodingFormat: v as "float" | "base64" })}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="float">float</SelectItem>
            <SelectItem value="base64">base64</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs text-muted-foreground">{t("embeddings.params.dimensions")}</Label>
        <Input
          type="number"
          min={1}
          step={1}
          value={value.dimensions ?? ""}
          onChange={(e) =>
            onChange({ dimensions: e.target.value === "" ? undefined : Number(e.target.value) })
          }
          className="h-8 text-xs"
        />
      </div>
    </div>
  );
}
