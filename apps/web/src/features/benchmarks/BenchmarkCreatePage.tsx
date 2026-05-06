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
  type CreateBenchmarkRequest,
  type ScenarioId,
  createBenchmarkRequestSchema,
  scenarioIdSchema,
} from "@modeldoctor/contracts";
import { useEffect } from "react";
import { useForm, useFormContext } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  TOOL_DEFAULTS,
  ToolParamsForm,
  ToolSelectorField,
  useToolUnsupported,
} from "./forms/ToolParamsEditor";
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

  const [params] = useSearchParams();
  const scenarioParam = params.get("scenario");
  const scenarioParse = scenarioIdSchema.safeParse(scenarioParam);
  const scenario: ScenarioId = scenarioParse.success ? scenarioParse.data : "inference";
  const defaultTool = SCENARIOS[scenario].tools[0];

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
      <PageHeader title={t(`create.titleByScenario.${scenario}`)} subtitle={t("create.subtitle")} />
      <div className="space-y-6 px-8 py-6">
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-6">
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

            <FormSection title={t("create.sections.endpoint")}>
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
            </FormSection>

            <FormSection title={t("create.sections.tool")}>
              <ToolSelectorField scenario={scenario} />
            </FormSection>

            <FormSection title={t("create.sections.parameters")}>
              <ToolParamsForm scenario={scenario} />
            </FormSection>

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
