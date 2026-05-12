import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { EvaluationSample } from "@modeldoctor/contracts";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
    const res = await importIt.mutateAsync({
      name: name || file.name.replace(/\.json$/, ""),
      import: { format: "json", payload: payload as never },
    });
    nav(`/quality-gate/evaluations/${res.id}`);
  }

  async function handleCsvImport(file: File) {
    const text = await file.text();
    const res = await importIt.mutateAsync({
      name: name || file.name.replace(/\.csv$/, ""),
      import: { format: "csv", payload: text },
    });
    nav(`/quality-gate/evaluations/${res.id}`);
  }

  return (
    <div className="p-6 max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">{t("evaluations.form.newTitle")}</h1>

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

      <Button
        disabled={!name || samples.length === 0}
        onClick={async () => {
          const res = await create.mutateAsync({
            name,
            description: description || null,
            samples,
          });
          nav(`/quality-gate/evaluations/${res.id}`);
        }}
      >
        {t("evaluations.form.save")}
      </Button>
    </div>
  );
}
