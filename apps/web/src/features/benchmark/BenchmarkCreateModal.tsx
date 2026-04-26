import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
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
import { BenchmarkEndpointFields } from "./BenchmarkEndpointFields";
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

export function BenchmarkCreateModal() {
  const { t } = useTranslation("benchmark");
  const [searchParams, setSearchParams] = useSearchParams();

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

  const onSubmit = form.handleSubmit((values) => {
    // Real submit lands in Task 4.
    toast.success("Submitted (stub)");
    console.info("benchmark submit stub", values);
    close();
  });

  const errors = form.formState.errors;
  const basicHasError = BASIC_FIELDS.some((f) => errors[f]);

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
                </TabsTrigger>
              </TabsList>

              <TabsContent value="basic" className="space-y-3 pt-2">
                <div>
                  <Label>{t("create.fields.name")}</Label>
                  <Input {...form.register("name")} />
                </div>
                <div>
                  <Label>{t("create.fields.description")}</Label>
                  <Textarea rows={2} {...form.register("description")} />
                </div>
                <BenchmarkEndpointFields />
              </TabsContent>

              <TabsContent value="config" className="pt-2">
                <p className="text-sm text-muted-foreground">
                  Configuration tab implementation arrives in Task 4.
                </p>
              </TabsContent>
            </Tabs>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                {t("actions.cancel")}
              </Button>
              <Button type="submit" disabled={!form.formState.isValid}>
                {t("create.submit")}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
