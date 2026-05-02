import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCreateBaseline } from "@/features/baseline/queries";
import { ApiError } from "@/lib/api-client";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

export interface SetBaselineDialogProps {
  runId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function SetBaselineDialog({
  runId,
  open,
  onOpenChange,
  onSuccess,
}: SetBaselineDialogProps) {
  const { t } = useTranslation("history");
  const create = useCreateBaseline();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tagsInput, setTagsInput] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    const tags = tagsInput
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    create.mutate(
      {
        runId,
        name: trimmed,
        ...(description.trim() ? { description: description.trim() } : {}),
        tags,
      },
      {
        onSuccess: () => {
          onSuccess?.();
          onOpenChange(false);
          // Reset for next open.
          setName("");
          setDescription("");
          setTagsInput("");
        },
        onError: (err) => {
          if (err instanceof ApiError && err.status === 409) {
            toast.error(t("detail.baseline.errors.alreadyExists"));
          } else {
            toast.error(t("detail.baseline.errors.generic"));
          }
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("detail.baseline.dialog.title")}</DialogTitle>
            <DialogDescription>{t("detail.baseline.dialog.body")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="baseline-name">{t("detail.baseline.dialog.nameLabel")}</Label>
            <Input
              id="baseline-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("detail.baseline.dialog.namePlaceholder")}
              maxLength={200}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="baseline-description">
              {t("detail.baseline.dialog.descriptionLabel")}
            </Label>
            <Textarea
              id="baseline-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="baseline-tags">{t("detail.baseline.dialog.tagsLabel")}</Label>
            <Input
              id="baseline-tags"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="qwen, throughput"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("detail.baseline.dialog.cancel")}
            </Button>
            <Button type="submit" disabled={create.isPending || name.trim().length === 0}>
              {t("detail.baseline.dialog.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
