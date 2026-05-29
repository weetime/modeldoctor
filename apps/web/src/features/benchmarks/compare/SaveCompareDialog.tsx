import type { Classification } from "@modeldoctor/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCreateSavedCompare } from "./queries";

export interface SaveCompareDialogRun {
  id: string;
  name: string | null;
  tool: string;
}

export interface SaveCompareDialogProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  runs: SaveCompareDialogRun[];
  baselineId: string | null;
  context: string;
}

export function SaveCompareDialog({
  open,
  onOpenChange,
  runs,
  baselineId,
  context,
}: SaveCompareDialogProps) {
  const { t } = useTranslation("benchmarks");
  const navigate = useNavigate();
  const create = useCreateSavedCompare();
  const [name, setName] = useState("");
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [ctx, setCtx] = useState(context);
  const [classification, setClassification] = useState<Classification>("internal");
  const [clientName, setClientName] = useState("");

  const allLabelled = runs.every((r) => labels[r.id]?.trim());
  const canSubmit = name.trim().length > 0 && allLabelled && !create.isPending;

  async function submit() {
    if (!canSubmit) return;
    const sc = await create.mutateAsync({
      name: name.trim(),
      benchmarkIds: runs.map((r) => r.id),
      stageLabels: Object.fromEntries(runs.map((r) => [r.id, labels[r.id].trim()])),
      baselineId: baselineId ?? undefined,
      context: ctx.trim() || undefined,
      classification,
      clientName: clientName.trim() || undefined,
    });
    onOpenChange(false);
    navigate(`/benchmarks/compare/saved/${sc.id}`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("savedCompare.dialog.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="sc-name">{t("savedCompare.dialog.nameLabel")}</Label>
            <Input
              id="sc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("savedCompare.dialog.namePlaceholder")}
            />
          </div>
          <div>
            <div className="text-sm font-medium mb-1">
              {t("savedCompare.dialog.stageLabelsTitle")}
            </div>
            <div className="text-xs text-muted-foreground mb-2">
              {t("savedCompare.dialog.stageLabelsHint")}
            </div>
            <div className="space-y-2">
              {runs.map((r) => (
                <div key={r.id} className="grid grid-cols-[1fr_auto] items-center gap-2">
                  <Label htmlFor={`label-${r.id}`} className="text-sm font-normal">
                    {r.name ?? r.id}
                  </Label>
                  <Input
                    id={`label-${r.id}`}
                    aria-label={r.name ?? r.id}
                    className="w-32"
                    value={labels[r.id] ?? ""}
                    onChange={(e) => setLabels((p) => ({ ...p, [r.id]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          </div>
          <div>
            <Label htmlFor="sc-ctx">{t("savedCompare.dialog.contextLabel")}</Label>
            <Textarea
              id="sc-ctx"
              rows={4}
              value={ctx}
              onChange={(e) => setCtx(e.target.value)}
              placeholder={t("savedCompare.dialog.contextPlaceholder")}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="sc-classification">
                {t("savedCompare.dialog.classificationLabel", { defaultValue: "Classification" })}
              </Label>
              <Select
                value={classification}
                onValueChange={(v) => setClassification(v as Classification)}
              >
                <SelectTrigger id="sc-classification">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="internal">
                    {t("savedCompare.classification.internal", { defaultValue: "Internal" })}
                  </SelectItem>
                  <SelectItem value="partner">
                    {t("savedCompare.classification.partner", { defaultValue: "Partner" })}
                  </SelectItem>
                  <SelectItem value="public">
                    {t("savedCompare.classification.public", { defaultValue: "Public" })}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="sc-client">
                {t("savedCompare.dialog.clientLabel", { defaultValue: "Client / customer" })}
              </Label>
              <Input
                id="sc-client"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder={t("savedCompare.dialog.clientPlaceholder", {
                  defaultValue: "(optional, surfaces in report Hero)",
                })}
              />
            </div>
          </div>
          {create.error ? (
            <div className="text-sm text-rose-600">{create.error.message}</div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("savedCompare.dialog.cancel")}
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {t("savedCompare.dialog.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
