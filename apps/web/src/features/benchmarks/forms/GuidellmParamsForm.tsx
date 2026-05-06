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
import { GUIDELLM_CATEGORY_DEFAULTS, guidellmRateTypes } from "@modeldoctor/tool-adapters/schemas";
import type { GuidellmParams } from "@modeldoctor/tool-adapters/schemas";
import { useEffect, useId, useRef } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";

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

const PROFILE_HINTS: Record<GuidellmParams["profile"], string> = {
  throughput: "Saturate the backend; max-concurrency caps it.",
  latency: "1 in-flight at a time; measures single-request latency.",
  long_context: "Prompts biased to long contexts; stress KV-cache.",
  generation_heavy: "Short prompts, long outputs; output-token throughput focus.",
  sharegpt: "Replay ShareGPT prompts; realistic conversational shape.",
  custom: "Custom; rate-type and concurrency control the run shape.",
};

/** Rate types where requestRate is meaningful. Throughput / synchronous ignore it. */
const RATE_TYPES_USING_REQUEST_RATE = new Set<GuidellmParams["rateType"]>([
  "constant",
  "poisson",
  "sweep",
]);

/** Rate types where maxConcurrency is meaningful. Constant / poisson / synchronous ignore it. */
const RATE_TYPES_USING_CONCURRENCY = new Set<GuidellmParams["rateType"]>(["throughput", "sweep"]);

interface GuidellmParamsFormProps {
  fieldPrefix?: "params" | "config";
}

export function GuidellmParamsForm({ fieldPrefix = "params" }: GuidellmParamsFormProps = {}) {
  const { control, register, setValue } = useFormContext();

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
    const def = GUIDELLM_CATEGORY_DEFAULTS[connection.category];
    if ("apiType" in def) {
      setValue(`${fieldPrefix}.apiType`, def.apiType, { shouldDirty: false });
    }
  }, [connection, fieldPrefix, setValue]);

  const unsupported =
    connection && "unsupported" in GUIDELLM_CATEGORY_DEFAULTS[connection.category];

  const profile = useWatch({ control, name: `${fieldPrefix}.profile` }) as
    | GuidellmParams["profile"]
    | undefined;
  const datasetName = useWatch({ control, name: `${fieldPrefix}.datasetName` }) as
    | GuidellmParams["datasetName"]
    | undefined;
  const rateType = useWatch({ control, name: `${fieldPrefix}.rateType` }) as
    | GuidellmParams["rateType"]
    | undefined;
  const validateBackend = useWatch({ control, name: `${fieldPrefix}.validateBackend` }) as
    | boolean
    | undefined;

  // Editing a legacy template whose config omits rateType: write "constant"
  // so submitting doesn't 400 with "rateType: Required".
  useEffect(() => {
    if (rateType === undefined) {
      setValue(`${fieldPrefix}.rateType`, "constant", { shouldValidate: true });
    }
  }, [rateType, setValue, fieldPrefix]);

  const idPrefix = useId();
  const ids = {
    seed: `${idPrefix}-seed`,
    processor: `${idPrefix}-processor`,
    validateBackend: `${idPrefix}-validateBackend`,
  };

  const showRequestRate = rateType !== undefined && RATE_TYPES_USING_REQUEST_RATE.has(rateType);
  const showMaxConcurrency = rateType !== undefined && RATE_TYPES_USING_CONCURRENCY.has(rateType);

  return (
    <div className="space-y-4">
      {/* Required tokens — only when datasetName=random (no defaults in
          guidellmParamDefaults; superRefine enforces). Asterisks let the
          user know upfront, instead of a 400 on submit. */}
      {datasetName === "random" && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField
            control={control}
            name={`${fieldPrefix}.datasetInputTokens`}
            render={({ field }) => (
              <FormItem>
                <FormLabel required>Input tokens</FormLabel>
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
            name={`${fieldPrefix}.datasetOutputTokens`}
            render={({ field }) => (
              <FormItem>
                <FormLabel required>Output tokens</FormLabel>
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
      )}

      {/* Profile config — sensible defaults pre-filled; user changes per
          need. No asterisks here. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FormField
          control={control}
          name={`${fieldPrefix}.profile`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Profile</FormLabel>
              <Select onValueChange={field.onChange} value={field.value ?? ""}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select profile" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {PROFILES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {profile ? <FormDescription>{PROFILE_HINTS[profile]}</FormDescription> : null}
              <FormMessage />
            </FormItem>
          )}
        />
        {unsupported && connection && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {t("forms.unsupportedCategory.guidellm", { category: connection.category })}
          </p>
        )}
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
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FormField
          control={control}
          name={`${fieldPrefix}.datasetName`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Dataset</FormLabel>
              <Select onValueChange={field.onChange} value={field.value ?? ""}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select dataset" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {DATASETS.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name={`${fieldPrefix}.rateType`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Rate type</FormLabel>
              <Select onValueChange={field.onChange} value={field.value ?? ""}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select rate type" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {guidellmRateTypes.map((rt) => (
                    <SelectItem key={rt} value={rt}>
                      {rt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      {/* Scale knobs — Total requests + Max duration always shown.
          Request rate hides when rateType ignores it (throughput,
          synchronous). Max concurrency hides when rateType ignores it
          (constant, poisson, synchronous). */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FormField
          control={control}
          name={`${fieldPrefix}.totalRequests`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Total requests</FormLabel>
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
          name={`${fieldPrefix}.maxDurationSeconds`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Max duration (s)</FormLabel>
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

      {(showRequestRate || showMaxConcurrency) && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {showRequestRate ? (
            <FormField
              control={control}
              name={`${fieldPrefix}.requestRate`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Request rate (0 = unlimited)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.1"
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
          ) : null}
          {showMaxConcurrency ? (
            <FormField
              control={control}
              name={`${fieldPrefix}.maxConcurrency`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Max concurrency</FormLabel>
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
          ) : null}
        </div>
      )}

      {/* Advanced — collapsible, default closed. */}
      <details className="rounded-md border border-border bg-muted/20 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
          Advanced
        </summary>
        <div className="mt-3 space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={ids.seed}>Dataset seed (optional)</Label>
              <Input
                id={ids.seed}
                type="number"
                {...register(`${fieldPrefix}.datasetSeed`, {
                  setValueAs: (v) => (v === "" || v === undefined ? undefined : Number(v)),
                })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={ids.processor}>Processor (optional)</Label>
              <Input
                id={ids.processor}
                {...register(`${fieldPrefix}.processor`, {
                  setValueAs: (v) => (v === "" || v === undefined ? undefined : v),
                })}
                placeholder="HuggingFace tokenizer name"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Switch
              id={ids.validateBackend}
              checked={validateBackend === true}
              onCheckedChange={(v) =>
                setValue(`${fieldPrefix}.validateBackend`, v, { shouldValidate: true })
              }
            />
            <Label htmlFor={ids.validateBackend}>Validate backend before run</Label>
          </div>
        </div>
      </details>
    </div>
  );
}
