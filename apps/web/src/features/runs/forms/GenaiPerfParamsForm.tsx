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
import { useFormContext, useWatch } from "react-hook-form";

const ENDPOINT_TYPES: GenaiPerfParams["endpointType"][] = [
  "chat",
  "completions",
  "embeddings",
  "rankings",
];

export function GenaiPerfParamsForm() {
  const { register, setValue, control } = useFormContext();
  const endpointType = useWatch({ control, name: "params.endpointType" });
  const streaming = useWatch({ control, name: "params.streaming" });

  return (
    <div className="space-y-4">
      <div>
        <Label>Endpoint type</Label>
        <Select
          value={endpointType ?? ""}
          onValueChange={(v) =>
            setValue("params.endpointType", v as GenaiPerfParams["endpointType"], {
              shouldValidate: true,
            })
          }
        >
          <SelectTrigger aria-label="Endpoint type">
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
          <Label>Num prompts</Label>
          <Input
            type="number"
            aria-label="Num prompts"
            {...register("params.numPrompts", { valueAsNumber: true })}
          />
        </div>
        <div>
          <Label>Concurrency</Label>
          <Input
            type="number"
            aria-label="Concurrency"
            {...register("params.concurrency", { valueAsNumber: true })}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Input tokens mean (optional)</Label>
          <Input
            type="number"
            {...register("params.inputTokensMean", {
              setValueAs: (v) => (v === "" || v === undefined ? undefined : Number(v)),
            })}
          />
        </div>
        <div>
          <Label>Input tokens stddev</Label>
          <Input
            type="number"
            {...register("params.inputTokensStddev", { valueAsNumber: true })}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Output tokens mean (optional)</Label>
          <Input
            type="number"
            {...register("params.outputTokensMean", {
              setValueAs: (v) => (v === "" || v === undefined ? undefined : Number(v)),
            })}
          />
        </div>
        <div>
          <Label>Output tokens stddev</Label>
          <Input
            type="number"
            {...register("params.outputTokensStddev", { valueAsNumber: true })}
          />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Switch
          checked={streaming === true}
          onCheckedChange={(v) =>
            setValue("params.streaming", v, { shouldValidate: true })
          }
          aria-label="Streaming"
        />
        <Label>Streaming</Label>
      </div>
    </div>
  );
}
