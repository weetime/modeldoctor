import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useConnections } from "@/features/connections/queries";
import {
  VEGETA_API_TYPE_TO_BODY,
  VEGETA_API_TYPE_TO_PATH,
  VEGETA_CATEGORY_DEFAULTS,
} from "@modeldoctor/tool-adapters/schemas";
import type { VegetaParams } from "@modeldoctor/tool-adapters/schemas";
import { useEffect, useRef } from "react";
import { useFormContext, useWatch } from "react-hook-form";

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
  const { control, setValue } = useFormContext();
  const connectionId = useWatch({ control, name: "connectionId" }) as string | undefined;
  const apiType = useWatch({ control, name: `${fieldPrefix}.apiType` }) as
    | VegetaParams["apiType"]
    | undefined;

  const connections = useConnections();
  const connection = connectionId
    ? connections.data?.find((c) => c.id === connectionId)
    : undefined;

  // Refs track the apiType last applied as a default so a *user-driven*
  // apiType change still resets path/body (rule: "apiType is the template").
  const lastConnectionId = useRef<string | undefined>(undefined);
  const lastApiType = useRef<VegetaParams["apiType"] | undefined>(undefined);

  // When the connection changes: derive apiType from category, then path +
  // body from the new apiType + connection.model.
  useEffect(() => {
    if (!connection) return;
    if (lastConnectionId.current === connection.id) return;
    lastConnectionId.current = connection.id;
    const def = VEGETA_CATEGORY_DEFAULTS[connection.category];
    const nextApiType = def.apiType;
    setValue(`${fieldPrefix}.apiType`, nextApiType, { shouldDirty: false });
    setValue(`${fieldPrefix}.path`, VEGETA_API_TYPE_TO_PATH[nextApiType], {
      shouldDirty: false,
    });
    setValue(`${fieldPrefix}.body`, VEGETA_API_TYPE_TO_BODY[nextApiType](connection.model), {
      shouldDirty: false,
    });
    lastApiType.current = nextApiType;
  }, [connection, fieldPrefix, setValue]);

  // When apiType changes via a user pick: reset path + body to the new
  // template against the current connection.model (or "<unknown>" fallback).
  useEffect(() => {
    if (!apiType) return;
    if (lastApiType.current === apiType) return;
    lastApiType.current = apiType;
    const model = connection?.model ?? "<unknown>";
    setValue(`${fieldPrefix}.path`, VEGETA_API_TYPE_TO_PATH[apiType], { shouldDirty: false });
    setValue(`${fieldPrefix}.body`, VEGETA_API_TYPE_TO_BODY[apiType](model), {
      shouldDirty: false,
    });
  }, [apiType, connection?.model, fieldPrefix, setValue]);

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

      <details className="rounded-md border border-border bg-muted/20 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
          Advanced
        </summary>
        <div className="mt-3 space-y-4">
          <FormField
            control={control}
            name={`${fieldPrefix}.path`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Path</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="/v1/embeddings" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name={`${fieldPrefix}.body`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Body</FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    rows={6}
                    className="font-mono text-xs"
                    placeholder='{"model":"…","input":"hello"}'
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </details>
    </div>
  );
}
