import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useConnections } from "@/features/connections/queries";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  type CreateBenchmarkRequest,
  type ScenarioId,
  createBenchmarkRequestSchema,
  scenarioIdSchema,
} from "@modeldoctor/contracts";
import { useEffect, useId } from "react";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { TOOL_DEFAULTS, ToolParamsEditor } from "./forms/ToolParamsEditor";
import { useCreateBenchmark } from "./queries";
import { SCENARIOS } from "./scenarios";

/**
 * Thin inline connection picker — lists the user's saved connections in a
 * <Select>. Used instead of the full EndpointPicker (which requires
 * endpoint: EndpointValues + onEndpointChange, designed for manual-entry
 * flows) because BenchmarkCreatePage only needs a saved-connection ID.
 */
function SavedConnectionPicker({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (id: string) => void;
}) {
  const { t } = useTranslation("connections");
  const { data: connections, isLoading } = useConnections();

  return (
    <Select value={value || "__none__"} onValueChange={(v) => onChange(v === "__none__" ? "" : v)}>
      <SelectTrigger id={id} aria-label="Connection">
        <SelectValue
          placeholder={
            isLoading
              ? "Loading…"
              : t("picker.placeholder", { defaultValue: "Select a connection" })
          }
        />
      </SelectTrigger>
      <SelectContent>
        {(connections ?? []).map((conn) => (
          <SelectItem key={conn.id} value={conn.id}>
            {conn.name} — {conn.baseUrl}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function BenchmarkCreatePage() {
  const { t } = useTranslation("benchmarks");
  const navigate = useNavigate();
  const createMut = useCreateBenchmark();
  const idPrefix = useId();
  const connectionFieldId = `${idPrefix}-connection`;
  const nameFieldId = `${idPrefix}-name`;
  const descFieldId = `${idPrefix}-desc`;

  // Phase 13: scenario comes from ?scenario=… in the URL. Invalid / missing
  // values fall back to "inference". The submit body forwards this scenario
  // (the contract requires it), and the tool dropdown is narrowed to
  // SCENARIOS[scenario].tools so callers can't pick an incompatible tool.
  const [params] = useSearchParams();
  const scenarioParam = params.get("scenario");
  const scenarioParse = scenarioIdSchema.safeParse(scenarioParam);
  const scenario: ScenarioId = scenarioParse.success ? scenarioParse.data : "inference";
  const defaultTool = SCENARIOS[scenario].tools[0];

  const form = useForm<CreateBenchmarkRequest>({
    resolver: zodResolver(createBenchmarkRequestSchema),
    mode: "onChange",
    defaultValues: {
      tool: defaultTool,
      scenario,
      connectionId: "",
      name: "",
      description: undefined,
      params: TOOL_DEFAULTS[defaultTool] as Record<string, unknown>,
    },
  });

  // Reset form defaults when the URL-driven scenario changes (e.g. browser
  // back/forward between ?scenario=inference and ?scenario=gateway). Without
  // this, defaultValues are only read at mount, so the form would keep a
  // stale tool/params combo and the readonly Tool indicator would show a
  // tool that doesn't match the URL — and the submit body would carry a
  // mismatched (tool, scenario) which the server rejects with
  // BENCHMARK_SCENARIO_TOOL_MISMATCH. Wiping any partial form data here is
  // acceptable UX: this page is a URL-driven flow.
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

  const connectionId = useWatch({ control: form.control, name: "connectionId" }) ?? "";

  function handleConnectionChange(next: string) {
    form.setValue("connectionId", next, { shouldValidate: true });
  }

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      // scenario is sourced from the URL (not the form), so the create body
      // overrides whatever the form may carry. Keeps a single source of truth.
      const body: CreateBenchmarkRequest = { ...values, scenario };
      const benchmark = await createMut.mutateAsync(body);
      toast.success(t("create.submitted", { name: benchmark.name ?? benchmark.id }));
      navigate(`/benchmarks/${benchmark.id}`);
    } catch (e) {
      const err = e as { code?: string; message?: string; status?: number };
      toast.error(err.message ?? t("create.errors.submitFailed"));
    }
  });

  const submitDisabled = !form.formState.isValid || createMut.isPending || !connectionId;

  return (
    <>
      <PageHeader title={t("create.title")} subtitle={t("create.subtitle")} />
      <div className="mx-auto max-w-3xl space-y-6 px-8 py-6">
        <FormProvider {...form}>
          <form onSubmit={onSubmit} className="space-y-6">
            {/* Endpoint section */}
            <section className="rounded-lg border border-border bg-card p-4">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {t("create.sections.endpoint")}
              </h2>
              <Label htmlFor={connectionFieldId} className="sr-only">
                {t("create.fields.connection", { defaultValue: "Connection" })}
              </Label>
              <SavedConnectionPicker
                id={connectionFieldId}
                value={connectionId}
                onChange={handleConnectionChange}
              />
            </section>

            <ToolParamsEditor scenario={scenario} />

            {/* Run metadata section */}
            <section className="rounded-lg border border-border bg-card p-4 space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {t("create.sections.metadata")}
              </h2>
              <div>
                <Label htmlFor={nameFieldId}>{t("create.fields.name")}</Label>
                <Input id={nameFieldId} {...form.register("name")} />
              </div>
              <div>
                <Label htmlFor={descFieldId}>{t("create.fields.description")}</Label>
                <Textarea
                  id={descFieldId}
                  rows={2}
                  {...form.register("description", {
                    setValueAs: (v) => (v === "" || v === undefined ? undefined : v),
                  })}
                />
              </div>
            </section>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => navigate("/benchmarks")}>
                {t("actions.cancel")}
              </Button>
              <Button type="submit" disabled={submitDisabled}>
                {createMut.isPending ? "…" : t("actions.submit")}
              </Button>
            </div>
          </form>
        </FormProvider>
      </div>
    </>
  );
}
