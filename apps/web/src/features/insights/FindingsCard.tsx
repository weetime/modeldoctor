// apps/web/src/features/insights/FindingsCard.tsx

import type { Finding } from "@modeldoctor/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

const SEV_RANK: Record<Finding["severity"], number> = {
  crit: 0,
  warn: 1,
  good: 2,
  no_data: 3,
};

const SEV_BADGE = {
  crit: { emoji: "🔴", cls: "border-l-rose-500 bg-rose-50/50 dark:bg-rose-950/20" },
  warn: { emoji: "🟡", cls: "border-l-amber-500 bg-amber-50/50 dark:bg-amber-950/20" },
  good: { emoji: "🟢", cls: "border-l-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20" },
  no_data: { emoji: "·", cls: "border-l-muted bg-muted/30" },
} as const;

interface Props {
  findings: Finding[];
  defaultLimit?: number;
}

export function FindingsCard({ findings, defaultLimit = 5 }: Props) {
  const { t } = useTranslation("insights");
  const [expanded, setExpanded] = useState(false);

  const visible = findings
    .filter((f) => f.severity !== "no_data")
    .sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || b.weight - a.weight);

  const shown = expanded ? visible : visible.slice(0, defaultLimit);
  const hiddenCount = visible.length - shown.length;

  if (visible.length === 0) {
    return (
      <Card>
        <CardHeader>
          <h3 className="text-sm font-semibold">{t("detail.findings.title")}</h3>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">{t("detail.findings.noFindings")}</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <h3 className="text-sm font-semibold">{t("detail.findings.title")}</h3>
      </CardHeader>
      <CardContent className="space-y-2">
        {shown.map((f) => {
          const sev = SEV_BADGE[f.severity];
          return (
            <div
              key={f.checkId}
              data-testid={`finding-${f.checkId}`}
              data-severity={f.severity}
              className={`rounded-md border-l-[3px] px-3 py-2 text-sm ${sev.cls}`}
            >
              <div className="flex items-center gap-2 font-medium">
                <span>{sev.emoji}</span>
                <span>[{t(`detail.scenario.${f.scenario}`)}]</span>
                <span>{f.checkId}</span>
                {f.value != null && (
                  <span className="text-muted-foreground">
                    = {f.value.toFixed(2)} (warn {f.threshold.warn} / crit {f.threshold.crit})
                  </span>
                )}
              </div>
              {f.recommendation && (
                <div className="mt-1 text-xs text-muted-foreground">{f.recommendation}</div>
              )}
            </div>
          );
        })}
        {hiddenCount > 0 && (
          <div className="pt-1">
            <Button variant="ghost" size="sm" onClick={() => setExpanded(true)}>
              {t("detail.findings.expandAll", { count: visible.length })}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
