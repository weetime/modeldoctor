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
import type { GuidellmParams } from "@modeldoctor/tool-adapters/schemas";
import { useId } from "react";
import { useFormContext, useWatch } from "react-hook-form";

const PROFILES: GuidellmParams["profile"][] = [
  "throughput",
  "latency",
  "long_context",
  "generation_heavy",
  "sharegpt",
  "custom",
];

const API_TYPES: GuidellmParams["apiType"][] = ["chat", "completion"];
const DATASETS: GuidellmParams["datasetName"][] = ["random", "sharegpt"];

interface GuidellmParamsFormProps {
  fieldPrefix?: "params" | "config";
}

export function GuidellmParamsForm({ fieldPrefix = "params" }: GuidellmParamsFormProps = {}) {
  const { register, setValue, control } = useFormContext();
  const profile = useWatch({ control, name: `${fieldPrefix}.profile` });
  const apiType = useWatch({ control, name: `${fieldPrefix}.apiType` });
  const datasetName = useWatch({ control, name: `${fieldPrefix}.datasetName` });
  const validateBackend = useWatch({ control, name: `${fieldPrefix}.validateBackend` });

  const idPrefix = useId();
  const ids = {
    profile: `${idPrefix}-profile`,
    apiType: `${idPrefix}-apiType`,
    dataset: `${idPrefix}-dataset`,
    seed: `${idPrefix}-seed`,
    inputTokens: `${idPrefix}-inputTokens`,
    outputTokens: `${idPrefix}-outputTokens`,
    requestRate: `${idPrefix}-requestRate`,
    totalRequests: `${idPrefix}-totalRequests`,
    maxDuration: `${idPrefix}-maxDuration`,
    maxConcurrency: `${idPrefix}-maxConcurrency`,
    processor: `${idPrefix}-processor`,
    validateBackend: `${idPrefix}-validateBackend`,
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor={ids.profile}>Profile</Label>
          <Select
            onValueChange={(v) =>
              setValue(`${fieldPrefix}.profile`, v as GuidellmParams["profile"], {
                shouldValidate: true,
              })
            }
            value={profile ?? ""}
          >
            <SelectTrigger id={ids.profile}>
              <SelectValue placeholder="Select profile" />
            </SelectTrigger>
            <SelectContent>
              {PROFILES.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor={ids.apiType}>API type</Label>
          <Select
            onValueChange={(v) =>
              setValue(`${fieldPrefix}.apiType`, v as GuidellmParams["apiType"], {
                shouldValidate: true,
              })
            }
            value={apiType ?? ""}
          >
            <SelectTrigger id={ids.apiType}>
              <SelectValue placeholder="Select API type" />
            </SelectTrigger>
            <SelectContent>
              {API_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor={ids.dataset}>Dataset</Label>
          <Select
            onValueChange={(v) =>
              setValue(`${fieldPrefix}.datasetName`, v as GuidellmParams["datasetName"], {
                shouldValidate: true,
              })
            }
            value={datasetName ?? ""}
          >
            <SelectTrigger id={ids.dataset}>
              <SelectValue placeholder="Select dataset" />
            </SelectTrigger>
            <SelectContent>
              {DATASETS.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor={ids.seed}>Dataset seed (optional)</Label>
          <Input
            id={ids.seed}
            type="number"
            {...register(`${fieldPrefix}.datasetSeed`, {
              setValueAs: (v) => (v === "" || v === undefined ? undefined : Number(v)),
            })}
          />
        </div>
      </div>

      {datasetName === "random" && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor={ids.inputTokens}>Input tokens</Label>
            <Input
              id={ids.inputTokens}
              type="number"
              {...register(`${fieldPrefix}.datasetInputTokens`, { valueAsNumber: true })}
            />
          </div>
          <div>
            <Label htmlFor={ids.outputTokens}>Output tokens</Label>
            <Input
              id={ids.outputTokens}
              type="number"
              {...register(`${fieldPrefix}.datasetOutputTokens`, { valueAsNumber: true })}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor={ids.requestRate}>Request rate (0 = unlimited)</Label>
          <Input
            id={ids.requestRate}
            type="number"
            step="0.1"
            {...register(`${fieldPrefix}.requestRate`, { valueAsNumber: true })}
          />
        </div>
        <div>
          <Label htmlFor={ids.totalRequests}>Total requests</Label>
          <Input
            id={ids.totalRequests}
            type="number"
            {...register(`${fieldPrefix}.totalRequests`, { valueAsNumber: true })}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor={ids.maxDuration}>Max duration (s)</Label>
          <Input
            id={ids.maxDuration}
            type="number"
            {...register(`${fieldPrefix}.maxDurationSeconds`, { valueAsNumber: true })}
          />
        </div>
        <div>
          <Label htmlFor={ids.maxConcurrency}>Max concurrency</Label>
          <Input
            id={ids.maxConcurrency}
            type="number"
            {...register(`${fieldPrefix}.maxConcurrency`, { valueAsNumber: true })}
          />
        </div>
      </div>

      <div>
        <Label htmlFor={ids.processor}>Processor (optional)</Label>
        <Input
          id={ids.processor}
          {...register(`${fieldPrefix}.processor`, {
            setValueAs: (v) => (v === "" || v === undefined ? undefined : v),
          })}
          placeholder="HuggingFace tokenizer name"
        />
      </div>

      <div className="flex items-center gap-3">
        <Switch
          id={ids.validateBackend}
          checked={validateBackend === true}
          onCheckedChange={(v) => setValue(`${fieldPrefix}.validateBackend`, v, { shouldValidate: true })}
        />
        <Label htmlFor={ids.validateBackend}>Validate backend before run</Label>
      </div>
    </div>
  );
}
