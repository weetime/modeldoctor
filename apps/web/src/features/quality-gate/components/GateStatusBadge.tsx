import { useTranslation } from "react-i18next";
import type { GateResult, RunStatus } from "@modeldoctor/contracts";
import { Badge } from "@/components/ui/badge";

export function GateStatusBadge({
  status,
  gateResult,
}: {
  status: RunStatus;
  gateResult: GateResult | null;
}) {
  const { t } = useTranslation("quality-gate");

  if (status === "PENDING") return <Badge variant="outline">{t("runs.status.pending")}</Badge>;
  if (status === "RUNNING") return <Badge variant="default">{t("runs.status.running")}</Badge>;
  if (status === "CANCELLED") return <Badge variant="outline">{t("runs.status.cancelled")}</Badge>;
  if (status === "FAILED") return <Badge variant="destructive">{t("runs.status.failed")}</Badge>;
  if (gateResult === "PASSED")
    return <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white border-transparent">{t("runs.gateResult.passed")}</Badge>;
  if (gateResult === "WARNING") return <Badge variant="warning">{t("runs.gateResult.warning")}</Badge>;
  return <Badge variant="destructive">{t("runs.gateResult.failed")}</Badge>;
}
