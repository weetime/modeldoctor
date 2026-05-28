import { zodResolver } from "@hookform/resolvers/zod";
import { type CreateRunRequest, createRunRequestSchema } from "@modeldoctor/contracts";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { FormActions } from "@/components/common/form-actions";
import { FormSection } from "@/components/common/form-section";
import { PageHeader } from "@/components/common/page-header";
import { ConnectionPicker } from "@/components/connection/ConnectionPicker";
import { Button } from "@/components/ui/button";
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
import { BaselinePickerDialog } from "./components/BaselinePickerDialog";
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
    mode: "onChange",
    defaultValues: {
      evaluationId: "",
      endpointAId: "",
      endpointBId: undefined,
      baselineRunIdOverride: null,
      gateConfig: { passRateMin: 0.9 },
    },
  });

  const evaluationId = form.watch("evaluationId");
  const endpointAId = form.watch("endpointAId");
  const endpointBId = form.watch("endpointBId");
  const baselineOverride = form.watch("baselineRunIdOverride");

  // Baseline is opt-in: null = no comparison run, string = picked one.
  // Dual-endpoint via endpointBId is the other comparison path, mutually
  // exclusive at the contract level.
  const effectiveBaselineId = baselineOverride ?? null;
  const baselineModeActive = effectiveBaselineId !== null;

  // Single-endpoint is the default (industry mainstream: LangSmith / Braintrust
  // / Vellum all default to a single experiment / run, and add comparison
  // post-hoc). Dual-endpoint is opt-in via a + button.
  const [showEndpointB, setShowEndpointB] = useState(false);

  // Baseline mode forces single-endpoint: clear any B value AND collapse the
  // B section.
  useEffect(() => {
    if (baselineModeActive) {
      if (endpointBId) {
        form.setValue("endpointBId", undefined, { shouldDirty: true, shouldValidate: true });
      }
      if (showEndpointB) setShowEndpointB(false);
    }
  }, [baselineModeActive, endpointBId, form, showEndpointB]);

  // Auto-clear B when A is changed to the same connection (prevents the
  // schema refine "endpointAId !== endpointBId" from blocking the form
  // without any visible signal in the UI).
  useEffect(() => {
    if (endpointAId && endpointBId && endpointAId === endpointBId) {
      form.setValue("endpointBId", undefined, { shouldDirty: true, shouldValidate: true });
    }
  }, [endpointAId, endpointBId, form]);

  // Clear any baseline pick when user switches to a different evaluation —
  // a run from eval A can't be a baseline for eval B.
  useEffect(() => {
    if (baselineOverride != null) {
      form.setValue("baselineRunIdOverride", null, { shouldDirty: true, shouldValidate: true });
    }
    // biome-ignore lint/correctness/useExhaustiveDependencies: only react to evaluationId switch
  }, [evaluationId]);

  const [pickerOpen, setPickerOpen] = useState(false);

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
      <div className="space-y-6 px-8 py-6">
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
                {/* Endpoint B is opt-in: only render when user explicitly added it
                    via "+ Add comparison endpoint" AND we're not in baseline mode
                    (the contract refine forbids endpointB + baseline together). */}
                {!baselineModeActive && showEndpointB && (
                  <FormField
                    control={form.control}
                    name="endpointBId"
                    render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center justify-between">
                          <FormLabel>{t("runs.form.endpointB")}</FormLabel>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-auto p-0 text-xs text-muted-foreground hover:text-foreground"
                            onClick={() => {
                              form.setValue("endpointBId", undefined, {
                                shouldDirty: true,
                                shouldValidate: true,
                              });
                              setShowEndpointB(false);
                            }}
                          >
                            {t("runs.form.endpointBRemove")}
                          </Button>
                        </div>
                        <FormControl>
                          <ConnectionPicker
                            selectedConnectionId={field.value ?? null}
                            onSelect={(id) => field.onChange(id ?? undefined)}
                            allowManual={false}
                            excludeIds={endpointAId ? [endpointAId] : undefined}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>

              {/* Comparison-run picker — only available in single-endpoint mode.
                  Picking a historical run reuses its per-sample outputs as the
                  comparison side (no second endpoint call needed). */}
              {evaluationId && !endpointBId && (
                <div className="space-y-2">
                  {baselineModeActive ? (
                    <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm space-y-2">
                      <div className="font-medium">{t("runs.form.comparisonRunActive")}</div>
                      <div className="text-muted-foreground">
                        {t("runs.form.comparisonRunActiveBody", {
                          runId: effectiveBaselineId?.slice(0, 12),
                        })}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setPickerOpen(true)}
                        >
                          {t("runs.form.changeComparisonRunButton")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            form.setValue("baselineRunIdOverride", null, {
                              shouldDirty: true,
                              shouldValidate: true,
                            })
                          }
                        >
                          {t("runs.form.clearComparisonRunButton")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    !showEndpointB && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-auto px-0 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => setPickerOpen(true)}
                      >
                        {t("runs.form.pickComparisonRunButton")}
                      </Button>
                    )
                  )}
                </div>
              )}

              {!baselineModeActive && !showEndpointB && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-auto px-0 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setShowEndpointB(true)}
                >
                  {t("runs.form.endpointBAdd")}
                </Button>
              )}
            </FormSection>

            <FormSection title={t("runs.form.sectionGate")}>
              <GateConfigForm
                namePrefix="gateConfig"
                dual={(!!endpointBId && !!endpointAId) || baselineModeActive}
                maxRegressionsDisabledHint={
                  !endpointBId && !baselineModeActive
                    ? t("runs.form.maxRegressionsDisabledHint")
                    : undefined
                }
              />
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

        <BaselinePickerDialog
          evaluationId={evaluationId}
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          initialRunId={effectiveBaselineId}
          onPick={(runId) =>
            form.setValue("baselineRunIdOverride", runId, {
              shouldDirty: true,
              shouldValidate: true,
            })
          }
        />
      </div>
    </>
  );
}
