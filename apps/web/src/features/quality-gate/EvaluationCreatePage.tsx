import { zodResolver } from "@hookform/resolvers/zod";
import {
  type CreateEvaluationRequest,
  createEvaluationRequestSchema,
} from "@modeldoctor/contracts";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
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
import { SamplesTableEditor } from "./components/SamplesTableEditor";
import { useCreateEvaluation, useImportEvaluation } from "./queries";

const blankSample: CreateEvaluationRequest["samples"][number] = {
  prompt: "",
  expected: "",
  judgeConfig: { kind: "exact-match" },
};

export function EvaluationCreatePage() {
  const nav = useNavigate();
  const { t } = useTranslation("quality-gate");
  const { t: tSidebar } = useTranslation("sidebar");
  const { t: tCommon } = useTranslation("common");
  const create = useCreateEvaluation();
  const importIt = useImportEvaluation();

  const form = useForm<CreateEvaluationRequest>({
    resolver: zodResolver(createEvaluationRequestSchema),
    mode: "onChange",
    defaultValues: {
      name: "",
      description: null,
      samples: [blankSample],
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const res = await create.mutateAsync(values);
      nav(`/quality-gate/evaluations/${res.id}`);
    } catch (err) {
      toast.error(t("evaluations.form.saveError", { message: (err as Error).message }));
    }
  });

  async function handleJsonImport(file: File) {
    const text = await file.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      toast.error(t("evaluations.form.jsonParseError"));
      return;
    }
    try {
      const res = await importIt.mutateAsync({
        name: form.getValues("name") || file.name.replace(/\.json$/, ""),
        import: { format: "json", payload: payload as never },
      });
      nav(`/quality-gate/evaluations/${res.id}`);
    } catch (err) {
      toast.error(t("evaluations.form.saveError", { message: (err as Error).message }));
    }
  }

  async function handleCsvImport(file: File) {
    const text = await file.text();
    try {
      const res = await importIt.mutateAsync({
        name: form.getValues("name") || file.name.replace(/\.csv$/, ""),
        import: { format: "csv", payload: text },
      });
      nav(`/quality-gate/evaluations/${res.id}`);
    } catch (err) {
      toast.error(t("evaluations.form.saveError", { message: (err as Error).message }));
    }
  }

  const breadcrumbs = [
    { label: tSidebar("groups.qualityGate") },
    {
      label: tSidebar("items.qualityGateEvaluations"),
      to: "/quality-gate/evaluations",
    },
    { label: tCommon("actions.create") },
  ];

  const importButtons = (
    <>
      <label className="inline-flex">
        <input
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => e.target.files && handleJsonImport(e.target.files[0])}
        />
        <Button type="button" variant="outline" size="sm" asChild>
          <span>{t("evaluations.form.importJson")}</span>
        </Button>
      </label>
      <label className="inline-flex">
        <input
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(e) => e.target.files && handleCsvImport(e.target.files[0])}
        />
        <Button type="button" variant="outline" size="sm" asChild>
          <span>{t("evaluations.form.importCsv")}</span>
        </Button>
      </label>
    </>
  );

  return (
    <>
      <PageHeader
        title={t("evaluations.form.newTitle")}
        subtitle={t("evaluations.form.createSubtitle")}
        breadcrumbs={breadcrumbs}
      />
      <Form {...form}>
        <form onSubmit={onSubmit}>
          <div className="space-y-6 px-8 py-6 pb-24">
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
              <SamplesTableEditor name="samples" trailingActions={importButtons} />
            </FormSection>
          </div>

          <div className="sticky bottom-0 left-0 right-0 z-10 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <div className="px-8 py-3">
              <FormActions
                onCancel={() => nav("/quality-gate/evaluations")}
                cancelLabel={t("evaluations.form.cancel")}
                submitLabel={t("evaluations.form.save")}
                disabled={!form.formState.isValid}
                pending={create.isPending}
              />
            </div>
          </div>
        </form>
      </Form>
    </>
  );
}
