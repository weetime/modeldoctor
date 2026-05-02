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

  return (
    <div className="space-y-4">
      <div>
        <Label>API type</Label>
        <Select
          value={apiType ?? ""}
          onValueChange={(v) =>
            setValue("params.apiType", v as VegetaParams["apiType"], {
              shouldValidate: true,
            })
          }
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
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Rate (req/s)</Label>
          <Input
            type="number"
            aria-label="Rate (req/s)"
            {...register("params.rate", { valueAsNumber: true })}
          />
        </div>
        <div>
          <Label>Duration (s)</Label>
          <Input
            type="number"
            aria-label="Duration (s)"
            {...register("params.duration", { valueAsNumber: true })}
          />
        </div>
      </div>
    </div>
  );
}
