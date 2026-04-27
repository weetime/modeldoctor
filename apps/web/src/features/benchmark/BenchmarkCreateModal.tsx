import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useId, useRef } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { BenchmarkEndpointFields } from "./BenchmarkEndpointFields";
import { BenchmarkProfilePicker } from "./BenchmarkProfilePicker";
import { profileLabelKey } from "./profiles";
import { useBenchmarkDetail, useCreateBenchmark } from "./queries";
import {
  type BenchmarkRun,
  type CreateBenchmarkRequest,
  CreateBenchmarkRequestSchema,
} from "./schemas";

function mapDuplicateToDefaults(run: BenchmarkRun): CreateBenchmarkRequest {
  return {
    name: `${run.name}-2`,
    description: run.description ?? undefined,
    profile: run.profile,
    apiType: run.apiType,
    apiUrl: run.apiUrl,
    apiKey: "",
    model: run.model,
    datasetName: run.datasetName,
    datasetInputTokens: run.datasetInputTokens ?? undefined,
    datasetOutputTokens: run.datasetOutputTokens ?? undefined,
    datasetSeed: run.datasetSeed ?? undefined,
    requestRate: run.requestRate,
    totalRequests: run.totalRequests,
  };
}

const BASIC_FIELDS: (keyof CreateBenchmarkRequest)[] = [
  "name",
  "description",
  "apiType",
  "apiUrl",
  "apiKey",
  "model",
];

const CONFIG_FIELDS: (keyof CreateBenchmarkRequest)[] = [
  "profile",
  "datasetName",
  "datasetInputTokens",
  "datasetOutputTokens",
  "requestRate",
  "totalRequests",
  "datasetSeed",
];

export function BenchmarkCreateModal() {
  const { t } = useTranslation("benchmark");
  const [searchParams, setSearchParams] = useSearchParams();
  const nameId = useId();
  const descId = useId();

  const duplicateId = searchParams.get("duplicate");
  const open = searchParams.get("create") === "1" || duplicateId !== null;

  const sourceQuery = useBenchmarkDetail(duplicateId ?? "");
  const sourceRun = duplicateId ? sourceQuery.data : undefined;

  const form = useForm<CreateBenchmarkRequest>({
    resolver: zodResolver(CreateBenchmarkRequestSchema),
    mode: "onChange",
    defaultValues: {
      name: "",
      description: "",
      profile: "throughput",
      apiType: "chat",
      apiUrl: "",
      apiKey: "",
      model: "",
      datasetName: "random",
      datasetInputTokens: 1024,
      datasetOutputTokens: 128,
      requestRate: 0,
      totalRequests: 1000,
    },
  });

  const duplicateApplied = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      form.reset();
      duplicateApplied.current = null;
      return;
    }
    if (sourceRun && duplicateApplied.current !== sourceRun.id) {
      form.reset(mapDuplicateToDefaults(sourceRun));
      duplicateApplied.current = sourceRun.id;
    }
  }, [open, sourceRun, form]);

  const close = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("create");
    next.delete("duplicate");
    setSearchParams(next, { replace: true });
  };

  const errors = form.formState.errors;
  const basicHasError = BASIC_FIELDS.some((f) => errors[f]);
  const configHasError = CONFIG_FIELDS.some((f) => errors[f]);
  const profile = form.watch("profile");
  const datasetName = form.watch("datasetName");
  const navigate = useNavigate();
  const createMut = useCreateBenchmark();

  const onSubmit = form.handleSubmit(async (values) => {
    const run = await createMut.mutateAsync(values);
    toast.success(`Benchmark "${run.name}" submitted`);
    close();
    navigate(`/benchmarks/${run.id}`);
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) close();
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("create.title")}</DialogTitle>
          <DialogDescription>{t("create.subtitle")}</DialogDescription>
        </DialogHeader>

        {duplicateId && sourceRun && (
          <Alert className="border-yellow-300 bg-yellow-50 text-yellow-900">
            <AlertDescription>
              {t("create.duplicateBanner", { name: sourceRun.name })}
            </AlertDescription>
          </Alert>
        )}

        <FormProvider {...form}>
          <form onSubmit={onSubmit} className="space-y-4">
            <Tabs defaultValue="basic">
              <TabsList>
                <TabsTrigger value="basic">
                  {t("create.tabs.basic")}
                  {basicHasError && (
                    <span
                      data-testid="basic-error-dot"
                      className="ml-1 inline-block size-1.5 rounded-full bg-destructive"
                    />
                  )}
                </TabsTrigger>
                <TabsTrigger value="config">
                  {t("create.tabs.config")}
                  {configHasError && (
                    <span
                      data-testid="config-error-dot"
                      className="ml-1 inline-block size-1.5 rounded-full bg-destructive"
                    />
                  )}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="basic" className="space-y-3 pt-2">
                <div>
                  <Label htmlFor={nameId}>{t("create.fields.name")}</Label>
                  <Input id={nameId} {...form.register("name")} />
                </div>
                <div>
                  <Label htmlFor={descId}>{t("create.fields.description")}</Label>
                  <Textarea id={descId} rows={2} {...form.register("description")} />
                </div>
                <BenchmarkEndpointFields requireApiKeyHighlight={!!duplicateId} />
              </TabsContent>

              <TabsContent value="config" className="space-y-3 pt-2">
                <BenchmarkProfilePicker />
                {profile !== "custom" && profile !== "sharegpt" && (
                  <Alert>
                    <AlertDescription>
                      {t("create.presetLoaded", {
                        profile: t(`profiles.${profileLabelKey(profile)}`),
                      })}
                    </AlertDescription>
                  </Alert>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>{t("create.fields.dataset")}</Label>
                    <Select
                      value={datasetName}
                      onValueChange={(v) =>
                        form.setValue("datasetName", v as "random" | "sharegpt", {
                          shouldValidate: true,
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="random">{t("datasets.random")}</SelectItem>
                        <SelectItem value="sharegpt" disabled>
                          {t("datasets.sharegpt")} {t("comingSoon")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>{t("create.fields.seed")}</Label>
                    <Input
                      type="number"
                      {...form.register("datasetSeed", {
                        setValueAs: (v) => (v === "" ? undefined : Number(v)),
                      })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>{t("create.fields.inputTokens")}</Label>
                    <Input
                      type="number"
                      {...form.register("datasetInputTokens", {
                        valueAsNumber: true,
                      })}
                    />
                  </div>
                  <div>
                    <Label>{t("create.fields.outputTokens")}</Label>
                    <Input
                      type="number"
                      {...form.register("datasetOutputTokens", {
                        valueAsNumber: true,
                      })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>{t("create.fields.requestRate")}</Label>
                    <Input
                      type="number"
                      {...form.register("requestRate", { valueAsNumber: true })}
                    />
                  </div>
                  <div>
                    <Label>{t("create.fields.totalRequests")}</Label>
                    <Input
                      type="number"
                      {...form.register("totalRequests", {
                        valueAsNumber: true,
                      })}
                    />
                  </div>
                </div>
              </TabsContent>
            </Tabs>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                {t("actions.cancel")}
              </Button>
              <Button type="submit" disabled={!form.formState.isValid || createMut.isPending}>
                {createMut.isPending ? "…" : t("create.submit")}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
