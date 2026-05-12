import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { EvaluationSample } from "@modeldoctor/contracts";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { EvaluationSampleEditor } from "./components/EvaluationSampleEditor";
import { useEvaluation, useUpdateEvaluation } from "./queries";

export function EvaluationDetailPage() {
  const { id = "" } = useParams();
  const { t } = useTranslation("quality-gate");
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

  if (!data) return null;

  return (
    <div className="p-6 max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">{data.name}</h1>
      <Input value={name} onChange={(e) => setName(e.target.value)} />
      <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />

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

      <Button onClick={() => update.mutate({ name, description: description || null, samples })}>
        {t("evaluations.form.save")}
      </Button>
    </div>
  );
}
