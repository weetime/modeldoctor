import { useEffect, useId } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BenchmarkEndpointFields } from "./BenchmarkEndpointFields";
import { BenchmarkProfilePicker } from "./BenchmarkProfilePicker";
import { profileLabelKey } from "./profiles";
import { useCreateBenchmark } from "./queries";
import {
  CreateBenchmarkRequestSchema,
  type CreateBenchmarkRequest,
} from "./schemas";

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

  const open = searchParams.get("create") === "1";

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

  useEffect(() => {
    if (!open) form.reset();
  }, [open, form]);

  const close = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("create");
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
                  <Label htmlFor={descId}>
                    {t("create.fields.description")}
                  </Label>
                  <Textarea
                    id={descId}
                    rows={2}
                    {...form.register("description")}
                  />
                </div>
                <BenchmarkEndpointFields />
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
                        form.setValue(
                          "datasetName",
                          v as "random" | "sharegpt",
                          {
                            shouldValidate: true,
                          },
                        )
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="random">
                          {t("datasets.random")}
                        </SelectItem>
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
                        setValueAs: (v) =>
                          v === "" ? undefined : Number(v),
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
              <Button
                type="submit"
                disabled={!form.formState.isValid || createMut.isPending}
              >
                {createMut.isPending ? "…" : t("create.submit")}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
