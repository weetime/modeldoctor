import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
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
import { useConnections } from "@/features/connections/queries";
import { GENAI_PERF_CATEGORY_DEFAULTS } from "@modeldoctor/tool-adapters/schemas";
import type { GenaiPerfParams } from "@modeldoctor/tool-adapters/schemas";
import { useEffect, useId, useRef } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";

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
  const { control, register, setValue } = useFormContext();
  const streaming = useWatch({ control, name: `${fieldPrefix}.streaming` }) as boolean | undefined;

  const { t } = useTranslation("benchmarks");
  const connectionId = useWatch({ control, name: "connectionId" }) as string | undefined;
  const connections = useConnections();
  const connection = connectionId
    ? connections.data?.find((c) => c.id === connectionId)
    : undefined;

  const lastConnectionId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!connection) return;
    if (lastConnectionId.current === connection.id) return;
    lastConnectionId.current = connection.id;
    const def = GENAI_PERF_CATEGORY_DEFAULTS[connection.category];
    if ("endpointType" in def) {
      setValue(`${fieldPrefix}.endpointType`, def.endpointType, { shouldDirty: false });
    }
  }, [connection, fieldPrefix, setValue]);

  const unsupported =
    connection && "unsupported" in GENAI_PERF_CATEGORY_DEFAULTS[connection.category];

  const idPrefix = useId();
  const ids = {
    streaming: `${idPrefix}-streaming`,
    tokenizer: `${idPrefix}-tokenizer`,
  };

  return (
    <div className="space-y-4">
      {unsupported && connection && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {t("forms.unsupportedCategory.genaiPerf", { category: connection.category })}
        </p>
      )}
      <FormField
        control={control}
        name={`${fieldPrefix}.endpointType`}
        render={({ field }) => (
          <FormItem>
            <FormLabel>Endpoint type</FormLabel>
            <Select onValueChange={field.onChange} value={field.value ?? ""}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Select endpoint type" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {ENDPOINT_TYPES.map((t) => (
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
          name={`${fieldPrefix}.numPrompts`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Num prompts</FormLabel>
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
          name={`${fieldPrefix}.concurrency`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Concurrency</FormLabel>
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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FormField
          control={control}
          name={`${fieldPrefix}.inputTokensMean`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Input tokens mean</FormLabel>
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
              <FormDescription>Optional. Auto-derived from prompts when empty.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name={`${fieldPrefix}.inputTokensStddev`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Input tokens stddev</FormLabel>
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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FormField
          control={control}
          name={`${fieldPrefix}.outputTokensMean`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Output tokens mean</FormLabel>
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
              <FormDescription>Optional. Auto-derived from prompts when empty.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name={`${fieldPrefix}.outputTokensStddev`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Output tokens stddev</FormLabel>
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

      <details className="rounded-md border border-border bg-muted/20 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
          Advanced
        </summary>
        <div className="mt-3 space-y-4">
          <div className="flex items-center gap-3">
            <Switch
              id={ids.streaming}
              checked={streaming === true}
              onCheckedChange={(v) =>
                setValue(`${fieldPrefix}.streaming`, v, { shouldValidate: true })
              }
            />
            <Label htmlFor={ids.streaming}>Streaming</Label>
          </div>
          <div className="space-y-2">
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
      </details>
    </div>
  );
}
