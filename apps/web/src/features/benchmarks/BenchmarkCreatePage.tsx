import { FormActions } from "@/components/common/form-actions";
import { PageHeader } from "@/components/common/page-header";
import { ConnectionPicker } from "@/components/connection/ConnectionPicker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  type BenchmarkTemplate,
  type CreateBenchmarkRequest,
  type ScenarioId,
  createBenchmarkRequestSchema,
  scenarioIdSchema,
} from "@modeldoctor/contracts";
import { useEffect, useRef } from "react";
import { useForm, useFormContext } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { X } from "lucide-react";
import { useTemplate } from "@/features/benchmark-templates/queries";
import {
  TOOL_DEFAULTS,
  ToolParamsForm,
  ToolSelectorField,
  useToolUnsupported,
} from "./forms/ToolParamsEditor";
import { PrefillFromTemplatePopover } from "./PrefillFromTemplatePopover";
import { useCreateBenchmark } from "./queries";
import { SCENARIOS } from "./scenarios";

/** Submit row — split out so it can use the same useFormContext + useToolUnsupported as the rest of the form. */
function SubmitRow({
  scenario,
  pending,
  onCancel,
}: { scenario: ScenarioId; pending: boolean; onCancel: () => void }) {
  const { t } = useTranslation("benchmarks");
  const { t: tc } = useTranslation("common");
  const { formState } = useFormContext();
  const unsupported = useToolUnsupported(scenario);
  return (
    <FormActions
      onCancel={onCancel}
      cancelLabel={tc("actions.cancel")}
      submitLabel={t("actions.submit")}
      disabled={!formState.isValid || unsupported !== null}
      pending={pending}
    />
  );
}

export function BenchmarkCreatePage() {
  const { t } = useTranslation("benchmarks");
  const navigate = useNavigate();
  const createMut = useCreateBenchmark();

  const [params, setSearchParams] = useSearchParams();
  const scenarioParam = params.get("scenario");
  const scenarioParse = scenarioIdSchema.safeParse(scenarioParam);
  const scenario: ScenarioId = scenarioParse.success ? scenarioParse.data : "inference";
  const defaultTool = SCENARIOS[scenario].tools[0];
  const templateIdParam = params.get("templateId");

  const form = useForm<CreateBenchmarkRequest>({
    resolver: zodResolver(createBenchmarkRequestSchema),
    mode: "onTouched",
    defaultValues: {
      tool: defaultTool,
      scenario,
      connectionId: "",
      name: "",
      description: undefined,
      params: TOOL_DEFAULTS[defaultTool] as Record<string, unknown>,
      templateId: undefined,
    },
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: form is stable, defaultTool is derived from scenario
  useEffect(() => {
    form.reset({
      tool: defaultTool,
      scenario,
      connectionId: "",
      name: "",
      description: undefined,
      params: TOOL_DEFAULTS[defaultTool] as Record<string, unknown>,
      templateId: undefined,
    });
  }, [scenario]);

  const watchedTemplateId = form.watch("templateId");
  const tplQuery = useTemplate(templateIdParam ?? undefined);
  const bannerTpl = useTemplate(watchedTemplateId ?? undefined);

  function applyTemplate(template: BenchmarkTemplate) {
    if (template.scenario !== scenario) {
      toast.warning(
        t("create.prefillFromTemplate.scenarioMismatch", { scenario: template.scenario }),
      );
    }
    form.reset({
      tool: template.tool,
      scenario: template.scenario,
      connectionId: form.getValues("connectionId") ?? "",
      name: template.name,
      description: template.description ?? undefined,
      params: template.config,
      templateId: template.id,
    });
    toast.info(t("create.prefillFromTemplate.applied", { name: template.name }));
  }

  // One-shot prefill from URL ?templateId=
  const hasAppliedRef = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: applyTemplate is stable; we only want to run when template loads
  useEffect(() => {
    if (tplQuery.data && !hasAppliedRef.current) {
      applyTemplate(tplQuery.data);
      hasAppliedRef.current = true;
    }
  }, [tplQuery.data]);

  // 404 / fetch error: toast + drop the bad URL param
  useEffect(() => {
    if (templateIdParam && tplQuery.isError) {
      toast.error(t("create.prefillFromTemplate.notFound"));
      const next = new URLSearchParams(params);
      next.delete("templateId");
      setSearchParams(next, { replace: true });
    }
  }, [templateIdParam, tplQuery.isError]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const body: CreateBenchmarkRequest = { ...values, scenario };
      const benchmark = await createMut.mutateAsync(body);
      toast.success(t("create.submitted", { name: benchmark.name }));
      navigate(`/benchmarks/${benchmark.id}`);
    } catch (e) {
      const err = e as { code?: string; message?: string; status?: number };
      toast.error(err.message ?? t("create.errors.submitFailed"));
    }
  });

  return (
    <>
      <PageHeader
        title={t(`create.titleByScenario.${scenario}`)}
        subtitle={t("create.subtitle")}
        rightSlot={<PrefillFromTemplatePopover scenario={scenario} onPick={applyTemplate} />}
      />
      <div className="space-y-6 px-8 py-6">
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-6">
            {watchedTemplateId && bannerTpl.data && (
              <div className="flex items-center justify-between rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
                <span>
                  {t("create.prefilledBanner.label", { name: bannerTpl.data.name })}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => form.setValue("templateId", undefined, { shouldDirty: true })}
                  className="gap-1"
                >
                  <X className="h-3.5 w-3.5" />
                  {t("create.prefilledBanner.clear")}
                </Button>
              </div>
            )}
            {/* Top row: 基本信息 (left) + 目标 (right) — both info-light, paired
             * for 2-col on md+. On small screens they stack naturally. */}
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("create.sections.metadata")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>{t("create.fields.name")}</FormLabel>
                        <FormControl>
                          <Input {...field} />
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
                        <FormLabel>{t("create.fields.description")}</FormLabel>
                        <FormControl>
                          <Textarea
                            rows={2}
                            {...field}
                            value={field.value ?? ""}
                            onChange={(e) =>
                              field.onChange(e.target.value === "" ? undefined : e.target.value)
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("create.sections.target")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <FormField
                    control={form.control}
                    name="connectionId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>
                          {t("create.fields.connection", { defaultValue: "Connection" })}
                        </FormLabel>
                        <FormControl>
                          <ConnectionPicker
                            selectedConnectionId={field.value || null}
                            onSelect={(id) =>
                              form.setValue("connectionId", id ?? "", { shouldValidate: true })
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <ToolSelectorField scenario={scenario} />
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("create.sections.parameters")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ToolParamsForm scenario={scenario} />
              </CardContent>
            </Card>

            <SubmitRow
              scenario={scenario}
              pending={createMut.isPending}
              onCancel={() => navigate("/benchmarks")}
            />
          </form>
        </Form>
      </div>
    </>
  );
}
