import { FormActions } from "@/components/common/form-actions";
import { FormSection } from "@/components/common/form-section";
import { PageHeader } from "@/components/common/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Copy, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { PinnedBaselineCard } from "./components/PinnedBaselineCard";
import { SamplesTableEditor } from "./components/SamplesTableEditor";
import { useDuplicateEvaluation, useEvaluation, useUpdateEvaluation } from "./queries";

type FormShape = Required<Pick<UpdateEvaluationRequest, "name" | "description" | "samples">>;

export function EvaluationDetailPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const { t } = useTranslation("quality-gate");
  const { t: tSidebar } = useTranslation("sidebar");
  const { data } = useEvaluation(id);
  const update = useUpdateEvaluation(id);
  const duplicate = useDuplicateEvaluation();
  const [initialized, setInitialized] = useState(false);

  const form = useForm<FormShape>({
    resolver: zodResolver(updateEvaluationRequestSchema),
    mode: "onChange",
    defaultValues: { name: "", description: null, samples: [] },
  });

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

  async function handleDuplicate() {
    try {
      const copy = await duplicate.mutateAsync(id);
      toast.success(t("official.duplicateSuccess", { name: copy.name }));
      nav(`/quality-gate/evaluations/${copy.id}`);
    } catch (err) {
      toast.error(t("official.duplicateError", { message: (err as Error).message }));
    }
  }

  const breadcrumbs = [
    { label: tSidebar("groups.qualityGate") },
    {
      label: tSidebar("items.qualityGateEvaluations"),
      to: "/quality-gate/evaluations",
    },
    { label: data?.name ?? t("evaluations.form.editTitle") },
  ];

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

  const isOfficial = data.isOfficial;

  return (
    <>
      <PageHeader
        title={data.name}
        subtitle={t("evaluations.form.editSubtitle")}
        breadcrumbs={breadcrumbs}
        rightSlot={
          isOfficial ? (
            <Button onClick={handleDuplicate} disabled={duplicate.isPending}>
              <Copy className="mr-1 h-4 w-4" />
              {t("official.duplicateButton")}
            </Button>
          ) : undefined
        }
      />
      <Form {...form}>
        <form onSubmit={onSubmit}>
          <div className="space-y-6 px-8 py-6 pb-24">
            {isOfficial && (
              <Alert>
                <ShieldCheck className="h-4 w-4" />
                <AlertDescription>{t("official.readOnlyHint")}</AlertDescription>
              </Alert>
            )}
            {data.baselineRunId && (
              <PinnedBaselineCard evaluationId={data.id} baselineRunId={data.baselineRunId} />
            )}
            <fieldset
              disabled={isOfficial}
              className="space-y-6 disabled:opacity-100 disabled:cursor-default"
            >
              <FormSection title={t("evaluations.form.sectionBasics")}>
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>{t("evaluations.form.nameLabel")}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          readOnly={isOfficial}
                          placeholder={t("evaluations.form.namePlaceholder")}
                        />
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
                          readOnly={isOfficial}
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
                <SamplesTableEditor name="samples" readOnly={isOfficial} />
              </FormSection>
            </fieldset>
          </div>

          {!isOfficial && (
            <div className="sticky bottom-0 left-0 right-0 z-10 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
              <div className="px-8 py-3">
                <FormActions
                  onCancel={() => nav("/quality-gate/evaluations")}
                  cancelLabel={t("evaluations.form.cancel")}
                  submitLabel={t("evaluations.form.save")}
                  disabled={!form.formState.isValid}
                  pending={update.isPending}
                />
              </div>
            </div>
          )}
        </form>
      </Form>
    </>
  );
}
