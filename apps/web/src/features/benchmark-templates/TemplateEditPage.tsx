import { zodResolver } from "@hookform/resolvers/zod";
import {
  type PatchBenchmarkTemplateRequest,
  patchBenchmarkTemplateRequestSchema,
} from "@modeldoctor/contracts";
import type { ToolName as AdapterToolName } from "@modeldoctor/tool-adapters/schemas";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { FormActions } from "@/components/common/form-actions";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import type { ScenarioId as AdapterScenarioId } from "@/features/benchmarks/scenarios";
import { useAuthStore } from "@/stores/auth-store";
import { DeleteTemplateDialog } from "./DeleteTemplateDialog";
import { useDeleteTemplate, useTemplate, useUpdateTemplate } from "./queries";
import { TemplateForm } from "./TemplateForm";

export function TemplateEditPage() {
  const { t } = useTranslation("benchmark-templates");
  const { t: tSidebar } = useTranslation("sidebar");
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

  const form = useForm<PatchBenchmarkTemplateRequest>({
    resolver: zodResolver(patchBenchmarkTemplateRequestSchema),
    mode: "onTouched",
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
  }, [tpl, form]);

  const placeholderCrumbs = [
    { label: tSidebar("groups.benchmarks") },
    { label: tSidebar("items.benchmarkTemplates"), to: "/benchmark-templates" },
    { label: t("edit.title") },
  ];
  if (tplQ.isLoading) {
    return (
      <>
        <PageHeader
          title={t("edit.title")}
          subtitle={t("edit.subtitle")}
          breadcrumbs={placeholderCrumbs}
        />
        <div className="px-8 py-6 text-sm text-muted-foreground">…</div>
      </>
    );
  }
  if (!tpl) {
    return (
      <>
        <PageHeader
          title={t("edit.title")}
          subtitle={t("edit.subtitle")}
          breadcrumbs={placeholderCrumbs}
        />
        <div className="px-8 py-6 text-sm text-destructive">404</div>
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
      <PageHeader
        title={t("edit.title")}
        subtitle={t("edit.subtitle")}
        breadcrumbs={[
          { label: tSidebar("groups.benchmarks") },
          { label: tSidebar("items.benchmarkTemplates"), to: "/benchmark-templates" },
          { label: tpl.name },
        ]}
      />
      <div className="space-y-4 px-8 py-6">
        {!canEdit && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
            {t("edit.readonlyBanner")}
          </div>
        )}
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-6">
            <TemplateForm
              mode={mode}
              isAdmin={isAdmin}
              // NOTE: tpl.scenario/tpl.tool are contracts' (widened)
              // ScenarioId/BenchmarkTool, which now include "omni" /
              // "vllm-omni-bench". TemplateForm's display props are still
              // typed against tool-adapters' narrower unions until the omni
              // scenario + tool are registered there. Safe today: no
              // existing template can carry those values yet.
              displayScenario={tpl.scenario as AdapterScenarioId}
              displayTool={tpl.tool as AdapterToolName}
            />
            <FormActions
              onCancel={() => navigate("/benchmark-templates")}
              cancelLabel={t("actions.back")}
              submitLabel={t("actions.save")}
              disabled={!canEdit}
              pending={updateMut.isPending}
              leading={
                canEdit ? (
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => setConfirmingDelete(true)}
                  >
                    {t("actions.delete")}
                  </Button>
                ) : undefined
              }
            />
          </form>
        </Form>
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
