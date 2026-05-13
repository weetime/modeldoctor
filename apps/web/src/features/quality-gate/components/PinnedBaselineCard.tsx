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
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useRun, useSetBaseline } from "../queries";
import { BaselinePickerDialog } from "./BaselinePickerDialog";
import { GateStatusBadge } from "./GateStatusBadge";

interface Props {
  evaluationId: string;
  baselineRunId: string;
}

export function PinnedBaselineCard({ evaluationId, baselineRunId }: Props) {
  const { t } = useTranslation("quality-gate");
  const { data: run } = useRun(baselineRunId);
  const setBaseline = useSetBaseline(evaluationId);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [unpinOpen, setUnpinOpen] = useState(false);

  async function doUnpin() {
    try {
      await setBaseline.mutateAsync(null);
      toast.success(t("runs.report.unpinSuccessToast"));
    } catch (err) {
      toast.error(t("runs.report.pinErrorToast", { message: (err as Error).message }));
    }
  }

  async function doChange(newRunId: string) {
    try {
      await setBaseline.mutateAsync(newRunId);
      toast.success(t("runs.report.pinSuccessToast"));
    } catch (err) {
      toast.error(t("runs.report.pinErrorToast", { message: (err as Error).message }));
    }
  }

  return (
    <div className="rounded-md border bg-card p-4 space-y-2">
      <div className="font-medium">{t("evaluations.baseline.cardTitle")}</div>
      {!run ? (
        <div className="text-sm text-muted-foreground">{t("evaluations.baseline.loading")}</div>
      ) : (
        <>
          <div className="flex items-center gap-2 text-sm">
            <span className="font-mono">{run.id.slice(0, 12)}</span>
            <span className="text-muted-foreground">·</span>
            <span>{new Date(run.createdAt).toLocaleString()}</span>
            <span className="text-muted-foreground">·</span>
            <GateStatusBadge status={run.status} gateResult={run.gateResult} />
          </div>
          <div className="flex gap-2 pt-1">
            <Button asChild size="sm" variant="outline">
              <Link to={`/quality-gate/runs/${run.id}`}>{t("evaluations.baseline.view")}</Link>
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)}>
              {t("evaluations.baseline.change")}
            </Button>
            <AlertDialog open={unpinOpen} onOpenChange={setUnpinOpen}>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="ghost" className="text-destructive">
                  {t("evaluations.baseline.unpin")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("evaluations.baseline.unpinConfirmTitle")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("evaluations.baseline.unpinConfirmBody")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("evaluations.form.cancel")}</AlertDialogCancel>
                  <AlertDialogAction onClick={doUnpin}>
                    {t("evaluations.baseline.unpinConfirmAction")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </>
      )}
      <BaselinePickerDialog
        evaluationId={evaluationId}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        initialRunId={baselineRunId}
        onPick={doChange}
      />
    </div>
  );
}
