import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { VegetaParams } from "@modeldoctor/tool-adapters/schemas";
import { useFormContext } from "react-hook-form";

const API_TYPES: VegetaParams["apiType"][] = [
  "chat",
  "embeddings",
  "rerank",
  "images",
  "chat-vision",
  "chat-audio",
];

interface VegetaParamsFormProps {
  fieldPrefix?: "params" | "config";
}

export function VegetaParamsForm({ fieldPrefix = "params" }: VegetaParamsFormProps = {}) {
  const { control } = useFormContext();

  return (
    <div className="space-y-4">
      <FormField
        control={control}
        name={`${fieldPrefix}.apiType`}
        render={({ field }) => (
          <FormItem>
            <FormLabel>API type</FormLabel>
            <Select onValueChange={field.onChange} value={field.value ?? ""}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Select API type" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {API_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FormField
          control={control}
          name={`${fieldPrefix}.rate`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Rate (req/s)</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  {...field}
                  value={field.value ?? ""}
                  onChange={(e) =>
                    field.onChange(e.target.value === "" ? undefined : Number(e.target.value))
                  }
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name={`${fieldPrefix}.duration`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Duration (s)</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  {...field}
                  value={field.value ?? ""}
                  onChange={(e) =>
                    field.onChange(e.target.value === "" ? undefined : Number(e.target.value))
                  }
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </div>
  );
}
