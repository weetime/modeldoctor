// apps/web/src/features/insights/ProfileSelector.tsx

import type { EvaluationProfile } from "@modeldoctor/contracts";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Props {
  value: string;
  options: EvaluationProfile[];
  onChange: (slug: string) => void;
}

export function ProfileSelector({ value, options, onChange }: Props) {
  const { t } = useTranslation("insights");
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[200px]" aria-label={t("detail.profile.label")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((p) => (
          <SelectItem key={p.slug} value={p.slug}>
            {p.nameKey ? t(p.nameKey, { defaultValue: p.name }) : p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
