import { zodResolver } from "@hookform/resolvers/zod";
import {
  type CreateBenchmarkTemplateRequest,
  createBenchmarkTemplateRequestSchema,
  type ScenarioId,
  scenarioIdSchema,
} from "@modeldoctor/contracts";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { FormActions } from "@/components/common/form-actions";
import { PageHeader } from "@/components/common/page-header";
import { Form } from "@/components/ui/form";
import { TOOL_DEFAULTS } from "@/features/benchmarks/forms/ToolParamsEditor";
import { SCENARIOS } from "@/features/benchmarks/scenarios";
import { useAuthStore } from "@/stores/auth-store";
import { useCreateTemplate } from "./queries";
import { TemplateForm } from "./TemplateForm";

export function TemplateCreatePage() {
  const { t } = useTranslation("benchmark-templates");
  const { t: tc } = useTranslation("common");
  const { t: tSidebar } = useTranslation("sidebar");
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const user = useAuthStore((s) => s.user);
  const isAdmin = (user?.roles ?? []).includes("admin");
  const createMut = useCreateTemplate();

  const scenarioParam = params.get("scenario");
  const scenarioParse = scenarioIdSchema.safeParse(scenarioParam);
  const scenario: ScenarioId = scenarioParse.success ? scenarioParse.data : "inference";
  // `scenario` is contracts' ScenarioId; SCENARIOS (from
  // @modeldoctor/tool-adapters) is keyed by tool-adapters' own ScenarioId,
  // which is the same 7-value union as of the omni scenario's registration
  // there — no cast needed.
  const tool = SCENARIOS[scenario].tools[0];

  const form = useForm<CreateBenchmarkTemplateRequest>({
    resolver: zodResolver(createBenchmarkTemplateRequestSchema),
    mode: "onTouched",
    defaultValues: {
      name: "",
      description: undefined,
      scenario,
      tool,
      config: TOOL_DEFAULTS[tool] as Record<string, unknown>,
      isOfficial: false,
      tags: [],
      // categories defaults to ["chat"] in the schema; the create-template
      // UI does not yet expose a category picker (follow-up work). For now
      // every user-created template targets chat connections.
      categories: ["chat"],
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const created = await createMut.mutateAsync(values);
      toast.success(t("create.submitted", { name: created.name }));
      navigate(`/benchmark-templates?scenario=${created.scenario}`);
    } catch (e) {
      toast.error((e as Error).message ?? t("create.errors.submitFailed"));
    }
  });

  const breadcrumbs = [
    { label: tSidebar("groups.benchmarks") },
    { label: tSidebar("items.benchmarkTemplates"), to: "/benchmark-templates" },
    { label: tc("actions.create") },
  ];

  return (
    <>
      <PageHeader
        title={t("create.title")}
        subtitle={t("create.subtitle")}
        breadcrumbs={breadcrumbs}
      />
      <div className="px-8 py-6">
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-6">
            <TemplateForm mode="create" isAdmin={isAdmin} />
            <FormActions
              onCancel={() => navigate("/benchmark-templates")}
              cancelLabel={tc("actions.cancel")}
              submitLabel={t("actions.save")}
              disabled={!form.formState.isValid}
              pending={createMut.isPending}
            />
          </form>
        </Form>
      </div>
    </>
  );
}
