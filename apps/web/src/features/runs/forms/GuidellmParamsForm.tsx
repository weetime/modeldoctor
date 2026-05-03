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

export function GuidellmParamsForm() {
  const { register, setValue, control } = useFormContext();
  const profile = useWatch({ control, name: "params.profile" });
  const apiType = useWatch({ control, name: "params.apiType" });
  const datasetName = useWatch({ control, name: "params.datasetName" });
  const validateBackend = useWatch({ control, name: "params.validateBackend" });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Profile</Label>
          <Select
            onValueChange={(v) =>
              setValue("params.profile", v as GuidellmParams["profile"], {
                shouldValidate: true,
              })
            }
            value={profile ?? ""}
          >
            <SelectTrigger aria-label="Profile">
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
          <Label>API type</Label>
          <Select
            onValueChange={(v) =>
              setValue("params.apiType", v as GuidellmParams["apiType"], {
                shouldValidate: true,
              })
            }
            value={apiType ?? ""}
          >
            <SelectTrigger aria-label="API type">
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
          <Label>Dataset</Label>
          <Select
            onValueChange={(v) =>
              setValue("params.datasetName", v as GuidellmParams["datasetName"], {
                shouldValidate: true,
              })
            }
            value={datasetName ?? ""}
          >
            <SelectTrigger aria-label="Dataset">
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
          <Label>Dataset seed (optional)</Label>
          <Input
            type="number"
            {...register("params.datasetSeed", {
              setValueAs: (v) => (v === "" || v === undefined ? undefined : Number(v)),
            })}
          />
        </div>
      </div>

      {datasetName === "random" && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Input tokens</Label>
            <Input
              type="number"
              aria-label="Input tokens"
              {...register("params.datasetInputTokens", { valueAsNumber: true })}
            />
          </div>
          <div>
            <Label>Output tokens</Label>
            <Input
              type="number"
              aria-label="Output tokens"
              {...register("params.datasetOutputTokens", { valueAsNumber: true })}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Request rate (0 = unlimited)</Label>
          <Input
            type="number"
            step="0.1"
            {...register("params.requestRate", { valueAsNumber: true })}
          />
        </div>
        <div>
          <Label>Total requests</Label>
          <Input
            type="number"
            aria-label="Total requests"
            {...register("params.totalRequests", { valueAsNumber: true })}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Max duration (s)</Label>
          <Input
            type="number"
            {...register("params.maxDurationSeconds", { valueAsNumber: true })}
          />
        </div>
        <div>
          <Label>Max concurrency</Label>
          <Input
            type="number"
            aria-label="Max concurrency"
            {...register("params.maxConcurrency", { valueAsNumber: true })}
          />
        </div>
      </div>

      <div>
        <Label>Processor (optional)</Label>
        <Input
          {...register("params.processor", {
            setValueAs: (v) => (v === "" || v === undefined ? undefined : v),
          })}
          placeholder="HuggingFace tokenizer name"
        />
      </div>

      <div className="flex items-center gap-3">
        <Switch
          checked={validateBackend === true}
          onCheckedChange={(v) => setValue("params.validateBackend", v, { shouldValidate: true })}
          aria-label="Validate backend"
        />
        <Label>Validate backend before run</Label>
      </div>
    </div>
  );
}
