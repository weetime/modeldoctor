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
import { type CreateRunRequest, createRunRequestSchema } from "@modeldoctor/contracts";
import {
  genaiPerfParamDefaults,
  guidellmParamDefaults,
  vegetaParamDefaults,
} from "@modeldoctor/tool-adapters/schemas";
import type { ToolName } from "@modeldoctor/tool-adapters/schemas";
import { useId } from "react";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { GenaiPerfParamsForm } from "./forms/GenaiPerfParamsForm";
import { GuidellmParamsForm } from "./forms/GuidellmParamsForm";
import { VegetaParamsForm } from "./forms/VegetaParamsForm";
import { useCreateRun } from "./queries";

const TOOL_DEFAULTS: Record<ToolName, unknown> = {
  guidellm: guidellmParamDefaults,
  vegeta: vegetaParamDefaults,
  "genai-perf": genaiPerfParamDefaults,
};

const TOOLS: ToolName[] = ["guidellm", "vegeta", "genai-perf"];

/**
 * Thin inline connection picker — lists the user's saved connections in a
 * <Select>. Used instead of the full EndpointPicker (which requires
 * endpoint: EndpointValues + onEndpointChange, designed for manual-entry
 * flows) because RunCreatePage only needs a saved-connection ID.
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

export function RunCreatePage() {
  const { t } = useTranslation("runs");
  const navigate = useNavigate();
  const createMut = useCreateRun();
  const idPrefix = useId();
  const connectionFieldId = `${idPrefix}-connection`;
  const toolFieldId = `${idPrefix}-tool`;
  const nameFieldId = `${idPrefix}-name`;
  const descFieldId = `${idPrefix}-desc`;

  const form = useForm<CreateRunRequest>({
    resolver: zodResolver(createRunRequestSchema),
    mode: "onChange",
    defaultValues: {
      tool: "guidellm",
      kind: "benchmark",
      connectionId: "",
      name: "",
      description: undefined,
      params: TOOL_DEFAULTS.guidellm as Record<string, unknown>,
    },
  });

  // Single source of truth: form state. useWatch keeps the section render +
  // tool-specific subform in sync without a duplicate useState/useEffect pair.
  const tool = (useWatch({ control: form.control, name: "tool" }) ?? "guidellm") as ToolName;
  const connectionId = useWatch({ control: form.control, name: "connectionId" }) ?? "";

  function handleToolChange(next: ToolName) {
    form.reset({
      ...form.getValues(),
      tool: next,
      params: TOOL_DEFAULTS[next] as Record<string, unknown>,
    });
  }

  function handleConnectionChange(next: string) {
    form.setValue("connectionId", next, { shouldValidate: true });
  }

  const ParamsForm =
    tool === "guidellm"
      ? GuidellmParamsForm
      : tool === "vegeta"
        ? VegetaParamsForm
        : GenaiPerfParamsForm;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const run = await createMut.mutateAsync(values);
      toast.success(t("create.submitted", { name: run.name ?? run.id }));
      navigate(`/runs/${run.id}`);
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

            {/* Tool section */}
            <section className="rounded-lg border border-border bg-card p-4">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {t("create.sections.tool")}
              </h2>
              <div className="max-w-xs">
                <Label htmlFor={toolFieldId}>{t("create.fields.tool")}</Label>
                <Select value={tool} onValueChange={(v) => handleToolChange(v as ToolName)}>
                  <SelectTrigger id={toolFieldId} aria-label="Tool">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TOOLS.map((tn) => (
                      <SelectItem key={tn} value={tn}>
                        {t(`create.tools.${tn}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </section>

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

            {/* Parameters section */}
            <section className="rounded-lg border border-border bg-card p-4">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {t("create.sections.parameters")}
              </h2>
              <ParamsForm />
            </section>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => navigate("/runs")}>
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
