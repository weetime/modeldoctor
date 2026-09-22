import type {
  AutomationRunPublic,
  AutomationVerdict,
  DiscoveredModelStatus,
} from "@modeldoctor/contracts";
import { useTranslation } from "react-i18next";
import { Badge, type BadgeProps } from "@/components/ui/badge";

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

// Real Badge variants: default | outline | success | warning | destructive
// (there is no "secondary" variant — see SamplesTable.tsx's deltaVariant for
// the established mapping convention).
const VERDICT_VARIANT: Record<AutomationVerdict, BadgeVariant> = {
  passed: "success",
  failed: "destructive",
  regressed: "destructive",
  error: "destructive",
  superseded: "outline",
};

export function VerdictBadge({ run }: { run: AutomationRunPublic | null }) {
  const { t } = useTranslation("deployment-gate");
  if (!run) return <span className="text-muted-foreground">{t("models.noRun")}</span>;
  if (run.status === "pending" || run.status === "running") {
    return <Badge variant="outline">{t(`verdict.${run.status}`)}</Badge>;
  }
  if (!run.verdict) return <span className="text-muted-foreground">{t("models.noRun")}</span>;
  return (
    <Badge variant={VERDICT_VARIANT[run.verdict] ?? "outline"}>{t(`verdict.${run.verdict}`)}</Badge>
  );
}

const STATUS_VARIANT: Record<DiscoveredModelStatus, BadgeVariant> = {
  new: "default",
  active: "outline",
  unroutable: "destructive",
  removed: "outline",
};

export function ModelStatusBadge({ status }: { status: DiscoveredModelStatus }) {
  const { t } = useTranslation("deployment-gate");
  return <Badge variant={STATUS_VARIANT[status]}>{t(`models.status.${status}`)}</Badge>;
}
