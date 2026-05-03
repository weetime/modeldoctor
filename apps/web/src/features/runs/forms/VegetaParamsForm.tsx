import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { VegetaParams } from "@modeldoctor/tool-adapters/schemas";
import { useId } from "react";
import { useFormContext, useWatch } from "react-hook-form";

const API_TYPES: VegetaParams["apiType"][] = [
  "chat",
  "embeddings",
  "rerank",
  "images",
  "chat-vision",
  "chat-audio",
];

export function VegetaParamsForm() {
  const { register, setValue, control } = useFormContext();
  const apiType = useWatch({ control, name: "params.apiType" });

  const idPrefix = useId();
  const ids = {
    apiType: `${idPrefix}-apiType`,
    rate: `${idPrefix}-rate`,
    duration: `${idPrefix}-duration`,
  };

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor={ids.apiType}>API type</Label>
        <Select
          value={apiType ?? ""}
          onValueChange={(v) =>
            setValue("params.apiType", v as VegetaParams["apiType"], {
              shouldValidate: true,
            })
          }
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
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor={ids.rate}>Rate (req/s)</Label>
          <Input
            id={ids.rate}
            type="number"
            {...register("params.rate", { valueAsNumber: true })}
          />
        </div>
        <div>
          <Label htmlFor={ids.duration}>Duration (s)</Label>
          <Input
            id={ids.duration}
            type="number"
            {...register("params.duration", { valueAsNumber: true })}
          />
        </div>
      </div>
    </div>
  );
}
