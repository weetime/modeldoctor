import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { GateResult } from "@modeldoctor/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useEvaluation, useSetBaseline } from "../queries";

interface Props {
  evaluationId: string;
  runId: string;
  /** Run's gate verdict — used to block pinning runs that failed the gate.
   * Always allow the unpin path though, in case a now-FAILED run was pinned
   * before this validation was added. */
  gateResult: GateResult | null;
}

export function PinBaselineButton({ evaluationId, runId, gateResult }: Props) {
  const { t } = useTranslation("quality-gate");
  const evaluation = useEvaluation(evaluationId);
  const setBaseline = useSetBaseline(evaluationId);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [unpinOpen, setUnpinOpen] = useState(false);

  const currentPin = evaluation.data?.baselineRunId ?? null;
  const isThisPinned = currentPin === runId;
  const hasOtherPin = currentPin !== null && !isThisPinned;
  const canPin = gateResult !== "FAILED";

  async function pin(target: string | null, successKey: string) {
    try {
      await setBaseline.mutateAsync(target);
      toast.success(t(successKey));
    } catch (err) {
      toast.error(t("runs.report.pinErrorToast", { message: (err as Error).message }));
    }
  }

  if (isThisPinned) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-primary font-medium">{t("runs.report.pinnedBadge")}</span>
        <AlertDialog open={unpinOpen} onOpenChange={setUnpinOpen}>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="sm" className="text-destructive">
              {t("runs.report.unpinButton")}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("runs.report.unpinConfirmTitle")}</AlertDialogTitle>
              <AlertDialogDescription>{t("runs.report.unpinConfirmBody")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("evaluations.form.cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={() => pin(null, "runs.report.unpinSuccessToast")}>
                {t("runs.report.unpinConfirmAction")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  // Pin / Replace paths require a passable gate verdict; if this run failed
  // the gate, fall through to render nothing (the Unpin path above already
  // handled the edge case where a now-FAILED run was previously pinned).
  if (!canPin) {
    return null;
  }

  if (hasOtherPin) {
    return (
      <AlertDialog open={replaceOpen} onOpenChange={setReplaceOpen}>
        <AlertDialogTrigger asChild>
          <Button variant="outline" size="sm">
            {t("runs.report.pinButton")}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("runs.report.replaceConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-line">
              {t("runs.report.replaceConfirmBody", { currentId: currentPin?.slice(0, 12) })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("evaluations.form.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => pin(runId, "runs.report.pinSuccessToast")}>
              {t("runs.report.replaceConfirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => pin(runId, "runs.report.pinSuccessToast")}
      disabled={setBaseline.isPending}
    >
      {t("runs.report.pinButton")}
    </Button>
  );
}
