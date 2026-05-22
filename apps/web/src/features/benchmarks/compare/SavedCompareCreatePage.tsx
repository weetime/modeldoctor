// Deep link: /benchmarks/compare/saved/new?evaluationRunIds=id1,id2
// Triggered from RunsListPage (multi-select toolbar) and RunReportPage
// (Add to Compare button). On mount we prefill evaluationRunIds and,
// once their createdAt timestamps load, auto-fill stageLabels with
// "Latest / Previous / Older" or YYYY-MM-DD strings.

import { zodResolver } from "@hookform/resolvers/zod";
import { stageLabelsSchema } from "@modeldoctor/contracts";
import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { FormActions } from "@/components/common/form-actions";
import { FormSection } from "@/components/common/form-section";
import { PageHeader } from "@/components/common/page-header";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useEvaluationRunsByIds } from "@/features/quality-gate/queries";
import { useCreateSavedCompare } from "./queries";

const formSchema = z.object({
  name: z.string().min(1).max(200),
  context: z.string().max(10_000).optional(),
  stageLabels: stageLabelsSchema,
});
type FormValues = z.infer<typeof formSchema>;

export function SavedCompareCreatePage() {
  const { t } = useTranslation("benchmarks");
  const { t: tSidebar } = useTranslation("sidebar");
  const navigate = useNavigate();
  const create = useCreateSavedCompare();

  const [searchParams] = useSearchParams();
  const prefilledIdsParam = searchParams.get("evaluationRunIds");
  const runIds = prefilledIdsParam ? prefilledIdsParam.split(",").filter(Boolean) : [];

  const form = useForm<FormValues>({
    mode: "onChange",
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      context: "",
      stageLabels: Object.fromEntries(runIds.map((id) => [id, ""])),
    },
  });

  const selected = useEvaluationRunsByIds(runIds);
  const autoFilled = useRef(false);

  // Auto-fill stageLabels once run createdAt timestamps load — and only when
  // the user hasn't started editing labels yet.
  useEffect(() => {
    if (!selected.data || autoFilled.current) return;
    if (form.formState.dirtyFields.stageLabels) return;

    const sorted = [...selected.data].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    const labels = Object.fromEntries(
      sorted.map((r, i) => {
        if (i === 0) return [r.id, t("compare.autoLabel.latest")];
        if (i === 1) return [r.id, t("compare.autoLabel.previous")];
        if (i === 2) return [r.id, t("compare.autoLabel.older")];
        return [r.id, new Date(r.createdAt).toISOString().slice(0, 10)];
      }),
    );
    form.setValue("stageLabels", labels, { shouldValidate: true });
    autoFilled.current = true;
  }, [selected.data, form, t]);

  const stageLabels = form.watch("stageLabels");
  const allLabelled = runIds.every((id) => stageLabels[id]?.trim());
  const canSubmit =
    runIds.length >= 2 && allLabelled && form.formState.isValid && !create.isPending;

  const onSubmit = form.handleSubmit(async (values) => {
    if (runIds.length < 2) return;
    const sc = await create.mutateAsync({
      name: values.name.trim(),
      benchmarkIds: [],
      evaluationRunIds: runIds,
      stageLabels: Object.fromEntries(runIds.map((id) => [id, values.stageLabels[id].trim()])),
      context: values.context?.trim() || undefined,
    });
    navigate(`/benchmarks/compare/saved/${sc.id}`);
  });

  const breadcrumbs = [
    { label: tSidebar("groups.benchmarks") },
    { label: t("savedCompare.list.title"), to: "/benchmarks/compare/saved" },
    { label: t("savedCompare.dialog.title") },
  ];

  return (
    <>
      <PageHeader title={t("savedCompare.dialog.title")} breadcrumbs={breadcrumbs} />
      <div className="space-y-6 px-8 py-6">
        {runIds.length < 2 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {t("compareDisabledNeedTwoRuns")}
          </div>
        )}

        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-6">
            <FormSection title={t("savedCompare.dialog.title")}>
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t("savedCompare.dialog.nameLabel")}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder={t("savedCompare.dialog.namePlaceholder")} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </FormSection>

            <FormSection
              title={t("savedCompare.dialog.stageLabelsTitle")}
              description={t("savedCompare.dialog.stageLabelsHint")}
            >
              <div className="space-y-2">
                {runIds.map((id) => {
                  const runData = selected.data?.find((r) => r.id === id);
                  return (
                    <FormField
                      key={id}
                      control={form.control}
                      name={`stageLabels.${id}` as const}
                      render={({ field }) => (
                        <FormItem className="grid grid-cols-[1fr_auto] items-center gap-2 space-y-0">
                          <FormLabel className="text-sm font-normal tabular-nums">
                            {runData
                              ? new Date(runData.createdAt).toLocaleString()
                              : id.slice(0, 12)}
                          </FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              value={field.value ?? ""}
                              aria-label={id}
                              className="w-32"
                            />
                          </FormControl>
                          <FormMessage className="col-span-2" />
                        </FormItem>
                      )}
                    />
                  );
                })}
              </div>
            </FormSection>

            <FormSection title={t("savedCompare.dialog.contextLabel")}>
              <FormField
                control={form.control}
                name="context"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Textarea
                        {...field}
                        value={field.value ?? ""}
                        rows={4}
                        placeholder={t("savedCompare.dialog.contextPlaceholder")}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </FormSection>

            {create.error && <div className="text-sm text-destructive">{create.error.message}</div>}

            <FormActions
              onCancel={() => navigate(-1)}
              cancelLabel={t("savedCompare.dialog.cancel")}
              submitLabel={t("savedCompare.dialog.submit")}
              disabled={!canSubmit}
              pending={create.isPending}
            />
          </form>
        </Form>
      </div>
    </>
  );
}
