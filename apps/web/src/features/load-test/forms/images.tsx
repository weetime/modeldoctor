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
import { useLoadTestStore } from "../store";

export function ImagesForm() {
  const { t } = useTranslation("load-test");
  const v = useLoadTestStore((s) => s.images);
  const patch = useLoadTestStore((s) => s.patch);
  const set = (next: Partial<typeof v>) => patch("images", { ...v, ...next });
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="col-span-2">
        <Label>{t("fields.imagePrompt")}</Label>
        <Textarea
          rows={4}
          value={v.imagePrompt}
          onChange={(e) => set({ imagePrompt: e.target.value })}
        />
      </div>
      <div>
        <Label>{t("fields.imageSize")}</Label>
        <Select value={v.imageSize} onValueChange={(val) => set({ imageSize: val })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">{t("fields.default")}</SelectItem>
            <SelectItem value="256x256">256x256</SelectItem>
            <SelectItem value="512x512">512x512</SelectItem>
            <SelectItem value="1024x1024">1024x1024</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>{t("fields.imageN")}</Label>
        <Input
          type="number"
          min={1}
          max={4}
          value={v.imageN}
          onChange={(e) => set({ imageN: Number(e.target.value) })}
        />
      </div>
    </div>
  );
}
