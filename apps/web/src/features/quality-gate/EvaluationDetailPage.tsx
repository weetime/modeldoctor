import { FormActions } from "@/components/common/form-actions";
import { FormSection } from "@/components/common/form-section";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
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
import { zodResolver } from "@hookform/resolvers/zod";
import {
  type UpdateEvaluationRequest,
  updateEvaluationRequestSchema,
} from "@modeldoctor/contracts";
import { useEffect, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { EvaluationSampleEditor } from "./components/EvaluationSampleEditor";
import { PinnedBaselineCard } from "./components/PinnedBaselineCard";
import { useEvaluation, useUpdateEvaluation } from "./queries";

type FormShape = Required<Pick<UpdateEvaluationRequest, "name" | "description" | "samples">>;

const blankSample: FormShape["samples"][number] = {
  prompt: "",
  expected: "",
  judgeConfig: { kind: "exact-match" },
};

export function EvaluationDetailPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const { t } = useTranslation("quality-gate");
  const { t: tSidebar } = useTranslation("sidebar");
  const { data } = useEvaluation(id);
  const update = useUpdateEvaluation(id);
  const [initialized, setInitialized] = useState(false);

  const form = useForm<FormShape>({
    resolver: zodResolver(updateEvaluationRequestSchema),
    mode: "onChange",
    defaultValues: { name: "", description: null, samples: [] },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "samples" });

  useEffect(() => {
    if (data && !initialized) {
      form.reset({
        name: data.name,
        description: data.description ?? null,
        samples: data.samples,
      });
      setInitialized(true);
    }
  }, [data, initialized, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await update.mutateAsync(values);
      toast.success(t("evaluations.form.saveSuccess"));
    } catch (err) {
      toast.error(t("evaluations.form.saveError", { message: (err as Error).message }));
    }
  });

  const breadcrumbs = [
    { label: tSidebar("groups.qualityGate") },
    {
      label: tSidebar("items.qualityGateEvaluations"),
      to: "/quality-gate/evaluations",
    },
    { label: data?.name ?? t("evaluations.form.editTitle") },
  ];

  // Loading / 404: still render PageHeader + breadcrumbs (with a placeholder
  // for the entity name) so spatial layout stays consistent. Body becomes
  // a skeleton card while data arrives.
  if (!data) {
    return (
      <>
        <PageHeader
          title={t("evaluations.form.editTitle")}
          subtitle={t("evaluations.form.editSubtitle")}
          breadcrumbs={breadcrumbs}
        />
        <div className="space-y-6 px-8 py-6">
          <div className="h-64 animate-pulse rounded-md border border-border bg-muted/30" />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={data.name}
        subtitle={t("evaluations.form.editSubtitle")}
        breadcrumbs={breadcrumbs}
      />
      <div className="space-y-6 px-8 py-6">
        {data.baselineRunId && (
          <PinnedBaselineCard evaluationId={data.id} baselineRunId={data.baselineRunId} />
        )}
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-6">
            <FormSection title={t("evaluations.form.sectionBasics")}>
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t("evaluations.form.nameLabel")}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder={t("evaluations.form.namePlaceholder")} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("evaluations.form.descriptionLabel")}</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        value={field.value ?? ""}
                        placeholder={t("evaluations.form.descriptionPlaceholder")}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </FormSection>

            <FormSection title={t("evaluations.form.sectionSamples")}>
              <Button type="button" onClick={() => append(blankSample)}>
                {t("evaluations.form.addSample")}
              </Button>

              <div className="space-y-3">
                {fields.map((f, i) => (
                  <EvaluationSampleEditor
                    key={f.id}
                    namePrefix={`samples.${i}`}
                    index={i}
                    onRemove={() => remove(i)}
                  />
                ))}
              </div>
            </FormSection>

            <FormActions
              onCancel={() => nav("/quality-gate/evaluations")}
              cancelLabel={t("evaluations.form.cancel")}
              submitLabel={t("evaluations.form.save")}
              disabled={!form.formState.isValid}
              pending={update.isPending}
            />
          </form>
        </Form>
      </div>
    </>
  );
}
