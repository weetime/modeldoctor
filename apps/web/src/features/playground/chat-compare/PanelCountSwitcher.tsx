import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { type PanelCount, useCompareStore } from "./store";

const COUNTS: PanelCount[] = [2, 3, 4];

export function PanelCountSwitcher() {
  const { t } = useTranslation("playground");
  const panelCount = useCompareStore((s) => s.panelCount);
  const setPanelCount = useCompareStore((s) => s.setPanelCount);
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">{t("chat.compare.panelCount")}:</span>
      <div className="flex gap-1">
        {COUNTS.map((n) => (
          <Button
            key={n}
            size="sm"
            variant={n === panelCount ? "default" : "outline"}
            onClick={() => setPanelCount(n)}
          >
            {n}
          </Button>
        ))}
      </div>
    </div>
  );
}
