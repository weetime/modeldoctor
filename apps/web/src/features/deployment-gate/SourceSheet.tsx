import { zodResolver } from "@hookform/resolvers/zod";
import type { PlatformSource } from "@modeldoctor/contracts";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z } from "zod";
import { FormActions } from "@/components/common/form-actions";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { dgApi } from "./api";
import { useCreateSource, useTestSource, useUpdateSource } from "./queries";

const schema = z.object({
  name: z.string().min(1).max(120),
  baseUrl: z.string().url(),
  apiKey: z.string(),
  clusterId: z.string(),
  enabled: z.boolean(),
});
type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existing: PlatformSource | null;
}

export function SourceSheet({ open, onOpenChange, existing }: Props) {
  const { t } = useTranslation("deployment-gate");
  const { t: tCommon } = useTranslation("common");
  const create = useCreateSource();
  const update = useUpdateSource();
  const test = useTestSource();
  const form = useForm<FormValues>({
    mode: "onTouched",
    resolver: zodResolver(existing ? schema : schema.extend({ apiKey: z.string().min(1) })),
    defaultValues: { name: "", baseUrl: "", apiKey: "", clusterId: "", enabled: true },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        name: existing?.name ?? "",
        baseUrl: existing?.baseUrl ?? "",
        apiKey: "",
        clusterId: existing?.clusterId ?? "",
        enabled: existing?.enabled ?? true,
      });
    }
  }, [open, existing, form]);

  async function onTest() {
    const { baseUrl, apiKey } = form.getValues();
    try {
      const r =
        existing && !apiKey
          ? await dgApi.testSavedSource(existing.id)
          : await test.mutateAsync({ baseUrl, apiKey });
      if (r.ok) toast.success(t("sources.sheet.testOk", { count: r.modelCount ?? 0 }));
      else toast.error(t("sources.sheet.testFail", { error: r.error }));
    } catch (e) {
      toast.error(t("sources.sheet.testFail", { error: (e as Error).message }));
    }
  }

  async function onSubmit(v: FormValues) {
    const clusterId = v.clusterId.trim() || null;
    if (existing) {
      await update.mutateAsync({
        id: existing.id,
        body: {
          name: v.name,
          baseUrl: v.baseUrl,
          clusterId,
          enabled: v.enabled,
          ...(v.apiKey ? { apiKey: v.apiKey } : {}),
        },
      });
    } else {
      await create.mutateAsync({
        kind: "gpustack",
        name: v.name,
        baseUrl: v.baseUrl,
        apiKey: v.apiKey,
        clusterId,
      });
    }
    onOpenChange(false);
  }

  const pending = create.isPending || update.isPending;
  const apiKeyValue = form.watch("apiKey");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[480px] sm:max-w-[480px]">
        <SheetHeader>
          <SheetTitle>
            {existing ? t("sources.sheet.editTitle") : t("sources.sheet.createTitle")}
          </SheetTitle>
        </SheetHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="mt-6 space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>{t("sources.sheet.name")}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="baseUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>{t("sources.sheet.baseUrl")}</FormLabel>
                  <FormControl>
                    <Input placeholder="http://gpustack.example.com" {...field} />
                  </FormControl>
                  <FormDescription>{t("sources.sheet.baseUrlHint")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="apiKey"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required={!existing}>{t("sources.sheet.apiKey")}</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      autoComplete="off"
                      placeholder={existing ? t("sources.sheet.apiKeyKeep") : ""}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>{t("sources.sheet.apiKeyHint")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="clusterId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("sources.sheet.clusterId")}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormDescription>{t("sources.sheet.clusterIdHint")}</FormDescription>
                </FormItem>
              )}
            />
            {existing && (
              <FormField
                control={form.control}
                name="enabled"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between">
                    <FormLabel>{t("sources.sheet.enabled")}</FormLabel>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
            )}
            <SheetFooter className="pt-4">
              <FormActions
                onCancel={() => onOpenChange(false)}
                cancelLabel={tCommon("actions.cancel")}
                submitLabel={tCommon("actions.save")}
                pending={pending}
                leading={
                  <Button
                    type="button"
                    variant="outline"
                    onClick={onTest}
                    disabled={test.isPending || (!existing && !apiKeyValue)}
                  >
                    {test.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {t("sources.sheet.test")}
                  </Button>
                }
              />
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
