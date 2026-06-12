import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface ConfirmDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  /** Destructive action label; defaults to common actions.delete. */
  confirmLabel?: string;
  /** Disables both buttons and blocks closing while the mutation runs. */
  pending?: boolean;
  onConfirm: () => void;
}

const KEYWORD = "DELETE";

/**
 * Type-to-confirm destructive dialog — the uniform lock for every delete
 * across the app. The confirm button stays disabled until the user types
 * DELETE (case-insensitive, trimmed).
 *
 * Uses a plain destructive Button instead of AlertDialogAction so the dialog
 * does NOT auto-close on click; callers close it (or unmount) when their
 * mutation settles, mirroring the previous AlertDialog call sites.
 */
export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pending = false,
  onConfirm,
}: ConfirmDeleteDialogProps) {
  const { t } = useTranslation("common");
  const [text, setText] = useState("");
  useEffect(() => {
    if (!open) setText("");
  }, [open]);
  const armed = text.trim().toUpperCase() === KEYWORD;
  return (
    <AlertDialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {t("deleteConfirm.hint", { keyword: KEYWORD })}
          </p>
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("deleteConfirm.placeholder")}
            autoComplete="off"
            spellCheck={false}
            aria-label={t("deleteConfirm.placeholder")}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t("actions.cancel")}</AlertDialogCancel>
          <Button variant="destructive" disabled={!armed || pending} onClick={onConfirm}>
            {confirmLabel ?? t("actions.delete")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
