import { zodResolver } from "@hookform/resolvers/zod";
import type {
  CreateLlmJudgeProvider,
  LlmJudgeProviderPublic,
  UpdateLlmJudgeProvider,
} from "@modeldoctor/contracts";
import { createLlmJudgeProviderSchema, updateLlmJudgeProviderSchema } from "@modeldoctor/contracts";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { FormActions } from "@/components/common/form-actions";
import { FormSection } from "@/components/common/form-section";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ApiError } from "@/lib/api-client";
import { toastLlmJudgeError } from "./errors";
import { useCreateLlmJudgeProvider, useTestLlmJudge, useUpdateLlmJudgeProvider } from "./queries";

interface ProviderInput {
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  enabled: boolean;
  isDefault: boolean;
}

export type ProviderSheetMode =
  | { kind: "create"; initial?: Partial<ProviderInput> }
  | { kind: "edit"; existing: LlmJudgeProviderPublic };

interface ProviderSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: ProviderSheetMode;
}

const empty: ProviderInput = {
  name: "",
  baseUrl: "",
  model: "",
  apiKey: "",
  enabled: true,
  isDefault: false,
};

function existingToFormValues(p: LlmJudgeProviderPublic): ProviderInput {
  return {
    name: p.name,
    baseUrl: p.baseUrl,
    model: p.model,
    apiKey: "", // never sent on PATCH unless rotate toggle is on
    enabled: p.enabled,
    isDefault: p.isDefault,
  };
}

export function ProviderSheet({ open, onOpenChange, mode }: ProviderSheetProps) {
  const { t } = useTranslation("llm-judge-providers");
  const { t: tc } = useTranslation("common");
  const createMut = useCreateLlmJudgeProvider();
  const updateMut = useUpdateLlmJudgeProvider();
  const testMut = useTestLlmJudge();

  const isEdit = mode.kind === "edit";
  const existing = mode.kind === "edit" ? mode.existing : null;

  const [rotateKey, setRotateKey] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm<ProviderInput>({
    resolver: zodResolver(
      isEdit ? updateLlmJudgeProviderSchema : createLlmJudgeProviderSchema,
    ) as never,
    mode: "onTouched",
    defaultValues: existing
      ? existingToFormValues(existing)
      : { ...empty, ...(mode.kind === "create" ? (mode.initial ?? {}) : {}) },
  });

  useEffect(() => {
    if (!open) return;
    const next: ProviderInput = existing
      ? existingToFormValues(existing)
      : { ...empty, ...(mode.kind === "create" ? (mode.initial ?? {}) : {}) };
    form.reset(next);
    setSubmitError(null);
    setRotateKey(false);
    // `mode` is read inside intentionally; its identity is unstable so it is
    // deliberately omitted from deps — the open false→true transition reseeds.
    // Depend on `existing?.id` (not the object) so background refetches that
    // swap the object identity don't reset the form mid-edit; `mode` is read
    // inside intentionally and omitted for the same reason.
  }, [open, existing?.id, form]);

  const baseUrlValue = form.watch("baseUrl");
  const modelValue = form.watch("model");
  const apiKeyValue = form.watch("apiKey");
  const isDefaultValue = form.watch("isDefault");

  // Invariant: the default must stay enabled. Mirror the server rule in the UI
  // by forcing the enabled checkbox on (and locking it) while isDefault is set.
  useEffect(() => {
    if (isDefaultValue) form.setValue("enabled", true);
  }, [isDefaultValue, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      const baseUrl = values.baseUrl.trim();
      if (existing) {
        const body: UpdateLlmJudgeProvider = {
          name: values.name,
          baseUrl,
          model: values.model,
          enabled: values.enabled,
          isDefault: values.isDefault,
        };
        if (rotateKey) {
          // Rotate was requested, so a fresh key is mandatory — silently keeping
          // the old key would be confusing.
          const trimmedKey = values.apiKey.trim();
          if (!trimmedKey) {
            setSubmitError(t("sheet.rotateKeyRequired"));
            return;
          }
          body.apiKey = trimmedKey;
        }
        await updateMut.mutateAsync({ id: existing.id, body });
        toast.success(t("toast.updateSuccess"));
      } else {
        const body: CreateLlmJudgeProvider = {
          name: values.name,
          baseUrl,
          model: values.model,
          apiKey: values.apiKey.trim(),
          enabled: values.enabled,
          isDefault: values.isDefault,
        };
        await createMut.mutateAsync(body);
        toast.success(t("toast.createSuccess"));
      }
      onOpenChange(false);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : undefined;
      if (code === "LLM_JUDGE_PROVIDER_NAME_TAKEN") {
        toastLlmJudgeError(t, e);
      } else {
        setSubmitError(e instanceof Error ? e.message : tc("errors.unknown"));
      }
    }
  });

  const handleTest = async () => {
    const baseUrl = baseUrlValue?.trim();
    const model = modelValue?.trim();
    const key = apiKeyValue?.trim();
    // Need baseUrl + model always. apiKey may be omitted only when editing an
    // existing provider (the saved key is resolved server-side by id).
    if (!baseUrl || !model || (!key && !existing)) {
      toast.error(t("toast.test.fillFirst"));
      return;
    }
    try {
      const r = await testMut.mutateAsync({
        baseUrl,
        model,
        ...(key ? { apiKey: key } : {}),
        ...(existing && !key ? { id: existing.id } : {}),
      });
      if (r.ok) toast.success(t("toast.test.ok", { ms: r.latencyMs }));
      else toast.error(t("toast.test.fail", { error: r.error ?? "unknown" }));
    } catch (e) {
      toast.error(t("toast.test.fail", { error: e instanceof Error ? e.message : "unknown" }));
    }
  };

  const keyDisabled = isEdit && !rotateKey;
  const keyPlaceholder =
    existing?.apiKeyPreview && existing.apiKeyPreview.length > 0
      ? existing.apiKeyPreview
      : t("sheet.fields.apiKey.placeholder");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[640px]">
        <SheetHeader>
          <SheetTitle>{isEdit ? t("sheet.editTitle") : t("sheet.createTitle")}</SheetTitle>
        </SheetHeader>

        <Form {...form}>
          <form
            onSubmit={onSubmit}
            autoComplete="off"
            className="flex min-h-0 flex-1 flex-col gap-4"
          >
            <div className="flex-1 space-y-4 overflow-y-auto pr-1">
              <FormSection>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>{t("sheet.fields.name.label")}</FormLabel>
                        <FormControl>
                          <Input
                            autoComplete="off"
                            placeholder={t("sheet.fields.name.placeholder")}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="model"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>{t("sheet.fields.model.label")}</FormLabel>
                        <FormControl>
                          <Input
                            autoComplete="off"
                            placeholder={t("sheet.fields.model.placeholder")}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="baseUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>{t("sheet.fields.baseUrl.label")}</FormLabel>
                      <FormControl>
                        <Input
                          type="url"
                          autoComplete="off"
                          placeholder={t("sheet.fields.baseUrl.placeholder")}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="apiKey"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center justify-between">
                        <FormLabel required={!isEdit}>{t("sheet.fields.apiKey.label")}</FormLabel>
                        {isEdit ? (
                          <label className="flex items-center gap-1 text-xs text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={rotateKey}
                              onChange={(e) => {
                                const next = e.target.checked;
                                setRotateKey(next);
                                if (!next) form.setValue("apiKey", "");
                              }}
                              aria-label={t("sheet.rotateKey")}
                            />
                            {t("sheet.rotateKey")}
                          </label>
                        ) : null}
                      </div>
                      <FormControl>
                        <Input
                          autoComplete="new-password"
                          type="password"
                          placeholder={keyPlaceholder}
                          disabled={keyDisabled}
                          {...field}
                        />
                      </FormControl>
                      {isEdit ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t("sheet.rotateKeyHint")}
                        </p>
                      ) : null}
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="enabled"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-start gap-2">
                        <FormControl>
                          <Checkbox
                            id="lj-enabled"
                            checked={!!field.value}
                            disabled={isDefaultValue}
                            onCheckedChange={(v) => field.onChange(v === true)}
                          />
                        </FormControl>
                        <div className="min-w-0">
                          <label
                            htmlFor="lj-enabled"
                            className="cursor-pointer text-sm font-medium leading-none"
                          >
                            {t("sheet.fields.enabled.label")}
                          </label>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {isDefaultValue
                              ? t("sheet.fields.enabled.lockedHelp")
                              : t("sheet.fields.enabled.help")}
                          </p>
                        </div>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="isDefault"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-start gap-2">
                        <FormControl>
                          <Checkbox
                            id="lj-isDefault"
                            checked={!!field.value}
                            onCheckedChange={(v) => field.onChange(v === true)}
                          />
                        </FormControl>
                        <div className="min-w-0">
                          <label
                            htmlFor="lj-isDefault"
                            className="cursor-pointer text-sm font-medium leading-none"
                          >
                            {t("sheet.fields.isDefault.label")}
                          </label>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {t("sheet.fields.isDefault.help")}
                          </p>
                        </div>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}
              </FormSection>
            </div>

            <SheetFooter className="border-t border-border pt-3">
              <FormActions
                onCancel={() => onOpenChange(false)}
                cancelLabel={tc("actions.cancel")}
                submitLabel={tc("actions.save")}
                pending={createMut.isPending || updateMut.isPending}
                leading={
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleTest}
                    disabled={!baseUrlValue?.trim() || !modelValue?.trim() || testMut.isPending}
                  >
                    {testMut.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {t("sheet.actions.testing")}
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                        {t("sheet.actions.test")}
                      </>
                    )}
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
