import { FormActions } from "@/components/common/form-actions";
import { FormSection } from "@/components/common/form-section";
import { PageHeader } from "@/components/common/page-header";
import { ConnectionPicker } from "@/components/connection/ConnectionPicker";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { zodResolver } from "@hookform/resolvers/zod";
import { type CreateRunRequest, createRunRequestSchema } from "@modeldoctor/contracts";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { GateConfigForm } from "./components/GateConfigForm";
import { useCreateRun, useEvaluations } from "./queries";

export function RunCreatePage() {
  const nav = useNavigate();
  const { t } = useTranslation("quality-gate");
  const { t: tCommon } = useTranslation("common");
  const { t: tSidebar } = useTranslation("sidebar");
  const evaluations = useEvaluations();
  const create = useCreateRun();

  const form = useForm<CreateRunRequest>({
    resolver: zodResolver(createRunRequestSchema),
    mode: "onTouched",
    defaultValues: {
      evaluationId: "",
      endpointAId: "",
      endpointBId: undefined,
      gateConfig: { passRateMin: 0.9 },
    },
  });
  const endpointBId = form.watch("endpointBId");
  const endpointAId = form.watch("endpointAId");

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const run = await create.mutateAsync(values);
      nav(`/quality-gate/runs/${run.id}`);
    } catch (err) {
      toast.error(t("runs.form.saveError", { message: (err as Error).message }));
    }
  });

  const breadcrumbs = [
    { label: tSidebar("groups.qualityGate") },
    { label: tSidebar("items.qualityGateRuns"), to: "/quality-gate/runs" },
    { label: tCommon("actions.create") },
  ];

  return (
    <>
      <PageHeader
        title={t("runs.form.newTitle")}
        subtitle={t("runs.form.newSubtitle")}
        breadcrumbs={breadcrumbs}
      />
      <div className="px-8 py-6">
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-6">
            <FormSection title={t("runs.form.sectionTarget")}>
              <FormField
                control={form.control}
                name="evaluationId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t("runs.form.evaluationLabel")}</FormLabel>
                    <FormControl>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger>
                          <SelectValue placeholder={t("runs.form.evaluationPlaceholder")} />
                        </SelectTrigger>
                        <SelectContent>
                          {evaluations.data?.map((e) => (
                            <SelectItem key={e.id} value={e.id}>
                              {e.name} ({e.totalSamples})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="endpointAId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>{t("runs.form.endpointA")}</FormLabel>
                      <FormControl>
                        <ConnectionPicker
                          selectedConnectionId={field.value || null}
                          onSelect={(id) => field.onChange(id ?? "")}
                          allowManual={false}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="endpointBId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("runs.form.endpointB")}</FormLabel>
                      <FormControl>
                        <ConnectionPicker
                          selectedConnectionId={field.value ?? null}
                          onSelect={(id) => field.onChange(id ?? undefined)}
                          allowManual={false}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </FormSection>

            <FormSection title={t("runs.form.sectionGate")}>
              <GateConfigForm namePrefix="gateConfig" dual={!!endpointBId && !!endpointAId} />
            </FormSection>

            <FormActions
              onCancel={() => nav("/quality-gate/runs")}
              cancelLabel={t("evaluations.form.cancel")}
              submitLabel={t("runs.form.trigger")}
              disabled={!form.formState.isValid}
              pending={create.isPending}
            />
          </form>
        </Form>
      </div>
    </>
  );
}
