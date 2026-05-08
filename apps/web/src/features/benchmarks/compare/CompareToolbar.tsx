import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "react-i18next";

export interface CompareToolbarRun {
  id: string;
  name: string | null;
  tool: string;
}

export interface CompareToolbarProps {
  runs: CompareToolbarRun[];
  baselineId: string | null;
  onBaselineChange: (id: string | null) => void;
}

const NONE = "__none__";

export function CompareToolbar({ runs, baselineId, onBaselineChange }: CompareToolbarProps) {
  const { t } = useTranslation("benchmarks");
  const labelId = "compare-baseline-label";
  return (
    <div className="flex items-center gap-3 text-sm">
      <div className="flex items-center gap-2">
        <span id={labelId} className="text-muted-foreground">
          {t("compare.baselineLabel")}
        </span>
        <Select
          value={baselineId ?? NONE}
          onValueChange={(v) => onBaselineChange(v === NONE ? null : v)}
        >
          <SelectTrigger className="h-8 min-w-[180px]" aria-labelledby={labelId}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t("compare.baselineNone")}</SelectItem>
            {runs.map((run) => (
              <SelectItem key={run.id} value={run.id}>
                {run.name ?? run.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
