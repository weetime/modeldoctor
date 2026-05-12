import { FormSection } from "@/components/common/form-section";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { type EvaluationSample, evaluationSampleSchema } from "@modeldoctor/contracts";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { EvaluationSampleEditor } from "./components/EvaluationSampleEditor";
import { useEvaluation, useUpdateEvaluation } from "./queries";

export function EvaluationDetailPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const { t } = useTranslation("quality-gate");
  const { t: tSidebar } = useTranslation("sidebar");
  const { data } = useEvaluation(id);
  const update = useUpdateEvaluation(id);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [samples, setSamples] = useState<EvaluationSample[]>([]);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (data && !initialized) {
      setName(data.name);
      setDescription(data.description ?? "");
      setSamples(data.samples);
      setInitialized(true);
    }
  }, [data, initialized]);

  async function handleSave() {
    for (let i = 0; i < samples.length; i++) {
      const parsed = evaluationSampleSchema.safeParse({ ...samples[i], id: samples[i].id || "_" });
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        toast.error(
          t("evaluations.form.validationError", {
            idx: i + 1,
            message: `${issue.path.join(".") || "field"}: ${issue.message}`,
          }),
        );
        return;
      }
    }
    try {
      await update.mutateAsync({ name, description: description || null, samples });
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
    { label: data?.name ?? t("evaluations.form.editTitle") },
  ];

  if (!data) return null;

  return (
    <>
      <PageHeader
        title={data.name}
        subtitle={t("evaluations.form.editSubtitle")}
        breadcrumbs={breadcrumbs}
      />
      <div className="px-8 py-6 space-y-6">
        <FormSection title={t("evaluations.form.sectionBasics")}>
          <Input
            placeholder={t("evaluations.form.namePlaceholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Textarea
            placeholder={t("evaluations.form.descriptionPlaceholder")}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </FormSection>

        <FormSection title={t("evaluations.form.sectionSamples")}>
          <Button
            onClick={() =>
              setSamples([
                ...samples,
                {
                  id: "",
                  idx: samples.length,
                  prompt: "",
                  expected: "",
                  judgeConfig: { kind: "exact-match" },
                },
              ])
            }
          >
            {t("evaluations.form.addSample")}
          </Button>

          <div className="space-y-3">
            {samples.map((s, i) => (
              <EvaluationSampleEditor
                key={i}
                index={i}
                value={s}
                onChange={(v) => setSamples(samples.map((x, j) => (j === i ? v : x)))}
                onRemove={() => setSamples(samples.filter((_, j) => j !== i))}
              />
            ))}
          </div>
        </FormSection>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => nav("/quality-gate/evaluations")}>
            {t("evaluations.form.cancel")}
          </Button>
          <Button disabled={!name || samples.length === 0 || update.isPending} onClick={handleSave}>
            {update.isPending ? "…" : t("evaluations.form.save")}
          </Button>
        </div>
      </div>
    </>
  );
}
