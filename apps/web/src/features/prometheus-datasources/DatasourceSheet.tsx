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
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api-client";
import { zodResolver } from "@hookform/resolvers/zod";
import type {
  CreatePrometheusDatasource,
  PrometheusDatasourcePublic,
  PrometheusDatasourceWithSecret,
  UpdatePrometheusDatasource,
} from "@modeldoctor/contracts";
import {
  createPrometheusDatasourceSchema,
  updatePrometheusDatasourceSchema,
} from "@modeldoctor/contracts";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { toastDatasourceError } from "./errors";
import { useCreateDatasource, useUpdateDatasource, useVerifyDatasource } from "./queries";

/** Form input shape — mirrors the create schema with empty strings for absent values. */
export interface DatasourceInput {
  name: string;
  baseUrl: string;
  bearerToken: string;
  customHeaders: string;
  isDefault: boolean;
}

/**
 * Sheet mode — `create` for a brand-new row, `edit` to modify an existing
 * one. In edit mode, the bearerToken field is hidden by default (preview
 * chip shown); the user clicks "Rotate" to send a fresh value. With Rotate
 * off, the PATCH body omits `bearerToken` entirely so the saved secret is
 * preserved.
 */
export type DatasourceSheetMode =
  | { kind: "create"; initial?: Partial<DatasourceInput> }
  | { kind: "edit"; existing: PrometheusDatasourcePublic };

interface DatasourceSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: DatasourceSheetMode;
  onSaved?: (ds: PrometheusDatasourcePublic | PrometheusDatasourceWithSecret) => void;
}

const empty: DatasourceInput = {
  name: "",
  baseUrl: "",
  bearerToken: "",
  customHeaders: "",
  isDefault: false,
};

function existingToFormValues(ds: PrometheusDatasourcePublic): DatasourceInput {
  return {
    name: ds.name,
    baseUrl: ds.baseUrl,
    bearerToken: "", // never sent in PATCH unless rotate toggle is on
    customHeaders: ds.customHeaders,
    isDefault: ds.isDefault,
  };
}

export function DatasourceSheet({ open, onOpenChange, mode, onSaved }: DatasourceSheetProps) {
  const { t } = useTranslation("prometheus-datasources");
  const { t: tc } = useTranslation("common");
  const createMut = useCreateDatasource();
  const updateMut = useUpdateDatasource();
  const verifyMut = useVerifyDatasource();

  const isEdit = mode.kind === "edit";
  const existing = mode.kind === "edit" ? mode.existing : null;

  const [rotateBearer, setRotateBearer] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm<DatasourceInput>({
    // In edit mode every field is optional (PATCH semantics — the user can
    // submit a rename without re-typing the URL), so we branch the resolver.
    resolver: zodResolver(
      isEdit ? updatePrometheusDatasourceSchema : createPrometheusDatasourceSchema,
    ) as never,
    mode: "onTouched",
    defaultValues: existing
      ? existingToFormValues(existing)
      : { ...empty, ...(mode.kind === "create" ? (mode.initial ?? {}) : {}) },
  });

  // Reseed the form whenever the sheet opens (or `existing` swaps) so a
  // reopen with a fresh `initial` doesn't stick on stale state. We read
  // `mode.initial` inside the effect rather than via deps — `mode` is a
  // fresh object identity per parent render and would cause the effect
  // to fire on every render. The "open false → true" transition is the
  // only moment we need a reseed in practice (pill click always toggles
  // `open` through false-to-true).
  useEffect(() => {
    if (!open) return;
    const next: DatasourceInput = existing
      ? existingToFormValues(existing)
      : { ...empty, ...(mode.kind === "create" ? (mode.initial ?? {}) : {}) };
    form.reset(next);
    setSubmitError(null);
    setRotateBearer(false);
    // biome-ignore lint/correctness/useExhaustiveDependencies: `mode` identity is unstable; we read it inside the effect intentionally
  }, [open, existing, form]);

  const baseUrlValue = form.watch("baseUrl");
  const bearerTokenValue = form.watch("bearerToken");
  const customHeadersValue = form.watch("customHeaders");

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      const trimmedBearer = values.bearerToken.trim();
      if (existing) {
        const body: UpdatePrometheusDatasource = {
          name: values.name,
          baseUrl: values.baseUrl,
          customHeaders: values.customHeaders,
          isDefault: values.isDefault,
        };
        if (rotateBearer) {
          // Empty string clears the token (anonymous Prometheus); non-empty rotates.
          body.bearerToken = trimmedBearer;
        }
        const saved = await updateMut.mutateAsync({ id: existing.id, body });
        toast.success(t("toast.updateSuccess"));
        onSaved?.(saved);
      } else {
        const body: CreatePrometheusDatasource = {
          name: values.name,
          baseUrl: values.baseUrl,
          customHeaders: values.customHeaders,
          isDefault: values.isDefault,
        };
        if (trimmedBearer.length > 0) {
          body.bearerToken = trimmedBearer;
        }
        const saved = await createMut.mutateAsync(body);
        toast.success(t("toast.createSuccess"));
        onSaved?.(saved);
      }
      onOpenChange(false);
    } catch (e) {
      // Conflict codes (name/baseUrl taken) get per-code i18n via toast;
      // everything else surfaces inline so the user keeps form context.
      const code = e instanceof ApiError ? e.code : undefined;
      if (
        code === "PROMETHEUS_DATASOURCE_NAME_TAKEN" ||
        code === "PROMETHEUS_DATASOURCE_BASEURL_TAKEN"
      ) {
        toastDatasourceError(t, e);
      } else {
        const msg = e instanceof Error ? e.message : tc("errors.unknown");
        setSubmitError(msg);
      }
    }
  });

  const handleVerify = async () => {
    const baseUrl = baseUrlValue?.trim();
    if (!baseUrl) return;
    try {
      // For edit + rotate-off, send the existing bearer (server-side, by id)
      // is not what verify supports — verify is stateless. So we send the
      // current form value, or undefined if rotate is off in edit mode.
      const bearerToken =
        isEdit && !rotateBearer
          ? undefined
          : bearerTokenValue?.trim()
            ? bearerTokenValue.trim()
            : undefined;
      const customHeaders = customHeadersValue?.trim() || undefined;
      const res = await verifyMut.mutateAsync({ baseUrl, bearerToken, customHeaders });
      if (res.ok) {
        toast.success(
          res.version
            ? t("toast.verify.ok", { version: res.version })
            : t("toast.verify.okNoVersion"),
        );
      } else {
        toast.error(t("toast.verify.fail", { reason: res.reason ?? "" }));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : tc("errors.unknown");
      toast.error(t("toast.verify.fail", { reason: msg }));
    }
  };

  const bearerDisabled = isEdit && !rotateBearer;
  const bearerPlaceholder =
    existing?.bearerPreview && existing.bearerPreview.length > 0
      ? existing.bearerPreview
      : t("sheet.fields.bearerToken.placeholder");

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
                </div>

                <FormField
                  control={form.control}
                  name="bearerToken"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center justify-between">
                        <FormLabel>{t("sheet.fields.bearerToken.label")}</FormLabel>
                        {isEdit ? (
                          <label className="flex items-center gap-1 text-xs text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={rotateBearer}
                              onChange={(e) => {
                                const next = e.target.checked;
                                setRotateBearer(next);
                                if (!next) form.setValue("bearerToken", "");
                              }}
                              aria-label={t("sheet.rotateBearer")}
                            />
                            {t("sheet.rotateBearer")}
                          </label>
                        ) : null}
                      </div>
                      <FormControl>
                        <Input
                          autoComplete="new-password"
                          type="password"
                          placeholder={bearerPlaceholder}
                          disabled={bearerDisabled}
                          {...field}
                        />
                      </FormControl>
                      {isEdit ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t("sheet.rotateBearerHint")}
                        </p>
                      ) : null}
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="customHeaders"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("sheet.fields.customHeaders.label")}</FormLabel>
                      <FormControl>
                        <Textarea
                          rows={3}
                          placeholder={t("sheet.fields.customHeaders.placeholder")}
                          {...field}
                        />
                      </FormControl>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("sheet.fields.customHeaders.help")}
                      </p>
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
                            id="isDefault"
                            checked={!!field.value}
                            onCheckedChange={(v) => field.onChange(v === true)}
                          />
                        </FormControl>
                        <div className="min-w-0">
                          <label
                            htmlFor="isDefault"
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
                    onClick={handleVerify}
                    disabled={!baseUrlValue?.trim() || verifyMut.isPending}
                  >
                    {verifyMut.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {t("sheet.actions.verifying")}
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                        {t("sheet.actions.verify")}
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
