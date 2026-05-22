import type { BenchmarkTemplate } from "@modeldoctor/contracts";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export interface DeleteTemplateDialogProps {
  template: BenchmarkTemplate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  pending: boolean;
}

export function DeleteTemplateDialog({
  template,
  open,
  onOpenChange,
  onConfirm,
  pending,
}: DeleteTemplateDialogProps) {
  const { t } = useTranslation("benchmark-templates");
  if (!template) return null;
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("edit.deleteConfirm.title", { name: template.name })}
          </AlertDialogTitle>
          <AlertDialogDescription>{t("edit.deleteConfirm.body")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("edit.deleteConfirm.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={onConfirm}
            className="bg-destructive hover:bg-destructive/90"
          >
            {t("edit.deleteConfirm.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
