import { FormSection } from "@/components/common/form-section";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { type EvaluationSample, evaluationSampleSchema } from "@modeldoctor/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { EvaluationSampleEditor } from "./components/EvaluationSampleEditor";
import { useCreateEvaluation, useImportEvaluation } from "./queries";

const blank = (idx: number): EvaluationSample => ({
  id: "",
  idx,
  prompt: "",
  expected: "",
  judgeConfig: { kind: "exact-match" },
});

export function EvaluationCreatePage() {
  const nav = useNavigate();
  const { t } = useTranslation("quality-gate");
  const { t: tSidebar } = useTranslation("sidebar");
  const { t: tCommon } = useTranslation("common");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [samples, setSamples] = useState<EvaluationSample[]>([blank(0)]);
  const create = useCreateEvaluation();
  const importIt = useImportEvaluation();

  async function handleJsonImport(file: File) {
    const text = await file.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      toast.error(t("evaluations.form.jsonParseError"));
      return;
    }
    try {
      const res = await importIt.mutateAsync({
        name: name || file.name.replace(/\.json$/, ""),
        import: { format: "json", payload: payload as never },
      });
      nav(`/quality-gate/evaluations/${res.id}`);
    } catch (err) {
      toast.error(t("evaluations.form.saveError", { message: (err as Error).message }));
    }
  }

  async function handleCsvImport(file: File) {
    const text = await file.text();
    try {
      const res = await importIt.mutateAsync({
        name: name || file.name.replace(/\.csv$/, ""),
        import: { format: "csv", payload: text },
      });
      nav(`/quality-gate/evaluations/${res.id}`);
    } catch (err) {
      toast.error(t("evaluations.form.saveError", { message: (err as Error).message }));
    }
  }

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
      const res = await create.mutateAsync({
        name,
        description: description || null,
        samples,
      });
      nav(`/quality-gate/evaluations/${res.id}`);
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
    { label: tCommon("actions.create") },
  ];

  return (
    <>
      <PageHeader
        title={t("evaluations.form.newTitle")}
        subtitle={t("evaluations.form.createSubtitle")}
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
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setSamples([...samples, blank(samples.length)])}>
              {t("evaluations.form.addSample")}
            </Button>
            <label className="inline-flex">
              <input
                type="file"
                accept=".json,application/json"
                hidden
                onChange={(e) => e.target.files && handleJsonImport(e.target.files[0])}
              />
              <Button variant="outline" asChild>
                <span>{t("evaluations.form.importJson")}</span>
              </Button>
            </label>
            <label className="inline-flex">
              <input
                type="file"
                accept=".csv,text/csv"
                hidden
                onChange={(e) => e.target.files && handleCsvImport(e.target.files[0])}
              />
              <Button variant="outline" asChild>
                <span>{t("evaluations.form.importCsv")}</span>
              </Button>
            </label>
          </div>

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
          <Button disabled={!name || samples.length === 0 || create.isPending} onClick={handleSave}>
            {create.isPending ? "…" : t("evaluations.form.save")}
          </Button>
        </div>
      </div>
    </>
  );
}
