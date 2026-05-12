import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { EvaluationSample } from "@modeldoctor/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EvaluationSampleEditor } from "./components/EvaluationSampleEditor";
import { useEvaluation, useUpdateEvaluation } from "./queries";

export function EvaluationDetailPage() {
  const { id = "" } = useParams();
  const { data } = useEvaluation(id);
  const update = useUpdateEvaluation(id);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [samples, setSamples] = useState<EvaluationSample[]>([]);

  useEffect(() => {
    if (data) {
      setName(data.name);
      setDescription(data.description ?? "");
      setSamples(data.samples);
    }
  }, [data]);

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
        添加样本
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

      <Button
        onClick={() => update.mutate({ name, description: description || null, samples })}
      >
        保存
      </Button>
    </div>
  );
}
