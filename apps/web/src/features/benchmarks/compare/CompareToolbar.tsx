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

export function CompareToolbar({ runs, baselineId, onBaselineChange }: CompareToolbarProps) {
  const { t } = useTranslation("runs");
  return (
    <div className="flex items-center gap-3 text-sm">
      <label className="flex items-center gap-2">
        <span className="text-muted-foreground">{t("compare.baselineLabel")}</span>
        <select
          className="rounded border border-border bg-background px-2 py-1"
          value={baselineId ?? ""}
          onChange={(e) => onBaselineChange(e.target.value === "" ? null : e.target.value)}
        >
          <option value="">{t("compare.baselineNone")}</option>
          {runs.map((run) => (
            <option key={run.id} value={run.id}>
              {run.name ?? run.id}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
