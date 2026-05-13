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
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useEvaluation, useSetBaseline } from "../queries";

interface Props {
  evaluationId: string;
  runId: string;
}

export function PinBaselineButton({ evaluationId, runId }: Props) {
  const { t } = useTranslation("quality-gate");
  const evaluation = useEvaluation(evaluationId);
  const setBaseline = useSetBaseline(evaluationId);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [unpinOpen, setUnpinOpen] = useState(false);

  const currentPin = evaluation.data?.baselineRunId ?? null;
  const isThisPinned = currentPin === runId;
  const hasOtherPin = currentPin !== null && !isThisPinned;

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
