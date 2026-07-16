import { zodResolver } from "@hookform/resolvers/zod";
import {
  type BenchmarkTemplate,
  type CreateBenchmarkRequest,
  createBenchmarkRequestSchema,
  type ScenarioId,
  scenarioIdSchema,
} from "@modeldoctor/contracts";
import type { ToolName as AdapterToolName } from "@modeldoctor/tool-adapters/schemas";
import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useForm, useFormContext } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { FormActions } from "@/components/common/form-actions";
import { PageHeader } from "@/components/common/page-header";
import { ConnectionPicker } from "@/components/connection/ConnectionPicker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useTemplate } from "@/features/benchmark-templates/queries";
import { useConnection } from "@/features/connections/queries";
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
}: {
  scenario: ScenarioId;
  pending: boolean;
  onCancel: () => void;
}) {
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
  const { t: tCommon } = useTranslation("common");
  const { t: tSidebar } = useTranslation("sidebar");
  const navigate = useNavigate();
  const createMut = useCreateBenchmark();

  const [params, setSearchParams] = useSearchParams();
  const scenarioParam = params.get("scenario");
  const scenarioParse = scenarioIdSchema.safeParse(scenarioParam);
  const scenario: ScenarioId = scenarioParse.success ? scenarioParse.data : "inference";
  // NOTE: `scenario` is contracts' ScenarioId (includes "omni"); SCENARIOS
  // (from @modeldoctor/tool-adapters) is still keyed by its own narrower
  // ScenarioId until the omni scenario is registered there. Safe today:
  // no picker offers "omni" yet, so this key is never actually "omni".
  const defaultTool = SCENARIOS[scenario as keyof typeof SCENARIOS].tools[0];
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
  const watchedConnectionId = form.watch("connectionId");
  const connectionQuery = useConnection(watchedConnectionId || null);
  const connectionCategory = connectionQuery.data?.category ?? null;
  const tplQuery = useTemplate(templateIdParam ?? undefined);
  const bannerTpl = useTemplate(watchedTemplateId ?? undefined);

  function applyTemplate(template: BenchmarkTemplate) {
    // Scenario mismatch: redirect URL so the page re-renders under the
    // template's scenario, then the prefill effect re-runs and applies the
    // template cleanly. URL stays the single source of truth for scenario.
    if (template.scenario !== scenario) {
      toast.warning(
        t("create.prefillFromTemplate.scenarioMismatch", { scenario: template.scenario }),
      );
      const next = new URLSearchParams(params);
      next.set("scenario", template.scenario);
      next.set("templateId", template.id);
      setSearchParams(next, { replace: true });
      return;
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

  // One-shot prefill from URL ?templateId=. Re-runs across a scenario change
  // so the redirect path in applyTemplate can land and reapply.
  const hasAppliedRef = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: applyTemplate is stable; we only want to run when template loads or scenario settles
  useEffect(() => {
    if (tplQuery.data && !hasAppliedRef.current) {
      applyTemplate(tplQuery.data);
      // Only consider it applied when scenarios actually matched — otherwise
      // applyTemplate redirected and we want the post-redirect render to retry.
      if (tplQuery.data.scenario === scenario) {
        hasAppliedRef.current = true;
      }
    }
  }, [tplQuery.data, scenario]);

  // 404 / fetch error: toast + drop the bad URL param
  // biome-ignore lint/correctness/useExhaustiveDependencies: params and setSearchParams are stable RouterDom returns; t is stable i18n; we only re-run when templateIdParam or fetch error state changes
  useEffect(() => {
    if (templateIdParam && tplQuery.isError) {
      toast.error(t("create.prefillFromTemplate.notFound"));
      const next = new URLSearchParams(params);
      next.delete("templateId");
      setSearchParams(next, { replace: true });
    }
  }, [templateIdParam, tplQuery.isError]);

  // Cascade guard: if the user changes connection after applying a template
  // and the new connection's category isn't covered by the template's
  // `categories`, fully unwind the template's prefill — clearing only
  // `templateId` leaves the template's params/name/description in the form
  // and the user could accidentally submit a config that doesn't fit the
  // endpoint. Reset to tool defaults (preserving tool/scenario/connectionId
  // because those drive the current page), and drop `?templateId=` from
  // the URL so a refresh doesn't immediately re-apply.
  // biome-ignore lint/correctness/useExhaustiveDependencies: form / params / setSearchParams are stable; we only re-run when category or template-id change
  useEffect(() => {
    if (!watchedTemplateId || !bannerTpl.data || !connectionCategory) return;
    if (!bannerTpl.data.categories.includes(connectionCategory)) {
      const currentTool = form.getValues("tool");
      form.reset({
        tool: currentTool,
        scenario,
        connectionId: form.getValues("connectionId") ?? "",
        name: "",
        description: undefined,
        // currentTool is contracts' (widened) BenchmarkTool; TOOL_DEFAULTS is
        // still keyed by tool-adapters' narrower ToolName until
        // vllm-omni-bench registers there. Safe today: this form never
        // reaches "vllm-omni-bench" (not offered in any tool picker yet).
        params: TOOL_DEFAULTS[currentTool as AdapterToolName] as Record<string, unknown>,
        templateId: undefined,
      });
      if (params.get("templateId")) {
        const next = new URLSearchParams(params);
        next.delete("templateId");
        setSearchParams(next, { replace: true });
      }
      toast.warning(
        t("create.prefillFromTemplate.categoryMismatch", {
          templateName: bannerTpl.data.name,
          category: connectionCategory,
        }),
      );
    }
  }, [connectionCategory, watchedTemplateId, bannerTpl.data]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const benchmark = await createMut.mutateAsync(values);
      toast.success(t("create.submitted", { name: benchmark.name }));
      navigate(`/benchmarks/${benchmark.id}`);
    } catch (e) {
      const err = e as { code?: string; message?: string; status?: number };
      toast.error(err.message ?? t("create.errors.submitFailed"));
    }
  });

  const SCENARIO_SIDEBAR_KEY: Record<ScenarioId, string> = {
    inference: "benchmarkInference",
    capacity: "benchmarkCapacity",
    gateway: "benchmarkGateway",
    "lb-strategy": "benchmarkPrefixCache",
    "engine-kv-cache": "benchmarkKvCacheStress",
    agent: "benchmarkAgent",
    // Sidebar copy for the omni scenario lands with the UI work
    // (later tasks); key follows the existing naming convention.
    omni: "benchmarkOmni",
  };
  const breadcrumbs = [
    { label: tSidebar("groups.benchmarks") },
    {
      label: tSidebar(`items.${SCENARIO_SIDEBAR_KEY[scenario]}`),
      to: `/benchmarks/${scenario}`,
    },
    { label: tCommon("actions.create") },
  ];

  return (
    <>
      <PageHeader
        title={t(`create.titleByScenario.${scenario}`)}
        subtitle={t("create.subtitle")}
        breadcrumbs={breadcrumbs}
        rightSlot={
          <PrefillFromTemplatePopover
            scenario={scenario}
            category={connectionCategory}
            onPick={applyTemplate}
          />
        }
      />
      <div className="space-y-6 px-8 py-6">
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-6">
            {watchedTemplateId && bannerTpl.data && (
              <div className="flex items-center justify-between rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
                <span>{t("create.prefilledBanner.label", { name: bannerTpl.data.name })}</span>
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
            {/* Top row: basic info (left) + target (right) — both info-light, paired
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
                        {connectionCategory && (
                          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <span>{t("create.fields.connectionCategoryHint")}</span>
                            <Badge variant="outline" className="text-xs">
                              {t(`create.prefillFromTemplate.categoryBadge.${connectionCategory}`, {
                                defaultValue: connectionCategory,
                              })}
                            </Badge>
                          </p>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {scenario === "agent" && (
                    <div className="space-y-1 rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-muted-foreground">
                      <p>{t("create.fields.agentToolCallHint")}</p>
                      <p>{t("create.fields.agentContextWindowHint")}</p>
                    </div>
                  )}
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
