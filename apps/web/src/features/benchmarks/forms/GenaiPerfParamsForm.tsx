import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { GenaiPerfParams } from "@modeldoctor/tool-adapters/schemas";
import { useId } from "react";
import { useFormContext, useWatch } from "react-hook-form";

const ENDPOINT_TYPES: GenaiPerfParams["endpointType"][] = [
  "chat",
  "completions",
  "embeddings",
  "rankings",
];

interface GenaiPerfParamsFormProps {
  fieldPrefix?: "params" | "config";
}

export function GenaiPerfParamsForm({ fieldPrefix = "params" }: GenaiPerfParamsFormProps = {}) {
  const { register, setValue, control } = useFormContext();
  const endpointType = useWatch({ control, name: `${fieldPrefix}.endpointType` });
  const streaming = useWatch({ control, name: `${fieldPrefix}.streaming` });

  const idPrefix = useId();
  const ids = {
    endpointType: `${idPrefix}-endpointType`,
    numPrompts: `${idPrefix}-numPrompts`,
    concurrency: `${idPrefix}-concurrency`,
    inputTokensMean: `${idPrefix}-inputTokensMean`,
    inputTokensStddev: `${idPrefix}-inputTokensStddev`,
    outputTokensMean: `${idPrefix}-outputTokensMean`,
    outputTokensStddev: `${idPrefix}-outputTokensStddev`,
    streaming: `${idPrefix}-streaming`,
    tokenizer: `${idPrefix}-tokenizer`,
  };

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor={ids.endpointType}>Endpoint type</Label>
        <Select
          value={endpointType ?? ""}
          onValueChange={(v) =>
            setValue(`${fieldPrefix}.endpointType`, v as GenaiPerfParams["endpointType"], {
              shouldValidate: true,
            })
          }
        >
          <SelectTrigger id={ids.endpointType}>
            <SelectValue placeholder="Select endpoint type" />
          </SelectTrigger>
          <SelectContent>
            {ENDPOINT_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor={ids.numPrompts}>Num prompts</Label>
          <Input
            id={ids.numPrompts}
            type="number"
            {...register(`${fieldPrefix}.numPrompts`, { valueAsNumber: true })}
          />
        </div>
        <div>
          <Label htmlFor={ids.concurrency}>Concurrency</Label>
          <Input
            id={ids.concurrency}
            type="number"
            {...register(`${fieldPrefix}.concurrency`, { valueAsNumber: true })}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor={ids.inputTokensMean}>Input tokens mean (optional)</Label>
          <Input
            id={ids.inputTokensMean}
            type="number"
            {...register(`${fieldPrefix}.inputTokensMean`, {
              setValueAs: (v) => (v === "" || v === undefined ? undefined : Number(v)),
            })}
          />
        </div>
        <div>
          <Label htmlFor={ids.inputTokensStddev}>Input tokens stddev</Label>
          <Input
            id={ids.inputTokensStddev}
            type="number"
            {...register(`${fieldPrefix}.inputTokensStddev`, { valueAsNumber: true })}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor={ids.outputTokensMean}>Output tokens mean (optional)</Label>
          <Input
            id={ids.outputTokensMean}
            type="number"
            {...register(`${fieldPrefix}.outputTokensMean`, {
              setValueAs: (v) => (v === "" || v === undefined ? undefined : Number(v)),
            })}
          />
        </div>
        <div>
          <Label htmlFor={ids.outputTokensStddev}>Output tokens stddev</Label>
          <Input
            id={ids.outputTokensStddev}
            type="number"
            {...register(`${fieldPrefix}.outputTokensStddev`, { valueAsNumber: true })}
          />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Switch
          id={ids.streaming}
          checked={streaming === true}
          onCheckedChange={(v) => setValue(`${fieldPrefix}.streaming`, v, { shouldValidate: true })}
        />
        <Label htmlFor={ids.streaming}>Streaming</Label>
      </div>
      <div>
        <Label htmlFor={ids.tokenizer}>Tokenizer (HuggingFace id, optional)</Label>
        <Input
          id={ids.tokenizer}
          {...register(`${fieldPrefix}.tokenizer`, {
            setValueAs: (v) => (v === "" || v === undefined ? undefined : v),
          })}
          placeholder="Overrides connection-level default; leave empty to use it."
        />
      </div>
    </div>
  );
}
