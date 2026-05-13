import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useRuns } from "../queries";
import { GateStatusBadge } from "./GateStatusBadge";

interface Props {
  evaluationId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Currently selected (highlighted) run id. */
  initialRunId?: string | null;
  onPick: (runId: string) => void;
}

export function BaselinePickerDialog({
  evaluationId,
  open,
  onOpenChange,
  initialRunId,
  onPick,
}: Props) {
  const { t } = useTranslation("quality-gate");
  const { data } = useRuns({ evaluationId, pageSize: 10 });
  const completed = (data?.items ?? []).filter((r) => r.status === "COMPLETED");
  const [picked, setPicked] = useState<string | null>(initialRunId ?? null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("runs.form.baselinePickerTitle")}</DialogTitle>
          <DialogDescription>{t("runs.form.baselinePickerDescription")}</DialogDescription>
        </DialogHeader>
        {completed.length === 0 ? (
          <div className="text-muted-foreground py-8 text-center">
            {t("runs.form.baselinePickerEmpty")}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12" />
                <TableHead>{t("runs.form.baselinePickerColumnId")}</TableHead>
                <TableHead>{t("runs.form.baselinePickerColumnCreatedAt")}</TableHead>
                <TableHead>{t("runs.form.baselinePickerColumnVerdict")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {completed.map((r) => (
                <TableRow
                  key={r.id}
                  className={picked === r.id ? "bg-accent/40" : "cursor-pointer"}
                  onClick={() => setPicked(r.id)}
                >
                  <TableCell>
                    <input
                      type="radio"
                      name="baseline-pick"
                      checked={picked === r.id}
                      onChange={() => setPicked(r.id)}
                    />
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.id.slice(0, 12)}</TableCell>
                  <TableCell>{new Date(r.createdAt).toLocaleString()}</TableCell>
                  <TableCell>
                    <GateStatusBadge status={r.status} gateResult={r.gateResult} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("evaluations.form.cancel")}
          </Button>
          <Button
            disabled={!picked}
            onClick={() => {
              if (picked) {
                onPick(picked);
                onOpenChange(false);
              }
            }}
          >
            {t("runs.form.baselinePickerConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
