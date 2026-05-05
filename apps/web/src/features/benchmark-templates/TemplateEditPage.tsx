import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/auth-store";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  type UpdateBenchmarkTemplateRequest,
  updateBenchmarkTemplateRequestSchema,
} from "@modeldoctor/contracts";
import { useEffect, useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { DeleteTemplateDialog } from "./DeleteTemplateDialog";
import { TemplateForm } from "./TemplateForm";
import { useDeleteTemplate, useTemplate, useUpdateTemplate } from "./queries";

export function TemplateEditPage() {
  const { t } = useTranslation("benchmark-templates");
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const tplQ = useTemplate(id);
  const user = useAuthStore((s) => s.user);
  const myId = user?.id;
  const isAdmin = (user?.roles ?? []).includes("admin");
  const updateMut = useUpdateTemplate(id ?? "");
  const deleteMut = useDeleteTemplate();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const tpl = tplQ.data;
  const canEdit = !!tpl && (isAdmin || tpl.createdBy === myId);
  const mode = !canEdit ? "edit-readonly" : "edit-owner";

  const patchSchema = updateBenchmarkTemplateRequestSchema.omit({
    isOfficial: true,
    scenario: true,
    tool: true,
  });

  const form = useForm<Partial<UpdateBenchmarkTemplateRequest>>({
    resolver: zodResolver(patchSchema),
    mode: "onChange",
    defaultValues: {},
  });

  useEffect(() => {
    if (!tpl) return;
    form.reset({
      name: tpl.name,
      description: tpl.description ?? undefined,
      config: tpl.config,
      tags: tpl.tags,
    });
    // Set the disabled fields so the disabled selectors render the right value
    form.setValue("scenario" as never, tpl.scenario as never);
    form.setValue("tool" as never, tpl.tool as never);
    form.setValue("isOfficial" as never, tpl.isOfficial as never);
  }, [tpl, form]);

  if (tplQ.isLoading) {
    return (
      <>
        <PageHeader title={t("edit.title")} subtitle={t("edit.subtitle")} />
        <div className="mx-auto max-w-3xl px-8 py-6 text-sm text-muted-foreground">…</div>
      </>
    );
  }
  if (!tpl) {
    return (
      <>
        <PageHeader title={t("edit.title")} subtitle={t("edit.subtitle")} />
        <div className="mx-auto max-w-3xl px-8 py-6 text-sm text-destructive">404</div>
      </>
    );
  }

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await updateMut.mutateAsync(values);
      toast.success(t("edit.saved"));
    } catch (e) {
      toast.error((e as Error).message ?? t("edit.errors.saveFailed"));
    }
  });

  async function onDelete() {
    if (!id) return;
    try {
      await deleteMut.mutateAsync(id);
      toast.success(t("edit.deleted"));
      navigate("/benchmark-templates");
    } catch (e) {
      toast.error((e as Error).message ?? t("edit.errors.deleteFailed"));
    }
  }

  return (
    <>
      <PageHeader title={t("edit.title")} subtitle={t("edit.subtitle")} />
      <div className="mx-auto max-w-3xl space-y-4 px-8 py-6">
        {!canEdit && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
            {t("edit.readonlyBanner")}
          </div>
        )}
        <FormProvider {...form}>
          <form onSubmit={onSubmit} className="space-y-6">
            <TemplateForm mode={mode} isAdmin={isAdmin} />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate("/benchmark-templates")}
              >
                {t("actions.back")}
              </Button>
              {canEdit && (
                <>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => setConfirmingDelete(true)}
                  >
                    {t("actions.delete")}
                  </Button>
                  <Button type="submit" disabled={updateMut.isPending}>
                    {updateMut.isPending ? "…" : t("actions.save")}
                  </Button>
                </>
              )}
            </div>
          </form>
        </FormProvider>
      </div>
      <DeleteTemplateDialog
        template={tpl}
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        onConfirm={onDelete}
        pending={deleteMut.isPending}
      />
    </>
  );
}
