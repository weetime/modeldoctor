import { CheckIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
  // Server-side filter for COMPLETED so pageSize:10 actually returns 10 candidates.
  const { data, isLoading } = useRuns({
    evaluationId,
    status: "COMPLETED",
    pageSize: 10,
  });
  const items = data?.items ?? [];
  const [picked, setPicked] = useState<string | null>(initialRunId ?? null);

  // Reset `picked` whenever the dialog reopens — picker state is per-session,
  // not global.
  useEffect(() => {
    if (open) setPicked(initialRunId ?? null);
  }, [open, initialRunId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("runs.form.baselinePickerTitle")}</DialogTitle>
          <DialogDescription>{t("runs.form.baselinePickerDescription")}</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="h-32 animate-pulse rounded-md border border-border bg-muted/30" />
        ) : items.length === 0 ? (
          <div className="text-muted-foreground py-8 text-center">
            {t("runs.form.baselinePickerEmpty")}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>{t("runs.form.baselinePickerColumnId")}</TableHead>
                <TableHead>{t("runs.form.baselinePickerColumnCreatedAt")}</TableHead>
                <TableHead>{t("runs.form.baselinePickerColumnVerdict")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((r) => {
                const isPicked = picked === r.id;
                return (
                  <TableRow
                    key={r.id}
                    className={`cursor-pointer ${isPicked ? "bg-accent/40" : ""}`}
                    onClick={() => setPicked(r.id)}
                  >
                    <TableCell>
                      {/* Hidden radio for screen readers + form-semantics;
                          CheckIcon below is the visual indicator. */}
                      <input
                        type="radio"
                        name="baseline-pick"
                        value={r.id}
                        checked={isPicked}
                        onChange={() => setPicked(r.id)}
                        aria-label={r.id}
                        className="sr-only"
                      />
                      <CheckIcon
                        className={`h-4 w-4 ${isPicked ? "text-primary" : "text-transparent"}`}
                        aria-hidden="true"
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.id.slice(0, 12)}</TableCell>
                    <TableCell>{new Date(r.createdAt).toLocaleString()}</TableCell>
                    <TableCell>
                      <GateStatusBadge status={r.status} gateResult={r.gateResult} />
                    </TableCell>
                  </TableRow>
                );
              })}
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
