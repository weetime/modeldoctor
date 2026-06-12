import type { BenchmarkTemplate } from "@modeldoctor/contracts";
import { useTranslation } from "react-i18next";
import { ConfirmDeleteDialog } from "@/components/common/confirm-delete-dialog";

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
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("edit.deleteConfirm.title", { name: template.name })}
      description={t("edit.deleteConfirm.body")}
      confirmLabel={t("edit.deleteConfirm.confirm")}
      pending={pending}
      onConfirm={onConfirm}
    />
  );
}
