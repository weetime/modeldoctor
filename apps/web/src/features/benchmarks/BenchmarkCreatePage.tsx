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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  type ConnectionPublic,
  type CreateBenchmarkRequest,
  type ModalityCategory,
  type ScenarioId,
  createBenchmarkRequestSchema,
  scenarioIdSchema,
} from "@modeldoctor/contracts";
import {
  GENAI_PERF_CATEGORY_DEFAULTS,
  GUIDELLM_CATEGORY_DEFAULTS,
  VEGETA_CATEGORY_DEFAULTS,
} from "@modeldoctor/tool-adapters/schemas";
import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { TOOL_DEFAULTS, ToolParamsForm, ToolSelectorField } from "./forms/ToolParamsEditor";
import { useCreateBenchmark } from "./queries";
import { SCENARIOS } from "./scenarios";

const TOOL_CATEGORY_DEFAULTS = {
  vegeta: VEGETA_CATEGORY_DEFAULTS,
  guidellm: GUIDELLM_CATEGORY_DEFAULTS,
  "genai-perf": GENAI_PERF_CATEGORY_DEFAULTS,
} as const;

/** Categories supported by ANY tool available in this scenario. A connection
 * whose category falls outside this set cannot be used to run any benchmark
 * in the scenario, so the picker disables it. */
function supportedCategoriesForScenario(scenario: ScenarioId): Set<ModalityCategory> {
  const out = new Set<ModalityCategory>();
  for (const tool of SCENARIOS[scenario].tools) {
    const map = TOOL_CATEGORY_DEFAULTS[tool];
    for (const cat of Object.keys(map) as ModalityCategory[]) {
      const def = map[cat];
      if (!("unsupported" in def)) out.add(cat);
    }
  }
  return out;
}

export function BenchmarkCreatePage() {
  const { t } = useTranslation("benchmarks");
  const { t: tc } = useTranslation("common");
  const navigate = useNavigate();
  const createMut = useCreateBenchmark();

  const [params] = useSearchParams();
  const scenarioParam = params.get("scenario");
  const scenarioParse = scenarioIdSchema.safeParse(scenarioParam);
  const scenario: ScenarioId = scenarioParse.success ? scenarioParse.data : "inference";
  const defaultTool = SCENARIOS[scenario].tools[0];

  const supported = useMemo(() => supportedCategoriesForScenario(scenario), [scenario]);
  const connectionDisabledReason = (c: ConnectionPublic): string | null =>
    supported.has(c.category)
      ? null
      : t("create.unsupportedCategoryForScenario", { category: c.category });

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
    });
  }, [scenario]);

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
      <PageHeader title={t("create.title")} subtitle={t("create.subtitle")} />
      <div className="space-y-6 px-8 py-6">
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-6">
            <FormSection title={t("create.sections.endpoint")}>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
                          disabledReason={connectionDisabledReason}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <ToolSelectorField scenario={scenario} />
              </div>
            </FormSection>

            <FormSection title={t("create.sections.metadata")}>
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
            </FormSection>

            <FormSection title={t("create.sections.parameters")}>
              <ToolParamsForm scenario={scenario} />
            </FormSection>

            <FormActions
              onCancel={() => navigate("/benchmarks")}
              cancelLabel={tc("actions.cancel")}
              submitLabel={t("actions.submit")}
              disabled={!form.formState.isValid}
              pending={createMut.isPending}
            />
          </form>
        </Form>
      </div>
    </>
  );
}
